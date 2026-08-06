import { DEFAULT_CHOICE_PARAMETERS } from "./parameters.js";
import type {
  ChoiceParameters,
  ChoiceRequest,
  JourneyOption,
  MarketDemand,
  SatisfactionReason,
} from "./types.js";

export function totalJourneyHours(option: JourneyOption): number {
  return option.inVehicleHours + option.expectedWaitHours + option.transferHours;
}

export function generalizedCost(
  market: MarketDemand,
  option: JourneyOption,
  parameters: ChoiceParameters = DEFAULT_CHOICE_PARAMETERS,
): number {
  const weights = parameters.weights[market.passengerType];
  const normalizedFare = option.fare / Math.max(1, market.acceptableFare);
  const normalizedTime = totalJourneyHours(option) / Math.max(1, market.referenceTimeHours);
  const normalizedWait = option.expectedWaitHours / 24;
  const comfortLoss = 1 - option.comfort / 100;
  const reputationLoss = 1 - option.reputation / 100;
  const delayRisk = 1 - option.onTimeRate;
  const satisfactionLoss = 1 - option.satisfaction / 100;

  const cabinPreference = parameters.cabinPreference[market.passengerType][option.cabinClass];
  return (
    weights.fare * normalizedFare +
    weights.time * normalizedTime +
    weights.wait * normalizedWait +
    weights.transfer * option.transferCount +
    weights.comfort * comfortLoss +
    weights.reputation * reputationLoss +
    weights.reliability * delayRisk +
    weights.satisfaction * satisfactionLoss -
    cabinPreference
  );
}

export function explainJourneyChoice(
  market: MarketDemand,
  option: JourneyOption,
): { satisfaction: number; positive: SatisfactionReason[]; negative: SatisfactionReason[] } {
  const fareRatio = option.fare / Math.max(1, market.acceptableFare);
  const timeDelta = totalJourneyHours(option) - market.referenceTimeHours;
  const reasons: SatisfactionReason[] = [
    {
      code: "fare",
      text: fareRatio <= 1
        ? `${option.cabinClass === "economy" ? "经济" : option.cabinClass === "business" ? "商务" : "头等"}舱票价低于可接受价 ${Math.round((1 - fareRatio) * 100)}%`
        : `${option.cabinClass === "economy" ? "经济" : option.cabinClass === "business" ? "商务" : "头等"}舱票价高于可接受价 ${Math.round((fareRatio - 1) * 100)}%`,
      impact: Math.min(45, Math.abs(1 - fareRatio) * 45),
      positive: fareRatio <= 1,
    },
    {
      code: "time",
      text: timeDelta <= 0
        ? `行程比市场基准节省 ${Math.abs(timeDelta).toFixed(1)} 小时`
        : `行程比市场基准多用 ${timeDelta.toFixed(1)} 小时`,
      impact: Math.min(35, Math.abs(timeDelta) / Math.max(1, market.referenceTimeHours) * 35),
      positive: timeDelta <= 0,
    },
    {
      code: "direct",
      text: option.transferCount === 0 ? "直达服务，无需换乘" : `需要换乘 ${option.transferCount} 次`,
      impact: option.transferCount === 0 ? 16 : Math.min(36, option.transferCount * 18),
      positive: option.transferCount === 0,
    },
    {
      code: "reliability",
      text: `预计准点率 ${(option.onTimeRate * 100).toFixed(1)}%`,
      impact: Math.abs(option.onTimeRate - 0.9) * 70,
      positive: option.onTimeRate >= 0.9,
    },
    {
      code: "comfort",
      text: `客舱舒适度 ${option.comfort.toFixed(0)} / 100`,
      impact: Math.abs(option.comfort - 65) * 0.55,
      positive: option.comfort >= 65,
    },
    {
      code: "frequency",
      text: `平均候机 ${option.expectedWaitHours.toFixed(1)} 小时`,
      impact: Math.min(30, option.expectedWaitHours / 3),
      positive: option.expectedWaitHours <= 12,
    },
  ];
  const positive = reasons.filter((reason) => reason.positive).sort((a, b) => b.impact - a.impact).slice(0, 3);
  const negative = reasons.filter((reason) => !reason.positive).sort((a, b) => b.impact - a.impact).slice(0, 3);
  const positiveImpact = positive.reduce((sum, reason) => sum + reason.impact, 0);
  const negativeImpact = negative.reduce((sum, reason) => sum + reason.impact, 0);
  return {
    satisfaction: Math.max(0, Math.min(100, 62 + positiveImpact * 0.35 - negativeImpact * 0.55)),
    positive,
    negative,
  };
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
      option.passengerType === market.passengerType,
  );
  const temperature = parameters.temperature[market.passengerType];
  const weights = matchingOptions.map((option) =>
    Math.exp(-generalizedCost(market, option, parameters) / temperature),
  );
  const noTravelWeight = Math.exp(
    -parameters.noTravelCost[market.passengerType] / temperature,
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
