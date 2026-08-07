import type {
  CabinConfiguration,
  PassengerClass,
  ShipType,
  TravelMode,
} from "./types.js";

export const CABIN_INSTALLATION_MASS_TONNES: CabinConfiguration = {
  economy: 0.08,
  business: 0.18,
  premium: 0.35,
};
export const PASSENGER_AND_BAGGAGE_MASS_TONNES = 0.1;
export const ASTRONOMICAL_UNIT_KM = 149_597_870.7;
/** v0.7 stores an explicit destination reserve instead of a hidden percentage. */
export const EMERGENCY_FUEL_MARGIN = 0;
/** Deprecated compatibility name: one stored fuel unit is exactly one tonne in v0.7. */
export const FUEL_UNIT_MASS_TONNES = 1;

function stableHash(value: string): number {
  let result = 2166136261;
  for (const character of value) result = Math.imul(result ^ character.charCodeAt(0), 16777619);
  return result >>> 0;
}

export function deterministicExitDistanceKm(systemId: string, mode: "warp" | "hyperspace"): number {
  const fraction = stableHash(`${systemId}:${mode}:exit-distance`) / 4_294_967_295;
  const minimumAu = 0.14;
  const spanAu = 0.02;
  return Math.round((minimumAu + fraction * spanAu) * ASTRONOMICAL_UNIT_KM / 10_000) * 10_000;
}

export interface FuelConsumptionEstimate {
  fuelUnits: number;
  requiredFuelLoadUnits: number;
  emergencyReserveUnits: number;
  fuelCapacityUtilization: number;
  grossMassTonnes: number;
  rangeMismatchMultiplier: number;
  installedCabinMassTonnes: number;
  passengerMassTonnes: number;
  carriedFuelMassTonnes: number;
}

export interface SublightTransitEstimate {
  distanceKm: number;
  targetSpeedKmPerSecond: number;
  maximumReachableSpeedKmPerSecond: number;
  peakSpeedKmPerSecond: number;
  thrustMN: number;
  thrustRatio: number;
  accelerationMetersPerSecondSquared: number;
  accelerationHours: number;
  coastHours: number;
  decelerationHours: number;
  totalHours: number;
  burnSeconds: number;
  fuelTonnes: number;
  fuelUnits: number;
  requiredFuelLoadUnits: number;
  grossMassTonnes: number;
  specificImpulseSeconds: number;
}

export function driveEfficiencyMultiplier(
  ratio: number,
  optimalRatio: number,
  slowPenalty = 3,
  fastPenalty = 7,
): number {
  return 1 + slowPenalty * Math.max(0, optimalRatio - ratio) ** 2 +
    fastPenalty * Math.max(0, ratio - optimalRatio) ** 2;
}

export function cabinInstallationMass(cabins: CabinConfiguration): number {
  return (Object.keys(CABIN_INSTALLATION_MASS_TONNES) as PassengerClass[]).reduce(
    (sum, passengerClass) =>
      sum + cabins[passengerClass] * CABIN_INSTALLATION_MASS_TONNES[passengerClass],
    0,
  );
}

function dryOperatingMass(ship: ShipType, cabins: CabinConfiguration): number {
  return ship.structuralMassTonnes + cabinInstallationMass(cabins);
}

