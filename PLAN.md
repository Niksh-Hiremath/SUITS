# PLAN.md — SUITS 2.0 complete product build

## Status

Living execution plan for the OpenAI Build Week version of SUITS. Update this file continuously while implementing. Do not replace evidence with optimistic summaries.

## Product statement

**SUITS is a voice-first, evidence-grounded AI courtroom simulator.** A user uploads a fictional case packet, reviews a structured case compiled by GPT-5.6, and conducts a live hearing against AI courtroom participants. Both sides can call and examine multiple witnesses, introduce and challenge evidence, reveal or dispute facts, interrupt with objections, negotiate settlements, and receive a transcript-grounded advocacy debrief. Local NVIDIA-accelerated STT and local TTS provide low-latency audio; GPT-5.6 provides the courtroom intelligence.

Product boundary: fictional or deliberately anonymized educational simulations only. SUITS does not provide legal advice or predict outcomes of real disputes.

---

## 1. Starting point

The current repository already provides:

- Next.js 16, React 19, TypeScript, Tailwind, Convex, OpenAI SDK, Zod, and Vitest;
- a deterministic phase machine and persistent trials/turns/traces/debriefs/eval records;
- one hardcoded Asha Mehta v. Vertex Logistics case;
- authored/deterministic witness and opposing-counsel responses;
- a Court Director manager/specialist/reviewer experiment;
- a non-streaming GPT review/debrief;
- legacy ElevenLabs push-to-talk STT/TTS actions;
- a basic courtroom UI, Court Records, and a five-run evaluation gate.

The migration must preserve useful reliability and observability while replacing the hardcoded case and linear one-witness flow with a general event-driven simulation.

### Baseline actions

- [x] Record `git status`, current branch, current commit, Node/npm/Python/CUDA versions.
- [x] If the working tree is safe and the tag does not exist, tag the pre-build commit locally as `hermes-hackathon-v1`; do not push automatically. The tag already existed at the correct final Hermes runtime commit and was intentionally not moved.
- [x] Run and record: `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run eval`, `npm run build`.
- [x] Save baseline failures without hiding them.
- [x] Inventory the actual app routes, Convex functions, domain modules, tests, and generated files.
- [x] Add the observed baseline to `Progress` and `Verification Evidence` at the end of this plan.

---

## 2. Definition of Done

Codex may mark the Goal complete only when all applicable items below are proven.

### A. User case ingestion

- [ ] A user can create a case by uploading at least text, Markdown, and text-based PDF files; image/scanned-page support is implemented when the selected GPT-5.6 input path supports it.
- [ ] Files are privately stored, indexed, and represented with source/page/segment provenance.
- [ ] GPT-5.6 compiles the packet into a strict, versioned `CaseGraph`.
- [ ] Uploaded text is treated as untrusted data and cannot override system instructions.
- [ ] A review screen lets the user inspect and correct parties, issues, timeline, facts, evidence, witnesses, knowledge boundaries, and simulation settings before publication.
- [ ] The repository contains at least two seeded fictional cases in addition to user upload support.

### B. Dynamic courtroom

- [ ] A case supports at least three distinct witnesses with separate knowledge views and prior-statement memory.
- [ ] The user and opposing AI can call, examine, cross-examine, recall, and release witnesses when permitted.
- [ ] The opposing AI chooses strategy based on the current record rather than a fixed script.
- [ ] The judge can rule, instruct, maintain order, handle recess, and enforce phase/action constraints.
- [ ] Facts and evidence have explicit lifecycles; proposed assertions never become admitted truth automatically.
- [ ] Parties can offer evidence, object, withdraw it, move to strike, and obtain a ruling.
- [ ] Stricken testimony remains in the audit transcript but cannot influence jury reasoning.
- [ ] Hidden authored facts may be revealed through valid testimony or evidence events.
- [ ] Truly new assertions are tracked as proposed/disputed until verified or excluded.
- [ ] Both sides can propose, counter, accept, reject, expire, or withdraw settlement offers using private negotiation state.
- [ ] A complete trial can be paused, resumed after reload, and deterministically replayed from events.

### C. Voice and interruption

- [ ] The canonical courtroom UI is microphone/voice controlled with no visible typed composer.
- [ ] A developer-only typed control exists only behind an explicit non-production flag.
- [ ] A local Python speech companion performs streaming STT and TTS without sending raw audio to OpenAI or Convex.
- [ ] The default STT adapter supports NVIDIA GPU streaming and emits revisioned partial/final transcripts.
- [ ] The default TTS adapter is local, supports multiple character voices, phrase streaming, cancellation, and timing metadata.
- [ ] User barge-in cancels queued/current speech safely.
- [ ] A high-confidence partial transcript can trigger an immediate cached “Objection!” clip and animation before the utterance ends.
- [ ] GPT-5.6 receives the objection candidate and record context, and the deterministic engine commits the resulting objection/ruling only after schema and rule validation.
- [ ] False/overruled objections, sustained objections, rephrasing, motion to strike, and resume/cancel behavior are handled coherently.
- [ ] The system exposes speech-service readiness, GPU/provider status, warmup, and actionable errors.

### D. GPT-5.6 runtime integration

