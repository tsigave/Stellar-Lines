import { currentFuelPrice } from "../../game/fuel.js";
import type { GameState } from "../../game/model.js";
import { formatCredits, formatGameDate, formatNumber } from "../format.js";

interface TopMetricsProps {
  game: GameState;
}

export function TopMetrics({ game }: TopMetricsProps) {
  const latest = game.history.at(-1);
  const profit = latest?.profit ?? 0;
  const metrics = [
    { label: "可用资金", value: formatCredits(game.cash), tone: "primary" },
    { label: "昨日收入", value: formatCredits(latest?.revenue ?? 0), tone: "normal" },
    { label: "昨日总成本", value: formatCredits((latest?.operatingCost ?? 0) + (latest?.overhead ?? 0)), tone: "warning" },
    { label: "昨日利润", value: formatCredits(profit), tone: profit >= 0 ? "positive" : "negative" },
    { label: "昨日旅客航段", value: formatNumber(latest?.passengers ?? 0), tone: "normal" },
    { label: "当前燃料价格", value: `${currentFuelPrice(game).toFixed(3)} Cr`, tone: "fuel" },
  ];
  return (
    <section className="top-metrics">
      <div className="metric-date">
        <span>公司运营总览</span>
        <strong>{formatGameDate(game.day)}</strong>
      </div>
      {metrics.map((metric) => (
        <div className={`top-metric ${metric.tone}`} key={metric.label}>
          <span>{metric.label}</span>
          <strong>{metric.value}</strong>
        </div>
      ))}
      <div className={profit >= 0 ? "top-company-state positive" : "top-company-state negative"}>
        <i />{profit >= 0 ? "运营正常" : "需要调整"}
      </div>
    </section>
  );
}
