import { simulateCampaign } from "../campaign.js";
import { explainJourneyChoice } from "../choice.js";
import { buildRouteServices } from "../routes.js";
import { PASSENGER_CLASSES, PASSENGER_TYPES } from "../types.js";
import type { CabinConfiguration, CampaignDay, GeneratedGalaxy, PassengerEvaluation, PassengerType, Route, RouteCostBreakdown, ShipType, SimulationScenario } from "../types.js";
import type { ScheduledFlight } from "../scheduling.js";
import { clamp } from "../utils.js";
import {
  CONDITION_WEAR_PER_FLIGHT_HOUR,
  DAILY_COMPANY_OVERHEAD,
  DEADLINE_DAY,
  CASH_GOAL,
  MAINTENANCE_DAYS,
  PASSENGER_GOAL,
  type FlightFinancialEvent,
  type GameActionResult,
  type GameDayRecord,
  type GameRouteDaySummary,
  type GameState,
  type OwnedShip,
  requirePlaying,
} from "./model.js";
import {
  fleetConfigurationForShip,
  shipMaintenanceCost,
} from "./fleet.js";
import {
  applyAutomaticFuelContract,
  applyPlayerFuelCost,
  fuelPriceRecord,
  forecastWeeklyFuelDemand,
  settleFuelDay,
} from "./fuel.js";
import { applyDueFleetChanges, routeSchedule } from "./player-routes.js";
import { buildGameSchedule } from "./schedule.js";
import { gameScenario } from "./state.js";
import {
  deliverShipPurchaseOrders,
  orderAutomaticReplacements,
  refreshShipyardMarket,
} from "./ships.js";

