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

async function getViewportSize(
  page: Page
): Promise<{ width: number; height: number }> {
  const viewport = page.viewportSize();
  if (viewport) return viewport;
  return await page.evaluate(() => ({
    width: window.innerWidth || 1280,
    height: window.innerHeight || 720,
  }));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizedPointToViewport(
  point: { x: number; y: number },
  viewport: { width: number; height: number }
) {
  return {
    x: clamp(Math.round(point.x * viewport.width), 0, viewport.width - 1),
    y: clamp(Math.round(point.y * viewport.height), 0, viewport.height - 1),
  };
}

function bboxCenterToViewport(
  bbox: { x1: number; y1: number; x2: number; y2: number },
  viewport: { width: number; height: number }
) {
  return normalizedPointToViewport(
    { x: (bbox.x1 + bbox.x2) / 2, y: (bbox.y1 + bbox.y2) / 2 },
    viewport
  );
}

function jitterOffsets(radiusPx: number): Array<{ dx: number; dy: number }> {
  return [
    { dx: 0, dy: 0 },
    { dx: -radiusPx, dy: 0 },
    { dx: radiusPx, dy: 0 },
    { dx: 0, dy: -radiusPx },
    { dx: 0, dy: radiusPx },
  ];
}

async function clickElementFromPoint(
  page: Page,
  x: number,
  y: number
): Promise<boolean> {
  return await page.evaluate(
    ({ clickX, clickY }: { clickX: number; clickY: number }) => {
      const element = document.elementFromPoint(clickX, clickY);
      if (!element || !(element instanceof HTMLElement)) return false;
      element.scrollIntoView({
        block: "center",
        inline: "center",
        behavior: "auto",
      });
      const rect = element.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const ev = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: centerX,
        clientY: centerY,
      });
      element.dispatchEvent(ev);
      return true;
    },
    { clickX: x, clickY: y }
  );
}

async function clickByVision(page: Page, action: PlannedAction): Promise<string> {
  const viewport = await getViewportSize(page);
  const basePoint = action.clickPoint
    ? normalizedPointToViewport(action.clickPoint, viewport)
    : action.bbox
    ? bboxCenterToViewport(action.bbox, viewport)
    : null;

  if (!basePoint) {
    throw new Error("Vision click requires bbox or clickPoint");
  }

  const maxRetries = Number(process.env.VISION_CLICK_RETRIES ?? "3");
  const jitterPx = Number(process.env.VISION_CLICK_JITTER_PX ?? "4");
  const candidates = jitterOffsets(jitterPx).map((offset) => ({
    x: clamp(basePoint.x + offset.dx, 0, viewport.width - 1),
    y: clamp(basePoint.y + offset.dy, 0, viewport.height - 1),
  }));

  const startUrl = page.url();

  for (let i = 0; i < Math.min(maxRetries, candidates.length); i++) {
    const { x, y } = candidates[i];

    try {
      await page.mouse.move(x, y, { steps: 12 });
      await page.mouse.click(x, y);
      await page.waitForTimeout(300);

      const currentUrl = page.url();
      if (currentUrl !== startUrl) {
        return `click:vision (mouse ${i + 1} of ${maxRetries})`;
      }

      const domClicked = await clickElementFromPoint(page, x, y);
      if (domClicked) {
        await page.waitForTimeout(300);
        if (page.url() !== startUrl) {
          return `click:vision (elementFromPoint fallback ${i + 1} of ${maxRetries})`;
        }
        return `click:vision (elementFromPoint ${i + 1} of ${maxRetries})`;
      }
    } catch (err) {
      void err;
    }
  }

  throw new Error(
    `Vision click failed after ${maxRetries} attempts (base point ${basePoint.x},${basePoint.y})`
  );
}

