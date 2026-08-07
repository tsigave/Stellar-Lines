import { useEffect, useMemo, useState } from "react";
import {
  CABIN_SPACE_PER_SEAT,
  cabinSpaceUsed,
  compareTechnicalStop,
  currentFuelPrice,
  defaultBuildForShipType,
  directionalEfficiencyAt,
  FTL_DRIVE_MODELS,
  ftlKAtSpeed,
  fleetConfigurationForShip,
  fleetFixedMaintenanceCost,
  missionProfileForRoute,
  quoteShipPurchaseAgreement,
  hullVariantFromShipType,
  OPTIONAL_MODULES,
  resolveShipMission,
  SUBLIGHT_ENGINE_MODELS,
  shipAgeYears,
  shipComfortAtAge,
  shipMaintenanceCost,
  shipMaintenanceState,
  shipResaleValue,
  shipyardOfferFor,
  type CabinConfiguration,
  type FleetConfiguration,
  type GameState,
  type GeneratedGalaxy,
  type OwnedShip,
  type ShipPurchaseLineInput,
  type ShipBuildConfiguration,
  type ShipType,
} from "../../index.js";
import { formatCredits } from "../format.js";

interface FleetPanelProps {
  game: GameState;
  galaxy: GeneratedGalaxy;
  shipTypes: readonly ShipType[];
  onPlacePurchaseAgreement: (lines: readonly ShipPurchaseLineInput[]) => void;
  onCreateConfiguration: (
    shipTypeId: string,
    name: string,
    cabins: CabinConfiguration,
    build?: ShipBuildConfiguration,
  ) => void;
  onUpdateConfiguration: (
    configurationId: string,
    name: string,
    cabins: CabinConfiguration,
    build?: ShipBuildConfiguration,
  ) => void;
  onAssignShips: (configurationId: string, shipIds: readonly string[]) => void;
  onMaintainShip: (shipId: string) => void;
  onReplaceShip: (shipId: string) => void;
  onSellShip: (shipId: string) => void;
  onAutoMaintenanceThresholdChange: (threshold: number) => void;
  onAutoReplacementAgeChange: (ageYears: number | null) => void;
}

const MAINTENANCE_LABELS = {
  ready: "状态良好",
  due: "维护到期",
  required: "强制停航",
  maintenance: "维护中",
} as const;

function CabinInputs({
  cabins,
  disabled = false,
  onChange,
}: {
  cabins: CabinConfiguration;
  disabled?: boolean;
  onChange: (cabins: CabinConfiguration) => void;
}) {
  const update = (passengerClass: keyof CabinConfiguration, value: number) =>
    onChange({ ...cabins, [passengerClass]: Math.max(0, Math.floor(value || 0)) });
  return (
    <div className="cabin-editor">
      <label><span>头等</span><small>每座占 {CABIN_SPACE_PER_SEAT.premium}</small><input type="number" min="0" value={cabins.premium} disabled={disabled} onChange={(event) => update("premium", Number(event.target.value))} /></label>
      <label><span>商务</span><small>每座占 {CABIN_SPACE_PER_SEAT.business}</small><input type="number" min="0" value={cabins.business} disabled={disabled} onChange={(event) => update("business", Number(event.target.value))} /></label>
      <label><span>经济</span><small>每座占 {CABIN_SPACE_PER_SEAT.economy}</small><input type="number" min="0" value={cabins.economy} disabled={disabled} onChange={(event) => update("economy", Number(event.target.value))} /></label>
    </div>
  );
}

function ConfigurationCard({
  configuration,
  type,
  ships,
  game,
  onUpdate,
  onAssignShips,
}: {
  configuration: FleetConfiguration;
  type: ShipType;
  ships: readonly OwnedShip[];
  game: GameState;
  onUpdate: FleetPanelProps["onUpdateConfiguration"];
  onAssignShips: FleetPanelProps["onAssignShips"];
}) {
  const [name, setName] = useState(configuration.name);
  const [cabins, setCabins] = useState<CabinConfiguration>({ ...configuration.cabins });
  const [selectedShipIds, setSelectedShipIds] = useState<string[]>([]);
  useEffect(() => {
    setName(configuration.name);
    setCabins({ ...configuration.cabins });
  }, [configuration]);
  const assigned = ships.filter((ship) => ship.configurationId === configuration.id);
  const locked = assigned.some((ship) => ship.routeId !== null);
  const usedSpace = cabinSpaceUsed(cabins);
  const invalid = usedSpace > type.cabinSpace || usedSpace === 0;
  const eligibleShips = ships.filter((ship) =>
    ship.routeId === null && shipMaintenanceState(ship, game.day) !== "maintenance"
  );

  return (
    <article className="fleet-configuration-card">
      <div className="configuration-heading">
        <input value={name} disabled={locked} onChange={(event) => setName(event.target.value)} aria-label="配置方案名称" />
        <span>{assigned.length} 艘已分配</span>
      </div>
      <small>{SUBLIGHT_ENGINE_MODELS.find((engine) => engine.id === configuration.build.sublightEngineModelId)?.model ?? configuration.build.sublightEngineModelId} · {FTL_DRIVE_MODELS.find((drive) => drive.id === configuration.build.ftlDriveModelId)?.model ?? "无 FTL"} · 模块 {configuration.build.optionalModuleIds.length}</small>
      <div className="cabin-editor-heading">
        <strong>统一客舱方案</strong>
        <span className={invalid ? "over-capacity" : ""}>{usedSpace} / {type.cabinSpace} 空间</span>
      </div>
      <CabinInputs cabins={cabins} disabled={locked} onChange={setCabins} />
      <p className="automatic-fuel-note">燃料不属于配置，系统按抵达储备吨数反向求解每次任务的真实装载量。</p>
      <button className="save-configuration" disabled={locked || invalid} onClick={() => onUpdate(configuration.id, name, cabins)}>
        {locked ? "方案正在执行航线" : "保存统一方案"}
      </button>

      <div className="configuration-assignment">
        <strong>将同型舰船分配到此方案</strong>
        <div>
          {eligibleShips.map((ship) => (
            <label key={ship.id}>
              <input
                type="checkbox"
                checked={selectedShipIds.includes(ship.id)}
                onChange={() => setSelectedShipIds((current) => current.includes(ship.id)
                  ? current.filter((shipId) => shipId !== ship.id)
                  : [...current, ship.id])}
              />
              <span>{ship.name}</span>
              <small>{ship.configurationId === configuration.id ? "当前方案" : ship.configurationId ? "将从其他方案调入" : "未配置"}</small>
            </label>
          ))}
        </div>
        <button disabled={selectedShipIds.length === 0} onClick={() => {
          onAssignShips(configuration.id, selectedShipIds);
          setSelectedShipIds([]);
        }}>分配 {selectedShipIds.length} 艘</button>
      </div>
    </article>
  );
}

