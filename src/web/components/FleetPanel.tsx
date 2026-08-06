import { useEffect, useMemo, useState } from "react";
import {
  CABIN_SPACE_PER_SEAT,
  cabinSpaceUsed,
  estimateFuelConsumption,
  FIXED_MAINTENANCE_COST_SCALE,
  fleetConfigurationForShip,
  fleetFixedMaintenanceCost,
  quoteShipPurchaseAgreement,
  shipAgeYears,
  shipComfortAtAge,
  shipMaintenanceCost,
  shipMaintenanceState,
  shipResaleValue,
  shipyardOfferFor,
  type CabinConfiguration,
  type FleetConfiguration,
  type GameState,
  type OwnedShip,
  type ShipPurchaseLineInput,
  type ShipType,
  type TravelMode,
} from "../../index.js";
import { formatCredits } from "../format.js";

interface FleetPanelProps {
  game: GameState;
  shipTypes: readonly ShipType[];
  onPlacePurchaseAgreement: (lines: readonly ShipPurchaseLineInput[]) => void;
  onCreateConfiguration: (
    shipTypeId: string,
    name: string,
    cabins: CabinConfiguration,
  ) => void;
  onUpdateConfiguration: (
    configurationId: string,
    name: string,
    cabins: CabinConfiguration,
  ) => void;
  onAssignShips: (configurationId: string, shipIds: readonly string[]) => void;
  onMaintainShip: (shipId: string) => void;
  onAutoMaintenanceThresholdChange: (threshold: number) => void;
  onAutoReplacementAgeChange: (ageYears: number | null) => void;
}

const MODE_LABELS: Record<TravelMode, string> = {
  sublight: "亚光速",
  warp: "曲率",
  hyperspace: "超空间",
};
const MAINTENANCE_LABELS = {
  ready: "状态良好",
  due: "维护到期",
  required: "强制停航",
  maintenance: "维护中",
} as const;

function formatModeValue(type: ShipType, mode: TravelMode): string {
  const speed = type.speedByMode[mode];
  const range = type.maxRangeByMode[mode];
  if (speed === undefined || range === undefined) return "—";
  return mode === "sublight"
    ? `指数 ${speed.toFixed(2)} · 航程 ${range}`
    : `${speed.toFixed(1)} 光年/日 · ${range} 光年`;
}

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
      <div className="cabin-editor-heading">
        <strong>统一客舱方案</strong>
        <span className={invalid ? "over-capacity" : ""}>{usedSpace} / {type.cabinSpace} 空间</span>
      </div>
      <CabinInputs cabins={cabins} disabled={locked} onChange={setCabins} />
      <p className="automatic-fuel-note">燃料将在每次出发前按航程与预计载荷自动配给，并额外保留 20% 应急燃料。</p>
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
  onCreate,
}: {
  type: ShipType;
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
      <p className="automatic-fuel-note">系统会按每次任务自动装载所需燃料，并固定加入 20% 应急裕度。</p>
      <button className="save-configuration" disabled={invalid} onClick={() => {
        onCreate(type.id, name, cabins);
        setName("");
        setCabins({ premium: 0, business: 0, economy: 0 });
      }}>创建方案</button>
    </article>
  );
}

