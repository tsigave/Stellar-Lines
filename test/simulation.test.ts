import assert from "node:assert/strict";
import test from "node:test";
import { compactGameForStorage, loadStoredGame, persistGame, type StorageLike } from "../src/web/storage.js";
import {
  buildJourneyOptions,
  buildFareCurveData,
  buildRouteServices,
  assignShipsToFleetConfiguration,
  buyShip,
  chooseJourneys,
  explainJourneyChoice,
  createGeneratedGameEvents,
  createGeneratedScenario,
  createFleetConfiguration,
  createNewGame,
  createPlayerRoute,
  deliverShipPurchaseOrders,
  CHINESE_SYSTEM_NAMES,
  CORE_FUEL_STORAGE_CAPACITY,
  DEFAULT_GALAXY_CONFIG,
  DAILY_COMPANY_OVERHEAD,
  EMERGENCY_FUEL_MARGIN,
  deterministicVariation,
  eventIntensity,
  fuelEventIntensity,
  generateMarketDemands,
  generateFlightSchedule,
  buildSpeedEconomicsCurve,
  fuelMultiplierAtCruiseRatio,
  roundToFiveMinutes,
  starportMovementCapacity,
  starportControlDelayProbability,
  flightCompensationRate,
  buildGameSchedule,
  requestRouteFleetChange,
  allReferenceTimes,
  marketEventDemandMultiplier,
  migrateGameState,
  generateGalaxy,
  gameScenario,
  gameWorldLegs,
  isGameState,
  fuelPriceRecord,
  estimateFuelConsumption,
  estimateInterstellarFuel,
  estimateSublightTransit,
  deterministicExitDistanceKm,
  setShipReserveRoute,
  investInStarportCapacity,
  orderShipReplacement,
  setRouteSublightProfile,
  setRouteDirectionalPricingLinked,
  setRouteDirectionalFares,
  fleetConfigurationForShip,
  fleetFixedMaintenanceCost,
  performShipMaintenance,
  placeShipPurchaseAgreement,
  purchaseAgreementDiscount,
  quoteShipPurchaseAgreement,
  recommendRouteFares,
  passengerSatisfactionByClass,
  PASSENGER_TYPES,
  PROOF_OF_CONCEPT_SCENARIO,
  simulateCampaign,
  shortestReferenceTime,
  simulateDay,
  shipMaintenanceState,
  shipAgeYears,
  shipComfortAtAge,
  MAINTENANCE_DUE_HOURS,
  MAINTENANCE_REQUIRED_HOURS,
  setAutoMaintenanceThreshold,
  setAutoReplacementAge,
  buyFuelForWarehouse,
  cancelFuelContract,
  quoteFuelContract,
  setFuelAutoContractPolicy,
  setFuelWarehouseRental,
  signFuelContract,
  updateFleetConfiguration,
  compareTechnicalStop,
  defaultBuildForShipType,
  FTL_DRIVE_MODELS,
  hullVariantFromShipType,
  OPTIONAL_MODULES,
  resolveShipMission,
  resolveStandardReferenceMission,
  STANDARD_REFERENCE_BUILD,
  STANDARD_REFERENCE_HULL,
  SUBLIGHT_ENGINE_MODELS,
  advanceGameDay,
  closePlayerRoute,
  configureShipCabins,
  type GameState,
  type MarketDemand,
  type MarketEvent,
  type GalaxyGenerationConfig,
  type PassengerClass,
  type OwnedShip,
  type Route,
  type ServiceLeg,
  type ShipType,
  type Starport,
  type WorldLeg,
} from "../src/index.js";

test("v0.7 标准参考船严格复现 12 ly 与 100 ly 质量和航时校准点", () => {
  const short = resolveStandardReferenceMission(12);
  const long = resolveStandardReferenceMission(100);
  const overRange = resolveStandardReferenceMission(101);
  assert.ok(Math.abs(short.totalFuelBurnTonnes - 80.02) < 0.03);
  assert.ok(Math.abs(short.phases[0]!.fuelBurnTonnes + short.phases[2]!.fuelBurnTonnes - short.phases[1]!.fuelBurnTonnes) < 0.03);
  assert.ok(Math.abs(long.totalFuelBurnTonnes - 500) < 0.03);
  assert.ok(Math.abs(long.phases[0]!.fuelBurnTonnes - 36.41) < 0.03);
  assert.ok(Math.abs(long.phases[1]!.fuelBurnTonnes - 444.70) < 0.03);
  assert.ok(Math.abs(long.phases[2]!.fuelBurnTonnes - 18.892) < 0.01);
  assert.ok(Math.abs(long.totalHours / 24 - 19) < 0.1);
  assert.equal(long.feasible, true);
  assert.equal(overRange.feasible, false);
});

test("v0.7 真实载荷、抵达储备和重型模块都会提高起飞质量与燃料", () => {
  const base = resolveStandardReferenceMission(12);
  const loaded = resolveShipMission({
    build: { ...STANDARD_REFERENCE_BUILD, optionalModuleIds: ["redundant-drive"], destinationReserveTonnes: 20 },
    hull: STANDARD_REFERENCE_HULL,
    distanceLightYears: 12,
    passengerCount: 180,
  });
  assert.ok(loaded.payloadMassTonnes > 0);
  assert.ok(loaded.operatingDryMassTonnes > base.operatingDryMassTonnes);
  assert.ok(loaded.takeoffMassTonnes > base.takeoffMassTonnes);
  assert.ok(loaded.initialFuelTonnes > base.initialFuelTonnes + 20);
});

test("v0.7 驱动器逐型号读取速度-k曲线，曲率与超空间形成速度和路径取舍", () => {
  const warp = FTL_DRIVE_MODELS.find((drive) => drive.id === "frontier-w2-economy")!;
  const hyperspace = FTL_DRIVE_MODELS.find((drive) => drive.id === "horizon-hs4-economy")!;
  assert.equal(warp.mode, "warp");
  assert.equal(hyperspace.mode, "hyperspace");
  assert.ok(hyperspace.maximumSpeedLyPerDay > warp.maximumSpeedLyPerDay);
  assert.ok(Math.abs(warp.efficiencyCurve[1]!.kPerLightYear - hyperspace.efficiencyCurve[1]!.kPerLightYear) < 0.0002);
});

test("v0.7 推力改变亚光速航时，效率曲线改变燃料且滑行阶段燃料为零", () => {
  const economy = resolveShipMission({ build: STANDARD_REFERENCE_BUILD, hull: STANDARD_REFERENCE_HULL, distanceLightYears: 12, thrustRatio: 0.8 });
  const maximum = resolveShipMission({ build: STANDARD_REFERENCE_BUILD, hull: STANDARD_REFERENCE_HULL, distanceLightYears: 12, thrustRatio: 1 });
  assert.notEqual(economy.phases[0]!.hours, maximum.phases[0]!.hours);
  assert.notEqual(economy.phases[0]!.fuelBurnTonnes, maximum.phases[0]!.fuelBurnTonnes);
  assert.ok(SUBLIGHT_ENGINE_MODELS[0]!.directionalEfficiencyCurve.length >= 3);
});

test("v0.7 技术停靠能让超长航程可行并增加周转和港口成本", () => {
  const comparison = compareTechnicalStop({ build: STANDARD_REFERENCE_BUILD, hull: STANDARD_REFERENCE_HULL, distanceLightYears: 140 });
  assert.equal(comparison.direct.feasible, false);
  assert.equal(comparison.withTechnicalStop.feasible, true);
  assert.ok(comparison.withTechnicalStop.totalHours > comparison.withTechnicalStop.legs.reduce((sum, leg) => sum + leg.totalHours, 0));
  assert.ok(comparison.withTechnicalStop.addedPortCost > 0);
});

test("v0.7 九个系列三十个子型号都具备组件引用并通过质量油箱平衡检查", () => {
  const ships = PROOF_OF_CONCEPT_SCENARIO.shipTypes;
  assert.equal(ships.length, 30);
  assert.equal(new Set(ships.map((ship) => ship.familyId)).size, 9);
  for (const ship of ships) {
    assert.ok(ship.hullVariantId && ship.defaultSublightEngineModelId);
    assert.ok((ship.operatingDryMassTonnes ?? 0) > 0);
    assert.ok((ship.maximumTakeoffMassTonnes ?? 0) >= (ship.operatingDryMassTonnes ?? 0) + ship.fuelCapacityTonnes - 1e-6);
    const ratio = ship.fuelCapacityTonnes / (ship.operatingDryMassTonnes ?? ship.structuralMassTonnes);
    assert.ok(ratio >= 0.2 && ratio <= 1.3);
  }
});

test("v0.7 采购协议可分别报价并保留同船体的不同推进配置", () => {
  const generated = createGeneratedScenario(DEFAULT_GALAXY_CONFIG);
  const type = generated.scenario.shipTypes.find((ship) => ship.id === "meridian-liner")!;
  const game = createNewGame(DEFAULT_GALAXY_CONFIG, generated.galaxy, generated.galaxy.ports[0]!.id, generated.scenario.shipTypes);
  const standard = defaultBuildForShipType(type);
  const economy = { ...standard, sublightEngineModelId: "frontier-tf-420", optionalModuleIds: [OPTIONAL_MODULES[1]!.id] };
  const quote = quoteShipPurchaseAgreement(game, [
    { shipTypeId: type.id, quantity: 1, build: standard },
    { shipTypeId: type.id, quantity: 1, build: economy },
  ], generated.scenario.shipTypes);
  assert.equal(quote.lines.length, 2);
  assert.notEqual(quote.lines[0]!.listUnitPrice, quote.lines[1]!.listUnitPrice);
  const ordered = placeShipPurchaseAgreement({ ...game, cash: 20_000_000 }, quote.lines.map(({ shipTypeId, quantity, build }) => ({ shipTypeId, quantity, build: build! })), generated.scenario.shipTypes).state;
  assert.equal(ordered.shipPurchaseOrders.length, 2);
  assert.notEqual(ordered.shipPurchaseOrders[0]!.build.sublightEngineModelId, ordered.shipPurchaseOrders[1]!.build.sublightEngineModelId);
});

test("v0.7 发动机供应商与系列多样性产生可解释的保障开销", () => {
  const types = PROOF_OF_CONCEPT_SCENARIO.shipTypes;
  const type = types.find((ship) => ship.id === "meridian-liner")!;
  const baseShip: OwnedShip = {
    id: "a", name: "A", shipTypeId: type.id, routeId: null, condition: 100,
    flightHoursSinceMaintenance: 0, maintenanceUntilDay: null, configurationId: null,
    commissionedDay: 1, purchasePricePaid: type.purchasePrice,
    build: defaultBuildForShipType(type),
  };
  const uniform = fleetFixedMaintenanceCost([baseShip, { ...baseShip, id: "b", name: "B" }], types);
  const diverse = fleetFixedMaintenanceCost([baseShip, {
    ...baseShip, id: "b", name: "B",
    build: { ...baseShip.build!, sublightEngineModelId: "frontier-tf-420" },
  }], types);
  assert.ok(diverse.diversityOverhead > uniform.diversityOverhead);
  assert.ok(diverse.total > uniform.total);
});

test("v0.7 航线与班表读取实际采购配置并保留三个阶段的独立时长", () => {
  const type = PROOF_OF_CONCEPT_SCENARIO.shipTypes.find((ship) => ship.id === "meridian-liner-m120")!;
  const ports: Starport[] = ["a", "b"].map((id) => ({
    id, systemId: id, name: id, population: 50, economy: 50, business: 50,
    tourism: 50, administration: 50, portLevel: 5, dailyCapacity: 1_000,
    fuelPrice: 2, serviceFee: 100,
    hyperspaceExitDistanceKm: 22_439_681,
  }));
  const leg: WorldLeg = { id: "a-b-v07", fromPortId: "a", toPortId: "b", mode: "hyperspace", distance: 12, hazard: 0, timeModifier: 1, fuelModifier: 1, isOpen: true };
  const baseRoute: Route = {
    id: "configured", companyId: "player", name: "Configured", kind: "return", routingMode: "hyperspace",
    stops: ports.map((port) => ({ portId: port.id, stopType: "commercial" as const, minimumStopHours: 2 })),
    shipTypeId: type.id, assignedShips: 1, pricing: { multiplier: 1, passengerClassMultiplier: { economy: 1, business: 1, premium: 1 } },
    maintenanceAllowanceHours: 0, active: true,
  };
  const standardBuild = defaultBuildForShipType(type, { economy: 80, business: 0, premium: 0 });
  const alternativeBuild = { ...standardBuild, sublightEngineModelId: "frontier-tf-420" };
  const standard = buildRouteServices({ ...baseRoute, buildConfiguration: standardBuild }, type, ports, [leg])[0]!;
  const alternative = buildRouteServices({ ...baseRoute, buildConfiguration: alternativeBuild }, type, ports, [leg])[0]!;
  assert.notEqual(standard.sublightHours, alternative.sublightHours);
  assert.notEqual(standard.fuelConsumptionPerDepartureFull, alternative.fuelConsumptionPerDepartureFull);
  assert.ok(standard.departureSublightHours! > 0 && standard.interstellarHours! > 0 && standard.arrivalSublightHours! > 0);
  assert.ok(Math.abs(standard.inVehicleHours - standard.departureSublightHours! - standard.interstellarHours! - standard.arrivalSublightHours!) < 1e-6);
});

function configureShipsForTest(
  game: GameState,
  shipIds: readonly string[],
  shipTypes: readonly ShipType[],
): GameState {
  return shipIds.reduce((current, shipId) => {
    const ship = current.fleet.find((candidate) => candidate.id === shipId)!;
    const type = shipTypes.find((candidate) => candidate.id === ship.shipTypeId)!;
    return configureShipCabins(
      current,
      shipId,
      { economy: type.cabinSpace, business: 0, premium: 0 },
      shipTypes,
    ).state;
  }, game);
}

