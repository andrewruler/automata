/**
 * =============================================================================
 * OPENAI RESPONSES API — one “thread” of structured JSON calls
 * =============================================================================
 *
 * The **Responses** API is OpenAI’s unified endpoint for multi-turn + tools + structured output.
 * Here we only use: `instructions` (system-like), `input` (user payload as JSON text),
 * and `text.format` = **json_schema** so the model must return JSON matching our schema.
 *
 * `store: true` + `previous_response_id` chains turns inside **one** `JsonThread` instance.
 * We use two instances in `agent.ts`: planner thread vs critic thread.
 */
import "dotenv/config";
import OpenAI from "openai";

/**
 * OpenAI’s TypeScript types require JSON Schema objects to be typed as string-keyed records,
 * not TypeScript’s bare `object` type (that’s why `llmAgent.ts` casts schemas when calling `.ask`).
 */
type JsonSchemaObject = Record<string, unknown>;

/** Arguments for a single structured completion. */
type AskArgs = {
  /** Logical name for this schema in the API (logging / debugging). */
  schemaName: string;
  /** JSON Schema describing the exact JSON object shape we expect back. */
  schema: JsonSchemaObject;
  /** High-level system instructions for this call (planner vs critic, etc.). */
  instructions: string;
  /**
   * Arbitrary JSON-serializable payload; we `JSON.stringify` it and send as the user “input”.
   * The model sees task + observation + history in one blob.
   */
  payload: unknown;
};

/**
 * Thin wrapper around `client.responses.create` with automatic thread chaining.
 *
 * Construct **one** `JsonThread` per logical conversation (planner or critic).
 * Each `.ask()` adds another turn linked via `previous_response_id`.
 */
export class JsonThread {
  private client: OpenAI;
  private model: string;
  /** Set after the first successful response; links the next request to this chain. */
  private previousResponseId?: string;

  /**
   * Reads `OPENAI_API_KEY` and `OPENAI_MODEL` from the environment.
   *
   * @throws If `OPENAI_API_KEY` is missing.
   */
  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("Missing OPENAI_API_KEY (set it in .env or the environment)");
    }
    this.client = new OpenAI({ apiKey });
    this.model = process.env.OPENAI_MODEL ?? "gpt-5.4";
  }

  /**
   * Performs **one** model round-trip and parses the assistant output as JSON type `T`.
   *
   * Flow:
   *   1. POST to Responses API with strict JSON schema output.
   *   2. Save `response.id` as `previousResponseId` for the next call on this thread.
   *   3. Read `response.output_text` (SDK aggregates text parts) → `JSON.parse`.
   *
   * @typeParam T — Expected TypeScript shape (must match the JSON schema; trust but verify in app code).
   * @returns Parsed JSON object.
   * @throws On empty model output or network/API errors.
   */
  async ask<T>({ schemaName, schema, instructions, payload }: AskArgs): Promise<T> {
    const response = await this.client.responses.create({
      model: this.model,
      store: true,
      previous_response_id: this.previousResponseId,
      instructions,
      input: JSON.stringify(payload),
      text: {
        format: {
          type: "json_schema",
          name: schemaName,
          strict: true,
          schema,
        },
      },
    });

    this.previousResponseId = response.id;

    const raw = response.output_text?.trim();
    if (!raw) {
      throw new Error("LLM returned empty output_text");
    }

    return JSON.parse(raw) as T;
  }
}