function routeSummaries(
  state: GameState,
  campaignDay: CampaignDay,
  scenario: SimulationScenario,
): GameRouteDaySummary[] {
  return state.routes.map((route) => {
    const services = campaignDay.settlement.services.filter((service) =>
      service.serviceLegId.startsWith(`${route.id}:`),
    );
    const capacity = services.reduce((sum, service) => sum + service.capacity, 0);
    const passengers = services.reduce((sum, service) => sum + service.passengers, 0);
    const satisfaction = passengers > 0
      ? services.reduce((sum, service) => sum + service.satisfaction * service.passengers, 0) / passengers
      : 0;
    const schedule = routeSchedule(route, scenario);
    const capacityByClass: CabinConfiguration = { economy: 0, business: 0, premium: 0 };
    const passengersByClass: CabinConfiguration = { economy: 0, business: 0, premium: 0 };
    const revenueByClass: CabinConfiguration = { economy: 0, business: 0, premium: 0 };
    const passengersByType: Record<PassengerType, number> = { business: 0, leisure: 0, budget: 0, luxury: 0 };
    const requestedByType: Record<PassengerType, number> = { business: 0, leisure: 0, budget: 0, luxury: 0 };
    const noTravelByType: Record<PassengerType, number> = { business: 0, leisure: 0, budget: 0, luxury: 0 };
    const capacityLostByType: Record<PassengerType, number> = { business: 0, leisure: 0, budget: 0, luxury: 0 };
    const costBreakdown: RouteCostBreakdown = {
      fuel: 0, staff: 0, port: 0, flightMaintenance: 0, fixedMaintenance: 0,
      ageSurcharge: 0, depreciation: 0, delay: 0, other: 0, total: 0,
    };
    const emptyDirection = () => ({
      capacityByClass: { economy: 0, business: 0, premium: 0 } as CabinConfiguration,
      passengersByClass: { economy: 0, business: 0, premium: 0 } as CabinConfiguration,
      loadFactorByClass: { economy: 0, business: 0, premium: 0 } as CabinConfiguration,
    });
    const directions = { outbound: emptyDirection(), return: emptyDirection() };
    const serviceModels = (() => {
      return scenario.routes.filter((candidate) => candidate.id === route.id || candidate.parentRouteId === route.id)
        .flatMap((variant) => {
          const shipType = scenario.shipTypes.find((ship) => ship.id === variant.shipTypeId);
          if (!shipType) return [];
          try {
            return buildRouteServices({ ...variant, active: true }, shipType, scenario.ports, scenario.worldLegs);
          } catch {
            return [];
          }
        });
    })();
    const serviceModelById = new Map(serviceModels.map((service) => [service.id, service]));
    for (const service of services) {
      for (const cabinClass of PASSENGER_CLASSES) {
        capacityByClass[cabinClass] += service.capacityByClass[cabinClass];
        passengersByClass[cabinClass] += service.passengersByClass[cabinClass];
        revenueByClass[cabinClass] += service.revenueByClass[cabinClass];
      }
      for (const passengerType of PASSENGER_TYPES) passengersByType[passengerType] += service.passengersByType[passengerType];
      for (const key of Object.keys(costBreakdown) as (keyof RouteCostBreakdown)[]) {
        if (key !== "total") costBreakdown[key] += service.costBreakdown[key];
      }
      const model = serviceModelById.get(service.serviceLegId);
      const direction = model?.fromPortId === route.stops[0]?.portId ? directions.outbound : directions.return;
      for (const cabinClass of PASSENGER_CLASSES) {
        direction.capacityByClass[cabinClass] += service.capacityByClass[cabinClass];
        direction.passengersByClass[cabinClass] += service.passengersByClass[cabinClass];
      }
    }
    for (const direction of [directions.outbound, directions.return]) {
      for (const cabinClass of PASSENGER_CLASSES) {
        direction.loadFactorByClass[cabinClass] = direction.capacityByClass[cabinClass] > 0
          ? direction.passengersByClass[cabinClass] / direction.capacityByClass[cabinClass]
          : 0;
      }
    }
    costBreakdown.total = costBreakdown.fuel + costBreakdown.staff + costBreakdown.port +
      costBreakdown.flightMaintenance + costBreakdown.fixedMaintenance + costBreakdown.ageSurcharge +
      costBreakdown.depreciation + costBreakdown.delay + costBreakdown.other;
    const revenue = services.reduce((sum, service) => sum + service.ticketRevenue, 0);
    const cost = costBreakdown.total;
    const profit = revenue - cost;
    const routeFlights = state.scheduledFlights.filter((flight) =>
      flight.routeId === route.id && Math.floor(flight.departureMinute / 1_440) === state.day,
    );
    const onTimeFlights = routeFlights.filter((flight) => {
      if (flight.status === "cancelled") return false;
      const plannedMinutes = flight.scheduledArrivalMinute - flight.scheduledDepartureMinute;
      const threshold = Math.min(240, Math.max(60, plannedMinutes * 0.03));
      return flight.delayMinutes <= threshold;
    }).length;
    const onTimeRate = routeFlights.length > 0
      ? onTimeFlights / routeFlights.length
      : serviceModels.length > 0
        ? serviceModels.reduce((sum, service) => sum + service.onTimeRate, 0) / serviceModels.length
        : 0;
    const loadFactorByClass = Object.fromEntries(PASSENGER_CLASSES.map((cabinClass) => [
      cabinClass,
      capacityByClass[cabinClass] > 0 ? passengersByClass[cabinClass] / capacityByClass[cabinClass] : 0,
    ])) as CabinConfiguration;
    const routeMarkets = campaignDay.settlement.markets.filter((market) => market.journeys.some((journey) =>
      journey.option.serviceLegIds.some((id) => id.startsWith(`${route.id}:`)),
    ));
    for (const market of routeMarkets) {
      const passengerType = market.market.passengerType;
      requestedByType[passengerType] += market.journeys
        .filter((journey) => journey.option.serviceLegIds.some((id) => id.startsWith(`${route.id}:`)))
        .reduce((sum, journey) => sum + journey.requestedPassengers, 0);
      noTravelByType[passengerType] += market.initialNoTravelPassengers;
      capacityLostByType[passengerType] += market.capacityLostPassengers;
    }
    const evaluations = PASSENGER_TYPES.map((passengerType) => {
      const entries = routeMarkets.filter((market) => market.market.passengerType === passengerType);
      const routeJourneys = entries.flatMap((market) => market.journeys
        .filter((journey) => journey.actualPassengers > 0 && journey.option.serviceLegIds.some((id) => id.startsWith(`${route.id}:`)))
        .map((journey) => ({ journey, explanation: explainJourneyChoice(market.market, journey.option) })));
      const evaluationPassengers = routeJourneys.reduce((sum, entry) => sum + entry.journey.actualPassengers, 0);
      const reasons = routeJourneys.flatMap((entry) => [...entry.explanation.positive, ...entry.explanation.negative]);
      const uniqueReasons = [...reasons]
        .sort((a, b) => b.impact - a.impact)
        .filter((reason, index, ranked) => ranked.findIndex((candidate) => candidate.code === reason.code) === index);
      return {
        passengerType,
        passengers: evaluationPassengers,
        satisfaction: evaluationPassengers > 0
          ? routeJourneys.reduce((sum, entry) => sum + entry.explanation.satisfaction * entry.journey.actualPassengers, 0) / evaluationPassengers
          : 0,
        positiveReasons: uniqueReasons.filter((reason) => reason.positive).slice(0, 3),
        negativeReasons: uniqueReasons.filter((reason) => !reason.positive).slice(0, 3),
      };
    });
    const warnings: string[] = [];
    if (profit < 0) warnings.push("航线亏损");
    if (PASSENGER_CLASSES.some((cabinClass) => capacityByClass[cabinClass] > 0 && loadFactorByClass[cabinClass] < 0.35)) warnings.push("部分舱位上座率偏低");
    if (onTimeRate < 0.85) warnings.push("准点率预警");
    return {
      routeId: route.id,
      passengers,
      revenue,
      cost,
      loadFactor: capacity > 0 ? passengers / capacity : 0,
      departuresPerWeek: schedule.departuresPerWeek,
      roundTripDays: schedule.roundTripDays,
      satisfaction,
      profit,
      margin: revenue > 0 ? profit / revenue : 0,
      onTimeRate,
      capacityByClass,
      passengersByClass,
      loadFactorByClass,
      revenueByClass,
      passengersByType,
      requestedByType,
      noTravelByType,
      capacityLostByType,
      priceLostPassengers: routeMarkets.reduce((sum, market) => sum + market.priceLostPassengers, 0),
      capacityLostPassengers: routeMarkets.reduce((sum, market) => sum + market.capacityLostPassengers, 0),
      costBreakdown,
      directions,
      evaluations,
      warnings,
      forecastPassengers: passengers,
      forecastProfit: profit,
      forecastPassengerError: 0,
      forecastProfitError: 0,
    };
  });
}

