import {
  AgentTask,
  CriticVerdict,
  PageObservation,
  PlannedAction,
  StepRecord,
} from "./types.js";
import { JsonThread } from "./llm.js";

const actionSchema = {
  type: "object",
  properties: {
    actionType: {
      type: "string",
      enum: ["goto", "click", "fill", "press", "wait", "done"],
    },
    reason: { type: "string" },
    url: { type: "string" },
    selector: { type: "string" },
    credentialKey: { type: "string" },
    text: { type: "string" },
    key: { type: "string" },
    ms: { type: "integer", minimum: 0 },
    doneMessage: { type: "string" },
  },
  required: ["actionType", "reason"],
  additionalProperties: false,
} as const;

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
  observation: PageObservation,
  history: StepRecord[]
): Promise<PlannedAction> {
  const plan = await thread.ask<PlannedAction>({
    schemaName: "browser_next_action",
    schema: actionSchema,
    instructions: [
      "You are a browser automation planner.",
      "Return exactly one next action as JSON.",
      "Never output raw secret values.",
      "When an action needs a user credential, set credentialKey instead of text.",
      "Stay only on allowed domains.",
      "Prefer robust Playwright locator strings using visible text, name, placeholder, data-testid, or simple CSS selectors.",
      'Examples: button:has-text("Sign up"), input[name="email"], [data-testid="submit"].',
      "Do not invent elements that are not plausibly present in the observation.",
      "If the task looks complete, return actionType='done'.",
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
  before: PageObservation,
  action: PlannedAction,
  executionResult: string,
  after: PageObservation,
  history: StepRecord[]
): Promise<CriticVerdict> {
  return await thread.ask<CriticVerdict>({
    schemaName: "browser_step_critic",
    schema: criticSchema,
    instructions: [
      "You are a browser automation critic.",
      "Judge whether the last browser action advanced the task.",
      "Use success if the goal appears satisfied.",
      "Use blocked if there is an obvious hard blocker like CAPTCHA, email verification, phone verification, permission denial, or domain restriction.",
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
    (action.actionType === "click" || action.actionType === "press") &&
    !action.selector
  ) {
    throw new Error(`${action.actionType} action missing selector`);
  }

  if (action.actionType === "press" && !action.key) {
    throw new Error("press action missing key");
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

  if (action.actionType === "wait" && typeof action.ms !== "number") {
    throw new Error("wait action missing ms");
  }
}
