# SUITS — Execution Roadmap

> A two-phase, step-by-step build roadmap for Hermes Agent.
>
> **Project:** SUITS, a voiced moot-court coach for fictional cases  
> **Track:** AI as Agency  
> **Team:** Solo  
> **Core outcome:** A user completes a short hearing and receives a downloadable, transcript-grounded Case Debrief.  
> **Product boundary:** Educational coaching with fictional cases only; never present SUITS as legal advice.

---

## 0. Instructions for Hermes

Execute this document in order. Treat every checkbox as work to complete and verify, not merely a suggestion.

### Operating rules

1. Read `PLAN.md`, `HANDBOOK.md`, and `HACKATHON.md` before changing code.
2. Preserve Hermes session receipts and make small, descriptive commits so judges can verify that Hermes was the coding partner.
3. Work on one step at a time. Do not begin a step whose prerequisite gate has not passed.
4. After every meaningful change, run the narrowest relevant checks, then run the end-to-end golden path at each gate.
5. Never commit credentials, API keys, private case rubrics, raw user audio, or unnecessary personal data.
6. Prefer a reliable deterministic path over a broader probabilistic feature.
7. If a provider fails, follow the fallback branch in this roadmap immediately; do not spend more than the stated timebox debugging it.
8. Record actual latency, token use, cost, retries, errors, and fallbacks. Never invent proof or claim an unverified integration.
9. Keep the app deployable after every gate. A fresh browser must be able to use the current build.
10. When time is short, apply the cut order in Section 3. Do not cut the golden path.

### Definition of the golden path

A golden-path run must:

- create or resume one fictional trial;
- complete all required phases in a code-controlled order;
- let the user perform at least one decisive cross-examination exchange;
- produce at least one voiced AI response, while retaining typed input/output fallback;
- generate a jury verdict based only on the transcript;
- generate a schema-valid Case Debrief with a strength, missed opportunity, evidence references, and revised closing;
- link debrief findings to real transcript turns;
- store a complete Court Records trace with handoffs, timing, tokens, cost, retries, and status;
- recover gracefully from one expected edge case; and
- work from a public deployment in a fresh browser.

### Required quality gates

Do not mark a gate complete unless all listed checks pass. If a gate fails:

1. save the failure and error details in the trace or development notes;
2. fix the smallest root cause;
3. rerun the failed check;
4. rerun the full gate; and
5. cut optional scope if the gate is behind schedule.

---

# Phase 1 — Before the Hackathon

## Goal of Phase 1

Arrive with the product scope, provider choices, data contracts, golden case, eval criteria, accounts, and demo plan settled. Do not build the scored product before the event if the rules prohibit it. Phase 1 should remove uncertainty and prepare allowed scaffolding, notes, schemas, fixtures, and verification scripts.

## Step 1. Confirm eligibility and the allowed starting point

**Purpose:** Avoid disqualification and establish exactly what can exist before kickoff.

- [ ] Read the eligibility, starting-point, scoring, submission, and demo sections in `HANDBOOK.md`.
- [ ] Confirm the registered track is **AI as Agency** and record that decision in project notes.
- [ ] Confirm the build is solo and that any pre-existing helper utilities are allowed.
- [ ] Make an inventory of every existing file, component, prompt, case fixture, and deployment.
- [ ] Label each item as `allowed helper`, `event-day build`, or `requires mentor approval`.
- [ ] Prepare a one-sentence disclosure of the starting point for a mentor.
- [ ] If any existing work could be interpreted as the scored product, ask a mentor at kickoff and record the answer before using it.
- [ ] Confirm Hermes will be used as the coding partner and that session receipts can be shown.

**Exit check:** The starting point can be explained honestly in under 30 seconds, and no questionable pre-built product code is scheduled for use without mentor approval.

## Step 2. Freeze the product scope

**Purpose:** Prevent feature drift during the eight-hour build.

