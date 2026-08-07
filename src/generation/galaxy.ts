import { PROOF_OF_CONCEPT_SHIPS } from "../scenarios/proof-of-concept.js";
import { deterministicExitDistanceKm } from "../fuel.js";
import type {
  EconomyType,
  GalaxyGenerationConfig,
  GeneratedGalaxy,
  HyperspaceTopology,
  PlanetarySystemDetails,
  PlanetType,
  Route,
  SimulationScenario,
  Starport,
  StarSystem,
  SystemLane,
  SystemPlanet,
  SystemMoon,
  TravelMode,
  WorldLeg,
} from "../types.js";
import { createRandom, type RandomSource } from "./random.js";
import { CHINESE_SYSTEM_NAMES } from "./system-names.js";

const PORT_KINDS = [
  "中央港", "轨道港", "自由港", "终点站", "空间站", "交易站", "登陆场", "星港",
];
const SPECTRAL_CLASSES: readonly StarSystem["spectralClass"][] = [
  "B", "A", "F", "G", "G", "K", "K", "M", "M", "M",
];
const PLANET_TYPES: readonly PlanetType[] = [
  "terrestrial", "super-earth", "rocky", "rocky", "ocean", "desert", "ice",
  "volcanic", "gas-giant", "gas-giant", "ice-giant", "dwarf",
];
const MOON_TYPES: readonly SystemMoon["type"][] = [
  "rocky", "rocky", "ice", "ice", "volcanic", "ocean",
];

function economyForBody(type: PlanetType | SystemMoon["type"], random: RandomSource): EconomyType {
  const choices: EconomyType[] =
    type === "gas-giant" || type === "ice-giant"
      ? ["mining", "research", "commercial"]
      : type === "ocean" || type === "terrestrial"
        ? ["diversified", "commercial", "tourism", "agricultural", "administrative"]
        : type === "super-earth"
          ? ["diversified", "industrial", "commercial", "administrative"]
          : type === "desert" || type === "rocky"
            ? ["mining", "industrial", "research"]
            : ["mining", "research"];
  return random.pick(choices);
}

function populationForPlanet(type: PlanetType, development: number, random: RandomSource): number {
  const maximumMillions: Record<PlanetType, number> = {
    terrestrial: 9_000,
    "super-earth": 16_000,
    rocky: 1_800,
    ocean: 6_500,
    desert: 2_800,
    ice: 550,
    volcanic: 120,
    "gas-giant": 0,
    "ice-giant": 0,
    dwarf: 180,
  };
  const maximum = maximumMillions[type];
  if (maximum === 0) return 0;
  const developmentFactor = Math.pow(development / 100, 1.45);
  return Number(Math.max(0.08, maximum * developmentFactor * (0.08 + random.next() * 0.92)).toFixed(2));
}

function planetRotationPeriodHours(type: PlanetType, random: RandomSource): number {
  const giant = type === "gas-giant" || type === "ice-giant";
  const magnitude = giant
    ? 14 + random.next() * 20
    : 18 + random.next() * 102;
  return Number((random.next() < 0.09 ? -magnitude : magnitude).toFixed(2));
}

function axialTiltDegrees(
  random: RandomSource,
  extremeChance: number,
): number {
  const extreme = random.next() < extremeChance;
  const degrees = extreme
    ? 45 + random.next() * 100
    : 1 + random.next() * 34;
  return Number(degrees.toFixed(1));
}

interface Point {
  x: number;
  y: number;
}

interface SystemPair {
  left: number;
  right: number;
  distance: number;
}

export const DEFAULT_GALAXY_CONFIG: GalaxyGenerationConfig = {
  seed: "frontier-8042",
  systemCount: 8,
  starportCount: 6,
  shape: "spiral",
  topology: "mixed",
  laneDensity: 0.35,
};

export function validateGalaxyConfig(config: GalaxyGenerationConfig): void {
  if (!config.seed.trim()) throw new Error("Seed cannot be empty");
  if (!Number.isInteger(config.systemCount) || config.systemCount < 3 || config.systemCount > 30) {
    throw new Error("System count must be an integer between 3 and 30");
  }
  if (
    !Number.isInteger(config.starportCount) ||
    config.starportCount < 1 ||
    config.starportCount > config.systemCount
  ) {
    throw new Error("Starport count must be between 1 and the system count");
  }
  if (config.laneDensity < 0 || config.laneDensity > 1) {
    throw new Error("Lane density must be between 0 and 1");
  }
}

