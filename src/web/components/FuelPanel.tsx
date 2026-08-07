import { useMemo, useState } from "react";
import {
  contractedFuelShare,
  currentFuelPrice,
  FUEL_CONTRACT_CANCELLATION_RATE,
  FUEL_CONTRACT_MINIMUM_WEEKLY_UNITS,
  FUEL_OPERATING_COST_SCALE,
  FUEL_RESALE_PRICE_RATE,
  FUEL_UNIT_MASS_TONNES,
  FUEL_WAREHOUSE_RENT_PER_TONNE_DAY,
  forecastWeeklyFuelDemand,
  quoteFuelContract,
  type FuelAutoContractPolicy,
  type FuelSurplusPolicy,
  type GameState,
} from "../../index.js";
import { formatCredits, formatGameDate, formatNumber } from "../format.js";

interface FuelPanelProps {
  game: GameState;
  onSignContract: (termWeeks: number, weeklyUnits: number) => void;
  onCancelContract: (contractId: string) => void;
  onAutoPolicyChange: (policy: FuelAutoContractPolicy) => void;
  onWarehouseRentalChange: (rented: boolean) => void;
  onWarehousePolicyChange: (limit: number | null, surplusPolicy: FuelSurplusPolicy) => void;
  onBuyWarehouseFuel: (units: number) => void;
  onSellWarehouseFuel: (units: number) => void;
}

const PRICE_HISTORY_DAY_OPTIONS = [30, 90, 360] as const;

function contractStatus(game: GameState, contract: GameState["fuelContracts"][number]): string {
  if (contract.cancelledOnDay !== null) return `第 ${contract.cancelledOnDay} 日解约`;
  if (game.day > contract.endsOnDay || contract.deliveredUnits >= contract.totalUnits - 1e-6) return "已履行";
  if (game.day < contract.startsOnDay) return `第 ${contract.startsOnDay} 日开始`;
  return "执行中";
}

function shortGameDate(day: number): string {
  const year = Math.floor((day - 1) / 364) + 1;
  const dayOfYear = (day - 1) % 364;
  const month = Math.floor(dayOfYear / 28) + 1;
  const dayOfMonth = dayOfYear % 28 + 1;
  return `${year}年${month}月${dayOfMonth}日`;
}

