/**
 * =============================================================================
 * RUN LOGGING — one folder on disk per agent run
 * =============================================================================
 *
 * Every `runLLMAgentTask` creates `runs/<sanitized-task-name>/<timestamp>/`:
 *   - `run.log` — append-only text log (mirror of important console lines).
 *   - PNG files — paths collected in memory and listed in `ExecutionResult.screenshots`.
 *
 * Intentionally does **not** write raw password values (executor logs credential *keys* only).
 */
import fs from "node:fs";
import path from "node:path";

/**
 * Per-run logger: console + `run.log` + screenshot path bookkeeping.
 */
export class Logger {
  /** Absolute path to this run’s directory (created in the constructor). */
  readonly dir: string;
  /** Absolute paths of PNGs saved during this run. */
  readonly screenshots: string[] = [];
  /** Collected execution error messages (shown again in `ExecutionResult`). */
  readonly errors: string[] = [];

  /**
   * Creates the run directory under `runs/<safeTaskName>/<Date.now()>`.
   *
   * @param taskName — Used for folder naming (non-alphanumeric → `_`).
   */
  constructor(private readonly taskName: string) {
    const safe = taskName.replace(/[^a-zA-Z0-9-_]/g, "_");
    this.dir = path.join("runs", safe, String(Date.now()));
    fs.mkdirSync(this.dir, { recursive: true });
  }

  /**
   * Prints to stdout and appends a timestamped line to `run.log`.
   *
   * @param message — Free-form log line (avoid secrets).
   */
  log(message: string): void {
    const line = `[${this.taskName}] ${message}`;
    console.log(line);
    fs.appendFileSync(path.join(this.dir, "run.log"), `${new Date().toISOString()} ${line}\n`);
  }

  /**
   * Prints to stderr, pushes to `errors[]`, and appends to `run.log`.
   *
   * @param message — Error description (e.g. Playwright exception message).
   */
  error(message: string): void {
    this.errors.push(message);
    const line = `[${this.taskName}] ERROR: ${message}`;
    console.error(line);
    fs.appendFileSync(
      path.join(this.dir, "run.log"),
      `${new Date().toISOString()} ${line}\n`
    );
  }

  /**
   * Builds an absolute `.png` path under this run’s directory (file not created until screenshot).
   *
   * @param basename — Filename without extension (e.g. `step-1730000000`).
   */
  screenshotPath(basename: string): string {
    return path.join(this.dir, `${basename}.png`);
  }

  /**
   * Records a screenshot path after Playwright writes the file.
   *
   * @param filePath — Typically the return value of `screenshotPath`.
   */
  addScreenshot(filePath: string): void {
    this.screenshots.push(filePath);
  }
}
