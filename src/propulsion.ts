import {
  type CabinConfiguration,
  type FtlDriveModel,
  type FtlEfficiencyCurvePoint,
  type MissionPhasePerformance,
  type OptionalModule,
  type ResolvedShipPerformance,
  type ShipBuildConfiguration,
  type ShipHullVariant,
  type ShipType,
  type SublightEngineModel,
} from "./types.js";
import {
  ASTRONOMICAL_UNIT_KM,
  cabinInstallationMass,
  PASSENGER_AND_BAGGAGE_MASS_TONNES,
} from "./fuel.js";

export const LIGHT_SPEED_METERS_PER_SECOND = 299_792_458;
export const STANDARD_SUBLIGHT_DISTANCE_AU = 0.15;
export const STANDARD_MASS_ENERGY_CONVERSION_EFFICIENCY = 0.00394;
export const STANDARD_SUBLIGHT_RETENTION = 0.96359205;
export const STANDARD_SINGLE_BURN_RETENTION = 0.98162725;
export const STANDARD_FTL_K_PER_LIGHT_YEAR = 0.00618973;
export const STANDARD_FTL_SPEED_LY_PER_DAY = 6;
export const STANDARD_ECONOMY_THRUST_RATIO = 0.8;
export const STANDARD_TARGET_SPEED_KM_PER_SECOND = Number((
  -0.07 * LIGHT_SPEED_METERS_PER_SECOND / 2 / 1_000 * Math.log(STANDARD_SUBLIGHT_RETENTION)
).toFixed(6));

export const SUBLIGHT_ENGINE_MODELS: readonly SublightEngineModel[] = [
  {
    id: "helios-pf-860", manufacturer: "Helios Propulsion", family: "PF", model: "PF-215",
    installationClass: 3, massTonnes: 20, price: 61_250, fixedMaintenanceCostPerDay: 70,
    maintenancePerFlightHour: 8.5, maximumThrustMN: 2.15, maximumContinuousThrustMN: 1.935,
    optimalThrustRatio: 0.68, economyThrustRatio: 0.8,
    directionalEfficiencyCurve: [
      { ratio: 0.5, efficiency: 0.56 }, { ratio: 0.68, efficiency: 0.65 },
      { ratio: 0.8, efficiency: 0.622 }, { ratio: 0.9, efficiency: 0.58 }, { ratio: 1, efficiency: 0.5 },
    ], reliability: 0.968, highThrustWear: 0.16,
  },
  {
    id: "frontier-tf-420", manufacturer: "边疆联合动力", family: "TF", model: "TF-205E",
    installationClass: 1, massTonnes: 14.667, price: 42_666.67, fixedMaintenanceCostPerDay: 50,
    maintenancePerFlightHour: 7.667, maximumThrustMN: 1.9, maximumContinuousThrustMN: 1.65,
    optimalThrustRatio: 0.62, economyThrustRatio: 0.74,
    directionalEfficiencyCurve: [
      { ratio: 0.5, efficiency: 0.6 }, { ratio: 0.62, efficiency: 0.66 },
      { ratio: 0.74, efficiency: 0.64 }, { ratio: 0.9, efficiency: 0.55 }, { ratio: 1, efficiency: 0.49 },
    ], reliability: 0.955, highThrustWear: 0.12,
  },
  {
    id: "vector-sprint-1120", manufacturer: "矢量动力集团", family: "Sprint", model: "Sprint-230",
    installationClass: 4, massTonnes: 17.667, price: 68_333.33, fixedMaintenanceCostPerDay: 76.667,
    maintenancePerFlightHour: 8.667, maximumThrustMN: 3.3, maximumContinuousThrustMN: 2.84,
    optimalThrustRatio: 0.72, economyThrustRatio: 0.84,
    directionalEfficiencyCurve: [
      { ratio: 0.5, efficiency: 0.52 }, { ratio: 0.72, efficiency: 0.63 },
      { ratio: 0.84, efficiency: 0.6 }, { ratio: 0.92, efficiency: 0.55 }, { ratio: 1, efficiency: 0.48 },
    ], reliability: 0.975, highThrustWear: 0.22,
  },
  {
    id: "atlas-titan-2480", manufacturer: "阿特拉斯重工", family: "Titan", model: "Titan-225E",
    installationClass: 5, massTonnes: 71.667, price: 240_000, fixedMaintenanceCostPerDay: 260,
    maintenancePerFlightHour: 27.333, maximumThrustMN: 7.5, maximumContinuousThrustMN: 7.2,
    optimalThrustRatio: 0.64, economyThrustRatio: 0.78,
    directionalEfficiencyCurve: [
      { ratio: 0.5, efficiency: 0.58 }, { ratio: 0.64, efficiency: 0.65 },
      { ratio: 0.78, efficiency: 0.62 }, { ratio: 0.9, efficiency: 0.56 }, { ratio: 1, efficiency: 0.5 },
    ], reliability: 0.985, highThrustWear: 0.08,
  },
  {
    id: "dawn-orbital-180", manufacturer: "曙光轨道工业", family: "Orbital", model: "Orbital-200L",
    installationClass: 1, massTonnes: 4.5, price: 14_500, fixedMaintenanceCostPerDay: 18,
    maintenancePerFlightHour: 3, maximumThrustMN: 1, maximumContinuousThrustMN: 0.8,
    optimalThrustRatio: 0.65, economyThrustRatio: 0.76,
    directionalEfficiencyCurve: [
      { ratio: 0.5, efficiency: 0.58 }, { ratio: 0.65, efficiency: 0.64 },
      { ratio: 0.76, efficiency: 0.62 }, { ratio: 0.9, efficiency: 0.54 }, { ratio: 1, efficiency: 0.48 },
    ], reliability: 0.974, highThrustWear: 0.1,
  },
];

