import { app, type HttpRequest, type InvocationContext, type HttpResponseInit } from "@azure/functions";
import {
  FORECAST_ROUTE,
  LOCATIONS_ROUTE,
  RUNNING_ASSESSMENT_ROUTE,
  WEATHER_ROUTE,
  WeatherError,
} from "../domain/weather.js";
import { assessRunning, getDailyForecast, getWeather, searchLocations } from "../services/openMeteo.js";

async function handleRequest(
  context: InvocationContext,
  operation: () => Promise<unknown>,
): Promise<HttpResponseInit> {
  try {
    return { jsonBody: await operation() };
  } catch (error) {
    if (error instanceof WeatherError) {
      return {
        status: error.status,
        jsonBody: {
          error: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      };
    }
    context.error("Unexpected error while processing weather request.", error);
    return {
      status: 500,
      jsonBody: { error: "internal_error", message: "The weather request could not be completed." },
    };
  }
}

export function weatherHandler(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  return handleRequest(context, () => getWeather(
    request.query.get("city"),
    fetch,
    request.query.get("country"),
    request.query.get("admin1"),
  ));
}

export function locationsHandler(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  return handleRequest(context, async () => ({
    locations: await searchLocations(request.query.get("query")),
  }));
}

export function forecastHandler(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  return handleRequest(context, () => getDailyForecast(
    request.query.get("city"),
    request.query.get("date"),
    fetch,
    request.query.get("country"),
    request.query.get("admin1"),
  ));
}

export function runningAssessmentHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  return handleRequest(context, () => assessRunning(
    request.query.get("city"),
    request.query.get("date"),
    fetch,
    request.query.get("country"),
    request.query.get("admin1"),
  ));
}

app.http("weather", {
  methods: ["GET"],
  authLevel: "function",
  route: WEATHER_ROUTE,
  handler: weatherHandler,
});

app.http("locations", {
  methods: ["GET"],
  authLevel: "function",
  route: LOCATIONS_ROUTE,
  handler: locationsHandler,
});

app.http("forecast", {
  methods: ["GET"],
  authLevel: "function",
  route: FORECAST_ROUTE,
  handler: forecastHandler,
});

app.http("runningAssessment", {
  methods: ["GET"],
  authLevel: "function",
  route: RUNNING_ASSESSMENT_ROUTE,
  handler: runningAssessmentHandler,
});
