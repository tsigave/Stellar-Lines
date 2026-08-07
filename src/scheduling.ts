import { hashString } from "./utils.js";

import { driveEfficiencyMultiplier, estimateInterstellarFuel } from "./fuel.js";
import { buildRouteServices } from "./routes.js";
import type {
  CabinConfiguration,
  PassengerClass,
  Route,
  ShipBuildConfiguration,
  ShipType,
  Starport,
  TravelMode,
  WorldLeg,
} from "./types.js";

export const MINUTES_PER_DAY = 1_440;
export const SCHEDULE_GRANULARITY_MINUTES = 5;
export const STARPORT_SLOT_MINUTES = 60;
export const STARPORT_DAILY_MOVEMENTS: Readonly<Record<Starport["portLevel"], number>> = {
  1: 12, 2: 28, 3: 60, 4: 120, 5: 240,
};

export type DelayReason = "starport-control" | "ground-turnaround" | "technical" | "route-environment" | "knock-on";
export type FlightStatus = "scheduled" | "boarding" | "departed" | "arrived" | "cancelled";

export interface ScheduledFlight {
  id: string;
  routeId: string;
  companyId: string;
  shipId: string;
  shipTypeId: string;
  fromPortId: string;
  toPortId: string;
  departureMinute: number;
  arrivalMinute: number;
  scheduledDepartureMinute: number;
  scheduledArrivalMinute: number;
  cruiseRatio: number;
  seatsByClass: CabinConfiguration;
  fuelUnits: number;
  delayMinutes: number;
  delayReasons: readonly DelayReason[];
  status: FlightStatus;
  compensationRate: number;
  onTimeThresholdMinutes: number;
  onTime: boolean;
  departureSlotStatus: "confirmed" | "shifted" | "queued" | "cancelled";
  arrivalSlotStatus: "confirmed" | "shifted" | "queued" | "cancelled";
  originalShipId?: string;
  replacementShipId?: string;
  sublightHours: number;
  departureSublightHours: number;
  interstellarHours: number;
  arrivalSublightHours: number;
  sublightFuelUnits: number;
  interstellarFuelUnits: number;
  extraCrewCost: number;
  extraPortCost: number;
}

export interface ShipLogEntry {
  id: string;
  shipId: string;
  minute: number;
  kind: "departed-starport" | "entered-hyperspace" | "hyperspace-cruise" | "arrived-system" | "sublight-approach" | "arrived-starport" | "delay" | "cancelled";
  portId?: string;
  flightId: string;
  detail: string;
}

export interface StarportCapacityDay {
  portId: string;
  day: number;
  capacity: number;
  used: number;
  utilization: number;
  departureFlightIds: readonly string[];
  arrivalFlightIds: readonly string[];
  slots: readonly StarportCapacitySlot[];
  modifier: number;
  congestionRisk: number;
}

export interface StarportCapacitySlot {
  startMinute: number;
  capacity: number;
  used: number;
  utilization: number;
  flightIds: readonly string[];
}

export interface SchedulingShip {
  id: string;
  shipTypeId: string;
  routeId: string | null;
  condition: number;
  cabins: CabinConfiguration;
  currentPortId?: string;
  commissionedDay?: number;
  flightHoursSinceMaintenance?: number;
  maintenanceState?: "ready" | "due" | "required" | "maintenance";
  reserveForRouteId?: string | null;
  substitutesForShipId?: string;
  availableMinute?: number;
  buildConfiguration?: ShipBuildConfiguration;
}

export interface ScheduleResult {
  flights: readonly ScheduledFlight[];
  shipLogs: readonly ShipLogEntry[];
  starportCapacity: readonly StarportCapacityDay[];
}

export interface SpeedEconomicsPoint {
  cruiseRatio: number;
  travelHours: number;
  fuelMultiplier: number;
  fuelUnits: number;
  maintenanceCost: number;
  crewCost: number;
  technicalDelayProbability: number;
  departuresPerWeek: number;
  projectedProfit: number;
  sublightHours: number;
  sublightFuelUnits: number;
}

