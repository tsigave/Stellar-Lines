import { deterministicExitDistanceKm, estimateSublightTransit } from "../fuel.js";
import { buildRouteServices } from "../routes.js";
import { PASSENGER_CLASSES } from "../types.js";
import type { CabinConfiguration, GeneratedGalaxy, Route, ShipType, SimulationScenario } from "../types.js";
import { clamp } from "../utils.js";
import {
  fleetConfigurationForShip,
  shipMaintenanceState,
} from "./fleet.js";
import { buildGameSchedule, gameWorldLegs } from "./schedule.js";
import {
  ROUTE_OPENING_COST,
  type CreateRouteInput,
  type FleetConfiguration,
  type GameActionResult,
  type GameState,
  type OwnedShip,
  type PendingFleetChange,
  type StarportCapacityInvestment,
  requirePlaying,
} from "./model.js";

function routePricing(multiplier: number): Route["pricing"] {
  return {
    multiplier,
    passengerClassMultiplier: { economy: 1, business: 1.35, premium: 2.1 },
  };
}

export function createPlayerRoute(
  state: GameState,
  input: CreateRouteInput,
  galaxy: GeneratedGalaxy,
  shipTypes: readonly ShipType[],
): GameActionResult {
  requirePlaying(state);
  if (input.originPortId !== state.basePortId) throw new Error("所有玩家航线必须从公司基地出发");
  if (input.originPortId === input.destinationPortId) throw new Error("目的地不能是公司基地");
  if (state.cash < ROUTE_OPENING_COST) throw new Error("资金不足，无法支付航线开办费");
  const selectedShipIds = [...new Set(input.shipIds)];
  if (selectedShipIds.length === 0) throw new Error("请至少选择一艘可用船只");
  const ships = selectedShipIds.map((shipId) => state.fleet.find((candidate) => candidate.id === shipId));
  if (ships.some((ship) => !ship || ship.routeId)) throw new Error("选择的船只中有船已被分配");
  const selectedShips = ships as OwnedShip[];
  const selectedConfigurations = selectedShips.map((ship) => fleetConfigurationForShip(state, ship));
  if (selectedConfigurations.some((configuration) => !configuration)) {
    throw new Error("所选舰船尚未分配统一配置方案");
  }
  const configurations = selectedConfigurations as FleetConfiguration[];
  if (selectedShips.some((ship) => {
    const maintenance = shipMaintenanceState(ship, state.day);
    return maintenance !== "ready" && maintenance !== "due";
  })) throw new Error("选择的船只中有船正在维护或已被强制停航");
  const selectedTypes = selectedShips.map((ship) => shipTypes.find((candidate) => candidate.id === ship.shipTypeId));
  if (selectedTypes.some((shipType) => !shipType)) throw new Error("船型数据不存在");
  const concreteTypes = selectedTypes as ShipType[];
  if (concreteTypes.some((shipType) => !shipType.supportedModes.includes(input.routingMode))) {
    throw new Error(`所选船只必须全部安装${input.routingMode === "warp" ? "曲率" : "超空间"}引擎`);
  }
  const shipType = concreteTypes[0]!;
  const cabinCapacityByClass: CabinConfiguration = {
    economy: configurations.reduce((sum, configuration) => sum + configuration.cabins.economy, 0) / selectedShips.length,
    business: configurations.reduce((sum, configuration) => sum + configuration.cabins.business, 0) / selectedShips.length,
    premium: configurations.reduce((sum, configuration) => sum + configuration.cabins.premium, 0) / selectedShips.length,
  };
  const number = state.nextRouteNumber;
  const route: Route = {
    id: `player-route-${number}`,
    companyId: "player",
    name: input.name.trim() || `远星航线 ${number}`,
    kind: "return",
    routingMode: input.routingMode,
    stops: [input.originPortId, input.destinationPortId].map((portId) => ({
      portId,
      stopType: "commercial" as const,
      minimumStopHours: 4,
    })),
    shipTypeId: shipType.id,
    assignedShips: selectedShips.length,
    cabinCapacityByClass,
    pricing: {
      ...routePricing(Math.max(0, input.fareMultiplier)),
      ...(input.fareByClass ? {
        fareByClass: {
          economy: Math.max(0, input.fareByClass.economy),
          business: Math.max(0, input.fareByClass.business),
          premium: Math.max(0, input.fareByClass.premium),
        },
      } : {}),
    },
    maintenanceAllowanceHours: 0,
    active: true,
    buildConfiguration: configurations[0]!.build,
    cruiseRatioByShipType: Object.fromEntries(concreteTypes.map((type) => [type.id, 1])),
    sublightTargetSpeedKmPerSecondByShipType: Object.fromEntries(concreteTypes.map((type) => [type.id, Math.min(80, type.maximumSublightSpeedKmPerSecond ?? 80)])),
    sublightThrustRatioByShipType: Object.fromEntries(concreteTypes.map((type) => [type.id, type.fuelOptimalThrustRatio ?? 0.72])),
    scheduleBufferMinutes: 30,
    directionalPricingLinked: true,
    confirmedLongTermSlots: false,
    slotBidPerMovement: 0,
    slotApplicationDay: state.day,
  };
  for (const selectedType of concreteTypes) {
    const selectedTypeShip = selectedShips.find((ship) => ship.shipTypeId === selectedType.id)!;
    const selectedTypeConfiguration = fleetConfigurationForShip(state, selectedTypeShip)!;
    buildRouteServices(
      { ...route, shipTypeId: selectedType.id, assignedShips: 1, buildConfiguration: selectedTypeConfiguration.build },
      selectedType,
      galaxy.ports,
      gameWorldLegs(galaxy),
    );
  }
  const prospectiveState: GameState = {
      ...state,
      cash: state.cash - ROUTE_OPENING_COST,
      routes: [...state.routes, route],
      fleet: state.fleet.map((candidate) =>
        selectedShipIds.includes(candidate.id) ? { ...candidate, routeId: route.id } : candidate,
      ),
      nextRouteNumber: number + 1,
    };
  const schedule = buildGameSchedule(prospectiveState, galaxy, shipTypes, 7);
  const newRouteFlights = schedule.flights.filter((flight) => flight.routeId === route.id);
  if (newRouteFlights.some((flight) => flight.status === "cancelled")) {
    throw new Error("星港未来七日硬容量不足，请减少班次或更换时刻");
  }
  return {
    state: {
      ...prospectiveState,
      scheduledFlights: schedule.flights,
      shipLogs: schedule.shipLogs,
      starportCapacity: schedule.starportCapacity,
    },
    message: `航线“${route.name}”已开通，${selectedShips.length} 艘兼容舰船已生成五分钟精度班表`,
  };
}

