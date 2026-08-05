import { simulateCampaign } from "./campaign.js";
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
  WorldLeg,
} from "./types.js";

export const GAME_STATE_VERSION = 1;
export const STARTING_CASH = 3_000_000;
export const ROUTE_OPENING_COST = 25_000;
export const DAILY_COMPANY_OVERHEAD = 700;
export const GAME_DEMAND_SCALE = 16;
export const CASH_GOAL = 3_750_000;
export const PASSENGER_GOAL = 4_500;
export const DEADLINE_DAY = 121;

export interface OwnedShip {
  id: string;
  name: string;
  shipTypeId: string;
  routeId: string | null;
}

export interface GameRouteDaySummary {
  routeId: string;
  passengers: number;
  revenue: number;
  cost: number;
  loadFactor: number;
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

export type GameStatus = "playing" | "won" | "lost";

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
  nextShipNumber: number;
  nextRouteNumber: number;
  status: GameStatus;
}

export interface CreateRouteInput {
  name: string;
  originPortId: string;
  destinationPortId: string;
  shipId: string;
  fareMultiplier: number;
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

export function createNewGame(
  config: GalaxyGenerationConfig,
  galaxy: GeneratedGalaxy,
): GameState {
  const basePort = galaxy.ports[0];
  if (!basePort) throw new Error("可玩星域至少需要一个星港");
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
      },
    ],
    routes: [],
    history: [],
    nextShipNumber: 2,
    nextRouteNumber: 1,
    status: "playing",
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
    Array.isArray(candidate.history)
  );
}

export function gameScenario(
  baseScenario: SimulationScenario,
  galaxy: GeneratedGalaxy,
  state: GameState,
): SimulationScenario {
  return {
    ...baseScenario,
    ports: baseScenario.ports.map((port) => ({
      ...port,
      population: port.population * GAME_DEMAND_SCALE,
    })),
    routes: [
      ...baseScenario.routes.filter((route) => route.companyId !== "player"),
      ...state.routes,
    ],
    events: createGeneratedGameEvents(galaxy),
  };
}

function requirePlaying(state: GameState): void {
  if (state.status !== "playing") throw new Error("本局已经结束，请开始新游戏");
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
  ports: readonly Starport[],
  worldLegs: readonly WorldLeg[],
  shipTypes: readonly ShipType[],
): GameActionResult {
  requirePlaying(state);
  if (input.originPortId === input.destinationPortId) throw new Error("起点和终点不能相同");
  if (state.cash < ROUTE_OPENING_COST) throw new Error("资金不足，无法支付航线开办费");
  const ship = state.fleet.find((candidate) => candidate.id === input.shipId);
  if (!ship || ship.routeId) throw new Error("请选择一艘可用船只");
  const shipType = shipTypes.find((candidate) => candidate.id === ship.shipTypeId);
  if (!shipType) throw new Error("船型数据不存在");
  const number = state.nextRouteNumber;
  const route: Route = {
    id: `player-route-${number}`,
    companyId: "player",
    name: input.name.trim() || `远星航线 ${number}`,
    kind: "return",
    stops: [input.originPortId, input.destinationPortId].map((portId) => ({
      portId,
      stopType: "commercial" as const,
      minimumStopHours: 1,
    })),
    shipTypeId: shipType.id,
    assignedShips: 1,
    pricing: routePricing(Math.max(0.65, Math.min(1.8, input.fareMultiplier))),
    maintenanceAllowanceHours: 2,
    active: true,
  };
  buildRouteServices(route, shipType, ports, worldLegs);
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
    message: `已关闭“${route.name}”，船只已返还舰队`,
  };
}

function routeSummaries(state: GameState, campaignDay: CampaignDay): GameRouteDaySummary[] {
  return state.routes.map((route) => {
    const services = campaignDay.settlement.services.filter((service) =>
      service.serviceLegId.startsWith(`${route.id}:`),
    );
    const capacity = services.reduce((sum, service) => sum + service.capacity, 0);
    const passengers = services.reduce((sum, service) => sum + service.passengers, 0);
    return {
      routeId: route.id,
      passengers,
      revenue: services.reduce((sum, service) => sum + service.ticketRevenue, 0),
      cost: services.reduce((sum, service) => sum + service.operatingCost, 0),
      loadFactor: capacity > 0 ? passengers / capacity : 0,
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
  const won = cash >= CASH_GOAL || totalPassengers >= PASSENGER_GOAL;
  const lost = cash < 0 || (!won && nextDay >= DEADLINE_DAY);
  const record: GameDayRecord = {
    day: state.day,
    cash,
    revenue,
    operatingCost,
    overhead,
    profit,
    passengers,
    activeEventIds: campaignDay.activeEventIds,
    announcedEventIds: campaignDay.announcedEventIds,
    routes: routeSummaries(state, campaignDay),
  };
  const status: GameStatus = won ? "won" : lost ? "lost" : "playing";
  return {
    state: {
      ...state,
      day: nextDay,
      cash,
      history: [...state.history, record].slice(-180),
      status,
    },
    message:
      status === "won"
        ? "经营目标达成！远星航运已站稳脚跟。"
        : status === "lost"
          ? "公司未能维持经营，本局结束。"
          : `第 ${state.day} 日结算完成：${profit >= 0 ? "盈利" : "亏损"} ${Math.abs(profit).toFixed(0)} Cr`,
  };
}