function clampCoordinate(value: number): number {
  return Math.max(6, Math.min(94, value));
}

function generatePoints(
  count: number,
  shape: GalaxyGenerationConfig["shape"],
  random: RandomSource,
): Point[] {
  if (shape === "spiral") {
    const arms = count < 10 ? 2 : 3;
    return Array.from({ length: count }, (_, index) => {
      const fraction = (index + 1) / count;
      const arm = index % arms;
      const angle = fraction * Math.PI * 3.6 + (arm * Math.PI * 2) / arms + random.next() * 0.3;
      const radius = 10 + 38 * Math.sqrt(fraction) + (random.next() - 0.5) * 6;
      return {
        x: clampCoordinate(50 + Math.cos(angle) * radius),
        y: clampCoordinate(50 + Math.sin(angle) * radius * 0.78),
      };
    });
  }

  if (shape === "clusters") {
    const centers = random.shuffle([
      { x: 26, y: 30 }, { x: 72, y: 28 }, { x: 48, y: 72 }, { x: 78, y: 70 },
    ]).slice(0, count < 12 ? 3 : 4);
    return Array.from({ length: count }, (_, index) => {
      const center = centers[index % centers.length]!;
      const angle = random.next() * Math.PI * 2;
      const radius = 4 + random.next() * 16;
      return {
        x: clampCoordinate(center.x + Math.cos(angle) * radius),
        y: clampCoordinate(center.y + Math.sin(angle) * radius),
      };
    });
  }

  const points: Point[] = [];
  const minimumDistance = Math.max(4, 17 / Math.sqrt(count / 8));
  let attempts = 0;
  while (points.length < count && attempts < count * 200) {
    attempts += 1;
    const candidate = { x: 7 + random.next() * 86, y: 7 + random.next() * 86 };
    if (
      points.every(
        (point) => Math.hypot(point.x - candidate.x, point.y - candidate.y) >= minimumDistance,
      )
    ) {
      points.push(candidate);
    }
  }
  while (points.length < count) {
    points.push({ x: 7 + random.next() * 86, y: 7 + random.next() * 86 });
  }
  return points;
}

function allPairs(points: readonly Point[]): SystemPair[] {
  const pairs: SystemPair[] = [];
  for (let left = 0; left < points.length; left += 1) {
    for (let right = left + 1; right < points.length; right += 1) {
      pairs.push({
        left,
        right,
        distance: Math.hypot(
          points[left]!.x - points[right]!.x,
          points[left]!.y - points[right]!.y,
        ),
      });
    }
  }
  return pairs;
}

function pairKey(left: number, right: number): string {
  return left < right ? `${left}:${right}` : `${right}:${left}`;
}

function minimumSpanningTree(points: readonly Point[], pairs: readonly SystemPair[]): SystemPair[] {
  const connected = new Set([0]);
  const result: SystemPair[] = [];
  while (connected.size < points.length) {
    const edge = pairs
      .filter(
        (pair) => connected.has(pair.left) !== connected.has(pair.right),
      )
      .sort((left, right) => left.distance - right.distance)[0];
    if (!edge) throw new Error("Unable to connect generated galaxy");
    result.push(edge);
    connected.add(edge.left);
    connected.add(edge.right);
  }
  return result;
}

function baseTopology(
  topology: HyperspaceTopology,
  points: readonly Point[],
  pairs: readonly SystemPair[],
): SystemPair[] {
  if (topology === "radial") {
    const centerIndex = points
      .map((point, index) => ({ index, distance: Math.hypot(point.x - 50, point.y - 50) }))
      .sort((left, right) => left.distance - right.distance)[0]!.index;
    return pairs.filter((pair) => pair.left === centerIndex || pair.right === centerIndex);
  }
  if (topology === "ring") {
    const ordered = points
      .map((point, index) => ({ index, angle: Math.atan2(point.y - 50, point.x - 50) }))
      .sort((left, right) => left.angle - right.angle);
    const byKey = new Map(pairs.map((pair) => [pairKey(pair.left, pair.right), pair]));
    return ordered.map((entry, index) => {
      const next = ordered[(index + 1) % ordered.length]!;
      return byKey.get(pairKey(entry.index, next.index))!;
    });
  }
  return minimumSpanningTree(points, pairs);
}

