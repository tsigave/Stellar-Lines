import type { ChoiceParameters, DemandParameters, PassengerClass } from "./types.js";

export const DEFAULT_CHOICE_PARAMETERS: ChoiceParameters = {
  weights: {
    economy: {
      fare: 4,
      time: 1.2,
      wait: 0.6,
      transfer: 0.8,
      comfort: 0.3,
      reputation: 0.3,
      reliability: 0.5,
      satisfaction: 0.7,
    },
    business: {
      fare: 1.2,
      time: 3,
      wait: 1.8,
      transfer: 1.5,
      comfort: 0.5,
      reputation: 0.8,
      reliability: 1.5,
      satisfaction: 1.4,
    },
    premium: {
      fare: 0.8,
      time: 2,
      wait: 0.8,
      transfer: 2,
      comfort: 1.8,
      reputation: 1.5,
      reliability: 1.2,
      satisfaction: 1.6,
    },
  },
  temperature: {
    economy: 0.75,
    business: 0.6,
    premium: 0.65,
  },
  noTravelCost: {
    economy: 6.2,
    business: 7,
    premium: 6.8,
  },
};

export const DEFAULT_DEMAND_PARAMETERS: DemandParameters = {
  classScale: {
    economy: 0.85,
    business: 0.22,
    premium: 0.08,
  },
  timeScaleHours: {
    economy: 72,
    business: 48,
    premium: 60,
  },
  distancePower: {
    economy: 1.35,
    business: 1.55,
    premium: 1.4,
  },
  acceptableFareMultiplier: {
    economy: 1,
    business: 1.8,
    premium: 2.8,
  },
  baseBoardingFare: 20,
  farePerDistance: 0.8,
  farePerReferenceHour: 2,
};

export const DEFAULT_CLASS_FARE_MULTIPLIER: Record<PassengerClass, number> = {
  economy: 1,
  business: 1.35,
  premium: 2.1,
};

export const MODE_REFERENCE_SPEED = {
  sublight: 1,
  warp: 4,
  hyperspace: 5,
} as const;

export const PASSENGER_SATISFACTION_WEIGHTS = {
  economy: { speed: 0.2, comfort: 0.25, reliability: 0.25, condition: 0.3 },
  business: { speed: 0.45, comfort: 0.15, reliability: 0.3, condition: 0.1 },
  premium: { speed: 0.15, comfort: 0.45, reliability: 0.15, condition: 0.25 },
} as const;