function OwnedShipCard({ ship, type, game, onMaintainShip }: {
  ship: OwnedShip;
  type: ShipType;
  game: GameState;
  onMaintainShip: (shipId: string) => void;
}) {
  const maintenance = shipMaintenanceState(ship, game.day);
  const configuration = fleetConfigurationForShip(game, ship);
  const ageYears = shipAgeYears(ship, game.day);
  const effectiveComfort = shipComfortAtAge(ship, type, game.day);
  return (
    <article className={`fleet-ship-card ${maintenance}`}>
      <div className="fleet-card-heading">
        <div><strong>{ship.name}</strong><span>{type.familyName} · {type.variant} · {ship.routeId ? "执行航线" : "基地待命"}</span></div>
        <em>{MAINTENANCE_LABELS[maintenance]}</em>
      </div>
      <div className="ship-configuration-summary">
        <span>配置方案</span><strong>{configuration?.name ?? "未分配"}</strong>
        {configuration && <small>头等 {configuration.cabins.premium} · 商务 {configuration.cabins.business} · 经济 {configuration.cabins.economy} · 自动配油 + 20% 应急裕度</small>}
      </div>
      <div className="fleet-condition-row"><span>维护值 {ship.condition.toFixed(0)}%</span><span>本周期 {ship.flightHoursSinceMaintenance.toFixed(0)} 小时</span></div>
      <div className="ship-age-summary"><span>船龄 {ageYears.toFixed(1)} 年</span><span>舒适度 {effectiveComfort.toFixed(1)} / {type.comfort}</span><span>估值 {formatCredits(shipResaleValue(ship, type, game.day))}</span></div>
      <div className="maintenance-meter"><i style={{ width: `${ship.condition}%` }} /></div>
      <div className="fleet-card-actions single-action">
        <button disabled={maintenance === "maintenance" || game.cash < shipMaintenanceCost(type)} onClick={() => onMaintainShip(ship.id)}>
          {maintenance === "maintenance" ? `维护至第 ${ship.maintenanceUntilDay} 日` : `大修 ${formatCredits(shipMaintenanceCost(type))}`}
        </button>
      </div>
    </article>
  );
}

function fuelCurve(type: ShipType) {
  const mode = type.supportedModes.find((candidate) => candidate !== "sublight") ?? "sublight";
  const range = type.maxRangeByMode[mode] ?? 1;
  const cabins = { premium: 0, business: 0, economy: type.cabinSpace };
  return [0.1, 0.5, 1].map((fraction) => {
    const distance = Math.max(1, range * fraction);
    const empty = estimateFuelConsumption(type, mode, distance, cabins, 0);
    const full = estimateFuelConsumption(type, mode, distance, cabins, type.cabinSpace);
    return { label: `${Math.round(fraction * 100)}% 航程`, distance, empty, full };
  });
}

