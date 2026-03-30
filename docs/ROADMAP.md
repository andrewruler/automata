# Automata roadmap — real Chrome, dual vision, memory

End state: you type a **high-level task** (e.g. *“Create a Render backend service and create/store env vars”*), and a **headed** agent drives **your Google Chrome profile**, step by step, using **HTML + vision** together, **rolling plans**, and **persistent memory**—with guardrails, verification, and auditable logs.

This document is the segment plan from **today’s repo** to that target.

---

## 1. Baseline (what you have now)

| Piece | Location / behavior |
|--------|---------------------|
| Loop | `src/agent.ts` — observe → plan → execute → critic |
| Browser | **Google Chrome** by default (`src/chrome.ts`): launch, `CHROME_USER_DATA_DIR`, or `CHROME_CDP_URL`; `headless` only if `HEADLESS=true` |
| Observation | **HTML-ish summary** only (`src/observer.ts`) |
| LLM | Responses API + structured JSON (`src/llm.ts`, `src/llmAgent.ts`) |
| Actions | Selector-based (`src/executor.ts`) |
| Safety | Domain allowlist (`src/guardrails.ts`), local credential keys |
| Persistence | Run logs + screenshots; `storageState` on some success paths |

**Gaps vs target:** no real Chrome profile, no vision path, no explicit modality router, no milestone task intake, no long-horizon memory layer beyond API thread IDs, no coordinate/refinement pipeline, no Render-specific skill boundaries.

---

## 2. Target definition (done when…)

1. **Input**: One natural-language **mission** (multi-step), not only a fixed `AgentTask` in code.
2. **Browser**: **Google Chrome**, **headed by default**, using **your profile** (or a dedicated agent profile you choose), launched or attached in a documented way.
3. **Dual system**: Each step can use **DOM/HTML observation** and/or **screenshot vision**, chosen by policy + model hint; executor prefers **semantic/DOM** actions when confident.
4. **Planning**: **High-level milestones** (optional, refreshable) + **single next action** every iteration (not a giant fixed tree).
5. **Memory**: Short-term via **conversation threading**; mid/long-term via **rolling summary** (and optional retrieval later).
6. **Robustness**: **Verification** after actions; **retries** and bounded **coordinate refinement** when using vision.
7. **Secrets**: Env vars and API keys **never** sent to the model as values; **keys names + vault/local resolution** only.
8. **Ops**: You can **watch** the browser, read **run logs**, and **replay** from screenshots + structured history.

---

## 3. Architecture (target)

```
                    ┌─────────────────────────────────────┐
                    │  Mission intake (NL → milestones)   │
                    └─────────────────┬───────────────────┘
                                      ▼
┌──────────┐   ┌──────────────────────────────────────────────────┐
│ Memory   │   │  Main loop (deadline, max steps)                  │
│ layer    │◄──┤  1. Observe HTML (+ optional screenshot)           │
│ (thread  │   │  2. Plan next action (+ modality: html|vision|hybrid)│
│ + summary│   │  3. Execute (locator | normalized bbox pipeline)    │
│ + files) │   │  4. Verify                                          │
│          │   │  5. Critic / adjust memory                         │
└──────────┘   └──────────────────────────────────────────────────┘
                                      │
                    ┌─────────────────┴─────────────────┐
                    ▼                                   ▼
            HTML observer                      Vision observer
            (extend observer.ts)              (screenshot + schema)
                    │                                   │
                    └─────────────────┬─────────────────┘
                                      ▼
                              Real Chrome (profile)
                              Playwright: channel or CDP
```

---

## 4. Phased plan

### Phase A — Real Chrome + your profile (foundation) ✅

**Goal:** Same automation stack, but **not** bundled Chromium; **headed**; profile documented.

**Work items**

- [x] Add config: `CHROME_CHANNEL=chrome` or `CHROME_CDP_URL=http://127.0.0.1:9222`.
- [x] **Option A (recommended first):** `chromium.launch({ channel: "chrome", headless: false, ... })` — uses installed Chrome; simplest.
- [x] **Option B (true “my profile”):** Document Chrome start flags (`--remote-debugging-port=9222`, `--user-data-dir=...`, profile directory). Use `chromium.connectOverCDP()` in `agent.ts`; attach to existing default context or pick target page.
- [x] **Security doc:** Agent profile vs daily profile; why isolating an `automata` profile is safer than automating your personal profile with secrets.
- [x] Env: `HEADLESS=false` default; fail fast if Chrome not found when `channel: "chrome"`.

**Exit criteria:** One command runs the current demo **in visible Google Chrome** (profile strategy A or B written and working).

