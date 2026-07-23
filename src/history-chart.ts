import { PROVIDER_IDS, type DailyUsage, type ProviderId } from "./types";

export interface HistoryChartPoint {
  date: string;
  value: number;
}

export interface HistoryChartSeries {
  provider: ProviderId;
  points: HistoryChartPoint[];
}

export interface HistoryChartData {
  dates: string[];
  series: HistoryChartSeries[];
  total: HistoryChartPoint[];
}

export function prepareHistoryChartData(
  histories: Record<ProviderId, DailyUsage[]>,
  maximumDates = 30,
): HistoryChartData {
  const dates = [...new Set(PROVIDER_IDS.flatMap((provider) => histories[provider].map((item) => item.date)))]
    .sort()
    .slice(-Math.max(1, maximumDates));
  const includedDates = new Set(dates);
  const series = PROVIDER_IDS.map((provider) => ({
    provider,
    points: histories[provider]
      .filter((item) => includedDates.has(item.date))
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((item) => ({ date: item.date, value: item.equivalentUsedUsd })),
  }));
  const totalsByDate = new Map<string, number>();
  for (const provider of PROVIDER_IDS) {
    for (const item of histories[provider]) {
      if (includedDates.has(item.date)) {
        totalsByDate.set(item.date, (totalsByDate.get(item.date) ?? 0) + item.equivalentUsedUsd);
      }
    }
  }
  const total = dates.map((date) => ({ date, value: totalsByDate.get(date) ?? 0 }));
  return { dates, series, total };
}
