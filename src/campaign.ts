import { generateMarketDemands } from "./demand.js";
import {
  activeEvents,
  announcedEvents,
  applyEventsToPorts,
  applyEventsToWorldLegs,
  marketEventDemandMultiplier,
} from "./events.js";
import { allReferenceTimes } from "./graph.js";
import { buildRouteServices } from "./routes.js";
import { simulateDay } from "./simulation.js";
import type { FuelInventorySupply } from "./simulation.js";
import type {
  CampaignCompanySummary,
  CampaignResult,
  SimulationScenario,
} from "./types.js";

export interface SimulateCampaignOptions {
  startDay?: number;
  numberOfDays: number;
  fuelInventorySupplies?: readonly FuelInventorySupply[];
}

export function simulateCampaign(
  scenario: SimulationScenario,
  options: SimulateCampaignOptions,
): CampaignResult {
  if (!Number.isInteger(options.numberOfDays) || options.numberOfDays <= 0) {
    throw new Error("numberOfDays must be a positive integer");
  }
  const startDay = options.startDay ?? 1;
  const referenceTimes = allReferenceTimes(scenario.ports, scenario.worldLegs);
  const shipTypesById = new Map(scenario.shipTypes.map((ship) => [ship.id, ship]));
  const days: CampaignResult["days"][number][] = [];
  const fuelInventorySupplies = (options.fuelInventorySupplies ?? []).map((supply) => ({ ...supply }));

  for (let offset = 0; offset < options.numberOfDays; offset += 1) {
    const day = startDay + offset;
    const currentPorts = applyEventsToPorts(scenario.ports, scenario.events, day);
    const currentWorldLegs = applyEventsToWorldLegs(scenario.worldLegs, scenario.events, day);
    const services = scenario.routes.flatMap((route) => {
      const ship = shipTypesById.get(route.shipTypeId);
      if (!ship) throw new Error(`Unknown ship type ${route.shipTypeId} on route ${route.id}`);
      return buildRouteServices(route, ship, currentPorts, currentWorldLegs, {
        companyReputation: scenario.companyReputation[route.companyId] ?? 50,
        shipCondition: scenario.shipConditionByRoute?.[route.id] ?? 100,
        ...(scenario.onTimeRateByRoute?.[route.parentRouteId ?? route.id] !== undefined
          ? { onTimeRate: scenario.onTimeRateByRoute[route.parentRouteId ?? route.id]! }
          : {}),
      });
    });
    const markets = generateMarketDemands(scenario.ports, referenceTimes, {
      day,
      seed: scenario.seed,
      demandMultiplier: (origin, destination, passengerType) =>
        marketEventDemandMultiplier(
          scenario.events,
          day,
          origin.id,
          destination.id,
          passengerType,
        ),
    });
    const settlement = simulateDay({ markets, services, fuelInventorySupplies });
    for (const supply of fuelInventorySupplies) {
      const used = settlement.services
        .filter((service) => {
          const candidate = services.find((item) => item.id === service.serviceLegId);
          return candidate?.companyId === supply.companyId && candidate.fromPortId === supply.portId;
        })
        .reduce((sum, service) => sum + service.inventoryFuelUnitsUsed, 0);
      supply.availableUnits = Math.max(0, supply.availableUnits - used);
    }
    days.push({
      day,
      announcedEventIds: announcedEvents(scenario.events, day).map((event) => event.id),
      activeEventIds: activeEvents(scenario.events, day).map((event) => event.id),
      settlement,
    });
  }

  const companyIds = [
    ...new Set(days.flatMap((day) => day.settlement.companies.map((company) => company.companyId))),
  ];
  const companies: CampaignCompanySummary[] = companyIds.map((companyId) => {
    const dailyResults = days
      .flatMap((day) => day.settlement.companies)
      .filter((company) => company.companyId === companyId);
    const passengers = dailyResults.reduce((sum, company) => sum + company.passengers, 0);
    const ticketRevenue = dailyResults.reduce(
      (sum, company) => sum + company.ticketRevenue,
      0,
    );
    const operatingCost = dailyResults.reduce(
      (sum, company) => sum + company.operatingCost,
      0,
    );
    return {
      companyId,
      passengers,
      averageDailyPassengers: passengers / options.numberOfDays,
      ticketRevenue,
      operatingCost,
      operatingProfit: ticketRevenue - operatingCost,
    };
  });

  return {
    startDay,
    endDay: startDay + options.numberOfDays - 1,
    days,
    companies,
  };
}
