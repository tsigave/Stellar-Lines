import { useEffect, useState } from "react";
import {
  CABIN_SPACE_PER_SEAT,
  cabinSpaceUsed,
  shipMaintenanceCost,
  shipMaintenanceState,
  type CabinConfiguration,
  type GameState,
  type OwnedShip,
  type ShipType,
  type TravelMode,
} from "../../index.js";
import { formatCredits } from "../format.js";

interface FleetPanelProps {
  game: GameState;
  shipTypes: readonly ShipType[];
  onBuyShips: (shipTypeId: string, quantity: number) => void;
  onConfigureCabins: (shipId: string, cabins: CabinConfiguration) => void;
  onMaintainShip: (shipId: string) => void;
  onAutoMaintenanceThresholdChange: (threshold: number) => void;
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

function OwnedShipCard({
  ship,
  type,
  game,
  onConfigureCabins,
  onMaintainShip,
}: {
  ship: OwnedShip;
  type: ShipType;
  game: GameState;
  onConfigureCabins: (shipId: string, cabins: CabinConfiguration) => void;
  onMaintainShip: (shipId: string) => void;
}) {
  const [cabins, setCabins] = useState<CabinConfiguration>({ ...ship.cabins });
  useEffect(() => setCabins({ ...ship.cabins }), [ship.cabins]);
  const maintenance = shipMaintenanceState(ship, game.day);
  const usedSpace = cabinSpaceUsed(cabins);
  const invalid = usedSpace > type.cabinSpace;
  const locked = ship.routeId !== null || maintenance === "maintenance";
  const updateCabin = (passengerClass: keyof CabinConfiguration, value: number) => {
    setCabins((current) => ({ ...current, [passengerClass]: Math.max(0, Math.floor(value || 0)) }));
  };

  return (
    <article className={`fleet-ship-card ${maintenance}`}>
      <div className="fleet-card-heading">
        <div><strong>{ship.name}</strong><span>{type.name} · {ship.routeId ? "执行航线" : "基地待命"}</span></div>
        <em>{MAINTENANCE_LABELS[maintenance]}</em>
      </div>
      <div className="fleet-condition-row">
        <span>维护值 {ship.condition.toFixed(0)}%</span>
        <span>本周期 {ship.flightHoursSinceMaintenance.toFixed(0)} 小时</span>
      </div>
      <div className="maintenance-meter"><i style={{ width: `${ship.condition}%` }} /></div>

      <div className="cabin-editor-heading">
        <strong>客舱配置</strong>
        <span className={invalid ? "over-capacity" : ""}>{usedSpace} / {type.cabinSpace} 空间</span>
      </div>
      <div className="cabin-editor">
        <label><span>头等</span><small>每座占 {CABIN_SPACE_PER_SEAT.premium}</small><input type="number" min="0" value={cabins.premium} disabled={locked} onChange={(event) => updateCabin("premium", Number(event.target.value))} /></label>
        <label><span>商务</span><small>每座占 {CABIN_SPACE_PER_SEAT.business}</small><input type="number" min="0" value={cabins.business} disabled={locked} onChange={(event) => updateCabin("business", Number(event.target.value))} /></label>
        <label><span>经济</span><small>每座占 {CABIN_SPACE_PER_SEAT.economy}</small><input type="number" min="0" value={cabins.economy} disabled={locked} onChange={(event) => updateCabin("economy", Number(event.target.value))} /></label>
      </div>
      <p className="cabin-help">空间占用比例为头等 6 : 商务 3 : 经济 1。未配置座位的空舱船不能投入航线。</p>
      <div className="fleet-card-actions">
        <button disabled={locked || invalid} onClick={() => onConfigureCabins(ship.id, cabins)}>保存舱位</button>
        <button disabled={maintenance === "maintenance" || game.cash < shipMaintenanceCost(type)} onClick={() => onMaintainShip(ship.id)}>
          {maintenance === "maintenance" ? `维护至第 ${ship.maintenanceUntilDay} 日` : `维护 ${formatCredits(shipMaintenanceCost(type))}`}
        </button>
      </div>
    </article>
  );
}

export function FleetPanel({
  game,
  shipTypes,
  onBuyShips,
  onConfigureCabins,
  onMaintainShip,
  onAutoMaintenanceThresholdChange,
}: FleetPanelProps) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const quantityFor = (shipTypeId: string) => quantities[shipTypeId] ?? 1;

