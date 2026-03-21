import "dotenv/config";
import { runLLMAgentTask } from "./agent.js";
import { AgentTask } from "./types.js";

const task: AgentTask = {
  name: "api-signup-demo",
  goal: "Create an account for this browser application using the provided credentials and stop when the dashboard or a clear success message appears.",
  startUrl: "https://example.com",
  allowedDomains: ["example.com"],
  deadlineSeconds: 120,
  maxSteps: 20,
  credentials: {
    email: process.env.DEMO_EMAIL ?? "",
    password: process.env.DEMO_PASSWORD ?? "",
    fullName: process.env.DEMO_FULL_NAME ?? "",
  },
  successHints: [
    "dashboard visible",
    "account created",
    "welcome message",
    "api keys page",
    "logged in state",
  ],
};

async function main() {
  const result = await runLLMAgentTask(task);
  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