export function togglePlayerRoute(state: GameState, routeId: string): GameActionResult {
  requirePlaying(state);
  const route = state.routes.find((candidate) => candidate.id === routeId);
  if (!route) throw new Error("航线不存在");
  const active = !route.active;
  return {
    state: {
      ...state,
      routes: state.routes.map((candidate) =>
        candidate.id === routeId ? { ...candidate, active } : candidate,
      ),
    },
    message: active ? `已恢复“${route.name}”` : `已暂停“${route.name}”`,
  };
}

export function adjustPlayerRouteFare(
  state: GameState,
  routeId: string,
  delta: number,
): GameActionResult {
  requirePlaying(state);
  const route = state.routes.find((candidate) => candidate.id === routeId);
  if (!route) throw new Error("航线不存在");
  const multiplier = Math.max(0.65, Math.min(1.8, route.pricing.multiplier + delta));
  return {
    state: {
      ...state,
      routes: state.routes.map((candidate) =>
        candidate.id === routeId
          ? { ...candidate, pricing: { ...candidate.pricing, multiplier } }
          : candidate,
      ),
    },
    message: `“${route.name}”票价已调整为标准价的 ${Math.round(multiplier * 100)}%`,
  };
}

export function setPlayerRouteFares(
  state: GameState,
  routeId: string,
  fareByClass: CabinConfiguration,
): GameActionResult {
  requirePlaying(state);
  const route = state.routes.find((candidate) => candidate.id === routeId);
  if (!route) throw new Error("航线不存在");
  const normalized: CabinConfiguration = {
    economy: Math.max(0, Math.round(fareByClass.economy)),
    business: Math.max(0, Math.round(fareByClass.business)),
    premium: Math.max(0, Math.round(fareByClass.premium)),
  };
  return {
    state: {
      ...state,
      routes: state.routes.map((candidate) => candidate.id === routeId
        ? { ...candidate, pricing: { ...candidate.pricing, fareByClass: normalized } }
        : candidate),
    },
    message: `“${route.name}”三舱票价已确认并将在下一次结算生效`,
  };
}

