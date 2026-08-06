import type {
  MarketEvent,
  Route,
  RoutePricing,
  ShipType,
  SimulationScenario,
  Starport,
  TravelMode,
  WorldLeg,
} from "../types.js";

type PortValues = Pick<
  Starport,
  | "population"
  | "economy"
  | "business"
  | "tourism"
  | "administration"
  | "portLevel"
  | "dailyCapacity"
  | "fuelPrice"
  | "serviceFee"
>;

function port(
  id: string,
  systemId: string,
  name: string,
  values: PortValues,
): Starport {
  return { id, systemId, name, ...values };
}

export const PROOF_OF_CONCEPT_PORTS: readonly Starport[] = [
  port("terra-central", "sol", "Terra Central", {
    population: 100, economy: 98, business: 100, tourism: 82, administration: 100,
    portLevel: 5, dailyCapacity: 5_000, fuelPrice: 2.7, serviceFee: 190,
  }),
  port("luna-freeport", "sol", "Luna Freeport", {
    population: 58, economy: 78, business: 74, tourism: 88, administration: 45,
    portLevel: 4, dailyCapacity: 2_100, fuelPrice: 2.3, serviceFee: 120,
  }),
  port("mars-dome", "sol", "Mars Dome", {
    population: 66, economy: 72, business: 62, tourism: 76, administration: 55,
    portLevel: 4, dailyCapacity: 1_900, fuelPrice: 2.5, serviceFee: 110,
  }),
  port("sol-hub", "sol", "Sol Hyperspace Hub", {
    population: 28, economy: 92, business: 90, tourism: 30, administration: 82,
    portLevel: 5, dailyCapacity: 6_000, fuelPrice: 2.1, serviceFee: 150,
  }),
  port("alpha-prime", "alpha-centauri", "Alpha Prime", {
    population: 80, economy: 88, business: 90, tourism: 62, administration: 86,
    portLevel: 5, dailyCapacity: 3_400, fuelPrice: 2.4, serviceFee: 155,
  }),
  port("proxima-outpost", "alpha-centauri", "Proxima Outpost", {
    population: 32, economy: 48, business: 42, tourism: 38, administration: 30,
    portLevel: 3, dailyCapacity: 850, fuelPrice: 3.2, serviceFee: 75,
  }),
  port("alpha-junction", "alpha-centauri", "Alpha Junction", {
    population: 24, economy: 84, business: 82, tourism: 28, administration: 70,
    portLevel: 5, dailyCapacity: 4_200, fuelPrice: 2.0, serviceFee: 130,
  }),
  port("meridian", "sirius", "Meridian", {
    population: 74, economy: 94, business: 96, tourism: 58, administration: 76,
    portLevel: 5, dailyCapacity: 3_100, fuelPrice: 2.8, serviceFee: 165,
  }),
  port("pelagos", "sirius", "Pelagos", {
    population: 46, economy: 60, business: 52, tourism: 96, administration: 35,
    portLevel: 3, dailyCapacity: 1_250, fuelPrice: 3.1, serviceFee: 90,
  }),
  port("sirius-hub", "sirius", "Sirius Exchange", {
    population: 26, economy: 86, business: 88, tourism: 34, administration: 72,
    portLevel: 5, dailyCapacity: 4_600, fuelPrice: 2.2, serviceFee: 135,
  }),
  port("aurora", "vega", "Aurora", {
    population: 55, economy: 72, business: 64, tourism: 100, administration: 40,
    portLevel: 4, dailyCapacity: 1_900, fuelPrice: 2.9, serviceFee: 125,
  }),
  port("karst", "vega", "Karst Industrial Port", {
    population: 42, economy: 82, business: 70, tourism: 24, administration: 42,
    portLevel: 3, dailyCapacity: 1_400, fuelPrice: 2.3, serviceFee: 95,
  }),
  port("vega-hub", "vega", "Vega Crossing", {
    population: 22, economy: 80, business: 78, tourism: 35, administration: 65,
    portLevel: 5, dailyCapacity: 4_000, fuelPrice: 2.0, serviceFee: 125,
  }),
  port("new-haven", "tau-ceti", "New Haven", {
    population: 48, economy: 66, business: 58, tourism: 68, administration: 72,
    portLevel: 4, dailyCapacity: 1_550, fuelPrice: 2.7, serviceFee: 105,
  }),
  port("greenfield", "tau-ceti", "Greenfield", {
    population: 38, economy: 58, business: 38, tourism: 64, administration: 35,
    portLevel: 3, dailyCapacity: 1_000, fuelPrice: 2.4, serviceFee: 78,
  }),
  port("tau-relay", "tau-ceti", "Tau Relay", {
    population: 18, economy: 70, business: 68, tourism: 22, administration: 58,
    portLevel: 4, dailyCapacity: 2_800, fuelPrice: 2.1, serviceFee: 105,
  }),
  port("frontier", "epsilon-eridani", "Frontier Landing", {
    population: 28, economy: 44, business: 34, tourism: 52, administration: 48,
    portLevel: 3, dailyCapacity: 780, fuelPrice: 3.4, serviceFee: 72,
  }),
  port("kepler-labs", "epsilon-eridani", "Kepler Research Array", {
    population: 16, economy: 52, business: 78, tourism: 36, administration: 55,
    portLevel: 3, dailyCapacity: 620, fuelPrice: 3.2, serviceFee: 68,
  }),
  port("hektor-mines", "epsilon-eridani", "Hektor Mines", {
    population: 34, economy: 64, business: 46, tourism: 18, administration: 30,
    portLevel: 2, dailyCapacity: 700, fuelPrice: 3.6, serviceFee: 62,
  }),
  port("epsilon-relay", "epsilon-eridani", "Epsilon Relay", {
    population: 14, economy: 62, business: 60, tourism: 20, administration: 50,
    portLevel: 4, dailyCapacity: 2_100, fuelPrice: 2.5, serviceFee: 92,
  }),
];

