import { ASTRONOMICAL_UNIT_KM } from "../fuel.js";

export type SublightDistanceUnit = "au" | "km";

function scientificKilometers(value: number): string {
  return value.toExponential(3).replace("e+", "e");
}

export function formatSublightDistanceKm(valueKm: number, unit: SublightDistanceUnit): string {
  return unit === "au"
    ? `${(valueKm / ASTRONOMICAL_UNIT_KM).toFixed(3)} AU`
    : `${scientificKilometers(valueKm)} km`;
}

export function formatSublightDistanceAu(valueAu: number, unit: SublightDistanceUnit): string {
  return unit === "au"
    ? `${valueAu.toFixed(3)} AU`
    : `${scientificKilometers(valueAu * ASTRONOMICAL_UNIT_KM)} km`;
}

export function sublightDistanceInputValue(valueAu: number, unit: SublightDistanceUnit): number | string {
  return unit === "au" ? valueAu : scientificKilometers(valueAu * ASTRONOMICAL_UNIT_KM);
}

export function sublightDistanceInputToAu(value: number, unit: SublightDistanceUnit): number {
  return unit === "au" ? value : value / ASTRONOMICAL_UNIT_KM;
}

export function formatCredits(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M Cr`;
  if (absolute >= 1_000) return `${(value / 1_000).toFixed(1)}K Cr`;
  return `${value.toFixed(0)} Cr`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value);
}

export function formatPopulation(millions: number): string {
  if (millions >= 1_000) {
    const billions = millions / 1_000;
    return `${billions >= 10 ? billions.toFixed(1) : billions.toFixed(2)}B`;
  }
  return `${millions >= 10 ? millions.toFixed(1) : millions.toFixed(2)}M`;
}

export function formatGameDate(day: number): string {
  const year = Math.floor((day - 1) / 364) + 1;
  const dayOfYear = (day - 1) % 364;
  const month = Math.floor(dayOfYear / 28) + 1;
  const dayOfMonth = (dayOfYear % 28) + 1;
  return `航运纪元 ${year} 年 · ${month} 月 ${dayOfMonth} 日`;
}