function deliverAllOrdersForTest(game: GameState, shipTypes: readonly ShipType[]): GameState {
  const deliveryDay = Math.max(game.day, ...game.shipPurchaseOrders.map((order) => order.deliveryDay));
  return deliverShipPurchaseOrders({ ...game, day: deliveryDay }, shipTypes, deliveryDay).state;
}

test("中文行星系名称库包含 500 个不重复名称", () => {
  assert.equal(CHINESE_SYSTEM_NAMES.length, 500);
  assert.equal(new Set(CHINESE_SYSTEM_NAMES).size, 500);
  assert.ok(CHINESE_SYSTEM_NAMES.every((name) => /^[\p{Script=Han}]+$/u.test(name)));
});

function market(passengerClass: PassengerClass, potentialPassengers = 1_000): MarketDemand {
  return {
    originPortId: "a",
    destinationPortId: "c",
    passengerType: passengerClass === "economy" ? "budget" : passengerClass === "premium" ? "luxury" : "business",
    potentialPassengers,
    referenceTimeHours: 10,
    acceptableFare: passengerClass === "economy" ? 180 : 320,
  };
}

function service(overrides: Partial<ServiceLeg> & Pick<ServiceLeg, "id" | "fromPortId" | "toPortId">): ServiceLeg {
  return {
    id: overrides.id,
    routeId: overrides.routeId ?? overrides.id,
    companyId: overrides.companyId ?? overrides.id,
    fromPortId: overrides.fromPortId,
    toPortId: overrides.toPortId,
    modePath: overrides.modePath ?? ["hyperspace"],
    distance: overrides.distance ?? 40,
    inVehicleHours: overrides.inVehicleHours ?? 8,
    destinationDwellHours: overrides.destinationDwellHours ?? 2,
    departuresPerWeek: overrides.departuresPerWeek ?? 14,
    seatsPerDeparture: overrides.seatsPerDeparture ?? 500,
    dailySeatCapacity: overrides.dailySeatCapacity ?? 1_000,
    ...(overrides.seatsPerDepartureByClass ? { seatsPerDepartureByClass: overrides.seatsPerDepartureByClass } : {}),
    ...(overrides.dailySeatCapacityByClass ? { dailySeatCapacityByClass: overrides.dailySeatCapacityByClass } : {}),
    ...(overrides.operatingCostPerPassenger !== undefined ? { operatingCostPerPassenger: overrides.operatingCostPerPassenger } : {}),
    fareByClass: overrides.fareByClass ?? { economy: 120, business: 160, premium: 240 },
    comfort: overrides.comfort ?? 70,
    reputation: overrides.reputation ?? 70,
    onTimeRate: overrides.onTimeRate ?? 0.95,
    satisfactionByClass: overrides.satisfactionByClass ?? { economy: 75, business: 75, premium: 75 },
    ...(overrides.baseCostBreakdown ? { baseCostBreakdown: overrides.baseCostBreakdown } : {}),
    dailyOperatingCost: overrides.dailyOperatingCost ?? 2_000,
  };
}

test("经济旅客对降价的相对反应强于商务旅客", () => {
  const normal = service({ id: "normal", fromPortId: "a", toPortId: "c" });
  const cheap = service({
    id: "cheap",
    fromPortId: "a",
    toPortId: "c",
    fareByClass: { economy: 96, business: 128, premium: 192 },
  });

  const economyMarket = market("economy");
  const businessMarket = market("business");
  const economyOptions = buildJourneyOptions([normal, cheap], economyMarket);
  const businessOptions = buildJourneyOptions([normal, cheap], businessMarket);
  const economyChoice = chooseJourneys(economyMarket, economyOptions);
  const businessChoice = chooseJourneys(businessMarket, businessOptions);
  const economyRatio =
    economyChoice.requestedByOption.get(economyOptions.find((o) => o.serviceLegIds[0] === "cheap")!.id)! /
    economyChoice.requestedByOption.get(economyOptions.find((o) => o.serviceLegIds[0] === "normal")!.id)!;
  const businessRatio =
    businessChoice.requestedByOption.get(businessOptions.find((o) => o.serviceLegIds[0] === "cheap")!.id)! /
    businessChoice.requestedByOption.get(businessOptions.find((o) => o.serviceLegIds[0] === "normal")!.id)!;

  assert.ok(economyRatio > businessRatio);
  assert.ok(economyRatio > 1);
});

test("相同日运力下，高频服务获得更多商务旅客", () => {
  const highFrequency = service({
    id: "frequent",
    fromPortId: "a",
    toPortId: "c",
    departuresPerWeek: 28,
    seatsPerDeparture: 50,
    dailySeatCapacity: 200,
  });
  const lowFrequency = service({
    id: "infrequent",
    fromPortId: "a",
    toPortId: "c",
    departuresPerWeek: 2,
    seatsPerDeparture: 700,
    dailySeatCapacity: 200,
  });
  const businessMarket = market("business", 300);
  const settlement = simulateDay({
    markets: [businessMarket],
    services: [highFrequency, lowFrequency],
  });
  const frequentPassengers = settlement.services.find(
    (item) => item.serviceLegId === "frequent",
  )!.passengers;
  const infrequentPassengers = settlement.services.find(
    (item) => item.serviceLegId === "infrequent",
  )!.passengers;

  assert.ok(frequentPassengers > infrequentPassengers);
});

test("商务旅客比经济旅客更偏好较贵的直达服务", () => {
  const direct = service({
    id: "direct",
    fromPortId: "a",
    toPortId: "c",
    fareByClass: { economy: 150, business: 200, premium: 300 },
  });
  const firstConnection = service({
    id: "connection-1",
    companyId: "connector",
    fromPortId: "a",
    toPortId: "b",
    inVehicleHours: 4,
    fareByClass: { economy: 60, business: 80, premium: 120 },
  });
  const secondConnection = service({
    id: "connection-2",
    companyId: "connector",
    fromPortId: "b",
    toPortId: "c",
    inVehicleHours: 4,
    fareByClass: { economy: 60, business: 80, premium: 120 },
  });

  const directShare = (passengerClass: PassengerClass): number => {
    const targetMarket = market(passengerClass);
    const options = buildJourneyOptions(
      [direct, firstConnection, secondConnection],
      targetMarket,
      { allowTransfers: true },
    );
    const choice = chooseJourneys(targetMarket, options);
    const directOptions = options.filter((option) => option.serviceLegIds[0] === "direct");
    const totalRequested = [...choice.requestedByOption.values()].reduce(
      (sum, value) => sum + value,
      0,
    );
    return directOptions.reduce((sum, option) => sum + (choice.requestedByOption.get(option.id) ?? 0), 0) / totalRequested;
  };

  assert.ok(directShare("business") > directShare("economy"));
});

test("共享航段永远不会超过可用运力", () => {
  const aToB = service({ id: "a-b", fromPortId: "a", toPortId: "b" });
  const dToB = service({ id: "d-b", fromPortId: "d", toPortId: "b" });
  const shared = service({
    id: "b-c",
    fromPortId: "b",
    toPortId: "c",
    dailySeatCapacity: 100,
    seatsPerDeparture: 50,
  });
  const markets: MarketDemand[] = [
    market("economy", 100_000),
    { ...market("economy", 100_000), originPortId: "d" },
  ];
  const settlement = simulateDay({ markets, services: [aToB, dToB, shared], journeySearch: { allowTransfers: true } });
  const sharedResult = settlement.services.find((item) => item.serviceLegId === "b-c")!;

  assert.ok(sharedResult.passengers <= 100 + 1e-9);
  assert.ok(sharedResult.loadFactor <= 1 + 1e-9);
  assert.ok(settlement.markets.some((item) => item.capacityLostPassengers > 0));
});

test("航线自动展开为往返服务并计算班次", () => {
  const ports: Starport[] = ["a", "b", "c"].map((id) => ({
    id,
    systemId: id,
    name: id.toUpperCase(),
    population: 50,
    economy: 50,
    business: 50,
    tourism: 50,
    administration: 50,
    portLevel: 3,
    dailyCapacity: 1_000,
    fuelPrice: 2,
    serviceFee: 100,
  }));
  const worldLegs: WorldLeg[] = [
    {
      id: "a-b",
      fromPortId: "a",
      toPortId: "b",
      mode: "hyperspace",
      distance: 40,
      hazard: 0,
      timeModifier: 1,
      fuelModifier: 1,
      isOpen: true,
    },
    {
      id: "b-c",
      fromPortId: "b",
      toPortId: "c",
      mode: "hyperspace",
      distance: 40,
      hazard: 0,
      timeModifier: 1,
      fuelModifier: 1,
      isOpen: true,
    },
  ];
  const ship: ShipType = {
    id: "liner",
    name: "Liner",
    manufacturer: "Test Shipyard",
    familyId: "test-family",
    familyName: "Test Family",
    variant: "100",
    description: "Test fixture",
    structuralMassTonnes: 300,
    fuelCapacityTonnes: 100,
    fixedMaintenanceCostPerDay: 1_000,
    cabinSpace: 100,
    seats: 100,
    purchasePrice: 1_000_000,
    supportedModes: ["hyperspace"],
    speedByMode: { hyperspace: 8 },
    maxRangeByMode: { hyperspace: 100 },
    fuelPerDistanceByMode: { hyperspace: 1 },
    maintenancePerFlightHour: 10,
    crewCostPerFlightHour: 10,
    reliability: 0.95,
    comfort: 70,
    minimumPortLevel: 3,
    turnaroundHours: 1,
    operationalAvailability: 1,
  };
  const route: Route = {
    id: "trunk",
    companyId: "player",
    name: "Trunk",
    kind: "return",
    stops: ["a", "b", "c"].map((portId) => ({
      portId,
      stopType: "commercial" as const,
      minimumStopHours: 1,
    })),
    shipTypeId: "liner",
    assignedShips: 1,
    pricing: {
      multiplier: 1,
      passengerClassMultiplier: { economy: 1, business: 1.35, premium: 2.1 },
    },
    maintenanceAllowanceHours: 0,
    active: true,
  };

  const services = buildRouteServices(route, ship, ports, worldLegs);
  assert.deepEqual(
    services.map((item) => `${item.fromPortId}->${item.toPortId}`),
    ["a->b", "b->c", "c->b", "b->a"],
  );
  assert.ok(services.every((item) => item.departuresPerWeek > 0));
});

test("同一种子和日期产生完全相同的平滑需求变化", () => {
  const first = deterministicVariation(123, "a->c:economy", 42);
  const second = deterministicVariation(123, "a->c:economy", 42);
  const nextDay = deterministicVariation(124, "a->c:economy", 42);

  assert.equal(first, second);
  assert.ok(Math.abs(first - nextDay) < 0.02);
  assert.ok(first >= 0.92 && first <= 1.08);
});

test("v0.5 OD 需求按四类旅客生成且不再把旅客类型当作舱位", () => {
  const ports: Starport[] = ["a", "b"].map((id, index) => ({
    id, systemId: id, name: id, population: 60 + index * 10, economy: 70,
    business: 65, tourism: 75, administration: 55, portLevel: 3,
    dailyCapacity: 1_000, fuelPrice: 2, serviceFee: 100,
  }));
  const legs: WorldLeg[] = [{
    id: "a-b", fromPortId: "a", toPortId: "b", mode: "hyperspace",
    distance: 30, hazard: 0, timeModifier: 1, fuelModifier: 1, isOpen: true,
  }];
  const markets = generateMarketDemands(ports, allReferenceTimes(ports, legs), { day: 12, seed: 77 });
  const outbound = markets.filter((entry) => entry.originPortId === "a" && entry.destinationPortId === "b");
  assert.deepEqual(new Set(outbound.map((entry) => entry.passengerType)), new Set(PASSENGER_TYPES));
  assert.equal(outbound.length, 4);
  assert.ok(outbound.every((entry) => !("passengerClass" in entry)));
});

test("v0.5 四类旅客可在三舱之间选择且分舱容量独立", () => {
  const cabinService = service({
    id: "three-cabins", fromPortId: "a", toPortId: "c",
    dailySeatCapacity: 180,
    dailySeatCapacityByClass: { economy: 100, business: 50, premium: 30 },
    seatsPerDepartureByClass: { economy: 100, business: 50, premium: 30 },
    fareByClass: { economy: 100, business: 100, premium: 100 },
  });
  const leisureMarket: MarketDemand = {
    originPortId: "a", destinationPortId: "c", passengerType: "leisure",
    potentialPassengers: 1_000, referenceTimeHours: 10, acceptableFare: 180,
  };
  const options = buildJourneyOptions([cabinService], leisureMarket);
  assert.deepEqual(new Set(options.map((option) => option.cabinClass)), new Set(["economy", "business", "premium"]));
  const settlement = simulateDay({ markets: [leisureMarket], services: [cabinService] });
  const result = settlement.services[0]!;
  assert.ok(result.passengersByClass.economy <= 100 + 1e-9);
  assert.ok(result.passengersByClass.business <= 50 + 1e-9);
  assert.ok(result.passengersByClass.premium <= 30 + 1e-9);
});

