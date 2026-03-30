import { spawn } from "node:child_process";
import {
  CodingCommandResult,
  CodingExecutionResult,
  CodingMission,
  CodingProvider,
} from "./types.js";

function runCommand(command: string, cwd: string): Promise<CodingCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", ["-lc", command], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        command,
        exitCode: code ?? 1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
}

export class LocalShellCodingProvider implements CodingProvider {
  readonly name = "local-shell";

  async run(mission: CodingMission): Promise<CodingExecutionResult> {
    const commandResults: CodingCommandResult[] = [];
    for (const command of mission.commands) {
      const result = await runCommand(command, mission.workingDirectory);
      commandResults.push(result);
      if (result.exitCode !== 0) {
        return {
          success: false,
          provider: this.name,
          missionId: mission.id,
          summary: `Stopped at failing command: ${command}`,
          commandResults,
        };
      }
    }

    return {
      success: true,
      provider: this.name,
      missionId: mission.id,
      summary: "All configured coding commands completed successfully.",
      commandResults,
    };
  }
}