function applyAutomaticMaintenance(
  fleet: readonly OwnedShip[],
  routes: readonly Route[],
  scenario: SimulationScenario,
  day: number,
  cash: number,
  threshold: number,
  shipTypes: readonly ShipType[],
): { fleet: OwnedShip[]; cash: number; maintainedShipNames: string[]; cost: number } {
  let remainingCash = cash;
  let totalCost = 0;
  const maintainedShipNames: string[] = [];
  const nextFleet = fleet.map((ship) => {
    if (ship.maintenanceUntilDay !== null || ship.condition > threshold) return ship;
    const route = routes.find((candidate) => candidate.id === ship.routeId);
    const isAtMainBase = !route || !route.active || (() => {
      const schedule = routeSchedule(route, scenario);
      const cycleHours = schedule.roundTripDays * 24;
      if (cycleHours <= 24) return true;
      const routeShips = fleet.filter((candidate) => candidate.routeId === route.id);
      const shipIndex = Math.max(0, routeShips.findIndex((candidate) => candidate.id === ship.id));
      const phaseOffset = (shipIndex * cycleHours) / Math.max(1, routeShips.length);
      const phase = (((day - 1) * 24 + phaseOffset) % cycleHours + cycleHours) % cycleHours;
      return phase < 0.001 || phase >= cycleHours - 24;
    })();
    if (!isAtMainBase) return ship;
    const shipType = shipTypes.find((candidate) => candidate.id === ship.shipTypeId);
    if (!shipType) return ship;
    const cost = shipMaintenanceCost(shipType);
    if (remainingCash < cost) return ship;
    remainingCash -= cost;
    totalCost += cost;
    maintainedShipNames.push(ship.name);
    return {
      ...ship,
      condition: 100,
      flightHoursSinceMaintenance: 0,
      maintenanceUntilDay: day + MAINTENANCE_DAYS,
    };
  });
  return { fleet: nextFleet, cash: remainingCash, maintainedShipNames, cost: totalCost };
}

