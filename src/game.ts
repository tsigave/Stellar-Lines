import { simulateCampaign } from "./campaign.js";
import { explainJourneyChoice } from "./choice.js";
import { PASSENGER_CLASSES, PASSENGER_TYPES } from "./types.js";
import { applyEventsToPorts } from "./events.js";
import { buildRouteServices } from "./routes.js";
import { createRandom } from "./generation/random.js";
import { FIXED_MAINTENANCE_COST_SCALE } from "./parameters.js";
import type {
  CabinConfiguration,
  CampaignDay,
  GeneratedGalaxy,
  GalaxyGenerationConfig,
  MarketEvent,
  PassengerEvaluation,
  PassengerType,
  Route,
  RouteCostBreakdown,
  ShipType,
  SimulationScenario,
  Starport,
  TravelMode,
  WorldLeg,
} from "./types.js";

export const GAME_STATE_VERSION = 9;
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
export const DAYS_PER_SHIP_YEAR = 360;
export const SHIP_AGE_MAINTENANCE_RATE = 0.06;
export const SHIP_AGE_COMFORT_LOSS_PER_YEAR = 1.5;

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
  commissionedDay: number;
  purchasePricePaid: number;
}

export interface ShipyardMarketOffer {
  shipTypeId: string;
  popularity: number;
  discountRate: number;
  inventory: number;
  updatedDay: number;
}

export interface ShipPurchaseOrder {
  id: string;
  agreementId: string;
  shipTypeId: string;
  quantity: number;
  unitPrice: number;
  marketDiscountRate: number;
  agreementDiscountRate: number;
  orderedDay: number;
  deliveryDay: number;
  /** Automatic renewal orders pair each delivered ship with one existing ship. */
  replacementShipIds?: readonly string[];
}

