import { Page } from "playwright";
import { PageObservation } from "./types.js";

export async function observePage(page: Page): Promise<PageObservation> {
  return await page.evaluate(() => {
    const norm = (s: string | null | undefined) =>
      (s ?? "").replace(/\s+/g, " ").trim();

    const short = (s: string | null | undefined, n = 140) =>
      norm(s).slice(0, n);

    const textOf = (el: Element | null) => short(el?.textContent ?? "");

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