function ftlCurve(optimalSpeed: number, maximumSpeed: number, bestK: number): readonly FtlEfficiencyCurvePoint[] {
  return [
    { speedLyPerDay: optimalSpeed * 0.72, kPerLightYear: bestK * 1.045 },
    { speedLyPerDay: optimalSpeed, kPerLightYear: bestK },
    { speedLyPerDay: (optimalSpeed + maximumSpeed) / 2, kPerLightYear: bestK * 1.055 },
    { speedLyPerDay: maximumSpeed, kPerLightYear: bestK * 1.16 },
  ];
}

export const FTL_DRIVE_MODELS: readonly FtlDriveModel[] = [
  {
    id: "meridian-hs6-reference", mode: "hyperspace", manufacturer: "子午线航天", family: "HS", model: "6 Reference",
    installationClass: 3, massTonnes: 90, price: 520_000, fixedMaintenanceCostPerDay: 520,
    maintenancePerFlightHour: 42, minimumSpeedLyPerDay: 3.8, optimalSpeedLyPerDay: 5.2,
    maximumSpeedLyPerDay: 6, efficiencyCurve: [
      { speedLyPerDay: 3.8, kPerLightYear: 0.00642 }, { speedLyPerDay: 5.2, kPerLightYear: 0.00598 },
      { speedLyPerDay: 6, kPerLightYear: STANDARD_FTL_K_PER_LIGHT_YEAR },
    ], reliability: 0.962, highSpeedWear: 0.18, minimumPortLevel: 3,
  },
  {
    id: "horizon-hs4-economy", mode: "hyperspace", manufacturer: "地平线公共交通", family: "Commons", model: "4E",
    installationClass: 2, massTonnes: 62, price: 300_000, fixedMaintenanceCostPerDay: 310,
    maintenancePerFlightHour: 28, minimumSpeedLyPerDay: 3.1, optimalSpeedLyPerDay: 4.1,
    maximumSpeedLyPerDay: 4.8, efficiencyCurve: ftlCurve(4.1, 4.8, 0.00578),
    reliability: 0.954, highSpeedWear: 0.12, minimumPortLevel: 2,
  },
  {
    id: "aurora-hs7-sprint", mode: "hyperspace", manufacturer: "极光航行器公司", family: "Sprint", model: "7S",
    installationClass: 4, massTonnes: 118, price: 760_000, fixedMaintenanceCostPerDay: 820,
    maintenancePerFlightHour: 68, minimumSpeedLyPerDay: 4.6, optimalSpeedLyPerDay: 5.8,
    maximumSpeedLyPerDay: 6.8, efficiencyCurve: ftlCurve(5.8, 6.8, 0.00648),
    reliability: 0.971, highSpeedWear: 0.28, minimumPortLevel: 3,
  },
  {
    id: "frontier-w2-economy", mode: "warp", manufacturer: "边疆联合动力", family: "Trail", model: "W2E",
    installationClass: 1, massTonnes: 58, price: 270_000, fixedMaintenanceCostPerDay: 270,
    maintenancePerFlightHour: 25, minimumSpeedLyPerDay: 1.3, optimalSpeedLyPerDay: 1.9,
    maximumSpeedLyPerDay: 2.5, efficiencyCurve: ftlCurve(1.9, 2.5, 0.00582),
    reliability: 0.951, highSpeedWear: 0.1, minimumPortLevel: 1,
  },
  {
    id: "vector-w4-direct", mode: "warp", manufacturer: "矢量动力集团", family: "Direct", model: "W4",
    installationClass: 3, massTonnes: 104, price: 590_000, fixedMaintenanceCostPerDay: 610,
    maintenancePerFlightHour: 55, minimumSpeedLyPerDay: 2.2, optimalSpeedLyPerDay: 3,
    maximumSpeedLyPerDay: 3.9, efficiencyCurve: ftlCurve(3, 3.9, 0.00652),
    reliability: 0.973, highSpeedWear: 0.24, minimumPortLevel: 3,
  },
  {
    id: "atlas-hs5-heavy", mode: "hyperspace", manufacturer: "阿特拉斯重工", family: "Titan", model: "HS5",
    installationClass: 5, massTonnes: 235, price: 1_100_000, fixedMaintenanceCostPerDay: 1_260,
    maintenancePerFlightHour: 96, minimumSpeedLyPerDay: 3.7, optimalSpeedLyPerDay: 4.8,
    maximumSpeedLyPerDay: 5.7, efficiencyCurve: ftlCurve(4.8, 5.7, 0.00602),
    reliability: 0.948, highSpeedWear: 0.2, minimumPortLevel: 4,
  },
];

