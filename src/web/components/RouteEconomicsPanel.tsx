import { useEffect, useMemo, useState } from "react";
import {
  PASSENGER_CLASSES,
  PASSENGER_TYPES,
  buildFareCurveData,
  buildRouteServices,
  buildSpeedEconomicsCurve,
  explainJourneyChoice,
  gameScenario,
  recommendRouteFares,
  simulateCampaign,
  summarizeRouteEconomics,
  formatScheduleMinute,
  type CabinConfiguration,
  type GameRouteDaySummary,
  type GameState,
  type GeneratedGalaxy,
  type PassengerClass,
  type PassengerEvaluation,
  type RouteCostBreakdown,
  type SimulationScenario,
} from "../../index.js";
import { formatCredits, formatNumber } from "../format.js";

interface RouteEconomicsPanelProps {
  game: GameState;
  galaxy: GeneratedGalaxy;
  baseScenario: SimulationScenario;
  routeId: string;
  onBack: () => void;
  onConfirmFares: (routeId: string, fares: CabinConfiguration) => void;
  onConfirmDirectionalFares: (routeId: string, direction: "outbound" | "return", fares: CabinConfiguration) => void;
  onDirectionalPricingLinked: (routeId: string, linked: boolean) => void;
  onCruiseRatioChange: (routeId: string, shipTypeId: string, ratio: number) => void;
  onSublightProfileChange: (routeId: string, shipTypeId: string, speed: number, thrustRatio: number) => void;
  onScheduleBufferChange: (routeId: string, minutes: number) => void;
  onSlotBidChange: (routeId: string, bid: number) => void;
  onWeeklyScheduleChange: (routeId: string, minutes: readonly number[]) => void;
}

const CABIN_LABELS = { economy: "经济舱", business: "商务舱", premium: "头等舱" } as const;
const TYPE_LABELS = { business: "商务", leisure: "休闲旅游", budget: "廉价", luxury: "高端" } as const;
const COST_LABELS: Record<Exclude<keyof RouteCostBreakdown, "total">, string> = {
  fuel: "燃料", staff: "人员", port: "港口", flightMaintenance: "飞行小时维护",
  fixedMaintenance: "固定维护", ageSurcharge: "船龄加价", depreciation: "折旧",
  delay: "预计延误", other: "其他",
};

function averageFares(route: GameState["routes"][number], services: ReturnType<typeof buildRouteServices>): CabinConfiguration {
  if (route.pricing.fareByClass) return { ...route.pricing.fareByClass };
  return Object.fromEntries(PASSENGER_CLASSES.map((cabinClass) => [
    cabinClass,
    services.length > 0 ? services.reduce((sum, service) => sum + service.fareByClass[cabinClass], 0) / services.length : 0,
  ])) as CabinConfiguration;
}

function aggregateHistory(records: readonly GameRouteDaySummary[]) {
  const days = Math.max(1, records.length);
  const cabins = (field: "capacityByClass" | "passengersByClass") => Object.fromEntries(PASSENGER_CLASSES.map((cabinClass) => [
    cabinClass,
    records.reduce((sum, record) => sum + record[field][cabinClass], 0),
  ])) as CabinConfiguration;
  const capacity = cabins("capacityByClass");
  const passengers = cabins("passengersByClass");
  const directions = Object.fromEntries((["outbound", "return"] as const).map((direction) => {
    const directionCapacity = Object.fromEntries(PASSENGER_CLASSES.map((cabinClass) => [cabinClass,
      records.reduce((sum, record) => sum + record.directions[direction].capacityByClass[cabinClass], 0),
    ])) as CabinConfiguration;
    const directionPassengers = Object.fromEntries(PASSENGER_CLASSES.map((cabinClass) => [cabinClass,
      records.reduce((sum, record) => sum + record.directions[direction].passengersByClass[cabinClass], 0),
    ])) as CabinConfiguration;
    return [direction, {
      capacityByClass: directionCapacity,
      passengersByClass: directionPassengers,
      loadFactorByClass: Object.fromEntries(PASSENGER_CLASSES.map((cabinClass) => [cabinClass,
        directionCapacity[cabinClass] > 0 ? directionPassengers[cabinClass] / directionCapacity[cabinClass] : 0,
      ])) as CabinConfiguration,
    }];
  })) as GameRouteDaySummary["directions"];
  return {
    revenue: records.reduce((sum, record) => sum + record.revenue, 0) / days,
    cost: records.reduce((sum, record) => sum + record.cost, 0) / days,
    profit: records.reduce((sum, record) => sum + record.profit, 0) / days,
    load: Object.fromEntries(PASSENGER_CLASSES.map((cabinClass) => [
      cabinClass, capacity[cabinClass] > 0 ? passengers[cabinClass] / capacity[cabinClass] : 0,
    ])) as CabinConfiguration,
    directions,
  };
}

