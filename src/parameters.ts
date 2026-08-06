import type { ChoiceParameters, DemandParameters, PassengerClass, PassengerType } from "./types.js";

/**
 * Fuel units describe physical consumption, while the quoted port price is a
 * market index. This converts that index into the delivered operating expense
 * (procurement, storage and handling included).
 */
export const FUEL_OPERATING_COST_SCALE = 27;

/** Effective share of the catalog maintenance reserve charged every day. */
export const FIXED_MAINTENANCE_COST_SCALE = 0.25;

export const DEFAULT_CHOICE_PARAMETERS: ChoiceParameters = {
  weights: {
    business: {
      fare: 1,
      time: 2.2,
      wait: 1.8,
      transfer: 1.5,
      comfort: 1,
      reputation: 0.8,
      reliability: 2.5,
      satisfaction: 1,
    },
    leisure: {
      fare: 2.8,
      time: 1.4,
      wait: 0.8,
      transfer: 1.6,
      comfort: 2.2,
      reputation: 0.5,
      reliability: 1.2,
      satisfaction: 0.8,
    },
    budget: {
      fare: 4.5,
      time: 1.2,
      wait: 1,
      transfer: 1.3,
      comfort: 0.8,
      reputation: 0.3,
      reliability: 1.2,
      satisfaction: 0.5,
    },
    luxury: {
      fare: 0.5,
      time: 1.2,
      wait: 1,
      transfer: 1.5,
      comfort: 3.6,
      reputation: 1.5,
      reliability: 2.2,
      satisfaction: 1.8,
    },
  },
  temperature: {
    business: 0.6,
    leisure: 0.72,
    budget: 0.78,
    luxury: 0.62,
  },
  noTravelCost: {
    business: 7,
    leisure: 6.4,
    budget: 6.1,
    luxury: 6.8,
  },
  cabinPreference: {
    business: { economy: 0.1, business: 0.85, premium: 0.55 },
    leisure: { economy: 0.75, business: 0.38, premium: 0.12 },
    budget: { economy: 1, business: -0.5, premium: -1.2 },
    luxury: { economy: -1.2, business: 0.45, premium: 1.25 },
  },
};

export const DEFAULT_DEMAND_PARAMETERS: DemandParameters = {
  classScale: {
    business: 0.24,
    leisure: 0.48,
    budget: 0.42,
    luxury: 0.07,
  },
  timeScaleHours: {
    business: 48,
    leisure: 78,
    budget: 70,
    luxury: 62,
  },
  distancePower: {
    business: 1.55,
    leisure: 1.3,
    budget: 1.42,
    luxury: 1.36,
  },
  acceptableFareMultiplier: {
    business: 1.85,
    leisure: 1.15,
    budget: 0.82,
    luxury: 3.25,
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

export const PASSENGER_TYPE_SATISFACTION_WEIGHTS: Record<PassengerType, {
  speed: number; comfort: number; reliability: number; condition: number;
}> = {
  business: { speed: 0.32, comfort: 0.12, reliability: 0.4, condition: 0.16 },
  leisure: { speed: 0.18, comfort: 0.35, reliability: 0.2, condition: 0.27 },
  budget: { speed: 0.2, comfort: 0.15, reliability: 0.25, condition: 0.4 },
  luxury: { speed: 0.14, comfort: 0.48, reliability: 0.25, condition: 0.13 },
};
