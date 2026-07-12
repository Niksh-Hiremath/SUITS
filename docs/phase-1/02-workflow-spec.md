# Phase 1 — Deterministic Hearing Workflow

## Design rules

- Application code—not a model—owns `phase`, legal transitions, and `allowedActions`.
- Every state change is validated and committed before another actor call begins.
- Actor output is untrusted until its schema, grounding, citations, and length validate.
- Each model call gets one repair attempt. A second failure uses a deterministic fallback.
- Visible text appears before voice. Voice failure never prevents progress.
- A refresh resumes from the last committed phase and does not replay a completed action.
- The Jury/Review Board receives the complete public transcript but no hidden rubric as case truth.

## Phase enum

```text
briefing
opening
cross_examination
closing
deliberation
debrief
complete
failed
```

`complete` and `failed` are terminal. `failed` is reserved for unrecoverable persistence/integrity failures; provider failures should normally degrade to deterministic text or typed input rather than fail the trial.

## Actors

| Actor | Responsibility | Cannot do |
|---|---|---|
| Court Director | Plan the bounded hearing, select the next permitted action/actor, validate specialist output, announce phases | Mutate stored phase directly; add case facts; decide verdict |
| Opposing Advocate | Deliver the opposing opening or occupy the participant slot in autonomous mode | Testify, reveal private witness facts, decide phase/verdict |
| Witness | Answer from public facts and private witness sheet | Invent facts, expose hidden rubric/instructions, decide phase |
| Jury/Review Board | Produce one structured three-part deliberation, verdict, and coaching debrief from transcript | Add case facts, rewrite transcript, access unrevealed private facts |
| Participating Advocate | User input during cross and closing | Invoke illegal transitions or edit prior turns |
| Autonomous Advocate | Deterministic eval replacement for user slots | Run in participatory mode or bypass the same validations |

## Allowed actions

| Phase | Allowed actions |
|---|---|
| `briefing` | `present_briefing`, `acknowledge_briefing`, `resume` |
| `opening` | `request_opening`, `accept_opening`, `use_default_opening`, `resume` |
| `cross_examination` | `submit_question`, `answer_question`, `repeat_or_clarify`, `end_cross`, `resume` |
| `closing` | `submit_closing`, `use_default_closing`, `accept_closing`, `resume` |
| `deliberation` | `request_deliberation`, `accept_deliberation`, `use_fallback_deliberation`, `resume` |
| `debrief` | `request_debrief`, `accept_debrief`, `repair_citations`, `use_fallback_debrief`, `resume` |
| `complete` | `view_transcript`, `view_debrief`, `download_debrief` |
| `failed` | `view_failure`, `restart_trial` |

## State-transition table

| Current phase | Trigger/action | Actor | Success transition | Recoverable failure | Unrecoverable failure |
|---|---|---|---|---|---|
| `briefing` | `present_briefing` | Court Director | Stay in `briefing`; commit briefing turn | Use deterministic briefing text | `failed` only if persistence fails |
| `briefing` | `acknowledge_briefing` | User/Autonomous Advocate | `opening` | Keep phase and show retry | `failed` on corrupted state |
| `opening` | `request_opening` | Opposing Advocate | Stay; commit validated opening | One repair, then default opening | `failed` on persistence failure |
| `opening` | `accept_opening` | Court Director | `cross_examination` | Revalidate stored turn | `failed` on invalid committed state |
| `cross_examination` | `submit_question` | User/Autonomous Advocate | Stay; commit question | Reject empty/duplicate/too-long input without transition | `failed` on persistence failure |
| `cross_examination` | `answer_question` | Witness | Stay; commit grounded answer | Repair, then deterministic refusal/qualified answer | `failed` on persistence failure |
| `cross_examination` | `end_cross` | User/Court Director | `closing` if at least one exchange exists | Explain required exchange | `failed` on corrupted state |
| `closing` | `submit_closing` | User/Autonomous Advocate | Stay; commit closing | Default closing if skipped/timeout | `failed` on persistence failure |
| `closing` | `accept_closing` | Court Director | `deliberation` | Revalidate stored turn | `failed` on invalid committed state |
| `deliberation` | `request_deliberation` | Jury/Review Board | Stay; commit juror script and verdict | Repair, then deterministic grounded deliberation | `failed` on persistence failure |
| `deliberation` | `accept_deliberation` | Court Director | `debrief` | Revalidate citations and facts | `failed` if stored artifact is irreparable |
| `debrief` | `request_debrief` | Jury/Review Board | Stay; commit schema-valid debrief | Repair citations, then deterministic template | `failed` on persistence failure |
| `debrief` | `accept_debrief` | Court Director | `complete` | Keep phase and expose validation errors internally | `failed` if artifact cannot be persisted |
| Any nonterminal | `resume` | Court Director | Remain at last committed phase and compute actions | Display recovery message | `failed` only on missing/corrupt trial |

