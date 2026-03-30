import { Page } from "playwright";
import { Logger } from "./logger.js";
import { observePage } from "./observer.js";
import { ObservationBundle, VisionFrame } from "./types.js";

function visionMode(): "off" | "every" | "fallback" {
  const mode = (process.env.VISION_MODE ?? "off").trim().toLowerCase();
  if (mode === "every" || mode === "fallback") return mode;
  return "off";
}

async function viewportSize(page: Page): Promise<{ width: number; height: number }> {
  const direct = page.viewportSize();
  if (direct) return direct;
  return await page.evaluate(() => ({
    width: window.innerWidth || 1280,
    height: window.innerHeight || 720,
  }));
}

async function captureVisionFrame(
  page: Page,
  logger: Logger,
  basename: string
): Promise<VisionFrame> {
  const shotPath = logger.screenshotPath(basename);
  await page.screenshot({ path: shotPath, fullPage: false });
  logger.addScreenshot(shotPath);
  const size = await viewportSize(page);
  return {
    path: shotPath,
    width: size.width,
    height: size.height,
    captureKind: "viewport",
  };
}

export async function buildObservationBundle(
  page: Page,
  logger: Logger,
  step: number,
  stage: "before" | "after",
  forceVision = false
): Promise<ObservationBundle> {
  const html = await observePage(page);
  const mode = visionMode();
  if (mode !== "every" && !forceVision) {
    return { html };
  }
  const vision = await captureVisionFrame(page, logger, `vision-${stage}-step-${step}-${Date.now()}`);
  return { html, vision };
}