export const OPTIONAL_MODULES: readonly OptionalModule[] = [
  { id: "navigation-ai", name: "高级导航 AI", effect: "navigation-ai", installationClass: 1, massTonnes: 4, price: 82_000, fixedMaintenanceCostPerDay: 45, crewMultiplier: 0.9, reliabilityBonus: 0.004 },
  { id: "predictive-maintenance", name: "预测性维护系统", effect: "predictive-maintenance", installationClass: 2, massTonnes: 7, price: 110_000, fixedMaintenanceCostPerDay: 62, reliabilityBonus: 0.012 },
  { id: "automated-ground-interface", name: "自动地勤接口", effect: "automated-ground-interface", installationClass: 2, massTonnes: 6, price: 76_000, fixedMaintenanceCostPerDay: 36, turnaroundMultiplier: 0.84 },
  { id: "high-capacity-radiator", name: "高容量散热系统", effect: "high-capacity-radiator", installationClass: 3, massTonnes: 13, price: 145_000, fixedMaintenanceCostPerDay: 88, highSpeedWearMultiplier: 0.72 },
  { id: "extended-fuel-tank", name: "扩展燃料舱", effect: "extended-fuel-tank", installationClass: 2, massTonnes: 18, price: 95_000, fixedMaintenanceCostPerDay: 42, fuelCapacityBonusTonnes: 70, cabinSpaceDelta: -18, turnaroundMultiplier: 1.06 },
  { id: "redundant-drive", name: "冗余驱动系统", effect: "redundant-drive", installationClass: 3, massTonnes: 24, price: 210_000, fixedMaintenanceCostPerDay: 135, reliabilityBonus: 0.018 },
  { id: "quick-change-engine-bay", name: "快拆引擎舱", effect: "quick-change-engine-bay", installationClass: 2, massTonnes: 9, price: 105_000, fixedMaintenanceCostPerDay: 58, reliabilityBonus: 0.006 },
  { id: "premium-cabin-environment", name: "高级客舱环境系统", effect: "premium-cabin-environment", installationClass: 2, massTonnes: 12, price: 135_000, fixedMaintenanceCostPerDay: 70, cabinSpaceDelta: -12, comfortBonus: 8 },
];

export const STANDARD_REFERENCE_HULL: ShipHullVariant = {
  id: "reference-medium-500", familyId: "reference-medium", name: "标准中程 500",
  installationClass: 3, structureMassTonnes: 300, fuelCapacityTonnes: 500,
  maximumTakeoffMassTonnes: 1_000, sublightEngineCount: 4, ftlDriveSlots: 1,
  optionalModuleSlots: 2, cabinSpace: 200, basePrice: 1_400_000, deliveryDays: 45,
  fixedMaintenanceCostPerDay: 1_900, minimumPortLevel: 3,
};

export const STANDARD_REFERENCE_BUILD: ShipBuildConfiguration = {
  hullVariantId: STANDARD_REFERENCE_HULL.id,
  sublightEngineModelId: "helios-pf-860",
  ftlDriveModelId: "meridian-hs6-reference",
  optionalModuleIds: [], cabins: { economy: 200, business: 0, premium: 0 },
  destinationReserveTonnes: 0,
};

export interface ResolveMissionInput {
  build: ShipBuildConfiguration;
  hull: ShipHullVariant;
  distanceLightYears: number;
  passengerCount?: number;
  additionalPayloadTonnes?: number;
  ftlSpeedLyPerDay?: number;
  thrustRatio?: number;
  targetSublightSpeedKmPerSecond?: number;
  /** One-way physical-space distance from the origin port to the FTL entry point. */
  departureSublightDistanceAu?: number;
  /** One-way physical-space distance from the FTL exit point to the destination port. */
  arrivalSublightDistanceAu?: number;
  /** @deprecated Use separate departure/arrival distances. */
  sublightDistanceAu?: number;
  destinationReserveTonnes?: number;
  sublightEngines?: readonly SublightEngineModel[];
  ftlDrives?: readonly FtlDriveModel[];
  optionalModules?: readonly OptionalModule[];
}

const FAMILY_FUEL_RATIO: Readonly<Record<string, number>> = {
  "frontier-pioneer": 0.685,
  "vector-fast": 0.84,
  "meridian-mainline": 1,
  "atlas-grand": 0.99,
  "celestial-yacht": 0.86,
  "aurora-clipper": 0.88,
  "horizon-coach": 1.02,
  "odyssey-sleeper": 1.2,
};

function installationClassForMass(massTonnes: number): 1 | 2 | 3 | 4 | 5 {
  if (massTonnes < 140) return 1;
  if (massTonnes < 340) return 2;
  if (massTonnes < 720) return 3;
  if (massTonnes < 1_300) return 4;
  return 5;
}

export const SUBLIGHT_ENGINE_COUNT_BY_FAMILY: Readonly<Record<string, number>> = {
  "frontier-pioneer": 3,
  "vector-fast": 4,
  "meridian-mainline": 4,
  "atlas-grand": 3,
  "celestial-yacht": 2,
  "aurora-clipper": 4,
  "horizon-coach": 6,
  "odyssey-sleeper": 5,
};

export function sublightEngineCountForFamily(familyId: string): number {
  return SUBLIGHT_ENGINE_COUNT_BY_FAMILY[familyId] ?? 4;
}

