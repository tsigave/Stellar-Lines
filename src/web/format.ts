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
