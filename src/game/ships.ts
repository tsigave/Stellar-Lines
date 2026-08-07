import { createRandom } from "../generation/random.js";
import { defaultBuildForShipType, hullVariantFromShipType, resolveShipMission } from "../propulsion.js";
import type { ShipBuildConfiguration, ShipType } from "../types.js";
import { clamp } from "../utils.js";
import {
  fleetConfigurationForShip,
  shipAgeYears,
  shipResaleValue,
} from "./fleet.js";
import {
  type GameActionResult,
  type GameState,
  type OwnedShip,
  type ShipPurchaseLineInput,
  type ShipPurchaseOrder,
  type ShipyardMarketOffer,
  requirePlaying,
} from "./model.js";

function marketOffer(seed: string, shipTypeId: string, day: number): ShipyardMarketOffer {
  const random = createRandom(`${seed}:shipyard:${shipTypeId}:${Math.floor(day / 7)}`);
  const popularity = Number((0.18 + random.next() * 0.78).toFixed(4));
  const clearanceChance = 0.16 + (1 - popularity) * 0.58;
  const discountRate = random.next() < clearanceChance
    ? Number(clamp(0.04 + (1 - popularity) * 0.18 + random.next() * 0.06, 0, 0.28).toFixed(2))
    : 0;
  const inventory = random.next() < 0.1 + (1 - popularity) * 0.62
    ? random.integer(1, popularity < 0.4 ? 4 : 2)
    : 0;
  return { shipTypeId, popularity, discountRate, inventory, updatedDay: day };
}

export function createShipyardMarket(
  seed: string,
  shipTypes: readonly ShipType[],
  day = 1,
): ShipyardMarketOffer[] {
  return shipTypes.map((shipType) => marketOffer(seed, shipType.id, day));
}

export function shipyardOfferFor(
  state: Pick<GameState, "config" | "day" | "shipyardMarket">,
  shipType: ShipType,
): ShipyardMarketOffer {
  return state.shipyardMarket.find((offer) => offer.shipTypeId === shipType.id) ??
    marketOffer(state.config.seed, shipType.id, state.day);
}

export function purchaseAgreementDiscount(totalShips: number): number {
  if (totalShips >= 15) return 0.1;
  if (totalShips >= 10) return 0.08;
  if (totalShips >= 6) return 0.06;
  if (totalShips >= 4) return 0.04;
  if (totalShips >= 2) return 0.02;
  return 0;
}

export interface ShipPurchaseAgreementQuoteLine extends ShipPurchaseLineInput {
  listUnitPrice: number;
  unitPrice: number;
  marketDiscountRate: number;
  agreementDiscountRate: number;
  inventoryUsed: number;
  deliveryDay: number;
}

export interface ShipPurchaseAgreementQuote {
  lines: readonly ShipPurchaseAgreementQuoteLine[];
  totalShips: number;
  listPrice: number;
  totalPrice: number;
  agreementDiscountRate: number;
}

