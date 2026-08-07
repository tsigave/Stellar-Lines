import { simulateCampaign } from "./campaign.js";
import { explainJourneyChoice } from "./choice.js";
import { PASSENGER_CLASSES, PASSENGER_TYPES } from "./types.js";
import { applyEventsToWorldLegs, eventIntensity, fuelEventIntensity } from "./events.js";
import { buildRouteServices } from "./routes.js";
import { createRandom } from "./generation/random.js";
import {
  generateFlightSchedule,
  type ScheduledFlight,
  type SchedulingShip,
  type ShipLogEntry,
  type StarportCapacityDay,
} from "./scheduling.js";
import { FIXED_MAINTENANCE_COST_SCALE, FUEL_OPERATING_COST_SCALE } from "./parameters.js";
import { deterministicExitDistanceKm, estimateSublightTransit } from "./fuel.js";
import {
  defaultBuildForShipType,
  FTL_DRIVE_MODELS,
  hullVariantFromShipType,
  resolveShipMission,
  SUBLIGHT_ENGINE_MODELS,
} from "./propulsion.js";
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
  ShipBuildConfiguration,
  SimulationScenario,
  Starport,
  TravelMode,
  WorldLeg,
} from "./types.js";

export const GAME_STATE_VERSION = 14;
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
export const CORE_FUEL_STORAGE_CAPACITY = 2_500;
export const FUEL_CONTRACT_DEPOSIT_RATE = 0.2;
export const FUEL_CONTRACT_MINIMUM_WEEKLY_UNITS = 100;
export const FUEL_CONTRACT_QUANTITY_STEP = 10;
export const FUEL_CONTRACT_CANCELLATION_RATE = 0.25;
export const FUEL_WAREHOUSE_RENT_PER_TONNE_DAY = 0.05;
export const FUEL_RESALE_PRICE_RATE = 0.8;

export type FuelSurplusPolicy = "store-first" | "sell-all";

export interface FuelWarehouse {
  rented: boolean;
  capacity: number;
  quantity: number;
  /** Weighted average delivered cost, including procurement and handling. */
  averageUnitCost: number;
  /** Maximum automatic withdrawal per day; null means unlimited. */
  dailyWithdrawalLimit: number | null;
  surplusPolicy: FuelSurplusPolicy;
}

export interface FuelContract {
  id: string;
  signedOnDay: number;
  startsOnDay: number;
  endsOnDay: number;
  termWeeks: number;
  weeklyUnits: number;
  totalUnits: number;
  deliveredUnits: number;
  marketPriceAtSigning: number;
  premiumRate: number;
  contractMarketPrice: number;
  deliveredUnitCost: number;
  totalValue: number;
  depositPaid: number;
  depositRemaining: number;
  createdAutomatically: boolean;
  cancelledOnDay: number | null;
  cancellationFee: number;
}

export interface FuelAutoContractPolicy {
  enabled: boolean;
  triggerPrice: number;
  termWeeks: number;
  /** Share intentionally left exposed to warehouse/spot procurement. */
  spotExposureShare: number;
}

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
  /** 最后确认所在星港；在途时为最近一次起飞星港。 */
  currentPortId?: string;
  /** 备用池中的船不进入常规轮转，只在指定航线出现取消风险时顶替。 */
  reserveForRouteId?: string | null;
  /** 采购时预先指定；完成配置后可从下一可用时隙加入。 */
  plannedRouteId?: string | null;
  /** Immutable purchase-time propulsion build; replacement orders inherit it. */
  build?: ShipBuildConfiguration;
}

export interface PendingFleetChange {
  id: string;
  shipId: string;
  fromRouteId: string | null;
  toRouteId: string | null;
  requestedDay: number;
  effectiveDay: number;
  status: "pending" | "applied";
  expectedCost: number;
  capacityDelta: number;
  possiblyCancelledFlightIds: readonly string[];
}

export interface FlightFinancialEvent {
  id: string;
  minute: number;
  flightId?: string;
  routeId?: string;
  kind: "ticket-revenue" | "fuel-purchase" | "flight-maintenance" | "depreciation" | "crew-payroll" | "delay-compensation" | "delay-extra-cost";
  amount: number;
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
  targetRouteId?: string | null;
  build: ShipBuildConfiguration;
}

export interface ShipPurchaseLineInput {
  shipTypeId: string;
  quantity: number;
  targetRouteId?: string | null;
  build?: ShipBuildConfiguration;
}

export interface StarportCapacityInvestment {
  portId: string;
  level: number;
  totalCost: number;
}

