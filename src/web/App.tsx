import { useCallback, useEffect, useMemo, useState } from "react";
import {
  advanceGameDay,
  closePlayerRoute,
  assignShipsToFleetConfiguration,
  createFleetConfiguration,
  createGeneratedGameEvents,
  createGeneratedScenario,
  createNewGame,
  createPlayerRoute,
  DEFAULT_GALAXY_CONFIG,
  gameScenario,
  isGameState,
  migrateGameState,
  performShipMaintenance,
  placeShipPurchaseAgreement,
  setAutoMaintenanceThreshold,
  setAutoReplacementAge,
  setPlayerRouteFares,
  updateFleetConfiguration,
  simulateCampaign,
  togglePlayerRoute,
  type CreateRouteInput,
  type GalaxyGenerationConfig,
  type GameState,
} from "../index.js";
import { CompanyPanel } from "./components/CompanyPanel.js";
import { DemandPanel } from "./components/DemandPanel.js";
import { FuelMarketPanel } from "./components/FuelMarketPanel.js";
import { FleetPanel } from "./components/FleetPanel.js";
import { GalaxyMap } from "./components/GalaxyMap.js";
import { GenerationPanel } from "./components/GenerationPanel.js";
import { OperationsPanel } from "./components/OperationsPanel.js";
import { RouteEconomicsPanel } from "./components/RouteEconomicsPanel.js";
import { TimeControls, type GameSpeed } from "./components/TimeControls.js";
import { TopMetrics } from "./components/TopMetrics.js";
import { loadStoredGame, persistGame } from "./storage.js";

const SAVE_KEY = "stellar-lines-v0-save";

interface GameSession {
  generated: ReturnType<typeof createGeneratedScenario>;
  game: GameState;
  restored: boolean;
}

function createSession(
  config: GalaxyGenerationConfig,
  basePortId?: string,
  restored = true,
): GameSession {
  const generated = createGeneratedScenario(config);
  const base = basePortId ?? generated.galaxy.ports[0]?.id;
  if (!base) throw new Error("可玩星域至少需要两个有人星球");
  return {
    generated,
    game: createNewGame(config, generated.galaxy, base, generated.scenario.shipTypes),
    restored,
  };
}

function initialSession(): GameSession {
  try {
    const storedGame = migrateGameState(loadStoredGame(window.localStorage, SAVE_KEY));
    if (isGameState(storedGame)) {
      return { generated: createGeneratedScenario(storedGame.config), game: storedGame, restored: true };
    }
  } catch {
    // A corrupt or unavailable local save should never prevent a new game.
  }
  return createSession(DEFAULT_GALAXY_CONFIG, undefined, false);
}