function leg(
  id: string,
  fromPortId: string,
  toPortId: string,
  mode: TravelMode,
  distance: number,
  hazard = 0.04,
): WorldLeg {
  return {
    id,
    fromPortId,
    toPortId,
    mode,
    distance,
    hazard,
    timeModifier: 1,
    fuelModifier: 1,
    isOpen: true,
  };
}

export const PROOF_OF_CONCEPT_WORLD_LEGS: readonly WorldLeg[] = [
  leg("terra-sol", "terra-central", "sol-hub", "sublight", 8, 0.01),
  leg("luna-sol", "luna-freeport", "sol-hub", "sublight", 4, 0.01),
  leg("mars-sol", "mars-dome", "sol-hub", "sublight", 16, 0.02),
  leg("terra-luna", "terra-central", "luna-freeport", "sublight", 6, 0.01),
  leg("mars-terra", "mars-dome", "terra-central", "sublight", 14, 0.02),
  leg("alpha-junction-prime", "alpha-junction", "alpha-prime", "sublight", 6, 0.01),
  leg("alpha-junction-proxima", "alpha-junction", "proxima-outpost", "sublight", 10, 0.03),
  leg("sirius-hub-meridian", "sirius-hub", "meridian", "sublight", 5, 0.01),
  leg("sirius-hub-pelagos", "sirius-hub", "pelagos", "sublight", 9, 0.02),
  leg("vega-hub-aurora", "vega-hub", "aurora", "sublight", 7, 0.01),
  leg("vega-hub-karst", "vega-hub", "karst", "sublight", 12, 0.02),
  leg("tau-relay-haven", "tau-relay", "new-haven", "sublight", 5, 0.01),
  leg("tau-relay-greenfield", "tau-relay", "greenfield", "sublight", 8, 0.02),
  leg("epsilon-relay-frontier", "epsilon-relay", "frontier", "sublight", 6, 0.03),
  leg("epsilon-relay-kepler", "epsilon-relay", "kepler-labs", "sublight", 10, 0.03),
  leg("epsilon-relay-hektor", "epsilon-relay", "hektor-mines", "sublight", 14, 0.04),

  leg("hyper-sol-alpha", "sol-hub", "alpha-junction", "hyperspace", 45),
  leg("hyper-alpha-sirius", "alpha-junction", "sirius-hub", "hyperspace", 52),
  leg("hyper-sirius-vega", "sirius-hub", "vega-hub", "hyperspace", 60, 0.06),
  leg("hyper-vega-tau", "vega-hub", "tau-relay", "hyperspace", 55, 0.05),
  leg("hyper-tau-epsilon", "tau-relay", "epsilon-relay", "hyperspace", 70, 0.08),
  leg("hyper-sol-sirius", "sol-hub", "sirius-hub", "hyperspace", 85, 0.07),
  leg("hyper-alpha-vega", "alpha-junction", "vega-hub", "hyperspace", 95, 0.09),

  leg("warp-terra-alpha", "terra-central", "alpha-prime", "warp", 50, 0.04),
  leg("warp-luna-proxima", "luna-freeport", "proxima-outpost", "warp", 48, 0.06),
  leg("warp-meridian-aurora", "meridian", "aurora", "warp", 55, 0.05),
  leg("warp-haven-frontier", "new-haven", "frontier", "warp", 62, 0.08),
];