- [ ] `gpt-5.6-luna` is the default interactive runtime model, while `gpt-5.6-terra` is used for case compilation and final coaching.
- [ ] GPT-5.6 performs case compilation, courtroom role reasoning, opposing strategy, rulings, negotiation reasoning, jury deliberation, and final coaching where applicable.
- [ ] All action-producing calls use strict structured outputs and versioned schemas.
- [ ] Each role receives only its authorized `KnowledgeView`.
- [ ] User-visible dynamic answers come from validated GPT-5.6 output; deterministic authored case answers are not the normal runtime path.
- [ ] Streaming output begins TTS at safe phrase boundaries.
- [ ] Stale/cancelled model output cannot update trial state or reach TTS.
- [ ] Prompt caching/context compaction is implemented and measured.
- [ ] Model latency, usage, cost, validation, retries, citations, and failures appear in Court Records.

### E. Courtroom presentation

- [ ] The hearing runs inside a rendered courtroom scene rather than a chat-only interface.
- [ ] The scene includes judge, user counsel, opposing counsel, current witness, clerk/evidence display, and jury representation.
- [ ] Characters support idle, listening, thinking, speaking, objecting, standing, sitting, presenting, reacting, and ruling/gavel states.
- [ ] Active-speaker camera direction and smooth cuts are implemented.
- [ ] Speech drives lip/viseme movement and speaking-state timing.
- [ ] Emotional/performance metadata influences bounded facial/body animation.
- [ ] Evidence presentation and rulings have visible transitions.
- [ ] A reduced-quality mode preserves all interactions on weaker hardware.
- [ ] All external assets have recorded licenses/attribution.

### F. Debrief, records, and evaluation

- [ ] Every material claim in the debrief cites transcript turns and/or evidence IDs.
- [ ] The debrief distinguishes admitted record, excluded/stricken material, hidden case truth, and coaching inference.
- [ ] It reports strengths, weak questions, missed evidence, contradictions, objection accuracy, witness strategy, settlement choices, jury movement, and an improved closing.
- [ ] Court Records displays the event tree, model calls, role knowledge scope, citations, rulings, interruptions, audio timing, retries, costs, and fallbacks.
- [ ] At least two multi-case automated evaluation scenarios run repeatedly.
- [ ] The core eval gate passes at least 9 of 10 full mocked/replay runs and all deterministic invariant tests.
- [ ] At least one live GPT-5.6 end-to-end run and one live local-GPU speech run are recorded when credentials/hardware are available.

### G. Quality and delivery

- [ ] `npm run lint`, `npm run typecheck`, `npm test`, `npm run eval`, `npm run build`, `npm run test:e2e`, and `npm run verify` pass, with external skips reported honestly.
- [ ] Speech-service tests pass in CI/mock mode and on the target local environment when available.
- [ ] No secret is present in tracked files or client bundles.
- [ ] README and required architecture/setup/security/case-format/build-week/demo documents are complete.
- [ ] The primary demo path can be completed reliably in under three minutes without manual database edits.
- [ ] A recovery path exists for microphone permission denial, speech-service disconnect, OpenAI timeout, malformed model output, and browser refresh—without exposing the production text composer.

---

## 3. Target repository shape

Do not reorganize merely for aesthetics. Move toward this layout when it reduces coupling:

```text
convex/
  schema.ts
  cases.ts
  trials.ts
  events.ts
  traces.ts
  artifacts.ts
  uploads.ts
  migrations.ts

src/
  app/
    api/
      cases/compile/route.ts
      trials/[trialId]/respond/route.ts
      trials/[trialId]/interrupt/route.ts
    cases/
    courtroom/
    records/
    settings/
  components/
    courtroom/
    case-editor/
    records/
  domain/
    case-graph/
    trial-engine/
    knowledge/
    agents/
    objections/
    negotiation/
    debrief/
  server/
    openai/
    convex/
    documents/
  lib/
  evals/

services/speech/
  pyproject.toml
  src/suits_speech/
    app.py
    protocol.py
    vad.py
    stt/
    tts/
    audio_queue.py
    timing.py
  tests/

public/
  courtroom/
  audio/cached/

docs/
  ARCHITECTURE.md
  LOCAL_SPEECH.md
  CASE_FORMAT.md
  ASSETS.md
  SECURITY_AND_PRIVACY.md
  DEMO_SCRIPT.md
  build-week/
```

Generated Convex files remain generated; do not hand-edit them.

---

## 4. Domain contracts

### 4.1 CaseGraph

Create versioned schemas and migrations. A representative shape:

```ts
type CaseGraph = {
  caseId: string;
  version: number;
  title: string;
  jurisdictionProfile: SimulationRuleProfile;
  parties: Party[];
  issues: LegalIssue[];
  timeline: TimelineEvent[];
  facts: Fact[];
  evidence: EvidenceItem[];
  witnesses: WitnessProfile[];
  contradictions: Contradiction[];
  settlement: SettlementConfiguration;
  juryInstructions: JuryInstruction[];
  sourceSegments: SourceSegment[];
  compilerMetadata: CompilerMetadata;
};
```

Each fact/evidence/witness claim stores provenance. Separate authoring truth from what each role may know.

