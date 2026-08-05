import { DEFAULT_DEMAND_PARAMETERS } from "./parameters.js";
import {
  PASSENGER_CLASSES,
  type PassengerClass,
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

function findLeg(
  fromPortId: string,
  toPortId: string,
  worldLegs: readonly WorldLeg[],
): WorldLeg | undefined {
  const direct = worldLegs.find(
    (leg) => leg.isOpen && leg.fromPortId === fromPortId && leg.toPortId === toPortId,
  );
  if (direct) return direct;

  const reverse = worldLegs.find(
    (leg) => leg.isOpen && leg.fromPortId === toPortId && leg.toPortId === fromPortId,
  );
  return reverse
    ? { ...reverse, id: `${reverse.id}:reverse`, fromPortId, toPortId }
    : undefined;
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

  const physicalLegs: Array<{
    from: ExpandedStop;
    to: ExpandedStop;
    leg: WorldLeg;
    travelHours: number;
    stopHours: number;
    fuelCost: number;
    operatingCost: number;
  }> = [];

  for (let index = 0; index < expandedStops.length - 1; index += 1) {
    const from = expandedStops[index]!;
    const to = expandedStops[index + 1]!;
    const leg = findLeg(from.portId, to.portId, worldLegs);
    if (!leg) throw new Error(`No open world leg from ${from.portId} to ${to.portId}`);
    if (!ship.supportedModes.includes(leg.mode)) {
      throw new Error(`${ship.name} does not support ${leg.mode}`);
    }
    const maximumRange = modeValue(ship.maxRangeByMode, leg.mode, "Maximum range");
    if (leg.distance > maximumRange) {
      throw new Error(`${ship.name} cannot fly ${leg.id}: range exceeded`);
    }

    const speed = modeValue(ship.speedByMode, leg.mode, "Speed");
    const fuelPerDistance = modeValue(ship.fuelPerDistanceByMode, leg.mode, "Fuel rate");
    const travelHours = (leg.distance / speed) * leg.timeModifier;
    const stopHours = Math.max(to.minimumStopHours, ship.turnaroundHours);
    const fromPort = portsById.get(from.portId)!;
    const toPort = portsById.get(to.portId)!;
    const fuelCost =
      leg.distance * fuelPerDistance * leg.fuelModifier * fromPort.fuelPrice;
    const operatingCost =
      fuelCost +
      travelHours * (ship.maintenancePerFlightHour + ship.crewCostPerFlightHour) +
      toPort.serviceFee;

    physicalLegs.push({ from, to, leg, travelHours, stopHours, fuelCost, operatingCost });
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
    const distance = group.reduce((sum, item) => sum + item.leg.distance, 0);
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
    const fareByClass = Object.fromEntries(
      PASSENGER_CLASSES.map((passengerClass) => [
        passengerClass,
        baseFare *
          route.pricing.multiplier *
          route.pricing.passengerClassMultiplier[passengerClass],
      ]),
    ) as Record<PassengerClass, number>;

    services.push({
      id: `${route.id}:${groupStart}-${index}`,
      routeId: route.id,
      companyId: route.companyId,
      fromPortId: first.from.portId,
      toPortId: last.to.portId,
      modePath: group.map((item) => item.leg.mode),
      distance,
      inVehicleHours,
      destinationDwellHours: last.stopHours,
      departuresPerWeek,
      seatsPerDeparture: ship.seats,
      dailySeatCapacity: (departuresPerWeek * ship.seats) / 7,
      fareByClass,
      comfort: ship.comfort,
      reputation: options.companyReputation ?? 60,
      onTimeRate: Math.min(0.999, options.onTimeRate ?? ship.reliability),
      dailyOperatingCost: (departuresPerWeek * operatingCostPerDeparture) / 7,
    });
    groupStart = index + 1;
  }

  return services;
}
