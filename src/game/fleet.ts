import { FIXED_MAINTENANCE_COST_SCALE } from "../parameters.js";
import {
  defaultBuildForShipType,
  FTL_DRIVE_MODELS,
  hullVariantFromShipType,
  resolveShipMission,
  SUBLIGHT_ENGINE_MODELS,
} from "../propulsion.js";
import type { CabinConfiguration, ShipBuildConfiguration, ShipType } from "../types.js";
import { clamp } from "../utils.js";
import {
  CONDITION_WEAR_PER_FLIGHT_HOUR,
  DAYS_PER_SHIP_YEAR,
  DEFAULT_AUTO_MAINTENANCE_THRESHOLD,
  MAINTENANCE_DAYS,
  MAINTENANCE_DUE_CONDITION,
  MAINTENANCE_DUE_HOURS,
  MAINTENANCE_REQUIRED_CONDITION,
  MAINTENANCE_REQUIRED_HOURS,
  SHIP_AGE_COMFORT_LOSS_PER_YEAR,
  SHIP_AGE_MAINTENANCE_RATE,
  type FleetConfiguration,
  type GameActionResult,
  type GameState,
  type OwnedShip,
  type ShipMaintenanceState,
  requirePlaying,
} from "./model.js";

export const CABIN_SPACE_PER_SEAT: CabinConfiguration = {
  economy: 1,
  business: 3,
  premium: 6,
};

export function cabinSpaceUsed(cabins: CabinConfiguration): number {
  return cabins.economy * CABIN_SPACE_PER_SEAT.economy +
    cabins.business * CABIN_SPACE_PER_SEAT.business +
    cabins.premium * CABIN_SPACE_PER_SEAT.premium;
}

export function fleetConfigurationForShip(
  state: Pick<GameState, "fleetConfigurations">,
  ship: OwnedShip,
): FleetConfiguration | undefined {
  return ship.configurationId
    ? state.fleetConfigurations.find((configuration) => configuration.id === ship.configurationId)
    : undefined;
}

export function shipAgeYears(ship: OwnedShip, day: number): number {
  return Math.max(0, day - ship.commissionedDay) / DAYS_PER_SHIP_YEAR;
}

export function shipComfortAtAge(ship: OwnedShip, shipType: ShipType, day: number): number {
  return Math.max(35, shipType.comfort - shipAgeYears(ship, day) * SHIP_AGE_COMFORT_LOSS_PER_YEAR);
}

export function shipResaleValue(ship: OwnedShip, shipType: ShipType, day: number): number {
  const ageValue = Math.max(0.12, 0.68 - shipAgeYears(ship, day) * 0.045);
  const conditionValue = 0.55 + clamp(ship.condition, 0, 100) / 100 * 0.45;
  return Math.round(shipType.purchasePrice * ageValue * conditionValue);
}

export function shipMaintenanceState(ship: OwnedShip, day: number): ShipMaintenanceState {
  if (ship.maintenanceUntilDay !== null && ship.maintenanceUntilDay > day) return "maintenance";
  if (
    ship.condition <= MAINTENANCE_REQUIRED_CONDITION ||
    ship.flightHoursSinceMaintenance >= MAINTENANCE_REQUIRED_HOURS
  ) return "required";
  if (
    ship.condition <= MAINTENANCE_DUE_CONDITION ||
    ship.flightHoursSinceMaintenance >= MAINTENANCE_DUE_HOURS
  ) return "due";
  return "ready";
}

export function shipMaintenanceCost(shipType: ShipType): number {
  return Math.max(15_000, Math.round(shipType.purchasePrice * 0.0125));
}

function normalizeFleetConfiguration(
  shipType: ShipType,
  cabins: CabinConfiguration,
): CabinConfiguration {
  if (Object.values(cabins).some((seats) => !Number.isFinite(seats) || seats < 0)) {
    throw new Error("舱位数量必须是非负有限数字");
  }
  const normalized: CabinConfiguration = {
    economy: Math.max(0, Math.floor(Number(cabins.economy))),
    business: Math.max(0, Math.floor(Number(cabins.business))),
    premium: Math.max(0, Math.floor(Number(cabins.premium))),
  };
  if (cabinSpaceUsed(normalized) > shipType.cabinSpace) {
    throw new Error(`舱位占用超过 ${shipType.cabinSpace} 个可用空间单位`);
  }
  if (cabinSpaceUsed(normalized) === 0) throw new Error("配置方案至少需要一个客舱座位");
  return normalized;
}

