import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createGeneratedScenario,
  DEFAULT_GALAXY_CONFIG,
  simulateCampaign,
  type DaySettlement,
  type GalaxyGenerationConfig,
} from "../index.js";
import { DemandPanel } from "./components/DemandPanel.js";
import type { FinanceTotals } from "./components/FinancePanel.js";
import { ContinuousGalaxyMap } from "./components/ContinuousGalaxyMap.js";
import { GenerationPanel } from "./components/GenerationPanel.js";
import { TimeControls, type GameSpeed } from "./components/TimeControls.js";
import { TopMetrics } from "./components/TopMetrics.js";

const STARTING_BALANCE = 5_000_000;

function settlementForDay(
  generated: ReturnType<typeof createGeneratedScenario>,
  day: number,
): DaySettlement {
  return simulateCampaign(generated.scenario, { startDay: day, numberOfDays: 1 }).days[0]!.settlement;
}

function playerTotals(settlement: DaySettlement): FinanceTotals {
  const player = settlement.companies.find((company) => company.companyId === "player");
  return {
    revenue: player?.ticketRevenue ?? 0,
    cost: player?.operatingCost ?? 0,
    profit: player?.operatingProfit ?? 0,
    passengers: player?.passengers ?? 0,
  };
}

export function App() {
  const [config, setConfig] = useState<GalaxyGenerationConfig>(DEFAULT_GALAXY_CONFIG);
  const [generated, setGenerated] = useState(() => createGeneratedScenario(DEFAULT_GALAXY_CONFIG));
  const [day, setDay] = useState(1);
  const [speed, setSpeed] = useState<GameSpeed>(0);
  const [error, setError] = useState<string | null>(null);
  const [selectedPortId, setSelectedPortId] = useState(generated.galaxy.ports[0]!.id);
  const [settlement, setSettlement] = useState(() => settlementForDay(generated, 1));
  const [cumulative, setCumulative] = useState<FinanceTotals>(() => playerTotals(settlement));

  const playerToday = useMemo(
    () => settlement.companies.find((company) => company.companyId === "player"),
    [settlement],
  );

  const regenerate = () => {
    try {
      const next = createGeneratedScenario(config);
      const firstSettlement = settlementForDay(next, 1);
      setGenerated(next);
      setDay(1);
      setSpeed(0);
      setSelectedPortId(next.galaxy.ports[0]!.id);
      setSettlement(firstSettlement);
      setCumulative(playerTotals(firstSettlement));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法生成星域");
    }
  };

  const advanceOneDay = useCallback(() => {
    const nextDay = day + 1;
    const nextSettlement = settlementForDay(generated, nextDay);
    const nextTotals = playerTotals(nextSettlement);
    setDay(nextDay);
    setSettlement(nextSettlement);
    setCumulative((current) => ({
      revenue: current.revenue + nextTotals.revenue,
      cost: current.cost + nextTotals.cost,
      profit: current.profit + nextTotals.profit,
      passengers: current.passengers + nextTotals.passengers,
    }));
  }, [day, generated]);

  useEffect(() => {
    if (speed === 0) return undefined;
    const delay = speed === 1 ? 1000 : speed === 4 ? 260 : 85;
    const timer = window.setTimeout(advanceOneDay, delay);
    return () => window.clearTimeout(timer);
  }, [advanceOneDay, speed]);

  const laneCount = generated.galaxy.worldLegs.filter((leg) => leg.mode === "hyperspace").length;
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-mark">FS</div>
        <div className="brand-copy"><strong>远星航运局</strong><span>FARSTAR TRANSPORT AUTHORITY</span></div>
        <div className="header-sector">
          <span>当前星域</span>
          <strong>{generated.scenario.name}</strong>
        </div>
        <div className="header-indicator"><i />网络在线</div>
      </header>

      <TopMetrics
        day={day}
        today={playerToday}
        cumulative={cumulative}
        startingBalance={STARTING_BALANCE}
      />

      <main className="workspace">
        <GenerationPanel
          config={config}
          setConfig={setConfig}
          onGenerate={regenerate}
          error={error}
          generatedCounts={{
            systems: generated.galaxy.systems.length,
            ports: generated.galaxy.ports.length,
            lanes: laneCount,
          }}
        />
          <ContinuousGalaxyMap
            key={generated.galaxy.config.seed}
            galaxy={generated.galaxy}
            selectedPortId={selectedPortId}
            onSelectPort={setSelectedPortId}
            day={day}
            speed={speed}
          />
        <aside className="inspector-panel glass-panel">
          <DemandPanel
            galaxy={generated.galaxy}
            settlement={settlement}
            selectedPortId={selectedPortId}
          />
        </aside>
      </main>

      <TimeControls day={day} speed={speed} onSpeedChange={setSpeed} onAdvance={advanceOneDay} />
    </div>
  );
}
