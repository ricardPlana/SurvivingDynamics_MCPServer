import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  FORECAST_ROUTE,
  LOCATIONS_ROUTE,
  RUNNING_ASSESSMENT_ROUTE,
  WEATHER_ROUTE,
  WeatherError,
} from "../src/domain/weather.js";
import { assessRunning, getDailyForecast, getWeather, searchLocations } from "../src/services/openMeteo.js";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function geocodingResponse(name = "Barcelona", country = "Spain"): Response {
  return Response.json({
    results: [{
      name,
      admin1: "Catalonia",
      country,
      country_code: "ES",
      latitude: 41.38,
      longitude: 2.17,
      timezone: "Europe/Madrid",
    }],
  });
}

function dailyResponse(date: string, values: {
  minimumTemperatureC?: number;
  maximumTemperatureC?: number;
  precipitationMm?: number;
  maximumWindSpeedKmh?: number;
  weatherCode?: number;
} = {}): Response {
  return Response.json({
    daily: {
      time: [date],
      temperature_2m_min: [values.minimumTemperatureC ?? 12],
      temperature_2m_max: [values.maximumTemperatureC ?? 21],
      precipitation_sum: [values.precipitationMm ?? 0],
      wind_speed_10m_max: [values.maximumWindSpeedKmh ?? 15],
      weather_code: [values.weatherCode ?? 1],
    },
  });
}

test("rejects an empty city before making a provider request", async () => {
  let calls = 0;
  await assert.rejects(
    getWeather(" ", async () => {
      calls += 1;
      return new Response();
    }),
    (error: unknown) => error instanceof WeatherError && error.status === 400,
  );
  assert.equal(calls, 0);
});

test("maps geocoding and current forecast into the existing weather contract", async () => {
  const urls: URL[] = [];
  const fetcher = async (input: URL | RequestInfo): Promise<Response> => {
    const url = new URL(input.toString());
    urls.push(url);
    if (url.hostname === "geocoding-api.open-meteo.com") return geocodingResponse("Paris", "France");
    return Response.json({
      current: {
        temperature_2m: 18.2,
        apparent_temperature: 17.8,
        relative_humidity_2m: 62,
        precipitation: 0,
        weather_code: 0,
        wind_speed_10m: 12.4,
        is_day: 1,
        time: "2026-10-06T14:00",
      },
    });
  };

  const result = await getWeather(" Paris ", fetcher);
  assert.deepEqual(result, {
    city: "Paris",
    country: "France",
    temperatureC: 18.2,
    feelsLikeC: 17.8,
    relativeHumidityPercent: 62,
    precipitationMm: 0,
    windSpeedKmh: 12.4,
    condition: "Clear",
    observedAt: "2026-10-06T14:00",
    isDay: true,
  });
  assert.equal(urls.length, 2);
  assert.equal(urls[0].searchParams.get("name"), "Paris");
  assert.equal(urls[0].searchParams.get("count"), "10");
  assert.equal(urls[1].searchParams.get("latitude"), "41.38");
});

test("retries a transient provider network failure once", async () => {
  let weatherCalls = 0;
  const result = await getWeather("Barcelona", async (input) => {
    const url = new URL(input.toString());
    if (url.hostname === "geocoding-api.open-meteo.com") return geocodingResponse();
    weatherCalls += 1;
    if (weatherCalls === 1) throw new TypeError("Temporary network failure");
    return Response.json({
      current: {
        temperature_2m: 18,
        apparent_temperature: 18,
        relative_humidity_2m: 50,
        precipitation: 0,
        weather_code: 1,
        wind_speed_10m: 5,
        is_day: 1,
        time: "2026-10-20T14:00",
      },
    });
  });

  assert.equal(weatherCalls, 2);
  assert.equal(result.city, "Barcelona");
});

test("returns useful locations for city names with diacritics", async () => {
  const locations = await searchLocations("Lerida", async (input) => {
    assert.equal(new URL(input.toString()).searchParams.get("name"), "Lleida");
    return Response.json({
      results: [{
        name: "Lérida",
        admin1: "Catalonia",
        country: "Spain",
        country_code: "ES",
        latitude: 41.62,
        longitude: 0.62,
        timezone: "Europe/Madrid",
      }],
    });
  });
  assert.equal(locations[0].name, "Lérida");

  const result = await getWeather("Lerida", async (input) => {
    const url = new URL(input.toString());
    return url.hostname === "geocoding-api.open-meteo.com"
      ? geocodingResponse("Lérida")
      : Response.json({
        current: {
          temperature_2m: 18,
          apparent_temperature: 18,
          relative_humidity_2m: 50,
          precipitation: 0,
          weather_code: 1,
          wind_speed_10m: 5,
          is_day: 1,
          time: "2026-10-06T14:00",
        },
      });
  });
  assert.equal(result.city, "Lérida");
});

