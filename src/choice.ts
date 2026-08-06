import { DEFAULT_CHOICE_PARAMETERS } from "./parameters.js";
import type {
  ChoiceParameters,
  ChoiceRequest,
  JourneyOption,
  MarketDemand,
} from "./types.js";

export function totalJourneyHours(option: JourneyOption): number {
  return option.inVehicleHours + option.expectedWaitHours + option.transferHours;
}

export function generalizedCost(
  market: MarketDemand,
  option: JourneyOption,
  parameters: ChoiceParameters = DEFAULT_CHOICE_PARAMETERS,
): number {
  const weights = parameters.weights[market.passengerClass];
  const normalizedFare = option.fare / Math.max(1, market.acceptableFare);
  const normalizedTime = totalJourneyHours(option) / Math.max(1, market.referenceTimeHours);
  const normalizedWait = option.expectedWaitHours / 24;
  const comfortLoss = 1 - option.comfort / 100;
  const reputationLoss = 1 - option.reputation / 100;
  const delayRisk = 1 - option.onTimeRate;
  const satisfactionLoss = 1 - option.satisfaction / 100;

  return (
    weights.fare * normalizedFare +
    weights.time * normalizedTime +
    weights.wait * normalizedWait +
    weights.transfer * option.transferCount +
    weights.comfort * comfortLoss +
    weights.reputation * reputationLoss +
    weights.reliability * delayRisk +
    weights.satisfaction * satisfactionLoss
  );
}

export function chooseJourneys(
  market: MarketDemand,
  options: readonly JourneyOption[],
  parameters: ChoiceParameters = DEFAULT_CHOICE_PARAMETERS,
  passengerPool = market.potentialPassengers,
): ChoiceRequest {
  const matchingOptions = options.filter(
    (option) =>
      option.originPortId === market.originPortId &&
      option.destinationPortId === market.destinationPortId &&
      option.passengerClass === market.passengerClass,
  );
  const temperature = parameters.temperature[market.passengerClass];
  const weights = matchingOptions.map((option) =>
    Math.exp(-generalizedCost(market, option, parameters) / temperature),
  );
  const noTravelWeight = Math.exp(
    -parameters.noTravelCost[market.passengerClass] / temperature,
  );
  const totalWeight = noTravelWeight + weights.reduce((sum, weight) => sum + weight, 0);
  const requestedByOption = new Map<string, number>();

  matchingOptions.forEach((option, index) => {
    requestedByOption.set(option.id, passengerPool * (weights[index]! / totalWeight));
  });

  return {
    market,
    options: matchingOptions,
    requestedByOption,
    initialNoTravel: passengerPool * (noTravelWeight / totalWeight),
  };
}