export function setRouteDirectionalFares(
  state: GameState,
  routeId: string,
  direction: "outbound" | "return",
  fares: CabinConfiguration,
): GameActionResult {
  requirePlaying(state);
  const route = state.routes.find((candidate) => candidate.id === routeId);
  if (!route) throw new Error("航线不存在");
  const normalized = Object.fromEntries(PASSENGER_CLASSES.map((cabinClass) => [
    cabinClass, Math.max(0, Math.round(fares[cabinClass])),
  ])) as CabinConfiguration;
  return {
    state: {
      ...state,
      routes: state.routes.map((candidate) => candidate.id === routeId ? {
        ...candidate,
        pricing: {
          ...candidate.pricing,
          directionalFareByClass: candidate.directionalPricingLinked !== false
            ? { outbound: normalized, return: normalized }
            : { ...candidate.pricing.directionalFareByClass, [direction]: normalized },
        },
      } : candidate),
    },
    message: `“${route.name}”${direction === "outbound" ? "去程" : "回程"}票价已更新`,
  };
}

export function setRouteDirectionalPricingLinked(state: GameState, routeId: string, linked: boolean): GameActionResult {
  requirePlaying(state);
  const route = state.routes.find((candidate) => candidate.id === routeId);
  if (!route) throw new Error("航线不存在");
  const outbound = route.pricing.directionalFareByClass?.outbound ?? route.pricing.fareByClass;
  return {
    state: { ...state, routes: state.routes.map((candidate) => candidate.id === routeId ? {
      ...candidate,
      directionalPricingLinked: linked,
      pricing: linked && outbound ? { ...candidate.pricing, directionalFareByClass: { outbound, return: outbound } } : candidate.pricing,
    } : candidate) },
    message: `“${route.name}”双向票价已${linked ? "联动" : "拆分"}`,
  };
}

export function setRouteCruiseRatio(
  state: GameState,
  routeId: string,
  shipTypeId: string,
  cruiseRatio: number,
  shipTypes: readonly ShipType[],
  galaxy?: GeneratedGalaxy,
): GameActionResult {
  requirePlaying(state);
  const route = state.routes.find((candidate) => candidate.id === routeId);
  const type = shipTypes.find((candidate) => candidate.id === shipTypeId);
  if (!route || !type) throw new Error("航线或船型不存在");
  const normalized = Number(clamp(cruiseRatio, type.minimumCruiseRatio ?? 0.7, type.maximumCruiseRatio ?? 1.1).toFixed(3));
  const nextState: GameState = {
      ...state,
      routes: state.routes.map((candidate) => candidate.id === routeId ? {
        ...candidate,
        cruiseRatioByShipType: { ...candidate.cruiseRatioByShipType, [shipTypeId]: normalized },
      } : candidate),
    };
  const schedule = galaxy ? buildGameSchedule(nextState, galaxy, shipTypes, 7) : null;
  if (schedule?.flights.some((flight) => flight.routeId === routeId && flight.status === "cancelled")) {
    throw new Error("该速度方案会超出星港硬容量或失去可用时隙，不能提交");
  }
  return {
    state: schedule ? { ...nextState, scheduledFlights: schedule.flights, shipLogs: schedule.shipLogs, starportCapacity: schedule.starportCapacity } : nextState,
    message: `“${route.name}”的 ${type.name} 巡航速度已设为标称速度的 ${(normalized * 100).toFixed(0)}%`,
  };
}

