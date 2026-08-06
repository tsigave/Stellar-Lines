import { chooseJourneys } from "./choice.js";
import { DEFAULT_CHOICE_PARAMETERS } from "./parameters.js";
import type {
  AllocatedJourney,
  ChoiceParameters,
  ChoiceRequest,
  JourneyOption,
  MarketDemand,
  PassengerClass,
  ServiceLeg,
} from "./types.js";

export interface CapacityAllocation {
  allocations: readonly AllocatedJourney[];
  initialNoTravelByMarket: ReadonlyMap<string, number>;
  capacityLostByMarket: ReadonlyMap<string, number>;
}

function marketKey(market: MarketDemand): string {
  return `${market.originPortId}->${market.destinationPortId}:${market.passengerType}`;
}

function allocationKey(market: MarketDemand, option: JourneyOption): string {
  return `${marketKey(market)}|${option.id}`;
}

function serviceCapacityKey(
  serviceLegId: string,
  passengerClass: PassengerClass,
  availableCapacity: ReadonlyMap<string, number>,
): string {
  const classKey = `${serviceLegId}:${passengerClass}`;
  return availableCapacity.has(classKey) ? classKey : `${serviceLegId}:*`;
}

function applyCapacityPass(
  requests: readonly ChoiceRequest[],
  availableCapacity: ReadonlyMap<string, number>,
): Map<string, number> {
  const totalRequestedByLeg = new Map<string, number>();
  for (const request of requests) {
    for (const option of request.options) {
      const requested = request.requestedByOption.get(option.id) ?? 0;
      for (const serviceLegId of option.serviceLegIds) {
        const legId = serviceCapacityKey(
          serviceLegId,
          option.cabinClass,
          availableCapacity,
        );
        totalRequestedByLeg.set(legId, (totalRequestedByLeg.get(legId) ?? 0) + requested);
      }
    }
  }

  const actualByAllocation = new Map<string, number>();
  for (const request of requests) {
    for (const option of request.options) {
      const requested = request.requestedByOption.get(option.id) ?? 0;
      let scale = 1;
      for (const serviceLegId of option.serviceLegIds) {
        const legId = serviceCapacityKey(
          serviceLegId,
          option.cabinClass,
          availableCapacity,
        );
        const totalRequested = totalRequestedByLeg.get(legId) ?? 0;
        const capacity = availableCapacity.get(legId) ?? 0;
        if (totalRequested > 0) scale = Math.min(scale, capacity / totalRequested);
      }
      actualByAllocation.set(
        allocationKey(request.market, option),
        requested * Math.max(0, Math.min(1, scale)),
      );
    }
  }
  return actualByAllocation;
}

function usedCapacity(
  requests: readonly ChoiceRequest[],
  actual: ReadonlyMap<string, number>,
  availableCapacity: ReadonlyMap<string, number>,
): Map<string, number> {
  const used = new Map<string, number>();
  for (const request of requests) {
    for (const option of request.options) {
      const passengers = actual.get(allocationKey(request.market, option)) ?? 0;
      for (const serviceLegId of option.serviceLegIds) {
        const legId = serviceCapacityKey(
          serviceLegId,
          option.cabinClass,
          availableCapacity,
        );
        used.set(legId, (used.get(legId) ?? 0) + passengers);
      }
    }
  }
  return used;
}

export function allocateCapacity(
  markets: readonly MarketDemand[],
  optionsByMarket: ReadonlyMap<string, readonly JourneyOption[]>,
  services: readonly ServiceLeg[],
  choiceParameters: ChoiceParameters = DEFAULT_CHOICE_PARAMETERS,
): CapacityAllocation {
  const capacity = new Map<string, number>();
  for (const service of services) {
    if (service.dailySeatCapacityByClass) {
      for (const passengerClass of ["economy", "business", "premium"] as const) {
        capacity.set(
          `${service.id}:${passengerClass}`,
          service.dailySeatCapacityByClass[passengerClass],
        );
      }
    } else {
      capacity.set(`${service.id}:*`, service.dailySeatCapacity);
    }
  }
  const firstRequests = markets.map((market) =>
    chooseJourneys(market, optionsByMarket.get(marketKey(market)) ?? [], choiceParameters),
  );
  const firstActual = applyCapacityPass(firstRequests, capacity);
  const firstUsed = usedCapacity(firstRequests, firstActual, capacity);
  const residualCapacity = new Map<string, number>();
  for (const [legId, legCapacity] of capacity) {
    residualCapacity.set(legId, Math.max(0, legCapacity - (firstUsed.get(legId) ?? 0)));
  }

  const overflowByMarket = new Map<string, number>();
  const secondRequests: ChoiceRequest[] = [];
  for (const request of firstRequests) {
    let overflow = 0;
    for (const option of request.options) {
      const requested = request.requestedByOption.get(option.id) ?? 0;
      const actual = firstActual.get(allocationKey(request.market, option)) ?? 0;
      overflow += Math.max(0, requested - actual);
    }
    overflowByMarket.set(marketKey(request.market), overflow);
    if (overflow <= 0) continue;

    const availableOptions = request.options.filter((option) =>
      option.serviceLegIds.every((serviceLegId) => {
        const legId = serviceCapacityKey(
          serviceLegId,
          option.cabinClass,
          residualCapacity,
        );
        return (residualCapacity.get(legId) ?? 0) > 1e-9;
      }),
    );
    secondRequests.push(
      chooseJourneys(request.market, availableOptions, choiceParameters, overflow),
    );
  }

  const secondActual = applyCapacityPass(secondRequests, residualCapacity);
  const allocationRecords = new Map<string, AllocatedJourney>();

  const mergePass = (
    requests: readonly ChoiceRequest[],
    actual: ReadonlyMap<string, number>,
    includeRequested: boolean,
  ): void => {
    for (const request of requests) {
      for (const option of request.options) {
        const key = allocationKey(request.market, option);
        const current = allocationRecords.get(key);
        allocationRecords.set(key, {
          market: request.market,
          option,
          requestedPassengers:
            (current?.requestedPassengers ?? 0) +
            (includeRequested ? (request.requestedByOption.get(option.id) ?? 0) : 0),
          actualPassengers:
            (current?.actualPassengers ?? 0) + (actual.get(key) ?? 0),
        });
      }
    }
  };

  mergePass(firstRequests, firstActual, true);
  mergePass(secondRequests, secondActual, false);

  const initialNoTravelByMarket = new Map(
    firstRequests.map((request) => [marketKey(request.market), request.initialNoTravel]),
  );
  const secondRequestsByMarket = new Map(
    secondRequests.map((request) => [marketKey(request.market), request]),
  );
  const capacityLostByMarket = new Map<string, number>();
  for (const market of markets) {
    const key = marketKey(market);
    const secondRequest = secondRequestsByMarket.get(key);
    let secondServed = 0;
    if (secondRequest) {
      for (const option of secondRequest.options) {
        secondServed += secondActual.get(allocationKey(market, option)) ?? 0;
      }
    }
    capacityLostByMarket.set(key, Math.max(0, (overflowByMarket.get(key) ?? 0) - secondServed));
  }

  return {
    allocations: [...allocationRecords.values()],
    initialNoTravelByMarket,
    capacityLostByMarket,
  };
}

export function capacityMarketKey(market: MarketDemand): string {
  return marketKey(market);
}
