import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type WheelEvent,
} from "react";
import { createRandom } from "../../generation/random.js";
import { gameWorldLegs, shipMaintenanceState, type GameState } from "../../game.js";
import { MAX_INTERSTELLAR_SPEED_LY_PER_DAY } from "../../routes.js";
import type { GeneratedGalaxy, Route, ShipType, StarSystem, SystemLane } from "../../types.js";

interface GalaxyMapProps {
  galaxy: GeneratedGalaxy;
  game: GameState;
  shipTypes: readonly ShipType[];
  motionDurationMs: number;
  basePortId?: string;
  selectedPortId: string;
  onSelectPort: (portId: string) => void;
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

const STAR_COLORS: Record<string, string> = {
  O: "#9ebcff", B: "#b8ccff", A: "#d7e2ff", F: "#fff2d2",
  G: "#ffd479", K: "#ff9c66", M: "#ff6b5f",
};
const CAMERA_BOUNDS = { minimumX: -500, maximumX: 1500, minimumY: -350, maximumY: 1050 };
const MAP_WIDTH = 1000;
const MAP_HEIGHT = 700;

interface ShipMapVisual {
  id: string;
  name: string;
  x: number;
  y: number;
  state: "idle" | "traveling" | "docked" | "paused" | "maintenance" | "grounded";
  status: string;
  routeName: string | null;
}

function hyperspacePath(
  galaxy: GeneratedGalaxy,
  fromSystemId: string,
  toSystemId: string,
): SystemLane[] {
  const lanes = galaxy.systemLanes.filter((lane) => lane.mode === "hyperspace");
  const queue = [fromSystemId];
  const visited = new Set([fromSystemId]);
  const previous = new Map<string, { systemId: string; lane: SystemLane }>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === toSystemId) break;
    for (const lane of lanes) {
      const next = lane.fromSystemId === current
        ? lane.toSystemId
        : lane.toSystemId === current
          ? lane.fromSystemId
          : undefined;
      if (!next || visited.has(next)) continue;
      visited.add(next);
      previous.set(next, { systemId: current, lane });
      queue.push(next);
    }
  }
  if (!previous.has(toSystemId)) return [];
  const result: SystemLane[] = [];
  let current = toSystemId;
  while (current !== fromSystemId) {
    const step = previous.get(current);
    if (!step) return [];
    result.unshift(step.lane);
    current = step.systemId;
  }
  return result;
}

function orientedSystemPath(
  lanes: readonly SystemLane[],
  fromSystemId: string,
): string[] {
  const result = [fromSystemId];
  let current = fromSystemId;
  for (const lane of lanes) {
    const next = lane.fromSystemId === current ? lane.toSystemId : lane.fromSystemId;
    result.push(next);
    current = next;
  }
  return result;
}

function positionAlongPath(
  systems: readonly StarSystem[],
  durations: readonly number[],
  elapsedHours: number,
): { x: number; y: number; segmentProgress: number } {
  let remaining = elapsedHours;
  for (let index = 0; index < durations.length; index += 1) {
    const duration = durations[index]!;
    const from = systems[index]!;
    const to = systems[index + 1]!;
    if (remaining <= duration) {
      const progress = Math.max(0, Math.min(1, remaining / Math.max(0.01, duration)));
      return {
        x: (from.x + (to.x - from.x) * progress) * 10,
        y: (from.y + (to.y - from.y) * progress) * 7,
        segmentProgress: progress,
      };
    }
    remaining -= duration;
  }
  const end = systems.at(-1)!;
  return { x: end.x * 10, y: end.y * 7, segmentProgress: 1 };
}

