import { allocateCapacity, capacityMarketKey } from "./capacity.js";
import { chooseJourneys, explainJourneyChoice } from "./choice.js";
import { buildJourneyOptionsForMarkets, type JourneySearchOptions } from "./journeys.js";
import { DEFAULT_CHOICE_PARAMETERS } from "./parameters.js";
import type {
  ChoiceParameters,
  CompanySettlement,
  DaySettlement,
  MarketDemand,
  MarketSettlement,
  PassengerClass,
  PassengerType,
  RouteCostBreakdown,
  ServiceLeg,
  ServiceSettlement,
} from "./types.js";
import { PASSENGER_CLASSES } from "./types.js";

function zeroCabins(): Record<PassengerClass, number> {
  return { economy: 0, business: 0, premium: 0 };
}

function zeroPassengerTypes(): Record<PassengerType, number> {
  return { business: 0, leisure: 0, budget: 0, luxury: 0 };
}

function zeroCosts(): RouteCostBreakdown {
  return {
    fuel: 0, staff: 0, port: 0, flightMaintenance: 0, fixedMaintenance: 0,
    ageSurcharge: 0, depreciation: 0, delay: 0, other: 0, total: 0,
  };
}

export interface SimulateDayInput {
  markets: readonly MarketDemand[];
  services: readonly ServiceLeg[];
  choiceParameters?: ChoiceParameters;
  journeySearch?: JourneySearchOptions;
  fuelInventorySupplies?: readonly FuelInventorySupply[];
}

export interface FuelInventorySupply {
  companyId: string;
  portId: string;
  availableUnits: number;
  averageUnitCost: number;
  useAtOrAbove: number;
}

