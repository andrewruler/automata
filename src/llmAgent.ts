/**
 * =============================================================================
 * PLANNER + CRITIC — the two LLM roles that drive the agent loop
 * =============================================================================
 *
 * `planNextAction` (planner): Given the current observation and recent history,
 * choose the single next browser action.
 *
 * `critiqueStep` (critic): Given before/after observations plus the execution
 * result, decide whether to continue, declare success, or stop as blocked/failed.
 *
 * Both use Structured Outputs (JSON Schema). Schemas are declared `as const` in
 * TypeScript but cast to `Record<string, unknown>` for the OpenAI client.
 */

import {
  AgentTask,
  CriticVerdict,
  ObservationBundle,
  PlannedAction,
  StepRecord,
} from "./types.js";
import { JsonThread } from "./llm.js";

/**
 * Detects hard blockers that should be treated as blocked rather than retried.
 * CAPTCHA is excluded here because it may be handled by a specialized solver flow elsewhere.
 */
function detectHardBlockers(observation: ObservationBundle): string | null {
  const combined = [
    observation.html,
    typeof observation.vision === "string" ? observation.vision : "",
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();

  const blockerPatterns: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /phone verification|verify your phone|enter verification code/, label: "Phone verification required" },
    { pattern: /email verification|check your email to verify/, label: "Email verification required" },
    { pattern: /permission denied|access denied|forbidden|not authorized/, label: "Access denied" },
  ];

  for (const { pattern, label } of blockerPatterns) {
    if (pattern.test(combined)) return label;
  }

  return null;
}

/** JSON Schema for the planner reply. Keep in sync with `PlannedAction` in `types.ts`. */
const actionSchema = {
  type: "object",
  properties: {
    actionType: {
      type: "string",
      enum: ["goto", "click", "fill", "press", "wait", "done"],
    },
    reason: { type: "string" },
    url: { type: ["string", "null"] },
    selector: { type: ["string", "null"] },
    executionMode: { type: ["string", "null"], enum: ["dom", "vision", null] },
    bbox: {
      type: ["object", "null"],
      properties: {
        x1: { type: "number", minimum: 0, maximum: 1 },
        y1: { type: "number", minimum: 0, maximum: 1 },
        x2: { type: "number", minimum: 0, maximum: 1 },
        y2: { type: "number", minimum: 0, maximum: 1 },
      },
      required: ["x1", "y1", "x2", "y2"],
      additionalProperties: false,
    },
    clickPoint: {
      type: ["object", "null"],
      properties: {
        x: { type: "number", minimum: 0, maximum: 1 },
        y: { type: "number", minimum: 0, maximum: 1 },
      },
      required: ["x", "y"],
      additionalProperties: false,
    },
    credentialKey: { type: ["string", "null"] },
    text: { type: ["string", "null"] },
    key: { type: ["string", "null"] },
    ms: { type: ["integer", "null"], minimum: 0 },
    doneMessage: { type: ["string", "null"] },
  },
  required: [
    "actionType",
    "reason",
    "url",
    "selector",
    "executionMode",
    "bbox",
    "clickPoint",
    "credentialKey",
    "text",
    "key",
    "ms",
    "doneMessage",
  ],
  additionalProperties: false,
} as const;

/** JSON Schema for the critic reply. Keep in sync with `CriticVerdict`. */
const criticSchema = {
  type: "object",
  properties: {
    status: {
      type: "string",
      enum: ["continue", "success", "blocked", "failed"],
    },
    summary: { type: "string" },
    goalProgress: { type: "string" },
    nextAdvice: { type: "string" },
  },
  required: ["status", "summary", "goalProgress", "nextAdvice"],
  additionalProperties: false,
} as const;