function NewConfigurationCard({
  type,
  build,
  onCreate,
}: {
  type: ShipType;
  build: ShipBuildConfiguration;
  onCreate: FleetPanelProps["onCreateConfiguration"];
}) {
  const [name, setName] = useState("");
  const [cabins, setCabins] = useState<CabinConfiguration>({ premium: 0, business: 0, economy: 0 });
  const usedSpace = cabinSpaceUsed(cabins);
  const invalid = usedSpace > type.cabinSpace || usedSpace === 0;
  return (
    <article className="fleet-configuration-card new-configuration-card">
      <div className="configuration-heading"><strong>新建配置方案</strong><span>{type.name}</span></div>
      <input value={name} placeholder="例如：短程全经济 / 商务快线" onChange={(event) => setName(event.target.value)} aria-label="新配置方案名称" />
      <div className="cabin-editor-heading"><strong>统一客舱方案</strong><span className={invalid ? "over-capacity" : ""}>{usedSpace} / {type.cabinSpace} 空间</span></div>
      <CabinInputs cabins={cabins} onChange={setCabins} />
      <p className="automatic-fuel-note">系统按船体、客舱、实际旅客质量、航段和抵达储备自动反算燃料。</p>
      <button className="save-configuration" disabled={invalid} onClick={() => {
        onCreate(type.id, name, cabins, { ...build, cabins });
        setName("");
        setCabins({ premium: 0, business: 0, economy: 0 });
      }}>创建方案</button>
    </article>
  );
}

function OwnedShipCard({ ship, type, game, onMaintainShip, onReplaceShip, onSellShip }: {
  ship: OwnedShip;
  type: ShipType;
  game: GameState;
  onMaintainShip: (shipId: string) => void;
  onReplaceShip: (shipId: string) => void;
  onSellShip: (shipId: string) => void;
}) {
  const maintenance = shipMaintenanceState(ship, game.day);
  const configuration = fleetConfigurationForShip(game, ship);
  const ageYears = shipAgeYears(ship, game.day);
  const effectiveComfort = shipComfortAtAge(ship, type, game.day);
  const pendingAssignment = game.pendingFleetChanges.some((change) => change.shipId === ship.id && change.status === "pending" && change.toRouteId !== null);
  const replacementPending = game.shipPurchaseOrders.some((order) => order.replacementShipIds?.includes(ship.id));
  const saleBlocked = !!ship.routeId || !!ship.plannedRouteId || !!ship.reserveForRouteId || pendingAssignment || replacementPending;
  return (
    <article className={`fleet-ship-card ${maintenance}`}>
      <div className="fleet-card-heading">
        <div><strong>{ship.name}</strong><span>{type.familyName} · {type.variant} · {ship.routeId ? "执行航线" : "基地待命"}</span></div>
        <em>{MAINTENANCE_LABELS[maintenance]}</em>
      </div>
      <div className="ship-configuration-summary">
        <span>配置方案</span><strong>{configuration?.name ?? "未分配"}</strong>
        {configuration && <small>头等 {configuration.cabins.premium} · 商务 {configuration.cabins.business} · 经济 {configuration.cabins.economy} · 抵达储备 {configuration.build.destinationReserveTonnes.toFixed(1)} t</small>}
      </div>
      <div className="fleet-condition-row"><span>维护值 {ship.condition.toFixed(0)}%</span><span>本周期 {ship.flightHoursSinceMaintenance.toFixed(0)} 小时</span></div>
      <div className="ship-age-summary"><span>船龄 {ageYears.toFixed(1)} 年</span><span>舒适度 {effectiveComfort.toFixed(1)} / {type.comfort}</span><span>估值 {formatCredits(shipResaleValue(ship, type, game.day))}</span></div>
      <div className="maintenance-meter"><i style={{ width: `${ship.condition}%` }} /></div>
      <div className="fleet-card-actions">
        <button disabled={maintenance === "maintenance" || game.cash < shipMaintenanceCost(type)} onClick={() => onMaintainShip(ship.id)}>
          {maintenance === "maintenance" ? `维护至第 ${ship.maintenanceUntilDay} 日` : `大修 ${formatCredits(shipMaintenanceCost(type))}`}
        </button>
        <button disabled={replacementPending} onClick={() => onReplaceShip(ship.id)}>订购同型替代</button>
        <button className="sell-ship-button" disabled={saleBlocked} title={saleBlocked ? "只有未分配、未预定且未设为备用的舰船可以出售" : ""} onClick={() => {
          if (window.confirm(`出售 ${ship.name}？预计回收 ${formatCredits(shipResaleValue(ship, type, game.day))}。`)) onSellShip(ship.id);
        }}>出售舰船</button>
      </div>
    </article>
  );
}

