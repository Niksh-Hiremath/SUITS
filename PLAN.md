# SUITS — Final Build Plan
### AI as Agency · Hermes Buildathon Hyderabad · Solo

**One-liner:** SUITS is a voiced moot-court coach. Argue a fictional case live against AI counsel, cross-examine a witness, and hear a jury deliberate—then receive a client-ready Case Debrief showing which arguments landed, what evidence you missed, and how to improve.

**Pitch for judges:** “SUITS replaces the human moot-court practice team: opposing counsel, witness, judge, jury, and performance coach. The courtroom is the input; the coaching report is the real output.”

**Product boundary:** Fictional cases and educational coaching only. SUITS does not provide legal advice.

---

## 1. Locked spec

| Decision | Locked choice |
|---|---|
| Track | AI as Agency |
| Team | Solo |
| Hermes | Coding partner with session receipts; Hermes Clerk is added only after the core product is reliable |
| Cases | **1 golden demo case first**; cases 2–3 only after the full loop passes repeatedly |
| Modes | Participatory is the product; autonomous mode runs the same workflow as an eval/regression harness |
| Demo format | 60–120 second “summary hearing”: briefing → one cross → short closing → deliberation → debrief |
| Full format | 5–8 minute trial after the demo path is stable |
| Witnesses | One case-specific witness. Cross-examination only; direct examination is out of scope |
| Real output | **Case Debrief**: argument map, evidence used/missed, contradictions found, objection accuracy, juror movement, revised closing, transcript-linked findings |
| Monetization | Trial and verdict free; ₹99 premium debrief via Dodo only after the core loop works |
| Core stack | Next.js + React · Convex · Cloudflare · ElevenLabs Flash v2.5 TTS · ElevenLabs Scribe v2 STT · typed input fallback · OpenAI model ID verified before kickoff |

**Success criteria for one completed task:**

1. Every required phase completes in valid order.
2. All generated output passes its schema.
3. The verdict and debrief cite the actual transcript and introduce no new case facts.
4. The debrief contains at least one useful strength, one missed opportunity, and a revised argument.
5. The complete run, latency, token use, cost, retries, and agent handoffs appear in Court Records.

---

## 2. Architecture

```text
WEB APP (Next.js, one primary flow)
 ├─ Courtroom: avatars, speaking indicator, phase banner, text fallback
 ├─ Push-to-talk mic → verified STT → text turn
 ├─ Streaming transcript + resumable trial state
 └─ Verdict + downloadable Case Debrief

CONVEX (state, evidence, and observability)
 ├─ cases       public facts, witness sheet, private evidence rubric
 ├─ trials      mode, side, phase, status, allowedActions, timestamps
 ├─ turns       speaker, text, audioUrl, transcript citations
 ├─ traces      parentStep, agent, action, tokens, cost, latency, retry
 ├─ juryVotes   persona, vote, confidence, transcript-grounded reasoning
 ├─ debriefs    structured coaching report + schema/version metadata
 └─ evalRuns    case, version, assertions, score, failure reason

COURT DIRECTOR (deterministic workflow + bounded manager decisions)
 ├─ Code owns legal phase transitions and validates allowed actions
 ├─ Manager plans the hearing, selects the relevant specialist, and reviews output
 ├─ OPPOSING ADVOCATE argues the other side or fills the user slot in eval mode
 ├─ WITNESS answers from a case-specific sheet; the golden contradiction has one deterministic attack path
 └─ JURY/REVIEW BOARD returns a three-juror dialogue script plus the coaching debrief
```

The Jury/Review Board generates one structured, internally coherent deliberation script in a single model call. The script contains three short juror parts, which are sent to three ElevenLabs voices in parallel and then played as an out-loud exchange. This preserves the signature audio moment without three sequential reasoning calls.

### Golden-case stagecraft rule

The golden case contains one decisive contradiction with one explicitly authored line of attack. A rehearsed question matching that attack deterministically unlocks the contradiction; it does not depend on a probabilistic quality judgment. Other questions still use evidence coverage and question-quality gating, so the general product remains responsive rather than scripted.

### State-machine rule

The LLM never directly mutates the phase. It chooses from `allowedActions`; code validates the structured response and performs the transition. Each call has:

- a strict schema;
- one retry for malformed output;
- a deterministic fallback;
- a timeout and visible recovery state;
- resume support from the last committed phase.

### Verdict model

Keep these separate:

- **Canonical assessment:** the case author’s evidence-based baseline.
- **Advocacy performance:** whether the user found and used the decisive facts.
- **Jury verdict:** what these jurors decided from the transcript they actually heard.

