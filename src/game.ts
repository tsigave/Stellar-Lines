import { simulateCampaign } from "./campaign.js";
import { applyEventsToPorts } from "./events.js";
import { buildRouteServices } from "./routes.js";
import type {
  CabinConfiguration,
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

export const GAME_STATE_VERSION = 6;
export const STARTING_CASH = 3_000_000;
export const ROUTE_OPENING_COST = 25_000;
export const DAILY_COMPANY_OVERHEAD = 700;
export const GAME_DEMAND_SCALE = 18;
export const CASH_GOAL = 3_750_000;
export const PASSENGER_GOAL = 4_000;
export const DEADLINE_DAY = 121;
export const MAINTENANCE_DUE_CONDITION = 40;
export const MAINTENANCE_REQUIRED_CONDITION = 20;
// 3,200 flight hours is roughly six calendar months for a highly utilized liner.
// Condition wear is aligned with the same interval so an 80% preventive policy
// no longer sends a healthy ship to maintenance every few weeks.
export const MAINTENANCE_DUE_HOURS = 3_200;
export const MAINTENANCE_REQUIRED_HOURS = 4_200;
export const CONDITION_WEAR_PER_FLIGHT_HOUR = 0.00625;
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
  configurationId: string | null;
}

export interface FleetConfiguration {
  id: string;
  shipTypeId: string;
  name: string;
  cabins: CabinConfiguration;
}

export const CABIN_SPACE_PER_SEAT: CabinConfiguration = {
  economy: 1,
  business: 3,
  premium: 6,
};

export function cabinSpaceUsed(cabins: CabinConfiguration): number {
  return cabins.economy * CABIN_SPACE_PER_SEAT.economy +
    cabins.business * CABIN_SPACE_PER_SEAT.business +
    cabins.premium * CABIN_SPACE_PER_SEAT.premium;
}

export function fleetConfigurationForShip(
  state: Pick<GameState, "fleetConfigurations">,
  ship: OwnedShip,
): FleetConfiguration | undefined {
  return ship.configurationId
    ? state.fleetConfigurations.find((configuration) => configuration.id === ship.configurationId)
    : undefined;
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
  fleetConfigurations: readonly FleetConfiguration[];
  routes: readonly Route[];
  history: readonly GameDayRecord[];
  fuelMarket: readonly FuelPriceRecord[];
  nextShipNumber: number;
  nextFleetConfigurationNumber: number;
  nextRouteNumber: number;
  status: GameStatus;
  primaryGoalCompletedOnDay: number | null;
  autoMaintenanceThreshold: number;
}

