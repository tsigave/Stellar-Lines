import { fuelEventIntensity } from "../events.js";
import { FUEL_OPERATING_COST_SCALE } from "../parameters.js";
import type { CampaignDay, GeneratedGalaxy, MarketEvent, SimulationScenario, Starport } from "../types.js";
import { clamp, hashString } from "../utils.js";
import {
  CORE_FUEL_STORAGE_CAPACITY,
  FUEL_CONTRACT_CANCELLATION_RATE,
  FUEL_CONTRACT_DEPOSIT_RATE,
  FUEL_CONTRACT_MINIMUM_WEEKLY_UNITS,
  FUEL_CONTRACT_QUANTITY_STEP,
  FUEL_RESALE_PRICE_RATE,
  FUEL_WAREHOUSE_RENT_PER_TONNE_DAY,
  type FuelAutoContractPolicy,
  type FuelContract,
  type FuelPriceRecord,
  type FuelSurplusPolicy,
  type GameActionResult,
  type GameState,
  requirePlaying,
} from "./model.js";

export function createGeneratedGameEvents(galaxy: GeneratedGalaxy): MarketEvent[] {
  const ports = [...galaxy.ports].sort(
    (left, right) => hashString(`${galaxy.config.seed}:${left.id}`) - hashString(`${galaxy.config.seed}:${right.id}`),
  );
  if (ports.length === 0) return [];
  const first = ports[0]!;
  const second = ports[1] ?? first;
  const third = ports[2] ?? second;
  return [
    {
      id: "v0-trade-fair",
      name: `${first.name} 星际贸易博览会`,
      description: "商务与高端出行需求短期上升。",
      announcedOnDay: 8,
      startsOnDay: 15,
      endsOnDay: 27,
      recoveryDays: 5,
      affectedPortIds: [first.id],
      demandModifiers: { budget: 1.18, leisure: 1.55, business: 2.1, luxury: 1.65 },
      portCapacityModifier: 0.9,
    },
    {
      id: "v0-fuel-shock",
      name: `${second.name} 燃料供应紧张`,
      description: "主要供应节点紧张推高统一市场报价，所有航线成本增加。",
      announcedOnDay: 34,
      startsOnDay: 42,
      endsOnDay: 55,
      recoveryDays: 8,
      affectedPortIds: [second.id],
      demandModifiers: { business: 0.92, luxury: 0.94 },
      fuelPriceModifier: 1.75,
    },
    {
      id: "v0-settlement-wave",
      name: `${third.name} 殖民迁徙潮`,
      description: "新一轮定居计划带来持续客流。",
      announcedOnDay: 67,
      startsOnDay: 76,
      endsOnDay: 98,
      recoveryDays: 12,
      affectedPortIds: [third.id],
      demandModifiers: { budget: 1.9, leisure: 2.15, business: 1.35, luxury: 1.12 },
    },
  ];
}

function dynamicFuelPrice(seed: string, day: number): number {
  const portHash = hashString(`${seed}:fuel:unified-market`);
  const phaseA = (portHash % 6283) / 1000;
  const phaseB = ((portHash >>> 7) % 6283) / 1000;
  const portBias = (((hashString(`${seed}:fuel-bias:unified-market`) % 2_001) / 1_000) - 1) * 0.2;
  const latent = portBias +
    0.78 * Math.sin(day / 12.5 + phaseA) +
    0.46 * Math.sin(day / 5.8 + phaseB) +
    0.2 * Math.sin(day / 2.7 + phaseA / 2);
  // tanh provides soft 1–3 Cr bounds without sticking to either boundary.
  const normal = 2 + Math.tanh(latent) * 0.96;

  // Rare regimes use a ten-day raised-cosine envelope. Price, slope and peak
  // are continuous, so a surplus or shortage is visible before it reaches its
  // extreme and fades out without a one-day jump.
  const windowLength = 48;
  const halfDuration = 5;
  const window = Math.floor((Math.max(1, day) - 1) / windowLength);
  const dayInWindow = (Math.max(1, day) - 1) % windowLength;
  const regimeHash = hashString(`${seed}:fuel-regime:unified-market:${window}`);
  const regimeRoll = (regimeHash % 10_000) / 10_000;
  const centerDay = 6 + (hashString(`${seed}:fuel-window-center:unified-market:${window}`) % 36);
  const distanceFromCenter = Math.abs(dayInWindow - centerDay);
  if (distanceFromCenter <= halfDuration && (regimeRoll < 0.1 || regimeRoll > 0.86)) {
    const progress = (dayInWindow - (centerDay - halfDuration)) / (halfDuration * 2);
    const envelope = Math.sin(Math.PI * progress) ** 2;
    const tailVariation = (hashString(`${seed}:fuel-tail:unified-market:${window}`) % 1_001) / 1_000;
    const target = regimeRoll < 0.1
      ? 0.5 + tailVariation * 0.25
      : 5 + tailVariation;
    return Number((normal + (target - normal) * envelope).toFixed(3));
  }
  return Number(normal.toFixed(3));
}

