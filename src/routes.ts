import {
  DEFAULT_DEMAND_PARAMETERS,
  FIXED_MAINTENANCE_COST_SCALE,
  FUEL_OPERATING_COST_SCALE,
  PASSENGER_SATISFACTION_WEIGHTS,
  PASSENGER_TYPE_SATISFACTION_WEIGHTS,
} from "./parameters.js";
import { estimateFuelConsumption } from "./fuel.js";
import {
  PASSENGER_CLASSES,
  PASSENGER_TYPES,
  type PassengerClass,
  type PassengerType,
  type RouteCostBreakdown,
  type Route,
  type RouteStop,
  type ServiceLeg,
  type ShipType,
  type Starport,
  type TravelMode,
  type WorldLeg,
} from "./types.js";

export interface BuildRouteServicesOptions {
  companyReputation?: number;
  onTimeRate?: number;
  shipCondition?: number;
}

export const MAX_INTERSTELLAR_SPEED_LY_PER_DAY = 10;
/** 每次商业停靠的标准星系内接驳量；接驳小时数 = 12 / 亚光速指数。 */
export const LOCAL_SUBLIGHT_TRANSFER_UNITS = 12;

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function passengerSatisfactionByClass(
  distance: number,
  inVehicleHours: number,
  comfort: number,
  onTimeRate: number,
  condition: number,
): Record<PassengerClass, number> {
  const speedLyPerDay = distance / Math.max(1 / 24, inVehicleHours / 24);
  const factors = {
    speed: clampScore((speedLyPerDay / MAX_INTERSTELLAR_SPEED_LY_PER_DAY) * 100),
    comfort: clampScore(comfort),
    reliability: clampScore(onTimeRate * 100),
    condition: clampScore(condition),
  };
  return Object.fromEntries(PASSENGER_CLASSES.map((passengerClass) => {
    const weights = PASSENGER_SATISFACTION_WEIGHTS[passengerClass];
    const score =
      factors.speed * weights.speed +
      factors.comfort * weights.comfort +
      factors.reliability * weights.reliability +
      factors.condition * weights.condition;
    return [passengerClass, Number(score.toFixed(1))];
  })) as Record<PassengerClass, number>;
}

export function passengerSatisfactionByType(
  distance: number,
  inVehicleHours: number,
  comfort: number,
  onTimeRate: number,
  condition: number,
): Record<PassengerType, number> {
  const speedLyPerDay = distance / Math.max(1 / 24, inVehicleHours / 24);
  const factors = {
    speed: clampScore((speedLyPerDay / MAX_INTERSTELLAR_SPEED_LY_PER_DAY) * 100),
    comfort: clampScore(comfort),
    reliability: clampScore(onTimeRate * 100),
    condition: clampScore(condition),
  };
  return Object.fromEntries(PASSENGER_TYPES.map((passengerType) => {
    const weights = PASSENGER_TYPE_SATISFACTION_WEIGHTS[passengerType];
    const score = factors.speed * weights.speed + factors.comfort * weights.comfort +
      factors.reliability * weights.reliability + factors.condition * weights.condition;
    return [passengerType, Number(score.toFixed(1))];
  })) as Record<PassengerType, number>;
}

interface ExpandedStop extends RouteStop {
  sourceIndex: number;
}

function expandRouteStops(route: Route): ExpandedStop[] {
  const stops = route.stops.map((stop, sourceIndex) => ({ ...stop, sourceIndex }));
  if (route.kind === "loop") return [...stops, { ...stops[0]!, sourceIndex: 0 }];

  const returning = stops
    .slice(1, -1)
    .reverse()
    .map((stop) => ({ ...stop }));
  return [...stops, ...returning, { ...stops[0]!, sourceIndex: 0 }];
}

function orientLeg(
  leg: WorldLeg,
  fromPortId: string,
): WorldLeg {
  return leg.fromPortId === fromPortId
    ? leg
    : {
        ...leg,
        id: `${leg.id}:reverse`,
        fromPortId: leg.toPortId,
        toPortId: leg.fromPortId,
      };
}

