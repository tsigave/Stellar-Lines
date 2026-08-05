import { MODE_REFERENCE_SPEED } from "./parameters.js";
import type { Starport, WorldLeg } from "./types.js";

export function shortestReferenceTime(
  originPortId: string,
  destinationPortId: string,
  legs: readonly WorldLeg[],
): number {
  if (originPortId === destinationPortId) return 0;

  const distances = new Map<string, number>([[originPortId, 0]]);
  const unvisited = new Set<string>([
    originPortId,
    destinationPortId,
    ...legs.flatMap((leg) => [leg.fromPortId, leg.toPortId]),
  ]);

  while (unvisited.size > 0) {
    let current: string | undefined;
    let currentDistance = Number.POSITIVE_INFINITY;

    for (const portId of unvisited) {
      const distance = distances.get(portId) ?? Number.POSITIVE_INFINITY;
      if (distance < currentDistance) {
        current = portId;
        currentDistance = distance;
      }
    }

    if (current === undefined || !Number.isFinite(currentDistance)) break;
    if (current === destinationPortId) return currentDistance;

    unvisited.delete(current);
    for (const leg of legs) {
      if (!leg.isOpen) continue;
      const nextPortId =
        leg.fromPortId === current
          ? leg.toPortId
          : leg.toPortId === current
            ? leg.fromPortId
            : undefined;
      if (nextPortId === undefined) continue;
      const travelHours =
        (leg.distance / MODE_REFERENCE_SPEED[leg.mode]) * leg.timeModifier;
      const candidate = currentDistance + travelHours;
      if (candidate < (distances.get(nextPortId) ?? Number.POSITIVE_INFINITY)) {
        distances.set(nextPortId, candidate);
      }
    }
  }

  return Number.POSITIVE_INFINITY;
}

export function allReferenceTimes(
  ports: readonly Starport[],
  legs: readonly WorldLeg[],
): ReadonlyMap<string, number> {
  const result = new Map<string, number>();
  for (const origin of ports) {
    for (const destination of ports) {
      if (origin.id === destination.id) continue;
      result.set(
        marketPairKey(origin.id, destination.id),
        shortestReferenceTime(origin.id, destination.id, legs),
      );
    }
  }
  return result;
}

export function marketPairKey(originPortId: string, destinationPortId: string): string {
  return `${originPortId}->${destinationPortId}`;
}
