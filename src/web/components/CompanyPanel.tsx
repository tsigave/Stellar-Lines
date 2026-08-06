import { shipMaintenanceState } from "../../game.js";
import type {
  GameState,
  GeneratedGalaxy,
  MarketEvent,
  Route,
  ShipType,
} from "../../index.js";
import { CASH_GOAL, DEADLINE_DAY, PASSENGER_GOAL } from "../../game.js";
import { formatCredits, formatNumber } from "../format.js";

interface CompanyPanelProps {
  game: GameState;
  galaxy: GeneratedGalaxy;
  shipTypes: readonly ShipType[];
  events: readonly MarketEvent[];
  onToggleRoute: (routeId: string) => void;
  onCloseRoute: (routeId: string) => void;
  onAdjustFare: (routeId: string, delta: number) => void;
}

function portName(galaxy: GeneratedGalaxy, portId: string): string {
  return galaxy.ports.find((port) => port.id === portId)?.name ?? portId;
}

function routeEndpoints(galaxy: GeneratedGalaxy, route: Route): string {
  return `${portName(galaxy, route.stops[0]!.portId)} → ${portName(galaxy, route.stops.at(-1)!.portId)}`;
}

export function CompanyPanel({
  game,
  galaxy,
  shipTypes,
  events,
  onToggleRoute,
  onCloseRoute,
  onAdjustFare,
}: CompanyPanelProps) {
  const latest = game.history.at(-1);
  const totalPassengers = game.history.reduce((sum, day) => sum + day.passengers, 0);
  const announcedEvents = events.filter(
    (event) => game.day >= event.announcedOnDay && game.day <= event.endsOnDay + event.recoveryDays,
  );

  return (
    <section className="company-section">
      <div className="section-heading-row">
        <div><span className="eyebrow">PLAYER COMPANY</span><h2>{game.companyName}</h2></div>
        <span className={`status-pill ${game.status === "lost" ? "negative" : "positive"}`}>
          {game.status === "lost" ? "经营失败" : game.primaryGoalCompletedOnDay ? "自由经营" : "初创阶段"}
        </span>
      </div>

      <div className="goal-card">
        <div><span>初级经营目标</span><strong>{game.primaryGoalCompletedOnDay ? "已完成 · 继续自由经营" : `${formatCredits(CASH_GOAL)} 或 ${formatNumber(PASSENGER_GOAL)} 客流`}</strong></div>
        <small>{game.primaryGoalCompletedOnDay ? `第 ${game.primaryGoalCompletedOnDay} 日达成 · 当前累计 ${formatNumber(totalPassengers)} 客流` : `期限：第 ${DEADLINE_DAY - 1} 日 · 当前累计 ${formatNumber(totalPassengers)} 客流`}</small>
        <div className="goal-progress"><i style={{ width: `${game.primaryGoalCompletedOnDay ? 100 : Math.min(100, Math.max(game.cash / CASH_GOAL, totalPassengers / PASSENGER_GOAL) * 100)}%` }} /></div>
      </div>

      <div className="section-title">旅客满意需求</div>
      <div className="passenger-preferences">
        <div><strong>经济</strong><span>船况与可靠性</span></div>
        <div><strong>商务</strong><span>速度与准点率</span></div>
        <div><strong>高端</strong><span>舒适度与船况</span></div>
      </div>

      <div className="section-title">航线表现</div>
      <div className="route-list">
        {game.routes.map((route) => {
          const summary = latest?.routes.find((candidate) => candidate.routeId === route.id);
          const shipType = shipTypes.find((ship) => ship.id === route.shipTypeId);
          const ownedShip = game.fleet.find((ship) => ship.routeId === route.id);
          const maintenance = ownedShip ? shipMaintenanceState(ownedShip, game.day) : "required";
          const operationalState = !route.active
            ? "暂停"
            : maintenance === "maintenance"
              ? "维护中"
              : maintenance === "required"
                ? "维护停航"
                : "运营";
          return (
            <article className={route.active ? "route-card" : "route-card paused"} key={route.id}>
              <div className="route-card-heading">
                <div><strong>{route.name}</strong><span>{routeEndpoints(galaxy, route)}</span></div>
                <em>{operationalState}</em>
              </div>
              <div className="route-card-meta">
                <span>{shipType?.name} · {route.routingMode === "warp" ? "曲率直达" : "超空间航路"}</span>
                <span>票价 {Math.round(route.pricing.multiplier * 100)}%</span>
              </div>
              <div className="route-stats">
                <span>客流 <strong>{formatNumber(summary?.passengers ?? 0)}</strong></span>
                <span>载客率 <strong>{((summary?.loadFactor ?? 0) * 100).toFixed(0)}%</strong></span>
                <span>班次 <strong>{(summary?.departuresPerWeek ?? 0).toFixed(1)}/周</strong></span>
                <span>周期 <strong>{(summary?.roundTripDays ?? 0).toFixed(1)}日</strong></span>
                <span>满意度 <strong>{(summary?.satisfaction ?? 0).toFixed(0)}</strong></span>
                <span>利润 <strong className={(summary?.revenue ?? 0) - (summary?.cost ?? 0) >= 0 ? "positive-text" : "negative-text"}>{formatCredits((summary?.revenue ?? 0) - (summary?.cost ?? 0))}</strong></span>
              </div>
              <div className="route-actions">
                <button onClick={() => onAdjustFare(route.id, -0.05)}>降价</button>
                <button onClick={() => onAdjustFare(route.id, 0.05)}>提价</button>
                <button onClick={() => onToggleRoute(route.id)}>{route.active ? "暂停" : "恢复"}</button>
                <button className="danger-button" onClick={() => onCloseRoute(route.id)}>关闭</button>
              </div>
            </article>
          );
        })}
        {game.routes.length === 0 && <p className="empty-state larger">尚未建立航线。请在上方星港运营区完成第一条航线。</p>}
      </div>

      <div className="section-title">世界动态</div>
      <div className="event-list">
        {announcedEvents.map((event) => {
          const active = game.day >= event.startsOnDay && game.day <= event.endsOnDay + event.recoveryDays;
          return (
            <article className={active ? "event-card active" : "event-card"} key={event.id}>
              <span>{active ? "生效中" : `第 ${event.startsOnDay} 日开始`}</span>
              <strong>{event.name}</strong>
              <p>{event.description}</p>
            </article>
          );
        })}
        {announcedEvents.length === 0 && <p className="empty-state">目前没有已公布事件。</p>}
      </div>
    </section>
  );
}