### 4.2 Trial actions and events

Use a discriminated `TrialAction` union for attempted actions and a separate `TrialEvent` union for committed facts. Candidate actions include:

```text
START_TRIAL
BEGIN_PHASE
CALL_WITNESS
SWEAR_WITNESS
ASK_QUESTION
ANSWER_QUESTION
OBJECT
RULE_ON_OBJECTION
MOVE_TO_STRIKE
STRIKE_TESTIMONY
OFFER_EVIDENCE
RULE_ON_EVIDENCE
REVEAL_HIDDEN_FACT
PROPOSE_ASSERTION
VERIFY_ASSERTION
DISPUTE_ASSERTION
RECALL_WITNESS
RELEASE_WITNESS
REQUEST_RECESS
RESUME_TRIAL
PROPOSE_SETTLEMENT
COUNTER_SETTLEMENT
ACCEPT_SETTLEMENT
REJECT_SETTLEMENT
WITHDRAW_SETTLEMENT
REST_CASE
GIVE_CLOSING
INSTRUCT_JURY
DELIBERATE
RENDER_VERDICT
GENERATE_DEBRIEF
FAIL_STEP
RECOVER_STEP
```

Implement:

- `validateAction(state, action, actorView)`;
- `commitAction(validatedAction) -> TrialEvent[]`;
- `reduceTrial(events) -> TrialState`;
- `buildKnowledgeView(state, actorId)`;
- `buildJuryRecord(state)`;
- `replayAndAssert(events)`.

### 4.3 Idempotency and concurrency

Every user utterance, model response, objection interrupt, TTS job, and committed action has a stable ID. Convex mutations reject duplicates and stale expected state versions. A late response with an obsolete revision cannot commit.

---

## 5. Runtime architecture

```text
Browser microphone
  -> AudioWorklet / PCM frames
  -> localhost speech WebSocket
  -> local VAD + streaming STT
  -> revisioned partial/final transcript events

Final transcript or material interrupt candidate
  -> Next.js server route/orchestrator
  -> load compact Convex trial state
  -> construct role-specific KnowledgeView
  -> GPT-5.6 Responses API with strict schema
  -> deterministic validation
  -> Convex append-only events/traces
  -> streamed dialogue chunks
  -> local TTS WebSocket queue
  -> audio + viseme/timing events
  -> Three.js courtroom animation
```

Convex persists canonical state. The browser coordinates live media but cannot authorize actions by itself.

### 5.1 OpenAI call classes

Implement explicit adapters and schemas for:

1. `CaseCompiler`: documents -> draft CaseGraph plus uncertainties.
2. `OpponentPlanner`: phase/material-event strategy -> bounded intended actions.
3. `RoleResponder`: witness/counsel/judge/jury dialogue and cited action payload.
4. `ObjectionResolver`: partial/final utterance + record -> objection basis and ruling recommendation.
5. `NegotiationAgent`: private offer/counter reasoning within configured utility boundaries.
6. `DebriefGenerator`: audit record -> cited coaching artifact.

Do not call all six on every turn. Routine dialogue should use the smallest valid path. Invoke planning at phase boundaries or material state changes. Use deterministic checks and targeted repair.

### 5.2 Prompt and context rules

- Stable simulation rules first.
- Versioned case summary and role policy next.
- Relevant knowledge/evidence only.
- Current state and transcript delta last.
- Uploaded content enclosed as untrusted source material.
- All factual output cites permitted IDs.
- Store prompt/schema versions and redacted request summaries.

---

## 6. Local speech protocol

Create a versioned JSON control protocol plus binary PCM/audio frames.

### Client -> speech service

```text
hello
load_models
start_utterance
audio_chunk
end_utterance
cancel_utterance
synthesize
cancel_synthesis
set_voice
ping
```

### Speech service -> client

```text
ready
capabilities
speech_started
stt_partial
stt_final
speech_ended
tts_started
tts_audio
tts_timing
tts_finished
cancelled
metrics
error
pong
```

Every transcript event includes `utteranceId` and monotonic `revision`. Every TTS event includes `jobId`, actor, sequence, and cancel state.

### Default providers

- STT: configurable NVIDIA Nemotron streaming English adapter on CUDA.
- VAD: lightweight local VAD.
- TTS: configurable Kokoro adapter with per-character voices.
- CI: deterministic fake STT/TTS providers.

Do not download model weights during normal application startup without explicit setup. Provide a setup command, cache detection, progress reporting, and disk/VRAM requirements.

### Interruption flow

1. STT emits a partial revision.
2. A fast deterministic candidate detector checks likely objection patterns and current rules.
3. On high confidence, create `interruptId`, stop/pause the current speech turn, play a cached “Objection!” clip, and animate opposing counsel standing.
4. Send only the candidate partial, recent exchange, and relevant rule profile to `ObjectionResolver`.
5. Validate the structured result.
6. Commit objection and ruling events.
7. Cancel, strike, resume, or request rephrasing according to the ruling.
8. Ignore any late transcript/model/TTS result carrying stale IDs.

The local candidate detector proposes an interruption; it does not make the legal ruling.

---

## 7. Courtroom scene and interaction design

### Required scene

