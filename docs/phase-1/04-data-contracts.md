# Phase 1 — Data Contracts

This document specifies implementation-neutral contracts. Concrete Convex validators and TypeScript types are event-day work.

## Global conventions

- IDs are stable opaque strings with a type prefix: `case_`, `trial_`, `turn_`, `trace_`, `vote_`, `debrief_`, `eval_`, `feedback_`.
- Timestamps are UTC ISO-8601 strings at API boundaries and server timestamps in storage.
- Every mutable record has `createdAt`, `updatedAt`, `version`, and `status` where applicable.
- Generated artifacts carry `schemaVersion`, `promptVersion`, `caseVersion`, and `model`.
- Server validation rejects unknown fields for model-generated artifacts.
- Public and private case material are stored separately and served through separate server-only/public queries.
- Transcript claims cite stable `turnId` values, never array positions.

## `cases`

```json
{
  "id": "case_harbor_lantern_v1",
  "slug": "harbor-lantern-v-northstar",
  "title": "Harbor Lantern Events v. Northstar Rentals",
  "version": 1,
  "status": "active",
  "disclaimer": "Fictional educational exercise; not legal advice.",
  "publicFacts": [{"factId":"F-PUB-001","text":"..."}],
  "publicEvidence": [{"evidenceId":"E-001","name":"...","summary":"..."}],
  "privateBundleRef": "case_private_harbor_lantern_v1",
  "createdAt": "2026-07-12T00:00:00Z",
  "updatedAt": "2026-07-12T00:00:00Z"
}
```

Private bundle (server-only): witness facts, hidden evidence, canonical assessment, accepted contradiction variants, authored fallbacks, and grading rubric. No client query returns `privateBundleRef` contents.

## `trials`

Required fields:

```json
{
  "id": "trial_example",
  "caseId": "case_harbor_lantern_v1",
  "caseVersion": 1,
  "mode": "participatory",
  "side": "respondent",
  "phase": "briefing",
  "status": "active",
  "allowedActions": ["present_briefing"],
  "phaseSequence": 0,
  "stateVersion": 1,
  "lastCommittedActionId": null,
  "failureCode": null,
  "createdAt": "2026-07-12T00:00:00Z",
  "updatedAt": "2026-07-12T00:00:00Z",
  "completedAt": null
}
```

Enums:

- `mode`: `participatory | autonomous`
- `side`: `claimant | respondent`
- `phase`: workflow enum from `02-workflow-spec.md`
- `status`: `active | waiting_for_user | running_actor | complete | failed`

## `turns`

```json
{
  "id": "turn_example",
  "trialId": "trial_example",
  "sequence": 1,
  "speaker": "witness",
  "actor": "Witness",
  "phase": "cross_examination",
  "text": "Yes. The log shows 7:31 PM.",
  "source": "model",
  "audioUrl": null,
  "inputMode": null,
  "factIds": ["F-WIT-005"],
  "evidenceIds": ["E-003"],
  "replyToTurnId": "turn_question",
  "schemaVersion": "turn.v1",
  "promptVersion": "witness.v1",
  "createdAt": "2026-07-12T00:00:00Z"
}
```

Enums:

- `speaker`: `director | opposing_advocate | participant | autonomous_advocate | witness | juror_1 | juror_2 | juror_3 | system`
- `source`: `user_typed | user_stt | model | deterministic_fallback | authored_fixture`
- `inputMode`: `typed | stt | null`

Client-visible turns must not expose internal fact IDs that reveal hidden facts before the text itself lawfully reveals them. Internal grounding metadata may be served only in protected proof views.

## `traces`

```json
{
  "id": "trace_example",
  "trialId": "trial_example",
  "parentId": "trace_parent_or_null",
  "actor": "Witness",
  "action": "answer_question",
  "phase": "cross_examination",
  "status": "succeeded",
  "startedAt": "2026-07-12T00:00:00Z",
  "endedAt": "2026-07-12T00:00:02Z",
  "latencyMs": 2000,
  "provider": "openai",
  "model": "verified-model-id",
  "inputTokens": 0,
  "outputTokens": 0,
  "estimatedCostUsd": 0.0,
  "actualCostUsd": null,
  "retryCount": 0,
  "fallbackUsed": false,
  "errorCode": null,
  "errorSummary": null,
  "inputTurnIds": ["turn_question"],
  "outputTurnIds": ["turn_answer"],
  "artifactIds": [],
  "schemaVersion": "trace.v1",
  "promptVersion": "witness.v1"
}
```

Trace status: `pending | running | succeeded | repaired | fallback | interrupted | failed`.

Never persist raw secrets, complete hidden prompts, raw audio bytes, or unnecessary personal data in traces.

## `juryVotes`