export function FuelPanel({
  game,
  onSignContract,
  onCancelContract,
  onAutoPolicyChange,
  onWarehouseRentalChange,
  onWarehousePolicyChange,
  onBuyWarehouseFuel,
  onSellWarehouseFuel,
}: FuelPanelProps) {
  const [termWeeks, setTermWeeks] = useState(16);
  const [weeklyUnits, setWeeklyUnits] = useState(FUEL_CONTRACT_MINIMUM_WEEKLY_UNITS);
  const [autoEnabled, setAutoEnabled] = useState(game.fuelAutoContractPolicy.enabled);
  const [autoTrigger, setAutoTrigger] = useState(game.fuelAutoContractPolicy.triggerPrice);
  const [autoTerm, setAutoTerm] = useState(game.fuelAutoContractPolicy.termWeeks);
  const [spotExposure, setSpotExposure] = useState(Math.round(game.fuelAutoContractPolicy.spotExposureShare * 100));
  const [withdrawalUnlimited, setWithdrawalUnlimited] = useState(game.fuelWarehouse.dailyWithdrawalLimit === null);
  const [withdrawalLimit, setWithdrawalLimit] = useState(game.fuelWarehouse.dailyWithdrawalLimit ?? 250);
  const [surplusPolicy, setSurplusPolicy] = useState<FuelSurplusPolicy>(game.fuelWarehouse.surplusPolicy);
  const [tradeUnits, setTradeUnits] = useState(100);
  const [priceHistoryDays, setPriceHistoryDays] = useState(30);
  const [hoveredPriceIndex, setHoveredPriceIndex] = useState<number | null>(null);
  const price = currentFuelPrice(game);
  const latest = game.history.at(-1);
  const weeklyForecast = forecastWeeklyFuelDemand(game);
  const coverage = contractedFuelShare(game, weeklyForecast);
  const quote = useMemo(() => {
    try {
      return quoteFuelContract(game, termWeeks, weeklyUnits);
    } catch {
      return null;
    }
  }, [game, termWeeks, weeklyUnits]);
  const priceRecords = game.fuelMarket.slice(-priceHistoryDays);
  const prices = priceRecords.map((record) => record.price);
  const minimumPrice = Math.min(...prices, price);
  const maximumPrice = Math.max(...prices, price);
  const paddedMinimumPrice = Math.max(0.5, Math.floor((minimumPrice - 0.15) * 4) / 4);
  const paddedMaximumPrice = Math.min(6, Math.ceil((maximumPrice + 0.15) * 4) / 4);
  const chartMinimumPrice = paddedMaximumPrice - paddedMinimumPrice < 0.25
    ? Math.max(0.5, paddedMinimumPrice - 0.25)
    : paddedMinimumPrice;
  const chartMaximumPrice = paddedMaximumPrice - chartMinimumPrice < 0.25
    ? Math.min(6, chartMinimumPrice + 0.5)
    : paddedMaximumPrice;
  const priceRange = Math.max(0.25, chartMaximumPrice - chartMinimumPrice);
  const pricePoints = prices.map((value, index) => {
    const x = prices.length <= 1 ? 500 : index / (prices.length - 1) * 1_000;
    const y = 140 - (value - chartMinimumPrice) / priceRange * 140;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const priceTicks = Array.from({ length: 5 }, (_, index) =>
    chartMaximumPrice - priceRange * index / 4,
  );
  const priceTickIndexes = [...new Set(Array.from({ length: Math.min(5, priceRecords.length) }, (_, index) =>
    priceRecords.length <= 1 ? 0 : Math.round(index * (priceRecords.length - 1) / Math.min(4, priceRecords.length - 1)),
  ))];
  const hoveredPriceRecord = hoveredPriceIndex === null ? undefined : priceRecords[hoveredPriceIndex];
  const hoveredPriceLeft = hoveredPriceIndex === null || priceRecords.length <= 1
    ? 50
    : hoveredPriceIndex / (priceRecords.length - 1) * 100;
  const hoveredPriceTop = hoveredPriceRecord
    ? (1 - (hoveredPriceRecord.price - chartMinimumPrice) / priceRange) * 100
    : 50;
  const consumptionRecords = game.history.slice(-30);
  const maximumConsumption = Math.max(1, ...consumptionRecords.map((record) => record.fuelConsumedUnits ?? 0));
  const activeContracts = game.fuelContracts.filter((contract) =>
    contract.cancelledOnDay === null && game.day <= contract.endsOnDay && contract.deliveredUnits < contract.totalUnits - 1e-6,
  );
  const historicalContracts = game.fuelContracts.filter((contract) => !activeContracts.includes(contract)).slice(-12).reverse();
  const warehouseFill = game.fuelWarehouse.capacity > 0
    ? game.fuelWarehouse.quantity / game.fuelWarehouse.capacity
    : 0;
  const estimatedDailyRent = game.fuelWarehouse.quantity * FUEL_UNIT_MASS_TONNES * FUEL_WAREHOUSE_RENT_PER_TONNE_DAY;

  return (
    <main className="fuel-workspace">
      <section className="fuel-hero glass-panel">
        <div>
          <span className="eyebrow">UNIFIED FUEL MARKET · V0.5.2</span>
          <h2>燃料风险管理</h2>
          <p>统一市场报价；通过供货合约锁定成本，或租用仓库保留低价现货。</p>
        </div>
        <div className="fuel-hero-price"><span>当前市场价</span><strong>{price.toFixed(3)} Cr</strong><small>交付成本 {(price * FUEL_OPERATING_COST_SCALE).toFixed(2)} Cr / FU</small></div>
        <div className="fuel-kpi"><span>预计每周消耗</span><strong>{formatNumber(weeklyForecast)} FU</strong><small>最近经营与当前需求基准</small></div>
        <div className="fuel-kpi"><span>合约覆盖</span><strong>{(coverage * 100).toFixed(0)}%</strong><small>保留现货 {(Math.max(0, 1 - coverage) * 100).toFixed(0)}%</small></div>
        <div className="fuel-kpi"><span>仓库库存</span><strong>{game.fuelWarehouse.quantity.toFixed(1)} FU</strong><small>{game.fuelWarehouse.rented ? `预计日租 ${formatCredits(estimatedDailyRent)}` : "尚未租用"}</small></div>
      </section>

      <section className="fuel-dashboard-grid">
        <article className="fuel-section-card glass-panel">
          <div className="fleet-section-heading">
            <div><span className="eyebrow">PRICE HISTORY</span><h2>统一市场走势</h2></div>
            <div className="fuel-price-history-controls">
              <label>查看周期
                <select
                  aria-label="油价记录查看周期"
                  value={priceHistoryDays}
                  onChange={(event) => {
                    setPriceHistoryDays(Number(event.target.value));
                    setHoveredPriceIndex(null);
                  }}
                >
                  {PRICE_HISTORY_DAY_OPTIONS.map((days) => <option value={days} key={days}>{days} 日</option>)}
                </select>
              </label>
              <p>已显示 {priceRecords.length} 日 · {minimumPrice.toFixed(2)}–{maximumPrice.toFixed(2)} Cr</p>
            </div>
          </div>
          <div className="fuel-price-chart" role="img" aria-label={`最近 ${priceRecords.length} 日统一燃料价格，横轴为游戏日期，纵轴为每标准燃料单位价格`}>
            <strong className="fuel-price-y-title">价格（Cr/FU）</strong>
            <div className="fuel-price-y-axis">
              {priceTicks.map((tick, index) => <span key={index} style={{ top: `${index * 25}%` }}>{tick.toFixed(2)}</span>)}
            </div>
            <div
              className="fuel-price-plot"
              onMouseMove={(event) => {
                if (priceRecords.length === 0) return;
                const bounds = event.currentTarget.getBoundingClientRect();
                const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width)));
                setHoveredPriceIndex(Math.round(ratio * (priceRecords.length - 1)));
              }}
              onMouseLeave={() => setHoveredPriceIndex(null)}
            >
              <svg className="fuel-wide-chart" viewBox="0 0 1000 140" preserveAspectRatio="none" aria-hidden="true">
                {[0, 35, 70, 105, 140].map((y) => <line key={y} x1="0" y1={y} x2="1000" y2={y} />)}
                <polyline points={pricePoints} />
              </svg>
              {hoveredPriceRecord && <>
                <i className="fuel-price-hover-line" style={{ left: `${hoveredPriceLeft}%` }} />
                <i className="fuel-price-hover-dot" style={{ left: `${hoveredPriceLeft}%`, top: `${hoveredPriceTop}%` }} />
                <div className={`fuel-price-tooltip${hoveredPriceLeft < 15 ? " left" : hoveredPriceLeft > 85 ? " right" : ""}${hoveredPriceTop < 22 ? " below" : ""}`} style={{ left: `${hoveredPriceLeft}%`, top: `${hoveredPriceTop}%` }}>
                  <span>{formatGameDate(hoveredPriceRecord.day)}</span>
                  <strong>{hoveredPriceRecord.price.toFixed(3)} Cr / FU</strong>
                </div>
              </>}
            </div>
            <div className="fuel-price-x-axis">
              {priceTickIndexes.map((index) => <span
                className={priceRecords.length <= 1 ? "single" : index === 0 ? "start" : index === priceRecords.length - 1 ? "end" : ""}
                key={index}
                style={{ left: `${priceRecords.length <= 1 ? 50 : index / (priceRecords.length - 1) * 100}%` }}
              >{shortGameDate(priceRecords[index]!.day)}</span>)}
            </div>
            <strong className="fuel-price-x-title">游戏日期</strong>
          </div>
        </article>

        <article className="fuel-section-card glass-panel">
          <div className="fleet-section-heading"><div><span className="eyebrow">DAILY BURN</span><h2>最近 30 天燃料消耗</h2></div><p>合约 · 仓库 · 现货来源</p></div>
          <div className="fuel-consumption-chart" aria-label="最近三十日每日燃料消耗">
            {consumptionRecords.length === 0 ? <div className="empty-state larger">完成首个经营日后显示燃料消耗。</div> : consumptionRecords.map((record) => {
              const total = record.fuelConsumedUnits ?? 0;
              const contract = Math.min(total, record.fuelContractUsedUnits ?? 0);
              const warehouse = Math.min(Math.max(0, total - contract), record.fuelWarehouseUsedUnits ?? 0);
              const spot = Math.max(0, total - contract - warehouse);
              return <div className="fuel-day-column" key={record.day} title={`第 ${record.day} 日：${total.toFixed(1)} FU`}>
                <div style={{ height: `${Math.max(2, total / maximumConsumption * 100)}%` }}>
                  <i className="contract" style={{ height: `${total > 0 ? contract / total * 100 : 0}%` }} />
                  <i className="warehouse" style={{ height: `${total > 0 ? warehouse / total * 100 : 0}%` }} />
                  <i className="spot" style={{ height: `${total > 0 ? spot / total * 100 : 0}%` }} />
                </div>
                <span>{record.day}</span>
              </div>;
            })}
          </div>
          <div className="fuel-chart-legend"><span><i className="contract" />合约</span><span><i className="warehouse" />仓库</span><span><i className="spot" />现货</span></div>
        </article>
      </section>

      <section className="fuel-section-card glass-panel">
        <div className="fleet-section-heading"><div><span className="eyebrow">SUPPLY CONTRACTS</span><h2>签订供货合约</h2></div><p>20% 定金；剩余 80% 在合约期内按日支付。</p></div>
        <div className="fuel-contract-builder">
          <label>合约期限
            <select value={termWeeks} onChange={(event) => setTermWeeks(Number(event.target.value))}>
              {[1, 2, 4, 8, 12, 16, 20, 24, 28, 32].map((weeks) => <option value={weeks} key={weeks}>{weeks} 周</option>)}
            </select>
          </label>
          <label>每周供应量
            <input type="number" min={FUEL_CONTRACT_MINIMUM_WEEKLY_UNITS} step="10" value={weeklyUnits} onChange={(event) => setWeeklyUnits(Number(event.target.value))} />
          </label>
          <div><span>期限附加率</span><strong>{quote ? `${(quote.premiumRate * 100).toFixed(2)}%` : "—"}</strong></div>
          <div><span>固定合约价</span><strong>{quote ? `${quote.contractMarketPrice.toFixed(3)} Cr` : "—"}</strong></div>
          <div><span>合约总额</span><strong>{quote ? formatCredits(quote.totalValue) : "—"}</strong></div>
          <div><span>签约定金</span><strong>{quote ? formatCredits(quote.deposit) : "—"}</strong></div>
          <button disabled={!quote || game.cash < (quote?.deposit ?? 0)} onClick={() => quote && onSignContract(termWeeks, weeklyUnits)}>支付定金并签约</button>
        </div>
        <small className="fuel-rule-note">最低 {FUEL_CONTRACT_MINIMUM_WEEKLY_UNITS} FU/周、每 10 FU 调整；提前取消将没收未摊销定金，并收取剩余合同额 25% 与供应商价格损失中的较高者。</small>

        <div className="fuel-contract-list">
          {activeContracts.length === 0 ? <div className="empty-state larger">当前没有执行中的燃料合约。</div> : activeContracts.map((contract) => {
            const remainingUnits = Math.max(0, contract.totalUnits - contract.deliveredUnits);
            const remainingValue = remainingUnits * contract.deliveredUnitCost;
            const supplierLoss = Math.max(0, contract.deliveredUnitCost - price * FUEL_OPERATING_COST_SCALE) * remainingUnits;
            const additionalFee = Math.max(remainingValue * FUEL_CONTRACT_CANCELLATION_RATE, supplierLoss);
            return <article key={contract.id}>
              <div><strong>{contract.id}</strong><span>{contract.createdAutomatically ? "自动签约" : "手动签约"} · {contractStatus(game, contract)}</span></div>
              <div><span>供应</span><strong>{contract.weeklyUnits.toFixed(0)} FU/周</strong></div>
              <div><span>固定价</span><strong>{contract.contractMarketPrice.toFixed(3)} Cr</strong></div>
              <div><span>剩余期限</span><strong>{Math.max(0, contract.endsOnDay - game.day + 1)} 天</strong></div>
              <div><span>解约总损失</span><strong>{formatCredits(contract.depositRemaining + additionalFee)}</strong></div>
              <button onClick={() => onCancelContract(contract.id)}>提前解约</button>
            </article>;
          })}
        </div>
        {historicalContracts.length > 0 && <details className="fuel-contract-history"><summary>查看最近历史合约（{historicalContracts.length}）</summary>{historicalContracts.map((contract) => <p key={contract.id}><strong>{contract.id}</strong><span>{contractStatus(game, contract)} · {contract.weeklyUnits.toFixed(0)} FU/周 · {contract.contractMarketPrice.toFixed(3)} Cr</span></p>)}</details>}
      </section>

      <section className="fuel-dashboard-grid strategy">
        <article className="fuel-section-card glass-panel">
          <div className="fleet-section-heading"><div><span className="eyebrow">AUTOMATION</span><h2>自动签约策略</h2></div><p>按未来净敞口补足，不会在低价期间逐日重复签约。</p></div>
          <div className="fuel-policy-form">
            <label className="toggle-line"><input type="checkbox" checked={autoEnabled} onChange={(event) => setAutoEnabled(event.target.checked)} />启用自动签约</label>
            <label>触发价格<input type="number" min="0.5" max="6" step="0.05" value={autoTrigger} onChange={(event) => setAutoTrigger(Number(event.target.value))} /></label>
            <label>合约期限<select value={autoTerm} onChange={(event) => setAutoTerm(Number(event.target.value))}>{Array.from({ length: 32 }, (_, index) => index + 1).map((weeks) => <option value={weeks} key={weeks}>{weeks} 周</option>)}</select></label>
            <label>保留现货比例<input type="number" min="0" max="100" step="5" value={spotExposure} onChange={(event) => setSpotExposure(Number(event.target.value))} /></label>
            <button onClick={() => onAutoPolicyChange({ enabled: autoEnabled, triggerPrice: autoTrigger, termWeeks: autoTerm, spotExposureShare: spotExposure / 100 })}>保存自动策略</button>
          </div>
          <p className="fuel-explanation">当报价不高于 {autoTrigger.toFixed(2)} Cr 时，系统最多把未来预测消耗的 {Math.max(0, 100 - spotExposure).toFixed(0)}% 纳入合同；新增缺口不足 100 FU/周时继续使用现货。</p>
        </article>

        <article className="fuel-section-card glass-panel">
          <div className="fleet-section-heading"><div><span className="eyebrow">WAREHOUSE</span><h2>租用燃料仓库</h2></div><p>按日末实际库存吨数计租，不对空置容量收费。</p></div>
          {!game.fuelWarehouse.rented ? <div className="fuel-rental-callout"><p>固定容量 {formatNumber(game.fuelWarehouse.capacity)} FU；租金 {FUEL_WAREHOUSE_RENT_PER_TONNE_DAY.toFixed(2)} Cr/吨/天。</p><button onClick={() => onWarehouseRentalChange(true)}>租用仓库</button></div> : <>
            <div className="fuel-storage-overview"><div><span>库存</span><strong>{game.fuelWarehouse.quantity.toFixed(1)} / {game.fuelWarehouse.capacity.toFixed(0)} FU</strong></div><div className="fuel-storage-meter"><i style={{ width: `${Math.min(100, warehouseFill * 100)}%` }} /></div><small>加权平均成本 {game.fuelWarehouse.quantity > 0 ? `${(game.fuelWarehouse.averageUnitCost / FUEL_OPERATING_COST_SCALE).toFixed(3)} Cr` : "—"}</small></div>
            <div className="fuel-warehouse-trade"><label>交易数量<input type="number" min="1" step="10" value={tradeUnits} onChange={(event) => setTradeUnits(Number(event.target.value))} /></label><button onClick={() => onBuyWarehouseFuel(tradeUnits)}>按市价买入</button><button onClick={() => onSellWarehouseFuel(tradeUnits)}>按八折出售</button></div>
            <div className="fuel-policy-form warehouse">
              <label className="toggle-line"><input type="checkbox" checked={withdrawalUnlimited} onChange={(event) => setWithdrawalUnlimited(event.target.checked)} />每日提取不限量</label>
              {!withdrawalUnlimited && <label>每日提取上限<input type="number" min="0" step="10" value={withdrawalLimit} onChange={(event) => setWithdrawalLimit(Number(event.target.value))} /></label>}
              <label>合约盈余<select value={surplusPolicy} onChange={(event) => setSurplusPolicy(event.target.value as FuelSurplusPolicy)}><option value="store-first">优先入库</option><option value="sell-all">全部出售</option></select></label>
              <button onClick={() => onWarehousePolicyChange(withdrawalUnlimited ? null : withdrawalLimit, surplusPolicy)}>保存仓库策略</button>
            </div>
            <button className="cancel-warehouse" disabled={game.fuelWarehouse.quantity > 0} onClick={() => onWarehouseRentalChange(false)}>取消租用</button>
          </>}
        </article>
      </section>

      {latest && <section className="fuel-section-card glass-panel fuel-last-settlement">
        <div className="fleet-section-heading"><div><span className="eyebrow">LAST SETTLEMENT</span><h2>昨日燃料结算</h2></div><p>第 {latest.day} 日</p></div>
        <div><span>实际消耗<strong>{(latest.fuelConsumedUnits ?? 0).toFixed(1)} FU</strong></span><span>合约供应<strong>{(latest.fuelContractDeliveredUnits ?? 0).toFixed(1)} FU</strong></span><span>仓库提取<strong>{(latest.fuelWarehouseUsedUnits ?? 0).toFixed(1)} FU</strong></span><span>现货采购<strong>{(latest.fuelSpotPurchasedUnits ?? 0).toFixed(1)} FU</strong></span><span>盈余出售<strong>{(latest.fuelSurplusSoldUnits ?? 0).toFixed(1)} FU</strong></span><span>仓储费<strong>{formatCredits(latest.fuelWarehouseRent ?? 0)}</strong></span></div>
      </section>}
    </main>
  );
}