export function defaultSublightEngineForHull(hull: Pick<ShipHullVariant, "installationClass">): SublightEngineModel {
  const preferred = hull.installationClass === 1 ? "dawn-orbital-180"
    : hull.installationClass === 2 ? "frontier-tf-420"
      : hull.installationClass === 3 ? "helios-pf-860"
        : hull.installationClass === 4 ? "vector-sprint-1120"
          : "atlas-titan-2480";
  return SUBLIGHT_ENGINE_MODELS.find((engine) => engine.id === preferred)!;
}

export function defaultFtlDriveForShipType(ship: ShipType, hull: Pick<ShipHullVariant, "installationClass">): FtlDriveModel | undefined {
  const mode = ship.supportedModes.find((candidate) => candidate !== "sublight");
  if (mode === "warp") {
    return FTL_DRIVE_MODELS.find((drive) => drive.id === (hull.installationClass <= 2 ? "frontier-w2-economy" : "vector-w4-direct"));
  }
  if (mode === "hyperspace") {
    const id = hull.installationClass <= 2 ? "horizon-hs4-economy"
      : hull.installationClass === 3 ? "meridian-hs6-reference"
        : hull.installationClass === 4 ? "aurora-hs7-sprint" : "atlas-hs5-heavy";
    return FTL_DRIVE_MODELS.find((drive) => drive.id === id);
  }
  return undefined;
}

/** Recalibrates a legacy catalog identity into a v0.7 hull whose aggregate fields are projections only. */
export function projectShipTypeToV07(ship: ShipType): ShipType {
  const operatingDryMass = Math.max(55, ship.structuralMassTonnes);
  const installationClass = installationClassForMass(operatingDryMass);
  const fuelRatio = FAMILY_FUEL_RATIO[ship.familyId] ?? 0.95;
  const fuelCapacity = Math.round(operatingDryMass * fuelRatio * 10) / 10;
  const provisionalHull: ShipHullVariant = {
    id: `${ship.id}-hull`, familyId: ship.familyId, name: `${ship.name} 船体`, installationClass,
    structureMassTonnes: operatingDryMass, fuelCapacityTonnes: fuelCapacity,
    maximumTakeoffMassTonnes: operatingDryMass + fuelCapacity,
    sublightEngineCount: sublightEngineCountForFamily(ship.familyId),
    ftlDriveSlots: ship.supportedModes.some((mode) => mode !== "sublight") ? 1 : 0,
    optionalModuleSlots: installationClass <= 2 ? 2 : installationClass <= 4 ? 3 : 4,
    cabinSpace: ship.cabinSpace, basePrice: ship.purchasePrice * 0.62,
    deliveryDays: Math.max(7, Math.round(10 + operatingDryMass / 24)),
    fixedMaintenanceCostPerDay: ship.fixedMaintenanceCostPerDay * 0.58,
    minimumPortLevel: ship.minimumPortLevel,
  };
  const engine = defaultSublightEngineForHull(provisionalHull);
  const drive = defaultFtlDriveForShipType(ship, provisionalHull);
  const engineCount = provisionalHull.sublightEngineCount;
  const retention = STANDARD_SUBLIGHT_RETENTION;
  const maximumRange = drive
    ? Math.max(0, Math.log((operatingDryMass + fuelCapacity) * retention ** 2 / operatingDryMass) /
      ftlKAtSpeed(drive, drive.maximumSpeedLyPerDay))
    : ship.maxRangeByMode.sublight ?? 0;
  const supportedModes = drive ? ["sublight", drive.mode] as const : ["sublight"] as const;
  return {
    ...ship,
    structuralMassTonnes: operatingDryMass,
    operatingDryMassTonnes: operatingDryMass,
    fuelCapacityTonnes: fuelCapacity,
    maximumTakeoffMassTonnes: operatingDryMass + fuelCapacity,
    purchasePrice: Math.round(provisionalHull.basePrice + engine.price * engineCount + (drive?.price ?? 0)),
    fixedMaintenanceCostPerDay: Math.round(provisionalHull.fixedMaintenanceCostPerDay + engine.fixedMaintenanceCostPerDay * engineCount + (drive?.fixedMaintenanceCostPerDay ?? 0)),
    maintenancePerFlightHour: engine.maintenancePerFlightHour * engineCount + (drive?.maintenancePerFlightHour ?? 0),
    reliability: Math.min(engine.reliability, drive?.reliability ?? 1),
    supportedModes,
    speedByMode: { sublight: ship.speedByMode.sublight ?? 1, ...(drive ? { [drive.mode]: drive.maximumSpeedLyPerDay } : {}) },
    maxRangeByMode: { ...(ship.maxRangeByMode.sublight === undefined ? {} : { sublight: ship.maxRangeByMode.sublight }), ...(drive ? { [drive.mode]: round(maximumRange, 2) } : {}) },
    fuelPerDistanceByMode: { ...(ship.fuelPerDistanceByMode.sublight === undefined ? {} : { sublight: ship.fuelPerDistanceByMode.sublight }), ...(drive ? { [drive.mode]: round(ftlKAtSpeed(drive, drive.maximumSpeedLyPerDay) * 1_000, 4) } : {}) },
    sublightThrustMN: engine.maximumThrustMN * engineCount,
    maximumSublightSpeedKmPerSecond: Math.max(STANDARD_TARGET_SPEED_KM_PER_SECOND, ship.maximumSublightSpeedKmPerSecond ?? 0),
    fuelOptimalThrustRatio: engine.optimalThrustRatio,
    hullVariantId: provisionalHull.id,
    defaultSublightEngineModelId: engine.id,
    ...(drive ? { defaultFtlDriveModelId: drive.id } : {}),
    defaultOptionalModuleIds: [],
  };
}