**Implemented:** `src/chrome.ts`, `docs/CHROME_SETUP.md`, `.env.example`; `src/agent.ts` uses `createBrowserSession()`. Extra: `CHROME_USER_DATA_DIR` → `launchPersistentContext`.

---

### Phase B — Mission intake (NL task → structured mission)

**Goal:** Replace or wrap hardcoded `AgentTask` in `index.ts` with **CLI arg / stdin / small config file**: free text → structured object.

**Work items**

- [ ] Schema: `Mission { id, rawGoal, milestones[], allowedDomains[], deadlineSeconds, maxSteps, credentialKeyNames[], constraints }`.
- [ ] One LLM call (structured output) or template: **raw goal → ordered milestones** (soft plan; can be revised later).
- [ ] Map milestones into current `AgentTask`-compatible fields (`goal`, `successHints`, `startUrl` either fixed per provider e.g. `render.com` or first milestone “navigate to X”).
- [ ] Guardrails: **allowedDomains** must be explicit for any navigation (no LLM-chosen open internet by default).

**Exit criteria:** Running `npm start -- "Create Render web service and set env vars"` produces a mission object and starts the loop with correct allowlist (you still manually set domains in v1 if needed).

---

### Phase C — Dual observation (HTML + vision)

**Goal:** Every loop tick can build **`ObservationBundle`**: `{ html: PageObservation, vision?: VisionFrame }`.

**Work items**

- [ ] Types in `types.ts`: `VisionFrame { imageBase64 | path, width, height, captureKind: "viewport" | "element" }`.
- [ ] `observePage` stays; add `captureViewportScreenshot(page)` → buffer/path + dimensions.
- [ ] Policy: `alwaysVision`, `onDemand`, `everyNSteps`, `onHtmlLowConfidence` (start with **every step optional** + env `VISION_MODE=off|every|fallback`).
- [ ] Token/cost: downscale JPEG or max width for API; log vision bytes per step.

**Exit criteria:** Planner can receive **both** HTML summary and **one** viewport image per step when enabled.

---

### Phase D — Modality-aware planner + executor

**Goal:** Model returns actions that say whether to use **selector** or **normalized bbox** (or both as hint).

**Work items**

- [ ] Extend `PlannedAction` (or parallel union types): e.g. `executionMode: "dom" | "vision"`, `bboxNorm?: { x1,y1,x2,y2 }` in 0–1, `clickPointNorm?: { x,y }`.
- [ ] `executor.ts`:  
  - **dom:** current locators.  
  - **vision:** map normalized coords → viewport pixels using **screenshot dimensions**; `page.mouse.click` (or locator from CDP `DOM.getNodeForLocation` / `elementFromPoint` if you add a small bridge).  
- [ ] **Hybrid path:** vision bbox center → `elementFromPoint` in page → if element, **click via DOM**; else raw mouse.
- [ ] Planner instructions: prefer **dom** when observation matches; vision for unknown/custom UI.

**Exit criteria:** On a page with a button hard for text selectors, vision path can click successfully **with verification** (URL or observation change).

---

### Phase E — Coordinate accuracy subsystem

**Goal:** Reduce flake from DPI, crop mismatch, and model bbox error.

**Work items**

- [ ] Prompt contract: all vision geometry **normalized to the image sent**; include **explicit width × height** in payload.
- [ ] Click **inside bbox** with jitter; optional **second pass** crop + re-ask for tight bbox.
- [ ] After click: **verify** (timeout + observation diff); on failure, **spiral nudge** or one **re-prompt** with new screenshot (max K tries).
- [ ] Document Windows **display scaling** (capture path must match mouse mapping—use same coordinate space as Playwright’s `page.screenshot` + `page.mouse`).

**Exit criteria:** Documented invariants + retry metrics in logs; measurable drop in misclick rate on a fixed test page.

---

### Phase F — Memory layer

**Goal:** Long tasks don’t rely only on raw step history.

**Work items**

- [ ] **Short-term:** Keep `previous_response_id` threads (planner / critic / optional “strategist”); define when to **fork** vs **continue** thread after errors.
- [ ] **Rolling summary:** Every N steps or on milestone boundary, LLM updates `memory.md` or JSON: *done, current milestone, blockers, env vars names created, URLs*. Inject summary into planner payload (bounded tokens).
- [ ] **Artifacts:** Write milestone state under `runs/.../state.json` for resume (future phase: true resume).
- [ ] Optional later: embeddings / vector store for “where did we store X” — **not required** for first Render demo.

**Exit criteria:** 30+ step run still gets coherent next actions; summary file readable by you post-run.

---

### Phase G — Human-like pacing (optional layer)

