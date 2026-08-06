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
export const EMERGENCY_FUEL_MARGIN = 0.2;
/** 标准燃料单位折算为质量，仅用于计算携油重量对耗油的反馈。 */
export const FUEL_UNIT_MASS_TONNES = 0.1;

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

export function cabinInstallationMass(cabins: CabinConfiguration): number {
  return (Object.keys(CABIN_INSTALLATION_MASS_TONNES) as PassengerClass[]).reduce(
    (sum, passengerClass) =>
      sum + cabins[passengerClass] * CABIN_INSTALLATION_MASS_TONNES[passengerClass],
    0,
  );
}

/**
 * Fuel curve:
 *
 * distance × drive coefficient × gross-mass factor × range-mismatch factor.
 * The logarithmic mismatch term makes a long-range hull inefficient on a very short leg
 * without allowing the penalty to grow without bound. Fuel is loaded automatically for the
 * predicted passenger load before departure, including a fixed 20% emergency margin. The
 * closed-form equation includes the mass of that fuel without requiring iterative simulation.
 */
export function estimateFuelConsumption(
  ship: ShipType,
  mode: TravelMode,
  distance: number,
  cabins: CabinConfiguration,
  passengerCount: number,
): FuelConsumptionEstimate {
  const driveCoefficient = ship.fuelPerDistanceByMode[mode];
  const designRange = ship.maxRangeByMode[mode];
  if (driveCoefficient === undefined || designRange === undefined) {
    throw new Error(`Fuel data is missing for ${ship.name} in ${mode}`);
  }
  const installedCabinMassTonnes = cabinInstallationMass(cabins);
  const passengerMassTonnes = Math.max(0, passengerCount) * PASSENGER_AND_BAGGAGE_MASS_TONNES;
  const dryDepartureMassTonnes = ship.structuralMassTonnes + installedCabinMassTonnes + passengerMassTonnes;
  const rangeRatio = Math.max(1, designRange / Math.max(1, distance));
  const rangeMismatchMultiplier = 1 + 0.18 * Math.log2(rangeRatio);
  const burnFactor = Math.max(0, distance) * driveCoefficient * rangeMismatchMultiplier / 100;
  const fuelMassFeedback = burnFactor * (1 + EMERGENCY_FUEL_MARGIN) * FUEL_UNIT_MASS_TONNES;
  const fuelUnits = burnFactor * dryDepartureMassTonnes / Math.max(0.25, 1 - fuelMassFeedback);
  const emergencyReserveUnits = fuelUnits * EMERGENCY_FUEL_MARGIN;
  const requiredFuelLoadUnits = fuelUnits + emergencyReserveUnits;
  const carriedFuelMassTonnes = requiredFuelLoadUnits * FUEL_UNIT_MASS_TONNES;
  const grossMassTonnes = dryDepartureMassTonnes + carriedFuelMassTonnes;
  return {
    fuelUnits: Number(fuelUnits.toFixed(4)),
    requiredFuelLoadUnits: Number(requiredFuelLoadUnits.toFixed(4)),
    emergencyReserveUnits: Number(emergencyReserveUnits.toFixed(4)),
    fuelCapacityUtilization: Number((carriedFuelMassTonnes / ship.fuelCapacityTonnes).toFixed(4)),
    grossMassTonnes: Number(grossMassTonnes.toFixed(3)),
    rangeMismatchMultiplier: Number(rangeMismatchMultiplier.toFixed(4)),
    installedCabinMassTonnes: Number(installedCabinMassTonnes.toFixed(3)),
    passengerMassTonnes: Number(passengerMassTonnes.toFixed(3)),
    carriedFuelMassTonnes: Number(carriedFuelMassTonnes.toFixed(3)),
  };
}