export interface ShipPurchaseLineInput {
  shipTypeId: string;
  quantity: number;
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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function shipAgeYears(ship: OwnedShip, day: number): number {
  return Math.max(0, day - ship.commissionedDay) / DAYS_PER_SHIP_YEAR;
}

export function shipComfortAtAge(ship: OwnedShip, shipType: ShipType, day: number): number {
  return Math.max(35, shipType.comfort - shipAgeYears(ship, day) * SHIP_AGE_COMFORT_LOSS_PER_YEAR);
}

export function shipResaleValue(ship: OwnedShip, shipType: ShipType, day: number): number {
  const ageValue = Math.max(0.12, 0.68 - shipAgeYears(ship, day) * 0.045);
  const conditionValue = 0.55 + clamp(ship.condition, 0, 100) / 100 * 0.45;
  return Math.round(shipType.purchasePrice * ageValue * conditionValue);
}

function marketOffer(seed: string, shipTypeId: string, day: number): ShipyardMarketOffer {
  const random = createRandom(`${seed}:shipyard:${shipTypeId}:${Math.floor(day / 7)}`);
  const popularity = Number((0.18 + random.next() * 0.78).toFixed(4));
  const clearanceChance = 0.16 + (1 - popularity) * 0.58;
  const discountRate = random.next() < clearanceChance
    ? Number(clamp(0.04 + (1 - popularity) * 0.18 + random.next() * 0.06, 0, 0.28).toFixed(2))
    : 0;
  const inventory = random.next() < 0.1 + (1 - popularity) * 0.62
    ? random.integer(1, popularity < 0.4 ? 4 : 2)
    : 0;
  return { shipTypeId, popularity, discountRate, inventory, updatedDay: day };
}

export function createShipyardMarket(
  seed: string,
  shipTypes: readonly ShipType[],
  day = 1,
): ShipyardMarketOffer[] {
  return shipTypes.map((shipType) => marketOffer(seed, shipType.id, day));
}

export function shipyardOfferFor(
  state: Pick<GameState, "config" | "day" | "shipyardMarket">,
  shipType: ShipType,
): ShipyardMarketOffer {
  return state.shipyardMarket.find((offer) => offer.shipTypeId === shipType.id) ??
    marketOffer(state.config.seed, shipType.id, state.day);
}

export function purchaseAgreementDiscount(totalShips: number): number {
  if (totalShips >= 15) return 0.1;
  if (totalShips >= 10) return 0.08;
  if (totalShips >= 6) return 0.06;
  if (totalShips >= 4) return 0.04;
  if (totalShips >= 2) return 0.02;
  return 0;
}

export interface ShipPurchaseAgreementQuoteLine extends ShipPurchaseLineInput {
  listUnitPrice: number;
  unitPrice: number;
  marketDiscountRate: number;
  agreementDiscountRate: number;
  inventoryUsed: number;
  deliveryDay: number;
}

export interface ShipPurchaseAgreementQuote {
  lines: readonly ShipPurchaseAgreementQuoteLine[];
  totalShips: number;
  listPrice: number;
  totalPrice: number;
  agreementDiscountRate: number;
}

export function quoteShipPurchaseAgreement(
  state: GameState,
  requestedLines: readonly ShipPurchaseLineInput[],
  shipTypes: readonly ShipType[],
): ShipPurchaseAgreementQuote {
  const quantitiesByType = new Map<string, number>();
  for (const line of requestedLines) {
    quantitiesByType.set(line.shipTypeId, (quantitiesByType.get(line.shipTypeId) ?? 0) + line.quantity);
  }
  const lines = [...quantitiesByType].map(([shipTypeId, quantity]) => ({ shipTypeId, quantity }))
    .filter((line) => line.quantity > 0);
  const totalShips = lines.reduce((sum, line) => sum + line.quantity, 0);
  if (totalShips < 1 || totalShips > 60) throw new Error("单份采购协议必须包含 1 至 60 艘舰船");
  const agreementDiscountRate = purchaseAgreementDiscount(totalShips);
  const quotedLines = lines.map((line) => {
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 20) {
      throw new Error("每个型号的采购数量必须是 1 至 20 艘");
    }
    const shipType = shipTypes.find((candidate) => candidate.id === line.shipTypeId);
    if (!shipType) throw new Error("采购协议包含未知船型");
    const offer = shipyardOfferFor(state, shipType);
    const inventoryUsed = Math.min(offer.inventory, line.quantity);
    const factoryQuantity = line.quantity - inventoryUsed;
    const manufacturingDays = factoryQuantity === 0
      ? 1
      : Math.ceil(8 + shipType.structuralMassTonnes / 95 + offer.popularity * 32 + factoryQuantity * 1.6);
    const unitPrice = Math.round(shipType.purchasePrice * (1 - offer.discountRate) * (1 - agreementDiscountRate));
    return {
      ...line,
      listUnitPrice: shipType.purchasePrice,
      unitPrice,
      marketDiscountRate: offer.discountRate,
      agreementDiscountRate,
      inventoryUsed,
      deliveryDay: state.day + manufacturingDays,
    };
  });
  return {
    lines: quotedLines,
    totalShips,
    listPrice: quotedLines.reduce((sum, line) => sum + line.listUnitPrice * line.quantity, 0),
    totalPrice: quotedLines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0),
    agreementDiscountRate,
  };
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
  profit: number;
  margin: number;
  onTimeRate: number;
  capacityByClass: CabinConfiguration;
  passengersByClass: CabinConfiguration;
  loadFactorByClass: CabinConfiguration;
  revenueByClass: CabinConfiguration;
  passengersByType: Record<PassengerType, number>;
  requestedByType: Record<PassengerType, number>;
  noTravelByType: Record<PassengerType, number>;
  capacityLostByType: Record<PassengerType, number>;
  priceLostPassengers: number;
  capacityLostPassengers: number;
  costBreakdown: RouteCostBreakdown;
  directions: Readonly<Record<"outbound" | "return", {
    capacityByClass: CabinConfiguration;
    passengersByClass: CabinConfiguration;
    loadFactorByClass: CabinConfiguration;
  }>>;
  evaluations: readonly PassengerEvaluation[];
  warnings: readonly string[];
  forecastPassengers: number;
  forecastProfit: number;
  forecastPassengerError: number;
  forecastProfitError: number;
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
  shipyardMarket: readonly ShipyardMarketOffer[];
  shipPurchaseOrders: readonly ShipPurchaseOrder[];
  routes: readonly Route[];
  history: readonly GameDayRecord[];
  fuelMarket: readonly FuelPriceRecord[];
  nextShipNumber: number;
  nextFleetConfigurationNumber: number;
  nextPurchaseAgreementNumber: number;
  nextRouteNumber: number;
  status: GameStatus;
  primaryGoalCompletedOnDay: number | null;
  autoMaintenanceThreshold: number;
  autoReplacementAgeYears: number | null;
}