function predictedDirections(
  routeOriginPortId: string,
  services: ReturnType<typeof buildRouteServices>,
  settlement: ReturnType<typeof simulateCampaign>["days"][number]["settlement"],
): GameRouteDaySummary["directions"] {
  const settlementById = new Map(settlement.services.map((service) => [service.serviceLegId, service]));
  return Object.fromEntries((["outbound", "return"] as const).map((direction) => {
    const matching = services.filter((service) =>
      direction === "outbound" ? service.fromPortId === routeOriginPortId : service.fromPortId !== routeOriginPortId,
    );
    const capacityByClass = Object.fromEntries(PASSENGER_CLASSES.map((cabinClass) => [cabinClass,
      matching.reduce((sum, service) => sum + (settlementById.get(service.id)?.capacityByClass[cabinClass] ?? 0), 0),
    ])) as CabinConfiguration;
    const passengersByClass = Object.fromEntries(PASSENGER_CLASSES.map((cabinClass) => [cabinClass,
      matching.reduce((sum, service) => sum + (settlementById.get(service.id)?.passengersByClass[cabinClass] ?? 0), 0),
    ])) as CabinConfiguration;
    return [direction, {
      capacityByClass,
      passengersByClass,
      loadFactorByClass: Object.fromEntries(PASSENGER_CLASSES.map((cabinClass) => [cabinClass,
        capacityByClass[cabinClass] > 0 ? passengersByClass[cabinClass] / capacityByClass[cabinClass] : 0,
      ])) as CabinConfiguration,
    }];
  })) as GameRouteDaySummary["directions"];
}

