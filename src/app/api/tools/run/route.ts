import { NextResponse } from "next/server";
import { z } from "zod";

import { TOOL_DEFINITIONS } from "@/config/tools";
import type { ToolName } from "@/config/tools";
import { executeTool } from "@/server/tools/execute-tool";

const requestSchema = z.object({
  toolName: z
    .string()
    .refine(
      (value): value is ToolName =>
        TOOL_DEFINITIONS.some((tool) => tool.name === value),
      "Unknown tool name",
    ),
  arguments: z.unknown().optional(),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = requestSchema.parse(body);
    const toolName = parsed.toolName as ToolName;
    const args = parsed.arguments;

    const result = await executeTool(toolName, args);
    return NextResponse.json(
      {
        success: true,
        result,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Tool execution failed", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to execute the requested tool",
      },
      { status: 400 },
    );
  }
}