export const PROOF_OF_CONCEPT_SHIPS: readonly ShipType[] = [
  {
    id: "sparrow-shuttle", name: "Sparrow Shuttle", seats: 32, purchasePrice: 180_000,
    supportedModes: ["sublight"], speedByMode: { sublight: 1 },
    maxRangeByMode: { sublight: 24 }, fuelPerDistanceByMode: { sublight: 0.42 },
    maintenancePerFlightHour: 18, crewCostPerFlightHour: 16, reliability: 0.97,
    comfort: 52, minimumPortLevel: 1, turnaroundHours: 0.75, operationalAvailability: 0.95,
  },
  {
    id: "pioneer-regional", name: "Pioneer Regional", seats: 64, purchasePrice: 520_000,
    supportedModes: ["sublight", "warp"], speedByMode: { sublight: 0.9, warp: 2.8 },
    maxRangeByMode: { sublight: 32, warp: 70 }, fuelPerDistanceByMode: { sublight: 0.55, warp: 1.05 },
    maintenancePerFlightHour: 28, crewCostPerFlightHour: 22, reliability: 0.94,
    comfort: 62, minimumPortLevel: 2, turnaroundHours: 1.25, operationalAvailability: 0.92,
  },
  {
    id: "arrow-express", name: "Arrow Express", seats: 48, purchasePrice: 920_000,
    supportedModes: ["sublight", "warp"], speedByMode: { sublight: 1.2, warp: 4.8 },
    maxRangeByMode: { sublight: 28, warp: 65 }, fuelPerDistanceByMode: { sublight: 0.72, warp: 1.55 },
    maintenancePerFlightHour: 42, crewCostPerFlightHour: 30, reliability: 0.965,
    comfort: 76, minimumPortLevel: 3, turnaroundHours: 0.9, operationalAvailability: 0.94,
  },
  {
    id: "meridian-liner", name: "Meridian Liner", seats: 180, purchasePrice: 2_200_000,
    supportedModes: ["sublight", "hyperspace"], speedByMode: { sublight: 0.8, hyperspace: 4 },
    maxRangeByMode: { sublight: 28, hyperspace: 110 }, fuelPerDistanceByMode: { sublight: 0.9, hyperspace: 0.68 },
    maintenancePerFlightHour: 62, crewCostPerFlightHour: 45, reliability: 0.95,
    comfort: 72, minimumPortLevel: 3, turnaroundHours: 1.8, operationalAvailability: 0.93,
  },
  {
    id: "atlas-liner", name: "Atlas Grand Liner", seats: 360, purchasePrice: 4_800_000,
    supportedModes: ["sublight", "hyperspace"], speedByMode: { sublight: 0.65, hyperspace: 3.2 },
    maxRangeByMode: { sublight: 24, hyperspace: 130 }, fuelPerDistanceByMode: { sublight: 1.4, hyperspace: 1.05 },
    maintenancePerFlightHour: 105, crewCostPerFlightHour: 72, reliability: 0.925,
    comfort: 66, minimumPortLevel: 4, turnaroundHours: 3, operationalAvailability: 0.89,
  },
  {
    id: "celestial-yacht", name: "Celestial Yacht", seats: 84, purchasePrice: 3_600_000,
    supportedModes: ["sublight", "warp"],
    speedByMode: { sublight: 1.1, warp: 4.2 },
    maxRangeByMode: { sublight: 30, warp: 80 },
    fuelPerDistanceByMode: { sublight: 1.1, warp: 1.8 },
    maintenancePerFlightHour: 118, crewCostPerFlightHour: 64, reliability: 0.975,
    comfort: 96, minimumPortLevel: 4, turnaroundHours: 1.6, operationalAvailability: 0.94,
  },
  {
    id: "comet-courier", name: "Comet Courier", seats: 24, purchasePrice: 680_000,
    supportedModes: ["sublight", "warp"], speedByMode: { sublight: 1.15, warp: 4 },
    maxRangeByMode: { sublight: 26, warp: 58 }, fuelPerDistanceByMode: { sublight: 0.48, warp: 1.18 },
    maintenancePerFlightHour: 31, crewCostPerFlightHour: 20, reliability: 0.955,
    comfort: 68, minimumPortLevel: 2, turnaroundHours: 0.7, operationalAvailability: 0.95,
  },
  {
    id: "aurora-clipper", name: "Aurora Clipper", seats: 96, purchasePrice: 1_450_000,
    supportedModes: ["sublight", "hyperspace"], speedByMode: { sublight: 1, hyperspace: 5 },
    maxRangeByMode: { sublight: 30, hyperspace: 130 }, fuelPerDistanceByMode: { sublight: 0.68, hyperspace: 0.82 },
    maintenancePerFlightHour: 54, crewCostPerFlightHour: 34, reliability: 0.972,
    comfort: 82, minimumPortLevel: 3, turnaroundHours: 1.1, operationalAvailability: 0.95,
  },
  {
    id: "horizon-coach", name: "Horizon Coach", seats: 140, purchasePrice: 1_250_000,
    supportedModes: ["sublight", "hyperspace"], speedByMode: { sublight: 0.75, hyperspace: 2.6 },
    maxRangeByMode: { sublight: 26, hyperspace: 105 }, fuelPerDistanceByMode: { sublight: 0.7, hyperspace: 0.56 },
    maintenancePerFlightHour: 44, crewCostPerFlightHour: 31, reliability: 0.94,
    comfort: 60, minimumPortLevel: 2, turnaroundHours: 1.5, operationalAvailability: 0.93,
  },
  {
    id: "vector-executive", name: "Vector Executive", seats: 36, purchasePrice: 1_650_000,
    supportedModes: ["sublight", "warp"], speedByMode: { sublight: 1.2, warp: 5 },
    maxRangeByMode: { sublight: 28, warp: 70 }, fuelPerDistanceByMode: { sublight: 0.72, warp: 1.7 },
    maintenancePerFlightHour: 63, crewCostPerFlightHour: 38, reliability: 0.978,
    comfort: 90, minimumPortLevel: 4, turnaroundHours: 0.85, operationalAvailability: 0.96,
  },
  {
    id: "odyssey-sleeper", name: "Odyssey Sleeper", seats: 240, purchasePrice: 3_100_000,
    supportedModes: ["sublight", "hyperspace"], speedByMode: { sublight: 0.72, hyperspace: 3.6 },
    maxRangeByMode: { sublight: 25, hyperspace: 125 }, fuelPerDistanceByMode: { sublight: 1.08, hyperspace: 0.92 },
    maintenancePerFlightHour: 88, crewCostPerFlightHour: 58, reliability: 0.958,
    comfort: 88, minimumPortLevel: 4, turnaroundHours: 2.3, operationalAvailability: 0.92,
  },
];

