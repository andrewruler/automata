/**
 * =============================================================================
 * AGENT ORCHESTRATION — the full “sense → think → act → review” loop
 * =============================================================================
 *
 * Called from `index.ts` via `runLLMAgentTask(task)`.
 *
 * One **iteration** (one value of `step`) does:
 *   (1) Observe page  →  (2) Planner LLM picks next action  →  (3) Execute with Playwright
 *   →  (4) Observe again  →  (5) Critic LLM judges outcome  →  (6) Record history
 *
 * The planner sees past steps through `history` and its own OpenAI thread (`JsonThread`).
 * The critic has a separate thread so its “conversation” doesn’t collide with planning.
 *
 * Stops when: planner says `done`, critic says `success` / `blocked` / `failed`,
 * or limits (`maxSteps`, `deadlineSeconds`) hit.
 */
import path from "node:path";
import { createBrowserSession } from "./chrome.js";
import { Logger } from "./logger.js";
import { JsonThread } from "./llm.js";
import { critiqueStep, planNextAction } from "./llmAgent.js";
import { executeAction } from "./executor.js";
import { AgentTask, ExecutionResult, StepRecord } from "./types.js";
import { ensureAllowedUrl } from "./guardrails.js";
import { buildObservationBundle } from "./observationBundle.js";

function classifyDoneMessage(message: string): boolean {
  const text = message.toLowerCase();
  const blockedSignals = [
    "blocked",
    "cannot",
    "can't",
    "unable",
    "missing",
    "requires",
    "requirement",
    "need ",
    "not provided",
    "captcha",
    "verification",
    "mfa",
    "2fa",
    "phone",
    "email verify",
  ];
  return !blockedSignals.some((signal) => text.includes(signal));
}

function needsFallbackVision(history: StepRecord[]): boolean {
  if (history.length === 0) return false;
  const last = history[history.length - 1];
  return last.result.startsWith("Execution error:");
}

function actionSignature(action: { actionType: string; selector?: string; url?: string }): string {
  return `${action.actionType}|${action.selector ?? ""}|${action.url ?? ""}`;
}

function isRepeatedFailingAction(history: StepRecord[], signature: string): boolean {
  const recent = history.slice(-6);
  const matchingFailures = recent.filter(
    (h) => actionSignature(h.action) === signature && h.result.startsWith("Execution error:")
  );
  return matchingFailures.length >= 2;
}

function isPressNoProgressLoop(history: StepRecord[]): boolean {
  const recent = history.slice(-4);
  if (recent.length < 3) return false;
  const pressOnly = recent.every((h) => h.action.actionType === "press");
  if (!pressOnly) return false;
  const lastUrl = recent[recent.length - 1].urlAfter;
  const sameUrl = recent.every((h) => h.urlAfter === lastUrl);
  return sameUrl;
}

/**
 * Runs a single browser automation “episode” for the given task.
 *
 * Steps inside this function:
 * 1. Create logger + planner/critic LLM threads.
 * 2. Open browser (`createBrowserSession`) — Chrome per `CHROME_*` env.
 * 3. Guard + navigate to `task.startUrl`.
 * 4. Loop: observe → plan → [maybe execute] → observe → critique → append history.
 * 5. `finally`: always `dispose()` the browser session (CDP disconnect vs full close).
 *
 * @param task — Goal, URLs, domain allowlist, timeouts, optional credential map.
 * @returns Summary for the user: success flag, step count, paths to screenshots, errors, optional auth state file.
 */
