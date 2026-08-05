import { marketPairKey } from "./graph.js";
import { DEFAULT_DEMAND_PARAMETERS } from "./parameters.js";
import {
  PASSENGER_CLASSES,
  type DemandParameters,
  type MarketDemand,
  type PassengerClass,
  type Starport,
} from "./types.js";

export interface DemandGenerationOptions {
  day?: number;
  seed?: number;
  demandMultiplier?: (
    origin: Starport,
    destination: Starport,
    passengerClass: PassengerClass,
  ) => number;
  affinityOverride?: (
    origin: Starport,
    destination: Starport,
    passengerClass: PassengerClass,
  ) => number | undefined;
  parameters?: DemandParameters;
}

function normalizedLink(a: number, b: number): number {
  return Math.sqrt(Math.max(0, a) * Math.max(0, b)) / 100;
}

export function marketAffinity(
  origin: Starport,
  destination: Starport,
  passengerClass: PassengerClass,
): number {
  const economicLink = normalizedLink(origin.economy, destination.economy);
  const businessLink = normalizedLink(origin.business, destination.business);
  const tourismLink = normalizedLink(origin.tourism, destination.tourism);
  const administrativeLink = normalizedLink(
    origin.administration,
    destination.administration,
  );

  const raw =
    passengerClass === "economy"
      ? 0.5 + 0.2 * economicLink + 0.2 * tourismLink + 0.1 * administrativeLink
      : passengerClass === "business"
        ? 0.35 + 0.45 * businessLink + 0.15 * economicLink + 0.05 * administrativeLink
        : 0.3 + 0.3 * tourismLink + 0.25 * businessLink + 0.15 * administrativeLink;

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
  passengerClass: PassengerClass,
  parameters: DemandParameters = DEFAULT_DEMAND_PARAMETERS,
): number {
  const estimatedDistance = referenceTimeHours * 5;
  const standardFare =
    parameters.baseBoardingFare +
    estimatedDistance * parameters.farePerDistance +
    referenceTimeHours * parameters.farePerReferenceHour;
  return standardFare * parameters.acceptableFareMultiplier[passengerClass];
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

      for (const passengerClass of PASSENGER_CLASSES) {
        const affinity =
          options.affinityOverride?.(origin, destination, passengerClass) ??
          marketAffinity(origin, destination, passengerClass);
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
              referenceTimeHours / parameters.timeScaleHours[passengerClass],
              parameters.distancePower[passengerClass],
            ));
        const marketId = `${origin.id}->${destination.id}:${passengerClass}`;
        const multiplier =
          options.demandMultiplier?.(origin, destination, passengerClass) ?? 1;
        const potentialPassengers =
          parameters.classScale[passengerClass] *
          marketSize *
          affinity *
          distanceDecay *
          multiplier *
          deterministicVariation(day, marketId, seed);

        markets.push({
          originPortId: origin.id,
          destinationPortId: destination.id,
          passengerClass,
          potentialPassengers: Math.max(0, potentialPassengers),
          referenceTimeHours,
          acceptableFare: acceptableFare(referenceTimeHours, passengerClass, parameters),
        });
      }
    }
  }

  return markets;
}
