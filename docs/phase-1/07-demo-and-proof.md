# Phase 1 — Demo, Proof, and Recovery Plan

## Four-minute structure

- Context: 20 seconds.
- Live product: remainder of the first two minutes.
- Proof: 60 seconds.
- Q&A: 60 seconds.

## Context script

> “People who argue for a living need opposing counsel, a witness, a judge, jurors, and a coach. SUITS replaces that practice team with a managed agent workflow. The courtroom is the simulation; this transcript-grounded coaching report is the real output.”

## Pre-stage state

- Product, Convex dashboard/proof surface, and any verified partner surface already authenticated.
- Public deployment open in a fresh browser profile.
- Pre-created trial genuinely completed briefing and opening and is paused at cross-examination.
- Earlier phases remain visible in the same trace.
- Browser zoom, screen sharing, microphone, and audio tested.
- Backup recording one action away.
- One known-good completed trial URL and run ID available.

## Live path (target: about 100 seconds)

1. Show the fictional-case disclaimer and trial at cross-examination without touring settings.
2. Briefly point to the existing briefing/opening transcript.
3. Ask by push-to-talk, or type immediately if needed:

   > “Ms. Sen, the Gate B log records Northstar’s truck at 7:31 PM, eleven minutes before the lights failed at 7:42, correct?”

4. Witness admits the authored contradiction.
5. Advance to closing and use:

   > “Northstar was late against the schedule, but Harbor Lantern has not proved it arrived after the outage. Its own log places the truck there beforehand, blocked at Harbor Lantern’s gate.”

6. One Jury/Review Board call produces three short juror parts; text appears first, voices render in parallel, and playback is ordered.
7. Reveal verdict and downloadable Case Debrief.
8. Point to one transcript-linked strength, one missed opportunity, and revised closing.

## Honest edge case

Preferred: submit a question containing an unsupported premise, such as “Your camera shows the truck arrived at 5:50 PM, correct?” The witness refuses to confirm it because neither the camera nor time exists in the fictional record.

Alternative if time is tight: show typed input as the explicit fallback without manufacturing a microphone failure.

## Proof minute — fixed order

1. **Trace:** Court Director → specialists → Jury/Review Board, including genuinely executed briefing/opening.
2. **Assertions and metrics:** phase order, schema, grounding, debrief usefulness, real latency, tokens, cost, retries, and fallback status.
3. **Eval comparison:** identical golden inputs across two prompt/agent versions.
4. **Real users:** completed run count and usefulness ratings linked to anonymous run IDs.
5. **Partner evidence:** only integrations a mentor observed doing real work.

State only values visible in stored execution data.

## Likely Q&A

### “Is this really an agency or just role-play prompts?”

> “The Court Director owns a deterministic workflow, makes a bounded case-specific plan, delegates evidence tasks to specialists, validates their outputs, and hands the complete transcript to a Jury/Review Board. The models cannot mutate phase state. This trace and the schema-validated artifacts show each handoff. We target a defensible managed organization, not emergent autonomy.”

### “What is the real output?”

> “The downloadable, transcript-grounded Case Debrief. It maps arguments to evidence, identifies contradictions and missed opportunities, explains juror movement, and rewrites the closing with citations to what the user actually said.”

### “Is this legal advice?”

> “No. SUITS uses fictional cases for educational advocacy coaching. It does not analyze real client matters or provide legal advice.”

### “How reliable is it?”

> “Here are the named assertions and five consecutive runs. I’ll claim only the pass rate and latency visible in this stored report.”

### “Why deterministic contradiction matching?”

> “The demo’s critical teaching moment should not depend on a model guessing question quality. The matcher reveals authored evidence when the required semantic elements are present; the rest of the witness behavior remains grounded and responsive.”

## Failure recovery

- **Mic/STT fails:** switch immediately to typed question; mention that the failure is recorded in the trace.
- **TTS/autoplay fails:** continue with already-visible text; do not retry repeatedly.
- **Model timeout/malformed output:** show deterministic fallback and trace status.
- **Refresh/state issue:** attempt one resume from trial URL.
- **Public deployment outage:** attempt one reload; then switch to clean backup recording while retaining live proof surfaces if available.
- **Proof surface unavailable:** use known-good run URL and stored backup screenshots only as a last resort.

On-stage rule: narrate briefly, attempt one recovery, then switch to backup so the proof minute is preserved.

## Backup recording plan

Record after feature freeze from the final public deployment. It must show:

- Public URL.
- Same pre-created trial and earlier trace.
- Decisive question and witness admission.
- Closing, juror dialogue, verdict, and debrief.
- Court Records with actual metrics.
- Date/time or identifiable final build context.

The recording is recovery evidence, not a substitute for the required live public product.

## Proof-harvest checklist

- [ ] Final deployment URL.
- [ ] Known-good demo trial URL and run ID.
- [ ] Court Records trace screenshot/URL.
- [ ] Named assertion report.
- [ ] Five-run reliability report.
- [ ] Prompt-version comparison.
- [ ] Actual latency/token/cost/retry data.
- [ ] Three floor-user run IDs if available.
- [ ] Usefulness ratings and optional consented comments.
- [ ] Mentor verification for each claimed partner power-up.
- [ ] Submission acknowledgement.
- [ ] Hermes session receipts and event-day commit history.
- [ ] Backup recording.

## Rehearsal acceptance

- Complete sequence fits four minutes twice in succession.
- No setup tour, unsupported number, or unverified integration claim.
- Decisive question is read exactly rather than improvised.
- Recovery action is known for each critical dependency.
- Proof minute remains intact even if live voice fails.

## Exit check

The demo plan passes when it fits four minutes, proves the real output and managed workflow, includes one honest edge case, and has a single-step recovery path for voice, model, state, and deployment failures.