const standardPricing: RoutePricing = {
  multiplier: 1,
  passengerClassMultiplier: { economy: 1, business: 1.35, premium: 2.1 },
};

function route(
  id: string,
  companyId: string,
  name: string,
  stopIds: readonly string[],
  shipTypeId: string,
  assignedShips: number,
  priceMultiplier: number,
  kind: Route["kind"] = "return",
): Route {
  return {
    id,
    companyId,
    name,
    kind,
    stops: stopIds.map((portId) => ({
      portId,
      stopType: "commercial" as const,
      minimumStopHours: 1,
    })),
    shipTypeId,
    assignedShips,
    pricing: { ...standardPricing, multiplier: priceMultiplier },
    maintenanceAllowanceHours: 2,
    active: true,
  };
}

export const PROOF_OF_CONCEPT_ROUTES: readonly Route[] = [
  route(
    "player-central-corridor", "player", "Central Corridor",
    ["terra-central", "sol-hub", "alpha-junction", "alpha-prime"],
    "meridian-liner", 3, 1,
  ),
  route(
    "player-vega-coast", "player", "Vega Coast",
    ["meridian", "sirius-hub", "vega-hub", "aurora"],
    "meridian-liner", 1, 1.05,
  ),
  route(
    "player-frontier-link", "player", "Frontier Link",
    ["new-haven", "frontier"], "pioneer-regional", 1, 1.1,
  ),
  route(
    "budget-sol-sirius", "nova-budget", "Sol–Sirius Saver",
    ["terra-central", "sol-hub", "sirius-hub", "meridian"],
    "atlas-liner", 5, 0.76,
  ),
  route(
    "budget-frontier-trunk", "nova-budget", "Frontier Trunk",
    ["new-haven", "tau-relay", "epsilon-relay", "frontier"],
    "meridian-liner", 2, 0.72,
  ),
  route(
    "swift-terra-alpha", "swift-business", "Terra–Alpha Direct",
    ["terra-central", "alpha-prime"], "arrow-express", 2, 1.35,
  ),
  route(
    "swift-meridian-aurora", "swift-business", "Meridian–Aurora Direct",
    ["meridian", "aurora"], "arrow-express", 1, 1.3,
  ),
  route(
    "local-sol-ring", "orbital-regional", "Sol Local Ring",
    ["terra-central", "luna-freeport", "sol-hub", "mars-dome"],
    "sparrow-shuttle", 3, 0.9, "loop",
  ),
  route(
    "local-alpha", "orbital-regional", "Alpha Local",
    ["alpha-prime", "alpha-junction", "proxima-outpost"],
    "pioneer-regional", 1, 0.92,
  ),
  route(
    "luxury-grand-tour", "celestial-lines", "Grand Tour",
    ["alpha-prime", "alpha-junction", "vega-hub", "aurora"],
    "aurora-clipper", 1, 1.7,
  ),
];

