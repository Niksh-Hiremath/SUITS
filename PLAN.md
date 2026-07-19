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
- [ ] role-specific KnowledgeView prompts;
- [ ] cancellation/revision handling;
- [ ] validation and targeted repair;
- [x] prompt/version/cost/latency traces;
- [x] deterministic mock/replay adapter;
- [x] live integration smoke command.

Gate:

- [ ] Mock integration suite passes all role and validation scenarios.
- [ ] With a key available, at least one live GPT-5.6 multi-witness trial completes without knowledge leakage or unsupported admitted facts.
- [x] Runtime witness/counsel answers are accepted GPT-5.6 outputs, not authored golden-answer replacements.

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
- [x] Milestone 2 complete.
- [x] Milestone 3 complete.
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

## 17. Blocked external prerequisites

Only list genuine external blockers such as absent API credentials, unavailable CUDA hardware, unavailable microphone permission, or missing deployment access. Include the command that will verify the item once unblocked.

- None yet.
