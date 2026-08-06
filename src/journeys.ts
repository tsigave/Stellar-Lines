import { generalizedCost } from "./choice.js";
import { DEFAULT_CHOICE_PARAMETERS } from "./parameters.js";
import type {
  ChoiceParameters,
  JourneyOption,
  MarketDemand,
  PassengerClass,
  ServiceLeg,
} from "./types.js";
import { PASSENGER_CLASSES } from "./types.js";

export interface JourneySearchOptions {
  maximumServiceLegs?: number;
  maximumResults?: number;
  maximumTimeRatio?: number;
  minimumTransferHours?: number;
  choiceParameters?: ChoiceParameters;
  /** v0.5 默认仅允许单一航线直达；v0.7 再开放跨航线换乘。 */
  allowTransfers?: boolean;
}

function isDirectPath(path: readonly ServiceLeg[]): boolean {
  return path.length <= 1 || path.every((service) => service.routeId === path[0]!.routeId);
}

function buildOutgoingServices(
  services: readonly ServiceLeg[],
): ReadonlyMap<string, readonly ServiceLeg[]> {
  const outgoing = new Map<string, ServiceLeg[]>();
  for (const service of services) {
    if (service.departuresPerWeek <= 0 || service.dailySeatCapacity <= 0) continue;
    const entries = outgoing.get(service.fromPortId) ?? [];
    entries.push(service);
    outgoing.set(service.fromPortId, entries);
  }
  return outgoing;
}

function enumerateServicePaths(
  outgoing: ReadonlyMap<string, readonly ServiceLeg[]>,
  originPortId: string,
  destinationPortId: string,
  maximumServiceLegs: number,
): ServiceLeg[][] {
  const paths: ServiceLeg[][] = [];
  const seen = new Set<string>();
  const visit = (currentPortId: string, path: ServiceLeg[], visitedPorts: Set<string>): void => {
    if (path.length >= maximumServiceLegs || paths.length >= 500) return;
    for (const service of outgoing.get(currentPortId) ?? []) {
      if (visitedPorts.has(service.toPortId)) continue;
      const nextPath = [...path, service];
      if (service.toPortId === destinationPortId) {
        const key = nextPath.map((entry) => entry.id).join("|");
        if (!seen.has(key)) {
          seen.add(key);
          paths.push(nextPath);
        }
        continue;
      }
      const nextVisited = new Set(visitedPorts);
      nextVisited.add(service.toPortId);
      visit(service.toPortId, nextPath, nextVisited);
    }
  };
  visit(originPortId, [], new Set([originPortId]));
  return paths;
}

function halfHeadway(service: ServiceLeg): number {
  if (service.departuresPerWeek <= 0) return 96;
  return Math.min(96, 168 / service.departuresPerWeek / 2);
}

function pathToJourney(
  path: readonly ServiceLeg[],
  market: MarketDemand,
  cabinClass: PassengerClass,
  minimumTransferHours: number,
): JourneyOption {
  let inVehicleHours = 0;
  let expectedWaitHours = halfHeadway(path[0]!);
  let transferHours = 0;
  let transferCount = 0;
  let weightedComfort = 0;
  let weightedReputation = 0;
  let weightedOnTime = 0;
  let weightedSatisfaction = 0;
  let weightHours = 0;

  path.forEach((service, index) => {
    inVehicleHours += service.inVehicleHours;
    const serviceWeight = Math.max(0.1, service.inVehicleHours);
    weightHours += serviceWeight;
    weightedComfort += service.comfort * serviceWeight;
    weightedReputation += service.reputation * serviceWeight;
    weightedOnTime += service.onTimeRate * serviceWeight;
    weightedSatisfaction += (service.satisfactionByPassengerType?.[market.passengerType]
      ?? service.satisfactionByClass[cabinClass]) * serviceWeight;

    const next = path[index + 1];
    if (!next) return;
    if (next.routeId === service.routeId) {
      inVehicleHours += service.destinationDwellHours;
    } else {
      transferCount += 1;
      transferHours += minimumTransferHours;
      expectedWaitHours += halfHeadway(next);
    }
  });

  const fareByServiceLeg = path.map((service) => service.fareByClass[cabinClass]);
  return {
    id: `${market.originPortId}->${market.destinationPortId}:${market.passengerType}:${cabinClass}:${path
      .map((service) => service.id)
      .join("+")}`,
    originPortId: market.originPortId,
    destinationPortId: market.destinationPortId,
    passengerType: market.passengerType,
    cabinClass,
    serviceLegIds: path.map((service) => service.id),
    companies: [...new Set(path.map((service) => service.companyId))],
    fare: fareByServiceLeg.reduce((sum, fare) => sum + fare, 0),
    fareByServiceLeg,
    inVehicleHours,
    expectedWaitHours,
    transferHours,
    transferCount,
    comfort: weightedComfort / weightHours,
    reputation: weightedReputation / weightHours,
    onTimeRate: weightedOnTime / weightHours,
    satisfaction: weightedSatisfaction / weightHours,
  };
}

