import { useMemo, useState } from "react";
import {
  formatScheduleMinute,
  starportMovementCapacity,
  requestRouteFleetChange,
  type GameState,
  type GeneratedGalaxy,
  type ShipType,
} from "../../index.js";

const REASON_LABELS = {
  "starport-control": "星港管制",
  "ground-turnaround": "地面周转",
  technical: "技术维护",
  "route-environment": "航路环境",
  "knock-on": "连锁晚点",
} as const;

export function SchedulePanel({ game, galaxy, shipTypes, onFleetChange, onReserveChange, onInvestCapacity }: {
  game: GameState;
  galaxy: GeneratedGalaxy;
  shipTypes: readonly ShipType[];
  onFleetChange: (shipId: string, routeId: string | null) => void;
  onReserveChange: (shipId: string, routeId: string | null) => void;
  onInvestCapacity: (portId: string) => void;
}) {
  const [selectedPortId, setSelectedPortId] = useState(game.basePortId);
  const [selectedCapacityDay, setSelectedCapacityDay] = useState(game.day);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [reserves, setReserves] = useState<Record<string, string>>({});
  const portById = useMemo(() => new Map(galaxy.ports.map((port) => [port.id, port])), [galaxy.ports]);
  const routeById = useMemo(() => new Map(game.routes.map((route) => [route.id, route])), [game.routes]);
  const flights = game.scheduledFlights.filter((flight) =>
    flight.companyId === "player" && flight.departureMinute >= game.day * 1_440 && flight.departureMinute < (game.day + 7) * 1_440,
  );
  const selectedPort = portById.get(selectedPortId);
  const storedPortCapacity = game.starportCapacity.filter((entry) => entry.portId === selectedPortId && entry.day >= game.day && entry.day < game.day + 7);
  const portCapacity = storedPortCapacity.length > 0 || !selectedPort ? storedPortCapacity : Array.from({ length: 7 }, (_, offset) => ({
    portId: selectedPort.id, day: game.day + offset, capacity: starportMovementCapacity(selectedPort), used: 0, utilization: 0,
    departureFlightIds: [] as readonly string[], arrivalFlightIds: [] as readonly string[], slots: [] as const, modifier: 1, congestionRisk: 0,
  }));
  const selectedDay = portCapacity.find((entry) => entry.day === selectedCapacityDay) ?? portCapacity[0];
  const investment = game.starportCapacityInvestments[selectedPortId];
  const previewFleetChange = (shipId: string, value: string) => {
    try {
      const result = requestRouteFleetChange(game, shipId, value === "standby" ? null : value, shipTypes, galaxy);
      return { change: result.state.pendingFleetChanges.find((entry) => entry.shipId === shipId && entry.status === "pending"), error: null as string | null };
    } catch (error) {
      return { change: undefined, error: error instanceof Error ? error.message : "无法预览" };
    }
  };

  return <main className="schedule-workspace">
    <section className="schedule-hero glass-panel">
      <div><span className="eyebrow">LIVE DISPATCH</span><h2>航班、轮转与星港容量</h2><p>五分钟精度；起飞和降落分别占用一个硬时隙，排队最长六小时。</p></div>
      <div className="schedule-kpis"><span>未来七日航班<strong>{flights.length}</strong></span><span>非准点<strong>{flights.filter((flight) => !flight.onTime).length}</strong></span><span>取消<strong>{flights.filter((flight) => flight.status === "cancelled").length}</strong></span><span>公司声誉<strong>{game.companyReputation.toFixed(1)}</strong></span></div>
    </section>

    <section className="schedule-grid">
      <article className="glass-panel schedule-card span-2"><div className="section-heading-row"><div><h2>实际航班计划</h2><p>显示分配时隙、替代船、延误原因和实体空间航段。</p></div></div>
        <div className="accessible-table"><table><thead><tr><th>航班</th><th>航线 / 执行船</th><th>起飞 / 抵达</th><th>时隙</th><th>状态</th><th>原因与物理</th></tr></thead><tbody>{flights.slice(0, 160).map((flight) => <tr key={flight.id}><td>{portById.get(flight.fromPortId)?.name} → {portById.get(flight.toPortId)?.name}</td><td>{routeById.get(flight.routeId)?.name}<small>{flight.shipId} · {shipTypes.find((type) => type.id === flight.shipTypeId)?.name}{flight.replacementShipId ? ` · 替代 ${flight.originalShipId}` : ""}</small></td><td>{formatScheduleMinute(flight.departureMinute)}<small>{formatScheduleMinute(flight.arrivalMinute)}</small></td><td>{flight.departureSlotStatus} / {flight.arrivalSlotStatus}</td><td className={flight.status === "cancelled" ? "negative-text" : !flight.onTime ? "warning-text" : "positive-text"}>{flight.status === "cancelled" ? `取消 · 赔付 ${(flight.compensationRate * 100).toFixed(0)}%` : flight.delayMinutes > 0 ? `晚点 ${flight.delayMinutes} 分${flight.onTime ? "（准点窗内）" : ""}` : "准点"}</td><td>{flight.delayReasons.map((reason) => REASON_LABELS[reason]).join("、") || "—"}<small>亚光速 {flight.sublightHours.toFixed(1)}h / {flight.sublightFuelUnits.toFixed(1)} FU · 星际 {flight.interstellarFuelUnits.toFixed(1)} FU</small></td></tr>)}</tbody></table></div>
      </article>

      <article className="glass-panel schedule-card"><div className="section-heading-row"><div><h2>星港七日 movement</h2><p>事件、投资和拥堵修正已经计入。</p></div><button onClick={() => onInvestCapacity(selectedPortId)}>投资容量</button></div><select value={selectedPortId} onChange={(event) => { setSelectedPortId(event.target.value); setSelectedCapacityDay(game.day); }}>{galaxy.ports.map((port) => <option key={port.id} value={port.id}>{port.name} · L{port.portLevel}</option>)}</select><small>投资 {investment?.level ?? 0}/5 · 本地声誉 {(game.localReputation[selectedPortId] ?? game.companyReputation).toFixed(1)}</small><div className="capacity-day-list">{portCapacity.map((entry) => <button className={selectedDay?.day === entry.day ? "active" : ""} key={`${entry.portId}:${entry.day}`} onClick={() => setSelectedCapacityDay(entry.day)}><span>第 {entry.day} 日</span><i><b style={{ width: `${Math.min(100, entry.utilization * 100)}%` }}/></i><strong>{entry.used} / {entry.capacity}</strong><small>修正 ×{entry.modifier.toFixed(2)} · 拥堵风险 {(entry.congestionRisk * 100).toFixed(0)}%</small></button>)}</div></article>

      <article className="glass-panel schedule-card"><h2>当日分时时隙</h2><p>零容量小时不会接受 movement；红色表示已满。</p><div className="slot-grid">{selectedDay?.slots.map((slot) => <div key={slot.startMinute} className={slot.capacity > 0 && slot.used >= slot.capacity ? "full" : ""}><time>{String(Math.floor(slot.startMinute % 1_440 / 60)).padStart(2, "0")}:00</time><strong>{slot.used}/{slot.capacity}</strong></div>)}</div></article>

      <article className="glass-panel schedule-card"><h2>动态调船与备用池</h2><p>提交前校验十四日容量；在途船完成往返后生效。</p><div className="dispatch-list">{game.fleet.map((ship) => { const pending = game.pendingFleetChanges.find((change) => change.shipId === ship.id && change.status === "pending"); const value = assignments[ship.id] ?? ship.routeId ?? "standby"; const reserve = reserves[ship.id] ?? ship.reserveForRouteId ?? "none"; const draft = !pending && value !== (ship.routeId ?? "standby") ? previewFleetChange(ship.id, value) : null; return <div key={ship.id}><span><strong>{ship.name}</strong><small>{pending ? `第 ${pending.effectiveDay} 日 · 容量 ${pending.capacityDelta >= 0 ? "+" : ""}${pending.capacityDelta} · 成本 ${pending.expectedCost.toFixed(0)} Cr · 可能取消 ${pending.possiblyCancelledFlightIds.length} 班` : draft?.change ? `预览：第 ${draft.change.effectiveDay} 日 · 容量 ${draft.change.capacityDelta >= 0 ? "+" : ""}${draft.change.capacityDelta} · 成本 ${draft.change.expectedCost.toFixed(0)} Cr · 可能取消 ${draft.change.possiblyCancelledFlightIds.length} 班` : draft?.error ?? (ship.routeId ? routeById.get(ship.routeId)?.name : "基地待命")}</small></span><select value={value} disabled={!!pending || !!ship.reserveForRouteId} onChange={(event) => setAssignments((current) => ({ ...current, [ship.id]: event.target.value }))}><option value="standby">基地待命</option>{game.routes.filter((route) => route.active).map((route) => <option key={route.id} value={route.id}>{route.name}</option>)}</select><button disabled={!!pending || !!ship.reserveForRouteId || !!draft?.error || value === (ship.routeId ?? "standby")} onClick={() => onFleetChange(ship.id, value === "standby" ? null : value)}>排程</button>{!ship.routeId && <><select value={reserve} onChange={(event) => setReserves((current) => ({ ...current, [ship.id]: event.target.value }))}><option value="none">非备用</option>{game.routes.filter((route) => route.active).map((route) => <option key={route.id} value={route.id}>备用：{route.name}</option>)}</select><button disabled={reserve === (ship.reserveForRouteId ?? "none")} onClick={() => onReserveChange(ship.id, reserve === "none" ? null : reserve)}>设置备用</button></>}</div>; })}</div></article>

      <article className="glass-panel schedule-card span-2"><h2>舰船运行日志</h2><div className="ship-log-list">{game.shipLogs.slice(-120).reverse().map((entry) => <div key={entry.id}><time>{formatScheduleMinute(entry.minute)}</time><strong>{game.fleet.find((ship) => ship.id === entry.shipId)?.name ?? entry.shipId}</strong><span>{entry.detail}</span></div>)}{game.shipLogs.length === 0 && <p>开通航线后将生成离港、跃迁、巡航、跃出、亚光速进近和到港日志。</p>}</div></article>
    </section>
  </main>;
}
