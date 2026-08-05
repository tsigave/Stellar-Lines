import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type MouseEvent,
  type WheelEvent,
} from "react";
import { createRandom } from "../../generation/random.js";
import type { GeneratedGalaxy } from "../../types.js";
import {
  clampAnchor,
  LAYER_ZOOM_THRESHOLD,
  type MapEntryRequest,
} from "../mapTransitions.js";

interface GalaxyMapProps {
  active: boolean;
  galaxy: GeneratedGalaxy;
  selectedPortId: string;
  onSelectPort: (portId: string) => void;
  onEnterSystem: (systemId: string, entry: MapEntryRequest) => void;
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
  active,
  galaxy,
  selectedPortId,
  onSelectPort,
  onEnterSystem,
}: GalaxyMapProps) {
  const [camera, setCamera] = useState<Camera>({ centerX: 500, centerY: 350, zoom: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const [focusedSystemId, setFocusedSystemId] = useState<string | null>(null);
  const dragState = useRef<DragState | null>(null);
  const systemsByHub = useMemo(
    () => new Map(galaxy.systems.map((system) => [system.hubPortId, system])),
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

  useEffect(() => {
    setCamera({ centerX: 500, centerY: 350, zoom: 1 });
  }, [galaxy.config.seed]);

  const viewWidth = MAP_WIDTH / camera.zoom;
  const viewHeight = MAP_HEIGHT / camera.zoom;
  const viewBox = `${camera.centerX - viewWidth / 2} ${camera.centerY - viewHeight / 2} ${viewWidth} ${viewHeight}`;

  const anchorForSystem = (systemId: string) => {
    const system = galaxy.systems.find((candidate) => candidate.id === systemId)!;
    return clampAnchor({
      x: (system.x * 10 - (camera.centerX - viewWidth / 2)) / viewWidth,
      y: (system.y * 7 - (camera.centerY - viewHeight / 2)) / viewHeight,
    });
  };

  const changeZoom = (delta: number) => {
    const nextZoom = Math.max(0.75, Math.min(LAYER_ZOOM_THRESHOLD + 0.35, camera.zoom + delta));
    if (nextZoom >= LAYER_ZOOM_THRESHOLD) {
      const target =
        galaxy.systems.find((system) => system.id === focusedSystemId) ??
        [...galaxy.systems].sort(
          (left, right) =>
            Math.hypot(left.x * 10 - camera.centerX, left.y * 7 - camera.centerY) -
            Math.hypot(right.x * 10 - camera.centerX, right.y * 7 - camera.centerY),
        )[0];
      if (target) onEnterSystem(target.id, { mode: "zoom", anchor: anchorForSystem(target.id) });
      return;
    }
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

  const enterByDoubleClick = (systemId: string, event: MouseEvent<SVGCircleElement>) => {
    event.stopPropagation();
    const bounds = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
    const anchor = bounds
      ? clampAnchor({
          x: (event.clientX - bounds.left) / bounds.width,
          y: (event.clientY - bounds.top) / bounds.height,
        })
      : anchorForSystem(systemId);
    onEnterSystem(systemId, { mode: "double", anchor });
  };

  return (
    <section
      className={`map-panel glass-panel map-layer ${active ? "active" : "inactive"}`}
      aria-hidden={!active}
    >
      <div className="map-toolbar">
        <div>
          <span className="eyebrow">LIVE NETWORK</span>
          <h2>银河航路图</h2>
        </div>
        <div className="map-hint">拖动地图 · 双击恒星进入 · 放大至400%自动切换</div>
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
            {galaxy.worldLegs.filter((leg) => leg.mode === "hyperspace").map((leg) => {
              const from = systemsByHub.get(leg.fromPortId);
              const to = systemsByHub.get(leg.toPortId);
              if (!from || !to) return null;
              return (
                <line key={leg.id} className="hyper-lane" x1={from.x * 10} y1={from.y * 7} x2={to.x * 10} y2={to.y * 7} />
              );
            })}
            {galaxy.worldLegs.filter((leg) => leg.mode === "warp").map((leg) => {
              const from = systemsByHub.get(leg.fromPortId);
              const to = systemsByHub.get(leg.toPortId);
              if (!from || !to) return null;
              return (
                <line key={leg.id} className="warp-lane" x1={from.x * 10} y1={from.y * 7} x2={to.x * 10} y2={to.y * 7} />
              );
            })}
          </g>

          {galaxy.systems.map((system) => {
            const localPorts = galaxy.ports.filter((port) => port.systemId === system.id);
            const details = galaxy.systemDetails[system.id]!;
            const x = system.x * 10;
            const y = system.y * 7;
            const hubSelected = system.hubPortId === selectedPortId;
            return (
              <g key={system.id} className="system-node">
                <circle cx={x} cy={y} r="24" fill="none" stroke="#78d6d0" strokeOpacity="0.13" />
                <circle
                  className="system-hit-target"
                  cx={x} cy={y} r="13"
                  onPointerDown={(event) => event.stopPropagation()}
                  onPointerEnter={() => setFocusedSystemId(system.id)}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectPort(system.hubPortId);
                  }}
                  onDoubleClick={(event) => enterByDoubleClick(system.id, event)}
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
                <text className="system-meta" x={x + 14} y={y + 3}>{localPorts.length} PORTS · 点击查看</text>
              </g>
            );
          })}
        </svg>
        <div className="map-legend">
          <span><i className="legend-line hyper" />超空间</span>
          <span><i className="legend-line warp" />曲速直达</span>
          <span><i className="legend-dot" />可选星港</span>
        </div>
      </div>
    </section>
  );
}