export function createFleetConfiguration(
  state: GameState,
  shipTypeId: string,
  name: string,
  cabins: CabinConfiguration,
  shipTypes: readonly ShipType[],
  requestedBuild?: ShipBuildConfiguration,
): GameActionResult {
  requirePlaying(state);
  const shipType = shipTypes.find((candidate) => candidate.id === shipTypeId);
  if (!shipType) throw new Error("船型数据不存在");
  const normalized = normalizeFleetConfiguration(shipType, cabins);
  const build = { ...(requestedBuild ?? defaultBuildForShipType(shipType, normalized)), cabins: normalized };
  const resolved = resolveShipMission({ build, hull: hullVariantFromShipType(shipType), distanceLightYears: 0 });
  if (!resolved.feasible) throw new Error(resolved.infeasibleReasons.join("；"));
  const number = state.nextFleetConfigurationNumber;
  const configuration: FleetConfiguration = {
    id: `fleet-config-${number}`,
    shipTypeId,
    name: name.trim() || `${shipType.familyName}方案 ${number}`,
    cabins: normalized,
    build,
  };
  return {
    state: {
      ...state,
      fleetConfigurations: [...state.fleetConfigurations, configuration],
      nextFleetConfigurationNumber: number + 1,
    },
    message: `已创建 ${shipType.name} 的“${configuration.name}”配置方案`,
  };
}

export function updateFleetConfiguration(
  state: GameState,
  configurationId: string,
  name: string,
  cabins: CabinConfiguration,
  shipTypes: readonly ShipType[],
  requestedBuild?: ShipBuildConfiguration,
): GameActionResult {
  requirePlaying(state);
  const configuration = state.fleetConfigurations.find((candidate) => candidate.id === configurationId);
  if (!configuration) throw new Error("配置方案不存在");
  if (state.fleet.some((ship) => ship.configurationId === configurationId && ship.routeId)) {
    throw new Error("方案下仍有执行航线的舰船，不能修改");
  }
  const shipType = shipTypes.find((candidate) => candidate.id === configuration.shipTypeId);
  if (!shipType) throw new Error("船型数据不存在");
  const normalized = normalizeFleetConfiguration(shipType, cabins);
  const build = { ...(requestedBuild ?? configuration.build), cabins: normalized };
  const resolved = resolveShipMission({ build, hull: hullVariantFromShipType(shipType), distanceLightYears: 0 });
  if (!resolved.feasible) throw new Error(resolved.infeasibleReasons.join("；"));
  const updated = {
    ...configuration,
    name: name.trim() || configuration.name,
    cabins: normalized,
    build,
  };
  return {
    state: {
      ...state,
      fleetConfigurations: state.fleetConfigurations.map((candidate) =>
        candidate.id === configurationId ? updated : candidate,
      ),
    },
    message: `配置方案“${updated.name}”已更新`,
  };
}

export function assignShipsToFleetConfiguration(
  state: GameState,
  configurationId: string,
  shipIds: readonly string[],
): GameActionResult {
  requirePlaying(state);
  const configuration = state.fleetConfigurations.find((candidate) => candidate.id === configurationId);
  if (!configuration) throw new Error("配置方案不存在");
  const uniqueShipIds = [...new Set(shipIds)];
  if (uniqueShipIds.length === 0) throw new Error("请至少选择一艘舰船");
  const ships = uniqueShipIds.map((shipId) => state.fleet.find((candidate) => candidate.id === shipId));
  if (ships.some((ship) => !ship)) throw new Error("舰船不存在");
  if (ships.some((ship) => ship!.shipTypeId !== configuration.shipTypeId)) {
    throw new Error("配置方案只能分配给完全相同的船型");
  }
  if (ships.some((ship) => ship!.routeId || shipMaintenanceState(ship!, state.day) === "maintenance")) {
    throw new Error("执行航线或维护中的舰船不能更换配置方案");
  }
  return {
    state: {
      ...state,
      fleet: state.fleet.map((ship) =>
        uniqueShipIds.includes(ship.id) ? {
          ...ship,
          configurationId,
          routeId: ship.plannedRouteId ?? ship.routeId,
          plannedRouteId: null,
        } : ship,
      ),
    },
    message: `已将 ${uniqueShipIds.length} 艘舰船分配至“${configuration.name}”`,
  };
}

/** 兼容命令行与旧调用：创建一个方案并立即分配指定舰船。 */
export function configureShipCabins(
  state: GameState,
  shipId: string,
  cabins: CabinConfiguration,
  shipTypes: readonly ShipType[],
): GameActionResult {
  const ship = state.fleet.find((candidate) => candidate.id === shipId);
  if (!ship) throw new Error("舰船不存在");
  const created = createFleetConfiguration(
    state,
    ship.shipTypeId,
    `${ship.name} 标准方案`,
    cabins,
    shipTypes,
  );
  const configuration = created.state.fleetConfigurations.at(-1)!;
  return assignShipsToFleetConfiguration(created.state, configuration.id, [shipId]);
}