function generateHyperspacePairs(
  points: readonly Point[],
  topology: HyperspaceTopology,
  density: number,
  random: RandomSource,
): SystemPair[] {
  const pairs = allPairs(points);
  const base = baseTopology(topology, points, pairs);
  const selected = new Map(base.map((pair) => [pairKey(pair.left, pair.right), pair]));
  const practicalMaximum = Math.min(pairs.length, Math.max(points.length - 1, points.length * 3));
  const target = Math.max(
    selected.size,
    Math.round(selected.size + density * (practicalMaximum - selected.size)),
  );
  const candidates = pairs
    .filter((pair) => !selected.has(pairKey(pair.left, pair.right)))
    .map((pair) => ({
      pair,
      score:
        topology === "mixed"
          ? pair.distance * (0.65 + random.next() * 0.7)
          : pair.distance,
    }))
    .sort((left, right) => left.score - right.score);
  for (const candidate of candidates) {
    if (selected.size >= target) break;
    selected.set(pairKey(candidate.pair.left, candidate.pair.right), candidate.pair);
  }
  return [...selected.values()];
}

function uniqueSystemNames(count: number, random: RandomSource): string[] {
  if (count > CHINESE_SYSTEM_NAMES.length) {
    throw new Error(`System count exceeds the ${CHINESE_SYSTEM_NAMES.length}-name pool`);
  }
  return random.shuffle(CHINESE_SYSTEM_NAMES).slice(0, count);
}

function createPort(
  system: StarSystem,
  index: number,
  random: RandomSource,
): Starport {
  const isHub = index === 0;
  const population = isHub ? random.integer(35, 82) : random.integer(12, 76);
  const economy = random.integer(isHub ? 65 : 35, isHub ? 96 : 88);
  const business = random.integer(isHub ? 60 : 25, isHub ? 95 : 90);
  const tourism = random.integer(20, 98);
  const administration = random.integer(isHub ? 55 : 20, isHub ? 92 : 82);
  return {
    id: `${system.id}-port-${index + 1}`,
    systemId: system.id,
    name: isHub
      ? `${system.name}枢纽港`
      : `${system.name}${random.pick(PORT_KINDS)}${String.fromCharCode(64 + index)}`,
    population,
    economy,
    business,
    tourism,
    administration,
    portLevel: isHub ? (random.next() > 0.35 ? 5 : 4) : random.pick([2, 3, 3, 4]),
    dailyCapacity: isHub ? random.integer(2_400, 5_600) : random.integer(500, 2_100),
    fuelPrice: Number((1.8 + random.next() * 1.8).toFixed(2)),
    serviceFee: random.integer(isHub ? 105 : 55, isHub ? 185 : 125),
    hyperspaceExitDistanceKm: deterministicExitDistanceKm(system.id, "hyperspace"),
    warpExitDistanceKm: deterministicExitDistanceKm(system.id, "warp"),
  };
}

