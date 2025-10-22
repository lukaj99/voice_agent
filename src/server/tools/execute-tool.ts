import { z } from "zod";

import type { ToolName } from "@/config/tools";

type ToolExecutionResult = {
  content: string;
  data?: Record<string, unknown>;
};

const weatherArgumentsSchema = z.object({
  location: z.string().min(1),
});

const weatherConditionSchema = z
  .object({
    weatherDesc: z.array(z.object({ value: z.string() })).optional(),
    temp_C: z.string().optional(),
    temp_c: z.string().optional(),
    tempC: z.string().optional(),
    FeelsLikeC: z.string().optional(),
    feelsLikeC: z.string().optional(),
    FeelsLike_C: z.string().optional(),
    humidity: z.string().optional(),
  })
  .passthrough();

const hourlySnapshotSchema = z
  .object({
    tempC: z.string().optional(),
    temp_c: z.string().optional(),
  })
  .passthrough();

const daySchema = z
  .object({
    hourly: z.array(hourlySnapshotSchema).optional(),
  })
  .passthrough();

const nearestAreaSchema = z
  .object({
    areaName: z
      .array(z.object({ value: z.string().optional() }).passthrough())
      .optional(),
  })
  .passthrough();

const weatherResponseSchema = z.object({
  current_condition: z.array(weatherConditionSchema).optional(),
  weather: z.array(daySchema).optional(),
  nearest_area: z.array(nearestAreaSchema).optional(),
});

async function runWeatherTool(
  args: unknown,
): Promise<ToolExecutionResult> {
  const { location } = weatherArgumentsSchema.parse(args);

  const endpoint = `https://wttr.in/${encodeURIComponent(location)}?format=j1`;
  const response = await fetch(endpoint, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(
      `Weather API request failed with status ${response.status}`,
    );
  }

  const payload = weatherResponseSchema.parse(await response.json());
  const current = payload.current_condition?.[0];
  const today = payload.weather?.[0];

  if (!current) {
    throw new Error("Weather API returned an unexpected payload");
  }

  const description = current.weatherDesc?.[0]?.value ?? "Unknown";

  const tempC = current.temp_C ?? current.temp_c ?? current.tempC;
  const feelsLikeC =
    current.FeelsLikeC ?? current.feelsLikeC ?? current.FeelsLike_C;

  const summaryParts = [
    `Currently ${description.toLowerCase()} and ${tempC ?? "?"}°C`,
    feelsLikeC ? `feels like ${feelsLikeC}°C` : null,
  ].filter(Boolean);

  let forecastSnippet: string | null = null;
  if (today?.hourly?.length) {
    const morning = today.hourly[2];
    const afternoon = today.hourly[4];
    const evening = today.hourly[7];
    const snippets = [
      morning
        ? `Morning: ${morning.tempC ?? morning.temp_c ?? "?"}°C`
        : null,
      afternoon
        ? `Afternoon: ${afternoon.tempC ?? afternoon.temp_c ?? "?"}°C`
        : null,
      evening
        ? `Evening: ${evening.tempC ?? evening.temp_c ?? "?"}°C`
        : null,
    ].filter(Boolean);
    if (snippets.length) {
      forecastSnippet = snippets.join(", ");
    }
  }

  const content = [
    `Weather for ${location}:`,
    summaryParts.join(", "),
    forecastSnippet ? `Forecast: ${forecastSnippet}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    content,
    data: {
      provider: "wttr.in",
      location: payload.nearest_area?.[0]?.areaName?.[0]?.value ?? location,
      description,
      temperatureC: tempC,
      feelsLikeC,
      humidity: current.humidity,
      forecast: today,
    },
  };
}

async function runTimeTool(): Promise<ToolExecutionResult> {
  const now = new Date();
  return {
    content: `Current time is ${now.toISOString()}`,
    data: {
      iso: now.toISOString(),
      locale: now.toLocaleString(),
    },
  };
}

export async function executeTool(
  toolName: ToolName,
  args: unknown,
): Promise<ToolExecutionResult> {
  switch (toolName) {
    case "get_weather_forecast":
      return runWeatherTool(args);
    case "get_current_time":
      return runTimeTool();
    default:
      throw new Error(`Unhandled tool: ${toolName}`);
  }
}
