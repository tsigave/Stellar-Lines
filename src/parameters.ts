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
    },
    business: {
      fare: 1.2,
      time: 3,
      wait: 1.8,
      transfer: 1.5,
      comfort: 0.5,
      reputation: 0.8,
      reliability: 1.5,
    },
    premium: {
      fare: 0.8,
      time: 2,
      wait: 0.8,
      transfer: 2,
      comfort: 1.8,
      reputation: 1.5,
      reliability: 1.2,
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
  warp: 5,
  hyperspace: 9,
} as const;