function EfficiencyCurveChart({
  title,
  xLabel,
  yLabel,
  points,
  currentX,
  currentY,
  xFormatter,
  yFormatter,
  lowerIsBetter = false,
}: {
  title: string;
  xLabel: string;
  yLabel: string;
  points: readonly { x: number; y: number }[];
  currentX: number;
  currentY: number;
  xFormatter: (value: number) => string;
  yFormatter: (value: number) => string;
  lowerIsBetter?: boolean;
}) {
  const sorted = [...points].sort((left, right) => left.x - right.x);
  const width = 560;
  const height = 220;
  const plot = { left: 58, right: 18, top: 18, bottom: 44 };
  const xMin = sorted[0]?.x ?? 0;
  const xMax = sorted.at(-1)?.x ?? 1;
  const rawYMin = Math.min(...sorted.map((point) => point.y), currentY);
  const rawYMax = Math.max(...sorted.map((point) => point.y), currentY);
  const yPadding = Math.max((rawYMax - rawYMin) * 0.22, Math.abs(rawYMax) * 0.025, 0.01);
  const yMin = rawYMin - yPadding;
  const yMax = rawYMax + yPadding;
  const plotWidth = width - plot.left - plot.right;
  const plotHeight = height - plot.top - plot.bottom;
  const scaleX = (value: number) => plot.left + (value - xMin) / Math.max(1e-9, xMax - xMin) * plotWidth;
  const scaleY = (value: number) => plot.top + (yMax - value) / Math.max(1e-9, yMax - yMin) * plotHeight;
  const polyline = sorted.map((point) => `${scaleX(point.x)},${scaleY(point.y)}`).join(" ");
  const xTicks = Array.from({ length: 5 }, (_, index) => xMin + (xMax - xMin) * index / 4);
  const yTicks = Array.from({ length: 4 }, (_, index) => yMax - (yMax - yMin) * index / 3);
  const markerX = scaleX(Math.max(xMin, Math.min(xMax, currentX)));
  const markerY = scaleY(currentY);
  return (
    <section className="efficiency-curve-panel" aria-label={title}>
      <div className="efficiency-curve-heading"><div><strong>{title}</strong><small>{lowerIsBetter ? "燃料系数越低越省" : "定向效率越高越省"}</small></div><span>当前：{xFormatter(currentX)} · {yFormatter(currentY)}</span></div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}，横轴${xLabel}，纵轴${yLabel}`}>
        {yTicks.map((tick) => <g key={`y-${tick}`}><line x1={plot.left} x2={width - plot.right} y1={scaleY(tick)} y2={scaleY(tick)} /><text x={plot.left - 8} y={scaleY(tick) + 4} textAnchor="end">{yFormatter(tick)}</text></g>)}
        {xTicks.map((tick) => <g key={`x-${tick}`}><line x1={scaleX(tick)} x2={scaleX(tick)} y1={plot.top} y2={height - plot.bottom} /><text x={scaleX(tick)} y={height - 24} textAnchor="middle">{xFormatter(tick)}</text></g>)}
        <polyline points={polyline} />
        {sorted.map((point) => <circle className="curve-point" key={`${point.x}-${point.y}`} cx={scaleX(point.x)} cy={scaleY(point.y)} r="3.5"><title>{xFormatter(point.x)} · {yFormatter(point.y)}</title></circle>)}
        <line className="current-guide" x1={markerX} x2={markerX} y1={plot.top} y2={height - plot.bottom} />
        <circle className="current-point" cx={markerX} cy={markerY} r="5"><title>当前：{xFormatter(currentX)} · {yFormatter(currentY)}</title></circle>
        <text className="axis-label x-axis-label" x={plot.left + plotWidth / 2} y={height - 4} textAnchor="middle">{xLabel}</text>
        <text className="axis-label y-axis-label" x="13" y={plot.top + plotHeight / 2} textAnchor="middle" transform={`rotate(-90 13 ${plot.top + plotHeight / 2})`}>{yLabel}</text>
      </svg>
    </section>
  );
}

export function FleetPanel({
  game,
  galaxy,
  shipTypes,
  onPlacePurchaseAgreement,
  onCreateConfiguration,
  onUpdateConfiguration,
  onAssignShips,
  onMaintainShip,
  onReplaceShip,
  onSellShip,
  onAutoMaintenanceThresholdChange,
  onAutoReplacementAgeChange,
}: FleetPanelProps) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [purchaseCart, setPurchaseCart] = useState<Record<string, number>>({});
  const [purchaseBuilds, setPurchaseBuilds] = useState<Record<string, ShipBuildConfiguration>>({});
  const [purchaseTargetRouteId, setPurchaseTargetRouteId] = useState("standby");
  const familyGroups = useMemo(() => {
    const groups = new Map<string, { id: string; name: string; manufacturer: string; types: ShipType[] }>();
    for (const type of shipTypes) {
      const existing = groups.get(type.familyId);
      if (existing) existing.types.push(type);
      else groups.set(type.familyId, { id: type.familyId, name: type.familyName, manufacturer: type.manufacturer, types: [type] });
    }
    for (const group of groups.values()) {
      group.types.sort((left, right) => left.variant.localeCompare(right.variant, "zh-CN", { numeric: true }));
    }
    return [...groups.values()];
  }, [shipTypes]);
  const [openFamilyId, setOpenFamilyId] = useState(() => shipTypes[0]?.familyId ?? "");
  const [selectedCatalogTypeId, setSelectedCatalogTypeId] = useState(() => shipTypes[0]?.id ?? "");
  const selectedCatalogType = shipTypes.find((type) => type.id === selectedCatalogTypeId) ?? shipTypes[0];
  const [draftBuild, setDraftBuild] = useState<ShipBuildConfiguration>(() => defaultBuildForShipType(shipTypes[0]!));
  const [missionProfileSource, setMissionProfileSource] = useState("virtual");
  const [virtualDepartureDistance, setVirtualDepartureDistance] = useState(0.15);
  const [virtualInterstellarDistance, setVirtualInterstellarDistance] = useState(12);
  const [virtualArrivalDistance, setVirtualArrivalDistance] = useState(0.15);
  const [missionPassengers, setMissionPassengers] = useState(40);
  const [missionReserve, setMissionReserve] = useState(0);
  const [missionSpeed, setMissionSpeed] = useState(6);
  const [missionThrustRatio, setMissionThrustRatio] = useState(0.8);
  const [visibleEfficiencyCurve, setVisibleEfficiencyCurve] = useState<"sublight" | "ftl" | null>(null);
  useEffect(() => {
    if (selectedCatalogType) {
      const build = defaultBuildForShipType(selectedCatalogType);
      setDraftBuild(build);
      const drive = FTL_DRIVE_MODELS.find((candidate) => candidate.id === build.ftlDriveModelId);
      const engine = SUBLIGHT_ENGINE_MODELS.find((candidate) => candidate.id === build.sublightEngineModelId);
      if (drive) setMissionSpeed(drive.maximumSpeedLyPerDay);
      if (engine) setMissionThrustRatio(engine.economyThrustRatio);
      setMissionPassengers((current) => Math.min(current, selectedCatalogType.seats));
    }
  }, [selectedCatalogType?.id]);
  const selectedHull = selectedCatalogType ? hullVariantFromShipType(selectedCatalogType) : null;
  const selectedEngine = SUBLIGHT_ENGINE_MODELS.find((engine) => engine.id === draftBuild.sublightEngineModelId);
  const selectedDrive = FTL_DRIVE_MODELS.find((drive) => drive.id === draftBuild.ftlDriveModelId);
  const selectedEngineCount = selectedHull?.sublightEngineCount ?? 0;
  const currentSublightEfficiency = selectedEngine
    ? directionalEfficiencyAt(selectedEngine, missionThrustRatio)
    : 0;
  const economySublightEfficiency = selectedEngine
    ? directionalEfficiencyAt(selectedEngine, selectedEngine.economyThrustRatio)
    : 0;
  const currentFtlK = selectedDrive ? ftlKAtSpeed(selectedDrive, missionSpeed) : 0;
  const optimalFtlK = selectedDrive ? ftlKAtSpeed(selectedDrive, selectedDrive.optimalSpeedLyPerDay) : 0;
  const routeProfileResult = useMemo(() => {
    if (missionProfileSource === "virtual") return {
      profile: {
        departureSublightDistanceAu: virtualDepartureDistance,
        interstellarDistanceLightYears: virtualInterstellarDistance,
        arrivalSublightDistanceAu: virtualArrivalDistance,
      },
      error: null as string | null,
    };
    const route = game.routes.find((candidate) => candidate.id === missionProfileSource);
    if (!route || !selectedDrive) return { profile: null, error: "当前配置没有可用于该航线的 FTL 驱动器" };
    try {
      return { profile: missionProfileForRoute(route, galaxy.ports, galaxy.worldLegs, selectedDrive.mode), error: null as string | null };
    } catch (caught) {
      return { profile: null, error: caught instanceof Error ? caught.message : "无法解析航线任务剖面" };
    }
  }, [galaxy.ports, galaxy.worldLegs, game.routes, missionProfileSource, selectedDrive, virtualArrivalDistance, virtualDepartureDistance, virtualInterstellarDistance]);
  const missionInput = selectedCatalogType && selectedHull && routeProfileResult.profile ? {
    build: { ...draftBuild, destinationReserveTonnes: missionReserve },
    hull: selectedHull,
    distanceLightYears: routeProfileResult.profile.interstellarDistanceLightYears,
    passengerCount: missionPassengers,
    ftlSpeedLyPerDay: missionSpeed,
    thrustRatio: missionThrustRatio,
    departureSublightDistanceAu: routeProfileResult.profile.departureSublightDistanceAu,
    arrivalSublightDistanceAu: routeProfileResult.profile.arrivalSublightDistanceAu,
  } : null;
  const resolvedMission = useMemo(() => selectedCatalogType && selectedHull && missionInput
    ? resolveShipMission(missionInput!)
    : null, [missionInput, selectedCatalogType, selectedHull]);
  const resolvedBuild = useMemo(() => selectedHull
    ? resolveShipMission({ build: draftBuild, hull: selectedHull, distanceLightYears: 0 })
    : null, [draftBuild, selectedHull]);
  const technicalStopComparison = useMemo(() => missionInput && missionInput.distanceLightYears > 0
    ? compareTechnicalStop(missionInput)
    : null, [missionInput]);
  const emptyMaximumAcceleration = selectedHull && selectedEngine && resolvedBuild
    ? selectedEngine.maximumThrustMN * selectedEngineCount * 1_000 / resolvedBuild.operatingDryMassTonnes
    : 0;
  const quantityFor = (shipTypeId: string) => quantities[shipTypeId] ?? 1;
  const maintenance = useMemo(() => fleetFixedMaintenanceCost(game.fleet, shipTypes, game.day), [game.day, game.fleet, shipTypes]);
  const ownedTypeIds = [...new Set(game.fleet.map((ship) => ship.shipTypeId))];
  const purchaseLines = Object.entries(purchaseCart)
    .filter(([, quantity]) => quantity > 0)
    .map(([shipTypeId, quantity]) => ({
      shipTypeId,
      quantity,
      targetRouteId: purchaseTargetRouteId === "standby" ? null : purchaseTargetRouteId,
      ...(purchaseBuilds[shipTypeId] ? { build: purchaseBuilds[shipTypeId] } : {}),
    }));
  const purchaseQuote = purchaseLines.length > 0
    ? quoteShipPurchaseAgreement(game, purchaseLines, shipTypes)
    : null;

  return (
    <main className="fleet-workspace">
      <section className="fleet-overview glass-panel">
        <div className="fleet-overview-copy"><span className="eyebrow">FLEET COMMAND</span><h2>舰队、配置与维护</h2><p>每种船型可维护多个统一方案，再把同型舰船批量分配到方案；不再逐船编辑舱位。</p></div>
        <div className="fleet-overview-stats">
          <div><span>舰船总数</span><strong>{game.fleet.length}</strong></div>
          <div><span>统一方案</span><strong>{game.fleetConfigurations.length}</strong></div>
          <div><span>未配置</span><strong>{game.fleet.filter((ship) => !ship.configurationId).length}</strong></div>
        </div>
        <div className="maintenance-cost-summary">
          <span>每日维护准备金（非现金）</span><strong>{formatCredits(maintenance.total)}</strong>
          <small>船龄加价 {formatCredits(maintenance.ageSurcharge)} · 供应商/系列节省 {formatCredits(maintenance.supplierDiscount + maintenance.familyDiscount)} · 工具培训备件 {formatCredits(maintenance.diversityOverhead)}</small>
        </div>
        <div className="fleet-policy-stack top-policy">
          <div className="auto-maintenance-policy">
            <label htmlFor="auto-maintenance-threshold">自动大修阈值</label>
            <select id="auto-maintenance-threshold" value={game.autoMaintenanceThreshold} onChange={(event) => onAutoMaintenanceThresholdChange(Number(event.target.value))}>
              {[50, 60, 70, 80, 90, 95].map((threshold) => <option key={threshold} value={threshold}>{threshold}%</option>)}
            </select>
          </div>
          <div className="auto-maintenance-policy">
            <label htmlFor="auto-replacement-age">按船龄自动更新</label>
            <select id="auto-replacement-age" value={game.autoReplacementAgeYears ?? "never"} onChange={(event) => onAutoReplacementAgeChange(event.target.value === "never" ? null : Number(event.target.value))}>
              <option value="never">永不自动更新</option>
              {[1, 2, 3, 5, 8, 10, 15, 20].map((age) => <option key={age} value={age}>{age} 年</option>)}
            </select>
          </div>
        </div>
      </section>

      <section className="fleet-section purchase-orders-section glass-panel">
        <div className="fleet-section-heading"><div><span className="eyebrow">DELIVERY QUEUE</span><h2>船厂制造与待交付</h2></div><p>现货也需要一天完成验收；其余订单的交期随结构规模、订购数量和型号热度增加。</p></div>
        {game.shipPurchaseOrders.length === 0
          ? <div className="fleet-empty-callout"><p>当前没有待交付采购订单。</p></div>
          : <div className="purchase-order-grid">{game.shipPurchaseOrders.map((order) => {
            const type = shipTypes.find((candidate) => candidate.id === order.shipTypeId);
            return <article key={order.id}><div><strong>{type?.name ?? order.shipTypeId} × {order.quantity}</strong><span>{order.replacementShipIds?.length ? `自动更新 · 接替 ${order.replacementShipIds.length} 艘旧船` : order.targetRouteId ? `预定：${game.routes.find((route) => route.id === order.targetRouteId)?.name ?? order.targetRouteId}` : order.agreementId}</span></div><em>第 {order.deliveryDay} 日交付 · 还需 {Math.max(0, order.deliveryDay - game.day)} 日</em><small>成交单价 {formatCredits(order.unitPrice)} · 行情优惠 {(order.marketDiscountRate * 100).toFixed(0)}% · 协议优惠 {(order.agreementDiscountRate * 100).toFixed(0)}%</small></article>;
          })}</div>}
      </section>

      <section className="fleet-section glass-panel">
        <div className="fleet-section-heading"><div><span className="eyebrow">CONFIGURATION LIBRARY</span><h2>船型统一配置方案</h2></div><p>配置记录实际引擎、FTL 驱动与模块；每次出发按客舱、实际载客、抵达储备和分阶段物理重新结算。</p></div>
        {ownedTypeIds.map((shipTypeId) => {
          const type = shipTypes.find((candidate) => candidate.id === shipTypeId)!;
          const ships = game.fleet.filter((ship) => ship.shipTypeId === shipTypeId);
          const configurations = game.fleetConfigurations.filter((configuration) => configuration.shipTypeId === shipTypeId);
          return (
            <div className="type-configuration-group" key={shipTypeId}>
              <div className="type-configuration-heading"><div><strong>{type.name}</strong><span>{type.manufacturer} · {type.familyName}系列 {type.variant}</span></div><em>{ships.length} 艘 · {configurations.length} 个方案</em></div>
              <div className="configuration-grid">
                {configurations.map((configuration) => <ConfigurationCard key={configuration.id} configuration={configuration} type={type} ships={ships} game={game} onUpdate={onUpdateConfiguration} onAssignShips={onAssignShips} />)}
                <NewConfigurationCard type={type} build={ships.find((ship) => ship.build)?.build ?? defaultBuildForShipType(type)} onCreate={onCreateConfiguration} />
              </div>
            </div>
          );
        })}
      </section>

      <section className="fleet-section glass-panel">
        <div className="fleet-section-heading"><div><span className="eyebrow">OWNED SHIPS</span><h2>当前舰船与维护</h2></div></div>
        <div className="owned-fleet-grid">{game.fleet.map((ship) => {
          const type = shipTypes.find((candidate) => candidate.id === ship.shipTypeId);
          return type ? <OwnedShipCard key={ship.id} ship={ship} type={type} game={game} onMaintainShip={onMaintainShip} onReplaceShip={onReplaceShip} onSellShip={onSellShip} /> : null;
        })}</div>
      </section>

      <section className="fleet-section shipyard-section glass-panel">
        <div className="fleet-section-heading"><div><span className="eyebrow">SHIPYARD CATALOG</span><h2>购买舰船</h2></div><p>左栏选择完整舰船型号，中栏查看船体结构与当前选装，右栏用现实航线或虚拟航线验证任务。目录仅保留具备 FTL 能力的 {shipTypes.length} 个型号。</p></div>
        {selectedCatalogType && selectedHull && resolvedBuild && <div className="shipyard-builder-grid">
          <article className="shipyard-builder-column ship-selector-column">
            <span className="eyebrow">1 · SHIP</span><h3>选择舰船</h3>
            <nav className="ship-family-menu compact" aria-label="舰船系列">{familyGroups.map((family) => {
              const expanded = openFamilyId === family.id;
              const selected = selectedCatalogType.familyId === family.id;
              return <div className={`ship-family-branch${expanded ? " expanded" : ""}${selected ? " selected" : ""}`} key={family.id}>
                <button className="ship-family-trigger" aria-expanded={expanded} aria-controls={`ship-family-${family.id}`} onClick={() => {
                  if (expanded) setOpenFamilyId("");
                  else {
                    setOpenFamilyId(family.id);
                    if (!family.types.some((type) => type.id === selectedCatalogType.id)) setSelectedCatalogTypeId(family.types[0]!.id);
                  }
                }}><span><strong>{family.name}系列</strong><small>{family.manufacturer} · {family.types.length} 型号</small></span><i aria-hidden="true">⌄</i></button>
                <div className="ship-variant-submenu" id={`ship-family-${family.id}`} aria-hidden={!expanded}><div>{family.types.map((type) => <button key={type.id} className={type.id === selectedCatalogType.id ? "active" : ""} onClick={() => setSelectedCatalogTypeId(type.id)}><strong>{type.name}</strong><small>{type.cabinSpace} 空间 · {formatCredits(type.purchasePrice)}</small></button>)}</div></div>
              </div>;
            })}</nav>
          </article>
          <article className="shipyard-builder-column options-column">
            <span className="eyebrow">2 · SHIP DATA & OUTFIT</span><h3>舰船信息与选装</h3>
            <div className="catalog-card-heading"><div><strong>{selectedCatalogType.name}</strong><span>{selectedCatalogType.manufacturer} · {selectedCatalogType.familyName}系列 {selectedCatalogType.variant}</span></div><em>{formatCredits(resolvedBuild.purchasePrice)}</em></div>
            <p className="ship-description">{selectedCatalogType.description}</p>
            <div className="ship-market-status">{(() => { const offer = shipyardOfferFor(game, selectedCatalogType); return <><span>市场热度 <strong>{(offer.popularity * 100).toFixed(0)}%</strong></span><span>促销 <strong>{offer.discountRate > 0 ? `${(offer.discountRate * 100).toFixed(0)}%` : "无"}</strong></span><span>现货 <strong>{offer.inventory} 艘</strong></span></>; })()}</div>
            <dl className="ship-structure-data">
              <div><dt>标准船体结构质量</dt><dd>{selectedHull.structureMassTonnes.toFixed(1)} t</dd></div>
              <div><dt>当前亚光速引擎质量</dt><dd>{((selectedEngine?.massTonnes ?? 0) * selectedEngineCount).toFixed(1)} t（{selectedEngineCount} × {selectedEngine?.massTonnes.toFixed(1) ?? "—"}）</dd></div>
              <div><dt>当前 FTL 驱动质量</dt><dd>{((selectedDrive?.massTonnes ?? 0) * selectedHull.ftlDriveSlots).toFixed(1)} t</dd></div>
              <div><dt>当前运营干质量</dt><dd>{resolvedBuild.operatingDryMassTonnes.toFixed(1)} t</dd></div>
              <div><dt>燃料舱 / 最大起飞质量</dt><dd>{resolvedBuild.fuelCapacityTonnes.toFixed(1)} / {selectedHull.maximumTakeoffMassTonnes.toFixed(1)} t</dd></div>
              <div><dt>当前最高 FTL 速率</dt><dd>{selectedDrive ? `${selectedDrive.maximumSpeedLyPerDay.toFixed(1)} ly/d` : "未安装"}</dd></div>
              <div><dt>最高亚光速加速度（空载）</dt><dd>{emptyMaximumAcceleration.toFixed(3)} m/s²</dd></div>
              <div><dt>当前亚光速燃料效率</dt><dd className="efficiency-data"><span>{selectedEngine ? `${(currentSublightEfficiency * 100).toFixed(1)}% @ ${(missionThrustRatio * 100).toFixed(0)}% 推力 · 经济点 ${(economySublightEfficiency * 100).toFixed(1)}%` : "未安装"}</span><button type="button" disabled={!selectedEngine} aria-expanded={visibleEfficiencyCurve === "sublight"} aria-controls="sublight-efficiency-curve" onClick={() => setVisibleEfficiencyCurve((current) => current === "sublight" ? null : "sublight")}>{visibleEfficiencyCurve === "sublight" ? "收起曲线" : "查看曲线"}</button></dd></div>
              <div><dt>当前 FTL 燃料效率</dt><dd className="efficiency-data"><span>{selectedDrive ? `${(currentFtlK * 1_000).toFixed(3)}‰/ly @ ${missionSpeed.toFixed(1)} ly/d · 最优 ${(optimalFtlK * 1_000).toFixed(3)}‰/ly` : "未安装"}</span><button type="button" disabled={!selectedDrive} aria-expanded={visibleEfficiencyCurve === "ftl"} aria-controls="ftl-efficiency-curve" onClick={() => setVisibleEfficiencyCurve((current) => current === "ftl" ? null : "ftl")}>{visibleEfficiencyCurve === "ftl" ? "收起曲线" : "查看曲线"}</button></dd></div>
              <div><dt>推进器数量</dt><dd>亚光速 {selectedEngineCount} 台（系列固定）· FTL {selectedHull.ftlDriveSlots} 套 · 模块 {selectedHull.optionalModuleSlots}</dd></div>
            </dl>
            {visibleEfficiencyCurve === "sublight" && selectedEngine && <div id="sublight-efficiency-curve"><EfficiencyCurveChart
              title={`${selectedEngine.manufacturer} ${selectedEngine.model} · 效率—推力曲线`}
              xLabel="推力比例"
              yLabel="定向效率"
              points={selectedEngine.directionalEfficiencyCurve.map((point) => ({ x: point.ratio * 100, y: point.efficiency * 100 }))}
              currentX={missionThrustRatio * 100}
              currentY={currentSublightEfficiency * 100}
              xFormatter={(value) => `${value.toFixed(0)}%`}
              yFormatter={(value) => `${value.toFixed(1)}%`}
            /></div>}
            {visibleEfficiencyCurve === "ftl" && selectedDrive && <div id="ftl-efficiency-curve"><EfficiencyCurveChart
              title={`${selectedDrive.manufacturer} ${selectedDrive.model} · 燃料效率—速度曲线`}
              xLabel="FTL 速度"
              yLabel="燃料系数"
              points={selectedDrive.efficiencyCurve.map((point) => ({ x: point.speedLyPerDay, y: point.kPerLightYear * 1_000 }))}
              currentX={missionSpeed}
              currentY={currentFtlK * 1_000}
              xFormatter={(value) => `${value.toFixed(1)} ly/d`}
              yFormatter={(value) => `${value.toFixed(3)}‰/ly`}
              lowerIsBetter
            /></div>}
            <label>亚光速引擎<select value={draftBuild.sublightEngineModelId} onChange={(event) => { const id = event.target.value; setDraftBuild((current) => ({ ...current, sublightEngineModelId: id })); const engine = SUBLIGHT_ENGINE_MODELS.find((candidate) => candidate.id === id); if (engine) setMissionThrustRatio(engine.economyThrustRatio); }}>{SUBLIGHT_ENGINE_MODELS.filter((engine) => engine.installationClass <= selectedHull.installationClass).map((engine) => <option key={engine.id} value={engine.id}>{engine.manufacturer} {engine.model} · 固定 {selectedEngineCount} 台 · 单机 {engine.massTonnes} t / {engine.maximumThrustMN.toFixed(2)} MN · 总推力 {(engine.maximumThrustMN * selectedEngineCount).toFixed(1)} MN · 经济效率 {(directionalEfficiencyAt(engine, engine.economyThrustRatio) * 100).toFixed(1)}%</option>)}</select></label>
            <label>FTL 驱动<select value={draftBuild.ftlDriveModelId ?? ""} onChange={(event) => { const id = event.target.value; setDraftBuild((current) => ({ ...current, ftlDriveModelId: id })); const drive = FTL_DRIVE_MODELS.find((candidate) => candidate.id === id); if (drive) setMissionSpeed(drive.maximumSpeedLyPerDay); }}>{FTL_DRIVE_MODELS.filter((drive) => drive.installationClass <= selectedHull.installationClass && selectedCatalogType.supportedModes.includes(drive.mode)).map((drive) => <option key={drive.id} value={drive.id}>{drive.mode === "warp" ? "曲率" : "超空间"} · {drive.manufacturer} {drive.model} · {drive.massTonnes} t · 最优 {(ftlKAtSpeed(drive, drive.optimalSpeedLyPerDay) * 1_000).toFixed(3)}‰/ly</option>)}</select></label>
            <div className="module-picker"><strong>辅助模块（{draftBuild.optionalModuleIds.length}/{selectedHull.optionalModuleSlots}）</strong>{OPTIONAL_MODULES.filter((module) => module.installationClass <= selectedHull.installationClass).map((module) => <label key={module.id}><input type="checkbox" checked={draftBuild.optionalModuleIds.includes(module.id)} disabled={!draftBuild.optionalModuleIds.includes(module.id) && draftBuild.optionalModuleIds.length >= selectedHull.optionalModuleSlots} onChange={() => setDraftBuild((current) => ({ ...current, optionalModuleIds: current.optionalModuleIds.includes(module.id) ? current.optionalModuleIds.filter((id) => id !== module.id) : [...current.optionalModuleIds, module.id] }))}/><span>{module.name}</span><small>{module.massTonnes} t · {formatCredits(module.price)}</small></label>)}</div>
            {(() => { const quantity = quantityFor(selectedCatalogType.id); const cartTotal = purchaseLines.reduce((sum, line) => sum + line.quantity, 0); const offer = shipyardOfferFor(game, selectedCatalogType); return <div className="purchase-row"><label>协议数量<input type="number" min="1" max="20" value={quantity} onChange={(event) => setQuantities((current) => ({ ...current, [selectedCatalogType.id]: Math.max(1, Math.min(20, Math.floor(Number(event.target.value) || 1))) }))}/></label><div><span>当前配置小计</span><strong>{formatCredits(resolvedBuild.purchasePrice * (1 - offer.discountRate) * quantity)}</strong></div><button disabled={cartTotal + quantity > 60 || !resolvedBuild.feasible} onClick={() => { setPurchaseBuilds((current) => ({ ...current, [selectedCatalogType.id]: { ...draftBuild, destinationReserveTonnes: missionReserve } })); setPurchaseCart((current) => ({ ...current, [selectedCatalogType.id]: Math.min(20, (current[selectedCatalogType.id] ?? 0) + quantity) })); }}>按当前配置加入协议</button></div>; })()}
          </article>
          <article className="shipyard-builder-column mission-column">
            <span className="eyebrow">3 · MISSION</span><h3>任务剖面分析</h3>
            <label className="mission-profile-source">任务来源<select value={missionProfileSource} onChange={(event) => setMissionProfileSource(event.target.value)}><option value="virtual">虚拟航线（手动设定）</option>{game.routes.map((route) => <option key={route.id} value={route.id}>现实航线 · {route.name}</option>)}</select></label>
            {missionProfileSource === "virtual" ? <div className="mission-inputs profile-distances"><label>离港实体距离<input type="number" min="0.00001" max="10" step="0.01" value={virtualDepartureDistance} onChange={(event) => setVirtualDepartureDistance(Math.max(0.00001, Number(event.target.value) || 0.00001))}/><small>AU</small></label><label>{selectedDrive?.mode === "warp" ? "曲率航行距离" : "超空间航行距离"}<input type="number" min="0" max="500" value={virtualInterstellarDistance} onChange={(event) => setVirtualInterstellarDistance(Math.max(0, Number(event.target.value) || 0))}/><small>ly</small></label><label>进港实体距离<input type="number" min="0.00001" max="10" step="0.01" value={virtualArrivalDistance} onChange={(event) => setVirtualArrivalDistance(Math.max(0.00001, Number(event.target.value) || 0.00001))}/><small>AU</small></label></div> : routeProfileResult.profile ? <div className="route-profile-summary"><span>离港 {routeProfileResult.profile.departureSublightDistanceAu.toFixed(3)} AU</span><strong>{routeProfileResult.profile.interstellarDistanceLightYears.toFixed(1)} ly</strong><span>进港 {routeProfileResult.profile.arrivalSublightDistanceAu.toFixed(3)} AU</span></div> : <p className="mission-profile-error">{routeProfileResult.error}</p>}
            <div className="mission-inputs"><label>旅客<input type="number" min="0" max={selectedCatalogType.seats} value={missionPassengers} onChange={(event) => setMissionPassengers(Math.max(0, Math.min(selectedCatalogType.seats, Number(event.target.value) || 0)))}/><small>人</small></label><label>抵达储备<input type="number" min="0" value={missionReserve} onChange={(event) => setMissionReserve(Math.max(0, Number(event.target.value) || 0))}/><small>t</small></label>{selectedDrive && <label>FTL 速度<input type="number" min={selectedDrive.minimumSpeedLyPerDay} max={selectedDrive.maximumSpeedLyPerDay} step="0.1" value={missionSpeed} onChange={(event) => setMissionSpeed(Math.max(selectedDrive.minimumSpeedLyPerDay, Math.min(selectedDrive.maximumSpeedLyPerDay, Number(event.target.value) || selectedDrive.minimumSpeedLyPerDay)))}/><small>ly/d</small></label>}{selectedEngine && <label>推力<input type="number" min="0.5" max="1" step="0.01" value={missionThrustRatio} onChange={(event) => setMissionThrustRatio(Math.max(.5, Math.min(1, Number(event.target.value) || .5)))}/><small>比例</small></label>}</div>
            {resolvedMission ? <><div className="mission-verdict"><strong className={resolvedMission.feasible ? "positive-text" : "negative-text"}>{resolvedMission.feasible ? "任务可行" : "任务不可行"}</strong><span>起飞 {resolvedMission.takeoffMassTonnes.toFixed(1)} t · 燃料 {resolvedMission.initialFuelTonnes.toFixed(2)} t · 油箱 {(resolvedMission.fuelCapacityUtilization * 100).toFixed(1)}%</span><span>直达航程 {resolvedMission.maximumDirectRangeLightYears.toFixed(1)} ly · 总航时 {(resolvedMission.totalHours / 24).toFixed(2)} 日</span>{resolvedMission.infeasibleReasons.map((reason) => <small key={reason}>{reason}</small>)}</div><div className="mission-phases">{resolvedMission.phases.map((phase) => <div key={phase.kind}><span>{phase.kind === "departure" ? "离港" : phase.kind === "arrival" ? "进港" : "星际"}</span><strong>{phase.fuelBurnTonnes.toFixed(2)} t</strong><small>{phase.distance.toFixed(3)} {phase.kind === "interstellar" ? "ly" : "AU"} · {phase.hours.toFixed(2)} h</small></div>)}</div><div className="mission-costs"><strong>单班完整成本</strong><span>燃料 {formatCredits(resolvedMission.totalFuelBurnTonnes * currentFuelPrice(game))}</span><span>飞时维护 {formatCredits(resolvedMission.maintenancePerFlightHour * resolvedMission.totalHours)}</span><span>人员 {formatCredits(resolvedMission.crewRequired * resolvedMission.totalHours * 3.5)}</span><span>折旧 {formatCredits(resolvedMission.purchasePrice / (8 * 360) * resolvedMission.totalHours / 24)}</span></div>{technicalStopComparison && <div className="technical-stop-comparison"><strong>直飞 / 中途技术补给</strong><span>直飞：{technicalStopComparison.direct.feasible ? `${technicalStopComparison.direct.totalFuelBurnTonnes.toFixed(1)} t · ${(technicalStopComparison.direct.totalHours / 24).toFixed(2)} 日` : "不可行"}</span><span>技术停靠：{technicalStopComparison.withTechnicalStop.feasible ? `${technicalStopComparison.withTechnicalStop.totalFuelBurnTonnes.toFixed(1)} t · ${(technicalStopComparison.withTechnicalStop.totalHours / 24).toFixed(2)} 日 · 港口 ${formatCredits(technicalStopComparison.withTechnicalStop.addedPortCost)}` : "不可行"}</span></div>}</> : <div className="mission-verdict"><strong className="negative-text">无法分析任务</strong><small>{routeProfileResult.error}</small></div>}
          </article>
        </div>}
        {purchaseQuote && <section className="purchase-agreement-cart">
          <div className="purchase-agreement-heading"><div><strong>采购协议草案</strong><span>{purchaseQuote.lines.length} 个型号 · {purchaseQuote.totalShips} 艘</span></div><em>批量协议优惠 {(purchaseQuote.agreementDiscountRate * 100).toFixed(0)}%</em></div>
          <label>交付后目标航线<select value={purchaseTargetRouteId} onChange={(event) => setPurchaseTargetRouteId(event.target.value)}><option value="standby">基地待命（默认）</option>{game.routes.filter((route) => route.active).map((route) => <option key={route.id} value={route.id}>{route.name}</option>)}</select></label>
          <div className="purchase-agreement-lines">{purchaseQuote.lines.map((line) => {
            const type = shipTypes.find((candidate) => candidate.id === line.shipTypeId)!;
            return <div key={line.shipTypeId}><span><strong>{type.name} × {line.quantity}</strong><small>第 {line.deliveryDay} 日交付{line.inventoryUsed > 0 ? ` · 使用现货 ${line.inventoryUsed} 艘` : " · 排产制造"}</small></span><em>{formatCredits(line.unitPrice * line.quantity)}</em><button onClick={() => setPurchaseCart((current) => { const next = { ...current }; delete next[line.shipTypeId]; return next; })}>移除</button></div>;
          })}</div>
          <div className="purchase-agreement-total"><span>目录价 <s>{formatCredits(purchaseQuote.listPrice)}</s><strong>协议总价 {formatCredits(purchaseQuote.totalPrice)}</strong></span><button disabled={game.cash < purchaseQuote.totalPrice || game.status !== "playing"} onClick={() => { onPlacePurchaseAgreement(purchaseLines); setPurchaseCart({}); }}>签订并支付</button></div>
        </section>}
      </section>
    </main>
  );
}
