import { applyEventsToWorldLegs, eventIntensity } from "../events.js";
import { buildRouteServices } from "../routes.js";
import {
  generateFlightSchedule,
  type SchedulingShip,
} from "../scheduling.js";
import type { CabinConfiguration, GeneratedGalaxy, MarketEvent, Route, ShipType, WorldLeg } from "../types.js";
import {
  fleetConfigurationForShip,
  fleetFixedMaintenanceCost,
  shipComfortAtAge,
  shipMaintenanceState,
  shipResaleValue,
} from "./fleet.js";
import { createGeneratedGameEvents } from "./fuel.js";
import { DAYS_PER_SHIP_YEAR, type GameState, type OwnedShip } from "./model.js";

export function gameWorldLegs(galaxy: GeneratedGalaxy): WorldLeg[] {
  const systemsById = new Map(galaxy.systems.map((system) => [system.id, system]));
  const directWarpLegs: WorldLeg[] = [];
  const coordinateScaleSamples = galaxy.systemLanes
    .filter((lane) => lane.mode === "hyperspace")
    .map((lane) => {
      const from = systemsById.get(lane.fromSystemId)!;
      const to = systemsById.get(lane.toSystemId)!;
      const mapDistance = Math.hypot(from.x - to.x, from.y - to.y);
      return mapDistance > 0 ? lane.distance / mapDistance : 0;
    })
    .filter((sample) => sample > 0);
  const coordinateToLightYears = coordinateScaleSamples.reduce((sum, sample) => sum + sample, 0) /
    Math.max(1, coordinateScaleSamples.length);
  for (let leftIndex = 0; leftIndex < galaxy.ports.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < galaxy.ports.length; rightIndex += 1) {
      const left = galaxy.ports[leftIndex]!;
      const right = galaxy.ports[rightIndex]!;
      const leftSystem = systemsById.get(left.systemId)!;
      const rightSystem = systemsById.get(right.systemId)!;
      const coordinateDistance = Math.hypot(leftSystem.x - rightSystem.x, leftSystem.y - rightSystem.y);
      directWarpLegs.push({
        id: `game-warp-${left.id}-${right.id}`,
        fromPortId: left.id,
        toPortId: right.id,
        mode: "warp",
        distance: Number(Math.max(5, Math.min(70, coordinateDistance * coordinateToLightYears)).toFixed(2)),
        hazard: 0.035,
        timeModifier: 1,
        fuelModifier: 1,
        isOpen: true,
      });
    }
  }
  return [...galaxy.worldLegs, ...directWarpLegs];
}

export function shipsForRoute(state: GameState, routeId: string): OwnedShip[] {
  return state.fleet.filter((ship) => ship.routeId === routeId);
}

