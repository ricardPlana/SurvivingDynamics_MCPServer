import {
  normalizeCity,
  normalizeForecastDate,
  RUNNING_THRESHOLDS,
  WeatherError,
  type CityLocation,
  type DailyForecast,
  type RunningAssessment,
  type Weather,
} from "../domain/weather.js";

type Fetch = (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>;

const PROVIDER_ATTEMPTS = 2;
const PROVIDER_RETRY_DELAY_MS = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function getProviderResponse(url: URL, fetcher: Fetch): Promise<Response> {
  for (let attempt = 1; attempt <= PROVIDER_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(8_000) });
      if (response.ok) return response;
      if (attempt === PROVIDER_ATTEMPTS || (response.status < 500 && response.status !== 429)) {
        throw new WeatherError("The weather provider returned an error.", 502, "weather_unavailable");
      }
    } catch (error) {
      if (error instanceof WeatherError) throw error;
      if (attempt === PROVIDER_ATTEMPTS) {
        throw new WeatherError("The weather provider could not be reached.", 502, "weather_unavailable");
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, PROVIDER_RETRY_DELAY_MS));
  }

  throw new WeatherError("The weather provider could not be reached.", 502, "weather_unavailable");
}

async function getJson(url: URL, fetcher: Fetch): Promise<Record<string, unknown>> {
  const response = await getProviderResponse(url, fetcher);
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

function normalizeName(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLocaleLowerCase();
}

function canonicalCityName(value: string): string {
  const normalized = normalizeName(value);
  return normalized === "lerida" ? "lleida" : normalized;
}

function geocodingQuery(value: string): string {
  return canonicalCityName(value) === "lleida" ? "Lleida" : value;
}

function mapLocation(value: unknown): CityLocation {
  if (!isRecord(value)) {
    throw new WeatherError("The location provider returned incomplete data.", 502, "weather_unavailable");
  }
  return {
    name: requiredString(value, "name"),
    admin1: typeof value.admin1 === "string" ? value.admin1 : "",
    country: typeof value.country === "string" ? value.country : "",
    countryCode: typeof value.country_code === "string" ? value.country_code : "",
    latitude: requiredNumber(value, "latitude"),
    longitude: requiredNumber(value, "longitude"),
    timezone: typeof value.timezone === "string" ? value.timezone : "auto",
  };
}

async function fetchLocations(query: string, fetcher: Fetch): Promise<CityLocation[]> {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.search = new URLSearchParams({
    name: geocodingQuery(query),
    count: "10",
    language: "en",
    format: "json",
  }).toString();
  const payload = await getJson(url, fetcher);
  if (payload.results === undefined) return [];
  if (!Array.isArray(payload.results)) {
    throw new WeatherError("The location provider returned invalid data.", 502, "weather_unavailable");
  }
  return payload.results.map(mapLocation);
}

export async function searchLocations(queryInput: string | null, fetcher: Fetch = fetch): Promise<CityLocation[]> {
  return fetchLocations(normalizeCity(queryInput, "query"), fetcher);
}

async function resolveLocation(
  cityInput: string | null,
  countryInput: string | null,
  admin1Input: string | null,
  fetcher: Fetch,
): Promise<CityLocation> {
  const city = normalizeCity(cityInput);
  const country = countryInput?.trim() ?? "";
  const admin1 = admin1Input?.trim() ?? "";
  const matches = await fetchLocations(city, fetcher);
  if (matches.length === 0) {
    throw new WeatherError(`No matching city was found for "${city}".`, 404, "city_not_found");
  }

  let candidates = matches.filter((location) => canonicalCityName(location.name) === canonicalCityName(city));
  if (country) {
    candidates = candidates.filter((location) =>
      normalizeName(location.country) === normalizeName(country)
      || normalizeName(location.countryCode) === normalizeName(country));
  }
  if (admin1) {
    candidates = candidates.filter((location) => normalizeName(location.admin1) === normalizeName(admin1));
  }
  if (candidates.length === 1) return candidates[0];

  if (candidates.length === 0 && !country && !admin1 && matches.length === 1) return matches[0];
  const suggestions = candidates.length > 0 ? candidates : matches;
  throw new WeatherError(
    `More than one location may match "${city}". Search for the city and specify its country or region.`,
    409,
    "city_ambiguous",
    suggestions,
  );
}

async function getCurrentForLocation(location: CityLocation, fetcher: Fetch): Promise<Weather> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,is_day",
    timezone: "auto",
  }).toString();

  const payload = await getJson(url, fetcher);
  if (!isRecord(payload.current)) {
    throw new WeatherError("The weather provider returned incomplete data.", 502, "weather_unavailable");
  }
  const current = payload.current;
  return {
    city: location.name,
    country: location.country,
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

export async function getWeather(
  cityInput: string | null,
  fetcher: Fetch = fetch,
  countryInput: string | null = null,
  admin1Input: string | null = null,
): Promise<Weather> {
  const location = await resolveLocation(cityInput, countryInput, admin1Input, fetcher);
  return getCurrentForLocation(location, fetcher);
}

async function fetchDailyForecast(
  location: CityLocation,
  dateInput: string | null,
  fetcher: Fetch,
): Promise<DailyForecast> {
  const date = normalizeForecastDate(dateInput);
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    daily: "temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,weather_code",
    timezone: location.timezone,
    start_date: date,
    end_date: date,
  }).toString();

  const payload = await getJson(url, fetcher);
  if (!isRecord(payload.daily)) {
    throw new WeatherError("The weather provider returned incomplete data.", 502, "weather_unavailable");
  }
  const daily = payload.daily;
  const dates = daily.time;
  if (!Array.isArray(dates)) {
    throw new WeatherError("The weather provider returned incomplete data.", 502, "weather_unavailable");
  }
  const index = dates.indexOf(date);
  if (index < 0) {
    throw new WeatherError("The requested forecast is unavailable.", 502, "weather_unavailable");
  }

  function dailyNumber(key: string): number {
    const values = daily[key];
    const value = Array.isArray(values) ? values[index] : undefined;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new WeatherError("The weather provider returned incomplete data.", 502, "weather_unavailable");
    }
    return value;
  }

  return {
    city: location.name,
    country: location.country,
    date,
    minimumTemperatureC: dailyNumber("temperature_2m_min"),
    maximumTemperatureC: dailyNumber("temperature_2m_max"),
    precipitationMm: dailyNumber("precipitation_sum"),
    maximumWindSpeedKmh: dailyNumber("wind_speed_10m_max"),
    condition: conditionFor(dailyNumber("weather_code")),
  };
}

