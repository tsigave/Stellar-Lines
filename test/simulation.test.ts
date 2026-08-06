import assert from "node:assert/strict";
import test from "node:test";
import {
  buildJourneyOptions,
  buildRouteServices,
  buyShip,
  chooseJourneys,
  createGeneratedGameEvents,
  createGeneratedScenario,
  createNewGame,
  createPlayerRoute,
  DEFAULT_GALAXY_CONFIG,
  deterministicVariation,
  eventIntensity,
  generateMarketDemands,
  marketEventDemandMultiplier,
  generateGalaxy,
  gameWorldLegs,
  fuelPriceRecord,
  performShipMaintenance,
  passengerSatisfactionByClass,
  PROOF_OF_CONCEPT_SCENARIO,
  simulateCampaign,
  shortestReferenceTime,
  simulateDay,
  shipMaintenanceState,
  setAutoMaintenanceThreshold,
  advanceGameDay,
  closePlayerRoute,
  type MarketDemand,
  type MarketEvent,
  type GalaxyGenerationConfig,
  type PassengerClass,
  type Route,
  type ServiceLeg,
  type ShipType,
  type Starport,
  type WorldLeg,
} from "../src/index.js";

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

test("概念验证场景包含20个星港、6种船型且所有航线有效", () => {
  assert.equal(PROOF_OF_CONCEPT_SCENARIO.ports.length, 20);
  assert.equal(PROOF_OF_CONCEPT_SCENARIO.shipTypes.length, 6);

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
  const origin = generated.galaxy.ports[0]!;
  const destination = generated.galaxy.ports[1]!;
  const opened = createPlayerRoute(
    game,
    {
      name: "First Corridor",
      originPortId: origin.id,
      destinationPortId: destination.id,
      shipId: game.fleet[0]!.id,
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
  const [origin, destination] = generated.galaxy.ports;
  assert.ok(origin && destination);
  game = createPlayerRoute(
    game,
    {
      name: "Deep Corridor",
      originPortId: origin.id,
      destinationPortId: destination.id,
      shipId: game.fleet[0]!.id,
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
      shipId: game.fleet[0]!.id,
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
  assert.throws(() => createPlayerRoute(
    game,
    {
      name: "Unsupported Warp",
      originPortId: base.id,
      destinationPortId: destination.id,
      shipId: game.fleet[0]!.id,
      fareMultiplier: 1,
      routingMode: "warp",
    },
    generated.galaxy,
    generated.scenario.shipTypes,
  ), /曲率引擎/);

  game = buyShip(game, "arrow-express", generated.scenario.shipTypes).state;
  const arrow = game.fleet.find((ship) => ship.shipTypeId === "arrow-express")!;
  game = createPlayerRoute(
    game,
    {
      name: "Direct Warp",
      originPortId: base.id,
      destinationPortId: destination.id,
      shipId: arrow.id,
      fareMultiplier: 1,
      routingMode: "warp",
    },
    generated.galaxy,
    generated.scenario.shipTypes,
  ).state;
  const arrowType = generated.scenario.shipTypes.find((ship) => ship.id === "arrow-express")!;
  const services = buildRouteServices(game.routes[0]!, arrowType, generated.galaxy.ports, gameWorldLegs(generated.galaxy));
  assert.ok(services.every((service) => service.modePath.every((mode) => mode === "warp")));
  assert.ok(services[0]!.destinationDwellHours >= 24);
  assert.ok(services[0]!.departuresPerWeek < 7);
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
  const ship = PROOF_OF_CONCEPT_SCENARIO.shipTypes.find((candidate) => candidate.id === "celestial-yacht")!;
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
  game = createPlayerRoute(
    game,
    {
      name: "Maintenance Run",
      originPortId: base.id,
      destinationPortId: destination.id,
      shipId: game.fleet[0]!.id,
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

test("船只到达玩家设定阈值后自动维修", () => {
  const generated = createGeneratedScenario(DEFAULT_GALAXY_CONFIG);
  const base = generated.galaxy.ports[0]!;
  const destination = generated.galaxy.ports[1]!;
  let game = createNewGame(DEFAULT_GALAXY_CONFIG, generated.galaxy, base.id);
  game = setAutoMaintenanceThreshold(game, 95).state;
  game = createPlayerRoute(game, {
    name: "Automatic Maintenance", originPortId: base.id, destinationPortId: destination.id,
    shipId: game.fleet[0]!.id, fareMultiplier: 1, routingMode: "hyperspace",
  }, generated.galaxy, generated.scenario.shipTypes).state;
  while (game.fleet[0]!.condition > 95) {
    game = advanceGameDay(game, generated.scenario, generated.galaxy).state;
  }
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
  const base = generated.galaxy.ports.find((port) => port.name === "Orion Crossing Hub")!;
  const destination = generated.galaxy.ports.find((port) => port.name === "Cygnus Crown Hub")!;
  let game = createNewGame(DEFAULT_GALAXY_CONFIG, generated.galaxy, base.id);
  game = createPlayerRoute(
    game,
    {
      name: "Profitable Corridor",
      originPortId: base.id,
      destinationPortId: destination.id,
      shipId: game.fleet[0]!.id,
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
