import { simulateCampaign } from "./campaign.js";
import { applyEventsToPorts } from "./events.js";
import { buildRouteServices } from "./routes.js";
import type {
  CampaignDay,
  GeneratedGalaxy,
  GalaxyGenerationConfig,
  MarketEvent,
  Route,
  ShipType,
  SimulationScenario,
  Starport,
  TravelMode,
  WorldLeg,
} from "./types.js";

export const GAME_STATE_VERSION = 3;
export const STARTING_CASH = 3_000_000;
export const ROUTE_OPENING_COST = 25_000;
export const DAILY_COMPANY_OVERHEAD = 700;
export const GAME_DEMAND_SCALE = 18;
export const CASH_GOAL = 3_750_000;
export const PASSENGER_GOAL = 4_000;
export const DEADLINE_DAY = 121;
export const MAINTENANCE_DUE_CONDITION = 40;
export const MAINTENANCE_REQUIRED_CONDITION = 20;
export const MAINTENANCE_DUE_HOURS = 120;
export const MAINTENANCE_REQUIRED_HOURS = 160;
export const MAINTENANCE_DAYS = 3;
export const DEFAULT_AUTO_MAINTENANCE_THRESHOLD = 80;

export type PlayerRoutingMode = Extract<TravelMode, "warp" | "hyperspace">;
export type ShipMaintenanceState = "ready" | "due" | "required" | "maintenance";

export interface OwnedShip {
  id: string;
  name: string;
  shipTypeId: string;
  routeId: string | null;
  condition: number;
  flightHoursSinceMaintenance: number;
  maintenanceUntilDay: number | null;
}

export interface FuelPriceRecord {
  day: number;
  prices: Readonly<Record<string, number>>;
}

export interface GameRouteDaySummary {
  routeId: string;
  passengers: number;
  revenue: number;
  cost: number;
  loadFactor: number;
  departuresPerWeek: number;
  roundTripDays: number;
  satisfaction: number;
}

export interface GameDayRecord {
  day: number;
  cash: number;
  revenue: number;
  operatingCost: number;
  overhead: number;
  profit: number;
  passengers: number;
  activeEventIds: readonly string[];
  announcedEventIds: readonly string[];
  routes: readonly GameRouteDaySummary[];
}

export type GameStatus = "playing" | "lost";

export interface GameState {
  version: typeof GAME_STATE_VERSION;
  config: GalaxyGenerationConfig;
  companyName: string;
  day: number;
  cash: number;
  basePortId: string;
  fleet: readonly OwnedShip[];
  routes: readonly Route[];
  history: readonly GameDayRecord[];
  fuelMarket: readonly FuelPriceRecord[];
  nextShipNumber: number;
  nextRouteNumber: number;
  status: GameStatus;
  primaryGoalCompletedOnDay: number | null;
  autoMaintenanceThreshold: number;
}

export interface CreateRouteInput {
  name: string;
  originPortId: string;
  destinationPortId: string;
  shipId: string;
  fareMultiplier: number;
  routingMode: PlayerRoutingMode;
}

export interface GameActionResult {
  state: GameState;
  message: string;
}

function copyConfig(config: GalaxyGenerationConfig): GalaxyGenerationConfig {
  return { ...config };
}

function hash(value: string): number {
  let result = 2166136261;
  for (const character of value) {
    result = Math.imul(result ^ character.charCodeAt(0), 16777619);
  }
  return result >>> 0;
}