export interface SpeedEconomicsCurve {
  points: readonly SpeedEconomicsPoint[];
  fuelOptimalRatio: number;
  costOptimalRatio: number;
  profitOptimalRatio: number;
}

function random01(key: string): number {
  let state = hashString(key) || 1;
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return (state >>> 0) / 4_294_967_296;
}

export function roundToFiveMinutes(minutes: number): number {
  return Math.round(minutes / SCHEDULE_GRANULARITY_MINUTES) * SCHEDULE_GRANULARITY_MINUTES;
}

export function starportMovementCapacity(port: Starport, modifier = 1): number {
  return Math.max(1, Math.floor(STARPORT_DAILY_MOVEMENTS[port.portLevel] * modifier));
}

export function starportControlDelayProbability(utilization: number): number {
  return 0.02 + 0.18 * Math.max(0, utilization) ** 3;
}

export function fuelMultiplierAtCruiseRatio(cruiseRatio: number, optimalRatio: number): number {
  return driveEfficiencyMultiplier(cruiseRatio, optimalRatio, 3, 7);
}

export function buildSpeedEconomicsCurve(
  ship: ShipType,
  distance: number,
  mode: TravelMode,
  cabins: CabinConfiguration,
  farePerDeparture: number,
  loadFactor = 0.7,
): SpeedEconomicsCurve {
  const minimum = ship.minimumCruiseRatio ?? 0.7;
  const maximum = ship.maximumCruiseRatio ?? 1.1;
  const optimal = ship.fuelOptimalCruiseRatio ?? 0.82;
  const nominalSpeed = ship.speedByMode[mode] ?? 1;
  const seats = Object.values(cabins).reduce((sum, value) => sum + value, 0);
  const points: SpeedEconomicsPoint[] = [];
  for (let step = 0; step <= 16; step += 1) {
    const cruiseRatio = minimum + (maximum - minimum) * step / 16;
    const travelHours = distance / Math.max(0.01, nominalSpeed * cruiseRatio) * 24;
    const fuelMultiplier = driveEfficiencyMultiplier(
      cruiseRatio, optimal, ship.slowFuelPenaltyCoefficient ?? 3, ship.fastFuelPenaltyCoefficient ?? 7,
    );
    const fuelUnits = mode === "sublight"
      ? 0
      : estimateInterstellarFuel(ship, mode, distance, cabins, cruiseRatio).fuelUnits;
    const highSpeedWear = 1 + (ship.highSpeedMaintenancePenalty ?? 2.4) * Math.max(0, cruiseRatio - 0.9) ** 2;
    const maintenanceCost = travelHours * ship.maintenancePerFlightHour * highSpeedWear;
    const crewCost = travelHours * ship.crewCostPerFlightHour;
    const technicalDelayProbability = Math.min(0.7, (1 - ship.reliability) +
      (ship.highSpeedReliabilityPenalty ?? 0.22) * Math.max(0, cruiseRatio - 0.9) ** 2);
    const departuresPerWeek = 168 / Math.max(1, travelHours * 2 + ship.turnaroundHours * 2);
    const projectedProfit = departuresPerWeek * (farePerDeparture - fuelUnits - maintenanceCost - crewCost);
    points.push({ cruiseRatio, travelHours, fuelMultiplier, fuelUnits, maintenanceCost, crewCost, technicalDelayProbability, departuresPerWeek, projectedProfit, sublightHours: 0, sublightFuelUnits: 0 });
  }
  const minimumBy = (selector: (point: SpeedEconomicsPoint) => number) =>
    points.reduce((best, point) => selector(point) < selector(best) ? point : best).cruiseRatio;
  return {
    points,
    fuelOptimalRatio: minimumBy((point) => point.fuelUnits),
    costOptimalRatio: minimumBy((point) => point.fuelUnits + point.maintenanceCost + point.crewCost),
    profitOptimalRatio: points.reduce((best, point) => point.projectedProfit > best.projectedProfit ? point : best).cruiseRatio,
  };
}

