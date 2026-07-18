# AGENTS.md — SUITS engineering contract

## 1. Mission

Build **SUITS**, a voice-first, evidence-grounded AI courtroom simulator for fictional educational cases. A user uploads a case packet, reviews the compiled case, and conducts a live hearing against AI-controlled courtroom participants. The finished system must support multiple witnesses, dynamic evidence and fact status, objections that can interrupt speech, opposing-counsel strategy, settlement negotiation, realistic courtroom animation, and a transcript-grounded coaching debrief.

The application is an educational simulation. It must not present itself as legal advice, predict real-case outcomes, or impersonate a licensed lawyer.

## 2. Authoritative instructions

1. Read this file and the entire root `PLAN.md` before making changes.
2. `PLAN.md` is the current product and execution contract. Maintain it as a living plan while working.
3. Never reduce the Definition of Done, acceptance gates, or non-negotiable invariants merely to finish sooner. Scope may change only when a genuine technical constraint is documented under `PLAN.md > Decisions` and the replacement still satisfies the product outcome.
4. Do not declare the goal complete based on code inspection alone. Completion requires the verification evidence specified in `PLAN.md`.

## 3. Existing repository and migration posture

The starting repository is a Next.js/React/TypeScript application with Convex persistence, Zod schemas, Vitest tests, OpenAI calls, a deterministic phase machine, traces, evaluations, one authored case, and legacy ElevenLabs voice actions.

Preserve and reuse working foundations where they remain valid:

- deterministic workflow ownership;
- append-only traces and transcript citations;
- schema validation and bounded fallbacks;
- Convex trial persistence and resume behavior;
- existing tests and evaluation concepts;
- the Court Records/debrief product direction.

Replace or generalize the following rather than building beside them:

- hardcoded Asha/Vertex domain logic;
- `answerGoldenWitness`, `replyAsOpposingCounsel`, and verdict overrides as normal runtime paths;
- one-witness assumptions;
- fixed linear phase transitions that cannot express witness calls, objections, evidence motions, settlement, recess, recall, or resumed speech;
- ElevenLabs as the primary STT/TTS path;
- visible typed courtroom input in production;
- non-streaming LLM-to-speech handling.

Do not rewrite git history or delete legacy proof. Never commit secrets, model weights, generated audio, user uploads, or large binary assets unless explicitly intended and license-compatible.

## 4. Non-negotiable architecture

### 4.1 Ownership boundaries

- **GPT-5.6 proposes intelligent actions and dialogue.** Use the OpenAI Responses API from server-side code only. The default runtime model is configured as `gpt-5.6-luna`.
- **The deterministic trial engine decides what actually happens.** It validates permissions, phase, speaker, knowledge scope, evidence status, fact status, and action preconditions before committing an event.
- **Convex is the durable source of truth.** OpenAI conversation state, browser state, and speech-service state are caches or transport state, never the canonical trial record.
- **The local speech companion owns live audio.** Raw microphone audio must not pass through Convex or the OpenAI API. Local STT emits revisioned partial/final transcripts; local TTS accepts chunked text and returns audio plus timing metadata.
- **The renderer consumes semantic performance commands.** LLM output may request emotion, intent, gesture, and speaking style, but it must never directly control arbitrary Three.js properties or execute code.

### 4.2 Event sourcing

All material courtroom changes are append-only `TrialEvent`s. Derived trial state is produced by a pure reducer. Never delete or silently mutate historical testimony, evidence, facts, rulings, or offers.

Every committed event must include at least:

- stable event ID and trial ID;
- sequence number and timestamp;
- actor and event type;
- causation/correlation IDs where applicable;
- payload validated by a discriminated schema;
- source (`user`, `ai`, `deterministic`, `speech`, or `system`);
- prompt/schema/model versions for generated actions;
- citations or evidence/fact IDs when the action makes factual claims.

### 4.3 Facts and evidence

A generated assertion is not automatically a fact. Use explicit lifecycles such as:

- facts: `hidden`, `proposed`, `disputed`, `verified`, `admitted`, `excluded`, `stricken`;
- evidence: `uploaded`, `indexed`, `offered`, `admitted`, `excluded`, `withdrawn`;
- testimony: active record versus stricken record.