function findLegPath(
  fromPortId: string,
  toPortId: string,
  worldLegs: readonly WorldLeg[],
  ship: ShipType,
  routingMode?: Extract<TravelMode, "warp" | "hyperspace">,
): WorldLeg[] | undefined {
  const usableLegs = worldLegs.filter((leg) => {
    const maximumRange = ship.maxRangeByMode[leg.mode];
    return (
      leg.isOpen &&
      (routingMode === undefined || leg.mode === routingMode) &&
      ship.supportedModes.includes(leg.mode) &&
      maximumRange !== undefined &&
      leg.distance <= maximumRange
    );
  });
  const nodeIds = new Set(usableLegs.flatMap((leg) => [leg.fromPortId, leg.toPortId]));
  if (!nodeIds.has(fromPortId) || !nodeIds.has(toPortId)) return undefined;

  const distances = new Map<string, number>([[fromPortId, 0]]);
  const previous = new Map<string, { nodeId: string; leg: WorldLeg }>();
  const unvisited = new Set(nodeIds);
  while (unvisited.size > 0) {
    let current: string | undefined;
    let currentDistance = Number.POSITIVE_INFINITY;
    for (const nodeId of unvisited) {
      const distance = distances.get(nodeId) ?? Number.POSITIVE_INFINITY;
      if (distance < currentDistance) {
        current = nodeId;
        currentDistance = distance;
      }
    }
    if (!current || !Number.isFinite(currentDistance)) break;
    if (current === toPortId) break;
    unvisited.delete(current);

    for (const leg of usableLegs) {
      const neighbor =
        leg.fromPortId === current
          ? leg.toPortId
          : leg.toPortId === current
            ? leg.fromPortId
            : undefined;
      if (!neighbor || !unvisited.has(neighbor)) continue;
      const speed = modeValue(ship.speedByMode, leg.mode, "Speed");
      const candidate = currentDistance + Math.max(
        1,
        leg.distance / Math.min(speed, MAX_INTERSTELLAR_SPEED_LY_PER_DAY),
      ) * leg.timeModifier;
      if (candidate < (distances.get(neighbor) ?? Number.POSITIVE_INFINITY)) {
        distances.set(neighbor, candidate);
        previous.set(neighbor, { nodeId: current, leg: orientLeg(leg, current) });
      }
    }
  }

  if (!previous.has(toPortId)) return undefined;
  const path: WorldLeg[] = [];
  let current = toPortId;
  while (current !== fromPortId) {
    const step = previous.get(current);
    if (!step) return undefined;
    path.unshift(step.leg);
    current = step.nodeId;
  }
  return path;
}

function modeValue(
  values: Partial<Record<TravelMode, number>>,
  mode: TravelMode,
  label: string,
): number {
  const value = values[mode];
  if (value === undefined) throw new Error(`${label} is missing for ${mode}`);
  return value;
}

function validateRoute(route: Route, ship: ShipType, portsById: ReadonlyMap<string, Starport>): void {
  if (route.stops.length < 2) throw new Error(`Route ${route.id} needs at least two stops`);
  if (route.stops[0]?.stopType !== "commercial") {
    throw new Error(`Route ${route.id} must start at a commercial stop`);
  }
  if (route.assignedShips <= 0) throw new Error(`Route ${route.id} has no assigned ships`);

  for (const stop of route.stops) {
    const port = portsById.get(stop.portId);
    if (!port) throw new Error(`Unknown port ${stop.portId} on route ${route.id}`);
    if (port.portLevel < ship.minimumPortLevel) {
      throw new Error(`${ship.name} cannot use port ${port.name}`);
    }
  }
}

