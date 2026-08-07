import type { GameRouteDaySummary, GameState } from "../game.js";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface PersistGameResult {
  saved: boolean;
  retainedHistoryDays: number;
  bytes: number;
  error?: unknown;
}

function compactHistoricalRoute(route: GameRouteDaySummary, keepEvaluations: boolean): GameRouteDaySummary {
  if (keepEvaluations) return route;
  return { ...route, evaluations: [] };
}

/**
 * localStorage is intentionally treated as a compact resume snapshot, not the
 * authoritative analytics database. Route-level history stays aggressively
 * compact, while lightweight fuel quotes are retained for the 360-day chart.
 */
export function compactGameForStorage(game: GameState, historyDays: number): GameState {
  const history = historyDays > 0 ? game.history.slice(-historyDays) : [];
  return {
    ...game,
    history: history.map((record, index) => ({
      ...record,
      financialEvents: index === history.length - 1 ? (record.financialEvents?.slice(-200) ?? []) : [],
      routes: record.routes.map((route) =>
        compactHistoricalRoute(route, index === history.length - 1),
      ),
    })),
    fuelMarket: game.fuelMarket.slice(-360),
    scheduledFlights: game.scheduledFlights.slice(0, 300),
    shipLogs: game.shipLogs.slice(-200),
    // Empty capacity rows are reproducible from the port level and current day.
    starportCapacity: game.starportCapacity.filter((entry) => entry.used > 0),
  };
}

export function persistGame(
  storage: StorageLike,
  key: string,
  game: GameState,
): PersistGameResult {
  let lastError: unknown;
  for (const historyDays of [90, 30, 7, 0]) {
    const serialized = JSON.stringify(compactGameForStorage(game, historyDays));
    try {
      storage.setItem(key, serialized);
      return {
        saved: true,
        retainedHistoryDays: Math.min(historyDays, game.history.length),
        bytes: serialized.length * 2,
      };
    } catch (error) {
      lastError = error;
    }
  }
  return { saved: false, retainedHistoryDays: 0, bytes: 0, error: lastError };
}

export function loadStoredGame(storage: StorageLike, key: string): unknown {
  const serialized = storage.getItem(key);
  return serialized ? JSON.parse(serialized) : undefined;
}