export interface CreateRouteInput {
  name: string;
  originPortId: string;
  destinationPortId: string;
  shipIds: readonly string[];
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

function shipsForRoute(state: GameState, routeId: string): OwnedShip[] {
  return state.fleet.filter((ship) => ship.routeId === routeId);
}

function operationalPlayerRoutes(state: GameState): Route[] {
  return state.routes.flatMap((route) => {
    if (!route.active) return [];
    const availableShips = shipsForRoute(state, route.id).filter((ship) => {
      const maintenance = shipMaintenanceState(ship, state.day);
      return maintenance !== "required" && maintenance !== "maintenance" &&
        !!fleetConfigurationForShip(state, ship);
    });
    if (availableShips.length === 0) return [];
    const configurations = availableShips.map((ship) => fleetConfigurationForShip(state, ship)!);
    const cabinCapacityByClass: CabinConfiguration = {
      economy: configurations.reduce((sum, configuration) => sum + configuration.cabins.economy, 0) / availableShips.length,
      business: configurations.reduce((sum, configuration) => sum + configuration.cabins.business, 0) / availableShips.length,
      premium: configurations.reduce((sum, configuration) => sum + configuration.cabins.premium, 0) / availableShips.length,
    };
    return [{
      ...route,
      assignedShips: availableShips.length,
      cabinCapacityByClass,
    }];
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
        configurationId: null,
      },
    ],
    fleetConfigurations: [],
    routes: [],
    history: [],
    fuelMarket: [fuelPriceRecord(galaxy, 1)],
    nextShipNumber: 2,
    nextFleetConfigurationNumber: 1,
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
    candidate.fleet.every((ship) =>
      !!ship &&
      typeof ship === "object" &&
      ((ship as Partial<OwnedShip>).configurationId === null ||
        typeof (ship as Partial<OwnedShip>).configurationId === "string")
    ) &&
    Array.isArray(candidate.fleetConfigurations) &&
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
    shipConditionByRoute: Object.fromEntries(state.routes.map((route) => {
      const ships = shipsForRoute(state, route.id);
      const averageCondition = ships.length > 0
        ? ships.reduce((sum, ship) => sum + ship.condition, 0) / ships.length
        : 100;
      return [route.id, averageCondition];
    })),
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
  quantity = 1,
): GameActionResult {
  requirePlaying(state);
  const shipType = shipTypes.find((candidate) => candidate.id === shipTypeId);
  if (!shipType) throw new Error("未知船型");
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
    throw new Error("单次购买数量必须是 1 至 20 艘");
  }
  const totalPrice = shipType.purchasePrice * quantity;
  if (state.cash < totalPrice) throw new Error("资金不足，无法购买所选舰船");
  const number = state.nextShipNumber;
  const purchasedShips: OwnedShip[] = Array.from({ length: quantity }, (_, index) => {
    const shipNumber = number + index;
    return {
      id: `ship-${shipNumber}`,
      name: `${shipType.name} ${shipNumber.toString().padStart(2, "0")}`,
      shipTypeId,
      routeId: null,
      condition: 100,
      flightHoursSinceMaintenance: 0,
      maintenanceUntilDay: null,
      configurationId: null,
    };
  });
  return {
    state: {
      ...state,
      cash: state.cash - totalPrice,
      fleet: [...state.fleet, ...purchasedShips],
      nextShipNumber: number + quantity,
    },
    message: `已购买 ${shipType.name} × ${quantity}；新船为空舱，请先配置舱位`,
  };
}

function normalizeFleetConfiguration(
  shipType: ShipType,
  cabins: CabinConfiguration,
): CabinConfiguration {
  if (Object.values(cabins).some((seats) => !Number.isFinite(seats) || seats < 0)) {
    throw new Error("舱位数量必须是非负有限数字");
  }
  const normalized: CabinConfiguration = {
    economy: Math.max(0, Math.floor(Number(cabins.economy))),
    business: Math.max(0, Math.floor(Number(cabins.business))),
    premium: Math.max(0, Math.floor(Number(cabins.premium))),
  };
  if (cabinSpaceUsed(normalized) > shipType.cabinSpace) {
    throw new Error(`舱位占用超过 ${shipType.cabinSpace} 个可用空间单位`);
  }
  if (cabinSpaceUsed(normalized) === 0) throw new Error("配置方案至少需要一个客舱座位");
  return normalized;
}

export function createFleetConfiguration(
  state: GameState,
  shipTypeId: string,
  name: string,
  cabins: CabinConfiguration,
  shipTypes: readonly ShipType[],
): GameActionResult {
  requirePlaying(state);
  const shipType = shipTypes.find((candidate) => candidate.id === shipTypeId);
  if (!shipType) throw new Error("船型数据不存在");
  const normalized = normalizeFleetConfiguration(shipType, cabins);
  const number = state.nextFleetConfigurationNumber;
  const configuration: FleetConfiguration = {
    id: `fleet-config-${number}`,
    shipTypeId,
    name: name.trim() || `${shipType.familyName}方案 ${number}`,
    cabins: normalized,
  };
  return {
    state: {
      ...state,
      fleetConfigurations: [...state.fleetConfigurations, configuration],
      nextFleetConfigurationNumber: number + 1,
    },
    message: `已创建 ${shipType.name} 的“${configuration.name}”配置方案`,
  };
}

