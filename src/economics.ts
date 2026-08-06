import { PASSENGER_CLASSES } from "./types.js";
import type {
  CabinConfiguration,
  DaySettlement,
  PassengerClass,
  RouteCostBreakdown,
  ServiceLeg,
  ServiceSettlement,
} from "./types.js";

export interface CabinFareRecommendation {
  cabinClass: PassengerClass;
  currentFare: number;
  breakEvenFare: number;
  recommendedFare: number;
  expectedPassengers: number;
  referencePassengers: number;
  allocatedDailyCost: number;
  confidence: "normal" | "low";
}

export interface RouteEconomicsSummary {
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
  costBreakdown: RouteCostBreakdown;
  passengersByClass: CabinConfiguration;
  capacityByClass: CabinConfiguration;
  loadFactorByClass: CabinConfiguration;
}

export interface FareCurvePoint {
  fare: number;
  passengers: number;
  passengerLow: number;
  passengerHigh: number;
  profit: number;
  profitLow: number;
  profitHigh: number;
}

export function buildFareCurveData(
  baseFare: number,
  evaluate: (fare: number) => { passengers: number; profit: number; revenue: number },
  factors: readonly number[] = [0.55, 0.7, 0.85, 1, 1.15, 1.3, 1.5],
  uncertainty = 0.08,
): FareCurvePoint[] {
  return factors.map((factor) => {
    const fare = Math.max(0, Math.round(baseFare * factor / 10) * 10);
    const result = evaluate(fare);
    const profitRange = Math.abs(result.revenue) * uncertainty;
    return {
      fare,
      passengers: result.passengers,
      passengerLow: result.passengers * (1 - uncertainty),
      passengerHigh: result.passengers * (1 + uncertainty),
      profit: result.profit,
      profitLow: result.profit - profitRange,
      profitHigh: result.profit + profitRange,
    };
  });
}

const CABIN_COST_WEIGHT: Record<PassengerClass, number> = {
  economy: 1,
  business: 4.05,
  premium: 10.8,
};

function zeroCabins(): CabinConfiguration {
  return { economy: 0, business: 0, premium: 0 };
}

function zeroCosts(): RouteCostBreakdown {
  return {
    fuel: 0, staff: 0, port: 0, flightMaintenance: 0, fixedMaintenance: 0,
    ageSurcharge: 0, depreciation: 0, delay: 0, other: 0, total: 0,
  };
}

export function summarizeRouteEconomics(
  routeId: string,
  settlement: DaySettlement,
): RouteEconomicsSummary {
  const services = settlement.services.filter((service) => service.serviceLegId.startsWith(`${routeId}:`));
  const passengersByClass = zeroCabins();
  const capacityByClass = zeroCabins();
  const costs = zeroCosts();
  let revenue = 0;
  for (const service of services) {
    revenue += service.ticketRevenue;
    for (const cabinClass of PASSENGER_CLASSES) {
      passengersByClass[cabinClass] += service.passengersByClass[cabinClass];
      capacityByClass[cabinClass] += service.capacityByClass[cabinClass];
    }
    for (const key of Object.keys(costs) as (keyof RouteCostBreakdown)[]) {
      if (key !== "total") costs[key] += service.costBreakdown[key];
    }
  }
  costs.total = costs.fuel + costs.staff + costs.port + costs.flightMaintenance +
    costs.fixedMaintenance + costs.ageSurcharge + costs.depreciation + costs.delay + costs.other;
  const loadFactorByClass = Object.fromEntries(PASSENGER_CLASSES.map((cabinClass) => [
    cabinClass,
    capacityByClass[cabinClass] > 0 ? passengersByClass[cabinClass] / capacityByClass[cabinClass] : 0,
  ])) as CabinConfiguration;
  const profit = revenue - costs.total;
  return {
    revenue,
    cost: costs.total,
    profit,
    margin: revenue > 0 ? profit / revenue : 0,
    costBreakdown: costs,
    passengersByClass,
    capacityByClass,
    loadFactorByClass,
  };
}

export function recommendRouteFares(
  routeId: string,
  services: readonly ServiceLeg[],
  settlements: readonly ServiceSettlement[] = [],
): Record<PassengerClass, CabinFareRecommendation> {
  const routeServices = services.filter((service) => service.routeId === routeId);
  const settlementById = new Map(settlements.map((service) => [service.serviceLegId, service]));
  const weightedCapacity = Object.fromEntries(PASSENGER_CLASSES.map((cabinClass) => [
    cabinClass,
    routeServices.reduce((sum, service) =>
      sum + (service.dailySeatCapacityByClass?.[cabinClass] ?? 0) * CABIN_COST_WEIGHT[cabinClass], 0),
  ])) as CabinConfiguration;
  const totalWeight = PASSENGER_CLASSES.reduce((sum, cabinClass) => sum + weightedCapacity[cabinClass], 0);
  const totalCost = routeServices.reduce((sum, service) => {
    const settlement = settlementById.get(service.id);
    return sum + (settlement?.operatingCost ?? service.dailyOperatingCost);
  }, 0);

  return Object.fromEntries(PASSENGER_CLASSES.map((cabinClass) => {
    const capacity = routeServices.reduce((sum, service) =>
      sum + (service.dailySeatCapacityByClass?.[cabinClass] ?? 0), 0);
    const expectedPassengers = routeServices.reduce((sum, service) =>
      sum + (settlementById.get(service.id)?.passengersByClass[cabinClass] ?? 0), 0);
    const referencePassengers = capacity * 0.55;
    const denominator = Math.max(expectedPassengers, referencePassengers, 1);
    const allocatedDailyCost = totalWeight > 0
      ? totalCost * weightedCapacity[cabinClass] / totalWeight
      : totalCost / PASSENGER_CLASSES.length;
    const breakEvenFare = allocatedDailyCost / denominator;
    const currentFare = routeServices.length > 0
      ? routeServices.reduce((sum, service) => sum + service.fareByClass[cabinClass], 0) / routeServices.length
      : 0;
    return [cabinClass, {
      cabinClass,
      currentFare,
      breakEvenFare,
      recommendedFare: breakEvenFare * 1.2,
      expectedPassengers,
      referencePassengers,
      allocatedDailyCost,
      confidence: expectedPassengers < referencePassengers ? "low" : "normal",
    }];
  })) as Record<PassengerClass, CabinFareRecommendation>;
}

export function mergeServiceCosts(services: readonly ServiceSettlement[]): RouteCostBreakdown {
  const result = zeroCosts();
  for (const service of services) {
    for (const key of Object.keys(result) as (keyof RouteCostBreakdown)[]) {
      if (key !== "total") result[key] += service.costBreakdown[key];
    }
  }
  result.total = result.fuel + result.staff + result.port + result.flightMaintenance +
    result.fixedMaintenance + result.ageSurcharge + result.depreciation + result.delay + result.other;
  return result;
}