test("v0.5 推荐价使用完整成本、55%参考上座率并严格加价20%", () => {
  const costed = service({
    id: "costed", routeId: "route-costed", fromPortId: "a", toPortId: "c",
    dailySeatCapacity: 180,
    dailySeatCapacityByClass: { economy: 100, business: 50, premium: 30 },
    seatsPerDepartureByClass: { economy: 100, business: 50, premium: 30 },
    baseCostBreakdown: {
      fuel: 800, staff: 500, port: 200, flightMaintenance: 300,
      fixedMaintenance: 400, ageSurcharge: 100, depreciation: 600,
      delay: 100, other: 0, total: 3_000,
    },
    dailyOperatingCost: 3_000,
  });
  const recommendation = recommendRouteFares("route-costed", [costed]);
  for (const cabinClass of ["economy", "business", "premium"] as const) {
    assert.ok(recommendation[cabinClass].allocatedDailyCost > 0);
    assert.equal(recommendation[cabinClass].referencePassengers, costed.dailySeatCapacityByClass![cabinClass] * 0.55);
    assert.ok(Math.abs(recommendation[cabinClass].recommendedFare - recommendation[cabinClass].breakEvenFare * 1.2) < 1e-9);
    assert.equal(recommendation[cabinClass].confidence, "low");
  }
});

test("v0.5 评价原因和图表数据均由实际数值生成且可复现", () => {
  const targetMarket: MarketDemand = {
    originPortId: "a", destinationPortId: "c", passengerType: "business",
    potentialPassengers: 200, referenceTimeHours: 12, acceptableFare: 150,
  };
  const option = buildJourneyOptions([service({
    id: "explain", fromPortId: "a", toPortId: "c", inVehicleHours: 8,
    fareByClass: { economy: 120, business: 210, premium: 400 }, onTimeRate: 0.82,
  })], targetMarket).find((entry) => entry.cabinClass === "business")!;
  const explanation = explainJourneyChoice(targetMarket, option);
  assert.ok(explanation.negative.some((reason) => reason.text.includes("高于可接受价 40%")));
  assert.ok(explanation.positive.some((reason) => reason.text.includes("直达")));

  const evaluate = (fare: number) => ({ passengers: Math.max(0, 120 - fare / 2), profit: fare * 2 - 100, revenue: fare * 2 });
  const first = buildFareCurveData(200, evaluate);
  const second = buildFareCurveData(200, evaluate);
  assert.deepEqual(first, second);
  assert.ok(first.every((point) => point.passengerLow <= point.passengers && point.passengers <= point.passengerHigh));
  assert.ok(first.every((point) => point.profitLow <= point.profit && point.profit <= point.profitHigh));
});

test("v0.5 航段票款收入减全部成本严格等于净利润", () => {
  const costed = service({
    id: "accounting", fromPortId: "a", toPortId: "c",
    dailySeatCapacity: 100,
    baseCostBreakdown: {
      fuel: 200, staff: 100, port: 80, flightMaintenance: 90,
      fixedMaintenance: 110, ageSurcharge: 20, depreciation: 150,
      delay: 30, other: 10, total: 790,
    },
    dailyOperatingCost: 790,
    operatingCostPerPassenger: 2,
  });
  const settlement = simulateDay({ markets: [market("economy", 60)], services: [costed] }).services[0]!;
  assert.ok(Math.abs(settlement.ticketRevenue - settlement.operatingCost - settlement.netProfit) < 1e-9);
  assert.ok(settlement.costBreakdown.depreciation > 0);
});

test("v0.6 随机可玩航线的真实质量燃料成本保持有限", () => {
  const costShares = Array.from({ length: 12 }, (_, seedIndex) => {
    const generated = createGeneratedScenario({
      ...DEFAULT_GALAXY_CONFIG,
      seed: `fuel-balance-${seedIndex}`,
    });
    const shipTypes = new Map(generated.scenario.shipTypes.map((shipType) => [shipType.id, shipType]));
    return generated.scenario.routes.flatMap((route) => {
      const shipType = shipTypes.get(route.shipTypeId)!;
      return buildRouteServices(
        route,
        shipType,
        generated.scenario.ports,
        generated.scenario.worldLegs,
      ).map((serviceLeg) => ({
        fuel: serviceLeg.baseCostBreakdown!.fuel / serviceLeg.baseCostBreakdown!.total,
        fixedMaintenance: serviceLeg.baseCostBreakdown!.fixedMaintenance / serviceLeg.baseCostBreakdown!.total,
      }));
    });
  }).flat();
  const fuelShares = costShares.map((share) => share.fuel).sort((left, right) => left - right);
  const fixedShares = costShares.map((share) => share.fixedMaintenance).sort((left, right) => left - right);
  const medianFuelShare = fuelShares[Math.floor(fuelShares.length * 0.5)]!;
  const highFuelShare = fuelShares[Math.floor(fuelShares.length * 0.95)]!;
  const medianFixedShare = fixedShares[Math.floor(fixedShares.length * 0.5)]!;

  assert.ok(medianFuelShare > 0 && medianFuelShare < 0.7);
  assert.ok(highFuelShare < 0.85);
  assert.ok(medianFixedShare < 0.3);
});

test("自动存档超出配额时逐级缩短历史且不会抛出异常", () => {
  const generated = createGeneratedScenario({ ...DEFAULT_GALAXY_CONFIG, seed: "storage-quota" });
  const game = createNewGame(
    generated.galaxy.config,
    generated.galaxy,
    generated.galaxy.ports[0]!.id,
    generated.scenario.shipTypes,
  );
  const history = Array.from({ length: 90 }, (_, index) => ({
    day: index + 1,
    cash: game.cash,
    revenue: 0,
    operatingCost: 0,
    overhead: 0,
    profit: 0,
    passengers: 0,
    activeEventIds: ["x".repeat(1_500)],
    announcedEventIds: [],
    routes: [],
  }));
  const bloated = { ...game, history };
  let stored = "";
  const limitedStorage: StorageLike = {
    getItem: () => stored || null,
    setItem: (_key, value) => {
      if (value.length > 20_000) throw new Error("quota exceeded");
      stored = value;
    },
  };
  const result = persistGame(limitedStorage, "save", bloated);
  assert.equal(result.saved, true);
  assert.equal(result.retainedHistoryDays, 7);
  const restored = loadStoredGame(limitedStorage, "save") as GameState;
  assert.equal(restored.history.length, 7);

  const unavailable: StorageLike = {
    getItem: () => null,
    setItem: () => { throw new Error("disabled"); },
  };
  assert.doesNotThrow(() => persistGame(unavailable, "save", bloated));
  assert.equal(persistGame(unavailable, "save", bloated).saved, false);
});

test("燃料报价在压缩存档中独立保留最近 360 日", () => {
  const generated = createGeneratedScenario({ ...DEFAULT_GALAXY_CONFIG, seed: "fuel-price-storage" });
  const game = createNewGame(
    generated.galaxy.config,
    generated.galaxy,
    generated.galaxy.ports[0]!.id,
    generated.scenario.shipTypes,
  );
  const fuelMarket = Array.from({ length: 420 }, (_, index) => ({
    day: index + 1,
    price: 1 + index / 1_000,
  }));

  const compact = compactGameForStorage({ ...game, fuelMarket }, 7);
  assert.equal(compact.history.length, 0);
  assert.equal(compact.fuelMarket.length, 360);
  assert.equal(compact.fuelMarket[0]!.day, 61);
  assert.equal(compact.fuelMarket.at(-1)!.day, 420);
});

test("v0.7 不会把 v0.5 旧自动出售存档误读为新物理状态", () => {
  const generated = createGeneratedScenario({ ...DEFAULT_GALAXY_CONFIG, seed: "replacement-migration" });
  const game = createNewGame(
    generated.galaxy.config,
    generated.galaxy,
    generated.galaxy.ports[0]!.id,
    generated.scenario.shipTypes,
  );
  const legacy = {
    ...game,
    version: 8,
    autoSellAgeYears: 5,
  };
  delete (legacy as { autoReplacementAgeYears?: number | null }).autoReplacementAgeYears;
  const migrated = migrateGameState(legacy);
  assert.equal(migrated, legacy);
  assert.equal(isGameState(migrated), false);
});

test("v0.7 不再运行 v0.5.1 燃料存档迁移链", () => {
  const generated = createGeneratedScenario({ ...DEFAULT_GALAXY_CONFIG, seed: "fuel-v10-migration" });
  const game = createNewGame(
    generated.galaxy.config,
    generated.galaxy,
    generated.galaxy.ports[0]!.id,
    generated.scenario.shipTypes,
  );
  const baseId = game.basePortId;
  const legacy = {
    ...game,
    version: 10,
    fuelMarket: [{ day: 1, prices: { [baseId]: 1.25, remote: 2.8 } }],
    fuelStorage: {
      portId: baseId, capacity: CORE_FUEL_STORAGE_CAPACITY, quantity: 240,
      averageUnitCost: 18, autoBuyPriceThreshold: 1.5, inventoryUsePriceThreshold: 3,
    },
  } as Record<string, unknown>;
  delete legacy.fuelWarehouse;
  delete legacy.fuelContracts;
  delete legacy.fuelAutoContractPolicy;
  delete legacy.nextFuelContractNumber;
  const migrated = migrateGameState(legacy);
  assert.equal(migrated, legacy);
  assert.equal(isGameState(migrated), false);
});

test("概念验证版世界航段可双向用于理论旅行时间", () => {
  const leg: WorldLeg = {
    id: "a-b",
    fromPortId: "a",
    toPortId: "b",
    mode: "hyperspace",
    distance: 45,
    hazard: 0,
    timeModifier: 1,
    fuelModifier: 1,
    isOpen: true,
  };

  assert.equal(shortestReferenceTime("a", "b", [leg]), 216);
  assert.equal(shortestReferenceTime("b", "a", [leg]), 216);
});

test("事件只在开始后生效，并在恢复期平滑消退", () => {
  const event: MarketEvent = {
    id: "expo",
    name: "Expo",
    description: "Test event",
    announcedOnDay: 5,
    startsOnDay: 10,
    endsOnDay: 20,
    recoveryDays: 10,
    affectedPortIds: ["c"],
    demandModifiers: { business: 3 },
  };

  assert.equal(eventIntensity(event, 9), 0);
  assert.equal(eventIntensity(event, 10), 1);
  assert.equal(eventIntensity(event, 20), 1);
  assert.equal(eventIntensity(event, 25), 0.5);
  assert.equal(eventIntensity(event, 30), 0);
  assert.equal(fuelEventIntensity(event, 9), 0);
  assert.equal(fuelEventIntensity(event, 10), 0);
  assert.equal(fuelEventIntensity(event, 12), 0.5);
  assert.equal(fuelEventIntensity(event, 14), 1);
  assert.equal(fuelEventIntensity(event, 25), 0.5);
  assert.equal(fuelEventIntensity(event, 30), 0);
  assert.equal(marketEventDemandMultiplier([event], 9, "a", "c", "business"), 1);
  assert.equal(marketEventDemandMultiplier([event], 10, "a", "c", "business"), 3);
  assert.equal(marketEventDemandMultiplier([event], 25, "a", "c", "business"), 2);
});

test("概念验证场景包含20个星港、30种系列化船型且所有航线有效", () => {
  assert.equal(PROOF_OF_CONCEPT_SCENARIO.ports.length, 20);
  assert.equal(PROOF_OF_CONCEPT_SCENARIO.shipTypes.length, 30);
  assert.equal(new Set(PROOF_OF_CONCEPT_SCENARIO.shipTypes.map((ship) => ship.familyId)).size, 9);
  assert.equal(PROOF_OF_CONCEPT_SCENARIO.shipTypes.filter((ship) => ship.familyId === "vector-fast").length, 6);
  assert.ok(PROOF_OF_CONCEPT_SCENARIO.shipTypes.every((shipType) =>
    shipType.supportedModes.filter((mode) => mode === "warp" || mode === "hyperspace").length <= 1,
  ));

  const ships = new Map(
    PROOF_OF_CONCEPT_SCENARIO.shipTypes.map((shipType) => [shipType.id, shipType]),
  );
  for (const scenarioRoute of PROOF_OF_CONCEPT_SCENARIO.routes) {
    const shipType = ships.get(scenarioRoute.shipTypeId);
    assert.ok(shipType);
    assert.doesNotThrow(() =>
      buildRouteServices(
        scenarioRoute,
        shipType,
        PROOF_OF_CONCEPT_SCENARIO.ports,
        PROOF_OF_CONCEPT_SCENARIO.worldLegs,
      ),
    );
  }
});

test("多日战役模拟在相同种子和输入下保持确定性", () => {
  const first = simulateCampaign(PROOF_OF_CONCEPT_SCENARIO, {
    startDay: 29,
    numberOfDays: 3,
  });
  const second = simulateCampaign(PROOF_OF_CONCEPT_SCENARIO, {
    startDay: 29,
    numberOfDays: 3,
  });

  assert.deepEqual(first, second);
  assert.deepEqual(first.days.map((day) => day.activeEventIds), [
    [],
    ["alpha-industry-expo"],
    ["alpha-industry-expo"],
  ]);
  assert.deepEqual(first.days.map((day) => day.announcedEventIds), [
    ["alpha-industry-expo"],
    ["alpha-industry-expo"],
    ["alpha-industry-expo"],
  ]);
});

