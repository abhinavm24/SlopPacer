import { describe, expect, it } from "vitest";
import { prepareHistoryChartData } from "../src/history-chart";

describe("history chart data", () => {
  it("plots all providers against one sorted date axis", () => {
    const chart = prepareHistoryChartData({
      claude: [{ date: "2026-07-17", equivalentUsedUsd: 12 }],
      chatgpt: [{ date: "2026-07-16", equivalentUsedUsd: 8 }],
      cursor: [{ date: "2026-07-17", equivalentUsedUsd: 3 }],
    });

    expect(chart.dates).toEqual(["2026-07-16", "2026-07-17"]);
    expect(chart.series).toEqual([
      { provider: "claude", points: [{ date: "2026-07-17", value: 12 }] },
      { provider: "chatgpt", points: [{ date: "2026-07-16", value: 8 }] },
      { provider: "cursor", points: [{ date: "2026-07-17", value: 3 }] },
    ]);
  });

  it("limits the shared axis to the most recent recorded dates", () => {
    const claude = Array.from({ length: 35 }, (_, index) => ({
      date: new Date(Date.UTC(2026, 5, 1 + index)).toISOString().slice(0, 10),
      equivalentUsedUsd: index,
    }));
    const chart = prepareHistoryChartData({ claude, chatgpt: [], cursor: [] }, 30);

    expect(chart.dates).toHaveLength(30);
    expect(chart.dates[0]).toBe("2026-06-06");
    expect(chart.series[0]?.points).toHaveLength(30);
  });
});