export function buildRouteServices(
  route: Route,
  ship: ShipType,
  ports: readonly Starport[],
  worldLegs: readonly WorldLeg[],
  options: BuildRouteServicesOptions = {},
): ServiceLeg[] {
  if (!route.active) return [];
  if (route.shipTypeId !== ship.id) throw new Error(`Ship type mismatch on route ${route.id}`);

  const portsById = new Map(ports.map((port) => [port.id, port]));
  validateRoute(route, ship, portsById);
  const expandedStops = expandRouteStops(route);
  const installedCabins = route.cabinCapacityByClass ?? {
    economy: Math.floor(ship.seats * 0.78),
    business: Math.floor(ship.seats * 0.15),
    premium: ship.seats - Math.floor(ship.seats * 0.78) - Math.floor(ship.seats * 0.15),
  };
  const seatsPerDepartureByClass = installedCabins;
  const seatsPerDeparture = PASSENGER_CLASSES.reduce(
    (sum, passengerClass) => sum + installedCabins[passengerClass],
    0,
  );

  const physicalLegs: Array<{
    from: ExpandedStop;
    to: ExpandedStop;
    legs: readonly WorldLeg[];
    travelHours: number;
    stopHours: number;
    fuelConsumptionEmpty: number;
    fuelConsumptionFull: number;
    fuelLoadEmpty: number;
    fuelLoadFull: number;
    fuelCostPerPassenger: number;
    emptyFuelCost: number;
    staffCost: number;
    flightMaintenanceCost: number;
    portCost: number;
    operatingCost: number;
  }> = [];

  for (let index = 0; index < expandedStops.length - 1; index += 1) {
    const from = expandedStops[index]!;
    const to = expandedStops[index + 1]!;
    const legs = findLegPath(from.portId, to.portId, worldLegs, ship, route.routingMode);
    if (!legs) {
      throw new Error(`${ship.name} cannot find an open path from ${from.portId} to ${to.portId}`);
    }
    const travelHours = legs.reduce((sum, leg) => {
      const speed = modeValue(ship.speedByMode, leg.mode, "Speed");
      return sum + Math.max(
        1,
        leg.distance / Math.min(speed, MAX_INTERSTELLAR_SPEED_LY_PER_DAY),
      ) * 24 * leg.timeModifier;
    }, 0);
    // A commercial call includes local sublight approach/departure plus ground handling.
    // Faster sublight drives therefore shorten every stop and increase weekly frequency.
    const sublightSpeed = ship.speedByMode.sublight ?? 1;
    const localTransferHours = LOCAL_SUBLIGHT_TRANSFER_UNITS / sublightSpeed;
    const stopHours = Math.max(to.minimumStopHours, ship.turnaroundHours) + localTransferHours;
    const fromPort = portsById.get(from.portId)!;
    const toPort = portsById.get(to.portId)!;
    const fuelConsumptionEmpty = legs.reduce((sum, leg) =>
      sum + estimateFuelConsumption(
        ship,
        leg.mode,
        leg.distance,
        installedCabins,
        0,
      ).fuelUnits * leg.fuelModifier,
    0);
    const fuelConsumptionFull = legs.reduce((sum, leg) =>
      sum + estimateFuelConsumption(
        ship,
        leg.mode,
        leg.distance,
        installedCabins,
        seatsPerDeparture,
      ).fuelUnits * leg.fuelModifier,
    0);
    const fuelLoadEmpty = legs.reduce((sum, leg) =>
      sum + estimateFuelConsumption(
        ship,
        leg.mode,
        leg.distance,
        installedCabins,
        0,
      ).requiredFuelLoadUnits * leg.fuelModifier,
    0);
    const fuelLoadFull = legs.reduce((sum, leg) =>
      sum + estimateFuelConsumption(
        ship,
        leg.mode,
        leg.distance,
        installedCabins,
        seatsPerDeparture,
      ).requiredFuelLoadUnits * leg.fuelModifier,
    0);
    const emptyFuelCost = fuelConsumptionEmpty * fromPort.fuelPrice * FUEL_OPERATING_COST_SCALE;
    const fuelCostPerPassenger = seatsPerDeparture > 0
      ? ((fuelConsumptionFull - fuelConsumptionEmpty) * fromPort.fuelPrice * FUEL_OPERATING_COST_SCALE) / seatsPerDeparture
      : 0;
    const operatingCost =
      emptyFuelCost +
      travelHours * (ship.maintenancePerFlightHour + ship.crewCostPerFlightHour) +
      toPort.serviceFee;

    physicalLegs.push({
      from,
      to,
      legs,
      travelHours,
      stopHours,
      fuelConsumptionEmpty,
      fuelConsumptionFull,
      fuelLoadEmpty,
      fuelLoadFull,
      fuelCostPerPassenger,
      emptyFuelCost,
      staffCost: travelHours * ship.crewCostPerFlightHour,
      flightMaintenanceCost: travelHours * ship.maintenancePerFlightHour,
      portCost: toPort.serviceFee,
      operatingCost,
    });
  }

  const cycleHours =
    physicalLegs.reduce((sum, item) => sum + item.travelHours + item.stopHours, 0) +
    route.maintenanceAllowanceHours;
  const departuresPerWeek =
    (route.assignedShips * ship.operationalAvailability * 168) / cycleHours;

  const services: ServiceLeg[] = [];
  let groupStart = 0;
  for (let index = 0; index < physicalLegs.length; index += 1) {
    const physical = physicalLegs[index]!;
    if (physical.to.stopType !== "commercial") continue;
    const group = physicalLegs.slice(groupStart, index + 1);
    const first = group[0]!;
    const last = group[group.length - 1]!;
    const distance = group.reduce(
      (sum, item) => sum + item.legs.reduce((legSum, leg) => legSum + leg.distance, 0),
      0,
    );
    const inVehicleHours = group.reduce(
      (sum, item, groupIndex) =>
        sum + item.travelHours + (groupIndex < group.length - 1 ? item.stopHours : 0),
      0,
    );
    const operatingCostPerDeparture = group.reduce(
      (sum, item) => sum + item.operatingCost,
      0,
    );
    const baseFare =
      DEFAULT_DEMAND_PARAMETERS.baseBoardingFare +
      distance * DEFAULT_DEMAND_PARAMETERS.farePerDistance +
      inVehicleHours * DEFAULT_DEMAND_PARAMETERS.farePerReferenceHour;
    const fareByClass = route.pricing.fareByClass
      ? { ...route.pricing.fareByClass }
      : Object.fromEntries(PASSENGER_CLASSES.map((passengerClass) => [
          passengerClass,
          baseFare * route.pricing.multiplier * route.pricing.passengerClassMultiplier[passengerClass],
        ])) as Record<PassengerClass, number>;

    const onTimeRate = Math.min(0.999, options.onTimeRate ?? ship.reliability);
    const dailySeatCapacityByClass = seatsPerDepartureByClass
      ? Object.fromEntries(PASSENGER_CLASSES.map((passengerClass) => [
          passengerClass,
          (departuresPerWeek * seatsPerDepartureByClass[passengerClass]) / 7,
        ])) as Record<PassengerClass, number>
      : undefined;
    const departuresPerDay = departuresPerWeek / 7;
    const cycleOperatingCost = physicalLegs.reduce((sum, item) => sum + item.operatingCost, 0);
    const allocationWeight = cycleOperatingCost > 0
      ? operatingCostPerDeparture / cycleOperatingCost
      : 1 / Math.max(1, physicalLegs.length);
    const fixedMaintenance = route.economics?.fixedMaintenancePerDay
      ?? ship.fixedMaintenanceCostPerDay * route.assignedShips * FIXED_MAINTENANCE_COST_SCALE;
    const ageSurcharge = route.economics?.ageSurchargePerDay ?? 0;
    const depreciation = route.economics?.depreciationPerDay
      ?? ship.purchasePrice * route.assignedShips / (8 * 364);
    const delay = route.economics?.expectedDelayCostPerDay
      ?? (1 - onTimeRate) * operatingCostPerDeparture * departuresPerDay * 0.2;
    const baseCostBreakdown: RouteCostBreakdown = {
      fuel: group.reduce((sum, item) => sum + item.emptyFuelCost, 0) * departuresPerDay,
      staff: group.reduce((sum, item) => sum + item.staffCost, 0) * departuresPerDay,
      port: group.reduce((sum, item) => sum + item.portCost, 0) * departuresPerDay,
      flightMaintenance: group.reduce((sum, item) => sum + item.flightMaintenanceCost, 0) * departuresPerDay,
      fixedMaintenance: fixedMaintenance * allocationWeight,
      ageSurcharge: ageSurcharge * allocationWeight,
      depreciation: depreciation * allocationWeight,
      delay: delay * allocationWeight,
      other: 0,
      total: 0,
    };
    baseCostBreakdown.total = Object.entries(baseCostBreakdown)
      .filter(([key]) => key !== "total")
      .reduce((sum, [, value]) => sum + value, 0);
    services.push({
      id: `${route.id}:${groupStart}-${index}`,
      routeId: route.id,
      companyId: route.companyId,
      fromPortId: first.from.portId,
      toPortId: last.to.portId,
      modePath: group.flatMap((item) => item.legs.map((leg) => leg.mode)),
      distance,
      inVehicleHours,
      destinationDwellHours: last.stopHours,
      departuresPerWeek,
      seatsPerDeparture,
      dailySeatCapacity: (departuresPerWeek * seatsPerDeparture) / 7,
      ...(seatsPerDepartureByClass && dailySeatCapacityByClass
        ? { seatsPerDepartureByClass, dailySeatCapacityByClass }
        : {}),
      fuelConsumptionPerDepartureEmpty: group.reduce(
        (sum, item) => sum + item.fuelConsumptionEmpty,
        0,
      ),
      fuelConsumptionPerDepartureFull: group.reduce(
        (sum, item) => sum + item.fuelConsumptionFull,
        0,
      ),
      fuelLoadPerDepartureEmpty: group.reduce(
        (sum, item) => sum + item.fuelLoadEmpty,
        0,
      ),
      fuelLoadPerDepartureFull: group.reduce(
        (sum, item) => sum + item.fuelLoadFull,
        0,
      ),
      operatingCostPerPassenger: group.reduce(
        (sum, item) => sum + item.fuelCostPerPassenger,
        0,
      ),
      fareByClass,
      comfort: route.effectiveComfort ?? ship.comfort,
      reputation: options.companyReputation ?? 60,
      onTimeRate,
      satisfactionByClass: passengerSatisfactionByClass(
        distance,
        inVehicleHours,
        route.effectiveComfort ?? ship.comfort,
        onTimeRate,
        options.shipCondition ?? 100,
      ),
      satisfactionByPassengerType: passengerSatisfactionByType(
        distance,
        inVehicleHours,
        route.effectiveComfort ?? ship.comfort,
        onTimeRate,
        options.shipCondition ?? 100,
      ),
      baseCostBreakdown,
      dailyOperatingCost: baseCostBreakdown.total,
    });
    groupStart = index + 1;
  }

  return services;
}