export interface CreateRouteInput {
  name: string;
  originPortId: string;
  destinationPortId: string;
  shipIds: readonly string[];
  fareMultiplier: number;
  fareByClass?: CabinConfiguration;
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
      demandModifiers: { budget: 1.18, leisure: 1.55, business: 2.1, luxury: 1.65 },
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
      demandModifiers: { business: 0.92, luxury: 0.94 },
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
      demandModifiers: { budget: 1.9, leisure: 2.15, business: 1.35, luxury: 1.12 },
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

function operationalPlayerRoutes(state: GameState, shipTypes: readonly ShipType[]): Route[] {
  return state.routes.flatMap((route) => {
    if (!route.active) return [];
    const availableShips = shipsForRoute(state, route.id).filter((ship) => {
      const maintenance = shipMaintenanceState(ship, state.day);
      return maintenance !== "required" && maintenance !== "maintenance" &&
        !!fleetConfigurationForShip(state, ship);
    });
    if (availableShips.length === 0) return [];
    const configurations = availableShips.map((ship) => fleetConfigurationForShip(state, ship)!);
    const shipType = shipTypes.find((candidate) => candidate.id === route.shipTypeId);
    const cabinCapacityByClass: CabinConfiguration = {
      economy: configurations.reduce((sum, configuration) => sum + configuration.cabins.economy, 0) / availableShips.length,
      business: configurations.reduce((sum, configuration) => sum + configuration.cabins.business, 0) / availableShips.length,
      premium: configurations.reduce((sum, configuration) => sum + configuration.cabins.premium, 0) / availableShips.length,
    };
    const maintenance = fleetFixedMaintenanceCost(availableShips, shipTypes, state.day);
    const expectedHoldingDays = Math.max(360, (state.autoReplacementAgeYears ?? 8) * DAYS_PER_SHIP_YEAR);
    const depreciationPerDay = shipType
      ? availableShips.reduce((sum, ship) => {
          const residualDay = ship.commissionedDay + expectedHoldingDays;
          const residual = shipResaleValue(ship, shipType, residualDay);
          return sum + Math.max(0, ship.purchasePricePaid - residual) /
            Math.max(1, residualDay - ship.commissionedDay);
        }, 0)
      : 0;
    return [{
      ...route,
      assignedShips: availableShips.length,
      cabinCapacityByClass,
      economics: {
        fixedMaintenancePerDay: Math.max(0, maintenance.total - maintenance.ageSurcharge),
        ageSurchargePerDay: maintenance.ageSurcharge,
        depreciationPerDay,
        expectedDelayCostPerDay: shipType
          ? (1 - shipType.reliability) * shipType.crewCostPerFlightHour * 8 * availableShips.length
          : 0,
      },
      ...(shipType ? {
        effectiveComfort: availableShips.reduce(
          (sum, ship) => sum + shipComfortAtAge(ship, shipType, state.day),
          0,
        ) / availableShips.length,
      } : {}),
    }];
  });
}

export function createNewGame(
  config: GalaxyGenerationConfig,
  galaxy: GeneratedGalaxy,
  basePortId: string,
  shipTypes: readonly ShipType[] = [],
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
        commissionedDay: 1,
        purchasePricePaid: shipTypes.find((shipType) => shipType.id === "meridian-liner")?.purchasePrice ?? 2_200_000,
      },
    ],
    fleetConfigurations: [],
    shipyardMarket: createShipyardMarket(config.seed, shipTypes),
    shipPurchaseOrders: [],
    routes: [],
    history: [],
    fuelMarket: [fuelPriceRecord(galaxy, 1)],
    nextShipNumber: 2,
    nextFleetConfigurationNumber: 1,
    nextPurchaseAgreementNumber: 1,
    nextRouteNumber: 1,
    status: "playing",
    primaryGoalCompletedOnDay: null,
    autoMaintenanceThreshold: DEFAULT_AUTO_MAINTENANCE_THRESHOLD,
    autoReplacementAgeYears: null,
  };
}

