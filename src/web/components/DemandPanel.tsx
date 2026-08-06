import { PASSENGER_TYPES, type DaySettlement, type GeneratedGalaxy } from "../../types.js";
import { formatNumber, formatPopulation } from "../format.js";

interface DemandPanelProps {
  galaxy: GeneratedGalaxy;
  settlement: DaySettlement;
  selectedPortId: string;
}

const TYPE_LABELS = { business: "商务", leisure: "休闲旅游", budget: "廉价", luxury: "高端" } as const;

export function DemandPanel({ galaxy, settlement, selectedPortId }: DemandPanelProps) {
  const port = galaxy.ports.find((candidate) => candidate.id === selectedPortId);
  const system = galaxy.systems.find((candidate) => candidate.id === port?.systemId);
  if (!port || !system) return null;

  const outbound = settlement.markets.filter(
    (market) => market.market.originPortId === selectedPortId,
  );
  const classTotals = Object.fromEntries(
    PASSENGER_TYPES.map((passengerType) => [
      passengerType,
      outbound
        .filter((market) => market.market.passengerType === passengerType)
        .reduce((sum, market) => sum + market.market.potentialPassengers, 0),
    ]),
  ) as Record<(typeof PASSENGER_TYPES)[number], number>;
  const destinationMap = new Map<string, { potential: number; actual: number }>();
  for (const market of outbound) {
    const current = destinationMap.get(market.market.destinationPortId) ?? { potential: 0, actual: 0 };
    current.potential += market.market.potentialPassengers;
    current.actual += market.actualPassengers;
    destinationMap.set(market.market.destinationPortId, current);
  }
  const destinations = [...destinationMap.entries()]
    .map(([portId, values]) => ({
      port: galaxy.ports.find((candidate) => candidate.id === portId)!,
      ...values,
    }))
    .sort((left, right) => right.potential - left.potential)
    .slice(0, 6);
  const maximumDemand = Math.max(1, ...destinations.map((destination) => destination.potential));

  return (
    <section className="demand-section">
      <div className="selected-port-heading">
        <div className="port-emblem">◉</div>
        <div>
          <span className="eyebrow">SELECTED STARPORT</span>
          <h2>{port.name}</h2>
          <p>{system.name} · {port.portLevel}级星港</p>
        </div>
      </div>
      <div className="port-attributes">
        <span>服务人口 <strong>{formatPopulation(port.populationMillions ?? port.population)}</strong></span>
        <span>燃料 <strong>{port.fuelPrice.toFixed(2)} Cr</strong></span>
        <span>容量 <strong>{formatNumber(port.dailyCapacity)}</strong></span>
      </div>
      <div className="class-demand">
        {PASSENGER_TYPES.map((passengerType) => (
          <div key={passengerType}>
            <span className={`class-dot ${passengerType}`} />
            <span>{TYPE_LABELS[passengerType]}</span>
            <strong>{formatNumber(classTotals[passengerType])}</strong>
          </div>
        ))}
      </div>
      <div className="subheading"><span>热门目的地</span><small>潜在 / 实际</small></div>
      <div className="destination-list">
        {destinations.map((destination) => (
          <div className="destination-row" key={destination.port.id}>
            <div className="destination-label">
              <strong>{destination.port.name}</strong>
              <span>{formatNumber(destination.potential)} / {formatNumber(destination.actual)}</span>
            </div>
            <div className="demand-track">
              <span style={{ width: `${(destination.potential / maximumDemand) * 100}%` }} />
              <i style={{ width: `${(destination.actual / maximumDemand) * 100}%` }} />
            </div>
          </div>
        ))}
        {destinations.length === 0 && <p className="empty-state">该星港目前没有可达市场。</p>}
      </div>
    </section>
  );
}