export function quoteShipPurchaseAgreement(
  state: GameState,
  requestedLines: readonly ShipPurchaseLineInput[],
  shipTypes: readonly ShipType[],
): ShipPurchaseAgreementQuote {
  const quantitiesByType = new Map<string, ShipPurchaseLineInput>();
  for (const line of requestedLines) {
    const key = `${line.shipTypeId}:${line.targetRouteId ?? "standby"}:${JSON.stringify(line.build ?? null)}`;
    const current = quantitiesByType.get(key);
    quantitiesByType.set(key, { ...line, quantity: (current?.quantity ?? 0) + line.quantity });
  }
  const lines = [...quantitiesByType.values()]
    .filter((line) => line.quantity > 0);
  const totalShips = lines.reduce((sum, line) => sum + line.quantity, 0);
  if (totalShips < 1 || totalShips > 60) throw new Error("单份采购协议必须包含 1 至 60 艘舰船");
  const agreementDiscountRate = purchaseAgreementDiscount(totalShips);
  const quotedLines = lines.map((line) => {
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 20) {
      throw new Error("每个型号的采购数量必须是 1 至 20 艘");
    }
    const shipType = shipTypes.find((candidate) => candidate.id === line.shipTypeId);
    if (!shipType) throw new Error("采购协议包含未知船型");
    const targetRoute = line.targetRouteId ? state.routes.find((route) => route.id === line.targetRouteId) : undefined;
    if (line.targetRouteId && !targetRoute) throw new Error("预定目标航线不存在");
    if (targetRoute?.routingMode && !shipType.supportedModes.includes(targetRoute.routingMode)) {
      throw new Error(`${shipType.name} 不支持预定航线的推进方式`);
    }
    const hull = hullVariantFromShipType(shipType);
    const build = line.build ?? defaultBuildForShipType(shipType);
    if (build.hullVariantId !== hull.id) throw new Error("采购配置与所选船体不匹配");
    const resolvedBuild = resolveShipMission({ build, hull, distanceLightYears: 0 });
    if (!resolvedBuild.feasible) throw new Error(resolvedBuild.infeasibleReasons.join("；"));
    const offer = shipyardOfferFor(state, shipType);
    const inventoryUsed = Math.min(offer.inventory, line.quantity);
    const factoryQuantity = line.quantity - inventoryUsed;
    const manufacturingDays = factoryQuantity === 0
      ? 1
      : Math.ceil(hull.deliveryDays + offer.popularity * 18 + factoryQuantity * 1.6);
    const unitPrice = Math.round(resolvedBuild.purchasePrice * (1 - offer.discountRate) * (1 - agreementDiscountRate));
    return {
      ...line,
      build,
      listUnitPrice: resolvedBuild.purchasePrice,
      unitPrice,
      marketDiscountRate: offer.discountRate,
      agreementDiscountRate,
      inventoryUsed,
      deliveryDay: state.day + manufacturingDays,
    };
  });
  return {
    lines: quotedLines,
    totalShips,
    listPrice: quotedLines.reduce((sum, line) => sum + line.listUnitPrice * line.quantity, 0),
    totalPrice: quotedLines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0),
    agreementDiscountRate,
  };
}

export function buyShip(
  state: GameState,
  shipTypeId: string,
  shipTypes: readonly ShipType[],
  quantity = 1,
): GameActionResult {
  return placeShipPurchaseAgreement(state, [{ shipTypeId, quantity }], shipTypes);
}

export function sellShip(
  state: GameState,
  shipId: string,
  shipTypes: readonly ShipType[],
): GameActionResult {
  requirePlaying(state);
  const ship = state.fleet.find((candidate) => candidate.id === shipId);
  if (!ship) throw new Error("舰船不存在");
  const hasPendingAssignment = state.pendingFleetChanges.some((change) =>
    change.shipId === shipId && change.status === "pending" && change.toRouteId !== null
  );
  if (ship.routeId || ship.plannedRouteId || ship.reserveForRouteId || hasPendingAssignment) {
    throw new Error("只能出售未被分配、预定或设为航线备用的舰船");
  }
  if (state.shipPurchaseOrders.some((order) => order.replacementShipIds?.includes(shipId))) {
    throw new Error("该舰船已有替代订单，不能直接出售");
  }
  const shipType = shipTypes.find((candidate) => candidate.id === ship.shipTypeId);
  if (!shipType) throw new Error("舰船型号不存在");
  const revenue = shipResaleValue(ship, shipType, state.day);
  return {
    state: { ...state, cash: state.cash + revenue, fleet: state.fleet.filter((candidate) => candidate.id !== shipId) },
    message: `已出售 ${ship.name}，获得 ${revenue.toFixed(0)} Cr`,
  };
}

export function orderShipReplacement(
  state: GameState,
  shipId: string,
  shipTypes: readonly ShipType[],
): GameActionResult {
  requirePlaying(state);
  const ship = state.fleet.find((candidate) => candidate.id === shipId);
  if (!ship) throw new Error("舰船不存在");
  if (state.shipPurchaseOrders.some((order) => order.replacementShipIds?.includes(shipId))) {
    throw new Error("该舰船已有替代订单");
  }
  const configuration = fleetConfigurationForShip(state, ship);
  const inheritedBuild = ship.build ?? configuration?.build;
  const replacementLine: ShipPurchaseLineInput = {
    shipTypeId: ship.shipTypeId,
    quantity: 1,
    targetRouteId: ship.routeId,
    ...(inheritedBuild ? { build: inheritedBuild } : {}),
  };
  const purchased = placeShipPurchaseAgreement(state, [replacementLine], shipTypes);
  const agreementId = purchased.state.shipPurchaseOrders.at(-1)?.agreementId;
  return {
    state: { ...purchased.state, shipPurchaseOrders: purchased.state.shipPurchaseOrders.map((order) =>
      order.agreementId === agreementId ? { ...order, replacementShipIds: [shipId] } : order) },
    message: `${ship.name} 的同型号替代船已订购；交付时继承航线与客舱配置，旧船随后回收`,
  };
}