A persuasive user may move the jury away from the canonical assessment. Evals therefore score fact discovery, transcript grounding, phase completion, and debrief quality—not only verdict agreement.

### Latency rules

- Stream text as soon as possible; voice must never block seeing the response.
- Generate courtroom acknowledgements and phase announcements ahead of time.
- Do not pre-generate dialogue that depends on an unfinished user/agent turn.
- Start TTS after the first complete sentence when supported.
- Keep spoken responses below roughly 35 words.
- Target under 3 seconds to visible text and under 5 seconds to audio; measure actual values.
- Keep typed input as a first-class fallback if microphone, STT, or browser permission fails.

---

## 3. Hermes eligibility

1. **Required: coding partner.** Build through Hermes sessions and retain prompt/session receipts and commits.
2. **Optional after core reliability: Clerk of Court.** Hermes + Telegram can assign a case, deliver a completed debrief, and recall one prior coaching pattern. This counts only if a mentor can trigger a real capability from their phone.

Do not risk the core trial to add Telegram. Hermes coding-partner receipts already satisfy eligibility.

---

## 4. Rubric targets and proof

| Parameter | Wt | Honest target | Verifiable proof |
|---|---:|---:|---|
| Real output | 20x | L4; L5 only if the rubric’s live-surface and 85%+ criteria are genuinely met | 3+ repeated runs, explicit success assertions, real users, downloadable transcript-grounded debriefs |
| Observability | 7x | L4 | Trace tree, handoffs, retries, token/cost/latency per step, filters by run and agent |
| Org structure | 5x | L4 | Court Director makes a case-specific plan, delegates to a relevant specialist, and reviews output |
| Evals | 5x | L3 first, L4 stretch | Named assertions, repeatable eval command/action, before/after prompt-version comparison |
| Handoffs/memory | 2x | L4 | Case and transcript context survive Advocate → Witness → Jury/Review Board; prior-user memory is stretch |
| Management UI | 1x | L3–L4 | A non-engineer can pick a case/side, start, resume, and inspect a trial |
| Cost/latency | 1x | L3–L4 | Measured per completed task; no unsupported estimate |

**Do not claim:** emergent L5 org structure, L5 production observability, or overflow from repeated simulations unless mentors confirm those runs qualify as additional real autonomous tasks.

### User evidence

For each floor user, save:

- completed/failed status based on the explicit task criteria;
- usefulness rating for the debrief (1–5);
- one optional sentence of feedback;
- consented email only if actually needed;
- anonymous run ID linking feedback to the trace.

Three trustworthy completed runs are more valuable than a large unqualified run count.

---

## 5. Build sequence and gates

### Tonight — dependency decision gate

Do not arrive with unresolved core-provider questions:

1. Run a real ElevenLabs Scribe v2 transcription request. Typed input remains the guaranteed fallback.
2. Generate one short sentence with ElevenLabs Flash v2.5 and select the six demo voices.
3. Confirm the exact OpenAI model ID with a minimal structured-output request.
4. Save working request/response examples and required environment-variable names without committing secrets.
5. Choose six voices: Judge/Director, Advocate, Witness, and Jurors 1–3.

The 10 AM block confirms these decisions and credentials; it does not discover the provider strategy.

| Deadline | Required outcome |
|---|---|
| 10:00–11:00 | Confirm Hermes and the already-tested model/STT/TTS credentials, then verify Convex and Cloudflare. Scaffold and deploy a blank app. |
| 11:00–12:30 | Text-only golden vertical slice: one case, deterministic phases, autonomous Advocate, Witness, three-part Jury/Review Board script, stored debrief. |
| **Gate 1: 12:30** | One deployed autonomous run completes end to end twice. If not, remove juror plurality and objections. |
| 12:30–1:30 | Participatory slot, one cross-examination exchange, typed input, transcript-linked debrief. |
| 1:30–2:15 | Court Records: trace tree, run detail, latency/token/cost/retry fields. |
| **Gate 2: 2:15** | A fresh browser can complete the text demo and inspect its trace. No voice work before this passes. |
| 2:15–3:15 | ElevenLabs sentence playback, push-to-talk STT, audio queue, permission/error fallback. |
| 3:15–3:45 | Named eval assertions and at least one prompt/version comparison on the golden case. |
| **Gate 3: 3:45** | Five consecutive demo-mode runs achieve at least 4/5 explicit success criteria. Fix reliability before adding features. |
| 3:45–4:20 | Add the fastest authentic partner integration: Dodo checkout or Linkup precedent citation. Add the other only if the first is stable. |
| 4:20–4:45 | UI polish, disclaimer, downloadable report, cases 2–3 only if all gates passed. |
| **4:45** | Feature freeze. No new integrations or agents. |
| 4:45–5:15 | Real-user runs, feedback, failure fixes, proof harvest, backup recording. |
| 5:15–5:30 | Submit with live URL and verified claims. |
| 5:30–6:00 | Pre-warm the demo trial, log into proof surfaces, rehearse twice. |

