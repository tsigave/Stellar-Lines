import { useEffect, useMemo, useState } from "react";
import {
  ROUTE_OPENING_COST,
  type CreateRouteInput,
  type GameState,
  type GeneratedGalaxy,
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
}

const MODE_LABELS = { sublight: "亚光速", warp: "曲速", hyperspace: "超空间" } as const;

export function OperationsPanel({
  game,
  galaxy,
  shipTypes,
  selectedPortId,
  onCreateRoute,
  onBuyShip,
}: OperationsPanelProps) {
  const [originPortId, setOriginPortId] = useState(selectedPortId);
  const [destinationPortId, setDestinationPortId] = useState(
    galaxy.ports.find((port) => port.id !== selectedPortId)?.id ?? selectedPortId,
  );
  const [shipId, setShipId] = useState("");
  const [routeName, setRouteName] = useState("");
  const [fareMultiplier, setFareMultiplier] = useState(1);
  const availableShips = useMemo(
    () => game.fleet.filter((ship) => ship.routeId === null),
    [game.fleet],
  );

  useEffect(() => {
    setOriginPortId(selectedPortId);
  }, [selectedPortId]);

  useEffect(() => {
    if (originPortId === destinationPortId) {
      setDestinationPortId(galaxy.ports.find((port) => port.id !== originPortId)?.id ?? originPortId);
    }
  }, [destinationPortId, galaxy.ports, originPortId]);

  useEffect(() => {
    if (!availableShips.some((ship) => ship.id === shipId)) {
      setShipId(availableShips[0]?.id ?? "");
    }
  }, [availableShips, shipId]);

  const submit = () => {
    onCreateRoute({
      name: routeName,
      originPortId,
      destinationPortId,
      shipId,
      fareMultiplier,
    });
    setRouteName("");
  };

  return (
    <aside className="control-panel operations-panel glass-panel">
      <div className="panel-heading">
        <span className="eyebrow">OPERATIONS DESK</span>
        <h2>航线与舰队</h2>
        <p>点击地图选择起点，再配置目的地与船只。</p>
      </div>

      <section className="objective-card">
        <span>当前基地</span>
        <strong>{galaxy.ports.find((port) => port.id === game.basePortId)?.name}</strong>
        <small>{game.fleet.filter((ship) => !ship.routeId).length} 艘可用 · {game.routes.filter((route) => route.active).length} 条运营航线</small>
      </section>

      <div className="section-title">建立往返航线</div>
      <label className="field-label" htmlFor="route-origin">起点</label>
      <select id="route-origin" value={originPortId} onChange={(event) => setOriginPortId(event.target.value)}>
        {galaxy.ports.map((port) => <option key={port.id} value={port.id}>{port.name}</option>)}
      </select>

      <label className="field-label" htmlFor="route-destination">目的地</label>
      <select id="route-destination" value={destinationPortId} onChange={(event) => setDestinationPortId(event.target.value)}>
        {galaxy.ports.filter((port) => port.id !== originPortId).map((port) => (
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

      <label className="field-label" htmlFor="route-name">航线名称</label>
      <input id="route-name" value={routeName} placeholder="留空自动命名" onChange={(event) => setRouteName(event.target.value)} />

      <div className="slider-heading">
        <label htmlFor="fare-multiplier">票价策略</label>
        <output>{Math.round(fareMultiplier * 100)}%</output>
      </div>
      <input
        id="fare-multiplier"
        type="range"
        min="0.65"
        max="1.8"
        step="0.05"
        value={fareMultiplier}
        onChange={(event) => setFareMultiplier(Number(event.target.value))}
      />
      <div className="fare-hint">
        {fareMultiplier < 0.9 ? "低价引流，单位收入较低" : fareMultiplier > 1.2 ? "高价定位，可能损失价格敏感旅客" : "标准市场票价"}
      </div>

      <button
        className="primary-action"
        disabled={!shipId || originPortId === destinationPortId || game.status !== "playing"}
        onClick={submit}
      >
        <span>开通航线</span><small>{formatCredits(ROUTE_OPENING_COST)}</small>
      </button>

      <div className="section-title fleet-title">船型市场</div>
      <div className="ship-market">
        {shipTypes.filter((ship) => ship.supportedModes.includes("hyperspace")).map((ship) => (
          <article className="ship-offer" key={ship.id}>
            <div><strong>{ship.name}</strong><span>{ship.seats} 座 · 舒适 {ship.comfort}</span></div>
            <small>{ship.supportedModes.map((mode) => MODE_LABELS[mode]).join(" / ")}</small>
            <button
              disabled={game.cash < ship.purchasePrice || game.status !== "playing"}
              onClick={() => onBuyShip(ship.id)}
            >购买 {formatCredits(ship.purchasePrice)}</button>
          </article>
        ))}
      </div>
    </aside>
  );
}
