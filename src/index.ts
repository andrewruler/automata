/**
 * =============================================================================
 * ENTRYPOINT — where the process starts (npm run dev / node dist/index.js)
 * =============================================================================
 *
 * Flow from here:
 *   1. `import "dotenv/config"` runs first: loads variables from `.env` into `process.env`
 *      (so OPENAI_API_KEY, CHROME_*, DEMO_*, etc. exist before any other module reads them).
 *   2. We build a single `AgentTask` object (today: hardcoded demo; later: CLI / file — ROADMAP Phase B).
 *   3. `main()` calls `runLLMAgentTask(task)` in `agent.ts` — that opens Chrome and runs the full loop.
 *   4. We print the returned `ExecutionResult` as JSON; non-success sets exit code 1 for scripts/CI.
 *
 * Tip: read `docs/WORKFLOW.md` for the same story file-by-file.
 */
import "dotenv/config";
import { runLLMAgentTask } from "./agent.js";
import { AgentTask } from "./types.js";

/** Demo task: adjust startUrl / allowedDomains / goal for your real target. */
const task: AgentTask = {
  name: "api-signup-demo",
  goal: "Create an account for this browser application using the provided credentials and stop when the dashboard or a clear success message appears.",
  startUrl: "https://example.com",
  allowedDomains: ["example.com"],
  deadlineSeconds: 120,
  maxSteps: 20,
  credentials: {
    email: process.env.DEMO_EMAIL ?? "",
    password: process.env.DEMO_PASSWORD ?? "",
    fullName: process.env.DEMO_FULL_NAME ?? "",
  },
  successHints: [
    "dashboard visible",
    "account created",
    "welcome message",
    "api keys page",
    "logged in state",
  ],
};

/**
 * Runs the agent once and surfaces the outcome.
 *
 * @returns Promise<void> — always resolves unless an unhandled error escapes `runLLMAgentTask`.
 */
async function main() {
  const result = await runLLMAgentTask(task);
  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
