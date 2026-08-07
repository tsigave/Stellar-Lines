import { useEffect, useRef, useState, type WheelEvent } from "react";
import type {
  EconomyType,
  PlanetarySystemDetails,
  Starport,
  StarSystem,
  SystemMoon,
  SystemPlanet,
} from "../../types.js";
import { formatPopulation } from "../format.js";
import {
  cameraForAnchor,
  CENTER_ANCHOR,
  detailViewBox,
  LAYER_EXIT_THRESHOLD,
  MAP_CONTENT_REVEAL_DELAY_MS,
  MAP_TRANSITION_DURATION_MS,
  zoomAround,
  type DetailCamera,
  type MapLayerEntry,
} from "./mapTransitions.js";
import { PlanetBody } from "./PlanetBody.js";
import { SpaceBackdrop } from "./SpaceBackdrop.js";
import { PLANET_LABELS } from "./SystemMap.js";

interface PlanetMapProps {
  active: boolean;
  entry: MapLayerEntry;
  system: StarSystem;
  details: PlanetarySystemDetails;
  planet: SystemPlanet;
  ports: readonly Starport[];
  selectedPortId: string;
  onSelectPort: (portId: string) => void;
  onBackToGalaxy: () => void;
  onBackToSystem: () => void;
  onExitToSystem: () => void;
}

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
const MOON_COLORS = { rocky: "#978779", ice: "#b5dae2", volcanic: "#b65042", ocean: "#4da6c3" } as const;
const PLANET_CENTER = { x: 450, y: 285 };

function easeInOut(value: number): number {
  return value < 0.5 ? 2 * value * value : 1 - Math.pow(-2 * value + 2, 2) / 2;
}