test("随机银河严格遵守数量配置并可由种子复现", () => {
  const config: GalaxyGenerationConfig = {
    ...DEFAULT_GALAXY_CONFIG,
    seed: "repeatable-sector",
    systemCount: 12,
    starportCount: 8,
  };
  const first = generateGalaxy(config);
  const second = generateGalaxy(config);

  assert.equal(first.systems.length, 12);
  assert.equal(first.ports.length, 8);
  assert.deepEqual(first, second);
  const availableSystemNames = new Set<string>(CHINESE_SYSTEM_NAMES);
  assert.ok(first.systems.every((system) => availableSystemNames.has(system.name)));
  assert.equal(new Set(first.systems.map((system) => system.name)).size, first.systems.length);
  assert.ok(first.ports.every((port) => port.name.endsWith("枢纽港")));
  assert.ok(first.systems.some((system) => system.inhabited));
  assert.ok(first.systems.some((system) => !system.inhabited));
  const navigationNodeIds = new Set(first.systems.map((system) => system.navigationNodeId));
  assert.ok(first.worldLegs.every(
    (leg) => navigationNodeIds.has(leg.fromPortId) && navigationNodeIds.has(leg.toPortId),
  ));
  const averageHyperspaceDistance = first.systemLanes
    .filter((lane) => lane.mode === "hyperspace")
    .reduce((sum, lane, _index, lanes) => sum + lane.distance / lanes.length, 0);
  assert.ok(averageHyperspaceDistance >= 8 && averageHyperspaceDistance <= 13);
  let ringedPlanetCount = 0;
  for (const system of first.systems) {
    const details = first.systemDetails[system.id]!;
    const localPorts = first.ports.filter((port) => port.systemId === system.id);
    assert.ok(details.stars.length >= 1 && details.stars.length <= 3);
    assert.ok(details.planets.length >= 4 && details.planets.length <= 9);
    assert.equal(
      details.planets.some((planet) => planet.inhabited),
      system.inhabited,
    );
    assert.equal(details.starportLocations.length, localPorts.length);
    assert.equal(localPorts.length, system.inhabited ? 1 : 0);
    assert.equal(system.hubPortId !== null, system.inhabited);
    for (const planet of details.planets) {
      if (planet.hasRings) ringedPlanetCount += 1;
      assert.ok(planet.ringTilt >= -28 && planet.ringTilt <= 28);
      assert.ok(planet.orbitalPeriodDays > 0);
      assert.notEqual(planet.rotationPeriodHours, 0);
      assert.ok(planet.rotationAngle >= 0 && planet.rotationAngle < Math.PI * 2);
      assert.ok(planet.axialTiltDegrees >= 1 && planet.axialTiltDegrees <= 145);
      assert.ok(planet.moons.length >= 0);
      for (const moon of planet.moons) {
        assert.ok(moon.orbitalPeriodDays > 0);
        assert.notEqual(moon.rotationPeriodHours, 0);
        assert.ok(moon.rotationAngle >= 0 && moon.rotationAngle < Math.PI * 2);
        assert.ok(moon.axialTiltDegrees >= 1 && moon.axialTiltDegrees <= 145);
      }
      if (planet.inhabited) {
        assert.ok(planet.populationMillions > 0);
        assert.ok(planet.colony);
        assert.ok(planet.development > 0);
        assert.notEqual(planet.economyType, "none");
      }
    }
    assert.ok(localPorts.every((port) => (port.populationMillions ?? 0) > 0));
  }
  assert.ok(ringedPlanetCount > 0);

  const fullyInhabited = generateGalaxy({
    ...DEFAULT_GALAXY_CONFIG,
    seed: "fully-inhabited-sector",
    systemCount: 5,
    starportCount: 5,
  });
  assert.ok(fullyInhabited.systems.every((system) => system.inhabited));
  assert.ok(fullyInhabited.systems.every(
    (system) => fullyInhabited.ports.filter((port) => port.systemId === system.id).length === 1,
  ));
  assert.throws(() => generateGalaxy({
    ...DEFAULT_GALAXY_CONFIG,
    systemCount: 5,
    starportCount: 6,
  }));
});

test("高发展度市场产生更多跨星客运需求", () => {
  const lowDevelopmentPorts: Starport[] = [
    {
      id: "low-a", systemId: "low-system-a", name: "Low A", population: 55,
      economy: 25, business: 25, tourism: 50, administration: 25,
      portLevel: 3, dailyCapacity: 1_500, fuelPrice: 2, serviceFee: 80,
    },
    {
      id: "low-b", systemId: "low-system-b", name: "Low B", population: 55,
      economy: 25, business: 25, tourism: 50, administration: 25,
      portLevel: 3, dailyCapacity: 1_500, fuelPrice: 2, serviceFee: 80,
    },
  ];
  const highDevelopmentPorts = lowDevelopmentPorts.map((port, index) => ({
    ...port,
    id: `high-${index}`,
    systemId: `high-system-${index}`,
    economy: 90,
    business: 90,
    administration: 90,
  }));
  const lowTimes = new Map([
    ["low-a->low-b", 10],
    ["low-b->low-a", 10],
  ]);
  const highTimes = new Map([
    ["high-0->high-1", 10],
    ["high-1->high-0", 10],
  ]);
  const lowDemand = generateMarketDemands(lowDevelopmentPorts, lowTimes, { day: 1, seed: 7 })
    .reduce((sum, marketItem) => sum + marketItem.potentialPassengers, 0);
  const highDemand = generateMarketDemands(highDevelopmentPorts, highTimes, { day: 1, seed: 7 })
    .reduce((sum, marketItem) => sum + marketItem.potentialPassengers, 0);

  assert.ok(highDemand > lowDemand * 1.5);
});

test("高热度超空间市场会自动出现竞争航线", () => {
  const generated = createGeneratedScenario({
    ...DEFAULT_GALAXY_CONFIG,
    seed: "dense-developed-markets",
    systemCount: 18,
    starportCount: 14,
    laneDensity: 0.85,
  });
  const competitiveRoutes = generated.scenario.routes.filter((route) =>
    route.id.startsWith("competitive-hyper-"),
  );

  assert.ok(competitiveRoutes.length > 0);
  for (const route of competitiveRoutes) {
    const sameMarket = generated.scenario.routes.filter(
      (candidate) =>
        candidate.stops[0]?.portId === route.stops[0]?.portId &&
        candidate.stops[1]?.portId === route.stops[1]?.portId,
    );
    assert.ok(sameMarket.length >= 2);
  }
});

test("所有超空间拓扑都保持全部行星系连通", () => {
  const topologies: GalaxyGenerationConfig["topology"][] = [
    "web",
    "radial",
    "ring",
    "mixed",
  ];

  for (const topology of topologies) {
    const galaxy = generateGalaxy({
      ...DEFAULT_GALAXY_CONFIG,
      seed: `connected-${topology}`,
      systemCount: 14,
      starportCount: 10,
      topology,
      laneDensity: 0,
    });
    const neighbors = new Map(
      galaxy.systems.map((system) => [system.id, new Set<string>()]),
    );
    for (const lane of galaxy.systemLanes.filter((candidate) => candidate.mode === "hyperspace")) {
      neighbors.get(lane.fromSystemId)!.add(lane.toSystemId);
      neighbors.get(lane.toSystemId)!.add(lane.fromSystemId);
    }
    const visited = new Set<string>();
    const queue = [galaxy.systems[0]!.id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      queue.push(...neighbors.get(current)!);
    }
    assert.equal(visited.size, galaxy.systems.length, `${topology} should be connected`);
    assert.ok(
      galaxy.systems
        .filter((system) => !system.inhabited)
        .every((system) => neighbors.get(system.id)!.size > 0),
    );
  }
});

test("生成场景中的初始航线均有效并可完成日结算", () => {
  const generated = createGeneratedScenario(DEFAULT_GALAXY_CONFIG);
  const ships = new Map(generated.scenario.shipTypes.map((ship) => [ship.id, ship]));
  for (const route of generated.scenario.routes) {
    assert.doesNotThrow(() =>
      buildRouteServices(
        route,
        ships.get(route.shipTypeId)!,
        generated.scenario.ports,
        generated.scenario.worldLegs,
      ),
    );
  }
  const result = simulateCampaign(generated.scenario, { numberOfDays: 1 });
  assert.equal(result.days.length, 1);
  assert.ok(result.companies.some((company) => company.companyId === "player"));
  assert.ok(result.companies.every((company) => Number.isFinite(company.operatingProfit)));
});

test("舰船批量采购会进入交付队列，并以空舱交付且遵守 6:3:1 空间占用", () => {
  const generated = createGeneratedScenario(DEFAULT_GALAXY_CONFIG);
  const base = generated.galaxy.ports[0]!;
  let game = createNewGame(DEFAULT_GALAXY_CONFIG, generated.galaxy, base.id);
  const shuttle = generated.scenario.shipTypes.find((ship) => ship.id === "sparrow-shuttle")!;
  const startingCash = game.cash;
  const quote = quoteShipPurchaseAgreement(game, [{ shipTypeId: shuttle.id, quantity: 3 }], generated.scenario.shipTypes);
  game = buyShip(game, shuttle.id, generated.scenario.shipTypes, 3).state;
  assert.equal(game.fleet.filter((ship) => ship.shipTypeId === shuttle.id).length, 0);
  assert.equal(game.shipPurchaseOrders.length, 1);
  assert.equal(game.cash, startingCash - quote.totalPrice);
  game = deliverAllOrdersForTest(game, generated.scenario.shipTypes);
  const purchased = game.fleet.filter((ship) => ship.shipTypeId === shuttle.id);

  assert.equal(purchased.length, 3);
  assert.ok(purchased.every((ship) => ship.configurationId === null));
  assert.throws(() => configureShipCabins(
    game,
    purchased[0]!.id,
    { premium: 6, business: 0, economy: 0 },
    generated.scenario.shipTypes,
  ), /超过/);

  game = configureShipCabins(
    game,
    purchased[0]!.id,
    { premium: 2, business: 4, economy: 8 },
    generated.scenario.shipTypes,
  ).state;
  assert.deepEqual(fleetConfigurationForShip(
    game,
    game.fleet.find((ship) => ship.id === purchased[0]!.id)!,
  )!.cabins, {
    premium: 2,
    business: 4,
    economy: 8,
  });
});

test("同一船型可维护多个统一方案并批量分配舰船", () => {
  const generated = createGeneratedScenario(DEFAULT_GALAXY_CONFIG);
  const base = generated.galaxy.ports[0]!;
  let game = createNewGame(DEFAULT_GALAXY_CONFIG, generated.galaxy, base.id);
  game = buyShip(game, "sparrow-shuttle", generated.scenario.shipTypes, 3).state;
  game = deliverAllOrdersForTest(game, generated.scenario.shipTypes);
  const shuttles = game.fleet.filter((ship) => ship.shipTypeId === "sparrow-shuttle");
  game = createFleetConfiguration(
    game,
    "sparrow-shuttle",
    "通勤方案",
    { premium: 0, business: 4, economy: 20 },
    generated.scenario.shipTypes,
  ).state;
  const commuter = game.fleetConfigurations.at(-1)!;
  game = createFleetConfiguration(
    game,
    "sparrow-shuttle",
    "高端方案",
    { premium: 4, business: 0, economy: 8 },
    generated.scenario.shipTypes,
  ).state;
  const premium = game.fleetConfigurations.at(-1)!;
  game = assignShipsToFleetConfiguration(game, commuter.id, shuttles.slice(0, 2).map((ship) => ship.id)).state;
  game = assignShipsToFleetConfiguration(game, premium.id, [shuttles[2]!.id]).state;

  assert.equal(game.fleetConfigurations.filter((configuration) => configuration.shipTypeId === "sparrow-shuttle").length, 2);
  assert.equal(game.fleet.filter((ship) => ship.configurationId === commuter.id).length, 2);
  assert.equal(game.fleet.filter((ship) => ship.configurationId === premium.id).length, 1);

  game = updateFleetConfiguration(
    game,
    commuter.id,
    "通勤增强方案",
    { premium: 0, business: 2, economy: 26 },
    generated.scenario.shipTypes,
  ).state;
  assert.equal(game.fleetConfigurations.find((configuration) => configuration.id === commuter.id)!.name, "通勤增强方案");
  assert.ok(game.fleet.filter((ship) => ship.configurationId === commuter.id).every((ship) =>
    fleetConfigurationForShip(game, ship)!.cabins.economy === 26
  ));
});

test("v0.7 星际燃料使用吨、计入旅客质量并采用显式抵达储备", () => {
  const baseType = PROOF_OF_CONCEPT_SCENARIO.shipTypes.find((ship) => ship.id === "arrow-express")!;
  const cabins = { premium: 0, business: 0, economy: baseType.cabinSpace };
  const shortRange = estimateFuelConsumption(baseType, "warp", 10, cabins, 0);
  const loaded = estimateFuelConsumption(baseType, "warp", 10, cabins, baseType.cabinSpace);
  const slow = estimateInterstellarFuel(baseType, "warp", 10, cabins, baseType.minimumCruiseRatio!);

  assert.ok(loaded.fuelUnits > shortRange.fuelUnits);
  assert.ok(loaded.passengerMassTonnes > 0);
  assert.equal(shortRange.emergencyReserveUnits, Number((shortRange.fuelUnits * EMERGENCY_FUEL_MARGIN).toFixed(4)));
  assert.equal(shortRange.requiredFuelLoadUnits, Number((shortRange.fuelUnits * (1 + EMERGENCY_FUEL_MARGIN)).toFixed(4)));
  assert.ok(loaded.carriedFuelMassTonnes > shortRange.carriedFuelMassTonnes);
  assert.ok(slow.rangeMismatchMultiplier > 1);
  assert.ok(slow.fuelUnits > estimateInterstellarFuel(baseType, "warp", 10, cabins, baseType.fuelOptimalCruiseRatio!).fuelUnits);
});