function createSystemDetails(
  system: StarSystem,
  localPorts: readonly Starport[],
  random: RandomSource,
): PlanetarySystemDetails {
  const starCountRoll = random.next();
  const starCount = starCountRoll < 0.06 ? 3 : starCountRoll < 0.28 ? 2 : 1;
  const starOffsets =
    starCount === 1
      ? [{ x: 0, y: 0 }]
      : starCount === 2
        ? [{ x: -7, y: -2 }, { x: 8, y: 3 }]
        : [{ x: -8, y: 4 }, { x: 7, y: 5 }, { x: 0, y: -8 }];
  const stars = starOffsets.map((offset, index) => ({
    id: `${system.id}-star-${index + 1}`,
    spectralClass: index === 0 ? system.spectralClass : random.pick(SPECTRAL_CLASSES),
    relativeSize: Number((0.72 + random.next() * 0.7).toFixed(2)),
    offsetX: offset.x,
    offsetY: offset.y,
  }));

  const planetCount = random.integer(4, 9);
  const planets: SystemPlanet[] = Array.from({ length: planetCount }, (_, index) => {
    const type = random.pick(PLANET_TYPES);
    const orbitRadius = 54 + index * 34 + random.integer(-3, 3);
    return {
      id: `${system.id}-planet-${index + 1}`,
      name: `${system.name} ${String.fromCharCode(98 + index)}`,
      type,
      orbitRadius,
      orbitalAngle: random.next() * Math.PI * 2,
      orbitalPeriodDays: Number((
        42 * Math.pow(orbitRadius / 54, 1.55) * (0.82 + random.next() * 0.36)
      ).toFixed(2)),
      rotationPeriodHours: planetRotationPeriodHours(type, random),
      rotationAngle: random.next() * Math.PI * 2,
      axialTiltDegrees: axialTiltDegrees(
        random,
        type === "ice-giant" ? 0.22 : 0.08,
      ),
      relativeSize: Number((0.55 + random.next() * 1.15).toFixed(2)),
      inhabited: false,
      populationMillions: 0,
      colony: false,
      development: 0,
      economyType: "none",
      hasRings: false,
      ringTilt: 0,
      moons: [],
    };
  });
  if (
    planets.every(
      (planet) =>
        planet.type === "gas-giant" ||
        planet.type === "ice-giant" ||
        planet.type === "volcanic",
    )
  ) {
    planets[0] = { ...planets[0]!, type: "rocky" };
  }
  const habitableCandidates = random.shuffle(
    planets.filter(
      (planet) =>
        planet.type !== "gas-giant" &&
        planet.type !== "ice-giant" &&
        planet.type !== "volcanic",
    ),
  );
  const inhabitedCount = Math.min(
    habitableCandidates.length,
    system.inhabited
      ? Math.max(1, Math.min(3, Math.ceil(localPorts.length / 2)))
      : 0,
  );
  const inhabitedIds = new Set(
    habitableCandidates.slice(0, inhabitedCount).map((planet) => planet.id),
  );
  for (let index = 0; index < planets.length; index += 1) {
    const planet = planets[index]!;
    const inhabited = inhabitedIds.has(planet.id);
    const development = inhabited ? random.integer(28, 96) : 0;
    const moonCount =
      planet.type === "gas-giant" || planet.type === "ice-giant"
        ? random.integer(2, 6)
        : random.integer(0, 3);
    const moons: SystemMoon[] = Array.from({ length: moonCount }, (_, moonIndex) => {
      const moonInhabited = inhabited && random.next() < 0.17;
      const moonDevelopment = moonInhabited ? random.integer(18, Math.max(20, development - 5)) : 0;
      const moonType = random.pick(MOON_TYPES);
      const orbitRadius = 34 + moonIndex * 22 + random.integer(-2, 3);
      const orbitalPeriodDays = Number((
        2.4 * Math.pow(orbitRadius / 34, 1.45) * (0.82 + random.next() * 0.36)
      ).toFixed(2));
      const tidallyLocked = random.next() < 0.7;
      return {
        id: `${planet.id}-moon-${moonIndex + 1}`,
        name: `${planet.name}-${moonIndex + 1}`,
        type: moonType,
        orbitRadius,
        orbitalAngle: random.next() * Math.PI * 2,
        orbitalPeriodDays,
        rotationPeriodHours: tidallyLocked
          ? orbitalPeriodDays * 24
          : Number(((random.next() < 0.06 ? -1 : 1) * (14 + random.next() * 150)).toFixed(2)),
        rotationAngle: random.next() * Math.PI * 2,
        axialTiltDegrees: axialTiltDegrees(random, 0.05),
        relativeSize: Number((0.35 + random.next() * 0.65).toFixed(2)),
        inhabited: moonInhabited,
        populationMillions: moonInhabited
          ? Number((0.05 + random.next() * Math.max(0.1, moonDevelopment * 1.8)).toFixed(2))
          : 0,
        colony: moonInhabited,
        development: moonDevelopment,
        economyType: moonInhabited ? economyForBody(moonType, random) : "none",
      };
    });
    planets[index] = {
      ...planet,
      inhabited,
      populationMillions: inhabited ? populationForPlanet(planet.type, development, random) : 0,
      colony: inhabited,
      development,
      economyType: inhabited ? economyForBody(planet.type, random) : "none",
      hasRings:
        random.next() <
        (planet.type === "gas-giant" || planet.type === "ice-giant" ? 0.42 : 0.08),
      ringTilt: Number((-28 + random.next() * 56).toFixed(1)),
      moons,
    };
  }
  const inhabitedPlanets = planets.filter((planet) => planet.inhabited);
  const solidPlanets = planets.filter(
    (planet) => planet.type !== "gas-giant" && planet.type !== "ice-giant",
  );
  const starportLocations = localPorts.map((port, index) => {
    const deepSpace = index > 0 && random.next() < 0.1;
    const hostPlanet = deepSpace
      ? null
      : index === 0
        ? inhabitedPlanets[0]!
        : random.next() < 0.72
          ? random.pick(inhabitedPlanets)
          : random.pick(solidPlanets);
    const possibleMoons = hostPlanet?.moons ?? [];
    const hostMoon =
      index > 0 && possibleMoons.length > 0 && random.next() < 0.18
        ? random.pick(possibleMoons)
        : null;
    return {
      portId: port.id,
      hostPlanetId: hostPlanet?.id ?? null,
      hostMoonId: hostMoon?.id ?? null,
      kind: deepSpace ? "deep-space" as const : index === 0 || random.next() < 0.55 ? "orbital" as const : "surface" as const,
      orbitalAngle: random.next() * Math.PI * 2,
    };
  });
  return { systemId: system.id, stars, planets, starportLocations };
}

