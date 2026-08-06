import assert from "node:assert/strict";
import test from "node:test";
import {
  buildJourneyOptions,
  buildRouteServices,
  assignShipsToFleetConfiguration,
  buyShip,
  chooseJourneys,
  createGeneratedGameEvents,
  createGeneratedScenario,
  createFleetConfiguration,
  createNewGame,
  createPlayerRoute,
  CHINESE_SYSTEM_NAMES,
  DEFAULT_GALAXY_CONFIG,
  DAILY_COMPANY_OVERHEAD,
  EMERGENCY_FUEL_MARGIN,
  deterministicVariation,
  eventIntensity,
  generateMarketDemands,
  marketEventDemandMultiplier,
  generateGalaxy,
  gameWorldLegs,
  fuelPriceRecord,
  estimateFuelConsumption,
  fleetConfigurationForShip,
  fleetFixedMaintenanceCost,
  performShipMaintenance,
  passengerSatisfactionByClass,
  PROOF_OF_CONCEPT_SCENARIO,
  simulateCampaign,
  shortestReferenceTime,
  simulateDay,
  shipMaintenanceState,
  MAINTENANCE_DUE_HOURS,
  MAINTENANCE_REQUIRED_HOURS,
  setAutoMaintenanceThreshold,
  updateFleetConfiguration,
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

test("中文行星系名称库包含 500 个不重复名称", () => {
  assert.equal(CHINESE_SYSTEM_NAMES.length, 500);
  assert.equal(new Set(CHINESE_SYSTEM_NAMES).size, 500);
  assert.ok(CHINESE_SYSTEM_NAMES.every((name) => /^[\p{Script=Han}]+$/u.test(name)));
});

function market(passengerClass: PassengerClass, potentialPassengers = 1_000): MarketDemand {
  return {
    originPortId: "a",
    destinationPortId: "c",
    passengerClass,
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
    fareByClass: overrides.fareByClass ?? { economy: 120, business: 160, premium: 240 },
    comfort: overrides.comfort ?? 70,
    reputation: overrides.reputation ?? 70,
    onTimeRate: overrides.onTimeRate ?? 0.95,
    satisfactionByClass: overrides.satisfactionByClass ?? { economy: 75, business: 75, premium: 75 },
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
    );
    const choice = chooseJourneys(targetMarket, options);
    const directOption = options.find((option) => option.serviceLegIds[0] === "direct")!;
    const totalRequested = [...choice.requestedByOption.values()].reduce(
      (sum, value) => sum + value,
      0,
    );
    return choice.requestedByOption.get(directOption.id)! / totalRequested;
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
  const settlement = simulateDay({ markets, services: [aToB, dToB, shared] });
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

test("舰船支持批量购买且以空舱交付，舱位严格遵守 6:3:1 空间占用", () => {
  const generated = createGeneratedScenario(DEFAULT_GALAXY_CONFIG);
  const base = generated.galaxy.ports[0]!;
  let game = createNewGame(DEFAULT_GALAXY_CONFIG, generated.galaxy, base.id);
  const shuttle = generated.scenario.shipTypes.find((ship) => ship.id === "sparrow-shuttle")!;
  const startingCash = game.cash;
  game = buyShip(game, shuttle.id, generated.scenario.shipTypes, 3).state;
  const purchased = game.fleet.filter((ship) => ship.shipTypeId === shuttle.id);

  assert.equal(purchased.length, 3);
  assert.equal(game.cash, startingCash - shuttle.purchasePrice * 3);
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

test("燃料曲线自动加入20%应急裕度并响应载客质量和航程错配", () => {
  const baseType = PROOF_OF_CONCEPT_SCENARIO.shipTypes.find((ship) => ship.id === "arrow-express")!;
  const cabins = { premium: 0, business: 0, economy: baseType.cabinSpace };
  const shortRange = estimateFuelConsumption(baseType, "warp", 10, cabins, 0);
  const loaded = estimateFuelConsumption(baseType, "warp", 10, cabins, baseType.cabinSpace);
  const excessiveRange = estimateFuelConsumption(
    { ...baseType, maxRangeByMode: { ...baseType.maxRangeByMode, warp: 1_000 } },
    "warp",
    10,
    cabins,
    0,
  );

  assert.ok(loaded.fuelUnits > shortRange.fuelUnits);
  assert.equal(shortRange.emergencyReserveUnits, Number((shortRange.fuelUnits * EMERGENCY_FUEL_MARGIN).toFixed(4)));
  assert.equal(shortRange.requiredFuelLoadUnits, Number((shortRange.fuelUnits * (1 + EMERGENCY_FUEL_MARGIN)).toFixed(4)));
  assert.ok(loaded.carriedFuelMassTonnes > shortRange.carriedFuelMassTonnes);
  assert.ok(loaded.fuelCapacityUtilization > shortRange.fuelCapacityUtilization);
  assert.ok(excessiveRange.rangeMismatchMultiplier > shortRange.rangeMismatchMultiplier);
  assert.ok(excessiveRange.fuelUnits > shortRange.fuelUnits * 1.4);
});

test("固定维护费按供应商与系列规模折扣乘算叠加并进入日结算", () => {
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
  assert.equal(game.history[0]!.overhead, DAILY_COMPANY_OVERHEAD + starterMaintenance);
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
  assert.equal(service.dailySeatCapacityByClass!.business, service.dailySeatCapacityByClass!.premium * 2);
  assert.equal(service.dailySeatCapacityByClass!.economy, service.dailySeatCapacityByClass!.premium * 6);
});

test("超空间船整体快于曲率船，亚光速指数会改变星港周转", () => {
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
  const slow = buildRouteServices(route, { ...baseType, speedByMode: { ...baseType.speedByMode, sublight: 0.5 } }, ports, [leg]);
  const fast = buildRouteServices(route, { ...baseType, speedByMode: { ...baseType.speedByMode, sublight: 2 } }, ports, [leg]);
  assert.ok(fast[0]!.destinationDwellHours < slow[0]!.destinationDwellHours);
  assert.ok(fast[0]!.departuresPerWeek > slow[0]!.departuresPerWeek);
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
  assert.equal(game.fleet.length, 2);
  assert.equal(game.cash, initialCash - yacht.purchasePrice);

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
  assert.equal(game.routes.length, 0);
  assert.equal(game.fleet[0]!.routeId, null);
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
  assert.equal(services[0]!.destinationDwellHours, 4 + 12 / arrowType.speedByMode.sublight!);
  assert.ok(services[0]!.departuresPerWeek < 7);
});

test("同速同推进方式的多艘船可共同增加航线班次", () => {
  const generated = createGeneratedScenario(DEFAULT_GALAXY_CONFIG);
  const base = generated.galaxy.ports[0]!;
  const destination = generated.galaxy.ports[1]!;
  let game = createNewGame(DEFAULT_GALAXY_CONFIG, generated.galaxy, base.id);
  game = buyShip(game, "meridian-liner", generated.scenario.shipTypes).state;
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

test("同一航线拒绝不同船型的组合", () => {
  const generated = createGeneratedScenario(DEFAULT_GALAXY_CONFIG);
  const base = generated.galaxy.ports[0]!;
  const destination = generated.galaxy.ports[1]!;
  let game = createNewGame(DEFAULT_GALAXY_CONFIG, generated.galaxy, base.id);
  game = buyShip(game, "pioneer-regional", generated.scenario.shipTypes).state;
  game = buyShip(game, "arrow-express", generated.scenario.shipTypes).state;
  const warpShips = game.fleet.filter((ship) => ship.shipTypeId === "pioneer-regional" || ship.shipTypeId === "arrow-express");
  game = configureShipsForTest(game, warpShips.map((ship) => ship.id), generated.scenario.shipTypes);
  assert.throws(() => createPlayerRoute(game, {
    name: "Mixed Speed",
    originPortId: base.id,
    destinationPortId: destination.id,
    shipIds: warpShips.map((ship) => ship.id),
    fareMultiplier: 1,
    routingMode: "warp",
  }, generated.galaxy, generated.scenario.shipTypes), /相同船型/);
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
  assert.equal(pristine[0]!.inVehicleHours, 24);
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

test("燃料市场价格逐日变化并保留历史", () => {
  const generated = createGeneratedScenario(DEFAULT_GALAXY_CONFIG);
  let game = createNewGame(DEFAULT_GALAXY_CONFIG, generated.galaxy, generated.galaxy.ports[0]!.id);
  const first = fuelPriceRecord(generated.galaxy, 1);
  for (let day = 0; day < 8; day += 1) {
    game = advanceGameDay(game, generated.scenario, generated.galaxy).state;
  }
  assert.equal(game.fuelMarket.length, 9);
  const portId = generated.galaxy.ports[0]!.id;
  assert.notEqual(game.fuelMarket.at(-1)!.prices[portId], first.prices[portId]);
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
