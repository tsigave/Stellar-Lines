import { defaultBuildForShipType } from "../propulsion.js";
import type { GeneratedGalaxy, GalaxyGenerationConfig, Route, ShipType, SimulationScenario } from "../types.js";
import { createGeneratedGameEvents, dynamicFuelPorts, fuelPriceRecord } from "./fuel.js";
import {
  buildGameSchedule,
  gameWorldLegs,
  operationalPlayerRoutes,
  shipsForRoute,
} from "./schedule.js";
import { createShipyardMarket } from "./ships.js";
import {
  CORE_FUEL_STORAGE_CAPACITY,
  DEFAULT_AUTO_MAINTENANCE_THRESHOLD,
  GAME_DEMAND_SCALE,
  GAME_STATE_VERSION,
  STARTING_CASH,
  type GameState,
  type OwnedShip,
} from "./model.js";

function copyConfig(config: GalaxyGenerationConfig): GalaxyGenerationConfig {
  return { ...config };
}

export function createNewGame(
  config: GalaxyGenerationConfig,
  galaxy: GeneratedGalaxy,
  basePortId: string,
  shipTypes: readonly ShipType[] = [],
  staticAiRoutes: readonly Route[] = [],
): GameState {
  const basePort = galaxy.ports.find((port) => port.id === basePortId);
  if (!basePort) throw new Error("请选择一个有效的基地星球");
  const starterType = shipTypes.find((shipType) => shipType.id === "meridian-liner");
  const initial: GameState = {
    version: GAME_STATE_VERSION,
    config: copyConfig(config),
    companyName: "远星航运",
    day: 1,
    cash: STARTING_CASH,
    basePortId: basePort.id,
    fleet: [
      {
        id: "ship-1",
        name: "远星一号",
        shipTypeId: "meridian-liner",
        routeId: null,
        condition: 100,
        flightHoursSinceMaintenance: 0,
        maintenanceUntilDay: null,
        configurationId: null,
        commissionedDay: 1,
        purchasePricePaid: starterType?.purchasePrice ?? 2_200_000,
        currentPortId: basePort.id,
        ...(starterType ? { build: defaultBuildForShipType(starterType) } : {}),
      },
    ],
    fleetConfigurations: [],
    shipyardMarket: createShipyardMarket(config.seed, shipTypes),
    shipPurchaseOrders: [],
    routes: [],
    history: [],
    fuelMarket: [fuelPriceRecord(galaxy, 1)],
    fuelWarehouse: {
      rented: false,
      capacity: CORE_FUEL_STORAGE_CAPACITY,
      quantity: 0,
      averageUnitCost: 0,
      dailyWithdrawalLimit: null,
      surplusPolicy: "store-first",
    },
    fuelContracts: [],
    fuelAutoContractPolicy: {
      enabled: false,
      triggerPrice: 1.5,
      termWeeks: 16,
      spotExposureShare: 0.4,
    },
    nextFuelContractNumber: 1,
    nextShipNumber: 2,
    nextFleetConfigurationNumber: 1,
    nextPurchaseAgreementNumber: 1,
    nextRouteNumber: 1,
    status: "playing",
    primaryGoalCompletedOnDay: null,
    autoMaintenanceThreshold: DEFAULT_AUTO_MAINTENANCE_THRESHOLD,
    autoReplacementAgeYears: null,
    scheduledFlights: [],
    shipLogs: [],
    starportCapacity: [],
    pendingFleetChanges: [],
    starportCapacityInvestments: {},
    companyReputation: 70,
    localReputation: { [basePort.id]: 72 },
    unsettledFinancialEvents: [],
    staticAiRoutes,
  };
  const schedule = buildGameSchedule(initial, galaxy, shipTypes, 7);
  return { ...initial, scheduledFlights: schedule.flights, shipLogs: schedule.shipLogs, starportCapacity: schedule.starportCapacity };
}

export function migrateGameState(value: unknown): unknown {
  // v0.7 is an intentional physics/save boundary. Retain old storage untouched,
  // but never reinterpret v0.6.1 aggregate ship and FU data as v0.7 mass state.
  return value;
}

