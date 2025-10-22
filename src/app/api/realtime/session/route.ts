import { NextResponse } from "next/server";

import { DEFAULT_AGENT_INSTRUCTIONS } from "@/config/agent";
import { TOOL_DEFINITIONS } from "@/config/tools";
import { env } from "@/lib/env";

const OPENAI_REALTIME_URL = "https://api.openai.com/v1/realtime/sessions";

export async function POST() {
  const transcriptionModel =
    env.OPENAI_TRANSCRIPTION_MODEL ?? "gpt-4o-mini-transcribe";

  const requestBody: Record<string, unknown> = {
    model: env.OPENAI_REALTIME_MODEL,
    voice: "verse",
    modalities: ["text", "audio"],
    instructions: DEFAULT_AGENT_INSTRUCTIONS.trim(),
    tools: TOOL_DEFINITIONS,
    tool_choice: "auto",
  };

  if (transcriptionModel) {
    requestBody.input_audio_transcription = { model: transcriptionModel };
  }

  const response = await fetch(OPENAI_REALTIME_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.OPENAI_REALTIME_MODEL,
      // The voice is configurable via the OPENAI_REALTIME_VOICE environment variable for flexibility.
      // Defaults to "verse" if not set.
      voice: process.env.OPENAI_REALTIME_VOICE || "verse",
      modalities: ["text", "audio"],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("Failed to create OpenAI realtime session", errorBody);
    return NextResponse.json(
      { error: "Failed to create OpenAI realtime session" },
      { status: 500 },
    );
  }

  const session = await response.json();
  return NextResponse.json(session);
}

export const dynamic = "force-dynamic";
