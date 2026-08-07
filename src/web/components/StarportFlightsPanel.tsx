import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  formatScheduleMinute,
  starportMovementCapacity,
  type GameState,
  type GeneratedGalaxy,
  type ScheduledFlight,
} from "../../index.js";

interface StarportFlightsPanelProps {
  game: GameState;
  galaxy: GeneratedGalaxy;
  selectedPortId: string;
  onOpenRoute: (routeId: string) => void;
  onOpenSchedule: () => void;
}

type MovementMode = "arrivals" | "departures";

function flightState(flight: ScheduledFlight, currentMinute: number): { label: string; className: string } {
  if (flight.status === "cancelled") return { label: "取消", className: "negative-text" };
  if (flight.departureMinute < currentMinute && flight.arrivalMinute >= currentMinute) {
    return { label: flight.onTime ? "飞行中 · 预计准点" : `飞行中 · 预计晚点 ${flight.delayMinutes} 分`, className: flight.onTime ? "positive-text" : "warning-text" };
  }
  if (flight.arrivalMinute < currentMinute) {
    return { label: flight.onTime ? "已准点" : `已晚点 ${flight.delayMinutes} 分`, className: flight.onTime ? "positive-text" : "warning-text" };
  }
  return { label: flight.onTime ? "预计准点" : `预计晚点 ${flight.delayMinutes} 分`, className: flight.onTime ? "positive-text" : "warning-text" };
}

function movementStatus(flight: ScheduledFlight, currentMinute: number): { label: string; className: string } {
  if (flight.status === "cancelled") return { label: "取消", className: "cancelled" };
  const landed = flight.arrivalMinute < currentMinute;
  if (landed) return flight.onTime
    ? { label: "准点", className: "on-time" }
    : { label: "晚点", className: "delayed" };
  return flight.onTime
    ? { label: "预计准点", className: "on-time" }
    : { label: "预计晚点", className: "delayed" };
}

function movementMinute(flight: ScheduledFlight, portId: string): number {
  return flight.fromPortId === portId ? flight.departureMinute : flight.arrivalMinute;
}