function globalFuelPrice(galaxy: GeneratedGalaxy, day: number): number {
  let price = dynamicFuelPrice(galaxy.config.seed, day);
  for (const event of createGeneratedGameEvents(galaxy)) {
    if (event.fuelPriceModifier === undefined) continue;
    const intensity = fuelEventIntensity(event, day);
    const target = event.fuelPriceModifier >= 1 ? 6 : 0.5;
    const strength = Math.min(1, Math.abs(event.fuelPriceModifier - 1));
    price += (target - price) * strength * intensity;
  }
  return Number(clamp(price, 0.5, 6).toFixed(3));
}

export function dynamicFuelPorts(galaxy: GeneratedGalaxy, day: number): Starport[] {
  const price = globalFuelPrice(galaxy, day);
  return galaxy.ports.map((port) => ({
    ...port,
    fuelPrice: price,
  }));
}

export function fuelPriceRecord(galaxy: GeneratedGalaxy, day: number): FuelPriceRecord {
  return { day, price: globalFuelPrice(galaxy, day) };
}

export function currentFuelPrice(state: Pick<GameState, "fuelMarket">): number {
  return state.fuelMarket.at(-1)?.price ?? 2;
}

export function fuelContractPremiumRate(termWeeks: number): number {
  return Number((0.01 + clamp(Math.round(termWeeks), 1, 32) * 0.0025).toFixed(4));
}

export interface FuelContractQuote {
  termWeeks: number;
  weeklyUnits: number;
  totalUnits: number;
  marketPrice: number;
  premiumRate: number;
  contractMarketPrice: number;
  deliveredUnitCost: number;
  totalValue: number;
  deposit: number;
  dailyInstallment: number;
}

export function quoteFuelContract(
  state: GameState,
  termWeeks: number,
  weeklyUnits: number,
): FuelContractQuote {
  const normalizedWeeks = clamp(Math.round(termWeeks), 1, 32);
  const normalizedUnits = Math.floor(weeklyUnits / FUEL_CONTRACT_QUANTITY_STEP) * FUEL_CONTRACT_QUANTITY_STEP;
  if (normalizedUnits < FUEL_CONTRACT_MINIMUM_WEEKLY_UNITS) {
    throw new Error(`燃料合约最低供应量为每周 ${FUEL_CONTRACT_MINIMUM_WEEKLY_UNITS} t`);
  }
  const marketPrice = currentFuelPrice(state);
  const premiumRate = fuelContractPremiumRate(normalizedWeeks);
  const contractMarketPrice = Number((marketPrice * (1 + premiumRate)).toFixed(4));
  const deliveredUnitCost = contractMarketPrice * FUEL_OPERATING_COST_SCALE;
  const totalUnits = normalizedUnits * normalizedWeeks;
  const totalValue = totalUnits * deliveredUnitCost;
  const deposit = totalValue * FUEL_CONTRACT_DEPOSIT_RATE;
  return {
    termWeeks: normalizedWeeks,
    weeklyUnits: normalizedUnits,
    totalUnits,
    marketPrice,
    premiumRate,
    contractMarketPrice,
    deliveredUnitCost,
    totalValue,
    deposit,
    dailyInstallment: totalValue * (1 - FUEL_CONTRACT_DEPOSIT_RATE) / (normalizedWeeks * 7),
  };
}