- Bench and judge.
- User counsel table/position.
- Opposing counsel table and animated attorney.
- Witness stand with active witness model.
- Clerk/evidence display.
- Jury box or representative jurors.
- Phase/status indicators integrated into the environment rather than a chat layout.

### Performance state

```ts
type CharacterPerformance = {
  actorId: string;
  activity: "idle" | "listening" | "thinking" | "speaking" | "objecting" |
    "standing" | "sitting" | "presenting" | "reacting" | "ruling";
  emotion: "neutral" | "confident" | "nervous" | "angry" | "confused" |
    "defensive" | "empathetic";
  intensity: number;
  gazeTarget?: string;
  gesture?: string;
  visemes?: VisemeCue[];
};
```

The model may emit semantic fields only. Map them through a renderer-owned allowlist.

### UX requirements

- Clear microphone state and who currently owns the floor.
- Voice commands for pause, resume, repeat, request recess, accept/reject offer, and end examination.
- Transcript available as a record/inspection drawer, not as a text-input fallback.
- Recovery UI for local speech disconnected, model timeout, and invalid action.
- A preflight page tests microphone, speakers, local speech service, CUDA/model readiness, Convex, and OpenAI configuration before the hearing.

---

## 8. Milestones and gates

### Milestone 0 — Preserve history and establish baseline

Deliverables:

- [x] baseline evidence recorded;
- [x] legacy behavior mapped;
- [x] existing files/tests classified as preserve, migrate, or retire;
- [x] local pre-build tag verified at the correct legacy boundary and left unchanged;
- [x] documentation directories created.

Gate:

- [x] Existing app can be built or all baseline blockers are reproduced and documented. The absent `NEXT_PUBLIC_CONVEX_URL` baseline blocker was reproduced, then resolved by linking the existing Convex development deployment; the fresh Milestone 1 production build passes.

### Milestone 1 — Event-sourced domain core

Deliverables:

- [x] versioned CaseGraph, TrialAction, TrialEvent, TrialState, KnowledgeView schemas;
- [x] pure reducer and validator;
- [x] fact/evidence/testimony/settlement lifecycles;
- [x] idempotency and stale-state protection;
- [x] migration path from existing trial tables/data;
- [x] replay tool and invariant tests.

Gate:

- [x] Unit tests prove illegal phase changes, unknown evidence use, automatic fact admission, stricken-record leakage, witness knowledge leakage, and duplicate events are rejected.
- [x] A seeded case replays to identical state twice.

### Milestone 2 — Case upload and GPT-5.6 compiler

Deliverables:

- [ ] upload/storage/extraction pipeline;
- [ ] source-segment provenance;
- [ ] strict GPT-5.6 CaseCompiler;
- [ ] injection-resistant prompt boundary;
- [ ] uncertainty/validation report;
- [ ] user review/edit/publish UI;
- [ ] at least three seeded cases total.

Gate:

- [ ] A fixture packet compiles into valid CaseGraph with all factual fields linked to source segments or marked inferred/uncertain.
- [ ] Malicious embedded instructions do not change compiler behavior in tests.

### Milestone 3 — General multi-witness trial engine

Deliverables:

- [ ] dynamic phase/action permissions;
- [ ] both sides calling/recalling/releasing witnesses;
- [ ] direct and cross examination;
- [ ] evidence offer/ruling and fact lifecycle;
- [ ] opposing strategy state;
- [ ] negotiation state and private offers;
- [ ] pause/resume/replay in Convex;
- [ ] migration away from hardcoded golden roleplay as normal runtime.

Gate:

- [ ] A deterministic scripted simulation completes with three witnesses, one excluded exhibit, one stricken statement, one revealed hidden fact, and one rejected or accepted settlement.
- [ ] Reloading mid-hearing resumes from the last committed event.

### Milestone 4 — GPT-5.6 courtroom intelligence

Deliverables:

- [ ] Responses API streaming adapter;
- [ ] strict schemas for all call classes;
- [ ] role-specific KnowledgeView prompts;
- [ ] cancellation/revision handling;
- [ ] validation and targeted repair;
- [ ] prompt/version/cost/latency traces;
- [ ] deterministic mock/replay adapter;
- [ ] live integration smoke command.

Gate:

- [ ] Mock integration suite passes all role and validation scenarios.
- [ ] With a key available, at least one live GPT-5.6 multi-witness trial completes without knowledge leakage or unsupported admitted facts.
- [ ] Runtime witness/counsel answers are accepted GPT-5.6 outputs, not authored golden-answer replacements.

### Milestone 5 — Local real-time STT/TTS companion

Deliverables:

- [ ] Python service and versioned WebSocket protocol;
- [ ] GPU STT adapter, VAD, partial/final revisions;
- [ ] local multi-voice TTS adapter;
- [ ] phrase queue, timing, cancellation, barge-in;
- [ ] cached fixed courtroom clips;
- [ ] preflight/health/capability UI;
- [ ] setup scripts and documentation;
- [ ] deterministic fake providers for CI.

Gate:

- [ ] Protocol and cancellation tests pass without GPU.
- [ ] On target hardware when available, microphone speech produces partial/final transcripts and local spoken responses with measured timings.
- [ ] Raw audio is absent from OpenAI requests and Convex records.

