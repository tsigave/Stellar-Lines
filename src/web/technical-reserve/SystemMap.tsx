import { useEffect, useMemo, useRef, useState, type WheelEvent } from "react";
import type {
  PlanetarySystemDetails,
  PlanetType,
  Starport,
  StarSystem,
  SystemPlanet,
} from "../../types.js";
import { formatPopulation } from "../format.js";
import {
  anchorForWorld,
  cameraForAnchor,
  CENTER_ANCHOR,
  detailViewBox,
  LAYER_EXIT_THRESHOLD,
  LAYER_ZOOM_THRESHOLD,
  MAP_CONTENT_REVEAL_DELAY_MS,
  MAP_TRANSITION_DURATION_MS,
  zoomAround,
  type DetailCamera,
  type MapEntryRequest,
  type MapLayerEntry,
} from "./mapTransitions.js";
import { PlanetBody } from "./PlanetBody.js";
import { SpaceBackdrop } from "./SpaceBackdrop.js";

interface SystemMapProps {
  active: boolean;
  entry: MapLayerEntry;
  system: StarSystem;
  details: PlanetarySystemDetails;
  ports: readonly Starport[];
  selectedPortId: string;
  onSelectPort: (portId: string) => void;
  onBackToGalaxy: () => void;
  onExitToGalaxy: () => void;
  onEnterPlanet: (planetId: string, entry: MapEntryRequest) => void;
}

const STAR_COLORS: Record<string, string> = {
  O: "#9ebcff", B: "#b8ccff", A: "#d7e2ff", F: "#fff2d2",
  G: "#ffd479", K: "#ff9c66", M: "#ff6b5f",
};
export const PLANET_COLORS: Record<PlanetType, string> = {
  terrestrial: "#65a883",
  "super-earth": "#7898a8",
  rocky: "#9c8876",
  ocean: "#4faac6",
  desert: "#d39b56",
  ice: "#b9dde3",
  volcanic: "#b94e3f",
  "gas-giant": "#b88768",
  "ice-giant": "#77a9c4",
  dwarf: "#817c78",
};
export const PLANET_LABELS: Record<PlanetType, string> = {
  terrestrial: "类地行星",
  "super-earth": "超级地球",
  rocky: "岩质行星",
  ocean: "海洋行星",
  desert: "沙漠行星",
  ice: "冰封行星",
  volcanic: "火山行星",
  "gas-giant": "类木行星",
  "ice-giant": "类海王星",
  dwarf: "矮行星",
};
const MOON_COLORS = { rocky: "#978779", ice: "#b5dae2", volcanic: "#b65042", ocean: "#4da6c3" } as const;
const SYSTEM_CENTER = { x: 450, y: 285 };

function planetPosition(planet: SystemPlanet) {
  return {
    x: SYSTEM_CENTER.x + Math.cos(planet.orbitalAngle) * planet.orbitRadius,
    y: SYSTEM_CENTER.y + Math.sin(planet.orbitalAngle) * planet.orbitRadius * 0.52,
  };
}

function easeInOut(value: number): number {
  return value < 0.5 ? 2 * value * value : 1 - Math.pow(-2 * value + 2, 2) / 2;
}