function ageFleetAfterDay(
  state: GameState,
  scenario: SimulationScenario,
): OwnedShip[] {
  return state.fleet.map((ship) => {
    if (ship.maintenanceUntilDay !== null) {
      return state.day + 1 >= ship.maintenanceUntilDay
        ? { ...ship, maintenanceUntilDay: null }
        : ship;
    }
    if (!ship.routeId) return ship;
    const route = state.routes.find((candidate) => candidate.id === ship.routeId);
    if (!route) return ship;
    const flights = state.scheduledFlights.filter((flight) => flight.shipId === ship.id && flight.status !== "cancelled" &&
      Math.floor(flight.departureMinute / 1_440) === state.day);
    const flightHours = flights.reduce((sum, flight) => sum + Math.max(0, flight.arrivalMinute - flight.departureMinute) / 60, 0);
    const shipType = scenario.shipTypes.find((candidate) => candidate.id === ship.shipTypeId);
    const cruiseRatio = route.cruiseRatioByShipType?.[ship.shipTypeId] ?? 1;
    const wearMultiplier = 1 + (shipType?.highSpeedMaintenancePenalty ?? 2.4) * Math.max(0, cruiseRatio - .9) ** 2;
    return {
      ...ship,
      condition: Math.max(0, ship.condition - flightHours * CONDITION_WEAR_PER_FLIGHT_HOUR * wearMultiplier),
      flightHoursSinceMaintenance: ship.flightHoursSinceMaintenance + flightHours,
    };
  });
}

