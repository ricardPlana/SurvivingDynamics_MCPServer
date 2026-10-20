export const WEATHER_ROUTE = "weather";
export const LOCATIONS_ROUTE = "locations";
export const FORECAST_ROUTE = "forecast";
export const RUNNING_ASSESSMENT_ROUTE = "running-assessment";
export const MAX_CITY_LENGTH = 100;
export const MAX_FORECAST_DAYS = 7;

export type Weather = {
  city: string;
  country: string;
  temperatureC: number;
  feelsLikeC: number;
  relativeHumidityPercent: number;
  precipitationMm: number;
  windSpeedKmh: number;
  condition: string;
  observedAt: string;
  isDay: boolean;
};

export type CityLocation = {
  name: string;
  admin1: string;
  country: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  timezone: string;
};

export type DailyForecast = {
  city: string;
  country: string;
  date: string;
  minimumTemperatureC: number;
  maximumTemperatureC: number;
  precipitationMm: number;
  maximumWindSpeedKmh: number;
  condition: string;
};

export const RUNNING_THRESHOLDS = {
  minimumTemperatureC: 5,
  maximumTemperatureC: 30,
  maximumPrecipitationMm: 2,
  maximumWindSpeedKmh: 25,
} as const;

export type RunningAssessment = {
  activity: "running";
  recommendation: "recommended" | "not_recommended";
  city: string;
  country: string;
  date: string;
  reasons: string[];
  thresholds: typeof RUNNING_THRESHOLDS;
  forecast: DailyForecast;
  disclaimer: string;
};

export type WeatherErrorCode =
  | "invalid_city"
  | "city_not_found"
  | "city_ambiguous"
  | "invalid_date"
  | "date_out_of_range"
  | "weather_unavailable";

export class WeatherError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 502,
    readonly code: WeatherErrorCode,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "WeatherError";
  }
}

export function normalizeCity(value: string | null, field = "city"): string {
  const city = value?.trim() ?? "";
  if (city.length < 2 || city.length > MAX_CITY_LENGTH) {
    throw new WeatherError(
      `${field} must contain between 2 and ${MAX_CITY_LENGTH} characters.`,
      400,
      "invalid_city",
    );
  }
  return city;
}

export function normalizeForecastDate(value: string | null): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new WeatherError("Date must use YYYY-MM-DD format.", 400, "invalid_date");
  }

  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new WeatherError("Date must be a valid calendar date.", 400, "invalid_date");
  }

  const today = new Date().toISOString().slice(0, 10);
  const daysFromToday = Math.floor((date.getTime() - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (daysFromToday < 0 || daysFromToday >= MAX_FORECAST_DAYS) {
    throw new WeatherError(`Date must be today or within the next ${MAX_FORECAST_DAYS - 1} days.`, 400, "date_out_of_range");
  }
  return value;
}