export const PROOF_OF_CONCEPT_EVENTS: readonly MarketEvent[] = [
  {
    id: "alpha-industry-expo",
    name: "Alpha Interstellar Industry Expo",
    description: "A major industry exhibition draws business and premium travelers to Alpha Prime.",
    announcedOnDay: 10, startsOnDay: 30, endsOnDay: 48, recoveryDays: 7,
    affectedPortIds: ["alpha-prime"],
    demandModifiers: { economy: 1.25, business: 2.8, premium: 1.9 },
    portCapacityModifier: 0.9,
  },
  {
    id: "sirius-fuel-crisis",
    name: "Sirius Fuel Supply Crisis",
    description: "A refinery shutdown sharply raises fuel prices throughout Sirius.",
    announcedOnDay: 45, startsOnDay: 60, endsOnDay: 75, recoveryDays: 14,
    affectedPortIds: ["meridian", "pelagos", "sirius-hub"],
    demandModifiers: {}, fuelPriceModifier: 1.85,
  },
  {
    id: "vega-hyperspace-storm",
    name: "Vega Hyperspace Storm",
    description: "Unstable currents slow all services entering the Vega system.",
    announcedOnDay: 76, startsOnDay: 90, endsOnDay: 101, recoveryDays: 5,
    affectedPortIds: ["aurora", "karst", "vega-hub"],
    demandModifiers: { economy: 0.9, business: 0.82, premium: 0.86 },
    travelTimeModifier: 1.55,
  },
  {
    id: "aurora-light-festival",
    name: "Aurora Festival of Light",
    description: "The celebrated festival creates a seasonal tourism boom.",
    announcedOnDay: 98, startsOnDay: 120, endsOnDay: 140, recoveryDays: 8,
    affectedPortIds: ["aurora"],
    demandModifiers: { economy: 1.7, business: 1.15, premium: 2.4 },
  },
  {
    id: "frontier-settlement-wave",
    name: "Frontier Settlement Wave",
    description: "A new habitat program attracts settlers and supporting professionals.",
    announcedOnDay: 142, startsOnDay: 160, endsOnDay: 190, recoveryDays: 20,
    affectedPortIds: ["frontier"],
    demandModifiers: { economy: 2.1, business: 1.6, premium: 1.25 },
  },
];

export const PROOF_OF_CONCEPT_SCENARIO: SimulationScenario = {
  id: "proof-of-concept",
  name: "Six Systems",
  seed: 8042026,
  ports: PROOF_OF_CONCEPT_PORTS,
  worldLegs: PROOF_OF_CONCEPT_WORLD_LEGS,
  shipTypes: PROOF_OF_CONCEPT_SHIPS,
  routes: PROOF_OF_CONCEPT_ROUTES,
  companyReputation: {
    player: 60,
    "nova-budget": 52,
    "swift-business": 72,
    "orbital-regional": 68,
    "celestial-lines": 84,
  },
  events: PROOF_OF_CONCEPT_EVENTS,
};
