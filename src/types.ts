export type PassengerClass = "economy" | "business" | "premium";
/** 旅客出行目的/偏好；与购买的客舱产品 PassengerClass 严格分离。 */
export type PassengerType = "business" | "leisure" | "budget" | "luxury";
export type TravelMode = "sublight" | "warp" | "hyperspace";
export type CabinConfiguration = Record<PassengerClass, number>;

export const PASSENGER_CLASSES: readonly PassengerClass[] = [
  "economy",
  "business",
  "premium",
];

export const PASSENGER_TYPES: readonly PassengerType[] = [
  "business",
  "leisure",
  "budget",
  "luxury",
];

export interface Starport {
  id: string;
  systemId: string;
  name: string;
  population: number;
  populationMillions?: number;
  economy: number;
  business: number;
  tourism: number;
  administration: number;
  portLevel: 1 | 2 | 3 | 4 | 5;
  dailyCapacity: number;
  fuelPrice: number;
  serviceFee: number;
}

export interface StarSystem {
  id: string;
  name: string;
  x: number;
  y: number;
  spectralClass: "O" | "B" | "A" | "F" | "G" | "K" | "M";
  inhabited: boolean;
  navigationNodeId: string;
  hubPortId: string | null;
}

export interface SystemStar {
  id: string;
  spectralClass: StarSystem["spectralClass"];
  relativeSize: number;
  offsetX: number;
  offsetY: number;
}

export type PlanetType =
  | "terrestrial"
  | "super-earth"
  | "rocky"
  | "ocean"
  | "desert"
  | "ice"
  | "volcanic"
  | "gas-giant"
  | "ice-giant"
  | "dwarf";

export type EconomyType =
  | "none"
  | "diversified"
  | "industrial"
  | "commercial"
  | "tourism"
  | "mining"
  | "agricultural"
  | "research"
  | "administrative";

export interface SystemMoon {
  id: string;
  name: string;
  type: "rocky" | "ice" | "volcanic" | "ocean";
  orbitRadius: number;
  orbitalAngle: number;
  orbitalPeriodDays: number;
  rotationPeriodHours: number;
  rotationAngle: number;
  axialTiltDegrees: number;
  relativeSize: number;
  inhabited: boolean;
  populationMillions: number;
  colony: boolean;
  development: number;
  economyType: EconomyType;
}

export interface SystemPlanet {
  id: string;
  name: string;
  type: PlanetType;
  orbitRadius: number;
  orbitalAngle: number;
  orbitalPeriodDays: number;
  rotationPeriodHours: number;
  rotationAngle: number;
  axialTiltDegrees: number;
  relativeSize: number;
  inhabited: boolean;
  populationMillions: number;
  colony: boolean;
  development: number;
  economyType: EconomyType;
  hasRings: boolean;
  ringTilt: number;
  moons: readonly SystemMoon[];
}

export interface StarportSystemLocation {
  portId: string;
  hostPlanetId: string | null;
  hostMoonId: string | null;
  kind: "surface" | "orbital" | "deep-space";
  orbitalAngle: number;
}

export interface PlanetarySystemDetails {
  systemId: string;
  stars: readonly SystemStar[];
  planets: readonly SystemPlanet[];
  starportLocations: readonly StarportSystemLocation[];
}

export type GalaxyShape = "disc" | "spiral" | "clusters";
export type HyperspaceTopology = "web" | "radial" | "ring" | "mixed";

export interface GalaxyGenerationConfig {
  seed: string;
  systemCount: number;
  starportCount: number;
  shape: GalaxyShape;
  topology: HyperspaceTopology;
  laneDensity: number;
}

export interface GeneratedGalaxy {
  config: GalaxyGenerationConfig;
  systems: readonly StarSystem[];
  systemDetails: Readonly<Record<string, PlanetarySystemDetails>>;
  ports: readonly Starport[];
  systemLanes: readonly SystemLane[];
  worldLegs: readonly WorldLeg[];
}

export interface SystemLane {
  id: string;
  fromSystemId: string;
  toSystemId: string;
  mode: Extract<TravelMode, "warp" | "hyperspace">;
  distance: number;
}

export interface WorldLeg {
  id: string;
  fromPortId: string;
  toPortId: string;
  mode: TravelMode;
  distance: number;
  hazard: number;
  timeModifier: number;
  fuelModifier: number;
  isOpen: boolean;
}

