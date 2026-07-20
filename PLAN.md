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

- [x] The hearing runs inside a rendered courtroom scene rather than a chat-only interface.
- [x] The scene includes judge, user counsel, opposing counsel, current witness, clerk/evidence display, and jury representation.
- [x] Characters support idle, listening, thinking, speaking, objecting, standing, sitting, presenting, reacting, and ruling/gavel states.
- [x] Active-speaker camera direction and smooth cuts are implemented.
- [x] Speech drives lip/viseme movement and speaking-state timing.
- [x] Emotional/performance metadata influences bounded facial/body animation.
- [x] Evidence presentation and rulings have visible transitions.
- [x] A reduced-quality mode preserves all interactions on weaker hardware.
- [x] All external assets have recorded licenses/attribution.

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

- [x] upload/storage/extraction pipeline;
- [x] source-segment provenance;
- [x] strict GPT-5.6 CaseCompiler;
- [x] injection-resistant prompt boundary;
- [x] uncertainty/validation report;
- [x] user review/edit/publish UI;
- [x] at least three seeded cases total.

Gate:

- [x] A fixture packet compiles into valid CaseGraph with all factual fields linked to source segments or marked inferred/uncertain.
- [x] Malicious embedded instructions are not obeyed and do not change authored case semantics or trusted compiler behavior in tests.

### Milestone 3 — General multi-witness trial engine

Deliverables:

- [x] dynamic phase/action permissions;
- [x] both sides calling/recalling/releasing witnesses;
- [x] direct and cross examination;
- [x] evidence offer/ruling and fact lifecycle;
- [x] opposing strategy state;
- [x] negotiation state and private offers;
- [x] pause/resume/replay in Convex;
- [x] migration away from hardcoded golden roleplay as normal runtime.

Gate:

- [x] A deterministic scripted simulation completes with three witnesses, one excluded exhibit, one stricken statement, one revealed hidden fact, and one rejected or accepted settlement.
- [x] Reloading mid-hearing resumes from the last committed event.

### Milestone 4 — GPT-5.6 courtroom intelligence

Deliverables:

- [x] Responses API streaming adapter;
- [x] strict schemas for all call classes;
- [x] role-specific KnowledgeView prompts;
- [x] cancellation/revision handling;
- [x] validation and targeted repair;
- [x] prompt/version/cost/latency traces;
- [x] deterministic mock/replay adapter;
- [x] live integration smoke command.

Gate:

- [x] Mock integration suite passes all role and validation scenarios.
- [x] With a key available, at least one live GPT-5.6 multi-witness trial completes without knowledge leakage or unsupported admitted facts.
- [x] Runtime witness/counsel answers are accepted GPT-5.6 outputs, not authored golden-answer replacements.

### Milestone 5 — Local real-time STT/TTS companion

Deliverables:

- [x] Python service and versioned WebSocket protocol;
- [x] GPU STT adapter, VAD, partial/final revisions;
- [x] local multi-voice TTS adapter;
- [x] phrase queue, timing, cancellation, barge-in;
- [x] cached fixed courtroom clips;
- [x] preflight/health/capability UI;
- [x] setup scripts and documentation;
- [x] deterministic fake providers for CI.

Gate:

- [x] Protocol and cancellation tests pass without GPU.
- [ ] On target hardware when available, microphone speech produces partial/final transcripts and local spoken responses with measured timings.
- [ ] Raw audio is absent from OpenAI requests and Convex records.

### Milestone 6 — Mid-sentence objections and live orchestration

Deliverables:

- [x] partial-transcript candidate detector;
- [x] interrupt coordinator with stale revision protection;
- [x] cached objection reaction;
- [x] GPT-5.6 objection/ruling schema;
- [x] sustained/overruled/rephrase/strike/resume flows;
- [x] simultaneous speaker and barge-in handling;
- [x] objection metrics and eval fixtures.

Gate:

- [x] E2E fixture proves objection can interrupt before final STT, cancel active audio, obtain a validated ruling, and resume coherently.
- [x] Late model/audio events cannot alter the committed post-ruling state.

### Milestone 7 — Animated courtroom

Deliverables:

- [x] Three.js/R3F scene and licensed assets;
- [x] character animation state machines;
- [x] camera director;
- [x] lip/viseme timing;
- [x] evidence/ruling/settlement transitions;
- [x] quality settings and responsive layout;
- [x] accessibility and motion-reduction support;
- [x] visual regression evidence.

Gate:

- [x] Playwright completes the primary trial flow with no console errors.
- [x] Screenshots/video show each required character state and a mid-sentence objection sequence.
- [x] Reduced-quality mode remains functional.

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
- [x] Milestone 2 complete.
- [x] Milestone 3 complete.
- [x] Milestone 4 complete.
- [ ] Milestone 5 complete.
- [x] Milestone 6 complete.
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

- 2026-07-18 23:01 IST — Milestone 2 case ingestion/compiler gate complete
  - Changed: delivered bounded PDF/DOCX/TXT/Markdown/JSON ingestion; immutable source segments and field-level grounding; a strict streamed `gpt-5.6-terra` compiler with targeted repair and prompt-injection classification; uncertainty and source-coverage reports; owner-bound draft review/edit/publish and recovery workspaces; three complete seeded fictional cases; atomic Convex compile claims, per-generation durable quotas, fenced draft registration, idempotent replay, upload cleanup, and a dry-run-by-default orphan reconciler.
  - Verified: the named M2 acceptance slice passed 69 tests and the owner publication integration passed; the full repository gate passed clean install, lint, both TypeScript surfaces, 313 tests with two explicitly skipped live suites, three evals, and a production build that completed static generation 16/16. Real Terra smoke and strengthened adversarial-injection runs passed. The reproducible PowerShell race produced one fast `409`, one durable `200`, and a 439 ms replay without a second generation; Convex showed one quota charge, a completed generation-1 claim with its lease token cleared, two append-only upload records, and zero orphaned or dangling storage objects.
  - Remaining: Milestone 3 general multi-witness trial orchestration and Convex resume behavior. Capture formal Playwright screenshots/video at the Milestone 9 visual gate; the Windows file-picker helper stopped when it could not establish the current Chrome URL with sufficient confidence, so no visual artifact is claimed here.
  - Blocked: none for Milestone 2. The stopped Windows automation helper is a QA-tool limitation, not a product or acceptance-gate blocker.
  - Commits: scoped M2 series from `06589aa` through `bc1a23a`; this PLAN gate entry is committed separately.

- 2026-07-19 02:13 IST — Milestone 3 event engine and Convex persistence checkpoint
  - Changed: generalized the active engine to V3 while preserving exact V1/V2 contracts; added multi-appearance direct/cross/redirect/recross examination, both-side call/recall/release, bounded exhibit presentation for witness foundation, revalidated evidence foundation, strike-motion grant/deny/withdraw lifecycles, independent fact support, bilateral settlement authority, opposing strategy, strict completion/citation/provenance gates, canonical event-envelope replay, and full CaseGraph-content pinning. Convex now derives owner/actor identity server-side, separates public player actions from trusted judge/AI/system actions, commits events/projections/snapshots/receipts atomically, and enforces idempotency plus expected-version concurrency.
  - Verified: 181 focused domain/Convex tests passed; the scripted acceptance completes three witnesses, an excluded exhibit, stricken testimony, an atomically revealed hidden fact, rejected settlement, pause/reload, verdict, debrief, completion, and byte-identical double replay. The full repository passed 427 tests with two explicit live-only skips, lint with only five known warnings, both TypeScript surfaces, three evals, and a 16/16 production build.
  - Remaining: replace the legacy `/hearing` golden-answer/opposing/verdict runtime path with the V3 event engine before marking Milestone 3 complete; then run a linked development Convex sync and a real durable create/append/reload smoke before the final M3 gate commit.
  - Blocked: none. Convex CLI authentication was already valid; no new login was required.
  - Commit: `348ac0c` (`feat: generalize multi-witness trial engine`).

- 2026-07-19 03:21 IST — Milestone 3 V3 hearing-runtime cutover complete
  - Changed: replaced the normal `/hearing` call graph with an owner-bound Next.js BFF and secret-protected Convex V3 hearing facade; added deterministic actor derivation, seeded/private published graph resolution, redacted role-scoped projections, dynamic witness controls, server-projected capabilities, case-library launch/resume links, stable command retry identities, and recovery from partial multi-append commands. The legacy Asha/Vertex golden witness, opposing-counsel, verdict, cloud-voice, and mutable trial APIs remain preserved only as historical code outside the new hearing call graph. Court Records links were removed from the V3 hearing until that surface receives an owner-bound V3 projection.
  - Verified: the bounded V3 cutover suite passed 34 tests, including strict browser DTO rejection, private-graph owner isolation, hidden-knowledge redaction, exact command replay, and a simulated failure after `CALL_WITNESS` that recovered with one call and one oath. A linked Convex development sync completed without a new login. A real secret-protected cloud smoke created `trial_cd5405e1ae2d44a78b56cab9140c1c9d`, advanced sequence/version 3 to 8, committed a witness question and answer, replayed the exact request without changing the head, and reloaded the identical durable head. The full repository gate passed 456 tests with two explicit live-only skips, three evals, lint with four generated-file warnings and no errors, both TypeScript surfaces, and a production build that generated 17/17 pages.
  - Remaining: Milestone 4 must replace the temporary case-agnostic deterministic witness/verdict/debrief proposal adapter with streamed, strict, role-isolated GPT-5.6 calls and live multi-witness proof. The visible typed courtroom control remains an explicitly interim development surface until the local-speech/voice-first milestones; the legacy `/records` page must not be advertised as V3 Court Records until it is migrated.
  - Blocked: none for Milestone 3.
  - Commits: V3 facade/UI cutover series `8641028` through `b43bb0c`; this PLAN gate entry is committed separately.

- 2026-07-19 03:51 IST — Milestone 4 courtroom-intelligence contract checkpoint
  - Changed: audited every active deterministic proposal seam and the reusable streamed Terra compiler; added strict provider-neutral witness request/output contracts, exact pending-response/head binding checks, segment-level fact/evidence/prior-statement grounding, allowlisted semantic performance commands, server-owned boundary responses, and redacted model-call/attempt trace contracts. No raw prompt, KnowledgeView, output, provider message, hidden fact, or owner identity is permitted in a trace.
  - Verified: 14 focused courtroom-AI tests pass, including strict unknown-key rejection, OpenAI Structured Output conversion with an object root, cross-witness and unscoped-citation rejection, stale/cancelled response rejection, bounded output, safe refusal materialization, Luna/Terra task routing, repair-attempt accounting, timing/usage checks, and raw-sensitive-field rejection. Scoped lint and the full root TypeScript check pass.
  - Remaining: implement the streamed Luna provider, prompt boundary, one-repair orchestration, durable owner-bound attempt storage, and secret-only Convex prepare/commit split; then cut over witness responses before adding opposing strategy/examination, judge decisions, settlement, jury verdict, and Terra coaching.
  - Blocked: none. The local OpenAI key has not yet been used for a Luna courtroom smoke, so entitlement and live latency remain unverified rather than presumed. Convex CLI authentication remains valid and needs no user login.
  - Commits: `05ca446`, `d162fb6`.

- 2026-07-19 04:53 IST — Milestone 4 live Luna witness checkpoint
  - Changed: added the streamed Responses provider and strict contracts for every planned courtroom call class; implemented the witness-specific KnowledgeView prompt, one targeted semantic repair, cancellation, phrase emission after whole-output validation, published Luna/Terra cost estimation, immutable owner-bound call/attempt audits, and an atomic generated-testimony append. The active Next.js BFF now obtains a secret-only Convex preparation, calls `gpt-5.6-luna`, and commits only against a freshly revalidated head; the compatibility Convex command refuses model-required questions instead of fabricating testimony.
  - Verified: 60 provider/boundary tests, 19 focused persistence tests, seven Convex hearing-runtime tests, and 32 protected-BFF/integration tests passed, along with both TypeScript surfaces and scoped lint. `npx convex dev --once` synchronized the new tables, indexes, and functions to `cheery-bandicoot-36` without another login. A real two-witness Luna smoke completed in 22.576 seconds, committed and durably reloaded both grounded answers, used distinct audited call IDs, required zero repairs, and cited no fact or evidence outside either witness's scoped request. Calls used 2,105 input/120 output tokens at an estimated $0.002825 and 2,199 input/130 output tokens at an estimated $0.002979.
  - Remaining: this is a witness-path checkpoint, not the Milestone 4 gate. Opposing-counsel planning/examination/objections, judge rulings, settlement evaluation, jury deliberation/verdict, and Terra final coaching still require role-specific prompt/orchestration cutovers and a real multi-role trial before the gate checkboxes can be marked complete.
  - Blocked: none. The local file intentionally lacks the Convex service secret; the live command loaded the already-configured development secret into that PowerShell process without printing or persisting it.
  - Commits: implementation series `a623b80` through `01c0471`, plus generated binding refresh `920f60a`; this PLAN checkpoint is committed separately.

- 2026-07-19 06:59 IST — Milestone 4 opposing-counsel runtime and live checkpoint
  - Changed: added a private opposing-counsel planning KnowledgeView, public-only counsel responder, strict planner/counsel schemas and prompts, shared streamed validation/one-repair orchestration, secret Convex prepare/commit boundaries, atomic strategy/dialogue/audit commits, resumable planner-to-counsel-to-witness continuation, durable examination-ending speech, exact partial-chain recovery, safe failure classification, and a three-question per-leg bound. Removed the public raw canonical reload wrapper, rejected unsupported user-side and ambiguous counsel rosters before writes, and kept redirect as an explicit player decision.
  - Verified: the current repository gate passes lint with only four generated-file warnings, both TypeScript surfaces, 720 tests with three expected live-only skips, three evals, and the 17/17 production build. The real Luna multi-actor smoke passed in 124.294 seconds for `trial_c1a64355e5144fb2899f6e06a38a4313`: two direct witnesses plus both bounded opposing cross examinations produced 24 accepted calls (eight witness, eight planner, eight counsel), 93,200 input and 7,926 output tokens, one accepted targeted planner repair, zero terminal failures, and estimated total cost $0.1101875. The final redacted owner reload exactly matched the returned head, all scoped citation assertions passed, and no authored witness or counsel response was substituted.
  - Remaining: this is still not the full Milestone 4 gate. Judge objection/ruling orchestration, settlement evaluation, jury deliberation/verdict, and Terra final coaching need role-specific prompt/runtime cutovers; the live smoke must then finish the complete trial without leakage or unsupported admitted facts. The unauthenticated legacy Convex public surface found by the security audit must be internalized before it can be treated as deployment-safe.
  - Blocked: none. Convex remained authenticated and the development deployment synchronized without another login.
  - Commits: opposing-counsel implementation series `ada5ec9` through `42f5703`; this PLAN checkpoint is committed separately.

- 2026-07-19 07:12 IST — Convex legacy public-surface hardening
  - Changed: replaced the browser legacy Court Records reader with a static migration notice, removed every active `/records` link, converted all legacy trial/trace/artifact/eval/event/case functions and billable participatory/autonomous/ElevenLabs actions to internal Convex functions, and internalized the low-level active-V3 `createTrial`/`append` wrappers. Added source regressions, an exact deployment-level public-function allowlist, and PowerShell wrappers for the allowlist check and admin-only legacy Gate 3 invocation. No legacy row, table, model artifact, or git history was deleted.
  - Verified: the linked development deployment synchronized without login and `npm run verify:convex-surface` reports exactly six public UDFs, all owner-authenticated `caseUploads` functions. The full gate passes lint with four generated warnings, both TypeScript surfaces, 724 tests with three live-only skips, three evals, and a 17/17 production build. The five-run legacy Gate 3 action was not executed because routing it internally does not justify five billable Terra calls; its PowerShell wrapper was syntax-checked and the normal eval suite passed.
  - Remaining: resume Milestone 4 judge/objection, settlement, jury, and Terra coaching runtime work. Owner-bound V3 Court Records remains a later product deliverable; the static notice must not be presented as the finished records experience.
  - Blocked: none. Convex authentication and the existing development deployment remained available.
  - Commits: `6063a05`, `69354cf`, `55d56a4`, and `59bcdf7`; this PLAN checkpoint is committed separately.