export function estimateInterstellarFuel(
  ship: ShipType,
  mode: Exclude<TravelMode, "sublight">,
  distanceLightYears: number,
  cabins: CabinConfiguration,
  cruiseRatio = 1,
): FuelConsumptionEstimate {
  const legacyCoefficient = ship.fuelPerDistanceByMode[mode];
  if (legacyCoefficient === undefined) throw new Error(`Fuel data is missing for ${ship.name} in ${mode}`);
  const optimal = ship.fuelOptimalCruiseRatio ?? 0.82;
  const efficiencyCurve = driveEfficiencyMultiplier(
    cruiseRatio,
    optimal,
    ship.slowFuelPenaltyCoefficient ?? 3,
    ship.fastFuelPenaltyCoefficient ?? 7,
  );
  // Compatibility-derived default preserves the former scale: efficiency is
  // light-years × carried tonnes per tonne of fuel.
  const baseEfficiency = ship.interstellarEfficiencyLyPerFuelTonneMass ?? 1_000 / legacyCoefficient;
  const effectiveEfficiency = baseEfficiency / efficiencyCurve;
  const dryMassTonnes = dryOperatingMass(ship, cabins);
  const distance = Math.max(0, distanceLightYears);
  const massDistanceRatio = distance / Math.max(1, effectiveEfficiency);
  if (massDistanceRatio * (1 + EMERGENCY_FUEL_MARGIN) >= 0.98) {
    throw new Error(`${ship.name} cannot carry enough ${mode} fuel for ${distance.toFixed(1)} ly`);
  }
  // F = distance × (dry mass + 120% × F) / efficiency.
  const fuelTonnes = massDistanceRatio * dryMassTonnes /
    Math.max(0.02, 1 - massDistanceRatio * (1 + EMERGENCY_FUEL_MARGIN));
  const fuelUnits = fuelTonnes / FUEL_UNIT_MASS_TONNES;
  const roundedFuelUnits = Number(fuelUnits.toFixed(4));
  const emergencyReserveUnits = Number((roundedFuelUnits * EMERGENCY_FUEL_MARGIN).toFixed(4));
  const requiredFuelLoadUnits = Number((roundedFuelUnits + emergencyReserveUnits).toFixed(4));
  const carriedFuelMassTonnes = requiredFuelLoadUnits * FUEL_UNIT_MASS_TONNES;
  return {
    fuelUnits: roundedFuelUnits,
    requiredFuelLoadUnits,
    emergencyReserveUnits,
    fuelCapacityUtilization: Number((carriedFuelMassTonnes / ship.fuelCapacityTonnes).toFixed(4)),
    grossMassTonnes: Number((dryMassTonnes + carriedFuelMassTonnes).toFixed(3)),
    rangeMismatchMultiplier: Number(efficiencyCurve.toFixed(4)),
    installedCabinMassTonnes: Number(cabinInstallationMass(cabins).toFixed(3)),
    passengerMassTonnes: 0,
    carriedFuelMassTonnes: Number(carriedFuelMassTonnes.toFixed(3)),
  };
}

export function estimateSublightTransit(
  ship: ShipType,
  distanceKm: number,
  cabins: CabinConfiguration,
  interstellarFuelLoadTonnes = 0,
  targetSpeedKmPerSecond = ship.maximumSublightSpeedKmPerSecond ?? 120,
  thrustRatio = 1,
): SublightTransitEstimate {
  const ratedThrustMN = ship.sublightThrustMN ?? Math.max(4, (ship.speedByMode.sublight ?? 1) * ship.structuralMassTonnes * 0.012);
  const normalizedThrustRatio = Math.max(0.25, Math.min(1, thrustRatio));
  const thrustMN = ratedThrustMN * normalizedThrustRatio;
  const baseSpecificImpulse = ship.sublightSpecificImpulseSeconds ?? 4_000_000;
  const impulsePenalty = driveEfficiencyMultiplier(
    normalizedThrustRatio,
    ship.fuelOptimalThrustRatio ?? 0.72,
    ship.slowFuelPenaltyCoefficient ?? 3,
    ship.fastFuelPenaltyCoefficient ?? 7,
  );
  const specificImpulseSeconds = baseSpecificImpulse / impulsePenalty;
  const dryMassTonnes = dryOperatingMass(ship, cabins);
  const distanceMeters = Math.max(1, distanceKm) * 1_000;
  const configuredSpeedKmPerSecond = Math.max(1, Math.min(
    targetSpeedKmPerSecond,
    ship.maximumSublightSpeedKmPerSecond ?? targetSpeedKmPerSecond,
  ));
  let fuelTonnes = 0;
  let acceleration = 0;
  let peakSpeedMps = 0;
  let burnSeconds = 0;
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const grossMassTonnes = dryMassTonnes + Math.max(0, interstellarFuelLoadTonnes) +
      fuelTonnes * (1 + EMERGENCY_FUEL_MARGIN);
    acceleration = thrustMN * 1_000 / Math.max(1, grossMassTonnes);
    const maximumReachableMps = Math.sqrt(acceleration * distanceMeters);
    const configuredMps = configuredSpeedKmPerSecond * 1_000;
    peakSpeedMps = Math.min(configuredMps, maximumReachableMps);
    burnSeconds = 2 * peakSpeedMps / Math.max(1e-6, acceleration);
    fuelTonnes = thrustMN * burnSeconds / Math.max(1, specificImpulseSeconds);
  }
  const grossMassTonnes = dryMassTonnes + Math.max(0, interstellarFuelLoadTonnes) +
    fuelTonnes * (1 + EMERGENCY_FUEL_MARGIN);
  const accelerationSeconds = peakSpeedMps / Math.max(1e-6, acceleration);
  const accelerationDistance = peakSpeedMps ** 2 / Math.max(1e-6, acceleration);
  const coastDistance = Math.max(0, distanceMeters - accelerationDistance);
  const coastSeconds = coastDistance / Math.max(1, peakSpeedMps);
  const fuelUnits = fuelTonnes / FUEL_UNIT_MASS_TONNES;
  return {
    distanceKm: Math.round(distanceKm),
    targetSpeedKmPerSecond,
    maximumReachableSpeedKmPerSecond: Number((Math.sqrt(acceleration * distanceMeters) / 1_000).toFixed(3)),
    peakSpeedKmPerSecond: Math.min(
      configuredSpeedKmPerSecond,
      Number((peakSpeedMps / 1_000).toFixed(3)),
    ),
    thrustMN: Number(thrustMN.toFixed(3)),
    thrustRatio: normalizedThrustRatio,
    accelerationMetersPerSecondSquared: Number(acceleration.toFixed(6)),
    accelerationHours: accelerationSeconds / 3_600,
    coastHours: coastSeconds / 3_600,
    decelerationHours: accelerationSeconds / 3_600,
    totalHours: (burnSeconds + coastSeconds) / 3_600,
    burnSeconds,
    fuelTonnes: Number(fuelTonnes.toFixed(6)),
    fuelUnits: Number(fuelUnits.toFixed(4)),
    requiredFuelLoadUnits: Number((fuelUnits * (1 + EMERGENCY_FUEL_MARGIN)).toFixed(4)),
    grossMassTonnes: Number(grossMassTonnes.toFixed(3)),
    specificImpulseSeconds: Number(specificImpulseSeconds.toFixed(1)),
  };
}

