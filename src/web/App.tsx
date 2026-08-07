import { useCallback, useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  advanceGameDay,
  buyFuelForWarehouse,
  cancelFuelContract,
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
  orderShipReplacement,
  placeShipPurchaseAgreement,
  requestRouteFleetChange,
  setShipReserveRoute,
  sellShip,
  investInStarportCapacity,
  setAutoMaintenanceThreshold,
  setAutoReplacementAge,
  sellFuelFromWarehouse,
  setFuelAutoContractPolicy,
  setFuelWarehousePolicy,
  setFuelWarehouseRental,
  signFuelContract,
  setPlayerRouteFares,
  setRouteCruiseRatio,
  setRouteDirectionalFares,
  setRouteDirectionalPricingLinked,
  setRouteScheduleBuffer,
  setRouteSlotBid,
  setRouteSublightProfile,
  setRouteWeeklyDepartureMinutes,
  updateFleetConfiguration,
  simulateCampaign,
  togglePlayerRoute,
  type CreateRouteInput,
  type GalaxyGenerationConfig,
  type GameState,
} from "../index.js";
import { CompanyPanel } from "./components/CompanyPanel.js";
import { DemandPanel } from "./components/DemandPanel.js";
import { FuelPanel } from "./components/FuelPanel.js";
import { FleetPanel } from "./components/FleetPanel.js";
import { GalaxyMap } from "./components/GalaxyMap.js";
import { GenerationPanel } from "./components/GenerationPanel.js";
import { OperationsPanel } from "./components/OperationsPanel.js";
import { RouteEconomicsPanel } from "./components/RouteEconomicsPanel.js";
import { SchedulePanel } from "./components/SchedulePanel.js";
import { StarportFlightsPanel } from "./components/StarportFlightsPanel.js";
import { TimeControls, type GameSpeed } from "./components/TimeControls.js";
import { TopMetrics } from "./components/TopMetrics.js";
import { loadStoredGame, persistGame } from "./storage.js";

const SAVE_KEY = "stellar-lines-v0.7-save";
const LEGACY_SAVE_KEYS = ["stellar-lines-v0-save", "stellar-lines-v0.6-save", "stellar-lines-v0.6.1-save"] as const;
const UI_THEME_KEY = "stellar-lines-ui-theme";
const INSPECTOR_WIDTH_KEY = "stellar-lines-inspector-width";
type UiTheme = "deep-space" | "aurora" | "command-deck";

function storedUiTheme(): UiTheme {
  try {
    const stored = window.localStorage.getItem(UI_THEME_KEY);
    if (stored === "aurora" || stored === "command-deck") return stored;
  } catch {
    // UI preferences are optional and must not block the game.
  }
  return "deep-space";
}

function storedInspectorWidth(): number {
  try {
    const stored = Number(window.localStorage.getItem(INSPECTOR_WIDTH_KEY));
    if (Number.isFinite(stored) && stored >= 340 && stored <= 720) return stored;
  } catch {
    // UI preferences are optional and must not block the game.
  }
  return 440;
}

interface GameSession {
  generated: ReturnType<typeof createGeneratedScenario>;
  game: GameState;
  restored: boolean;
  legacySaveDetected: boolean;
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
    game: createNewGame(config, generated.galaxy, base, generated.scenario.shipTypes, generated.scenario.routes.filter((route) => route.companyId !== "player")),
    restored,
    legacySaveDetected: false,
  };
}

