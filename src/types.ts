/**
 * =============================================================================
 * SHARED DATA SHAPES — how information flows between modules
 * =============================================================================
 *
 * Execution order reminder (see `docs/WORKFLOW.md`):
 *   `AgentTask` (input) → `PageObservation` (observer) → `PlannedAction` (planner)
 *   → Playwright (executor) → `CriticVerdict` (critic) → `StepRecord` (history)
 *   → repeat until `ExecutionResult`.
 *
 * Playwright’s own types (`Page`, `Browser`, …) live in the `playwright` package, not here.
 */

export type CredentialMap = Record<string, string>;

/**
 * Definition of one automation job passed into `runLLMAgentTask`.
 *
 * - `allowedDomains` is enforced by `ensureAllowedUrl` (hostname allowlist).
 * - `credentials` values are **never** sent to the LLM; only keys appear in planner payload.
 */
export type AgentTask = {
  name: string;
  goal: string;
  startUrl: string;
  allowedDomains: string[];
  deadlineSeconds: number;
  maxSteps: number;
  credentials?: CredentialMap;
  successHints?: string[];
};

/**
 * Phase B mission input shape (natural language goal + guardrailed execution settings).
 */
export type Mission = {
  id: string;
  rawGoal: string;
  milestones: string[];
  allowedDomains: string[];
  deadlineSeconds: number;
  maxSteps: number;
  credentialKeyNames: string[];
  constraints: string[];
  startUrl: string;
};

/**
 * Compact “what’s on the page” structure produced by `observePage`.
 * The planner and critic both consume this (before/after snapshots).
 */
export type PageObservation = {
  url: string;
  title: string;
  headings: string[];
  buttons: string[];
  links: Array<{ text: string; href: string }>;
  inputs: Array<{
    tag: string;
    type: string;
    name: string;
    placeholder: string;
    label: string;
  }>;
  alerts: string[];
  bodyTextExcerpt: string;
};

export type VisionFrame = {
  path: string;
  width: number;
  height: number;
  captureKind: "viewport";
};

export type ObservationBundle = {
  html: PageObservation;
  vision?: VisionFrame;
};

export type NormalizedRect = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type NormalizedPoint = {
  x: number;
  y: number;
};

/**
 * One step requested by the planner. `executor.ts` dispatches on `actionType`.
 *
 * - `selector`: Playwright locator string (CSS / text / role — see planner instructions).
 * - `credentialKey`: must exist in `task.credentials`; actual value filled locally.
 * - `executionMode` and normalized coordinates allow vision-guided clicks when DOM selectors are unreliable.
 */
export type PlannedAction = {
  actionType: "goto" | "click" | "fill" | "press" | "wait" | "done";
  reason: string;
  url?: string;
  selector?: string;
  executionMode?: "dom" | "vision";
  bbox?: NormalizedRect;
  clickPoint?: NormalizedPoint;
  credentialKey?: string;
  text?: string;
  key?: string;
  ms?: number;
  doneMessage?: string;
};

/**
 * Critic output after each executed step (except pure `done` planner exits handled earlier).
 * `agent.ts` uses `status` to decide whether to continue the loop or return.
 */
export type CriticVerdict = {
  status: "continue" | "success" | "blocked" | "failed";
  summary: string;
  goalProgress: string;
  nextAdvice: string;
};

/**
 * One row of memory: what we saw, what we did, what happened, what the critic said.
 * The last N entries are embedded in planner/critic payloads (`recentHistory`).
 */
export type StepRecord = {
  step: number;
  observation: PageObservation;
  action: PlannedAction;
  result: string;
  screenshot?: string;
  urlAfter: string;
  criticStatus?: CriticVerdict["status"];
  criticSummary?: string;
};

/**
 * Final return value from `runLLMAgentTask` printed by `index.ts`.
 */
export type ExecutionResult = {
  success: boolean;
  stepsCompleted: number;
  message: string;
  lastUrl?: string;
  screenshots: string[];
  errors: string[];
  /** Playwright storage state JSON path (cookies/localStorage snapshot), if saved. */
  authStatePath?: string;
};
