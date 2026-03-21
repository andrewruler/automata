import path from "node:path";
import { chromium } from "playwright";
import { Logger } from "./logger.js";
import { observePage } from "./observer.js";
import { JsonThread } from "./llm.js";
import { critiqueStep, planNextAction } from "./llmAgent.js";
import { executeAction } from "./executor.js";
import { AgentTask, ExecutionResult, StepRecord } from "./types.js";
import { ensureAllowedUrl } from "./guardrails.js";

export async function runLLMAgentTask(task: AgentTask): Promise<ExecutionResult> {
  const logger = new Logger(task.name);
  const planner = new JsonThread();
  const critic = new JsonThread();

  const deadline = Date.now() + task.deadlineSeconds * 1000;
  const browser = await chromium.launch({
    headless: process.env.HEADLESS === "true",
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });

  const page = await context.newPage();
  const history: StepRecord[] = [];

  try {
    ensureAllowedUrl(task.startUrl, task.allowedDomains);
    await page.goto(task.startUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    for (let step = 1; step <= task.maxSteps && Date.now() < deadline; step++) {
      const before = await observePage(page);

      const action = await planNextAction(planner, task, before, history);

      if (action.actionType === "done") {
        const authStatePath = path.join(logger.dir, "storage-state.json");
        await context.storageState({ path: authStatePath });
        return {
          success: true,
          stepsCompleted: step - 1,
          message: action.doneMessage ?? action.reason,
          lastUrl: page.url(),
          screenshots: logger.screenshots,
          errors: logger.errors,
          authStatePath,
        };
      }

      let execMessage = "";
      let screenshot: string | undefined;

      try {
        const exec = await executeAction(page, task, action, logger);
        execMessage = exec.message;
        screenshot = exec.screenshot;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(msg);
        execMessage = `Execution error: ${msg}`;
      }

      const after = await observePage(page);

      const verdict = await critiqueStep(
        critic,
        task,
        before,
        action,
        execMessage,
        after,
        history
      );

      history.push({
        step,
        observation: before,
        action,
        result: execMessage,
        screenshot,
        urlAfter: after.url,
        criticStatus: verdict.status,
        criticSummary: verdict.summary,
      });

      logger.log(
        `step ${step}: ${action.actionType} -> ${verdict.status} | ${verdict.summary}`
      );

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
    }

    return {
      success: false,
      stepsCompleted: history.length,
      message: "Stopped: deadline or maxSteps reached",
      lastUrl: page.url(),
      screenshots: logger.screenshots,
      errors: logger.errors,
    };
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