export function FleetPanel({
  game,
  shipTypes,
  onPlacePurchaseAgreement,
  onCreateConfiguration,
  onUpdateConfiguration,
  onAssignShips,
  onMaintainShip,
  onAutoMaintenanceThresholdChange,
  onAutoReplacementAgeChange,
}: FleetPanelProps) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [purchaseCart, setPurchaseCart] = useState<Record<string, number>>({});
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
  const [selectedFamilyId, setSelectedFamilyId] = useState(() => shipTypes[0]?.familyId ?? "");
  const [selectedCatalogTypeId, setSelectedCatalogTypeId] = useState(() => shipTypes[0]?.id ?? "");
  const selectedFamily = familyGroups.find((family) => family.id === selectedFamilyId) ?? familyGroups[0];
  const selectedCatalogType = selectedFamily?.types.find((type) => type.id === selectedCatalogTypeId) ?? selectedFamily?.types[0];
  const quantityFor = (shipTypeId: string) => quantities[shipTypeId] ?? 1;
  const maintenance = useMemo(() => fleetFixedMaintenanceCost(game.fleet, shipTypes, game.day), [game.day, game.fleet, shipTypes]);
  const ownedTypeIds = [...new Set(game.fleet.map((ship) => ship.shipTypeId))];
  const purchaseLines = Object.entries(purchaseCart)
    .filter(([, quantity]) => quantity > 0)
    .map(([shipTypeId, quantity]) => ({ shipTypeId, quantity }));
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
          <span>每日固定维护</span><strong>{formatCredits(maintenance.total)}</strong>
          <small>船龄加价 {formatCredits(maintenance.ageSurcharge)} · 供应商节省 {formatCredits(maintenance.supplierDiscount)} · 系列节省 {formatCredits(maintenance.familyDiscount)}</small>
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
            return <article key={order.id}><div><strong>{type?.name ?? order.shipTypeId} × {order.quantity}</strong><span>{order.replacementShipIds?.length ? `自动更新 · 接替 ${order.replacementShipIds.length} 艘旧船` : order.agreementId}</span></div><em>第 {order.deliveryDay} 日交付 · 还需 {Math.max(0, order.deliveryDay - game.day)} 日</em><small>成交单价 {formatCredits(order.unitPrice)} · 行情优惠 {(order.marketDiscountRate * 100).toFixed(0)}% · 协议优惠 {(order.agreementDiscountRate * 100).toFixed(0)}%</small></article>;
          })}</div>}
      </section>

      <section className="fleet-section glass-panel">
        <div className="fleet-section-heading"><div><span className="eyebrow">CONFIGURATION LIBRARY</span><h2>船型统一配置方案</h2></div><p>配置方案只负责统一客舱；每次出发前会依据航段和预约载客量自动配油，并固定加入 20% 应急裕度。</p></div>
        {ownedTypeIds.map((shipTypeId) => {
          const type = shipTypes.find((candidate) => candidate.id === shipTypeId)!;
          const ships = game.fleet.filter((ship) => ship.shipTypeId === shipTypeId);
          const configurations = game.fleetConfigurations.filter((configuration) => configuration.shipTypeId === shipTypeId);
          return (
            <div className="type-configuration-group" key={shipTypeId}>
              <div className="type-configuration-heading"><div><strong>{type.name}</strong><span>{type.manufacturer} · {type.familyName}系列 {type.variant}</span></div><em>{ships.length} 艘 · {configurations.length} 个方案</em></div>
              <div className="configuration-grid">
                {configurations.map((configuration) => <ConfigurationCard key={configuration.id} configuration={configuration} type={type} ships={ships} game={game} onUpdate={onUpdateConfiguration} onAssignShips={onAssignShips} />)}
                <NewConfigurationCard type={type} onCreate={onCreateConfiguration} />
              </div>
            </div>
          );
        })}
      </section>

      <section className="fleet-section glass-panel">
        <div className="fleet-section-heading"><div><span className="eyebrow">OWNED SHIPS</span><h2>当前舰船与维护</h2></div></div>
        <div className="owned-fleet-grid">{game.fleet.map((ship) => {
          const type = shipTypes.find((candidate) => candidate.id === ship.shipTypeId);
          return type ? <OwnedShipCard key={ship.id} ship={ship} type={type} game={game} onMaintainShip={onMaintainShip} /> : null;
        })}</div>
      </section>

      <section className="fleet-section shipyard-section glass-panel">
        <div className="fleet-section-heading"><div><span className="eyebrow">SHIPYARD CATALOG</span><h2>购买舰船</h2></div><p>先选择系列，再在二级菜单选择具体子型号。当前共 {familyGroups.length} 个系列、{shipTypes.length} 个型号。</p></div>
        <nav className="ship-family-menu" aria-label="舰船系列">
          {familyGroups.map((family) => (
            <button key={family.id} className={family.id === selectedFamily?.id ? "active" : ""} onClick={() => {
              setSelectedFamilyId(family.id);
              setSelectedCatalogTypeId(family.types[0]!.id);
            }}>
              <strong>{family.name}系列</strong><span>{family.manufacturer} · {family.types.length} 型号</span>
            </button>
          ))}
        </nav>
        {selectedFamily && <nav className="ship-variant-menu" aria-label={`${selectedFamily.name}系列子型号`}>
          <span>选择子型号</span>
          {selectedFamily.types.map((type) => (
            <button key={type.id} className={type.id === selectedCatalogType?.id ? "active" : ""} onClick={() => setSelectedCatalogTypeId(type.id)}>
              {type.variant}<small>{type.cabinSpace} 空间 · {formatCredits(type.purchasePrice)}</small>
            </button>
          ))}
        </nav>}
        {purchaseQuote && <section className="purchase-agreement-cart">
          <div className="purchase-agreement-heading"><div><strong>采购协议草案</strong><span>{purchaseQuote.lines.length} 个型号 · {purchaseQuote.totalShips} 艘</span></div><em>批量协议优惠 {(purchaseQuote.agreementDiscountRate * 100).toFixed(0)}%</em></div>
          <div className="purchase-agreement-lines">{purchaseQuote.lines.map((line) => {
            const type = shipTypes.find((candidate) => candidate.id === line.shipTypeId)!;
            return <div key={line.shipTypeId}><span><strong>{type.name} × {line.quantity}</strong><small>第 {line.deliveryDay} 日交付{line.inventoryUsed > 0 ? ` · 使用现货 ${line.inventoryUsed} 艘` : " · 排产制造"}</small></span><em>{formatCredits(line.unitPrice * line.quantity)}</em><button onClick={() => setPurchaseCart((current) => { const next = { ...current }; delete next[line.shipTypeId]; return next; })}>移除</button></div>;
          })}</div>
          <div className="purchase-agreement-total"><span>目录价 <s>{formatCredits(purchaseQuote.listPrice)}</s><strong>协议总价 {formatCredits(purchaseQuote.totalPrice)}</strong></span><button disabled={game.cash < purchaseQuote.totalPrice || game.status !== "playing"} onClick={() => { onPlacePurchaseAgreement(purchaseLines); setPurchaseCart({}); }}>签订并支付</button></div>
        </section>}
        <div className="selected-ship-catalog">{selectedCatalogType && (() => {
          const type = selectedCatalogType;
          const offer = shipyardOfferFor(game, type);
          const quantity = quantityFor(type.id);
          const marketUnitPrice = Math.round(type.purchasePrice * (1 - offer.discountRate));
          const cartTotal = purchaseLines.reduce((sum, line) => sum + line.quantity, 0);
          const interstellarModes = type.supportedModes.filter((mode) => mode !== "sublight");
          const curve = fuelCurve(type);
          return (
            <article className="ship-catalog-card" key={type.id}>
              <div className="catalog-card-heading"><div><strong>{type.name}</strong><span>{type.manufacturer} · {type.familyName}系列 {type.variant}</span></div><em>{offer.discountRate > 0 && <s>{formatCredits(type.purchasePrice)}</s>}{formatCredits(marketUnitPrice)}</em></div>
              <div className="ship-market-status"><span>市场热度 <strong>{(offer.popularity * 100).toFixed(0)}%</strong></span><span>随机促销 <strong>{offer.discountRate > 0 ? `${(offer.discountRate * 100).toFixed(0)}%` : "无"}</strong></span><span>船厂现货 <strong>{offer.inventory} 艘</strong></span></div>
              <p>{type.description}</p>
              <div className="ship-spec-grid">
                <div><span>结构质量</span><strong>{type.structuralMassTonnes.toLocaleString()} 吨</strong></div>
                <div><span>燃料容量</span><strong>{type.fuelCapacityTonnes.toLocaleString()} 吨</strong></div>
                <div><span>客舱空间</span><strong>{type.cabinSpace} 单位</strong></div>
                <div><span>固定维护</span><strong>{formatCredits(type.fixedMaintenanceCostPerDay * FIXED_MAINTENANCE_COST_SCALE)} / 日</strong></div>
              </div>
              <div className="drive-specs"><div><span>亚光速</span><strong>{formatModeValue(type, "sublight")}</strong></div>{interstellarModes.map((mode) => <div key={mode}><span>{MODE_LABELS[mode]} · 耗油系数 {type.fuelPerDistanceByMode[mode]}</span><strong>{formatModeValue(type, mode)}</strong></div>)}</div>
              <div className="fuel-curve-table"><div className="fuel-curve-heading"><span>自动配油曲线 · 已含 20% 应急裕度</span><small>空载 / 满载任务耗油</small></div>{curve.map((point) => <div key={point.label}><span>{point.label}<small>{point.distance.toFixed(0)} 光年 · 错配 ×{point.empty.rangeMismatchMultiplier.toFixed(2)}</small></span><strong>{point.empty.fuelUnits.toFixed(1)} / {point.full.fuelUnits.toFixed(1)} 单位<small>满载起飞装油 {point.full.requiredFuelLoadUnits.toFixed(1)} · 油箱 {(point.full.fuelCapacityUtilization * 100).toFixed(0)}%</small></strong></div>)}</div>
              <div className="purchase-row"><label>协议数量<input type="number" min="1" max="20" value={quantity} onChange={(event) => setQuantities((current) => ({ ...current, [type.id]: Math.max(1, Math.min(20, Math.floor(Number(event.target.value) || 1))) }))} /></label><div><span>当前行情小计</span><strong>{formatCredits(marketUnitPrice * quantity)}</strong></div><button disabled={cartTotal + quantity > 60} onClick={() => setPurchaseCart((current) => ({ ...current, [type.id]: Math.min(20, (current[type.id] ?? 0) + quantity) }))}>加入采购协议</button></div>
            </article>
          );
        })()}</div>
      </section>
    </main>
  );
}
