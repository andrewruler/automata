/**
 * =============================================================================
 * BROWSER SESSION — how Playwright connects to Chrome
 * =============================================================================
 *
 * `agent.ts` only calls `createBrowserSession()` and later `dispose()`. This file hides:
 *   - Attaching to **your** already-running Chrome (CDP),
 *   - Launching Chrome with **your User Data** folder (persistent profile),
 *   - Or launching Chrome with a **throwaway** profile (quick tests).
 *
 * Details: `docs/CHROME_SETUP.md` · Roadmap: `docs/ROADMAP.md` Phase A.
 */
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

/** Which connection strategy was used (for logs / debugging). */
export type BrowserSessionMode = "cdp" | "launch" | "persistent";

/**
 * Everything `agent.ts` needs to drive one tab and clean up afterward.
 *
 * - `browser` — top-level Playwright handle to the Chromium/Chrome process (or CDP connection).
 * - `context` — cookie/storage isolation layer (one Chrome “profile” is roughly one default context).
 * - `page` — one tab; `page.goto`, `page.locator`, etc. all go here.
 * - `dispose` — **must** run in `finally`; semantics differ by mode (see below).
 */
export type BrowserSession = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  mode: BrowserSessionMode;
  /**
   * Cleanup when the agent run ends:
   * - **cdp**: `browser.close()` = disconnect WebSocket only; **your Chrome keeps running**.
   * - **launch**: close ephemeral context + browser Playwright started.
   * - **persistent**: `context.close()` shuts down that Chrome instance we launched with your user-data-dir.
   */
  dispose: () => Promise<void>;
};

/**
 * Maps `HEADLESS` env to Playwright’s headless flag.
 * Default is **headed** (visible window) unless `HEADLESS=true`.
 *
 * @returns Whether Playwright should run without a visible UI.
 */
function headless(): boolean {
  return process.env.HEADLESS === "true";
}

/**
 * Reads `CHROME_CHANNEL` to pick which browser executable Playwright launches.
 *
 * @returns `"chrome"` (Google Chrome), `"chromium"` (bundled), or `"msedge"`.
 */
function pickChannel(): "chrome" | "chromium" | "msedge" {
  const c = (process.env.CHROME_CHANNEL ?? "chrome").toLowerCase();
  if (c === "chromium") return "chromium";
  if (c === "msedge" || c === "edge") return "msedge";
  return "chrome";
}

/**
 * When attaching via CDP, Chrome may already have many tabs. Pick a sensible default:
 * prefer a normal `https?://` page over `chrome://` or DevTools.
 *
 * @param context — Default browser context from the live Chrome instance.
 * @returns An existing `Page` or a newly opened tab if none exist.
 */
function pickPage(context: BrowserContext): Promise<Page> {
  const pages = context.pages();
  const preferred = pages.find((p: Page) => {
    const u = p.url();
    return u.length > 0 && !u.startsWith("devtools://") && !u.startsWith("chrome://");
  });
  if (preferred) return Promise.resolve(preferred);
  if (pages[0]) return Promise.resolve(pages[0]);
  return context.newPage();
}

/**
 * Opens or attaches a browser according to environment variables (precedence top-down):
 *
 * 1. **`CHROME_CDP_URL`** (e.g. `http://127.0.0.1:9222`)  
 *    Connect to Chrome **you** started with `--remote-debugging-port`.  
 *    `dispose` disconnects only.
 *
 * 2. **`CHROME_USER_DATA_DIR`** (path to Chrome “User Data” directory)  
 *    Launch Chrome with that profile (cookies, extensions, logins).  
 *    Optional **`CHROME_PROFILE_DIRECTORY`** → `Default`, `Profile 1`, …  
 *    Chrome must not already be locking that folder.
 *
 * 3. **Neither** → Launch Chrome with a **temporary** profile (clean slate each run).
 *
 * @throws If CDP has no context, profile is locked, or Chrome cannot be launched.
 */
export async function createBrowserSession(): Promise<BrowserSession> {
  // ----- Branch 1: attach to existing Chrome (CDP) -----
  const cdpUrl = process.env.CHROME_CDP_URL?.trim();
  if (cdpUrl) {
    const browser = await chromium.connectOverCDP(cdpUrl);
    const context = browser.contexts()[0];
    if (!context) {
      await browser.close();
      throw new Error(
        "CHROME_CDP_URL: connected but no browser context. Start Chrome with --remote-debugging-port=9222 (see docs/CHROME_SETUP.md)."
      );
    }
    const page = await pickPage(context);
    return {
      browser,
      context,
      page,
      mode: "cdp",
      dispose: async () => {
        await browser.close();
      },
    };
  }

  const userDataDir = process.env.CHROME_USER_DATA_DIR?.trim();
  const viewport = { width: 1440, height: 960 };
  const channel = pickChannel();
  const profileDir = process.env.CHROME_PROFILE_DIRECTORY?.trim();
  const profileArgs = profileDir ? [`--profile-directory=${profileDir}`] : [];

  // ----- Branch 2: launch Chrome bound to a real user-data directory (your profile) -----
  if (userDataDir) {
    try {
      const context = await chromium.launchPersistentContext(userDataDir, {
        channel: channel === "chromium" ? undefined : channel,
        headless: headless(),
        viewport,
        args: profileArgs,
      });
      const browser = context.browser();
      if (!browser) {
        await context.close();
        throw new Error("launchPersistentContext: no Browser handle (unexpected)");
      }
      const page = await pickPage(context);
      return {
        browser,
        context,
        page,
        mode: "persistent",
        dispose: async () => {
          await context.close();
        },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `Failed to open Chrome with CHROME_USER_DATA_DIR=${userDataDir}. Close every Chrome window using this profile (Chrome locks the folder). ${msg}`
      );
    }
  }

  // ----- Branch 3: launch Chrome with a fresh temporary profile -----
  try {
    const launchOpts: Parameters<typeof chromium.launch>[0] = {
      headless: headless(),
    };
    if (channel !== "chromium") {
      launchOpts.channel = channel;
    }
    const browser = await chromium.launch(launchOpts);
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    return {
      browser,
      context,
      page,
      mode: "launch",
      dispose: async () => {
        await context.close().catch(() => {});
        await browser.close().catch(() => {});
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Failed to launch browser (channel=${channel}). Install Google Chrome, run \`npx playwright install chrome\`, or use CHROME_CDP_URL. ${msg}`
    );
  }
}