export function buildJourneyOptions(
  services: readonly ServiceLeg[],
  market: MarketDemand,
  options: JourneySearchOptions = {},
): JourneyOption[] {
  const maximumServiceLegs = options.maximumServiceLegs ?? 3;
  const maximumResults = options.maximumResults ?? 12;
  const maximumTimeRatio = options.maximumTimeRatio ?? 12;
  const minimumTransferHours = options.minimumTransferHours ?? 2;
  const choiceParameters = options.choiceParameters ?? DEFAULT_CHOICE_PARAMETERS;
  const allowTransfers = options.allowTransfers ?? false;
  const outgoing = buildOutgoingServices(services);
  return enumerateServicePaths(
    outgoing,
    market.originPortId,
    market.destinationPortId,
    maximumServiceLegs,
  )
    .filter((path) => allowTransfers || isDirectPath(path))
    .flatMap((path) => PASSENGER_CLASSES
      .filter((cabinClass) => path.every((service) =>
        service.dailySeatCapacityByClass
          ? service.dailySeatCapacityByClass[cabinClass] > 0
          : service.dailySeatCapacity > 0,
      ))
      .map((cabinClass) => pathToJourney(path, market, cabinClass, minimumTransferHours)))
    .filter(
      (journey) =>
        journey.inVehicleHours + journey.expectedWaitHours + journey.transferHours <=
        market.referenceTimeHours * maximumTimeRatio,
    )
    .sort(
      (left, right) =>
        generalizedCost(market, left, choiceParameters) -
        generalizedCost(market, right, choiceParameters),
    )
    .slice(0, maximumResults);
}

function marketKey(market: MarketDemand): string {
  return `${market.originPortId}->${market.destinationPortId}:${market.passengerType}`;
}

export function buildJourneyOptionsForMarkets(
  services: readonly ServiceLeg[],
  markets: readonly MarketDemand[],
  options: JourneySearchOptions = {},
): ReadonlyMap<string, readonly JourneyOption[]> {
  const maximumServiceLegs = options.maximumServiceLegs ?? 3;
  const maximumResults = options.maximumResults ?? 12;
  const maximumTimeRatio = options.maximumTimeRatio ?? 12;
  const minimumTransferHours = options.minimumTransferHours ?? 2;
  const choiceParameters = options.choiceParameters ?? DEFAULT_CHOICE_PARAMETERS;
  const allowTransfers = options.allowTransfers ?? false;
  const outgoing = buildOutgoingServices(services);
  const pathsByPair = new Map<string, ServiceLeg[][]>();
  const result = new Map<string, JourneyOption[]>();

  for (const market of markets) {
    const pairKey = `${market.originPortId}->${market.destinationPortId}`;
    let paths = pathsByPair.get(pairKey);
    if (!paths) {
      paths = enumerateServicePaths(
        outgoing,
        market.originPortId,
        market.destinationPortId,
        maximumServiceLegs,
      );
      pathsByPair.set(pairKey, paths);
    }
    const journeys = paths
      .filter((path) => allowTransfers || isDirectPath(path))
      .flatMap((path) => PASSENGER_CLASSES
        .filter((cabinClass) => path.every((service) =>
          service.dailySeatCapacityByClass
            ? service.dailySeatCapacityByClass[cabinClass] > 0
            : service.dailySeatCapacity > 0,
        ))
        .map((cabinClass) => pathToJourney(path, market, cabinClass, minimumTransferHours)))
      .filter(
        (journey) =>
          journey.inVehicleHours + journey.expectedWaitHours + journey.transferHours <=
          market.referenceTimeHours * maximumTimeRatio,
      )
      .sort(
        (left, right) =>
          generalizedCost(market, left, choiceParameters) -
          generalizedCost(market, right, choiceParameters),
      )
      .slice(0, maximumResults);
    result.set(marketKey(market), journeys);
  }
  return result;
}