export function createGeneratedGameEvents(galaxy: GeneratedGalaxy): MarketEvent[] {
  const ports = [...galaxy.ports].sort(
    (left, right) => hash(`${galaxy.config.seed}:${left.id}`) - hash(`${galaxy.config.seed}:${right.id}`),
  );
  if (ports.length === 0) return [];
  const first = ports[0]!;
  const second = ports[1] ?? first;
  const third = ports[2] ?? second;
  return [
    {
      id: "v0-trade-fair",
      name: `${first.name} 星际贸易博览会`,
      description: "商务与高端出行需求短期上升。",
      announcedOnDay: 8,
      startsOnDay: 15,
      endsOnDay: 27,
      recoveryDays: 5,
      affectedPortIds: [first.id],
      demandModifiers: { economy: 1.18, business: 2.1, premium: 1.65 },
      portCapacityModifier: 0.9,
    },
    {
      id: "v0-fuel-shock",
      name: `${second.name} 燃料供应紧张`,
      description: "当地燃料价格上涨，途经航线成本增加。",
      announcedOnDay: 34,
      startsOnDay: 42,
      endsOnDay: 55,
      recoveryDays: 8,
      affectedPortIds: [second.id],
      demandModifiers: { business: 0.92, premium: 0.94 },
      fuelPriceModifier: 1.75,
    },
    {
      id: "v0-settlement-wave",
      name: `${third.name} 殖民迁徙潮`,
      description: "新一轮定居计划带来持续客流。",
      announcedOnDay: 67,
      startsOnDay: 76,
      endsOnDay: 98,
      recoveryDays: 12,
      affectedPortIds: [third.id],
      demandModifiers: { economy: 1.9, business: 1.35, premium: 1.12 },
    },
  ];
}

function dynamicFuelPrice(port: Starport, seed: string, day: number): number {
  const portHash = hash(`${seed}:fuel:${port.id}`);
  const phaseA = (portHash % 6283) / 1000;
  const phaseB = ((portHash >>> 7) % 6283) / 1000;
  const variation =
    1 +
    0.09 * Math.sin(day / 6.5 + phaseA) +
    0.055 * Math.sin(day / 21 + phaseB) +
    0.025 * Math.sin(day / 2.7 + phaseA / 2);
  return Number(Math.max(0.7, port.fuelPrice * variation).toFixed(3));
}

function dynamicFuelPorts(galaxy: GeneratedGalaxy, day: number): Starport[] {
  return galaxy.ports.map((port) => ({
    ...port,
    fuelPrice: dynamicFuelPrice(port, galaxy.config.seed, day),
  }));
}

export function fuelPriceRecord(galaxy: GeneratedGalaxy, day: number): FuelPriceRecord {
  const eventAdjusted = applyEventsToPorts(
    dynamicFuelPorts(galaxy, day),
    createGeneratedGameEvents(galaxy),
    day,
  );
  return {
    day,
    prices: Object.fromEntries(eventAdjusted.map((port) => [port.id, port.fuelPrice])),
  };
}

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

export function shipMaintenanceState(ship: OwnedShip, day: number): ShipMaintenanceState {
  if (ship.maintenanceUntilDay !== null && ship.maintenanceUntilDay > day) return "maintenance";
  if (
    ship.condition <= MAINTENANCE_REQUIRED_CONDITION ||
    ship.flightHoursSinceMaintenance >= MAINTENANCE_REQUIRED_HOURS
  ) return "required";
  if (
    ship.condition <= MAINTENANCE_DUE_CONDITION ||
    ship.flightHoursSinceMaintenance >= MAINTENANCE_DUE_HOURS
  ) return "due";
  return "ready";
}

export function shipMaintenanceCost(shipType: ShipType): number {
  return Math.max(15_000, Math.round(shipType.purchasePrice * 0.0125));
}

function shipForRoute(state: GameState, routeId: string): OwnedShip | undefined {
  return state.fleet.find((ship) => ship.routeId === routeId);
}

function operationalPlayerRoutes(state: GameState): Route[] {
  return state.routes.filter((route) => {
    const ship = shipForRoute(state, route.id);
    return route.active && !!ship && shipMaintenanceState(ship, state.day) !== "required" && shipMaintenanceState(ship, state.day) !== "maintenance";
  });
}