export function PlanetMap({
  active,
  entry,
  system,
  details,
  planet,
  ports,
  selectedPortId,
  onSelectPort,
  onBackToGalaxy,
  onBackToSystem,
  onExitToSystem,
}: PlanetMapProps) {
  const initialCamera = cameraForAnchor(
    PLANET_CENTER.x,
    PLANET_CENTER.y,
    entry.anchor,
    entry.mode === "double" ? 0.7 : 1,
  );
  const [camera, setCamera] = useState<DetailCamera>(initialCamera);
  const [focusedMoonId, setFocusedMoonId] = useState<string | null>(null);
  const [orbitalContentVisible, setOrbitalContentVisible] = useState(entry.mode !== "double");
  const [collapsing, setCollapsing] = useState(false);
  const cameraRef = useRef(camera);
  const animationRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const focusedMoon = planet.moons.find((moon) => moon.id === focusedMoonId);
  const selectedBody: SystemPlanet | SystemMoon = focusedMoon ?? planet;
  const planetRadius = (planet.type === "gas-giant" || planet.type === "ice-giant" ? 78 : 62) * planet.relativeSize;
  const planetPorts = details.starportLocations.filter((location) => location.hostPlanetId === planet.id);

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
      PLANET_CENTER.x,
      PLANET_CENTER.y,
      entry.anchor,
      entry.mode === "double" ? 0.7 : 1,
    );
    commitCamera(start);
    setCollapsing(false);
    setFocusedMoonId(null);
    setOrbitalContentVisible(entry.mode !== "double");
    if (entry.mode === "double") {
      animateCamera(
        start,
        cameraForAnchor(PLANET_CENTER.x, PLANET_CENTER.y, CENTER_ANCHOR, 1.1),
        MAP_TRANSITION_DURATION_MS,
      );
      timerRef.current = window.setTimeout(
        () => setOrbitalContentVisible(true),
        MAP_CONTENT_REVEAL_DELAY_MS,
      );
    } else {
      timerRef.current = window.setTimeout(() => setOrbitalContentVisible(true), 30);
    }
    return () => {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [entry.id]);

  const beginExitToSystem = () => {
    if (collapsing) return;
    setCollapsing(true);
    setOrbitalContentVisible(false);
    animateCamera(
      cameraRef.current,
      cameraForAnchor(PLANET_CENTER.x, PLANET_CENTER.y, entry.anchor, 0.9),
      MAP_TRANSITION_DURATION_MS,
    );
    timerRef.current = window.setTimeout(
      onExitToSystem,
      MAP_TRANSITION_DURATION_MS - 100,
    );
  };

  const changeZoom = (delta: number) => {
    const current = cameraRef.current;
    const nextZoom = current.zoom + delta;
    if (nextZoom <= LAYER_EXIT_THRESHOLD) {
      beginExitToSystem();
      return;
    }
    commitCamera(
      zoomAround(
        PLANET_CENTER.x,
        PLANET_CENTER.y,
        current,
        Math.max(LAYER_EXIT_THRESHOLD + 0.02, Math.min(3.5, nextZoom)),
      ),
    );
  };

  const onWheel = (event: WheelEvent<SVGSVGElement>) => {
    changeZoom(event.deltaY < 0 ? 0.18 : -0.18);
  };

  return (
    <section
      className={`map-panel glass-panel map-layer ${active ? "active" : "inactive"}`}
      aria-hidden={!active}
    >
      <div className="map-toolbar hierarchical-toolbar">
        <div className="map-breadcrumbs">
          <button onClick={onBackToGalaxy}>银河</button><span>›</span>
          <button onClick={onBackToSystem}>{system.name}</button><span>›</span>
          <strong>{planet.name}</strong>
        </div>
        <div className="map-hint">点击卫星查看数据 · 缩小返回恒星系</div>
        <div className="map-actions">
          <span>{Math.round(camera.zoom * 100)}%</span>
          <button onClick={() => changeZoom(0.25)}>＋</button>
          <button onClick={() => changeZoom(-0.25)}>−</button>
          <button onClick={() => commitCamera(cameraForAnchor(PLANET_CENTER.x, PLANET_CENTER.y, CENTER_ANCHOR, 1))}>重置</button>
        </div>
      </div>
      <div className="map-canvas planet-map-canvas">
        <svg viewBox={detailViewBox(camera)} onWheel={onWheel} role="img" aria-label={`${planet.name} 行星与卫星`}>
          <SpaceBackdrop id={`planet-space-${planet.id}`} seed={`${planet.id}-planet-space`} />
          <g className={`planet-orbital-content ${orbitalContentVisible && !collapsing ? "visible" : "hidden"}`}>
            {planet.moons.map((moon) => (
              <ellipse key={`moon-orbit-${moon.id}`} cx={PLANET_CENTER.x} cy={PLANET_CENTER.y} rx={moon.orbitRadius * 2.25} ry={moon.orbitRadius * 0.72} className="planet-orbit" />
            ))}
            {planet.moons.map((moon) => {
              const x = PLANET_CENTER.x + Math.cos(moon.orbitalAngle) * moon.orbitRadius * 2.25;
              const y = PLANET_CENTER.y + Math.sin(moon.orbitalAngle) * moon.orbitRadius * 0.72;
              const selected = moon.id === focusedMoonId;
              return (
                <g key={moon.id} className={selected ? "moon-node selected" : "moon-node"} onClick={() => setFocusedMoonId(moon.id)}>
                  {(selected || moon.inhabited) && <circle cx={x} cy={y} r={9 + moon.relativeSize * 5} className="planet-status-ring" />}
                  <circle cx={x} cy={y} r={5 + moon.relativeSize * 5} fill={MOON_COLORS[moon.type]} />
                  <text x={x + 11} y={y - 5}>{moon.name}</text>
                  {moon.inhabited && <text className="planet-population-label" x={x + 11} y={y + 8}>{formatPopulation(moon.populationMillions)}</text>}
                </g>
              );
            })}
            {planetPorts.map((location, index) => {
              const port = ports.find((candidate) => candidate.id === location.portId);
              if (!port) return null;
              const moon = location.hostMoonId ? planet.moons.find((candidate) => candidate.id === location.hostMoonId) : undefined;
              const baseX = moon ? PLANET_CENTER.x + Math.cos(moon.orbitalAngle) * moon.orbitRadius * 2.25 : PLANET_CENTER.x;
              const baseY = moon ? PLANET_CENTER.y + Math.sin(moon.orbitalAngle) * moon.orbitRadius * 0.72 : PLANET_CENTER.y;
              const distance = moon ? 15 : planetRadius + 18 + index * 5;
              const x = baseX + Math.cos(location.orbitalAngle) * distance;
              const y = baseY + Math.sin(location.orbitalAngle) * distance;
              return (
                <g key={port.id} className={port.id === selectedPortId ? "system-port selected" : "system-port"} onClick={() => onSelectPort(port.id)}>
                  <circle cx={x} cy={y} r={port.id === selectedPortId ? 7 : 5} />
                  <path d={`M ${x - 8} ${y} L ${x + 8} ${y} M ${x} ${y - 8} L ${x} ${y + 8}`} />
                  <title>{port.name}</title>
                </g>
              );
            })}
          </g>
          <circle cx={PLANET_CENTER.x} cy={PLANET_CENTER.y} r={planetRadius + 9} className={planet.inhabited ? "inhabited-planet-aura" : "uninhabited-planet-aura"} />
          <PlanetBody
            id={`${planet.id}-detail-body`}
            type={planet.type}
            x={PLANET_CENTER.x}
            y={PLANET_CENTER.y}
            radius={planetRadius}
            hasRings={planet.hasRings}
            ringTilt={planet.ringTilt}
            axialTiltDegrees={planet.axialTiltDegrees}
            detailed
          />
        </svg>
        <aside className={`planet-data-panel ${orbitalContentVisible && !collapsing ? "visible" : "hidden"}`}>
          <span className="eyebrow">{focusedMoon ? "MOON DATA" : "PLANET DATA"}</span>
          <h2>{selectedBody.name}</h2>
          <p>{focusedMoon ? `${focusedMoon.type.toUpperCase()} 卫星` : PLANET_LABELS[planet.type]}</p>
          <div className="planet-data-grid">
            <div><span>人口</span><strong>{selectedBody.inhabited ? formatPopulation(selectedBody.populationMillions) : "无人居住"}</strong></div>
            <div><span>殖民地</span><strong>{selectedBody.colony ? "已建立" : "无"}</strong></div>
            <div><span>发展度</span><strong>{selectedBody.development || "—"}</strong></div>
            <div><span>经济类型</span><strong>{ECONOMY_LABELS[selectedBody.economyType]}</strong></div>
            <div><span>自转轴倾角</span><strong>{selectedBody.axialTiltDegrees.toFixed(1)}°</strong></div>
            <div><span>天然卫星</span><strong>{focusedMoon ? "—" : planet.moons.length}</strong></div>
          </div>
          {!focusedMoon && <div className="moon-count">天然卫星 <strong>{planet.moons.length}</strong></div>}
          {focusedMoon && <button onClick={() => setFocusedMoonId(null)}>返回行星数据</button>}
        </aside>
      </div>
    </section>
  );
}
