import { normalizeCity, WeatherError, type Weather } from "../domain/weather.js";

type Fetch = (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function getJson(url: URL, fetcher: Fetch): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetcher(url, { signal: AbortSignal.timeout(8_000) });
  } catch {
    throw new WeatherError("The weather provider could not be reached.", 502, "weather_unavailable");
  }

  if (!response.ok) {
    throw new WeatherError("The weather provider returned an error.", 502, "weather_unavailable");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new WeatherError("The weather provider returned invalid data.", 502, "weather_unavailable");
  }

  if (!isRecord(payload)) {
    throw new WeatherError("The weather provider returned invalid data.", 502, "weather_unavailable");
  }
  return payload;
}

function requiredNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new WeatherError("The weather provider returned incomplete data.", 502, "weather_unavailable");
  }
  return value;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new WeatherError("The weather provider returned incomplete data.", 502, "weather_unavailable");
  }
  return value;
}

function conditionFor(code: number): string {
  if (code === 0) return "Clear";
  if (code === 1 || code === 2) return "Mostly clear";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Fog";
  if ([51, 53, 55, 56, 57].includes(code)) return "Drizzle";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "Rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Snow";
  if ([95, 96, 99].includes(code)) return "Thunderstorm";
  return "Unknown";
}

export async function getWeather(cityInput: string | null, fetcher: Fetch = fetch): Promise<Weather> {
  const city = normalizeCity(cityInput);
  const geocodingUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
  geocodingUrl.search = new URLSearchParams({
    name: city,
    count: "1",
    language: "en",
    format: "json",
  }).toString();

  const geocoding = await getJson(geocodingUrl, fetcher);
  const matches = geocoding.results;
  if (!Array.isArray(matches) || matches.length === 0 || !isRecord(matches[0])) {
    throw new WeatherError(`No matching city was found for "${city}".`, 404, "city_not_found");
  }

  const location = matches[0];
  const latitude = requiredNumber(location, "latitude");
  const longitude = requiredNumber(location, "longitude");
  const forecastUrl = new URL("https://api.open-meteo.com/v1/forecast");
  forecastUrl.search = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,is_day",
    timezone: "auto",
  }).toString();

  const forecast = await getJson(forecastUrl, fetcher);
  if (!isRecord(forecast.current)) {
    throw new WeatherError("The weather provider returned incomplete data.", 502, "weather_unavailable");
  }
  const current = forecast.current;

  return {
    city: requiredString(location, "name"),
    country: typeof location.country === "string" ? location.country : "",
    temperatureC: requiredNumber(current, "temperature_2m"),
    feelsLikeC: requiredNumber(current, "apparent_temperature"),
    relativeHumidityPercent: requiredNumber(current, "relative_humidity_2m"),
    precipitationMm: requiredNumber(current, "precipitation"),
    windSpeedKmh: requiredNumber(current, "wind_speed_10m"),
    condition: conditionFor(requiredNumber(current, "weather_code")),
    observedAt: requiredString(current, "time"),
    isDay: requiredNumber(current, "is_day") === 1,
  };
}