export interface ShipType {
  id: string;
  name: string;
  manufacturer: string;
  familyId: string;
  familyName: string;
  variant: string;
  description: string;
  structuralMassTonnes: number;
  fuelCapacityTonnes: number;
  fixedMaintenanceCostPerDay: number;
  /** 可用于客舱的空间单位；经济/商务/头等座分别占用 1/3/6 单位。 */
  cabinSpace: number;
  /** 标准宣传布局的总座位数，玩家自有船只仍从空舱开始配置。 */
  seats: number;
  purchasePrice: number;
  supportedModes: readonly TravelMode[];
  speedByMode: Partial<Record<TravelMode, number>>;
  maxRangeByMode: Partial<Record<TravelMode, number>>;
  fuelPerDistanceByMode: Partial<Record<TravelMode, number>>;
  maintenancePerFlightHour: number;
  crewCostPerFlightHour: number;
  reliability: number;
  comfort: number;
  minimumPortLevel: 1 | 2 | 3 | 4 | 5;
  turnaroundHours: number;
  operationalAvailability: number;
}

export interface RouteStop {
  portId: string;
  stopType: "commercial" | "technical";
  minimumStopHours: number;
}

export interface RoutePricing {
  multiplier: number;
  passengerClassMultiplier: Record<PassengerClass, number>;
  /** 玩家设置的单程绝对票价；未提供时使用旧版倍率定价。 */
  fareByClass?: Record<PassengerClass, number>;
}

export interface RouteEconomics {
  fixedMaintenancePerDay: number;
  ageSurchargePerDay: number;
  depreciationPerDay: number;
  expectedDelayCostPerDay: number;
}

export interface Route {
  id: string;
  companyId: string;
  name: string;
  kind: "return" | "loop";
  routingMode?: Extract<TravelMode, "warp" | "hyperspace">;
  stops: readonly RouteStop[];
  shipTypeId: string;
  assignedShips: number;
  /** 玩家所分配舰船的平均每班客舱容量。 */
  cabinCapacityByClass?: CabinConfiguration;
  /** 玩家舰队按船龄修正后的平均舒适度。 */
  effectiveComfort?: number;
  pricing: RoutePricing;
  economics?: RouteEconomics;
  maintenanceAllowanceHours: number;
  active: boolean;
}

export interface ServiceLeg {
  id: string;
  routeId: string;
  companyId: string;
  fromPortId: string;
  toPortId: string;
  modePath: readonly TravelMode[];
  distance: number;
  inVehicleHours: number;
  destinationDwellHours: number;
  departuresPerWeek: number;
  seatsPerDeparture: number;
  dailySeatCapacity: number;
  seatsPerDepartureByClass?: CabinConfiguration;
  dailySeatCapacityByClass?: CabinConfiguration;
  fuelConsumptionPerDepartureEmpty?: number;
  fuelConsumptionPerDepartureFull?: number;
  fuelLoadPerDepartureEmpty?: number;
  fuelLoadPerDepartureFull?: number;
  fuelMarketPrice?: number;
  fuelDeliveredUnitCost?: number;
  operatingCostPerPassenger?: number;
  fareByClass: Record<PassengerClass, number>;
  comfort: number;
  reputation: number;
  onTimeRate: number;
  satisfactionByClass: Record<PassengerClass, number>;
  satisfactionByPassengerType?: Record<PassengerType, number>;
  baseCostBreakdown?: RouteCostBreakdown;
  dailyOperatingCost: number;
}

export interface JourneyOption {
  id: string;
  originPortId: string;
  destinationPortId: string;
  passengerType: PassengerType;
  cabinClass: PassengerClass;
  serviceLegIds: readonly string[];
  companies: readonly string[];
  fare: number;
  fareByServiceLeg: readonly number[];
  inVehicleHours: number;
  expectedWaitHours: number;
  transferHours: number;
  transferCount: number;
  comfort: number;
  reputation: number;
  onTimeRate: number;
  satisfaction: number;
}

export interface MarketKey {
  originPortId: string;
  destinationPortId: string;
  passengerType: PassengerType;
}

export interface MarketDemand extends MarketKey {
  potentialPassengers: number;
  referenceTimeHours: number;
  acceptableFare: number;
}