- [ ] Lock the one-liner: “SUITS is a voiced moot-court coach that runs a fictional hearing and produces a transcript-grounded coaching debrief.”
- [ ] Lock the primary user: a law student, junior advocate, or professional practicing oral advocacy.
- [ ] Lock one golden demo case as the only required case.
- [ ] Lock participatory mode as the user-facing product.
- [ ] Lock autonomous mode as an eval and regression harness, not a separate product.
- [ ] Lock the summary hearing to 60–120 seconds for the live demo.
- [ ] Lock one witness and cross-examination only; exclude direct examination.
- [ ] Lock the Case Debrief as the real work product.
- [ ] Lock the product disclaimer: fictional cases, educational coaching, no legal advice.
- [ ] Add the following to a “not now” list: multiple witnesses, open-ended legal research, real client matters, user accounts, collaboration, elaborate avatars, mobile app, and full billing system.

**Exit check:** Every proposed feature can be classified as golden path, proof/observability, optional partner integration, or deferred.

## Step 3. Define the end-to-end hearing workflow

**Purpose:** Make orchestration deterministic and auditable.

- [ ] Define the phase enum: `briefing`, `opening`, `cross_examination`, `closing`, `deliberation`, `debrief`, `complete`, and `failed`.
- [ ] Define allowed transitions explicitly; no model may set the next phase directly.
- [ ] Define `allowedActions` for every phase.
- [ ] Define which actor runs in each phase: Court Director, Opposing Advocate, Witness, and Jury/Review Board.
- [ ] Define the input, output schema, timeout, retry count, and fallback for each actor call.
- [ ] Limit malformed structured output to one repair attempt before deterministic fallback.
- [ ] Define how a trial resumes from the last committed phase after refresh or interruption.
- [ ] Define how the participatory user slot is replaced by the autonomous Advocate in eval mode.
- [ ] Define how the full transcript is handed to the Jury/Review Board without adding new facts.
- [ ] Write one state-transition table containing current phase, allowed action, actor, success transition, and failure transition.

**Exit check:** A developer can implement the workflow without asking what happens next in any normal or failure state.

## Step 4. Author the golden case

**Purpose:** Create a controlled case that reliably demonstrates real reasoning and coaching.

- [ ] Give the case a fictional title, parties, dispute, and neutral case summary.
- [ ] Write the public facts available to every actor.
- [ ] Write a private witness sheet containing only facts the witness may know.
- [ ] Write an evidence list with stable evidence IDs.
- [ ] Author one decisive timeline contradiction.
- [ ] Author one explicit, rehearsable line of attack that deterministically unlocks that contradiction.
- [ ] Define acceptable semantic variants of the decisive question.
- [ ] Define witness behavior for supported questions, ambiguous questions, repeated questions, and facts not in evidence.
- [ ] Define the canonical evidence-based assessment separately from the jury verdict.
- [ ] Define what constitutes strong, adequate, and weak advocacy on this case.
- [ ] Create a short ideal transcript and at least three failure transcripts: missed contradiction, hallucinated fact, and weak closing.
- [ ] Ensure no real person, active dispute, privileged information, or legal advice appears in the case.

**Exit check:** The golden case supports a two-minute hearing, contains one satisfying contradiction, and has enough authored truth to grade the user without model-invented facts.

## Step 5. Define data contracts and schemas

**Purpose:** Make implementation fast and model outputs verifiable.

- [ ] Define schemas for `cases`, `trials`, `turns`, `traces`, `juryVotes`, `debriefs`, `evalRuns`, and optional `feedback`.
- [ ] Include stable IDs, creation/update timestamps, version fields, and status fields.
- [ ] Store public case facts separately from private evidence and witness instructions.
- [ ] Give every transcript turn a stable turn ID, speaker, phase, text, and optional audio URL.
- [ ] Give every trace step a parent ID, actor, action, start/end time, status, model, token counts, estimated/actual cost, retry count, and error summary.
- [ ] Require jury reasoning and debrief findings to cite transcript turn IDs.
- [ ] Require debrief fields for strengths, missed opportunities, contradictions, evidence used, evidence missed, objection accuracy when enabled, juror movement, revised closing, and limitations.
- [ ] Add schema and prompt version fields to every generated artifact.
- [ ] Define redaction and retention rules for audio and user feedback.

**Exit check:** Example JSON for each schema validates, invalid citations are rejected, and private case data cannot leak into the client before it is revealed in the hearing.