function createFuelContractFromQuote(
  state: GameState,
  quote: FuelContractQuote,
  createdAutomatically: boolean,
): GameState {
  if (state.cash < quote.deposit) throw new Error("资金不足，无法支付燃料合约定金");
  const contract: FuelContract = {
    id: `fuel-contract-${state.nextFuelContractNumber}`,
    signedOnDay: state.day,
    startsOnDay: state.day,
    endsOnDay: state.day + quote.termWeeks * 7 - 1,
    termWeeks: quote.termWeeks,
    weeklyUnits: quote.weeklyUnits,
    totalUnits: quote.totalUnits,
    deliveredUnits: 0,
    marketPriceAtSigning: quote.marketPrice,
    premiumRate: quote.premiumRate,
    contractMarketPrice: quote.contractMarketPrice,
    deliveredUnitCost: quote.deliveredUnitCost,
    totalValue: quote.totalValue,
    depositPaid: quote.deposit,
    depositRemaining: quote.deposit,
    createdAutomatically,
    cancelledOnDay: null,
    cancellationFee: 0,
  };
  return {
    ...state,
    cash: state.cash - quote.deposit,
    fuelContracts: [...state.fuelContracts, contract],
    nextFuelContractNumber: state.nextFuelContractNumber + 1,
  };
}

export function signFuelContract(
  state: GameState,
  termWeeks: number,
  weeklyUnits: number,
): GameActionResult {
  requirePlaying(state);
  const quote = quoteFuelContract(state, termWeeks, weeklyUnits);
  return {
    state: createFuelContractFromQuote(state, quote, false),
    message: `燃料合约已签订：每周 ${quote.weeklyUnits.toFixed(0)} t、${quote.termWeeks} 周，已支付 20% 定金 ${quote.deposit.toFixed(0)} Cr`,
  };
}

export function cancelFuelContract(state: GameState, contractId: string): GameActionResult {
  requirePlaying(state);
  const contract = state.fuelContracts.find((candidate) => candidate.id === contractId);
  if (!contract || contract.cancelledOnDay !== null || state.day > contract.endsOnDay) {
    throw new Error("该燃料合约已经结束");
  }
  const remainingUnits = Math.max(0, contract.totalUnits - contract.deliveredUnits);
  const remainingValue = remainingUnits * contract.deliveredUnitCost;
  const supplierPriceLoss = Math.max(
    0,
    contract.deliveredUnitCost - currentFuelPrice(state) * FUEL_OPERATING_COST_SCALE,
  ) * remainingUnits;
  const additionalFee = Math.max(remainingValue * FUEL_CONTRACT_CANCELLATION_RATE, supplierPriceLoss);
  if (state.cash < additionalFee) throw new Error("资金不足，无法支付提前解约违约金");
  const totalLoss = contract.depositRemaining + additionalFee;
  return {
    state: {
      ...state,
      cash: state.cash - additionalFee,
      fuelContracts: state.fuelContracts.map((candidate) => candidate.id === contractId
        ? {
            ...candidate,
            cancelledOnDay: state.day,
            cancellationFee: totalLoss,
            depositRemaining: 0,
          }
        : candidate),
    },
    message: `已提前取消 ${contract.id}：未摊销定金被没收，并支付 ${additionalFee.toFixed(0)} Cr 违约金`,
  };
}

export function setFuelAutoContractPolicy(
  state: GameState,
  policy: FuelAutoContractPolicy,
): GameActionResult {
  requirePlaying(state);
  const normalized: FuelAutoContractPolicy = {
    enabled: Boolean(policy.enabled),
    triggerPrice: Number(clamp(policy.triggerPrice, 0.5, 6).toFixed(2)),
    termWeeks: clamp(Math.round(policy.termWeeks), 1, 32),
    spotExposureShare: Number(clamp(policy.spotExposureShare, 0, 1).toFixed(2)),
  };
  return {
    state: { ...state, fuelAutoContractPolicy: normalized },
    message: normalized.enabled
      ? `自动签约已启用：燃料价格不高于 ${normalized.triggerPrice.toFixed(2)} Cr 时，至少保留 ${(normalized.spotExposureShare * 100).toFixed(0)}% 现货敞口`
      : "自动签约已关闭",
  };
}

export function setFuelWarehouseRental(state: GameState, rented: boolean): GameActionResult {
  requirePlaying(state);
  if (!rented && state.fuelWarehouse.quantity > 1e-9) throw new Error("取消仓库前必须先清空库存");
  return {
    state: { ...state, fuelWarehouse: { ...state.fuelWarehouse, rented } },
    message: rented ? "已租用公司燃料仓库" : "已取消燃料仓库租用",
  };
}