export function setRouteSublightProfile(
  state: GameState,
  routeId: string,
  shipTypeId: string,
  targetSpeedKmPerSecond: number,
  thrustRatio: number,
  shipTypes: readonly ShipType[],
  galaxy: GeneratedGalaxy,
): GameActionResult {
  requirePlaying(state);
  const route = state.routes.find((candidate) => candidate.id === routeId);
  const type = shipTypes.find((candidate) => candidate.id === shipTypeId);
  if (!route || !type) throw new Error("航线或船型不存在");
  const configuration = state.fleet.find((ship) => ship.routeId === routeId && ship.shipTypeId === shipTypeId);
  const cabins = configuration ? fleetConfigurationForShip(state, configuration)?.cabins : undefined;
  if (!cabins) throw new Error("该型号尚无航线客舱配置");
  const normalizedThrust = Number(clamp(thrustRatio, 0.25, 1).toFixed(3));
  const mode = route.routingMode ?? "hyperspace";
  const relevantPorts = route.stops.flatMap((stop) => galaxy.ports.filter((port) => port.id === stop.portId));
  const safeMaximum = relevantPorts.reduce((minimum, port) => {
    const distance = mode === "hyperspace"
      ? port.hyperspaceExitDistanceKm ?? deterministicExitDistanceKm(port.systemId, mode)
      : port.warpExitDistanceKm ?? deterministicExitDistanceKm(port.systemId, mode);
    const estimate = estimateSublightTransit(type, distance, cabins, type.fuelCapacityTonnes, type.maximumSublightSpeedKmPerSecond ?? 120, normalizedThrust);
    return Math.min(minimum, estimate.maximumReachableSpeedKmPerSecond, type.maximumSublightSpeedKmPerSecond ?? Number.POSITIVE_INFINITY);
  }, Number.POSITIVE_INFINITY);
  const normalizedSpeed = Number(clamp(targetSpeedKmPerSecond, 1, safeMaximum).toFixed(3));
  const nextState: GameState = { ...state, routes: state.routes.map((candidate) => candidate.id === routeId ? {
    ...candidate,
    sublightTargetSpeedKmPerSecondByShipType: { ...candidate.sublightTargetSpeedKmPerSecondByShipType, [shipTypeId]: normalizedSpeed },
    sublightThrustRatioByShipType: { ...candidate.sublightThrustRatioByShipType, [shipTypeId]: normalizedThrust },
  } : candidate) };
  const schedule = buildGameSchedule(nextState, galaxy, shipTypes, 7);
  if (schedule.flights.some((flight) => flight.routeId === routeId && flight.status === "cancelled")) {
    throw new Error("该亚光速方案会使班表失去可用时隙，不能提交");
  }
  return {
    state: { ...nextState, scheduledFlights: schedule.flights, shipLogs: schedule.shipLogs, starportCapacity: schedule.starportCapacity },
    message: `“${route.name}”的 ${type.name} 亚光速目标已设为 ${normalizedSpeed.toFixed(1)} km/s、额定推力 ${(normalizedThrust * 100).toFixed(0)}%`,
  };
}

export function setRouteScheduleBuffer(
  state: GameState,
  routeId: string,
  minutes: number,
  galaxy: GeneratedGalaxy,
  shipTypes: readonly ShipType[],
): GameActionResult {
  requirePlaying(state);
  const route = state.routes.find((candidate) => candidate.id === routeId);
  if (!route) throw new Error("航线不存在");
  const normalized = Math.max(0, Math.min(12 * 60, Math.round(minutes / 5) * 5));
  const nextState: GameState = { ...state, routes: state.routes.map((candidate) => candidate.id === routeId ? { ...candidate, scheduleBufferMinutes: normalized } : candidate) };
  const schedule = buildGameSchedule(nextState, galaxy, shipTypes, 7);
  return { state: { ...nextState, scheduledFlights: schedule.flights, shipLogs: schedule.shipLogs, starportCapacity: schedule.starportCapacity }, message: `“${route.name}”轮转缓冲已设为 ${normalized} 分钟` };
}

export function setRouteSlotBid(
  state: GameState,
  routeId: string,
  bidPerMovement: number,
  galaxy: GeneratedGalaxy,
  shipTypes: readonly ShipType[],
): GameActionResult {
  requirePlaying(state);
  const route = state.routes.find((candidate) => candidate.id === routeId);
  if (!route) throw new Error("航线不存在");
  const bid = Math.max(0, Math.min(500, Math.round(bidPerMovement)));
  const nextState: GameState = { ...state, routes: state.routes.map((candidate) => candidate.id === routeId ? { ...candidate, slotBidPerMovement: bid } : candidate) };
  const schedule = buildGameSchedule(nextState, galaxy, shipTypes, 7);
  return { state: { ...nextState, scheduledFlights: schedule.flights, shipLogs: schedule.shipLogs, starportCapacity: schedule.starportCapacity }, message: `“${route.name}”时隙申请费已设为 ${bid} Cr/movement` };
}