export function hullVariantFromShipType(ship: ShipType): ShipHullVariant {
  const projected = ship.hullVariantId ? ship : projectShipTypeToV07(ship);
  const installationClass = installationClassForMass(projected.operatingDryMassTonnes ?? projected.structuralMassTonnes);
  const engine = SUBLIGHT_ENGINE_MODELS.find((candidate) => candidate.id === projected.defaultSublightEngineModelId) ?? defaultSublightEngineForHull({ installationClass });
  const drive = FTL_DRIVE_MODELS.find((candidate) => candidate.id === projected.defaultFtlDriveModelId);
  const engineCount = sublightEngineCountForFamily(projected.familyId);
  const componentMass = engine.massTonnes * engineCount + (drive?.massTonnes ?? 0);
  const cabinMass = cabinInstallationMass({ economy: projected.seats, business: 0, premium: 0 });
  const fixedAssets = projected.cabinSpace * 0.07;
  return {
    id: projected.hullVariantId ?? `${projected.id}-hull`, familyId: projected.familyId, name: `${projected.name} 船体`,
    installationClass, structureMassTonnes: Math.max(10, (projected.operatingDryMassTonnes ?? projected.structuralMassTonnes) - componentMass - cabinMass - fixedAssets),
    fuelCapacityTonnes: projected.fuelCapacityTonnes,
    maximumTakeoffMassTonnes: projected.maximumTakeoffMassTonnes ?? projected.structuralMassTonnes + projected.fuelCapacityTonnes,
    sublightEngineCount: engineCount, ftlDriveSlots: drive ? 1 : 0,
    optionalModuleSlots: installationClass <= 2 ? 2 : installationClass <= 4 ? 3 : 4,
    cabinSpace: projected.cabinSpace,
    basePrice: Math.max(0, projected.purchasePrice - engine.price * engineCount - (drive?.price ?? 0)),
    deliveryDays: Math.max(7, Math.round(10 + projected.structuralMassTonnes / 24)),
    fixedMaintenanceCostPerDay: Math.max(0, projected.fixedMaintenanceCostPerDay - engine.fixedMaintenanceCostPerDay * engineCount - (drive?.fixedMaintenanceCostPerDay ?? 0)),
    minimumPortLevel: projected.minimumPortLevel,
  };
}

export function defaultBuildForShipType(ship: ShipType, cabins?: CabinConfiguration): ShipBuildConfiguration {
  const projected = ship.hullVariantId ? ship : projectShipTypeToV07(ship);
  return {
    hullVariantId: projected.hullVariantId!,
    sublightEngineModelId: projected.defaultSublightEngineModelId!,
    ...(projected.defaultFtlDriveModelId ? { ftlDriveModelId: projected.defaultFtlDriveModelId } : {}),
    optionalModuleIds: projected.defaultOptionalModuleIds ?? [],
    cabins: cabins ?? { economy: projected.seats, business: 0, premium: 0 },
    destinationReserveTonnes: 0,
  };
}

export interface FittedCurvePoint {
  x: number;
  y: number;
  slope: number;
}

function endpointSlope(firstWidth: number, secondWidth: number, firstDelta: number, secondDelta: number): number {
  const candidate = ((2 * firstWidth + secondWidth) * firstDelta - firstWidth * secondDelta)
    / (firstWidth + secondWidth);
  if (Math.sign(candidate) !== Math.sign(firstDelta)) return 0;
  if (Math.sign(firstDelta) !== Math.sign(secondDelta) && Math.abs(candidate) > Math.abs(3 * firstDelta)) {
    return 3 * firstDelta;
  }
  return candidate;
}

/**
 * Shape-preserving cubic Hermite fit through measured curve points.
 * The returned slopes are also suitable for constructing an equivalent SVG cubic path.
 */
export function fitShapePreservingCurve(points: readonly { x: number; y: number }[]): readonly FittedCurvePoint[] {
  const sorted = [...points].sort((left, right) => left.x - right.x);
  if (sorted.length === 0) return [];
  if (sorted.length === 1) return [{ ...sorted[0]!, slope: 0 }];

  const widths = sorted.slice(1).map((point, index) => point.x - sorted[index]!.x);
  if (widths.some((width) => width <= 0)) throw new Error("Curve point x values must be unique");
  const deltas = widths.map((width, index) => (sorted[index + 1]!.y - sorted[index]!.y) / width);
  if (sorted.length === 2) {
    return sorted.map((point) => ({ ...point, slope: deltas[0]! }));
  }

  const slopes = new Array<number>(sorted.length).fill(0);
  slopes[0] = endpointSlope(widths[0]!, widths[1]!, deltas[0]!, deltas[1]!);
  for (let index = 1; index < sorted.length - 1; index += 1) {
    const previousDelta = deltas[index - 1]!;
    const nextDelta = deltas[index]!;
    if (previousDelta === 0 || nextDelta === 0 || Math.sign(previousDelta) !== Math.sign(nextDelta)) {
      slopes[index] = 0;
      continue;
    }
    const previousWidth = widths[index - 1]!;
    const nextWidth = widths[index]!;
    const previousWeight = 2 * nextWidth + previousWidth;
    const nextWeight = nextWidth + 2 * previousWidth;
    slopes[index] = (previousWeight + nextWeight)
      / (previousWeight / previousDelta + nextWeight / nextDelta);
  }
  const last = sorted.length - 1;
  slopes[last] = endpointSlope(widths[last - 1]!, widths[last - 2]!, deltas[last - 1]!, deltas[last - 2]!);
  return sorted.map((point, index) => ({ ...point, slope: slopes[index]! }));
}