export function buildGameSchedule(
  state: Pick<GameState, "config" | "day" | "routes" | "fleet" | "fleetConfigurations"> & Partial<Pick<GameState, "basePortId" | "starportCapacityInvestments" | "starportCapacity" | "history" | "scheduledFlights" | "staticAiRoutes">>,
  galaxy: GeneratedGalaxy,
  shipTypes: readonly ShipType[],
  numberOfDays = 7,
  events: readonly MarketEvent[] = createGeneratedGameEvents(galaxy),
) {
  const scheduleStartMinute = state.day * 1_440;
  const committedFlights = (state.scheduledFlights ?? []).filter((flight) => flight.status !== "cancelled" &&
    flight.departureMinute < scheduleStartMinute && flight.arrivalMinute >= scheduleStartMinute);
  const schedulingShips: SchedulingShip[] = state.fleet.flatMap((ship) => {
    const configuration = fleetConfigurationForShip(state, ship);
    if (!configuration) return [];
    const committed = committedFlights.filter((flight) => flight.shipId === ship.id).sort((left, right) => right.arrivalMinute - left.arrivalMinute)[0];
    return [{
      id: ship.id, shipTypeId: ship.shipTypeId, routeId: ship.routeId,
      condition: ship.condition, cabins: configuration.cabins,
      ...(committed ? { currentPortId: committed.toPortId, availableMinute: committed.arrivalMinute } : ship.currentPortId ? { currentPortId: ship.currentPortId } : {}), commissionedDay: ship.commissionedDay,
      flightHoursSinceMaintenance: ship.flightHoursSinceMaintenance,
      maintenanceState: shipMaintenanceState(ship, state.day),
      buildConfiguration: configuration.build,
      ...(ship.reserveForRouteId !== undefined ? { reserveForRouteId: ship.reserveForRouteId } : {}),
    }];
  });
  const dispatchedShips = [...schedulingShips];
  for (const route of state.routes.filter((candidate) => candidate.active)) {
    const risky = dispatchedShips.filter((ship) => ship.routeId === route.id &&
      (ship.maintenanceState === "required" || ship.maintenanceState === "maintenance" || ship.condition < 55));
    const reserves = dispatchedShips.filter((ship) => !ship.routeId && ship.reserveForRouteId === route.id &&
      ship.maintenanceState !== "required" && ship.maintenanceState !== "maintenance");
    for (let index = 0; index < Math.min(risky.length, reserves.length); index += 1) {
      const original = risky[index]!;
      const reserve = reserves[index]!;
      const originalIndex = dispatchedShips.indexOf(original);
      if (originalIndex >= 0) dispatchedShips.splice(originalIndex, 1);
      const reserveIndex = dispatchedShips.indexOf(reserve);
      dispatchedShips[reserveIndex] = { ...reserve, routeId: route.id, substitutesForShipId: original.id };
    }
  }
  const validShips = dispatchedShips.filter((ship) => ship.maintenanceState !== "required" && ship.maintenanceState !== "maintenance");
  const aiRoutes = (state.staticAiRoutes ?? []).map((route) => ({ ...route, confirmedLongTermSlots: true, slotApplicationDay: 0 }));
  const aiShips: SchedulingShip[] = aiRoutes.flatMap((route) => {
    const type = shipTypes.find((candidate) => candidate.id === route.shipTypeId);
    if (!type) return [];
    const cabins = route.cabinCapacityByClass ?? {
      economy: Math.floor(type.seats * .78), business: Math.floor(type.seats * .15),
      premium: type.seats - Math.floor(type.seats * .78) - Math.floor(type.seats * .15),
    };
    return Array.from({ length: Math.max(1, Math.ceil(route.assignedShips)) }, (_, index): SchedulingShip => {
      const id = `ai:${route.id}:${index}`;
      const committed = committedFlights.filter((flight) => flight.shipId === id).sort((left, right) => right.arrivalMinute - left.arrivalMinute)[0];
      const currentPortId = committed?.toPortId ?? route.stops[0]?.portId;
      return {
        id, shipTypeId: type.id, routeId: route.id, condition: 90, cabins,
        ...(currentPortId ? { currentPortId } : {}),
        ...(committed ? { availableMinute: committed.arrivalMinute } : {}),
        commissionedDay: 1, flightHoursSinceMaintenance: 0, maintenanceState: "ready",
      };
    });
  });
  const capacityModifierByPort = Object.fromEntries(galaxy.ports.map((port) => {
    const eventModifier = events.reduce((modifier, event) => {
      if (!event.affectedPortIds.includes(port.id) || event.portCapacityModifier === undefined) return modifier;
      const intensity = eventIntensity(event, state.day);
      return modifier * (1 + (event.portCapacityModifier - 1) * intensity);
    }, 1);
    const investment = state.starportCapacityInvestments?.[port.id]?.level ?? 0;
    const recentUtilization = state.starportCapacity?.filter((entry) => entry.portId === port.id).at(-1)?.utilization ?? 0;
    const congestionModifier = recentUtilization > 0.95 ? 0.92 : recentUtilization > 0.85 ? 0.97 : 1;
    return [port.id, eventModifier * (1 + investment * 0.08) * congestionModifier];
  }));
  const eventRiskByPort = Object.fromEntries(galaxy.ports.map((port) => [port.id,
    events.reduce((risk, event) => event.affectedPortIds.includes(port.id)
      ? Math.max(risk, eventIntensity(event, state.day)) : risk, 0),
  ]));
  const capacityModifierByPortDay: Record<string, number> = {};
  const eventRiskByPortDay: Record<string, number> = {};
  for (let day = state.day; day <= state.day + Math.max(370, numberOfDays); day += 1) {
    for (const port of galaxy.ports) {
      const eventModifier = events.reduce((modifier, event) => {
        if (!event.affectedPortIds.includes(port.id) || event.portCapacityModifier === undefined) return modifier;
        return modifier * (1 + (event.portCapacityModifier - 1) * eventIntensity(event, day));
      }, 1);
      const investment = state.starportCapacityInvestments?.[port.id]?.level ?? 0;
      const recentUtilization = state.starportCapacity?.filter((entry) => entry.portId === port.id).at(-1)?.utilization ?? 0;
      const congestionModifier = recentUtilization > .95 ? .92 : recentUtilization > .85 ? .97 : 1;
      capacityModifierByPortDay[`${port.id}:${day}`] = eventModifier * (1 + investment * .08) * congestionModifier;
      eventRiskByPortDay[`${port.id}:${day}`] = events.reduce((risk, event) => event.affectedPortIds.includes(port.id)
        ? Math.max(risk, eventIntensity(event, day)) : risk, 0);
    }
  }
  const historicalUseByRoute = Object.fromEntries(state.routes.map((route) => [route.id,
    Math.min(1, (state.history ?? []).filter((day) => day.routes.some((summary) => summary.routeId === route.id)).length / 28),
  ]));
  const loadFactorByRoute = Object.fromEntries(state.routes.map((route) => {
    const latest = [...(state.history ?? [])].reverse().flatMap((record) => record.routes).find((summary) => summary.routeId === route.id);
    return [route.id, latest?.loadFactor ?? 0.7];
  }));
  const playerRoutesWithBuild = state.routes.map((route) => {
    const assigned = state.fleet.find((ship) => ship.routeId === route.id && ship.shipTypeId === route.shipTypeId);
    const configuration = assigned ? fleetConfigurationForShip(state, assigned) : undefined;
    return configuration ? { ...route, buildConfiguration: configuration.build } : route;
  });
  const schedule = generateFlightSchedule({
    seed: state.config.seed,
    startDay: state.day,
    numberOfDays,
    routes: [...aiRoutes, ...playerRoutesWithBuild],
    ships: [...aiShips, ...validShips],
    shipTypes,
    ports: galaxy.ports,
    worldLegs: applyEventsToWorldLegs(gameWorldLegs(galaxy), events, state.day),
    ...(state.basePortId ? { basePortId: state.basePortId } : {}),
    capacityModifierByPort,
    eventRiskByPort,
    capacityModifierByPortDay,
    eventRiskByPortDay,
    historicalUseByRoute,
    loadFactorByRoute,
    committedFlights,
  });
  const historyCutoffMinute = Math.max(0, state.day - 7) * 1_440;
  const retainedFlights = (state.scheduledFlights ?? []).filter((flight) =>
    flight.departureMinute >= historyCutoffMinute && flight.departureMinute < scheduleStartMinute,
  );
  const flightById = new Map(retainedFlights.map((flight) => [flight.id, flight]));
  for (const flight of schedule.flights) flightById.set(flight.id, flight);
  const flights = [...flightById.values()].sort((left, right) => left.departureMinute - right.departureMinute);
  return { ...schedule, flights, shipLogs: schedule.shipLogs.filter((entry) => !entry.shipId.startsWith("ai:")) };
}