## Step 6. Define prompts and deterministic safeguards

**Purpose:** Bound each agent and preserve transcript grounding.

- [ ] Write a concise system contract for the Court Director.
- [ ] Write the Opposing Advocate contract with side, phase, speaking-length, and fact-grounding constraints.
- [ ] Write the Witness contract with an explicit prohibition on facts outside the witness sheet.
- [ ] Write the Jury/Review Board contract to return one structured three-juror dialogue plus the Case Debrief.
- [ ] Require every claim about user performance to cite one or more transcript turn IDs.
- [ ] Add a validator that rejects unknown case facts, missing citations, invalid phases, and overly long spoken lines.
- [ ] Add deterministic messages for timeouts, malformed output, provider failure, phase announcement, and resume.
- [ ] Keep spoken AI responses below approximately 35 words.
- [ ] Write the deterministic contradiction-unlock matcher for the golden question; document its accepted inputs.

**Exit check:** Each actor has a bounded responsibility, strict structured output, and a non-LLM fallback.

## Step 7. Verify provider accounts and credentials

**Purpose:** Eliminate event-day authentication and provider-selection surprises.

- [ ] Run `hermes status`; resolve setup issues and confirm receipts are retained.
- [ ] Confirm the exact OpenAI model ID with one minimal structured-output request.
- [ ] Confirm Convex account/project access and required CLI authentication.
- [ ] Confirm Cloudflare account access and deployment permissions.
- [ ] Generate one short ElevenLabs TTS sentence and measure response time.
- [ ] Select voices for Director/Judge, Advocate, Witness, and Jurors 1–3.
- [x] Reject Wispr Flow for the app path: its public site is a dictation product/help center and no public developer API/SDK was found during pre-event verification.
- [ ] Test a real ElevenLabs Scribe v2 STT request.
- [x] Lock the input fallback chain: ElevenLabs Scribe v2 → typed input.
- [ ] Confirm Linkup and Dodo access, but do not place either on the critical path.
- [ ] Record environment-variable names in `.env.example`; store real values only in ignored local/provider secret stores.
- [ ] Confirm secrets are absent from tracked files and terminal screenshots intended for judging.

**Timebox rule:** Spend at most 30 focused minutes on each optional provider. If it still fails, record the fallback and move on.

**Exit check:** Every core provider has a successful minimal request or an explicit tested fallback.

## Step 8. Prepare the repository and event-day task queue

**Purpose:** Let Hermes begin implementation immediately after kickoff.

- [ ] Document the intended stack: Next.js/React, Convex, Cloudflare, OpenAI, ElevenLabs, and selected STT.
- [ ] Prepare an ordered issue/task list matching Phase 2 of this roadmap.
- [ ] Define standard scripts for development, type-checking, linting, unit tests, evals, and production build.
- [ ] Prepare `.gitignore`, `.env.example`, and a concise README outline if permitted.
- [ ] Decide naming conventions for actors, phases, tables, API routes, and trace events.
- [ ] Decide the minimal UI routes: landing/start, courtroom, verdict/debrief, and Court Records.
- [ ] Prepare a commit sequence so each gate has a clear checkpoint.
- [ ] Ensure the repository is backed up and accessible without depending on venue Wi-Fi.

**Exit check:** At kickoff, Hermes can start from the first approved implementation task without another architecture discussion.

## Step 9. Define evals and acceptance tests before coding

**Purpose:** Make reliability measurable rather than subjective.

- [ ] Define assertions for valid phase order and terminal completion.
- [ ] Define assertions for schema validity on every model output.
- [ ] Define assertions that every debrief citation resolves to a real transcript turn.
- [ ] Define a no-new-facts assertion for witness, verdict, and debrief output.
- [ ] Define assertions for presence of one strength, one missed opportunity, and one revised argument.
- [ ] Define an assertion that the golden question reveals the authored contradiction.
- [ ] Define an assertion that an unsupported question is refused or safely qualified.
- [ ] Define latency targets: visible text under 3 seconds and audio under 5 seconds where provider conditions allow.
- [ ] Define a full-run reliability target: at least 4 of 5 consecutive runs pass every core assertion before optional scope is added.
- [ ] Define a prompt/version comparison report using identical case inputs.