test("returns city choices when a name is ambiguous and filters by country", async () => {
  const fetcher = async (input: URL | RequestInfo): Promise<Response> => {
    const url = new URL(input.toString());
    if (url.hostname === "geocoding-api.open-meteo.com") {
      return Response.json({
        results: [
          { name: "Santiago", country: "Chile", country_code: "CL", latitude: -33.45, longitude: -70.66 },
          { name: "Santiago", country: "Spain", country_code: "ES", latitude: 42.88, longitude: -8.54 },
        ],
      });
    }
    return Response.json({
      current: {
        temperature_2m: 18,
        apparent_temperature: 18,
        relative_humidity_2m: 50,
        precipitation: 0,
        weather_code: 1,
        wind_speed_10m: 5,
        is_day: 1,
        time: "2026-10-06T14:00",
      },
    });
  };

  await assert.rejects(
    getWeather("Santiago", fetcher),
    (error: unknown) => error instanceof WeatherError
      && error.status === 409
      && Array.isArray(error.details)
      && error.details.length === 2,
  );
  const selected = await getWeather("Santiago", fetcher, "ES");
  assert.equal(selected.country, "Spain");
});

test("returns an empty location list when there are no matches", async () => {
  assert.deepEqual(await searchLocations("Narnia", async () => Response.json({ results: [] })), []);
});

test("rejects dates outside the supported forecast range before calling the provider", async () => {
  let calls = 0;
  await assert.rejects(
    getDailyForecast("Barcelona", "1900-01-01", async () => {
      calls += 1;
      return new Response();
    }),
    (error: unknown) => error instanceof WeatherError && error.code === "date_out_of_range",
  );
  assert.equal(calls, 0);
});

test("maps a daily forecast for the requested date", async () => {
  const date = today();
  const fetcher = async (input: URL | RequestInfo): Promise<Response> => {
    const url = new URL(input.toString());
    return url.hostname === "geocoding-api.open-meteo.com"
      ? geocodingResponse()
      : dailyResponse(date, { precipitationMm: 0.5, maximumWindSpeedKmh: 18 });
  };

  const forecast = await getDailyForecast("Barcelona", date, fetcher);
  assert.deepEqual(forecast, {
    city: "Barcelona",
    country: "Spain",
    date,
    minimumTemperatureC: 12,
    maximumTemperatureC: 21,
    precipitationMm: 0.5,
    maximumWindSpeedKmh: 18,
    condition: "Mostly clear",
  });
});

test("explains the running recommendation and returns its explicit thresholds", async () => {
  const date = today();
  const fetcher = async (input: URL | RequestInfo): Promise<Response> => {
    const url = new URL(input.toString());
    return url.hostname === "geocoding-api.open-meteo.com"
      ? geocodingResponse()
      : dailyResponse(date, { minimumTemperatureC: 3, maximumTemperatureC: 31, precipitationMm: 4, maximumWindSpeedKmh: 30 });
  };

  const assessment = await assessRunning("Barcelona", date, fetcher);
  assert.equal(assessment.recommendation, "not_recommended");
  assert.equal(assessment.reasons.length, 4);
  assert.equal(assessment.thresholds.minimumTemperatureC, 5);
  assert.equal(assessment.thresholds.maximumTemperatureC, 30);
  assert.equal(assessment.thresholds.maximumPrecipitationMm, 2);
  assert.equal(assessment.thresholds.maximumWindSpeedKmh, 25);
});

test("accepts forecast values exactly on the running thresholds", async () => {
  const date = today();
  const fetcher = async (input: URL | RequestInfo): Promise<Response> => {
    const url = new URL(input.toString());
    return url.hostname === "geocoding-api.open-meteo.com"
      ? geocodingResponse()
      : dailyResponse(date, {
        minimumTemperatureC: 5,
        maximumTemperatureC: 30,
        precipitationMm: 2,
        maximumWindSpeedKmh: 25,
      });
  };

  const assessment = await assessRunning("Barcelona", date, fetcher);
  assert.equal(assessment.recommendation, "recommended");
  assert.deepEqual(assessment.reasons, []);
});

test("keeps both OpenAPI surfaces aligned with the API routes and each other", async () => {
  const specification = JSON.parse(
    await readFile(new URL("../../openapi/weather.openapi.json", import.meta.url), "utf8"),
  ) as {
    basePath?: string;
    definitions?: unknown;
    paths?: Record<string, { get?: { operationId?: string; parameters?: Array<{ name?: string; $ref?: string; required?: boolean }> } }>;
  };
  assert.equal(specification.basePath, "/api");
  assert.ok(specification.paths?.[`/${WEATHER_ROUTE}`]?.get?.parameters?.some((parameter) => parameter.$ref === "#/parameters/city"));
  assert.ok(specification.paths?.[`/${LOCATIONS_ROUTE}`]?.get?.parameters?.some((parameter) => parameter.name === "query"));
  assert.equal(specification.paths?.[`/${FORECAST_ROUTE}`]?.get?.operationId, "GetDailyForecast");
  assert.equal(specification.paths?.[`/${RUNNING_ASSESSMENT_ROUTE}`]?.get?.operationId, "AssessRunningConditions");

  const copilotSpecification = JSON.parse(
    await readFile(new URL("../../openapi/copilot.openapi.json", import.meta.url), "utf8"),
  ) as {
    basePath?: string;
    definitions?: unknown;
    paths?: unknown;
    securityDefinitions?: Record<string, { name?: string; in?: string }>;
  };
  assert.equal(copilotSpecification.basePath, "/copilot-weather");
  assert.deepEqual(copilotSpecification.paths, specification.paths);
  assert.deepEqual(copilotSpecification.definitions, specification.definitions);
  assert.equal(copilotSpecification.securityDefinitions?.ApiManagementKey.name, "Ocp-Apim-Subscription-Key");
  assert.equal(copilotSpecification.securityDefinitions?.ApiManagementKey.in, "header");
});