- 2026-07-19 08:31 IST — Milestone 4 generated jury and coaching runtime checkpoint
  - Changed: replaced the authored/mock trial ending with a canonical closing-to-completion continuation; added role-isolated Luna jury and Terra final-coaching requests, strict source-head/citation/precommit binding, private exact generated-artifact storage, deterministic verdict materialization from the accepted jury recommendation, complete-event materialization, and atomic event/artifact/terminal-trace commits. The secret Convex service now exposes strict jury/debrief commit routes, while browser projections receive only the redacted canonical record.
  - Verified: 23 focused Convex/BFF/UI tests passed, including the exact 16-event closing-to-completion tail, model-role routing, private artifact schemas, replay without duplicate events, conflicting replay rejection without overwrite, cross-owner denial, absence of hidden artifact content from the browser view, and rejection of a closing request with no jury-considerable support. A fifteenth Convex integration test proves `unable_to_reach` remains a non-winner decision verbatim. The broad gate passed 847 tests with three explicit live-only skips, three evals, lint with only four generated warnings, both TypeScript surfaces, the six-function Convex deployment allowlist, the 17/17 production build, `git diff --check`, and the linked development Convex sync. A real 186-second complete trial then durably accepted 28/28 model calls across two witnesses, opposing examination/closing, Luna jury deliberation, and Terra coaching, with one repaired planner call, exact reload, two private artifacts, and estimated total cost $0.2366214.
  - Remaining: this is not the Milestone 4 gate. Judge/objection and settlement model paths still require live hearing-runtime command integration and acceptance proof before Milestone 4 can be marked complete.
  - Blocked: none. Convex CLI authentication is already valid; no login is requested unless the next development sync reports an authentication failure.
  - Commit: `feat: complete generated trial finale`.

- 2026-07-19 10:16 IST — Milestone 4 GPT-5.6 courtroom-intelligence gate complete
  - Changed: added an application-level objection decision window for pending AI witness responses; strict role-isolated Luna judge and settlement requests; one-repair precommit boundaries; atomic ruling/resolution/resume-or-cancel and negotiation/audit commits; high-level user continue, object, propose, counter, accept, reject, and withdraw intents; verdict-free Terra coaching after settlement; protected Convex HTTP/Next.js orchestration; and exact resumed-response rebinding after an overruled objection. No authored dialogue, ruling, settlement decision, verdict, or coaching result is used on the normal runtime path.
  - Verified: the focused objection/settlement/BFF/provider slice passed 74 tests, and the expanded Convex plus resumed-response slice passed 31 tests. The full repository gate passed lint with four generated warnings and no errors, both TypeScript surfaces, 876 tests with three explicit live-only skips, three evals, the 17/17 production build, and `git diff --check`. `npx convex dev --once` synchronized the linked development deployment in 6.81 seconds without a login prompt. A real protected two-witness trial passed in 228.802 seconds for `trial_c2e0b65b75fa478ebe4cde79476f4a28`: 30/30 accepted calls included eight witness answers, nine opponent plans, nine counsel responses, one judge objection ruling, one settlement evaluation, one jury deliberation, and one Terra debrief. The durable stream contains exactly one user objection, interruption, AI ruling, deterministic resolve/resume chain, user offer, AI counteroffer, user rejection, jury deliberation, and generated debrief; exact owner reload and all scoped-citation assertions passed. Aggregate usage was 124,007 input and 16,791 output tokens, one accepted planner repair, and estimated cost $0.2775385.
  - Remaining: begin Milestone 5 local Python STT/TTS. Milestone 6 still owns true partial-STT mid-sentence detection, cached audible objection, audio cancellation/barge-in, rephrase handling, and speech-timing proof; this M4 gate does not claim those audio behaviors. The visible typed courtroom control remains interim until the voice-first UI gate, and owner-bound V3 Court Records remains a later deliverable.
  - Blocked: none. The live command loaded the existing development service secret into one PowerShell process without printing, rotating, or persisting it; Convex CLI authentication remained valid.
  - Commits: `e622142`, `ea27f4e`; live-gate harness and this PLAN evidence are committed separately.

- 2026-07-19 13:26 IST — Milestone 5 bounded local speech and fixed-reaction checkpoint
  - Changed: added the local Python/FastAPI companion foundation, a strict versioned loopback WebSocket protocol, bounded connection/STT/TTS ownership, revisioned partial/final transcript events, energy VAD, phrase-sized PCM streaming with browser acknowledgements and backpressure, cancellation and stale-result fencing, deterministic fake providers, and an atomic immutable cache for the canonical “Objection!”, “Sustained.”, and “Overruled.” reactions. Cached reactions are synthesized once during explicit provider load, advertised by ID through capabilities, and replayed without another provider call or filesystem persistence.
  - Verified: `uv sync --extra dev`, Ruff format/check, strict mypy over all 16 speech modules, and the complete 126-test speech suite passed. Focused cache/application/session coverage passed 23 tests; concurrency regressions cover shared provider serialization, cancelled recognizer creation, executor-backed provider termination, response cancellation, acknowledgement ordering, bounded resource admission, atomic cache prewarm/retry, and cached playback without a runtime provider call. The completed session-actor re-audit reported no remaining high- or medium-severity finding.
  - Remaining: implement and verify the optional NVIDIA Nemotron streaming STT and Kokoro TTS adapters without implicit downloads; add explicit setup/doctor commands and local-speech documentation; build the browser AudioWorklet/playback/WebSocket client and preflight UI; remove the production composer; and record a real RTX 5070 microphone-to-partial/final-to-audio run. Milestone 6 still owns material partial-transcript objection detection and true audible mid-sentence interruption.
  - Blocked: none for the CPU/fake protocol gate. No GPU/model/microphone result is claimed at this checkpoint.
  - Commits: Milestone 5 series `76b93b9` through `75afb5d`; this PLAN checkpoint is committed separately.

- 2026-07-19 14:37 IST — Milestone 5 real local-provider checkpoint
  - Changed: added cache-only Kokoro 0.9.4 and native Transformers 5.13 Nemotron adapters; explicit CPU/CUDA extras; pinned local snapshot selection; strict one-session Nemotron ownership; restart-required worker quarantine; physical cancellation waits; bounded revisioned PCM streaming; three allowlisted voices; a read-only doctor; and a PowerShell setup command that downloads only exact model-file allowlists after explicit opt-in. The offline English spaCy wheel and `librosa` are lockfile dependencies, and Kokoro now fails closed before Misaki can invoke its downloader.
  - Verified: `scripts/setup-local-speech.ps1 -Runtime local-cuda -DownloadModels` installed `torch==2.11.0+cu130`, `transformers==5.13.1`, and both exact snapshots, then returned `speech-doctor.v1` status `ready` on the RTX 5070. The committed opt-in live smoke loaded both providers and the three immutable reaction clips, produced 2,175 ms of Kokoro speech, streamed 109 ordered 20 ms frames, observed four Nemotron partial revisions with the first at 1,112 ms, finalized in 54 ms, and matched the fixed normalized transcript in 12,001 ms total. The full speech gate passed 172 tests, Ruff, strict mypy over all 20 source modules, `uv lock --check`, and `git diff --check`.
  - Corrected during the live gate: the first Kokoro run exposed Misaki's implicit `en_core_web_sm` installer, which is now impossible on the runtime path; the first Nemotron load exposed the required `librosa` dependency; the first streaming run exposed tuple-versus-NumPy processor input; and concurrent CUDA model initialization proved nondeterministic, so provider load is serialized TTS-first. These failed attempts are not counted as passes.
  - Remaining: finish local-speech documentation; build and visually verify the browser AudioWorklet/WebSocket/playback preflight; remove the production text composer; prove a real microphone utterance through partial/final STT and audible local response; and verify that no raw audio reaches OpenAI or Convex. Synthetic in-memory audio is not reported as microphone proof. Milestone 6 still owns material partial-transcript objection decisions and true mid-sentence interruption.
  - Blocked: none for provider installation or synthetic real-model execution. Browser microphone permission and audible playback have not yet been exercised.
  - Commits: `a17de38`, `d86ba5b`, `57d86e9`, `1fad5f0`, `bd26311`, `89ded49`, `830450e`, `a6d282a`, and `6697ac2`.

- 2026-07-19 15:39–16:00 IST — Milestone 5 browser transport and audio-pipeline checkpoint
  - Changed: added cumulative STT credit revisions bound to an utterance and accepted-through sequence; an exact-loopback `suits.speech.v1` browser client; fail-closed handshake, generation, response, and acknowledgement fencing; an explicitly armed AudioWorklet that resamples to transferable 16 kHz mono PCM; eight-frame worklet credits; bounded playback scheduling with pressure signals, timing metadata, cancellation/barge-in, and output-latency-aware audible completion; and explicit browser speech environment defaults. Raw PCM has no persistence, fetch, analytics, logging, Convex, or OpenAI path in these modules.
  - Verified: the Python service passed Ruff format/check, strict mypy over all 20 source modules, `uv lock --check`, and 175 tests. The seven browser speech test files passed 50 tests; scoped ESLint and root strict TypeScript passed. Independent audits found and corrected stale absolute-credit snapshots, worklet-to-main queue growth, startup sequence loss, observer-owned resource leaks, cancelled playback gaps, close/activation races, and failed-resume `AudioContext` leaks before commit.
  - Remaining: integrate the framework-independent hearing speech controller and preflight UI; remove the production composer; exercise the production browser against the fake service; then record a real microphone utterance, audible playback, and a raw-audio boundary audit. No browser microphone, speaker, or visual proof is claimed by this checkpoint.
  - Commits: `fc1f785`, `b35da01`, `08a3029`, and `59e46f3`.

- 2026-07-19 16:20–17:30 IST — Milestone 5 voice-first hearing integration checkpoint
  - Changed: added the framework-independent hearing voice policy and controller orchestration; exact utterance/revision/head fencing; final-transcript-to-high-level-command submission; phrase-safe local synthesis; cancellation, barge-in, and response lifecycle reconciliation; the production voice-first question/closing controls; a developer-only typed control double-gated by non-production mode and `NEXT_PUBLIC_SUITS_DEV_TYPED_INPUT=1`; explicit local-audio recovery states; and a contained responsive case rail. Raw microphone PCM remains on the direct browser-to-loopback WebSocket path.
  - Verified: the browser/controller/hearing slice passed 12 files and 97 tests with scoped ESLint, strict root TypeScript, and `git diff --check`. The production build retained no typed input under the default environment. In-app browser review covered the live hearing at desktop and responsive widths, found no horizontal overflow, and reported no console warning/error; an independent page/layout audit found no remaining high- or medium-severity defect.
  - Remaining: a real microphone utterance, human partial/final transcript, audible speaker response, and network/record raw-audio audit are still required for the Milestone 5 gate. No microphone permission or audible-output result is claimed.
  - Commits: `b31135a`, `6d45e9e`, `4b0f684`, `d5110ba`, and `77ecf0c`.

- 2026-07-19 18:36–18:48 IST — Milestone 5 bounded system-preflight checkpoint
  - Changed: added strict versioned server and durable-health contracts; secret-protected read-only Convex health; two fixed, server-only, `store:false` Luna/Terra Responses probes; hard per-check timeouts; a five-minute ready/fifteen-second degraded single-flight cache; a serializable global Convex permit limiting cold-instance probes to five per rolling ten minutes; safe rate-limit and failure responses; and an accessible `/preflight` workspace for session, Convex, model, CUDA/provider, microphone, capture, playback, and fixed speaker-clip status. Local readiness and provider badges are revoked on speech-service disconnect. The home and hearing navigation link to preflight.
  - Verified: the final focused preflight command passed seven files and 22 tests; the independent server/UI audit gate passed eight files and 25 tests, scoped ESLint, root and Convex strict TypeScript, `git diff --check`, and an independent P0–P2 re-audit. `npx convex dev --once` synchronized the protected routes in 8.02 seconds without a login prompt. A fresh local Next process returned a real safe `suits.server-preflight.v1` ready response in 5,161 ms: Convex 982 ms, Luna 4,500 ms, and Terra 2,576 ms. `npm run build` compiled all 19 pages/routes, including `/preflight` and `/api/preflight`, in 13.9 seconds.
  - Browser boundary: the in-app browser rendered the preflight surface and showed no console warning/error, but its local click control focused without dispatching and later timed out even after a fresh tab/process. The direct production endpoint and static UI contracts passed; the failed browser-control interaction is not reported as an interactive E2E pass. “Prepare local audio” and “Test speakers” were not clicked because microphone/audio permission was not authorized.
  - Remaining: the two Milestone 5 hardware/privacy gate items remain open. Milestone 6 still owns automatic partial-transcript objection orchestration.
  - Commits: `5e0307c` and `d52864c`.

- 2026-07-19 19:09–19:42 IST — Milestone 6 partial-candidate and coordinator checkpoint
  - Changed: added a pure, versioned, high-confidence partial-question detector that emits review candidates only for grounds permitted by the pinned rules. Ambiguous privilege, hearsay, argumentative, and lay-opinion language now requires explicit contextual gates before it can trigger an audible reaction. Added an actorless local coordinator with monotonic utterance generations and canonical-head high-water, exact revision binding, one in-flight request, semantic retry rules, cached-reaction-before-model ordering, cancellable async barriers, final-STT sealing, final-bound model dispatch, one bounded sealed retry, content-free metrics, and abortable delivery fences. Browser proposals carry no authoritative actor identity; the protected server must derive actors, rules, and the accepted ground from canonical owner-bound state.
  - Verified: 45 focused detector/coordinator tests pass with scoped zero-warning ESLint, strict root TypeScript, and `git diff --check`. The current full repository suite passes 136 files and 1,039 tests with three explicit live-only skips. Independent audits found and drove fixes for async stale-delivery races, thrown error observers, permanent dedupe, recovery after withdrawal/provider failure, stale generation/head reopening, non-cancellable reaction/model/delivery callbacks, false-positive audible triggers, duplicate request stranding, and sealed-final retry behavior.
  - Remaining: this is a framework-independent component checkpoint, not the Milestone 6 gate. The hearing controller, protected Next route, atomic Convex four-event preparation, existing Luna ruling loop, ruling clips, and end-to-end sustained/overruled resume behavior are not yet wired. The cached objection reaction, model/ruling deliverable, flow/eval checkboxes, and both milestone gates remain open.
  - Commits: `6e5b874` and `1bd6853`.

- 2026-07-19 19:42-22:36 IST - Milestone 6 durable final-bound interruption checkpoint
  - Changed: wired the conservative partial detector into the hearing controller so PCM is fenced immediately, the cached local objection reaction plays before any model dispatch, and the exact final STT revision becomes the only durable question. Added an atomic four-event `ASK_QUESTION -> REQUEST_RESPONSE -> OBJECT -> BEGIN_INTERRUPTION` prefix; owner-bound recovery metadata; server-only judge/witness leases; strict Luna ruling and resumed-witness fences; no-write candidate withdrawal; current-versus-historical performance authority; reload recovery; sustained rephrase/cancel and overruled resume handling; normal resumed-testimony barge-in; and durable-head-first playback.
  - Recovery hardening: lease credentials never reach the browser; near-expiry claims renew before Luna dispatch; hung renewals abort before the skew-adjusted durable takeover deadline; malformed or late claims are released; the prepared objection ground is immutable; pending-to-complete reload audio is coalesced before drain; aborted/unmounted runs cannot publish or enqueue; and a failed pending ruling clip schedules owner recovery only after recording cleanup. Candidate withdrawal uses a neutral local correction and never fabricates an "Overruled" ruling.
  - Verified: the focused interruption/controller/page slice passed 159 tests before the final lease regressions; the final BFF suite passed 21 tests; the full speech/hearing slice passed 13 files and 121 tests; three Convex suites passed 47 tests; scoped lint and both TypeScript surfaces passed; and independent page and BFF re-audits reported no remaining actionable issue. The repository gate then passed 141 files/1,201 tests with three explicit live-only skips, three evals, the production build, and the six-function Convex public-surface allowlist. `npx convex dev --once` synchronized the linked development deployment in 7.95 seconds without a login prompt and added the three final-bound claim indexes.
  - Remaining: this is not the Milestone 6 gate. A production-path browser E2E fixture still must prove the audible objection occurs before final STT, active audio is cancelled, and the validated ruling resumes coherently. The combined sustained/overruled/rephrase/strike/resume deliverable and objection eval fixtures remain open. No microphone permission or audible-output claim is made.
  - Commits: `1177e88`, `23b331a`, `dbdc290`, `f170c52`, `501bb35`, `ac143ca`, `da2bdde`, `87a04ce`, and `affd284`.

