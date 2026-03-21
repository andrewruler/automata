import fs from "node:fs";
import path from "node:path";

export class Logger {
  readonly dir: string;
  readonly screenshots: string[] = [];
  readonly errors: string[] = [];

  constructor(private readonly taskName: string) {
    const safe = taskName.replace(/[^a-zA-Z0-9-_]/g, "_");
    this.dir = path.join("runs", safe, String(Date.now()));
    fs.mkdirSync(this.dir, { recursive: true });
  }

  log(message: string): void {
    const line = `[${this.taskName}] ${message}`;
    console.log(line);
    fs.appendFileSync(path.join(this.dir, "run.log"), `${new Date().toISOString()} ${line}\n`);
  }

  error(message: string): void {
    this.errors.push(message);
    const line = `[${this.taskName}] ERROR: ${message}`;
    console.error(line);
    fs.appendFileSync(
      path.join(this.dir, "run.log"),
      `${new Date().toISOString()} ${line}\n`
    );
  }

  screenshotPath(basename: string): string {
    return path.join(this.dir, `${basename}.png`);
  }

  addScreenshot(filePath: string): void {
    this.screenshots.push(filePath);
  }
}