function initialSession(): GameSession {
  try {
    const storedGame = migrateGameState(loadStoredGame(window.localStorage, SAVE_KEY));
    if (isGameState(storedGame)) {
      return { generated: createGeneratedScenario(storedGame.config), game: storedGame, restored: true, legacySaveDetected: false };
    }
    const legacySaveDetected = LEGACY_SAVE_KEYS.some((key) => window.localStorage.getItem(key) !== null);
    if (legacySaveDetected) return { ...createSession(DEFAULT_GALAXY_CONFIG, undefined, false), legacySaveDetected: true };
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
      : session.legacySaveDetected
        ? "检测到 v0.6.1 或更早存档。v0.7 采用不兼容的新物理规则，旧存档已保留但不会读取；请创建新游戏。"
        : "请先生成星域并选择一个基地星球。",
  );
  const [error, setError] = useState<string | null>(null);
  const [saveWarning, setSaveWarning] = useState<string | null>(null);
  const [showNewGame, setShowNewGame] = useState(!session.restored);
  const [showSettings, setShowSettings] = useState(false);
  const [uiTheme, setUiTheme] = useState<UiTheme>(storedUiTheme);
  const [inspectorWidth, setInspectorWidth] = useState(storedInspectorWidth);
  const [activeView, setActiveView] = useState<"company" | "map" | "fleet" | "fuel" | "schedule" | "route">("map");
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(session.game.routes[0]?.id ?? null);
  const { generated, game } = session;

  useEffect(() => {
    document.documentElement.dataset.uiTheme = uiTheme;
    try { window.localStorage.setItem(UI_THEME_KEY, uiTheme); } catch { /* optional preference */ }
  }, [uiTheme]);

  useEffect(() => {
    try { window.localStorage.setItem(INSPECTOR_WIDTH_KEY, String(inspectorWidth)); } catch { /* optional preference */ }
  }, [inspectorWidth]);

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
    return simulateCampaign(scenario, {
      startDay: game.day,
      numberOfDays: 1,
    }).days[0]!.settlement;
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
        game: createNewGame(config, newGamePreview.galaxy, draftBasePortId, newGamePreview.scenario.shipTypes, newGamePreview.scenario.routes.filter((route) => route.companyId !== "player")),
        restored: true,
        legacySaveDetected: false,
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

  const changeInspectorWidth = (value: number) => setInspectorWidth(Math.max(340, Math.min(720, Math.round(value))));
  const beginInspectorResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = inspectorWidth;
    const move = (moveEvent: PointerEvent) => changeInspectorWidth(startWidth - (moveEvent.clientX - startX));
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
  };
  const resizeInspectorWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") changeInspectorWidth(inspectorWidth + 20);
    else if (event.key === "ArrowRight") changeInspectorWidth(inspectorWidth - 20);
    else if (event.key === "Home") changeInspectorWidth(340);
    else if (event.key === "End") changeInspectorWidth(720);
    else return;
    event.preventDefault();
  };

  const previewLaneCount = newGamePreview?.galaxy.systemLanes.filter((lane) => lane.mode === "hyperspace").length ?? 0;
  const baseOptions = (newGamePreview?.galaxy.ports ?? []).map((port) => {
    const system = newGamePreview?.galaxy.systems.find((candidate) => candidate.id === port.systemId);
    return { value: port.id, label: `${system?.name ?? port.name} · ${port.name}` };
  });

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-mark">FS</div>
        <div className="brand-copy"><strong>远星航运局</strong><span>PROPULSION ECONOMY V0.7.1</span></div>
        <div className="header-sector"><span>当前星域</span><strong>{generated.scenario.name}</strong></div>
        <button className="new-game-button" onClick={openNewGame}>新游戏</button>
        <button className="settings-button" onClick={() => setShowSettings(true)}>界面设置</button>
        <div className={saveWarning ? "header-indicator warning" : "header-indicator"}><i />{saveWarning ? "存档受限" : "自动存档"}</div>
      </header>

      <TopMetrics game={game} />

      <nav className="primary-view-tabs" aria-label="主要功能">
        <button className={activeView === "company" ? "active" : ""} onClick={() => setActiveView("company")}>
          <span>企业总览</span><small>目标 · 航线 · 声誉</small>
        </button>
        <button className={activeView === "map" ? "active" : ""} onClick={() => setActiveView("map")}>
          <span>星图运营</span><small>星港 · 航班 · 新航线</small>
        </button>
        <button className={activeView === "fleet" ? "active" : ""} onClick={() => setActiveView("fleet")}>
          <span>舰队管理</span><small>购买 · 舱位 · 维护</small>
        </button>
        <button className={activeView === "fuel" ? "active" : ""} onClick={() => setActiveView("fuel")}>
          <span>燃料管理</span><small>市场 · 合约 · 仓库</small>
        </button>
        <button className={activeView === "schedule" ? "active" : ""} onClick={() => setActiveView("schedule")}>
          <span>航班调度</span><small>班表 · 轮转 · 星港</small>
        </button>
        {selectedRouteId && <button className={activeView === "route" ? "active" : ""} onClick={() => setActiveView("route")}>
          <span>航线经营</span><small>旅客 · 价格 · 成本</small>
        </button>}
      </nav>

      {activeView === "company" ? (
        <main className="company-workspace">
          <div className="company-dashboard-hero glass-panel">
            <div><span className="eyebrow">COMPANY OVERVIEW</span><h2>玩家企业信息总览</h2><p>集中查看经营目标、旅客偏好、航线表现和已公布事件。</p></div>
            <div><span>公司声誉</span><strong>{game.companyReputation.toFixed(1)}</strong></div>
            <div><span>运营航线</span><strong>{game.routes.filter((route) => route.active).length}</strong></div>
            <div><span>现役舰船</span><strong>{game.fleet.length}</strong></div>
          </div>
          <section className="company-dashboard-panel glass-panel">
            <CompanyPanel
              game={game}
              galaxy={generated.galaxy}
              shipTypes={generated.scenario.shipTypes}
              events={events}
              onToggleRoute={(routeId) => commit(() => togglePlayerRoute(game, routeId))}
              onOpenRoute={(routeId) => { setSelectedRouteId(routeId); setActiveView("route"); setSpeed(0); }}
              onCloseRoute={(routeId) => commit(() => closePlayerRoute(game, routeId))}
            />
          </section>
        </main>
      ) : activeView === "route" && selectedRouteId ? (
        <RouteEconomicsPanel
          game={game}
          galaxy={generated.galaxy}
          baseScenario={generated.scenario}
          routeId={selectedRouteId}
          onBack={() => setActiveView("map")}
          onConfirmFares={(routeId, fares) => commit(() => setPlayerRouteFares(game, routeId, fares))}
          onConfirmDirectionalFares={(routeId, direction, fares) => commit(() => setRouteDirectionalFares(game, routeId, direction, fares))}
          onDirectionalPricingLinked={(routeId, linked) => commit(() => setRouteDirectionalPricingLinked(game, routeId, linked))}
          onCruiseRatioChange={(routeId, shipTypeId, ratio) => commit(() => setRouteCruiseRatio(game, routeId, shipTypeId, ratio, generated.scenario.shipTypes, generated.galaxy))}
          onSublightProfileChange={(routeId, shipTypeId, speedValue, thrustRatio) => commit(() => setRouteSublightProfile(game, routeId, shipTypeId, speedValue, thrustRatio, generated.scenario.shipTypes, generated.galaxy))}
          onScheduleBufferChange={(routeId, minutes) => commit(() => setRouteScheduleBuffer(game, routeId, minutes, generated.galaxy, generated.scenario.shipTypes))}
          onSlotBidChange={(routeId, bid) => commit(() => setRouteSlotBid(game, routeId, bid, generated.galaxy, generated.scenario.shipTypes))}
          onWeeklyScheduleChange={(routeId, minutes) => commit(() => setRouteWeeklyDepartureMinutes(game, routeId, minutes, generated.galaxy, generated.scenario.shipTypes))}
        />
      ) : activeView === "fleet" ? (
        <FleetPanel
          game={game}
          galaxy={generated.galaxy}
          shipTypes={generated.scenario.shipTypes}
          onPlacePurchaseAgreement={(lines) => commit(() => placeShipPurchaseAgreement(game, lines, generated.scenario.shipTypes))}
          onCreateConfiguration={(shipTypeId, name, cabins, build) => commit(() => createFleetConfiguration(game, shipTypeId, name, cabins, generated.scenario.shipTypes, build))}
          onUpdateConfiguration={(configurationId, name, cabins, build) => commit(() => updateFleetConfiguration(game, configurationId, name, cabins, generated.scenario.shipTypes, build))}
          onAssignShips={(configurationId, shipIds) => commit(() => assignShipsToFleetConfiguration(game, configurationId, shipIds))}
          onMaintainShip={(shipId) => commit(() => performShipMaintenance(game, shipId, generated.scenario.shipTypes))}
          onReplaceShip={(shipId) => commit(() => orderShipReplacement(game, shipId, generated.scenario.shipTypes))}
          onSellShip={(shipId) => commit(() => sellShip(game, shipId, generated.scenario.shipTypes))}
          onAutoMaintenanceThresholdChange={(threshold) => commit(() => setAutoMaintenanceThreshold(game, threshold))}
          onAutoReplacementAgeChange={(ageYears) => commit(() => setAutoReplacementAge(game, ageYears))}
        />
      ) : activeView === "fuel" ? (
        <FuelPanel
          game={game}
          onSignContract={(weeks, units) => commit(() => signFuelContract(game, weeks, units))}
          onCancelContract={(contractId) => commit(() => cancelFuelContract(game, contractId))}
          onAutoPolicyChange={(policy) => commit(() => setFuelAutoContractPolicy(game, policy))}
          onWarehouseRentalChange={(rented) => commit(() => setFuelWarehouseRental(game, rented))}
          onWarehousePolicyChange={(limit, policy) => commit(() => setFuelWarehousePolicy(game, limit, policy))}
          onBuyWarehouseFuel={(units) => commit(() => buyFuelForWarehouse(game, units))}
          onSellWarehouseFuel={(units) => commit(() => sellFuelFromWarehouse(game, units))}
        />
      ) : activeView === "schedule" ? (
        <SchedulePanel
          game={game}
          galaxy={generated.galaxy}
          shipTypes={generated.scenario.shipTypes}
          onFleetChange={(shipId, routeId) => commit(() => requestRouteFleetChange(game, shipId, routeId, generated.scenario.shipTypes, generated.galaxy))}
          onReserveChange={(shipId, routeId) => commit(() => setShipReserveRoute(game, shipId, routeId, generated.scenario.shipTypes))}
          onInvestCapacity={(portId) => commit(() => investInStarportCapacity(game, portId, generated.galaxy, generated.scenario.shipTypes))}
        />
      ) : (
        <main className="workspace" style={{ "--inspector-width": `${inspectorWidth}px` } as CSSProperties}>
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
          <div
            className="vertical-splitter"
            role="separator"
            aria-label="调整星港侧栏宽度"
            aria-orientation="vertical"
            aria-valuemin={340}
            aria-valuemax={720}
            aria-valuenow={inspectorWidth}
            tabIndex={0}
            onPointerDown={beginInspectorResize}
            onKeyDown={resizeInspectorWithKeyboard}
          ><i /></div>
          <aside className="inspector-panel glass-panel">
            <DemandPanel galaxy={generated.galaxy} settlement={previewSettlement} selectedPortId={selectedPortId} onSelectPort={setSelectedPortId} />
            <StarportFlightsPanel
              game={game}
              galaxy={generated.galaxy}
              selectedPortId={selectedPortId}
              onOpenSchedule={() => { setActiveView("schedule"); setSpeed(0); }}
              onOpenRoute={(routeId) => { setSelectedRouteId(routeId); setActiveView("route"); setSpeed(0); }}
            />
            <OperationsPanel
              game={game}
              galaxy={generated.galaxy}
              shipTypes={generated.scenario.shipTypes}
              selectedPortId={selectedPortId}
              onCreateRoute={createRoute}
              onOpenFleet={() => setActiveView("fleet")}
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

      {showSettings && (
        <div className="settings-overlay" role="dialog" aria-modal="true" aria-label="界面设置">
          <section className="settings-dialog glass-panel">
            <div className="settings-heading">
              <div><span className="eyebrow">INTERFACE SETTINGS</span><h2>界面设置</h2><p>主题和分栏宽度会保存在当前浏览器。</p></div>
              <button type="button" onClick={() => setShowSettings(false)}>关闭</button>
            </div>
            <h3>视觉主题</h3>
            <div className="theme-options">
              <button type="button" className={uiTheme === "deep-space" ? "active deep-space" : "deep-space"} aria-pressed={uiTheme === "deep-space"} onClick={() => setUiTheme("deep-space")}><i /><strong>深空航务</strong><span>工业直角面板、均衡密度与航务仪表结构</span></button>
              <button type="button" className={uiTheme === "aurora" ? "active aurora" : "aurora"} aria-pressed={uiTheme === "aurora"} onClick={() => setUiTheme("aurora")}><i /><strong>极光玻璃</strong><span>悬浮圆角卡片、玻璃模糊、宽松间距与胶囊导航</span></button>
              <button type="button" className={uiTheme === "command-deck" ? "active command-deck" : "command-deck"} aria-pressed={uiTheme === "command-deck"} onClick={() => setUiTheme("command-deck")}><i /><strong>舰桥终端</strong><span>高密度网格、硬边框、紧凑表格与战术终端导航</span></button>
            </div>
            <div className="panel-width-setting">
              <div><h3>星港侧栏宽度</h3><p>也可以直接拖动星图与侧栏之间的分隔条；方向键每次调整 20px。</p></div>
              <strong>{inspectorWidth}px</strong>
              <input aria-label="星港侧栏宽度" type="range" min="340" max="720" step="10" value={inspectorWidth} onChange={(event) => changeInspectorWidth(Number(event.target.value))} />
              <button type="button" onClick={() => changeInspectorWidth(440)}>恢复默认</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
