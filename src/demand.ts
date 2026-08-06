import { marketPairKey } from "./graph.js";
import { DEFAULT_DEMAND_PARAMETERS } from "./parameters.js";
import {
  PASSENGER_TYPES,
  type DemandParameters,
  type MarketDemand,
  type PassengerType,
  type Starport,
} from "./types.js";

export interface DemandGenerationOptions {
  day?: number;
  seed?: number;
  demandMultiplier?: (
    origin: Starport,
    destination: Starport,
    passengerType: PassengerType,
  ) => number;
  affinityOverride?: (
    origin: Starport,
    destination: Starport,
    passengerType: PassengerType,
  ) => number | undefined;
  parameters?: DemandParameters;
}

function normalizedLink(a: number, b: number): number {
  return Math.sqrt(Math.max(0, a) * Math.max(0, b)) / 100;
}

export function marketAffinity(
  origin: Starport,
  destination: Starport,
  passengerType: PassengerType,
): number {
  const economicLink = normalizedLink(origin.economy, destination.economy);
  const businessLink = normalizedLink(origin.business, destination.business);
  const tourismLink = normalizedLink(origin.tourism, destination.tourism);
  const administrativeLink = normalizedLink(
    origin.administration,
    destination.administration,
  );

  const raw =
    passengerType === "business"
        ? 0.35 + 0.45 * businessLink + 0.15 * economicLink + 0.05 * administrativeLink
      : passengerType === "leisure"
        ? 0.38 + 0.15 * economicLink + 0.36 * tourismLink + 0.11 * administrativeLink
      : passengerType === "budget"
        ? 0.52 + 0.24 * economicLink + 0.15 * tourismLink + 0.09 * administrativeLink
        : 0.28 + 0.34 * tourismLink + 0.28 * businessLink + 0.1 * administrativeLink;

  return Math.min(2.5, Math.max(0.35, raw));
}

function stableHash(value: string, seed: number): number {
  let hash = seed | 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}

export function deterministicVariation(
  day: number,
  marketId: string,
  seed = 1,
): number {
  const hash = stableHash(marketId, seed);
  const phaseA = (hash % 6283) / 1000;
  const phaseB = ((hash >>> 8) % 6283) / 1000;
  return 1 + 0.05 * Math.sin(day / 9 + phaseA) + 0.03 * Math.sin(day / 31 + phaseB);
}

export function acceptableFare(
  referenceTimeHours: number,
  passengerType: PassengerType,
  parameters: DemandParameters = DEFAULT_DEMAND_PARAMETERS,
): number {
  const estimatedDistance = referenceTimeHours * 5;
  const standardFare =
    parameters.baseBoardingFare +
    estimatedDistance * parameters.farePerDistance +
    referenceTimeHours * parameters.farePerReferenceHour;
  return standardFare * parameters.acceptableFareMultiplier[passengerType];
}

export function generateMarketDemands(
  ports: readonly Starport[],
  referenceTimes: ReadonlyMap<string, number>,
  options: DemandGenerationOptions = {},
): MarketDemand[] {
  const parameters = options.parameters ?? DEFAULT_DEMAND_PARAMETERS;
  const day = options.day ?? 0;
  const seed = options.seed ?? 1;
  const markets: MarketDemand[] = [];

  for (const origin of ports) {
    for (const destination of ports) {
      if (origin.id === destination.id) continue;
      const referenceTimeHours = referenceTimes.get(marketPairKey(origin.id, destination.id));
      if (referenceTimeHours === undefined || !Number.isFinite(referenceTimeHours)) continue;

      for (const passengerType of PASSENGER_TYPES) {
        const affinity =
          options.affinityOverride?.(origin, destination, passengerType) ??
          marketAffinity(origin, destination, passengerType);
        const originDevelopment =
          (origin.economy + origin.business + origin.administration) / 300;
        const destinationDevelopment =
          (destination.economy + destination.business + destination.administration) / 300;
        const developmentMultiplier =
          0.55 + 0.9 * Math.sqrt(originDevelopment * destinationDevelopment);
        const marketSize =
          Math.sqrt(origin.population * destination.population) * developmentMultiplier;
        const distanceDecay =
          1 /
          (1 +
            Math.pow(
              referenceTimeHours / parameters.timeScaleHours[passengerType],
              parameters.distancePower[passengerType],
            ));
        const marketId = `${origin.id}->${destination.id}:${passengerType}`;
        const multiplier =
          options.demandMultiplier?.(origin, destination, passengerType) ?? 1;
        const potentialPassengers =
          parameters.classScale[passengerType] *
          marketSize *
          affinity *
          distanceDecay *
          multiplier *
          deterministicVariation(day, marketId, seed);

        markets.push({
          originPortId: origin.id,
          destinationPortId: destination.id,
          passengerType,
          potentialPassengers: Math.max(0, potentialPassengers),
          referenceTimeHours,
          acceptableFare: acceptableFare(referenceTimeHours, passengerType, parameters),
        });
      }
    }
  }

  return markets;
}
