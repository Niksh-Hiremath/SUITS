import { describe, expect, it } from "vitest";

import {
  CaseGraphV1Schema,
  createThreeWitnessCaseGraphV1Fixture,
} from "../src/domain/case-graph";
import {
  DEBRIEF_GENERATOR_OUTPUT_SCHEMA_VERSION,
  DebriefGeneratorModelOutputSchema,
  type DebriefGeneratorModelOutput,
} from "../src/domain/courtroom-ai";
import { actorFromBindings, deriveTrialActorBindings } from "../src/domain/hearing-runtime/actors";
import {
  TRIAL_ACTION_SCHEMA_VERSION,
  TrialActionV3Schema,
  commitAction,
  createStartTrialAction,
  type ActorRef,
  type TrialActionByType,
  type TrialActionType,
  type TrialEvent,
  type TrialStateV3,
} from "../src/domain/trial-engine";
import { deriveCourtRecordsCitationResources } from "./courtRecords";

const OWNER_ID = "owner:523e4567-e89b-42d3-a456-426614174000";
const BASE_TIME = Date.parse("2026-07-20T03:00:00.000Z");
const COLLISION_ID = "fact_complaint_sent";

function replaceExactIdentifier(
  value: unknown,
  from: string,
  to: string,
): unknown {
  if (value === from) return to;
  if (Array.isArray(value)) {
    return value.map((child) => replaceExactIdentifier(child, from, to));
  }
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      replaceExactIdentifier(child, from, to),
    ]),
  );
}

function fixture() {
  const graph = CaseGraphV1Schema.parse(
    replaceExactIdentifier(
      createThreeWitnessCaseGraphV1Fixture(),
      "evidence_complaint_email",
      COLLISION_ID,
    ),
  );
  const bindings = deriveTrialActorBindings(graph);
  const trialId = "trial:records:resource-derivation";
  const started = commitAction(
    null,
    createStartTrialAction({
      trialId,
      actionId: "action:records:resource:start",
      requestedAt: new Date(BASE_TIME).toISOString(),
      graph,
      actors: bindings.map(({ actor }) => actor),
      actorBindings: bindings,
      userSide: "user",
    }),
  );
  let state = started.state;
  const events: TrialEvent[] = [started.event];
  let identity = 0;
  const actor = (
    predicate: (candidate: ActorRef) => boolean,
    code: string,
  ) => actorFromBindings(bindings, predicate, code);
  const commit = <K extends TrialActionType>(
    type: K,
    payload: TrialActionByType<K>["payload"],
    actionActor: ActorRef,
  ) => {
    identity += 1;
    const action = TrialActionV3Schema.parse({
      schemaVersion: TRIAL_ACTION_SCHEMA_VERSION,
      actionId: `action:records:resource:${identity}:${type.toLowerCase()}`,
      trialId,
      expectedStateVersion: state.version,
      actor: actionActor,
      source: "deterministic",
      requestedAt: new Date(BASE_TIME + identity * 1_000).toISOString(),
      causationId: state.eventIds.at(-1) ?? null,
      correlationId: trialId,
      responseId: null,
      interruptId: null,
      modelMetadata: null,
      type,
      payload,
    });
    const result = commitAction(state, action);
    state = result.state;
    events.push(result.event);
    return result.event;
  };

  const judge = actor((candidate) => candidate.role === "judge", "JUDGE_MISSING");
  const counsel = actor(
    (candidate) => candidate.role === "user_counsel",
    "COUNSEL_MISSING",
  );
  commit("BEGIN_PHASE", { phase: "case_in_chief" }, judge);
  commit(
    "CALL_WITNESS",
    { witnessId: "witness_rina_shah", calledBySide: "user" },
    counsel,
  );
  commit("SWEAR_WITNESS", { witnessId: "witness_rina_shah" }, judge);
  const question = commit(
    "ASK_QUESTION",
    {
      questionId: "question:records:resource",
      witnessId: "witness_rina_shah",
      examinationKind: "direct",
      text: "When did you send the complaint?",
      turnId: "turn:records:resource",
      presentedEvidenceIds: [COLLISION_ID],
      factIds: [COLLISION_ID],
      evidenceIds: [COLLISION_ID],
    },
    counsel,
  );
  return {
    graph,
    get state(): TrialStateV3 {
      return state;
    },
    events,
    question,
  };
}

