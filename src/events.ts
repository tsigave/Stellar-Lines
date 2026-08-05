import type {
  MarketEvent,
  PassengerClass,
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
  passengerClass: PassengerClass,
): number {
  return events.reduce((multiplier, event) => {
    const intensity = eventIntensity(event, day);
    if (intensity <= 0 || !affectsMarket(event, originPortId, destinationPortId)) {
      return multiplier;
    }
    return multiplier * blendedMultiplier(event.demandModifiers[passengerClass], intensity);
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
      fuelPrice *= blendedMultiplier(event.fuelPriceModifier, intensity);
      dailyCapacity *= blendedMultiplier(event.portCapacityModifier, intensity);
    }
    return { ...port, fuelPrice, dailyCapacity };
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