- 2026-07-20 00:14 IST - Milestone 6 strike-motion and objection-eval checkpoint
  - Changed: added public-record-scoped strike opportunities for AI cross and recross; strict planner and counsel strike directives; spoken `MOVE_TO_STRIKE`, `STRIKE_TESTIMONY`, and `DENY_STRIKE_MOTION` events; a role-isolated Luna judge request; exact motion, testimony, action, speech, citation, model, and trace binding; atomic ruling plus terminal-audit persistence; and grant/deny continuation back to opponent planning. Pending rulings now serialize player commands, and an actorless owner-only continuation recovery path resumes abandoned model work after reload without accepting a browser-selected actor or command.
  - Hardened: judge ruling citations must equal the challenged testimony and cannot include unrelated facts, exhibits, source segments, events, or prior statements. Exact replay requires the original owner/trial/call-bound terminal trace; a missing, changed, or second trace cannot attach to a historical ruling. Raw source-segment identifiers are removed before the public judge request is dispatched.
  - Evaluated: added seven named objection assertions for no-write withdrawal, cached-reaction ordering, sustained cancellation/rephrase, overruled exact resume, stale/late suppression, and strike grant/deny. These fixtures are explicitly symbolic and make no browser, live-audio, or live-model claim.
  - Verified: 1,251 tests passed with three explicit live-only skips; both TypeScript surfaces, the two-file/six-test eval suite, repository lint, production build, and `git diff --check` passed. The build generated 19/19 pages and includes `/api/hearings/[trialId]/continuation/recover`. The linked `cheery-bandicoot-36` Convex deployment synchronized in 7.56 seconds without a login prompt.
  - Remaining: Milestone 6 is not complete until the production-path Playwright fixture proves the cached objection reaction precedes final STT, active speech is cancelled, the validated ruling commits, and the response resumes coherently. No microphone permission or audible-output claim is made.
  - Commits: `e6fc244`, `88fd8dd`, `b1cea7e`, `58af82d`, `b1a867d`, `566b45c`, and `8bf4dfb`.

- 2026-07-20 01:05 IST - Milestone 6 production-path browser gate complete
  - Changed: added a Playwright harness that launches a dedicated loopback Python fake-speech companion and the real Next.js hearing through PowerShell, synchronizes the linked Convex development functions, retrieves the existing development service secret without printing or persisting it, and creates an ephemeral session secret. The fixture drives the real hearing page, owner session, protected interruption route, browser microphone capture, speech WebSocket, framed fake STT/TTS, Web Audio playback, and durable Convex ruling/resume path. It passively observes string control frames only and discards binary payloads from the test ledger.
  - Regressions fixed: first-question capabilities and voice validation now accept the valid `available` examination leg; the framed fake TTS adapter truthfully advertises streaming support; and the server-only scripted final-bound provider remains fail-closed outside development/test, exact loopback hosts, and the named E2E scenario.
  - Verified: the fixture proves rev-3 partial detection dispatches the cached objection request before rev-4 final STT, barge-in stops active Web Audio and sends `cancel_synthesis` before the new utterance, no microphone chunks are forwarded after the interrupt, the protected final-bound request contains the partial trigger plus exact final transcript, the strict response commits an overruled/resume head, every objection `AudioBufferSourceNode` ends naturally without `stop` before the judge ruling clip, the witness resumes with the validated exact answer, no fallback `/commands` request is made, and the browser reports no console/page errors. The full Playwright suite passed 2/2 with two workers; the focused controller/provider contract passed 50/50; scoped lint and strict TypeScript passed.
  - Remaining: Milestone 6 is complete. The automated browser uses Chromium fake media and muted output, so it does not claim real microphone permission, human STT accuracy, speaker audibility, GPU inference, or the Milestone 5 hardware/privacy gate. Begin Milestone 7 animated-courtroom work while retaining the open Milestone 5 external-hardware checks.
  - Commits: `73961a3`, `7f20752`, `e8271a6`, `f032844`, `9c8e7f2`, `7f9a7b8`, and `0dcf8c2`.

- 2026-07-20 01:37 IST - Milestone 7 procedural courtroom foundation
  - Changed: added exact React Three Fiber/Three.js dependencies, a strict renderer-owned `courtroom-presentation-frame.v1` contract, a pure redacted-view-to-presentation selector, and a responsive full-width procedural courtroom with judge, both counsel, active witness, clerk/display, and representative jury. The canvas is a noninteractive enhancement; the existing voice and courtroom controls remain semantic DOM outside it.
  - Safety and recoverability: presentation labels are normalized and deterministically bounded before strict parsing; generic audio playback does not guess an actor from the latest transcript; OS reduced-motion preference reaches the presentation contract; WebGL capability is probed before mounting; the ready marker is emitted only from the first rendered frame; render failure and context loss expose a user-safe fallback without removing hearing controls. The scene uses only repository-authored primitives and is recorded in `docs/ASSETS.md`.
  - Verified: eight focused selector/page-boundary tests, scoped ESLint, strict TypeScript, and the production build passed. Two parallel Chromium fixtures passed: the real partial-objection hearing initialized and rendered the scene before continuing through the existing production-path interruption assertions, while a separately launched `--disable-webgl --disable-software-rasterizer` browser proved the fallback and enabled hearing controls.
  - Remaining: this closes only the scene/assets foundation deliverable, not Milestone 7. Exact audio actor/job/timing events, validated model performance projection, animated state transitions, visemes, camera priority/hysteresis, evidence/ruling/settlement transitions, explicit quality controls, a deterministic visual state atlas, and mid-sentence objection screenshots/video remain open.
  - Commit: `00a4782`.

- 2026-07-20 02:19 IST - Milestone 7 exact local performance stream
  - Changed: added a strict, immutable `hearing-performance-event.v1` contract and a separate observer stream for exact user VAD boundaries plus playback request, audible start, Web Audio-clock timing, and terminal status. Every playback event carries the full generation/fence/job/response/actor/sequence identity together with a bounded semantic scene actor, purpose, turn ID, and interruption ID; transcript-derived actors are resolved from the owner-side view rather than guessed from the latest turn.
  - Safety and races: renderer observers cannot affect microphone or playback ownership; stale jobs and duplicate VAD events are fenced; cancelled and superseded audio completions retain their true terminal status; controller barge-in/close reports cancellation only after local cleanup succeeds and reports playback failure otherwise; every emitted user-speech start receives exactly one service- or controller-sourced end across final, stop, failure, disconnect, and close. The contract accepts the full 292-character derived local partial-interruption bound, and a presentation validation failure cannot strand the active playback slot before synthesis.
  - Verified: strict TypeScript, scoped ESLint, 72 focused contract/controller/audio tests, all 134 speech-library tests, and the full root suite passed. The root suite reported 148 passing files plus three intentional live-only skips, with 1,284 passing tests plus three skips. Two independent read-only reviews found and then confirmed fixes for premature cancellation, duplicate completion mapping, unterminated user speech, max-length local interruption IDs, and final-before-VAD ordering; the final review reported no P0/P1 findings.
  - Remaining: presentation state still uses the static view selector. Next work must add the pure ephemeral animation/camera/mouth reducer, consume this exact stream on the hearing page, animate the R3F scene, project validated model performance safely, and capture the required visual/browser evidence.
  - Commits: `b7da0b4` and `670abc0`.

- 2026-07-20 03:23 IST - Milestone 7 exact performance runtime and renderer checkpoint
  - Changed: added a strict immutable ephemeral presentation reducer with monotonic playback/VAD high-water marks, bounded terminal identities and shape-only mouth cues, the required semantic priority ladder, exact current/pending camera compositions, and 180 ms return hysteresis. The hearing page now subscribes to exact performance events, resets before cross-trial speech can enqueue, memoizes the durable base frame, rebases focus/shot/reduced motion, and schedules one absolute hysteresis wakeup. The R3F scene now blends or cuts camera poses on demand, animates all eleven allowlisted poses, samples mouth cues against the page monotonic clock, exposes only semantic renderer selectors, and stops continuous animation under reduced motion. High/balanced/reduced quality controls remain functional without remounting or hiding hearing controls.
  - Safety and evidence: static recording stands/listens and cannot fabricate speaking before exact VAD. Requested playback may set posture/focus but the mouth remains at rest until the scheduled Web Audio start; terminal events return the mouth to rest while camera composition holds through hysteresis. The browser ledger is bounded and records only allowlisted actor/purpose/pose/camera/mouth attributes, never transcript, timing-mark text, or raw audio. The production-path fixture proves opposing-counsel objection, judge ruling, resumed-witness speech, exact close shots, mouth-after-scheduled-Web-Audio-start ordering, terminal rest, the settled witness/counsel two-shot, and a reduced-motion judge speaker test with cut plus static narrow mouth.
  - Verified: 31 focused presentation/page/renderer tests, strict TypeScript, zero-warning scoped ESLint, the full 1,307-test root suite with three intentional live-only skips, the 19-route production build, and the production-path Playwright fixture passed. The final browser run completed 1/1 in 44.4 seconds including PowerShell-launched fake speech, Next.js, and a 7.07-second linked Convex synchronization without a login prompt. Independent reviews found and confirmed fixes for stale generation/fence resurrection, same-actor and base-to-base camera composition loss, reduced-motion render loops, cross-trial reset ordering, and a test timestamp that previously measured source scheduling call order rather than the scheduled AudioContext start; the final re-review reported no P0/P1 findings.
  - Remaining: Milestone 7 is not complete. Validated GPT performance metadata, evidence and settlement transitions, a deterministic visual state atlas, success-run screenshots/video of every required state, and the primary full-trial Playwright flow remain open. Automated Chromium remains fake-media and muted-output evidence, not a real microphone, physical speaker audibility, or GPU speech claim.
  - Commits: `d32d165`, `378595f`, `361b3b5`, `3b77f41`, `b763b48`, and `01d55c4`.

- 2026-07-20 04:48 IST - Milestone 7 durable semantics and courtroom-transition checkpoint
  - Changed: added a strict v2 committed-performance contract and append-only Convex sidecar for accepted witness, counsel, judge, ruling, negotiation, and jury performance proposals; projected only head-valid public courtroom cues; and retained lazy validation/upgrade for legacy v1 rows. The pure presentation runtime now owns exact evidence/settlement enter, update, switch, and exit phases plus the ready -> gavel -> holding ruling sequence. The hearing page rebases these states against the exact trial head and uses one absolute wake selector for camera, display, and ruling deadlines.
  - Renderer boundary: the page joins a committed cue only after exact local playback has audibly started, against one active non-stricken turn or the exact current ruling head. The adapter removes call/action/event IDs, hashes, evidence IDs, actor provenance, and role `activity`; the stage receives only bounded emotion, intensity, delivery/style, gaze, and gesture values. Model metadata cannot select actor, animation, posture, camera, mouth timing, display lifecycle, or gavel timing. `stand`, `sit`, and `gavel` semantic gestures are intentionally inert. Reduced motion is time-invariant, and one revision/frame-clock cache reduces the R3F demand loop from multiple deep runtime selections to one shared sample per frame.
  - Verified: the linked Convex development deployment accepted the sidecar/functions through `npx convex dev --once` without a login prompt. The final focused semantic/runtime/page/renderer command passed five files and 45 tests; strict TypeScript, zero-warning scoped ESLint, and `git diff --check` passed. The full root suite passed 153 files with three intentional live-only skips (1,336 tests passed, three skipped), and `npm run build` compiled/typechecked and generated all 19 routes in 16.8 seconds. Independent audits found and confirmed fixes for actor-namespace mismatch, stricken/future/cross-trial cue leakage, stale ruling heads, renderer `activity` leakage, duplicate live regions, repeated per-frame deep parsing, and transition-duration drift; the final semantic-renderer review reported no P0-P3 findings.
  - Remaining: Milestone 7 still requires the deterministic visual state atlas, success screenshots/video for every required character state and the mid-sentence objection sequence, plus a primary full-trial Playwright flow with no console errors. Fake-media/muted browser evidence still does not prove a human microphone, physical speaker audibility, or GPU speech quality.
  - Commits: `417a6d4`, `7626539`, `001cf52`, `3ec0e21`, `d56f2bc`, `7c5f92a`, `9ec01e7`, `d50bec1`, and `8859586`.

- 2026-07-20 04:49-05:49 IST - Milestone 7 animated-courtroom gate complete
  - Changed: added 24 strict public-contract visual fixtures covering all eleven character animations, the complete evidence/settlement transition lifecycle, ruling ready/gavel/holding, and reduced-motion inert model gestures; a development/test-only, exact-server-flag atlas route; and a fixed capture clock whose cache is fenced by runtime object identity, revision, and time. Added a fail-closed loopback full-trial provider that reconstructs each trusted request from the binding manifest, verifies its SHA-256 digest, and supports only the named two-witness development scenario.
  - Browser proof: the production hearing now completes a fresh Redwood trial by voice with Rina and Theo, allows each leading partial to follow the real final-bound objection/ruling/resume path, records exactly one canonical answer per witness, releases both witnesses, delivers the player's spoken closing, completes opposing close/jury/debrief, and reloads to an exactly equal durable view without another command. The mid-sentence fixture retains objection, gavel, and resumed-testimony screenshots plus success video. The atlas commits 24 PNG baselines and retains a local success video.
  - Verified: `npm ci`, lint, both TypeScript surfaces, 1,363 root tests with three explicit live-only skips, six evals, 182 speech tests, the six-function authenticated Convex surface, the 19-route production build, and all five Playwright fixtures passed. The browser gate took 2.0 minutes and reported no page or console errors. The screenshot corpus is 2,410,104 bytes with aggregate SHA-256 `ae3b5aee91c86f0be16f5f13f2529dbd7b23796ce2603053760185ca661b506e`; three ignored local WebM artifacts and their hashes are recorded in `docs/build-week/VERIFICATION.md`.
  - Boundary: Chromium uses fake media, deterministic fake STT/TTS and model decisions, and muted output. This proves production-path orchestration and renderer behavior, not human microphone accuracy, physical speaker audibility, CUDA speech performance, or a live GPT-5.6 full trial. Those distinct gates remain open.
  - Remaining: Milestone 7 is complete. Begin Milestone 8 debrief, records, and repeated-evaluation work while retaining the Milestone 5 target-hardware checks and the later live-model/live-GPU acceptance gates.
  - Commits: `7643c77`, `8ddcc2f`, `546f46b`, `8f56ab4`, `c078190`, and `1ccb2ff`.

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
- Terra initially returned schema-shaped grounding-owner placeholders under the v3 compiler contract. The compiler now canonicalizes those placeholders to stable case entity IDs before strict citation/ownership validation; the standard live fixture then passed on its first attempt with three witnesses, five exhibits, eight facts, and three surfaced uncertainties.
- Convex `_storage.sha256` is represented as base64 while CaseGraph/source digests use lowercase hex. Exact base64/base64url/hex normalization is required before associating a storage object with a compile claim; MIME type alone is never sufficient.
- A real two-request race proved that the external OpenAI call can require one targeted repair even when the deterministic contract is correct: the winning request's first streamed response failed `strict_schema_invalid`, the repair was accepted, and the competing request remained a free `409`. The durable claim therefore must fence generations and registrations rather than assuming one provider attempt.
- The adversarial live packet was classified for all five authored patterns (`instruction_override`, `role_impersonation`, `safety_bypass`, `secret_exfiltration`, and `tool_invocation`) while still compiling the fictional facts into a draft; packet text never became instructions.
- Browser-plugin page evaluation intentionally withholds raw `fetch`, XHR, cookie mutation, and local-file constructors. Exact multipart concurrency verification therefore used PowerShell against the real Next.js HTTP boundary, while semantic browser inspection covered the case library and upload surface. Windows Computer Use stopped rather than acting when it could not verify Chrome's URL.

