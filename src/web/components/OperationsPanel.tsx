import { useEffect, useMemo, useState } from "react";
import {
  buildRouteServices,
  gameWorldLegs,
  ROUTE_OPENING_COST,
  shipMaintenanceCost,
  shipMaintenanceState,
  type CreateRouteInput,
  type GameState,
  type GeneratedGalaxy,
  type PlayerRoutingMode,
  type Route,
  type ShipType,
} from "../../index.js";
import { formatCredits } from "../format.js";

interface OperationsPanelProps {
  game: GameState;
  galaxy: GeneratedGalaxy;
  shipTypes: readonly ShipType[];
  selectedPortId: string;
  onCreateRoute: (input: CreateRouteInput) => void;
  onBuyShip: (shipTypeId: string) => void;
  onMaintainShip: (shipId: string) => void;
  onAutoMaintenanceThresholdChange: (threshold: number) => void;
}

const MODE_LABELS = { sublight: "亚光速", warp: "曲率", hyperspace: "超空间" } as const;
const MAINTENANCE_LABELS = {
  ready: "状态良好",
  due: "维护到期",
  required: "强制停航",
  maintenance: "维护中",
} as const;

export function OperationsPanel({
  game,
  galaxy,
  shipTypes,
  selectedPortId,
  onCreateRoute,
  onBuyShip,
  onMaintainShip,
  onAutoMaintenanceThresholdChange,
}: OperationsPanelProps) {
  const [destinationPortId, setDestinationPortId] = useState(
    galaxy.ports.find((port) => port.id !== game.basePortId)?.id ?? game.basePortId,
  );
  const [shipId, setShipId] = useState("");
  const [routeName, setRouteName] = useState("");
  const [fareMultiplier, setFareMultiplier] = useState(1);
  const [routingMode, setRoutingMode] = useState<PlayerRoutingMode>("hyperspace");
  const availableShips = useMemo(
    () => game.fleet.filter((ship) => ship.routeId === null && shipMaintenanceState(ship, game.day) !== "maintenance" && shipMaintenanceState(ship, game.day) !== "required"),
    [game.day, game.fleet],
  );
  const selectedShip = availableShips.find((ship) => ship.id === shipId);
  const selectedShipType = shipTypes.find((type) => type.id === selectedShip?.shipTypeId);
  const availableModes = (["hyperspace", "warp"] as const).filter((mode) =>
    selectedShipType?.supportedModes.includes(mode),
  );

  useEffect(() => {
    setDestinationPortId((current) => {
      if (selectedPortId !== game.basePortId && galaxy.ports.some((port) => port.id === selectedPortId)) {
        return selectedPortId;
      }
      if (current !== game.basePortId && galaxy.ports.some((port) => port.id === current)) return current;
      return galaxy.ports.find((port) => port.id !== game.basePortId)?.id ?? game.basePortId;
    });
  }, [galaxy.ports, game.basePortId, selectedPortId]);

  useEffect(() => {
    if (!availableShips.some((ship) => ship.id === shipId)) {
      setShipId(availableShips[0]?.id ?? "");
    }
  }, [availableShips, shipId]);

  useEffect(() => {
    if (!availableModes.includes(routingMode)) {
      setRoutingMode(availableModes[0] ?? "hyperspace");
    }
  }, [availableModes, routingMode]);

  const preview = useMemo(() => {
    if (!selectedShipType || !destinationPortId || !availableModes.includes(routingMode)) return null;
    const route: Route = {
      id: "route-preview",
      companyId: "player",
      name: "航线预览",
      kind: "return",
      routingMode,
      stops: [game.basePortId, destinationPortId].map((portId) => ({
        portId,
        stopType: "commercial" as const,
        minimumStopHours: 24,
      })),
      shipTypeId: selectedShipType.id,
      assignedShips: 1,
      pricing: {
        multiplier: fareMultiplier,
        passengerClassMultiplier: { economy: 1, business: 1.35, premium: 2.1 },
      },
      maintenanceAllowanceHours: 0,
      active: true,
    };
    try {
      const services = buildRouteServices(route, selectedShipType, galaxy.ports, gameWorldLegs(galaxy));
      const departuresPerWeek = services[0]?.departuresPerWeek ?? 0;
      return {
        error: null,
        departuresPerWeek,
        roundTripDays: departuresPerWeek > 0 ? 7 * selectedShipType.operationalAvailability / departuresPerWeek : 0,
        oneWayHours: services[0]?.inVehicleHours ?? 0,
      };
    } catch (caught) {
      return {
        error: caught instanceof Error ? caught.message : "无法建立航线",
        departuresPerWeek: 0,
        roundTripDays: 0,
        oneWayHours: 0,
      };
    }
  }, [availableModes, destinationPortId, fareMultiplier, galaxy, game.basePortId, routingMode, selectedShipType]);

  const submit = () => {
    onCreateRoute({
      name: routeName,
      originPortId: game.basePortId,
      destinationPortId,
      shipId,
      fareMultiplier,
      routingMode,
    });
    setRouteName("");
  };
  const basePort = galaxy.ports.find((port) => port.id === game.basePortId);

  return (
    <aside className="control-panel operations-panel glass-panel">
      <div className="panel-heading">
        <span className="eyebrow">OPERATIONS DESK</span>
        <h2>航线与舰队</h2>
        <p>点击地图选择目的地；所有航线从基地出发。</p>
      </div>

      <section className="objective-card">
        <span>公司基地</span>
        <strong>{basePort?.name}</strong>
        <small>{game.fleet.filter((ship) => !ship.routeId).length} 艘在基地 · {game.routes.filter((route) => route.active).length} 条运营航线</small>
      </section>

      <div className="section-title">建立基地往返航线</div>
      <div className="fixed-origin"><span>固定起点</span><strong>{basePort?.name}</strong></div>

      <label className="field-label" htmlFor="route-destination">目的地</label>
      <select id="route-destination" value={destinationPortId} onChange={(event) => setDestinationPortId(event.target.value)}>
        {galaxy.ports.filter((port) => port.id !== game.basePortId).map((port) => (
          <option key={port.id} value={port.id}>{port.name}</option>
        ))}
      </select>

      <label className="field-label" htmlFor="route-ship">分配船只</label>
      <select id="route-ship" value={shipId} onChange={(event) => setShipId(event.target.value)}>
        {availableShips.length === 0 && <option value="">没有可用船只</option>}
        {availableShips.map((ship) => {
          const type = shipTypes.find((candidate) => candidate.id === ship.shipTypeId);
          return <option key={ship.id} value={ship.id}>{ship.name} · {type?.seats ?? 0} 座</option>;
        })}
      </select>

      <label className="field-label" htmlFor="route-mode">航路方式</label>
      <select id="route-mode" value={routingMode} onChange={(event) => setRoutingMode(event.target.value as PlayerRoutingMode)}>
        {availableModes.length === 0 && <option value="">所选船只没有可用星际引擎</option>}
        {availableModes.map((mode) => (
          <option key={mode} value={mode}>{mode === "hyperspace" ? "超空间航路 · 沿航道网络" : "曲率航路 · 点对点直达"}</option>
        ))}
      </select>

      <label className="field-label" htmlFor="route-name">航线名称</label>
      <input id="route-name" value={routeName} placeholder="留空自动命名" onChange={(event) => setRouteName(event.target.value)} />

      <div className="slider-heading"><label htmlFor="fare-multiplier">票价策略</label><output>{Math.round(fareMultiplier * 100)}%</output></div>
      <input id="fare-multiplier" type="range" min="0.65" max="1.8" step="0.05" value={fareMultiplier} onChange={(event) => setFareMultiplier(Number(event.target.value))} />

      {preview && !preview.error && (
        <div className="route-preview">
          <span>单程航行 <strong>{(preview.oneWayHours / 24).toFixed(1)} 日</strong></span>
          <span>往返周期 <strong>{preview.roundTripDays.toFixed(1)} 日</strong></span>
          <span>计划班次 <strong>{preview.departuresPerWeek.toFixed(1)} / 周</strong></span>
        </div>
      )}
      {preview?.error && <div className="route-preview-error">{preview.error}</div>}

      <button className="primary-action" disabled={!shipId || !preview || !!preview.error || game.status !== "playing"} onClick={submit}>
        <span>开通航线</span><small>{formatCredits(ROUTE_OPENING_COST)}</small>
      </button>

      <div className="section-title fleet-title">我的舰队与维护</div>
      <div className="auto-maintenance-policy">
        <label htmlFor="auto-maintenance-threshold">自动维修阈值</label>
        <select id="auto-maintenance-threshold" value={game.autoMaintenanceThreshold} onChange={(event) => onAutoMaintenanceThresholdChange(Number(event.target.value))}>
          {[50, 60, 70, 80, 90, 95].map((threshold) => (
            <option key={threshold} value={threshold}>{threshold}% · {threshold >= 90 ? "预防性" : threshold >= 70 ? "标准" : "节约"}</option>
          ))}
        </select>
        <small>船只返抵主基地时若维护值低于阈值，系统会自动扣款并安排 3 日维护。</small>
      </div>
      <div className="owned-fleet">
        {game.fleet.map((ship) => {
          const type = shipTypes.find((candidate) => candidate.id === ship.shipTypeId)!;
          const state = shipMaintenanceState(ship, game.day);
          return (
            <article className={`owned-ship ${state}`} key={ship.id}>
              <div><strong>{ship.name}</strong><em>{MAINTENANCE_LABELS[state]}</em></div>
              <span>{type.name} · {type.supportedModes.filter((mode) => mode !== "sublight").map((mode) => MODE_LABELS[mode]).join(" / ")}</span>
              <div className="maintenance-meter"><i style={{ width: `${ship.condition}%` }} /></div>
              <small>维护值 {ship.condition.toFixed(0)}% · 本周期 {ship.flightHoursSinceMaintenance.toFixed(0)} 小时</small>
              <button disabled={state === "maintenance" || game.cash < shipMaintenanceCost(type)} onClick={() => onMaintainShip(ship.id)}>
                {state === "maintenance" ? `维护至第 ${ship.maintenanceUntilDay} 日` : `安排维护 · ${formatCredits(shipMaintenanceCost(type))}`}
              </button>
            </article>
          );
        })}
      </div>

      <div className="section-title fleet-title">船型市场</div>
      <div className="ship-market">
        {shipTypes.filter((ship) => ship.supportedModes.includes("hyperspace") || ship.supportedModes.includes("warp")).map((ship) => (
          <article className="ship-offer" key={ship.id}>
            <div><strong>{ship.name}</strong><span>{ship.seats} 座 · 舒适 {ship.comfort}</span></div>
            <small>{ship.supportedModes.map((mode) => MODE_LABELS[mode]).join(" / ")}</small>
            <button disabled={game.cash < ship.purchasePrice || game.status !== "playing"} onClick={() => onBuyShip(ship.id)}>购买 {formatCredits(ship.purchasePrice)}</button>
          </article>
        ))}
      </div>
    </aside>
  );
}
