import "./style.css";

type Action = "weather" | "locations" | "forecast" | "running-assessment";
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
type CityLocation = {
  name: string;
  admin1: string;
  country: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  timezone: string;
};
type SavedLocation = Pick<CityLocation, "name" | "admin1" | "country" | "countryCode">;
type DailyForecast = {
  city: string;
  country: string;
  date: string;
  minimumTemperatureC: number;
  maximumTemperatureC: number;
  precipitationMm: number;
  maximumWindSpeedKmh: number;
  condition: string;
};
type RunningAssessment = {
  activity: "running";
  recommendation: "recommended" | "not_recommended";
  city: string;
  country: string;
  date: string;
  reasons: string[];
  thresholds: {
    minimumTemperatureC: number;
    maximumTemperatureC: number;
    maximumPrecipitationMm: number;
    maximumWindSpeedKmh: number;
  };
  forecast: DailyForecast;
  disclaimer: string;
};

const form = document.querySelector<HTMLFormElement>("#weather-form")!;
const cityInput = document.querySelector<HTMLInputElement>("#city")!;
const countryInput = document.querySelector<HTMLInputElement>("#country")!;
const admin1Input = document.querySelector<HTMLInputElement>("#admin1")!;
const dateInput = document.querySelector<HTMLInputElement>("#date")!;
const status = document.querySelector<HTMLElement>("#status")!;
const result = document.querySelector<HTMLElement>("#result")!;
const apiBaseUrl = import.meta.env.VITE_WEATHER_API_BASE_URL || "/api";
const savedLocationKey = "weather-plans.selected-location";

dateInput.value = localDate(1);
dateInput.min = localDate(0);
dateInput.max = localDate(6);

const savedLocation = readSavedLocation();
if (savedLocation) {
  cityInput.value = savedLocation.name;
  countryInput.value = savedLocation.countryCode || savedLocation.country;
  admin1Input.value = savedLocation.admin1;
  status.textContent = `${placeName(savedLocation.name, savedLocation.country)} selected. Choose a forecast action.`;
}

cityInput.addEventListener("input", () => {
  countryInput.value = "";
  admin1Input.value = "";
  localStorage.removeItem(savedLocationKey);
  status.textContent = "City changed. Search for matching places to select one.";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitter = event.submitter;
  const action = submitter instanceof HTMLButtonElement && isAction(submitter.value)
    ? submitter.value
    : "running-assessment";
  const city = cityInput.value.trim();
  status.textContent = "Checking the weather service…";
  result.hidden = true;

  try {
    const url = new URL(`${apiBaseUrl.replace(/\/$/, "")}/${action}`, window.location.origin);
    if (action === "locations") {
      url.searchParams.set("query", city);
    } else {
      url.searchParams.set("city", city);
      if (countryInput.value) url.searchParams.set("country", countryInput.value);
      if (admin1Input.value) url.searchParams.set("admin1", admin1Input.value);
      if (action !== "weather") url.searchParams.set("date", dateInput.value);
    }

    const response = await fetch(url);
    const payload: unknown = await response.json();
    if (!response.ok) {
      const message = isRecord(payload) && typeof payload.message === "string"
        ? payload.message
        : "The weather request failed.";
      status.textContent = message;
      if (isRecord(payload) && isLocationList(payload.details)) renderLocations(payload.details.locations);
      return;
    }

    status.textContent = "";
    if (action === "locations" && isLocationList(payload)) {
      renderLocations(payload.locations);
    } else if (action === "weather" && isWeather(payload)) {
      renderCurrentWeather(payload);
    } else if (action === "forecast" && isDailyForecast(payload)) {
      renderForecast(payload);
    } else if (action === "running-assessment" && isRunningAssessment(payload)) {
      renderRunningAssessment(payload);
    } else {
      throw new Error("The weather service returned an unexpected response.");
    }
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "The weather request failed.";
  }
});