### Milestone 6 — Mid-sentence objections and live orchestration

Deliverables:

- [ ] partial-transcript candidate detector;
- [ ] interrupt coordinator with stale revision protection;
- [ ] cached objection reaction;
- [ ] GPT-5.6 objection/ruling schema;
- [ ] sustained/overruled/rephrase/strike/resume flows;
- [ ] simultaneous speaker and barge-in handling;
- [ ] objection metrics and eval fixtures.

Gate:

- [ ] E2E fixture proves objection can interrupt before final STT, cancel active audio, obtain a validated ruling, and resume coherently.
- [ ] Late model/audio events cannot alter the committed post-ruling state.

### Milestone 7 — Animated courtroom

Deliverables:

- [ ] Three.js/R3F scene and licensed assets;
- [ ] character animation state machines;
- [ ] camera director;
- [ ] lip/viseme timing;
- [ ] evidence/ruling/settlement transitions;
- [ ] quality settings and responsive layout;
- [ ] accessibility and motion-reduction support;
- [ ] visual regression evidence.

Gate:

- [ ] Playwright completes the primary trial flow with no console errors.
- [ ] Screenshots/video show each required character state and a mid-sentence objection sequence.
- [ ] Reduced-quality mode remains functional.

### Milestone 8 — Debrief, records, and evals

Deliverables:

- [ ] cited advanced debrief;
- [ ] jury-considerable record builder;
- [ ] trace/event/knowledge/latency/audio inspection UI;
- [ ] multi-case eval fixtures;
- [ ] repeated full-run gate;
- [ ] downloadable debrief and replay bundle.

Gate:

- [ ] 10-run mocked/replay gate achieves at least 9 successful runs.
- [ ] Every debrief factual claim is citation-valid.
- [ ] Jury/debrief tests prove excluded and stricken material is not used as admissible support.

### Milestone 9 — Hardening, documentation, and demo

Deliverables:

- [ ] full verification script;
- [ ] security/privacy review;
- [ ] prompt-injection and authorization tests;
- [ ] setup/architecture/case/speech/assets/build-week docs;
- [ ] polished README;
- [ ] deterministic under-three-minute demo case;
- [ ] recorded fallback/recovery path;
- [ ] Codex session documentation placeholders and `/feedback` reminder.

Gate:

- [ ] All Definition of Done items have evidence or explicit external blockers.
- [ ] Full verification passes.
- [ ] Fresh setup instructions have been exercised as far as the current environment permits.
- [ ] No production route exposes secrets or visible typed courtroom input.

---

## 9. Test and evaluation matrix

### Unit

- schemas and migrations;
- action validation and reducer exhaustiveness;
- fact/evidence/testimony lifecycle;
- KnowledgeView redaction;
- idempotency and stale revisions;
- objection candidate detection;
- settlement utility/expiry rules;
- TTS phrase buffering and cancellation;
- citation validation.

### Integration

- Convex event append + replay;
- OpenAI mock structured output + repair;
- uploaded case extraction + compilation fixture;
- speech WebSocket protocol;
- browser orchestrator -> model mock -> TTS mock;
- interrupted speech and late-result rejection.

### E2E

1. Preflight succeeds.
2. User uploads or selects a case.
3. User reviews/publishes CaseGraph.
4. User begins voice hearing.
5. Both sides call witnesses.
6. Opponent objects mid-utterance.
7. Judge sustains or overrules.
8. Evidence is offered and one item is excluded.
9. A hidden fact is revealed and a different assertion is disputed/stricken.
10. Settlement is offered and resolved.
11. Trial completes with jury/verdict/debrief.
12. Court Records and replay show identical committed history.

### Reliability eval assertions

- legal action ordering;
- no witness knowledge leakage;
- no unknown citations;
- no auto-admitted generated facts;
- no jury reliance on stricken/excluded material;
- settlement privacy;
- complete phase/action progress;
- interruption cancellation correctness;
- grounded debrief;
- trace completeness.

---

## 10. Performance targets

Measure rather than claim. Record machine, provider, warm/cold state, and sample size.

Initial targets on the target RTX 5070 environment:

- local STT partial update p95: <= 300 ms after audio chunk arrival;
- cached objection audio/animation start: <= 250 ms after candidate threshold;
- final transcript commit: <= 800 ms after speech end;
- GPT-5.6 visible/structured first useful output: target <= 3.5 s, reported honestly;
- local TTS first audio after first safe phrase: target <= 600 ms warm;
- cancellation of active TTS: <= 150 ms;
- courtroom render: 60 FPS target, >= 30 FPS reduced-quality minimum during normal operation.

Performance misses do not justify unsafe state shortcuts. Optimize after correctness instrumentation exists.

---

## 11. Security and privacy checklist

- [ ] API keys server-side only and absent from client bundles/logs.
- [ ] `.env.example` contains names and safe defaults only.
- [ ] Uploaded files are private and access-controlled.
- [ ] File size/type/page limits and parser timeouts exist.
- [ ] Uploaded text is isolated as untrusted content.
- [ ] Trial/action authorization is checked server-side.
- [ ] Role-specific knowledge is filtered server-side.
- [ ] Logs avoid raw secrets and unnecessary full document contents.
- [ ] Raw audio remains local by default.
- [ ] Delete/export controls for user case/trial data are documented or implemented.
- [ ] Educational disclaimer appears during upload and hearing.
- [ ] Real-person voice cloning is not implemented.