export function createNewGame(
  config: GalaxyGenerationConfig,
  galaxy: GeneratedGalaxy,
  basePortId: string,
): GameState {
  const basePort = galaxy.ports.find((port) => port.id === basePortId);
  if (!basePort) throw new Error("请选择一个有效的基地星球");
  return {
    version: GAME_STATE_VERSION,
    config: copyConfig(config),
    companyName: "远星航运",
    day: 1,
    cash: STARTING_CASH,
    basePortId: basePort.id,
    fleet: [
      {
        id: "ship-1",
        name: "远星一号",
        shipTypeId: "meridian-liner",
        routeId: null,
        condition: 100,
        flightHoursSinceMaintenance: 0,
        maintenanceUntilDay: null,
      },
    ],
    routes: [],
    history: [],
    fuelMarket: [fuelPriceRecord(galaxy, 1)],
    nextShipNumber: 2,
    nextRouteNumber: 1,
    status: "playing",
    primaryGoalCompletedOnDay: null,
    autoMaintenanceThreshold: DEFAULT_AUTO_MAINTENANCE_THRESHOLD,
  };
}

export function isGameState(value: unknown): value is GameState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<GameState>;
  return (
    candidate.version === GAME_STATE_VERSION &&
    Number.isInteger(candidate.day) &&
    typeof candidate.cash === "number" &&
    !!candidate.config &&
    Array.isArray(candidate.fleet) &&
    Array.isArray(candidate.routes) &&
    Array.isArray(candidate.history) &&
    Array.isArray(candidate.fuelMarket) &&
    typeof candidate.autoMaintenanceThreshold === "number"
  );
}

export function gameScenario(
  baseScenario: SimulationScenario,
  galaxy: GeneratedGalaxy,
  state: GameState,
): SimulationScenario {
  const dynamicPorts = dynamicFuelPorts(galaxy, state.day).map((port) => ({
    ...port,
    population: port.population * GAME_DEMAND_SCALE,
  }));
  return {
    ...baseScenario,
    ports: dynamicPorts,
    worldLegs: gameWorldLegs(galaxy),
    routes: [
      ...baseScenario.routes.filter((route) => route.companyId !== "player"),
      ...operationalPlayerRoutes(state),
    ],
    shipConditionByRoute: Object.fromEntries(
      state.fleet.filter((ship) => ship.routeId).map((ship) => [ship.routeId!, ship.condition]),
    ),
    events: createGeneratedGameEvents(galaxy),
  };
}

function requirePlaying(state: GameState): void {
  if (state.status !== "playing") throw new Error("公司已经破产，请开始新游戏");
}

export function buyShip(
  state: GameState,
  shipTypeId: string,
  shipTypes: readonly ShipType[],
): GameActionResult {
  requirePlaying(state);
  const shipType = shipTypes.find((candidate) => candidate.id === shipTypeId);
  if (!shipType) throw new Error("未知船型");
  if (state.cash < shipType.purchasePrice) throw new Error("资金不足，无法购买该船型");
  const number = state.nextShipNumber;
  return {
    state: {
      ...state,
      cash: state.cash - shipType.purchasePrice,
      fleet: [
        ...state.fleet,
        {
          id: `ship-${number}`,
          name: `${shipType.name} ${number.toString().padStart(2, "0")}`,
          shipTypeId,
          routeId: null,
          condition: 100,
          flightHoursSinceMaintenance: 0,
          maintenanceUntilDay: null,
        },
      ],
      nextShipNumber: number + 1,
    },
    message: `已购买 ${shipType.name}`,
  };
}

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
  const ship = state.fleet.find((candidate) => candidate.id === input.shipId);
  if (!ship || ship.routeId) throw new Error("请选择一艘可用船只");
  if (shipMaintenanceState(ship, state.day) !== "ready" && shipMaintenanceState(ship, state.day) !== "due") {
    throw new Error("该船正在维护或已被强制停航");
  }
  const shipType = shipTypes.find((candidate) => candidate.id === ship.shipTypeId);
  if (!shipType) throw new Error("船型数据不存在");
  if (!shipType.supportedModes.includes(input.routingMode)) {
    throw new Error(`${shipType.name} 没有安装${input.routingMode === "warp" ? "曲率" : "超空间"}引擎`);
  }
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
      minimumStopHours: 24,
    })),
    shipTypeId: shipType.id,
    assignedShips: 1,
    pricing: routePricing(Math.max(0.65, Math.min(1.8, input.fareMultiplier))),
    maintenanceAllowanceHours: 0,
    active: true,
  };
  buildRouteServices(route, shipType, galaxy.ports, gameWorldLegs(galaxy));
  return {
    state: {
      ...state,
      cash: state.cash - ROUTE_OPENING_COST,
      routes: [...state.routes, route],
      fleet: state.fleet.map((candidate) =>
        candidate.id === ship.id ? { ...candidate, routeId: route.id } : candidate,
      ),
      nextRouteNumber: number + 1,
    },
    message: `航线“${route.name}”已开通`,
  };
}