export function placeShipPurchaseAgreement(
  state: GameState,
  lines: readonly ShipPurchaseLineInput[],
  shipTypes: readonly ShipType[],
): GameActionResult {
  requirePlaying(state);
  const quote = quoteShipPurchaseAgreement(state, lines, shipTypes);
  if (state.cash < quote.totalPrice) throw new Error("资金不足，无法签订所选采购协议");
  const agreementNumber = state.nextPurchaseAgreementNumber;
  const agreementId = `purchase-${agreementNumber}`;
  const orders: ShipPurchaseOrder[] = quote.lines.map((line, index) => ({
    id: `${agreementId}-${index + 1}`,
    agreementId,
    shipTypeId: line.shipTypeId,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    marketDiscountRate: line.marketDiscountRate,
    agreementDiscountRate: line.agreementDiscountRate,
    orderedDay: state.day,
    deliveryDay: line.deliveryDay,
    targetRouteId: line.targetRouteId ?? null,
    build: line.build ?? defaultBuildForShipType(shipTypes.find((candidate) => candidate.id === line.shipTypeId)!),
  }));
  const inventoryByType = new Map(quote.lines.map((line) => [line.shipTypeId, line.inventoryUsed]));
  return {
    state: {
      ...state,
      cash: state.cash - quote.totalPrice,
      shipPurchaseOrders: [...state.shipPurchaseOrders, ...orders],
      shipyardMarket: shipTypes.map((shipType) => {
        const offer = shipyardOfferFor(state, shipType);
        return { ...offer, inventory: Math.max(0, offer.inventory - (inventoryByType.get(shipType.id) ?? 0)) };
      }),
      nextPurchaseAgreementNumber: agreementNumber + 1,
    },
    message: `已签订 ${quote.totalShips} 艘舰船采购协议，合同优惠 ${(quote.agreementDiscountRate * 100).toFixed(0)}%；将按各型号交期交付`,
  };
}

export function deliverShipPurchaseOrders(
  state: GameState,
  shipTypes: readonly ShipType[],
  throughDay = state.day,
): GameActionResult {
  const dueOrders = state.shipPurchaseOrders.filter((order) => order.deliveryDay <= throughDay);
  if (dueOrders.length === 0) return { state, message: "今日没有待交付舰船" };
  let nextShipNumber = state.nextShipNumber;
  const deliveredShips: OwnedShip[] = [];
  const replacedShips: OwnedShip[] = [];
  for (const order of dueOrders) {
    const shipType = shipTypes.find((candidate) => candidate.id === order.shipTypeId);
    if (!shipType) continue;
    for (let index = 0; index < order.quantity; index += 1) {
      const shipNumber = nextShipNumber++;
      const replacementShipId = order.replacementShipIds?.[index];
      const replacedShip = replacementShipId
        ? state.fleet.find((ship) => ship.id === replacementShipId)
        : undefined;
      if (replacedShip) replacedShips.push(replacedShip);
      deliveredShips.push({
        id: `ship-${shipNumber}`,
        name: `${shipType.name} ${shipNumber.toString().padStart(2, "0")}`,
        shipTypeId: shipType.id,
        routeId: replacedShip?.routeId ?? null,
        condition: 100,
        flightHoursSinceMaintenance: 0,
        maintenanceUntilDay: null,
        configurationId: replacedShip?.configurationId ?? null,
        commissionedDay: throughDay,
        purchasePricePaid: order.unitPrice,
        currentPortId: replacedShip?.currentPortId ?? state.basePortId,
        reserveForRouteId: replacedShip?.reserveForRouteId ?? null,
        plannedRouteId: replacedShip?.plannedRouteId ?? order.targetRouteId ?? null,
        build: replacedShip?.build ?? order.build,
      });
    }
  }
  const dueIds = new Set(dueOrders.map((order) => order.id));
  const replacedIds = new Set(replacedShips.map((ship) => ship.id));
  const replacementRevenue = replacedShips.reduce((sum, ship) => {
    const shipType = shipTypes.find((candidate) => candidate.id === ship.shipTypeId);
    return sum + (shipType ? shipResaleValue(ship, shipType, throughDay) : 0);
  }, 0);
  return {
    state: {
      ...state,
      cash: state.cash + replacementRevenue,
      fleet: [...state.fleet.filter((ship) => !replacedIds.has(ship.id)), ...deliveredShips],
      shipPurchaseOrders: state.shipPurchaseOrders.filter((order) => !dueIds.has(order.id)),
      nextShipNumber,
    },
    message: replacedShips.length > 0
      ? `船厂已交付 ${deliveredShips.length} 艘舰船，其中 ${replacedShips.length} 艘已自动接替旧船；旧船回收 ${replacementRevenue.toFixed(0)} Cr`
      : `船厂已交付 ${deliveredShips.length} 艘舰船；新船为空舱，请先分配统一配置方案`,
  };
}