export async function runLLMAgentTask(task: AgentTask): Promise<ExecutionResult> {
  // --- Setup: logging and two independent LLM conversation chains ---
  const logger = new Logger(task.name);
  const planner = new JsonThread();
  const critic = new JsonThread();

  const deadline = Date.now() + task.deadlineSeconds * 1000;
  const session = await createBrowserSession();
  const { context, page, mode, dispose } = session;
  logger.log(`browser session: ${mode} (HEADLESS=${process.env.HEADLESS === "true"})`);

  /** Grows by one entry per executed step; fed back into `planNextAction` so the model sees what happened. */
  const history: StepRecord[] = [];

  try {
    // --- Phase: land on the starting URL (before the main loop) ---
    ensureAllowedUrl(task.startUrl, task.allowedDomains);
    await page.goto(task.startUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    // =================================================================
    // MAIN LOOP — each pass is one “agent step” (may include LLM + browser)
    // =================================================================
    for (let step = 1; step <= task.maxSteps && Date.now() < deadline; step++) {
      // --- (1) Perceive: structured text snapshot of the current DOM (with optional vision fallback) ---
      const forceVision = needsFallbackVision(history) && (process.env.VISION_MODE ?? "off").trim().toLowerCase() === "fallback";
      const before = await buildObservationBundle(page, logger, step, "before", forceVision);

      // --- (2) Decide: ask planner for exactly one JSON action ---
      const action = await planNextAction(planner, task, before, history);
      const signature = actionSignature(action);

      // --- Early exit: planner believes the mission is complete (no browser action this turn) ---
      if (action.actionType === "done") {
        const doneText = action.doneMessage ?? action.reason;
        const doneIsSuccess = classifyDoneMessage(doneText);
        if (!doneIsSuccess) {
          logger.log(`done classified as non-success: ${doneText}`);
        }
        const authStatePath = path.join(logger.dir, "storage-state.json");
        await context.storageState({ path: authStatePath });
        return {
          success: doneIsSuccess,
          stepsCompleted: step - 1,
          message: doneText,
          lastUrl: page.url(),
          screenshots: logger.screenshots,
          errors: logger.errors,
          authStatePath,
        };
      }

      // --- (3) Act: run Playwright; failures are caught so the critic can still run ---
      let execMessage = "";
      let screenshot: string | undefined;

      try {
        if (action.actionType === "press" && isPressNoProgressLoop(history)) {
          execMessage =
            "Execution error: skipping repeated no-progress press loop; choose click/fill on a specific control.";
          logger.error(execMessage);
        } else
        if (isRepeatedFailingAction(history, signature)) {
          execMessage =
            "Execution error: skipped repeated failing action; choose a different selector or strategy.";
          logger.error(execMessage);
        } else {
          const exec = await executeAction(page, task, action, logger);
          execMessage = exec.message;
          screenshot = exec.screenshot;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(msg);
        execMessage = `Execution error: ${msg}`;
      }

      // --- (4) Perceive again: see what changed after the action ---
      const afterForceVision =
        (process.env.VISION_MODE ?? "off").trim().toLowerCase() === "every" ||
        ((process.env.VISION_MODE ?? "off").trim().toLowerCase() === "fallback" && execMessage.startsWith("Execution error:"));
      const after = await buildObservationBundle(page, logger, step, "after", afterForceVision);

      // --- (5) Review: second LLM call scores the step ---
      const verdict = await critiqueStep(
        critic,
        task,
        before,
        action,
        execMessage,
        after,
        history
      );

      // --- (6) Remember: store this step for future planner turns ---
      history.push({
        step,
        observation: before.html,
        action,
        result: execMessage,
        screenshot,
        urlAfter: after.html.url,
        criticStatus: verdict.status,
        criticSummary: verdict.summary,
      });

      logger.log(
        `step ${step}: ${action.actionType} -> ${verdict.status} | ${verdict.summary}`
      );

      // --- Stop on critic declaring overall success (e.g. goal met on screen) ---
      if (verdict.status === "success") {
        const authStatePath = path.join(logger.dir, "storage-state.json");
        await context.storageState({ path: authStatePath });
        return {
          success: true,
          stepsCompleted: step,
          message: verdict.summary,
          lastUrl: page.url(),
          screenshots: logger.screenshots,
          errors: logger.errors,
          authStatePath,
        };
      }

      // --- Stop on hard failure modes (CAPTCHA, etc.) ---
      if (verdict.status === "blocked" || verdict.status === "failed") {
        return {
          success: false,
          stepsCompleted: step,
          message: verdict.summary,
          lastUrl: page.url(),
          screenshots: logger.screenshots,
          errors: logger.errors,
        };
      }

      // --- `continue`: loop again with updated `history` ---
    }

    // --- Ran out of steps or time without explicit success/stop from critic ---
    return {
      success: false,
      stepsCompleted: history.length,
      message: "Stopped: deadline or maxSteps reached",
      lastUrl: page.url(),
      screenshots: logger.screenshots,
      errors: logger.errors,
    };
  } finally {
    // Always release Playwright resources (behavior depends on CDP vs launch — see `chrome.ts`).
    await dispose();
  }
}