function transcriptDebrief(turnId: string): DebriefGeneratorModelOutput {
  const citations = {
    admittedFactIds: [],
    admittedEvidenceIds: [],
    activeTestimonyIds: [],
    transcriptTurnIds: [turnId],
    unadmittedFactIds: [],
    unadmittedEvidenceIds: [],
    excludedFactIds: [],
    excludedEvidenceIds: [],
    strickenTestimonyIds: [],
    hiddenFactIds: [],
    hiddenSourceSegmentIds: [],
    coachingInferenceIds: [],
  };
  return DebriefGeneratorModelOutputSchema.parse({
    schemaVersion: DEBRIEF_GENERATOR_OUTPUT_SCHEMA_VERSION,
    overallAssessment: {
      text: "The active transcript supports a procedural coaching observation.",
      basis: "admitted_record",
      citations,
    },
    strengths: [
      {
        title: "Focused question",
        assessment: "The question is preserved in the active transcript.",
        recommendation: "Keep questions tied to the record.",
        basis: "admitted_record",
        citations,
      },
    ],
    weakQuestions: [],
    missedEvidence: [],
    contradictions: [],
    objectionAccuracy: [],
    witnessStrategy: [],
    settlementChoices: [],
    juryMovement: [],
    improvedClosing: { segments: [] },
    limitations: ["Fictional educational simulation; not legal advice."],
  });
}

function emptyAcceptedCitations() {
  return {
    factIds: [],
    evidenceIds: [],
    testimonyIds: [],
    eventIds: [],
    sourceSegmentIds: [],
    priorStatementIds: [],
  };
}

describe("Court Records cited-resource derivation", () => {
  it("preserves namespaces and applies exact owner/debrief scopes", () => {
    const input = fixture();
    const sourceSegmentId = input.graph.sourceSegments[0]?.sourceSegmentId;
    const priorStatementId = input.graph.witnesses[0]?.priorStatements[0]
      ?.priorStatementId;
    if (sourceSegmentId === undefined || priorStatementId === undefined) {
      throw new Error("Missing provenance fixture");
    }
    const resources = deriveCourtRecordsCitationResources({
      ownerId: OWNER_ID,
      graph: input.graph,
      state: input.state,
      events: input.events,
      traces: [
        {
          acceptedCitations: {
            ...emptyAcceptedCitations(),
            evidenceIds: ["evidence_draft_metadata"],
            eventIds: [input.question.eventId],
            sourceSegmentIds: [sourceSegmentId],
            priorStatementIds: [priorStatementId],
          },
        },
      ],
      finalDebrief: transcriptDebrief("turn:records:resource"),
    });

    expect(
      resources
        .filter(({ resourceId }) => resourceId === COLLISION_ID)
        .map(({ kind, scope }) => ({ kind, scope })),
    ).toEqual([
      { kind: "unadmitted_evidence", scope: "owner_record" },
      { kind: "unadmitted_fact", scope: "owner_record" },
    ]);
    expect(resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceId: "evidence_draft_metadata",
          kind: "unadmitted_evidence",
          scope: "debrief_only",
        }),
        expect.objectContaining({
          resourceId: sourceSegmentId,
          kind: "source_segment",
          scope: "debrief_only",
        }),
        expect.objectContaining({
          resourceId: priorStatementId,
          kind: "prior_statement",
          scope: "debrief_only",
        }),
        expect.objectContaining({
          resourceId: "turn:records:resource",
          kind: "transcript_turn",
          scope: "owner_record",
        }),
        expect.objectContaining({
          resourceId: input.question.eventId,
          kind: "event",
          scope: "owner_record",
        }),
      ]),
    );
  });

  it("rejects unresolved, duplicate, and invented inference citations", () => {
    const input = fixture();
    const base = {
      ownerId: OWNER_ID,
      graph: input.graph,
      state: input.state,
      traces: [],
      finalDebrief: null,
    } as const;
    const unknown = structuredClone(input.events);
    unknown.at(-1)?.citations.factIds.push("fact:unknown");
    expect(() =>
      deriveCourtRecordsCitationResources({ ...base, events: unknown }),
    ).toThrow("COURT_RECORDS_AUDIT_INVALID");

    const duplicate = structuredClone(input.events);
    duplicate.at(-1)?.citations.factIds.push(COLLISION_ID);
    expect(() =>
      deriveCourtRecordsCitationResources({ ...base, events: duplicate }),
    ).toThrow("COURT_RECORDS_AUDIT_INVALID");

    const invented = transcriptDebrief("turn:records:resource");
    invented.overallAssessment.citations.coachingInferenceIds = [
      "inference:invented",
    ];
    expect(() =>
      deriveCourtRecordsCitationResources({
        ...base,
        events: input.events,
        finalDebrief: invented,
      }),
    ).toThrow("COURT_RECORDS_AUDIT_INVALID");
  });
});