function worldLeg(
  id: string,
  fromPortId: string,
  toPortId: string,
  mode: TravelMode,
  distance: number,
  random: RandomSource,
): WorldLeg {
  return {
    id,
    fromPortId,
    toPortId,
    mode,
    distance: Number(distance.toFixed(2)),
    hazard: Number((0.01 + random.next() * (mode === "hyperspace" ? 0.1 : 0.05)).toFixed(3)),
    timeModifier: 1,
    fuelModifier: 1,
    isOpen: true,
  };
}

export function generateGalaxy(config: GalaxyGenerationConfig): GeneratedGalaxy {
  validateGalaxyConfig(config);
  const random = createRandom(config.seed);
  const points = generatePoints(config.systemCount, config.shape, random);
  const names = uniqueSystemNames(config.systemCount, random);
  // In the first version, one inhabited system always owns exactly one port.
  const inhabitedSystemCount = config.starportCount;
  const inhabitedSystemIds = new Set(
    random
      .shuffle(Array.from({ length: config.systemCount }, (_, index) => `system-${index + 1}`))
      .slice(0, inhabitedSystemCount),
  );
  const systems: StarSystem[] = points.map((point, index) => {
    const id = `system-${index + 1}`;
    const inhabited = inhabitedSystemIds.has(id);
    const hubPortId = inhabited ? `${id}-port-1` : null;
    return {
      id,
      name: names[index]!,
      x: point.x,
      y: point.y,
      spectralClass: random.pick(SPECTRAL_CLASSES),
      inhabited,
      navigationNodeId: hubPortId ?? `${id}-navigation`,
      hubPortId,
    };
  });
  const generatedPorts = systems
    .filter((system) => system.inhabited)
    .map((system) => createPort(system, 0, random));
  const systemDetails = Object.fromEntries(
    systems.map((system) => [
      system.id,
      createSystemDetails(
        system,
        generatedPorts.filter((port) => port.systemId === system.id),
        random,
      ),
    ]),
  ) as Record<string, PlanetarySystemDetails>;
  const ports = generatedPorts.map((port) => {
    const details = systemDetails[port.systemId]!;
    const system = systems.find((candidate) => candidate.id === port.systemId)!;
    const location = details.starportLocations.find((candidate) => candidate.portId === port.id)!;
    const hostPlanet = details.planets.find((planet) => planet.id === location.hostPlanetId);
    const hostMoon = hostPlanet?.moons.find((moon) => moon.id === location.hostMoonId);
    const systemPopulation = details.planets.reduce(
      (sum, planet) =>
        sum +
        planet.populationMillions +
        planet.moons.reduce((moonSum, moon) => moonSum + moon.populationMillions, 0),
      0,
    );
    const sameHostCount = Math.max(
      1,
      details.starportLocations.filter(
        (candidate) =>
          candidate.hostPlanetId === location.hostPlanetId &&
          candidate.hostMoonId === location.hostMoonId,
      ).length,
    );
    const hostedPopulation = hostMoon?.populationMillions ?? hostPlanet?.populationMillions ?? 0;
    const populationMillions =
      port.id === system.hubPortId
        ? Math.max(0.1, systemPopulation * 0.58)
        : location.kind === "deep-space"
          ? 0.08 + random.next() * 8
          : Math.max(0.05, hostedPopulation / sameHostCount);
    const development = hostMoon?.development ?? hostPlanet?.development ?? 20;
    const populationIndex = Math.max(
      1,
      Math.min(100, (8 + 24 * Math.log10(1 + populationMillions)) * (0.55 + development / 220)),
    );
    return {
      ...port,
      population: Number(populationIndex.toFixed(2)),
      populationMillions: Number(populationMillions.toFixed(2)),
    };
  });
  const systemLanes: SystemLane[] = [];
  const worldLegs: WorldLeg[] = [];
  const hyperspacePairs = generateHyperspacePairs(
    points,
    config.topology,
    config.laneDensity,
    random,
  );
  const averagePairDistance = hyperspacePairs.reduce((sum, pair) => sum + pair.distance, 0) /
    Math.max(1, hyperspacePairs.length);
  const toLightYears = (mapDistance: number): number =>
    Math.max(5, Math.min(32, mapDistance * (10 / averagePairDistance)));
  for (const pair of hyperspacePairs) {
    const left = systems[pair.left]!;
    const right = systems[pair.right]!;
    const id = `hyper-${left.id}-${right.id}`;
    const distance = toLightYears(pair.distance);
    systemLanes.push({
      id,
      fromSystemId: left.id,
      toSystemId: right.id,
      mode: "hyperspace",
      distance: Number(distance.toFixed(2)),
    });
    worldLegs.push(
      worldLeg(
        id,
        left.navigationNodeId,
        right.navigationNodeId,
        "hyperspace",
        distance,
        random,
      ),
    );
  }

  const selectedHyperspace = new Set(
    hyperspacePairs.map((pair) => pairKey(pair.left, pair.right)),
  );
  const warpCandidates = allPairs(points)
    .filter((pair) => !selectedHyperspace.has(pairKey(pair.left, pair.right)))
    .sort((left, right) => left.distance - right.distance)
    .slice(0, Math.max(1, Math.floor(systems.length / 3)));
  for (const pair of warpCandidates) {
    const left = systems[pair.left]!;
    const right = systems[pair.right]!;
    const id = `warp-${left.id}-${right.id}`;
    const distance = toLightYears(pair.distance);
    systemLanes.push({
      id,
      fromSystemId: left.id,
      toSystemId: right.id,
      mode: "warp",
      distance: Number(distance.toFixed(2)),
    });
    worldLegs.push(
      worldLeg(
        id,
        left.navigationNodeId,
        right.navigationNodeId,
        "warp",
        distance,
        random,
      ),
    );
  }

  return { config: { ...config }, systems, systemDetails, ports, systemLanes, worldLegs };
}