export function RouteEconomicsPanel({
  game,
  galaxy,
  baseScenario,
  routeId,
  onBack,
  onConfirmFares,
  onConfirmDirectionalFares,
  onDirectionalPricingLinked,
  onCruiseRatioChange,
  onSublightProfileChange,
  onScheduleBufferChange,
  onSlotBidChange,
  onWeeklyScheduleChange,
}: RouteEconomicsPanelProps) {
  const route = game.routes.find((candidate) => candidate.id === routeId);
  const [tab, setTab] = useState<"operations" | "schedule" | "rotations" | "passengers" | "pricing" | "costs">("operations");
  const [windowDays, setWindowDays] = useState<7 | 30 | 90>(7);
  const [curveClass, setCurveClass] = useState<PassengerClass>("economy");
  const [manualDay, setManualDay] = useState(0);
  const [manualTime, setManualTime] = useState("09:00");

  const currentScenario = useMemo(() => gameScenario(baseScenario, galaxy, game), [baseScenario, galaxy, game]);
  const scenarioRoutes = currentScenario.routes.filter((candidate) => candidate.id === routeId || candidate.parentRouteId === routeId);
  const scenarioRoute = scenarioRoutes[0];
  const services = useMemo(() => {
    return scenarioRoutes.flatMap((variant) => {
      const shipType = currentScenario.shipTypes.find((candidate) => candidate.id === variant.shipTypeId);
      if (!shipType) return [];
      return buildRouteServices(variant, shipType, currentScenario.ports, currentScenario.worldLegs, {
        companyReputation: currentScenario.companyReputation.player ?? 50,
        shipCondition: currentScenario.shipConditionByRoute?.[routeId] ?? 100,
      });
    });
  }, [currentScenario, routeId, scenarioRoutes]);
  const currentFares = useMemo(() => route ? averageFares(route, services) : { economy: 0, business: 0, premium: 0 }, [route, services]);
  const [draftFares, setDraftFares] = useState<CabinConfiguration>(currentFares);
  const [directionalFares, setDirectionalFares] = useState<Record<"outbound" | "return", CabinConfiguration>>({ outbound: currentFares, return: currentFares });
  useEffect(() => setDraftFares(currentFares), [currentFares.economy, currentFares.business, currentFares.premium, routeId]);
  useEffect(() => setDirectionalFares({
    outbound: { ...(route?.pricing.directionalFareByClass?.outbound ?? currentFares) },
    return: { ...(route?.pricing.directionalFareByClass?.return ?? currentFares) },
  }), [currentFares.economy, currentFares.business, currentFares.premium, routeId, route?.pricing.directionalFareByClass]);

  const simulateFares = (fares: CabinConfiguration) => {
    const pricingGame: GameState = {
      ...game,
      routes: game.routes.map((candidate) => candidate.id === routeId
        ? { ...candidate, pricing: { ...candidate.pricing, fareByClass: fares } }
        : candidate),
    };
    const scenario = gameScenario(baseScenario, galaxy, pricingGame);
    return {
      scenario,
      settlement: simulateCampaign(scenario, { startDay: game.day, numberOfDays: 1 }).days[0]!.settlement,
    };
  };

  const currentSettlement = useMemo(
    () => simulateCampaign(currentScenario, { startDay: game.day, numberOfDays: 1 }).days[0]!.settlement,
    [currentScenario, game.day],
  );
  const recommendations = useMemo(
    () => recommendRouteFares(routeId, services, currentSettlement.services),
    [currentSettlement.services, routeId, services],
  );
  const draftPrediction = useMemo(() => {
    const result = simulateFares(draftFares);
    return summarizeRouteEconomics(routeId, result.settlement);
  }, [baseScenario, draftFares, galaxy, game, routeId]);
  const curve = useMemo(() => buildFareCurveData(draftFares[curveClass], (fare) => {
    const result = simulateFares({ ...draftFares, [curveClass]: fare });
    const summary = summarizeRouteEconomics(routeId, result.settlement);
    return {
      passengers: summary.passengersByClass[curveClass],
      profit: summary.profit,
      revenue: summary.revenue,
    };
  }), [baseScenario, curveClass, draftFares, galaxy, game, routeId]);

  if (!route) return <main className="route-economics-page"><button onClick={onBack}>返回星图</button><p>航线不存在。</p></main>;

  const history = game.history.slice(-windowDays).map((day) => day.routes.find((candidate) => candidate.routeId === routeId)).filter((entry): entry is GameRouteDaySummary => !!entry);
  const latest = history.at(-1);
  const historyAverage = aggregateHistory(history);
  const displayedDirections = history.length > 0
    ? historyAverage.directions
    : predictedDirections(route.stops[0]!.portId, services, currentSettlement);
  const dirty = PASSENGER_CLASSES.some((cabinClass) => draftFares[cabinClass] !== currentFares[cabinClass]);
  const evaluations: readonly PassengerEvaluation[] = latest?.evaluations ?? PASSENGER_TYPES.map((passengerType) => {
    const entries = currentSettlement.markets.filter((market) => market.market.passengerType === passengerType && market.journeys.some((journey) =>
      journey.actualPassengers > 0 && journey.option.serviceLegIds.some((id) => id.startsWith(`${routeId}:`)),
    ));
    const routeJourneys = entries.flatMap((entry) => entry.journeys
      .filter((journey) => journey.actualPassengers > 0 && journey.option.serviceLegIds.some((id) => id.startsWith(`${routeId}:`)))
      .map((journey) => ({ journey, explanation: explainJourneyChoice(entry.market, journey.option) })));
    const passengers = routeJourneys.reduce((sum, entry) => sum + entry.journey.actualPassengers, 0);
    const reasons = routeJourneys.flatMap((entry) => [...entry.explanation.positive, ...entry.explanation.negative]);
    const uniqueReasons = [...reasons]
      .sort((a, b) => b.impact - a.impact)
      .filter((reason, index, ranked) => ranked.findIndex((candidate) => candidate.code === reason.code) === index);
    return {
      passengerType,
      passengers,
      satisfaction: passengers > 0 ? routeJourneys.reduce((sum, entry) => sum + entry.explanation.satisfaction * entry.journey.actualPassengers, 0) / passengers : 0,
      positiveReasons: uniqueReasons.filter((reason) => reason.positive).slice(0, 3),
      negativeReasons: uniqueReasons.filter((reason) => !reason.positive).slice(0, 3),
    };
  });
  const routeFlights = game.scheduledFlights.filter((flight) => flight.routeId === routeId);
  const routeShips = game.fleet.filter((ship) => ship.routeId === routeId);
  const routeTypeIds = [...new Set(routeShips.map((ship) => ship.shipTypeId))];
  const speedCurves = routeTypeIds.flatMap((shipTypeId) => {
    const type = currentScenario.shipTypes.find((candidate) => candidate.id === shipTypeId);
    const configuration = routeShips.find((ship) => ship.shipTypeId === shipTypeId)?.configurationId;
    const cabins = game.fleetConfigurations.find((candidate) => candidate.id === configuration)?.cabins;
    if (!type || !cabins || !route.routingMode) return [];
    const distance = services[0]?.distance ?? 1;
    const fare = Object.values(currentFares).reduce((sum, value) => sum + value, 0) / 3 * Object.values(cabins).reduce((sum, value) => sum + value, 0) * 0.7;
    return [{ type, curve: buildSpeedEconomicsCurve(type, distance, route.routingMode, cabins, fare, 0.7) }];
  });

  return (
    <main className="route-economics-page">
      <header className="route-detail-header">
        <button onClick={onBack}>← 返回星图</button>
        <div><span className="eyebrow">ROUTE ECONOMICS</span><h1>{route.name}</h1><p>{route.stops.map((stop) => galaxy.ports.find((port) => port.id === stop.portId)?.name ?? stop.portId).join(" → ")}</p></div>
        <div className={draftPrediction.profit >= 0 ? "route-profit positive-text" : "route-profit negative-text"}><span>预测日利润</span><strong>{formatCredits(draftPrediction.profit)}</strong></div>
      </header>

      <nav className="route-detail-tabs" aria-label="航线详情">
        {(["operations", "schedule", "rotations", "passengers", "pricing", "costs"] as const).map((entry) => <button key={entry} className={tab === entry ? "active" : ""} onClick={() => setTab(entry)}>{{ operations: "经营", schedule: "班表", rotations: "舰船轮转", passengers: "旅客", pricing: "价格", costs: "成本" }[entry]}</button>)}
      </nav>

      <div className="route-window-picker" aria-label="统计周期">
        {([7, 30, 90] as const).map((days) => <button key={days} className={windowDays === days ? "active" : ""} onClick={() => setWindowDays(days)}>最近 {days} 日</button>)}
        <span>{history.length > 0 ? `${history.length} 日实际记录` : "暂无历史，显示下一周期预测"}</span>
      </div>

      {tab === "operations" && <section className="route-detail-grid">
        <article className="route-detail-card span-2"><h2>双向分舱上座率</h2><div className="accessible-table"><table><thead><tr><th>方向</th>{PASSENGER_CLASSES.map((c) => <th key={c}>{CABIN_LABELS[c]}</th>)}</tr></thead><tbody>{(["outbound", "return"] as const).map((direction) => <tr key={direction}><th>{direction === "outbound" ? "去程" : "回程"}</th>{PASSENGER_CLASSES.map((c) => <td key={c}>{(displayedDirections[direction].loadFactorByClass[c] * 100).toFixed(1)}%</td>)}</tr>)}</tbody></table></div></article>
        <article className="route-detail-card"><h2>{windowDays} 日平均</h2><dl className="metric-list"><div><dt>票款收入</dt><dd>{formatCredits(history.length ? historyAverage.revenue : draftPrediction.revenue)}</dd></div><div><dt>完整成本</dt><dd>{formatCredits(history.length ? historyAverage.cost : draftPrediction.cost)}</dd></div><div><dt>净利润</dt><dd>{formatCredits(history.length ? historyAverage.profit : draftPrediction.profit)}</dd></div><div><dt>准点率</dt><dd>{((latest?.onTimeRate ?? services[0]?.onTimeRate ?? 0) * 100).toFixed(1)}%</dd></div></dl></article>
        <article className="route-detail-card span-3"><h2>收入、成本与净利润历史</h2><div className="history-bars" aria-hidden="true">{history.map((record) => <i key={record.routeId + record.revenue + record.profit} style={{ height: `${Math.min(100, Math.max(5, Math.abs(record.profit) / Math.max(1, record.revenue) * 100))}%` }} className={record.profit >= 0 ? "positive" : "negative"} />)}</div><div className="accessible-table"><table><thead><tr><th>日期</th><th>收入</th><th>完整成本</th><th>净利润</th></tr></thead><tbody>{game.history.slice(-windowDays).map((day) => { const record = day.routes.find((candidate) => candidate.routeId === routeId); return record ? <tr key={day.day}><td>第 {day.day} 日</td><td>{formatCredits(record.revenue)}</td><td>{formatCredits(record.cost)}</td><td>{formatCredits(record.profit)}</td></tr> : null; })}</tbody></table></div></article>
      </section>}

      {tab === "schedule" && <section className="route-detail-grid">
        <article className="route-detail-card span-3"><div className="section-heading-row"><div><h2>周班模板与轮转缓冲</h2><p>留空时自动均匀排班；手动时刻与缓冲严格按五分钟保存。</p></div><div className="manual-schedule-editor"><select value={manualDay} onChange={(event) => setManualDay(Number(event.target.value))}>{["周一", "周二", "周三", "周四", "周五", "周六", "周日"].map((label, index) => <option key={label} value={index}>{label}</option>)}</select><input type="time" step="300" value={manualTime} onChange={(event) => setManualTime(event.target.value)}/><button onClick={() => { const [hours, minutes] = manualTime.split(":").map(Number); onWeeklyScheduleChange(routeId, [...(route.weeklyDepartureMinutes ?? []), manualDay * 1_440 + hours! * 60 + minutes!]); }}>添加时刻</button></div></div><label className="buffer-control"><span>每航段计划缓冲：{route.scheduleBufferMinutes ?? 0} 分钟（越多越稳，但利用率越低）</span><input type="range" min="0" max="360" step="5" value={route.scheduleBufferMinutes ?? 0} onChange={(event) => onScheduleBufferChange(routeId, Number(event.target.value))}/></label><label className="buffer-control"><span>时隙申请费：{route.slotBidPerMovement ?? 0} Cr/movement（长期时隙和有限基地优势之后参与排序）</span><input type="range" min="0" max="500" step="10" value={route.slotBidPerMovement ?? 0} onChange={(event) => onSlotBidChange(routeId, Number(event.target.value))}/></label><div className="schedule-chip-list">{(route.weeklyDepartureMinutes ?? []).map((minute) => <button key={minute} onClick={() => onWeeklyScheduleChange(routeId, (route.weeklyDepartureMinutes ?? []).filter((entry) => entry !== minute))}>周{Math.floor(minute / 1_440) + 1} {String(Math.floor(minute % 1_440 / 60)).padStart(2, "0")}:{String(minute % 60).padStart(2, "0")} ×</button>)}{!route.weeklyDepartureMinutes?.length && <span>自动均匀排班</span>}</div></article>
        <article className="route-detail-card span-3"><h2>未来七日五分钟班表</h2><div className="accessible-table"><table><thead><tr><th>航班</th><th>执行舰船 / 型号</th><th>计划起飞</th><th>实际抵达</th><th>时隙 / 晚点 / 赔付</th></tr></thead><tbody>{routeFlights.map((flight) => <tr key={flight.id}><td>{galaxy.ports.find((port) => port.id === flight.fromPortId)?.name} → {galaxy.ports.find((port) => port.id === flight.toPortId)?.name}</td><td>{game.fleet.find((ship) => ship.id === flight.shipId)?.name} · {currentScenario.shipTypes.find((type) => type.id === flight.shipTypeId)?.name}{flight.replacementShipId ? `（替代 ${flight.originalShipId}）` : ""}</td><td>{formatScheduleMinute(flight.scheduledDepartureMinute)}</td><td>{flight.status === "cancelled" ? "取消" : formatScheduleMinute(flight.arrivalMinute)}</td><td>{flight.departureSlotStatus}/{flight.arrivalSlotStatus} · {flight.delayMinutes} 分 / {(flight.compensationRate * 100).toFixed(0)}%</td></tr>)}</tbody></table></div></article>
      </section>}

      {tab === "rotations" && <section className="route-detail-grid"><article className="route-detail-card span-3"><h2>各型号速度、推力与经济性</h2><p>巡航速度影响持续星际燃料消耗；亚光速只在加减速时消耗燃料，目标速度会按制动距离自动封顶。</p>{speedCurves.map(({ type, curve }) => { const ratio = route.cruiseRatioByShipType?.[type.id] ?? 1; const sublightSpeed = route.sublightTargetSpeedKmPerSecondByShipType?.[type.id] ?? Math.min(80, type.maximumSublightSpeedKmPerSecond ?? 80); const thrustRatio = route.sublightThrustRatioByShipType?.[type.id] ?? type.fuelOptimalThrustRatio ?? .72; const selected = curve.points.reduce((best, point) => Math.abs(point.cruiseRatio - ratio) < Math.abs(best.cruiseRatio - ratio) ? point : best); return <div className="speed-economics-row" key={type.id}><div><strong>{type.name}</strong><small>{routeShips.filter((ship) => ship.shipTypeId === type.id).length} 艘 · 自重 {type.structuralMassTonnes} t · 比冲 {type.sublightSpecificImpulseSeconds?.toFixed(0)} s · 星际效率 {type.interstellarEfficiencyLyPerFuelTonneMass?.toFixed(0)} ly/(t燃料·t船重)</small></div><label>星际巡航 {(ratio * 100).toFixed(0)}%<input type="range" min={type.minimumCruiseRatio ?? .7} max={type.maximumCruiseRatio ?? 1.1} step="0.025" value={ratio} onChange={(event) => onCruiseRatioChange(routeId, type.id, Number(event.target.value))}/></label><label>亚光速目标 {sublightSpeed.toFixed(1)} km/s<input type="range" min="1" max={type.maximumSublightSpeedKmPerSecond ?? 120} step="1" value={sublightSpeed} onChange={(event) => onSublightProfileChange(routeId, type.id, Number(event.target.value), thrustRatio)}/></label><label>推力 {(thrustRatio * 100).toFixed(0)}%<input type="range" min="0.25" max="1" step="0.025" value={thrustRatio} onChange={(event) => onSublightProfileChange(routeId, type.id, sublightSpeed, Number(event.target.value))}/></label><span>星际燃料消耗 {selected.fuelUnits.toFixed(1)} t · {selected.travelHours.toFixed(1)} h · {selected.departuresPerWeek.toFixed(2)} 班/周 · 预计 {formatCredits(selected.projectedProfit)}</span><em>燃料最佳 {(curve.fuelOptimalRatio * 100).toFixed(0)}% · 成本最佳 {(curve.costOptimalRatio * 100).toFixed(0)}% · 利润最佳 {(curve.profitOptimalRatio * 100).toFixed(0)}%</em></div>; })}<h3>型号 / 当前速度方案横向对比</h3><div className="accessible-table"><table><thead><tr><th>型号</th><th>速度</th><th>燃料消耗</th><th>单班成本</th><th>航时</th><th>班次/周</th><th>技术延误</th><th>预测利润</th></tr></thead><tbody>{speedCurves.map(({ type, curve }) => { const ratio = route.cruiseRatioByShipType?.[type.id] ?? 1; const point = curve.points.reduce((best, candidate) => Math.abs(candidate.cruiseRatio - ratio) < Math.abs(best.cruiseRatio - ratio) ? candidate : best); return <tr key={type.id}><td>{type.name}</td><td>{(point.cruiseRatio * 100).toFixed(0)}%</td><td>{point.fuelUnits.toFixed(1)} t</td><td>{formatCredits(point.fuelUnits + point.maintenanceCost + point.crewCost)}</td><td>{point.travelHours.toFixed(1)}h</td><td>{point.departuresPerWeek.toFixed(2)}</td><td>{(point.technicalDelayProbability * 100).toFixed(1)}%</td><td>{formatCredits(point.projectedProfit)}</td></tr>; })}</tbody></table></div></article><article className="route-detail-card span-3"><h2>舰船事件日志</h2><div className="ship-log-list">{game.shipLogs.filter((entry) => routeFlights.some((flight) => flight.id === entry.flightId)).slice(-80).reverse().map((entry) => <div key={entry.id}><time>{formatScheduleMinute(entry.minute)}</time><strong>{game.fleet.find((ship) => ship.id === entry.shipId)?.name}</strong><span>{entry.detail}</span></div>)}</div></article></section>}

      {tab === "passengers" && <section className="passenger-evaluation-grid">{evaluations.map((evaluation) => <article className="route-detail-card" key={evaluation.passengerType}><div className="evaluation-heading"><h2>{TYPE_LABELS[evaluation.passengerType]}</h2><strong>{evaluation.satisfaction.toFixed(0)} / 100</strong></div><p>{formatNumber(evaluation.passengers)} 名实际旅客{latest ? ` · 请求 ${formatNumber(latest.requestedByType[evaluation.passengerType])} · 不出行 ${formatNumber(latest.noTravelByType[evaluation.passengerType])} · 运力流失 ${formatNumber(latest.capacityLostByType[evaluation.passengerType])}` : ""}</p><h3>主要满意点</h3><ul className="reason-list positive">{evaluation.positiveReasons.map((reason) => <li key={reason.code + reason.text}>{reason.text}</li>)}{evaluation.positiveReasons.length === 0 && <li>暂无足够实际数据</li>}</ul><h3>主要不满意点</h3><ul className="reason-list negative">{evaluation.negativeReasons.map((reason) => <li key={reason.code + reason.text}>{reason.text}</li>)}{evaluation.negativeReasons.length === 0 && <li>暂无显著负面因素</li>}</ul></article>)}</section>}

      {tab === "pricing" && <section className="route-detail-grid">
        <article className="route-detail-card span-3"><div className="section-heading-row"><div><h2>三舱数字定价</h2><p>修改先进入预测，确认后才影响结算。浏览器原生撤销可恢复键盘输入。</p></div>{dirty && <span className="status-pill">未确认修改</span>}</div><div className="cabin-fare-editor">{PASSENGER_CLASSES.map((cabinClass) => <label key={cabinClass}><span>{CABIN_LABELS[cabinClass]}</span><input type="number" min="0" step="10" value={draftFares[cabinClass]} onChange={(event) => setDraftFares((current) => ({ ...current, [cabinClass]: Math.max(0, Number(event.target.value) || 0) }))}/><small>当前 {currentFares[cabinClass].toFixed(0)} · 盈亏平衡 {recommendations[cabinClass].breakEvenFare.toFixed(0)} · 推荐 {recommendations[cabinClass].recommendedFare.toFixed(0)} Cr {recommendations[cabinClass].confidence === "low" ? "· 低置信度" : ""}</small><button onClick={() => setDraftFares((current) => ({ ...current, [cabinClass]: Math.round(recommendations[cabinClass].recommendedFare / 10) * 10 }))}>恢复推荐</button></label>)}</div><div className="pricing-actions"><button onClick={() => setDraftFares(currentFares)} disabled={!dirty}>撤销未确认修改</button><button className="primary-action" onClick={() => onConfirmFares(routeId, draftFares)} disabled={!dirty}>确认三舱票价</button></div></article>
        <article className="route-detail-card span-3"><label><input type="checkbox" checked={route.directionalPricingLinked !== false} onChange={(event) => onDirectionalPricingLinked(routeId, event.target.checked)}/> 去程与回程分舱票价联动（默认开启；关闭后可分别确认）</label></article>
        {(["outbound", "return"] as const).map((direction) => <article className="route-detail-card" key={direction}><h2>{direction === "outbound" ? "去程" : "回程"}独立票价</h2><div className="directional-fares">{PASSENGER_CLASSES.map((cabinClass) => <label key={cabinClass}><span>{CABIN_LABELS[cabinClass]}</span><input type="number" min="0" step="10" value={directionalFares[direction][cabinClass]} onChange={(event) => setDirectionalFares((current) => ({ ...current, [direction]: { ...current[direction], [cabinClass]: Math.max(0, Number(event.target.value) || 0) } }))}/></label>)}</div><button onClick={() => onConfirmDirectionalFares(routeId, direction, directionalFares[direction])}>确认{direction === "outbound" ? "去程" : "回程"}票价</button></article>)}
        <article className="route-detail-card span-3"><div className="section-heading-row"><div><h2>价格—客流—利润预测</h2><p>基于当前平行航线与 AI 直达竞争；区间表示 ±8% 需求不确定性。</p></div><div className="curve-class-picker">{PASSENGER_CLASSES.map((c) => <button key={c} className={curveClass === c ? "active" : ""} onClick={() => setCurveClass(c)}>{CABIN_LABELS[c]}</button>)}</div></div><div className="accessible-table"><table><thead><tr><th>票价</th><th>预计客流区间</th><th>预计利润区间</th></tr></thead><tbody>{curve.map((point) => <tr key={point.fare}><td>{point.fare} Cr</td><td>{formatNumber(point.passengerLow)}–{formatNumber(point.passengerHigh)}</td><td>{formatCredits(point.profitLow)}–{formatCredits(point.profitHigh)}</td></tr>)}</tbody></table></div></article>
      </section>}

      {tab === "costs" && <section className="route-detail-grid"><article className="route-detail-card span-2"><h2>完整成本堆叠</h2><div className="cost-stack" aria-hidden="true">{(Object.keys(COST_LABELS) as (keyof typeof COST_LABELS)[]).map((key) => <i key={key} title={COST_LABELS[key]} style={{ flex: draftPrediction.costBreakdown[key] }} />)}</div><div className="accessible-table"><table><thead><tr><th>成本项</th><th>预测/日</th><th>占比</th></tr></thead><tbody>{(Object.keys(COST_LABELS) as (keyof typeof COST_LABELS)[]).map((key) => <tr key={key}><td>{COST_LABELS[key]}</td><td>{formatCredits(draftPrediction.costBreakdown[key])}</td><td>{draftPrediction.cost > 0 ? `${(draftPrediction.costBreakdown[key] / draftPrediction.cost * 100).toFixed(1)}%` : "0%"}</td></tr>)}</tbody><tfoot><tr><th>完整成本</th><th>{formatCredits(draftPrediction.cost)}</th><th>100%</th></tr></tfoot></table></div></article><article className="route-detail-card"><h2>成本核对</h2><dl className="metric-list"><div><dt>票款收入</dt><dd>{formatCredits(draftPrediction.revenue)}</dd></div><div><dt>减：完整成本</dt><dd>{formatCredits(draftPrediction.cost)}</dd></div><div><dt>严格等于净利润</dt><dd>{formatCredits(draftPrediction.revenue - draftPrediction.cost)}</dd></div><div><dt>利润率</dt><dd>{(draftPrediction.margin * 100).toFixed(1)}%</dd></div></dl></article></section>}
    </main>
  );
}