/** Compatibility entry point using v0.7 tonne units and actual passenger/baggage mass. */
export function estimateFuelConsumption(
  ship: ShipType,
  mode: TravelMode,
  distance: number,
  cabins: CabinConfiguration,
  passengerCount: number,
): FuelConsumptionEstimate {
  const passengerMassTonnes = Math.max(0, passengerCount) * PASSENGER_AND_BAGGAGE_MASS_TONNES;
  if (mode !== "sublight") {
    const empty = estimateInterstellarFuel(ship, mode, distance, cabins, 1);
    const massMultiplier = 1 + passengerMassTonnes / Math.max(1, dryOperatingMass(ship, cabins));
    const fuelUnits = Number((empty.fuelUnits * massMultiplier).toFixed(4));
    const requiredFuelLoadUnits = Number((empty.requiredFuelLoadUnits * massMultiplier).toFixed(4));
    return {
      ...empty,
      fuelUnits,
      requiredFuelLoadUnits,
      fuelCapacityUtilization: Number((requiredFuelLoadUnits / ship.fuelCapacityTonnes).toFixed(4)),
      grossMassTonnes: Number((empty.grossMassTonnes + passengerMassTonnes + (requiredFuelLoadUnits - empty.requiredFuelLoadUnits)).toFixed(3)),
      passengerMassTonnes: Number(passengerMassTonnes.toFixed(3)),
      carriedFuelMassTonnes: requiredFuelLoadUnits,
    };
  }
  const transit = estimateSublightTransit(
    { ...ship, structuralMassTonnes: ship.structuralMassTonnes + passengerMassTonnes },
    Math.max(1, distance) * 1_000_000,
    cabins,
  );
  const installedCabinMassTonnes = cabinInstallationMass(cabins);
  const carriedFuelMassTonnes = transit.requiredFuelLoadUnits * FUEL_UNIT_MASS_TONNES;
  return {
    fuelUnits: transit.fuelUnits,
    requiredFuelLoadUnits: transit.requiredFuelLoadUnits,
    emergencyReserveUnits: transit.requiredFuelLoadUnits - transit.fuelUnits,
    fuelCapacityUtilization: Number((carriedFuelMassTonnes / ship.fuelCapacityTonnes).toFixed(4)),
    grossMassTonnes: transit.grossMassTonnes,
    rangeMismatchMultiplier: 1,
    installedCabinMassTonnes,
    passengerMassTonnes: Number(passengerMassTonnes.toFixed(3)),
    carriedFuelMassTonnes,
  };
}
