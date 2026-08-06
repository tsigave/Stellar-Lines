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
  const [originPortId, setOriginPortId] = useState(game.basePortId);
  const [selectedShipIds, setSelectedShipIds] = useState<string[]>([]);
  const [routeName, setRouteName] = useState("");
  const [fareMultiplier, setFareMultiplier] = useState(1);
  const [routingMode, setRoutingMode] = useState<PlayerRoutingMode>("hyperspace");
  const availableShips = useMemo(
    () => game.fleet.filter((ship) => ship.routeId === null && shipMaintenanceState(ship, game.day) !== "maintenance" && shipMaintenanceState(ship, game.day) !== "required"),
    [game.day, game.fleet],
  );
  const availableModes = ["hyperspace", "warp"] as const;
  const selectedShips = availableShips.filter((ship) => selectedShipIds.includes(ship.id));
  const selectedShipTypes = selectedShips
    .map((ship) => shipTypes.find((type) => type.id === ship.shipTypeId))
    .filter((type): type is ShipType => !!type);
  const selectedSpeed = selectedShipTypes[0]?.speedByMode[routingMode];
  const modeCompatibleShips = availableShips.filter((ship) => {
    const type = shipTypes.find((candidate) => candidate.id === ship.shipTypeId);
    return !!type?.supportedModes.includes(routingMode);
  });
  const isShipCompatible = (shipId: string) => {
    const ship = availableShips.find((candidate) => candidate.id === shipId);
    const type = shipTypes.find((candidate) => candidate.id === ship?.shipTypeId);
    return !!type && type.supportedModes.includes(routingMode) &&
      (selectedSpeed === undefined || type.speedByMode[routingMode] === selectedSpeed);
  };

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
    setOriginPortId(game.basePortId);
  }, [game.basePortId]);

  useEffect(() => {
    setSelectedShipIds((current) => current.filter((shipId) =>
      availableShips.some((ship) => ship.id === shipId) && isShipCompatible(shipId),
    ));
  }, [availableShips, routingMode]);

  const preview = useMemo(() => {
    const selectedShipType = selectedShipTypes[0];
    if (!selectedShipType || !destinationPortId || originPortId !== game.basePortId) return null;
    const route: Route = {
      id: "route-preview",
      companyId: "player",
      name: "航线预览",
      kind: "return",
      routingMode,
      stops: [originPortId, destinationPortId].map((portId) => ({
        portId,
        stopType: "commercial" as const,
        minimumStopHours: 24,
      })),
      shipTypeId: selectedShipType.id,
      assignedShips: selectedShipIds.length,
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
        roundTripDays: departuresPerWeek > 0 ? 7 * selectedShipIds.length * selectedShipType.operationalAvailability / departuresPerWeek : 0,
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
  }, [destinationPortId, fareMultiplier, galaxy, game.basePortId, originPortId, routingMode, selectedShipIds.length, selectedShipTypes]);

  const submit = () => {
    onCreateRoute({
      name: routeName,
      originPortId,
      destinationPortId,
      shipIds: selectedShipIds,
      fareMultiplier,
      routingMode,
    });
    setRouteName("");
    setSelectedShipIds([]);
  };
  const toggleShip = (shipId: string) => {
    setSelectedShipIds((current) => current.includes(shipId)
      ? current.filter((candidate) => candidate !== shipId)
      : [...current, shipId]);
  };
  const basePort = galaxy.ports.find((port) => port.id === game.basePortId);

  return (
    <aside className="control-panel operations-panel glass-panel">
      <div className="panel-heading">
        <span className="eyebrow">OPERATIONS DESK</span>
        <h2>航线与舰队</h2>
        <p>依次选择起终点、推进方式，再分配同速船只。</p>
      </div>

      <section className="objective-card">
        <span>公司基地</span>
        <strong>{basePort?.name}</strong>
        <small>{game.fleet.filter((ship) => !ship.routeId).length} 艘在基地 · {game.routes.filter((route) => route.active).length} 条运营航线</small>
      </section>

      <div className="section-title">建立基地往返航线</div>
      <label className="field-label" htmlFor="route-origin">1 · 出发地</label>
      <select id="route-origin" value={originPortId} onChange={(event) => setOriginPortId(event.target.value)}>
        <option value={game.basePortId}>{basePort?.name} · 公司基地</option>
      </select>

      <label className="field-label" htmlFor="route-destination">2 · 目的地</label>
      <select id="route-destination" value={destinationPortId} onChange={(event) => setDestinationPortId(event.target.value)}>
        {galaxy.ports.filter((port) => port.id !== game.basePortId).map((port) => (
          <option key={port.id} value={port.id}>{port.name}</option>
        ))}
      </select>

      <label className="field-label" htmlFor="route-mode">3 · 出行方式</label>
      <select id="route-mode" value={routingMode} onChange={(event) => setRoutingMode(event.target.value as PlayerRoutingMode)}>
        {availableModes.map((mode) => (
          <option key={mode} value={mode}>{mode === "hyperspace" ? "超空间航路 · 沿航道网络" : "曲率航路 · 点对点直达"}</option>
        ))}
      </select>

      <div className="field-label route-fleet-label">4 · 分配船只 <span>{selectedShipIds.length} 艘</span></div>
      <div className="route-fleet-picker">
        {modeCompatibleShips.length === 0 && <p>没有配备该推进方式的可用船只。</p>}
        {modeCompatibleShips.map((ship) => {
          const type = shipTypes.find((candidate) => candidate.id === ship.shipTypeId)!;
          const checked = selectedShipIds.includes(ship.id);
          const compatible = checked || isShipCompatible(ship.id);
          return (
            <label className={compatible ? "" : "incompatible"} key={ship.id}>
              <input type="checkbox" checked={checked} disabled={!compatible} onChange={() => toggleShip(ship.id)} />
              <span><strong>{ship.name}</strong><small>{type.name} · {type.seats} 座 · {type.speedByMode[routingMode]} 光年/日</small></span>
            </label>
          );
        })}
      </div>
      {selectedSpeed !== undefined && <div className="route-fleet-rule">本航线统一速度：{selectedSpeed} 光年/日；可继续选择相同推进方式与速度的船只。</div>}

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

      <button className="primary-action" disabled={selectedShipIds.length === 0 || !preview || !!preview.error || game.status !== "playing"} onClick={submit}>
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
        <small>标准维护周期约 3,200 飞行小时（高利用率下约半年）；返抵主基地且低于阈值时自动安排 3 日维护。</small>
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
