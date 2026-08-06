import { useEffect, useMemo, useState } from "react";
import {
  buildRouteServices,
  fleetConfigurationForShip,
  gameWorldLegs,
  ROUTE_OPENING_COST,
  shipMaintenanceState,
  type CabinConfiguration,
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
  onOpenFleet: () => void;
}

const MODE_LABELS = { warp: "曲率直达", hyperspace: "超空间航道" } as const;

export function OperationsPanel({
  game,
  galaxy,
  shipTypes,
  selectedPortId,
  onCreateRoute,
  onOpenFleet,
}: OperationsPanelProps) {
  const defaultDestination = galaxy.ports.find((port) => port.id !== game.basePortId)?.id ?? game.basePortId;
  const [destinationPortId, setDestinationPortId] = useState(defaultDestination);
  const [selectedShipIds, setSelectedShipIds] = useState<string[]>([]);
  const [routeName, setRouteName] = useState("");
  const [fareMultiplier, setFareMultiplier] = useState(1);
  const [routingMode, setRoutingMode] = useState<PlayerRoutingMode>("hyperspace");
  const basePort = galaxy.ports.find((port) => port.id === game.basePortId);
  const destinationPort = galaxy.ports.find((port) => port.id === destinationPortId);

  const availableShips = useMemo(
    () => game.fleet.filter((ship) =>
      ship.routeId === null &&
      !!fleetConfigurationForShip(game, ship) &&
      shipMaintenanceState(ship, game.day) !== "maintenance" &&
      shipMaintenanceState(ship, game.day) !== "required"
    ),
    [game.day, game.fleet],
  );
  const selectedShips = availableShips.filter((ship) => selectedShipIds.includes(ship.id));
  const selectedConfigurations = selectedShips.map((ship) => fleetConfigurationForShip(game, ship)!);
  const selectedShipTypes = selectedShips
    .map((ship) => shipTypes.find((type) => type.id === ship.shipTypeId))
    .filter((type): type is ShipType => !!type);
  const selectedSpeed = selectedShipTypes[0]?.speedByMode[routingMode];
  const selectedShipTypeId = selectedShipTypes[0]?.id;
  const modeCompatibleShips = availableShips.filter((ship) => {
    const type = shipTypes.find((candidate) => candidate.id === ship.shipTypeId);
    return !!type?.supportedModes.includes(routingMode);
  });
  const isShipCompatible = (shipId: string) => {
    const ship = availableShips.find((candidate) => candidate.id === shipId);
    const type = shipTypes.find((candidate) => candidate.id === ship?.shipTypeId);
    return !!type && type.supportedModes.includes(routingMode) &&
      (selectedSpeed === undefined || type.speedByMode[routingMode] === selectedSpeed) &&
      (selectedShipTypeId === undefined || type.id === selectedShipTypeId);
  };

  useEffect(() => {
    setDestinationPortId((current) => {
      if (selectedPortId !== game.basePortId && galaxy.ports.some((port) => port.id === selectedPortId)) {
        return selectedPortId;
      }
      if (current !== game.basePortId && galaxy.ports.some((port) => port.id === current)) return current;
      return defaultDestination;
    });
  }, [defaultDestination, galaxy.ports, game.basePortId, selectedPortId]);

  useEffect(() => {
    setSelectedShipIds((current) => current.filter((shipId) =>
      availableShips.some((ship) => ship.id === shipId) && isShipCompatible(shipId),
    ));
  }, [availableShips, routingMode]);

  const averageCabins = useMemo<CabinConfiguration | null>(() => {
    if (selectedShips.length === 0) return null;
    return {
      economy: selectedConfigurations.reduce((sum, configuration) => sum + configuration.cabins.economy, 0) / selectedShips.length,
      business: selectedConfigurations.reduce((sum, configuration) => sum + configuration.cabins.business, 0) / selectedShips.length,
      premium: selectedConfigurations.reduce((sum, configuration) => sum + configuration.cabins.premium, 0) / selectedShips.length,
    };
  }, [selectedConfigurations, selectedShips.length]);

  const preview = useMemo(() => {
    const selectedShipType = selectedShipTypes[0];
    if (!selectedShipType || !averageCabins || !destinationPortId) return null;
    const route: Route = {
      id: "route-preview",
      companyId: "player",
      name: "航线预览",
      kind: "return",
      routingMode,
      stops: [game.basePortId, destinationPortId].map((portId) => ({
        portId,
        stopType: "commercial" as const,
        minimumStopHours: 4,
      })),
      shipTypeId: selectedShipType.id,
      assignedShips: selectedShipIds.length,
      cabinCapacityByClass: averageCabins,
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
        roundTripDays: departuresPerWeek > 0
          ? 7 * selectedShipIds.length * selectedShipType.operationalAvailability / departuresPerWeek
          : 0,
        oneWayHours: services[0]?.inVehicleHours ?? 0,
        seats: services[0]?.seatsPerDeparture ?? 0,
        fuelEmpty: services[0]?.fuelConsumptionPerDepartureEmpty ?? 0,
        fuelFull: services[0]?.fuelConsumptionPerDepartureFull ?? 0,
        fuelLoadEmpty: services[0]?.fuelLoadPerDepartureEmpty ?? 0,
        fuelLoadFull: services[0]?.fuelLoadPerDepartureFull ?? 0,
      };
    } catch (caught) {
      return {
        error: caught instanceof Error ? caught.message : "无法建立航线",
        departuresPerWeek: 0,
        roundTripDays: 0,
        oneWayHours: 0,
        seats: 0,
        fuelEmpty: 0,
        fuelFull: 0,
        fuelLoadEmpty: 0,
        fuelLoadFull: 0,
      };
    }
  }, [averageCabins, destinationPortId, fareMultiplier, galaxy, game.basePortId, routingMode, selectedShipIds.length, selectedShipTypes]);

  const toggleShip = (shipId: string) => {
    setSelectedShipIds((current) => current.includes(shipId)
      ? current.filter((candidate) => candidate !== shipId)
      : [...current, shipId]);
  };
  const submit = () => {
    onCreateRoute({
      name: routeName,
      originPortId: game.basePortId,
      destinationPortId,
      shipIds: selectedShipIds,
      fareMultiplier,
      routingMode,
    });
    setRouteName("");
    setSelectedShipIds([]);
  };

  return (
    <section className="starport-operations">
      <div className="panel-heading compact-heading">
        <span className="eyebrow">STARPORT OPERATIONS</span>
        <h2>星港与航线</h2>
        <p>地图选中的星港会自动成为候选目的地。</p>
      </div>

      <div className="starport-route-summary">
        <span>基地</span><strong>{basePort?.name}</strong>
        <i>→</i>
        <span>目的地</span><strong>{destinationPort?.name}</strong>
      </div>

      <label className="field-label" htmlFor="route-destination">目的星港</label>
      <select id="route-destination" value={destinationPortId} onChange={(event) => setDestinationPortId(event.target.value)}>
        {galaxy.ports.filter((port) => port.id !== game.basePortId).map((port) => (
          <option key={port.id} value={port.id}>{port.name}</option>
        ))}
      </select>

      <label className="field-label" htmlFor="route-mode">星际驱动方式</label>
      <select id="route-mode" value={routingMode} onChange={(event) => setRoutingMode(event.target.value as PlayerRoutingMode)}>
        <option value="hyperspace">超空间航道 · 沿固定网络高速航行</option>
        <option value="warp">曲率直达 · 点对点航行但速度较慢</option>
      </select>

      <div className="field-label route-fleet-label">分配已配置舰船 <span>{selectedShipIds.length} 艘</span></div>
      <div className="route-fleet-picker">
        {modeCompatibleShips.length === 0 && (
          <div className="fleet-empty-callout">
            <p>没有适用且已配置舱位的待命舰船。</p>
            <button onClick={onOpenFleet}>前往舰队选项卡</button>
          </div>
        )}
        {modeCompatibleShips.map((ship) => {
          const type = shipTypes.find((candidate) => candidate.id === ship.shipTypeId)!;
          const checked = selectedShipIds.includes(ship.id);
          const compatible = checked || isShipCompatible(ship.id);
          const configuration = fleetConfigurationForShip(game, ship)!;
          const totalSeats = configuration.cabins.economy + configuration.cabins.business + configuration.cabins.premium;
          return (
            <label className={compatible ? "" : "incompatible"} key={ship.id}>
              <input type="checkbox" checked={checked} disabled={!compatible} onChange={() => toggleShip(ship.id)} />
              <span>
                <strong>{ship.name}</strong>
                <small>{type.name} · {configuration.name} · {totalSeats} 座 · {type.speedByMode[routingMode]} 光年/日</small>
              </span>
            </label>
          );
        })}
      </div>
      {selectedSpeed !== undefined && (
        <div className="route-fleet-rule">统一{MODE_LABELS[routingMode]}速度：{selectedSpeed} 光年/日</div>
      )}

      <label className="field-label" htmlFor="route-name">航线名称</label>
      <input id="route-name" value={routeName} placeholder="留空自动命名" onChange={(event) => setRouteName(event.target.value)} />

      <div className="slider-heading"><label htmlFor="fare-multiplier">票价策略</label><output>{Math.round(fareMultiplier * 100)}%</output></div>
      <input id="fare-multiplier" type="range" min="0.65" max="1.8" step="0.05" value={fareMultiplier} onChange={(event) => setFareMultiplier(Number(event.target.value))} />

      {preview && !preview.error && (
        <div className="route-preview">
          <span>单程航行<strong>{(preview.oneWayHours / 24).toFixed(1)} 日</strong></span>
          <span>往返周期<strong>{preview.roundTripDays.toFixed(1)} 日</strong></span>
          <span>每班座位<strong>{preview.seats.toFixed(0)}</strong></span>
          <span>计划班次<strong>{preview.departuresPerWeek.toFixed(1)} / 周</strong></span>
          <span>空载耗油 / 装油<strong>{preview.fuelEmpty.toFixed(1)} / {preview.fuelLoadEmpty.toFixed(1)}</strong></span>
          <span>满载耗油 / 装油<strong>{preview.fuelFull.toFixed(1)} / {preview.fuelLoadFull.toFixed(1)}</strong></span>
        </div>
      )}
      {preview?.error && <div className="route-preview-error">{preview.error}</div>}

      <button className="primary-action" disabled={selectedShipIds.length === 0 || !preview || !!preview.error || game.status !== "playing"} onClick={submit}>
        <span>开通航线</span><small>{formatCredits(ROUTE_OPENING_COST)}</small>
      </button>
    </section>
  );
}