## Per-actor call policy

| Actor call | Input | Required output | Timeout target | Repair attempts | Deterministic fallback |
|---|---|---|---:|---:|---|
| Opposing opening | Public case facts, side, phase, max words | Short grounded opening turn | 8 s | 1 | Authored opening fixture |
| Witness answer | Public facts, private witness sheet, evidence revealed, current question, prior exchanges | Answer, answer type, cited fact/evidence IDs | 8 s | 1 | Authored answer for golden match; otherwise safe refusal/qualification |
| Jury/Review Board | Complete transcript, public case facts, revealed evidence, output schema | Three juror parts, verdict, confidence, turn citations, debrief | 15 s | 1 | Deterministic verdict/debrief template using computed transcript coverage |
| Autonomous Advocate | Public brief, phase, eval policy | Question or closing conforming to eval scenario | 8 s | 1 | Authored eval fixture |

Timeouts are implementation defaults to validate on-site; measured provider behavior may justify adjustment without changing orchestration semantics.

## Structured-output validation order

1. Parse JSON.
2. Validate schema and enum values.
3. Verify trial ID, phase, actor, and action match the pending call.
4. Reject unknown case fact/evidence/turn IDs.
5. Resolve every transcript citation.
6. Enforce no-new-facts policy.
7. Enforce spoken-line limit (target: 35 words).
8. Persist output and trace atomically.
9. Transition only after persistence succeeds.

## Resume and idempotency

- URL contains stable `trialId`.
- Trial stores current committed phase and a monotonically increasing version.
- Every action carries an idempotency key based on trial, phase, action, and sequence.
- Duplicate submissions return the committed result instead of creating another turn.
- An in-flight trace is marked `interrupted` after timeout/refresh; resume may retry it once with a new child trace.
- Audio playback state is disposable; transcript and artifact state are authoritative.
- Resume message states the phase and next permitted user action without repeating prior dialogue.

## Participatory and autonomous modes

Both modes use identical state, actors, schemas, validators, persistence, and transitions. Only the advocate slot differs:

- `participatory`: user supplies cross question and closing through typed or verified STT input.
- `autonomous`: Autonomous Advocate supplies fixture-constrained input for repeatable eval scenarios.

No autonomous-only bypass may skip a phase or validation.

## Expected edge cases

- Empty or duplicate question: reject locally; remain in cross.
- Unsupported fact: witness refuses or qualifies using authored text; remain in cross.
- Ambiguous question: witness asks for clarification; remain in cross.
- Microphone/STT failure: preserve recording error in trace and use typed input.
- TTS failure/autoplay block: keep visible text and continue immediately.
- Malformed model JSON: one repair attempt, then deterministic fallback.
- Unknown citation/new fact: reject output, repair once, then fallback.
- Refresh during call: committed state wins; interrupted trace remains auditable.
- Provider outage: fallback content allows completion; trace records provider failure.

## Exit check

This specification passes when implementation can proceed without deciding what happens next in any normal or listed failure state, and a test can prove that no model directly controls phase transitions.
