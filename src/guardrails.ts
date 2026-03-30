/**
 * =============================================================================
 * SAFETY RAILS — keep navigation inside an explicit hostname allowlist
 * =============================================================================
 *
 * `agent.ts` checks the starting URL; `executor.ts` checks again after each action in case
 * the site redirected somewhere unexpected. This does **not** stop sub-resource requests
 * (images, XHR) — only the **address bar URL** we pass into `ensureAllowedUrl`.
 */
import { URL } from "node:url";

/**
 * Ensures `urlString`’s **hostname** is allowed per `allowedDomains`.
 *
 * Matching rules:
 * - Exact match: `example.com` allows `example.com`.
 * - Subdomain match: `example.com` allows `app.example.com` (suffix `.example.com`).
 * - Comparison is case-insensitive.
 *
 * @param urlString — Full URL (e.g. current page from `page.url()`).
 * @param allowedDomains — List of bare domains like `["example.com", "render.com"]`.
 * @throws If URL is malformed or hostname is not allowed.
 */
export function ensureAllowedUrl(urlString: string, allowedDomains: string[]): void {
  // Dev override: allow all destinations when explicitly enabled.
  if (process.env.ALLOW_ALL_DOMAINS === "true") return;
  if (
    allowedDomains.some((d) => {
      const v = d.trim().toLowerCase();
      return v === "*" || v === "all";
    })
  ) {
    return;
  }

  let host: string;
  try {
    host = new URL(urlString).hostname.toLowerCase();
  } catch {
    throw new Error(`Invalid URL: ${urlString}`);
  }

  const allowed = allowedDomains.map((d) => d.toLowerCase());
  const ok = allowed.some(
    (d) => host === d || host.endsWith(`.${d}`)
  );

  if (!ok) {
    throw new Error(
      `Navigation blocked: host "${host}" is not in allowedDomains: ${allowed.join(", ")}`
    );
  }
}
