import path from "node:path";
import { CursorCodingProvider } from "./cursorProvider.js";
import { LocalShellCodingProvider } from "./localShellProvider.js";
import { CodingMission, CodingProvider } from "./types.js";

function splitCsv(input: string | undefined): string[] {
  if (!input) return [];
  return input
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "coding-mission";
}

function readRawGoal(): string {
  const cli = process.argv.slice(2).join(" ").trim();
  if (cli) return cli;
  return process.env.CODING_MISSION_GOAL?.trim() || "Run project coding checks.";
}

function buildCodingMission(rawGoal: string): CodingMission {
  const commands = splitCsv(process.env.CODING_COMMANDS);
  if (commands.length === 0) {
    throw new Error("Missing CODING_COMMANDS in .env (comma-separated shell commands).");
  }
  const workingDirectory = path.resolve(process.env.CODING_WORKDIR || ".");
  return {
    id: `coding-${Date.now()}-${slug(rawGoal)}`,
    rawGoal,
    workingDirectory,
    commands,
    constraints: splitCsv(process.env.CODING_CONSTRAINTS),
  };
}

function pickProvider(): CodingProvider {
  const provider = (process.env.CODE_PROVIDER || "local-shell").toLowerCase();
  if (provider === "cursor") return new CursorCodingProvider();
  return new LocalShellCodingProvider();
}

async function main() {
  const mission = buildCodingMission(readRawGoal());
  const provider = pickProvider();
  console.log(
    JSON.stringify(
      {
        mission: {
          id: mission.id,
          rawGoal: mission.rawGoal,
          workingDirectory: mission.workingDirectory,
          commands: mission.commands,
          constraints: mission.constraints,
        },
        provider: provider.name,
      },
      null,
      2
    )
  );

  const result = await provider.run(mission);
  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
