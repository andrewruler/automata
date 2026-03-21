import { Page } from "playwright";
import { PlannedAction, AgentTask } from "./types.js";
import { Logger } from "./logger.js";
import { ensureAllowedUrl } from "./guardrails.js";

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

async function settle(page: Page) {
  try {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
  } catch {
    // ignore
  }
  await page.waitForTimeout(800);
}
