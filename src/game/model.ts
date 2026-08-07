import type { ScheduledFlight, ShipLogEntry, StarportCapacityDay } from "../scheduling.js";
import type {
  CabinConfiguration,
  GalaxyGenerationConfig,
  PassengerEvaluation,
  PassengerType,
  Route,
  RouteCostBreakdown,
  ShipBuildConfiguration,
  TravelMode,
} from "../types.js";

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

export function requirePlaying(state: GameState): void {
  if (state.status !== "playing") throw new Error("公司已经破产，请开始新游戏");
}
