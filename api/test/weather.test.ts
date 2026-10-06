import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { WEATHER_ROUTE, WeatherError } from "../src/domain/weather.js";
import { getWeather } from "../src/services/openMeteo.js";

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

test("maps geocoding and forecast responses into the public contract", async () => {
  const urls: URL[] = [];
  const fetcher = async (input: URL | RequestInfo): Promise<Response> => {
    const url = new URL(input.toString());
    urls.push(url);
    if (url.hostname === "geocoding-api.open-meteo.com") {
      return Response.json({ results: [{ name: "Paris", country: "France", latitude: 48.85, longitude: 2.35 }] });
    }
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
  assert.equal(urls[1].searchParams.get("latitude"), "48.85");
});

test("returns a not-found error when geocoding has no matches", async () => {
  await assert.rejects(
    getWeather("Narnia", async () => Response.json({ results: [] })),
    (error: unknown) => error instanceof WeatherError && error.status === 404,
  );
});

test("keeps the HTTP route and OpenAPI operation in sync", async () => {
  const specification = JSON.parse(
    await readFile(new URL("../../openapi/weather.openapi.json", import.meta.url), "utf8"),
  ) as {
    basePath?: string;
    definitions?: unknown;
    paths?: Record<string, { get?: { parameters?: Array<{ name?: string; required?: boolean }> } }>;
  };
  const operation = specification.paths?.[`/${WEATHER_ROUTE}`]?.get;
  assert.ok(operation, `OpenAPI must define GET /${WEATHER_ROUTE}`);
  assert.ok(operation.parameters?.some((parameter) => parameter.name === "city" && parameter.required));

  const copilotSpecification = JSON.parse(
    await readFile(new URL("../../openapi/copilot.openapi.json", import.meta.url), "utf8"),
  ) as {
    basePath?: string;
    definitions?: unknown;
    paths?: Record<string, { get?: { parameters?: Array<{ name?: string; required?: boolean }> } }>;
    securityDefinitions?: Record<string, { name?: string; in?: string }>;
  };
  assert.equal(specification.basePath, "/api");
  assert.equal(copilotSpecification.basePath, "/copilot-weather");
  assert.deepEqual(copilotSpecification.paths, specification.paths);
  assert.deepEqual(copilotSpecification.definitions, specification.definitions);
  assert.equal(copilotSpecification.securityDefinitions?.ApiManagementKey.name, "Ocp-Apim-Subscription-Key");
  assert.equal(copilotSpecification.securityDefinitions?.ApiManagementKey.in, "header");
});
