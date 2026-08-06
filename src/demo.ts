import {
  allReferenceTimes,
  buildRouteServices,
  generateMarketDemands,
  simulateDay,
  type Route,
  type ShipType,
  type Starport,
  type WorldLeg,
} from "./index.js";

const ports: Starport[] = [
  {
    id: "sol",
    systemId: "sol-system",
    name: "太阳系中央港",
    population: 95,
    economy: 95,
    business: 95,
    tourism: 70,
    administration: 100,
    portLevel: 5,
    dailyCapacity: 4_000,
    fuelPrice: 2.8,
    serviceFee: 500,
  },
  {
    id: "alpha",
    systemId: "alpha-system",
    name: "阿尔法轨道站",
    population: 62,
    economy: 78,
    business: 72,
    tourism: 50,
    administration: 55,
    portLevel: 4,
    dailyCapacity: 2_000,
    fuelPrice: 2.4,
    serviceFee: 360,
  },
  {
    id: "haven",
    systemId: "haven-system",
    name: "新港殖民地",
    population: 34,
    economy: 48,
    business: 35,
    tourism: 88,
    administration: 30,
    portLevel: 3,
    dailyCapacity: 900,
    fuelPrice: 3.6,
    serviceFee: 220,
  },
];

const baseLegs: Array<
  readonly [string, string, string, WorldLeg["mode"], number]
> = [
  ["sol-alpha", "sol", "alpha", "hyperspace", 45],
  ["alpha-haven", "alpha", "haven", "hyperspace", 38],
  ["sol-haven", "sol", "haven", "warp", 70],
];

const worldLegs: WorldLeg[] = baseLegs.flatMap(
  ([id, fromPortId, toPortId, mode, distance]) => [
  {
    id,
    fromPortId,
    toPortId,
    mode,
    distance,
    hazard: 0.05,
    timeModifier: 1,
    fuelModifier: 1,
    isOpen: true,
  },
  {
    id: `${id}-reverse`,
    fromPortId: toPortId,
    toPortId: fromPortId,
    mode,
    distance,
    hazard: 0.05,
    timeModifier: 1,
    fuelModifier: 1,
    isOpen: true,
  },
  ] satisfies WorldLeg[],
);

const liner: ShipType = {
  id: "corridor-liner",
  name: "走廊级客轮",
  manufacturer: "示例船厂",
  description: "用于命令行演示的标准客轮。",
  cabinSpace: 220,
  seats: 220,
  purchasePrice: 2_500_000,
  supportedModes: ["sublight", "hyperspace"],
  speedByMode: { sublight: 1, hyperspace: 8 },
  maxRangeByMode: { sublight: 20, hyperspace: 100 },
  fuelPerDistanceByMode: { sublight: 1.2, hyperspace: 0.8 },
  maintenancePerFlightHour: 220,
  crewCostPerFlightHour: 150,
  reliability: 0.95,
  comfort: 72,
  minimumPortLevel: 3,
  turnaroundHours: 2,
  operationalAvailability: 0.92,
};

const route: Route = {
  id: "sol-alpha-haven",
  companyId: "player",
  name: "中央走廊线",
  kind: "return",
  stops: [
    { portId: "sol", stopType: "commercial", minimumStopHours: 2 },
    { portId: "alpha", stopType: "commercial", minimumStopHours: 2 },
    { portId: "haven", stopType: "commercial", minimumStopHours: 2 },
  ],
  shipTypeId: liner.id,
  assignedShips: 2,
  pricing: {
    multiplier: 1,
    passengerClassMultiplier: { economy: 1, business: 1.35, premium: 2.1 },
  },
  maintenanceAllowanceHours: 4,
  active: true,
};

const services = buildRouteServices(route, liner, ports, worldLegs, {
  companyReputation: 64,
});
const referenceTimes = allReferenceTimes(ports, worldLegs);
const markets = generateMarketDemands(ports, referenceTimes, { day: 1, seed: 42 });
const settlement = simulateDay({ markets, services });

console.log("\n公司日结算");
console.table(
  settlement.companies.map((company) => ({
    公司: company.companyId,
    旅客航段数: company.passengers.toFixed(1),
    票款收入: company.ticketRevenue.toFixed(0),
    运营成本: company.operatingCost.toFixed(0),
    运营利润: company.operatingProfit.toFixed(0),
  })),
);

console.log("航段表现");
console.table(
  settlement.services.map((service) => ({
    航段: service.serviceLegId,
    旅客: service.passengers.toFixed(1),
    运力: service.capacity.toFixed(1),
    满载率: `${(service.loadFactor * 100).toFixed(1)}%`,
  })),
);
