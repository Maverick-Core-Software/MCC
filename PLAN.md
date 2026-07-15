# Venice Pro+ Migration - Build Plan

**Created:** 2026-07-15 by Claude Fable 5 (build-handoff orchestrator)
**Target repos:** multi-repo — each session names its own absolute repo path
**Branch:** main in every repo (no feature branches; changes are additive and env-reversible)
**Design spec:** `C:\Workspace\Active\brain\projects\2026-07-15-venice-migration-design.md`

## Codebase Primer

(Orchestrator-only — never sent to Qwen; session-relevant details are folded into each session.)

- Windows 11, PowerShell. Node 20+ for MCC/grizzly-hcp, Python 3.11+ for agent-os/SEO-Agents.
- Venice API: OpenAI-compatible at `https://api.venice.ai/api/v1`, Bearer `VENICE_API_KEY`.
  Canonical key source: `C:\Users\carte\.env` (63-char value, verified live 2026-07-15).
- Verified Venice model IDs: `zai-org-glm-5-2`, `z-ai-glm-5v-turbo`, `deepseek-v3.2`,
  `deepseek-v4-pro`, `llama-3.3-70b`, `qwen3-6-27b`.
- Rule of the whole build: Venice becomes PRIMARY for non-frontier cloud traffic; the old
  provider stays wired as FALLBACK. Frontier (Anthropic direct, OpenAI Realtime) and local
  llama.cpp (`localhost:8080`) are untouched. Never delete old provider code or keys.
- MCC runs under PM2 (do NOT restart anything — Carter restarts manually later). Orca has a
  live task running; nothing in this plan touches Orca-managed processes.
- Session order: S1 (agent-os) and S4 (grizzly-hcp) and S5 (SEO-Agents) are independent.
  S2 → S3 are ordered (same MCC files). S6 last.
- Phase V (video-model research) is orchestrator-owned frontier work — never dispatched to Qwen.

## Session 1 - agent-os: land the Venice cutover

**Goal:** the uncommitted Venice-primary work in agent-os is committed, residual OpenCode references are removed, tests pass, and a live Venice smoke succeeds.
**Independent:** yes
**Stack / decisions:** Python; repo is `C:\Workspace\Infrastructure\agent-os` (no git remote — local commits only). OpenCode is removed entirely: not a provider, not a fallback. Direct vendor keys are the fallback tier (already implemented in the uncommitted work).

**Tasks:**
1. In `C:\Workspace\Infrastructure\agent-os`, commit ALL currently modified and untracked files as-is (this is prior work being landed, not yours to change). Untracked to include: `scripts/smoke_venice.py`, `memory/SESSION.md`, `docs/Head-Orchestrator/`, `src/kernel/static/head-orchestrator-diagram.html`. Commit message below (first commit).
2. Remove residual OpenCode references: grep the repo for `opencode` (case-insensitive) in `src/` and `config/`. In `src/kernel/model_bridge.py` and `src/kernel/providers.py` there is one reference each — delete the dead code path or comment referring to OpenCode routing (do not leave an `opencode/` model-ref parseable). In `config/model-routing.yaml` the single mention is an explanatory comment — leave comments alone.
3. Update tests that assert OpenCode behavior: `tests/test_cost_tracking.py`, `tests/test_cli.py`, `tests/test_orchestrator.py`, `tests/test_providers.py`, `tests/test_model_bridge.py`, `tests/test_pricing.py` contain `opencode` references. Convert each to the venice/direct equivalent the current router actually supports (`parse_model_ref` has no `opencode/` — tests must not expect it). Run the full suite until green.
4. Run the live smoke: `python scripts/smoke_venice.py` from the repo root (reads `.env` `VENICE_API_KEY`, default model `zai-org-glm-5-2`). It must print a successful chat completion.

**Interfaces (exact spellings):**
- Env: `VENICE_API_KEY`, `VENICE_BASE_URL=https://api.venice.ai/api/v1` (already in `.env`)
- Model refs: `venice/<model-id>`, `direct/<vendor>/<model>`, `local/<model>` — no `opencode/`