function localDate(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isAction(value: string): value is Action {
  return value === "weather" || value === "locations" || value === "forecast" || value === "running-assessment";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isWeather(value: unknown): value is Weather {
  if (!isRecord(value)) return false;
  return typeof value.city === "string"
    && typeof value.country === "string"
    && typeof value.temperatureC === "number"
    && typeof value.feelsLikeC === "number"
    && typeof value.relativeHumidityPercent === "number"
    && typeof value.precipitationMm === "number"
    && typeof value.windSpeedKmh === "number"
    && typeof value.condition === "string"
    && typeof value.observedAt === "string"
    && typeof value.isDay === "boolean";
}

function isCityLocation(value: unknown): value is CityLocation {
  if (!isRecord(value)) return false;
  return typeof value.name === "string"
    && typeof value.admin1 === "string"
    && typeof value.country === "string"
    && typeof value.countryCode === "string"
    && typeof value.latitude === "number"
    && typeof value.longitude === "number"
    && typeof value.timezone === "string";
}

function isSavedLocation(value: unknown): value is SavedLocation {
  return isRecord(value)
    && typeof value.name === "string"
    && typeof value.admin1 === "string"
    && typeof value.country === "string"
    && typeof value.countryCode === "string";
}

function readSavedLocation(): SavedLocation | null {
  const serialized = localStorage.getItem(savedLocationKey);
  if (!serialized) return null;

  try {
    const value: unknown = JSON.parse(serialized);
    if (isSavedLocation(value)) return value;
  } catch (error) {
    console.warn("Ignoring invalid saved city selection.", error);
  }
  localStorage.removeItem(savedLocationKey);
  return null;
}

function isLocationList(value: unknown): value is { locations: CityLocation[] } {
  return isRecord(value) && Array.isArray(value.locations) && value.locations.every(isCityLocation);
}

function isDailyForecast(value: unknown): value is DailyForecast {
  if (!isRecord(value)) return false;
  return typeof value.city === "string"
    && typeof value.country === "string"
    && typeof value.date === "string"
    && typeof value.minimumTemperatureC === "number"
    && typeof value.maximumTemperatureC === "number"
    && typeof value.precipitationMm === "number"
    && typeof value.maximumWindSpeedKmh === "number"
    && typeof value.condition === "string";
}

function isRunningAssessment(value: unknown): value is RunningAssessment {
  return isRecord(value)
    && value.activity === "running"
    && (value.recommendation === "recommended" || value.recommendation === "not_recommended")
    && typeof value.city === "string"
    && typeof value.country === "string"
    && typeof value.date === "string"
    && Array.isArray(value.reasons)
    && value.reasons.every((reason) => typeof reason === "string")
    && isRecord(value.thresholds)
    && isDailyForecast(value.forecast)
    && typeof value.disclaimer === "string";
}

function heading(text: string): HTMLHeadingElement {
  const element = document.createElement("h2");
  element.textContent = text;
  return element;
}

function textElement(tag: "p" | "span" | "li" | "strong", className: string, text: string): HTMLElement {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

function placeName(city: string, country: string): string {
  return [city, country].filter(Boolean).join(", ");
}

function fact(label: string, value: string): HTMLDivElement {
  const item = document.createElement("div");
  item.className = "fact";
  item.append(textElement("span", "", label), textElement("strong", "", value));
  return item;
}

function detailsGrid(items: Array<[string, string]>): HTMLDivElement {
  const details = document.createElement("div");
  details.className = "details";
  for (const [label, value] of items) details.append(fact(label, value));
  return details;
}

function showCard(...children: Node[]): void {
  result.replaceChildren(...children);
  result.hidden = false;
}

function renderCurrentWeather(weather: Weather): void {
  showCard(
    textElement("p", "place", placeName(weather.city, weather.country)),
    textElement("p", "temperature", `${Math.round(weather.temperatureC)}°`),
    textElement("p", "condition", weather.condition),
    detailsGrid([
      ["Feels like", `${Math.round(weather.feelsLikeC)}°C`],
      ["Humidity", `${weather.relativeHumidityPercent}%`],
      ["Wind", `${weather.windSpeedKmh} km/h`],
      ["Precipitation", `${weather.precipitationMm} mm`],
    ]),
    textElement("p", "observation", `Local time: ${weather.observedAt.replace("T", " ")} · ${weather.isDay ? "Daytime" : "Nighttime"}`),
  );
}

function renderForecast(forecast: DailyForecast): void {
  showCard(
    textElement("p", "place", placeName(forecast.city, forecast.country)),
    heading(`Forecast for ${forecast.date}`),
    textElement("p", "condition", forecast.condition),
    detailsGrid([
      ["Low", `${forecast.minimumTemperatureC}°C`],
      ["High", `${forecast.maximumTemperatureC}°C`],
      ["Precipitation", `${forecast.precipitationMm} mm`],
      ["Max wind", `${forecast.maximumWindSpeedKmh} km/h`],
    ]),
  );
}

function renderRunningAssessment(assessment: RunningAssessment): void {
  const recommendation = textElement(
    "p",
    `recommendation ${assessment.recommendation}`,
    assessment.recommendation === "recommended" ? "Running looks reasonable" : "Conditions are outside the demo criteria",
  );
  const reasons = document.createElement("ul");
  reasons.className = "reasons";
  const reasonItems = assessment.reasons.length > 0
    ? assessment.reasons
    : ["All forecast values are within the demo thresholds."];
  for (const reason of reasonItems) reasons.append(textElement("li", "", reason));
  const thresholds = assessment.thresholds;

  showCard(
    textElement("p", "place", `${placeName(assessment.city, assessment.country)} · ${assessment.date}`),
    recommendation,
    heading("Forecast"),
    textElement("p", "condition", assessment.forecast.condition),
    detailsGrid([
      ["Low / high", `${assessment.forecast.minimumTemperatureC}° / ${assessment.forecast.maximumTemperatureC}°C`],
      ["Precipitation", `${assessment.forecast.precipitationMm} mm`],
      ["Max wind", `${assessment.forecast.maximumWindSpeedKmh} km/h`],
    ]),
    heading("Why"),
    reasons,
    textElement(
      "p",
      "observation",
      `Demo limits: ${thresholds.minimumTemperatureC}–${thresholds.maximumTemperatureC}°C, up to ${thresholds.maximumPrecipitationMm} mm rain, wind up to ${thresholds.maximumWindSpeedKmh} km/h.`,
    ),
    textElement("p", "disclaimer", assessment.disclaimer),
  );
}

function renderLocations(locations: CityLocation[]): void {
  const list = document.createElement("div");
  list.className = "locations";
  if (locations.length === 0) {
    showCard(heading("No matching places"), textElement("p", "place", "Try another spelling or a longer city name."));
    return;
  }

  for (const location of locations) {
    const item = document.createElement("div");
    item.className = "location";
    const name = document.createElement("div");
    name.append(
      textElement("strong", "", location.name),
      textElement("span", "", [location.admin1, location.country].filter(Boolean).join(", ")),
    );
    const select = document.createElement("button");
    select.type = "button";
    select.className = "select-location";
    select.textContent = "Use this place";
    select.addEventListener("click", () => {
      const selectedLocation: SavedLocation = {
        name: location.name,
        admin1: location.admin1,
        country: location.country,
        countryCode: location.countryCode,
      };
      cityInput.value = location.name;
      countryInput.value = location.countryCode || location.country;
      admin1Input.value = location.admin1;
      localStorage.setItem(savedLocationKey, JSON.stringify(selectedLocation));
      status.textContent = `${placeName(location.name, location.country)} selected. Choose a forecast action.`;
      result.hidden = true;
    });
    item.append(name, select);
    list.append(item);
  }
  showCard(heading("Choose a matching place"), list);
}