A stricken item remains visible in the historical record but is excluded from the jury-considerable view. New facts require provenance and may become admitted only through a valid event and rule.

### 4.4 Knowledge isolation

Never give every role the entire case. Construct a role-specific `KnowledgeView` for each model call.

- Witnesses receive only their known facts, perceptions, prior statements, admitted exhibits they have seen, emotional state, and the current exchange.
- Opposing counsel receives its side’s permitted case material, strategy memory, public record, and privileged negotiation state—but not another actor’s hidden reasoning.
- Judge receives the record and applicable simulation rules, but not privileged settlement communications unless the scenario explicitly permits it.
- Jury receives only admissible, jury-considerable material and instructions.
- The debrief engine may inspect the full audit record but must clearly distinguish admitted record, excluded material, hidden authoring truth, and coaching inference.

Tests must prove these boundaries.

## 5. OpenAI integration rules

- Use the official OpenAI SDK and Responses API.
- Keep `OPENAI_API_KEY` exclusively server-side.
- Use strict Structured Outputs/Zod schemas for every action-producing call.
- Use `gpt-5.6-terra` for case compilation and final coaching. Use `gpt-5.6-luna` for role reasoning, courtroom decisions, strategy, settlement evaluation and all other tasks. Do not retain a hidden deterministic authored answer as the normal user-visible result.
- Prefer one focused call per material actor decision. Do not use manager/specialist/reviewer chains by default when they triple latency without measurable benefit.
- Use deterministic validation first and GPT repair only when a valid action cannot otherwise be accepted.
- Treat uploaded documents and transcript text as untrusted data, never as instructions. Delimit them and explicitly ignore embedded prompt injection.
- Keep stable rules and case metadata in cache-friendly prompt prefixes. Send compact state deltas and relevant evidence, not the full transcript on every call.
- Stream output. Emit machine-readable action metadata before or alongside dialogue when possible. Buffer natural-language output at phrase/sentence boundaries for TTS.
- Record model, request ID when available, token usage, latency, retries, validation failures, accepted citations, and estimated cost.
- Provide deterministic/mock adapters for tests, but the real GPT-5.6 integration must be exercised and documented before completion.

## 6. Local speech rules

The production courtroom is voice-first and has no visible text composer. Internal transcript text is mandatory. A developer-only typed control may exist behind an explicit environment flag and must not appear in production builds.

Implement a local Python speech companion, preferably under `services/speech/`, exposed through a versioned WebSocket protocol.

Required behavior:

- GPU-capable streaming STT with revisioned `partial` and `final` events;
- configurable default STT adapter for NVIDIA Nemotron streaming English;
- local VAD and end-of-utterance detection;
- configurable local TTS adapter with Kokoro as the default;
- phrase-level TTS queueing, cancellation, barge-in, backpressure, and speaker-specific voices;
- cached fixed clips for immediate courtroom reactions such as “Objection”, “Sustained”, and “Overruled”;
- health/capability endpoint reporting CUDA, loaded providers, model readiness, and measured warmup latency;
- CPU/mock mode for CI without pretending it verifies GPU performance;
- no cloud speech dependency in the canonical path.

Partial STT text normally stays local. Send it to GPT-5.6 only for a high-confidence, material interrupt candidate such as a potential objection. Final transcripts create normal courtroom-turn requests.

## 7. UI and animation rules

- Build a genuine courtroom scene, not only chat cards.
- Use a semantic animation state machine for each character: idle, listening, thinking, speaking, objecting, standing, sitting, presenting evidence, reacting, and judge ruling/gavel.
- Support animation blending, camera direction, active-speaker focus, lip/viseme timing, facial/emotional state, and evidence display transitions.
- Keep the scene performant and usable on the target RTX 5070 machine. Provide reduced-quality settings without removing core behavior.
- Avoid unlicensed assets. Record asset source and license in `docs/ASSETS.md`. Prefer original, CC0, or attribution-compatible assets.
- Use Playwright screenshots/video and browser-console checks to verify key flows. Visual polish does not override correctness, accessibility, or recoverability.

