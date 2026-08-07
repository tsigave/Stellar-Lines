import type {
  MarketEvent,
  PassengerType,
  Starport,
  WorldLeg,
} from "./types.js";

export function eventIntensity(event: MarketEvent, day: number): number {
  if (day < event.startsOnDay) return 0;
  if (day <= event.endsOnDay) return 1;
  if (event.recoveryDays <= 0) return 0;
  const recoveryProgress = (day - event.endsOnDay) / event.recoveryDays;
  return Math.max(0, 1 - recoveryProgress);
}

function blendedMultiplier(modifier: number | undefined, intensity: number): number {
  return modifier === undefined ? 1 : 1 + (modifier - 1) * intensity;
}

function smoothstep(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
}

/** Fuel shocks ramp in and recover smoothly; demand keeps its existing timing. */
export function fuelEventIntensity(event: MarketEvent, day: number): number {
  if (day < event.startsOnDay) return 0;
  if (day <= event.endsOnDay) {
    const rampDays = Math.min(4, Math.max(1, event.endsOnDay - event.startsOnDay));
    return smoothstep((day - event.startsOnDay) / rampDays);
  }
  if (event.recoveryDays <= 0) return 0;
  return 1 - smoothstep((day - event.endsOnDay) / event.recoveryDays);
}

function affectsMarket(
  event: MarketEvent,
  originPortId: string,
  destinationPortId: string,
): boolean {
  return (
    event.affectedPortIds.includes(originPortId) ||
    event.affectedPortIds.includes(destinationPortId)
  );
}

export function marketEventDemandMultiplier(
  events: readonly MarketEvent[],
  day: number,
  originPortId: string,
  destinationPortId: string,
  passengerType: PassengerType,
): number {
  return events.reduce((multiplier, event) => {
    const intensity = eventIntensity(event, day);
    if (intensity <= 0 || !affectsMarket(event, originPortId, destinationPortId)) {
      return multiplier;
    }
    return multiplier * blendedMultiplier(event.demandModifiers[passengerType], intensity);
  }, 1);
}

export function applyEventsToPorts(
  ports: readonly Starport[],
  events: readonly MarketEvent[],
  day: number,
): Starport[] {
  return ports.map((port) => {
    let fuelPrice = port.fuelPrice;
    let dailyCapacity = port.dailyCapacity;
    for (const event of events) {
      if (!event.affectedPortIds.includes(port.id)) continue;
      const intensity = eventIntensity(event, day);
      const fuelIntensity = fuelEventIntensity(event, day);
      if (event.fuelPriceModifier !== undefined) {
        const target = event.fuelPriceModifier >= 1 ? 6 : 0.5;
        const strength = Math.min(1, Math.abs(event.fuelPriceModifier - 1));
        fuelPrice += (target - fuelPrice) * strength * fuelIntensity;
      }
      dailyCapacity *= blendedMultiplier(event.portCapacityModifier, intensity);
    }
    return { ...port, fuelPrice: Math.max(0.5, Math.min(6, fuelPrice)), dailyCapacity };
  });
}

export function applyEventsToWorldLegs(
  legs: readonly WorldLeg[],
  events: readonly MarketEvent[],
  day: number,
): WorldLeg[] {
  return legs.map((leg) => {
    let timeModifier = leg.timeModifier;
    for (const event of events) {
      if (!affectsMarket(event, leg.fromPortId, leg.toPortId)) continue;
      timeModifier *= blendedMultiplier(event.travelTimeModifier, eventIntensity(event, day));
    }
    return { ...leg, timeModifier };
  });
}

export function announcedEvents(
  events: readonly MarketEvent[],
  day: number,
): MarketEvent[] {
  return events.filter(
    (event) =>
      day >= event.announcedOnDay && day <= event.endsOnDay + event.recoveryDays,
  );
}

export function activeEvents(events: readonly MarketEvent[], day: number): MarketEvent[] {
  return events.filter((event) => eventIntensity(event, day) > 0);
}
