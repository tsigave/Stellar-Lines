import {
  DEFAULT_DEMAND_PARAMETERS,
  FIXED_MAINTENANCE_COST_SCALE,
  FUEL_OPERATING_COST_SCALE,
  PASSENGER_SATISFACTION_WEIGHTS,
  PASSENGER_TYPE_SATISFACTION_WEIGHTS,
} from "./parameters.js";
import {
  deterministicExitDistanceKm,
  estimateSublightTransit,
} from "./fuel.js";
import {
  defaultBuildForShipType,
  hullVariantFromShipType,
  resolveShipMission,
} from "./propulsion.js";
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

function routeCruiseRatio(route: Route, ship: ShipType): number {
  return Math.max(ship.minimumCruiseRatio ?? 0.7, Math.min(
    ship.maximumCruiseRatio ?? 1.1,
    route.cruiseRatioByShipType?.[ship.id] ?? 1,
  ));
}

function sublightTargetSpeed(route: Route, ship: ShipType): number {
  return route.sublightTargetSpeedKmPerSecondByShipType?.[ship.id] ??
    (ship.maximumSublightSpeedKmPerSecond ?? 120) * 0.8;
}

function sublightThrustRatio(route: Route, ship: ShipType): number {
  return Math.max(0.25, Math.min(1, route.sublightThrustRatioByShipType?.[ship.id] ?? 0.85));
}

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
    sublightHours: number;
    departureSublightHours: number;
    interstellarHours: number;
    arrivalSublightHours: number;
    sublightFuelUnits: number;
    interstellarFuelUnits: number;
  }> = [];

  for (let index = 0; index < expandedStops.length - 1; index += 1) {
    const from = expandedStops[index]!;
    const to = expandedStops[index + 1]!;
    const legs = findLegPath(from.portId, to.portId, worldLegs, ship, route.routingMode);
    if (!legs) {
      throw new Error(`${ship.name} cannot find an open path from ${from.portId} to ${to.portId}`);
    }
    const fromPort = portsById.get(from.portId)!;
    const toPort = portsById.get(to.portId)!;
    const interstellarLegs = legs.filter((leg) => leg.mode !== "sublight");
    const primaryMode = interstellarLegs[0]?.mode as "warp" | "hyperspace" | undefined;
    let interstellarHours = 0;
    let interstellarFuelUnits = 0;
    let sublightHours = 0;
    let departureSublightHours = 0;
    let arrivalSublightHours = 0;
    let sublightFuelUnits = 0;
    let fuelConsumptionEmpty = 0;
    let fuelConsumptionFull = 0;
    let fuelLoadEmpty = 0;
    let fuelLoadFull = 0;
    if (primaryMode) {
      const departureDistance = primaryMode === "hyperspace"
        ? fromPort.hyperspaceExitDistanceKm ?? deterministicExitDistanceKm(fromPort.systemId, primaryMode)
        : fromPort.warpExitDistanceKm ?? deterministicExitDistanceKm(fromPort.systemId, primaryMode);
      const arrivalDistance = primaryMode === "hyperspace"
        ? toPort.hyperspaceExitDistanceKm ?? deterministicExitDistanceKm(toPort.systemId, primaryMode)
        : toPort.warpExitDistanceKm ?? deterministicExitDistanceKm(toPort.systemId, primaryMode);
      const distanceLightYears = interstellarLegs.reduce((sum, leg) => sum + leg.distance, 0);
      const distanceFuelModifier = interstellarLegs.reduce((sum, leg) => sum + leg.distance * leg.fuelModifier, 0) / Math.max(1e-9, distanceLightYears);
      const distanceTimeModifier = interstellarLegs.reduce((sum, leg) => sum + leg.distance * leg.timeModifier, 0) / Math.max(1e-9, distanceLightYears);
      const build = route.buildConfiguration
        ? { ...route.buildConfiguration, cabins: installedCabins }
        : defaultBuildForShipType(ship, installedCabins);
      const hull = hullVariantFromShipType(ship);
      const missionInput = {
        build,
        hull,
        distanceLightYears: distanceLightYears * distanceFuelModifier,
        ftlSpeedLyPerDay: modeValue(ship.speedByMode, primaryMode, "Speed") * routeCruiseRatio(route, ship),
        thrustRatio: sublightThrustRatio(route, ship),
        targetSublightSpeedKmPerSecond: sublightTargetSpeed(route, ship),
        sublightDistanceAu: ((departureDistance + arrivalDistance) / 2) / 149_597_870.7,
      };
      const emptyMission = resolveShipMission({ ...missionInput, passengerCount: 0 });
      const fullMission = resolveShipMission({ ...missionInput, passengerCount: seatsPerDeparture });
      if (!fullMission.feasible) throw new Error(`${ship.name} cannot cover ${fromPort.name} to ${toPort.name}: ${fullMission.infeasibleReasons.join("；")}`);
      const departurePhase = emptyMission.phases.find((phase) => phase.kind === "departure")!;
      const arrivalPhase = emptyMission.phases.find((phase) => phase.kind === "arrival")!;
      const ftlPhase = emptyMission.phases.find((phase) => phase.kind === "interstellar")!;
      sublightHours = departurePhase.hours + arrivalPhase.hours;
      departureSublightHours = departurePhase.hours;
      arrivalSublightHours = arrivalPhase.hours;
      sublightFuelUnits = departurePhase.fuelBurnTonnes + arrivalPhase.fuelBurnTonnes;
      interstellarHours = ftlPhase.hours * distanceTimeModifier;
      interstellarFuelUnits = ftlPhase.fuelBurnTonnes;
      fuelConsumptionEmpty = emptyMission.totalFuelBurnTonnes;
      fuelConsumptionFull = fullMission.totalFuelBurnTonnes;
      fuelLoadEmpty = emptyMission.initialFuelTonnes;
      fuelLoadFull = fullMission.initialFuelTonnes;
    } else {
      const localDistanceKm = Math.max(1, legs.reduce((sum, leg) => sum + leg.distance, 0)) * 1_000_000;
      const transit = estimateSublightTransit(ship, localDistanceKm, installedCabins, 0, sublightTargetSpeed(route, ship), sublightThrustRatio(route, ship));
      sublightHours = transit.totalHours;
      departureSublightHours = transit.totalHours;
      sublightFuelUnits = transit.fuelUnits;
      fuelConsumptionEmpty = transit.fuelTonnes;
      fuelConsumptionFull = transit.fuelTonnes + seatsPerDeparture * 0.1 * (transit.fuelTonnes / Math.max(1, transit.grossMassTonnes));
      fuelLoadEmpty = fuelConsumptionEmpty;
      fuelLoadFull = fuelConsumptionFull;
    }
    const travelHours = interstellarHours + sublightHours;
    const stopHours = Math.max(to.minimumStopHours, ship.turnaroundHours);
    if (ship.hullVariantId && fuelLoadFull > ship.fuelCapacityTonnes + 1e-6) {
      throw new Error(`${ship.name} fuel capacity cannot cover ${fromPort.name} to ${toPort.name}`);
    }
    const emptyFuelCost = fuelConsumptionEmpty * fromPort.fuelPrice * FUEL_OPERATING_COST_SCALE;
    const fuelCostPerPassenger = seatsPerDeparture > 0
      ? ((fuelConsumptionFull - fuelConsumptionEmpty) * fromPort.fuelPrice * FUEL_OPERATING_COST_SCALE) / seatsPerDeparture
      : 0;
    const highSpeedWear = 1 + (ship.highSpeedMaintenancePenalty ?? 2.4) * Math.max(0, routeCruiseRatio(route, ship) - .9) ** 2;
    const flightMaintenanceCost = travelHours * ship.maintenancePerFlightHour * highSpeedWear;
    const operatingCost =
      emptyFuelCost +
      flightMaintenanceCost + travelHours * ship.crewCostPerFlightHour +
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
      flightMaintenanceCost,
      portCost: toPort.serviceFee + Math.max(0, route.slotBidPerMovement ?? 0) * 2,
      operatingCost,
      sublightHours,
      departureSublightHours,
      interstellarHours,
      arrivalSublightHours,
      sublightFuelUnits,
      interstellarFuelUnits,
    });
  }

  const cycleHours =
    physicalLegs.reduce((sum, item) => sum + item.travelHours + item.stopHours, 0) +
    route.maintenanceAllowanceHours + (route.scheduleBufferMinutes ?? 0) / 60 * physicalLegs.length;
  const physicalDeparturesPerWeek =
    (route.assignedShips * ship.operationalAvailability * 168) / cycleHours;
  const plannedDeparturesPerWeek = route.weeklyDepartureMinutes && route.weeklyDepartureMinutes.length > 0
    ? Math.min(physicalDeparturesPerWeek, route.weeklyDepartureMinutes.length)
    : physicalDeparturesPerWeek;
  const departuresPerWeek = route.operationalDeparturesPerWeek === undefined
    ? plannedDeparturesPerWeek
    : Math.min(plannedDeparturesPerWeek, Math.max(0, route.operationalDeparturesPerWeek));

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
    const direction = first.from.sourceIndex === 0 ? "outbound" : "return";
    const directionalFares = route.pricing.directionalFareByClass?.[direction];
    const fareByClass = directionalFares ?? route.pricing.fareByClass
      ? { ...(directionalFares ?? route.pricing.fareByClass!) }
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
    const scheduledDepartureMinutes = route.weeklyDepartureMinutes ?? [];
    const scheduleQuality = scheduledDepartureMinutes.length === 0 ? 0.65 : (() => {
      const sorted = [...scheduledDepartureMinutes].sort((left, right) => left - right);
      const intervals = sorted.map((minute, itemIndex) =>
        itemIndex === sorted.length - 1 ? sorted[0]! + 7 * 1_440 - minute : sorted[itemIndex + 1]! - minute,
      );
      const average = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
      const deviation = Math.sqrt(intervals.reduce((sum, value) => sum + (value - average) ** 2, 0) / intervals.length);
      const regularity = Math.max(0, 1 - deviation / Math.max(1, average));
      const businessWindowShare = sorted.filter((minute) => {
        const day = Math.floor(minute / 1_440);
        const hour = minute % 1_440 / 60;
        return day < 5 && ((hour >= 7 && hour <= 10) || (hour >= 16 && hour <= 19));
      }).length / sorted.length;
      return Math.min(1, 0.35 + regularity * 0.4 + businessWindowShare * 0.25);
    })();
    const satisfactionByPassengerType = passengerSatisfactionByType(
      distance,
      inVehicleHours,
      route.effectiveComfort ?? ship.comfort,
      onTimeRate,
      options.shipCondition ?? 100,
    );
    satisfactionByPassengerType.business = Math.max(0, Math.min(100,
      satisfactionByPassengerType.business + (scheduleQuality - 0.65) * 24,
    ));
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
      fuelMarketPrice: portsById.get(first.from.portId)!.fuelPrice,
      fuelDeliveredUnitCost: portsById.get(first.from.portId)!.fuelPrice * FUEL_OPERATING_COST_SCALE,
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
      satisfactionByPassengerType,
      baseCostBreakdown,
      dailyOperatingCost: baseCostBreakdown.total,
      scheduledDepartureMinutes,
      scheduleQuality,
      sublightHours: group.reduce((sum, item) => sum + item.sublightHours, 0),
      departureSublightHours: group.reduce((sum, item) => sum + item.departureSublightHours, 0),
      interstellarHours: group.reduce((sum, item) => sum + item.interstellarHours, 0),
      arrivalSublightHours: group.reduce((sum, item) => sum + item.arrivalSublightHours, 0),
      sublightFuelUnits: group.reduce((sum, item) => sum + item.sublightFuelUnits, 0),
      interstellarFuelUnits: group.reduce((sum, item) => sum + item.interstellarFuelUnits, 0),
    });
    groupStart = index + 1;
  }

  return services;
}