test("多型号采购协议叠加批量优惠，热度延长排产且现货次日交付", () => {
  const generated = createGeneratedScenario(DEFAULT_GALAXY_CONFIG);
  const types = generated.scenario.shipTypes;
  let game = createNewGame(DEFAULT_GALAXY_CONFIG, generated.galaxy, generated.galaxy.ports[0]!.id, types);
  const sparrow = types.find((ship) => ship.id === "sparrow-shuttle")!;
  const pioneer = types.find((ship) => ship.id === "pioneer-regional")!;
  const agreement = quoteShipPurchaseAgreement(game, [
    { shipTypeId: sparrow.id, quantity: 3 },
    { shipTypeId: pioneer.id, quantity: 3 },
  ], types);
  assert.equal(agreement.agreementDiscountRate, purchaseAgreementDiscount(6));
  assert.equal(agreement.agreementDiscountRate, 0.06);
  assert.ok(agreement.totalPrice < agreement.listPrice);

  const originalOffer = game.shipyardMarket.find((offer) => offer.shipTypeId === sparrow.id)!;
  const withOffer = (popularity: number, inventory: number): GameState => ({
    ...game,
    shipyardMarket: game.shipyardMarket.map((offer) => offer.shipTypeId === sparrow.id
      ? { ...offer, popularity, inventory, discountRate: originalOffer.discountRate }
      : offer),
  });
  const hot = quoteShipPurchaseAgreement(withOffer(0.95, 0), [{ shipTypeId: sparrow.id, quantity: 2 }], types);
  const cold = quoteShipPurchaseAgreement(withOffer(0.15, 0), [{ shipTypeId: sparrow.id, quantity: 2 }], types);
  const stock = quoteShipPurchaseAgreement(withOffer(0.95, 2), [{ shipTypeId: sparrow.id, quantity: 2 }], types);
  assert.ok(hot.lines[0]!.deliveryDay > cold.lines[0]!.deliveryDay);
  assert.equal(stock.lines[0]!.deliveryDay, game.day + 1);

  game = placeShipPurchaseAgreement(game, [
    { shipTypeId: sparrow.id, quantity: 3 },
    { shipTypeId: pioneer.id, quantity: 3 },
  ], types).state;
  assert.equal(game.shipPurchaseOrders.length, 2);
  assert.equal(game.fleet.length, 1);
});

test("船龄提高固定维护并降低舒适度，到龄后订购新船且交付时无缝替换", () => {
  const generated = createGeneratedScenario(DEFAULT_GALAXY_CONFIG);
  const types = generated.scenario.shipTypes;
  const meridian = types.find((ship) => ship.id === "meridian-liner")!;
  let game = createNewGame(DEFAULT_GALAXY_CONFIG, generated.galaxy, generated.galaxy.ports[0]!.id, types);
  const ship = game.fleet[0]!;
  const agedDay = 721;
  assert.ok(shipAgeYears(ship, agedDay) >= 2);
  assert.ok(fleetFixedMaintenanceCost(game.fleet, types, agedDay).total > fleetFixedMaintenanceCost(game.fleet, types, 1).total);
  assert.ok(shipComfortAtAge(ship, meridian, agedDay) < meridian.comfort);

  game = {
    ...game,
    fleet: game.fleet.map((item) => ({
      ...item,
      routeId: "route-preserved",
      configurationId: "configuration-preserved",
    })),
  };
  game = setAutoReplacementAge({ ...game, day: 720, primaryGoalCompletedOnDay: 1 }, 2).state;
  game = advanceGameDay(game, generated.scenario, generated.galaxy).state;
  assert.equal(game.fleet.length, 1);
  assert.equal(game.fleet[0]!.id, ship.id);
  assert.equal(game.shipPurchaseOrders.length, 1);
  assert.deepEqual(game.shipPurchaseOrders[0]!.replacementShipIds, [ship.id]);

  const deliveryDay = game.shipPurchaseOrders[0]!.deliveryDay;
  const cashBeforeDelivery = game.cash;
  game = deliverShipPurchaseOrders({ ...game, day: deliveryDay }, types, deliveryDay).state;
  assert.equal(game.fleet.length, 1);
  assert.notEqual(game.fleet[0]!.id, ship.id);
  assert.equal(game.fleet[0]!.routeId, "route-preserved");
  assert.equal(game.fleet[0]!.configurationId, "configuration-preserved");
  assert.equal(game.fleet[0]!.commissionedDay, deliveryDay);
  assert.equal(game.shipPurchaseOrders.length, 0);
  assert.ok(game.cash > cashBeforeDelivery);
});

test("维护准备金保留折扣，但现金只在实际大修时支出", () => {
  const types = PROOF_OF_CONCEPT_SCENARIO.shipTypes;
  const owned = (shipTypeId: string, index: number): OwnedShip => ({
    id: `discount-${index}`,
    name: `Discount ${index}`,
    shipTypeId,
    routeId: null,
    condition: 100,
    flightHoursSinceMaintenance: 0,
    maintenanceUntilDay: null,
    configurationId: null,
    commissionedDay: 1,
    purchasePricePaid: 100_000,
  });
  const vectorFleet = ["comet-courier", "arrow-express", "vector-executive"].map(owned);
  const discounted = fleetFixedMaintenanceCost(vectorFleet, types);
  const mixed = fleetFixedMaintenanceCost(
    ["sparrow-shuttle", "pioneer-regional", "meridian-liner"].map(owned),
    types,
  );
  assert.ok(discounted.supplierDiscount > 0);
  assert.ok(discounted.familyDiscount > 0);
  assert.ok(discounted.total < discounted.undiscountedTotal);
  assert.equal(mixed.supplierDiscount, 0);
  assert.equal(mixed.familyDiscount, 0);

  const generated = createGeneratedScenario(DEFAULT_GALAXY_CONFIG);
  let game = createNewGame(DEFAULT_GALAXY_CONFIG, generated.galaxy, generated.galaxy.ports[0]!.id);
  const starterMaintenance = fleetFixedMaintenanceCost(game.fleet, generated.scenario.shipTypes).total;
  game = advanceGameDay(game, generated.scenario, generated.galaxy).state;
  assert.ok(starterMaintenance > 0);
  assert.equal(game.history[0]!.overhead, DAILY_COMPANY_OVERHEAD);
  const maintained = performShipMaintenance(game, game.fleet[0]!.id, generated.scenario.shipTypes).state;
  assert.ok(maintained.unsettledFinancialEvents.some((event) => event.kind === "flight-maintenance" && event.amount < 0));
});

test("玩家客舱配置按舱等形成独立运力", () => {
  const generated = createGeneratedScenario(DEFAULT_GALAXY_CONFIG);
  const [base, destination] = generated.galaxy.ports;
  assert.ok(base && destination);
  let game = createNewGame(DEFAULT_GALAXY_CONFIG, generated.galaxy, base.id);
  game = configureShipCabins(
    game,
    game.fleet[0]!.id,
    { premium: 10, business: 20, economy: 60 },
    generated.scenario.shipTypes,
  ).state;
  game = createPlayerRoute(game, {
    name: "Cabin Mix",
    originPortId: base.id,
    destinationPortId: destination.id,
    shipIds: [game.fleet[0]!.id],
    fareMultiplier: 1,
    routingMode: "hyperspace",
  }, generated.galaxy, generated.scenario.shipTypes).state;
  const type = generated.scenario.shipTypes.find((ship) => ship.id === "meridian-liner")!;
  const service = buildRouteServices(game.routes[0]!, type, generated.galaxy.ports, gameWorldLegs(generated.galaxy))[0]!;

  assert.deepEqual(service.seatsPerDepartureByClass, { premium: 10, business: 20, economy: 60 });
  assert.equal(service.seatsPerDeparture, 90);
  assert.ok(Math.abs(service.dailySeatCapacityByClass!.business - service.dailySeatCapacityByClass!.premium * 2) < 1e-10);
  assert.ok(Math.abs(service.dailySeatCapacityByClass!.economy - service.dailySeatCapacityByClass!.premium * 6) < 1e-10);
});

test("v0.7 超空间驱动整体快于曲率驱动且推进参数来自组件型号", () => {
  const ships = PROOF_OF_CONCEPT_SCENARIO.shipTypes;
  const warpSpeeds = ships.flatMap((ship) => ship.speedByMode.warp ?? []);
  const hyperspaceSpeeds = ships.flatMap((ship) => ship.speedByMode.hyperspace ?? []);
  assert.ok(Math.min(...hyperspaceSpeeds) > Math.max(...warpSpeeds));
  assert.ok(ships.every((ship) => ship.manufacturer && ship.description && ship.cabinSpace > 0));

  const ports: Starport[] = ["a", "b"].map((id) => ({
    id, systemId: id, name: id, population: 50, economy: 50, business: 50,
    tourism: 50, administration: 50, portLevel: 5, dailyCapacity: 1_000,
    fuelPrice: 2, serviceFee: 100,
  }));
  const leg: WorldLeg = {
    id: "a-b", fromPortId: "a", toPortId: "b", mode: "hyperspace", distance: 12,
    hazard: 0, timeModifier: 1, fuelModifier: 1, isOpen: true,
  };
  const baseType = ships.find((ship) => ship.id === "meridian-liner")!;
  const route: Route = {
    id: "turnaround", companyId: "player", name: "Turnaround", kind: "return",
    routingMode: "hyperspace",
    stops: ["a", "b"].map((portId) => ({ portId, stopType: "commercial" as const, minimumStopHours: 4 })),
    shipTypeId: baseType.id, assignedShips: 1,
    pricing: { multiplier: 1, passengerClassMultiplier: { economy: 1, business: 1.35, premium: 2.1 } },
    maintenanceAllowanceHours: 0, active: true,
  };
  const services = buildRouteServices(route, baseType, ports, [leg]);
  assert.ok(services[0]!.sublightHours! > 0);
  assert.ok(baseType.defaultSublightEngineModelId);
  assert.ok(baseType.defaultFtlDriveModelId);
});

test("可玩状态支持购船、开线、日结算和关闭航线的完整循环", () => {
  const generated = createGeneratedScenario(DEFAULT_GALAXY_CONFIG);
  const base = generated.galaxy.ports[0]!;
  let game = createNewGame(DEFAULT_GALAXY_CONFIG, generated.galaxy, base.id);
  const initialCash = game.cash;
  assert.equal(game.fleet.length, 1);
  assert.equal(game.routes.length, 0);

  const yacht = generated.scenario.shipTypes.find((ship) => ship.id === "meridian-liner")!;
  const purchased = buyShip(game, yacht.id, generated.scenario.shipTypes);
  game = purchased.state;
  assert.equal(game.fleet.length, 1);
  assert.equal(game.shipPurchaseOrders.length, 1);
  game = deliverAllOrdersForTest(game, generated.scenario.shipTypes);
  assert.equal(game.fleet.length, 2);
  assert.ok(game.cash < initialCash);

  // Restore the affordable starter state and assign its free Meridian liner.
  game = createNewGame(DEFAULT_GALAXY_CONFIG, generated.galaxy, base.id);
  game = configureShipsForTest(game, [game.fleet[0]!.id], generated.scenario.shipTypes);
  const origin = generated.galaxy.ports[0]!;
  const destination = generated.galaxy.ports[1]!;
  const opened = createPlayerRoute(
    game,
    {
      name: "First Corridor",
      originPortId: origin.id,
      destinationPortId: destination.id,
      shipIds: [game.fleet[0]!.id],
      fareMultiplier: 1,
      routingMode: "hyperspace",
    },
    generated.galaxy,
    generated.scenario.shipTypes,
  );
  game = opened.state;
  assert.equal(game.routes.length, 1);
  assert.equal(game.fleet[0]!.routeId, game.routes[0]!.id);
  assert.ok(game.cash < initialCash);

  const advanced = advanceGameDay(game, generated.scenario, generated.galaxy);
  game = advanced.state;
  assert.equal(game.day, 2);
  assert.equal(game.history.length, 1);
  assert.equal(game.history[0]!.routes.length, 1);
  assert.ok(Number.isFinite(game.history[0]!.profit));

  game = closePlayerRoute(game, game.routes[0]!.id).state;
  assert.equal(game.routes.length, 1);
  assert.equal(game.routes[0]!.active, true);
  assert.equal(game.routes[0]!.closingAfterRotation, true);
  assert.equal(game.fleet[0]!.routeId, game.routes[0]!.id);
  assert.ok(game.pendingFleetChanges.some((change) => change.shipId === game.fleet[0]!.id && change.toRouteId === null));
});

test("玩家航线可沿连通网络跨越无人行星系", () => {
  const generated = createGeneratedScenario({
    ...DEFAULT_GALAXY_CONFIG,
    seed: "sparse-playable-network",
    systemCount: 12,
    starportCount: 3,
    laneDensity: 0,
  });
  let game = createNewGame(generated.galaxy.config, generated.galaxy, generated.galaxy.ports[0]!.id);
  game = configureShipsForTest(game, [game.fleet[0]!.id], generated.scenario.shipTypes);
  const [origin, destination] = generated.galaxy.ports;
  assert.ok(origin && destination);
  game = createPlayerRoute(
    game,
    {
      name: "Deep Corridor",
      originPortId: origin.id,
      destinationPortId: destination.id,
      shipIds: [game.fleet[0]!.id],
      fareMultiplier: 1,
      routingMode: "hyperspace",
    },
    generated.galaxy,
    generated.scenario.shipTypes,
  ).state;
  assert.equal(game.routes.length, 1);
  assert.doesNotThrow(() => advanceGameDay(game, generated.scenario, generated.galaxy));
});

test("随机可玩场景包含确定性的预告事件", () => {
  const generated = createGeneratedScenario(DEFAULT_GALAXY_CONFIG);
  const first = createGeneratedGameEvents(generated.galaxy);
  const second = createGeneratedGameEvents(generated.galaxy);
  assert.deepEqual(first, second);
  assert.equal(first.length, 3);
  assert.ok(first.every((event) => event.affectedPortIds.length > 0));
});