export function setFuelWarehousePolicy(
  state: GameState,
  dailyWithdrawalLimit: number | null,
  surplusPolicy: FuelSurplusPolicy,
): GameActionResult {
  requirePlaying(state);
  const normalizedLimit = dailyWithdrawalLimit === null
    ? null
    : Number(clamp(dailyWithdrawalLimit, 0, CORE_FUEL_STORAGE_CAPACITY).toFixed(1));
  return {
    state: {
      ...state,
      fuelWarehouse: {
        ...state.fuelWarehouse,
        dailyWithdrawalLimit: normalizedLimit,
        surplusPolicy,
      },
    },
    message: `仓库策略已更新：${normalizedLimit === null ? "每日提取不限量" : `每日最多提取 ${normalizedLimit.toFixed(0)} t`}；${surplusPolicy === "store-first" ? "合约盈余优先入库" : "合约盈余直接出售"}`,
  };
}

export function buyFuelForWarehouse(state: GameState, units: number): GameActionResult {
  requirePlaying(state);
  if (!state.fuelWarehouse.rented) throw new Error("请先租用燃料仓库");
  const quantity = Number(Math.max(0, Math.min(units, state.fuelWarehouse.capacity - state.fuelWarehouse.quantity)).toFixed(1));
  if (quantity <= 0) throw new Error("请输入有效买入量，且不能超过仓库剩余容量");
  const unitCost = currentFuelPrice(state) * FUEL_OPERATING_COST_SCALE;
  const cost = quantity * unitCost;
  if (state.cash < cost) throw new Error("资金不足，无法完成燃料入库采购");
  const previousValue = state.fuelWarehouse.quantity * state.fuelWarehouse.averageUnitCost;
  const nextQuantity = state.fuelWarehouse.quantity + quantity;
  return {
    state: {
      ...state,
      cash: state.cash - cost,
      fuelWarehouse: {
        ...state.fuelWarehouse,
        quantity: nextQuantity,
        averageUnitCost: (previousValue + cost) / nextQuantity,
      },
    },
    message: `已按当前市场价买入 ${quantity.toFixed(1)} t 燃料并存入仓库`,
  };
}

export function sellFuelFromWarehouse(state: GameState, units: number): GameActionResult {
  requirePlaying(state);
  if (!state.fuelWarehouse.rented) throw new Error("当前没有租用燃料仓库");
  const quantity = Number(Math.max(0, Math.min(units, state.fuelWarehouse.quantity)).toFixed(1));
  if (quantity <= 0) throw new Error("请输入有效出售量");
  const revenue = quantity * currentFuelPrice(state) * FUEL_OPERATING_COST_SCALE * FUEL_RESALE_PRICE_RATE;
  const nextQuantity = state.fuelWarehouse.quantity - quantity;
  return {
    state: {
      ...state,
      cash: state.cash + revenue,
      fuelWarehouse: {
        ...state.fuelWarehouse,
        quantity: nextQuantity,
        averageUnitCost: nextQuantity > 1e-9 ? state.fuelWarehouse.averageUnitCost : 0,
      },
    },
    message: `已按市场交付价的 80% 出售 ${quantity.toFixed(1)} t 仓库燃料`,
  };
}

interface FuelDaySettlement {
  state: GameState;
  consumedUnits: number;
  consumedCost: number;
  effectiveUnitCost: number;
  contractDeliveredUnits: number;
  contractUsedUnits: number;
  contractCost: number;
  contractInstallment: number;
  contractDepositAmortized: number;
  spotPurchasedUnits: number;
  spotPurchaseCost: number;
  warehouseStoredUnits: number;
  warehouseStoredValue: number;
  warehouseUsedUnits: number;
  warehouseUsedValue: number;
  warehouseRent: number;
  surplusSoldUnits: number;
  surplusSoldCost: number;
  surplusSaleRevenue: number;
}

function isFuelContractActive(contract: FuelContract, day: number): boolean {
  return contract.cancelledOnDay === null && day >= contract.startsOnDay && day <= contract.endsOnDay &&
    contract.deliveredUnits < contract.totalUnits - 1e-9;
}

