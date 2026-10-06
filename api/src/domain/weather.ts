export const WEATHER_ROUTE = "weather";
export const MAX_CITY_LENGTH = 100;

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

export class WeatherError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 502,
    readonly code: "invalid_city" | "city_not_found" | "weather_unavailable",
  ) {
    super(message);
    this.name = "WeatherError";
  }
}

export function normalizeCity(value: string | null): string {
  const city = value?.trim() ?? "";
  if (city.length < 2 || city.length > MAX_CITY_LENGTH) {
    throw new WeatherError(
      `City must contain between 2 and ${MAX_CITY_LENGTH} characters.`,
      400,
      "invalid_city",
    );
  }
  return city;
}
