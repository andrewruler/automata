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

const ACTION_TIMEOUT_MS = 5000;

async function tryGoogleSignupOptionSelect(page: Page, wantedText: string): Promise<boolean> {
  return await page.evaluate((wantedRaw) => {
    if (!location.hostname.includes("accounts.google.com")) return false;
    if (!location.pathname.includes("/lifecycle/steps/signup/birthdaygender")) return false;
    const wanted = wantedRaw.trim().toLowerCase();
    if (!wanted) return false;

    const openDropdown = (kind: "month" | "gender"): boolean => {
      const overlays = Array.from(document.querySelectorAll(".VfPpkd-aPP78e")).filter((el) => {
        if (!(el instanceof HTMLElement)) return false;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden";
      }) as HTMLElement[];
      if (overlays.length === 0) return false;

      // On this page, month is usually the first dropdown and gender the second.
      const idx = kind === "month" ? 0 : Math.min(1, overlays.length - 1);
      overlays[idx].click();
      return true;
    };

    if (wanted.includes("january") || wanted.includes("february") || wanted.includes("march")) {
      openDropdown("month");
    } else {
      openDropdown("gender");
    }

    const options = Array.from(document.querySelectorAll('li[role="option"], [role="option"]'));
    const match = options.find((el) => {
      const t = (el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      return t.includes(wanted);
    });
    if (!(match instanceof HTMLElement)) return false;
    match.click();
    return true;
  }, wantedText);
}

async function tryGoogleSignupOpenDropdown(page: Page, kind: "month" | "gender"): Promise<boolean> {
  return await page.evaluate((k) => {
    if (!location.hostname.includes("accounts.google.com")) return false;
    if (!location.pathname.includes("/lifecycle/steps/signup/birthdaygender")) return false;
    const overlays = Array.from(document.querySelectorAll(".VfPpkd-aPP78e")).filter((el) => {
      if (!(el instanceof HTMLElement)) return false;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden";
    }) as HTMLElement[];
    if (overlays.length === 0) return false;
    const idx = k === "month" ? 0 : Math.min(1, overlays.length - 1);
    overlays[idx].click();
    return true;
  }, kind);
}

async function clickWithFallbacks(page: Page, selector: string): Promise<string> {
  const selectorLower = selector.trim().toLowerCase();

  // Prefer field-aware handling on Google signup before generic click paths.
  if (selectorLower.includes("text=gender") || selectorLower.includes("please select your gender")) {
    const opened = await tryGoogleSignupOpenDropdown(page, "gender");
    if (opened) return "click:google-open-gender";
  }
  if (selectorLower.includes("text=month")) {
    const opened = await tryGoogleSignupOpenDropdown(page, "month");
    if (opened) return "click:google-open-month";
  }
  if (selectorLower.startsWith("text=")) {
    const wanted = selector.slice(5).trim().replace(/^["']|["']$/g, "");
    const googleOptionSelected = await tryGoogleSignupOptionSelect(page, wanted);
    if (googleOptionSelected) return "click:google-option-select";
  }

  const target = page.locator(selector).first();

  try {
    await target.click({ timeout: ACTION_TIMEOUT_MS });
    return "click:normal";
  } catch {
    // continue to fallback chain
  }

  try {
    await target.click({ timeout: ACTION_TIMEOUT_MS, force: true });
    return "click:force";
  } catch {
    // continue
  }

  const jsClicked = await target.evaluate((el) => {
    const isHtml = (n: Element | null): n is HTMLElement => !!n && n instanceof HTMLElement;
    const nearestActionable = (start: Element | null): HTMLElement | null => {
      let node: Element | null = start;
      while (node) {
        if (
          node.matches(
            'li[role="option"], [role="option"], button, a, [role="button"], .VfPpkd-aPP78e, [aria-haspopup="listbox"]'
          )
        ) {
          return isHtml(node) ? node : null;
        }
        node = node.parentElement;
      }
      return null;
    };

    const rect = isHtml(el) ? el.getBoundingClientRect() : null;
    const fromPoint =
      rect && rect.width > 0 && rect.height > 0
        ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
        : null;

    const candidate = nearestActionable(fromPoint) ?? nearestActionable(el);
    if (!candidate) return false;

    candidate.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    candidate.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    candidate.click();
    return true;
  });

  if (jsClicked) return "click:js-fallback";

  // Dropdown-heavy UIs (e.g. Google) often require clicking the option container
  // or the visible overlay rather than the label/text span.
  const optionContainerClicked = await page.evaluate((rawSelector) => {
    const selector = rawSelector.trim();
    const textPrefix = "text=";
    if (!selector.toLowerCase().startsWith(textPrefix)) return false;
    const wanted = selector.slice(textPrefix.length).trim().replace(/^["']|["']$/g, "");
    if (!wanted) return false;

    const options = Array.from(document.querySelectorAll('li[role="option"], [role="option"]'));
    const match = options.find((el) => {
      const t = (el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      return t.includes(wanted.toLowerCase());
    });
    if (!(match instanceof HTMLElement)) return false;
    match.click();
    return true;
  }, selector);
  if (optionContainerClicked) return "click:option-container";

  const dropdownOverlayClicked = await page.evaluate((rawSelector) => {
    const selector = rawSelector.toLowerCase();
    const isLikelyDropdownTarget =
      selector.includes("gender") ||
      selector.includes("month") ||
      selector.includes('input[type="text"]') ||
      selector.includes("role=\"option\"");
    if (!isLikelyDropdownTarget) return false;

    const overlays = Array.from(document.querySelectorAll(".VfPpkd-aPP78e")).filter((el) => {
      if (!(el instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return (
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        rect.width > 0 &&
        rect.height > 0
      );
    }) as HTMLElement[];

    if (overlays.length === 0) return false;
    overlays[overlays.length - 1].click();
    return true;
  }, selector);
  if (dropdownOverlayClicked) return "click:dropdown-overlay";

  throw new Error(`click failed after fallbacks for selector: ${selector}`);
}

function isOverGenericFillSelector(selector: string): boolean {
  const s = selector.replace(/\s+/g, "").toLowerCase();
  return (
    s === "input[type=\"text\"]" ||
    s === "input[type='text']" ||
    s === "input[type=text]" ||
    s === "input[type=\"text\"]:not([name])" ||
    s === "input[type='text']:not([name])" ||
    s === "input[type=text]:not([name])"
  );
}

async function fillWithFallbacks(page: Page, selector: string, value: string): Promise<string> {
  const target = page.locator(selector).first();

  try {
    await target.fill(value, { timeout: ACTION_TIMEOUT_MS });
    return "fill:normal";
  } catch {
    // continue
  }

  try {
    await target.click({ timeout: ACTION_TIMEOUT_MS, force: true });
    await target.fill(value, { timeout: ACTION_TIMEOUT_MS, force: true });
    return "fill:force";
  } catch {
    // continue
  }

  const jsFilled = await target.evaluate(
    (el, nextValue) => {
      if (!(el instanceof HTMLElement)) return false;

      const nearestControl = (start: Element | null): HTMLElement | null => {
        let node: Element | null = start;
        while (node) {
          if (
            node.matches(
              'input, textarea, [contenteditable="true"], [role="combobox"], [aria-haspopup="listbox"], .VfPpkd-aPP78e'
            )
          ) {
            return node as HTMLElement;
          }
          node = node.parentElement;
        }
        return null;
      };

      const rect = el.getBoundingClientRect();
      const fromPoint =
        rect.width > 0 && rect.height > 0
          ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
          : null;
      const candidate = nearestControl(fromPoint) ?? nearestControl(el);
      if (!candidate) return false;

      candidate.click();

      if (candidate instanceof HTMLInputElement || candidate instanceof HTMLTextAreaElement) {
        candidate.focus();
        candidate.value = nextValue;
        candidate.dispatchEvent(new Event("input", { bubbles: true }));
        candidate.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }

      if (candidate.isContentEditable) {
        candidate.focus();
        candidate.textContent = nextValue;
        candidate.dispatchEvent(new Event("input", { bubbles: true }));
        candidate.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }

      return false;
    },
    value
  );

  if (jsFilled) return "fill:js-fallback";

  throw new Error(`fill failed after fallbacks for selector: ${selector}`);
}

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
      const strategy = await clickWithFallbacks(page, action.selector!);
      logger.log(`click strategy used: ${strategy}`);
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

      if (isOverGenericFillSelector(action.selector!)) {
        throw new Error(
          `Refusing overly generic fill selector: ${action.selector}. Choose a specific field selector.`
        );
      }

      const strategy = await fillWithFallbacks(page, action.selector!, value);
      logger.log(`fill strategy used: ${strategy}`);
      break;
    }

    case "press": {
      logger.log(`press: ${action.key} on ${action.selector} (${action.reason})`);
      await page.locator(action.selector!).first().press(action.key!, { timeout: ACTION_TIMEOUT_MS });
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
