export const TOOL_DEFINITIONS = [
  {
    type: "function",
    name: "get_weather_forecast",
    description:
      "Get the current weather and a short forecast for a city. Prioritize major global locations.",
    parameters: {
      type: "object",
      properties: {
        location: {
          type: "string",
          description:
            "Human readable location name such as 'San Francisco, CA' or 'Tokyo, Japan'.",
        },
      },
      required: ["location"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_current_time",
    description:
      "Return the current time in ISO 8601 format. Helpful when the user asks about the time or scheduling.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
] as const;

export type ToolName = (typeof TOOL_DEFINITIONS)[number]["name"];