export function SystemMap({
  active,
  entry,
  system,
  details,
  ports,
  selectedPortId,
  onSelectPort,
  onBackToGalaxy,
  onExitToGalaxy,
  onEnterPlanet,
}: SystemMapProps) {
  const initialPlanet = details.planets.find((planet) => planet.inhabited) ?? details.planets[0]!;
  const initialCamera = cameraForAnchor(
    SYSTEM_CENTER.x,
    SYSTEM_CENTER.y,
    entry.anchor,
    entry.mode === "double" ? 0.72 : 1,
  );
  const [focusedPlanetId, setFocusedPlanetId] = useState(initialPlanet.id);
  const [camera, setCamera] = useState<DetailCamera>(initialCamera);
  const [contentVisible, setContentVisible] = useState(entry.mode !== "double");
  const [collapsing, setCollapsing] = useState(false);
  const cameraRef = useRef(camera);
  const animationRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const focusedPlanet = details.planets.find((planet) => planet.id === focusedPlanetId) ?? initialPlanet;
  const positions = useMemo(
    () => new Map(details.planets.map((planet) => [planet.id, planetPosition(planet)])),
    [details.planets],
  );
  const focusPosition = positions.get(focusedPlanet.id)!;
  const largestPlanetRadius = Math.max(
    ...details.planets.map(
      (planet) =>
        (planet.type === "gas-giant" || planet.type === "ice-giant" ? 8 : 5.5) *
        planet.relativeSize,
    ),
  );
  const minimumStarRadius = largestPlanetRadius + 4.5;

  const commitCamera = (next: DetailCamera) => {
    cameraRef.current = next;
    setCamera(next);
  };

  const animateCamera = (from: DetailCamera, to: DetailCamera, duration: number) => {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    const started = performance.now();
    const frame = (now: number) => {
      const progress = Math.min(1, (now - started) / duration);
      const eased = easeInOut(progress);
      commitCamera({
        centerX: from.centerX + (to.centerX - from.centerX) * eased,
        centerY: from.centerY + (to.centerY - from.centerY) * eased,
        zoom: from.zoom + (to.zoom - from.zoom) * eased,
      });
      if (progress < 1) animationRef.current = requestAnimationFrame(frame);
    };
    animationRef.current = requestAnimationFrame(frame);
  };

  useEffect(() => {
    const start = cameraForAnchor(
      SYSTEM_CENTER.x,
      SYSTEM_CENTER.y,
      entry.anchor,
      entry.mode === "double" ? 0.72 : 1,
    );
    commitCamera(start);
    setCollapsing(false);
    setContentVisible(entry.mode !== "double");
    if (entry.mode === "double") {
      animateCamera(
        start,
        cameraForAnchor(SYSTEM_CENTER.x, SYSTEM_CENTER.y, CENTER_ANCHOR, 1.08),
        MAP_TRANSITION_DURATION_MS,
      );
      timerRef.current = window.setTimeout(
        () => setContentVisible(true),
        MAP_CONTENT_REVEAL_DELAY_MS,
      );
    } else {
      timerRef.current = window.setTimeout(() => setContentVisible(true), 30);
    }
    return () => {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [entry.id]);

  const beginExitToGalaxy = () => {
    if (collapsing) return;
    setCollapsing(true);
    setContentVisible(false);
    const current = cameraRef.current;
    const target = cameraForAnchor(SYSTEM_CENTER.x, SYSTEM_CENTER.y, entry.anchor, 0.92);
    animateCamera(current, target, MAP_TRANSITION_DURATION_MS);
    timerRef.current = window.setTimeout(
      onExitToGalaxy,
      MAP_TRANSITION_DURATION_MS - 100,
    );
  };

  const enterPlanet = (planet: SystemPlanet, mode: MapEntryRequest["mode"]) => {
    const position = positions.get(planet.id)!;
    onEnterPlanet(planet.id, {
      mode,
      anchor: anchorForWorld(position.x, position.y, cameraRef.current),
    });
  };

  const changeZoom = (delta: number) => {
    const current = cameraRef.current;
    const nextZoom = current.zoom + delta;
    if (nextZoom <= LAYER_EXIT_THRESHOLD) {
      beginExitToGalaxy();
      return;
    }
    if (nextZoom >= LAYER_ZOOM_THRESHOLD) {
      enterPlanet(focusedPlanet, "zoom");
      return;
    }
    commitCamera(
      zoomAround(
        focusPosition.x,
        focusPosition.y,
        current,
        Math.max(LAYER_EXIT_THRESHOLD + 0.02, nextZoom),
      ),
    );
  };

  const onWheel = (event: WheelEvent<SVGSVGElement>) => {
    changeZoom(event.deltaY < 0 ? 0.16 : -0.16);
  };

  return (
    <section
      className={`map-panel glass-panel map-layer ${active ? "active" : "inactive"}`}
      aria-hidden={!active}
    >
      <div className="map-toolbar hierarchical-toolbar">
        <div className="map-breadcrumbs">
          <button onClick={onBackToGalaxy}>银河</button><span>›</span><strong>{system.name}</strong>
        </div>
        <div className="map-hint">双击行星进入 · 放大至400%进入行星 · 缩小返回银河</div>
        <div className="map-actions">
          <span>{Math.round(camera.zoom * 100)}%</span>
          <button onClick={() => changeZoom(0.2)}>＋</button>
          <button onClick={() => changeZoom(-0.2)}>−</button>
          <button onClick={() => commitCamera(cameraForAnchor(SYSTEM_CENTER.x, SYSTEM_CENTER.y, CENTER_ANCHOR, 1))}>重置</button>
        </div>
      </div>
      <div className="map-canvas system-map-canvas">
        <svg viewBox={detailViewBox(camera)} onWheel={onWheel} role="img" aria-label={`${system.name} 行星系统`}>
          <defs>
            <filter id={`system-map-star-glow-${system.id}`} x="-150%" y="-150%" width="400%" height="400%">
              <feGaussianBlur stdDeviation="7" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          <SpaceBackdrop id={`system-space-${system.id}`} seed={`${system.id}-system-space`} />
          <g className={`system-celestial-content ${contentVisible && !collapsing ? "visible" : "hidden"}`}>
            {details.planets.map((planet) => (
              <ellipse key={`orbit-${planet.id}`} cx={SYSTEM_CENTER.x} cy={SYSTEM_CENTER.y} rx={planet.orbitRadius} ry={planet.orbitRadius * 0.52} className="planet-orbit" />
            ))}
            {details.planets.map((planet) => {
              const position = positions.get(planet.id)!;
              const selected = focusedPlanet.id === planet.id;
              const radius = (planet.type === "gas-giant" || planet.type === "ice-giant" ? 8 : 5.5) * planet.relativeSize;
              return (
                <g
                  key={planet.id}
                  className={selected ? "system-planet-node selected" : "system-planet-node"}
                  onPointerEnter={() => setFocusedPlanetId(planet.id)}
                  onClick={() => setFocusedPlanetId(planet.id)}
                  onDoubleClick={() => enterPlanet(planet, "double")}
                >
                  {planet.moons.map((moon, moonIndex) => {
                    const moonOrbit = radius + 7 + moonIndex * 4.5;
                    const moonX = position.x + Math.cos(moon.orbitalAngle) * moonOrbit;
                    const moonY = position.y + Math.sin(moon.orbitalAngle) * moonOrbit * 0.48;
                    return (
                      <g key={moon.id} className="system-moon-miniature">
                        <ellipse cx={position.x} cy={position.y} rx={moonOrbit} ry={moonOrbit * 0.48} />
                        <circle cx={moonX} cy={moonY} r={1.25 + moon.relativeSize * 0.8} fill={MOON_COLORS[moon.type]} />
                      </g>
                    );
                  })}
                  {(planet.inhabited || selected) && <circle cx={position.x} cy={position.y} r={radius + 6} className="planet-status-ring" />}
                  <PlanetBody
                    id={`${planet.id}-system-body`}
                    type={planet.type}
                    x={position.x}
                    y={position.y}
                    radius={radius}
                    hasRings={planet.hasRings}
                    ringTilt={planet.ringTilt}
                    axialTiltDegrees={planet.axialTiltDegrees}
                  />
                  <text x={position.x + radius + 8} y={position.y - 4}>{planet.name}</text>
                  {planet.inhabited && <text className="planet-population-label" x={position.x + radius + 8} y={position.y + 8}>{formatPopulation(planet.populationMillions)}</text>}
                  <title>{PLANET_LABELS[planet.type]} · {planet.inhabited ? formatPopulation(planet.populationMillions) : "无人居住"} · {planet.moons.length} 颗卫星</title>
                </g>
              );
            })}
            {details.starportLocations.map((location) => {
              const port = ports.find((candidate) => candidate.id === location.portId);
              const host = location.hostPlanetId ? positions.get(location.hostPlanetId) : undefined;
              if (!port) return null;
              const distance = location.kind === "surface" ? 8 : 17;
              const x = host ? host.x + Math.cos(location.orbitalAngle) * distance : SYSTEM_CENTER.x + Math.cos(location.orbitalAngle) * 380;
              const y = host ? host.y + Math.sin(location.orbitalAngle) * distance : SYSTEM_CENTER.y + Math.sin(location.orbitalAngle) * 205;
              return (
                <g key={port.id} className={port.id === selectedPortId ? "system-port selected" : "system-port"} onClick={() => onSelectPort(port.id)}>
                  <circle cx={x} cy={y} r={port.id === selectedPortId ? 6 : 4.5} />
                  <path d={`M ${x - 7} ${y} L ${x + 7} ${y} M ${x} ${y - 7} L ${x} ${y + 7}`} />
                  <title>{port.name}</title>
                </g>
              );
            })}
          </g>
          <g className="system-star-cluster">
            {details.stars.map((star) => (
              <circle
                key={star.id}
                cx={SYSTEM_CENTER.x + star.offsetX * 2.4}
                cy={SYSTEM_CENTER.y + star.offsetY * 2.4}
                r={minimumStarRadius + Math.max(0, star.relativeSize - 0.7) * 3.2}
                fill={STAR_COLORS[star.spectralClass]}
                filter={`url(#system-map-star-glow-${system.id})`}
              />
            ))}
          </g>
        </svg>
        <div className={`body-summary-card ${contentVisible && !collapsing ? "visible" : "hidden"}`}>
          <span className="eyebrow">FOCUSED PLANET</span>
          <h3>{focusedPlanet.name}</h3>
          <div><span>类型</span><strong>{PLANET_LABELS[focusedPlanet.type]}</strong></div>
          <div><span>人口</span><strong>{focusedPlanet.inhabited ? formatPopulation(focusedPlanet.populationMillions) : "无人居住"}</strong></div>
          <div><span>卫星</span><strong>{focusedPlanet.moons.length}</strong></div>
          <div><span>发展度</span><strong>{focusedPlanet.development || "—"}</strong></div>
          <button onClick={() => enterPlanet(focusedPlanet, "double")}>查看行星与卫星</button>
        </div>
      </div>
    </section>
  );
}