export async function getDailyForecast(
  cityInput: string | null,
  dateInput: string | null,
  fetcher: Fetch = fetch,
  countryInput: string | null = null,
  admin1Input: string | null = null,
): Promise<DailyForecast> {
  const date = normalizeForecastDate(dateInput);
  const location = await resolveLocation(cityInput, countryInput, admin1Input, fetcher);
  return fetchDailyForecast(location, date, fetcher);
}

export async function assessRunning(
  cityInput: string | null,
  dateInput: string | null,
  fetcher: Fetch = fetch,
  countryInput: string | null = null,
  admin1Input: string | null = null,
): Promise<RunningAssessment> {
  const date = normalizeForecastDate(dateInput);
  const location = await resolveLocation(cityInput, countryInput, admin1Input, fetcher);
  const forecast = await fetchDailyForecast(location, date, fetcher);
  const reasons: string[] = [];

  if (forecast.minimumTemperatureC < RUNNING_THRESHOLDS.minimumTemperatureC) {
    reasons.push(`Minimum temperature is below ${RUNNING_THRESHOLDS.minimumTemperatureC} °C.`);
  }
  if (forecast.maximumTemperatureC > RUNNING_THRESHOLDS.maximumTemperatureC) {
    reasons.push(`Maximum temperature is above ${RUNNING_THRESHOLDS.maximumTemperatureC} °C.`);
  }
  if (forecast.precipitationMm > RUNNING_THRESHOLDS.maximumPrecipitationMm) {
    reasons.push(`Expected precipitation exceeds ${RUNNING_THRESHOLDS.maximumPrecipitationMm} mm.`);
  }
  if (forecast.maximumWindSpeedKmh > RUNNING_THRESHOLDS.maximumWindSpeedKmh) {
    reasons.push(`Maximum wind exceeds ${RUNNING_THRESHOLDS.maximumWindSpeedKmh} km/h.`);
  }

  return {
    activity: "running",
    recommendation: reasons.length === 0 ? "recommended" : "not_recommended",
    city: location.name,
    country: location.country,
    date,
    reasons,
    thresholds: RUNNING_THRESHOLDS,
    forecast,
    disclaimer: "A simple demo heuristic, not medical advice or an official safety warning.",
  };
}
