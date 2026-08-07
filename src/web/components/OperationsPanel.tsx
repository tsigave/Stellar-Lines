import { useEffect, useMemo, useState } from "react";
import {
  buildRouteServices,
  buildGameSchedule,
  fleetConfigurationForShip,
  gameWorldLegs,
  recommendRouteFares,
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
  const [fares, setFares] = useState<CabinConfiguration>({ economy: 120, business: 260, premium: 520 });
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
  const modeCompatibleShips = availableShips.filter((ship) => {
    const type = shipTypes.find((candidate) => candidate.id === ship.shipTypeId);
    return !!type?.supportedModes.includes(routingMode);
  });
  const isShipCompatible = (shipId: string) => {
    const ship = availableShips.find((candidate) => candidate.id === shipId);
    const type = shipTypes.find((candidate) => candidate.id === ship?.shipTypeId);
    return !!type && type.supportedModes.includes(routingMode);
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
        multiplier: 1,
        passengerClassMultiplier: { economy: 1, business: 1.35, premium: 2.1 },
        fareByClass: fares,
      },
      maintenanceAllowanceHours: 0,
      active: true,
      cruiseRatioByShipType: Object.fromEntries(selectedShipTypes.map((type) => [type.id, 1])),
      sublightTargetSpeedKmPerSecondByShipType: Object.fromEntries(selectedShipTypes.map((type) => [type.id, Math.min(80, type.maximumSublightSpeedKmPerSecond ?? 80)])),
      sublightThrustRatioByShipType: Object.fromEntries(selectedShipTypes.map((type) => [type.id, type.fuelOptimalThrustRatio ?? .72])),
      scheduleBufferMinutes: 30,
      directionalPricingLinked: true,
      slotApplicationDay: game.day,
    };
    try {
      const typeGroups = [...new Set(selectedShips.map((ship) => ship.shipTypeId))].map((shipTypeId, index) => {
        const type = shipTypes.find((candidate) => candidate.id === shipTypeId)!;
        const ships = selectedShips.filter((ship) => ship.shipTypeId === shipTypeId);
        const configurations = ships.map((ship) => fleetConfigurationForShip(game, ship)!);
        const cabins: CabinConfiguration = {
          economy: configurations.reduce((sum, item) => sum + item.cabins.economy, 0) / ships.length,
          business: configurations.reduce((sum, item) => sum + item.cabins.business, 0) / ships.length,
          premium: configurations.reduce((sum, item) => sum + item.cabins.premium, 0) / ships.length,
        };
        const variant = { ...route, id: `${route.id}:${index}`, shipTypeId, assignedShips: ships.length, cabinCapacityByClass: cabins };
        return buildRouteServices(variant, type, galaxy.ports, gameWorldLegs(galaxy));
      });
      const services = typeGroups.flat();
      const recommendations = recommendRouteFares(services[0]?.routeId ?? route.id, typeGroups[0] ?? []);
      const departuresPerWeek = typeGroups.reduce((sum, group) => sum + (group[0]?.departuresPerWeek ?? 0), 0);
      const schedule = buildGameSchedule({
        ...game,
        routes: [...game.routes, route],
        fleet: game.fleet.map((ship) => selectedShipIds.includes(ship.id) ? { ...ship, routeId: route.id } : ship),
      }, galaxy, shipTypes, 14);
      const previewFlights = schedule.flights.filter((flight) => flight.routeId === route.id);
      const endpointCapacity = schedule.starportCapacity.filter((entry) => entry.portId === game.basePortId || entry.portId === destinationPortId);
      return {
        error: null,
        departuresPerWeek,
        roundTripDays: departuresPerWeek > 0
          ? typeGroups.reduce((sum, group) => sum + (group[0]?.destinationDwellHours ?? 0), 0) / Math.max(1, typeGroups.length) / 24
          : 0,
        oneWayHours: services[0]?.inVehicleHours ?? 0,
        seats: services.reduce((sum, service) => sum + service.dailySeatCapacity, 0),
        fuelEmpty: services.reduce((sum, service) => sum + (service.fuelConsumptionPerDepartureEmpty ?? 0), 0),
        fuelFull: services.reduce((sum, service) => sum + (service.fuelConsumptionPerDepartureFull ?? 0), 0),
        fuelLoadEmpty: services.reduce((sum, service) => sum + (service.fuelLoadPerDepartureEmpty ?? 0), 0),
        fuelLoadFull: services.reduce((sum, service) => sum + (service.fuelLoadPerDepartureFull ?? 0), 0),
        recommendations,
        slotMovements: previewFlights.filter((flight) => flight.status !== "cancelled").length * 2,
        cancelledFlights: previewFlights.filter((flight) => flight.status === "cancelled").length,
        shiftedFlights: previewFlights.filter((flight) => flight.departureSlotStatus !== "confirmed" || flight.arrivalSlotStatus !== "confirmed").length,
        peakCongestion: endpointCapacity.reduce((maximum, entry) => Math.max(maximum, entry.utilization), 0),
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
        recommendations: null,
        slotMovements: 0,
        cancelledFlights: 0,
        shiftedFlights: 0,
        peakCongestion: 0,
      };
    }
  }, [averageCabins, destinationPortId, fares, galaxy, game, routingMode, selectedShipIds.length, selectedShipTypes, shipTypes]);

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
      fareMultiplier: 1,
      fareByClass: fares,
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
        <small>跃出点距离：基地 {((routingMode === "hyperspace" ? basePort?.hyperspaceExitDistanceKm : basePort?.warpExitDistanceKm) ?? 0).toLocaleString()} km · 目的地 {((routingMode === "hyperspace" ? destinationPort?.hyperspaceExitDistanceKm : destinationPort?.warpExitDistanceKm) ?? 0).toLocaleString()} km</small>
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
      {selectedShipTypes.length > 0 && (
        <div className="route-fleet-rule">混合型号将按各自速度、舱位和周转时间独立生成航班：{[...new Set(selectedShipTypes.map((type) => `${type.name} ${type.speedByMode[routingMode]} 光年/日`))].join(" · ")}</div>
      )}

      <label className="field-label" htmlFor="route-name">航线名称</label>
      <input id="route-name" value={routeName} placeholder="留空自动命名" onChange={(event) => setRouteName(event.target.value)} />

      <div className="field-label pricing-heading">三舱单程票价 <span>当前 / 盈亏平衡 / 推荐</span></div>
      <div className="cabin-fare-editor compact">
        {(["economy", "business", "premium"] as const).map((cabinClass) => {
          const recommendation = preview?.recommendations?.[cabinClass];
          const label = cabinClass === "economy" ? "经济舱" : cabinClass === "business" ? "商务舱" : "头等舱";
          return (
            <label key={cabinClass}>
              <span>{label}</span>
              <input
                aria-label={`${label}票价`}
                type="number"
                min="0"
                step="10"
                value={fares[cabinClass]}
                onChange={(event) => setFares((current) => ({ ...current, [cabinClass]: Math.max(0, Number(event.target.value) || 0) }))}
              />
              <small>{recommendation
                ? `${recommendation.breakEvenFare.toFixed(0)} / ${recommendation.recommendedFare.toFixed(0)} Cr${recommendation.confidence === "low" ? " · 低置信" : ""}`
                : "—"}</small>
              <button type="button" disabled={!recommendation} onClick={() => recommendation && setFares((current) => ({
                ...current,
                [cabinClass]: Math.round(recommendation.recommendedFare / 10) * 10,
              }))}>恢复推荐</button>
            </label>
          );
        })}
      </div>

      {preview && !preview.error && (
        <div className="route-preview">
          <span>单程航行<strong>{(preview.oneWayHours / 24).toFixed(1)} 日</strong></span>
          <span>往返周期<strong>{preview.roundTripDays.toFixed(1)} 日</strong></span>
          <span>每班座位<strong>{preview.seats.toFixed(0)}</strong></span>
          <span>计划班次<strong>{preview.departuresPerWeek.toFixed(1)} / 周</strong></span>
          <span>空载燃料消耗 / 燃料载荷<strong>{preview.fuelEmpty.toFixed(1)} / {preview.fuelLoadEmpty.toFixed(1)}</strong></span>
          <span>满载燃料消耗 / 燃料载荷<strong>{preview.fuelFull.toFixed(1)} / {preview.fuelLoadFull.toFixed(1)}</strong></span>
          <span>十四日所需时隙<strong>{preview.slotMovements} movements</strong></span>
          <span>换时刻 / 取消<strong>{preview.shiftedFlights} / {preview.cancelledFlights}</strong></span>
          <span>端点峰值拥堵<strong>{(preview.peakCongestion * 100).toFixed(0)}%</strong></span>
        </div>
      )}
      {preview?.error && <div className="route-preview-error">{preview.error}</div>}

      <button className="primary-action" disabled={selectedShipIds.length === 0 || !preview || !!preview.error || preview.cancelledFlights > 0 || game.status !== "playing"} onClick={submit}>
        <span>开通航线</span><small>{formatCredits(ROUTE_OPENING_COST)}</small>
      </button>
    </section>
  );
}
