export type CodingMission = {
  id: string;
  rawGoal: string;
  workingDirectory: string;
  commands: string[];
  constraints: string[];
};

export type CodingCommandResult = {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type CodingExecutionResult = {
  success: boolean;
  provider: string;
  missionId: string;
  summary: string;
  commandResults: CodingCommandResult[];
};

export interface CodingProvider {
  name: string;
  run(mission: CodingMission): Promise<CodingExecutionResult>;
}