function buildShipVisuals(
  galaxy: GeneratedGalaxy,
  game: GameState,
  shipTypes: readonly ShipType[],
  simulationDay = game.day,
): ShipMapVisual[] {
  const systemsById = new Map(galaxy.systems.map((system) => [system.id, system]));
  const basePort = galaxy.ports.find((port) => port.id === game.basePortId)!;
  const baseSystem = systemsById.get(basePort.systemId)!;
  const worldLegs = gameWorldLegs(galaxy);
  return game.fleet.map((ship, shipIndex) => {
    const offsetX = (shipIndex % 3) * 7 - 7;
    const offsetY = Math.floor(shipIndex / 3) * 7 + 10;
    const atBase = (state: ShipMapVisual["state"], status: string, routeName: string | null = null): ShipMapVisual => ({
      id: ship.id,
      name: ship.name,
      x: baseSystem.x * 10 + offsetX,
      y: baseSystem.y * 7 + offsetY,
      state,
      status,
      routeName,
    });
    const maintenance = shipMaintenanceState(ship, game.day);
    const route = game.routes.find((candidate) => candidate.id === ship.routeId);
    if (maintenance === "maintenance") return atBase("maintenance", `维护中 · 第 ${ship.maintenanceUntilDay} 日恢复`, route?.name ?? null);
    if (maintenance === "required") return atBase("grounded", "维护值过低 · 强制停航", route?.name ?? null);
    if (!route) return atBase("idle", "基地待命");
    if (!route.active) return atBase("paused", "航线暂停", route.name);
    const shipType = shipTypes.find((candidate) => candidate.id === ship.shipTypeId);
    const fromPort = galaxy.ports.find((port) => port.id === route.stops[0]?.portId);
    const toPort = galaxy.ports.find((port) => port.id === route.stops.at(-1)?.portId);
    if (!shipType || !fromPort || !toPort) return atBase("grounded", "航线数据异常", route.name);
    const fromSystem = systemsById.get(fromPort.systemId)!;
    const toSystem = systemsById.get(toPort.systemId)!;
    let pathSystems: StarSystem[];
    let distances: number[];
    if (route.routingMode === "warp") {
      pathSystems = [fromSystem, toSystem];
      const leg = worldLegs.find((candidate) =>
        candidate.mode === "warp" &&
        ((candidate.fromPortId === fromPort.id && candidate.toPortId === toPort.id) ||
          (candidate.fromPortId === toPort.id && candidate.toPortId === fromPort.id)),
      );
      distances = [leg?.distance ?? 5];
    } else {
      const lanes = hyperspacePath(galaxy, fromSystem.id, toSystem.id);
      const systemIds = orientedSystemPath(lanes, fromSystem.id);
      pathSystems = systemIds.map((id) => systemsById.get(id)!).filter(Boolean);
      distances = lanes.map((lane) => lane.distance);
    }
    const speed = shipType.speedByMode[route.routingMode ?? "hyperspace"] ?? 1;
    const durations = distances.map((distance) =>
      Math.max(1, distance / Math.min(speed, MAX_INTERSTELLAR_SPEED_LY_PER_DAY)) * 24,
    );
    const travelHours = durations.reduce((sum, duration) => sum + duration, 0);
    if (travelHours <= 0 || pathSystems.length < 2) return atBase("grounded", "没有可用航路", route.name);
    const cycleHours = travelHours * 2 + 48;
    const routeShips = game.fleet.filter((candidate) => candidate.routeId === route.id);
    const routeShipIndex = Math.max(0, routeShips.findIndex((candidate) => candidate.id === ship.id));
    const phaseOffset = (routeShipIndex * cycleHours) / Math.max(1, routeShips.length);
    const phase = (((simulationDay - 1) * 24 + phaseOffset) % cycleHours + cycleHours) % cycleHours;
    if (phase < travelHours) {
      const position = positionAlongPath(pathSystems, durations, phase);
      return { id: ship.id, name: ship.name, x: position.x + offsetX, y: position.y + offsetY, state: "traveling", status: `去程航行 · ${Math.round((phase / travelHours) * 100)}%`, routeName: route.name };
    }
    if (phase < travelHours + 24) {
      return { id: ship.id, name: ship.name, x: toSystem.x * 10 + offsetX, y: toSystem.y * 7 + offsetY, state: "docked", status: `${toPort.name} 停靠`, routeName: route.name };
    }
    if (phase < travelHours * 2 + 24) {
      const returnElapsed = phase - travelHours - 24;
      const position = positionAlongPath([...pathSystems].reverse(), [...durations].reverse(), returnElapsed);
      return { id: ship.id, name: ship.name, x: position.x + offsetX, y: position.y + offsetY, state: "traveling", status: `返程航行 · ${Math.round((returnElapsed / travelHours) * 100)}%`, routeName: route.name };
    }
    return atBase("docked", `${basePort.name} 停靠`, route.name);
  });
}