export function advanceGameDay(
  state: GameState,
  baseScenario: SimulationScenario,
  galaxy: GeneratedGalaxy,
): GameActionResult {
  requirePlaying(state);
  const dispatchedState = applyDueFleetChanges(state, state.day);
  const currentSchedule = buildGameSchedule(dispatchedState, galaxy, baseScenario.shipTypes, 7, baseScenario.events);
  const scheduledState: GameState = {
    ...dispatchedState,
    scheduledFlights: currentSchedule.flights,
    shipLogs: [...dispatchedState.shipLogs, ...currentSchedule.shipLogs]
      .filter((entry, index, entries) => entries.findIndex((candidate) => candidate.id === entry.id) === index)
      .slice(-1_000),
    starportCapacity: currentSchedule.starportCapacity,
  };
  const scenario = gameScenario(baseScenario, galaxy, scheduledState);
  const rawCampaignDay = simulateCampaign(scenario, {
    startDay: state.day,
    numberOfDays: 1,
  }).days[0]!;
  const playerRouteIds = new Set(scenario.routes
    .filter((route) => route.companyId === "player")
    .map((route) => route.id));
  const todayFlights = currentSchedule.flights.filter((flight) =>
    flight.companyId === "player" && Math.floor(flight.departureMinute / 1_440) === scheduledState.day,
  );
  const operatedFlights = todayFlights.filter((flight) => flight.status !== "cancelled");
  const consumedUnits = operatedFlights.reduce((sum, flight) => sum + flight.fuelUnits, 0);
  const automaticContract = applyAutomaticFuelContract(scheduledState, forecastWeeklyFuelDemand(scheduledState, consumedUnits));
  const fuelSettlement = settleFuelDay(automaticContract.state, consumedUnits);
  const operatingState = fuelSettlement.state;
  const campaignDay = applyPlayerFuelCost(rawCampaignDay, scenario, fuelSettlement.effectiveUnitCost);
  const company = campaignDay.settlement.companies.find(
    (candidate) => candidate.companyId === "player",
  );
  const grossRevenue = company?.ticketRevenue ?? 0;
  const serviceModelById = new Map(scenario.routes.filter((route) => route.companyId === "player").flatMap((route) => {
    const type = scenario.shipTypes.find((candidate) => candidate.id === route.shipTypeId);
    if (!type) return [];
    try { return buildRouteServices(route, type, scenario.ports, scenario.worldLegs).map((service) => [service.id, service] as const); }
    catch { return []; }
  }));
  const routeDirectionRevenue = campaignDay.settlement.services
    .filter((service) => playerRouteIds.has(service.serviceLegId.split(":")[0] ?? ""))
    .reduce((map, service) => {
      const routeId = service.serviceLegId.split(":")[0] ?? "";
      const fromPortId = serviceModelById.get(service.serviceLegId)?.fromPortId ?? "unknown";
      const key = `${routeId}:${fromPortId}`;
      map.set(key, (map.get(key) ?? 0) + service.ticketRevenue);
      return map;
    }, new Map<string, number>());
  const revenueForFlight = (flight: ScheduledFlight) => {
    const actualFlights = operatedFlights.filter((candidate) => candidate.routeId === flight.routeId && candidate.fromPortId === flight.fromPortId).length;
    const actualRevenue = routeDirectionRevenue.get(`${flight.routeId}:${flight.fromPortId}`) ?? 0;
    if (actualFlights > 0) return actualRevenue / actualFlights;
    const route = operatingState.routes.find((candidate) => candidate.id === flight.routeId);
    const direction = route?.stops[0]?.portId === flight.fromPortId ? "outbound" : "return";
    const fares = route?.pricing.directionalFareByClass?.[direction] ?? route?.pricing.fareByClass;
    return fares ? PASSENGER_CLASSES.reduce((sum, cabinClass) => sum + fares[cabinClass] * flight.seatsByClass[cabinClass] * 0.7, 0) : 0;
  };
  const cancelledFlights = todayFlights.filter((flight) => flight.status === "cancelled");
  const cancelledBookedRevenue = cancelledFlights.reduce((sum, flight) => sum + revenueForFlight(flight), 0);
  const compensationPaid = operatedFlights.reduce((sum, flight) => sum + revenueForFlight(flight) * flight.compensationRate, 0) + cancelledBookedRevenue;
  const revenue = grossRevenue + cancelledBookedRevenue - compensationPaid;
  const routeOperatingCost = company?.operatingCost ?? 0;
  const delayExtraCost = operatedFlights.reduce((sum, flight) => sum + flight.extraCrewCost + flight.extraPortCost, 0);
  const operatingCost = routeOperatingCost + delayExtraCost + fuelSettlement.surplusSoldCost + fuelSettlement.warehouseRent;
  const accountingNonCashOrEventMaintenance = campaignDay.settlement.services
    .filter((service) => playerRouteIds.has(service.serviceLegId.split(":")[0] ?? ""))
    .reduce((sum, service) => sum + service.costBreakdown.fixedMaintenance + service.costBreakdown.ageSurcharge +
      service.costBreakdown.flightMaintenance + service.costBreakdown.depreciation, 0);
  const cashRouteOperatingCost = Math.max(0, routeOperatingCost - accountingNonCashOrEventMaintenance);
  const overhead = DAILY_COMPANY_OVERHEAD;
  const profit = revenue + fuelSettlement.surplusSaleRevenue - operatingCost - overhead;
  const cashOperatingProfit = revenue + fuelSettlement.surplusSaleRevenue - cashRouteOperatingCost - delayExtraCost -
    fuelSettlement.surplusSoldCost - fuelSettlement.warehouseRent - overhead;
  const cash = operatingState.cash + cashOperatingProfit + fuelSettlement.warehouseUsedValue +
    fuelSettlement.contractDepositAmortized - fuelSettlement.warehouseStoredValue;
  const passengers = company?.passengers ?? 0;
  const totalPassengers =
    operatingState.history.reduce((sum, record) => sum + record.passengers, 0) + passengers;
  const nextDay = operatingState.day + 1;
  const agedFleet = ageFleetAfterDay(operatingState, scenario);
  const automaticMaintenance = applyAutomaticMaintenance(
    agedFleet,
    operatingState.routes,
    scenario,
    nextDay,
    cash,
    operatingState.autoMaintenanceThreshold,
    baseScenario.shipTypes,
  );
  const delivery = deliverShipPurchaseOrders({
    ...operatingState,
    day: nextDay,
    cash: automaticMaintenance.cash,
    fleet: automaticMaintenance.fleet,
  }, baseScenario.shipTypes, nextDay);
  const deliveredOrders = operatingState.shipPurchaseOrders.filter((order) => order.deliveryDay <= nextDay);
  const deliveredCount = deliveredOrders.reduce((sum, order) => sum + order.quantity, 0);
  const replacedCount = deliveredOrders.reduce(
    (sum, order) => sum + (order.replacementShipIds?.length ?? 0),
    0,
  );
  const automaticReplacement = orderAutomaticReplacements(
    { ...delivery.state, routes: operatingState.routes },
    nextDay,
    baseScenario.shipTypes,
  );
  const finalCash = automaticReplacement.state.cash;
  const justCompletedGoal =
    operatingState.primaryGoalCompletedOnDay === null &&
    (finalCash >= CASH_GOAL || totalPassengers >= PASSENGER_GOAL);
  const primaryGoalCompletedOnDay = justCompletedGoal
    ? operatingState.day
    : operatingState.primaryGoalCompletedOnDay;
  const lost = finalCash < 0 || (primaryGoalCompletedOnDay === null && nextDay >= DEADLINE_DAY);
  const routeSummariesForDay = routeSummaries(operatingState, campaignDay, scenario);
  const financialEvents: FlightFinancialEvent[] = [...operatingState.unsettledFinancialEvents, ...operatedFlights.flatMap((flight) => {
    const shipType = baseScenario.shipTypes.find((type) => type.id === flight.shipTypeId);
    const flightHours = Math.max(0, flight.arrivalMinute - flight.departureMinute) / 60;
    const revenuePerFlight = revenueForFlight(flight);
    const events: FlightFinancialEvent[] = [
      { id: `${flight.id}:revenue`, minute: flight.departureMinute, flightId: flight.id, routeId: flight.routeId, kind: "ticket-revenue", amount: revenuePerFlight },
      { id: `${flight.id}:fuel`, minute: flight.departureMinute - 5, flightId: flight.id, routeId: flight.routeId, kind: "fuel-purchase", amount: -flight.fuelUnits * fuelSettlement.effectiveUnitCost },
    ];
    if (shipType) {
      events.push({ id: `${flight.id}:depreciation`, minute: flight.arrivalMinute, flightId: flight.id, routeId: flight.routeId, kind: "depreciation", amount: -shipType.purchasePrice / (8 * 364 * 24) * flightHours });
    }
    if (flight.compensationRate > 0) events.push({ id: `${flight.id}:compensation`, minute: flight.arrivalMinute, flightId: flight.id, routeId: flight.routeId, kind: "delay-compensation", amount: -revenuePerFlight * flight.compensationRate });
    if (flight.extraCrewCost + flight.extraPortCost > 0) events.push({ id: `${flight.id}:delay-cost`, minute: flight.arrivalMinute, flightId: flight.id, routeId: flight.routeId, kind: "delay-extra-cost", amount: -(flight.extraCrewCost + flight.extraPortCost) });
    return events;
  })];
  for (const flight of cancelledFlights) {
    const booked = revenueForFlight(flight);
    financialEvents.push(
      { id: `${flight.id}:revenue`, minute: flight.scheduledDepartureMinute, flightId: flight.id, routeId: flight.routeId, kind: "ticket-revenue", amount: booked },
      { id: `${flight.id}:compensation`, minute: flight.scheduledDepartureMinute, flightId: flight.id, routeId: flight.routeId, kind: "delay-compensation", amount: -booked },
    );
  }
  if (automaticMaintenance.cost > 0) financialEvents.push({
    id: `automatic-maintenance:${operatingState.day}`,
    minute: operatingState.day * 1_440 + 1_435,
    kind: "flight-maintenance",
    amount: -automaticMaintenance.cost,
  });
  const staffCost = routeSummariesForDay.reduce((sum, route) => sum + route.costBreakdown.staff, 0);
  financialEvents.push({ id: `payroll:${operatingState.day}`, minute: operatingState.day * 1_440 + 1_435, kind: "crew-payroll", amount: -staffCost });
  const record: GameDayRecord = {
    day: operatingState.day,
    cash: finalCash,
    revenue,
    operatingCost,
    overhead,
    profit: profit - automaticMaintenance.cost,
    passengers,
    fuelPurchasedUnits: fuelSettlement.spotPurchasedUnits,
    fuelPurchaseCost: fuelSettlement.spotPurchaseCost,
    fuelInventoryUsedUnits: fuelSettlement.warehouseUsedUnits,
    fuelConsumedUnits: fuelSettlement.consumedUnits,
    fuelContractDeliveredUnits: fuelSettlement.contractDeliveredUnits,
    fuelContractUsedUnits: fuelSettlement.contractUsedUnits,
    fuelContractCost: fuelSettlement.contractCost,
    fuelContractInstallment: fuelSettlement.contractInstallment,
    fuelContractDepositAmortized: fuelSettlement.contractDepositAmortized,
    fuelSpotPurchasedUnits: fuelSettlement.spotPurchasedUnits,
    fuelSpotPurchaseCost: fuelSettlement.spotPurchaseCost,
    fuelWarehouseStoredUnits: fuelSettlement.warehouseStoredUnits,
    fuelWarehouseUsedUnits: fuelSettlement.warehouseUsedUnits,
    fuelWarehouseRent: fuelSettlement.warehouseRent,
    fuelSurplusSoldUnits: fuelSettlement.surplusSoldUnits,
    fuelSurplusSaleRevenue: fuelSettlement.surplusSaleRevenue,
    fuelEffectiveUnitCost: fuelSettlement.effectiveUnitCost,
    activeEventIds: campaignDay.activeEventIds,
    announcedEventIds: campaignDay.announcedEventIds,
    routes: routeSummariesForDay,
    flightsOperated: operatedFlights.length,
    flightsCancelled: todayFlights.length - operatedFlights.length,
    delayedFlights: operatedFlights.filter((flight) => flight.delayMinutes > 0).length,
    compensationPaid,
    financialEvents,
  };
  const positionedFleet = automaticReplacement.state.fleet.map((ship) => {
    const latestArrival = currentSchedule.flights
      .filter((flight) => flight.shipId === ship.id && flight.arrivalMinute < nextDay * 1_440)
      .sort((left, right) => right.arrivalMinute - left.arrivalMinute)[0];
    return latestArrival ? { ...ship, currentPortId: latestArrival.toPortId } : ship;
  });
  const nextOperationalState = applyDueFleetChanges({
    ...automaticReplacement.state,
    day: nextDay,
      routes: automaticReplacement.state.routes.map((route) => todayFlights.some((flight) => flight.routeId === route.id && flight.status !== "cancelled")
        ? { ...route, confirmedLongTermSlots: true }
        : route),
    fleet: positionedFleet,
  }, nextDay);
  const punctuality = todayFlights.length > 0 ? todayFlights.filter((flight) => flight.onTime).length / todayFlights.length : 0.92;
  const cancellationRate = todayFlights.length > 0 ? todayFlights.filter((flight) => flight.status === "cancelled").length / todayFlights.length : 0;
  const reputationDelta = (punctuality - 0.85) * 1.2 - cancellationRate * 4;
  const companyReputation = clamp(automaticReplacement.state.companyReputation + reputationDelta, 0, 100);
  const localReputation = { ...automaticReplacement.state.localReputation };
  for (const port of galaxy.ports) {
    const portFlights = todayFlights.filter((flight) => flight.fromPortId === port.id || flight.toPortId === port.id);
    if (portFlights.length === 0) continue;
    const localOnTime = portFlights.filter((flight) => flight.onTime).length / portFlights.length;
    const localCancelled = portFlights.filter((flight) => flight.status === "cancelled").length / portFlights.length;
    localReputation[port.id] = clamp((localReputation[port.id] ?? companyReputation) + (localOnTime - 0.85) * 1.5 - localCancelled * 5, 0, 100);
  }
  const nextSchedule = buildGameSchedule(nextOperationalState, galaxy, baseScenario.shipTypes, 7, baseScenario.events);
  return {
    state: {
      ...operatingState,
      day: nextDay,
      cash: finalCash,
      fleet: nextOperationalState.fleet,
      routes: nextOperationalState.routes,
      shipPurchaseOrders: automaticReplacement.state.shipPurchaseOrders,
      nextShipNumber: delivery.state.nextShipNumber,
      nextPurchaseAgreementNumber: automaticReplacement.state.nextPurchaseAgreementNumber,
      shipyardMarket: refreshShipyardMarket(automaticReplacement.state, baseScenario.shipTypes, nextDay),
      history: [...operatingState.history, record].slice(-90),
      fuelMarket: [...operatingState.fuelMarket, fuelPriceRecord(galaxy, nextDay)].slice(-360),
      status: lost ? "lost" : "playing",
      primaryGoalCompletedOnDay,
      pendingFleetChanges: nextOperationalState.pendingFleetChanges,
      companyReputation,
      localReputation,
      unsettledFinancialEvents: [],
      scheduledFlights: nextSchedule.flights,
      starportCapacity: nextSchedule.starportCapacity,
      shipLogs: scheduledState.shipLogs,
    },
    message: replacedCount > 0
      ? `船厂今日交付并自动替换 ${replacedCount} 艘到龄舰船；航线与客舱方案已转移到新船。`
      : automaticReplacement.orderedShipNames.length > 0
      ? `已为 ${automaticReplacement.orderedShipNames.length} 艘到龄舰船订购同型号新船；旧船将在交付前继续运营。${automaticReplacement.deferredCount > 0 ? ` 另有 ${automaticReplacement.deferredCount} 艘因资金不足等待采购。` : ""}`
      : automaticReplacement.deferredCount > 0
      ? `${automaticReplacement.deferredCount} 艘舰船已到更新船龄，但资金不足；旧船继续运营并将在后续每日重试采购。`
      : deliveredCount > 0
      ? `船厂今日交付 ${deliveredCount} 艘舰船；请为新船分配统一配置方案。`
      : automaticContract.signedWeeklyUnits > 0
      ? `燃料价格达到自动签约条件，已新增每周 ${automaticContract.signedWeeklyUnits.toFixed(0)} t 的燃料合约并支付定金。`
      : automaticMaintenance.maintainedShipNames.length > 0
      ? `${automaticMaintenance.maintainedShipNames.join("、")} 返抵主基地，维护值已低于 ${state.autoMaintenanceThreshold}% 阈值并自动进场维护。`
      : justCompletedGoal
      ? "初级经营目标达成！公司进入自由经营阶段，游戏将继续进行。"
      : lost
        ? "公司未能维持经营，本局结束。"
        : `第 ${state.day} 日结算完成：${profit >= 0 ? "盈利" : "亏损"} ${Math.abs(profit).toFixed(0)} Cr`,
  };
}
