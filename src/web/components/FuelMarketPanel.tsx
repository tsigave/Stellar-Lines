import type { GameState, GeneratedGalaxy } from "../../index.js";

interface FuelMarketPanelProps {
  game: GameState;
  galaxy: GeneratedGalaxy;
  selectedPortId: string;
}

export function FuelMarketPanel({ game, galaxy, selectedPortId }: FuelMarketPanelProps) {
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
