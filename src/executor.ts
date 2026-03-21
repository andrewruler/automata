/**
 * =============================================================================
 * ACTION EXECUTION — trusted bridge from LLM JSON to Playwright
 * =============================================================================
 *
 * The model only **describes** what to do (`PlannedAction`). This file is the only place
 * that actually calls `page.goto`, `click`, etc. That separation keeps credentials and
 * navigation policy under your control (`guardrails`, `task.credentials`).
 *
 * Called once per loop iteration from `agent.ts` **unless** the planner returned `done`.
 */
import { Page } from "playwright";
import { PlannedAction, AgentTask } from "./types.js";
import { Logger } from "./logger.js";
import { ensureAllowedUrl } from "./guardrails.js";

/**
 * Executes one `PlannedAction` on the given Playwright `Page`.
 *
 * Order of operations (typical case):
 *   1. Switch on `action.actionType` and run the matching Playwright API.
 *   2. After navigation-like actions, `settle` waits briefly for SPA updates.
 *   3. Re-run `ensureAllowedUrl` on the **current** URL (catch unexpected redirects off-domain).
 *   4. Save a full-page PNG under the run directory and return its path.
 *
 * Special case: `done` returns immediately **without** a screenshot (nothing to “do” in the page).
 *
 * @param page — Tab to automate.
 * @param task — Supplies `allowedDomains` and `credentials` for fills.
 * @param action — One planner output (already validated by `validateAction`).
 * @param logger — For console + disk log lines and screenshot path generation.
 * @returns Human-readable result string for the critic, optional screenshot path.
 */
export async function executeAction(
  page: Page,
  task: AgentTask,
  action: PlannedAction,
  logger: Logger
): Promise<{ message: string; screenshot?: string }> {
  switch (action.actionType) {
    case "goto": {
      ensureAllowedUrl(action.url!, task.allowedDomains);
      logger.log(`goto: ${action.url} (${action.reason})`);
      await page.goto(action.url!, { waitUntil: "domcontentloaded", timeout: 30000 });
      break;
    }

    case "click": {
      logger.log(`click: ${action.selector} (${action.reason})`);
      await page.locator(action.selector!).first().click({ timeout: 12000 });
      await settle(page);
      break;
    }

    case "fill": {
      const value =
        action.credentialKey != null
          ? task.credentials?.[action.credentialKey] ?? ""
          : action.text ?? "";

      logger.log(
        `fill: ${action.selector} using ${
          action.credentialKey ? `credential:${action.credentialKey}` : "literal text"
        } (${action.reason})`
      );

      if (!value) {
        throw new Error("Resolved fill value is empty");
      }

      await page.locator(action.selector!).first().fill(value, { timeout: 12000 });
      break;
    }

    case "press": {
      logger.log(`press: ${action.key} on ${action.selector} (${action.reason})`);
      await page.locator(action.selector!).first().press(action.key!, { timeout: 12000 });
      await settle(page);
      break;
    }

    case "wait": {
      logger.log(`wait: ${action.ms}ms (${action.reason})`);
      await page.waitForTimeout(action.ms!);
      break;
    }

    case "done": {
      logger.log(`done: ${action.doneMessage ?? action.reason}`);
      return { message: action.doneMessage ?? action.reason };
    }
  }

  ensureAllowedUrl(page.url(), task.allowedDomains);

  const screenshot = logger.screenshotPath(`step-${Date.now()}`);
  await page.screenshot({ path: screenshot, fullPage: true });
  logger.addScreenshot(screenshot);

  return {
    message: `Executed ${action.actionType} successfully`,
    screenshot,
  };
}

/**
 * Best-effort wait for the document to settle after a click/navigation.
 * Many SPAs update the DOM asynchronously; a fixed short delay reduces flaky “observe too early”.
 *
 * @param page — Current tab.
 */
async function settle(page: Page) {
  try {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
  } catch {
    // ignore
  }
  await page.waitForTimeout(800);
}