export function performShipMaintenance(
  state: GameState,
  shipId: string,
  shipTypes: readonly ShipType[],
): GameActionResult {
  requirePlaying(state);
  const ship = state.fleet.find((candidate) => candidate.id === shipId);
  if (!ship) throw new Error("船只不存在");
  if (shipMaintenanceState(ship, state.day) === "maintenance") throw new Error("该船已经在维护中");
  const shipType = shipTypes.find((candidate) => candidate.id === ship.shipTypeId);
  if (!shipType) throw new Error("船型数据不存在");
  const cost = shipMaintenanceCost(shipType);
  if (state.cash < cost) throw new Error("资金不足，无法安排维护");
  return {
    state: {
      ...state,
      cash: state.cash - cost,
      fleet: state.fleet.map((candidate) =>
        candidate.id === shipId
          ? {
              ...candidate,
              condition: 100,
              flightHoursSinceMaintenance: 0,
              maintenanceUntilDay: state.day + MAINTENANCE_DAYS,
            }
          : candidate,
      ),
    },
    message: `${ship.name} 已进场维护，将在第 ${state.day + MAINTENANCE_DAYS} 日恢复`,
  };
}

export function setAutoMaintenanceThreshold(
  state: GameState,
  threshold: number,
): GameActionResult {
  requirePlaying(state);
  const normalized = Math.max(30, Math.min(95, Math.round(threshold)));
  return {
    state: { ...state, autoMaintenanceThreshold: normalized },
    message: `自动维修阈值已设为 ${normalized}%`,
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

export function closePlayerRoute(state: GameState, routeId: string): GameActionResult {
  requirePlaying(state);
  const route = state.routes.find((candidate) => candidate.id === routeId);
  if (!route) throw new Error("航线不存在");
  return {
    state: {
      ...state,
      routes: state.routes.filter((candidate) => candidate.id !== routeId),
      fleet: state.fleet.map((ship) =>
        ship.routeId === routeId ? { ...ship, routeId: null } : ship,
      ),
    },
    message: `已关闭“${route.name}”，船只已返还基地`,
  };
}

function routeSchedule(route: Route, scenario: SimulationScenario): { departuresPerWeek: number; roundTripDays: number; dailyFlightHours: number } {
  const shipType = scenario.shipTypes.find((ship) => ship.id === route.shipTypeId);
  if (!shipType) return { departuresPerWeek: 0, roundTripDays: 0, dailyFlightHours: 0 };
  const services = buildRouteServices(
    { ...route, active: true },
    shipType,
    scenario.ports,
    scenario.worldLegs,
  );
  const departuresPerWeek = services[0]?.departuresPerWeek ?? 0;
  const roundTripDays = departuresPerWeek > 0
    ? (7 * route.assignedShips * shipType.operationalAvailability) / departuresPerWeek
    : 0;
  const dailyFlightHours = services.reduce(
    (sum, service) => sum + service.inVehicleHours * service.departuresPerWeek / 7,
    0,
  );
  return { departuresPerWeek, roundTripDays, dailyFlightHours };
}

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
    return {
      routeId: route.id,
      passengers,
      revenue: services.reduce((sum, service) => sum + service.ticketRevenue, 0),
      cost: services.reduce((sum, service) => sum + service.operatingCost, 0),
      loadFactor: capacity > 0 ? passengers / capacity : 0,
      departuresPerWeek: schedule.departuresPerWeek,
      roundTripDays: schedule.roundTripDays,
      satisfaction,
    };
  });
}

