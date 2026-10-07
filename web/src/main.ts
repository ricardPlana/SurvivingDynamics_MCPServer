import "./style.css";

type Weather = {
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

const form = document.querySelector<HTMLFormElement>("#weather-form")!;
const cityInput = document.querySelector<HTMLInputElement>("#city")!;
const status = document.querySelector<HTMLElement>("#status")!;
const result = document.querySelector<HTMLElement>("#result")!;
const apiBaseUrl = import.meta.env.VITE_WEATHER_API_BASE_URL || "/api";

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const city = cityInput.value.trim();
  status.textContent = "Looking up current conditions…";
  result.hidden = true;

  try {
    const url = new URL(`${apiBaseUrl.replace(/\/$/, "")}/weather`, window.location.origin);
    url.searchParams.set("city", city);
    const response = await fetch(url);
    const payload: unknown = await response.json();
    if (!response.ok) {
      const message = typeof payload === "object" && payload !== null && "message" in payload
        ? String(payload.message)
        : "The weather request failed.";
      throw new Error(message);
    }

    if (!isWeather(payload)) {
      throw new Error("The weather service returned an unexpected response.");
    }
    renderWeather(payload);
    status.textContent = "";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "The weather request failed.";
  }
});

function renderWeather(weather: Weather): void {
  const place = document.createElement("p");
  place.className = "place";
  place.textContent = [weather.city, weather.country].filter(Boolean).join(", ");

  const temperature = document.createElement("p");
  temperature.className = "temperature";
  temperature.textContent = `${Math.round(weather.temperatureC)}°`;

  const condition = document.createElement("p");
  condition.className = "condition";
  condition.textContent = weather.condition;

  const details = document.createElement("div");
  details.className = "details";
  const facts = [
    ["Feels like", `${Math.round(weather.feelsLikeC)}°C`],
    ["Humidity", `${weather.relativeHumidityPercent}%`],
    ["Wind", `${weather.windSpeedKmh} km/h`],
    ["Precipitation", `${weather.precipitationMm} mm`],
  ];
  for (const [label, value] of facts) {
    const item = document.createElement("div");
    const name = document.createElement("span");
    name.textContent = label;
    const reading = document.createElement("strong");
    reading.textContent = value;
    item.append(name, reading);
    details.append(item);
  }

  const observation = document.createElement("p");
  observation.className = "observation";
  observation.textContent = `Local time: ${weather.observedAt.replace("T", " ")} · ${weather.isDay ? "Daytime" : "Nighttime"}`;
  result.replaceChildren(place, temperature, condition, details, observation);
  result.hidden = false;
}

function isWeather(value: unknown): value is Weather {
  if (typeof value !== "object" || value === null) return false;
  const weather = value as Record<string, unknown>;
  return typeof weather.city === "string"
    && typeof weather.country === "string"
    && typeof weather.temperatureC === "number"
    && typeof weather.feelsLikeC === "number"
    && typeof weather.relativeHumidityPercent === "number"
    && typeof weather.precipitationMm === "number"
    && typeof weather.windSpeedKmh === "number"
    && typeof weather.condition === "string"
    && typeof weather.observedAt === "string"
    && typeof weather.isDay === "boolean";
}
