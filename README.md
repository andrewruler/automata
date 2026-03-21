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

Adjust `src/index.ts` (`startUrl`, `allowedDomains`, goal) for your real target site.