export function isGameState(value: unknown): value is GameState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<GameState>;
  return (
    candidate.version === GAME_STATE_VERSION &&
    Number.isInteger(candidate.day) &&
    typeof candidate.cash === "number" &&
    !!candidate.config &&
    Array.isArray(candidate.fleet) &&
    candidate.fleet.every((ship) =>
      !!ship &&
      typeof ship === "object" &&
      ((ship as Partial<OwnedShip>).configurationId === null ||
        typeof (ship as Partial<OwnedShip>).configurationId === "string")
    ) &&
    Array.isArray(candidate.fleetConfigurations) &&
    candidate.fleetConfigurations.every((configuration) => !!configuration?.build) &&
    Array.isArray(candidate.shipyardMarket) &&
    Array.isArray(candidate.shipPurchaseOrders) &&
    candidate.shipPurchaseOrders.every((order) => !!order?.build) &&
    Array.isArray(candidate.routes) &&
    Array.isArray(candidate.history) &&
    Array.isArray(candidate.fuelMarket) &&
    !!candidate.fuelWarehouse &&
    typeof candidate.fuelWarehouse.quantity === "number" &&
    typeof candidate.fuelWarehouse.capacity === "number" &&
    Array.isArray(candidate.fuelContracts) &&
    Array.isArray(candidate.scheduledFlights) &&
    Array.isArray(candidate.shipLogs) &&
    Array.isArray(candidate.starportCapacity) &&
    Array.isArray(candidate.pendingFleetChanges) &&
    !!candidate.starportCapacityInvestments &&
    typeof candidate.companyReputation === "number" &&
    !!candidate.localReputation &&
    Array.isArray(candidate.unsettledFinancialEvents) &&
    Array.isArray(candidate.staticAiRoutes) &&
    !!candidate.fuelAutoContractPolicy &&
    typeof candidate.nextFuelContractNumber === "number" &&
    typeof candidate.autoMaintenanceThreshold === "number" &&
    (candidate.autoReplacementAgeYears === null || typeof candidate.autoReplacementAgeYears === "number")
  );
}

export function gameScenario(
  baseScenario: SimulationScenario,
  galaxy: GeneratedGalaxy,
  state: GameState,
): SimulationScenario {
  const dynamicPorts = dynamicFuelPorts(galaxy, state.day).map((port) => ({
    ...port,
    population: port.population * GAME_DEMAND_SCALE,
  }));
  return {
    ...baseScenario,
    companyReputation: { ...baseScenario.companyReputation, player: state.companyReputation },
    ports: dynamicPorts,
    worldLegs: gameWorldLegs(galaxy),
    routes: [
      ...baseScenario.routes.filter((route) => route.companyId !== "player"),
      ...operationalPlayerRoutes(state, baseScenario.shipTypes),
    ],
    shipConditionByRoute: Object.fromEntries(state.routes.map((route) => {
      const ships = shipsForRoute(state, route.id);
      const averageCondition = ships.length > 0
        ? ships.reduce((sum, ship) => sum + ship.condition, 0) / ships.length
        : 100;
      return [route.id, averageCondition];
    })),
    onTimeRateByRoute: Object.fromEntries(state.routes.map((route) => {
      const currentFlights = state.scheduledFlights.filter((flight) => flight.routeId === route.id && Math.floor(flight.departureMinute / 1_440) === state.day);
      if (currentFlights.length > 0) return [route.id, currentFlights.filter((flight) => flight.onTime).length / currentFlights.length];
      const recent = [...state.history].reverse().find((record) => record.routes.some((summary) => summary.routeId === route.id));
      return [route.id, recent?.routes.find((summary) => summary.routeId === route.id)?.onTimeRate ?? 0.92];
    })),
    // Fuel shocks have already been applied to the unified market quote above.
    // Keep their demand/capacity effects without reapplying a local fuel price.
    events: createGeneratedGameEvents(galaxy).map(({ fuelPriceModifier: _fuelPriceModifier, ...event }) => event),
  };
}