```json
{
  "id": "vote_example",
  "trialId": "trial_example",
  "juror": "juror_1",
  "persona": "evidence_first",
  "vote": "respondent",
  "confidence": 0.72,
  "reasoning": "The gate log predates the outage.",
  "turnCitations": ["turn_cross_question", "turn_witness_answer"],
  "evidenceIds": ["E-003"],
  "schemaVersion": "juryVote.v1",
  "promptVersion": "jury-review.v1",
  "caseVersion": 1,
  "model": "verified-model-id",
  "createdAt": "2026-07-12T00:00:00Z"
}
```

`vote`: `claimant | respondent | insufficient_record`. Confidence is `[0,1]`.

## `debriefs`

```json
{
  "id": "debrief_example",
  "trialId": "trial_example",
  "status": "valid",
  "overallAssessment": "...",
  "strengths": [{"finding":"...","turnCitations":["turn_1"]}],
  "missedOpportunities": [{"finding":"...","turnCitations":["turn_2"],"recommendedQuestion":"..."}],
  "contradictions": [{"description":"...","status":"found","turnCitations":["turn_3","turn_4"],"evidenceIds":["E-003"]}],
  "evidenceUsed": [{"evidenceId":"E-003","turnCitations":["turn_3"]}],
  "evidenceMissed": [{"evidenceId":"E-002","reason":"..."}],
  "objectionAccuracy": null,
  "jurorMovement": [{"juror":"juror_1","direction":"toward_respondent","reason":"...","turnCitations":["turn_4"]}],
  "revisedClosing": {"text":"...","basedOnTurnIds":["turn_3","turn_4"]},
  "limitations": ["Assessment is limited to this fictional transcript."],
  "schemaVersion": "debrief.v1",
  "promptVersion": "jury-review.v1",
  "caseVersion": 1,
  "model": "verified-model-id",
  "createdAt": "2026-07-12T00:00:00Z"
}
```

At least one strength, one missed opportunity, and a nonempty revised closing are mandatory. Objection accuracy remains `null` while objections are out of scope.

## `evalRuns`

```json
{
  "id": "eval_example",
  "trialId": "trial_example",
  "caseId": "case_harbor_lantern_v1",
  "scenarioId": "ideal_decisive_question",
  "status": "passed",
  "assertions": [{"name":"valid_phase_order","passed":true,"evidence":{"phases":["briefing","opening","cross_examination","closing","deliberation","debrief","complete"]}}],
  "passedCount": 5,
  "totalCount": 5,
  "score": 1.0,
  "failureReason": null,
  "schemaVersion": "evalRun.v1",
  "promptVersion": "suite.v1",
  "caseVersion": 1,
  "model": "verified-model-id",
  "createdAt": "2026-07-12T00:00:00Z",
  "completedAt": "2026-07-12T00:00:00Z"
}
```

## Optional `feedback`

```json
{
  "id": "feedback_example",
  "trialId": "trial_example",
  "anonymousRunLabel": "floor-user-01",
  "completed": true,
  "usefulnessRating": 4,
  "comment": "The revised closing was specific.",
  "email": null,
  "consentToStoreEmail": false,
  "createdAt": "2026-07-12T00:00:00Z"
}
```

Rating is integer 1–5. Email is absent by default and stored only with explicit consent.

## Citation integrity

A generated citation is valid only when:

1. The cited turn exists and belongs to the same trial.
2. The turn precedes the artifact being generated.
3. The cited text supports the associated claim.
4. The citation does not point only to a system/fallback error message.
5. Evidence IDs exist in the pinned case version and were revealed or used in transcript context.

Unknown, cross-trial, future, or unsupported citations reject the artifact. One repair attempt may replace citations; deterministic fallback follows.

## Privacy, redaction, and retention

- Raw user audio is ephemeral: process, derive transcript, then delete within 24 hours unless explicit consent and a documented need exist.
- Generated audio URLs may expire; transcript text remains the authoritative record.
- Do not collect names, emails, or legal matters for the core flow.
- Feedback email is optional, private, and never shown in public Court Records.
- Public Court Records redact private witness instructions, hidden rubric, raw prompts, secrets, and provider request headers.
- Development fixtures contain no personal data.
- Trials and text traces may be retained for the event demo; add an admin deletion path before any post-event public use.
- Logs display environment-variable names only, never values.

## Example validity checks

Valid examples above must pass schema validation. Explicit invalid fixtures to implement on event day:

- Debrief citing `turn_missing`.
- Witness output citing unknown `F-WIT-999`.
- Trial transition from `opening` directly to `deliberation`.
- Client query returning `privateBundleRef` contents.
- Trace without `startedAt`, status, or actor.
- Generated artifact without version fields.

## Exit check

The contract is ready when representative JSON validates against event-day schemas, invalid citations and transitions are rejected, and a client query test proves that private case data cannot be read before lawful transcript revelation.
