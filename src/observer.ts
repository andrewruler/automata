/**
 * =============================================================================
 * PAGE OBSERVATION — turn the live DOM into a small JSON summary for the LLM
 * =============================================================================
 *
 * We do **not** send raw HTML (too large, noisy). Instead, `observePage` runs a function
 * **inside the browser tab** via `page.evaluate(...)`. That function can use normal DOM APIs
 * (`document.querySelectorAll`, etc.) and returns a plain object → `PageObservation`.
 *
 * Called from `agent.ts` **before** each planner call (`before`) and **after** each action (`after`).
 */
import { Page } from "playwright";
import { PageObservation } from "./types.js";

/**
 * Captures a structured, size-limited text view of the current page for the planner/critic.
 *
 * Implementation note: the big callback passed to `page.evaluate` runs in the **page's JavaScript
 * world**, not in Node. It cannot close over Node variables unless you pass them as arguments
 * to `evaluate` (we don't need that here).
 *
 * @param page — Playwright handle to the tab being automated.
 * @returns Serializable snapshot: URL, title, lists of controls/text snippets.
 */
export async function observePage(page: Page): Promise<PageObservation> {
  return await page.evaluate(() => {
    /** Collapse whitespace for cleaner strings in the model context. */
    const norm = (s: string | null | undefined) =>
      (s ?? "").replace(/\s+/g, " ").trim();

    /** Truncate long strings so one page doesn't explode token usage. */
    const short = (s: string | null | undefined, n = 140) =>
      norm(s).slice(0, n);

    /** Visible-ish text from a single element. */
    const textOf = (el: Element | null) => short(el?.textContent ?? "");

    /**
     * Tries to find a human-readable label for an input (associated `<label>` or wrapping label).
     * Helps the model match "Email" fields even when placeholder is empty.
     */
    const labelFor = (el: Element): string => {
      const id = el.getAttribute("id");
      if (id) {
        const explicit = document.querySelector(`label[for="${id}"]`);
        if (explicit) return textOf(explicit);
      }
      const parentLabel = el.closest("label");
      if (parentLabel) return textOf(parentLabel);
      return "";
    };

    const headings = Array.from(document.querySelectorAll("h1,h2,h3"))
      .map((el) => textOf(el))
      .filter(Boolean)
      .slice(0, 20);

    const buttons = Array.from(
      document.querySelectorAll(
        'button, [role="button"], input[type="submit"], input[type="button"]'
      )
    )
      .map((el) => {
        if (el instanceof HTMLInputElement) {
          return short(el.value || el.getAttribute("aria-label") || "");
        }
        return short(
          el.getAttribute("aria-label") ||
            (el as HTMLElement).innerText ||
            el.textContent ||
            ""
        );
      })
      .filter(Boolean)
      .slice(0, 30);

    const links = Array.from(document.querySelectorAll("a[href]"))
      .map((el) => ({
        text: short((el as HTMLAnchorElement).innerText || el.textContent || ""),
        href: (el as HTMLAnchorElement).href || "",
      }))
      .filter((x) => x.text || x.href)
      .slice(0, 30);

    const inputs = Array.from(
      document.querySelectorAll("input, textarea, select")
    )
      .map((el) => {
        const input = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
        return {
          tag: el.tagName.toLowerCase(),
          type: (input as HTMLInputElement).type || "",
          name: input.getAttribute("name") || "",
          placeholder: input.getAttribute("placeholder") || "",
          label: labelFor(el),
        };
      })
      .slice(0, 40);

    const alerts = Array.from(
      document.querySelectorAll(
        '[role="alert"], .error, .alert, [aria-invalid="true"]'
      )
    )
      .map((el) => textOf(el))
      .filter(Boolean)
      .slice(0, 20);

    const bodyTextExcerpt = short(document.body?.innerText || "", 2500);

    return {
      url: location.href,
      title: document.title || "",
      headings,
      buttons,
      links,
      inputs,
      alerts,
      bodyTextExcerpt,
    };
  });
}

/**
 * Detects if a captcha is present on the current page.
 */
export async function detectCaptcha(page: Page): Promise<boolean> {
  const captchaSelectors = [
    'iframe[src*="recaptcha"]',
    'iframe[src*="captcha"]',
    '.captcha',
    '[id*="captcha"]',
    'img[alt*="captcha" i]',
    '[class*="captcha"]'
  ];
  
  for (const selector of captchaSelectors) {
    const element = await page.$(selector);
    if (element) return true;
  }
  
  return false;
}

/**
 * Captures a screenshot of the captcha area for analysis.
 */
export async function captureCaptchaArea(page: Page): Promise<Buffer | null> {
  try {
    // Try to find captcha element
    const captchaElement = await page.$('iframe[src*="recaptcha"], .captcha, [id*="captcha"]');
    
    if (captchaElement) {
      // Get bounding box
      const bbox = await captchaElement.boundingBox();
      if (bbox) {
        // Crop screenshot to captcha area with some padding
        return await page.screenshot({
          clip: {
            x: Math.max(0, bbox.x - 20),
            y: Math.max(0, bbox.y - 20),
            width: bbox.width + 40,
            height: bbox.height + 40
          }
        });
      }
    }
    
    // Fallback to full page screenshot
    return await page.screenshot();
  } catch (error) {
    console.error('Failed to capture captcha area:', error);
    return null;
  }
}