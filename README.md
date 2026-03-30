# automata — LLM-driven Playwright agent

The model proposes **strict JSON actions** (planner + critic each turn); your code executes them with Playwright and applies domain guardrails. Credentials are never sent to the model—only key names.

- Roadmap: **`docs/ROADMAP.md`**
- **End-to-end flow (start → finish):** **`docs/WORKFLOW.md`** (matches inline comments in `src/`)
- Chrome: **`docs/CHROME_SETUP.md`** — User Data + profile, or CDP (Chrome stays open after the run)

## Setup

```bash
npm install
npx playwright install chrome
```

Copy `.env.example` to `.env`, set `OPENAI_API_KEY`, and choose a Chrome mode (default: launch **Google Chrome** headed).

## Run

```bash
npm run dev
```

Or `npm run build` then `npm start`.

Mission from CLI:

```bash
npm start -- "Create Render web service and add env vars"
```

Set `ALLOWED_DOMAINS` in `.env` (required) and optionally `START_URL`.
Phase C starter supports `VISION_MODE=off|every|fallback` (`every` captures viewport screenshots into observation payload metadata).
Phase E coordinate accuracy is now enabled with environment options `VISION_CLICK_RETRIES` (default 3) and `VISION_CLICK_JITTER_PX` (default 4), plus a hybrid `elementFromPoint` fallback for vision clicks.

## Coding lane (scaffold)

Run coding-task commands through a provider abstraction:

```bash
npm run code -- "Run checks before commit"
```

Configure in `.env`:

- `CODE_PROVIDER=local-shell|cursor` (`cursor` is a placeholder adapter for future integration)
- `CODING_WORKDIR=.` (or repo path)
- `CODING_COMMANDS=npm run build,npm test` (comma-separated command list)

## Layout

| File | Role |
|------|------|
| `src/llm.ts` | Responses API + structured JSON + `previous_response_id` threading |
| `src/llmAgent.ts` | Planner / critic prompts and action validation |
| `src/observer.ts` | DOM summary for the model |
| `src/executor.ts` | Playwright execution only |
| `src/agent.ts` | Main loop |
| `src/chrome.ts` | Real Chrome: launch / persistent profile / CDP (`CHROME_*` env) |
| `src/guardrails.ts` | Allowed hostnames |
| `src/logger.ts` | Run logs + screenshots under `runs/` |
| `src/coding/*` | Coding mission/provider scaffold (`local-shell` working, `cursor` placeholder) |

Mission intake is now wired in `src/mission.ts` + `src/index.ts`; use CLI text and env config instead of editing code per run.
