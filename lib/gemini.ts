import "server-only";
import { ApiError, GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { env } from "./env";

let ai: GoogleGenAI | null = null;
const client = () => (ai ??= new GoogleGenAI({ apiKey: env.geminiApiKey() }));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isRetryable(err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 429 || err.status >= 500;
  const msg = String((err as Error)?.message ?? err);
  return /429|RESOURCE_EXHAUSTED|UNAVAILABLE|overloaded|ECONNRESET|fetch failed/i.test(msg);
}

/** One model call with exponential backoff on rate limits / transient errors. */
async function generate(prompt: string, jsonSchema: unknown): Promise<string> {
  const maxAttempts = 6;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await client().models.generateContent({
        model: env.geminiModel(),
        contents: prompt,
        config: {
          temperature: 0,
          responseMimeType: "application/json",
          responseJsonSchema: jsonSchema,
        },
      });
      return res.text ?? "";
    } catch (err) {
      if (attempt >= maxAttempts || !isRetryable(err)) throw err;
      const delay = Math.min(30_000, 1000 * 2 ** (attempt - 1)) + Math.random() * 500;
      console.warn(`[gemini] retryable error (attempt ${attempt}), backing off ${Math.round(delay)}ms:`, (err as Error).message);
      await sleep(delay);
    }
  }
}

/**
 * Asks for JSON matching `schema`. Validates with zod; on invalid JSON retries once
 * with the validation error appended, then throws.
 */
export async function generateJson<T>(prompt: string, schema: z.ZodType<T>, check?: (v: T) => string | null): Promise<T> {
  const jsonSchema = z.toJSONSchema(schema, { target: "draft-2020-12" });
  let lastError = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const p = attempt === 1 ? prompt : `${prompt}\n\nYour previous reply was invalid: ${lastError}\nReply again with ONLY valid JSON matching the schema.`;
    const raw = await generate(p, jsonSchema);
    try {
      const parsed = schema.parse(JSON.parse(stripFences(raw)));
      const problem = check?.(parsed);
      if (problem) throw new Error(problem);
      return parsed;
    } catch (err) {
      lastError = err instanceof z.ZodError ? z.prettifyError(err) : (err as Error).message;
      console.warn(`[gemini] invalid JSON (attempt ${attempt}): ${lastError}`);
    }
  }
  throw new Error(`Model returned invalid JSON twice: ${lastError}`);
}

function stripFences(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
}