---

## 6. Cut order

Cut the first item that has not already become necessary for the golden path:

1. Cases 2–3.
2. Never add separate juror reasoning calls; keep the single three-part deliberation script and parallel multi-voice rendering.
3. Multiple witnesses.
4. Objection flow.
5. Cross-trial Hermes personalization.
6. Telegram Clerk.
7. The slower of Dodo or Linkup.
8. Full-length trial mode.

**Never cut:** one decisive cross-examination, one voiced AI response, deterministic orchestration, typed fallback, transcript-grounded debrief, Court Records, deployed URL, and backup recording.

---

## 7. Demo script (4 minutes total)

### Context — 20 seconds

“People who argue for a living need a practice team: opposing counsel, witnesses, a judge, jurors, and a coach. SUITS replaces that team with a managed agent organization. The courtroom is the simulation; this coaching report is the work product.”

### Live product — about 100 seconds

1. Open a pre-created demo trial already positioned at cross-examination. Its briefing and opening phases genuinely ran beforehand and remain visible in the same Court Records trace.
2. Ask the rehearsed push-to-talk question matching the golden case’s authored timeline attack.
3. The deterministic attack path unlocks the witness’s decisive contradiction. Other lines of questioning remain quality-gated outside this golden path.
4. Show the Court Director’s bounded decision and advance to a short closing.
5. One model call produces a short three-juror dialogue; its three parts render through ElevenLabs in parallel, then play as an out-loud deliberation.
6. Reveal the verdict and Case Debrief, including a transcript-linked missed fact and revised closing.

**Edge case:** briefly show typed fallback or a witness refusing a question that assumes a fact not in evidence. Do not manufacture a live microphone failure.

### Proof — 60 seconds

Show, in this order:

1. The complete Court Records trace, including the genuinely executed briefing and opening phases before the live cross: Director → Advocate/Witness → Jury/Review Board.
2. Success assertions plus actual latency, cost, tokens, and retries.
3. Repeated-run eval comparison between two prompt/agent versions.
4. Real-user completed-run count and usefulness ratings.
5. Only then show partner proof such as a real Dodo checkout or Linkup citation.

### Q&A preparation

**Likely question:** “Is this really an agency, or several role-play prompts?”

**Answer:** “The Court Director owns a deterministic workflow, creates a case-specific plan, delegates the evidence task, validates specialist output, and sends the complete transcript to a Jury/Review Board that produces both the deliberation script and client deliverable. Here is the trace and the schema-validated output. We target a defensible L4 managed org, not a theatrical claim of emergent autonomy.”

**Second likely question:** “What is the real output?”

**Answer:** “The downloadable, transcript-grounded coaching report. It maps arguments to evidence, identifies contradictions and missed opportunities, shows which juror moved and why, and rewrites the user’s closing. Real users rated that report here.”

---

## 8. Pre-build verification checklist

- [ ] `hermes status` is green; session receipts and commit history are preserved.
- [ ] Tonight: the exact OpenAI model identifier is confirmed with a minimal structured-output call.
- [ ] Before kickoff: ElevenLabs Scribe v2 completes a real transcription request; typed input is guaranteed.
- [ ] ElevenLabs can generate and play one short sentence within acceptable latency.
- [ ] Convex and Cloudflare deployment work from a fresh browser.
- [ ] Six voices are chosen: Judge/Director, Advocate, Witness, and Jurors 1–3.
- [ ] Golden case contains public facts, private witness facts, decisive evidence, eval assertions, and one deterministic rehearsed contradiction path.
- [ ] Demo mode can begin at cross-examination and finish within 120 seconds, while the same run trace proves its earlier phases genuinely executed.
- [ ] Timeouts, retry limits, resume behavior, and malformed-output fallbacks are specified.
- [ ] Fictional-case and educational-only disclaimer is visible.
- [ ] Partner accounts are ready, but no partner integration blocks the golden path.

---

## 9. Final decision rule

At every gate ask: **does this make one complete coaching task more reliable, more useful, or easier to verify?**

If not, defer it. The winning build is one polished, voiced moot-court encounter that produces a surprisingly useful coaching report—and a trace proving how the agent organization produced it.
