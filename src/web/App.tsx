import { useCallback, useEffect, useMemo, useState } from "react";
import {
  advanceGameDay,
  adjustPlayerRouteFare,
  buyShip,
  closePlayerRoute,
  createGeneratedGameEvents,
  createGeneratedScenario,
  createNewGame,
  createPlayerRoute,
  DEFAULT_GALAXY_CONFIG,
  gameScenario,
  isGameState,
  simulateCampaign,
  togglePlayerRoute,
  type CreateRouteInput,
  type GalaxyGenerationConfig,
  type GameState,
} from "../index.js";
import { CompanyPanel } from "./components/CompanyPanel.js";
import { DemandPanel } from "./components/DemandPanel.js";
import { GalaxyMap } from "./components/GalaxyMap.js";
import { GenerationPanel } from "./components/GenerationPanel.js";
import { OperationsPanel } from "./components/OperationsPanel.js";
import { TimeControls, type GameSpeed } from "./components/TimeControls.js";
import { TopMetrics } from "./components/TopMetrics.js";

const SAVE_KEY = "stellar-lines-v0-save";

interface GameSession {
  generated: ReturnType<typeof createGeneratedScenario>;
  game: GameState;
}

function createSession(config: GalaxyGenerationConfig): GameSession {
  const generated = createGeneratedScenario(config);
  return { generated, game: createNewGame(config, generated.galaxy) };
}

function initialSession(): GameSession {
  try {
    const serialized = window.localStorage.getItem(SAVE_KEY);
    if (serialized) {
      const game: unknown = JSON.parse(serialized);
      if (isGameState(game)) {
        return { generated: createGeneratedScenario(game.config), game };
      }
    }
  } catch {
    // A corrupt or unavailable local save should never prevent a new game.
  }
  return createSession(DEFAULT_GALAXY_CONFIG);
}

export function App() {
  const [session, setSession] = useState<GameSession>(initialSession);
  const [config, setConfig] = useState<GalaxyGenerationConfig>(session.game.config);
  const [selectedPortId, setSelectedPortId] = useState(session.game.basePortId);
  const [speed, setSpeed] = useState<GameSpeed>(0);
  const [notice, setNotice] = useState(() =>
    session.game.history.length > 0
      ? `自动存档已载入：继续第 ${session.game.day} 日的经营。`
      : "欢迎登舰：选择起点、目的地和远星一号，建立第一条航线。",
  );
  const [error, setError] = useState<string | null>(null);
  const [showNewGame, setShowNewGame] = useState(false);
  const { generated, game } = session;

  const events = useMemo(
    () => createGeneratedGameEvents(generated.galaxy),
    [generated.galaxy],
  );
  const previewSettlement = useMemo(() => {
    const scenario = gameScenario(generated.scenario, generated.galaxy, game);
    return simulateCampaign(scenario, { startDay: game.day, numberOfDays: 1 }).days[0]!.settlement;
  }, [game, generated]);

  useEffect(() => {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(game));
  }, [game]);

  const commit = useCallback((action: () => { state: GameState; message: string }) => {
    try {
      const result = action();
      setSession((current) => ({ ...current, game: result.state }));
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

  const startNewGame = () => {
    try {
      const next = createSession(config);
      setSession(next);
      setSelectedPortId(next.game.basePortId);
      setSpeed(0);
      setShowNewGame(false);
      setError(null);
      setNotice("新公司已成立。你的首艘 Meridian 客轮正在基地待命。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法生成星域");
    }
  };

  const createRoute = (input: CreateRouteInput) =>
    commit(() => createPlayerRoute(
      game,
      input,
      generated.scenario.ports,
      generated.scenario.worldLegs,
      generated.scenario.shipTypes,
    ));

  const laneCount = generated.galaxy.systemLanes.filter((lane) => lane.mode === "hyperspace").length;
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-mark">FS</div>
        <div className="brand-copy"><strong>远星航运局</strong><span>PLAYABLE PROTOTYPE V0</span></div>
        <div className="header-sector"><span>当前星域</span><strong>{generated.scenario.name}</strong></div>
        <button className="new-game-button" onClick={() => setShowNewGame(true)}>新游戏</button>
        <div className="header-indicator"><i />自动存档</div>
      </header>

      <TopMetrics game={game} />

      <main className="workspace">
        <OperationsPanel
          game={game}
          galaxy={generated.galaxy}
          shipTypes={generated.scenario.shipTypes}
          selectedPortId={selectedPortId}
          onCreateRoute={createRoute}
          onBuyShip={(shipTypeId) => commit(() => buyShip(game, shipTypeId, generated.scenario.shipTypes))}
        />
        <div className="map-game-stack">
          <GalaxyMap
            key={generated.galaxy.config.seed}
            galaxy={generated.galaxy}
            playerRoutes={game.routes}
            selectedPortId={selectedPortId}
            onSelectPort={setSelectedPortId}
          />
          {(notice || error) && <div className={error ? "game-toast error" : "game-toast"}>{error ?? notice}</div>}
          {game.status !== "playing" && (
            <div className={`game-outcome ${game.status}`}>
              <span>{game.status === "won" ? "经营目标达成" : "本局经营结束"}</span>
              <strong>{game.status === "won" ? "远星航运已成为星域骨干承运人" : "资金或期限目标未能维持"}</strong>
              <button onClick={() => setShowNewGame(true)}>开始新游戏</button>
            </div>
          )}
        </div>
        <aside className="inspector-panel glass-panel">
          <DemandPanel galaxy={generated.galaxy} settlement={previewSettlement} selectedPortId={selectedPortId} />
          <CompanyPanel
            game={game}
            galaxy={generated.galaxy}
            shipTypes={generated.scenario.shipTypes}
            events={events}
            onToggleRoute={(routeId) => commit(() => togglePlayerRoute(game, routeId))}
            onAdjustFare={(routeId, delta) => commit(() => adjustPlayerRouteFare(game, routeId, delta))}
            onCloseRoute={(routeId) => commit(() => closePlayerRoute(game, routeId))}
          />
        </aside>
      </main>

      <TimeControls
        day={game.day}
        speed={speed}
        disabled={game.status !== "playing"}
        onSpeedChange={setSpeed}
        onAdvance={advanceOneDay}
      />

      {showNewGame && (
        <div className="new-game-overlay" role="dialog" aria-modal="true" aria-label="创建新游戏">
          <div className="new-game-dialog glass-panel">
            <div className="new-game-heading">
              <div><span className="eyebrow">NEW COMPANY</span><h2>创建新游戏</h2></div>
              <button onClick={() => setShowNewGame(false)}>关闭</button>
            </div>
            <GenerationPanel
              config={config}
              setConfig={setConfig}
              onGenerate={startNewGame}
              error={error}
              generatedCounts={{ systems: config.systemCount, ports: config.starportCount, lanes: laneCount }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