function clampCamera(camera: Camera): Camera {
  const viewWidth = MAP_WIDTH / camera.zoom;
  const viewHeight = MAP_HEIGHT / camera.zoom;
  const minimumCenterX = CAMERA_BOUNDS.minimumX + viewWidth / 2;
  const maximumCenterX = CAMERA_BOUNDS.maximumX - viewWidth / 2;
  const minimumCenterY = CAMERA_BOUNDS.minimumY + viewHeight / 2;
  const maximumCenterY = CAMERA_BOUNDS.maximumY - viewHeight / 2;
  return {
    ...camera,
    centerX: Math.max(minimumCenterX, Math.min(maximumCenterX, camera.centerX)),
    centerY: Math.max(minimumCenterY, Math.min(maximumCenterY, camera.centerY)),
  };
}

export function GalaxyMap({
  galaxy,
  game,
  shipTypes,
  motionDurationMs,
  basePortId,
  selectedPortId,
  onSelectPort,
}: GalaxyMapProps) {
  const [camera, setCamera] = useState<Camera>({ centerX: 500, centerY: 350, zoom: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const [displayDay, setDisplayDay] = useState(game.day);
  const [displayGame, setDisplayGame] = useState(game);
  const dragState = useRef<DragState | null>(null);
  const displayDayRef = useRef(game.day);
  const displayGameRef = useRef(game);
  const systemsById = useMemo(
    () => new Map(galaxy.systems.map((system) => [system.id, system])),
    [galaxy],
  );
  const backgroundStars = useMemo(() => {
    const random = createRandom(`${galaxy.config.seed}-background-tile`);
    return Array.from({ length: 42 }, (_, index) => ({
      id: index,
      x: random.next() * 300,
      y: random.next() * 210,
      r: 0.35 + random.next() * 1.05,
      opacity: 0.16 + random.next() * 0.55,
    }));
  }, [galaxy.config.seed]);
  const playerRoutes = game.routes;
  const shipVisuals = useMemo(
    () => buildShipVisuals(galaxy, displayGame, shipTypes, displayDay),
    [displayDay, displayGame, galaxy, shipTypes],
  );

  useEffect(() => {
    if (game.day === displayGameRef.current.day) {
      displayGameRef.current = game;
      displayDayRef.current = game.day;
      setDisplayGame(game);
      setDisplayDay(game.day);
      return undefined;
    }
    if (game.day < displayDayRef.current || motionDurationMs <= 0) {
      displayGameRef.current = game;
      displayDayRef.current = game.day;
      setDisplayGame(game);
      setDisplayDay(game.day);
      return undefined;
    }
    const startDay = displayDayRef.current;
    const targetDay = game.day;
    const startedAt = performance.now();
    let frame = 0;
    const animate = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / motionDurationMs);
      const nextDay = startDay + (targetDay - startDay) * progress;
      displayDayRef.current = nextDay;
      setDisplayDay(nextDay);
      if (progress < 1) {
        frame = requestAnimationFrame(animate);
        return;
      }
      displayGameRef.current = game;
      setDisplayGame(game);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [game, motionDurationMs]);

  useEffect(() => {
    setCamera({ centerX: 500, centerY: 350, zoom: 1 });
  }, [galaxy.config.seed]);

  const viewWidth = MAP_WIDTH / camera.zoom;
  const viewHeight = MAP_HEIGHT / camera.zoom;
  const viewBox = `${camera.centerX - viewWidth / 2} ${camera.centerY - viewHeight / 2} ${viewWidth} ${viewHeight}`;

  const changeZoom = (delta: number) => {
    const nextZoom = Math.max(0.75, Math.min(2.5, camera.zoom + delta));
    setCamera((current) => clampCamera({ ...current, zoom: nextZoom }));
  };

  const handleWheel = (event: WheelEvent<SVGSVGElement>) => {
    changeZoom(event.deltaY < 0 ? 0.13 : -0.13);
  };

  const handlePointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragState.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      centerX: camera.centerX,
      centerY: camera.centerY,
    };
    setIsDragging(true);
  };

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const drag = dragState.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const deltaX = ((event.clientX - drag.clientX) / bounds.width) * viewWidth;
    const deltaY = ((event.clientY - drag.clientY) / bounds.height) * viewHeight;
    setCamera((current) =>
      clampCamera({
        ...current,
        centerX: drag.centerX - deltaX,
        centerY: drag.centerY - deltaY,
      }),
    );
  };

  const finishDrag = (event: PointerEvent<SVGSVGElement>) => {
    if (dragState.current?.pointerId === event.pointerId) {
      dragState.current = null;
      setIsDragging(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
  };

  const resetCamera = () => setCamera({ centerX: 500, centerY: 350, zoom: 1 });

  return (
    <section className="map-panel glass-panel galaxy-overview-map">
      <div className="map-toolbar">
        <div>
          <span className="eyebrow">LIVE NETWORK</span>
          <h2>银河航路图</h2>
        </div>
        <div className="map-hint">首版银河总览 · 拖动与缩放 · 点击有人星系查看市场</div>
        <div className="map-actions">
          <span>{Math.round(camera.zoom * 100)}%</span>
          <button onClick={() => changeZoom(0.2)}>＋</button>
          <button onClick={() => changeZoom(-0.2)}>−</button>
          <button onClick={resetCamera}>重置</button>
        </div>
      </div>
      <div className="map-canvas">
        <svg
          className={isDragging ? "dragging" : ""}
          viewBox={viewBox}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
          role="img"
          aria-label="可拖动的随机银河航路图"
        >
          <defs>
            <filter id="star-glow" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <pattern id="continuous-starfield" width="300" height="210" patternUnits="userSpaceOnUse">
              <rect width="300" height="210" fill="#050b13" />
              {backgroundStars.map((star) => (
                <circle key={star.id} cx={star.x} cy={star.y} r={star.r} fill="#d7edff" opacity={star.opacity} />
              ))}
            </pattern>
          </defs>
          <rect
            x={CAMERA_BOUNDS.minimumX - 300}
            y={CAMERA_BOUNDS.minimumY - 210}
            width={CAMERA_BOUNDS.maximumX - CAMERA_BOUNDS.minimumX + 600}
            height={CAMERA_BOUNDS.maximumY - CAMERA_BOUNDS.minimumY + 420}
            fill="url(#continuous-starfield)"
          />

          <g className="network-lines">
            {galaxy.systemLanes.filter((lane) => lane.mode === "hyperspace").map((lane) => {
              const from = systemsById.get(lane.fromSystemId);
              const to = systemsById.get(lane.toSystemId);
              if (!from || !to) return null;
              return (
                <line key={lane.id} className="hyper-lane" x1={from.x * 10} y1={from.y * 7} x2={to.x * 10} y2={to.y * 7} />
              );
            })}
            {galaxy.systemLanes.filter((lane) => lane.mode === "warp").map((lane) => {
              const from = systemsById.get(lane.fromSystemId);
              const to = systemsById.get(lane.toSystemId);
              if (!from || !to) return null;
              return (
                <line key={lane.id} className="warp-lane" x1={from.x * 10} y1={from.y * 7} x2={to.x * 10} y2={to.y * 7} />
              );
            })}
          </g>

          <g className="player-route-lines" pointerEvents="none">
            {playerRoutes.filter((route) => route.active).flatMap((route) => {
              const fromPort = galaxy.ports.find((port) => port.id === route.stops[0]?.portId);
              const toPort = galaxy.ports.find((port) => port.id === route.stops.at(-1)?.portId);
              const from = fromPort ? systemsById.get(fromPort.systemId) : undefined;
              const to = toPort ? systemsById.get(toPort.systemId) : undefined;
              if (!from || !to) return null;
              if (route.routingMode === "warp") {
                return [(
                  <line key={route.id} className="player-route-line player-warp-route" x1={from.x * 10} y1={from.y * 7} x2={to.x * 10} y2={to.y * 7}>
                    <title>{route.name} · 曲率直达</title>
                  </line>
                )];
              }
              return hyperspacePath(galaxy, from.id, to.id).map((lane, index) => {
                const segmentFrom = systemsById.get(lane.fromSystemId)!;
                const segmentTo = systemsById.get(lane.toSystemId)!;
                return (
                  <line key={`${route.id}-${index}`} className="player-route-line player-hyper-route" x1={segmentFrom.x * 10} y1={segmentFrom.y * 7} x2={segmentTo.x * 10} y2={segmentTo.y * 7}>
                    <title>{route.name} · 超空间航路</title>
                  </line>
                );
              });
            })}
          </g>

          {galaxy.systems.map((system) => {
            const localPorts = galaxy.ports.filter((port) => port.systemId === system.id);
            const details = galaxy.systemDetails[system.id]!;
            const x = system.x * 10;
            const y = system.y * 7;
            const hubSelected = system.hubPortId === selectedPortId;
            return (
              <g
                key={system.id}
                className={`system-node ${system.inhabited ? "inhabited-system" : "uninhabited-system"}`}
              >
                <title>{system.inhabited ? `${system.name}，有人居住` : `${system.name}，无人居住`}</title>
                <circle className={system.hubPortId === basePortId ? "system-status-aura company-base" : "system-status-aura"} cx={x} cy={y} r="24" />
                <circle
                  className="system-hit-target"
                  cx={x} cy={y} r="13"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (system.hubPortId) onSelectPort(system.hubPortId);
                  }}
                />
                <g className={hubSelected ? "galaxy-star-group selected" : "galaxy-star-group"} pointerEvents="none">
                  {details.stars.map((star) => (
                    <circle
                      key={star.id}
                      className="system-star"
                      cx={x + star.offsetX * 0.42}
                      cy={y + star.offsetY * 0.42}
                      r={(hubSelected ? 5.4 : 4.4) * star.relativeSize}
                      fill={STAR_COLORS[star.spectralClass]}
                      filter="url(#star-glow)"
                    />
                  ))}
                </g>
                {localPorts.slice(1).map((port, index) => {
                  const angle = (index / Math.max(1, localPorts.length - 1)) * Math.PI * 2 - Math.PI / 2;
                  const radius = 16 + (index % 2) * 8;
                  return (
                    <circle
                      key={port.id}
                      className={port.id === selectedPortId ? "port-dot selected" : "port-dot"}
                      cx={x + Math.cos(angle) * radius}
                      cy={y + Math.sin(angle) * radius}
                      r={port.id === selectedPortId ? 4.5 : 3.2}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelectPort(port.id);
                      }}
                    >
                      <title>{port.name}</title>
                    </circle>
                  );
                })}
                <text x={x + 14} y={y - 13}>{system.name}</text>
                <text className="system-meta" x={x + 14} y={y + 3}>
                  {system.inhabited ? `有人居住 · ${localPorts.length} 星港` : "无人居住 · 未开发"}
                </text>
              </g>
            );
          })}
          <g className="live-ship-markers" pointerEvents="none">
            {shipVisuals.map((ship) => (
              <g
                key={ship.id}
                className={`live-ship-marker ${ship.state}`}
                style={{ transform: `translate(${ship.x}px, ${ship.y}px)` }}
              >
                <circle r="8" />
                <path d="M 0 -6 L 5 5 L 0 2 L -5 5 Z" />
                <text x="11" y="3">{ship.name}</text>
                <title>{ship.name} · {ship.status}{ship.routeName ? ` · ${ship.routeName}` : ""}</title>
              </g>
            ))}
          </g>
        </svg>
        <div className="ship-live-board">
          <strong>舰队实时状态</strong>
          {shipVisuals.map((ship) => (
            <div key={ship.id}><i className={ship.state} /><span>{ship.name}</span><em>{ship.status}</em></div>
          ))}
        </div>
        <div className="map-legend">
          <span><i className="legend-line hyper" />超空间</span>
          <span><i className="legend-line warp" />曲速直达</span>
          <span><i className="legend-line player" />玩家航线</span>
          <span><i className="legend-dot base" />公司基地</span>
          <span><i className="legend-dot inhabited" />有人行星系</span>
          <span><i className="legend-dot uninhabited" />无人行星系</span>
        </div>
      </div>
    </section>
  );
}
