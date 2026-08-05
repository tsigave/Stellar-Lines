import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type MouseEvent,
  type WheelEvent,
} from "react";
import type {
  EconomyType,
  GeneratedGalaxy,
  StarSystem,
  SystemMoon,
  SystemPlanet,
} from "../../types.js";
import { formatPopulation } from "../format.js";
import {
  CelestialWebGpuLayer,
  type CelestialRenderBody,
} from "./CelestialWebGpuLayer.js";
import { PlanetBody } from "./PlanetBody.js";
import { SpaceBackdrop } from "./SpaceBackdrop.js";
import { PLANET_LABELS } from "./SystemMap.js";

interface ContinuousGalaxyMapProps {
  galaxy: GeneratedGalaxy;
  selectedPortId: string;
  onSelectPort: (portId: string) => void;
  day: number;
  speed: 0 | 1 | 4 | 16;
}

interface Camera {
  centerX: number;
  centerY: number;
  zoom: number;
}

interface DragState {
  pointerId: number;
  clientX: number;
  clientY: number;
  centerX: number;
  centerY: number;
}

const MAP_WIDTH = 1000;
const MAP_HEIGHT = 700;
const SYSTEM_REVEAL_START = 2.8;
const SYSTEM_REVEAL_END = 4;
const PLANET_REVEAL_START = 8.5;
const PLANET_REVEAL_END = 10;
const GALAXY_ZOOM_MIN = 0.8;
const GALAXY_ZOOM_MAX = 2.75;
const SYSTEM_ZOOM_MIN = 3.8;
const SYSTEM_ZOOM_HOME = 4.6;
const SYSTEM_ZOOM_MAX = 8.4;
const PLANET_ZOOM_MIN = 9.8;
const PLANET_ZOOM_HOME = 11.2;
const PLANET_ZOOM_MAX = 14;
const TAU = Math.PI * 2;
const ROTATION_VISUAL_SLOWDOWN = 60;
const STAR_COLORS: Record<string, string> = {
  O: "#9ebcff", B: "#b8ccff", A: "#d7e2ff", F: "#fff2d2",
  G: "#ffd479", K: "#ff9c66", M: "#ff6b5f",
};
const MOON_COLORS = { rocky: "#978779", ice: "#b5dae2", volcanic: "#b65042", ocean: "#4da6c3" } as const;
const ECONOMY_LABELS: Record<EconomyType, string> = {
  none: "无",
  diversified: "综合经济",
  industrial: "工业",
  commercial: "商业与金融",
  tourism: "旅游",
  mining: "采矿",
  agricultural: "农业",
  research: "科研",
  administrative: "行政服务",
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function smoothstep(start: number, end: number, value: number): number {
  const normalized = clamp((value - start) / (end - start), 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

function mix(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function easeOutCubic(value: number): number {
  return 1 - Math.pow(1 - value, 3);
}

function easeOutBack(value: number): number {
  const overshoot = 1.7;
  const shifted = value - 1;
  return 1 + (overshoot + 1) * Math.pow(shifted, 3) + overshoot * Math.pow(shifted, 2);
}

function systemPosition(system: StarSystem) {
  return { x: system.x * 10, y: system.y * 7 };
}

function systemScale(zoom: number): number {
  return mix(0.025, 0.36, smoothstep(SYSTEM_REVEAL_START, SYSTEM_REVEAL_END, zoom));
}

function localPlanetRadius(planet: SystemPlanet): number {
  return (planet.type === "gas-giant" || planet.type === "ice-giant" ? 8 : 5.5) * planet.relativeSize;
}

function orbitalAngleAtTime(
  initialAngle: number,
  periodDays: number,
  elapsedDays: number,
): number {
  return initialAngle + (elapsedDays / periodDays) * TAU;
}

function surfaceRotationDegrees(
  initialAngle: number,
  periodHours: number,
  elapsedDays: number,
): number {
  return (
    initialAngle +
    ((elapsedDays * 24) / periodHours / ROTATION_VISUAL_SLOWDOWN) * TAU
  ) * 180 / Math.PI;
}

function formatOrbitalPeriod(days: number): string {
  return days >= 365
    ? `${(days / 365).toFixed(2)} 年`
    : `${days.toFixed(days < 10 ? 2 : 1)} 天`;
}

function formatRotationPeriod(hours: number): string {
  const direction = hours < 0 ? "逆行" : "顺行";
  const magnitude = Math.abs(hours);
  return `${magnitude.toFixed(magnitude < 24 ? 1 : 0)} 小时 · ${direction}`;
}

function planetPosition(
  system: StarSystem,
  planet: SystemPlanet,
  zoom: number,
  elapsedDays: number,
) {
  const origin = systemPosition(system);
  const scale = systemScale(zoom);
  const angle = orbitalAngleAtTime(
    planet.orbitalAngle,
    planet.orbitalPeriodDays,
    elapsedDays,
  );
  return {
    x: origin.x + Math.cos(angle) * planet.orbitRadius * scale,
    y: origin.y + Math.sin(angle) * planet.orbitRadius * 0.52 * scale,
  };
}

function moonPosition(
  parent: { x: number; y: number },
  moon: SystemMoon,
  orbitRadius: number,
  verticalScale: number,
  elapsedDays: number,
) {
  const angle = orbitalAngleAtTime(
    moon.orbitalAngle,
    moon.orbitalPeriodDays,
    elapsedDays,
  );
  return {
    x: parent.x + Math.cos(angle) * orbitRadius,
    y: parent.y + Math.sin(angle) * orbitRadius * verticalScale,
  };
}

export function ContinuousGalaxyMap({
  galaxy,
  selectedPortId,
  onSelectPort,
  day,
  speed,
}: ContinuousGalaxyMapProps) {
  const initialSystem = galaxy.systems.find((system) => system.hubPortId === selectedPortId) ?? galaxy.systems[0]!;
  const [camera, setCamera] = useState<Camera>({ centerX: 500, centerY: 350, zoom: 1 });
  const [focusedSystemId, setFocusedSystemId] = useState(initialSystem.id);
  const [focusedPlanetId, setFocusedPlanetId] = useState<string | null>(null);
  const [focusedMoonId, setFocusedMoonId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [webGpuReady, setWebGpuReady] = useState(false);
  const [motionDay, setMotionDay] = useState(day);
  const cameraRef = useRef(camera);
  const motionDayRef = useRef(day);
  const previousDayRef = useRef(day);
  const dragState = useRef<DragState | null>(null);
  const animationRef = useRef<number | null>(null);
  const motionFrameRef = useRef<number | null>(null);
  const semanticTransitionRef = useRef(false);
  const zoomIntentRef = useRef(camera.zoom);
  const suppressClickRef = useRef(false);
  const systemsById = useMemo(
    () => new Map(galaxy.systems.map((system) => [system.id, system])),
    [galaxy],
  );
  const focusedSystem =
    galaxy.systems.find((system) => system.id === focusedSystemId) ?? initialSystem;
  const details = galaxy.systemDetails[focusedSystem.id]!;
  const fallbackPlanet = details.planets.find((planet) => planet.inhabited) ?? details.planets[0]!;
  const focusedPlanet =
    details.planets.find((planet) => planet.id === focusedPlanetId) ?? fallbackPlanet;
  const focusedMoon = focusedPlanet.moons.find((moon) => moon.id === focusedMoonId);
  const elapsedMotionDays = motionDay - 1;
  const systemReveal = smoothstep(SYSTEM_REVEAL_START, SYSTEM_REVEAL_END, camera.zoom);
  const planetReveal = smoothstep(PLANET_REVEAL_START, PLANET_REVEAL_END, camera.zoom);
  const galaxyOpacity = 1 - systemReveal;
  const systemOpacity = systemReveal * (1 - planetReveal * 0.82);
  const scale = systemScale(camera.zoom);
  const systemOrigin = systemPosition(focusedSystem);
  const focusedPlanetPosition = planetPosition(
    focusedSystem,
    focusedPlanet,
    camera.zoom,
    elapsedMotionDays,
  );
  const semanticLevel =
    camera.zoom <= GALAXY_ZOOM_MAX
      ? "galaxy"
      : camera.zoom <= SYSTEM_ZOOM_MAX
        ? "system"
        : "planet";
  const viewWidth = MAP_WIDTH / camera.zoom;
  const viewHeight = MAP_HEIGHT / camera.zoom;
  const viewBox = `${camera.centerX - viewWidth / 2} ${camera.centerY - viewHeight / 2} ${viewWidth} ${viewHeight}`;
  const largestPlanetRadius = Math.max(...details.planets.map(localPlanetRadius));
  const minimumStarRadius = largestPlanetRadius + 4.5;

  const contentBoundsForZoom = (zoom: number) => {
    if (zoom <= GALAXY_ZOOM_MAX) {
      const positions = galaxy.systems.map(systemPosition);
      return {
        minimumX: Math.min(...positions.map((position) => position.x)) - 24,
        maximumX: Math.max(...positions.map((position) => position.x)) + 24,
        minimumY: Math.min(...positions.map((position) => position.y)) - 24,
        maximumY: Math.max(...positions.map((position) => position.y)) + 24,
      };
    }

    if (zoom <= SYSTEM_ZOOM_MAX) {
      const currentScale = systemScale(zoom);
      const outerOrbit = Math.max(...details.planets.map((planet) => planet.orbitRadius));
      const horizontalRadius = outerOrbit * currentScale + 18 / zoom;
      const verticalRadius = outerOrbit * 0.52 * currentScale + 18 / zoom;
      return {
        minimumX: systemOrigin.x - horizontalRadius,
        maximumX: systemOrigin.x + horizontalRadius,
        minimumY: systemOrigin.y - verticalRadius,
        maximumY: systemOrigin.y + verticalRadius,
      };
    }

    const targetPlanetPosition = planetPosition(
      focusedSystem,
      focusedPlanet,
      zoom,
      elapsedMotionDays,
    );
    const moonRadius = Math.max(
      0,
      ...focusedPlanet.moons.map((moon) => moon.orbitRadius * 0.16),
    );
    const horizontalRadius = Math.max(9.2 * (focusedPlanet.hasRings ? 1.8 : 1.2), moonRadius) + 2;
    const verticalRadius = Math.max(11, moonRadius * 0.72) + 2;
    return {
      minimumX: targetPlanetPosition.x - horizontalRadius,
      maximumX: targetPlanetPosition.x + horizontalRadius,
      minimumY: targetPlanetPosition.y - verticalRadius,
      maximumY: targetPlanetPosition.y + verticalRadius,
    };
  };

  const cameraLimitsForZoom = (zoom: number) => {
    const bounds = contentBoundsForZoom(zoom);
    const width = MAP_WIDTH / zoom;
    const height = MAP_HEIGHT / zoom;
    const visibleMargin = Math.min(width, height) * 0.12;
    return {
      minimumX: bounds.minimumX - width / 2 + visibleMargin,
      maximumX: bounds.maximumX + width / 2 - visibleMargin,
      minimumY: bounds.minimumY - height / 2 + visibleMargin,
      maximumY: bounds.maximumY + height / 2 - visibleMargin,
    };
  };

  const constrainCamera = (next: Camera): Camera => {
    const limits = cameraLimitsForZoom(next.zoom);
    return {
      ...next,
      centerX: clamp(next.centerX, limits.minimumX, limits.maximumX),
      centerY: clamp(next.centerY, limits.minimumY, limits.maximumY),
    };
  };

  const resistBoundary = (
    value: number,
    minimum: number,
    maximum: number,
    softness: number,
  ) => {
    if (value < minimum) {
      return minimum - softness * (1 - Math.exp(-(minimum - value) / softness));
    }
    if (value > maximum) {
      return maximum + softness * (1 - Math.exp(-(value - maximum) / softness));
    }
    return value;
  };

  const commitCamera = (next: Camera) => {
    cameraRef.current = next;
    setCamera(next);
  };

  const followMovingPlanet = (nextMotionDay: number) => {
    const current = cameraRef.current;
    if (
      current.zoom < PLANET_ZOOM_MIN ||
      semanticTransitionRef.current ||
      dragState.current
    ) return;
    const position = planetPosition(
      focusedSystem,
      focusedPlanet,
      current.zoom,
      nextMotionDay - 1,
    );
    commitCamera({ ...current, centerX: position.x, centerY: position.y });
  };

  const animateZoom = (
    destinationZoom: number,
    options: { systemId?: string; planetId?: string | null } = {},
  ) => {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    semanticTransitionRef.current = true;
    const systemId = options.systemId ?? focusedSystemId;
    const system = galaxy.systems.find((candidate) => candidate.id === systemId) ?? focusedSystem;
    const planetId = options.planetId === undefined ? focusedPlanetId : options.planetId;
    const destination = clamp(destinationZoom, GALAXY_ZOOM_MIN, PLANET_ZOOM_MAX);
    zoomIntentRef.current = destination;
    const start = cameraRef.current;
    const started = performance.now();
    const duration = 360;
    const destinationOrigin = systemPosition(system);
    const destinationPlanet = planetId
      ? galaxy.systemDetails[system.id]!.planets.find((planet) => planet.id === planetId)
      : undefined;
    const destinationFocus = destinationPlanet
      ? smoothstep(SYSTEM_REVEAL_START, SYSTEM_REVEAL_END, destination)
      : 0;
    const frame = (now: number) => {
      const progress = clamp((now - started) / duration, 0, 1);
      const eased = easeOutCubic(progress);
      const zoom = start.zoom * Math.pow(destination / start.zoom, eased);
      const destinationPlanetPosition = destinationPlanet
        ? planetPosition(
            system,
            destinationPlanet,
            zoom,
            motionDayRef.current - 1,
          )
        : destinationOrigin;
      const end = {
        x: mix(destinationOrigin.x, destinationPlanetPosition.x, destinationFocus),
        y: mix(destinationOrigin.y, destinationPlanetPosition.y, destinationFocus),
      };
      commitCamera({
        centerX: mix(start.centerX, end.x, eased),
        centerY: mix(start.centerY, end.y, eased),
        zoom,
      });
      if (progress < 1) {
        animationRef.current = requestAnimationFrame(frame);
      } else {
        semanticTransitionRef.current = false;
      }
    };
    animationRef.current = requestAnimationFrame(frame);
  };

  useEffect(() => {
    commitCamera({ centerX: 500, centerY: 350, zoom: 1 });
    zoomIntentRef.current = 1;
    setFocusedSystemId(galaxy.systems[0]!.id);
    setFocusedPlanetId(null);
    setFocusedMoonId(null);
    motionDayRef.current = day;
    previousDayRef.current = day;
    setMotionDay(day);
    return () => {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    };
  }, [galaxy]);

  useEffect(() => {
    const dayDelta = day - previousDayRef.current;
    previousDayRef.current = day;
    if (dayDelta === 0) return;
    // Running motion uses its own monotonic clock. Rebinding it to integer
    // settlement days would periodically move orbiting bodies backwards when
    // a busy simulation tick arrives late.
    if (speed === 0) {
      motionDayRef.current += dayDelta;
      setMotionDay(motionDayRef.current);
      followMovingPlanet(motionDayRef.current);
    }
  }, [day, speed]);

  useEffect(() => {
    if (speed === 0) return undefined;
    const daysPerSecond = speed === 1 ? 1 : speed === 4 ? 1000 / 260 : 1000 / 85;
    let previousFrame = performance.now();
    const frame = (now: number) => {
      const elapsedSeconds = Math.min(0.1, Math.max(0, now - previousFrame) / 1000);
      previousFrame = now;
      motionDayRef.current += elapsedSeconds * daysPerSecond;
      setMotionDay(motionDayRef.current);
      followMovingPlanet(motionDayRef.current);
      motionFrameRef.current = requestAnimationFrame(frame);
    };
    motionFrameRef.current = requestAnimationFrame(frame);
    return () => {
      if (motionFrameRef.current !== null) cancelAnimationFrame(motionFrameRef.current);
      motionFrameRef.current = null;
    };
  }, [speed, focusedSystem.id, focusedPlanet.id]);

  const animateAroundPoint = (
    worldPoint: { x: number; y: number },
    destinationZoom: number,
  ) => {
    if (semanticTransitionRef.current) return;
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    const current = cameraRef.current;
    const destination = clamp(destinationZoom, GALAXY_ZOOM_MIN, PLANET_ZOOM_MAX);
    zoomIntentRef.current = destination;
    const started = performance.now();
    const duration = 85;
    const frame = (now: number) => {
      const progress = clamp((now - started) / duration, 0, 1);
      const eased = easeOutCubic(progress);
      const zoom = current.zoom * Math.pow(destination / current.zoom, eased);
      const ratio = current.zoom / zoom;
      commitCamera(constrainCamera({
        centerX: worldPoint.x - (worldPoint.x - current.centerX) * ratio,
        centerY: worldPoint.y - (worldPoint.y - current.centerY) * ratio,
        zoom,
      }));
      if (progress < 1) animationRef.current = requestAnimationFrame(frame);
    };
    animationRef.current = requestAnimationFrame(frame);
  };

  const worldPointFromClient = (
    svg: SVGSVGElement,
    clientX: number,
    clientY: number,
  ) => {
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const matrix = svg.getScreenCTM();
    if (!matrix) return { x: cameraRef.current.centerX, y: cameraRef.current.centerY };
    const world = point.matrixTransform(matrix.inverse());
    return { x: world.x, y: world.y };
  };

  const nearestSystem = (point: { x: number; y: number }) =>
    [...galaxy.systems].sort((left, right) => {
      const leftPosition = systemPosition(left);
      const rightPosition = systemPosition(right);
      return (
        Math.hypot(leftPosition.x - point.x, leftPosition.y - point.y) -
        Math.hypot(rightPosition.x - point.x, rightPosition.y - point.y)
      );
    })[0] ?? focusedSystem;

  const nearestPlanet = (point: { x: number; y: number }) =>
    [...details.planets].sort((left, right) => {
      const leftPosition = planetPosition(
        focusedSystem,
        left,
        cameraRef.current.zoom,
        motionDayRef.current - 1,
      );
      const rightPosition = planetPosition(
        focusedSystem,
        right,
        cameraRef.current.zoom,
        motionDayRef.current - 1,
      );
      return (
        Math.hypot(leftPosition.x - point.x, leftPosition.y - point.y) -
        Math.hypot(rightPosition.x - point.x, rightPosition.y - point.y)
      );
    })[0] ?? fallbackPlanet;

  const requestZoom = (
    nextZoom: number,
    worldPoint: { x: number; y: number },
    targetElement: Element | null = null,
  ) => {
    if (semanticTransitionRef.current) return;
    const current = cameraRef.current;
    const zoomingIn = nextZoom > current.zoom;

    if (
      zoomingIn &&
      current.zoom <= GALAXY_ZOOM_MAX &&
      nextZoom > GALAXY_ZOOM_MAX
    ) {
      const systemId = targetElement?.closest("[data-system-id]")?.getAttribute("data-system-id");
      const targetSystem =
        galaxy.systems.find((system) => system.id === systemId) ?? nearestSystem(worldPoint);
      enterSystem(targetSystem);
      return;
    }

    if (
      zoomingIn &&
      current.zoom >= SYSTEM_ZOOM_MIN &&
      current.zoom <= SYSTEM_ZOOM_MAX &&
      nextZoom > SYSTEM_ZOOM_MAX
    ) {
      const planetId = targetElement?.closest("[data-planet-id]")?.getAttribute("data-planet-id");
      const targetPlanet =
        details.planets.find((planet) => planet.id === planetId) ?? nearestPlanet(worldPoint);
      enterPlanet(targetPlanet);
      return;
    }

    if (
      !zoomingIn &&
      current.zoom >= PLANET_ZOOM_MIN &&
      nextZoom < PLANET_ZOOM_MIN
    ) {
      animateZoom(SYSTEM_ZOOM_MAX, {
        systemId: focusedSystem.id,
        planetId: focusedPlanet.id,
      });
      return;
    }

    if (
      !zoomingIn &&
      current.zoom >= SYSTEM_ZOOM_MIN &&
      current.zoom <= SYSTEM_ZOOM_MAX &&
      nextZoom < SYSTEM_ZOOM_MIN
    ) {
      animateZoom(GALAXY_ZOOM_MAX, {
        systemId: focusedSystem.id,
        planetId: null,
      });
      return;
    }

    const boundedZoom =
      current.zoom <= GALAXY_ZOOM_MAX
        ? clamp(nextZoom, GALAXY_ZOOM_MIN, GALAXY_ZOOM_MAX)
        : current.zoom <= SYSTEM_ZOOM_MAX
          ? clamp(nextZoom, SYSTEM_ZOOM_MIN, SYSTEM_ZOOM_MAX)
          : clamp(nextZoom, PLANET_ZOOM_MIN, PLANET_ZOOM_MAX);
    animateAroundPoint(worldPoint, boundedZoom);
  };

  const onWheel = (event: WheelEvent<SVGSVGElement>) => {
    const nextZoom = clamp(
      zoomIntentRef.current * (event.deltaY < 0 ? 1.16 : 1 / 1.16),
      GALAXY_ZOOM_MIN,
      PLANET_ZOOM_MAX,
    );
    requestZoom(
      nextZoom,
      worldPointFromClient(event.currentTarget, event.clientX, event.clientY),
      event.target instanceof Element ? event.target : null,
    );
  };

  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || semanticTransitionRef.current) return;
    suppressClickRef.current = false;
    dragState.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      centerX: cameraRef.current.centerX,
      centerY: cameraRef.current.centerY,
    };
    setIsDragging(true);
  };

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const drag = dragState.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) <= 4) {
      return;
    }
    suppressClickRef.current = true;
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const zoom = cameraRef.current.zoom;
    const width = MAP_WIDTH / zoom;
    const height = MAP_HEIGHT / zoom;
    const limits = cameraLimitsForZoom(zoom);
    const rawCenterX = drag.centerX - ((event.clientX - drag.clientX) / bounds.width) * width;
    const rawCenterY = drag.centerY - ((event.clientY - drag.clientY) / bounds.height) * height;
    commitCamera({
      zoom,
      centerX: resistBoundary(
        rawCenterX,
        limits.minimumX,
        limits.maximumX,
        width * 0.08,
      ),
      centerY: resistBoundary(
        rawCenterY,
        limits.minimumY,
        limits.maximumY,
        height * 0.08,
      ),
    });
  };

  const reboundToBounds = () => {
    const start = cameraRef.current;
    const destination = constrainCamera(start);
    if (
      Math.abs(start.centerX - destination.centerX) < 0.001 &&
      Math.abs(start.centerY - destination.centerY) < 0.001
    ) return;
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    const started = performance.now();
    const duration = 280;
    const frame = (now: number) => {
      const progress = clamp((now - started) / duration, 0, 1);
      const eased = easeOutBack(progress);
      commitCamera({
        zoom: start.zoom,
        centerX: mix(start.centerX, destination.centerX, eased),
        centerY: mix(start.centerY, destination.centerY, eased),
      });
      if (progress < 1) {
        animationRef.current = requestAnimationFrame(frame);
      } else {
        commitCamera(destination);
      }
    };
    animationRef.current = requestAnimationFrame(frame);
  };

  const finishDrag = (event: PointerEvent<SVGSVGElement>) => {
    if (dragState.current?.pointerId !== event.pointerId) return;
    dragState.current = null;
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    reboundToBounds();
  };

  const suppressClickAfterDrag = (event: MouseEvent<SVGSVGElement>) => {
    if (!suppressClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClickRef.current = false;
  };

  const focusSystem = (system: StarSystem) => {
    setFocusedSystemId(system.id);
    setFocusedPlanetId(null);
    setFocusedMoonId(null);
    if (system.hubPortId) onSelectPort(system.hubPortId);
  };

  const enterSystem = (system: StarSystem) => {
    focusSystem(system);
    animateZoom(SYSTEM_ZOOM_HOME, { systemId: system.id, planetId: null });
  };

  const enterPlanet = (planet: SystemPlanet) => {
    setFocusedPlanetId(planet.id);
    setFocusedMoonId(null);
    animateZoom(PLANET_ZOOM_HOME, { systemId: focusedSystem.id, planetId: planet.id });
  };

  const resetView = () => {
    if (semanticLevel === "galaxy") {
      animateZoom(1, { planetId: null });
    } else if (semanticLevel === "system") {
      animateZoom(SYSTEM_ZOOM_HOME, { planetId: focusedPlanetId });
    } else {
      animateZoom(PLANET_ZOOM_HOME, { planetId: focusedPlanet.id });
    }
  };

  const focusedPlanetBaseRadius = localPlanetRadius(focusedPlanet) * scale;
  const focusedPlanetRadius = mix(focusedPlanetBaseRadius, 9.2, planetReveal);
  const celestialBodies: CelestialRenderBody[] = [];

  for (const system of galaxy.systems) {
    if (system.id === focusedSystem.id) continue;
    const origin = systemPosition(system);
    for (const star of galaxy.systemDetails[system.id]!.stars) {
      celestialBodies.push({
        id: star.id,
        kind: "star",
        x: origin.x + star.offsetX * 0.42,
        y: origin.y + star.offsetY * 0.42,
        radius: 4.4 * star.relativeSize,
        opacity: galaxyOpacity,
        color: STAR_COLORS[star.spectralClass] ?? "#ffd479",
        spectralClass: star.spectralClass,
        rotationDegrees: surfaceRotationDegrees(
          (star.offsetX + star.offsetY) * 0.13,
          480 + star.relativeSize * 180,
          elapsedMotionDays,
        ),
      });
    }
  }

  for (const planet of details.planets) {
    if (planet.id === focusedPlanet.id) continue;
    const position = planetPosition(focusedSystem, planet, camera.zoom, elapsedMotionDays);
    celestialBodies.push({
      id: planet.id,
      kind: "planet",
      planetType: planet.type,
      x: position.x,
      y: position.y,
      radius: localPlanetRadius(planet) * scale,
      opacity: systemOpacity,
      rotationDegrees: surfaceRotationDegrees(
        planet.rotationAngle,
        planet.rotationPeriodHours,
        elapsedMotionDays,
      ),
      axialTiltDegrees: planet.axialTiltDegrees,
      hasRings: planet.hasRings,
      ringTilt: planet.ringTilt,
    });
  }

  for (const [index, moon] of focusedPlanet.moons.entries()) {
    const miniatureOrbit = focusedPlanetBaseRadius + (2.2 + index * 1.45) / Math.max(1, camera.zoom / 4);
    const detailOrbit = moon.orbitRadius * 0.16;
    const orbit = mix(miniatureOrbit, detailOrbit, planetReveal);
    const position = moonPosition(
      focusedPlanetPosition,
      moon,
      orbit,
      mix(0.48, 0.72, planetReveal),
      elapsedMotionDays,
    );
    celestialBodies.push({
      id: moon.id,
      kind: "moon",
      planetType: moon.type,
      x: position.x,
      y: position.y,
      radius: mix(0.48, 0.78 + moon.relativeSize * 0.55, planetReveal),
      opacity: systemReveal,
      rotationDegrees: surfaceRotationDegrees(
        moon.rotationAngle,
        moon.rotationPeriodHours,
        elapsedMotionDays,
      ),
      axialTiltDegrees: moon.axialTiltDegrees,
    });
  }

  celestialBodies.push({
    id: focusedPlanet.id,
    kind: "planet",
    planetType: focusedPlanet.type,
    x: focusedPlanetPosition.x,
    y: focusedPlanetPosition.y,
    radius: focusedPlanetRadius,
    opacity: systemReveal,
    rotationDegrees: surfaceRotationDegrees(
      focusedPlanet.rotationAngle,
      focusedPlanet.rotationPeriodHours,
      elapsedMotionDays,
    ),
    axialTiltDegrees: focusedPlanet.axialTiltDegrees,
    hasRings: focusedPlanet.hasRings,
    ringTilt: focusedPlanet.ringTilt,
  });

  for (const star of details.stars) {
    const offsetScale = mix(0.42, 2.4 * scale, systemReveal);
    const galaxyRadius = 4.4 * star.relativeSize;
    const systemRadius = (minimumStarRadius + Math.max(0, star.relativeSize - 0.7) * 3.2) * scale;
    celestialBodies.push({
      id: star.id,
      kind: "star",
      x: systemOrigin.x + star.offsetX * offsetScale,
      y: systemOrigin.y + star.offsetY * offsetScale,
      radius: mix(galaxyRadius, systemRadius, systemReveal),
      opacity: 1 - planetReveal * 0.9,
      color: STAR_COLORS[star.spectralClass] ?? "#ffd479",
      spectralClass: star.spectralClass,
      rotationDegrees: surfaceRotationDegrees(
        (star.offsetX + star.offsetY) * 0.13,
        480 + star.relativeSize * 180,
        elapsedMotionDays,
      ),
    });
  }

  return (
    <section className="map-panel glass-panel continuous-map-panel">
      <div className="map-toolbar hierarchical-toolbar">
        <div className="map-breadcrumbs">
          <button onClick={() => animateZoom(1, { planetId: null })}>银河</button>
          {semanticLevel !== "galaxy" && <><span>›</span><button onClick={() => animateZoom(SYSTEM_ZOOM_HOME, { planetId: focusedPlanetId })}>{focusedSystem.name}</button></>}
          {semanticLevel === "planet" && <><span>›</span><strong>{focusedPlanet.name}</strong></>}
        </div>
        <div className="map-hint">连续语义缩放 · 当前目标始终居中 · 双击快速深入</div>
        <div className="map-actions">
          <span>{Math.round(camera.zoom * 100)}%</span>
          <button onClick={() => requestZoom(
            clamp(zoomIntentRef.current * 1.14, GALAXY_ZOOM_MIN, PLANET_ZOOM_MAX),
            { x: cameraRef.current.centerX, y: cameraRef.current.centerY },
          )}>＋</button>
          <button onClick={() => requestZoom(
            clamp(zoomIntentRef.current / 1.14, GALAXY_ZOOM_MIN, PLANET_ZOOM_MAX),
            { x: cameraRef.current.centerX, y: cameraRef.current.centerY },
          )}>−</button>
          <button onClick={resetView}>重置</button>
        </div>
      </div>
      <div className="map-canvas continuous-map-canvas">
        <CelestialWebGpuLayer
          bodies={celestialBodies}
          camera={{
            centerX: camera.centerX,
            centerY: camera.centerY,
            viewWidth,
            viewHeight,
          }}
          onReadyChange={setWebGpuReady}
        />
        <svg
          className={isDragging ? "dragging" : ""}
          viewBox={viewBox}
          onWheel={onWheel}
          onPointerDownCapture={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
          onClickCapture={suppressClickAfterDrag}
          role="img"
          aria-label="连续缩放的银河、恒星系与行星地图"
        >
          <defs>
            <filter id="continuous-star-glow" x="-180%" y="-180%" width="460%" height="460%">
              <feGaussianBlur stdDeviation={1.4 / Math.sqrt(camera.zoom)} result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          <SpaceBackdrop id="continuous-deep-space" seed={`${galaxy.config.seed}-continuous-space`} />

          <g className="galaxy-network" opacity={galaxyOpacity}>
            {galaxy.systemLanes.filter((lane) => lane.mode === "hyperspace").map((lane) => {
              const from = systemsById.get(lane.fromSystemId);
              const to = systemsById.get(lane.toSystemId);
              if (!from || !to) return null;
              return <line key={lane.id} className="hyper-lane" x1={from.x * 10} y1={from.y * 7} x2={to.x * 10} y2={to.y * 7} />;
            })}
            {galaxy.systemLanes.filter((lane) => lane.mode === "warp").map((lane) => {
              const from = systemsById.get(lane.fromSystemId);
              const to = systemsById.get(lane.toSystemId);
              if (!from || !to) return null;
              return <line key={lane.id} className="warp-lane" x1={from.x * 10} y1={from.y * 7} x2={to.x * 10} y2={to.y * 7} />;
            })}
          </g>

          {galaxy.systems.filter((system) => system.id !== focusedSystem.id).map((system) => {
            const origin = systemPosition(system);
            const systemDetails = galaxy.systemDetails[system.id]!;
            return (
              <g
                key={system.id}
                className="continuous-system-node"
                data-system-id={system.id}
                opacity={galaxyOpacity}
              >
                <circle
                  className="continuous-hit-target"
                  cx={origin.x}
                  cy={origin.y}
                  r={14 / camera.zoom}
                  onPointerDown={(event) => event.stopPropagation()}
                  onPointerEnter={() => setFocusedSystemId(system.id)}
                  onClick={() => focusSystem(system)}
                  onDoubleClick={() => enterSystem(system)}
                />
                {!webGpuReady && systemDetails.stars.map((star) => (
                  <circle
                    key={star.id}
                    cx={origin.x + star.offsetX * 0.42}
                    cy={origin.y + star.offsetY * 0.42}
                    r={4.4 * star.relativeSize}
                    fill={STAR_COLORS[star.spectralClass]}
                    filter="url(#continuous-star-glow)"
                    pointerEvents="none"
                  />
                ))}
                <text
                  x={origin.x + 14 / camera.zoom}
                  y={origin.y - 12 / camera.zoom}
                  style={{ fontSize: 11 / camera.zoom, strokeWidth: 2.4 / camera.zoom }}
                >{system.name}</text>
              </g>
            );
          })}

          <g className="focused-continuous-system" data-system-id={focusedSystem.id}>
            <g className="system-orbits" opacity={systemOpacity}>
              {details.planets.map((planet) => (
                <ellipse
                  key={`orbit-${planet.id}`}
                  cx={systemOrigin.x}
                  cy={systemOrigin.y}
                  rx={planet.orbitRadius * scale}
                  ry={planet.orbitRadius * 0.52 * scale}
                  className="planet-orbit"
                />
              ))}
            </g>

            {details.planets.filter((planet) => planet.id !== focusedPlanet.id).map((planet) => {
              const position = planetPosition(
                focusedSystem,
                planet,
                camera.zoom,
                elapsedMotionDays,
              );
              const radius = localPlanetRadius(planet) * scale;
              return (
                <g
                  key={planet.id}
                  className="continuous-planet-node"
                  data-planet-id={planet.id}
                  data-planet-type={planet.type}
                  opacity={systemOpacity}
                  pointerEvents={systemOpacity > 0.08 ? "auto" : "none"}
                  onPointerEnter={() => setFocusedPlanetId(planet.id)}
                  onClick={() => setFocusedPlanetId(planet.id)}
                  onDoubleClick={() => enterPlanet(planet)}
                >
                  {!webGpuReady && <PlanetBody
                    id={`${planet.id}-continuous`}
                    type={planet.type}
                    x={position.x}
                    y={position.y}
                    radius={radius}
                    hasRings={planet.hasRings}
                    ringTilt={planet.ringTilt}
                    surfaceRotationDegrees={surfaceRotationDegrees(
                      planet.rotationAngle,
                      planet.rotationPeriodHours,
                      elapsedMotionDays,
                    )}
                    axialTiltDegrees={planet.axialTiltDegrees}
                  />}
                  <circle
                    className="continuous-hit-target"
                    cx={position.x}
                    cy={position.y}
                    r={Math.max(radius + 3 / camera.zoom, 7 / camera.zoom)}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => { event.stopPropagation(); setFocusedPlanetId(planet.id); }}
                    onDoubleClick={(event) => { event.stopPropagation(); enterPlanet(planet); }}
                  />
                  <text
                    x={position.x + radius + 3 / camera.zoom}
                    y={position.y - 2 / camera.zoom}
                    style={{ fontSize: 10 / camera.zoom, strokeWidth: 2 / camera.zoom }}
                  >{planet.name}</text>
                </g>
              );
            })}

            <g
              className="continuous-focused-planet"
              data-planet-id={focusedPlanet.id}
              data-planet-type={focusedPlanet.type}
              opacity={systemReveal}
              pointerEvents={systemReveal > 0.08 ? "auto" : "none"}
              onPointerEnter={() => setFocusedPlanetId(focusedPlanet.id)}
              onClick={() => setFocusedPlanetId(focusedPlanet.id)}
              onDoubleClick={() => enterPlanet(focusedPlanet)}
            >
              {focusedPlanet.moons.map((moon, index) => {
                const miniatureOrbit = focusedPlanetBaseRadius + (2.2 + index * 1.45) / Math.max(1, camera.zoom / 4);
                const detailOrbit = moon.orbitRadius * 0.16;
                const orbit = mix(miniatureOrbit, detailOrbit, planetReveal);
                const position = moonPosition(
                  focusedPlanetPosition,
                  moon,
                  orbit,
                  mix(0.48, 0.72, planetReveal),
                  elapsedMotionDays,
                );
                const { x, y } = position;
                const moonRadius = mix(0.48, 0.78 + moon.relativeSize * 0.55, planetReveal);
                const moonRotation = surfaceRotationDegrees(
                  moon.rotationAngle,
                  moon.rotationPeriodHours,
                  elapsedMotionDays,
                );
                return (
                  <g key={moon.id} className="continuous-moon-node" onClick={(event) => { event.stopPropagation(); setFocusedMoonId(moon.id); }}>
                    <ellipse cx={focusedPlanetPosition.x} cy={focusedPlanetPosition.y} rx={orbit} ry={orbit * mix(0.48, 0.72, planetReveal)} className="planet-orbit" opacity={mix(0.35, 0.8, planetReveal)} />
                    {!webGpuReady && <g transform={`rotate(${moonRotation} ${x} ${y})`}>
                      <circle cx={x} cy={y} r={moonRadius} fill={MOON_COLORS[moon.type]} stroke={moon.id === focusedMoonId ? "#7dffee" : "#14232a"} strokeWidth={0.3} />
                      <path
                        d={`M ${x} ${y - moonRadius * 0.82} Q ${x + moonRadius * 0.42} ${y} ${x} ${y + moonRadius * 0.82}`}
                        fill="none"
                        stroke="rgba(235, 250, 255, 0.48)"
                        strokeWidth={Math.max(0.12, moonRadius * 0.12)}
                        opacity={planetReveal}
                      />
                    </g>}
                    <text
                      x={x + 1.5 / camera.zoom}
                      y={y - 0.7 / camera.zoom}
                      opacity={planetReveal}
                      style={{ fontSize: 9 / camera.zoom, strokeWidth: 1.6 / camera.zoom }}
                    >{moon.name}</text>
                  </g>
                );
              })}
              {!webGpuReady && <PlanetBody
                id={`${focusedPlanet.id}-continuous-focused`}
                type={focusedPlanet.type}
                x={focusedPlanetPosition.x}
                y={focusedPlanetPosition.y}
                radius={focusedPlanetRadius}
                hasRings={focusedPlanet.hasRings}
                ringTilt={focusedPlanet.ringTilt}
                surfaceRotationDegrees={surfaceRotationDegrees(
                  focusedPlanet.rotationAngle,
                  focusedPlanet.rotationPeriodHours,
                  elapsedMotionDays,
                )}
                axialTiltDegrees={focusedPlanet.axialTiltDegrees}
                detailed
              />}
              <circle
                className="continuous-hit-target"
                cx={focusedPlanetPosition.x}
                cy={focusedPlanetPosition.y}
                r={focusedPlanetRadius + 4 / camera.zoom}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => { event.stopPropagation(); setFocusedPlanetId(focusedPlanet.id); }}
                onDoubleClick={(event) => { event.stopPropagation(); enterPlanet(focusedPlanet); }}
              />
              <text
                x={focusedPlanetPosition.x + focusedPlanetRadius + 2 / camera.zoom}
                y={focusedPlanetPosition.y - 1 / camera.zoom}
                opacity={systemOpacity * (1 - planetReveal)}
                style={{ fontSize: 10 / camera.zoom, strokeWidth: 2 / camera.zoom }}
              >{focusedPlanet.name}</text>
            </g>

            <g className="continuous-star-cluster" opacity={1 - planetReveal * 0.9}>
              {!webGpuReady && details.stars.map((star) => {
                const offsetScale = mix(0.42, 2.4 * scale, systemReveal);
                const galaxyRadius = 4.4 * star.relativeSize;
                const systemRadius = (minimumStarRadius + Math.max(0, star.relativeSize - 0.7) * 3.2) * scale;
                return (
                  <circle
                    key={star.id}
                    cx={systemOrigin.x + star.offsetX * offsetScale}
                    cy={systemOrigin.y + star.offsetY * offsetScale}
                    r={mix(galaxyRadius, systemRadius, systemReveal)}
                    fill={STAR_COLORS[star.spectralClass]}
                    filter="url(#continuous-star-glow)"
                  />
                );
              })}
              <circle
                className="continuous-hit-target"
                cx={systemOrigin.x}
                cy={systemOrigin.y}
                r={14 / camera.zoom}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => {
                  if (focusedSystem.hubPortId) onSelectPort(focusedSystem.hubPortId);
                }}
                onDoubleClick={() => enterSystem(focusedSystem)}
              />
            </g>

            <g
              className="continuous-system-ports"
              opacity={systemOpacity * (1 - planetReveal)}
              pointerEvents={systemOpacity * (1 - planetReveal) > 0.08 ? "auto" : "none"}
            >
              {details.starportLocations.map((location) => {
                const port = galaxy.ports.find((candidate) => candidate.id === location.portId);
                if (!port) return null;
                const hostPlanet = details.planets.find((planet) => planet.id === location.hostPlanetId);
                const hostPlanetPosition = hostPlanet
                  ? planetPosition(
                      focusedSystem,
                      hostPlanet,
                      camera.zoom,
                      elapsedMotionDays,
                    )
                  : systemOrigin;
                const hostMoonIndex = hostPlanet?.moons.findIndex(
                  (moon) => moon.id === location.hostMoonId,
                ) ?? -1;
                const hostMoon = hostMoonIndex >= 0 ? hostPlanet?.moons[hostMoonIndex] : undefined;
                const host = hostMoon && hostPlanet
                  ? moonPosition(
                      hostPlanetPosition,
                      hostMoon,
                      localPlanetRadius(hostPlanet) * scale +
                        (2.2 + hostMoonIndex * 1.45) / Math.max(1, camera.zoom / 4),
                      0.48,
                      elapsedMotionDays,
                    )
                  : hostPlanetPosition;
                const distance = (location.kind === "surface" ? 8 : 17) * scale;
                const x = host.x + Math.cos(location.orbitalAngle) * distance;
                const y = host.y + Math.sin(location.orbitalAngle) * distance;
                return (
                  <g key={port.id} className={port.id === selectedPortId ? "system-port selected" : "system-port"} onClick={() => onSelectPort(port.id)}>
                    <circle cx={x} cy={y} r={(port.id === selectedPortId ? 5 : 3.6) / camera.zoom} />
                    <path d={`M ${x - 5 / camera.zoom} ${y} L ${x + 5 / camera.zoom} ${y} M ${x} ${y - 5 / camera.zoom} L ${x} ${y + 5 / camera.zoom}`} />
                  </g>
                );
              })}
            </g>
          </g>
        </svg>

        <div className="map-legend" style={{ opacity: galaxyOpacity }}>
          <span><i className="legend-line hyper" />超空间</span>
          <span><i className="legend-line warp" />曲速直达</span>
        </div>

        <aside className="body-summary-card continuous-summary" style={{ opacity: systemOpacity * (1 - planetReveal), pointerEvents: systemOpacity > 0.2 && planetReveal < 0.8 ? "auto" : "none" }}>
          <span className="eyebrow">FOCUSED PLANET</span>
          <h3>{focusedPlanet.name}</h3>
          <div><span>类型</span><strong>{PLANET_LABELS[focusedPlanet.type]}</strong></div>
          <div><span>人口</span><strong>{focusedPlanet.inhabited ? formatPopulation(focusedPlanet.populationMillions) : "无人居住"}</strong></div>
          <div><span>卫星</span><strong>{focusedPlanet.moons.length}</strong></div>
          <button onClick={() => enterPlanet(focusedPlanet)}>连续放大至行星</button>
        </aside>

        <aside className="planet-data-panel continuous-planet-data" style={{ opacity: planetReveal, pointerEvents: planetReveal > 0.5 ? "auto" : "none" }}>
          <span className="eyebrow">{focusedMoon ? "MOON DATA" : "PLANET DATA"}</span>
          <h2>{focusedMoon?.name ?? focusedPlanet.name}</h2>
          <p>{focusedMoon ? `${focusedMoon.type.toUpperCase()} 卫星` : PLANET_LABELS[focusedPlanet.type]}</p>
          <div className="planet-data-grid">
            <div><span>人口</span><strong>{(focusedMoon ?? focusedPlanet).inhabited ? formatPopulation((focusedMoon ?? focusedPlanet).populationMillions) : "无人居住"}</strong></div>
            <div><span>殖民地</span><strong>{(focusedMoon ?? focusedPlanet).colony ? "已建立" : "无"}</strong></div>
            <div><span>发展度</span><strong>{(focusedMoon ?? focusedPlanet).development || "—"}</strong></div>
            <div><span>经济类型</span><strong>{ECONOMY_LABELS[(focusedMoon ?? focusedPlanet).economyType]}</strong></div>
            <div><span>公转周期</span><strong>{formatOrbitalPeriod((focusedMoon ?? focusedPlanet).orbitalPeriodDays)}</strong></div>
            <div><span>自转周期</span><strong>{formatRotationPeriod((focusedMoon ?? focusedPlanet).rotationPeriodHours)}</strong></div>
            <div><span>自转轴倾角</span><strong>{(focusedMoon ?? focusedPlanet).axialTiltDegrees.toFixed(1)}°</strong></div>
            <div><span>星环</span><strong>{focusedMoon ? "—" : focusedPlanet.hasRings ? "存在" : "无"}</strong></div>
          </div>
          {!focusedMoon && <div className="moon-count">天然卫星 <strong>{focusedPlanet.moons.length}</strong></div>}
          {focusedMoon && <button onClick={() => setFocusedMoonId(null)}>返回行星数据</button>}
        </aside>
      </div>
    </section>
  );
}