**Exit check:** Evals can distinguish a genuinely good run from a theatrical but ungrounded demo.

## Step 10. Prepare demo, proof, and failure recovery

**Purpose:** Design the four-minute presentation before the final rush.

- [ ] Write the 20-second context statement.
- [ ] Rehearse the exact decisive cross-examination question.
- [ ] Define the two-minute live path: pre-created trial → cross → closing → juror dialogue → debrief.
- [ ] Choose one honest edge case, preferably a witness refusing a fact not in evidence or switching to typed input.
- [ ] Define the one-minute proof order: complete trace → assertions/latency/cost/retries → eval comparison → real-user feedback → verified partner integration.
- [ ] Prepare answers to “Is this truly an agency?” and “What is the real output?”
- [ ] Prepare a local backup route or recording plan, but remember the submitted product must be live at a public URL.
- [ ] Create a proof-harvest checklist covering deployment URL, run IDs, trace screenshots, eval results, user feedback, and partner evidence.

**Exit check:** The planned demo fits four minutes with no setup tour, no unsupported numbers, and a clear recovery path.

## Phase 1 completion gate

Phase 1 is complete only when:

- [ ] eligibility and starting scope are understood;
- [ ] the golden case and deterministic contradiction path are fully authored;
- [ ] workflow, schemas, prompts, eval assertions, and fallbacks are specified;
- [ ] Hermes, model, database, hosting, TTS, and at least typed input are viable;
- [ ] credentials and accounts are ready without secrets in source control;
- [ ] the event-day queue and demo script are ready; and
- [ ] no unresolved provider decision can block the first event-day build hour.

---

# Phase 2 — During the Hackathon

## Goal of Phase 2

Build, deploy, verify, and demonstrate one reliable end-to-end coaching task. The schedule below assumes kickoff at 10:00 AM, building starts around 11:00 AM, feature freeze is 4:45 PM, submission is due before 5:30 PM, and demos begin at 5:30 PM. Adjust clock times only if organizers announce a change; preserve the order and gates.

## Step 1. Kickoff and rules confirmation — 10:00–10:20

- [ ] Attend kickoff and note any rule, deadline, submission-link, or scoring changes.
- [ ] Ask a mentor to confirm the declared starting point if anything is ambiguous.
- [ ] Confirm the AI as Agency track is locked.
- [ ] Record the submission URL and final submission deadline.
- [ ] Confirm what mentor verification is required for partner power-ups.
- [ ] Update this roadmap only where official day-of instructions differ.

**Exit check:** There is no unresolved eligibility or submission ambiguity.

## Step 2. Environment and blank deployment — 10:20–11:00

- [ ] Start a Hermes coding session and preserve its receipt.
- [ ] Confirm model, Convex, Cloudflare, ElevenLabs, and selected STT credentials.
- [ ] Scaffold the approved Next.js application and Convex backend.
- [ ] Add environment validation that reports missing variable names without exposing values.
- [ ] Add basic scripts for dev, test/eval, type-check, and production build.
- [ ] Deploy a blank health-check page to Cloudflare.
- [ ] Open it from a fresh/incognito browser and confirm it loads.
- [ ] Commit the scaffold and deployment configuration.

**Fallback:** If Cloudflare deployment is blocked for more than 20 minutes, use the fastest organizer-approved public host, keep Cloudflare work documented, and return only after the golden path is live.

**Exit check:** A public URL serves the current app and the local project can connect to Convex.

## Step 3. Implement the data layer — 11:00–11:20

- [ ] Create the Convex tables and indexes defined in Phase 1.
- [ ] Seed exactly one golden case with public/private separation.
- [ ] Implement trial creation, turn append, trace append/update, and trial resume operations.
- [ ] Implement server-side validation for stable IDs, phase order, citations, and status changes.
- [ ] Prevent the client from reading private witness instructions or the hidden evidence rubric.
- [ ] Add a minimal development view or query to inspect one run.
- [ ] Test create/read/update flow with one synthetic run.