export function updateFleetConfiguration(
  state: GameState,
  configurationId: string,
  name: string,
  cabins: CabinConfiguration,
  shipTypes: readonly ShipType[],
): GameActionResult {
  requirePlaying(state);
  const configuration = state.fleetConfigurations.find((candidate) => candidate.id === configurationId);
  if (!configuration) throw new Error("配置方案不存在");
  if (state.fleet.some((ship) => ship.configurationId === configurationId && ship.routeId)) {
    throw new Error("方案下仍有执行航线的舰船，不能修改");
  }
  const shipType = shipTypes.find((candidate) => candidate.id === configuration.shipTypeId);
  if (!shipType) throw new Error("船型数据不存在");
  const normalized = normalizeFleetConfiguration(shipType, cabins);
  const updated = {
    ...configuration,
    name: name.trim() || configuration.name,
    cabins: normalized,
  };
  return {
    state: {
      ...state,
      fleetConfigurations: state.fleetConfigurations.map((candidate) =>
        candidate.id === configurationId ? updated : candidate,
      ),
    },
    message: `配置方案“${updated.name}”已更新`,
  };
}

export function assignShipsToFleetConfiguration(
  state: GameState,
  configurationId: string,
  shipIds: readonly string[],
): GameActionResult {
  requirePlaying(state);
  const configuration = state.fleetConfigurations.find((candidate) => candidate.id === configurationId);
  if (!configuration) throw new Error("配置方案不存在");
  const uniqueShipIds = [...new Set(shipIds)];
  if (uniqueShipIds.length === 0) throw new Error("请至少选择一艘舰船");
  const ships = uniqueShipIds.map((shipId) => state.fleet.find((candidate) => candidate.id === shipId));
  if (ships.some((ship) => !ship)) throw new Error("舰船不存在");
  if (ships.some((ship) => ship!.shipTypeId !== configuration.shipTypeId)) {
    throw new Error("配置方案只能分配给完全相同的船型");
  }
  if (ships.some((ship) => ship!.routeId || shipMaintenanceState(ship!, state.day) === "maintenance")) {
    throw new Error("执行航线或维护中的舰船不能更换配置方案");
  }
  return {
    state: {
      ...state,
      fleet: state.fleet.map((ship) =>
        uniqueShipIds.includes(ship.id) ? { ...ship, configurationId } : ship,
      ),
    },
    message: `已将 ${uniqueShipIds.length} 艘舰船分配至“${configuration.name}”`,
  };
}

/** 兼容命令行与旧调用：创建一个方案并立即分配指定舰船。 */
export function configureShipCabins(
  state: GameState,
  shipId: string,
  cabins: CabinConfiguration,
  shipTypes: readonly ShipType[],
): GameActionResult {
  const ship = state.fleet.find((candidate) => candidate.id === shipId);
  if (!ship) throw new Error("舰船不存在");
  const created = createFleetConfiguration(
    state,
    ship.shipTypeId,
    `${ship.name} 标准方案`,
    cabins,
    shipTypes,
  );
  const configuration = created.state.fleetConfigurations.at(-1)!;
  return assignShipsToFleetConfiguration(created.state, configuration.id, [shipId]);
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
  if (concreteTypes.some((shipType) => shipType.id !== concreteTypes[0]!.id)) {
    throw new Error("同一航线只能分配相同船型的舰船");
  }
  if (concreteTypes.some((shipType) => !shipType.supportedModes.includes(input.routingMode))) {
    throw new Error(`所选船只必须全部安装${input.routingMode === "warp" ? "曲率" : "超空间"}引擎`);
  }
  const serviceSpeed = concreteTypes[0]!.speedByMode[input.routingMode];
  if (!serviceSpeed || concreteTypes.some((shipType) => shipType.speedByMode[input.routingMode] !== serviceSpeed)) {
    throw new Error("同一航线只能分配推进方式与航行速度相同的船只");
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
    pricing: routePricing(Math.max(0.65, Math.min(1.8, input.fareMultiplier))),
    maintenanceAllowanceHours: 0,
    active: true,
  };
  for (const selectedType of concreteTypes) {
    buildRouteServices(
      { ...route, shipTypeId: selectedType.id, assignedShips: 1 },
      selectedType,
      galaxy.ports,
      gameWorldLegs(galaxy),
    );
  }
  return {
    state: {
      ...state,
      cash: state.cash - ROUTE_OPENING_COST,
      routes: [...state.routes, route],
      fleet: state.fleet.map((candidate) =>
        selectedShipIds.includes(candidate.id) ? { ...candidate, routeId: route.id } : candidate,
      ),
      nextRouteNumber: number + 1,
    },
    message: `航线“${route.name}”已开通，已分配 ${selectedShips.length} 艘船`,
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
  const fleetDailyFlightHours = services.reduce(
    (sum, service) => sum + service.inVehicleHours * service.departuresPerWeek / 7,
    0,
  );
  const dailyFlightHours = fleetDailyFlightHours / Math.max(1, route.assignedShips);
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
      condition: Math.max(0, ship.condition - flightHours * CONDITION_WEAR_PER_FLIGHT_HOUR),
      flightHoursSinceMaintenance: ship.flightHoursSinceMaintenance + flightHours,
    };
  });
}