export function setRouteWeeklyDepartureMinutes(
  state: GameState,
  routeId: string,
  minutes: readonly number[],
  galaxy?: GeneratedGalaxy,
  shipTypes: readonly ShipType[] = [],
): GameActionResult {
  requirePlaying(state);
  const route = state.routes.find((candidate) => candidate.id === routeId);
  if (!route) throw new Error("航线不存在");
  const normalized = [...new Set(minutes.map((minute) => Math.round(minute / 5) * 5))]
    .filter((minute) => minute >= 0 && minute < 7 * 1_440)
    .sort((left, right) => left - right);
  const nextState: GameState = { ...state, routes: state.routes.map((candidate) => candidate.id === routeId ? { ...candidate, weeklyDepartureMinutes: normalized, confirmedLongTermSlots: normalized.length > 0 || candidate.confirmedLongTermSlots === true } : candidate) };
  const schedule = galaxy ? buildGameSchedule(nextState, galaxy, shipTypes, 7) : null;
  if (schedule?.flights.some((flight) => flight.routeId === routeId && flight.status === "cancelled")) {
    throw new Error("该周班模板申请不到完整起降时隙，不能提交");
  }
  return {
    state: schedule ? { ...nextState, scheduledFlights: schedule.flights, shipLogs: schedule.shipLogs, starportCapacity: schedule.starportCapacity } : nextState,
    message: normalized.length > 0 ? `“${route.name}”已保存 ${normalized.length} 个五分钟精度周班时刻` : `“${route.name}”已恢复自动均匀排班`,
  };
}

export function requestRouteFleetChange(
  state: GameState,
  shipId: string,
  toRouteId: string | null,
  shipTypes: readonly ShipType[],
  galaxy?: GeneratedGalaxy,
): GameActionResult {
  requirePlaying(state);
  const ship = state.fleet.find((candidate) => candidate.id === shipId);
  if (!ship) throw new Error("舰船不存在");
  if (state.pendingFleetChanges.some((change) => change.shipId === shipId && change.status === "pending")) {
    throw new Error("该舰船已有待生效的调度变更");
  }
  const target = toRouteId ? state.routes.find((route) => route.id === toRouteId) : undefined;
  if (toRouteId && !target) throw new Error("目标航线不存在");
  const type = shipTypes.find((candidate) => candidate.id === ship.shipTypeId);
  if (!type) throw new Error("船型不存在");
  if (target && (!target.routingMode || !type.supportedModes.includes(target.routingMode))) {
    throw new Error("该船型不支持目标航线的推进方式");
  }
  if (!fleetConfigurationForShip(state, ship)) throw new Error("舰船尚未安装可销售客舱");
  const targetOrigin = target?.stops[0]?.portId ?? state.basePortId;
  if (!ship.routeId && ship.currentPortId && ship.currentPortId !== targetOrigin) {
    throw new Error("待命舰船不在目标航线起点，不能瞬移加入；请先安排返回基地");
  }
  const currentRoute = ship.routeId ? state.routes.find((route) => route.id === ship.routeId) : undefined;
  const rotationOrigin = currentRoute?.stops[0]?.portId ?? state.basePortId;
  const nextReturnArrival = state.scheduledFlights
    .filter((flight) => flight.shipId === shipId && flight.status !== "cancelled" &&
      flight.toPortId === rotationOrigin && flight.arrivalMinute >= state.day * 1_440)
    .reduce((earliest, flight) => Math.min(earliest, flight.arrivalMinute), Number.POSITIVE_INFINITY);
  const effectiveDay = ship.routeId === null
    ? state.day + 1
    : Number.isFinite(nextReturnArrival)
      ? Math.max(state.day + 1, Math.ceil(nextReturnArrival / 1_440))
      : state.day + 7;
  const configuration = fleetConfigurationForShip(state, ship)!;
  const seats = Object.values(configuration.cabins).reduce((sum, value) => sum + value, 0);
  const capacityDelta = toRouteId ? seats : -seats;
  let possiblyCancelledFlightIds: string[] = [];
  if (galaxy) {
    const previewState: GameState = {
      ...state,
      day: effectiveDay,
      fleet: state.fleet.map((candidate) => candidate.id === shipId ? { ...candidate, routeId: toRouteId } : candidate),
    };
    const preview = buildGameSchedule(previewState, galaxy, shipTypes, 14);
    const previewIds = new Set(preview.flights.filter((flight) => flight.status !== "cancelled").map((flight) => flight.id));
    const withdrawn = state.scheduledFlights.filter((flight) => flight.shipId === shipId && flight.departureMinute >= effectiveDay * 1_440 && !previewIds.has(flight.id)).map((flight) => flight.id);
    const capacityCancelled = preview.flights.filter((flight) => flight.status === "cancelled" &&
      (flight.routeId === toRouteId || flight.routeId === ship.routeId)).map((flight) => flight.id);
    possiblyCancelledFlightIds = [...new Set([...withdrawn, ...capacityCancelled])];
    if (toRouteId && capacityCancelled.length > 0) {
      throw new Error(`增班会超出星港硬时隙容量（预计 ${capacityCancelled.length} 班取消），不能提交`);
    }
  }
  const change: PendingFleetChange = {
    id: `fleet-change-${shipId}-${state.day}-${state.pendingFleetChanges.length + 1}`,
    shipId,
    fromRouteId: ship.routeId,
    toRouteId,
    requestedDay: state.day,
    effectiveDay,
    status: "pending",
    expectedCost: Math.max(0, target?.slotBidPerMovement ?? 0) * 2,
    capacityDelta,
    possiblyCancelledFlightIds,
  };
  return {
    state: { ...state, pendingFleetChanges: [...state.pendingFleetChanges, change] },
    message: `${ship.name} 的调度变更将在第 ${effectiveDay} 日完成当前轮转后生效；每日单班容量变化 ${capacityDelta >= 0 ? "+" : ""}${capacityDelta} 席`,
  };
}