**Exit check:** A test trial persists, survives refresh, and does not expose private case data to the browser.

## Step 4. Implement the deterministic Court Director — 11:20–11:45

- [ ] Encode the legal phase-transition table in code.
- [ ] Compute `allowedActions` from stored state.
- [ ] Reject out-of-order or duplicate transitions safely.
- [ ] Add per-step timeout, one structured-output repair attempt, and deterministic fallback.
- [ ] Commit each successful phase before starting the next call.
- [ ] Record parent/child trace relationships and actor handoffs.
- [ ] Implement resume from the last committed phase.
- [ ] Unit-test valid flow, invalid transition, timeout, malformed output, and resume.

**Exit check:** Tests prove that the LLM cannot mutate workflow state directly.

## Step 5. Build the text-only autonomous vertical slice — 11:45–12:30

- [ ] Implement the Opposing Advocate with strict structured output.
- [ ] Implement the Witness using only the public facts plus private witness sheet.
- [ ] Implement deterministic recognition of the golden contradiction question.
- [ ] Implement the single-call Jury/Review Board output: three juror parts, verdict, citations, and debrief.
- [ ] Validate every actor response and use deterministic fallback on failure.
- [ ] Implement autonomous mode by filling the user slot with the Advocate.
- [ ] Persist all turns, artifacts, traces, timings, retries, tokens, and cost.
- [ ] Add a basic results page that shows transcript, verdict, and debrief.
- [ ] Run the entire autonomous flow twice from the deployed app.

### Gate 1 — 12:30

Pass only if two deployed autonomous runs complete in valid order and produce schema-valid, transcript-grounded debriefs.

If Gate 1 fails:

- [ ] remove objection handling if present;
- [ ] simplify the three jurors to one structured response containing three short parts;
- [ ] shorten prompts and outputs;
- [ ] replace unreliable manager choices with deterministic rules; and
- [ ] do not start participatory or voice work until the gate passes.

## Step 6. Add the participatory courtroom — 12:30–1:30

- [ ] Build the minimal courtroom UI: phase banner, active speaker, transcript, text input, submit/continue controls, and recovery message.
- [ ] Let the user select the supported side or lock a default side for the golden demo.
- [ ] Implement typed cross-examination input as the guaranteed interaction path.
- [ ] Add the decisive-question path and at least one unsupported-question refusal path.
- [ ] Add a short closing input or a safe default closing when the demo must advance.
- [ ] Stream or reveal text before any audio work.
- [ ] Preserve trial ID in the URL so refresh resumes the same trial.
- [ ] Generate the transcript-linked verdict and Case Debrief.
- [ ] Add a print/download-friendly debrief view.
- [ ] Show the educational-only disclaimer without interrupting the demo.
- [ ] Complete one participatory run from a fresh browser.

**Exit check:** A first-time user can finish the text demo without developer intervention.

## Step 7. Build Court Records and proof surfaces — 1:30–2:15

- [ ] Create a run list with status, mode, case, start time, duration, and completion result.
- [ ] Create a run-detail trace tree showing Director → specialist handoffs.
- [ ] Show per-step actor, action, model, latency, input/output tokens, cost, retries, fallback, and error state.
- [ ] Link trace steps to transcript turns and generated artifacts.
- [ ] Show named success assertions and their pass/fail evidence.
- [ ] Add filters by run and actor if time permits, but keep the single-run proof view primary.
- [ ] Ensure values come from stored execution data, not hardcoded demo numbers.
- [ ] Protect private prompts, secrets, and witness sheet content from public proof views.
- [ ] Deploy and inspect Court Records from a fresh browser.

### Gate 2 — 2:15

Pass only if a fresh browser can complete the text demo, refresh/resume it, open the final debrief, and inspect the complete real trace.

If Gate 2 fails, stop all voice and integration work. Fix deployment, state, grounding, and observability first.

## Step 8. Add voice without weakening the text path — 2:15–3:15