export function refreshShipyardMarket(
  state: GameState,
  shipTypes: readonly ShipType[],
  nextDay: number,
): ShipyardMarketOffer[] {
  return shipTypes.map((shipType) => {
    const current = shipyardOfferFor(state, shipType);
    const dailyRandom = createRandom(`${state.config.seed}:shipyard-trend:${shipType.id}:${nextDay}`);
    const popularity = Number(clamp(
      current.popularity + (dailyRandom.next() - 0.5) * 0.024 + (0.52 - current.popularity) * 0.004,
      0.08,
      0.98,
    ).toFixed(4));
    if (nextDay % 7 !== 0) return { ...current, popularity, updatedDay: nextDay };
    const clearanceChance = 0.12 + (1 - popularity) * 0.64;
    const discountRate = dailyRandom.next() < clearanceChance
      ? Number(clamp(0.03 + (1 - popularity) * 0.2 + dailyRandom.next() * 0.06, 0, 0.3).toFixed(2))
      : 0;
    const replenishment = dailyRandom.next() < 0.08 + (1 - popularity) * 0.56
      ? dailyRandom.integer(1, popularity < 0.4 ? 3 : 1)
      : 0;
    return {
      ...current,
      popularity,
      discountRate,
      inventory: Math.min(5, current.inventory + replenishment),
      updatedDay: nextDay,
    };
  });
}

export function orderAutomaticReplacements(
  state: GameState,
  day: number,
  shipTypes: readonly ShipType[],
): { state: GameState; orderedShipNames: string[]; deferredCount: number } {
  if (state.autoReplacementAgeYears === null) {
    return { state, orderedShipNames: [], deferredCount: 0 };
  }
  const pendingReplacementIds = new Set(
    state.shipPurchaseOrders.flatMap((order) => order.replacementShipIds ?? []),
  );
  const eligible = state.fleet
    .filter((ship) =>
      shipAgeYears(ship, day) >= state.autoReplacementAgeYears! && !pendingReplacementIds.has(ship.id),
    )
    .sort((left, right) => shipAgeYears(right, day) - shipAgeYears(left, day))
    .slice(0, 60);
  if (eligible.length === 0) {
    return { state, orderedShipNames: [], deferredCount: 0 };
  }

  const selected: OwnedShip[] = [];
  for (const ship of eligible) {
    if (selected.filter((item) => item.shipTypeId === ship.shipTypeId).length >= 20) continue;
    const candidate = [...selected, ship];
    const lines = [...new Set(candidate.map((item) => item.shipTypeId))].map((shipTypeId) => ({
      shipTypeId,
      quantity: candidate.filter((item) => item.shipTypeId === shipTypeId).length,
    }));
    const quote = quoteShipPurchaseAgreement(state, lines, shipTypes);
    if (quote.totalPrice <= state.cash) selected.push(ship);
  }
  if (selected.length === 0) {
    return { state, orderedShipNames: [], deferredCount: eligible.length };
  }

  const lines = [...new Set(selected.map((ship) => ship.shipTypeId))].map((shipTypeId) => ({
    shipTypeId,
    quantity: selected.filter((ship) => ship.shipTypeId === shipTypeId).length,
  }));
  const existingOrderIds = new Set(state.shipPurchaseOrders.map((order) => order.id));
  const purchased = placeShipPurchaseAgreement(state, lines, shipTypes).state;
  const replacementIdsByType = new Map(lines.map((line) => [
    line.shipTypeId,
    selected.filter((ship) => ship.shipTypeId === line.shipTypeId).map((ship) => ship.id),
  ]));
  const shipPurchaseOrders = purchased.shipPurchaseOrders.map((order) =>
    existingOrderIds.has(order.id)
      ? order
      : { ...order, replacementShipIds: replacementIdsByType.get(order.shipTypeId) ?? [] },
  );
  return {
    state: { ...purchased, shipPurchaseOrders },
    orderedShipNames: selected.map((ship) => ship.name),
    deferredCount: eligible.length - selected.length,
  };
}
