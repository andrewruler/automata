export type CredentialMap = Record<string, string>;

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

export type PlannedAction = {
  actionType: "goto" | "click" | "fill" | "press" | "wait" | "done";
  reason: string;
  url?: string;
  selector?: string;
  credentialKey?: string;
  text?: string;
  key?: string;
  ms?: number;
  doneMessage?: string;
};

export type CriticVerdict = {
  status: "continue" | "success" | "blocked" | "failed";
  summary: string;
  goalProgress: string;
  nextAdvice: string;
};

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

export type ExecutionResult = {
  success: boolean;
  stepsCompleted: number;
  message: string;
  lastUrl?: string;
  screenshots: string[];
  errors: string[];
  authStatePath?: string;
};