- [ ] Add ElevenLabs sentence playback for at least one AI response.
- [ ] Render the three juror parts in parallel, then play them in order.
- [ ] Use a cancellable audio queue and visibly indicate the current speaker.
- [ ] Start playback only after text is available.
- [ ] Add push-to-talk using the verified STT provider.
- [ ] Display the transcription for user review before or as it is submitted.
- [ ] Handle denied microphone permission, empty audio, transcription failure, TTS failure, and autoplay restrictions.
- [ ] Keep typed input and visible text fully functional when audio fails.
- [ ] Record STT and TTS latency and failure status in the trace.
- [ ] Test with venue-like background noise and with microphone permission denied.
- [ ] Keep spoken responses under approximately 35 words.

**Fallback chain:** Primary STT → alternate already-verified STT → typed input. TTS failure → continue immediately with visible text.

**Exit check:** Voice enhances the deployed demo but cannot block completion.

## Step 9. Implement and run evals — 3:15–3:45

- [ ] Add a repeatable command or admin action for autonomous eval runs.
- [ ] Run all assertions defined in Phase 1.
- [ ] Save case version, prompt version, model, results, score, and failure reason.
- [ ] Run the same golden inputs against at least two prompt/agent versions.
- [ ] Show a concise before/after comparison in Court Records.
- [ ] Inspect failures for hallucinated facts, broken citations, invalid order, and missing coaching value.
- [ ] Fix the highest-impact failure and rerun.
- [ ] Run five consecutive demo-mode trials.

### Gate 3 — 3:45

Pass only if at least four of five consecutive runs satisfy all five core criteria:

1. valid phase order;
2. schema-valid output;
3. transcript grounding with no new facts;
4. useful debrief containing strength, missed opportunity, and revision; and
5. complete Court Records trace.

If Gate 3 fails, improve reliability until it passes. Do not add cases, agents, payment, research, or cosmetic features.

## Step 10. Add at most one authentic partner integration — 3:45–4:20

Choose the fastest integration that performs real work and can be verified by a mentor.

### Option A — Dodo Payments

- [ ] Add a real checkout for a ₹99 premium debrief.
- [ ] Complete the checkout flow in test/live mode as accepted by organizers.
- [ ] Unlock a real premium artifact or capability after successful payment.
- [ ] Store payment state safely and show mentor-verifiable evidence.

### Option B — Linkup

- [ ] Add a narrowly scoped precedent/context lookup that supports the fictional exercise.
- [ ] Clearly separate retrieved sources from authored case facts.
- [ ] Display source links and record the call in the trace.
- [ ] Ensure Linkup failure does not block the hearing or debrief.

**Decision rule:** Implement one option only. Add the second only if the first is stable, Gate 3 still passes, and at least 15 minutes remain before feature freeze.

**Exit check:** A mentor can watch the partner perform real work inside the product. Otherwise, do not claim the power-up.

## Step 11. Polish the golden path and freeze features — 4:20–4:45

- [ ] Improve only UI elements visible in the live path: hierarchy, loading states, speaker indicator, readable transcript, verdict reveal, and debrief formatting.
- [ ] Verify mobile responsiveness only enough to avoid breakage; prioritize the demo laptop.
- [ ] Add clear retry/resume messaging and eliminate dead-end buttons.
- [ ] Confirm the disclaimer is visible.
- [ ] Confirm the debrief can be downloaded or printed cleanly.
- [ ] Remove debug output, placeholder claims, broken links, and unused navigation.
- [ ] Run type-check, lint, tests, production build, and one deployed smoke test.
- [ ] Tag or commit the feature-freeze version.

### Feature freeze — 4:45

After this point:

- do not add integrations, agents, cases, auth, or new modes;
- accept only reliability fixes, proof corrections, and demo-critical copy/layout changes;
- preserve the known-good deployment and its run IDs.

## Step 12. Conduct real-user runs and harvest proof — 4:45–5:05

- [ ] Ask at least three floor users, if available, to complete the golden path themselves.
- [ ] For each run, record completed/failed status based on explicit criteria.
- [ ] Collect a 1–5 usefulness rating for the debrief.
- [ ] Collect one optional sentence of feedback.
- [ ] Use an anonymous run ID; collect email only with consent and only if genuinely needed.
- [ ] Link feedback to the corresponding trace without exposing personal data publicly.
- [ ] Fix only a repeated, demo-critical failure.
- [ ] Never convert partial or assisted runs into claimed completed runs.