function pricing(multiplier: number): Route["pricing"] {
  return {
    multiplier,
    passengerClassMultiplier: { economy: 1, business: 1.35, premium: 2.1 },
  };
}

function generatedRoute(
  id: string,
  companyId: string,
  portIds: readonly string[],
  shipTypeId: string,
  assignedShips: number,
  priceMultiplier: number,
): Route {
  return {
    id,
    companyId,
    name: `Route ${id.replaceAll("-", " ")}`,
    kind: "return",
    stops: portIds.map((portId) => ({
      portId,
      stopType: "commercial" as const,
      minimumStopHours: 1,
    })),
    shipTypeId,
    assignedShips,
    pricing: pricing(priceMultiplier),
    maintenanceAllowanceHours: 2,
    active: true,
  };
}

export interface GeneratedScenarioResult {
  galaxy: GeneratedGalaxy;
  scenario: SimulationScenario;
}

export function createGeneratedScenario(
  config: GalaxyGenerationConfig,
): GeneratedScenarioResult {
  const galaxy = generateGalaxy(config);
  const portsById = new Map(galaxy.ports.map((port) => [port.id, port]));
  const connectsTwoStarports = (leg: WorldLeg) =>
    portsById.has(leg.fromPortId) && portsById.has(leg.toPortId);
  const hyperLegs = galaxy.worldLegs.filter(
    (leg) => leg.mode === "hyperspace" && connectsTwoStarports(leg),
  );
  const warpLegs = galaxy.worldLegs.filter(
    (leg) => leg.mode === "warp" && connectsTwoStarports(leg),
  );
  const routes: Route[] = hyperLegs.map((leg, index) => {
    const companyIndex = index % 4;
    if (companyIndex === 0) {
      return generatedRoute(
        `player-hyper-${index + 1}`, "player", [leg.fromPortId, leg.toPortId],
        "meridian-liner", 2, 1,
      );
    }
    if (companyIndex === 1) {
      return generatedRoute(
        `budget-hyper-${index + 1}`, "nova-budget", [leg.fromPortId, leg.toPortId],
        "atlas-liner", 3, 0.78,
      );
    }
    if (companyIndex === 2) {
      return generatedRoute(
        `business-hyper-${index + 1}`, "swift-business", [leg.fromPortId, leg.toPortId],
        "aurora-clipper", 1, 1.35,
      );
    }
    return generatedRoute(
      `player-hyper-${index + 1}`, "player", [leg.fromPortId, leg.toPortId],
      "meridian-liner", 2, 1.05,
    );
  });

  hyperLegs.forEach((leg, index) => {
    const from = portsById.get(leg.fromPortId)!;
    const to = portsById.get(leg.toPortId)!;
    const marketIntensity =
      (from.population + to.population + from.economy + to.economy + from.business + to.business) /
      6;
    if (marketIntensity < 66) return;
    const baseCompany = routes[index]!.companyId;
    const competitor = baseCompany === "swift-business" ? "nova-budget" : "swift-business";
    routes.push(
      generatedRoute(
        `competitive-hyper-${index + 1}`,
        competitor,
        [leg.fromPortId, leg.toPortId],
        competitor === "nova-budget" ? "atlas-liner" : "aurora-clipper",
        competitor === "nova-budget" ? 3 : 1,
        competitor === "nova-budget" ? 0.8 : 1.28,
      ),
    );
  });

  for (const [index, system] of galaxy.systems.entries()) {
    const localPorts = galaxy.ports.filter((port) => port.systemId === system.id);
    if (localPorts.length < 2) continue;
    localPorts.slice(1).forEach((localPort, localIndex) => {
      routes.push(
        generatedRoute(
          `regional-${index + 1}-${localIndex + 1}`,
          index % 3 === 0 ? "player" : "orbital-regional",
          [system.hubPortId!, localPort.id],
          "pioneer-regional",
          1,
          0.92,
        ),
      );
    });
  }

  warpLegs.forEach((leg, index) => {
    routes.push(
      generatedRoute(
        `warp-express-${index + 1}`,
        "swift-business",
        [leg.fromPortId, leg.toPortId],
        "arrow-express",
        1,
        1.3,
      ),
    );
  });

  return {
    galaxy,
    scenario: {
      id: `generated-${config.seed}`,
      name: `Generated Galaxy ${config.seed}`,
      seed: config.seed.split("").reduce((sum, character) => sum + character.charCodeAt(0), 0),
      ports: galaxy.ports,
      worldLegs: galaxy.worldLegs,
      shipTypes: PROOF_OF_CONCEPT_SHIPS,
      routes,
      companyReputation: {
        player: 60,
        "nova-budget": 52,
        "swift-business": 72,
        "orbital-regional": 66,
      },
      events: [],
    },
  };
}
