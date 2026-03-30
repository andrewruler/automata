import { AgentTask, CredentialMap, Mission } from "./types.js";

function splitCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function normalizeHost(input: string): string {
  const withProtocol = input.includes("://") ? input : `https://${input}`;
  return new URL(withProtocol).hostname.toLowerCase();
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "mission";
}

function deriveMilestones(rawGoal: string): string[] {
  const parts = rawGoal
    .split(/[.;\n]+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return parts.length > 0 ? parts : [rawGoal.trim()];
}

export function buildMission(rawGoalInput: string, credentials?: CredentialMap): Mission {
  const rawGoal = rawGoalInput.trim();
  if (!rawGoal) {
    throw new Error('Missing mission text. Usage: npm start -- "Your mission here"');
  }

  const allowAllFlag = (process.env.ALLOW_ALL_DOMAINS ?? "").trim().toLowerCase();
  const allowedDomainsEnv = (process.env.ALLOWED_DOMAINS ?? "").trim().toLowerCase();
  const allowAllDomains =
    allowAllFlag === "true" ||
    allowedDomainsEnv === "*" ||
    allowedDomainsEnv === "true" ||
    allowedDomainsEnv === "all";
  const allowedDomainsRaw = splitCsv(process.env.ALLOWED_DOMAINS);
  if (!allowAllDomains && allowedDomainsRaw.length === 0) {
    throw new Error("Missing ALLOWED_DOMAINS in .env (comma-separated hostnames).");
  }
  const allowedDomains = allowAllDomains ? ["*"] : allowedDomainsRaw.map(normalizeHost);

  const defaultStartUrl = allowAllDomains ? "" : `https://${allowedDomains[0]}`;
  const startUrl = (process.env.START_URL ?? defaultStartUrl).trim();
  if (!startUrl) {
    throw new Error("Missing START_URL in .env when ALLOW_ALL_DOMAINS=true.");
  }
  const deadlineSeconds = Number(process.env.MISSION_DEADLINE_SECONDS ?? "300");
  const maxSteps = Number(process.env.MISSION_MAX_STEPS ?? "40");
  const constraints = splitCsv(process.env.MISSION_CONSTRAINTS);

  const credentialKeyNames = Object.entries(credentials ?? {})
    .filter(([, value]) => (value ?? "").length > 0)
    .map(([key]) => key);

  return {
    id: `mission-${Date.now()}-${slug(rawGoal)}`,
    rawGoal,
    milestones: deriveMilestones(rawGoal),
    allowedDomains,
    deadlineSeconds,
    maxSteps,
    credentialKeyNames,
    constraints,
    startUrl,
  };
}

export function missionToAgentTask(mission: Mission, credentials?: CredentialMap): AgentTask {
  return {
    name: mission.id,
    goal: mission.rawGoal,
    startUrl: mission.startUrl,
    allowedDomains: mission.allowedDomains,
    deadlineSeconds: mission.deadlineSeconds,
    maxSteps: mission.maxSteps,
    credentials,
    successHints: mission.milestones,
  };
}