export function fittedCurveValueAt(points: readonly { x: number; y: number }[], x: number): number {
  const fitted = fitShapePreservingCurve(points);
  if (fitted.length === 0) return 0;
  if (x <= fitted[0]!.x) return fitted[0]!.y;
  if (x >= fitted.at(-1)!.x) return fitted.at(-1)!.y;

  const upperIndex = fitted.findIndex((point) => point.x >= x);
  const lower = fitted[upperIndex - 1]!;
  const upper = fitted[upperIndex]!;
  const width = upper.x - lower.x;
  const fraction = (x - lower.x) / width;
  const fractionSquared = fraction * fraction;
  const fractionCubed = fractionSquared * fraction;
  return (2 * fractionCubed - 3 * fractionSquared + 1) * lower.y
    + (fractionCubed - 2 * fractionSquared + fraction) * width * lower.slope
    + (-2 * fractionCubed + 3 * fractionSquared) * upper.y
    + (fractionCubed - fractionSquared) * width * upper.slope;
}

export function directionalEfficiencyAt(engine: SublightEngineModel, thrustRatio: number): number {
  return fittedCurveValueAt(engine.directionalEfficiencyCurve.map((point) => ({ x: point.ratio, y: point.efficiency })), thrustRatio);
}

export function effectiveExhaustVelocityMetersPerSecond(engine: SublightEngineModel, thrustRatio: number): number {
  const directedEfficiency = STANDARD_MASS_ENERGY_CONVERSION_EFFICIENCY * directionalEfficiencyAt(engine, thrustRatio);
  return LIGHT_SPEED_METERS_PER_SECOND * Math.sqrt(2 * directedEfficiency);
}

export function ftlKAtSpeed(drive: FtlDriveModel, speedLyPerDay: number): number {
  return fittedCurveValueAt(drive.efficiencyCurve.map((point) => ({ x: point.speedLyPerDay, y: point.kPerLightYear })), speedLyPerDay);
}

function resolveComponents(input: ResolveMissionInput) {
  const engines = input.sublightEngines ?? SUBLIGHT_ENGINE_MODELS;
  const drives = input.ftlDrives ?? FTL_DRIVE_MODELS;
  const modules = input.optionalModules ?? OPTIONAL_MODULES;
  const engine = engines.find((candidate) => candidate.id === input.build.sublightEngineModelId);
  const drive = input.build.ftlDriveModelId
    ? drives.find((candidate) => candidate.id === input.build.ftlDriveModelId)
    : undefined;
  const installedModules = input.build.optionalModuleIds.map((id) => modules.find((candidate) => candidate.id === id)).filter((item): item is OptionalModule => !!item);
  return { engine, drive, modules: installedModules };
}

function round(value: number, digits = 6): number {
  return Number(value.toFixed(digits));
}

interface SublightPhaseResult {
  startMass: number;
  endMass: number;
  fuel: number;
  hours: number;
  acceleration: number;
  peakSpeedKmPerSecond: number;
}

function solveSublightBackwards(
  endMass: number,
  engine: SublightEngineModel,
  engineCount: number,
  distanceAu: number,
  thrustRatio: number,
  targetSpeedKmPerSecond: number,
): SublightPhaseResult {
  const exhaustVelocity = effectiveExhaustVelocityMetersPerSecond(engine, thrustRatio);
  const thrustN = engine.maximumThrustMN * engineCount * thrustRatio * 1_000_000;
  const distanceMeters = distanceAu * ASTRONOMICAL_UNIT_KM * 1_000;
  let peakMps = targetSpeedKmPerSecond * 1_000;
  let retention = Math.exp(-peakMps / exhaustVelocity);
  let startMass = endMass / retention ** 2;
  for (let iteration = 0; iteration < 12; iteration += 1) {
    const acceleration = thrustN / (startMass * 1_000);
    const reachable = Math.sqrt(Math.max(0, acceleration * distanceMeters));
    peakMps = Math.min(targetSpeedKmPerSecond * 1_000, reachable);
    retention = Math.exp(-peakMps / exhaustVelocity);
    startMass = endMass / retention ** 2;
  }
  const afterAccelerationMass = startMass * retention;
  const accelerationFuel = startMass - afterAccelerationMass;
  const decelerationFuel = afterAccelerationMass - endMass;
  const accelerationSeconds = accelerationFuel * 1_000 * exhaustVelocity / thrustN;
  const decelerationSeconds = decelerationFuel * 1_000 * exhaustVelocity / thrustN;
  const burnDistance = peakMps * (accelerationSeconds + decelerationSeconds) / 2;
  const coastSeconds = Math.max(0, distanceMeters - burnDistance) / Math.max(1, peakMps);
  return {
    startMass, endMass, fuel: startMass - endMass,
    hours: (accelerationSeconds + coastSeconds + decelerationSeconds) / 3_600,
    acceleration: thrustN / (startMass * 1_000),
    peakSpeedKmPerSecond: peakMps / 1_000,
  };
}