export function simulateDay(input: SimulateDayInput): DaySettlement {
  const choiceParameters = input.choiceParameters ?? DEFAULT_CHOICE_PARAMETERS;
  const optionsByMarket = buildJourneyOptionsForMarkets(input.services, input.markets, {
    ...input.journeySearch,
    choiceParameters,
  });
  const capacityAllocation = allocateCapacity(
    input.markets,
    optionsByMarket,
    input.services,
    choiceParameters,
  );

  const allocationsByMarket = new Map<
    string,
    (typeof capacityAllocation.allocations)[number][]
  >();
  for (const allocation of capacityAllocation.allocations) {
    const key = capacityMarketKey(allocation.market);
    const entries = allocationsByMarket.get(key) ?? [];
    entries.push(allocation);
    allocationsByMarket.set(key, entries);
  }

  const marketSettlements: MarketSettlement[] = input.markets.map((market) => {
    const key = capacityMarketKey(market);
    const journeys = allocationsByMarket.get(key) ?? [];
    const passengersByClass = zeroCabins();
    for (const journey of journeys) {
      passengersByClass[journey.option.cabinClass] += journey.actualPassengers;
    }
    const representative = [...journeys]
      .filter((journey) => journey.actualPassengers > 0)
      .sort((a, b) => b.actualPassengers - a.actualPassengers)[0];
    const explanation = representative
      ? explainJourneyChoice(market, representative.option)
      : { satisfaction: 0, positive: [], negative: [{ code: "no-service", text: "没有足够有吸引力且可用的直达座位", impact: 40, positive: false }] };
    const currentNoTravel = capacityAllocation.initialNoTravelByMarket.get(key) ?? 0;
    const zeroFareOptions = (optionsByMarket.get(key) ?? []).map((option) => ({
      ...option,
      fare: 0,
      fareByServiceLeg: option.fareByServiceLeg.map(() => 0),
    }));
    const zeroFareNoTravel = chooseJourneys(market, zeroFareOptions, choiceParameters).initialNoTravel;
    return {
      market,
      actualPassengers: journeys.reduce(
        (sum, journey) => sum + journey.actualPassengers,
        0,
      ),
      initialNoTravelPassengers: currentNoTravel,
      capacityLostPassengers: capacityAllocation.capacityLostByMarket.get(key) ?? 0,
      priceLostPassengers: Math.max(0, currentNoTravel - zeroFareNoTravel),
      passengersByClass,
      evaluation: {
        passengerType: market.passengerType,
        satisfaction: explanation.satisfaction,
        passengers: journeys.reduce((sum, journey) => sum + journey.actualPassengers, 0),
        positiveReasons: explanation.positive,
        negativeReasons: explanation.negative,
      },
      journeys,
    };
  });

  const passengerByService = new Map<string, number>();
  const revenueByService = new Map<string, number>();
  const satisfactionByService = new Map<string, number>();
  const passengersByServiceClass = new Map<string, Record<PassengerClass, number>>();
  const revenueByServiceClass = new Map<string, Record<PassengerClass, number>>();
  const passengersByServiceType = new Map<string, Record<PassengerType, number>>();
  for (const allocation of capacityAllocation.allocations) {
    allocation.option.serviceLegIds.forEach((serviceLegId, index) => {
      passengerByService.set(
        serviceLegId,
        (passengerByService.get(serviceLegId) ?? 0) + allocation.actualPassengers,
      );
      revenueByService.set(
        serviceLegId,
        (revenueByService.get(serviceLegId) ?? 0) +
          allocation.actualPassengers * (allocation.option.fareByServiceLeg[index] ?? 0),
      );
      satisfactionByService.set(
        serviceLegId,
        (satisfactionByService.get(serviceLegId) ?? 0) +
          allocation.actualPassengers * allocation.option.satisfaction,
      );
      const classPassengers = passengersByServiceClass.get(serviceLegId) ?? zeroCabins();
      classPassengers[allocation.option.cabinClass] += allocation.actualPassengers;
      passengersByServiceClass.set(serviceLegId, classPassengers);
      const classRevenue = revenueByServiceClass.get(serviceLegId) ?? zeroCabins();
      classRevenue[allocation.option.cabinClass] += allocation.actualPassengers *
        (allocation.option.fareByServiceLeg[index] ?? 0);
      revenueByServiceClass.set(serviceLegId, classRevenue);
      const typePassengers = passengersByServiceType.get(serviceLegId) ?? zeroPassengerTypes();
      typePassengers[allocation.market.passengerType] += allocation.actualPassengers;
      passengersByServiceType.set(serviceLegId, typePassengers);
    });
  }

  const remainingFuelInventory = new Map(
    (input.fuelInventorySupplies ?? []).map((supply) => [
      `${supply.companyId}:${supply.portId}`,
      { ...supply },
    ]),
  );
  const serviceSettlements: ServiceSettlement[] = input.services.map((service) => {
    const passengers = passengerByService.get(service.id) ?? 0;
    const passengersByClass = passengersByServiceClass.get(service.id) ?? zeroCabins();
    const revenueByClass = revenueByServiceClass.get(service.id) ?? zeroCabins();
    const capacityByClass = service.dailySeatCapacityByClass ?? {
      economy: service.dailySeatCapacity,
      business: 0,
      premium: 0,
    };
    const loadFactorByClass = Object.fromEntries(PASSENGER_CLASSES.map((cabinClass) => [
      cabinClass,
      capacityByClass[cabinClass] > 0 ? passengersByClass[cabinClass] / capacityByClass[cabinClass] : 0,
    ])) as Record<PassengerClass, number>;
    const costBreakdown = { ...(service.baseCostBreakdown ?? zeroCosts()) };
    costBreakdown.fuel += passengers * (service.operatingCostPerPassenger ?? 0);
    const averageDepartures = service.departuresPerWeek / 7;
    const emptyFuelUnits = (service.fuelConsumptionPerDepartureEmpty ?? 0) * averageDepartures;
    const variableFuelUnitsPerPassenger = service.seatsPerDeparture > 0
      ? ((service.fuelConsumptionPerDepartureFull ?? service.fuelConsumptionPerDepartureEmpty ?? 0) -
        (service.fuelConsumptionPerDepartureEmpty ?? 0)) / service.seatsPerDeparture
      : 0;
    const fuelUnitsConsumed = Math.max(0, emptyFuelUnits + passengers * variableFuelUnitsPerPassenger);
    const supplyKey = `${service.companyId}:${service.fromPortId}`;
    const supply = remainingFuelInventory.get(supplyKey);
    const canUseInventory = !!supply &&
      (service.fuelMarketPrice ?? 0) >= supply.useAtOrAbove &&
      supply.availableUnits > 0;
    const inventoryFuelUnitsUsed = canUseInventory
      ? Math.min(fuelUnitsConsumed, supply.availableUnits)
      : 0;
    if (supply) supply.availableUnits -= inventoryFuelUnitsUsed;
    const inventoryFuelValueUsed = inventoryFuelUnitsUsed * (supply?.averageUnitCost ?? 0);
    if (fuelUnitsConsumed > 0 && inventoryFuelUnitsUsed > 0) {
      const spotFuelUnits = fuelUnitsConsumed - inventoryFuelUnitsUsed;
      costBreakdown.fuel = inventoryFuelValueUsed +
        spotFuelUnits * (service.fuelDeliveredUnitCost ?? costBreakdown.fuel / fuelUnitsConsumed);
    }
    costBreakdown.total = costBreakdown.fuel + costBreakdown.staff + costBreakdown.port +
      costBreakdown.flightMaintenance + costBreakdown.fixedMaintenance +
      costBreakdown.ageSurcharge + costBreakdown.depreciation + costBreakdown.delay + costBreakdown.other;
    const ticketRevenue = revenueByService.get(service.id) ?? 0;
    return {
      serviceLegId: service.id,
      capacity: service.dailySeatCapacity,
      passengers,
      loadFactor:
        service.dailySeatCapacity > 0 ? passengers / service.dailySeatCapacity : 0,
      capacityByClass,
      passengersByClass,
      loadFactorByClass,
      revenueByClass,
      passengersByType: passengersByServiceType.get(service.id) ?? zeroPassengerTypes(),
      satisfaction: passengers > 0
        ? (satisfactionByService.get(service.id) ?? 0) / passengers
        : service.satisfactionByClass.economy,
      ticketRevenue,
      fuelUnitsConsumed,
      inventoryFuelUnitsUsed,
      inventoryFuelValueUsed,
      operatingCost: costBreakdown.total,
      costBreakdown,
      netProfit: ticketRevenue - costBreakdown.total,
    };
  });

  const companyIds = [...new Set(input.services.map((service) => service.companyId))];
  const servicesById = new Map(input.services.map((service) => [service.id, service]));
  const companies: CompanySettlement[] = companyIds.map((companyId) => {
    const companyServices = serviceSettlements.filter(
      (settlement) => servicesById.get(settlement.serviceLegId)?.companyId === companyId,
    );
    const ticketRevenue = companyServices.reduce(
      (sum, service) => sum + service.ticketRevenue,
      0,
    );
    const operatingCost = companyServices.reduce(
      (sum, service) => sum + service.operatingCost,
      0,
    );
    return {
      companyId,
      passengers: companyServices.reduce((sum, service) => sum + service.passengers, 0),
      ticketRevenue,
      operatingCost,
      operatingProfit: ticketRevenue - operatingCost,
    };
  });

  return { markets: marketSettlements, services: serviceSettlements, companies };
}
