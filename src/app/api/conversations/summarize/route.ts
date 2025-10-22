import { NextResponse } from "next/server";
import { z } from "zod";

import { openai } from "@/lib/openai";

const messageSchema = z.object({
  role: z.enum(["user", "assistant", "tool", "system"]),
  content: z.string().min(1),
});

const requestSchema = z.object({
  messages: z.array(messageSchema).min(1),
});

const SYSTEM_PROMPT = `
You are an analyst summarizing a short human conversation with an AI voice assistant.
- Produce a concise bullet list (3 items or fewer).
- Highlight key user requests, tool lookups, and follow-up actions.
- If the transcript is very short, respond with "Conversation too brief to summarize.".
`.trim();

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { messages } = requestSchema.parse(body);

    const transcriptText = messages
      .map((message) => {
        const prefix = message.role === "assistant" ? "Assistant" : "User";
        return `${prefix}: ${message.content.trim()}`;
      })
      .join("\n");

    const summaryResponse = await openai.responses.create({
      model: "gpt-4o-mini",
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: SYSTEM_PROMPT }],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: transcriptText,
            },
          ],
        },
      ],
    });

    const summary = summaryResponse.output_text?.trim();

    if (!summary) {
      throw new Error("Summary response did not include text output");
    }

    return NextResponse.json(
      {
        success: true,
        summary,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Failed to summarize conversation", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to produce summary",
      },
      { status: 400 },
    );
  }
}