**Goal:** Less bot-obvious **timing**; does not replace Chrome/CDP reality.

**Work items**

- [ ] Configurable delays before/after actions; random jitter.
- [ ] Optional: smooth mouse move (only matters for `page.mouse` / vision path).
- [ ] **Never** block verification on “fake human” delay—pacing wraps around stable waits.

**Exit criteria:** Tunable `HUMAN_DELAY_MS` without breaking correctness.

---

### Phase H — Render (and similar) “skill” boundaries

**Goal:** Your example task works **reliably enough** to demo, without pretending full unattended production.

**Work items**

- [ ] **Allowlist** `render.com` (and subdomains as needed) explicitly.
- [ ] **Success hints** and **milestone text** tuned for Render (create service, env group, env vars).
- [ ] **Blocked** handling: MFA, email verify, CAPTCHA → critic `blocked`, clean stop + summary.
- [ ] **Env vars:** model only outputs **names**; values from `.env` / OS env / secret manager you wire in executor (e.g. `fill` with `credentialKey` pattern extended to `envVarKey`).
- [ ] **Rate limits:** backoff and max retries on navigation.

**Exit criteria:** Scripted mission “create service + add env vars” completes **or** stops with an explicit **blocked** reason you can act on manually—no silent hang.

---

### Phase I — Operator experience & safety

**Goal:** You trust running it on your machine.

**Work items**

- [ ] **Big red stop:** global timeout, Ctrl+C handling, optional “pause between steps” debug flag.
- [ ] **Audit trail:** single `run.jsonl` with observation hashes, actions, modality, screenshots paths.
- [ ] **README:** Chrome profile setup, env vars table, legal/ToS reminder for third-party sites.
- [ ] **No secret logging:** redact fills in logs (you already avoid sending secrets to LLM; ensure logger never prints values).

**Exit criteria:** Another person (you in 6 months) can run and understand a run without reading code.

---

## 5. Suggested order of execution

1. **A** (Chrome) — unblocks realistic fingerprint and profile.  
2. **B** (Mission intake) — so you’re not editing `index.ts` per task.  
3. **C + D** (Dual observe + modality executor) — core technical lift.  
4. **E** (Coordinate pipeline) — makes vision usable.  
5. **F** (Memory) — needed before long Render flows.  
6. **H** (Render-specific) — vertical slice on top of the stack.  
7. **G** (Pacing) and **I** (Ops) — parallel or after first vertical slice.

---

## 6. Cost & model strategy (operational plan)

| Role | Suggestion |
|------|------------|
| Milestone intake / summary | Strong model, **infrequent** |
| Per-step planner + critic (text + optional image) | Strong when image included; **cheap text-only** variant when `VISION_MODE=off` or HTML-only step |
| Vision bbox refinement | **Smaller / cheaper** vision model on **cropped** image when you split passes |

Instrument **tokens + image count per run** in `Logger` so you can tune policy.

---

## 7. Risks (explicit)

| Risk | Mitigation |
|------|------------|
| Render or other sites block automation | Official API/CLI where possible; human handoff on `blocked`; don’t rely on evasion |
| Profile corruption / leaked secrets | Dedicated Chrome user data dir for automata; minimal extensions |
| Vision cost/latency | HTML-first policy; crop; skip vision steps when confident |
| Coordinate drift | Normalized coords + verify + hybrid `elementFromPoint` |
| LLM schema drift | Keep structured outputs; version schemas |

---

## 8. Files you will likely add or split

| New / changed | Purpose |
|---------------|---------|
| `src/chrome.ts` | ✅ Launch / persistent profile / CDP (`createBrowserSession`) |
| `src/mission.ts` | NL → `Mission` + milestones |
| `src/observationBundle.ts` | Compose HTML + vision |
| `src/visionExecutor.ts` | Normalized bbox → click + verify |
| `src/memory.ts` | Summary file + inject into prompts |
| `src/types.ts` | Mission, modalities, bbox types |
| `docs/CHROME_SETUP.md` | Profile + debugging port |
| `docs/ROADMAP.md` | This plan |
| `docs/WORKFLOW.md` | Start-to-finish execution order (companion to inline `src/` comments) |

---

## 9. Definition of “segment complete”

You can run **one command** with a **natural-language mission**, watch **Chrome (your profile strategy)** perform **multiple milestones** toward **Render backend + env vars**, using **HTML-first automation with vision fallback**, **headed**, with **memory summary** updated along the way, and end with **success** or a **clear blocked/failed** outcome plus **artifacts under `runs/`**.

Anything beyond that (full unattended production, every edge UI, legal guarantees) is **out of scope** for this segment but can be a later roadmap.