export function migrateGameState(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.version === 8 &&
    (candidate.autoSellAgeYears === null || typeof candidate.autoSellAgeYears === "number")
  ) {
    const { autoSellAgeYears, ...rest } = candidate;
    return {
      ...rest,
      version: GAME_STATE_VERSION,
      autoReplacementAgeYears: autoSellAgeYears,
    };
  }
  return value;
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
    Array.isArray(candidate.shipyardMarket) &&
    Array.isArray(candidate.shipPurchaseOrders) &&
    Array.isArray(candidate.routes) &&
    Array.isArray(candidate.history) &&
    Array.isArray(candidate.fuelMarket) &&
    typeof candidate.autoMaintenanceThreshold === "number" &&
    (candidate.autoReplacementAgeYears === null || typeof candidate.autoReplacementAgeYears === "number")
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
      ...operationalPlayerRoutes(state, baseScenario.shipTypes),
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
  return placeShipPurchaseAgreement(state, [{ shipTypeId, quantity }], shipTypes);
}

export function placeShipPurchaseAgreement(
  state: GameState,
  lines: readonly ShipPurchaseLineInput[],
  shipTypes: readonly ShipType[],
): GameActionResult {
  requirePlaying(state);
  const quote = quoteShipPurchaseAgreement(state, lines, shipTypes);
  if (state.cash < quote.totalPrice) throw new Error("资金不足，无法签订所选采购协议");
  const agreementNumber = state.nextPurchaseAgreementNumber;
  const agreementId = `purchase-${agreementNumber}`;
  const orders: ShipPurchaseOrder[] = quote.lines.map((line, index) => ({
    id: `${agreementId}-${index + 1}`,
    agreementId,
    shipTypeId: line.shipTypeId,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    marketDiscountRate: line.marketDiscountRate,
    agreementDiscountRate: line.agreementDiscountRate,
    orderedDay: state.day,
    deliveryDay: line.deliveryDay,
  }));
  const inventoryByType = new Map(quote.lines.map((line) => [line.shipTypeId, line.inventoryUsed]));
  return {
    state: {
      ...state,
      cash: state.cash - quote.totalPrice,
      shipPurchaseOrders: [...state.shipPurchaseOrders, ...orders],
      shipyardMarket: shipTypes.map((shipType) => {
        const offer = shipyardOfferFor(state, shipType);
        return { ...offer, inventory: Math.max(0, offer.inventory - (inventoryByType.get(shipType.id) ?? 0)) };
      }),
      nextPurchaseAgreementNumber: agreementNumber + 1,
    },
    message: `已签订 ${quote.totalShips} 艘舰船采购协议，合同优惠 ${(quote.agreementDiscountRate * 100).toFixed(0)}%；将按各型号交期交付`,
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

export function setAutoReplacementAge(
  state: GameState,
  ageYears: number | null,
): GameActionResult {
  requirePlaying(state);
  const normalized = ageYears === null ? null : clamp(Math.round(ageYears), 1, 30);
  return {
    state: { ...state, autoReplacementAgeYears: normalized },
    message: normalized === null
      ? "已关闭按船龄自动更新"
      : `舰船达到 ${normalized} 年船龄后将自动订购同型号新船，并在交付后更换`,
  };
}

export function deliverShipPurchaseOrders(
  state: GameState,
  shipTypes: readonly ShipType[],
  throughDay = state.day,
): GameActionResult {
  const dueOrders = state.shipPurchaseOrders.filter((order) => order.deliveryDay <= throughDay);
  if (dueOrders.length === 0) return { state, message: "今日没有待交付舰船" };
  let nextShipNumber = state.nextShipNumber;
  const deliveredShips: OwnedShip[] = [];
  const replacedShips: OwnedShip[] = [];
  for (const order of dueOrders) {
    const shipType = shipTypes.find((candidate) => candidate.id === order.shipTypeId);
    if (!shipType) continue;
    for (let index = 0; index < order.quantity; index += 1) {
      const shipNumber = nextShipNumber++;
      const replacementShipId = order.replacementShipIds?.[index];
      const replacedShip = replacementShipId
        ? state.fleet.find((ship) => ship.id === replacementShipId)
        : undefined;
      if (replacedShip) replacedShips.push(replacedShip);
      deliveredShips.push({
        id: `ship-${shipNumber}`,
        name: `${shipType.name} ${shipNumber.toString().padStart(2, "0")}`,
        shipTypeId: shipType.id,
        routeId: replacedShip?.routeId ?? null,
        condition: 100,
        flightHoursSinceMaintenance: 0,
        maintenanceUntilDay: null,
        configurationId: replacedShip?.configurationId ?? null,
        commissionedDay: throughDay,
        purchasePricePaid: order.unitPrice,
      });
    }
  }
  const dueIds = new Set(dueOrders.map((order) => order.id));
  const replacedIds = new Set(replacedShips.map((ship) => ship.id));
  const replacementRevenue = replacedShips.reduce((sum, ship) => {
    const shipType = shipTypes.find((candidate) => candidate.id === ship.shipTypeId);
    return sum + (shipType ? shipResaleValue(ship, shipType, throughDay) : 0);
  }, 0);
  return {
    state: {
      ...state,
      cash: state.cash + replacementRevenue,
      fleet: [...state.fleet.filter((ship) => !replacedIds.has(ship.id)), ...deliveredShips],
      shipPurchaseOrders: state.shipPurchaseOrders.filter((order) => !dueIds.has(order.id)),
      nextShipNumber,
    },
    message: replacedShips.length > 0
      ? `船厂已交付 ${deliveredShips.length} 艘舰船，其中 ${replacedShips.length} 艘已自动接替旧船；旧船回收 ${replacementRevenue.toFixed(0)} Cr`
      : `船厂已交付 ${deliveredShips.length} 艘舰船；新船为空舱，请先分配统一配置方案`,
  };
}

function refreshShipyardMarket(
  state: GameState,
  shipTypes: readonly ShipType[],
  nextDay: number,
): ShipyardMarketOffer[] {
  return shipTypes.map((shipType) => {
    const current = shipyardOfferFor(state, shipType);
    const dailyRandom = createRandom(`${state.config.seed}:shipyard-trend:${shipType.id}:${nextDay}`);
    const popularity = Number(clamp(
      current.popularity + (dailyRandom.next() - 0.5) * 0.024 + (0.52 - current.popularity) * 0.004,
      0.08,
      0.98,
    ).toFixed(4));
    if (nextDay % 7 !== 0) return { ...current, popularity, updatedDay: nextDay };
    const clearanceChance = 0.12 + (1 - popularity) * 0.64;
    const discountRate = dailyRandom.next() < clearanceChance
      ? Number(clamp(0.03 + (1 - popularity) * 0.2 + dailyRandom.next() * 0.06, 0, 0.3).toFixed(2))
      : 0;
    const replenishment = dailyRandom.next() < 0.08 + (1 - popularity) * 0.56
      ? dailyRandom.integer(1, popularity < 0.4 ? 3 : 1)
      : 0;
    return {
      ...current,
      popularity,
      discountRate,
      inventory: Math.min(5, current.inventory + replenishment),
      updatedDay: nextDay,
    };
  });
}

function orderAutomaticReplacements(
  state: GameState,
  day: number,
  shipTypes: readonly ShipType[],
): { state: GameState; orderedShipNames: string[]; deferredCount: number } {
  if (state.autoReplacementAgeYears === null) {
    return { state, orderedShipNames: [], deferredCount: 0 };
  }
  const pendingReplacementIds = new Set(
    state.shipPurchaseOrders.flatMap((order) => order.replacementShipIds ?? []),
  );
  const eligible = state.fleet
    .filter((ship) =>
      shipAgeYears(ship, day) >= state.autoReplacementAgeYears! && !pendingReplacementIds.has(ship.id),
    )
    .sort((left, right) => shipAgeYears(right, day) - shipAgeYears(left, day))
    .slice(0, 60);
  if (eligible.length === 0) {
    return { state, orderedShipNames: [], deferredCount: 0 };
  }

  const selected: OwnedShip[] = [];
  for (const ship of eligible) {
    if (selected.filter((item) => item.shipTypeId === ship.shipTypeId).length >= 20) continue;
    const candidate = [...selected, ship];
    const lines = [...new Set(candidate.map((item) => item.shipTypeId))].map((shipTypeId) => ({
      shipTypeId,
      quantity: candidate.filter((item) => item.shipTypeId === shipTypeId).length,
    }));
    const quote = quoteShipPurchaseAgreement(state, lines, shipTypes);
    if (quote.totalPrice <= state.cash) selected.push(ship);
  }
  if (selected.length === 0) {
    return { state, orderedShipNames: [], deferredCount: eligible.length };
  }

  const lines = [...new Set(selected.map((ship) => ship.shipTypeId))].map((shipTypeId) => ({
    shipTypeId,
    quantity: selected.filter((ship) => ship.shipTypeId === shipTypeId).length,
  }));
  const existingOrderIds = new Set(state.shipPurchaseOrders.map((order) => order.id));
  const purchased = placeShipPurchaseAgreement(state, lines, shipTypes).state;
  const replacementIdsByType = new Map(lines.map((line) => [
    line.shipTypeId,
    selected.filter((ship) => ship.shipTypeId === line.shipTypeId).map((ship) => ship.id),
  ]));
  const shipPurchaseOrders = purchased.shipPurchaseOrders.map((order) =>
    existingOrderIds.has(order.id)
      ? order
      : { ...order, replacementShipIds: replacementIdsByType.get(order.shipTypeId) ?? [] },
  );
  return {
    state: { ...purchased, shipPurchaseOrders },
    orderedShipNames: selected.map((ship) => ship.name),
    deferredCount: eligible.length - selected.length,
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
      const shipType = scenario.shipTypes.find((ship) => ship.id === route.shipTypeId);
      if (!shipType) return [];
      try {
        return buildRouteServices({ ...route, active: true }, shipType, scenario.ports, scenario.worldLegs);
      } catch {
        return [];
      }
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
    const onTimeRate = serviceModels.length > 0
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
  ageSurcharge: number;
}

export function fleetFixedMaintenanceCost(
  fleet: readonly OwnedShip[],
  shipTypes: readonly ShipType[],
  currentDay = 1,
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
  let ageSurcharge = 0;
  for (const ship of fleet) {
    const type = typeById.get(ship.shipTypeId);
    if (!type) continue;
    const originalBase = type.fixedMaintenanceCostPerDay * FIXED_MAINTENANCE_COST_SCALE;
    const base = originalBase * (1 + shipAgeYears(ship, currentDay) * SHIP_AGE_MAINTENANCE_RATE);
    const supplierDiscount = Math.min(0.18, Math.max(0, (supplierCounts.get(type.manufacturer) ?? 1) - 1) * 0.015);
    const familyDiscount = Math.min(0.22, Math.max(0, (familyCounts.get(type.familyId) ?? 1) - 1) * 0.025);
    const afterSupplier = base * (1 - supplierDiscount);
    const discounted = afterSupplier * (1 - familyDiscount);
    undiscountedTotal += base;
    ageSurcharge += base - originalBase;
    supplierSavings += base - afterSupplier;
    familySavings += afterSupplier - discounted;
    total += discounted;
  }
  return {
    total: Number(total.toFixed(2)),
    undiscountedTotal: Number(undiscountedTotal.toFixed(2)),
    supplierDiscount: Number(supplierSavings.toFixed(2)),
    familyDiscount: Number(familySavings.toFixed(2)),
    ageSurcharge: Number(ageSurcharge.toFixed(2)),
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
  const operationalRouteIds = new Set(scenario.routes.filter((route) => route.companyId === "player").map((route) => route.id));
  const idleFleet = state.fleet.filter((ship) => !ship.routeId || !operationalRouteIds.has(ship.routeId));
  const idleFixedMaintenance = fleetFixedMaintenanceCost(idleFleet, baseScenario.shipTypes, state.day);
  const overhead = DAILY_COMPANY_OVERHEAD + idleFixedMaintenance.total;
  const profit = revenue - operatingCost - overhead;
  const cash = state.cash + profit;
  const passengers = company?.passengers ?? 0;
  const totalPassengers =
    state.history.reduce((sum, record) => sum + record.passengers, 0) + passengers;
  const nextDay = state.day + 1;
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
  const delivery = deliverShipPurchaseOrders({
    ...state,
    day: nextDay,
    cash: automaticMaintenance.cash,
    fleet: automaticMaintenance.fleet,
  }, baseScenario.shipTypes, nextDay);
  const deliveredOrders = state.shipPurchaseOrders.filter((order) => order.deliveryDay <= nextDay);
  const deliveredCount = deliveredOrders.reduce((sum, order) => sum + order.quantity, 0);
  const replacedCount = deliveredOrders.reduce(
    (sum, order) => sum + (order.replacementShipIds?.length ?? 0),
    0,
  );
  const automaticReplacement = orderAutomaticReplacements(
    { ...delivery.state, routes: state.routes },
    nextDay,
    baseScenario.shipTypes,
  );
  const finalCash = automaticReplacement.state.cash;
  const justCompletedGoal =
    state.primaryGoalCompletedOnDay === null &&
    (finalCash >= CASH_GOAL || totalPassengers >= PASSENGER_GOAL);
  const primaryGoalCompletedOnDay = justCompletedGoal
    ? state.day
    : state.primaryGoalCompletedOnDay;
  const lost = finalCash < 0 || (primaryGoalCompletedOnDay === null && nextDay >= DEADLINE_DAY);
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
      fleet: automaticReplacement.state.fleet,
      routes: automaticReplacement.state.routes,
      shipPurchaseOrders: automaticReplacement.state.shipPurchaseOrders,
      nextShipNumber: delivery.state.nextShipNumber,
      nextPurchaseAgreementNumber: automaticReplacement.state.nextPurchaseAgreementNumber,
      shipyardMarket: refreshShipyardMarket(automaticReplacement.state, baseScenario.shipTypes, nextDay),
      history: [...state.history, record].slice(-90),
      fuelMarket: [...state.fuelMarket, fuelPriceRecord(galaxy, nextDay)].slice(-90),
      status: lost ? "lost" : "playing",
      primaryGoalCompletedOnDay,
    },
    message: replacedCount > 0
      ? `船厂今日交付并自动替换 ${replacedCount} 艘到龄舰船；航线与客舱方案已转移到新船。`
      : automaticReplacement.orderedShipNames.length > 0
      ? `已为 ${automaticReplacement.orderedShipNames.length} 艘到龄舰船订购同型号新船；旧船将在交付前继续运营。${automaticReplacement.deferredCount > 0 ? ` 另有 ${automaticReplacement.deferredCount} 艘因资金不足等待采购。` : ""}`
      : automaticReplacement.deferredCount > 0
      ? `${automaticReplacement.deferredCount} 艘舰船已到更新船龄，但资金不足；旧船继续运营并将在后续每日重试采购。`
      : deliveredCount > 0
      ? `船厂今日交付 ${deliveredCount} 艘舰船；请为新船分配统一配置方案。`
      : automaticMaintenance.maintainedShipNames.length > 0
      ? `${automaticMaintenance.maintainedShipNames.join("、")} 返抵主基地，维护值已低于 ${state.autoMaintenanceThreshold}% 阈值并自动进场维护。`
      : justCompletedGoal
      ? "初级经营目标达成！公司进入自由经营阶段，游戏将继续进行。"
      : lost
        ? "公司未能维持经营，本局结束。"
        : `第 ${state.day} 日结算完成：${profit >= 0 ? "盈利" : "亏损"} ${Math.abs(profit).toFixed(0)} Cr`,
  };
}
