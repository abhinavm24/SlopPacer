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
  return { dates, series };
}
