/**
 * features/forecast — EWMA balance forecast with confidence intervals.
 */
export { ForecastChart } from "./ForecastChart";
export { forecastEwma, enumerateForecastDays } from "@/lib/domain/forecast";
export type { ProviderForecast, ForecastPoint, EwmaConfig } from "@/lib/domain/forecast";