**Exit check:** Every claimed user result is tied to verifiable execution data.

## Step 13. Final deployment, backup, and submission — 5:05–5:30

- [ ] Run one clean golden path on the final public deployment.
- [ ] Verify from a fresh browser/device that the app, trial, Court Records, and debrief load.
- [ ] Verify no secrets or private witness facts are exposed in client bundles or public pages.
- [ ] Save the final deployment URL and at least one known-good demo trial URL.
- [ ] Pre-create a demo trial whose earlier phases genuinely ran and that is ready at cross-examination.
- [ ] Record a clean backup demonstration of the final deployed build.
- [ ] Capture proof screenshots only as backup; keep live proof surfaces ready.
- [ ] Submit the required public URL through the official form before the deadline.
- [ ] Confirm the submission acknowledgement.
- [ ] Push/backup the final code and preserve Hermes receipts and commit history.

**Exit check:** Submission is confirmed, the public URL works for another person, and the final evidence matches every claim.

## Step 14. Demo rehearsal and stage preparation — 5:30 onward

- [ ] Log in to the product, database/proof view, and any verified partner surface before presenting.
- [ ] Open the pre-created trial at cross-examination.
- [ ] Keep the backup recording one action away.
- [ ] Test microphone, audio output, screen sharing, browser zoom, and network.
- [ ] Rehearse the complete four-minute sequence twice with a timer.
- [ ] Use approximately 20 seconds for context, the remainder of two minutes for the live demo, one minute for proof, and one minute for Q&A.
- [ ] Ask the rehearsed decisive question; do not improvise the critical path.
- [ ] Show one edge case without manufacturing a failure.
- [ ] Show proof in this order: trace, assertions and metrics, eval comparison, real-user evidence, verified partner evidence.
- [ ] State only numbers visible on screen and verifiable in stored data.
- [ ] If the live demo fails, narrate briefly, attempt one recovery, then switch to the backup without losing the proof minute.

**Exit check:** The demo finishes within four minutes and clearly proves the working output, managed agent workflow, observability, and reliability.

## Phase 2 completion gate

The hackathon build is complete only when:

- [ ] a real user can complete the deployed golden path;
- [ ] deterministic orchestration and bounded agent responsibilities are visible;
- [ ] the Case Debrief is useful, downloadable, and grounded in real transcript turns;
- [ ] typed fallback works and at least one AI response is voiced;
- [ ] Court Records show actual handoffs, latency, cost, tokens, retries, and assertions;
- [ ] at least four of five consecutive eval runs pass the core criteria;
- [ ] all claimed user and partner evidence is authentic and verifiable;
- [ ] the public URL was submitted on time;
- [ ] Hermes receipts and commits prove eligibility; and
- [ ] the live demo and backup have both been rehearsed.

---

# 3. Scope Cut Order

When behind schedule, cut the first remaining optional item in this order:

1. Cases two and three.
2. Any juror implementation beyond one structured call with three short voice parts.
3. Multiple witnesses.
4. Objection flow.
5. Cross-trial personalization or memory.
6. Telegram Clerk of Court.
7. The second partner integration.
8. The first partner integration if it threatens the golden path.
9. Full-length trial mode.
10. Decorative animation, elaborate avatars, advanced filters, and non-demo settings.

Never cut:

- one golden fictional case;
- one decisive cross-examination exchange;
- deterministic phase orchestration;
- typed input and visible text fallback;
- at least one voiced AI response;
- transcript-grounded verdict and Case Debrief;
- Court Records with real execution metrics;
- a public deployment;
- explicit eval assertions; or
- a rehearsed backup demo.

---

# 4. Final Decision Rule

Before starting any task, Hermes must ask:

> Does this make one complete coaching task more reliable, more useful, or easier to verify before the next gate?

If the answer is no, defer it. The winning build is not the product with the most roles or integrations. It is one polished, voiced moot-court encounter that produces a surprisingly useful coaching report—and a trustworthy trace proving how the agent organization produced it.