---

## 12. Documentation and proof

Required files:

```text
README.md
docs/ARCHITECTURE.md
docs/LOCAL_SPEECH.md
docs/CASE_FORMAT.md
docs/ASSETS.md
docs/SECURITY_AND_PRIVACY.md
docs/DEMO_SCRIPT.md
docs/build-week/BUILD_WEEK_DELTA.md
docs/build-week/VERIFICATION.md
docs/build-week/CODEX_SESSIONS.md
```

`BUILD_WEEK_DELTA.md` must explicitly state that the previous repository already had the golden case, deterministic phase machine, traces, basic voice integration, and debrief/eval foundations. It must then identify the post-baseline event engine, uploads, GPT-5.6 runtime, local speech, multi-witness behavior, interruptions, negotiation, and animation work with commit references.

Never fabricate a Codex session ID or `/feedback` ID. Leave an obvious placeholder and tell the user the exact command to run at the end of the primary Codex thread.

---

## 13. Progress

Update after each meaningful checkpoint using dated entries:

```text
- YYYY-MM-DD HH:MM — Milestone/step
  - Changed:
  - Verified:
  - Remaining:
  - Blocked:
  - Commit:
```

- [x] Baseline recorded.
- [x] Milestone 0 complete.
- [x] Milestone 1 complete.
- [ ] Milestone 2 complete.
- [ ] Milestone 3 complete.
- [ ] Milestone 4 complete.
- [ ] Milestone 5 complete.
- [ ] Milestone 6 complete.
- [ ] Milestone 7 complete.
- [ ] Milestone 8 complete.
- [ ] Milestone 9 complete.

- 2026-07-18 17:09 IST — Milestone 0 baseline and preservation gate
  - Changed: recorded the environment, repository map, git boundary, legacy behavior, preserve/migrate/retire classification, baseline blockers, and exact verification evidence; created `docs/build-week/BASELINE.md`.
  - Verified: clean `main` at `92c00e3`, existing legacy tag at `2fec9bc`, npm clean install, lint exit 0, strict typecheck, 60 unit tests, three eval tests, Python/uv, RTX 5070, and CUDA 13.3. The build compiled and typechecked before reproducing the missing Convex URL prerender blocker.
  - Remaining: safely link and inventory the existing Convex deployment, then begin the additive event-sourced domain/migration work.
  - Blocked: baseline production prerender requires a valid `NEXT_PUBLIC_CONVEX_URL`; live GPT/model entitlement and local speech model readiness remain unverified rather than presumed.
  - Commit: `docs: record SUITS 2.0 baseline`.

- 2026-07-18 17:55 IST — Milestone 1 domain/persistence checkpoint
  - Changed: added and pushed the strict CaseGraph v1 contract with a three-witness fixture; added additive Convex CaseGraph/source/upload, append-only trial-event, receipt, projection, snapshot, and migration-checkpoint storage; linked the repository to the existing `SUITS` Convex project and refreshed generated API types. The pure TrialAction/TrialEvent/TrialState engine and role-isolated KnowledgeView are in local gate verification.
  - Verified: 44 CaseGraph tests; scoped CaseGraph and Convex lint/typechecks; exact 45-event enum synchronization across domain, Convex validator, and schema; existing project inventory; successful cloud development schema/function sync with all additive indexes accepted; nine KnowledgeView isolation tests and repository typecheck.
  - Remaining: finish and independently review reducer/invariant/replay tests, record the migration inventory without mutating legacy data, rerun the full Milestone 1 gate, then mark the milestone complete. Completed in the 18:05 entry below.
  - Blocked: none for Convex linkage. Live GPT-5.6 entitlement and local speech readiness remain later-milestone verification items.
  - Commits: `023a9fe`, `7a9a43a`, `ecf93eb`.

- 2026-07-18 18:05 IST — Milestone 1 event-sourced domain gate complete
  - Changed: completed the 45-action strict TrialAction/TrialEvent/TrialState contract, pure validator/reducer/commit/replay path, explicit fact/evidence/testimony/settlement/response/interruption lifecycles, deterministic event IDs, stale-version and actor binding, role-specific KnowledgeViews, jury-considerable filtering, and conservative legacy migration/checkpoint execution.
  - Verified: 14 focused engine tests and nine knowledge-isolation tests cover every Milestone 1 gate; a seeded three-witness stream replayed to byte-identical state twice; full lint/typecheck/test/eval/build and Convex TypeScript checks passed; the development migration inventoried all nine legacy tables, inserted one private legacy CaseGraph, and an identical retry was a no-op with `replayed: true`.
  - Remaining: begin Milestone 2 upload/storage/extraction, strict Terra compiler, injection boundary, review/edit/publish UI, and two additional seeded cases.
  - Blocked: none for Milestone 1.
  - Commits: `63de85b`, `d1c0857`; this PLAN completion entry is committed separately.

## 14. Discoveries

Record unexpected repository behavior, provider constraints, performance findings, and corrected assumptions with evidence.