test("选择的基地会约束所有玩家航线起点", () => {
  const generated = createGeneratedScenario(DEFAULT_GALAXY_CONFIG);
  const base = generated.galaxy.ports[2]!;
  const wrongOrigin = generated.galaxy.ports[0]!;
  const destination = generated.galaxy.ports[1]!;
  const game = createNewGame(DEFAULT_GALAXY_CONFIG, generated.galaxy, base.id);
  assert.equal(game.basePortId, base.id);
  assert.throws(() => createPlayerRoute(
    game,
    {
      name: "Invalid Origin",
      originPortId: wrongOrigin.id,
      destinationPortId: destination.id,
      shipIds: [game.fleet[0]!.id],
      fareMultiplier: 1,
      routingMode: "hyperspace",
    },
    generated.galaxy,
    generated.scenario.shipTypes,
  ), /基地/);
});

test("发动机类型约束超空间与曲率航路", () => {
  const generated = createGeneratedScenario(DEFAULT_GALAXY_CONFIG);
  const base = generated.galaxy.ports[0]!;
  const destination = generated.galaxy.ports[1]!;
  let game = createNewGame(DEFAULT_GALAXY_CONFIG, generated.galaxy, base.id);
  game = configureShipsForTest(game, [game.fleet[0]!.id], generated.scenario.shipTypes);
  assert.throws(() => createPlayerRoute(
    game,
    {
      name: "Unsupported Warp",
      originPortId: base.id,
      destinationPortId: destination.id,
      shipIds: [game.fleet[0]!.id],
      fareMultiplier: 1,
      routingMode: "warp",
    },
    generated.galaxy,
    generated.scenario.shipTypes,
  ), /曲率引擎/);

  game = buyShip(game, "arrow-express", generated.scenario.shipTypes).state;
  game = deliverAllOrdersForTest(game, generated.scenario.shipTypes);
  const arrow = game.fleet.find((ship) => ship.shipTypeId === "arrow-express")!;
  game = configureShipsForTest(game, [arrow.id], generated.scenario.shipTypes);
  game = createPlayerRoute(
    game,
    {
      name: "Direct Warp",
      originPortId: base.id,
      destinationPortId: destination.id,
      shipIds: [arrow.id],
      fareMultiplier: 1,
      routingMode: "warp",
    },
    generated.galaxy,
    generated.scenario.shipTypes,
  ).state;
  const arrowType = generated.scenario.shipTypes.find((ship) => ship.id === "arrow-express")!;
  const services = buildRouteServices(game.routes[0]!, arrowType, generated.galaxy.ports, gameWorldLegs(generated.galaxy));
  assert.ok(services.every((service) => service.modePath.every((mode) => mode === "warp")));
  assert.equal(services[0]!.destinationDwellHours, 4);
  assert.ok(services[0]!.sublightHours! > 0);
  assert.ok(services[0]!.departuresPerWeek < 7);
});

test("同速同推进方式的多艘船可共同增加航线班次", () => {
  const generated = createGeneratedScenario(DEFAULT_GALAXY_CONFIG);
  const base = generated.galaxy.ports[0]!;
  const destination = generated.galaxy.ports[1]!;
  let game = createNewGame(DEFAULT_GALAXY_CONFIG, generated.galaxy, base.id);
  game = buyShip(game, "meridian-liner", generated.scenario.shipTypes).state;
  game = deliverAllOrdersForTest(game, generated.scenario.shipTypes);
  const meridians = game.fleet.filter((ship) => ship.shipTypeId === "meridian-liner");
  game = configureShipsForTest(game, meridians.map((ship) => ship.id), generated.scenario.shipTypes);
  game = createPlayerRoute(game, {
    name: "Two Ship Corridor",
    originPortId: base.id,
    destinationPortId: destination.id,
    shipIds: meridians.map((ship) => ship.id),
    fareMultiplier: 1,
    routingMode: "hyperspace",
  }, generated.galaxy, generated.scenario.shipTypes).state;
  assert.equal(game.routes[0]!.assignedShips, 2);
  assert.ok(meridians.every((ship) => game.fleet.find((candidate) => candidate.id === ship.id)?.routeId === game.routes[0]!.id));
  const type = generated.scenario.shipTypes.find((ship) => ship.id === "meridian-liner")!;
  const twoShipServices = buildRouteServices(game.routes[0]!, type, generated.galaxy.ports, gameWorldLegs(generated.galaxy));
  const oneShipServices = buildRouteServices({ ...game.routes[0]!, assignedShips: 1 }, type, generated.galaxy.ports, gameWorldLegs(generated.galaxy));
  assert.equal(twoShipServices[0]!.departuresPerWeek, oneShipServices[0]!.departuresPerWeek * 2);
});

test("v0.6 同一航线允许兼容的不同船型并分别生成航班", () => {
  const generated = createGeneratedScenario(DEFAULT_GALAXY_CONFIG);
  const base = generated.galaxy.ports[0]!;
  const destination = generated.galaxy.ports[1]!;
  let game = createNewGame(DEFAULT_GALAXY_CONFIG, generated.galaxy, base.id);
  game = buyShip(game, "pioneer-regional", generated.scenario.shipTypes).state;
  game = buyShip(game, "arrow-express", generated.scenario.shipTypes).state;
  game = deliverAllOrdersForTest(game, generated.scenario.shipTypes);
  const warpShips = game.fleet.filter((ship) => ship.shipTypeId === "pioneer-regional" || ship.shipTypeId === "arrow-express");
  game = configureShipsForTest(game, warpShips.map((ship) => ship.id), generated.scenario.shipTypes);
  game = createPlayerRoute(game, {
    name: "Mixed Speed",
    originPortId: base.id,
    destinationPortId: destination.id,
    shipIds: warpShips.map((ship) => ship.id),
    fareMultiplier: 1,
    routingMode: "warp",
  }, generated.galaxy, generated.scenario.shipTypes).state;
  assert.equal(new Set(game.scheduledFlights.map((flight) => flight.shipTypeId)).size, 2);
  assert.ok(game.scheduledFlights.every((flight) => flight.departureMinute % 5 === 0 && flight.arrivalMinute % 5 === 0));
  assert.ok(game.scheduledFlights.every((flight) => flight.status !== "cancelled"));
});

test("五光年航段至少需要一天且船况不会改变速度", () => {
  const ports: Starport[] = ["a", "b"].map((id) => ({
    id, systemId: id, name: id, population: 50, economy: 50, business: 50,
    tourism: 50, administration: 50, portLevel: 4, dailyCapacity: 1_000,
    fuelPrice: 2, serviceFee: 100,
  }));
  const leg: WorldLeg = {
    id: "five-light-years", fromPortId: "a", toPortId: "b", mode: "hyperspace",
    distance: 5, hazard: 0, timeModifier: 1, fuelModifier: 1, isOpen: true,
  };
  const ship = PROOF_OF_CONCEPT_SCENARIO.shipTypes.find((candidate) => candidate.id === "aurora-clipper")!;
  const route: Route = {
    id: "minimum-time", companyId: "player", name: "Minimum Time", kind: "return",
    routingMode: "hyperspace",
    stops: ports.map((port) => ({ portId: port.id, stopType: "commercial" as const, minimumStopHours: 24 })),
    shipTypeId: ship.id, assignedShips: 1,
    pricing: { multiplier: 1, passengerClassMultiplier: { economy: 1, business: 1.35, premium: 2.1 } },
    maintenanceAllowanceHours: 0, active: true,
  };
  const pristine = buildRouteServices(route, ship, ports, [leg], { shipCondition: 100 });
  const worn = buildRouteServices(route, ship, ports, [leg], { shipCondition: 35 });
  assert.ok(pristine[0]!.inVehicleHours > 24);
  assert.equal(worn[0]!.inVehicleHours, pristine[0]!.inVehicleHours);
  assert.ok(worn[0]!.satisfactionByClass.premium < pristine[0]!.satisfactionByClass.premium);
});

test("不同旅客类型具有不同的速度与舒适度满意偏好", () => {
  const fastBasic = passengerSatisfactionByClass(50, 240, 45, 0.98, 90);
  const slowLuxury = passengerSatisfactionByClass(50, 480, 100, 0.98, 90);
  assert.ok(fastBasic.business > slowLuxury.business);
  assert.ok(slowLuxury.premium > fastBasic.premium);
});

test("船只累计损耗、强制停航并可完成定期维护", () => {
  const generated = createGeneratedScenario(DEFAULT_GALAXY_CONFIG);
  const base = generated.galaxy.ports[0]!;
  const destination = generated.galaxy.ports[3]!;
  let game = createNewGame(DEFAULT_GALAXY_CONFIG, generated.galaxy, base.id);
  game = setAutoMaintenanceThreshold(game, 30).state;
  game = configureShipsForTest(game, [game.fleet[0]!.id], generated.scenario.shipTypes);
  game = createPlayerRoute(
    game,
    {
      name: "Maintenance Run",
      originPortId: base.id,
      destinationPortId: destination.id,
      shipIds: [game.fleet[0]!.id],
      fareMultiplier: 1,
      routingMode: "hyperspace",
    },
    generated.galaxy,
    generated.scenario.shipTypes,
  ).state;
  while (shipMaintenanceState(game.fleet[0]!, game.day) === "ready") {
    game = advanceGameDay(game, generated.scenario, generated.galaxy).state;
  }
  assert.ok(game.fleet[0]!.condition < 100);
  assert.ok(game.fleet[0]!.flightHoursSinceMaintenance > 0);
  const maintenance = performShipMaintenance(game, game.fleet[0]!.id, generated.scenario.shipTypes);
  game = maintenance.state;
  assert.equal(shipMaintenanceState(game.fleet[0]!, game.day), "maintenance");
  const recoveryDay = game.fleet[0]!.maintenanceUntilDay!;
  while (game.day < recoveryDay) game = advanceGameDay(game, generated.scenario, generated.galaxy).state;
  assert.equal(shipMaintenanceState(game.fleet[0]!, game.day), "ready");
  assert.equal(game.fleet[0]!.condition, 100);
});

test("定期维护周期按高利用率下约半年校准", () => {
  assert.equal(MAINTENANCE_DUE_HOURS, 3_200);
  assert.equal(MAINTENANCE_REQUIRED_HOURS, 4_200);
  const ship = {
    id: "long-cycle",
    name: "Long Cycle",
    shipTypeId: "meridian-liner",
    routeId: null,
    condition: 100,
    flightHoursSinceMaintenance: MAINTENANCE_DUE_HOURS - 1,
    maintenanceUntilDay: null,
    configurationId: null,
    commissionedDay: 1,
    purchasePricePaid: 2_200_000,
  };
  assert.equal(shipMaintenanceState(ship, 180), "ready");
  assert.equal(shipMaintenanceState({ ...ship, flightHoursSinceMaintenance: MAINTENANCE_DUE_HOURS }, 180), "due");
  assert.equal(shipMaintenanceState({ ...ship, flightHoursSinceMaintenance: MAINTENANCE_REQUIRED_HOURS }, 180), "required");
});

test("船只到达玩家设定阈值后自动维修", () => {
  const generated = createGeneratedScenario(DEFAULT_GALAXY_CONFIG);
  const base = generated.galaxy.ports[0]!;
  const destination = generated.galaxy.ports[1]!;
  let game = createNewGame(DEFAULT_GALAXY_CONFIG, generated.galaxy, base.id);
  game = setAutoMaintenanceThreshold(game, 95).state;
  game = configureShipsForTest(game, [game.fleet[0]!.id], generated.scenario.shipTypes);
  game = createPlayerRoute(game, {
    name: "Automatic Maintenance", originPortId: base.id, destinationPortId: destination.id,
    shipIds: [game.fleet[0]!.id], fareMultiplier: 1, routingMode: "hyperspace",
  }, generated.galaxy, generated.scenario.shipTypes).state;
  game = advanceGameDay(game, generated.scenario, generated.galaxy).state;
  game = {
    ...game,
    fleet: game.fleet.map((ship) => ship.id === game.fleet[0]!.id ? { ...ship, condition: 94 } : ship),
  };
  assert.notEqual(shipMaintenanceState(game.fleet[0]!, game.day), "maintenance");
  const belowThresholdDay = game.day;
  for (let index = 0; index < 12 && shipMaintenanceState(game.fleet[0]!, game.day) !== "maintenance"; index += 1) {
    game = advanceGameDay(game, generated.scenario, generated.galaxy).state;
  }
  assert.equal(shipMaintenanceState(game.fleet[0]!, game.day), "maintenance");
  assert.ok(game.day > belowThresholdDay);
  assert.equal(game.fleet[0]!.condition, 100);
});

test("v0.5.2 统一燃料价格平时在 1–3 Cr 震荡并偶尔触及两端行情", () => {
  const generated = createGeneratedScenario({ ...DEFAULT_GALAXY_CONFIG, seed: "fuel-price-regimes" });
  const records = Array.from({ length: 480 }, (_, offset) =>
    fuelPriceRecord(generated.galaxy, offset + 1),
  );
  const prices = records.map((record) => record.price);
  const normalPrices = prices.filter((price) => price >= 1 && price <= 3);
  const maximumDailyChange = Math.max(...prices.slice(1).map((price, index) => Math.abs(price - prices[index]!)));
  const normalAboveTwoShare = normalPrices.filter((price) => price > 2).length / normalPrices.length;

  assert.ok(prices.every((price) => price >= 0.5 && price <= 6));
  assert.ok(normalPrices.length / prices.length > 0.9);
  assert.ok(normalAboveTwoShare >= 0.4 && normalAboveTwoShare <= 0.6);
  assert.ok(maximumDailyChange < 1.5);
  assert.ok(prices.some((price) => price <= 0.75));
  assert.ok(prices.some((price) => price >= 5));
  const game = createNewGame(DEFAULT_GALAXY_CONFIG, generated.galaxy, generated.galaxy.ports[0]!.id);
  const scenario = gameScenario(generated.scenario, generated.galaxy, game);
  assert.equal(new Set(scenario.ports.map((port) => port.fuelPrice)).size, 1);
});

