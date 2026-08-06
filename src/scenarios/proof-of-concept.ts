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

const CORE_PROOF_OF_CONCEPT_SHIPS: readonly ShipType[] = [
  {
    id: "sparrow-shuttle", name: "Sparrow Shuttle", seats: 32, purchasePrice: 180_000,
    manufacturer: "曙光轨道工业", familyId: "dawn-sparrow", familyName: "麻雀", variant: "S32",
    structuralMassTonnes: 90, fuelCapacityTonnes: 18, fixedMaintenanceCostPerDay: 450, cabinSpace: 32,
    description: "轻型星系内接驳艇，维护简单，适合短途支线与低等级星港。",
    supportedModes: ["sublight"], speedByMode: { sublight: 1 },
    maxRangeByMode: { sublight: 24 }, fuelPerDistanceByMode: { sublight: 0.42 },
    maintenancePerFlightHour: 18, crewCostPerFlightHour: 16, reliability: 0.97,
    comfort: 52, minimumPortLevel: 1, turnaroundHours: 0.75, operationalAvailability: 0.95,
  },
  {
    id: "pioneer-regional", name: "Pioneer Regional", seats: 64, purchasePrice: 520_000,
    manufacturer: "边疆联合船厂", familyId: "frontier-pioneer", familyName: "先驱", variant: "R64",
    structuralMassTonnes: 220, fuelCapacityTonnes: 60, fixedMaintenanceCostPerDay: 950, cabinSpace: 64,
    description: "面向新殖民地的经济型曲率客船，航程宽裕但巡航速度保守。",
    supportedModes: ["sublight", "warp"], speedByMode: { sublight: 0.9, warp: 2.8 },
    maxRangeByMode: { sublight: 32, warp: 70 }, fuelPerDistanceByMode: { sublight: 0.55, warp: 1.05 },
    maintenancePerFlightHour: 28, crewCostPerFlightHour: 22, reliability: 0.94,
    comfort: 62, minimumPortLevel: 2, turnaroundHours: 1.25, operationalAvailability: 0.92,
  },
  {
    id: "arrow-express", name: "矢量快速 20型", seats: 48, purchasePrice: 920_000,
    manufacturer: "矢量动力集团", familyId: "vector-fast", familyName: "矢量快速", variant: "20型",
    structuralMassTonnes: 180, fuelCapacityTonnes: 55, fixedMaintenanceCostPerDay: 1_350, cabinSpace: 48,
    description: "以高曲率速度见长的小型快船，适合高频商务直达航线。",
    supportedModes: ["sublight", "warp"], speedByMode: { sublight: 1.2, warp: 4.8 },
    maxRangeByMode: { sublight: 28, warp: 65 }, fuelPerDistanceByMode: { sublight: 0.72, warp: 1.55 },
    maintenancePerFlightHour: 42, crewCostPerFlightHour: 30, reliability: 0.965,
    comfort: 76, minimumPortLevel: 3, turnaroundHours: 0.9, operationalAvailability: 0.94,
  },
  {
    id: "meridian-liner", name: "Meridian Liner", seats: 180, purchasePrice: 2_200_000,
    manufacturer: "子午线航天", familyId: "meridian-mainline", familyName: "子午干线", variant: "M180",
    structuralMassTonnes: 650, fuelCapacityTonnes: 210, fixedMaintenanceCostPerDay: 4_200, cabinSpace: 180,
    description: "均衡可靠的超空间干线客轮，可灵活配置为大众运输或混合客舱。",
    supportedModes: ["sublight", "hyperspace"], speedByMode: { sublight: 0.8, hyperspace: 7.2 },
    maxRangeByMode: { sublight: 28, hyperspace: 110 }, fuelPerDistanceByMode: { sublight: 0.9, hyperspace: 0.68 },
    maintenancePerFlightHour: 62, crewCostPerFlightHour: 45, reliability: 0.95,
    comfort: 72, minimumPortLevel: 3, turnaroundHours: 1.8, operationalAvailability: 0.93,
  },
  {
    id: "atlas-liner", name: "Atlas Grand Liner", seats: 360, purchasePrice: 4_800_000,
    manufacturer: "阿特拉斯重工", familyId: "atlas-grand", familyName: "泰坦", variant: "G360",
    structuralMassTonnes: 1_500, fuelCapacityTonnes: 520, fixedMaintenanceCostPerDay: 9_500, cabinSpace: 360,
    description: "巨型超空间客轮，以空间和单位成本取胜，进出港周转相对缓慢。",
    supportedModes: ["sublight", "hyperspace"], speedByMode: { sublight: 0.65, hyperspace: 6.4 },
    maxRangeByMode: { sublight: 24, hyperspace: 130 }, fuelPerDistanceByMode: { sublight: 1.4, hyperspace: 1.05 },
    maintenancePerFlightHour: 105, crewCostPerFlightHour: 72, reliability: 0.925,
    comfort: 66, minimumPortLevel: 4, turnaroundHours: 3, operationalAvailability: 0.89,
  },
  {
    id: "celestial-yacht", name: "Celestial Yacht", seats: 84, purchasePrice: 3_600_000,
    manufacturer: "天穹精工", familyId: "celestial-yacht", familyName: "天穹游艇", variant: "Y84",
    structuralMassTonnes: 320, fuelCapacityTonnes: 110, fixedMaintenanceCostPerDay: 5_200, cabinSpace: 84,
    description: "强调私密性与舒适度的豪华曲率游艇，购置和维护成本高昂。",
    supportedModes: ["sublight", "warp"],
    speedByMode: { sublight: 1.1, warp: 4.2 },
    maxRangeByMode: { sublight: 30, warp: 80 },
    fuelPerDistanceByMode: { sublight: 1.1, warp: 1.8 },
    maintenancePerFlightHour: 118, crewCostPerFlightHour: 64, reliability: 0.975,
    comfort: 96, minimumPortLevel: 4, turnaroundHours: 1.6, operationalAvailability: 0.94,
  },
  {
    id: "comet-courier", name: "矢量快速 10型", seats: 24, purchasePrice: 680_000,
    manufacturer: "矢量动力集团", familyId: "vector-fast", familyName: "矢量快速", variant: "10型",
    structuralMassTonnes: 115, fuelCapacityTonnes: 35, fixedMaintenanceCostPerDay: 800, cabinSpace: 24,
    description: "小巧敏捷的曲率交通艇，适合稀薄市场和试探性新航线。",
    supportedModes: ["sublight", "warp"], speedByMode: { sublight: 1.15, warp: 4 },
    maxRangeByMode: { sublight: 26, warp: 58 }, fuelPerDistanceByMode: { sublight: 0.48, warp: 1.18 },
    maintenancePerFlightHour: 31, crewCostPerFlightHour: 20, reliability: 0.955,
    comfort: 68, minimumPortLevel: 2, turnaroundHours: 0.7, operationalAvailability: 0.95,
  },
  {
    id: "aurora-clipper", name: "Aurora Clipper", seats: 96, purchasePrice: 1_450_000,
    manufacturer: "极光航行器公司", familyId: "aurora-clipper", familyName: "极光飞剪", variant: "C96",
    structuralMassTonnes: 360, fuelCapacityTonnes: 125, fixedMaintenanceCostPerDay: 2_800, cabinSpace: 96,
    description: "高速超空间飞剪船，在速度、舒适度和可靠性之间取得优秀平衡。",
    supportedModes: ["sublight", "hyperspace"], speedByMode: { sublight: 1, hyperspace: 9.2 },
    maxRangeByMode: { sublight: 30, hyperspace: 130 }, fuelPerDistanceByMode: { sublight: 0.68, hyperspace: 0.82 },
    maintenancePerFlightHour: 54, crewCostPerFlightHour: 34, reliability: 0.972,
    comfort: 82, minimumPortLevel: 3, turnaroundHours: 1.1, operationalAvailability: 0.95,
  },
  {
    id: "horizon-coach", name: "Horizon Coach", seats: 140, purchasePrice: 1_250_000,
    manufacturer: "地平线公共交通", familyId: "horizon-coach", familyName: "地平线通勤", variant: "H140",
    structuralMassTonnes: 480, fuelCapacityTonnes: 160, fixedMaintenanceCostPerDay: 2_400, cabinSpace: 140,
    description: "价格亲民的超空间大众客船，适合高密度经济舱网络。",
    supportedModes: ["sublight", "hyperspace"], speedByMode: { sublight: 0.75, hyperspace: 6 },
    maxRangeByMode: { sublight: 26, hyperspace: 105 }, fuelPerDistanceByMode: { sublight: 0.7, hyperspace: 0.56 },
    maintenancePerFlightHour: 44, crewCostPerFlightHour: 31, reliability: 0.94,
    comfort: 60, minimumPortLevel: 2, turnaroundHours: 1.5, operationalAvailability: 0.93,
  },
  {
    id: "vector-executive", name: "矢量快速 30型", seats: 72, purchasePrice: 1_650_000,
    manufacturer: "矢量动力集团", familyId: "vector-fast", familyName: "矢量快速", variant: "30型",
    structuralMassTonnes: 250, fuelCapacityTonnes: 85, fixedMaintenanceCostPerDay: 1_900, cabinSpace: 72,
    description: "矢量快速系列的大容量型号，与 10/20 型共享驱动和大部分维护件。",
    supportedModes: ["sublight", "warp"], speedByMode: { sublight: 1.2, warp: 5 },
    maxRangeByMode: { sublight: 32, warp: 80 }, fuelPerDistanceByMode: { sublight: 0.75, warp: 1.62 },
    maintenancePerFlightHour: 63, crewCostPerFlightHour: 38, reliability: 0.978,
    comfort: 90, minimumPortLevel: 4, turnaroundHours: 0.85, operationalAvailability: 0.96,
  },
  {
    id: "odyssey-sleeper", name: "Odyssey Sleeper", seats: 240, purchasePrice: 3_100_000,
    manufacturer: "奥德赛深空系统", familyId: "odyssey-sleeper", familyName: "奥德赛卧铺", variant: "O240",
    structuralMassTonnes: 950, fuelCapacityTonnes: 340, fixedMaintenanceCostPerDay: 6_500, cabinSpace: 240,
    description: "长途超空间卧铺客轮，舒适度突出，适合远距离高端市场。",
    supportedModes: ["sublight", "hyperspace"], speedByMode: { sublight: 0.72, hyperspace: 7 },
    maxRangeByMode: { sublight: 25, hyperspace: 125 }, fuelPerDistanceByMode: { sublight: 1.08, hyperspace: 0.92 },
    maintenancePerFlightHour: 88, crewCostPerFlightHour: 58, reliability: 0.958,
    comfort: 88, minimumPortLevel: 4, turnaroundHours: 2.3, operationalAvailability: 0.92,
  },
];

