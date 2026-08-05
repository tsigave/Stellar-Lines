import type { CompanySettlement } from "../../types.js";
import { formatCredits, formatGameDate, formatNumber } from "../format.js";
import type { FinanceTotals } from "./FinancePanel.js";

interface TopMetricsProps {
  day: number;
  today: CompanySettlement | undefined;
  cumulative: FinanceTotals;
  startingBalance: number;
}

export function TopMetrics({ day, today, cumulative, startingBalance }: TopMetricsProps) {
  const profit = today?.operatingProfit ?? 0;
  const metrics = [
    { label: "可用资金", value: formatCredits(startingBalance + cumulative.profit), tone: "primary" },
    { label: "今日收入", value: formatCredits(today?.ticketRevenue ?? 0), tone: "normal" },
    { label: "今日成本", value: formatCredits(today?.operatingCost ?? 0), tone: "warning" },
    { label: "今日利润", value: formatCredits(profit), tone: profit >= 0 ? "positive" : "negative" },
    { label: "今日旅客航段", value: formatNumber(today?.passengers ?? 0), tone: "normal" },
  ];
  return (
    <section className="top-metrics">
      <div className="metric-date">
        <span>公司运营总览</span>
        <strong>{formatGameDate(day)}</strong>
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