test("v0.5.2 合约支付定金并按日交付，仓库与现货依次补足消耗", () => {
  const generated = createGeneratedScenario({ ...DEFAULT_GALAXY_CONFIG, seed: "fuel-storage" });
  const base = generated.galaxy.ports[0]!;
  const destination = generated.galaxy.ports[1]!;
  let game = createNewGame(DEFAULT_GALAXY_CONFIG, generated.galaxy, base.id, generated.scenario.shipTypes);
  game = configureShipsForTest(game, game.fleet.map((ship) => ship.id), generated.scenario.shipTypes);
  game = createPlayerRoute(
    game,
    {
      name: "Fuel Storage Route",
      originPortId: base.id,
      destinationPortId: destination.id,
      shipIds: [game.fleet[0]!.id],
      fareMultiplier: 1,
      routingMode: "hyperspace",
    },
    generated.galaxy,
    generated.scenario.shipTypes,
  ).state;
  game = setFuelWarehouseRental(game, true).state;
  game = buyFuelForWarehouse(game, 100).state;
  const quote = quoteFuelContract(game, 16, 100);
  const cashBefore = game.cash;
  game = signFuelContract(game, 16, 100).state;
  assert.equal(Number((cashBefore - game.cash).toFixed(2)), Number(quote.deposit.toFixed(2)));
  game = advanceGameDay(game, generated.scenario, generated.galaxy).state;

  assert.ok((game.history[0]!.fuelContractDeliveredUnits ?? 0) > 0);
  assert.ok((game.history[0]!.fuelContractInstallment ?? 0) > 0);
  assert.ok((game.history[0]!.fuelConsumedUnits ?? 0) > 0);
  assert.ok((game.history[0]!.fuelContractUsedUnits ?? 0) > 0);
  assert.ok((game.history[0]!.fuelWarehouseUsedUnits ?? 0) >= 0);
  assert.ok(game.fuelContracts[0]!.depositRemaining < quote.deposit);
  assert.ok(game.fuelWarehouse.quantity <= 100);
  assert.ok(Number.isFinite(game.cash));

  const remoteSettlement = simulateDay({
    markets: [],
    services: [service({
      id: "remote-fuel",
      companyId: "player",
      fromPortId: destination.id,
      toPortId: base.id,
      departuresPerWeek: 7,
      fuelConsumptionPerDepartureEmpty: 10,
      fuelConsumptionPerDepartureFull: 12,
      fuelMarketPrice: 6,
      fuelDeliveredUnitCost: 72,
      baseCostBreakdown: {
        fuel: 720, staff: 0, port: 0, flightMaintenance: 0,
        fixedMaintenance: 0, ageSurcharge: 0, depreciation: 0,
        delay: 0, other: 0, total: 720,
      },
    })],
    fuelInventorySupplies: [{
      companyId: "player",
      portId: base.id,
      availableUnits: 100,
      averageUnitCost: 12,
      useAtOrAbove: 3,
    }],
  }).services[0]!;
  assert.equal(remoteSettlement.inventoryFuelUnitsUsed, 0);
});

test("v0.5.2 自动签约按保留现货比例补齐且不会在低价期间重复堆叠", () => {
  const generated = createGeneratedScenario({ ...DEFAULT_GALAXY_CONFIG, seed: "fuel-auto-contract" });
  const base = generated.galaxy.ports[0]!;
  const destination = generated.galaxy.ports[1]!;
  let game = createNewGame(DEFAULT_GALAXY_CONFIG, generated.galaxy, base.id, generated.scenario.shipTypes);
  game = configureShipsForTest(game, game.fleet.map((ship) => ship.id), generated.scenario.shipTypes);
  game = createPlayerRoute(game, {
    name: "Automatic Fuel Contract Route", originPortId: base.id, destinationPortId: destination.id,
    shipIds: [game.fleet[0]!.id], fareMultiplier: 1, routingMode: "hyperspace",
  }, generated.galaxy, generated.scenario.shipTypes).state;
  game = setFuelAutoContractPolicy(game, {
    enabled: true, triggerPrice: 6, termWeeks: 8, spotExposureShare: 0,
  }).state;
  game = advanceGameDay(game, generated.scenario, generated.galaxy).state;
  assert.equal(game.fuelContracts.length, 1);
  const firstWeeklyUnits = game.fuelContracts[0]!.weeklyUnits;
  game = advanceGameDay(game, generated.scenario, generated.galaxy).state;
  assert.equal(game.fuelContracts.length, 1);
  assert.equal(game.fuelContracts[0]!.weeklyUnits, firstWeeklyUnits);
});

test("v0.5.2 提前解约没收未摊销定金并收取高额违约金", () => {
  const generated = createGeneratedScenario({ ...DEFAULT_GALAXY_CONFIG, seed: "fuel-contract-cancel" });
  let game = createNewGame(DEFAULT_GALAXY_CONFIG, generated.galaxy, generated.galaxy.ports[0]!.id);
  game = signFuelContract(game, 16, 100).state;
  const cashBeforeCancellation = game.cash;
  const depositRemaining = game.fuelContracts[0]!.depositRemaining;
  game = cancelFuelContract(game, game.fuelContracts[0]!.id).state;
  assert.ok(game.cash < cashBeforeCancellation);
  assert.ok(game.fuelContracts[0]!.cancellationFee > depositRemaining);
  assert.equal(game.fuelContracts[0]!.depositRemaining, 0);
  assert.equal(game.fuelContracts[0]!.cancelledOnDay, game.day);
});

test("燃料市场价格逐日变化并保留历史", () => {
  const generated = createGeneratedScenario(DEFAULT_GALAXY_CONFIG);
  let game = createNewGame(DEFAULT_GALAXY_CONFIG, generated.galaxy, generated.galaxy.ports[0]!.id);
  const first = fuelPriceRecord(generated.galaxy, 1);
  for (let day = 0; day < 8; day += 1) {
    game = advanceGameDay(game, generated.scenario, generated.galaxy).state;
  }
  assert.equal(game.fuelMarket.length, 9);
  assert.notEqual(game.fuelMarket.at(-1)!.price, first.price);
});

test("完成初级目标后仍可继续经营", () => {
  const generated = createGeneratedScenario(DEFAULT_GALAXY_CONFIG);
  const [base, destination] = generated.galaxy.ports;
  assert.ok(base);
  assert.ok(destination);
  let game = createNewGame(DEFAULT_GALAXY_CONFIG, generated.galaxy, base.id);
  game = configureShipsForTest(game, [game.fleet[0]!.id], generated.scenario.shipTypes);
  game = createPlayerRoute(
    game,
    {
      name: "Profitable Corridor",
      originPortId: base.id,
      destinationPortId: destination.id,
      shipIds: [game.fleet[0]!.id],
      fareMultiplier: 1,
      routingMode: "hyperspace",
    },
    generated.galaxy,
    generated.scenario.shipTypes,
  ).state;

  while (game.primaryGoalCompletedOnDay === null && game.status === "playing") {
    const maintenance = shipMaintenanceState(game.fleet[0]!, game.day);
    if (maintenance === "due" || maintenance === "required") {
      game = performShipMaintenance(game, game.fleet[0]!.id, generated.scenario.shipTypes).state;
    }
    game = advanceGameDay(game, generated.scenario, generated.galaxy).state;
  }
  assert.equal(game.status, "playing");
  assert.ok(game.primaryGoalCompletedOnDay !== null);
  const completedOnDay = game.primaryGoalCompletedOnDay;
  game = advanceGameDay(game, generated.scenario, generated.galaxy).state;
  assert.equal(game.status, "playing");
  assert.equal(game.primaryGoalCompletedOnDay, completedOnDay);
});

test("v0.6 航班计划确定性、五分钟粒度并遵守星港硬容量", () => {
  const ship = { ...PROOF_OF_CONCEPT_SCENARIO.shipTypes.find((candidate) => candidate.id === "aurora-clipper")!, minimumPortLevel: 1 as const };
  const ports: Starport[] = ["a", "b"].map((id) => ({
    id, systemId: id, name: id, population: 10, economy: 50, business: 50,
    tourism: 50, administration: 50, portLevel: 1, dailyCapacity: 1_000,
    fuelPrice: 2, serviceFee: 50,
  }));
  const route: Route = {
    id: "capacity-test", companyId: "player", name: "Capacity", kind: "return",
    routingMode: "hyperspace", stops: ports.map((port) => ({ portId: port.id, stopType: "commercial" as const, minimumStopHours: 0 })),
    shipTypeId: ship.id, assignedShips: 50,
    cabinCapacityByClass: { economy: 20, business: 0, premium: 0 },
    pricing: { multiplier: 1, passengerClassMultiplier: { economy: 1, business: 1, premium: 1 } },
    maintenanceAllowanceHours: 0, active: true, weeklyDepartureMinutes: [3 * 1_440],
  };
  const leg: WorldLeg = { id: "a-b", fromPortId: "a", toPortId: "b", mode: "hyperspace", distance: 5, hazard: .3, timeModifier: 1, fuelModifier: 1, isOpen: true };
  const ships = Array.from({ length: 50 }, (_, index) => ({ id: `s${index}`, shipTypeId: ship.id, routeId: route.id, condition: 75, cabins: { economy: 20, business: 0, premium: 0 } }));
  const input = { seed: "v06", startDay: 3, numberOfDays: 3, routes: [route], ships, shipTypes: [ship], ports, worldLegs: [leg] };
  const first = generateFlightSchedule(input);
  const second = generateFlightSchedule(input);
  assert.deepEqual(first, second);
  assert.ok(first.flights.every((flight) => flight.departureMinute % 5 === 0 && flight.arrivalMinute % 5 === 0));
  assert.ok(first.starportCapacity.every((entry) => entry.used <= entry.capacity));
  assert.ok(first.starportCapacity.every((entry) => entry.slots.every((slot) => slot.used <= slot.capacity)));
  assert.equal(starportMovementCapacity(ports[0]!), 12);
  assert.ok(first.flights.some((flight) => flight.status === "cancelled"));
  assert.ok(first.shipLogs.some((entry) => entry.kind === "cancelled"));
});

test("v0.6 实体空间采用加速滑行减速，比冲决定燃料消耗且目标速度受制动距离限制", () => {
  const ship = PROOF_OF_CONCEPT_SCENARIO.shipTypes.find((candidate) => candidate.id === "meridian-liner")!;
  const cabins = { economy: 80, business: 10, premium: 2 };
  const distance = deterministicExitDistanceKm("sol-test", "hyperspace");
  assert.equal(distance, deterministicExitDistanceKm("sol-test", "hyperspace"));
  assert.notEqual(distance, deterministicExitDistanceKm("sol-test", "warp"));
  const transit = estimateSublightTransit(ship, distance, cabins, 20, 1_000, .8);
  assert.ok(transit.accelerationHours > 0 && transit.decelerationHours > 0);
  assert.ok(transit.coastHours >= 0);
  assert.ok(Math.abs(transit.totalHours - transit.accelerationHours - transit.coastHours - transit.decelerationHours) < 1e-9);
  assert.ok(Math.abs(transit.burnSeconds - (transit.accelerationHours + transit.decelerationHours) * 3_600) < 1e-6);
  assert.ok(transit.peakSpeedKmPerSecond <= transit.maximumReachableSpeedKmPerSecond);
  assert.ok(transit.peakSpeedKmPerSecond <= ship.maximumSublightSpeedKmPerSecond!);
  const heavier = estimateSublightTransit({ ...ship, structuralMassTonnes: ship.structuralMassTonnes * 2 }, distance, cabins, 20, 50, .8);
  assert.ok(heavier.fuelUnits > estimateSublightTransit(ship, distance, cabins, 20, 50, .8).fuelUnits);
});

test("v0.6 星际效率按船重与携带燃料质量计算，控制概率及赔付边界严格匹配规格", () => {
  const ship = PROOF_OF_CONCEPT_SCENARIO.shipTypes.find((candidate) => candidate.id === "arrow-express")!;
  const cabins = { economy: 40, business: 2, premium: 0 };
  const light = estimateInterstellarFuel(ship, "warp", 20, cabins, .82);
  const heavy = estimateInterstellarFuel({ ...ship, structuralMassTonnes: ship.structuralMassTonnes * 1.5 }, "warp", 20, cabins, .82);
  assert.ok(heavy.fuelUnits > light.fuelUnits);
  assert.equal(starportControlDelayProbability(0), .02);
  assert.ok(Math.abs(starportControlDelayProbability(1) - .2) < 1e-12);
  assert.equal(flightCompensationRate(240, false), 0);
  assert.equal(flightCompensationRate(241, false), .1);
  assert.equal(flightCompensationRate(721, false), .25);
  assert.equal(flightCompensationRate(0, true), 1);
});