export function setShipReserveRoute(
  state: GameState,
  shipId: string,
  routeId: string | null,
  shipTypes: readonly ShipType[],
): GameActionResult {
  requirePlaying(state);
  const ship = state.fleet.find((candidate) => candidate.id === shipId);
  if (!ship) throw new Error("舰船不存在");
  if (ship.routeId) throw new Error("执行常规轮转的舰船不能同时进入备用池");
  const route = routeId ? state.routes.find((candidate) => candidate.id === routeId) : undefined;
  if (routeId && !route) throw new Error("备用目标航线不存在");
  const type = shipTypes.find((candidate) => candidate.id === ship.shipTypeId);
  if (route?.routingMode && !type?.supportedModes.includes(route.routingMode)) throw new Error("船型与备用目标航线不兼容");
  if (route && !fleetConfigurationForShip(state, ship)) throw new Error("备用船必须安装可销售客舱");
  return {
    state: { ...state, fleet: state.fleet.map((candidate) => candidate.id === shipId ? { ...candidate, reserveForRouteId: routeId } : candidate) },
    message: route ? `${ship.name} 已加入“${route.name}”备用池，出现取消风险时自动顶替` : `${ship.name} 已退出备用池`,
  };
}

export function investInStarportCapacity(
  state: GameState,
  portId: string,
  galaxy: GeneratedGalaxy,
  shipTypes: readonly ShipType[],
): GameActionResult {
  requirePlaying(state);
  const port = galaxy.ports.find((candidate) => candidate.id === portId);
  if (!port) throw new Error("星港不存在");
  const current = state.starportCapacityInvestments[portId];
  const level = current?.level ?? 0;
  if (level >= 5) throw new Error("该星港的容量协作投资已经达到上限");
  const cost = Math.round(25_000 * (level + 1) * port.portLevel);
  if (state.cash < cost) throw new Error("资金不足，无法投资星港容量");
  const investment: StarportCapacityInvestment = { portId, level: level + 1, totalCost: (current?.totalCost ?? 0) + cost };
  const nextState: GameState = { ...state, cash: state.cash - cost, starportCapacityInvestments: { ...state.starportCapacityInvestments, [portId]: investment } };
  const schedule = buildGameSchedule(nextState, galaxy, shipTypes, 7);
  return {
    state: { ...nextState, scheduledFlights: schedule.flights, shipLogs: schedule.shipLogs, starportCapacity: schedule.starportCapacity },
    message: `${port.name} 容量投资升至 ${investment.level} 级，基础 movement 修正 +${investment.level * 8}%`,
  };
}

