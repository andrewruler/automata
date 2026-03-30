/**
 * =============================================================================
 * ENTRYPOINT — where the process starts (npm run dev / node dist/index.js)
 * =============================================================================
 *
 * Flow from here:
 *   1. `import "dotenv/config"` runs first: loads variables from `.env` into `process.env`
 *      (so OPENAI_API_KEY, CHROME_*, DEMO_*, etc. exist before any other module reads them).
 *   2. We parse a mission from CLI text (`npm start -- "..."`) + env guardrails,
 *      then convert it into one `AgentTask`.
 *   3. `main()` calls `runLLMAgentTask(task)` in `agent.ts` — that opens Chrome and runs the full loop.
 *   4. We print the returned `ExecutionResult` as JSON; non-success sets exit code 1 for scripts/CI.
 *
 * Tip: read `docs/WORKFLOW.md` for the same story file-by-file.
 */
import "dotenv/config";
import { runLLMAgentTask } from "./agent.js";
import { buildMission, missionToAgentTask } from "./mission.js";

const credentials = {
  email: process.env.DEMO_EMAIL ?? "",
  password: process.env.DEMO_PASSWORD ?? "",
  fullName: process.env.DEMO_FULL_NAME ?? "",
};

function readRawMission(): string {
  const cliGoal = process.argv.slice(2).join(" ").trim();
  if (cliGoal) return cliGoal;
  const envGoal = process.env.MISSION_GOAL?.trim();
  if (envGoal) return envGoal;
  return "Create an account for this browser application and stop when the dashboard or a clear success message appears.";
}

/**
 * Runs the agent once and surfaces the outcome.
 *
 * @returns Promise<void> — always resolves unless an unhandled error escapes `runLLMAgentTask`.
 */
async function main() {
  const mission = buildMission(readRawMission(), credentials);
  const task = missionToAgentTask(mission, credentials);

  console.log(
    JSON.stringify(
      {
        mission: {
          id: mission.id,
          rawGoal: mission.rawGoal,
          milestones: mission.milestones,
          allowedDomains: mission.allowedDomains,
          startUrl: mission.startUrl,
          deadlineSeconds: mission.deadlineSeconds,
          maxSteps: mission.maxSteps,
        },
      },
      null,
      2
    )
  );

  const result = await runLLMAgentTask(task);
  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