  return (
    <main className="fleet-workspace">
      <section className="fleet-overview glass-panel">
        <div className="fleet-overview-copy">
          <span className="eyebrow">FLEET COMMAND</span>
          <h2>当前舰队与维护</h2>
          <p>新购舰船以空舱交付。先按市场策略配置头等、商务和经济舱，再前往星图建立航线。</p>
        </div>
        <div className="fleet-overview-stats">
          <div><span>舰船总数</span><strong>{game.fleet.length}</strong></div>
          <div><span>基地待命</span><strong>{game.fleet.filter((ship) => ship.routeId === null).length}</strong></div>
          <div><span>空舱舰船</span><strong>{game.fleet.filter((ship) => cabinSpaceUsed(ship.cabins) === 0).length}</strong></div>
        </div>
        <div className="auto-maintenance-policy top-policy">
          <label htmlFor="auto-maintenance-threshold">自动维护阈值</label>
          <select id="auto-maintenance-threshold" value={game.autoMaintenanceThreshold} onChange={(event) => onAutoMaintenanceThresholdChange(Number(event.target.value))}>
            {[50, 60, 70, 80, 90, 95].map((threshold) => (
              <option key={threshold} value={threshold}>{threshold}% · {threshold >= 90 ? "预防性" : threshold >= 70 ? "标准" : "节约"}</option>
            ))}
          </select>
          <small>返抵主基地且维护值低于阈值时，自动安排 3 日维护。</small>
        </div>
      </section>

      <section className="fleet-section glass-panel">
        <div className="fleet-section-heading"><div><span className="eyebrow">OWNED SHIPS</span><h2>舰队状态与舱位</h2></div></div>
        <div className="owned-fleet-grid">
          {game.fleet.map((ship) => {
            const type = shipTypes.find((candidate) => candidate.id === ship.shipTypeId);
            return type ? <OwnedShipCard key={ship.id} ship={ship} type={type} game={game} onConfigureCabins={onConfigureCabins} onMaintainShip={onMaintainShip} /> : null;
          })}
        </div>
      </section>

      <section className="fleet-section shipyard-section glass-panel">
        <div className="fleet-section-heading">
          <div><span className="eyebrow">SHIPYARD CATALOG</span><h2>购买舰船</h2></div>
          <p>超空间航道速度整体高于曲率直达；曲率船的优势是无需依赖固定航道。</p>
        </div>
        <div className="ship-catalog-grid">
          {shipTypes.map((type) => {
            const quantity = quantityFor(type.id);
            const totalPrice = quantity * type.purchasePrice;
            const interstellarModes = type.supportedModes.filter((mode) => mode !== "sublight");
            return (
              <article className="ship-catalog-card" key={type.id}>
                <div className="catalog-card-heading">
                  <div><strong>{type.name}</strong><span>{type.manufacturer}</span></div>
                  <em>{formatCredits(type.purchasePrice)}</em>
                </div>
                <p>{type.description}</p>
                <div className="ship-spec-grid">
                  <div><span>客舱空间</span><strong>{type.cabinSpace} 单位</strong></div>
                  <div><span>可靠性</span><strong>{Math.round(type.reliability * 100)}%</strong></div>
                  <div><span>舒适基准</span><strong>{type.comfort}</strong></div>
                  <div><span>最低港级</span><strong>{type.minimumPortLevel} 级</strong></div>
                </div>
                <div className="drive-specs">
                  <div><span>亚光速</span><strong>{formatModeValue(type, "sublight")}</strong></div>
                  {interstellarModes.map((mode) => <div key={mode}><span>{MODE_LABELS[mode]}</span><strong>{formatModeValue(type, mode)}</strong></div>)}
                </div>
                <p className="sublight-explanation">亚光速指数影响星系内周转：每次停靠的接驳时间为 12 ÷ 指数小时，指数越高，班次越密。</p>
                <div className="purchase-row">
                  <label>数量<input type="number" min="1" max="20" value={quantity} onChange={(event) => setQuantities((current) => ({ ...current, [type.id]: Math.max(1, Math.min(20, Math.floor(Number(event.target.value) || 1))) }))} /></label>
                  <div><span>合计</span><strong>{formatCredits(totalPrice)}</strong></div>
                  <button disabled={game.cash < totalPrice || game.status !== "playing"} onClick={() => onBuyShips(type.id, quantity)}>购买</button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