function applyAutomaticMaintenance(
  fleet: readonly OwnedShip[],
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
  const operationalRouteIds = new Set(
    scenario.routes.filter((route) => route.companyId === "player").map((route) => route.id),
  );
  return state.fleet.map((ship) => {
    if (ship.maintenanceUntilDay !== null) {
      return state.day + 1 >= ship.maintenanceUntilDay
        ? { ...ship, maintenanceUntilDay: null }
        : ship;
    }
    if (!ship.routeId || !operationalRouteIds.has(ship.routeId)) return ship;
    const route = state.routes.find((candidate) => candidate.id === ship.routeId);
    if (!route) return ship;
    const flightHours = routeSchedule(route, scenario).dailyFlightHours;
    return {
      ...ship,
      condition: Math.max(0, ship.condition - flightHours * 0.16),
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
  const scenario = gameScenario(baseScenario, galaxy, state);
  const campaignDay = simulateCampaign(scenario, {
    startDay: state.day,
    numberOfDays: 1,
  }).days[0]!;
  const company = campaignDay.settlement.companies.find(
    (candidate) => candidate.companyId === "player",
  );
  const revenue = company?.ticketRevenue ?? 0;
  const operatingCost = company?.operatingCost ?? 0;
  const overhead = DAILY_COMPANY_OVERHEAD + state.fleet.length * 250;
  const profit = revenue - operatingCost - overhead;
  const cash = state.cash + profit;
  const passengers = company?.passengers ?? 0;
  const totalPassengers =
    state.history.reduce((sum, record) => sum + record.passengers, 0) + passengers;
  const nextDay = state.day + 1;
  const justCompletedGoal =
    state.primaryGoalCompletedOnDay === null &&
    (cash >= CASH_GOAL || totalPassengers >= PASSENGER_GOAL);
  const primaryGoalCompletedOnDay = justCompletedGoal
    ? state.day
    : state.primaryGoalCompletedOnDay;
  const lost = cash < 0 || (primaryGoalCompletedOnDay === null && nextDay >= DEADLINE_DAY);
  const agedFleet = ageFleetAfterDay(state, scenario);
  const automaticMaintenance = applyAutomaticMaintenance(
    agedFleet,
    nextDay,
    cash,
    state.autoMaintenanceThreshold,
    baseScenario.shipTypes,
  );
  const finalCash = automaticMaintenance.cash;
  const record: GameDayRecord = {
    day: state.day,
    cash: finalCash,
    revenue,
    operatingCost,
    overhead,
    profit: profit - automaticMaintenance.cost,
    passengers,
    activeEventIds: campaignDay.activeEventIds,
    announcedEventIds: campaignDay.announcedEventIds,
    routes: routeSummaries(state, campaignDay, scenario),
  };
  return {
    state: {
      ...state,
      day: nextDay,
      cash: finalCash,
      fleet: automaticMaintenance.fleet,
      history: [...state.history, record].slice(-365),
      fuelMarket: [...state.fuelMarket, fuelPriceRecord(galaxy, nextDay)].slice(-365),
      status: finalCash < 0 || lost ? "lost" : "playing",
      primaryGoalCompletedOnDay,
    },
    message: automaticMaintenance.maintainedShipNames.length > 0
      ? `${automaticMaintenance.maintainedShipNames.join("、")} 已达到 ${state.autoMaintenanceThreshold}% 阈值并自动进场维护。`
      : justCompletedGoal
      ? "初级经营目标达成！公司进入自由经营阶段，游戏将继续进行。"
      : lost
        ? "公司未能维持经营，本局结束。"
        : `第 ${state.day} 日结算完成：${profit >= 0 ? "盈利" : "亏损"} ${Math.abs(profit).toFixed(0)} Cr`,
  };
}
