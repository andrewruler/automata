import { CodingExecutionResult, CodingMission, CodingProvider } from "./types.js";

/**
 * Phase J placeholder.
 *
 * This adapter is where Cursor/MCP integration should be implemented
 * once you decide on transport/auth and allowed operations.
 */
export class CursorCodingProvider implements CodingProvider {
  readonly name = "cursor";

  async run(mission: CodingMission): Promise<CodingExecutionResult> {
    return {
      success: false,
      provider: this.name,
      missionId: mission.id,
      summary:
        "Cursor provider is not implemented yet. Use CODE_PROVIDER=local-shell for now.",
      commandResults: [],
    };
  }
}
