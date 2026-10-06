import { app, type HttpRequest, type InvocationContext, type HttpResponseInit } from "@azure/functions";
import { WEATHER_ROUTE, WeatherError } from "../domain/weather.js";
import { getWeather } from "../services/openMeteo.js";

export async function weatherHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const weather = await getWeather(request.query.get("city"));
    return { jsonBody: weather };
  } catch (error) {
    if (error instanceof WeatherError) {
      return {
        status: error.status,
        jsonBody: { error: error.code, message: error.message },
      };
    }
    context.error("Unexpected error while loading weather.", error);
    return {
      status: 500,
      jsonBody: { error: "internal_error", message: "Weather could not be loaded." },
    };
  }
}

app.http("weather", {
  methods: ["GET"],
  authLevel: "function",
  route: WEATHER_ROUTE,
  handler: weatherHandler,
});