export function StarportFlightsPanel({ game, galaxy, selectedPortId, onOpenRoute, onOpenSchedule }: StarportFlightsPanelProps) {
  const [movementMode, setMovementMode] = useState<MovementMode>("arrivals");
  const timelineRef = useRef<HTMLDivElement>(null);
  const focusRowRef = useRef<HTMLDivElement>(null);
  const currentMinute = game.day * 1_440;
  const portById = useMemo(() => new Map(galaxy.ports.map((port) => [port.id, port])), [galaxy.ports]);
  const playerRouteById = useMemo(() => new Map(game.routes.map((route) => [route.id, route])), [game.routes]);
  const aiRouteById = useMemo(() => new Map(game.staticAiRoutes.map((route) => [route.id, route])), [game.staticAiRoutes]);
  const selectedPort = portById.get(selectedPortId);

  const allPortFlights = game.scheduledFlights.filter((flight) =>
    flight.fromPortId === selectedPortId || flight.toPortId === selectedPortId,
  );
  const boundedFlights = allPortFlights.filter((flight) => {
    const minute = movementMinute(flight, selectedPortId);
    return minute >= currentMinute - 7 * 1_440 && minute < currentMinute + 7 * 1_440;
  }).sort((left, right) => movementMinute(left, selectedPortId) - movementMinute(right, selectedPortId));
  const arrivalFlights = boundedFlights.filter((flight) => flight.toPortId === selectedPortId);
  const departureFlights = boundedFlights.filter((flight) => flight.fromPortId === selectedPortId);
  const visibleFlights = movementMode === "arrivals" ? arrivalFlights : departureFlights;
  const nextMovementIndex = visibleFlights.findIndex((flight) => movementMinute(flight, selectedPortId) >= currentMinute);
  const focusIndex = nextMovementIndex >= 0 ? nextMovementIndex : Math.max(0, visibleFlights.length - 1);
  const pastFlights = boundedFlights.filter((flight) => movementMinute(flight, selectedPortId) < currentMinute);
  const futureFlights = boundedFlights.filter((flight) => movementMinute(flight, selectedPortId) >= currentMinute);
  const playerFlights = allPortFlights.filter((flight) => flight.companyId === "player" &&
    movementMinute(flight, selectedPortId) >= currentMinute - 7 * 1_440 &&
    movementMinute(flight, selectedPortId) < currentMinute + 7 * 1_440)
    .sort((left, right) => movementMinute(left, selectedPortId) - movementMinute(right, selectedPortId));
  const capacity = game.starportCapacity.find((entry) => entry.portId === selectedPortId && entry.day === game.day);
  const dailyCapacity = capacity?.capacity ?? (selectedPort ? starportMovementCapacity(selectedPort) : 0);
  const usedCapacity = capacity?.used ?? futureFlights.filter((flight) => Math.floor(movementMinute(flight, selectedPortId) / 1_440) === game.day).length;
  const cancelled = [...pastFlights, ...futureFlights].filter((flight) => flight.status === "cancelled").length;
  const offTime = [...pastFlights, ...futureFlights].filter((flight) => flight.status !== "cancelled" && !flight.onTime).length;

  useEffect(() => {
    const container = timelineRef.current;
    const row = focusRowRef.current;
    if (!container || !row) return;
    container.scrollTop = Math.max(0, row.offsetTop - container.clientHeight * 0.42);
  }, [game.day, movementMode, selectedPortId, visibleFlights.length]);

  if (!selectedPort) return null;

  const renderFlight = (flight: ScheduledFlight, compact = false, focused = false) => {
    const departing = flight.fromPortId === selectedPortId;
    const counterpartId = departing ? flight.toPortId : flight.fromPortId;
    const route = playerRouteById.get(flight.routeId) ?? aiRouteById.get(flight.routeId);
    const state = flightState(flight, currentMinute);
    const status = movementStatus(flight, currentMinute);
    return <div className={`starport-flight-row${focused ? " current-focus" : ""}`} ref={focused ? focusRowRef : undefined}>
      <span className={`movement-status ${status.className}`}>{status.label}</span>
      <div className="flight-route-cell">
        <strong>{departing ? "前往" : "来自"} {portById.get(counterpartId)?.name ?? counterpartId}</strong>
        <small>{route?.name ?? (flight.companyId === "player" ? "玩家航线" : "其他航司")} · {flight.shipId}</small>
      </div>
      <div className="flight-time-cell">
        <time>{formatScheduleMinute(movementMinute(flight, selectedPortId))}</time>
        <small>{departing ? `预计抵达 ${formatScheduleMinute(flight.arrivalMinute)}` : `计划抵达 ${formatScheduleMinute(flight.scheduledArrivalMinute)}`}</small>
      </div>
      <div className={`flight-status-cell ${state.className}`}><strong>{departing ? "起飞" : "抵达"}</strong><small>{flight.delayMinutes > 0 ? `${flight.delayMinutes} 分 · ` : ""}{flight.departureSlotStatus} / {flight.arrivalSlotStatus}</small></div>
      {compact && playerRouteById.has(flight.routeId) && <button type="button" onClick={() => onOpenRoute(flight.routeId)}>航线</button>}
    </div>;
  };

  return <section className="starport-flight-section">
    <div className="starport-operational-kpis">
      <span>今日 movement<strong>{usedCapacity} / {dailyCapacity}</strong></span>
      <span>过去七日<strong>{pastFlights.length}</strong></span>
      <span>未来七日<strong>{futureFlights.length}</strong></span>
      <span>异常<strong>{offTime} 晚点 · {cancelled} 取消</strong></span>
    </div>

    <div className="section-heading-row starport-flight-heading">
      <div><span className="eyebrow">PORT MOVEMENTS</span><h2>抵达与起飞时间轴</h2></div>
      <button type="button" onClick={onOpenSchedule}>完整调度</button>
    </div>
    <div className="flight-window-tabs" role="tablist" aria-label="星港航班起降类型">
      <button type="button" role="tab" aria-selected={movementMode === "arrivals"} className={movementMode === "arrivals" ? "active" : ""} onClick={() => setMovementMode("arrivals")}>抵达 · {arrivalFlights.length}</button>
      <button type="button" role="tab" aria-selected={movementMode === "departures"} className={movementMode === "departures" ? "active" : ""} onClick={() => setMovementMode("departures")}>起飞 · {departureFlights.length}</button>
    </div>
    <p className="movement-window-note">当前时间前后各七日 · 默认定位当前时刻 · 向上查看历史，向下查看计划</p>
    <div className="starport-flight-list movement-timeline" ref={timelineRef} aria-label={`${movementMode === "arrivals" ? "抵达" : "起飞"}航班，当前时间前后各七日`}>
      {visibleFlights.map((flight, index) => <Fragment key={`network:${flight.id}`}>
        {index === nextMovementIndex && <div className="current-time-marker"><span>当前时间</span><strong>{formatScheduleMinute(currentMinute)}</strong></div>}
        {renderFlight(flight, false, index === focusIndex)}
      </Fragment>)}
      {visibleFlights.length > 0 && nextMovementIndex < 0 && <div className="current-time-marker"><span>当前时间</span><strong>{formatScheduleMinute(currentMinute)}</strong></div>}
      {visibleFlights.length === 0 && <p className="empty-state">当前时间前后七日没有已登记的{movementMode === "arrivals" ? "抵达" : "起飞"}航班。</p>}
    </div>

    <div className="section-heading-row player-port-heading">
      <div><span className="eyebrow">PLAYER OPERATIONS</span><h2>玩家在本站运营的航班</h2></div>
      <strong>{playerFlights.length} 班</strong>
    </div>
    <div className="starport-flight-list player-flights">
      {playerFlights.slice(0, 100).map((flight) => renderFlight(flight, true))}
      {playerFlights.length === 0 && <p className="empty-state">玩家目前没有在该星港起飞或抵达的航班。</p>}
    </div>
  </section>;
}