export function App() {
  const [session, setSession] = useState<GameSession>(initialSession);
  const [config, setConfig] = useState<GalaxyGenerationConfig>(session.game.config);
  const [draftBasePortId, setDraftBasePortId] = useState(session.game.basePortId);
  const [selectedPortId, setSelectedPortId] = useState(session.game.basePortId);
  const [speed, setSpeed] = useState<GameSpeed>(0);
  const [notice, setNotice] = useState(() =>
    session.restored
      ? `自动存档已载入：继续第 ${session.game.day} 日的经营。`
      : "请先生成星域并选择一个基地星球。",
  );
  const [error, setError] = useState<string | null>(null);
  const [saveWarning, setSaveWarning] = useState<string | null>(null);
  const [showNewGame, setShowNewGame] = useState(!session.restored);
  const [activeView, setActiveView] = useState<"map" | "fleet" | "route">("map");
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(session.game.routes[0]?.id ?? null);
  const { generated, game } = session;

  const newGamePreview = useMemo(() => {
    try {
      return createGeneratedScenario(config);
    } catch {
      return null;
    }
  }, [config]);

  useEffect(() => {
    if (!newGamePreview?.galaxy.ports.some((port) => port.id === draftBasePortId)) {
      setDraftBasePortId(newGamePreview?.galaxy.ports[0]?.id ?? "");
    }
  }, [draftBasePortId, newGamePreview]);

  const events = useMemo(
    () => createGeneratedGameEvents(generated.galaxy),
    [generated.galaxy],
  );
  const previewSettlement = useMemo(() => {
    const scenario = gameScenario(generated.scenario, generated.galaxy, game);
    return simulateCampaign(scenario, { startDay: game.day, numberOfDays: 1 }).days[0]!.settlement;
  }, [game, generated]);

  useEffect(() => {
    if (!session.restored) return;
    const result = persistGame(window.localStorage, SAVE_KEY, game);
    if (!result.saved) {
      setSaveWarning("浏览器存储空间已满：当前进度仍可继续游玩，但自动存档暂不可用。");
    } else if (game.history.length > 0 && result.retainedHistoryDays < Math.min(90, game.history.length)) {
      setSaveWarning(`浏览器存储空间不足：自动存档已保留最近 ${result.retainedHistoryDays} 日历史。`);
    } else {
      setSaveWarning(null);
    }
  }, [game, session.restored]);

  const commit = useCallback((action: () => { state: GameState; message: string }) => {
    try {
      const result = action();
      setSession((current) => ({ ...current, game: result.state, restored: true }));
      setNotice(result.message);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失败");
      setSpeed(0);
    }
  }, []);

  const advanceOneDay = useCallback(() => {
    commit(() => advanceGameDay(game, generated.scenario, generated.galaxy));
  }, [commit, game, generated]);

  useEffect(() => {
    if (speed === 0 || game.status !== "playing") return undefined;
    const delay = speed === 1 ? 1000 : speed === 4 ? 260 : 85;
    const timer = window.setTimeout(advanceOneDay, delay);
    return () => window.clearTimeout(timer);
  }, [advanceOneDay, game.status, speed]);

  const openNewGame = () => {
    setConfig(game.config);
    setDraftBasePortId(game.basePortId);
    setError(null);
    setShowNewGame(true);
  };

  const startNewGame = () => {
    try {
      if (!newGamePreview) throw new Error("请先提供有效的银河配置");
      const next: GameSession = {
        generated: newGamePreview,
        game: createNewGame(config, newGamePreview.galaxy, draftBasePortId, newGamePreview.scenario.shipTypes),
        restored: true,
      };
      setSession(next);
      setSelectedPortId(next.game.basePortId);
      setActiveView("fleet");
      setSpeed(0);
      setShowNewGame(false);
      setError(null);
      setNotice("公司基地已设立。远星一号为空舱交付，请先在舰队管理中配置舱位。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法生成星域");
    }
  };

  const createRoute = (input: CreateRouteInput) =>
    commit(() => createPlayerRoute(game, input, generated.galaxy, generated.scenario.shipTypes));

  const previewLaneCount = newGamePreview?.galaxy.systemLanes.filter((lane) => lane.mode === "hyperspace").length ?? 0;
  const baseOptions = (newGamePreview?.galaxy.ports ?? []).map((port) => {
    const system = newGamePreview?.galaxy.systems.find((candidate) => candidate.id === port.systemId);
    return { value: port.id, label: `${system?.name ?? port.name} · ${port.name}` };
  });

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-mark">FS</div>
        <div className="brand-copy"><strong>远星航运局</strong><span>PLAYABLE PROTOTYPE V0.5</span></div>
        <div className="header-sector"><span>当前星域</span><strong>{generated.scenario.name}</strong></div>
        <button className="new-game-button" onClick={openNewGame}>新游戏</button>
        <div className={saveWarning ? "header-indicator warning" : "header-indicator"}><i />{saveWarning ? "存档受限" : "自动存档"}</div>
      </header>

      <TopMetrics game={game} />

      <nav className="primary-view-tabs" aria-label="主要功能">
        <button className={activeView === "map" ? "active" : ""} onClick={() => setActiveView("map")}>
          <span>星图运营</span><small>星港 · 航线 · 市场</small>
        </button>
        <button className={activeView === "fleet" ? "active" : ""} onClick={() => setActiveView("fleet")}>
          <span>舰队管理</span><small>购买 · 舱位 · 维护</small>
        </button>
        {selectedRouteId && <button className={activeView === "route" ? "active" : ""} onClick={() => setActiveView("route")}>
          <span>航线经营</span><small>旅客 · 价格 · 成本</small>
        </button>}
      </nav>

      {activeView === "route" && selectedRouteId ? (
        <RouteEconomicsPanel
          game={game}
          galaxy={generated.galaxy}
          baseScenario={generated.scenario}
          routeId={selectedRouteId}
          onBack={() => setActiveView("map")}
          onConfirmFares={(routeId, fares) => commit(() => setPlayerRouteFares(game, routeId, fares))}
        />
      ) : activeView === "fleet" ? (
        <FleetPanel
          game={game}
          shipTypes={generated.scenario.shipTypes}
          onPlacePurchaseAgreement={(lines) => commit(() => placeShipPurchaseAgreement(game, lines, generated.scenario.shipTypes))}
          onCreateConfiguration={(shipTypeId, name, cabins) => commit(() => createFleetConfiguration(game, shipTypeId, name, cabins, generated.scenario.shipTypes))}
          onUpdateConfiguration={(configurationId, name, cabins) => commit(() => updateFleetConfiguration(game, configurationId, name, cabins, generated.scenario.shipTypes))}
          onAssignShips={(configurationId, shipIds) => commit(() => assignShipsToFleetConfiguration(game, configurationId, shipIds))}
          onMaintainShip={(shipId) => commit(() => performShipMaintenance(game, shipId, generated.scenario.shipTypes))}
          onAutoMaintenanceThresholdChange={(threshold) => commit(() => setAutoMaintenanceThreshold(game, threshold))}
          onAutoReplacementAgeChange={(ageYears) => commit(() => setAutoReplacementAge(game, ageYears))}
        />
      ) : (
        <main className="workspace">
          <div className="map-game-stack">
            <GalaxyMap
              key={generated.galaxy.config.seed}
              galaxy={generated.galaxy}
              game={game}
              shipTypes={generated.scenario.shipTypes}
              motionDurationMs={speed === 1 ? 1_000 : speed === 4 ? 260 : speed === 16 ? 85 : 650}
              basePortId={game.basePortId}
              selectedPortId={selectedPortId}
              onSelectPort={setSelectedPortId}
            />
            {game.status === "lost" && (
              <div className="game-outcome lost">
                <span>本局经营结束</span>
                <strong>资金耗尽，或未能在期限内完成初级目标</strong>
                <button onClick={openNewGame}>开始新游戏</button>
              </div>
            )}
          </div>
          <aside className="inspector-panel glass-panel">
            <OperationsPanel
              game={game}
              galaxy={generated.galaxy}
              shipTypes={generated.scenario.shipTypes}
              selectedPortId={selectedPortId}
              onCreateRoute={createRoute}
              onOpenFleet={() => setActiveView("fleet")}
            />
            <DemandPanel galaxy={generated.galaxy} settlement={previewSettlement} selectedPortId={selectedPortId} />
            <FuelMarketPanel game={game} galaxy={generated.galaxy} selectedPortId={selectedPortId} />
            <CompanyPanel
              game={game}
              galaxy={generated.galaxy}
              shipTypes={generated.scenario.shipTypes}
              events={events}
              onToggleRoute={(routeId) => commit(() => togglePlayerRoute(game, routeId))}
              onOpenRoute={(routeId) => { setSelectedRouteId(routeId); setActiveView("route"); setSpeed(0); }}
              onCloseRoute={(routeId) => commit(() => closePlayerRoute(game, routeId))}
            />
          </aside>
        </main>
      )}

      {(notice || error || saveWarning) && <div className={error || saveWarning ? "game-toast global-toast error" : "game-toast global-toast"}>{error ?? saveWarning ?? notice}</div>}

      <TimeControls day={game.day} speed={speed} disabled={game.status !== "playing"} onSpeedChange={setSpeed} onAdvance={advanceOneDay} />

      {showNewGame && (
        <div className="new-game-overlay" role="dialog" aria-modal="true" aria-label="创建新游戏">
          <div className="new-game-dialog glass-panel">
            <div className="new-game-heading">
              <div><span className="eyebrow">NEW COMPANY</span><h2>生成星域并选择基地</h2></div>
              {session.restored && <button onClick={() => setShowNewGame(false)}>关闭</button>}
            </div>
            <GenerationPanel
              config={config}
              setConfig={setConfig}
              onGenerate={startNewGame}
              error={error}
              generatedCounts={{ systems: newGamePreview?.galaxy.systems.length ?? 0, ports: newGamePreview?.galaxy.ports.length ?? 0, lanes: previewLaneCount }}
              baseOptions={baseOptions}
              basePortId={draftBasePortId}
              onBasePortChange={setDraftBasePortId}
            />
          </div>
        </div>
      )}
    </div>
  );
}
