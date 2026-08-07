import { FUEL_OPERATING_COST_SCALE, type GameState, type GeneratedGalaxy } from "../../index.js";

interface FuelMarketPanelProps {
  game: GameState;
  galaxy: GeneratedGalaxy;
  selectedPortId: string;
  onPolicyChange: (autoBuyPriceThreshold: number | null, inventoryUsePriceThreshold: number | null) => void;
}

const PRICE_OPTIONS = Array.from({ length: 23 }, (_, index) => 0.5 + index * 0.25);

export function FuelMarketPanel({ game, galaxy, selectedPortId, onPolicyChange }: FuelMarketPanelProps) {
  const port = galaxy.ports.find((candidate) => candidate.id === selectedPortId);
  if (!port) return null;
  const records = game.fuelMarket.slice(-30);
  const values = records.map((record) => record.prices[selectedPortId] ?? port.fuelPrice);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = Math.max(0.01, maximum - minimum);
  const points = values.map((value, index) => {
    const x = values.length <= 1 ? 150 : (index / (values.length - 1)) * 300;
    const y = 72 - ((value - minimum) / range) * 58;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const current = values.at(-1) ?? port.fuelPrice;
  const first = values[0] ?? current;
  const change = first > 0 ? ((current - first) / first) * 100 : 0;
  const currentRecord = game.fuelMarket.at(-1);
  const basePort = galaxy.ports.find((candidate) => candidate.id === game.fuelStorage.portId);
  const basePrice = currentRecord?.prices[game.fuelStorage.portId] ?? basePort?.fuelPrice ?? 0;
  const fillRate = game.fuelStorage.capacity > 0
    ? game.fuelStorage.quantity / game.fuelStorage.capacity
    : 0;

  return (
    <section className="fuel-market-section">
      <div className="section-heading-row">
        <div><span className="eyebrow">FUEL EXCHANGE</span><h2>燃料市场</h2></div>
        <strong className={change <= 0 ? "positive-text" : "negative-text"}>{current.toFixed(3)} Cr</strong>
      </div>
      <p>{port.name} · 最近 {records.length} 日价格曲线 · {change >= 0 ? "+" : ""}{change.toFixed(1)}%</p>
      <svg className="fuel-chart" viewBox="0 0 300 86" role="img" aria-label={`${port.name}燃料价格曲线`}>
        <line x1="0" y1="72" x2="300" y2="72" />
        <line x1="0" y1="43" x2="300" y2="43" />
        <line x1="0" y1="14" x2="300" y2="14" />
        <polyline points={points} />
        {values.length > 0 && <circle cx={points.split(" ").at(-1)?.split(",")[0]} cy={points.split(" ").at(-1)?.split(",")[1]} r="3" />}
      </svg>
      <section className="fuel-storage-card">
        <div className="fuel-storage-heading">
          <div><span>基地燃料库 · {basePort?.name ?? game.fuelStorage.portId}</span><strong>{game.fuelStorage.quantity.toFixed(1)} / {game.fuelStorage.capacity.toFixed(0)} FU</strong></div>
          <em>当前报价 {basePrice.toFixed(2)} Cr</em>
        </div>
        <div className="fuel-storage-meter" aria-label={`燃料库存 ${(fillRate * 100).toFixed(0)}%`}><i style={{ width: `${Math.min(100, fillRate * 100)}%` }} /></div>
        <small>库存平均买入价 {game.fuelStorage.quantity > 0 ? `${(game.fuelStorage.averageUnitCost / FUEL_OPERATING_COST_SCALE).toFixed(2)} Cr` : "—"} · 仅供从基地出发的自营航班使用</small>
        <div className="fuel-policy-grid">
          <label>自动买满价格
            <select value={game.fuelStorage.autoBuyPriceThreshold ?? "off"} onChange={(event) => onPolicyChange(event.target.value === "off" ? null : Number(event.target.value), game.fuelStorage.inventoryUsePriceThreshold)}>
              <option value="off">关闭自动买入</option>
              {PRICE_OPTIONS.map((price) => <option key={price} value={price}>{price.toFixed(2)} Cr 以下</option>)}
            </select>
          </label>
          <label>优先使用库存价格
            <select value={game.fuelStorage.inventoryUsePriceThreshold ?? "off"} onChange={(event) => onPolicyChange(game.fuelStorage.autoBuyPriceThreshold, event.target.value === "off" ? null : Number(event.target.value))}>
              <option value="off">关闭库存优先</option>
              {PRICE_OPTIONS.map((price) => <option key={price} value={price}>{price.toFixed(2)} Cr 以上</option>)}
            </select>
          </label>
        </div>
        <p>低于买入阈值时按基地现价自动补满；高于使用阈值时，基地始发航班先消耗库存，不足部分再按市价采购。</p>
      </section>
      <div className="fuel-price-grid">
        {galaxy.ports.map((candidate) => (
          <button key={candidate.id} className={candidate.id === selectedPortId ? "selected" : ""} disabled>
            <span>{candidate.name}</span><strong>{(currentRecord?.prices[candidate.id] ?? candidate.fuelPrice).toFixed(3)}</strong>
          </button>
        ))}
      </div>
    </section>
  );
}