function routeCruiseRatio(route: Route, ship: ShipType): number {
  return Math.max(ship.minimumCruiseRatio ?? 0.7, Math.min(ship.maximumCruiseRatio ?? 1.1, route.cruiseRatioByShipType?.[ship.id] ?? 1));
}

function delayFor(
  seed: string,
  flightId: string,
  ship: SchedulingShip,
  shipType: ShipType,
  hazard: number,
  utilization: number,
  previousDelay: number,
  bufferMinutes: number,
  plannedFlightHours: number,
  loadFactor: number,
  portLevel: Starport["portLevel"],
  eventRisk: number,
  cruiseRatio: number,
  currentDay: number,
  departureMinute: number,
): { minutes: number; reasons: DelayReason[] } {
  const ageYears = Math.max(0, (currentDay - (ship.commissionedDay ?? currentDay)) / 360);
  const layoutComplexity = (ship.cabins.business * 1.5 + ship.cabins.premium * 2.2) /
    Math.max(1, Object.values(ship.cabins).reduce((sum, value) => sum + value, 0));
  const hullScale = Math.min(1, shipType.structuralMassTonnes / 2_000);
  const overdue = ship.maintenanceState === "required" ? 0.28 : ship.maintenanceState === "due" ? 0.1 :
    Math.max(0, (ship.flightHoursSinceMaintenance ?? 0) - 3_200) / 8_000;
  const speedPenalty = (shipType.highSpeedReliabilityPenalty ?? 0.22) * Math.max(0, cruiseRatio - 0.9) ** 2;
  const propagatedDelay = Math.max(0, previousDelay - bufferMinutes);
  const departureHour = (departureMinute % MINUTES_PER_DAY) / 60;
  const peakPeriodRisk = (departureHour >= 7 && departureHour < 10) || (departureHour >= 17 && departureHour < 20) ? 0.03 : 0;
  const entries: Array<[DelayReason, number, number]> = [
    ["starport-control", starportControlDelayProbability(utilization) + peakPeriodRisk + eventRisk * 0.08, 10 + utilization * 95 + (5 - portLevel) * 5],
    ["ground-turnaround", Math.min(0.6, 0.01 + hullScale * 0.045 + loadFactor * 0.05 + layoutComplexity * 0.04 + (5 - portLevel) * 0.008), 10 + hullScale * 55 + loadFactor * 35 + layoutComplexity * 30],
    ["technical", Math.min(0.7, 1 - shipType.reliability + (100 - ship.condition) / 450 + ageYears * 0.006 + overdue + speedPenalty), 25 + (100 - ship.condition) * 1.8 + ageYears * 5 + overdue * 180],
    ["route-environment", Math.min(0.75, 0.01 + hazard * 0.13 + eventRisk * 0.25), 15 + hazard * 105 + eventRisk * plannedFlightHours * 15],
    ["knock-on", propagatedDelay > 0 ? 1 : 0, propagatedDelay],
  ];
  let minutes = 0;
  const reasons: DelayReason[] = [];
  for (const [reason, probability, scale] of entries) {
    if (probability >= 1 || random01(`${seed}:${flightId}:${reason}`) < probability) {
      reasons.push(reason);
      minutes += reason === "knock-on"
        ? roundToFiveMinutes(scale)
        : Math.max(5, roundToFiveMinutes(scale * (0.45 + random01(`${seed}:${flightId}:${reason}:duration`))));
    }
  }
  return { minutes, reasons };
}

export function flightCompensationRate(delayMinutes: number, cancelled: boolean): number {
  if (cancelled) return 1;
  if (delayMinutes > 720) return 0.25;
  if (delayMinutes > 240) return 0.1;
  return 0;
}