export interface ChoiceWeights {
  fare: number;
  time: number;
  wait: number;
  transfer: number;
  comfort: number;
  reputation: number;
  reliability: number;
  satisfaction: number;
}

export interface ChoiceParameters {
  weights: Record<PassengerType, ChoiceWeights>;
  temperature: Record<PassengerType, number>;
  noTravelCost: Record<PassengerType, number>;
  cabinPreference: Record<PassengerType, Record<PassengerClass, number>>;
}

export interface DemandParameters {
  classScale: Record<PassengerType, number>;
  timeScaleHours: Record<PassengerType, number>;
  distancePower: Record<PassengerType, number>;
  acceptableFareMultiplier: Record<PassengerType, number>;
  baseBoardingFare: number;
  farePerDistance: number;
  farePerReferenceHour: number;
}

export interface ChoiceRequest {
  market: MarketDemand;
  options: readonly JourneyOption[];
  requestedByOption: ReadonlyMap<string, number>;
  initialNoTravel: number;
}

export interface AllocatedJourney {
  market: MarketDemand;
  option: JourneyOption;
  requestedPassengers: number;
  actualPassengers: number;
}

export interface ServiceSettlement {
  serviceLegId: string;
  capacity: number;
  passengers: number;
  loadFactor: number;
  capacityByClass: CabinConfiguration;
  passengersByClass: CabinConfiguration;
  loadFactorByClass: CabinConfiguration;
  revenueByClass: CabinConfiguration;
  passengersByType: Record<PassengerType, number>;
  satisfaction: number;
  ticketRevenue: number;
  fuelUnitsConsumed: number;
  inventoryFuelUnitsUsed: number;
  inventoryFuelValueUsed: number;
  operatingCost: number;
  costBreakdown: RouteCostBreakdown;
  netProfit: number;
}

export interface RouteCostBreakdown {
  fuel: number;
  staff: number;
  port: number;
  flightMaintenance: number;
  fixedMaintenance: number;
  ageSurcharge: number;
  depreciation: number;
  delay: number;
  other: number;
  total: number;
}

export interface SatisfactionReason {
  code: string;
  text: string;
  impact: number;
  positive: boolean;
}

export interface PassengerEvaluation {
  passengerType: PassengerType;
  satisfaction: number;
  passengers: number;
  positiveReasons: readonly SatisfactionReason[];
  negativeReasons: readonly SatisfactionReason[];
}

export interface CompanySettlement {
  companyId: string;
  passengers: number;
  ticketRevenue: number;
  operatingCost: number;
  operatingProfit: number;
}

export interface MarketSettlement {
  market: MarketDemand;
  actualPassengers: number;
  initialNoTravelPassengers: number;
  capacityLostPassengers: number;
  priceLostPassengers: number;
  passengersByClass: CabinConfiguration;
  evaluation: PassengerEvaluation;
  journeys: readonly AllocatedJourney[];
}

export interface DaySettlement {
  markets: readonly MarketSettlement[];
  services: readonly ServiceSettlement[];
  companies: readonly CompanySettlement[];
}

export interface MarketEvent {
  id: string;
  name: string;
  description: string;
  announcedOnDay: number;
  startsOnDay: number;
  endsOnDay: number;
  recoveryDays: number;
  affectedPortIds: readonly string[];
  demandModifiers: Partial<Record<PassengerType, number>>;
  fuelPriceModifier?: number;
  portCapacityModifier?: number;
  travelTimeModifier?: number;
}

export interface SimulationScenario {
  id: string;
  name: string;
  seed: number;
  ports: readonly Starport[];
  worldLegs: readonly WorldLeg[];
  shipTypes: readonly ShipType[];
  routes: readonly Route[];
  companyReputation: Readonly<Record<string, number>>;
  shipConditionByRoute?: Readonly<Record<string, number>>;
  events: readonly MarketEvent[];
}

export interface CampaignDay {
  day: number;
  announcedEventIds: readonly string[];
  activeEventIds: readonly string[];
  settlement: DaySettlement;
}

export interface CampaignCompanySummary extends CompanySettlement {
  averageDailyPassengers: number;
}

export interface CampaignResult {
  startDay: number;
  endDay: number;
  days: readonly CampaignDay[];
  companies: readonly CampaignCompanySummary[];
}
