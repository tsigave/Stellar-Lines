import { allocateCapacity, capacityMarketKey } from "./capacity.js";
import { buildJourneyOptionsForMarkets, type JourneySearchOptions } from "./journeys.js";
import { DEFAULT_CHOICE_PARAMETERS } from "./parameters.js";
import type {
  ChoiceParameters,
  CompanySettlement,
  DaySettlement,
  MarketDemand,
  MarketSettlement,
  ServiceLeg,
  ServiceSettlement,
} from "./types.js";

export interface SimulateDayInput {
  markets: readonly MarketDemand[];
  services: readonly ServiceLeg[];
  choiceParameters?: ChoiceParameters;
  journeySearch?: JourneySearchOptions;
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
    return {
      market,
      actualPassengers: journeys.reduce(
        (sum, journey) => sum + journey.actualPassengers,
        0,
      ),
      initialNoTravelPassengers: capacityAllocation.initialNoTravelByMarket.get(key) ?? 0,
      capacityLostPassengers: capacityAllocation.capacityLostByMarket.get(key) ?? 0,
      journeys,
    };
  });

  const passengerByService = new Map<string, number>();
  const revenueByService = new Map<string, number>();
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
    });
  }

  const serviceSettlements: ServiceSettlement[] = input.services.map((service) => {
    const passengers = passengerByService.get(service.id) ?? 0;
    return {
      serviceLegId: service.id,
      capacity: service.dailySeatCapacity,
      passengers,
      loadFactor:
        service.dailySeatCapacity > 0 ? passengers / service.dailySeatCapacity : 0,
      ticketRevenue: revenueByService.get(service.id) ?? 0,
      operatingCost: service.dailyOperatingCost,
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
