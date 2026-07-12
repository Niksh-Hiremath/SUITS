# Phase 1 — Evals and Acceptance Tests

## Purpose

Distinguish a grounded, useful completed task from a theatrical but invalid demo. Evals use the same deployed workflow, schemas, validators, and persistence as participatory mode.

## Core completion criteria

A run passes the core suite only if all five criteria pass:

1. Valid phase order and terminal completion.
2. Schema-valid actor outputs and artifacts.
3. Transcript grounding with no new case facts.
4. Useful debrief with a strength, missed opportunity, and revision.
5. Complete Court Records trace.

Gate 3 requires at least four of five consecutive demo-mode runs to pass all five criteria.

## Named assertions

| Assertion | Pass condition | Evidence |
|---|---|---|
| `valid_phase_order` | Exactly follows briefing → opening → cross → closing → deliberation → debrief → complete; no illegal or duplicate transition | Stored trial phase events |
| `terminal_completion` | Trial status is `complete` and required artifacts exist | Trial + artifact IDs |
| `actor_schema_valid` | Every accepted actor output validates against its pinned schema | Validation records per trace |
| `debrief_schema_valid` | Debrief has all mandatory fields and versions | Debrief validation result |
| `citations_resolve` | Every citation exists, belongs to trial, precedes artifact, and supports its claim | Citation-resolution report |
| `no_new_facts` | Witness, jury, and debrief use only known fact/evidence IDs and supported transcript claims | Grounding validator report |
| `private_data_not_exposed` | Public/client query contains no witness sheet, hidden rubric, prompt, or unrevealed private evidence | Response-shape test |
| `golden_question_unlocks` | Accepted decisive question yields `decisive_admission` revealing `E-003` and correct times | Matched input + witness output |
| `semantic_variant_unlocks` | Each accepted variant triggers the same authored evidence without exact-string dependence | Variant matrix |
| `unsupported_question_safe` | Unsupported premise is refused/qualified and adds no fact | Witness answer + validator |
| `repeated_question_consistent` | Material facts do not change across repetition | Compared witness turns |
| `debrief_has_strength` | At least one specific strength cites a real participant turn | Debrief field + citation |
| `debrief_has_missed_opportunity` | At least one specific missed opportunity cites transcript context | Debrief field + citation |
| `debrief_has_revision` | Revised closing is nonempty and grounded in real transcript/evidence | Debrief field + source IDs |
| `trace_complete` | Every actor call has parent, actor, action, timestamps, status, model, tokens, cost, retries, and errors/fallback | Trace completeness report |
| `resume_idempotent` | Refresh resumes last committed phase without duplicate turns/actions | Before/after state comparison |
| `typed_fallback_completes` | Trial completes with microphone/STT unavailable | Run trace |
| `tts_failure_nonblocking` | Visible text remains and trial completes when TTS fails | Run trace + UI assertion |
| `visible_text_latency` | Measured text target under 3 seconds where provider conditions permit | Trace latency |
| `audio_latency` | Measured audio target under 5 seconds where provider conditions permit | TTS trace latency |

Latency misses should be reported honestly and need not invalidate factual correctness; the gate report distinguishes hard correctness assertions from performance targets.

## Eval scenarios

### `ideal_decisive_question`

- Uses personal-knowledge setup, decisive gate-log question, and nuanced closing.
- Expected: contradiction found, `E-003` used, debrief credits technique, respondent-leaning verdict permitted but not forced.

### `missed_contradiction`

- Uses vague cross and never mentions the gate log/timestamps.
- Expected: no contradiction unlock; debrief identifies missed opportunity and supplies the decisive question.

### `hallucinated_camera_fact`

- Asserts nonexistent camera evidence and 5:50 PM arrival.
- Expected: witness refuses/qualifies; no new fact enters transcript; debrief flags unsupported premise.

### `weak_closing_after_strong_cross`

- Reveals `E-003` but gives conclusory closing.
- Expected: debrief credits cross, flags overstatement, and revises closing with contractual-lateness nuance.

### `semantic_variants`

- Runs each accepted formulation from the golden-case document.
- Expected: every accepted variant unlocks; non-sufficient examples do not.

### `provider_failure_fallback`

- Injects timeout/malformed output/TTS failure separately.
- Expected: one repair where applicable, deterministic fallback, complete trace, and terminal completion.

### `refresh_resume`

- Interrupt after a committed cross question and during an uncommitted witness call.
- Expected: no duplicate question; interrupted trace retained; witness call safely retried or falls back.

## Negative fixtures

The suite must reject:

- Opening → deliberation transition.
- Unknown turn citation.
- Cross-trial citation.
- Witness fact ID not in pinned case version.
- Jury claim based on unrevealed `E-004`/`E-005`.
- Debrief without revised closing.
- Generated artifact without schema/prompt/case version.
- Client response containing private witness instructions.
- Spoken model line over 35 words.

## Version comparison report

Run identical case/scenario inputs against two prompt/agent versions. Report:

- Case/scenario and random/provider settings.
- Prompt/schema/model versions.
- Pass/fail for each named assertion.
- Text/audio latency, tokens, cost, retries, and fallback use.
- Fact/citation violations.
- Concise observed improvement or regression.

Do not claim improvement from different inputs.

## Reliability procedure

1. Reset to a clean seeded golden case.
2. Run five consecutive autonomous demo trials against the deployed app.
3. Save each trial and eval-run ID.
4. Require all five core criteria per passing run.
5. Gate passes at ≥4/5 passing runs.
6. If it fails, fix the highest-impact root cause and restart the five-run sequence.
7. Add no optional scope until the gate passes.

## Manual participatory acceptance

A fresh-browser tester must be able to:

- Start or open one fictional trial.
- Understand the current phase and active speaker.
- Submit a typed cross question.
- Trigger either decisive admission or safe refusal.
- Submit/use a closing.
- Read juror dialogue, verdict, and linked debrief.
- Refresh and resume without duplication.
- Open Court Records and inspect the same run.
- Print/download the debrief.
- See the educational-only disclaimer.

## Exit check

The specification is complete when every requirement maps to a named assertion or manual acceptance step, and the suite can fail an attractive but ungrounded output.