/** Build concrete, five-minute flights. Every departure and arrival reserves one hard movement. */
export function generateFlightSchedule(input: {
  seed: string;
  startDay: number;
  numberOfDays?: number;
  routes: readonly Route[];
  ships: readonly SchedulingShip[];
  shipTypes: readonly ShipType[];
  ports: readonly Starport[];
  worldLegs: readonly WorldLeg[];
  basePortId?: string;
  capacityModifierByPort?: Readonly<Record<string, number>>;
  eventRiskByPort?: Readonly<Record<string, number>>;
  capacityModifierByPortDay?: Readonly<Record<string, number>>;
  eventRiskByPortDay?: Readonly<Record<string, number>>;
  historicalUseByRoute?: Readonly<Record<string, number>>;
  loadFactorByRoute?: Readonly<Record<string, number>>;
  committedFlights?: readonly ScheduledFlight[];
}): ScheduleResult {
  const numberOfDays = input.numberOfDays ?? 7;
  const startMinute = input.startDay * MINUTES_PER_DAY;
  const endMinute = startMinute + numberOfDays * MINUTES_PER_DAY;
  const allocationEndMinute = endMinute + 365 * MINUTES_PER_DAY;
  const portById = new Map(input.ports.map((port) => [port.id, port]));
  const typeById = new Map(input.shipTypes.map((type) => [type.id, type]));
  const dayMovements = new Map<string, string[]>();
  const movementSlots = new Map<string, string[]>();
  const flights: ScheduledFlight[] = [...(input.committedFlights ?? [])];
  const logs: ShipLogEntry[] = [];
  const previousDelayByShip = new Map<string, number>();

  const capacityForPort = (port: Starport, day = input.startDay) => starportMovementCapacity(
    port,
    Math.max(0.1, input.capacityModifierByPortDay?.[`${port.id}:${day}`] ?? input.capacityModifierByPort?.[port.id] ?? 1),
  );
  const capacityForSlot = (dailyCapacity: number, slotIndex: number): number =>
    Math.floor((slotIndex + 1) * dailyCapacity / 24) - Math.floor(slotIndex * dailyCapacity / 24);
  type MovementReservation = { minute: number; status: ScheduledFlight["departureSlotStatus"]; dayKey: string; slotKey: string; movementId: string };
  const reserveMovement = (portId: string, minute: number, movementId: string): MovementReservation | null => {
    const port = portById.get(portId);
    if (!port) return null;
    const requested = roundToFiveMinutes(minute);
    let candidate = roundToFiveMinutes(minute);
    // A request may shift or queue for at most six hours. Beyond that it is
    // operationally cancelled instead of silently becoming a next-day flight.
    for (let attempts = 0; attempts < 72; attempts += 1, candidate += 5) {
      if (candidate >= allocationEndMinute) return null;
      const day = Math.floor(candidate / MINUTES_PER_DAY);
      const dayKey = `${portId}:${day}`;
      const slotIndex = Math.floor((candidate % MINUTES_PER_DAY) / STARPORT_SLOT_MINUTES);
      const slotKey = `${dayKey}:${slotIndex}`;
      const usedDay = dayMovements.get(dayKey) ?? [];
      const usedSlot = movementSlots.get(slotKey) ?? [];
      const dailyCapacity = capacityForPort(port, day);
      if (usedDay.length < dailyCapacity && usedSlot.length < capacityForSlot(dailyCapacity, slotIndex)) {
        usedDay.push(movementId);
        usedSlot.push(movementId);
        dayMovements.set(dayKey, usedDay);
        movementSlots.set(slotKey, usedSlot);
        const shift = candidate - requested;
        return { minute: candidate, status: shift === 0 ? "confirmed" : shift <= STARPORT_SLOT_MINUTES ? "shifted" : "queued", dayKey, slotKey, movementId };
      }
    }
    return null;
  };
  const releaseMovement = (reservation: MovementReservation | null): void => {
    if (!reservation) return;
    dayMovements.set(reservation.dayKey, (dayMovements.get(reservation.dayKey) ?? []).filter((id) => id !== reservation.movementId));
    movementSlots.set(reservation.slotKey, (movementSlots.get(reservation.slotKey) ?? []).filter((id) => id !== reservation.movementId));
  };
  for (const flight of input.committedFlights ?? []) {
    for (const [portId, minute, movementId] of [
      [flight.fromPortId, flight.departureMinute, `${flight.id}:departure`],
      [flight.toPortId, flight.arrivalMinute, `${flight.id}:arrival`],
    ] as const) {
      if (minute < startMinute || minute >= allocationEndMinute) continue;
      const day = Math.floor(minute / MINUTES_PER_DAY);
      const slotIndex = Math.floor((minute % MINUTES_PER_DAY) / STARPORT_SLOT_MINUTES);
      const dayKey = `${portId}:${day}`;
      const slotKey = `${dayKey}:${slotIndex}`;
      dayMovements.set(dayKey, [...(dayMovements.get(dayKey) ?? []), movementId]);
      movementSlots.set(slotKey, [...(movementSlots.get(slotKey) ?? []), movementId]);
    }
  }

  const routePriority = (route: Route): number => {
    const confirmed = route.confirmedLongTermSlots ? 1_000_000 : 0;
    const origin = route.stops[0]?.portId;
    const baseAdvantage = origin === input.basePortId ? 5_000 : 0;
    const bid = Math.max(0, route.slotBidPerMovement ?? 0) * 100;
    const history = Math.max(0, Math.min(1, input.historicalUseByRoute?.[route.id] ?? 0)) * 1_000;
    const application = Math.max(0, 1_000 - (route.slotApplicationDay ?? input.startDay));
    return confirmed + baseAdvantage + bid + history + application;
  };
  const activeRoutes = input.routes.filter((candidate) => candidate.active)
    .map((route, index) => ({ route, index }))
    .sort((left, right) => routePriority(right.route) - routePriority(left.route) || left.index - right.index)
    .map((entry) => entry.route);
  for (const route of activeRoutes) {
    const routeShips = input.ships.filter((ship) => ship.routeId === route.id);
    for (let shipIndex = 0; shipIndex < routeShips.length; shipIndex += 1) {
      const ship = routeShips[shipIndex]!;
      const type = typeById.get(ship.shipTypeId);
      if (!type) continue;
      let services;
      try {
        services = buildRouteServices({
          ...route,
          shipTypeId: type.id,
          assignedShips: 1,
          cabinCapacityByClass: ship.cabins,
          ...(ship.buildConfiguration ? { buildConfiguration: ship.buildConfiguration } : {}),
        }, type, input.ports, input.worldLegs);
      } catch {
        continue;
      }
      if (services.length === 0) continue;
      const locationIndex = ship.currentPortId ? services.findIndex((service) => service.fromPortId === ship.currentPortId) : 0;
      if (ship.currentPortId && locationIndex < 0) continue;
      let serviceQueue = locationIndex > 0 ? [...services.slice(locationIndex), ...services.slice(0, locationIndex)] : [...services];
      const cruiseRatio = routeCruiseRatio(route, type);
      const manualTimes = route.weeklyDepartureMinutes ?? [];
      const selectedManual = manualTimes.length > 0 ? manualTimes[shipIndex % manualTimes.length] : undefined;
      const manualCandidate = selectedManual === undefined ? 0 :
        Math.floor(startMinute / (7 * MINUTES_PER_DAY)) * 7 * MINUTES_PER_DAY + selectedManual;
      let cursor = selectedManual === undefined
        ? startMinute + roundToFiveMinutes((shipIndex / Math.max(1, routeShips.length)) * MINUTES_PER_DAY)
        : manualCandidate < startMinute ? manualCandidate + 7 * MINUTES_PER_DAY : manualCandidate;
      cursor = Math.max(cursor, roundToFiveMinutes(ship.availableMinute ?? startMinute));
      while (cursor < endMinute) {
        let retryCurrentService = false;
        for (const service of serviceQueue) {
          if (cursor >= endMinute) break;
          const scheduledDepartureMinute = roundToFiveMinutes(cursor);
          const id = `${route.id}:${ship.id}:${service.fromPortId}:${service.toPortId}:${scheduledDepartureMinute}`;
          const scaledHours = service.inVehicleHours;
          const scheduledArrivalMinute = roundToFiveMinutes(scheduledDepartureMinute + scaledHours * 60);
          const departureSlot = reserveMovement(service.fromPortId, scheduledDepartureMinute, `${id}:departure`);
          const utilization = (() => {
            const port = portById.get(service.fromPortId)!;
            const key = `${service.fromPortId}:${Math.floor(scheduledDepartureMinute / MINUTES_PER_DAY)}`;
            return (dayMovements.get(key)?.length ?? 0) / capacityForPort(port, Math.floor(scheduledDepartureMinute / MINUTES_PER_DAY));
          })();
          const hazard = input.worldLegs.filter((leg) =>
            (leg.fromPortId === service.fromPortId && leg.toPortId === service.toPortId) ||
            (leg.toPortId === service.fromPortId && leg.fromPortId === service.toPortId)
          ).reduce((maximum, leg) => Math.max(maximum, leg.hazard), 0.25);
          const delay = delayFor(
            input.seed, id, ship, type, hazard, utilization,
            previousDelayByShip.get(ship.id) ?? 0,
            route.scheduleBufferMinutes ?? 0,
            scaledHours,
            input.loadFactorByRoute?.[route.id] ?? 0.7,
            portById.get(service.fromPortId)?.portLevel ?? 1,
            Math.max(
              input.eventRiskByPortDay?.[`${service.fromPortId}:${Math.floor(scheduledDepartureMinute / MINUTES_PER_DAY)}`] ?? input.eventRiskByPort?.[service.fromPortId] ?? 0,
              input.eventRiskByPortDay?.[`${service.toPortId}:${Math.floor(scheduledArrivalMinute / MINUTES_PER_DAY)}`] ?? input.eventRiskByPort?.[service.toPortId] ?? 0,
            ),
            cruiseRatio,
            Math.floor(scheduledDepartureMinute / MINUTES_PER_DAY),
            scheduledDepartureMinute,
          );
          const arrivalSlot = departureSlot === null ? null : reserveMovement(
            service.toPortId,
            roundToFiveMinutes(departureSlot.minute + scaledHours * 60 + delay.minutes),
            `${id}:arrival`,
          );
          const cancelled = departureSlot === null || arrivalSlot === null || delay.minutes >= 24 * 60;
          if (cancelled) {
            releaseMovement(departureSlot);
            releaseMovement(arrivalSlot);
          }
          const departureMinute = departureSlot?.minute ?? scheduledDepartureMinute;
          const arrivalMinute = arrivalSlot?.minute ?? scheduledArrivalMinute;
          const fuelUnits = service.fuelConsumptionPerDepartureEmpty ?? 0;
          const delayMinutes = cancelled ? 0 : Math.max(0, arrivalMinute - scheduledArrivalMinute);
          const delayReasons = cancelled ? [] : [...delay.reasons];
          if ((departureSlot?.status !== "confirmed" || arrivalSlot?.status !== "confirmed") && !delayReasons.includes("starport-control")) {
            delayReasons.unshift("starport-control");
          }
          const onTimeThresholdMinutes = Math.min(240, Math.max(60, roundToFiveMinutes(scaledHours * 60 * 0.03)));
          const extraCrewCost = cancelled ? 0 : delayMinutes / 60 * type.crewCostPerFlightHour;
          const extraPortCost = cancelled ? 0 : delayMinutes / 60 * (portById.get(service.toPortId)?.serviceFee ?? 0) * 0.2;
          flights.push({
            id, routeId: route.id, companyId: route.companyId, shipId: ship.id, shipTypeId: type.id,
            fromPortId: service.fromPortId, toPortId: service.toPortId,
            departureMinute, arrivalMinute, scheduledDepartureMinute, scheduledArrivalMinute,
            cruiseRatio, seatsByClass: { ...ship.cabins }, fuelUnits,
            delayMinutes,
            delayReasons,
            status: cancelled ? "cancelled" : "scheduled",
            compensationRate: flightCompensationRate(delayMinutes, cancelled),
            onTimeThresholdMinutes,
            onTime: !cancelled && delayMinutes <= onTimeThresholdMinutes,
            departureSlotStatus: departureSlot?.status ?? "cancelled",
            arrivalSlotStatus: arrivalSlot?.status ?? "cancelled",
            sublightHours: service.sublightHours ?? 0,
            departureSublightHours: service.departureSublightHours ?? 0,
            interstellarHours: service.interstellarHours ?? Math.max(0, service.inVehicleHours - (service.sublightHours ?? 0)),
            arrivalSublightHours: service.arrivalSublightHours ?? 0,
            sublightFuelUnits: service.sublightFuelUnits ?? 0,
            interstellarFuelUnits: service.interstellarFuelUnits ?? 0,
            extraCrewCost,
            extraPortCost,
            ...(ship.substitutesForShipId ? { originalShipId: ship.substitutesForShipId, replacementShipId: ship.id } : {}),
          });
          if (cancelled) {
            logs.push({ id: `${id}:cancelled`, shipId: ship.id, minute: scheduledDepartureMinute, kind: "cancelled", portId: service.fromPortId, flightId: id, detail: "星港硬容量不足，航班取消" });
            previousDelayByShip.set(ship.id, 0);
            const failedIndex = serviceQueue.indexOf(service);
            serviceQueue = [...serviceQueue.slice(failedIndex), ...serviceQueue.slice(0, failedIndex)];
            cursor = scheduledDepartureMinute + Math.max(60, route.scheduleBufferMinutes ?? 0);
            retryCurrentService = true;
          } else {
            if (delayReasons.length > 0) logs.push({ id: `${id}:delay`, shipId: ship.id, minute: departureMinute, kind: "delay", portId: service.fromPortId, flightId: id, detail: `${delayReasons.join("、")}：延误 ${arrivalMinute - scheduledArrivalMinute} 分钟` });
            logs.push(
              { id: `${id}:depart`, shipId: ship.id, minute: departureMinute, kind: "departed-starport", portId: service.fromPortId, flightId: id, detail: "完成登机并离开星港" },
              { id: `${id}:jump`, shipId: ship.id, minute: roundToFiveMinutes(departureMinute + (service.departureSublightHours ?? 0) * 60), kind: "entered-hyperspace", flightId: id, detail: `完成加速—滑行—减速离港段；亚光速燃料消耗 ${(service.sublightFuelUnits ?? 0).toFixed(1)} t` },
              { id: `${id}:cruise`, shipId: ship.id, minute: roundToFiveMinutes((departureMinute + arrivalMinute) / 2), kind: "hyperspace-cruise", flightId: id, detail: "星际巡航" },
              { id: `${id}:system`, shipId: ship.id, minute: Math.max(departureMinute, roundToFiveMinutes(arrivalMinute - (service.arrivalSublightHours ?? 0) * 60)), kind: "arrived-system", portId: service.toPortId, flightId: id, detail: "退出星际航行；船速归零" },
              { id: `${id}:approach`, shipId: ship.id, minute: Math.max(departureMinute, roundToFiveMinutes(arrivalMinute - (service.arrivalSublightHours ?? 0) * 60)), kind: "sublight-approach", portId: service.toPortId, flightId: id, detail: "从跃出点加速—滑行—减速前往星港（滑行不消耗燃料）" },
              { id: `${id}:arrive`, shipId: ship.id, minute: arrivalMinute, kind: "arrived-starport", portId: service.toPortId, flightId: id, detail: "抵达星港" },
            );
            previousDelayByShip.set(ship.id, Math.max(0, arrivalMinute - scheduledArrivalMinute));
          }
          if (!cancelled) cursor = Math.max(cursor + 5, arrivalMinute + roundToFiveMinutes(service.destinationDwellHours * 60 + (route.scheduleBufferMinutes ?? 0)));
          if (retryCurrentService) break;
        }
      }
    }
  }

  const starportCapacity: StarportCapacityDay[] = [];
  const capacityDays = Math.max(numberOfDays, ...flights.map((flight) => Math.floor(flight.arrivalMinute / MINUTES_PER_DAY) - input.startDay + 1));
  for (let offset = 0; offset < capacityDays; offset += 1) {
    const day = input.startDay + offset;
    for (const port of input.ports) {
      const dayFlights = flights.filter((flight) => flight.status !== "cancelled" &&
        (Math.floor(flight.departureMinute / MINUTES_PER_DAY) === day && flight.fromPortId === port.id || Math.floor(flight.arrivalMinute / MINUTES_PER_DAY) === day && flight.toPortId === port.id));
      const departures = dayFlights.filter((flight) => flight.fromPortId === port.id && Math.floor(flight.departureMinute / MINUTES_PER_DAY) === day).map((flight) => flight.id);
      const arrivals = dayFlights.filter((flight) => flight.toPortId === port.id && Math.floor(flight.arrivalMinute / MINUTES_PER_DAY) === day).map((flight) => flight.id);
      const capacity = capacityForPort(port, day);
      const capacitySlots: StarportCapacitySlot[] = Array.from({ length: 24 }, (_, slotIndex) => {
        const slotIds = movementSlots.get(`${port.id}:${day}:${slotIndex}`) ?? [];
        const slotCapacity = capacityForSlot(capacity, slotIndex);
        return {
          startMinute: day * MINUTES_PER_DAY + slotIndex * STARPORT_SLOT_MINUTES,
          capacity: slotCapacity,
          used: slotIds.length,
          utilization: slotCapacity > 0 ? slotIds.length / slotCapacity : 0,
          flightIds: slotIds.map((id) => id.replace(/:(departure|arrival)$/, "")),
        };
      });
      const used = departures.length + arrivals.length;
      const modifier = Math.max(0.1, input.capacityModifierByPortDay?.[`${port.id}:${day}`] ?? input.capacityModifierByPort?.[port.id] ?? 1);
      starportCapacity.push({
        portId: port.id, day, capacity, used, utilization: used / capacity,
        departureFlightIds: departures, arrivalFlightIds: arrivals, slots: capacitySlots,
        modifier,
        congestionRisk: Math.min(1, (used / capacity) ** 3),
      });
    }
  }
  return { flights, shipLogs: logs.sort((a, b) => a.minute - b.minute), starportCapacity };
}

export function formatScheduleMinute(minute: number): string {
  const day = Math.floor(minute / MINUTES_PER_DAY);
  const withinDay = ((minute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = Math.floor(withinDay / 60).toString().padStart(2, "0");
  const minutes = Math.floor(withinDay % 60).toString().padStart(2, "0");
  return `第 ${day} 日 ${hours}:${minutes}`;
}

export function scheduleFitsStarportCapacity(schedule: ScheduleResult): boolean {
  return schedule.starportCapacity.every((entry) => entry.used <= entry.capacity) &&
    schedule.flights.every((flight) => flight.status !== "cancelled");
}