test("v0.6 已确认长期时隙优先于后申请航线，容量逐时段硬约束", () => {
  const ship = { ...PROOF_OF_CONCEPT_SCENARIO.shipTypes.find((candidate) => candidate.id === "aurora-clipper")!, minimumPortLevel: 1 as const };
  const ports: Starport[] = ["a", "b"].map((id) => ({ id, systemId: id, name: id, population: 10, economy: 50, business: 50, tourism: 50, administration: 50, portLevel: 1, dailyCapacity: 1_000, fuelPrice: 2, serviceFee: 50, hyperspaceExitDistanceKm: 500_000, warpExitDistanceKm: 500_000 }));
  const baseRoute: Route = { id: "new", companyId: "player", name: "New", kind: "return", routingMode: "hyperspace", stops: ports.map((port) => ({ portId: port.id, stopType: "commercial" as const, minimumStopHours: 0 })), shipTypeId: ship.id, assignedShips: 16, cabinCapacityByClass: { economy: 20, business: 0, premium: 0 }, pricing: { multiplier: 1, passengerClassMultiplier: { economy: 1, business: 1, premium: 1 } }, maintenanceAllowanceHours: 0, active: true, weeklyDepartureMinutes: [3 * 1_440], slotApplicationDay: 3 };
  const confirmed = { ...baseRoute, id: "confirmed", name: "Confirmed", confirmedLongTermSlots: true };
  const ships = [baseRoute, confirmed].flatMap((route) => Array.from({ length: 16 }, (_, index) => ({ id: `${route.id}-${index}`, shipTypeId: ship.id, routeId: route.id, condition: 90, cabins: { economy: 20, business: 0, premium: 0 } })));
  const leg: WorldLeg = { id: "a-b", fromPortId: "a", toPortId: "b", mode: "hyperspace", distance: 5, hazard: .2, timeModifier: 1, fuelModifier: 1, isOpen: true };
  const result = generateFlightSchedule({ seed: "priority", startDay: 3, numberOfDays: 3, routes: [baseRoute, confirmed], ships, shipTypes: [ship], ports, worldLegs: [leg], basePortId: "a" });
  const confirmedOperated = result.flights.filter((flight) => flight.routeId === confirmed.id && flight.status !== "cancelled").length;
  const newOperated = result.flights.filter((flight) => flight.routeId === baseRoute.id && flight.status !== "cancelled").length;
  assert.ok(confirmedOperated >= newOperated);
  assert.ok(result.starportCapacity.every((day) => day.slots.every((slot) => slot.used <= slot.capacity)));
});

test("v0.6 五类延误原因都能记录，连锁晚点进入后续轮转", () => {
  const ship = { ...PROOF_OF_CONCEPT_SCENARIO.shipTypes.find((candidate) => candidate.id === "aurora-clipper")!, minimumPortLevel: 1 as const };
  const ports: Starport[] = ["a", "b"].map((id) => ({ id, systemId: id, name: id, population: 10, economy: 50, business: 50, tourism: 50, administration: 50, portLevel: 5, dailyCapacity: 1_000, fuelPrice: 2, serviceFee: 50, hyperspaceExitDistanceKm: 500_000, warpExitDistanceKm: 500_000 }));
  const route: Route = { id: "delays", companyId: "player", name: "Delays", kind: "return", routingMode: "hyperspace", stops: ports.map((port) => ({ portId: port.id, stopType: "commercial" as const, minimumStopHours: 0 })), shipTypeId: ship.id, assignedShips: 50, cabinCapacityByClass: { economy: 20, business: 0, premium: 0 }, pricing: { multiplier: 1, passengerClassMultiplier: { economy: 1, business: 1, premium: 1 } }, maintenanceAllowanceHours: 0, scheduleBufferMinutes: 0, active: true };
  const ships = Array.from({ length: 50 }, (_, index) => ({ id: `delay-${index}`, shipTypeId: ship.id, routeId: route.id, condition: 50, commissionedDay: 1, flightHoursSinceMaintenance: 3_800, maintenanceState: "due" as const, cabins: { economy: 20, business: 0, premium: 0 } }));
  const leg: WorldLeg = { id: "a-b", fromPortId: "a", toPortId: "b", mode: "hyperspace", distance: 5, hazard: 1, timeModifier: 1, fuelModifier: 1, isOpen: true };
  const result = generateFlightSchedule({ seed: "all-delay-reasons", startDay: 20, numberOfDays: 30, routes: [route], ships, shipTypes: [ship], ports, worldLegs: [leg], basePortId: "a" });
  const reasons = new Set(result.flights.flatMap((flight) => flight.delayReasons));
  assert.deepEqual([...reasons].sort(), ["ground-turnaround", "knock-on", "route-environment", "starport-control", "technical"]);
});

test("v0.6 备用池自动替代高风险执行船，投资会提升星港硬容量", () => {
  const generated = createGeneratedScenario(DEFAULT_GALAXY_CONFIG);
  const types = generated.scenario.shipTypes;
  const base = generated.galaxy.ports[0]!;
  const destination = generated.galaxy.ports[1]!;
  let game = createNewGame(DEFAULT_GALAXY_CONFIG, generated.galaxy, base.id, types);
  game = buyShip(game, "meridian-liner", types).state;
  game = deliverAllOrdersForTest(game, types);
  game = configureShipsForTest(game, game.fleet.map((ship) => ship.id), types);
  game = createPlayerRoute(game, { name: "Reserve Test", originPortId: base.id, destinationPortId: destination.id, shipIds: [game.fleet[0]!.id], fareMultiplier: 1, routingMode: "hyperspace" }, generated.galaxy, types).state;
  const reserve = game.fleet.find((ship) => ship.routeId === null)!;
  game = setShipReserveRoute(game, reserve.id, game.routes[0]!.id, types).state;
  game = { ...game, fleet: game.fleet.map((ship) => ship.routeId === game.routes[0]!.id ? { ...ship, condition: 50 } : ship) };
  const substituted = buildGameSchedule(game, generated.galaxy, types, 7);
  assert.ok(substituted.flights.some((flight) => flight.replacementShipId === reserve.id && !!flight.originalShipId));
  const before = buildGameSchedule(game, generated.galaxy, types, 7).starportCapacity.find((entry) => entry.portId === base.id)!.capacity;
  game = investInStarportCapacity(game, base.id, generated.galaxy, types).state;
  const after = game.starportCapacity.find((entry) => entry.portId === base.id)!.capacity;
  assert.ok(after > before);
});

test("v0.6 巡航速度同时改变燃料、航时、磨损、班次和利润", () => {
  const ship = PROOF_OF_CONCEPT_SCENARIO.shipTypes.find((candidate) => candidate.id === "meridian-liner")!;
  const cabins = { economy: 80, business: 12, premium: 4 };
  assert.equal(fuelMultiplierAtCruiseRatio(ship.fuelOptimalCruiseRatio!, ship.fuelOptimalCruiseRatio!), 1);
  const curve = buildSpeedEconomicsCurve(ship, 60, "hyperspace", cabins, 80_000);
  const slow = curve.points[0]!;
  const fast = curve.points.at(-1)!;
  assert.ok(fast.travelHours < slow.travelHours);
  assert.notEqual(fast.fuelUnits, slow.fuelUnits);
  assert.notEqual(fast.maintenanceCost, slow.maintenanceCost);
  assert.ok(fast.departuresPerWeek > slow.departuresPerWeek);
  assert.notEqual(fast.projectedProfit, slow.projectedProfit);
  assert.ok(new Set([curve.fuelOptimalRatio, curve.costOptimalRatio, curve.profitOptimalRatio]).size >= 2);
  assert.equal(roundToFiveMinutes(12), 10);
});

test("v0.6 动态调船等待当前轮转且日结生成事件化财务记录", () => {
  const generated = createGeneratedScenario(DEFAULT_GALAXY_CONFIG);
  const base = generated.galaxy.ports[0]!;
  const destination = generated.galaxy.ports[1]!;
  let game = createNewGame(DEFAULT_GALAXY_CONFIG, generated.galaxy, base.id, generated.scenario.shipTypes);
  game = configureShipsForTest(game, [game.fleet[0]!.id], generated.scenario.shipTypes);
  game = createPlayerRoute(game, { name: "Event Accounting", originPortId: base.id, destinationPortId: destination.id, shipIds: [game.fleet[0]!.id], fareMultiplier: 1, routingMode: "hyperspace" }, generated.galaxy, generated.scenario.shipTypes).state;
  const change = requestRouteFleetChange(game, game.fleet[0]!.id, null, generated.scenario.shipTypes);
  assert.ok(change.state.pendingFleetChanges[0]!.effectiveDay > game.day);
  assert.equal(change.state.fleet[0]!.routeId, game.routes[0]!.id);
  game = advanceGameDay(game, generated.scenario, generated.galaxy).state;
  const record = game.history.at(-1)!;
  assert.ok((record.flightsOperated ?? 0) > 0);
  assert.ok(record.financialEvents?.some((event) => event.kind === "ticket-revenue"));
  assert.ok(record.financialEvents?.some((event) => event.kind === "fuel-purchase"));
  assert.ok(record.financialEvents?.some((event) => event.kind === "crew-payroll"));
});

test("v0.6 跨日航班保留已承诺时隙且同一舰船不会重复占用", () => {
  const generated = createGeneratedScenario(DEFAULT_GALAXY_CONFIG);
  const types = generated.scenario.shipTypes;
  const base = generated.galaxy.ports[0]!;
  const destination = generated.galaxy.ports.at(-1)!;
  let game = createNewGame(DEFAULT_GALAXY_CONFIG, generated.galaxy, base.id, types);
  game = configureShipsForTest(game, [game.fleet[0]!.id], types);
  game = createPlayerRoute(game, { name: "Long Rotation", originPortId: base.id, destinationPortId: destination.id, shipIds: [game.fleet[0]!.id], fareMultiplier: 1, routingMode: "hyperspace" }, generated.galaxy, types).state;
  const first = game.scheduledFlights.find((flight) => flight.shipId === game.fleet[0]!.id && flight.status !== "cancelled")!;
  game = advanceGameDay(game, generated.scenario, generated.galaxy).state;
  if (first.arrivalMinute >= game.day * 1_440) {
    assert.ok(game.scheduledFlights.some((flight) => flight.id === first.id));
    const overlaps = game.scheduledFlights.filter((flight) => flight.shipId === first.shipId && flight.id !== first.id && flight.departureMinute < first.arrivalMinute);
    assert.equal(overlaps.length, 0);
  }
});

test("v0.6 日结后保留最近七日真实航班供星港历史查询", () => {
  const generated = createGeneratedScenario(DEFAULT_GALAXY_CONFIG);
  const types = generated.scenario.shipTypes;
  const base = generated.galaxy.ports[0]!;
  const destination = generated.galaxy.ports[1]!;
  let game = createNewGame(DEFAULT_GALAXY_CONFIG, generated.galaxy, base.id, types);
  game = configureShipsForTest(game, [game.fleet[0]!.id], types);
  game = createPlayerRoute(game, { name: "History", originPortId: base.id, destinationPortId: destination.id, shipIds: [game.fleet[0]!.id], fareMultiplier: 1, routingMode: "hyperspace" }, generated.galaxy, types).state;
  const completedDay = game.day;
  const completedFlightIds = game.scheduledFlights
    .filter((flight) => flight.companyId === "player" && Math.floor(flight.departureMinute / 1_440) === completedDay)
    .map((flight) => flight.id);
  assert.ok(completedFlightIds.length > 0);
  game = advanceGameDay(game, generated.scenario, generated.galaxy).state;
  assert.ok(completedFlightIds.every((id) => game.scheduledFlights.some((flight) => flight.id === id)));
  assert.ok(game.scheduledFlights.some((flight) => flight.departureMinute < game.day * 1_440));
});

test("v0.6 手工替换老船且双向价格默认联动", () => {
  const generated = createGeneratedScenario(DEFAULT_GALAXY_CONFIG);
  const types = generated.scenario.shipTypes;
  const base = generated.galaxy.ports[0]!;
  const destination = generated.galaxy.ports[1]!;
  let game = createNewGame(DEFAULT_GALAXY_CONFIG, generated.galaxy, base.id, types);
  game = configureShipsForTest(game, [game.fleet[0]!.id], types);
  game = createPlayerRoute(game, { name: "Replacement", originPortId: base.id, destinationPortId: destination.id, shipIds: [game.fleet[0]!.id], fareMultiplier: 1, routingMode: "hyperspace" }, generated.galaxy, types).state;
  const routeId = game.routes[0]!.id;
  game = setRouteDirectionalFares(game, routeId, "outbound", { economy: 111, business: 222, premium: 333 }).state;
  assert.deepEqual(game.routes[0]!.pricing.directionalFareByClass!.return, { economy: 111, business: 222, premium: 333 });
  game = setRouteDirectionalPricingLinked(game, routeId, false).state;
  game = setRouteDirectionalFares(game, routeId, "return", { economy: 99, business: 199, premium: 299 }).state;
  assert.notDeepEqual(game.routes[0]!.pricing.directionalFareByClass!.outbound, game.routes[0]!.pricing.directionalFareByClass!.return);
  let preorder = placeShipPurchaseAgreement({ ...game, cash: 10_000_000 }, [{ shipTypeId: "meridian-liner", quantity: 1, targetRouteId: routeId }], types).state;
  assert.equal(preorder.shipPurchaseOrders.at(-1)!.targetRouteId, routeId);
  const deliveryDay = preorder.shipPurchaseOrders.at(-1)!.deliveryDay;
  preorder = deliverShipPurchaseOrders({ ...preorder, day: deliveryDay }, types, deliveryDay).state;
  const delivered = preorder.fleet.find((ship) => ship.plannedRouteId === routeId)!;
  preorder = configureShipCabins(preorder, delivered.id, { economy: types.find((type) => type.id === delivered.shipTypeId)!.cabinSpace, business: 0, premium: 0 }, types).state;
  assert.equal(preorder.fleet.find((ship) => ship.id === delivered.id)!.routeId, routeId);
  game = orderShipReplacement(game, game.fleet[0]!.id, types).state;
  assert.deepEqual(game.shipPurchaseOrders.at(-1)!.replacementShipIds, [game.fleet[0]!.id]);
  assert.equal(game.shipPurchaseOrders.at(-1)!.targetRouteId, routeId);
});