function familyVariant(
  baseId: string,
  changes: Partial<ShipType> & Pick<ShipType, "id" | "name" | "variant" | "description">,
): ShipType {
  const base = CORE_PROOF_OF_CONCEPT_SHIPS.find((ship) => ship.id === baseId);
  if (!base) throw new Error(`Unknown base ship type: ${baseId}`);
  return {
    ...base,
    ...changes,
    speedByMode: { ...base.speedByMode, ...changes.speedByMode },
    maxRangeByMode: { ...base.maxRangeByMode, ...changes.maxRangeByMode },
    fuelPerDistanceByMode: { ...base.fuelPerDistanceByMode, ...changes.fuelPerDistanceByMode },
  };
}

/**
 * 同系列子型号继承基础型号的大部分驱动、可靠性与维护参数，只调整容量、
 * 结构质量、设计航程和面向市场，体现平台化造船而非互不相关的船型堆叠。
 */
export const PROOF_OF_CONCEPT_SHIPS: readonly ShipType[] = [
  ...CORE_PROOF_OF_CONCEPT_SHIPS,
  familyVariant("sparrow-shuttle", {
    id: "sparrow-shuttle-s18", name: "麻雀 S18型", variant: "S18", seats: 18, cabinSpace: 18,
    purchasePrice: 125_000, structuralMassTonnes: 64, fuelCapacityTonnes: 13, fixedMaintenanceCostPerDay: 320,
    maxRangeByMode: { sublight: 20 }, fuelPerDistanceByMode: { sublight: 0.36 }, turnaroundHours: 0.55,
    description: "麻雀系列的双机组轻型型号，用最低固定成本覆盖极稀薄的星系内客流。",
  }),
  familyVariant("sparrow-shuttle", {
    id: "sparrow-shuttle-s48", name: "麻雀 S48型", variant: "S48", seats: 48, cabinSpace: 48,
    purchasePrice: 255_000, structuralMassTonnes: 128, fuelCapacityTonnes: 26, fixedMaintenanceCostPerDay: 610,
    speedByMode: { sublight: 0.95 }, maxRangeByMode: { sublight: 28 }, fuelPerDistanceByMode: { sublight: 0.5 }, turnaroundHours: 0.95,
    description: "加长客舱与起落架强化的麻雀型号，适合繁忙枢纽的星系内接驳。",
  }),
  familyVariant("pioneer-regional", {
    id: "pioneer-regional-r40", name: "先驱 R40型", variant: "R40", seats: 40, cabinSpace: 40,
    purchasePrice: 390_000, structuralMassTonnes: 165, fuelCapacityTonnes: 48, fixedMaintenanceCostPerDay: 720,
    speedByMode: { warp: 3 }, maxRangeByMode: { warp: 62 }, fuelPerDistanceByMode: { warp: 0.92 }, turnaroundHours: 1,
    description: "先驱系列的短机身殖民地型号，保留野外维护能力并降低小市场门槛。",
  }),
  familyVariant("pioneer-regional", {
    id: "pioneer-regional-r96", name: "先驱 R96型", variant: "R96", seats: 96, cabinSpace: 96,
    purchasePrice: 760_000, structuralMassTonnes: 310, fuelCapacityTonnes: 86, fixedMaintenanceCostPerDay: 1_320,
    speedByMode: { warp: 2.7 }, maxRangeByMode: { warp: 82 }, fuelPerDistanceByMode: { warp: 1.18 }, turnaroundHours: 1.55,
    description: "带扩展燃料舱的先驱长机身型号，面向距离较远的边疆聚居地。",
  }),
  familyVariant("arrow-express", {
    id: "vector-fast-15", name: "矢量快速 15型", variant: "15型", seats: 36, cabinSpace: 36,
    purchasePrice: 790_000, structuralMassTonnes: 148, fuelCapacityTonnes: 45, fixedMaintenanceCostPerDay: 1_080,
    speedByMode: { warp: 4.5 }, maxRangeByMode: { warp: 62 }, fuelPerDistanceByMode: { warp: 1.38 }, minimumPortLevel: 2,
    description: "介于交通艇与快船之间的矢量快速型号，适合成长中的商务航线。",
  }),
  familyVariant("arrow-express", {
    id: "vector-fast-25", name: "矢量快速 25型", variant: "25型", seats: 60, cabinSpace: 60,
    purchasePrice: 1_240_000, structuralMassTonnes: 215, fuelCapacityTonnes: 68, fixedMaintenanceCostPerDay: 1_610,
    speedByMode: { warp: 4.9 }, maxRangeByMode: { warp: 72 }, fuelPerDistanceByMode: { warp: 1.58 }, comfort: 82,
    description: "为商务与高端混合布局优化的矢量快速中大型子型号。",
  }),
  familyVariant("arrow-express", {
    id: "vector-fast-40", name: "矢量快速 40型", variant: "40型", seats: 96, cabinSpace: 96,
    purchasePrice: 2_050_000, structuralMassTonnes: 325, fuelCapacityTonnes: 112, fixedMaintenanceCostPerDay: 2_480,
    speedByMode: { warp: 4.7 }, maxRangeByMode: { warp: 92 }, fuelPerDistanceByMode: { warp: 1.78 }, turnaroundHours: 1.1,
    description: "系列内最大容量的快速干线型号，以略低极速换取更远航程和更多舱位。",
  }),
  familyVariant("meridian-liner", {
    id: "meridian-liner-m120", name: "子午干线 M120型", variant: "M120", seats: 120, cabinSpace: 120,
    purchasePrice: 1_650_000, structuralMassTonnes: 480, fuelCapacityTonnes: 162, fixedMaintenanceCostPerDay: 3_150,
    speedByMode: { hyperspace: 7.6 }, maxRangeByMode: { hyperspace: 102 }, fuelPerDistanceByMode: { hyperspace: 0.61 }, turnaroundHours: 1.45,
    description: "子午干线平台的轻量快速型号，适合尚未成熟的超空间干线。",
  }),
  familyVariant("meridian-liner", {
    id: "meridian-liner-m240", name: "子午干线 M240型", variant: "M240", seats: 240, cabinSpace: 240,
    purchasePrice: 2_850_000, structuralMassTonnes: 820, fuelCapacityTonnes: 270, fixedMaintenanceCostPerDay: 5_350,
    speedByMode: { hyperspace: 6.9 }, maxRangeByMode: { hyperspace: 120 }, fuelPerDistanceByMode: { hyperspace: 0.76 }, turnaroundHours: 2.15,
    description: "子午干线平台的高容量型号，提供更低的单位座位固定成本。",
  }),
  familyVariant("atlas-liner", {
    id: "atlas-liner-g240", name: "泰坦 G240型", variant: "G240", seats: 240, cabinSpace: 240,
    purchasePrice: 3_650_000, structuralMassTonnes: 1_080, fuelCapacityTonnes: 395, fixedMaintenanceCostPerDay: 7_250,
    speedByMode: { hyperspace: 6.7 }, maxRangeByMode: { hyperspace: 122 }, fuelPerDistanceByMode: { hyperspace: 0.94 }, turnaroundHours: 2.55,
    description: "泰坦平台的缩短型号，可进入更多星港并保持大型船的规模经济。",
  }),
  familyVariant("atlas-liner", {
    id: "atlas-liner-g480", name: "泰坦 G480型", variant: "G480", seats: 480, cabinSpace: 480,
    purchasePrice: 6_150_000, structuralMassTonnes: 1_920, fuelCapacityTonnes: 680, fixedMaintenanceCostPerDay: 12_200,
    speedByMode: { hyperspace: 6.1 }, maxRangeByMode: { hyperspace: 142 }, fuelPerDistanceByMode: { hyperspace: 1.18 }, turnaroundHours: 3.7,
    description: "泰坦平台旗舰型号，为最繁忙干线提供极高的单班运力。",
  }),
  familyVariant("celestial-yacht", {
    id: "celestial-yacht-y48", name: "天穹游艇 Y48型", variant: "Y48", seats: 48, cabinSpace: 48,
    purchasePrice: 2_650_000, structuralMassTonnes: 235, fuelCapacityTonnes: 82, fixedMaintenanceCostPerDay: 3_900,
    speedByMode: { warp: 4.5 }, maxRangeByMode: { warp: 74 }, fuelPerDistanceByMode: { warp: 1.62 }, comfort: 98, turnaroundHours: 1.25,
    description: "天穹游艇的小型私密型号，适合低客流、高票价的头等市场。",
  }),
  familyVariant("celestial-yacht", {
    id: "celestial-yacht-y120", name: "天穹游艇 Y120型", variant: "Y120", seats: 120, cabinSpace: 120,
    purchasePrice: 4_750_000, structuralMassTonnes: 430, fuelCapacityTonnes: 152, fixedMaintenanceCostPerDay: 6_850,
    speedByMode: { warp: 4 }, maxRangeByMode: { warp: 90 }, fuelPerDistanceByMode: { warp: 1.96 }, comfort: 94, turnaroundHours: 1.9,
    description: "带大型公共套房的天穹游艇型号，可承担高端旅游包机与旗舰航线。",
  }),
  familyVariant("aurora-clipper", {
    id: "aurora-clipper-c64", name: "极光飞剪 C64型", variant: "C64", seats: 64, cabinSpace: 64,
    purchasePrice: 1_080_000, structuralMassTonnes: 285, fuelCapacityTonnes: 98, fixedMaintenanceCostPerDay: 2_120,
    speedByMode: { hyperspace: 9.5 }, maxRangeByMode: { hyperspace: 118 }, fuelPerDistanceByMode: { hyperspace: 0.74 }, turnaroundHours: 0.9,
    description: "极光飞剪的小型高速型号，用于对时间高度敏感的薄商务市场。",
  }),
  familyVariant("aurora-clipper", {
    id: "aurora-clipper-c128", name: "极光飞剪 C128型", variant: "C128", seats: 128, cabinSpace: 128,
    purchasePrice: 1_920_000, structuralMassTonnes: 445, fuelCapacityTonnes: 154, fixedMaintenanceCostPerDay: 3_580,
    speedByMode: { hyperspace: 8.8 }, maxRangeByMode: { hyperspace: 138 }, fuelPerDistanceByMode: { hyperspace: 0.9 }, turnaroundHours: 1.35,
    description: "极光飞剪的加长型号，在保留高速优势的同时提升干线容量。",
  }),
  familyVariant("horizon-coach", {
    id: "horizon-coach-h90", name: "地平线通勤 H90型", variant: "H90", seats: 90, cabinSpace: 90,
    purchasePrice: 890_000, structuralMassTonnes: 350, fuelCapacityTonnes: 118, fixedMaintenanceCostPerDay: 1_760,
    speedByMode: { hyperspace: 6.3 }, maxRangeByMode: { hyperspace: 94 }, fuelPerDistanceByMode: { hyperspace: 0.5 }, turnaroundHours: 1.2,
    description: "地平线通勤的小型型号，以低票价和高周转覆盖区域客流。",
  }),
  familyVariant("horizon-coach", {
    id: "horizon-coach-h200", name: "地平线通勤 H200型", variant: "H200", seats: 200, cabinSpace: 200,
    purchasePrice: 1_720_000, structuralMassTonnes: 650, fuelCapacityTonnes: 218, fixedMaintenanceCostPerDay: 3_180,
    speedByMode: { hyperspace: 5.7 }, maxRangeByMode: { hyperspace: 112 }, fuelPerDistanceByMode: { hyperspace: 0.64 }, turnaroundHours: 1.9,
    description: "地平线通勤的大容量型号，为成熟大众市场提供更低单位成本。",
  }),
  familyVariant("odyssey-sleeper", {
    id: "odyssey-sleeper-o160", name: "奥德赛卧铺 O160型", variant: "O160", seats: 160, cabinSpace: 160,
    purchasePrice: 2_350_000, structuralMassTonnes: 720, fuelCapacityTonnes: 260, fixedMaintenanceCostPerDay: 4_950,
    speedByMode: { hyperspace: 7.4 }, maxRangeByMode: { hyperspace: 116 }, fuelPerDistanceByMode: { hyperspace: 0.84 }, turnaroundHours: 1.9,
    description: "奥德赛卧铺的短舱体型号，适合中等距离的夜航与高端混合布局。",
  }),
  familyVariant("odyssey-sleeper", {
    id: "odyssey-sleeper-o320", name: "奥德赛卧铺 O320型", variant: "O320", seats: 320, cabinSpace: 320,
    purchasePrice: 4_150_000, structuralMassTonnes: 1_210, fuelCapacityTonnes: 430, fixedMaintenanceCostPerDay: 8_250,
    speedByMode: { hyperspace: 6.7 }, maxRangeByMode: { hyperspace: 138 }, fuelPerDistanceByMode: { hyperspace: 1.02 }, turnaroundHours: 2.8,
    description: "奥德赛卧铺的远程大容量型号，为长距离夜航提供更多私人空间。",
  }),
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