export function performShipMaintenance(
  state: GameState,
  shipId: string,
  shipTypes: readonly ShipType[],
): GameActionResult {
  requirePlaying(state);
  const ship = state.fleet.find((candidate) => candidate.id === shipId);
  if (!ship) throw new Error("船只不存在");
  if (shipMaintenanceState(ship, state.day) === "maintenance") throw new Error("该船已经在维护中");
  const shipType = shipTypes.find((candidate) => candidate.id === ship.shipTypeId);
  if (!shipType) throw new Error("船型数据不存在");
  const cost = shipMaintenanceCost(shipType);
  if (state.cash < cost) throw new Error("资金不足，无法安排维护");
  return {
    state: {
      ...state,
      cash: state.cash - cost,
      fleet: state.fleet.map((candidate) =>
        candidate.id === shipId
          ? {
              ...candidate,
              condition: 100,
              flightHoursSinceMaintenance: 0,
              maintenanceUntilDay: state.day + MAINTENANCE_DAYS,
            }
          : candidate,
      ),
      unsettledFinancialEvents: [...state.unsettledFinancialEvents, {
        id: `maintenance:${ship.id}:${state.day}:${state.unsettledFinancialEvents.length + 1}`,
        minute: state.day * 1_440,
        ...(ship.routeId ? { routeId: ship.routeId } : {}),
        kind: "flight-maintenance",
        amount: -cost,
      }],
    },
    message: `${ship.name} 已进场维护，将在第 ${state.day + MAINTENANCE_DAYS} 日恢复`,
  };
}

export function setAutoMaintenanceThreshold(
  state: GameState,
  threshold: number,
): GameActionResult {
  requirePlaying(state);
  const normalized = Math.max(30, Math.min(95, Math.round(threshold)));
  return {
    state: { ...state, autoMaintenanceThreshold: normalized },
    message: `自动维修阈值已设为 ${normalized}%`,
  };
}

export function setAutoReplacementAge(
  state: GameState,
  ageYears: number | null,
): GameActionResult {
  requirePlaying(state);
  const normalized = ageYears === null ? null : clamp(Math.round(ageYears), 1, 30);
  return {
    state: { ...state, autoReplacementAgeYears: normalized },
    message: normalized === null
      ? "已关闭按船龄自动更新"
      : `舰船达到 ${normalized} 年船龄后将自动订购同型号新船，并在交付后更换`,
  };
}

export interface FleetFixedMaintenanceSummary {
  total: number;
  undiscountedTotal: number;
  supplierDiscount: number;
  familyDiscount: number;
  ageSurcharge: number;
  diversityOverhead: number;
}

export function fleetFixedMaintenanceCost(
  fleet: readonly OwnedShip[],
  shipTypes: readonly ShipType[],
  currentDay = 1,
): FleetFixedMaintenanceSummary {
  const typeById = new Map(shipTypes.map((shipType) => [shipType.id, shipType]));
  const supplierCounts = new Map<string, number>();
  const familyCounts = new Map<string, number>();
  for (const ship of fleet) {
    const type = typeById.get(ship.shipTypeId);
    if (!type) continue;
    supplierCounts.set(type.manufacturer, (supplierCounts.get(type.manufacturer) ?? 0) + 1);
    familyCounts.set(type.familyId, (familyCounts.get(type.familyId) ?? 0) + 1);
  }
  let total = 0;
  let undiscountedTotal = 0;
  let supplierSavings = 0;
  let familySavings = 0;
  let ageSurcharge = 0;
  const componentSuppliers = new Set<string>();
  const componentFamilies = new Set<string>();
  const componentModels = new Set<string>();
  for (const ship of fleet) {
    const type = typeById.get(ship.shipTypeId);
    if (!type) continue;
    const build = ship.build ?? defaultBuildForShipType(type);
    const engine = SUBLIGHT_ENGINE_MODELS.find((candidate) => candidate.id === build.sublightEngineModelId);
    const drive = FTL_DRIVE_MODELS.find((candidate) => candidate.id === build.ftlDriveModelId);
    for (const component of [engine, drive]) {
      if (!component) continue;
      componentSuppliers.add(component.manufacturer);
      componentFamilies.add(`${component.manufacturer}:${component.family}`);
      componentModels.add(component.id);
    }
    const originalBase = type.fixedMaintenanceCostPerDay * FIXED_MAINTENANCE_COST_SCALE;
    const base = originalBase * (1 + shipAgeYears(ship, currentDay) * SHIP_AGE_MAINTENANCE_RATE);
    const supplierDiscount = Math.min(0.18, Math.max(0, (supplierCounts.get(type.manufacturer) ?? 1) - 1) * 0.015);
    const familyDiscount = Math.min(0.22, Math.max(0, (familyCounts.get(type.familyId) ?? 1) - 1) * 0.025);
    const afterSupplier = base * (1 - supplierDiscount);
    const discounted = afterSupplier * (1 - familyDiscount);
    undiscountedTotal += base;
    ageSurcharge += base - originalBase;
    supplierSavings += base - afterSupplier;
    familySavings += afterSupplier - discounted;
    total += discounted;
  }
  const diversityOverhead = componentSuppliers.size * 250 + componentFamilies.size * 180 +
    Math.max(0, componentModels.size - componentFamilies.size) * 45;
  total += diversityOverhead;
  undiscountedTotal += diversityOverhead;
  return {
    total: Number(total.toFixed(2)),
    undiscountedTotal: Number(undiscountedTotal.toFixed(2)),
    supplierDiscount: Number(supplierSavings.toFixed(2)),
    familyDiscount: Number(familySavings.toFixed(2)),
    ageSurcharge: Number(ageSurcharge.toFixed(2)),
    diversityOverhead: Number(diversityOverhead.toFixed(2)),
  };
}