export function applyDueFleetChanges(state: GameState, day: number): GameState {
  const due = state.pendingFleetChanges.filter((change) => change.status === "pending" && change.effectiveDay <= day);
  if (due.length === 0) return state;
  const byShip = new Map(due.map((change) => [change.shipId, change]));
  const fleet = state.fleet.map((ship) => {
      const change = byShip.get(ship.id);
      return change ? { ...ship, routeId: change.toRouteId, reserveForRouteId: null } : ship;
    });
  return {
    ...state,
    fleet,
    routes: state.routes.map((route) => route.closingAfterRotation && !fleet.some((ship) => ship.routeId === route.id)
      ? { ...route, active: false, closingAfterRotation: false }
      : route),
    pendingFleetChanges: state.pendingFleetChanges.map((change) => due.includes(change) ? { ...change, status: "applied" } : change),
  };
}

export function closePlayerRoute(state: GameState, routeId: string): GameActionResult {
  requirePlaying(state);
  const route = state.routes.find((candidate) => candidate.id === routeId);
  if (!route) throw new Error("航线不存在");
  const routeShips = state.fleet.filter((ship) => ship.routeId === routeId);
  const changes = routeShips.map((ship, index): PendingFleetChange => {
    const origin = route.stops[0]?.portId ?? state.basePortId;
    const returnMinute = state.scheduledFlights.filter((flight) => flight.shipId === ship.id &&
      flight.status !== "cancelled" && flight.toPortId === origin && flight.arrivalMinute >= state.day * 1_440)
      .reduce((earliest, flight) => Math.min(earliest, flight.arrivalMinute), Number.POSITIVE_INFINITY);
    const configuration = fleetConfigurationForShip(state, ship);
    const seats = configuration ? Object.values(configuration.cabins).reduce((sum, value) => sum + value, 0) : 0;
    return {
      id: `fleet-change-${ship.id}-${state.day}-close-${index + 1}`,
      shipId: ship.id, fromRouteId: routeId, toRouteId: null, requestedDay: state.day,
      effectiveDay: Number.isFinite(returnMinute) ? Math.max(state.day + 1, Math.ceil(returnMinute / 1_440)) : state.day + 7,
      status: "pending", expectedCost: 0, capacityDelta: -seats, possiblyCancelledFlightIds: [],
    };
  });
  return {
    state: {
      ...state,
      routes: state.routes.map((candidate) => candidate.id === routeId ? { ...candidate, closingAfterRotation: true } : candidate),
      pendingFleetChanges: [...state.pendingFleetChanges, ...changes],
    },
    message: `“${route.name}”已停止新增航班；${routeShips.length} 艘船将在完成当前往返后退出，不会瞬移`,
  };
}

export function routeSchedule(route: Route, scenario: SimulationScenario): { departuresPerWeek: number; roundTripDays: number; dailyFlightHours: number } {
  const variants = scenario.routes.filter((candidate) =>
    candidate.id === route.id || candidate.parentRouteId === route.id,
  );
  const modeled = variants.flatMap((variant) => {
    const shipType = scenario.shipTypes.find((ship) => ship.id === variant.shipTypeId);
    if (!shipType) return [];
    const services = buildRouteServices({ ...variant, active: true }, shipType, scenario.ports, scenario.worldLegs);
    return [{ variant, shipType, services }];
  });
  const departuresPerWeek = modeled.reduce((sum, item) => sum + (item.services[0]?.departuresPerWeek ?? 0), 0);
  const weightedRoundTripDays = modeled.reduce((sum, item) => {
    const departures = item.services[0]?.departuresPerWeek ?? 0;
    const days = departures > 0 ? 7 * item.variant.assignedShips * item.shipType.operationalAvailability / departures : 0;
    return sum + days * item.variant.assignedShips;
  }, 0);
  const totalShips = modeled.reduce((sum, item) => sum + item.variant.assignedShips, 0);
  const roundTripDays = weightedRoundTripDays / Math.max(1, totalShips);
  const fleetDailyFlightHours = modeled.reduce((total, item) => total + item.services.reduce(
    (sum, service) => sum + service.inVehicleHours * service.departuresPerWeek / 7, 0,
  ), 0);
  const dailyFlightHours = fleetDailyFlightHours / Math.max(1, totalShips);
  return { departuresPerWeek, roundTripDays, dailyFlightHours };
}