export interface FleetConfiguration {
  id: string;
  shipTypeId: string;
  name: string;
  cabins: CabinConfiguration;
  build: ShipBuildConfiguration;
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
  const quantitiesByType = new Map<string, ShipPurchaseLineInput>();
  for (const line of requestedLines) {
    const key = `${line.shipTypeId}:${line.targetRouteId ?? "standby"}:${JSON.stringify(line.build ?? null)}`;
    const current = quantitiesByType.get(key);
    quantitiesByType.set(key, { ...line, quantity: (current?.quantity ?? 0) + line.quantity });
  }
  const lines = [...quantitiesByType.values()]
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
    const targetRoute = line.targetRouteId ? state.routes.find((route) => route.id === line.targetRouteId) : undefined;
    if (line.targetRouteId && !targetRoute) throw new Error("预定目标航线不存在");
    if (targetRoute?.routingMode && !shipType.supportedModes.includes(targetRoute.routingMode)) {
      throw new Error(`${shipType.name} 不支持预定航线的推进方式`);
    }
    const hull = hullVariantFromShipType(shipType);
    const build = line.build ?? defaultBuildForShipType(shipType);
    if (build.hullVariantId !== hull.id) throw new Error("采购配置与所选船体不匹配");
    const resolvedBuild = resolveShipMission({ build, hull, distanceLightYears: 0 });
    if (!resolvedBuild.feasible) throw new Error(resolvedBuild.infeasibleReasons.join("；"));
    const offer = shipyardOfferFor(state, shipType);
    const inventoryUsed = Math.min(offer.inventory, line.quantity);
    const factoryQuantity = line.quantity - inventoryUsed;
    const manufacturingDays = factoryQuantity === 0
      ? 1
      : Math.ceil(hull.deliveryDays + offer.popularity * 18 + factoryQuantity * 1.6);
    const unitPrice = Math.round(resolvedBuild.purchasePrice * (1 - offer.discountRate) * (1 - agreementDiscountRate));
    return {
      ...line,
      build,
      listUnitPrice: resolvedBuild.purchasePrice,
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
  price: number;
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
  fuelPurchasedUnits?: number;
  fuelPurchaseCost?: number;
  fuelInventoryUsedUnits?: number;
  fuelConsumedUnits?: number;
  fuelContractDeliveredUnits?: number;
  fuelContractUsedUnits?: number;
  fuelContractCost?: number;
  fuelContractInstallment?: number;
  fuelContractDepositAmortized?: number;
  fuelSpotPurchasedUnits?: number;
  fuelSpotPurchaseCost?: number;
  fuelWarehouseStoredUnits?: number;
  fuelWarehouseUsedUnits?: number;
  fuelWarehouseRent?: number;
  fuelSurplusSoldUnits?: number;
  fuelSurplusSaleRevenue?: number;
  fuelEffectiveUnitCost?: number;
  activeEventIds: readonly string[];
  announcedEventIds: readonly string[];
  routes: readonly GameRouteDaySummary[];
  flightsOperated?: number;
  flightsCancelled?: number;
  delayedFlights?: number;
  compensationPaid?: number;
  financialEvents?: readonly FlightFinancialEvent[];
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
  fuelWarehouse: FuelWarehouse;
  fuelContracts: readonly FuelContract[];
  fuelAutoContractPolicy: FuelAutoContractPolicy;
  nextFuelContractNumber: number;
  nextShipNumber: number;
  nextFleetConfigurationNumber: number;
  nextPurchaseAgreementNumber: number;
  nextRouteNumber: number;
  status: GameStatus;
  primaryGoalCompletedOnDay: number | null;
  autoMaintenanceThreshold: number;
  autoReplacementAgeYears: number | null;
  scheduledFlights: readonly ScheduledFlight[];
  shipLogs: readonly ShipLogEntry[];
  starportCapacity: readonly StarportCapacityDay[];
  pendingFleetChanges: readonly PendingFleetChange[];
  starportCapacityInvestments: Readonly<Record<string, StarportCapacityInvestment>>;
  companyReputation: number;
  localReputation: Readonly<Record<string, number>>;
  unsettledFinancialEvents: readonly FlightFinancialEvent[];
  staticAiRoutes: readonly Route[];
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
      description: "主要供应节点紧张推高统一市场报价，所有航线成本增加。",
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

function dynamicFuelPrice(seed: string, day: number): number {
  const portHash = hash(`${seed}:fuel:unified-market`);
  const phaseA = (portHash % 6283) / 1000;
  const phaseB = ((portHash >>> 7) % 6283) / 1000;
  const portBias = (((hash(`${seed}:fuel-bias:unified-market`) % 2_001) / 1_000) - 1) * 0.2;
  const latent = portBias +
    0.78 * Math.sin(day / 12.5 + phaseA) +
    0.46 * Math.sin(day / 5.8 + phaseB) +
    0.2 * Math.sin(day / 2.7 + phaseA / 2);
  // tanh provides soft 1–3 Cr bounds without sticking to either boundary.
  const normal = 2 + Math.tanh(latent) * 0.96;

  // Rare regimes use a ten-day raised-cosine envelope. Price, slope and peak
  // are continuous, so a surplus or shortage is visible before it reaches its
  // extreme and fades out without a one-day jump.
  const windowLength = 48;
  const halfDuration = 5;
  const window = Math.floor((Math.max(1, day) - 1) / windowLength);
  const dayInWindow = (Math.max(1, day) - 1) % windowLength;
  const regimeHash = hash(`${seed}:fuel-regime:unified-market:${window}`);
  const regimeRoll = (regimeHash % 10_000) / 10_000;
  const centerDay = 6 + (hash(`${seed}:fuel-window-center:unified-market:${window}`) % 36);
  const distanceFromCenter = Math.abs(dayInWindow - centerDay);
  if (distanceFromCenter <= halfDuration && (regimeRoll < 0.1 || regimeRoll > 0.86)) {
    const progress = (dayInWindow - (centerDay - halfDuration)) / (halfDuration * 2);
    const envelope = Math.sin(Math.PI * progress) ** 2;
    const tailVariation = (hash(`${seed}:fuel-tail:unified-market:${window}`) % 1_001) / 1_000;
    const target = regimeRoll < 0.1
      ? 0.5 + tailVariation * 0.25
      : 5 + tailVariation;
    return Number((normal + (target - normal) * envelope).toFixed(3));
  }
  return Number(normal.toFixed(3));
}

function globalFuelPrice(galaxy: GeneratedGalaxy, day: number): number {
  let price = dynamicFuelPrice(galaxy.config.seed, day);
  for (const event of createGeneratedGameEvents(galaxy)) {
    if (event.fuelPriceModifier === undefined) continue;
    const intensity = fuelEventIntensity(event, day);
    const target = event.fuelPriceModifier >= 1 ? 6 : 0.5;
    const strength = Math.min(1, Math.abs(event.fuelPriceModifier - 1));
    price += (target - price) * strength * intensity;
  }
  return Number(clamp(price, 0.5, 6).toFixed(3));
}

function dynamicFuelPorts(galaxy: GeneratedGalaxy, day: number): Starport[] {
  const price = globalFuelPrice(galaxy, day);
  return galaxy.ports.map((port) => ({
    ...port,
    fuelPrice: price,
  }));
}

export function fuelPriceRecord(galaxy: GeneratedGalaxy, day: number): FuelPriceRecord {
  return { day, price: globalFuelPrice(galaxy, day) };
}

export function currentFuelPrice(state: Pick<GameState, "fuelMarket">): number {
  return state.fuelMarket.at(-1)?.price ?? 2;
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

function operationalPlayerRoutes(state: GameState, shipTypes: readonly ShipType[]): Route[] {
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

export function createNewGame(
  config: GalaxyGenerationConfig,
  galaxy: GeneratedGalaxy,
  basePortId: string,
  shipTypes: readonly ShipType[] = [],
  staticAiRoutes: readonly Route[] = [],
): GameState {
  const basePort = galaxy.ports.find((port) => port.id === basePortId);
  if (!basePort) throw new Error("请选择一个有效的基地星球");
  const starterType = shipTypes.find((shipType) => shipType.id === "meridian-liner");
  const initial: GameState = {
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
        purchasePricePaid: starterType?.purchasePrice ?? 2_200_000,
        currentPortId: basePort.id,
        ...(starterType ? { build: defaultBuildForShipType(starterType) } : {}),
      },
    ],
    fleetConfigurations: [],
    shipyardMarket: createShipyardMarket(config.seed, shipTypes),
    shipPurchaseOrders: [],
    routes: [],
    history: [],
    fuelMarket: [fuelPriceRecord(galaxy, 1)],
    fuelWarehouse: {
      rented: false,
      capacity: CORE_FUEL_STORAGE_CAPACITY,
      quantity: 0,
      averageUnitCost: 0,
      dailyWithdrawalLimit: null,
      surplusPolicy: "store-first",
    },
    fuelContracts: [],
    fuelAutoContractPolicy: {
      enabled: false,
      triggerPrice: 1.5,
      termWeeks: 16,
      spotExposureShare: 0.4,
    },
    nextFuelContractNumber: 1,
    nextShipNumber: 2,
    nextFleetConfigurationNumber: 1,
    nextPurchaseAgreementNumber: 1,
    nextRouteNumber: 1,
    status: "playing",
    primaryGoalCompletedOnDay: null,
    autoMaintenanceThreshold: DEFAULT_AUTO_MAINTENANCE_THRESHOLD,
    autoReplacementAgeYears: null,
    scheduledFlights: [],
    shipLogs: [],
    starportCapacity: [],
    pendingFleetChanges: [],
    starportCapacityInvestments: {},
    companyReputation: 70,
    localReputation: { [basePort.id]: 72 },
    unsettledFinancialEvents: [],
    staticAiRoutes,
  };
  const schedule = buildGameSchedule(initial, galaxy, shipTypes, 7);
  return { ...initial, scheduledFlights: schedule.flights, shipLogs: schedule.shipLogs, starportCapacity: schedule.starportCapacity };
}

export function migrateGameState(value: unknown): unknown {
  // v0.7 is an intentional physics/save boundary. Retain old storage untouched,
  // but never reinterpret v0.6.1 aggregate ship and FU data as v0.7 mass state.
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
    candidate.fleetConfigurations.every((configuration) => !!configuration?.build) &&
    Array.isArray(candidate.shipyardMarket) &&
    Array.isArray(candidate.shipPurchaseOrders) &&
    candidate.shipPurchaseOrders.every((order) => !!order?.build) &&
    Array.isArray(candidate.routes) &&
    Array.isArray(candidate.history) &&
    Array.isArray(candidate.fuelMarket) &&
    !!candidate.fuelWarehouse &&
    typeof candidate.fuelWarehouse.quantity === "number" &&
    typeof candidate.fuelWarehouse.capacity === "number" &&
    Array.isArray(candidate.fuelContracts) &&
    Array.isArray(candidate.scheduledFlights) &&
    Array.isArray(candidate.shipLogs) &&
    Array.isArray(candidate.starportCapacity) &&
    Array.isArray(candidate.pendingFleetChanges) &&
    !!candidate.starportCapacityInvestments &&
    typeof candidate.companyReputation === "number" &&
    !!candidate.localReputation &&
    Array.isArray(candidate.unsettledFinancialEvents) &&
    Array.isArray(candidate.staticAiRoutes) &&
    !!candidate.fuelAutoContractPolicy &&
    typeof candidate.nextFuelContractNumber === "number" &&
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
    companyReputation: { ...baseScenario.companyReputation, player: state.companyReputation },
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
    onTimeRateByRoute: Object.fromEntries(state.routes.map((route) => {
      const currentFlights = state.scheduledFlights.filter((flight) => flight.routeId === route.id && Math.floor(flight.departureMinute / 1_440) === state.day);
      if (currentFlights.length > 0) return [route.id, currentFlights.filter((flight) => flight.onTime).length / currentFlights.length];
      const recent = [...state.history].reverse().find((record) => record.routes.some((summary) => summary.routeId === route.id));
      return [route.id, recent?.routes.find((summary) => summary.routeId === route.id)?.onTimeRate ?? 0.92];
    })),
    // Fuel shocks have already been applied to the unified market quote above.
    // Keep their demand/capacity effects without reapplying a local fuel price.
    events: createGeneratedGameEvents(galaxy).map(({ fuelPriceModifier: _fuelPriceModifier, ...event }) => event),
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

export function orderShipReplacement(
  state: GameState,
  shipId: string,
  shipTypes: readonly ShipType[],
): GameActionResult {
  requirePlaying(state);
  const ship = state.fleet.find((candidate) => candidate.id === shipId);
  if (!ship) throw new Error("舰船不存在");
  if (state.shipPurchaseOrders.some((order) => order.replacementShipIds?.includes(shipId))) {
    throw new Error("该舰船已有替代订单");
  }
  const configuration = fleetConfigurationForShip(state, ship);
  const inheritedBuild = ship.build ?? configuration?.build;
  const replacementLine: ShipPurchaseLineInput = {
    shipTypeId: ship.shipTypeId,
    quantity: 1,
    targetRouteId: ship.routeId,
    ...(inheritedBuild ? { build: inheritedBuild } : {}),
  };
  const purchased = placeShipPurchaseAgreement(state, [replacementLine], shipTypes);
  const agreementId = purchased.state.shipPurchaseOrders.at(-1)?.agreementId;
  return {
    state: { ...purchased.state, shipPurchaseOrders: purchased.state.shipPurchaseOrders.map((order) =>
      order.agreementId === agreementId ? { ...order, replacementShipIds: [shipId] } : order) },
    message: `${ship.name} 的同型号替代船已订购；交付时继承航线与客舱配置，旧船随后回收`,
  };
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
    targetRouteId: line.targetRouteId ?? null,
    build: line.build ?? defaultBuildForShipType(shipTypes.find((candidate) => candidate.id === line.shipTypeId)!),
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
  requestedBuild?: ShipBuildConfiguration,
): GameActionResult {
  requirePlaying(state);
  const shipType = shipTypes.find((candidate) => candidate.id === shipTypeId);
  if (!shipType) throw new Error("船型数据不存在");
  const normalized = normalizeFleetConfiguration(shipType, cabins);
  const build = { ...(requestedBuild ?? defaultBuildForShipType(shipType, normalized)), cabins: normalized };
  const resolved = resolveShipMission({ build, hull: hullVariantFromShipType(shipType), distanceLightYears: 0 });
  if (!resolved.feasible) throw new Error(resolved.infeasibleReasons.join("；"));
  const number = state.nextFleetConfigurationNumber;
  const configuration: FleetConfiguration = {
    id: `fleet-config-${number}`,
    shipTypeId,
    name: name.trim() || `${shipType.familyName}方案 ${number}`,
    cabins: normalized,
    build,
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
  requestedBuild?: ShipBuildConfiguration,
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
  const build = { ...(requestedBuild ?? configuration.build), cabins: normalized };
  const resolved = resolveShipMission({ build, hull: hullVariantFromShipType(shipType), distanceLightYears: 0 });
  if (!resolved.feasible) throw new Error(resolved.infeasibleReasons.join("；"));
  const updated = {
    ...configuration,
    name: name.trim() || configuration.name,
    cabins: normalized,
    build,
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
        uniqueShipIds.includes(ship.id) ? {
          ...ship,
          configurationId,
          routeId: ship.plannedRouteId ?? ship.routeId,
          plannedRouteId: null,
        } : ship,
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
      unsettledFinancialEvents: [...state.unsettledFinancialEvents, {
        id: `maintenance:${ship.id}:${state.day}:${state.unsettledFinancialEvents.length + 1}`,
        minute: state.day * 1_440,
        ...(ship.routeId ? { routeId: ship.routeId } : {}),
        kind: "flight-maintenance",
        amount: -cost,
      }],
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

export function fuelContractPremiumRate(termWeeks: number): number {
  return Number((0.01 + clamp(Math.round(termWeeks), 1, 32) * 0.0025).toFixed(4));
}

export interface FuelContractQuote {
  termWeeks: number;
  weeklyUnits: number;
  totalUnits: number;
  marketPrice: number;
  premiumRate: number;
  contractMarketPrice: number;
  deliveredUnitCost: number;
  totalValue: number;
  deposit: number;
  dailyInstallment: number;
}

export function quoteFuelContract(
  state: GameState,
  termWeeks: number,
  weeklyUnits: number,
): FuelContractQuote {
  const normalizedWeeks = clamp(Math.round(termWeeks), 1, 32);
  const normalizedUnits = Math.floor(weeklyUnits / FUEL_CONTRACT_QUANTITY_STEP) * FUEL_CONTRACT_QUANTITY_STEP;
  if (normalizedUnits < FUEL_CONTRACT_MINIMUM_WEEKLY_UNITS) {
    throw new Error(`燃料合约最低供应量为每周 ${FUEL_CONTRACT_MINIMUM_WEEKLY_UNITS} t`);
  }
  const marketPrice = currentFuelPrice(state);
  const premiumRate = fuelContractPremiumRate(normalizedWeeks);
  const contractMarketPrice = Number((marketPrice * (1 + premiumRate)).toFixed(4));
  const deliveredUnitCost = contractMarketPrice * FUEL_OPERATING_COST_SCALE;
  const totalUnits = normalizedUnits * normalizedWeeks;
  const totalValue = totalUnits * deliveredUnitCost;
  const deposit = totalValue * FUEL_CONTRACT_DEPOSIT_RATE;
  return {
    termWeeks: normalizedWeeks,
    weeklyUnits: normalizedUnits,
    totalUnits,
    marketPrice,
    premiumRate,
    contractMarketPrice,
    deliveredUnitCost,
    totalValue,
    deposit,
    dailyInstallment: totalValue * (1 - FUEL_CONTRACT_DEPOSIT_RATE) / (normalizedWeeks * 7),
  };
}

function createFuelContractFromQuote(
  state: GameState,
  quote: FuelContractQuote,
  createdAutomatically: boolean,
): GameState {
  if (state.cash < quote.deposit) throw new Error("资金不足，无法支付燃料合约定金");
  const contract: FuelContract = {
    id: `fuel-contract-${state.nextFuelContractNumber}`,
    signedOnDay: state.day,
    startsOnDay: state.day,
    endsOnDay: state.day + quote.termWeeks * 7 - 1,
    termWeeks: quote.termWeeks,
    weeklyUnits: quote.weeklyUnits,
    totalUnits: quote.totalUnits,
    deliveredUnits: 0,
    marketPriceAtSigning: quote.marketPrice,
    premiumRate: quote.premiumRate,
    contractMarketPrice: quote.contractMarketPrice,
    deliveredUnitCost: quote.deliveredUnitCost,
    totalValue: quote.totalValue,
    depositPaid: quote.deposit,
    depositRemaining: quote.deposit,
    createdAutomatically,
    cancelledOnDay: null,
    cancellationFee: 0,
  };
  return {
    ...state,
    cash: state.cash - quote.deposit,
    fuelContracts: [...state.fuelContracts, contract],
    nextFuelContractNumber: state.nextFuelContractNumber + 1,
  };
}

export function signFuelContract(
  state: GameState,
  termWeeks: number,
  weeklyUnits: number,
): GameActionResult {
  requirePlaying(state);
  const quote = quoteFuelContract(state, termWeeks, weeklyUnits);
  return {
    state: createFuelContractFromQuote(state, quote, false),
    message: `燃料合约已签订：每周 ${quote.weeklyUnits.toFixed(0)} t、${quote.termWeeks} 周，已支付 20% 定金 ${quote.deposit.toFixed(0)} Cr`,
  };
}

export function cancelFuelContract(state: GameState, contractId: string): GameActionResult {
  requirePlaying(state);
  const contract = state.fuelContracts.find((candidate) => candidate.id === contractId);
  if (!contract || contract.cancelledOnDay !== null || state.day > contract.endsOnDay) {
    throw new Error("该燃料合约已经结束");
  }
  const remainingUnits = Math.max(0, contract.totalUnits - contract.deliveredUnits);
  const remainingValue = remainingUnits * contract.deliveredUnitCost;
  const supplierPriceLoss = Math.max(
    0,
    contract.deliveredUnitCost - currentFuelPrice(state) * FUEL_OPERATING_COST_SCALE,
  ) * remainingUnits;
  const additionalFee = Math.max(remainingValue * FUEL_CONTRACT_CANCELLATION_RATE, supplierPriceLoss);
  if (state.cash < additionalFee) throw new Error("资金不足，无法支付提前解约违约金");
  const totalLoss = contract.depositRemaining + additionalFee;
  return {
    state: {
      ...state,
      cash: state.cash - additionalFee,
      fuelContracts: state.fuelContracts.map((candidate) => candidate.id === contractId
        ? {
            ...candidate,
            cancelledOnDay: state.day,
            cancellationFee: totalLoss,
            depositRemaining: 0,
          }
        : candidate),
    },
    message: `已提前取消 ${contract.id}：未摊销定金被没收，并支付 ${additionalFee.toFixed(0)} Cr 违约金`,
  };
}

export function setFuelAutoContractPolicy(
  state: GameState,
  policy: FuelAutoContractPolicy,
): GameActionResult {
  requirePlaying(state);
  const normalized: FuelAutoContractPolicy = {
    enabled: Boolean(policy.enabled),
    triggerPrice: Number(clamp(policy.triggerPrice, 0.5, 6).toFixed(2)),
    termWeeks: clamp(Math.round(policy.termWeeks), 1, 32),
    spotExposureShare: Number(clamp(policy.spotExposureShare, 0, 1).toFixed(2)),
  };
  return {
    state: { ...state, fuelAutoContractPolicy: normalized },
    message: normalized.enabled
      ? `自动签约已启用：燃料价格不高于 ${normalized.triggerPrice.toFixed(2)} Cr 时，至少保留 ${(normalized.spotExposureShare * 100).toFixed(0)}% 现货敞口`
      : "自动签约已关闭",
  };
}

export function setFuelWarehouseRental(state: GameState, rented: boolean): GameActionResult {
  requirePlaying(state);
  if (!rented && state.fuelWarehouse.quantity > 1e-9) throw new Error("取消仓库前必须先清空库存");
  return {
    state: { ...state, fuelWarehouse: { ...state.fuelWarehouse, rented } },
    message: rented ? "已租用公司燃料仓库" : "已取消燃料仓库租用",
  };
}

export function setFuelWarehousePolicy(
  state: GameState,
  dailyWithdrawalLimit: number | null,
  surplusPolicy: FuelSurplusPolicy,
): GameActionResult {
  requirePlaying(state);
  const normalizedLimit = dailyWithdrawalLimit === null
    ? null
    : Number(clamp(dailyWithdrawalLimit, 0, CORE_FUEL_STORAGE_CAPACITY).toFixed(1));
  return {
    state: {
      ...state,
      fuelWarehouse: {
        ...state.fuelWarehouse,
        dailyWithdrawalLimit: normalizedLimit,
        surplusPolicy,
      },
    },
    message: `仓库策略已更新：${normalizedLimit === null ? "每日提取不限量" : `每日最多提取 ${normalizedLimit.toFixed(0)} t`}；${surplusPolicy === "store-first" ? "合约盈余优先入库" : "合约盈余直接出售"}`,
  };
}

export function buyFuelForWarehouse(state: GameState, units: number): GameActionResult {
  requirePlaying(state);
  if (!state.fuelWarehouse.rented) throw new Error("请先租用燃料仓库");
  const quantity = Number(Math.max(0, Math.min(units, state.fuelWarehouse.capacity - state.fuelWarehouse.quantity)).toFixed(1));
  if (quantity <= 0) throw new Error("请输入有效买入量，且不能超过仓库剩余容量");
  const unitCost = currentFuelPrice(state) * FUEL_OPERATING_COST_SCALE;
  const cost = quantity * unitCost;
  if (state.cash < cost) throw new Error("资金不足，无法完成燃料入库采购");
  const previousValue = state.fuelWarehouse.quantity * state.fuelWarehouse.averageUnitCost;
  const nextQuantity = state.fuelWarehouse.quantity + quantity;
  return {
    state: {
      ...state,
      cash: state.cash - cost,
      fuelWarehouse: {
        ...state.fuelWarehouse,
        quantity: nextQuantity,
        averageUnitCost: (previousValue + cost) / nextQuantity,
      },
    },
    message: `已按当前市场价买入 ${quantity.toFixed(1)} t 燃料并存入仓库`,
  };
}

export function sellFuelFromWarehouse(state: GameState, units: number): GameActionResult {
  requirePlaying(state);
  if (!state.fuelWarehouse.rented) throw new Error("当前没有租用燃料仓库");
  const quantity = Number(Math.max(0, Math.min(units, state.fuelWarehouse.quantity)).toFixed(1));
  if (quantity <= 0) throw new Error("请输入有效出售量");
  const revenue = quantity * currentFuelPrice(state) * FUEL_OPERATING_COST_SCALE * FUEL_RESALE_PRICE_RATE;
  const nextQuantity = state.fuelWarehouse.quantity - quantity;
  return {
    state: {
      ...state,
      cash: state.cash + revenue,
      fuelWarehouse: {
        ...state.fuelWarehouse,
        quantity: nextQuantity,
        averageUnitCost: nextQuantity > 1e-9 ? state.fuelWarehouse.averageUnitCost : 0,
      },
    },
    message: `已按市场交付价的 80% 出售 ${quantity.toFixed(1)} t 仓库燃料`,
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
        currentPortId: replacedShip?.currentPortId ?? state.basePortId,
        reserveForRouteId: replacedShip?.reserveForRouteId ?? null,
        plannedRouteId: replacedShip?.plannedRouteId ?? order.targetRouteId ?? null,
        build: replacedShip?.build ?? order.build,
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

function applyDueFleetChanges(state: GameState, day: number): GameState {
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

function routeSchedule(route: Route, scenario: SimulationScenario): { departuresPerWeek: number; roundTripDays: number; dailyFlightHours: number } {
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
      return scenario.routes.filter((candidate) => candidate.id === route.id || candidate.parentRouteId === route.id)
        .flatMap((variant) => {
          const shipType = scenario.shipTypes.find((ship) => ship.id === variant.shipTypeId);
          if (!shipType) return [];
          try {
            return buildRouteServices({ ...variant, active: true }, shipType, scenario.ports, scenario.worldLegs);
          } catch {
            return [];
          }
        });
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
    const routeFlights = state.scheduledFlights.filter((flight) =>
      flight.routeId === route.id && Math.floor(flight.departureMinute / 1_440) === state.day,
    );
    const onTimeFlights = routeFlights.filter((flight) => {
      if (flight.status === "cancelled") return false;
      const plannedMinutes = flight.scheduledArrivalMinute - flight.scheduledDepartureMinute;
      const threshold = Math.min(240, Math.max(60, plannedMinutes * 0.03));
      return flight.delayMinutes <= threshold;
    }).length;
    const onTimeRate = routeFlights.length > 0
      ? onTimeFlights / routeFlights.length
      : serviceModels.length > 0
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
  return state.fleet.map((ship) => {
    if (ship.maintenanceUntilDay !== null) {
      return state.day + 1 >= ship.maintenanceUntilDay
        ? { ...ship, maintenanceUntilDay: null }
        : ship;
    }
    if (!ship.routeId) return ship;
    const route = state.routes.find((candidate) => candidate.id === ship.routeId);
    if (!route) return ship;
    const flights = state.scheduledFlights.filter((flight) => flight.shipId === ship.id && flight.status !== "cancelled" &&
      Math.floor(flight.departureMinute / 1_440) === state.day);
    const flightHours = flights.reduce((sum, flight) => sum + Math.max(0, flight.arrivalMinute - flight.departureMinute) / 60, 0);
    const shipType = scenario.shipTypes.find((candidate) => candidate.id === ship.shipTypeId);
    const cruiseRatio = route.cruiseRatioByShipType?.[ship.shipTypeId] ?? 1;
    const wearMultiplier = 1 + (shipType?.highSpeedMaintenancePenalty ?? 2.4) * Math.max(0, cruiseRatio - .9) ** 2;
    return {
      ...ship,
      condition: Math.max(0, ship.condition - flightHours * CONDITION_WEAR_PER_FLIGHT_HOUR * wearMultiplier),
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
  diversityOverhead: number;
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
  const componentSuppliers = new Set<string>();
  const componentFamilies = new Set<string>();
  const componentModels = new Set<string>();
  for (const ship of fleet) {
    const type = typeById.get(ship.shipTypeId);
    if (!type) continue;
    const build = ship.build ?? defaultBuildForShipType(type);
    const engine = SUBLIGHT_ENGINE_MODELS.find((candidate) => candidate.id === build.sublightEngineModelId);
    const drive = FTL_DRIVE_MODELS.find((candidate) => candidate.id === build.ftlDriveModelId);
    for (const component of [engine, drive]) {
      if (!component) continue;
      componentSuppliers.add(component.manufacturer);
      componentFamilies.add(`${component.manufacturer}:${component.family}`);
      componentModels.add(component.id);
    }
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
  const diversityOverhead = componentSuppliers.size * 250 + componentFamilies.size * 180 +
    Math.max(0, componentModels.size - componentFamilies.size) * 45;
  total += diversityOverhead;
  undiscountedTotal += diversityOverhead;
  return {
    total: Number(total.toFixed(2)),
    undiscountedTotal: Number(undiscountedTotal.toFixed(2)),
    supplierDiscount: Number(supplierSavings.toFixed(2)),
    familyDiscount: Number(familySavings.toFixed(2)),
    ageSurcharge: Number(ageSurcharge.toFixed(2)),
    diversityOverhead: Number(diversityOverhead.toFixed(2)),
  };
}

interface FuelDaySettlement {
  state: GameState;
  consumedUnits: number;
  consumedCost: number;
  effectiveUnitCost: number;
  contractDeliveredUnits: number;
  contractUsedUnits: number;
  contractCost: number;
  contractInstallment: number;
  contractDepositAmortized: number;
  spotPurchasedUnits: number;
  spotPurchaseCost: number;
  warehouseStoredUnits: number;
  warehouseStoredValue: number;
  warehouseUsedUnits: number;
  warehouseUsedValue: number;
  warehouseRent: number;
  surplusSoldUnits: number;
  surplusSoldCost: number;
  surplusSaleRevenue: number;
}

function isFuelContractActive(contract: FuelContract, day: number): boolean {
  return contract.cancelledOnDay === null && day >= contract.startsOnDay && day <= contract.endsOnDay &&
    contract.deliveredUnits < contract.totalUnits - 1e-9;
}

export function forecastWeeklyFuelDemand(state: GameState, currentDemand = 0): number {
  if (currentDemand > 0) return currentDemand * 7;
  const recent = state.history.slice(-30).filter((record) => (record.fuelConsumedUnits ?? 0) > 0);
  if (recent.length === 0) return 0;
  return recent.reduce((sum, record) => sum + (record.fuelConsumedUnits ?? 0), 0) / recent.length * 7;
}

export function contractedFuelShare(state: GameState, weeklyDemand: number, day = state.day): number {
  if (weeklyDemand <= 0) return 0;
  const weeklyUnits = state.fuelContracts
    .filter((contract) => isFuelContractActive(contract, day))
    .reduce((sum, contract) => sum + contract.weeklyUnits, 0);
  return clamp(weeklyUnits / weeklyDemand, 0, 10);
}

function applyAutomaticFuelContract(
  state: GameState,
  weeklyDemand: number,
): { state: GameState; signedWeeklyUnits: number } {
  const policy = state.fuelAutoContractPolicy;
  if (!policy.enabled || currentFuelPrice(state) > policy.triggerPrice || weeklyDemand <= 0) {
    return { state, signedWeeklyUnits: 0 };
  }
  const allowedWeeklyUnits = weeklyDemand * (1 - policy.spotExposureShare);
  const existingWeeklyUnits = state.fuelContracts
    .filter((contract) => isFuelContractActive(contract, state.day))
    .reduce((sum, contract) => sum + contract.weeklyUnits, 0);
  const requestedWeeklyUnits = Math.floor(
    Math.max(0, allowedWeeklyUnits - existingWeeklyUnits) / FUEL_CONTRACT_QUANTITY_STEP,
  ) * FUEL_CONTRACT_QUANTITY_STEP;
  if (requestedWeeklyUnits < FUEL_CONTRACT_MINIMUM_WEEKLY_UNITS) {
    return { state, signedWeeklyUnits: 0 };
  }
  const quote = quoteFuelContract(state, policy.termWeeks, requestedWeeklyUnits);
  if (state.cash < quote.deposit) return { state, signedWeeklyUnits: 0 };
  return {
    state: createFuelContractFromQuote(state, quote, true),
    signedWeeklyUnits: quote.weeklyUnits,
  };
}

function settleFuelDay(
  state: GameState,
  consumedUnits: number,
): FuelDaySettlement {
  let contractDeliveredUnits = 0;
  let contractCost = 0;
  let contractInstallment = 0;
  let contractDepositAmortized = 0;
  const contracts = state.fuelContracts.map((contract) => {
    if (!isFuelContractActive(contract, state.day)) return contract;
    const deliveryUnits = Math.min(contract.weeklyUnits / 7, contract.totalUnits - contract.deliveredUnits);
    const deliveryValue = deliveryUnits * contract.deliveredUnitCost;
    const depositAmortized = Math.min(contract.depositRemaining, deliveryValue * FUEL_CONTRACT_DEPOSIT_RATE);
    contractDeliveredUnits += deliveryUnits;
    contractCost += deliveryValue;
    contractInstallment += deliveryValue * (1 - FUEL_CONTRACT_DEPOSIT_RATE);
    contractDepositAmortized += depositAmortized;
    return {
      ...contract,
      deliveredUnits: contract.deliveredUnits + deliveryUnits,
      depositRemaining: Math.max(0, contract.depositRemaining - depositAmortized),
    };
  });
  const contractAverageUnitCost = contractDeliveredUnits > 0 ? contractCost / contractDeliveredUnits : 0;
  const contractUsedUnits = Math.min(consumedUnits, contractDeliveredUnits);
  const contractUsedCost = contractUsedUnits * contractAverageUnitCost;
  const remainingDemand = Math.max(0, consumedUnits - contractUsedUnits);
  const withdrawalLimit = state.fuelWarehouse.dailyWithdrawalLimit ?? Number.POSITIVE_INFINITY;
  const warehouseUsedUnits = state.fuelWarehouse.rented
    ? Math.min(remainingDemand, state.fuelWarehouse.quantity, withdrawalLimit)
    : 0;
  const warehouseUsedValue = warehouseUsedUnits * state.fuelWarehouse.averageUnitCost;
  const spotPurchasedUnits = Math.max(0, remainingDemand - warehouseUsedUnits);
  const spotDeliveredUnitCost = currentFuelPrice(state) * FUEL_OPERATING_COST_SCALE;
  const spotPurchaseCost = spotPurchasedUnits * spotDeliveredUnitCost;
  const surplusUnits = Math.max(0, contractDeliveredUnits - contractUsedUnits);
  const warehouseQuantityAfterUse = Math.max(0, state.fuelWarehouse.quantity - warehouseUsedUnits);
  const availableCapacity = Math.max(0, state.fuelWarehouse.capacity - warehouseQuantityAfterUse);
  const warehouseStoredUnits = state.fuelWarehouse.rented && state.fuelWarehouse.surplusPolicy === "store-first"
    ? Math.min(surplusUnits, availableCapacity)
    : 0;
  const warehouseStoredValue = warehouseStoredUnits * contractAverageUnitCost;
  const surplusSoldUnits = Math.max(0, surplusUnits - warehouseStoredUnits);
  const surplusSoldCost = surplusSoldUnits * contractAverageUnitCost;
  const surplusSaleRevenue = surplusSoldUnits * spotDeliveredUnitCost * FUEL_RESALE_PRICE_RATE;
  const remainingInventoryValue = warehouseQuantityAfterUse * state.fuelWarehouse.averageUnitCost;
  const warehouseQuantity = warehouseQuantityAfterUse + warehouseStoredUnits;
  const warehouseAverageUnitCost = warehouseQuantity > 1e-9
    ? (remainingInventoryValue + warehouseStoredValue) / warehouseQuantity
    : 0;
  const warehouseRent = state.fuelWarehouse.rented
    ? warehouseQuantity * FUEL_WAREHOUSE_RENT_PER_TONNE_DAY
    : 0;
  const consumedCost = contractUsedCost + warehouseUsedValue + spotPurchaseCost;
  return {
    state: {
      ...state,
      fuelContracts: contracts,
      fuelWarehouse: {
        ...state.fuelWarehouse,
        quantity: warehouseQuantity,
        averageUnitCost: warehouseAverageUnitCost,
      },
    },
    consumedUnits,
    consumedCost,
    effectiveUnitCost: consumedUnits > 0 ? consumedCost / consumedUnits : spotDeliveredUnitCost,
    contractDeliveredUnits,
    contractUsedUnits,
    contractCost,
    contractInstallment,
    contractDepositAmortized,
    spotPurchasedUnits,
    spotPurchaseCost,
    warehouseStoredUnits,
    warehouseStoredValue,
    warehouseUsedUnits,
    warehouseUsedValue,
    warehouseRent,
    surplusSoldUnits,
    surplusSoldCost,
    surplusSaleRevenue,
  };
}

function applyPlayerFuelCost(
  campaignDay: CampaignDay,
  scenario: SimulationScenario,
  effectiveUnitCost: number,
): CampaignDay {
  const playerRouteIds = new Set(scenario.routes
    .filter((route) => route.companyId === "player")
    .map((route) => route.id));
  let operatingCostDelta = 0;
  const services = campaignDay.settlement.services.map((service) => {
    const routeId = service.serviceLegId.split(":")[0] ?? "";
    if (!playerRouteIds.has(routeId)) return service;
    const fuelCost = service.fuelUnitsConsumed * effectiveUnitCost;
    const delta = fuelCost - service.costBreakdown.fuel;
    operatingCostDelta += delta;
    const costBreakdown = {
      ...service.costBreakdown,
      fuel: fuelCost,
      total: service.costBreakdown.total + delta,
    };
    return {
      ...service,
      inventoryFuelUnitsUsed: 0,
      inventoryFuelValueUsed: 0,
      operatingCost: service.operatingCost + delta,
      costBreakdown,
      netProfit: service.netProfit - delta,
    };
  });
  const companies = campaignDay.settlement.companies.map((company) => company.companyId === "player"
    ? {
        ...company,
        operatingCost: company.operatingCost + operatingCostDelta,
        operatingProfit: company.operatingProfit - operatingCostDelta,
      }
    : company);
  return {
    ...campaignDay,
    settlement: { ...campaignDay.settlement, services, companies },
  };
}

export function advanceGameDay(
  state: GameState,
  baseScenario: SimulationScenario,
  galaxy: GeneratedGalaxy,
): GameActionResult {
  requirePlaying(state);
  const dispatchedState = applyDueFleetChanges(state, state.day);
  const currentSchedule = buildGameSchedule(dispatchedState, galaxy, baseScenario.shipTypes, 7, baseScenario.events);
  const scheduledState: GameState = {
    ...dispatchedState,
    scheduledFlights: currentSchedule.flights,
    shipLogs: [...dispatchedState.shipLogs, ...currentSchedule.shipLogs]
      .filter((entry, index, entries) => entries.findIndex((candidate) => candidate.id === entry.id) === index)
      .slice(-1_000),
    starportCapacity: currentSchedule.starportCapacity,
  };
  const scenario = gameScenario(baseScenario, galaxy, scheduledState);
  const rawCampaignDay = simulateCampaign(scenario, {
    startDay: state.day,
    numberOfDays: 1,
  }).days[0]!;
  const playerRouteIds = new Set(scenario.routes
    .filter((route) => route.companyId === "player")
    .map((route) => route.id));
  const todayFlights = currentSchedule.flights.filter((flight) =>
    flight.companyId === "player" && Math.floor(flight.departureMinute / 1_440) === scheduledState.day,
  );
  const operatedFlights = todayFlights.filter((flight) => flight.status !== "cancelled");
  const consumedUnits = operatedFlights.reduce((sum, flight) => sum + flight.fuelUnits, 0);
  const automaticContract = applyAutomaticFuelContract(scheduledState, forecastWeeklyFuelDemand(scheduledState, consumedUnits));
  const fuelSettlement = settleFuelDay(automaticContract.state, consumedUnits);
  const operatingState = fuelSettlement.state;
  const campaignDay = applyPlayerFuelCost(rawCampaignDay, scenario, fuelSettlement.effectiveUnitCost);
  const company = campaignDay.settlement.companies.find(
    (candidate) => candidate.companyId === "player",
  );
  const grossRevenue = company?.ticketRevenue ?? 0;
  const serviceModelById = new Map(scenario.routes.filter((route) => route.companyId === "player").flatMap((route) => {
    const type = scenario.shipTypes.find((candidate) => candidate.id === route.shipTypeId);
    if (!type) return [];
    try { return buildRouteServices(route, type, scenario.ports, scenario.worldLegs).map((service) => [service.id, service] as const); }
    catch { return []; }
  }));
  const routeDirectionRevenue = campaignDay.settlement.services
    .filter((service) => playerRouteIds.has(service.serviceLegId.split(":")[0] ?? ""))
    .reduce((map, service) => {
      const routeId = service.serviceLegId.split(":")[0] ?? "";
      const fromPortId = serviceModelById.get(service.serviceLegId)?.fromPortId ?? "unknown";
      const key = `${routeId}:${fromPortId}`;
      map.set(key, (map.get(key) ?? 0) + service.ticketRevenue);
      return map;
    }, new Map<string, number>());
  const revenueForFlight = (flight: ScheduledFlight) => {
    const actualFlights = operatedFlights.filter((candidate) => candidate.routeId === flight.routeId && candidate.fromPortId === flight.fromPortId).length;
    const actualRevenue = routeDirectionRevenue.get(`${flight.routeId}:${flight.fromPortId}`) ?? 0;
    if (actualFlights > 0) return actualRevenue / actualFlights;
    const route = operatingState.routes.find((candidate) => candidate.id === flight.routeId);
    const direction = route?.stops[0]?.portId === flight.fromPortId ? "outbound" : "return";
    const fares = route?.pricing.directionalFareByClass?.[direction] ?? route?.pricing.fareByClass;
    return fares ? PASSENGER_CLASSES.reduce((sum, cabinClass) => sum + fares[cabinClass] * flight.seatsByClass[cabinClass] * 0.7, 0) : 0;
  };
  const cancelledFlights = todayFlights.filter((flight) => flight.status === "cancelled");
  const cancelledBookedRevenue = cancelledFlights.reduce((sum, flight) => sum + revenueForFlight(flight), 0);
  const compensationPaid = operatedFlights.reduce((sum, flight) => sum + revenueForFlight(flight) * flight.compensationRate, 0) + cancelledBookedRevenue;
  const revenue = grossRevenue + cancelledBookedRevenue - compensationPaid;
  const routeOperatingCost = company?.operatingCost ?? 0;
  const delayExtraCost = operatedFlights.reduce((sum, flight) => sum + flight.extraCrewCost + flight.extraPortCost, 0);
  const operatingCost = routeOperatingCost + delayExtraCost + fuelSettlement.surplusSoldCost + fuelSettlement.warehouseRent;
  const accountingNonCashOrEventMaintenance = campaignDay.settlement.services
    .filter((service) => playerRouteIds.has(service.serviceLegId.split(":")[0] ?? ""))
    .reduce((sum, service) => sum + service.costBreakdown.fixedMaintenance + service.costBreakdown.ageSurcharge +
      service.costBreakdown.flightMaintenance + service.costBreakdown.depreciation, 0);
  const cashRouteOperatingCost = Math.max(0, routeOperatingCost - accountingNonCashOrEventMaintenance);
  const overhead = DAILY_COMPANY_OVERHEAD;
  const profit = revenue + fuelSettlement.surplusSaleRevenue - operatingCost - overhead;
  const cashOperatingProfit = revenue + fuelSettlement.surplusSaleRevenue - cashRouteOperatingCost - delayExtraCost -
    fuelSettlement.surplusSoldCost - fuelSettlement.warehouseRent - overhead;
  const cash = operatingState.cash + cashOperatingProfit + fuelSettlement.warehouseUsedValue +
    fuelSettlement.contractDepositAmortized - fuelSettlement.warehouseStoredValue;
  const passengers = company?.passengers ?? 0;
  const totalPassengers =
    operatingState.history.reduce((sum, record) => sum + record.passengers, 0) + passengers;
  const nextDay = operatingState.day + 1;
  const agedFleet = ageFleetAfterDay(operatingState, scenario);
  const automaticMaintenance = applyAutomaticMaintenance(
    agedFleet,
    operatingState.routes,
    scenario,
    nextDay,
    cash,
    operatingState.autoMaintenanceThreshold,
    baseScenario.shipTypes,
  );
  const delivery = deliverShipPurchaseOrders({
    ...operatingState,
    day: nextDay,
    cash: automaticMaintenance.cash,
    fleet: automaticMaintenance.fleet,
  }, baseScenario.shipTypes, nextDay);
  const deliveredOrders = operatingState.shipPurchaseOrders.filter((order) => order.deliveryDay <= nextDay);
  const deliveredCount = deliveredOrders.reduce((sum, order) => sum + order.quantity, 0);
  const replacedCount = deliveredOrders.reduce(
    (sum, order) => sum + (order.replacementShipIds?.length ?? 0),
    0,
  );
  const automaticReplacement = orderAutomaticReplacements(
    { ...delivery.state, routes: operatingState.routes },
    nextDay,
    baseScenario.shipTypes,
  );
  const finalCash = automaticReplacement.state.cash;
  const justCompletedGoal =
    operatingState.primaryGoalCompletedOnDay === null &&
    (finalCash >= CASH_GOAL || totalPassengers >= PASSENGER_GOAL);
  const primaryGoalCompletedOnDay = justCompletedGoal
    ? operatingState.day
    : operatingState.primaryGoalCompletedOnDay;
  const lost = finalCash < 0 || (primaryGoalCompletedOnDay === null && nextDay >= DEADLINE_DAY);
  const routeSummariesForDay = routeSummaries(operatingState, campaignDay, scenario);
  const financialEvents: FlightFinancialEvent[] = [...operatingState.unsettledFinancialEvents, ...operatedFlights.flatMap((flight) => {
    const shipType = baseScenario.shipTypes.find((type) => type.id === flight.shipTypeId);
    const flightHours = Math.max(0, flight.arrivalMinute - flight.departureMinute) / 60;
    const revenuePerFlight = revenueForFlight(flight);
    const events: FlightFinancialEvent[] = [
      { id: `${flight.id}:revenue`, minute: flight.departureMinute, flightId: flight.id, routeId: flight.routeId, kind: "ticket-revenue", amount: revenuePerFlight },
      { id: `${flight.id}:fuel`, minute: flight.departureMinute - 5, flightId: flight.id, routeId: flight.routeId, kind: "fuel-purchase", amount: -flight.fuelUnits * fuelSettlement.effectiveUnitCost },
    ];
    if (shipType) {
      events.push({ id: `${flight.id}:depreciation`, minute: flight.arrivalMinute, flightId: flight.id, routeId: flight.routeId, kind: "depreciation", amount: -shipType.purchasePrice / (8 * 364 * 24) * flightHours });
    }
    if (flight.compensationRate > 0) events.push({ id: `${flight.id}:compensation`, minute: flight.arrivalMinute, flightId: flight.id, routeId: flight.routeId, kind: "delay-compensation", amount: -revenuePerFlight * flight.compensationRate });
    if (flight.extraCrewCost + flight.extraPortCost > 0) events.push({ id: `${flight.id}:delay-cost`, minute: flight.arrivalMinute, flightId: flight.id, routeId: flight.routeId, kind: "delay-extra-cost", amount: -(flight.extraCrewCost + flight.extraPortCost) });
    return events;
  })];
  for (const flight of cancelledFlights) {
    const booked = revenueForFlight(flight);
    financialEvents.push(
      { id: `${flight.id}:revenue`, minute: flight.scheduledDepartureMinute, flightId: flight.id, routeId: flight.routeId, kind: "ticket-revenue", amount: booked },
      { id: `${flight.id}:compensation`, minute: flight.scheduledDepartureMinute, flightId: flight.id, routeId: flight.routeId, kind: "delay-compensation", amount: -booked },
    );
  }
  if (automaticMaintenance.cost > 0) financialEvents.push({
    id: `automatic-maintenance:${operatingState.day}`,
    minute: operatingState.day * 1_440 + 1_435,
    kind: "flight-maintenance",
    amount: -automaticMaintenance.cost,
  });
  const staffCost = routeSummariesForDay.reduce((sum, route) => sum + route.costBreakdown.staff, 0);
  financialEvents.push({ id: `payroll:${operatingState.day}`, minute: operatingState.day * 1_440 + 1_435, kind: "crew-payroll", amount: -staffCost });
  const record: GameDayRecord = {
    day: operatingState.day,
    cash: finalCash,
    revenue,
    operatingCost,
    overhead,
    profit: profit - automaticMaintenance.cost,
    passengers,
    fuelPurchasedUnits: fuelSettlement.spotPurchasedUnits,
    fuelPurchaseCost: fuelSettlement.spotPurchaseCost,
    fuelInventoryUsedUnits: fuelSettlement.warehouseUsedUnits,
    fuelConsumedUnits: fuelSettlement.consumedUnits,
    fuelContractDeliveredUnits: fuelSettlement.contractDeliveredUnits,
    fuelContractUsedUnits: fuelSettlement.contractUsedUnits,
    fuelContractCost: fuelSettlement.contractCost,
    fuelContractInstallment: fuelSettlement.contractInstallment,
    fuelContractDepositAmortized: fuelSettlement.contractDepositAmortized,
    fuelSpotPurchasedUnits: fuelSettlement.spotPurchasedUnits,
    fuelSpotPurchaseCost: fuelSettlement.spotPurchaseCost,
    fuelWarehouseStoredUnits: fuelSettlement.warehouseStoredUnits,
    fuelWarehouseUsedUnits: fuelSettlement.warehouseUsedUnits,
    fuelWarehouseRent: fuelSettlement.warehouseRent,
    fuelSurplusSoldUnits: fuelSettlement.surplusSoldUnits,
    fuelSurplusSaleRevenue: fuelSettlement.surplusSaleRevenue,
    fuelEffectiveUnitCost: fuelSettlement.effectiveUnitCost,
    activeEventIds: campaignDay.activeEventIds,
    announcedEventIds: campaignDay.announcedEventIds,
    routes: routeSummariesForDay,
    flightsOperated: operatedFlights.length,
    flightsCancelled: todayFlights.length - operatedFlights.length,
    delayedFlights: operatedFlights.filter((flight) => flight.delayMinutes > 0).length,
    compensationPaid,
    financialEvents,
  };
  const positionedFleet = automaticReplacement.state.fleet.map((ship) => {
    const latestArrival = currentSchedule.flights
      .filter((flight) => flight.shipId === ship.id && flight.arrivalMinute < nextDay * 1_440)
      .sort((left, right) => right.arrivalMinute - left.arrivalMinute)[0];
    return latestArrival ? { ...ship, currentPortId: latestArrival.toPortId } : ship;
  });
  const nextOperationalState = applyDueFleetChanges({
    ...automaticReplacement.state,
    day: nextDay,
      routes: automaticReplacement.state.routes.map((route) => todayFlights.some((flight) => flight.routeId === route.id && flight.status !== "cancelled")
        ? { ...route, confirmedLongTermSlots: true }
        : route),
    fleet: positionedFleet,
  }, nextDay);
  const punctuality = todayFlights.length > 0 ? todayFlights.filter((flight) => flight.onTime).length / todayFlights.length : 0.92;
  const cancellationRate = todayFlights.length > 0 ? todayFlights.filter((flight) => flight.status === "cancelled").length / todayFlights.length : 0;
  const reputationDelta = (punctuality - 0.85) * 1.2 - cancellationRate * 4;
  const companyReputation = clamp(automaticReplacement.state.companyReputation + reputationDelta, 0, 100);
  const localReputation = { ...automaticReplacement.state.localReputation };
  for (const port of galaxy.ports) {
    const portFlights = todayFlights.filter((flight) => flight.fromPortId === port.id || flight.toPortId === port.id);
    if (portFlights.length === 0) continue;
    const localOnTime = portFlights.filter((flight) => flight.onTime).length / portFlights.length;
    const localCancelled = portFlights.filter((flight) => flight.status === "cancelled").length / portFlights.length;
    localReputation[port.id] = clamp((localReputation[port.id] ?? companyReputation) + (localOnTime - 0.85) * 1.5 - localCancelled * 5, 0, 100);
  }
  const nextSchedule = buildGameSchedule(nextOperationalState, galaxy, baseScenario.shipTypes, 7, baseScenario.events);
  return {
    state: {
      ...operatingState,
      day: nextDay,
      cash: finalCash,
      fleet: nextOperationalState.fleet,
      routes: nextOperationalState.routes,
      shipPurchaseOrders: automaticReplacement.state.shipPurchaseOrders,
      nextShipNumber: delivery.state.nextShipNumber,
      nextPurchaseAgreementNumber: automaticReplacement.state.nextPurchaseAgreementNumber,
      shipyardMarket: refreshShipyardMarket(automaticReplacement.state, baseScenario.shipTypes, nextDay),
      history: [...operatingState.history, record].slice(-90),
      fuelMarket: [...operatingState.fuelMarket, fuelPriceRecord(galaxy, nextDay)].slice(-360),
      status: lost ? "lost" : "playing",
      primaryGoalCompletedOnDay,
      pendingFleetChanges: nextOperationalState.pendingFleetChanges,
      companyReputation,
      localReputation,
      unsettledFinancialEvents: [],
      scheduledFlights: nextSchedule.flights,
      starportCapacity: nextSchedule.starportCapacity,
      shipLogs: scheduledState.shipLogs,
    },
    message: replacedCount > 0
      ? `船厂今日交付并自动替换 ${replacedCount} 艘到龄舰船；航线与客舱方案已转移到新船。`
      : automaticReplacement.orderedShipNames.length > 0
      ? `已为 ${automaticReplacement.orderedShipNames.length} 艘到龄舰船订购同型号新船；旧船将在交付前继续运营。${automaticReplacement.deferredCount > 0 ? ` 另有 ${automaticReplacement.deferredCount} 艘因资金不足等待采购。` : ""}`
      : automaticReplacement.deferredCount > 0
      ? `${automaticReplacement.deferredCount} 艘舰船已到更新船龄，但资金不足；旧船继续运营并将在后续每日重试采购。`
      : deliveredCount > 0
      ? `船厂今日交付 ${deliveredCount} 艘舰船；请为新船分配统一配置方案。`
      : automaticContract.signedWeeklyUnits > 0
      ? `燃料价格达到自动签约条件，已新增每周 ${automaticContract.signedWeeklyUnits.toFixed(0)} t 的燃料合约并支付定金。`
      : automaticMaintenance.maintainedShipNames.length > 0
      ? `${automaticMaintenance.maintainedShipNames.join("、")} 返抵主基地，维护值已低于 ${state.autoMaintenanceThreshold}% 阈值并自动进场维护。`
      : justCompletedGoal
      ? "初级经营目标达成！公司进入自由经营阶段，游戏将继续进行。"
      : lost
        ? "公司未能维持经营，本局结束。"
        : `第 ${state.day} 日结算完成：${profit >= 0 ? "盈利" : "亏损"} ${Math.abs(profit).toFixed(0)} Cr`,
  };
}
