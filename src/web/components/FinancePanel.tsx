import type { CompanySettlement } from "../../types.js";
import { formatCredits, formatNumber } from "../format.js";

export interface FinanceTotals {
  revenue: number;
  cost: number;
  profit: number;
  passengers: number;
}

interface FinancePanelProps {
  today: CompanySettlement | undefined;
  cumulative: FinanceTotals;
  startingBalance: number;
}

export function FinancePanel({ today, cumulative, startingBalance }: FinancePanelProps) {
  const dailyProfit = today?.operatingProfit ?? 0;
  const balance = startingBalance + cumulative.profit;
  return (
    <section className="finance-section">
      <div className="section-heading-row">
        <div><span className="eyebrow">PLAYER COMPANY</span><h2>远星航运</h2></div>
        <span className={dailyProfit >= 0 ? "status-pill positive" : "status-pill negative"}>
          {dailyProfit >= 0 ? "运营正常" : "需要调整"}
        </span>
      </div>
      <div className="balance-card">
        <span>可用资金</span>
        <strong>{formatCredits(balance)}</strong>
        <small>累计运营利润 {formatCredits(cumulative.profit)}</small>
      </div>
      <div className="finance-grid">
        <div><span>今日收入</span><strong>{formatCredits(today?.ticketRevenue ?? 0)}</strong></div>
        <div><span>今日成本</span><strong>{formatCredits(today?.operatingCost ?? 0)}</strong></div>
        <div className={dailyProfit >= 0 ? "profit positive-text" : "profit negative-text"}>
          <span>今日利润</span><strong>{formatCredits(dailyProfit)}</strong>
        </div>
        <div><span>旅客航段</span><strong>{formatNumber(today?.passengers ?? 0)}</strong></div>
      </div>
    </section>
  );
}