export function forecastWeeklyFuelDemand(state: GameState, currentDemand = 0): number {
  if (currentDemand > 0) return currentDemand * 7;
  const recent = state.history.slice(-30).filter((record) => (record.fuelConsumedUnits ?? 0) > 0);
  if (recent.length === 0) return 0;
  return recent.reduce((sum, record) => sum + (record.fuelConsumedUnits ?? 0), 0) / recent.length * 7;
}

export function contractedFuelShare(state: GameState, weeklyDemand: number, day = state.day): number {
  if (weeklyDemand <= 0) return 0;
  const weeklyUnits = state.fuelContracts
    .filter((contract) => isFuelContractActive(contract, day))
    .reduce((sum, contract) => sum + contract.weeklyUnits, 0);
  return clamp(weeklyUnits / weeklyDemand, 0, 10);
}

export function applyAutomaticFuelContract(
  state: GameState,
  weeklyDemand: number,
): { state: GameState; signedWeeklyUnits: number } {
  const policy = state.fuelAutoContractPolicy;
  if (!policy.enabled || currentFuelPrice(state) > policy.triggerPrice || weeklyDemand <= 0) {
    return { state, signedWeeklyUnits: 0 };
  }
  const allowedWeeklyUnits = weeklyDemand * (1 - policy.spotExposureShare);
  const existingWeeklyUnits = state.fuelContracts
    .filter((contract) => isFuelContractActive(contract, state.day))
    .reduce((sum, contract) => sum + contract.weeklyUnits, 0);
  const requestedWeeklyUnits = Math.floor(
    Math.max(0, allowedWeeklyUnits - existingWeeklyUnits) / FUEL_CONTRACT_QUANTITY_STEP,
  ) * FUEL_CONTRACT_QUANTITY_STEP;
  if (requestedWeeklyUnits < FUEL_CONTRACT_MINIMUM_WEEKLY_UNITS) {
    return { state, signedWeeklyUnits: 0 };
  }
  const quote = quoteFuelContract(state, policy.termWeeks, requestedWeeklyUnits);
  if (state.cash < quote.deposit) return { state, signedWeeklyUnits: 0 };
  return {
    state: createFuelContractFromQuote(state, quote, true),
    signedWeeklyUnits: quote.weeklyUnits,
  };
}