- The clean repository is on `main` at `92c00e3ccca51ae6c4734fe621de68ce81d839b0`, exactly aligned with `origin/main`. The existing lightweight `hermes-hackathon-v1` tag points to `2fec9bc87cfda70a7b8cb46b966b65699cfe5c20`, the final legacy runtime commit. HEAD only adds the SUITS 2.0 contract/config documentation, so moving the tag would weaken provenance.
- The current tracked app has three routes (`/`, `/hearing`, `/records`), nine domain modules with tests, ten Convex implementation modules, five generated Convex files, and an empty `public/` directory. There are no API routes, case editor, reusable courtroom components, speech service, Playwright tests, or current `docs/` tree at baseline.
- Convex has nine tables, 23 public functions, and one internal function. Persistence is a mutable trial snapshot plus append-style turns/traces, not a material `TrialEvent` stream. There is no authorization, ownership, upload metadata, migration runner, replay log, witness-specific data model, objection state, or settlement state.
- The current browser sends complete microphone blobs through Convex to ElevenLabs and downloads whole MP3 responses. Visible production textareas remain. This violates the required local-audio boundary and production voice-only contract.
- `convex/participatory.ts` calls a three-step Court Director model chain but discards the accepted specialist dialogue in favor of `answerGoldenWitness`. Opposing counsel is fully authored, and the final GPT verdict is overwritten by `assessGoldenVerdict`. The baseline used a forbidden legacy model literal even though `.env.example` named Luna and Terra; Milestone 2 removed that literal and made the two permitted roles exact.
- The legacy autonomous eval writes a Harbor Lantern/Northstar transcript into an Asha/Vertex trial and can still pass because overlapping IDs satisfy shallow assertions. This makes the old five-run gate unsuitable as SUITS 2.0 proof.
- `next.config.ts` uses `output: "export"`. The required server routes and secret-only OpenAI integration require migrating away from the static-export posture.
- The local environment exposes an RTX 5070 with 12,227 MiB VRAM, driver 610.62, CUDA 13.3, Node 24.17.0, npm 11.17.0, Python 3.12.10, and uv 0.11.25. Python and uv are installed correctly; earlier execution failures were caused by the previous Codex workspace sandbox, not missing software.
- The baseline `.env` contains `OPENAI_API_KEY` by name but no Convex URL/deployment configuration. This proves only local key presence; it does not prove model entitlement, deployment-side secrets, or a linked Convex database.
- Convex CLI login exposed one existing non-demo project, `SUITS` (`suits-749d2`), under team `niksh-hiremath`. Linking provisioned the personal development deployment `cheery-bandicoot-36` and populated ignored `.env.local` Convex client/deployment keys; no new project or production deployment was created.
- The linked development deployment retains all nine legacy tables and accepted eight additive SUITS 2.0 tables plus their indexes. Deployment environment names still include legacy ElevenLabs variables and an obsolete generic model selector; their values were not read or printed, and later milestones must replace the canonical voice/model paths without treating those settings as current architecture.
- Bounded inventory confirmed 1 public case, 1 private case, 17 trials, 57 turns, 38 traces, 24 jury votes, 8 debriefs, 0 eval runs, and 16 product events. The conservative backfill inserted one private `case-graph.legacy.v1` record and preserved all legacy rows; the same batch ID replayed without another insert.

## 15. Decisions

Record consequential choices, alternatives, and rationale. Do not use this section to silently weaken acceptance criteria.

- Keep Convex as canonical durable state while moving live streaming orchestration to server routes and the local speech companion.
- Use local STT/TTS and GPT-5.6 text reasoning; raw audio does not go to OpenAI.
- Keep an internal transcript and developer-only typed control, while removing visible production text input.
- Preserve the existing `hermes-hackathon-v1` tag at `2fec9bc`; do not recreate, force, or move it.
- Preserve legacy proof in git history rather than restoring deleted phase-one documents as if they were current product documentation. Cite the tagged files from the Build Week delta where useful.
- Treat the existing Convex tables as legacy data that may exist in a linked deployment. Add new optional/versioned structures and idempotent backfills before tightening required fields; never assume a fresh database.
- Separate product analytics from material courtroom events. Keep `productEvents` for analytics and introduce a dedicated append-only trial event store.
- The user subsequently authorized small milestone commits and pushes. Push only green, scoped commits on the active branch; never force-push, rewrite history, or push secrets/tags implicitly.
- Link only the existing Convex `SUITS` project and use a personal cloud development deployment for schema/function verification. Keep `.env.local` ignored and never print its values. Run conservative legacy backfills only after read-only inventory and command review; the first CaseGraph batch satisfied those conditions and was executed idempotently on development.
- Do not fabricate event histories for mutable legacy trials. Preserve their tables and bounded inventory checkpoints, backfill their CaseGraph, and start append-only SUITS 2.0 streams through an explicit version-0 `START_TRIAL` event when a legacy trial is resumed or upgraded.

## 16. Verification Evidence

For every gate, record exact commands, exit status, relevant metrics, artifact paths, screenshots/video paths, and external skips. Do not write “works” without evidence.