async function selectFirstDropdownOptionIfVisible(page: Page): Promise<boolean> {
  const chosen = await page.evaluate(() => {
    const options = Array.from(
      document.querySelectorAll('li[role="option"], [role="option"]')
    ).filter((el) => {
      if (!(el instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return (
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        rect.width > 0 &&
        rect.height > 0
      );
    });
    if (options.length === 0) return false;
    (options[0] as HTMLElement).click();
    return true;
  });

  if (chosen) {
    await page.waitForTimeout(300);
  }
  return chosen;
}

async function tryGoogleSignupOptionSelect(
  page: Page,
  wantedText: string
): Promise<boolean> {
  return await page.evaluate((wantedRaw) => {
    if (!location.hostname.includes("accounts.google.com")) return false;
    if (!location.pathname.includes("/lifecycle/steps/signup/birthdaygender"))
      return false;
    const wanted = wantedRaw.trim().toLowerCase();
    if (!wanted) return false;

    const openDropdown = (kind: "month" | "gender"): boolean => {
      const overlays = Array.from(document.querySelectorAll(".VfPpkd-aPP78e")).filter(
        (el) => {
          if (!(el instanceof HTMLElement)) return false;
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden";
        }
      ) as HTMLElement[];
      if (overlays.length === 0) return false;

      const idx = kind === "month" ? 0 : Math.min(1, overlays.length - 1);
      overlays[idx].click();
      return true;
    };

    if (
      wanted.includes("january") ||
      wanted.includes("february") ||
      wanted.includes("march")
    ) {
      openDropdown("month");
    } else {
      openDropdown("gender");
    }

    const options = Array.from(
      document.querySelectorAll('li[role="option"], [role="option"]')
    );
    const match = options.find((el) => {
      const t = (el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      return t.includes(wanted);
    });
    if (!(match instanceof HTMLElement)) return false;
    match.click();
    return true;
  }, wantedText);
}

async function tryGoogleSignupOpenDropdown(
  page: Page,
  kind: "month" | "gender"
): Promise<boolean> {
  return await page.evaluate((k) => {
    if (!location.hostname.includes("accounts.google.com")) return false;
    if (!location.pathname.includes("/lifecycle/steps/signup/birthdaygender"))
      return false;
    const overlays = Array.from(document.querySelectorAll(".VfPpkd-aPP78e")).filter(
      (el) => {
        if (!(el instanceof HTMLElement)) return false;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden";
      }
    ) as HTMLElement[];
    if (overlays.length === 0) return false;
    const idx = k === "month" ? 0 : Math.min(1, overlays.length - 1);
    overlays[idx].click();
    return true;
  }, kind);
}

async function clickWithFallbacks(page: Page, selector: string): Promise<string> {
  const selectorLower = selector.trim().toLowerCase();

  if (
    selectorLower.includes("text=gender") ||
    selectorLower.includes("please select your gender")
  ) {
    const opened = await tryGoogleSignupOpenDropdown(page, "gender");
    if (opened) return "click:google-open-gender";
  }
  if (selectorLower.includes("text=month")) {
    const opened = await tryGoogleSignupOpenDropdown(page, "month");
    if (opened) return "click:google-open-month";
  }
  if (
    selectorLower.includes('aria-label="month"') ||
    selectorLower.includes("aria-label='month'") ||
    (selectorLower.includes('role="combobox"') && selectorLower.includes("month")) ||
    selectorLower.includes('input[aria-label="month"]')
  ) {
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
  } catch {}

  try {
    await target.click({ timeout: ACTION_TIMEOUT_MS, force: true });
    return "click:force";
  } catch {}

  const jsClicked = await target.evaluate((el) => {
    const isHtml = (n: Element | null): n is HTMLElement =>
      !!n && n instanceof HTMLElement;
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

    candidate.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true })
    );
    candidate.dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true, cancelable: true })
    );
    candidate.click();
    return true;
  });

  if (jsClicked) return "click:js-fallback";

  const optionContainerClicked = await page.evaluate((rawSelector) => {
    const selector = rawSelector.trim();
    const textPrefix = "text=";
    if (!selector.toLowerCase().startsWith(textPrefix)) return false;
    const wanted = selector
      .slice(textPrefix.length)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (!wanted) return false;

    const options = Array.from(
      document.querySelectorAll('li[role="option"], [role="option"]')
    );
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
      selector.includes('role="option"');
    if (!isLikelyDropdownTarget) return false;

    const overlays = Array.from(document.querySelectorAll(".VfPpkd-aPP78e")).filter(
      (el) => {
        if (!(el instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return (
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          rect.width > 0 &&
          rect.height > 0
        );
      }
    ) as HTMLElement[];

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
    s === 'input[type="text"]' ||
    s === "input[type='text']" ||
    s === "input[type=text]" ||
    s === 'input[type="text"]:not([name])' ||
    s === "input[type='text']:not([name])" ||
    s === "input[type=text]:not([name])"
  );
}

async function refineGenericFillSelector(
  page: Page,
  selector: string
): Promise<string | null> {
  return await page.evaluate((rawSelector) => {
    const sel = rawSelector.trim();
    const element = document.querySelector(sel);
    if (!(element instanceof HTMLElement)) return null;
    const tag = element.tagName.toLowerCase();
    if (tag !== "input" && tag !== "textarea" && !element.isContentEditable)
      return null;

    const isVisible = (el: Element | null): el is HTMLElement => {
      if (!(el instanceof HTMLElement)) return false;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none"
      );
    };

    const attrs: Array<[string, string | null]> = [
      ["name", element.getAttribute("name")],
      ["id", element.getAttribute("id")],
      ["placeholder", element.getAttribute("placeholder")],
      ["aria-label", element.getAttribute("aria-label")],
      ["autocomplete", element.getAttribute("autocomplete")],
      ["data-testid", element.getAttribute("data-testid")],
    ];

    const candidates: string[] = [];
    for (const [attr, value] of attrs) {
      if (value && value.trim()) {
        const quoted = JSON.stringify(value.trim());
        candidates.push(`${sel}[${attr}=${quoted}]`);
      }
    }

    if (element.id) {
      const labels = Array.from(
        document.querySelectorAll(`label[for=${JSON.stringify(element.id)}]`)
      );
      for (const label of labels) {
        if (!(label instanceof HTMLElement)) continue;
        const text = (label.textContent || "").trim();
        if (text) {
          const quoted = JSON.stringify(text);
          candidates.push(`${sel}[aria-label=${quoted}]`);
        }
      }
    }

    const visibleMatches = Array.from(document.querySelectorAll(sel)).filter(isVisible);
    if (visibleMatches.length === 1) return sel;

    for (const candidate of candidates) {
      const matches = Array.from(document.querySelectorAll(candidate)).filter(
        isVisible
      );
      if (matches.length === 1) return candidate;
    }

    return null;
  }, selector);
}

async function fillWithFallbacks(
  page: Page,
  selector: string,
  value: string
): Promise<string> {
  const target = page.locator(selector).first();

  try {
    await target.fill(value, { timeout: ACTION_TIMEOUT_MS });
    return "fill:normal";
  } catch {}

  try {
    await target.click({ timeout: ACTION_TIMEOUT_MS, force: true });
    await target.fill(value, { timeout: ACTION_TIMEOUT_MS, force: true });
    return "fill:force";
  } catch {}

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

      if (
        candidate instanceof HTMLInputElement ||
        candidate instanceof HTMLTextAreaElement
      ) {
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
      await page.goto(action.url!, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      break;
    }

    case "click": {
      if (action.executionMode === "vision") {
        logger.log(`click: vision (${action.reason})`);
        const strategy = await clickByVision(page, action);
        logger.log(`click strategy used: ${strategy}`);
      } else {
        logger.log(`click: ${action.selector} (${action.reason})`);
        const strategy = await clickWithFallbacks(page, action.selector!);
        logger.log(`click strategy used: ${strategy}`);
      }
      await settle(page);
      break;
    }

    case "fill": {
      const value =
        action.credentialKey != null
          ? task.credentials?.[action.credentialKey] ?? ""
          : action.text ?? "";

      let selector = action.selector!;
      logger.log(
        `fill: ${selector} using ${
          action.credentialKey ? `credential:${action.credentialKey}` : "literal text"
        } (${action.reason})`
      );

      if (!value) {
        throw new Error("Resolved fill value is empty");
      }

      if (isOverGenericFillSelector(selector)) {
        const refined = await refineGenericFillSelector(page, selector);
        if (refined) {
          logger.log(`refined generic fill selector to: ${refined}`);
          selector = refined;
        } else {
          throw new Error(
            `Refusing overly generic fill selector: ${selector}. Choose a specific field selector.`
          );
        }
      }

      const strategy = await fillWithFallbacks(page, selector, value);
      logger.log(`fill strategy used: ${strategy}`);
      break;
    }

    case "press": {
      if (action.selector) {
        logger.log(`press: ${action.key} on ${action.selector} (${action.reason})`);
        const wasDropdown = /gender|month|day|year|month|combobox/i.test(
          action.selector
        );
        if (
          wasDropdown &&
          (action.key === "ArrowDown" ||
            action.key === "ArrowUp" ||
            action.key === "Enter")
        ) {
          const selected = await selectFirstDropdownOptionIfVisible(page);
          if (selected) {
            logger.log(
              `press: selected first visible dropdown option for ${action.selector}`
            );
            await settle(page);
            break;
          }
        }
        await page
          .locator(action.selector)
          .first()
          .press(action.key!, { timeout: ACTION_TIMEOUT_MS });
      } else {
        logger.log(`press: ${action.key} on page keyboard (${action.reason})`);
        if (
          action.key === "ArrowDown" ||
          action.key === "ArrowUp" ||
          action.key === "Enter"
        ) {
          const selected = await selectFirstDropdownOptionIfVisible(page);
          if (selected) {
            logger.log(
              `press: selected first visible dropdown option via global action ${action.key}`
            );
            await settle(page);
            break;
          }
        }
        await page.keyboard.press(action.key!, { delay: 10 });
      }
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
 */
async function settle(page: Page) {
  try {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
  } catch {
    // ignore
  }
  await page.waitForTimeout(800);
}