export function settleFuelDay(
  state: GameState,
  consumedUnits: number,
): FuelDaySettlement {
  let contractDeliveredUnits = 0;
  let contractCost = 0;
  let contractInstallment = 0;
  let contractDepositAmortized = 0;
  const contracts = state.fuelContracts.map((contract) => {
    if (!isFuelContractActive(contract, state.day)) return contract;
    const deliveryUnits = Math.min(contract.weeklyUnits / 7, contract.totalUnits - contract.deliveredUnits);
    const deliveryValue = deliveryUnits * contract.deliveredUnitCost;
    const depositAmortized = Math.min(contract.depositRemaining, deliveryValue * FUEL_CONTRACT_DEPOSIT_RATE);
    contractDeliveredUnits += deliveryUnits;
    contractCost += deliveryValue;
    contractInstallment += deliveryValue * (1 - FUEL_CONTRACT_DEPOSIT_RATE);
    contractDepositAmortized += depositAmortized;
    return {
      ...contract,
      deliveredUnits: contract.deliveredUnits + deliveryUnits,
      depositRemaining: Math.max(0, contract.depositRemaining - depositAmortized),
    };
  });
  const contractAverageUnitCost = contractDeliveredUnits > 0 ? contractCost / contractDeliveredUnits : 0;
  const contractUsedUnits = Math.min(consumedUnits, contractDeliveredUnits);
  const contractUsedCost = contractUsedUnits * contractAverageUnitCost;
  const remainingDemand = Math.max(0, consumedUnits - contractUsedUnits);
  const withdrawalLimit = state.fuelWarehouse.dailyWithdrawalLimit ?? Number.POSITIVE_INFINITY;
  const warehouseUsedUnits = state.fuelWarehouse.rented
    ? Math.min(remainingDemand, state.fuelWarehouse.quantity, withdrawalLimit)
    : 0;
  const warehouseUsedValue = warehouseUsedUnits * state.fuelWarehouse.averageUnitCost;
  const spotPurchasedUnits = Math.max(0, remainingDemand - warehouseUsedUnits);
  const spotDeliveredUnitCost = currentFuelPrice(state) * FUEL_OPERATING_COST_SCALE;
  const spotPurchaseCost = spotPurchasedUnits * spotDeliveredUnitCost;
  const surplusUnits = Math.max(0, contractDeliveredUnits - contractUsedUnits);
  const warehouseQuantityAfterUse = Math.max(0, state.fuelWarehouse.quantity - warehouseUsedUnits);
  const availableCapacity = Math.max(0, state.fuelWarehouse.capacity - warehouseQuantityAfterUse);
  const warehouseStoredUnits = state.fuelWarehouse.rented && state.fuelWarehouse.surplusPolicy === "store-first"
    ? Math.min(surplusUnits, availableCapacity)
    : 0;
  const warehouseStoredValue = warehouseStoredUnits * contractAverageUnitCost;
  const surplusSoldUnits = Math.max(0, surplusUnits - warehouseStoredUnits);
  const surplusSoldCost = surplusSoldUnits * contractAverageUnitCost;
  const surplusSaleRevenue = surplusSoldUnits * spotDeliveredUnitCost * FUEL_RESALE_PRICE_RATE;
  const remainingInventoryValue = warehouseQuantityAfterUse * state.fuelWarehouse.averageUnitCost;
  const warehouseQuantity = warehouseQuantityAfterUse + warehouseStoredUnits;
  const warehouseAverageUnitCost = warehouseQuantity > 1e-9
    ? (remainingInventoryValue + warehouseStoredValue) / warehouseQuantity
    : 0;
  const warehouseRent = state.fuelWarehouse.rented
    ? warehouseQuantity * FUEL_WAREHOUSE_RENT_PER_TONNE_DAY
    : 0;
  const consumedCost = contractUsedCost + warehouseUsedValue + spotPurchaseCost;
  return {
    state: {
      ...state,
      fuelContracts: contracts,
      fuelWarehouse: {
        ...state.fuelWarehouse,
        quantity: warehouseQuantity,
        averageUnitCost: warehouseAverageUnitCost,
      },
    },
    consumedUnits,
    consumedCost,
    effectiveUnitCost: consumedUnits > 0 ? consumedCost / consumedUnits : spotDeliveredUnitCost,
    contractDeliveredUnits,
    contractUsedUnits,
    contractCost,
    contractInstallment,
    contractDepositAmortized,
    spotPurchasedUnits,
    spotPurchaseCost,
    warehouseStoredUnits,
    warehouseStoredValue,
    warehouseUsedUnits,
    warehouseUsedValue,
    warehouseRent,
    surplusSoldUnits,
    surplusSoldCost,
    surplusSaleRevenue,
  };
}

export function applyPlayerFuelCost(
  campaignDay: CampaignDay,
  scenario: SimulationScenario,
  effectiveUnitCost: number,
): CampaignDay {
  const playerRouteIds = new Set(scenario.routes
    .filter((route) => route.companyId === "player")
    .map((route) => route.id));
  let operatingCostDelta = 0;
  const services = campaignDay.settlement.services.map((service) => {
    const routeId = service.serviceLegId.split(":")[0] ?? "";
    if (!playerRouteIds.has(routeId)) return service;
    const fuelCost = service.fuelUnitsConsumed * effectiveUnitCost;
    const delta = fuelCost - service.costBreakdown.fuel;
    operatingCostDelta += delta;
    const costBreakdown = {
      ...service.costBreakdown,
      fuel: fuelCost,
      total: service.costBreakdown.total + delta,
    };
    return {
      ...service,
      inventoryFuelUnitsUsed: 0,
      inventoryFuelValueUsed: 0,
      operatingCost: service.operatingCost + delta,
      costBreakdown,
      netProfit: service.netProfit - delta,
    };
  });
  const companies = campaignDay.settlement.companies.map((company) => company.companyId === "player"
    ? {
        ...company,
        operatingCost: company.operatingCost + operatingCostDelta,
        operatingProfit: company.operatingProfit - operatingCostDelta,
      }
    : company);
  return {
    ...campaignDay,
    settlement: { ...campaignDay.settlement, services, companies },
  };
}