export interface FleetFixedMaintenanceSummary {
  total: number;
  undiscountedTotal: number;
  supplierDiscount: number;
  familyDiscount: number;
}

export function fleetFixedMaintenanceCost(
  fleet: readonly OwnedShip[],
  shipTypes: readonly ShipType[],
): FleetFixedMaintenanceSummary {
  const typeById = new Map(shipTypes.map((shipType) => [shipType.id, shipType]));
  const supplierCounts = new Map<string, number>();
  const familyCounts = new Map<string, number>();
  for (const ship of fleet) {
    const type = typeById.get(ship.shipTypeId);
    if (!type) continue;
    supplierCounts.set(type.manufacturer, (supplierCounts.get(type.manufacturer) ?? 0) + 1);
    familyCounts.set(type.familyId, (familyCounts.get(type.familyId) ?? 0) + 1);
  }
  let total = 0;
  let undiscountedTotal = 0;
  let supplierSavings = 0;
  let familySavings = 0;
  for (const ship of fleet) {
    const type = typeById.get(ship.shipTypeId);
    if (!type) continue;
    const base = type.fixedMaintenanceCostPerDay;
    const supplierDiscount = Math.min(0.18, Math.max(0, (supplierCounts.get(type.manufacturer) ?? 1) - 1) * 0.015);
    const familyDiscount = Math.min(0.22, Math.max(0, (familyCounts.get(type.familyId) ?? 1) - 1) * 0.025);
    const afterSupplier = base * (1 - supplierDiscount);
    const discounted = afterSupplier * (1 - familyDiscount);
    undiscountedTotal += base;
    supplierSavings += base - afterSupplier;
    familySavings += afterSupplier - discounted;
    total += discounted;
  }
  return {
    total: Number(total.toFixed(2)),
    undiscountedTotal: Number(undiscountedTotal.toFixed(2)),
    supplierDiscount: Number(supplierSavings.toFixed(2)),
    familyDiscount: Number(familySavings.toFixed(2)),
  };
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
  const fixedMaintenance = fleetFixedMaintenanceCost(state.fleet, baseScenario.shipTypes);
  const overhead = DAILY_COMPANY_OVERHEAD + fixedMaintenance.total;
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
    state.routes,
    scenario,
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
      ? `${automaticMaintenance.maintainedShipNames.join("、")} 返抵主基地，维护值已低于 ${state.autoMaintenanceThreshold}% 阈值并自动进场维护。`
      : justCompletedGoal
      ? "初级经营目标达成！公司进入自由经营阶段，游戏将继续进行。"
      : lost
        ? "公司未能维持经营，本局结束。"
        : `第 ${state.day} 日结算完成：${profit >= 0 ? "盈利" : "亏损"} ${Math.abs(profit).toFixed(0)} Cr`,
  };
}