- Active V3 replay cannot authenticate arbitrary historical event IDs without an integrity field. New events therefore use the canonical `event:<actionId>` identity and an immediately preceding causation link; V2-to-V3 migration deterministically remaps legacy event IDs, causation, and event citations before replay validation.
- Evidence authentication required a bounded pre-admission context: witnesses could not cite an unadmitted exhibit when their view exposed admitted exhibits only. `ASK_QUESTION.presentedEvidenceIds` now records the exact seen, non-excluded exhibits shown for identification, and `knowledge-view.v2` exposes only that bounded set to the active witness.
- A full CaseGraph ID/version pair was insufficient to authenticate private witness and settlement material after hydration. Active V3 state now pins a canonical full-graph SHA-256 separately from the legacy source-content digest and rejects any hydrated graph whose complete canonical content differs.
- Browser Convex identity cannot safely stand in for the existing signed anonymous owner cookie: the browser uses an unauthenticated `ConvexProvider`, while private case ownership is `owner:<uuid>`. The V3 hearing therefore reuses the signed HttpOnly cookie through a same-origin Next.js BFF and a server-only Convex service secret; the browser never submits owner, graph, actor, or trusted action metadata.
- One high-level hearing command can span several atomic Convex mutations. A lost response after the first append can leave a valid intermediate state such as `awaiting_oath`; recovery therefore requires retaining the exact request ID, timestamp, expected head, and intent until confirmation. The client reloads the canonical head without clearing input and retries the same idempotency key, while an integration test proves a partial call resumes without duplicate events.
- The legacy `/records` route still reads unauthenticated mutable legacy trial tables. The V3 hearing no longer links to it; owner-bound V3 Court Records and full event pagination remain later deliverables rather than being misrepresented as complete.
- OpenAI's strict Zod helper rejects a discriminated union at the schema root (`Root schema must have type: 'object'`). Runtime call contracts therefore use a strict object root and place any discriminated proposal union inside a required property; the witness contract has a focused conversion test so this provider constraint cannot regress silently.
- The active Convex hearing action can validate and persist model output but cannot relay incremental Responses API deltas through the current Convex HTTP-to-Next JSON chain or bind browser disconnects directly to the provider `AbortSignal`. Live model orchestration therefore belongs in the Next.js server, with Convex exposing secret-only prepare and commit boundaries around its canonical state.
- Terminal model-call audits are immutable by `callId`. Retrying a still-pending witness response after a failed or cancelled provider call therefore requires a fresh audited call ID while retaining the stable response ID and material command identity; reusing the failed call ID would correctly conflict with its terminal trace.
- Published standard GPT-5.6 pricing supports deterministic estimates for Luna and Terra, but the estimator must return `null` when provider counters cannot be partitioned safely into uncached input, cached reads, cache writes, and output. The recorded rates and provenance are [OpenAI's model catalog](https://developers.openai.com/api/docs/models) and [the GPT-5.6 announcement](https://openai.com/index/gpt-5-6/).
- The live courtroom test initially failed safely before any model call because `SUITS_CONVEX_SERVICE_SECRET` was absent from local files. Reading the existing development value into one PowerShell process through `npx convex env get`, without printing or persisting it, then produced a successful real two-witness Luna run; no Convex login was needed.

- The first real opponent-planner attempt exposed a prompt-contract ambiguity rather than a schema failure: the planning view includes testimony `transcriptEventId` provenance, while the accepted call-audit citation contract has no `transcriptTurnIds` scope. Luna cited that visible event on both initial and repair attempts. Planner prompt v2 now explicitly limits citations to fact, evidence, testimony, and source-segment IDs and directs the model to cite `testimonyId`, not `transcriptEventId`; the strict validator and audit contract were not weakened.
- A completed opposing cross must yield explicit player control for redirect. The live smoke initially tried to call the next witness while the prior appearance was correctly at `redirect`; adding an explicit player waiver completed the flow and preserves the no-auto-waiver invariant.
- The bounded multi-actor live run used four planner decisions and four counsel responses per witness: three grounded cross questions plus one examination-ending decision/speech. Across two witnesses this produced 24 accepted Luna calls and one successful targeted planner repair, providing real latency/cost evidence for the three-question cap.
- A public-function audit found 25 remotely callable legacy or low-level Convex functions, including unauthenticated legacy records/mutations and billable OpenAI/ElevenLabs actions. The active V3 BFF path remains owner/secret-bound and the public raw V3 reload has been removed, but only the six authenticated `caseUploads` functions should remain public after the legacy surface is internalized. Existing rows must be preserved rather than deleted.
- Active TrialState intentionally projects only the current head and resumable lifecycle state; it does not retain the exact closing-turn IDs or final verdict payload required by Terra coaching. The final-coaching boundary therefore reconstructs and validates those bindings from the complete ordered TrialEvent stream rather than trusting a lossy snapshot projection.
- Jury and debrief model outputs can contain hidden authoring truth, jury-private reasoning, or coaching inference even when their canonical events are safe to expose. Persisting the exact validated outputs in private owner-bound generated-artifact rows, while committing only stable IDs and public-safe payloads to TrialEvents, preserves both auditability and knowledge isolation.
- The strict closing contract requires public record grounding. A trial with no jury-considerable fact, admitted evidence, or active testimony must stop before the closing/model pipeline instead of manufacturing an uncited closing or verdict.
- The first complete real multi-role trial accepted 28 calls: eight witness answers, nine opponent plans, nine counsel responses, one jury deliberation, and one Terra debrief. Terra coaching alone used 10,296 input/5,048 output tokens and an estimated $0.10353625, about 44% of the $0.2366214 total, so final coaching should remain a single terminal call rather than a reviewer chain.

- A resumed pending response retains its historical `interruptId`; treating every non-null interrupt marker as currently blocked made an overruled objection impossible to answer. The witness boundary now accepts only the exact `resumed` interruption bound to the current response/head, while active, resolved, cancelled, stale, or mismatched interruptions remain rejected.
- Settlement acceptance moves the canonical trial into `debrief` with no verdict. Terra coaching therefore validates a distinct settled-without-verdict audit shape, while user propose/counter/accept commands require an existing jury-considerable record so the resulting coaching cannot be manufactured from an empty case record. Reject and withdraw remain available without creating a settlement outcome.
- The M4 objection window is deliberately application-level: opposing dialogue is prepared and paused before witness generation so the user can object or continue. It proves validated judge reasoning and coherent deterministic resume/cancel behavior, but it is not the partial-STT, cached-audio, or mid-utterance barge-in path reserved for Milestone 6.
- The first live judge-and-settlement complete trial accepted 30 calls. The single Terra debrief used 10,941 input and 7,065 output tokens at an estimated $0.13540375, nearly half of the $0.2775385 run, reinforcing the single terminal coaching-call decision.

- Python and uv were already installed and visible to the user’s PowerShell PATH; the prior inability to invoke them came from the earlier Codex sandbox profile. With full access enabled, the speech service resolves Python 3.12 and uv normally without repository-specific PATH mutation.
- Local speech inference needs process-wide ownership, not only per-WebSocket cancellation. An asyncio task can report cancellation while executor-backed provider work is still physically running, so STT leases remain held through real cleanup and the serialized TTS lane quarantines itself if termination cannot be proven. Cached fixed reactions remain available from immutable memory without re-entering that provider lane.

- Misaki 0.9.4 invokes `spacy.cli.download("en_core_web_sm")` when its English package is absent. Because implicit runtime downloads violate the local-provider boundary, `en_core_web_sm==3.8.0` is now an explicit locked extra and the Kokoro adapter performs a fail-closed package preflight before importing the pipeline.
- Transformers 5.13.1 Nemotron raw-audio feature extraction requires `librosa` and a one-dimensional NumPy array; a Python tuple passes static protocol tests but fails the real feature extractor on `.shape`. The adapter now creates `np.float32` windows lazily and never imports the optional stack in fake/default CI mode.
- The Transformers Nemotron streaming implementation mutates model-instance streaming fields, so sharing one model across simultaneous generation sessions risks transcript cross-contamination. The adapter and configuration enforce one physical native STT session, use tokenized lane release, and require process restart after unconfirmed termination.
- Concurrent Kokoro and Nemotron CUDA initialization failed nondeterministically on Windows even though their steady-state allocation was about 1.5 GiB and both fit the 12,227 MiB GPU. Loading TTS and then STT sequentially was stable; the runtime preserves shared-call coalescing while serializing physical initialization.
- An absolute STT availability snapshot is unsafe when unrelated TTS activity can publish flow control between a browser send and service admission. Monotonic flow revisions plus utterance identity and a cumulative accepted-through sequence let the browser subtract locally sent-but-unacknowledged PCM without double-crediting or guessing from event timing.
- AudioWorklet messages can outpace main-thread consumption even when the speech WebSocket is bounded. The microphone processor therefore needs its own fixed in-flight frame credits and must remain unarmed until the controller has adopted every cleanup resource; otherwise startup sequence zero can be dropped on an already-running `AudioContext`.
- A model metadata lookup is insufficient for readiness because it does not prove the Responses endpoint, quota, or model invocation path used by hearings. The preflight therefore uses two minimal fixed Responses probes, but a process-local cache alone cannot cap cold-instance spend; the protected Convex permit serializes a global five-attempt rolling window before either model call.
- A sticky UI phase is not a valid health signal after an asynchronous speech disconnect. Preflight readiness must also reflect the controller lifecycle, and stale capability facts must remain informational rather than rendering as current provider readiness.
- The long-running Next development process stopped serving and hydrating reliably after repeated hot updates: both static pages and the preflight request timed out. Stopping only the exact workspace-owned listener/parent and starting a fresh process restored a 73 ms page response and a 5,161 ms live preflight. The failed browser-control click after restart remains unverified tooling behavior, not evidence of a passing interactive flow.
- The existing Luna objection resolver cannot safely consume a raw browser partial. Its canonical preparation requires an active durable `ASK_QUESTION -> REQUEST_RESPONSE -> OBJECT -> BEGIN_INTERRUPTION` chain with exact question, response, objection, interruption, and head bindings. The smallest safe M6 seam is therefore one protected final-bound interruption request backed by an atomic four-action Convex preparation, followed by the existing validated ruling loop and atomic ruling commit.
- Cancelling STT immediately at the first detector match would make an often-incomplete partial the canonical question. The safe browser flow must stop further PCM, dispatch the cached reaction, finalize the already-buffered utterance, intercept that exact final so it cannot enter the normal question path, and seal its revision onto the partial trigger before any billable/durable objection work starts.

- A final-bound ruling cannot be whole-chain single-flight if the BFF trusts a fixed heartbeat interval or the raw absolute expiry. The provider must wait for an immediate renewal when the claim is near expiry, every renewal request must time out before `leaseExpiresAt - clockSkew - safetyBuffer`, and claim acquisition must reserve execution time. Otherwise Convex can grant takeover while the prior Luna request is still running.
- Reload recovery cannot enqueue both a pending ruling and its later complete continuation as independent audio jobs. The queue must retain the earliest controller baseline while replacing the pending adoption with the complete response before drain; cancellation/unmount and concurrent courtroom activity also need synchronous fences before canonical publication.
- A generated strike ruling cannot safely rely on ordinary action idempotency alone. If replay is allowed to persist a new call ID, a schema-valid envelope can attach a second accepted audit to an already committed event. Replay must require the exact existing terminal trace for the original owner, trial, call, action, and event.
- A pending judicial motion must be a procedure-wide serialization point. Allowing settlement or another player command to append first makes a head-bound ruling stale, so player commands now fail with `STRIKE_RULING_PENDING` and reload invokes an actorless protected continuation before accepting new work.
- The production interruption path intentionally overlaps the protected ruling request with the short cached objection playback. The coordinator considers the local reaction dispatched once synthesis is queued, while the controller retains the true Web Audio completion and awaits natural drain before dispatching the judge ruling or resumed witness. Measuring drain before the HTTP request contradicts the low-latency runtime and its unit contract; source-identity tracking between exact objection and ruling synthesis markers is the deterministic browser assertion.
- The first valid examination question exists while the leg is `available`, not yet `in_progress`. Projection and voice-policy checks that required only `in_progress` hid/rejected the first question even though the deterministic engine authorized it. Production-path E2E exposed both copies of that assumption.
- A generic browser playback lifecycle cannot identify the character who is currently audible. During cached objection and ruling speech, deriving the speaker from the latest durable transcript would animate the wrong actor because the durable view can publish before its queued audio drains. The scene must remain neutral whenever no exact actor/job/timing event is available; the controller now exposes that exact stream for local playback.
- React Three Fiber's `Canvas` fallback and `onCreated` callback are not sufficient renderer proof. Capability detection, a first-`useFrame` ready signal, an error boundary, and `webglcontextlost`/`webglcontextrestored` handling are required to distinguish a drawn scene from a configured or failed context.
- Valid CaseGraph witness and evidence names can be longer than the intentionally compact renderer label contract. Presentation data must be deterministically normalized and bounded before strict renderer parsing so a valid case cannot crash the hearing UI.
- The speech companion publishes `stt_final` immediately followed by its authoritative `speech_ended` event. A controller fallback emitted from the final handler wins too early in browser task ordering; the fallback must occur only when the owned recording is actually cleared, so the service VAD reason and epoch timestamp can remain authoritative.
- Local partial-objection IDs are derived from generation, utterance ID, and revision and can reach 292 characters even though each speech protocol identifier is limited to 128. Presentation contracts therefore need a distinct bounded local-interruption identifier instead of reusing the transport identifier schema.

- The browser playback adapter schedules each source at least eight milliseconds ahead of `AudioContext.currentTime`. The initial M7 probe timestamped the intercepted JavaScript call, so it could not prove mouth-after-scheduled-start ordering until it retained the `when` value and converted both clocks.
- A durable base reframe can keep the same semantic actor while changing composition, most visibly from `witness_close` to `witness_counsel_two_shot`. Actor-only camera state silently bypassed hysteresis for that case; exact shot ownership fixed it.
- R3F `frameloop="demand"` still becomes a continuous loop when a component calls `invalidate()` on every active semantic frame. Reduced motion required both static pose time and explicit invalidation termination, not only smaller animation amplitudes.
- Durable actor IDs and local speech actor IDs deliberately occupy different namespaces. A browser semantic join must bind through the canonical turn/ruling plus the local scene slot and purpose; comparing those actor strings, or comparing a durable Responses API ID with a local TTS response ID, incorrectly suppresses valid performance.
- Schema-valid committed cues still require cross-field projection fences. Transcript cues must be active, same-trial, and no newer than the current view, while an unscoped current ruling cue must match the exact trial/version/last-event head before it can influence audible presentation.
- `selectCourtroomPresentationRuntime` performs strict snapshot validation and can carry up to 2,048 mouth cues. Calling it independently from several R3F `useFrame` callbacks multiplies deep parsing/scanning cost; one cache keyed by immutable runtime revision plus the shared frame clock preserves exact time sampling with one selection per demand frame.
- Fixed capture clocks can still collide across independent synthetic runtimes because each may begin at the same revision. A deterministic renderer cache must include runtime object identity as well as revision and time or the atlas can reuse another fixture's snapshot.
- Fake STT partials may advance to the final revision before an explicit test stop reaches the service. A production-path full-flow test must let the final-bound interruption finish naturally and assert the canonical durable turn instead of attempting a second submission.
- The no-action opposing-counsel path releases the active witness within the same `finish_witness` command in the current scenario; no redirect phase is created merely to satisfy a linear test script.
- Next.js normalizes `/hearing/` to `/hearing` on reload. Durable recovery assertions must bind trial identity and canonical head/view equality, not the cosmetic trailing-slash spelling.

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
- Bind private upload workspaces to a signed 30-day owner cookie and derive upload/case/claim identities from owner, request UUID, and content digest. Never accept a caller-selected durable identity or trust forwarding headers unless the configured proxy address is itself trusted.
- Treat one compile generation as the billable unit. Completed replay and live competitors are free; every retry or expired-lease takeover consumes a new durable quota attempt. Complete the claim in the same Convex transaction as the draft writes, retain generation/token fencing on every intermediate action, and clear the lease token when completion becomes durable.
- Keep storage reconciliation additive and conservative: exact seven-day retention, digest-and-time claim association, a final transactional reference check, bounded cursor/generation locks, append-only audit rows, daily scheduling, and deletion disabled unless `SUITS_STORAGE_RECONCILER_DELETE_ENABLED=1` is explicitly configured.
- Keep all seeded matters fictional and educational, with three or more witnesses, evidence/fact provenance, contradictions, and private settlement controls. User uploads remain drafts until explicit human review and publication.

- Freeze trial V1/V2 and policy V1/V2 exactly; add active V3 fields and deterministic migrations rather than mutating historical contracts. Preserve `caseGraphHash` as the legacy source digest and use the distinct `caseGraphContentHash` for full immutable hydration integrity.
- Treat presenting an exhibit for identification as distinct from offering it into evidence. Any examining counsel may identify a non-excluded case exhibit that the pinned witness has seen; only policy-authorized counsel may offer it, and admission revalidates every active authenticating testimony ID.
- Keep settlement V3 bilateral until per-recipient decisions and all-required acceptance semantics are modeled. A V3 offer therefore has exactly one recipient party, while frozen historical schemas remain unchanged.
- Make public Convex trial append owner-derived and player-counsel-only. Judge, AI, deterministic, speech-system, and recovery actions use a separate trusted internal boundary; callers cannot forge canonical actors, trial ownership, graph publication, projection versions, or snapshot cadence.
- Bind each V3 browser hearing to the deterministic server-selected counsel for its chosen side. Do not accept browser-selected actor IDs, even for another counsel on the same side, because party-scoped KnowledgeViews and private settlement authority differ.
- Route V3 hearing starts, commands, and reloads through the signed owner-cookie Next.js BFF and secret-protected Convex HTTP service. Expose only strict high-level player intents and a redacted `HearingRuntimeView`; canonical state JSON, raw event payloads, policy snapshots, hidden facts, private strategy, and trusted append are server-only.
- Retain a pending start/command request unchanged until the durable response is confirmed. On transport or stale-state failure, reload the owner-bound projection, preserve the user's input, and offer an exact-key retry so a partially applied multi-event command can finish idempotently.
- Represent witness dialogue as bounded, phrase-sized grounded segments. Flatten only a fully validated proposal into the canonical `ANSWER_QUESTION` action; prior-statement IDs and semantic performance remain audit/rendering metadata, while the engine receives only its existing text/fact/evidence payload.
- Use fixed server-owned language for insufficient-knowledge, outside-scope, cannot-recall, and unclear-question dispositions. The model selects the disposition and performance only, preventing a nominal refusal from becoming a free-text leakage channel.
- Run interactive courtroom intelligence in the Next.js server with `gpt-5.6-luna`, then revalidate a fresh Convex head before trusted append. Keep `gpt-5.6-terra` reserved for case compilation and final coaching, and never substitute authored dialogue when a live provider output is invalid, cancelled, or stale.
- Commit an accepted generated courtroom action and its accepted audit in the same Convex transaction. The standalone terminal-audit boundary accepts only failed or cancelled calls, so a crash cannot leave accepted model output recorded without its canonical event or vice versa.
- Allocate a new audited call ID for each provider retry while preserving the pending response/action identity. This keeps immutable failed/cancelled traces replay-safe without allowing multiple material answers for one courtroom request.

- Keep the active AI hearing runtime user-side-only until lead-counsel ownership is modeled. Reject `userSide: "opposing"`, zero/multiple user counsel, and zero/multiple opposing counsel before creating a durable trial instead of selecting an arbitrary actor or failing mid-hearing.
- Bound each AI-owned examination leg to three answered questions. At the cap, expose no further question opportunity and require a final planner plus counsel examination-ending turn, yielding at most 11 model steps after a completed player examination.
- Never auto-waive redirect or recross to simplify orchestration. Return the completed AI examination to the player and require an explicit high-level `finish_witness` decision before release or continuation.
- Keep planner citation categories that lack durable call-audit support empty, even when similarly named provenance IDs are visible as context. Expand the accepted-citation audit contract first if transcript-turn, instruction, rule, issue, or settlement-offer citations later become material.
- Internalize the unauthenticated legacy Convex records, mutation, eval, and provider actions before further deployment work. Preserve their data and CLI-admin evaluation path, remove browser links to legacy records, and lock the resulting public function allowlist with a regression check.
- Commit each accepted jury generation as one atomic bundle containing the Luna deliberation action, deterministic verdict/debrief phase transitions, the verdict derived from the validated recommendation, the private exact artifact, and its terminal trace. Commit the accepted Terra coaching action, completion transition, private artifact, and terminal trace with the same atomicity so a crash cannot expose a partial accepted finale.
- Keep full jury deliberation and Terra coaching artifacts out of TrialEvents, snapshots, and browser projections. Store them only in the owner-bound generated-artifact ledger and bind public events through stable decision/action/event IDs, hashes, schema versions, prompt versions, model roles, and exact source heads.
- Reject zero-record closing before any write. Do not weaken the required public-grounding citation contract or invent deterministic support merely to force a trial to completion.

- Commit each accepted objection decision as one transaction containing the Luna judge ruling, deterministic interruption resolution, optional deterministic speech resume, and terminal call audit. M4 permits only the two outcomes the current response lifecycle can execute exactly: sustained/cancel and overruled/resume. Rephrase remains a Milestone 6 speech-orchestration outcome rather than a silently accepted no-op.
- Keep negotiation reasoning private and derive every material party, offer, parent, expiry, action, and event identity server-side. The model may recommend only a request-allowed counter, accept, or reject with strict citations and terms; the deterministic engine and atomic mutation decide whether it commits.
- Treat M4 revision handling as immutable response/call identity plus stale-head rejection and cancellation. Do not conflate that gate with revisioned partial STT, which remains an explicit Milestone 5/6 deliverable.
- Pause an AI question response at the protected application boundary until the player chooses object or continue. This provides deterministic user agency now without claiming audible mid-sentence interruption before the local speech companion exists.

- Keep the local speech transport loopback-only with a strict `suits.speech.v1` subprotocol, bounded JSON/binary frames, hello timeout, connection/session/utterance/queue limits, revision and response identities, and explicit client acknowledgements. Raw microphone PCM stays inside this browser-to-local-service boundary and is neither persisted nor forwarded to Convex or OpenAI.
- Prewarm the three canonical courtroom reactions atomically from configured local voices during explicit model loading. Publish no partial cache, persist no generated audio, expose only stable clip IDs in capabilities, and allow cached playback without a new synthesis call; failure leaves the full cache unready and retryable.

- Pin the speech extras as two mutually exclusive uv profiles: `local-cpu` uses the official PyTorch CPU index and `local-cuda` uses the official CUDA 13.0 index. Both include the exact Kokoro package, Transformers 5.13.x, `librosa`, and the offline English wheel; the default `dev` sync remains lightweight and must not install real providers.
- Keep large model transfer behind `setup-local-speech.ps1 -DownloadModels` with exact repository revisions and literal file allowlists. Provider `load()` calls must use explicit local snapshots, `local_files_only=True` where applicable, and must never repair a missing cache by contacting a hub.
- Count the 2026-07-19 real-model closed loop as provider/STT/TTS evidence only. It is not microphone, browser playback, mid-sentence objection, or end-to-end courtroom proof; those gates remain open until exercised through the production browser path.
- Reconcile browser microphone capacity from cumulative service watermarks, never by replacing locally debited credits with a later absolute snapshot. Reject impossible watermark identities or sequences and ignore stale revisions.
- Keep capture and playback bounded independently of the WebSocket: arm the worklet only after browser resources are owned, allow at most eight unacknowledged worklet frames, acknowledge TTS only after playback accepts a frame, and use the browser output-latency estimate before reporting audible completion.
- Make local microphone preparation and speaker playback separate explicit preflight actions. Never request microphone access on mount or as a side effect of server/model readiness checks; revoke local ready state immediately when the controller reports a recoverable/fatal disconnect.
- Probe the two pinned GPT-5.6 models with fixed server-owned content only, `store:false`, low reasoning, and no case/transcript/audio data. Share successful results for five minutes, degraded results for fifteen seconds, and require a serializable protected Convex permit so parallel server instances cannot amplify billable calls beyond five preflight snapshots per rolling ten minutes.
- Treat the partial detector as a conservative local latency optimization, never as legal authority. The browser envelope is intentionally actorless; the protected service must reload the exact owner-bound trial head, derive counsel/witness/rules, rerun the detector with canonical context, and reject any forged or stale candidate before appending events.
- Use final-bound dispatch for the production M6 path: the partial may stop PCM and trigger the cached “Objection!” performance immediately, but the durable question and protected resolver request must bind the exact final STT text/revision. Keep immediate partial dispatch available only as an isolated coordinator mode for a future separately audited candidate-model path.

- Persist the exact final-bound four-event prefix atomically before Luna reasoning, then allow only the server-held lease owner to commit the matching judge ruling and optional resumed witness answer. Treat the canonical objection ground, question/response/event IDs, source/committed heads, decision ID, and target completion head as one immutable scope.
- Keep final-bound lease tokens server-only. Use the shared 30-second durable duration, a conservative five-second cross-service clock-skew allowance, a one-second pre-expiry abort buffer, and a bounded 60-second acquisition window that releases late claims rather than starting model work near the route deadline.
- Treat a revised final that no longer matches the partial candidate as a no-write withdrawal at the unchanged source head. Play only the neutral local correction "Correction. The objection is withdrawn."; never invent a judge ruling for an event that was not committed.
- Recover interruptions through an owner-only BFF route with no browser-selected interrupt, actor, ground, or lease authority. Publish the durable head before audio, suppress historical performance, coalesce pending-to-complete recovery before drain, and fence aborted or concurrent recovery before mutating page state.
- Offer AI strike motions only against active public testimony elicited by the player in the current direct or redirect leg. Consume the opportunity after one motion in the appearance, regardless of disposition, to keep planning bounded and prevent repetitive motions.
- Materialize a generic judge strike decision as exactly one append-only ruling event with embedded speech and one terminal call audit in the same Convex transaction. Derive every action, motion, turn, fact-strike, and event identity server-side.
- Treat pending generic judicial work like interrupted-speech recovery: expose only an owner/trial actorless continuation boundary, no browser-selected directive or actor, and return the current view without generic dispatch while a leased final-bound interruption remains active.
- Let protected ruling evaluation overlap cached objection playback to preserve latency, but never let judge or witness audio overtake it: retain the exact playback-completion promise, require natural Web Audio drain, and only then synthesize the ruling and continuation.
- Keep automated speech E2E hardware-independent and production-path: use Chromium fake media, muted output, a dedicated loopback fake companion, real framed WebSocket traffic, the real browser controller/BFF/Convex path, and a narrowly gated server-only decision provider. Do not grant real microphone permission or claim audible/GPU verification from this fixture.
- Start the animated courtroom with original procedural Three.js primitives and no external binary assets. This establishes deterministic rendering, a documented asset origin, responsive layout, and a safe semantic boundary before introducing licensed rigs, textures, or animation files.
- Keep renderer state subordinate to validated application contracts. The scene consumes an immutable allowlisted presentation frame, never the controller, model output JSON, transcript text, case summary, fact propositions, evidence descriptions, or arbitrary Three.js properties.
- Do not fabricate an audible actor from the durable transcript. Generic playback remains neutral when no exact local event is available; the hearing performance stream now carries explicit stable scene bindings, Web Audio timing, and cancellation fencing for renderer consumption.
- Keep exact local audio/VAD performance as a separate ephemeral renderer stream rather than a material trial event. Bind every playback update to the full controller identity and semantic scene purpose, use the Web Audio clock for mouth timing, and treat observer/schema failures as presentation failures that cannot retain microphone or playback ownership. Durable GPT-selected emotion/gesture metadata remains a separately authorized Convex sidecar decision and is not inferred from this stream.
- `AudioBufferSourceNode.start()` schedules against the AudioContext clock and may target a future `when`; the JavaScript call timestamp is not an audible-start timestamp. Browser timing evidence must convert that scheduled context time to the page monotonic clock, and muted fake-media automation must not claim physical speaker audibility.
- Camera actor identity is insufficient to preserve composition: the witness can validly own both a close shot and a witness/counsel two-shot. The ephemeral runtime therefore owns the exact current and pending shot in addition to actor, priority, and cue order.
- Reduced motion must freeze time-varying pose functions and stop mouth/pose self-invalidation after the event-triggered frame. A static semantic speaking state is not permission to run a perpetual render loop.
- Persist accepted GPT performance metadata in an append-only Convex sidecar bound to the exact call/action/event/turn/head/output hash, not by mutating material trial events. Project only public courtroom cues whose source and head still match canonical state; validate and lazily upgrade legacy v1 rows without inventing missing model output.
- Join durable semantics to local presentation only at the last browser boundary and only after exact audible start. Pass the renderer a structurally reduced allowlist with no role `activity` or provenance; keep actor, lifecycle, posture, camera, mouth, display, and ruling/gavel ownership in the deterministic local runtime.
- Sample the validated presentation runtime once per R3F demand frame and share that immutable snapshot across figures, display, gavel, and metadata. Use one prioritized atomic live region for transition or actor status so simultaneous visual changes do not create competing accessibility announcements.
- Keep the visual atlas fail-closed behind the server-only `SUITS_ENABLE_VISUAL_ATLAS=1` flag in development/test. Construct every fixture through public reducer/schema boundaries, freeze it with a fixed page clock, and return `notFound()` in production or without the exact flag.
- Commit the deterministic 24-image Chromium/Windows PNG baseline so visual regression is reviewable in git. Keep Playwright WebM recordings ignored as local build evidence and publish their byte counts, durations, and SHA-256 hashes instead of silently committing generated video binaries.
- Keep the complete-trial model fixture server-only and fail-closed to development/test, exact loopback hosts, and the named scenario. Reconstruct the trusted request from the server binding manifest plus the untrusted envelope and require an exact digest match before returning any scripted decision.

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

- 2026-07-18 18:06–23:01 IST — Milestone 2 completion gate
  - `$env:RUN_OPENAI_LIVE='1'; npm run test:live:case-compiler` — exit 0; real `gpt-5.6-terra` Responses API stream accepted on the first attempt in 58,654 ms with three witnesses, five evidence items, eight facts, three uncertainties, and no validation issues. Usage was 7,286 input, 11,427 output, 18,713 total, 3,682 cache-write, and 1,034 reasoning tokens.
  - `$env:RUN_OPENAI_LIVE_INJECTION='1'; npm run test:live:case-compiler-injection` — exit 0 after strengthening the gate; real adversarial packet accepted on the first attempt in 74,146 ms with request/response ID `resp_0d12e785ac31b16b016a5bbb67403c819a9e2764b6285dff0b`. The test proved the exact clean packet title, party/issue/witness/evidence/fact IDs, fact statuses, and settlement controls remained intact while all five injection patterns were detected and no validation issues remained. Usage was 7,422 input, 12,213 output, 19,635 total, 3,682 cached input, and 1,338 reasoning tokens.
  - `.\scripts\verify-case-compile-singleflight.ps1` — exit 0 against `http://127.0.0.1:3000`; session establishment returned 200, and two byte-identical 12,501-byte multipart requests with request ID `aa5e9665-24c7-49d1-a5fd-6ef0385a007c` produced `409 CASE_COMPILATION_IN_PROGRESS` in 1,369 ms with `Retry-After: 60` and one `200` in 61,753 ms. The identical retry returned 200 in 439 ms with `X-SUITS-Replayed: true` and the same upload/case identity. The committed PowerShell verifier asserts every status/header/identity condition and emits machine-readable evidence.
  - Earlier persisted live-race compiler audit — model `gpt-5.6-terra`, prompt `case-compiler.prompt.v3`, schema `case-compiler.output.v3`, 121,043.84 ms total and one targeted repair. Attempt 1 (`resp_07eb6d67a82bad67016a5bb4911e0c81998ab501418a15fd45`) streamed 39,748 characters and failed `strict_schema_invalid`; attempt 2 (`resp_030ccf1ef901cbe7016a5bb4d78f48819bb636293432153d69`) streamed 39,709 characters and was accepted. The response audit retained per-attempt usage, latency, request/response IDs, retry count, and accepted citations.
  - Convex post-race inspection — one completed generation-1 claim, one quota attempt, lease token/expiry cleared, completion/quota timestamps present, upload versions 1 (`uploaded`) and 2 (`indexed`) sharing one storage object, three total storage objects, three referenced objects, zero unreferenced objects, and zero dangling references.
  - `npx convex dev --once` — exit 0; additive claim/reconciler functions and indexes ready on development deployment `cheery-bandicoot-36` at 22:51:51 IST. `SUITS_STORAGE_RECONCILER_DELETE_ENABLED=0`; no production deployment or deletion sweep was invoked.
  - `npx vitest run tests/fixtures/case-packets/case-packets.test.ts src/server/case-ingestion/ingestion.test.ts src/server/case-ingestion/adapters/adapters.test.ts src/server/case-compiler/case-compiler.test.ts src/server/case-compiler/openai-provider.test.ts src/domain/seeded-cases/catalog.test.ts src/components/case-editor/case-graph-review-editor.test.tsx src/components/case-editor/case-workbench.test.ts src/components/case-editor/case-source-review.test.tsx src/app/api/cases/compile/route.test.ts` — exit 0; 10 files and 69 M2 acceptance tests passed.
  - `npx vitest run convex/casePublication.integration.test.ts` — exit 0; one real Convex transaction test proved owner draft reopen/list, edited publication, two immutable graph versions, human-review audit/provenance, latest published reopen/list, rejected cross-owner publication, and continued cross-owner read isolation.
  - `npm ci` — exit 0; 436 packages installed and 437 audited. Two moderate dependency advisories and three pending npm install-script review notices remain reported, not silently treated as fixed.
  - `npm run lint` — exit 0; the same five pre-existing warnings and no errors.
  - `npm run typecheck` — exit 0.
  - `npm test` — exit 0; 50 files passed, two live-only files explicitly skipped by their environment gates; 313 tests passed and two skipped.
  - `npm run eval` — exit 0; one file and three legacy eval tests passed.
  - `npx tsc -p convex/tsconfig.json --noEmit` — exit 0.
  - `npm run build` — exit 0; Next.js 16.2.10 production build compiled/typechecked, completed static generation 16/16, and reported all expected app routes, including five owner/case API routes, three seeded static case pages, and the dynamic case workbench.

- 2026-07-19 01:49–02:13 IST — Milestone 3 engine/persistence checkpoint
  - `npx vitest run src/domain/trial-engine src/domain/trial-policy src/domain/knowledge src/domain/case-graph convex/trialEvents.integration.test.ts` — exit 0; 16 files and 181 tests passed.
  - `src/domain/trial-engine/milestone3.acceptance.test.ts` — included in the focused gate; completed a three-witness both-sides call/recall script with one excluded exhibit, one stricken statement, one hidden fact revealed atomically, one rejected settlement, pause/reload, both closings, instructions, deliberation, verdict, debrief, completion, and two byte-identical replays.
  - `src/domain/trial-engine/audit-regressions.integration.test.ts` — included in the focused gate; 17 adversarial tests passed for serialized witness isolation, inconsistent START mappings, recess mutation/open-work rejection, invalidated foundation, independent fact support, bilateral settlement shape, event/citation/causation/response-envelope tampering, admissible assertion bases, jury-safe citations, and duplicate completion artifacts.
  - `convex/trialEvents.integration.test.ts` — included in the focused gate; ten tests passed for owner-derived create/read, public-player versus trusted append boundaries, atomic event/projection/snapshot/receipt writes, exact idempotent replay, action-ID conflicts, expected-version concurrency, snapshot/full replay, exact offset timestamps, payload-version migration handoff, envelope validation, pagination, and legacy handoff.
  - `npm test` — exit 0; 63 files passed, two live-only files skipped; 427 tests passed and two skipped.
  - `npm run lint` — exit 0; the same five known warnings and no errors.
  - `npm run typecheck -- --pretty false` and `npx tsc -p convex/tsconfig.json --noEmit` — exit 0.
  - `npm run eval` — exit 0; one file and three legacy eval tests passed.
  - `npm run build` — exit 0; Next.js 16.2.10 compiled/typechecked and generated all 16 pages. This verifies the checkpoint build, not the still-pending V3 hearing-runtime cutover.
  - `git diff --check` — exit 0.

- 2026-07-19 02:13–03:21 IST — Milestone 3 V3 runtime completion gate
  - `npx vitest run src/domain/hearing-runtime src/domain/hearing-journey.test.ts src/server/hearing-api/http.test.ts src/app/hearing/page.source.test.ts src/app/api/hearings/route.test.ts convex/hearingRuntime.integration.test.ts` — exit 0; nine files and 34 tests passed. Coverage includes strict no-owner/no-graph/no-actor browser contracts, redacted role projections, relative counsel labels, server-projected call/recall/action capabilities, exact V3 trial IDs, owner-cookie BFF edges, bounded legacy-call-graph rejection, seeded/private start, cross-owner denial, multi-witness orchestration, exact replay, resume, and partial-command recovery.
  - `convex/hearingRuntime.integration.test.ts` partial-command case — manually committed only the first `CALL_WITNESS` event, observed `awaiting_oath`, then retried the identical high-level request; the runtime reached direct examination with exactly one `CALL_WITNESS` and one `SWEAR_WITNESS` event.
  - `npx convex dev --once` — exit 0 at 03:02 and again after recovery hardening at 03:17; development deployment `cheery-bandicoot-36` accepted the V3 hearing functions and `trialProjections.by_owner` index. Existing Convex CLI authentication was valid; no login or production deployment occurred.
  - Secret-protected PowerShell cloud smoke against `/service/hearings/start`, `/service/hearings/command`, and `/service/hearings/read` — exit 0; created `trial_cd5405e1ae2d44a78b56cab9140c1c9d` for an ephemeral owner, called `witness_rina_shah`, committed question/answer events, advanced sequence/version from 3 to 8, produced two transcript turns, replayed the exact question command with an unchanged head, and reloaded the same version/event ID. No secret value was printed.
  - `npm run lint` — exit 0; four generated Convex unused-disable warnings and no errors.
  - `npm run typecheck -- --pretty false` and `npx tsc -p convex/tsconfig.json --noEmit` — exit 0.
  - `npm test` — exit 0; 71 files passed, two live-only files skipped; 456 tests passed and two skipped.
  - `npm run eval` — exit 0; one file and three legacy eval tests passed.
  - `npm run build` — exit 0; Next.js 16.2.10 compiled/typechecked, completed static generation 17/17, and listed the three owner-bound V3 hearing API routes plus `/hearing` and all case launch surfaces.
  - `git diff --check` — exit 0 before the scoped implementation commits.

- 2026-07-19 03:39–03:51 IST — Milestone 4 contract checkpoint
  - `npm exec -- vitest run src/domain/courtroom-ai` — exit 0; two files and 14 tests passed.
  - `npm exec -- eslint src/domain/courtroom-ai` — exit 0 with no warnings or errors.
  - `npm run typecheck` — exit 0.
  - `git push origin main` after `05ca446` and `d162fb6` — exit 0; both scoped contract commits are present on `origin/main`.
  - OpenAI Luna live runtime check — not run at this checkpoint; it remains an explicit Milestone 4 gate, not a pass.

- 2026-07-19 03:51–04:53 IST — Milestone 4 witness runtime and live checkpoint
  - `npm exec -- vitest run src/server/courtroom-ai src/domain/hearing-runtime/model-boundary.test.ts` — exit 0; 60 tests passed across the streamed provider, environment adapter, pricing, witness orchestration, strict contracts, redaction, cancellation, repair, and precommit binding.
  - Focused courtroom-call persistence and atomic generated-append suites — exit 0; 19 tests passed, including owner isolation, exact replay, conflicting trace rejection, accepted event/audit atomicity, and full rollback after an injected trace conflict.
  - `npm exec -- vitest run convex/hearingRuntime.integration.test.ts` — exit 0; seven tests passed for isolated preparation, fresh retry call IDs, refusal to fabricate model-required answers, accepted AI append/audit, exact prepare/commit replay, foreign-fact/cross-owner/stale rejection, and multi-witness resume.
  - Protected hearing BFF/domain/Convex integration slice — exit 0; 32 tests passed for secret-only prepare/commit/terminal-audit routing, safe diagnostics, disconnect cancellation, accepted commit, failed-call audit, and rejection of the removed direct Convex model-required path.
  - `npm run typecheck -- --pretty false`, `npm exec -- tsc -p convex/tsconfig.json --noEmit`, scoped ESLint, and `git diff --check` — exit 0.
  - `npx convex dev --once` — exit 0; functions ready on development deployment `cheery-bandicoot-36` without a login prompt. It added `courtroomModelCallAttempts.by_call_attempt` plus `courtroomModelCalls.by_call_id`, `.by_owner_trial`, and `.by_trial_time`.
  - Initial `$env:RUN_OPENAI_LIVE_COURTROOM='1'; npm run test:live:courtroom-witness` — exited before a provider request with the intended configuration error because the local files do not persist `SUITS_CONVEX_SERVICE_SECRET`; this failed preflight is not counted as a live pass.
  - Process-local development-secret retrieval followed by `$env:RUN_OPENAI_LIVE_COURTROOM='1'; npm run test:live:courtroom-witness` — exit 0; one real test passed in 22.576 seconds for trial `trial_f45026de69a54df5981989d7b05542c7`. Luna answered `witness_rina_shah` with 2,105 input/120 output tokens and estimated cost $0.002825, then `witness_theo_morgan` with 2,199 input/130 output tokens and estimated cost $0.002979. Both calls had zero repairs, distinct call IDs, only request-scoped citations, atomic durable events/audits, and byte-equivalent owner reload at the final head.
  - Opposing counsel, judge, settlement, jury, and Terra coaching were not exercised by this live test and remain unverified; this evidence does not satisfy the full multi-role Milestone 4 gate.

- 2026-07-19 04:53–06:59 IST — Milestone 4 opposing-counsel runtime and live checkpoint
  - `npm exec -- vitest run src/server/courtroom-ai/opponent-planner-prompt.test.ts src/server/courtroom-ai/opponent-planner.test.ts src/domain/courtroom-ai/opponent-planner.test.ts` — exit 0; 15 strict planner contract, prompt-boundary, validation, repair, and trace tests passed.
  - `npm exec -- vitest run src/domain/hearing-runtime/model-boundary.test.ts convex/hearingRuntime.integration.test.ts convex/trialEvents.generated.integration.test.ts` — exit 0; 116 tests passed for v2 prompt/precommit binding, private directive replay, atomic model/event commits, bounded continuation, exact recovery, and stale/conflict rejection.
  - `npm exec -- vitest run src/server/courtroom-ai/witness-runtime.live.test.ts convex/hearingRuntime.integration.test.ts` without the live flag — exit 0; 13 deterministic hearing-runtime tests passed and the one live-only test skipped as intended.
  - `npm exec -- convex dev --once` — exit 0; the linked `cheery-bandicoot-36` development functions were ready in 6.08 seconds without a login prompt.
  - The first configured opponent live run stopped safely with a durable failed `plan_opponent` audit: two validation attempts both reported only `unknown_transcript_turn_citation`, 8,895 input/856 output tokens, and estimated cost $0.01244435. No opponent action was committed. This failure drove the versioned citation-prompt correction rather than a validator relaxation.
  - Process-local Convex secret retrieval followed by `npm run test:live:courtroom-witness` — exit 0; one real multi-actor test passed in 124.294 seconds for `trial_c1a64355e5144fb2899f6e06a38a4313`. Persisted traces contain 24/24 accepted Luna calls: `witness_answer` 8 calls, 17,881 input/1,402 output tokens, $0.026293; `plan_opponent` 8 calls, 46,915 input/4,229 output tokens, one repair, $0.0517069; `counsel_response` 8 calls, 28,404 input/2,295 output tokens, $0.0321876. Totals were 93,200 input/7,926 output tokens, one validation repair, zero failed calls, and $0.1101875 estimated cost.
  - `npm run lint`, `npm run typecheck`, `npm exec -- tsc -p convex/tsconfig.json --noEmit`, `npm test`, `npm run eval`, `npm run build`, and `git diff --check` — exit 0. Lint reported only four generated Convex warnings; 97 files/720 tests passed with three expected live-only skips; three evals passed; Next.js 16.2.10 compiled/typechecked and generated 17/17 pages.
  - `git push origin main` through `42f5703` — exit 0; all scoped opponent-runtime, security-boundary, prompt-v2, recovery, and live-workflow commits are on `origin/main`.
  - Judge, objection, settlement, jury, Terra coaching, full-trial completion, local speech, and the unauthenticated legacy public Convex surface remain unverified or unfinished; none are reported as passed by this checkpoint.

- 2026-07-19 07:08–07:12 IST — Convex legacy public-surface hardening
  - `npm exec -- vitest run src/app/records/page.test.tsx src/app/hearing/page.source.test.ts` — exit 0; three tests passed and no active page links to `/records` or reads legacy trial APIs.
  - Legacy function audit plus focused domain/eval tests — exit 0; all nine assigned modules contain no public `action`, `mutation`, or `query` builders and no legacy provider action retains an `api.*` dependency; 34 focused tests passed.
  - `npm exec -- vitest run src/server/hearing-api/trial-events-boundary.source.test.ts src/server/hearing-api/convex-public-surface.source.test.ts convex/trialEvents.integration.test.ts` — exit 0; 14 tests passed for internal-only low-level event writes, raw replay isolation, the exact six-function source allowlist, authenticated upload ownership, and event-stream behavior.
  - PowerShell parser validation for `scripts/verify-convex-public-surface.ps1` and `scripts/run-legacy-gate3.ps1` — exit 0. `npm run eval` also remained green; `npm run eval:gate3` was intentionally not run because it performs five real Terra calls.
  - `npm exec -- convex dev --once` — exit 0; functions ready on `cheery-bandicoot-36` in 6.85 seconds without another login.
  - `npm run verify:convex-surface` — exit 0 against the deployed function spec; exactly six public functions remain: `caseUploads.generateUploadUrl`, `registerStoredUpload`, `getLatest`, `listMine`, `getDownloadUrl`, and `listSourceSegments`.
  - `npm run lint`, `npm run typecheck`, `npm exec -- tsc -p convex/tsconfig.json --noEmit`, `npm test`, `npm run eval`, `npm run build`, and `git diff --check` — exit 0. Lint reported four generated warnings and no errors; 99 files/724 tests passed with three expected live-only skips; three evals passed; Next.js generated 17/17 pages.
  - `git push origin main` through `59bcdf7` — exit 0. The deployment contains the same visibility changes; the worktree remained clean after sync.

- 2026-07-19 08:18–08:31 IST — Milestone 4 generated jury and coaching runtime checkpoint
  - `npx tsc -p convex/tsconfig.json --noEmit --pretty false` and `npx tsc --noEmit --pretty false` — exit 0; the Convex and root TypeScript surfaces accepted the final-audit query, replay lookup, atomic generation mutations, service routes, and final continuation orchestration.
  - Scoped ESLint over `convex/hearingRuntime.ts`, `convex/trialEvents.ts`, `convex/http.ts`, the updated integration/source tests, and the courtroom command files — exit 0 with no errors.
  - `npx vitest run convex/hearingRuntime.integration.test.ts` — exit 0; one file and 14 tests passed. The completed-flow case asserts the exact 16-event final tail, exactly one Luna `DELIBERATE` and one Terra `GENERATE_DEBRIEF`, two correctly typed private artifacts, exact model roles/schema versions, no deterministic mock ending, no raw artifact or hidden truth in the owner view, exact replay without duplication, conflicting replay rejection without overwrite, and cross-owner read denial.
  - `npx vitest run convex/hearingRuntime.integration.test.ts src/server/hearing-api/convex-http.source.test.ts src/app/hearing/page.source.test.ts src/server/hearing-api/courtroom-command.test.ts` — exit 0; four files and 23 tests passed, including strict secret endpoint schemas/references and no-record closing rejection before a model call or durable write.
  - `npx convex dev --once` — exit 0; the linked `cheery-bandicoot-36` development deployment accepted the four `courtroomGeneratedArtifacts` indexes and reported functions ready in 6.52 seconds without a login prompt.
  - `npx vitest run convex/hearingRuntime.integration.test.ts` after the independent audit — exit 0; one file and 15 tests passed. The added regression commits a Luna `unable_to_reach` recommendation and asserts the exact non-winner decision is preserved in both the deterministic `RENDER_VERDICT` payload and private jury artifact without mapping it to either side.
  - `npx eslint convex/hearingRuntime.integration.test.ts` and `npx tsc -p convex/tsconfig.json --noEmit --pretty false` — exit 0 after the non-winner regression.
  - `npm run lint`, `npm run typecheck`, `npx tsc -p convex/tsconfig.json --noEmit --pretty false`, `npm test`, `npm run eval`, and `npm run verify:convex-surface` — exit 0. Lint reported only four generated-file warnings; 114 files/847 tests passed with three explicit live-only skips; three evals passed; both TypeScript surfaces passed; and the linked deployment still exposes exactly six authenticated upload functions.
  - `npm run build` — exit 0; Next.js 16.2.10 compiled/typechecked and generated all 17 pages, including the protected hearing routes.
  - The extended live-test harness compiled, linted, and skipped without `RUN_OPENAI_LIVE_COURTROOM=1`; it requires one accepted Luna jury call, one accepted Terra coaching call, a completed durable trial, and an exact owner reload.
  - Process-local Convex secret retrieval followed by `$env:RUN_OPENAI_LIVE_COURTROOM='1'; npm run test:live:courtroom-witness` — exit 0; one real complete-trial test passed in 186.031 seconds for `trial_0071e21294254faca268b091ce702db6`. It completed two role-isolated user witnesses, both bounded opposing cross examinations, opposing closing, jury deliberation, verdict, Terra coaching, durable completion, and exact owner reload through the protected service boundaries.
  - A read-only PowerShell in-memory aggregate over `npx convex data courtroomModelCalls --limit 250 --format json` and `courtroomGeneratedArtifacts --limit 100 --format json`, filtered to that trial without printing raw rows, found 28/28 accepted calls, 116,023 input and 14,052 output tokens, one accepted planner repair, estimated total cost $0.2366214, and exactly two private artifacts (`jury_deliberation` on `gpt-5.6-luna`, `final_debrief` on `gpt-5.6-terra`). Task totals were: eight witness calls, 17,684/1,366 tokens, $0.02588; nine planner calls, 52,290/4,522 tokens, one repair, $0.0623973; nine counsel calls, 32,581/2,388 tokens, $0.0369566; one jury call, 3,172/728 tokens, $0.00785125; and one debrief call, 10,296/5,048 tokens, $0.10353625.
  - `git diff --check` — exit 0 before the checkpoint plan update.
  - Judge/objection and settlement live-runtime coverage remains pending; this finale proof does not report those paths as passed.

- 2026-07-19 09:48–10:16 IST — Milestone 4 judge, objection, settlement, and complete live gate
  - `npx vitest run convex/hearingRuntime.integration.test.ts src/domain/courtroom-ai/witness-answer.test.ts src/domain/hearing-runtime/objection-boundary.test.ts src/domain/hearing-runtime/settlement-boundary.test.ts src/server/courtroom-ai/objection-ruling.test.ts src/server/courtroom-ai/negotiation-agent.test.ts src/server/hearing-api/courtroom-command.test.ts src/server/hearing-api/convex-http.source.test.ts src/app/api/hearings/route.test.ts` — exit 0; nine files and 74 tests passed across strict precommits, provider generation, protected HTTP/Next orchestration, and API behavior.
  - `npx vitest run convex/hearingRuntime.integration.test.ts src/domain/courtroom-ai/witness-answer.test.ts` — exit 0 after the resumed-response fix and final atomic-conflict cases; two files and 31 tests passed. The Convex suite proves sustained/cancel and overruled/resolve/resume chains, resumed witness generation, exact replay, stale/tampered/cross-owner rejection, rollback on terminal-trace conflict, AI counter/accept/reject, player acceptance of an AI counter, settled Terra preparation without a verdict, and completed settled coaching.
  - `npm run lint`, `npm run typecheck`, `npm test`, `npm run eval`, and `npm run build` — exit 0. Lint reported four generated-file warnings and no errors; 116 files/876 tests passed with three explicit live-only skips; three evals passed; and Next.js 16.2.10 compiled, typechecked, and generated 17/17 pages.
  - `npx tsc -p convex/tsconfig.json --noEmit --pretty false`, scoped ESLint, and `git diff --check` — exit 0 for the Convex runtime, event mutations, boundaries, routes, orchestration, and integration tests.
  - `git push origin main` — exit 0 for `e622142` (`feat: commit generated objection and settlement actions`) and `ea27f4e` (`test: prove objection and settlement model loops`).
  - `npx convex dev --once` — exit 0; `cheery-bandicoot-36` reported functions ready in 6.81 seconds without a login prompt.
  - `npm run test:live:courtroom-witness` without the opt-in flag — exit 0 with one explicit skip. The first flagged preflight then failed in 4 ms before any model call because the local service secret was absent/short; no product state changed. Loading the already-configured development value into one PowerShell process via `npx convex env get`, without printing or persisting it, and rerunning with `RUN_OPENAI_LIVE_COURTROOM=1` — exit 0; the real protected trial passed in 228,802 ms (`trial_c2e0b65b75fa478ebe4cde79476f4a28`).
  - The live test asserted exact role/model/task/usage bindings for the Luna judge (`resolve_objection`), Luna settlement counsel (`evaluate_settlement`), Luna jury, and Terra debrief; two scoped direct witnesses; bounded opposing examinations; no citation outside each request; durable completion; and exact owner reload. The canonical event stream contains one `OBJECT`, `BEGIN_INTERRUPTION`, AI `RULE_ON_OBJECTION`, deterministic `RESOLVE_INTERRUPTION`, deterministic `RESUME_INTERRUPTED_SPEECH`, user `PROPOSE_SETTLEMENT`, AI `COUNTER_SETTLEMENT`, user `REJECT_SETTLEMENT`, Luna `DELIBERATE`, and Terra `GENERATE_DEBRIEF`.
  - A read-only PowerShell aggregate over `npx convex data courtroomModelCalls --limit 250 --format json` and `trialEvents --limit 500 --format json`, filtered in memory without printing raw rows, found 30/30 accepted calls, 124,007 input and 16,791 output tokens, one accepted planner repair, and estimated cost $0.2775385. Task counts were eight witness answers, nine opponent plans, nine counsel responses, one objection ruling, one settlement evaluation, one jury deliberation, and one debrief.

- 2026-07-19 10:16–13:26 IST — Milestone 5 bounded local speech and cached-reaction checkpoint
  - `cd services/speech; uv sync --extra dev` — exit 0; 35 packages resolved and 34 checked in the local environment.
  - `uv run ruff format --check src tests` and `uv run ruff check src tests` — exit 0; all 29 files were formatted and all lint checks passed.
  - `uv run mypy --strict src/suits_speech` — exit 0; all 16 source files passed strict typing.
  - `uv run pytest -q` — exit 0; 126 tests passed. The only warning is Starlette TestClient’s upstream `httpx` deprecation; it is not reported as a product pass or silently suppressed.
  - `uv run pytest tests/test_clip_cache.py tests/test_app.py tests/test_session.py -q` — exit 0; 23 focused tests passed for atomic/idempotent cache prewarm, invalid-output rejection, cancelled-waiter isolation, capability publication, and binary cached playback with acknowledgements and no post-warm provider call.
  - `git diff --check` — exit 0 before the scoped fixed-reaction commit.
  - `git push origin main` — exit 0 through `75afb5d`; the bounded speech actor and fixed-cache implementation are on `origin/main`.
  - Real Nemotron/Kokoro/CUDA and microphone/browser audio verification were not run and are not counted as passed.

- 2026-07-19 13:26–14:54 IST — Milestone 5 real local-provider verification
  - `scripts/setup-local-speech.ps1 -Runtime local-cuda -DownloadModels` — exit 0 in 215.2 seconds. The locked CUDA extra installed `torch==2.11.0+cu130` and `transformers==5.13.1`; only the literal Nemotron and Kokoro file allowlists were fetched at revisions `df1f0fe9dfdf05152936192b4c8c7653d53bf557` and `f3ff3571791e39611d31c381e3a41a3af07b4987`; the final read-only doctor returned `overallStatus: ready` with the NVIDIA GeForce RTX 5070 and 12,227 MiB visible.
  - Re-running `scripts/setup-local-speech.ps1 -Runtime local-cuda` after the lockfile corrections — exit 0 in 1.2 seconds; 146 packages resolved, 124 checked, no model download was requested, and every runtime/dependency/artifact doctor check passed, including `en_core_web_sm`, `librosa`, eSpeak NG, and both exact snapshots.
  - `$env:SUITS_RUN_LIVE_SPEECH_SMOKE='1'; $env:SUITS_SPEECH_MODE='cuda'; $env:SUITS_SPEECH_CACHE_DIR = Join-Path $env:LOCALAPPDATA 'SUITS\speech'; uv run --no-sync python -m suits_speech.smoke` — exit 0 in 13.6 seconds. The safe JSON report returned `status: passed`, `finalMatched: true`, 109 20 ms chunks, four partial revisions, first partial at 1,112 ms, 54 ms finalization, 9,671 ms provider/fixed-clip load, 85 ms subsequent TTS, and 12,001 ms total. The fixed phrase and PCM remained in memory; output contains metrics and the fixed expected normalized phrase, not PCM or arbitrary provider text.
  - `uv lock --check`, `uv run ruff format src tests`, `uv run ruff check src tests`, `uv run mypy --strict src`, `uv run pytest -q`, and `git diff --check` — exit 0; all 20 source modules passed strict typing and 172 tests passed. The only warning is Starlette TestClient's upstream `httpx` deprecation.
  - Failed attempts retained as discoveries rather than passes: missing `en_core_web_sm` caused Misaki to install at first real load; missing `librosa` blocked Nemotron; tuple PCM windows caused the real processor to raise `AttributeError`; and concurrent CUDA provider construction made Kokoro loading nondeterministic. Explicit locked dependencies, fail-closed offline preflight, NumPy windows, terminal padding/revision regressions, and serialized TTS-then-STT loading corrected each issue before the passing smoke.
  - No real browser microphone or audible playback was exercised. This evidence does not close the microphone/browser gate, the raw-audio-to-Convex/OpenAI audit, or Milestone 6 mid-sentence interruption.

- 2026-07-19 15:39–16:00 IST — Milestone 5 browser transport and audio-pipeline verification
  - `cd services/speech; uv run ruff format --check src tests; uv run ruff check src tests; uv run mypy --strict src; uv run pytest -q; uv lock --check` — exit 0; 38 files were already formatted, Ruff passed, all 20 source modules passed strict typing, 175 tests passed, and 146 locked packages resolved. The only warning is Starlette TestClient's upstream `httpx` deprecation.
  - `npx vitest run src/lib/speech` — exit 0; seven test files and 50 tests passed for protocol parsing, exact loopback transport, cumulative STT credit reconciliation, terminal debit retention, TTS acknowledgements, armed worklet resampling/credits, capture cleanup, playback pressure/timing/cancellation, and audible drain fencing.
  - `npx eslint src/lib/speech public/worklets/suits-mic-processor.js` and `npx tsc --noEmit --pretty false` — exit 0.
  - `git push origin main` — exit 0 through `59e46f3`; the cumulative service protocol, browser client, browser audio pipeline, and environment defaults are on `origin/main`.
  - Browser microphone permission, real audible speaker output, visual preflight, and the production-path raw-audio audit were not exercised and remain open.

- 2026-07-19 16:20–18:48 IST — Milestone 5 voice-first hearing and bounded-preflight verification
  - `npx vitest run src/lib/speech src/app/hearing` plus the focused controller/source suites — exit 0; 12 files and 97 tests passed for voice-policy invariants, controller lifecycle/cancellation, phrase playback, stale response fencing, developer-control gating, and hearing integration.
  - `npx vitest run src/domain/preflight.test.ts src/server/preflight src/app/api/preflight src/app/preflight convex/preflightHttp.integration.test.ts` — exit 0; seven files and 22 tests passed after the final accessibility/error-guidance additions. The independent final audit reran a slightly broader eight-file/25-test slice with no remaining P0–P2 finding.
  - Scoped ESLint, `npx tsc --noEmit --pretty false`, `npx tsc -p convex/tsconfig.json --noEmit --pretty false`, and `git diff --check` — exit 0. The only scoped CSS lint invocation reported that CSS is outside the ESLint configuration; it was not counted as a CSS lint pass.
  - `npx convex dev --once` — exit 0; linked deployment `cheery-bandicoot-36` reported functions ready in 8.02 seconds without a login prompt. Executable Convex HTTP tests proved authorized strict no-store health, unauthorized/malformed rejection, and durable quota exhaustion.
  - A PowerShell POST to `http://127.0.0.1:3000/api/preflight` with strict `{}` and same-origin headers — exit 0; HTTP 200 and `suits.server-preflight.v1` overall `ready` in 5,161 ms, with Convex ready in 982 ms, Luna ready in 4,500 ms, Terra ready in 2,576 ms, and `Cache-Control: no-store`. Only safe status/latency fields were printed.
  - `npm run build` — exit 0 in 13.9 seconds; Next.js compiled, typechecked, prerendered 19/19 pages, and registered `/preflight` plus `/api/preflight`.
  - In-app browser static review — the preflight page rendered at the normal 1,265×711 viewport with no warning/error console entries and no visible desktop layout defect. The automation click focused but did not dispatch; a later visible/fresh-tab attempt timed out and reset the browser-control session. This is recorded as an unverified interactive browser action, not a pass. No microphone permission or speaker playback was requested.
  - `git push origin main` — exit 0 for `5e0307c` (`feat: bound system preflight checks`) and `d52864c` (`feat: add system preflight workspace`).

- 2026-07-19 19:09–19:42 IST — Milestone 6 partial-candidate/coordinator verification
  - `npx vitest run src/domain/objections` — exit 0; two files and 45 tests passed. Coverage includes every conservative detector signal and negative context gate; rule filtering; minimum confidence; exact utterance/generation/head/revision fencing; equivalent-revision replacement; withdrawal and provider/delivery recovery; async cached-reaction ordering and cancellation; final-bound dispatch; sealed-final retry; ignored-abort model/delivery callbacks; error-observer containment; safe metrics; and stale result suppression.
  - `npx eslint --max-warnings 0 src/domain/objections`, `npx tsc --noEmit --pretty false`, and `git diff --check -- src/domain/objections` — exit 0.
  - `npm test` — exit 0 after the final coordinator hardening; 136 files and 1,039 tests passed with three explicit live-only skips.
  - Two independent read-only audits plus primary review identified the required protected integration seam. The current slice has no imports outside `src/domain/objections`, performs no network or durable mutation, and is not counted as cached-audio, Convex, Luna, or E2E interruption proof.
  - `git push origin main` — exit 0 for `6e5b874` (`feat: detect partial objection candidates`) and `1bd6853` (`feat: coordinate partial objection interrupts`).

- 2026-07-19 19:42-22:36 IST - Milestone 6 durable final-bound interruption verification
  - `npx vitest run src/app/api/hearings/route.test.ts` - exit 0; 21 BFF tests passed. They cover exact owner/session/origin binding, no browser authority or lease-token disclosure, whole-ruling single-flight, delayed-claim renewal before provider dispatch, hung-renew abort before the skew-adjusted takeover deadline, invalid-horizon and late-claim release, pre-aborted guard settlement, immutable objection ground, current/historical response authority, witness-failure salvage, no-write withdrawal, and owner-only reload recovery.
  - `npx vitest run src/lib/speech src/app/hearing` - exit 0; 13 files and 121 tests passed. Coverage includes partial/final fencing, cached objection/ruling delivery, neutral withdrawal correction, pending recovery after audio failure, exact resumed-witness binding, ruling dedupe, barge-in, durable baseline adoption, pending-to-complete queue coalescing, and abort-before-publication.
  - `npx vitest run convex/finalBoundInterruption.integration.test.ts convex/trialEvents.integration.test.ts convex/hearingRuntime.integration.test.ts` - exit 0; three files and 47 tests passed for the atomic prefix, claim/renew/release/takeover, same-transaction credential revalidation, exact ruling/witness commits, recovery reconstruction, no-write withdrawal, and ordinary non-final-bound compatibility.
  - `npx eslint` over the changed interruption, route, controller, page, and Convex files; `npm run typecheck`; and `npx tsc -p convex/tsconfig.json --noEmit --pretty false` - exit 0. Two independent final re-audits found no remaining actionable page, recovery, lease, identity, or ground-binding issue.
  - `npm run lint` - initial exit 1 because ESLint traversed `services/speech/.venv` and linted PyTorch's vendored JavaScript. Adding `**/.venv/**` to the global ignore fixed the repository configuration; the rerun exited 0 with only the four existing generated Convex warnings.
  - `npm test` - exit 0; 141 files passed, three live-only files skipped, 1,201 tests passed, and three tests skipped. `npm run eval` - exit 0; three evals passed. `npm run typecheck` and Convex TypeScript - exit 0.
  - `npm run build` - exit 0 in 14.9 seconds; Next.js 16.2.10 compiled/typechecked, generated 19/19 pages, and registered both protected interruption routes. `npm run verify:convex-surface` - exit 0; exactly six authenticated public Convex functions remain.
  - `npx convex dev --once` - exit 0; the linked `cheery-bandicoot-36` development deployment became ready in 7.95 seconds without a login prompt and added `finalBoundInterruptionClaims.by_claim_id`, `.by_interrupt`, and `.by_owner_trial`. No production deployment, microphone permission, audible playback, or live final-bound Luna request was exercised in this checkpoint.
  - `git push origin main` - exit 0 through `affd284`; all scoped implementation, test, lint-ignore, and generated-type commits are on `origin/main`.

- 2026-07-20 00:14 IST - Milestone 6 strike-motion and recovery verification
  - `npx vitest run convex/hearingRuntime.integration.test.ts convex/trialEvents.integration.test.ts src/server/hearing-api/convex-http.source.test.ts src/domain/hearing-runtime/opponent-strike-opportunities.test.ts` - exit 0 during the focused gate; 47 tests passed before the final replay and recovery regressions were added. Final individual suites passed 25 hearing-runtime tests and 21 trial-event persistence tests.
  - `npx vitest run src/app/hearing/page.source.test.ts src/app/api/hearings/route.test.ts src/server/hearing-api/durable-service.test.ts` - exit 0; three files and 26 tests passed for actorless recovery forwarding, malformed-response rejection, same-origin/session enforcement, real prepared-model orchestration, page reload wiring, and stale-head fencing.
  - `npm test` - exit 0; 145 files passed, three live-only files skipped, 1,251 tests passed, and three tests skipped. `npm run eval` - exit 0; two files and six tests passed, including seven named objection-flow assertions.
  - `npm run lint` - exit 0 with only the four existing generated Convex warnings. `npm run typecheck`, `npm exec -- tsc -p convex/tsconfig.json --noEmit`, and `git diff --check` - exit 0.
  - `npm run build` - exit 0 in 16.2 seconds; Next.js 16.2.10 compiled/typechecked and generated 19/19 pages; the route manifest includes `/api/hearings/[trialId]/continuation/recover`.
  - `npx convex dev --once` - exit 0; linked development deployment `cheery-bandicoot-36` reported functions ready in 7.56 seconds without a login prompt. No production deploy, microphone permission, audible playback, Playwright run, or live Luna strike decision was exercised in this checkpoint.
  - `git push origin main` - exit 0 through `8bf4dfb`; the pure opportunity selector, judge orchestration, atomic ruling/audit, persistence regressions, and protected reload recovery are on `origin/main`.

- 2026-07-20 00:22-01:05 IST - Milestone 6 production-path Playwright verification
  - `npm run test:e2e -- tests/e2e/hearing-objection.spec.ts` - exit 0; one Chromium fixture passed in 38.2 seconds including server startup. Its PowerShell launcher ran `npx convex dev --once`; linked deployment `cheery-bandicoot-36` became ready in 6.77 seconds without a login prompt. The test exercised the real page/controller/WebSocket/Python fake-speech/protected-route/Convex chain and asserted partial-before-final dispatch, active playback stop, service cancellation, strict final-bound schema, durable head advancement, natural reaction-audio drain before ruling audio, exact resumed testimony, no command fallback, and an empty browser error list.
  - `npm run test:e2e` - exit 0; both `preflight.smoke.spec.ts` and `hearing-objection.spec.ts` passed with two Chromium workers in 37.9 seconds. The synchronized Convex deployment became ready in 6.26 seconds; the dedicated fake speech WebSocket accepted the hearing connection.
  - `npm test -- src/lib/speech/hearing-controller.test.ts src/server/hearing-api/e2e-final-bound-provider.test.ts` - exit 0; two files and 50 tests passed, including the intentional ruling-request/playback overlap and the loopback/development-only provider gate.
  - `npm run typecheck`, `npx eslint playwright.config.ts tests/e2e/hearing-objection.spec.ts`, and `git diff --check` - exit 0.
  - Chromium used `--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream`, `--autoplay-policy=no-user-gesture-required`, and `--mute-audio`. This is production-path orchestration proof, not real microphone, audible speaker, CUDA, or live-Luna evidence; those claims remain explicitly open under their own gates.
  - `git push origin main` - exit 0 through `0dcf8c2`; the isolated speech/Next harness, fail-closed decision fixture, first-question fixes, fake streaming-capability correction, and browser acceptance test are on `origin/main`.

- 2026-07-20 01:25-01:37 IST - Milestone 7 procedural courtroom foundation verification
  - `npm run typecheck` and scoped `npx eslint` over the presentation domain, courtroom components, hearing page/source test, and both courtroom Playwright fixtures - exit 0.
  - `npx vitest run src/domain/courtroom-presentation src/app/hearing/page.source.test.ts` - exit 0; two files and eight tests passed. Coverage proves the fixed six-role ensemble, no copied case summary/fact/evidence-description markers, immutable frames, bounded long witness/evidence names, recording state, neutral generic playback, visible evidence presentation, pending-response thinking, reduced-motion camera cuts, and completed-leg floor handling.
  - `npm run build` - exit 0 in 15.7 seconds; Next.js 16.2.10 compiled/typechecked and generated 19/19 pages with the dynamically loaded client-only courtroom canvas.
  - `npx playwright test tests/e2e/courtroom-fallback.spec.ts tests/e2e/hearing-objection.spec.ts --project=chromium` - exit 0; two tests passed with two workers in 42.6 seconds. The normal fixture required `data-renderer-ready=true` from the first R3F frame before exercising the real page/controller/WebSocket/Python fake-speech/protected-route/Convex interruption chain. The second browser disabled WebGL and software rasterization, observed `data-renderer-state=unavailable`, displayed the safe fallback, and retained an enabled `Call witness` control.
  - The successful hearing fixture attached `playwright-report/data/5fcfc07bc67766c7585e546e9a1d1535512d3625.png`: 1,240 x 615, 119,277 bytes, SHA-256 `12159d45a6076969bbc63a61c1f165888c1a39dd39abfcba3fa35247c65b7b39`. Primary visual inspection confirmed the procedural architecture and six semantic role labels render without covering the hearing controls. The ignored report artifact is a static checkpoint, not a committed pixel baseline or proof of animated objection/ruling states.
  - Development logging retains one upstream R3F warning that `THREE.Clock` is deprecated; there were no browser console errors or page errors. The previous repeated deprecated soft-shadow warning was removed by selecting the supported percentage-closer shadow mode explicitly.
  - `git push origin main` - exit 0 through `00a4782` (`feat: add procedural courtroom stage`).

- 2026-07-20 02:10-02:19 IST - Milestone 7 exact local performance stream verification
  - `npm run typecheck` - exit 0 after the final max-ID and final/VAD ordering fixes.
  - Scoped `npx eslint` over both audio playback files, the performance contract/tests, and the hearing controller/tests - exit 0 with no warnings or errors. Full `npm run lint` also exited 0 with only four pre-existing unused-disable warnings in Convex generated files.
  - `npx vitest run src/lib/speech/hearing-performance.test.ts src/lib/speech/audio-playback.test.ts src/lib/speech/hearing-controller.test.ts` - exit 0; three files and 72 tests passed. Coverage includes audible-before-timing ordering, immutable exact identities, max-length local interruption bindings, throwing observers, authoritative final-then-VAD ordering, controller fallbacks, close/failure cleanup, cancellation/supersession mapping, and late-event fencing.
  - `npx vitest run src/lib/speech` - exit 0; all 11 files and 134 tests passed.
  - `npm test` - exit 0; 148 files passed and three intentional live-only files skipped, with 1,284 tests passed and three skipped.
  - `git diff --check` - exit 0 before commit. `git push origin main` - exit 0 through `b7da0b4` (`feat: define hearing performance event contract`) and then `670abc0` (`feat: stream exact hearing performance events`).

- 2026-07-20 02:37-03:23 IST - Milestone 7 runtime, animation, and browser verification
  - `npm run typecheck`, scoped `npx eslint` over the runtime/page/renderer/E2E slice with `--max-warnings 0`, and `git diff --check` - exit 0 after the exact-shot and scheduled-start fixes.
  - `npx vitest run src/domain/courtroom-presentation src/components/courtroom/courtroom-runtime.source.test.ts src/app/hearing/page.source.test.ts` - exit 0; four files and 31 tests passed. Coverage includes high-water/tombstone fencing, all eleven semantic poses, bounded shape-only timing, exact current/pending shots, same-actor and base-to-base hysteresis, recording-without-fabricated-speech, trial reset ordering, reduced-motion cuts/static pose, and renderer data boundaries.
  - `npm test` - exit 0; 150 files passed, three live-only files skipped, 1,307 tests passed, and three tests skipped.
  - `npm run build` - exit 0 in 16.1 seconds; Next.js compiled/typechecked and generated all 19 routes/pages.
  - `npm run test:e2e -- tests/e2e/hearing-objection.spec.ts` - exit 0; one Chromium production-path fixture passed in 44.4 seconds (23.3-second test body). Its PowerShell harness synchronized `cheery-bandicoot-36` in 7.07 seconds without a login prompt and used fake media plus muted output. The bounded semantic ledger proved objection -> ruling -> resumed witness order, close-shot blends, scheduled-Web-Audio-start-before-mouth timing on the shared page clock, terminal rest, settled return to the witness/counsel two-shot, reduced-quality switching without renderer loss, and a reduced-motion cut/static-mouth speaker test. The pure runtime tests prove the exact 180 ms threshold. This does not claim human microphone, physical speaker, or GPU inference evidence.
  - Two independent review rounds found and drove fixes for monotonic playback/VAD fencing, exact camera composition, same-actor/base-to-base hysteresis, reduced-motion demand-loop termination, cross-trial reset ordering, and source-call-versus-scheduled-audio timing. Final focused re-review reported no P0/P1 findings.
  - `git push origin main` - exit 0 through `361b3b5` (`feat: add fenced courtroom performance runtime`), `3b77f41` (`fix: preserve same-actor camera hysteresis`), `b763b48` (`feat: animate exact courtroom performance`), and `01d55c4` (`test: verify courtroom performance sequence`). The earlier quality-control commits `d32d165` and `378595f` are also on `origin/main`.

- 2026-07-20 03:51-04:48 IST - Milestone 7 committed semantics and transition verification
  - `npx convex dev --once` - exit 0; the linked `cheery-bandicoot-36` development deployment accepted the committed-performance sidecar schema/indexes and functions without a login prompt.
  - Focused v2 projection/sidecar suites plus `npm run typecheck` and scoped ESLint - exit 0; the final pre-render checkpoint passed 151 files with three skipped and 1,322 tests with three skipped before the renderer integration.
  - `npm exec -- vitest run src/components/courtroom/courtroom-semantic-style.test.ts src/components/courtroom/courtroom-runtime.source.test.ts src/app/hearing/page.source.test.ts src/domain/courtroom-presentation/semantic.test.ts src/domain/courtroom-presentation/runtime.test.ts` - exit 0; five files and 45 tests passed. Coverage proves active/non-stricken exact-turn and exact-ruling-head joins, no pre-audio or terminal influence, no role-activity/provenance leakage, inert model `stand`/`sit`/`gavel`, bounded affect, reduced-motion time invariance, privacy-safe enum selectors, exact-actor application, evidence/settlement/ruling phases, and one validated runtime selection per R3F frame.
  - `npm run typecheck`, scoped ESLint over the page/renderer/style slice with `--max-warnings 0`, and `git diff --check` - exit 0.
  - `npm test` - exit 0 in 12.7 seconds; 153 files passed, three live-only files skipped, 1,336 tests passed, and three skipped.
  - `npm run build` - exit 0 in 16.8 seconds; Next.js compiled/typechecked and generated all 19 routes/pages.
  - Two independent reviews found no blocking transition issues and no P0-P3 semantic-renderer issues after fixes for duplicate live regions, repeated deep selection, cross-trial/future/stricken cues, stale ruling heads, actor namespaces, and lifecycle leakage.
  - `git push origin main` - exit 0 through `417a6d4`, `7626539`, `001cf52`, `3ec0e21`, `d56f2bc`, `7c5f92a`, `9ec01e7`, `d50bec1`, and `8859586`.

- 2026-07-20 04:49-05:49 IST - Milestone 7 visual and full-trial verification
  - `npm ci` - exit 0 in 21.1 seconds; 457 packages installed. npm reported two moderate dependency advisories and three lifecycle scripts pending explicit approval; no breaking `npm audit fix --force` or implicit script approval was applied.
  - `npm run lint` - exit 0 in 18.5 seconds with zero errors and the four existing unused-disable warnings in generated Convex files. `npm run typecheck` - exit 0. `npm exec -- tsc -p convex/tsconfig.json --noEmit --pretty false` - exit 0.
  - `npm test -- --reporter=dot` - exit 0 in 14.29 seconds; 156 files passed, three live-only files skipped, 1,363 tests passed, and three skipped. `npm run eval` - exit 0; two files and six tests passed. `npm run verify:convex-surface` - exit 0; exactly six authenticated public functions.
  - `uv sync --project services/speech --locked --extra dev` completed. The first immediate combined invocation exposed a transient pytest plugin-autoload failure (87 async collection/runtime failures) and is not counted as a pass; diagnostics then proved `pytest_asyncio` installed and registered. `uv run --project services/speech python -m pytest services/speech/tests -q` reran independently and exited 0 in 7.9 seconds with all 182 tests passing and one upstream Starlette/httpx deprecation warning.
  - `npm run build` - exit 0 in 17.5 seconds; Next.js 16.2.10 compiled/typechecked, generated 19/19 pages, and retained the fail-closed dynamic atlas route.
  - `npm run test:e2e` - exit 0 in 123.1 seconds; all five Chromium tests passed. The two production-path hearing bodies took 28.2 seconds and about 1.2 minutes; the 24-state atlas took 20.0 seconds; WebGL fallback and preflight smoke also passed. Assertions cover partial-before-final objection, cancellation, ruling, exact resumed testimony, two called/released witnesses, spoken closing, opposing close, jury/debrief completion, exact durable reload equality, no post-reload command, disabled production composer, and empty page/console error ledgers.
  - The committed 24-PNG baseline under `tests/e2e/courtroom-visual-atlas.spec.ts-snapshots/` totals 2,410,104 bytes. Its sorted `filename sha256` corpus digest is `ae3b5aee91c86f0be16f5f13f2529dbd7b23796ce2603053760185ca661b506e`. The strict comparison permits at most 0.5% differing pixels at a 0.2 per-pixel threshold.
  - Ignored local video evidence under `docs/build-week/artifacts/m7/`: `mid-sentence-objection.webm` is 1,481,208 bytes / 26.920 seconds / SHA-256 `f217cb1aa40647a4c3d5fe4730fd69e6fb948b7fcd647a3376b877099ff5b50e`; `complete-two-witness-trial.webm` is 2,004,921 bytes / 72.440 seconds / SHA-256 `448639d15ca559fb8efa2099a291033ef6ba50897addd8a35a279b1303961de8`; `courtroom-visual-atlas.webm` is 1,641,624 bytes / 21.600 seconds / SHA-256 `7433776a51f3718c143b7bfb5ca5fc0fe1c670982df38506c66c497db0d3d62c`.
  - Automated Chromium used fake media, deterministic fake STT/TTS and server-only scripted model decisions, plus muted output. No human microphone, physical speaker audibility, CUDA speech performance, or live GPT-5.6 full-trial claim is made. `npm run verify` is a Milestone 9 deliverable and does not yet exist.
  - `git push origin main` - exit 0 through `1ccb2ff`; all Milestone 7 implementation and test commits are on `origin/main`.

## 17. Blocked external prerequisites

Only list genuine external blockers such as absent API credentials, unavailable CUDA hardware, unavailable microphone permission, or missing deployment access. Include the command that will verify the item once unblocked.

- None yet.