export function resolveShipMission(input: ResolveMissionInput): ResolvedShipPerformance {
  const { build, hull } = input;
  const { engine, drive, modules } = resolveComponents(input);
  const reasons: string[] = [];
  if (!engine) reasons.push("未安装兼容的亚光速引擎");
  if (input.distanceLightYears > 0 && !drive) reasons.push("星际任务未安装 FTL 驱动器");
  if (engine && engine.installationClass > hull.installationClass) reasons.push("亚光速引擎安装级别超过船体限制");
  if (drive && drive.installationClass > hull.installationClass) reasons.push("FTL 驱动器安装级别超过船体限制");
  if (modules.length !== build.optionalModuleIds.length) reasons.push("存在未知选装模块");
  if (modules.length > hull.optionalModuleSlots) reasons.push("选装模块数量超过插槽限制");
  if (modules.some((module) => module.installationClass > hull.installationClass)) reasons.push("选装模块安装级别超过船体限制");

  const engineModel = engine ?? SUBLIGHT_ENGINE_MODELS[0]!;
  const engineCount = hull.sublightEngineCount;
  const cabinMass = cabinInstallationMass(build.cabins);
  const crewAndFixedAssetsMass = hull.cabinSpace * 0.07;
  const operatingDryMass = hull.structureMassTonnes + engineModel.massTonnes * engineCount +
    (drive?.massTonnes ?? 0) * hull.ftlDriveSlots + modules.reduce((sum, module) => sum + module.massTonnes, 0) +
    cabinMass + crewAndFixedAssetsMass;
  const passengerCount = Math.max(0, input.passengerCount ?? 0);
  const payloadMass = passengerCount * PASSENGER_AND_BAGGAGE_MASS_TONNES + Math.max(0, input.additionalPayloadTonnes ?? 0);
  const reserve = Math.max(0, input.destinationReserveTonnes ?? build.destinationReserveTonnes);
  const fuelCapacity = hull.fuelCapacityTonnes + modules.reduce((sum, module) => sum + (module.fuelCapacityBonusTonnes ?? 0), 0);
  const thrustRatio = Math.max(0.5, Math.min(1, input.thrustRatio ?? engineModel.economyThrustRatio));
  const targetSpeed = Math.max(1, input.targetSublightSpeedKmPerSecond ?? STANDARD_TARGET_SPEED_KM_PER_SECOND);
  const fallbackSublightDistance = input.sublightDistanceAu ?? STANDARD_SUBLIGHT_DISTANCE_AU;
  const departureSublightDistance = Math.max(0.00001, input.departureSublightDistanceAu ?? fallbackSublightDistance);
  const arrivalSublightDistance = Math.max(0.00001, input.arrivalSublightDistanceAu ?? fallbackSublightDistance);
  const finalMass = operatingDryMass + payloadMass + reserve;
  const arrival = solveSublightBackwards(finalMass, engineModel, engineCount, arrivalSublightDistance, thrustRatio, targetSpeed);
  const speed = drive ? Math.max(drive.minimumSpeedLyPerDay, Math.min(drive.maximumSpeedLyPerDay, input.ftlSpeedLyPerDay ?? drive.maximumSpeedLyPerDay)) : 0;
  const k = drive ? ftlKAtSpeed(drive, speed) : 0;
  const ftlStartMass = arrival.startMass * Math.exp(k * Math.max(0, input.distanceLightYears));
  const departure = solveSublightBackwards(ftlStartMass, engineModel, engineCount, departureSublightDistance, thrustRatio, targetSpeed);
  const initialFuel = departure.startMass - operatingDryMass - payloadMass;
  const takeoffMass = departure.startMass;
  const ftlFuel = ftlStartMass - arrival.startMass;
  const rawPhases: MissionPhasePerformance[] = [
    { kind: "departure", distance: departureSublightDistance, hours: departure.hours, fuelBurnTonnes: departure.fuel, startMassTonnes: departure.startMass, endMassTonnes: departure.endMass },
    { kind: "interstellar", distance: Math.max(0, input.distanceLightYears), hours: speed > 0 ? input.distanceLightYears / speed * 24 : 0, fuelBurnTonnes: ftlFuel, startMassTonnes: ftlStartMass, endMassTonnes: arrival.startMass },
    { kind: "arrival", distance: arrivalSublightDistance, hours: arrival.hours, fuelBurnTonnes: arrival.fuel, startMassTonnes: arrival.startMass, endMassTonnes: arrival.endMass },
  ];
  const phases = rawPhases.map((phase): MissionPhasePerformance => ({
    ...phase,
    hours: round(phase.hours),
    fuelBurnTonnes: round(phase.fuelBurnTonnes),
    startMassTonnes: round(phase.startMassTonnes),
    endMassTonnes: round(phase.endMassTonnes),
  }));
  if (initialFuel > fuelCapacity + 1e-6) reasons.push(`需要 ${initialFuel.toFixed(2)} t 燃料，超过 ${fuelCapacity.toFixed(2)} t 燃料舱`);
  if (takeoffMass > hull.maximumTakeoffMassTonnes + 1e-6) reasons.push(`起飞质量 ${takeoffMass.toFixed(2)} t 超过最大起飞质量 ${hull.maximumTakeoffMassTonnes.toFixed(2)} t`);

  const limitingInitialMass = Math.min(
    operatingDryMass + payloadMass + fuelCapacity,
    hull.maximumTakeoffMassTonnes,
  );
  const standardRetention = Math.exp(-targetSpeed * 1_000 / effectiveExhaustVelocityMetersPerSecond(engineModel, thrustRatio)) ** 2;
  const maximumRange = drive && limitingInitialMass * standardRetention ** 2 > finalMass
    ? Math.log(limitingInitialMass * standardRetention ** 2 / finalMass) / Math.max(1e-9, k)
    : 0;
  const moduleReliability = modules.reduce((sum, module) => sum + (module.reliabilityBonus ?? 0), 0);
  const crewMultiplier = modules.reduce((product, module) => product * (module.crewMultiplier ?? 1), 1);
  const turnaroundMultiplier = modules.reduce((product, module) => product * (module.turnaroundMultiplier ?? 1), 1);
  const purchasePrice = hull.basePrice + engineModel.price * engineCount + (drive?.price ?? 0) * hull.ftlDriveSlots + modules.reduce((sum, module) => sum + module.price, 0);
  const fixedMaintenance = hull.fixedMaintenanceCostPerDay + engineModel.fixedMaintenanceCostPerDay * engineCount + (drive?.fixedMaintenanceCostPerDay ?? 0) * hull.ftlDriveSlots + modules.reduce((sum, module) => sum + module.fixedMaintenanceCostPerDay, 0);
  const flightMaintenance = engineModel.maintenancePerFlightHour * engineCount + (drive?.maintenancePerFlightHour ?? 0) * hull.ftlDriveSlots;
  return {
    build, operatingDryMassTonnes: round(operatingDryMass, 3), payloadMassTonnes: round(payloadMass, 3),
    initialFuelTonnes: round(initialFuel), arrivalReserveTonnes: round(reserve), takeoffMassTonnes: round(takeoffMass, 3),
    fuelCapacityTonnes: round(fuelCapacity, 3), maximumTakeoffMassTonnes: hull.maximumTakeoffMassTonnes,
    fuelCapacityUtilization: round(initialFuel / Math.max(1e-9, fuelCapacity), 4), totalFuelBurnTonnes: round(initialFuel - reserve),
    totalHours: round(phases.reduce((sum, phase) => sum + phase.hours, 0)), maximumDirectRangeLightYears: round(Math.max(0, maximumRange), 3),
    accelerationMetersPerSecondSquared: round(departure.acceleration), purchasePrice: round(purchasePrice, 2),
    fixedMaintenanceCostPerDay: round(fixedMaintenance, 2), maintenancePerFlightHour: round(flightMaintenance, 2),
    crewRequired: Math.max(2, Math.ceil((4 + hull.cabinSpace / 35) * crewMultiplier)),
    turnaroundHours: round((0.55 + hull.cabinSpace / 170) * turnaroundMultiplier, 3),
    reliability: round(Math.min(0.995, Math.min(engineModel.reliability, drive?.reliability ?? 1) + moduleReliability), 4),
    comfort: round(55 + Math.log2(Math.max(2, hull.cabinSpace)) * 3 + modules.reduce((sum, module) => sum + (module.comfortBonus ?? 0), 0), 2),
    phases, feasible: reasons.length === 0, infeasibleReasons: reasons,
  };
}