export function operationalPlayerRoutes(state: GameState, shipTypes: readonly ShipType[]): Route[] {
  return state.routes.flatMap((route) => {
    if (!route.active) return [];
    const availableShips = shipsForRoute(state, route.id).filter((ship) => {
      const maintenance = shipMaintenanceState(ship, state.day);
      return maintenance !== "required" && maintenance !== "maintenance" &&
        !!fleetConfigurationForShip(state, ship);
    });
    if (availableShips.length === 0) return [];
    const typeIds = [...new Set(availableShips.map((ship) => ship.shipTypeId))];
    return typeIds.flatMap((shipTypeId, typeIndex) => {
      const typeShips = availableShips.filter((ship) => ship.shipTypeId === shipTypeId);
      const configurations = typeShips.map((ship) => fleetConfigurationForShip(state, ship)!);
      const shipType = shipTypes.find((candidate) => candidate.id === shipTypeId);
      if (!shipType) return [];
      const cabinCapacityByClass: CabinConfiguration = {
        economy: configurations.reduce((sum, configuration) => sum + configuration.cabins.economy, 0) / typeShips.length,
        business: configurations.reduce((sum, configuration) => sum + configuration.cabins.business, 0) / typeShips.length,
        premium: configurations.reduce((sum, configuration) => sum + configuration.cabins.premium, 0) / typeShips.length,
      };
      const maintenance = fleetFixedMaintenanceCost(typeShips, shipTypes, state.day);
      const expectedHoldingDays = Math.max(360, (state.autoReplacementAgeYears ?? 8) * DAYS_PER_SHIP_YEAR);
      const depreciationPerDay = typeShips.reduce((sum, ship) => {
          const residualDay = ship.commissionedDay + expectedHoldingDays;
          const residual = shipResaleValue(ship, shipType, residualDay);
          return sum + Math.max(0, ship.purchasePricePaid - residual) /
            Math.max(1, residualDay - ship.commissionedDay);
        }, 0);
      return [{
        ...route,
        id: typeIndex === 0 ? route.id : `${route.id}:fleet:${shipTypeId}`,
        parentRouteId: route.id,
        shipTypeId,
        assignedShips: typeShips.length,
        cabinCapacityByClass,
        buildConfiguration: configurations[0]!.build,
        economics: {
          fixedMaintenancePerDay: Math.max(0, maintenance.total - maintenance.ageSurcharge),
          ageSurchargePerDay: maintenance.ageSurcharge,
          depreciationPerDay,
          expectedDelayCostPerDay: (1 - shipType.reliability) * shipType.crewCostPerFlightHour * 8 * typeShips.length,
        },
        effectiveComfort: typeShips.reduce(
          (sum, ship) => sum + shipComfortAtAge(ship, shipType, state.day),
          0,
        ) / typeShips.length,
        operationalDeparturesPerWeek: (() => {
          const horizonStart = state.day * 1_440;
          const horizonEnd = horizonStart + 7 * 1_440;
          const actual = state.scheduledFlights?.filter((flight) => flight.routeId === route.id && flight.shipTypeId === shipTypeId &&
            flight.status !== "cancelled" && flight.departureMinute >= horizonStart && flight.departureMinute < horizonEnd).length;
          const commercialStops = route.stops.filter((stop) => stop.stopType === "commercial").length;
          const servicesPerCycle = route.kind === "return" ? Math.max(1, 2 * (commercialStops - 1)) : Math.max(1, commercialStops);
          return actual / servicesPerCycle;
        })(),
      }];
    });
  });
}