export async function planNextAction(
  thread: JsonThread,
  task: AgentTask,
  observation: ObservationBundle,
  history: StepRecord[]
): Promise<PlannedAction> {
  const hardBlocker = detectHardBlockers(observation);

  if (hardBlocker) {
    return {
      actionType: "wait",
      reason: `${hardBlocker}. Let the critic classify the run as blocked.`,
      url: null,
      selector: null,
      executionMode: null,
      bbox: null,
      clickPoint: null,
      credentialKey: null,
      text: null,
      key: null,
      ms: 1000,
      doneMessage: null,
    };
  }

  const plan = await thread.ask<PlannedAction>({
    schemaName: "browser_next_action",
    schema: actionSchema as unknown as Record<string, unknown>,
    instructions: [
      "You are a browser automation planner.",
      "Return exactly one next action as JSON.",
      "Never output raw secret values.",
      "When an action needs a user credential, set credentialKey instead of text.",
      "Stay only on allowed domains.",
      "Prefer robust Playwright locator strings using visible text, name, placeholder, data-testid, or simple CSS selectors.",
      'Examples: button:has-text("Sign up"), input[name="email"], [data-testid="submit"].',
      'For fill actions, avoid generic selectors like input[type="text"] or input[type="text"]:not([name]); choose specific field selectors using name, aria-label, placeholder, label context, role, or data-* attributes.',
      'Prefer DOM selector (`executionMode: "dom"`) when page structure is clear. Use vision mode (`executionMode: "vision"`) only for hard-to-select elements where a screenshot and normalized bbox/clickPoint are more reliable.',
      'When performing dropdown or combobox interaction, prefer explicit `click` actions on option items (for example `click text=Female`) over low-level `press` keys when possible.',
      'Avoid using undesired global focus commands such as ArrowUp/ArrowDown/Enter unless the target element is clearly a keyboard-navigable combobox and no stable options are available.',
      'When using vision mode, include normalized coordinates in `bbox` or `clickPoint` (values 0–1 relative to viewport width/height).',
      "Do not invent elements that are not plausibly present in the observation.",
      "Treat email verification, phone verification, and access denial as hard blockers. CAPTCHA or human verification may be handled by a specialized solver flow elsewhere in the system.",
      "Use actionType='done' only when the task is truly complete.",
      "If the task is blocked or required data is missing, do not use done; keep the step minimal and let the critic classify blocked/failed after the attempt.",
      "Use observation.html as primary context; use observation.vision only when present.",
      "Choose the smallest useful next step, not a whole plan.",
    ].join(" "),
    payload: {
      task: {
        name: task.name,
        goal: task.goal,
        startUrl: task.startUrl,
        allowedDomains: task.allowedDomains,
        successHints: task.successHints ?? [],
        availableCredentialKeys: Object.keys(task.credentials ?? {}),
      },
      observation,
      recentHistory: history.slice(-6).map((h) => ({
        step: h.step,
        action: h.action,
        result: h.result,
        urlAfter: h.urlAfter,
        criticStatus: h.criticStatus,
        criticSummary: h.criticSummary,
      })),
    },
  });

  validateAction(plan, task);
  return plan;
}

export async function critiqueStep(
  thread: JsonThread,
  task: AgentTask,
  before: ObservationBundle,
  action: PlannedAction,
  executionResult: string,
  after: ObservationBundle,
  history: StepRecord[]
): Promise<CriticVerdict> {
  const blocker = detectHardBlockers(after) ?? detectHardBlockers(before);

  if (blocker) {
    return {
      status: "blocked",
      summary: blocker,
      goalProgress: "A hard verification or access blocker is preventing further progress.",
      nextAdvice: "Stop and require a human or another approved flow instead of retrying.",
    };
  }

  return await thread.ask<CriticVerdict>({
    schemaName: "browser_step_critic",
    schema: criticSchema as unknown as Record<string, unknown>,
    instructions: [
      "You are a browser automation critic.",
      "Judge whether the last browser action advanced the task.",
      "Use success if the goal appears satisfied.",
      "Use blocked if there is an obvious hard blocker like email verification, phone verification, permission denial, or domain restriction. CAPTCHA may be handled by a specialized solver flow elsewhere in the system.",
      "Use failed if the step clearly broke or is unrecoverable.",
      "Use continue otherwise.",
      "Be strict and brief.",
    ].join(" "),
    payload: {
      task: {
        goal: task.goal,
        successHints: task.successHints ?? [],
      },
      before,
      action,
      executionResult,
      after,
      recentHistory: history.slice(-6).map((h) => ({
        step: h.step,
        action: h.action,
        result: h.result,
        urlAfter: h.urlAfter,
        criticStatus: h.criticStatus,
        criticSummary: h.criticSummary,
      })),
    },
  });
}

function validateAction(action: PlannedAction, task: AgentTask) {
  if (!action.reason) throw new Error("Action missing reason");

  if (action.actionType === "goto" && !action.url) {
    throw new Error("goto action missing url");
  }

  if (
    action.actionType === "click" &&
    action.executionMode !== "vision" &&
    !action.selector
  ) {
    throw new Error("click action missing selector");
  }

  if (action.actionType === "press") {
    if (!action.key) {
      throw new Error("press action missing key");
    }
    if (action.selector && typeof action.selector !== "string") {
      throw new Error("press action selector must be a string when provided");
    }
  }

  if (action.actionType === "fill") {
    if (!action.selector) throw new Error("fill action missing selector");
    if (!action.credentialKey && !action.text) {
      throw new Error("fill action needs credentialKey or text");
    }
    if (
      action.credentialKey &&
      !(task.credentials && action.credentialKey in task.credentials)
    ) {
      throw new Error(`Unknown credentialKey: ${action.credentialKey}`);
    }
  }

  if (action.executionMode) {
    if (action.executionMode !== "dom" && action.executionMode !== "vision") {
      throw new Error(`Invalid executionMode: ${action.executionMode}`);
    }
    if (action.executionMode === "vision") {
      if (action.actionType !== "click") {
        throw new Error("vision executionMode is only supported for click actions");
      }
      if (!action.bbox && !action.clickPoint) {
        throw new Error("vision click actions require bbox or clickPoint");
      }
    }
  }

  if (action.actionType === "wait" && typeof action.ms !== "number") {
    throw new Error("wait action missing ms");
  }
}