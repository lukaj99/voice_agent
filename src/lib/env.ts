import { z } from "zod";

const envSchema = z.object({
  OPENAI_API_KEY: z
    .string()
    .min(1, "OPENAI_API_KEY is required on the server"),
  OPENAI_REALTIME_MODEL: z
    .string()
    .min(1)
    .default("gpt-4o-realtime-preview"),
  OPENAI_TRANSCRIPTION_MODEL: z
    .string()
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
});

const parsed = envSchema.safeParse({
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_REALTIME_MODEL: process.env.OPENAI_REALTIME_MODEL,
  OPENAI_TRANSCRIPTION_MODEL: process.env.OPENAI_TRANSCRIPTION_MODEL,
});

if (!parsed.success) {
  throw new Error(
    `Invalid environment variables: ${parsed.error.flatten().fieldErrors.OPENAI_API_KEY?.join(", ")}`
  );
}

export const env = parsed.data;
