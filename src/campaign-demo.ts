import {
  PROOF_OF_CONCEPT_SCENARIO,
  simulateCampaign,
} from "./index.js";

const result = simulateCampaign(PROOF_OF_CONCEPT_SCENARIO, {
  startDay: 1,
  numberOfDays: 196,
});

console.log(`\n场景：${PROOF_OF_CONCEPT_SCENARIO.name}`);
console.log(
  `${PROOF_OF_CONCEPT_SCENARIO.ports.length} 个星港，` +
    `${PROOF_OF_CONCEPT_SCENARIO.shipTypes.length} 种船型，` +
    `${PROOF_OF_CONCEPT_SCENARIO.routes.length} 条航线`,
);
console.log(`模拟期间：第 ${result.startDay} 日至第 ${result.endDay} 日`);

console.log("\n公司累计表现");
console.table(
  [...result.companies]
    .sort((left, right) => right.operatingProfit - left.operatingProfit)
    .map((company) => ({
      公司: company.companyId,
      日均旅客航段: company.averageDailyPassengers.toFixed(1),
      收入: company.ticketRevenue.toFixed(0),
      成本: company.operatingCost.toFixed(0),
      运营利润: company.operatingProfit.toFixed(0),
    })),
);

const reportDays = new Set([1, 30, 48, 60, 75, 90, 101, 120, 140, 160, 190, 196]);
console.log("关键日期中的玩家公司");
console.table(
  result.days
    .filter((day) => reportDays.has(day.day))
    .map((day) => {
      const player = day.settlement.companies.find((company) => company.companyId === "player");
      return {
        日期: day.day,
        已公布事件: day.announcedEventIds.join(", ") || "—",
        活跃事件: day.activeEventIds.join(", ") || "—",
        旅客航段: player?.passengers.toFixed(1) ?? "0",
        收入: player?.ticketRevenue.toFixed(0) ?? "0",
        运营利润: player?.operatingProfit.toFixed(0) ?? "0",
      };
    }),
);