**Verification:**
- Run: `python -m pytest -q` - expected: all tests pass, 0 failures
- Run: `python scripts/smoke_venice.py` - expected: non-empty completion text, exit 0
- Run: `git -C C:\Workspace\Infrastructure\agent-os status --short` - expected: clean

**Commit:** first: `feat: venice-primary routing, opencode removed (land prior session work)`; second: `test: sweep residual opencode references, venice/direct equivalents`

## Session 2 - MCC: Venice provider foundation

**Goal:** MCC has a `veniceChat()` provider primitive and Venice config constants; nothing is re-pointed yet.
**Independent:** no (S3 depends on this)
**Stack / decisions:** Node ESM (`.mjs`), repo `C:\Workspace\Active\MCC`. Follow the exact style of the existing provider primitives in `lib/models.mjs` (plain `fetch`, OpenAI-compatible body, error format `` `Venice ${model} ${status}: ...` ``). No new dependencies.

**Tasks:**
1. Modify `lib/config.mjs` — after the `zaiVisionModel` block add Venice constants, all `process.env`-driven with these exact names and defaults:
   - `veniceApiKey` ← `VENICE_API_KEY`, default `''`
   - `veniceBaseUrl` ← `VENICE_BASE_URL`, default `https://api.venice.ai/api/v1`
   - `veniceModel` ← `VENICE_MODEL`, default `zai-org-glm-5-2` (general/planner/review/executor)
   - `veniceVisionModel` ← `VENICE_VISION_MODEL`, default `z-ai-glm-5v-turbo`
   - `veniceQcModel` ← `VENICE_QC_MODEL`, default `llama-3.3-70b` (build QC; NIM has no 3.1-8b twin on Venice)
   - `veniceLocalFallbackModel` ← `VENICE_LOCAL_FALLBACK_MODEL`, default `qwen3-6-27b` (cloud stand-in for local Qwen)
   Also add `export const VENICE_MODELS = [...]` next to `OPENROUTER_MODELS` (leave OPENROUTER_MODELS in place) with entries `{ id, label, tier }`: `zai-org-glm-5-2`/GLM 5.2/cheap, `deepseek-v3.2`/DeepSeek V3.2/cheap, `deepseek-v4-pro`/DeepSeek V4 Pro/premium, `llama-3.3-70b`/Llama 3.3 70B/fast, `qwen3-coder-480b-a35b-instruct-turbo`/Qwen3 Coder/cheap, `kimi-k2-6`/Kimi K2.6/premium.
2. Modify `lib/models.mjs` — add exported `veniceChat(messages, { system, model, signal, maxTokens, temperature })` mirroring `openRouterChat` exactly, but using `veniceBaseUrl`/`veniceApiKey`/`veniceModel` defaults. Import the new constants from `./config.mjs`.
3. Modify `lib/models.mjs` — replace the hardcoded `https://api.anthropic.com/v1/messages` literal in `anthropicChat` with a new `anthropicBaseUrl` constant added to `lib/config.mjs` (env `ANTHROPIC_BASE_URL`, default `https://api.anthropic.com`), URL becomes `` `${anthropicBaseUrl}/v1/messages` ``. Behavior identical.
4. Update `.env.example`: add a `# Venice (Pro+ eval 2026-07 → primary for open-weight cloud traffic)` block listing all six new env vars with defaults shown, `VENICE_API_KEY=` left empty. Then append the real `VENICE_API_KEY` line to the real `C:\Workspace\Active\MCC\.env` by copying the `VENICE_API_KEY=...` line from `C:\Users\carte\.env` (never echo the value to the terminal or commit `.env`).

**Verification:**
- Run: `node --check lib/config.mjs && node --check lib/models.mjs` - expected: no output, exit 0
- Run: `node -e "import('./lib/models.mjs').then(m => m.veniceChat([{role:'user',content:'Reply with the single word pong'}], {maxTokens:16})).then(t => console.log('VENICE OK:', t))"` from the MCC root - expected: `VENICE OK: pong` (or similar single-word reply)
- Run: `git status --short` - expected: only `lib/config.mjs`, `lib/models.mjs`, `.env.example` modified (`.env` is gitignored)