export function resolveStandardReferenceMission(distanceLightYears: number, destinationReserveTonnes = 0): ResolvedShipPerformance {
  return resolveShipMission({
    build: { ...STANDARD_REFERENCE_BUILD, destinationReserveTonnes },
    hull: STANDARD_REFERENCE_HULL,
    distanceLightYears,
    ftlSpeedLyPerDay: STANDARD_FTL_SPEED_LY_PER_DAY,
    thrustRatio: STANDARD_ECONOMY_THRUST_RATIO,
    targetSublightSpeedKmPerSecond: STANDARD_TARGET_SPEED_KM_PER_SECOND,
  });
}

export interface TechnicalStopComparison {
  direct: ResolvedShipPerformance;
  withTechnicalStop: {
    feasible: boolean;
    totalFuelBurnTonnes: number;
    totalHours: number;
    addedPortCost: number;
    legs: readonly ResolvedShipPerformance[];
  };
}

export function compareTechnicalStop(
  input: ResolveMissionInput,
  stopTurnaroundHours = 6,
  stopPortCost = 1_200,
): TechnicalStopComparison {
  const direct = resolveShipMission(input);
  const halfDistance = input.distanceLightYears / 2;
  const first = resolveShipMission({ ...input, distanceLightYears: halfDistance, destinationReserveTonnes: 0 });
  const second = resolveShipMission({ ...input, distanceLightYears: halfDistance });
  return {
    direct,
    withTechnicalStop: {
      feasible: first.feasible && second.feasible,
      totalFuelBurnTonnes: round(first.totalFuelBurnTonnes + second.totalFuelBurnTonnes),
      totalHours: round(first.totalHours + second.totalHours + stopTurnaroundHours),
      addedPortCost: stopPortCost,
      legs: [first, second],
    },
  };
}
