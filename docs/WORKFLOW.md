# End-to-end workflow (read with inline comments in `src/`)

This matches the order code runs when you execute `npm run dev` or `npm start`.

1. **`src/index.ts`** — Loads environment variables (`dotenv`). Builds one `AgentTask`. Calls `runLLMAgentTask(task)`. Prints JSON and sets exit code.

2. **`src/agent.ts` → `runLLMAgentTask`** — Orchestrates everything:
   - Creates a `Logger` (disk + console).
   - Creates two **`JsonThread`** instances (OpenAI): **planner** and **critic** (separate conversation memory).
   - **`createBrowserSession()`** (`chrome.ts`): attaches to or launches Chrome, returns `page` + `dispose`.
   - **`ensureAllowedUrl`** on `task.startUrl` (guardrails).
   - **`page.goto(task.startUrl)`** — first navigation.
   - **Loop** until `maxSteps`, `deadline`, or stop condition:
     - **`observePage(page)`** — snapshot “before”.
     - **`planNextAction(...)`** — LLM returns one `PlannedAction`.
     - If `done` → save storage state, return success.
     - Else **`executeAction`** — Playwright performs the action; errors become text for the critic, not necessarily a crash.
     - **`observePage`** again — snapshot “after”.
     - **`critiqueStep`** — LLM judges continue / success / blocked / failed.
     - Append **`StepRecord`** to `history` for the next planner turn.
   - **`finally` → `dispose()`** — disconnect or close browser per mode (CDP leaves Chrome running).

3. **`src/chrome.ts` → `createBrowserSession`** — Picks CDP vs persistent profile vs ephemeral launch; returns a **`Page`** to automate.

4. **`src/observer.ts` → `observePage`** — Runs code **inside** the page to extract text lists (buttons, links, inputs, …) for the LLM.

5. **`src/llmAgent.ts`**
   - **`planNextAction`** — Sends task + observation + recent history to the planner thread; validates JSON with **`validateAction`**.
   - **`critiqueStep`** — Sends before/after + action + result to the critic thread.

6. **`src/llm.ts` → `JsonThread.ask`** — One OpenAI **Responses** call with **strict JSON schema**; chains **`previous_response_id`** for memory.

7. **`src/executor.ts` → `executeAction`** — Trusted switch: `goto` / `click` / `fill` / `press` / `wait` / `done`. Re-checks URL allowlist. Screenshots after most actions.

8. **`src/guardrails.ts` → `ensureAllowedUrl`** — Throws if hostname not in `allowedDomains`.

9. **`src/logger.ts`** — Append-only `run.log`, screenshot path list, error list.

10. **`src/types.ts`** — Shapes passed between the steps above.