**Commit:** `feat: venice provider primitive + config (pro+ eval, no re-pointing yet)`

## Session 3 - MCC: re-point non-frontier traffic to Venice

**Goal:** every non-frontier cloud call in MCC goes Venice-first with the old provider as in-code fallback; frontier and local paths unchanged.
**Independent:** no (requires Session 2's `veniceChat` — restated below)
**Stack / decisions:** Repo `C:\Workspace\Active\MCC`. Available from Session 2: `veniceChat(messages, { system, model, signal, maxTokens, temperature })` in `lib/models.mjs` (OpenAI-compatible, defaults to `zai-org-glm-5-2`), config constants `veniceApiKey, veniceBaseUrl, veniceModel, veniceVisionModel, veniceQcModel, veniceLocalFallbackModel, VENICE_MODELS` in `lib/config.mjs`. Fallback pattern to copy: the try/catch shape already used in `callLocalModel` in `lib/models.mjs`. Do NOT touch: `anthropicChat` usage as primary planner/workhorse, `localChat`, `callPiRpc`, estimate pipeline, OpenAI Realtime.

**Tasks:**
1. `lib/models.mjs`: (a) in `callLocalModel` and `callClaude`, change the fallback from OpenRouter to Venice-first-then-OpenRouter (Anthropic primary stays; on error try `veniceChat`, and only if Venice also fails try `openRouterChat`; keep the existing console.warn style, tagging which fallback answered). (b) in `callGpt4o`, make `veniceChat` (model `veniceModel`) the primary and the existing `openAiChat` the catch-fallback — same JSON-extraction logic runs on whichever text returns.
2. `lib/chat.mjs`: re-point the two NVIDIA NIM call sites (fetch blocks near lines 403-422 and 606-620, recognizable by `Authorization: Bearer ${nimApiKey}`): primary becomes `veniceChat` with model `veniceQcModel`; the existing NIM fetch moves into the catch as fallback (only attempted when `nimApiKey` is set); the existing OpenRouter fallback at ~420 stays as the last resort. Also re-point the ops editor call at ~line 472 (`openRouterChat(editorMessages, { model: openRouterExecutorModel, ...})`) to `veniceChat` with `veniceModel`, OpenRouter as catch-fallback.
3. `lib/chat.mjs` review-mode streaming (~lines 1001-1025, `useGemini` block): make Venice the primary streaming source — same OpenAI-compatible SSE shape as the existing OpenRouter branch but against `${veniceBaseUrl}/chat/completions` with `veniceApiKey` and model `veniceModel`; keep Gemini as first fallback (when `geminiApiKey` set) and OpenRouter as final fallback. The downstream SSE token handling is provider-agnostic — reuse it untouched.
4. `server.mjs`: the `/models` route (~line 154) currently serves `OPENROUTER_MODELS`/`openRouterModel` — serve `VENICE_MODELS` and `veniceModel` instead (import from `lib/config.mjs`); update the startup console.log at ~line 389 to print the Venice base URL + model alongside OpenRouter. `lib/zai-status.mjs`: point the status probe at `${veniceBaseUrl}/models` with `veniceApiKey` (keep response shape identical so the dashboard indicator works; on Venice failure fall back to the existing Z.AI probe).

**Interfaces (exact spellings):** env names as in Session 2; UI selector ids must be valid Venice model ids (`VENICE_MODELS` from config).

**Verification:**
- Run: `node --check lib/models.mjs && node --check lib/chat.mjs && node --check server.mjs && node --check lib/zai-status.mjs` - expected: exit 0
- Run: `node -e "import('./lib/models.mjs').then(m => m.callGpt4o([{role:'user',content:'Return JSON {\"ok\":true}'}])).then(o => console.log('PLANNER:', JSON.stringify(o)))"` - expected: `PLANNER: {"ok":true}` (proves Venice-primary planner path)
- Confirm by reading the diff: no changes to `anthropicChat` callers as primary, `localChat`, `callPiRpc`.

**Commit:** `feat: venice-first routing for NIM/openrouter/gemini/gpt4o paths, old providers as fallback`

## Session 4 - grizzly-hcp: Venice-default model router

**Goal:** all four model-router roles default to Venice with a working one-retry fallback to the previous Z.AI/DeepSeek routing; `claude-*` escape hatch untouched.
**Independent:** yes
**Stack / decisions:** TypeScript, repo `C:\Workspace\Active\grizzly-hcp`, Vercel AI SDK (`@ai-sdk/openai` `createOpenAI().chat()` — same pattern the file already uses; Venice only implements `/chat/completions`, so `.chat()` is mandatory). No new dependencies.

**Tasks:**
1. Modify `src/agent/model-router.ts`: add Venice constants — `VENICE_BASE_URL` (env, default `https://api.venice.ai/api/v1`), `VENICE_API_KEY` (env), `VENICE_TEXT_MODEL` (env, default `zai-org-glm-5-2`), `VENICE_VISION_MODEL` (env, default `z-ai-glm-5v-turbo`). Change `DEFAULTS` so REASONING/EXTRACTION/CHEAP → `VENICE_TEXT_MODEL` and VISION → `VENICE_VISION_MODEL`. In `getModel`, route any model id NOT matching the `claude-`/`deepseek-`/`gemini-` prefixes through Venice (`createOpenAI({ baseURL: VENICE_BASE_URL, apiKey: VENICE_API_KEY }).chat(modelId)`); throw a clear error if `VENICE_API_KEY` is unset. The existing z.ai branch becomes reachable only via the fallback function below (keep its code).
2. Same file: export `getFallbackModel(role: ModelRole): LanguageModelV3` returning the pre-Venice construction for that role — z.ai base/key with the old `glm-5.2`/`glm-5v-turbo` defaults (honoring the same `MAVERICK_<ROLE>_MODEL` override plus the `deepseek-*`/`claude-*` branches). Add a doc comment: "Venice Pro+ eval 2026-07 — old direct routing kept as fallback; revert = swap DEFAULTS back."
3. Find `getModel` call sites (`grep -rn "getModel(" src/ --include=*.ts`, excluding the router itself) and wrap each LLM invocation that uses the returned model in a one-retry fallback: on any thrown error from the AI SDK call, log a one-line warning naming the role and retry the identical call once with `getFallbackModel(role)`. If call sites share a helper, add the retry there once instead of per-site. Do not change function signatures used by callers.
4. Append `VENICE_API_KEY` + `VENICE_BASE_URL` to `.env` (copy the `VENICE_API_KEY=...` line from `C:\Users\carte\.env`; never echo the value) and document both plus the new defaults in `.env.example` under a `# Venice (Pro+ eval)` comment. Keep all ZAI_*/DEEPSEEK_* entries.

**Verification:**
- Run: `npx tsc --noEmit` - expected: exit 0
- Create a throwaway `scripts/smoke-venice.ts` that calls `generateText` with `getModel('CHEAP')` prompting "Reply with the single word pong", run it with `npx tsx scripts/smoke-venice.ts` - expected: pong. Then delete the script (do not commit it).
- Read the diff: `claude-*` branch byte-identical.

**Commit:** `feat: venice-default model router with z.ai/deepseek fallback (pro+ eval)`

## Session 5 - SEO-Agents-App: env swap to Venice

**Goal:** CrewAI research + exec tiers run on Venice open-weight models; OpenAI keys remain in place as the documented revert path; Gemini/Veo video generation untouched.
**Independent:** yes
**Stack / decisions:** Python + CrewAI (LiteLLM under the hood stays — it is a library, not a routed provider), repo `C:\Workspace\Active\SEO-Agents-App`. The routing hooks already exist in `src/seo_agents/crew.py` (`_llm_kwargs` reads `CREWAI_<TIER>_API_BASE`/`CREWAI_<TIER>_API_KEY`); this session is env + docs only — no Python code changes.

**Tasks:**
1. Edit the real `.env` (never echo or commit values): set `CREWAI_RESEARCH_MODEL=openai/zai-org-glm-5-2`, `CREWAI_EXEC_MODEL=openai/deepseek-v4-pro`, `CREWAI_RESEARCH_API_BASE=https://api.venice.ai/api/v1`, `CREWAI_EXEC_API_BASE=https://api.venice.ai/api/v1`, and set `CREWAI_RESEARCH_API_KEY` and `CREWAI_EXEC_API_KEY` to the value of `VENICE_API_KEY` copied from `C:\Users\carte\.env`. Keep `OPENAI_API_KEY` and all Gemini/Veo vars exactly as they are. Comment out (never blank) any old conflicting values — a blank value in `.env` does not clear anything.
2. Update `.env.example`: document the Venice block with a `# Venice Pro+ eval 2026-07` header, the six vars above with placeholder key, and a `# REVERT: restore CREWAI_*_MODEL to openai/gpt-4o-mini / openai/gpt-4o and remove the *_API_BASE overrides` comment. Ensure no active (uncommented) bogus defaults are introduced — commented lines only for optional values.
3. Live smoke: `python -c "from src.seo_agents.crew import build_research_llm, build_exec_llm; print(build_research_llm().call('Reply with the single word pong')); print(build_exec_llm().call('Reply with the single word pong'))"` (adjust import path if the package requires `pip install -e .` context — run from repo root with the project venv). Both must return text via Venice.

**Verification:**
- Run: the smoke command above - expected: two non-empty replies, no OpenAI endpoints hit
- Run: `git status --short` - expected: only `.env.example` modified (`.env` gitignored)
- Confirm: Gemini/Veo env untouched (`git diff .env.example` shows no GEMINI changes)

**Commit:** `docs: venice env routing for crewai tiers (pro+ eval), revert path documented`

## Session 6 (final) - docs + brain-write

**Goal:** project docs and memory updated. All three targets are REQUIRED.
**Independent:** no (last)

**Tasks:**
1. Update `C:\Workspace\Infrastructure\agent-os\memory\HANDOFF.md` — current state: Venice-primary landed and committed, opencode swept, live smoke green.
2. Append a dated 2026-07-15 entry to `C:\Workspace\Infrastructure\agent-os\memory\JOURNAL.md` (never rewrite history) summarizing Sessions 1-5 across the four repos: Venice primary for non-frontier traffic in agent-os, MCC, grizzly-hcp, SEO-Agents; old providers as fallback; frontier + local untouched; review ~2026-08-15.
3. Update the brain vault project notes — REQUIRED, skipping fails the session: `C:\Workspace\Active\brain\projects\agent-os.md` (Venice cutover landed) AND add a matching dated note of the migration to `C:\Workspace\Active\brain\projects\2026-07-15-venice-migration-design.md` under a new `## Execution log` heading listing each repo's commit hash (`git -C <repo> log -1 --format="%h %s"`).

**Verification:** all four files contain today's (2026-07-15) changes; brain vault commit exists.
**Commit:** in agent-os: `docs: update handoff + journal - venice migration landed`; in brain: `docs: venice migration execution log + agent-os note`

## Phase V - Video generation model research (ORCHESTRATOR ONLY — never dispatch to Qwen)

Research-only; zero code or config edits. SEO-Agents currently generates videos with Google Veo 3 (`GEMINI_VEO_MODEL=veo-3.0-generate-001`); quality is good but Carter sees visible "misses". Deliverable: a findings report comparing the current best video-generation models (July 2026) — candidates to cover at minimum: newer Veo releases, OpenAI Sora, Kling, Runway Gen-4+, MiniMax/Hailuo, Wan, and whatever Venice offers for video (it has a video quote API — pricing/quality/API maturity). Compare on: output quality/artifact rate for short marketing/SEO clips, API access + pricing, generation speed, prompt adherence. End state: report to Carter; he decides whether to test alternatives or keep Veo. No edits to SEO-Agents in this phase regardless of findings.

## Revisions

(empty)
