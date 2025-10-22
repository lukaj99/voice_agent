import { NextResponse } from "next/server";

import { env } from "@/lib/env";

const OPENAI_REALTIME_URL = "https://api.openai.com/v1/realtime/sessions";

export async function POST() {
  const response = await fetch(OPENAI_REALTIME_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.OPENAI_REALTIME_MODEL,
      voice: "verse",
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