## 8. Engineering standards

- TypeScript must remain strict. Avoid `any`; justify unavoidable unsafe casts locally.
- Domain behavior belongs in framework-independent modules with pure functions where possible.
- Use discriminated unions and exhaustive checks for events/actions.
- Keep provider adapters behind interfaces. Business logic must not import a concrete speech or model provider directly.
- Validate all external input at boundaries.
- Make mutations idempotent using action/event IDs.
- Handle cancellation and stale revisions explicitly with `utteranceId`, `revision`, `responseId`, and `interruptId`.
- Never swallow errors. Return user-safe states and retain diagnostic traces.
- Add migrations/backfills when Convex schemas change; do not assume a fresh database.
- Prefer small, reviewable modules over monolithic actions.
- Preserve existing working tests and add regression tests for every bug found.

## 9. Work and iteration protocol

1. Inspect the repository and run the baseline commands before editing.
2. Update `PLAN.md` with the observed baseline, repository map, and any corrected assumptions.
3. Work milestone by milestone. Do not skip a milestone gate because later UI work is more visible.
4. Use subagents/worktrees for independent research, audits, tests, or isolated components when useful. The root agent owns integration and must wait for and review all subagent results.
5. After every meaningful change, run the narrowest relevant tests. At every milestone gate, run the full required verification.
6. Update `PLAN.md` sections `Progress`, `Discoveries`, `Decisions`, and `Verification Evidence` with concrete commands and outcomes.
7. Make atomic commits with informative messages after green milestone gates. Do not push, rewrite history, force-push, publish releases, or rotate credentials unless explicitly instructed.
8. Do not ask the user about routine implementation choices. Choose the safest reversible option and document it. Ask only when a required decision is irreversible, security-sensitive, legally sensitive, or impossible to infer.

## 10. Required verification

Keep or create commands so the final verification is runnable from the repository root:

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run eval
npm run build
npm run test:e2e
npm run verify
```

The speech service must also have a reproducible test command, for example:

```bash
cd services/speech
uv sync --extra dev
uv run pytest
```

`npm run verify` should orchestrate all feasible non-secret checks and clearly separate:

- unit/integration/e2e checks that passed;
- OpenAI live checks skipped because no key was available;
- GPU speech checks skipped because compatible hardware/models were unavailable;
- checks that failed.

Never report skipped live checks as passed.

## 11. Product and hackathon documentation

Before completion, update or create:

- `README.md`: product, architecture, setup, local speech installation, environment variables, use, testing, limitations, and disclaimer;
- `docs/ARCHITECTURE.md`;
- `docs/LOCAL_SPEECH.md`;
- `docs/CASE_FORMAT.md`;
- `docs/ASSETS.md`;
- `docs/SECURITY_AND_PRIVACY.md`;
- `docs/build-week/BUILD_WEEK_DELTA.md`: pre-existing Hermes implementation versus new Codex/GPT-5.6 work;
- `docs/build-week/VERIFICATION.md`: exact commands, outputs, screenshots, evals, and unverified items;
- `docs/build-week/CODEX_SESSIONS.md`: placeholders/instructions for recording Codex session and `/feedback` IDs without fabricating them;
- `docs/DEMO_SCRIPT.md`: a reliable sub-three-minute hackathon demo path and recovery path.

The final report must be honest about what was executed on real hardware and with a real API key.

## 12. Blocker and completion policy

If a credential, GPU model, microphone permission, external asset, or deployment account is unavailable:

1. continue all work that can be completed without it;
2. implement provider interfaces, mocks, diagnostics, and setup scripts;
3. document the exact verification command and expected result;
4. mark the item `BLOCKED-EXTERNAL` in `PLAN.md`;
5. stop only when every remaining acceptance criterion depends on unavailable external input.

The project is complete only when every Definition of Done item in `PLAN.md` is either verified with evidence or explicitly marked blocked by a genuinely external prerequisite. Scaffolding, mocked demos, generated screenshots, or passing unit tests alone are not sufficient.
