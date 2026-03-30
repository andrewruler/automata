/**
 * =============================================================================
 * BROWSER SESSION - how Playwright connects to Chrome
 * =============================================================================
 *
 * `agent.ts` only calls `createBrowserSession()` and later `dispose()`. This file hides:
 *  - Attaching to your already-running Chrome (CDP),
 *  - Launching Chrome with your User Data folder (persistent profile),
 *  - Or launching Chrome with a throwaway profile (quick tests).
 *
 * Details: docs/CHROME_SETUP.md
 */
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";

/** Which connection strategy was used (for logs / debugging). */
export type BrowserSessionMode = "cdp" | "launch" | "persistent";

/**
 * Everything `agent.ts` needs to drive one tab and clean up afterward.
 */
export type BrowserSession = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  mode: BrowserSessionMode;
  dispose: () => Promise<void>;
};

/**
 * Maps `HEADLESS` env to Playwright's headless flag.
 * Default is headed (visible window) unless `HEADLESS=true`.
 */
function headless(): boolean {
  return process.env.HEADLESS === "true";
}

/** Inject a script that forces navigator.webdriver to be undefined. */
async function hideWebdriver(context: BrowserContext) {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", {
      get: () => undefined,
      configurable: true,
    });
  });
}

/**
 * Reads `CHROME_CHANNEL` to pick which browser executable Playwright launches.
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
 */
function pickPage(context: BrowserContext): Promise<Page> {
  const pages = context.pages();
  const preferred = pages.find((p: Page) => {
    const u = p.url();
    return (
      /^https?:\/\//i.test(u) &&
      !u.startsWith("devtools://") &&
      !u.startsWith("chrome://")
    );
  });
  if (preferred) return Promise.resolve(preferred);

  const usable = pages.find((p: Page) => {
    const u = p.url();
    return (
      u.length > 0 &&
      u !== "about:blank" &&
      !u.startsWith("devtools://") &&
      !u.startsWith("chrome://")
    );
  });
  if (usable) return Promise.resolve(usable);

  return context.newPage();
}

function requireBrowser(context: BrowserContext): Browser {
  const browser = context.browser();
  if (!browser) {
    throw new Error("Playwright context has no associated browser instance.");
  }
  return browser;
}

function isProfileInUseError(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err);
  const lower = text.toLowerCase();
  return (
    lower.includes("opening in existing browser session") ||
    lower.includes("singletonlock") ||
    lower.includes("profile appears to be in use")
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function allowTempProfileFallback(): boolean {
  return (process.env.CHROME_ALLOW_TEMP_FALLBACK ?? "false").trim().toLowerCase() === "true";
}

async function createCdpSession(cdpUrl: string): Promise<BrowserSession> {
  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0];
  if (!context) {
    await browser.close();
    throw new Error(
      "CHROME_CDP_URL: connected but no browser context. Start Chrome with --remote-debugging-port=9222 (see docs/CHROME_SETUP.md)."
    );
  }

  await hideWebdriver(context);

  const page = await pickPage(context);
  await page.bringToFront();
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

async function createLaunchSession(
  channel: "chrome" | "chromium" | "msedge",
  viewport: { width: number; height: number }
): Promise<BrowserSession> {
  const launchOpts: Parameters<typeof chromium.launch>[0] = {
    headless: headless(),
    ignoreDefaultArgs: ["--enable-automation"],
    args: [
      "--disable-blink-features=AutomationControlled",
      `--window-size=${viewport.width},${viewport.height}`,
    ],
  };

  if (channel !== "chromium") {
    launchOpts.channel = channel;
  }

  const browser = await chromium.launch(launchOpts);
  const context = await browser.newContext({ viewport });

  await hideWebdriver(context);

  const page = await context.newPage();
  await page.bringToFront();
  return {
    browser,
    context,
    page,
    mode: "launch",
    dispose: async () => {
      await context.close();
      await browser.close();
    },
  };
}

/**
 * Opens or attaches a browser according to environment variables (precedence top-down):
 *
 * 1. `CHROME_CDP_URL` (e.g. `http://127.0.0.1:9222`)
 * 2. `CHROME_USER_DATA_DIR`
 * 3. Neither -> launch Chrome with a temporary profile.
 */
export async function createBrowserSession(): Promise<BrowserSession> {
  // Branch 1: attach to existing Chrome (CDP)
  const cdpUrl = process.env.CHROME_CDP_URL?.trim();
  if (cdpUrl) {
    return createCdpSession(cdpUrl);
  }

  const userDataDir = process.env.CHROME_USER_DATA_DIR?.trim();
  const viewport = { width: 1440, height: 960 };
  const channel = pickChannel();

  // Branch 2: launch Chrome with a persistent user-data directory
  if (userDataDir) {
    const profileDir = process.env.CHROME_PROFILE_DIRECTORY?.trim() ?? "Default";
    const profileArgs = [
      `--profile-directory=${profileDir}`,
      `--window-size=${viewport.width},${viewport.height}`,
    ];

    let context: BrowserContext;
    try {
      context = await chromium.launchPersistentContext(userDataDir, {
        channel: channel === "chromium" ? undefined : channel,
        headless: headless(),
        viewport,
        ignoreDefaultArgs: ["--enable-automation"],
        args: ["--disable-blink-features=AutomationControlled", ...profileArgs],
      });
    } catch (err) {
      if (isProfileInUseError(err)) {
        if (allowTempProfileFallback()) {
          console.warn(
            "Chrome profile is in use; CHROME_ALLOW_TEMP_FALLBACK=true so using a temporary browser session."
          );
          return createLaunchSession(channel, viewport);
        }
        const raw = errorMessage(err);
        throw new Error(
          `Chrome profile is already in use. Close all Chrome windows for this profile and run again. If you intentionally want temporary-profile fallback, set CHROME_ALLOW_TEMP_FALLBACK=true. Raw launch error: ${raw}`
        );
      }
      throw new Error(
        `Failed to launch persistent Chrome profile (${userDataDir}, ${profileDir}): ${errorMessage(err)}`
      );
    }

    await hideWebdriver(context);

    const page = await pickPage(context);
    await page.bringToFront();
    const browser = requireBrowser(context);

    return {
      browser,
      context,
      page,
      mode: "persistent",
      dispose: async () => {
        await context.close();
      },
    };
  }

  // Branch 3: launch Chrome with a temporary (throwaway) profile
  return createLaunchSession(channel, viewport);
}