- 2026-07-18 16:40–17:09 IST — Milestone 0 baseline
  - `git status --short --branch` — exit 0; clean `main...origin/main` at `92c00e3`.
  - `git tag --list` and `git describe --tags --always --long HEAD` — existing `hermes-hackathon-v1` at `2fec9bc`; current contract commit is one commit later.
  - `node --version` / `npm --version` — exit 0; `v24.17.0` / `11.17.0`.
  - `python --version` / `uv --version` — exit 0 under Full access; `Python 3.12.10` / `uv 0.11.25`.
  - `nvidia-smi --query-gpu=name,driver_version,memory.total,compute_cap --format=csv,noheader` — exit 0; `NVIDIA GeForce RTX 5070, 610.62, 12227 MiB, 12.0`.
  - `nvcc --version` — exit 0; CUDA compilation tools 13.3 (`V13.3.33`).
  - `npm ci` — exit 0 after network/cache access was allowed; 405 packages installed, 406 audited, two moderate vulnerabilities reported, and three dependency install scripts reported as pending npm allow-script review.
  - `npm run lint` — exit 0 with five warnings: four generated Convex unused-disable warnings and one missing React hook dependency in `src/app/hearing/page.tsx`.
  - `npm run typecheck` — exit 0.
  - `npm test` — exit 0; 12 test files and 60 tests passed.
  - `npm run eval` — exit 0; one eval file and three tests passed.
  - `npm run build` — first sandboxed run failed fetching Google fonts. The network-enabled rerun compiled and typechecked successfully, then exited 1 while prerendering `/_not-found` because `NEXT_PUBLIC_CONVEX_URL` is not configured. This is a reproduced configuration blocker, not recorded as a passing build.
  - Repository, Convex, and git-history audits — completed read-only by the primary agent plus three independent subagent audits; detailed inventory is recorded in `docs/build-week/BASELINE.md`.

- 2026-07-18 17:28–17:55 IST — Milestone 1 partial evidence
  - `npm exec -- vitest run src/domain/case-graph/schema.test.ts` — exit 0; one file, 44 tests passed.
  - `npm exec -- eslint src/domain/case-graph` and `npm run typecheck -- --pretty false` — exit 0 before the CaseGraph commit.
  - `npm exec -- tsc -p convex/tsconfig.json --noEmit` and `npm exec -- eslint convex/schema.ts convex/trialEvents.ts convex/migrations.ts` — exit 0.
  - Canonical event comparison — 45 domain, Convex input, and Convex table literals in identical order.
  - Convex management API project inventory — read-only; exactly one existing project, `SUITS` (`suits-749d2`). No token or environment-variable values were emitted.
  - `npx convex dev --configure existing --team niksh-hiremath --project suits-749d2 --dev-deployment cloud --once --typecheck enable --tail-logs disable` — exit 0; linked/provisioned development deployment `cheery-bandicoot-36`, generated `.env.local`, accepted all additive tables/indexes, and reported functions ready at 17:54:34 IST. This was a development sync, not a production deploy or data migration.
  - `npx convex data --limit 1` — exit 0; confirmed the nine legacy and eight additive table names without printing record contents.
  - `npm exec -- vitest run src/domain/knowledge/knowledge.test.ts` — exit 0; one file, nine isolation/lifecycle tests passed after adding a hidden-fact dynamic-scope regression.
  - `npm exec -- eslint src/domain/knowledge` and `npm run typecheck -- --pretty false` — exit 0.

- 2026-07-18 17:58–18:05 IST — Milestone 1 completion gate
  - Read-only bounded inline inventory — exit 0; counts were `cases=1`, `privateCases=1`, `trials=17`, `turns=57`, `traces=38`, `juryVotes=24`, `debriefs=8`, `evalRuns=0`, and `productEvents=16`; all eight additive tables were initially empty and no row contents were printed.
  - `migrations:backfillLegacyCaseGraphsPage` with migration `suits2-casegraph-v1-20260718` and batch `suits2-casegraph-v1-batch-001` — first run processed 1 and inserted 1 private legacy CaseGraph; identical second run reported `replayed: true`, totals unchanged at one graph and one checkpoint.
  - `migrations:inventoryLegacyPage` — exit 0 for all nine bounded legacy-table pages; durable checkpoints match the read-only counts and report `isDone: true` without changing source rows.
  - `npm exec -- vitest run src/domain/trial-engine/engine.test.ts` — exit 0; one file, 14 tests passed after response-actor, repeat-interruption, and settlement-counterparty hardening.
  - `npm run lint` — exit 0 with the same five pre-existing warnings and no errors.
  - `npm run typecheck` — exit 0.
  - `npm test` — exit 0; 15 files and 127 tests passed.
  - `npm run eval` — exit 0; one file and three legacy eval tests passed.
  - `npm run build` — exit 0; optimized Next.js build compiled, typechecked, and prerendered all four routes with linked `.env.local` Convex configuration.
  - `npm exec -- tsc -p convex/tsconfig.json --noEmit` — exit 0.

## 17. Blocked external prerequisites

Only list genuine external blockers such as absent API credentials, unavailable CUDA hardware, unavailable microphone permission, or missing deployment access. Include the command that will verify the item once unblocked.

- None yet.
