import "dotenv/config";
import OpenAI from "openai";

type AskArgs = {
  schemaName: string;
  schema: object;
  instructions: string;
  payload: unknown;
};

export class JsonThread {
  private client: OpenAI;
  private model: string;
  private previousResponseId?: string;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("Missing OPENAI_API_KEY (set it in .env or the environment)");
    }
    this.client = new OpenAI({ apiKey });
    this.model = process.env.OPENAI_MODEL ?? "gpt-5.4";
  }

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
