# automata — LLM-driven Playwright agent

The model proposes **strict JSON actions** (planner + critic each turn); your code executes them with Playwright and applies domain guardrails. Credentials are never sent to the model—only key names.

## Setup

```bash
npm install
```

Install Chromium for Playwright once:

```bash
npx playwright install chromium
```

Copy `.env.example` to `.env` and set `OPENAI_API_KEY` and your demo credentials.

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
| `src/guardrails.ts` | Allowed hostnames |
| `src/logger.ts` | Run logs + screenshots under `runs/` |

Adjust `src/index.ts` (`startUrl`, `allowedDomains`, goal) for your real target site.
