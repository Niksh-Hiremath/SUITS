import { describe, expect, it } from "vitest";

import {
  COURT_RECORDS_MAX_LIFECYCLE_TRANSITIONS,
  COURT_RECORDS_MAX_MODEL_CALL_ATTEMPTS,
  CourtRecordsViewSchema,
  type CourtRecordsView,
} from "../../domain/court-records";
import { TRIAL_EVENT_TYPES } from "../../domain/trial-engine";
import {
  COURT_RECORDS_EVENT_TYPE_LABELS,
  COURT_RECORDS_HONEST_COPY,
  COURT_RECORDS_LIST_PAGE_SIZE,
  COURT_RECORDS_PANEL_PAGE_SIZES,
  CourtRecordsViewModelError,
  assertCourtRecordsViewBindings,
  createCourtRecordsCitationIndex,
  createCourtRecordsWorkspaceViewModel,
  flattenCourtRecordsDebrief,
  flattenCourtRecordsEventTree,
  paginateCourtRecordsList,
  paginateCourtRecordsPanel,
  summarizeCourtRecordsMetrics,
} from "./court-records-view-model";

const TRIAL_ID = "trial_223e4567e89b42d3a456426614174000";
const STARTED_AT = "2026-07-20T05:00:00.000Z";
const EMPTY_CITATIONS = Object.freeze({
  factIds: Object.freeze([]),
  evidenceIds: Object.freeze([]),
  testimonyIds: Object.freeze([]),
  eventIds: Object.freeze([]),
  sourceSegmentIds: Object.freeze([]),
});

function eventNode(sequence: number, total: number) {
  const eventId = `event:records:${sequence}`;
  return {
    eventId,
    sequence,
    stateVersion: sequence,
    type: sequence === 1 ? "START_TRIAL" : "BEGIN_PHASE",
    actor: {
      actorId: "actor:system",
      role: "system",
      side: "neutral",
      witnessId: null,
    },
    source: "system",
    occurredAt: `2026-07-20T05:00:${String(sequence % 60).padStart(2, "0")}.000Z`,
    parentEventId: sequence === 1 ? null : `event:records:${sequence - 1}`,
    childEventIds:
      sequence === total ? [] : [`event:records:${sequence + 1}`],
    responseId: null,
    interruptId: null,
    citations: EMPTY_CITATIONS,
  } as const;
}

function emptyDebriefCitations() {
  return {
    admittedFactIds: [],
    admittedEvidenceIds: [],
    activeTestimonyIds: [],
    transcriptTurnIds: [],
    unadmittedFactIds: [],
    unadmittedEvidenceIds: [],
    excludedFactIds: [],
    excludedEvidenceIds: [],
    strickenTestimonyIds: [],
    hiddenFactIds: [],
    hiddenSourceSegmentIds: [],
    coachingInferenceIds: [],
  } as const;
}

function finalDebriefFixture() {
  const citations = emptyDebriefCitations();
  return {
    artifactId: "artifact:records:debrief",
    eventId: "event:records:1",
    createdAt: 1_753_000_000_000,
    model: "gpt-5.6-terra",
    artifact: {
      schemaVersion: "debrief-generator.output.v1",
      overallAssessment: {
        text: "The examination stayed focused on the fictional record.",
        basis: "admitted_record",
        citations,
      },
      strengths: [
        {
          title: "Clear sequence",
          assessment: "The questions followed a coherent order.",
          recommendation: "Keep the same compact structure.",
          basis: "coaching_inference",
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
      improvedClosing: {
        segments: [{ text: "The admitted record supports the request.", citations }],
      },
      limitations: ["This is an educational simulation."],
    },
    citationResources: [],
  } as const;
}

function modelCallFixture(
  callId: string,
  options: Readonly<{
    latencyMs: number | null;
    estimatedCostUsd: number | null;
    withUsage: boolean;
    repair: boolean;
  }>,
) {
  return {
    callId,
    actorId: "witness:records",
    actorRole: "witness",
    callClass: "role_responder",
    task: "witness_answer",
    status: "accepted",
    fallback: {
      policy: "validated_model_or_fail",
      availability: "not_available",
      used: false,
      repairAttemptsAreFallbacks: false,
    },
    provider: "openai",
    providerProtocolVersion: "responses-api.v1",
    model: "gpt-5.6-luna",
    promptVersion: "prompt.v1",
    outputSchemaVersion: "output.v1",
    expectedStateVersion: 1,
    expectedLastEventId: "event:records:1",
    knowledgeScope: {
      integrity: "verified",
      schemaVersion: "knowledge-view.v2",
      stateVersion: 1,
      factCount: 0,
      evidenceCount: 0,
      testimonyCount: 0,
      priorStatementCount: 0,
      sourceSegmentCount: 0,
      publicRecordEventCount: 1,
      currentExchangeCount: 0,
    },
    startedAt: STARTED_AT,
    completedAt: "2026-07-20T05:00:01.000Z",
    latencyMs: options.latencyMs,
    retryCount: options.repair ? 1 : 0,
    validationFailureCount: options.repair ? 1 : 0,
    estimatedCostUsd: options.estimatedCostUsd,
    usage: options.withUsage
      ? {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
        }
      : null,
    acceptedCitationCount: 0,
    visibleCitationCount: 0,
    restrictedCitationCount: 0,
    acceptedCitations: {
      ...EMPTY_CITATIONS,
      priorStatementIds: [],
    },
    safeFailureCode: null,
    attempts: [
      {
        attempt: 1,
        mode: options.repair ? "repair" : "initial",
        status: "accepted",
        latencyMs: options.latencyMs ?? 0,
        firstStructuredDeltaMs: null,
        usage: null,
        validationIssueCodes: [],
        safeErrorCode: null,
      },
    ],
  } as const;
}

function citationResource(
  kind:
    | "admitted_fact"
    | "admitted_evidence"
    | "event"
    | "hidden_fact",
  resourceId: string,
  title = `${kind} title`,
) {
  return {
    resourceId,
    kind,
    scope: kind === "hidden_fact" ? "debrief_only" : "owner_record",
    title,
    stratum:
      kind === "admitted_fact" || kind === "admitted_evidence"
        ? "admitted_record"
        : kind === "hidden_fact"
          ? "hidden_authoring_truth"
          : "procedural_record",
    stratumLabel:
      kind === "hidden_fact" ? "Hidden authoring truth" : "Visible record",
  } as const;
}

function makeView(
  options: Readonly<{
    eventCount?: number;
    modelCalls?: readonly unknown[];
    citationResources?: readonly unknown[];
    finalDebrief?: unknown | null;
  }> = {},
): CourtRecordsView {
  const count = options.eventCount ?? 1;
  const nodes = Array.from({ length: count }, (_, index) =>
    eventNode(index + 1, count),
  );
  const modelCalls = options.modelCalls ?? [];
  const finalDebrief = options.finalDebrief ?? null;
  return CourtRecordsViewSchema.parse({
    schemaVersion: "court-records-view.v2",
    summary: {
      schemaVersion: "court-records-summary.v1",
      trialId: TRIAL_ID,
      caseId: "case_redwood_signal_v1",
      caseTitle: "Rina Shah v. Redwood Signal Systems",
      phase: "case_in_chief",
      status: "active",
      stateVersion: count,
      lastSequence: count,
      lastEventId: `event:records:${count}`,
      startedAt: STARTED_AT,
      updatedAt: "2026-07-20T05:01:00.000Z",
      transcriptTurnCount: 0,
      modelCallCount: modelCalls.length,
      hasFinalDebrief: finalDebrief !== null,
    },
    eventTree: { rootEventIds: ["event:records:1"], nodes },
    transcript: [],
    procedure: {
      objections: [],
      rulings: [],
      recoveries: [],
      interruptions: [],
    },
    lifecycles: { facts: [], evidence: [] },
    modelCalls,
    finalDebrief,
    citationResources: options.citationResources ?? [],
    audio: {
      availability: "not_recorded",
      retentionPolicy: "metadata_only_raw_audio_not_stored",
      entries: [],
    },
    replayIntegrity: {
      status: "verified",
      eventCount: count,
      firstSequence: 1,
      lastSequence: count,
      stateVersion: count,
      lastEventId: `event:records:${count}`,
      privacySafeProjectionHash: "a".repeat(64),
    },
  });
}

function expectViewModelError(
  callback: () => unknown,
  code: CourtRecordsViewModelError["code"],
): void {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(CourtRecordsViewModelError);
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error(`Expected ${code}`);
}

describe("Court Records view-model bindings", () => {
  it("fails closed when redundant head or count bindings disagree", () => {
    const view = makeView();
    const badHead = CourtRecordsViewSchema.parse({
      ...view,
      summary: { ...view.summary, stateVersion: 2 },
    });
    expectViewModelError(
      () => assertCourtRecordsViewBindings(badHead),
      "VIEW_HEAD_MISMATCH",
    );

    const badCount = CourtRecordsViewSchema.parse({
      ...view,
      summary: { ...view.summary, modelCallCount: 1 },
    });
    expectViewModelError(
      () => createCourtRecordsWorkspaceViewModel(badCount),
      "VIEW_COUNT_MISMATCH",
    );
  });

  it("validates and flattens a 20,000-deep tree without recursion", () => {
    const total = 20_000;
    const nodes = Array.from({ length: total }, (_, index) =>
      eventNode(index + 1, total),
    );
    const rows = flattenCourtRecordsEventTree({
      rootEventIds: ["event:records:1"],
      nodes,
    });

    expect(rows).toHaveLength(total);
    expect(rows[0]).toMatchObject({ depth: 0, ordinal: 1, isRoot: true });
    expect(rows.at(-1)).toMatchObject({
      depth: total - 1,
      ordinal: total,
      parentSequence: total - 1,
    });
    expect(Object.isFrozen(rows)).toBe(true);
  });

  it("rejects duplicate sequences and broken bidirectional edges", () => {
    const first = eventNode(1, 2);
    const second = eventNode(2, 2);
    expectViewModelError(
      () =>
        flattenCourtRecordsEventTree({
          rootEventIds: [first.eventId],
          nodes: [first, { ...second, sequence: 1 }],
        }),
      "EVENT_TREE_INVALID",
    );
    expectViewModelError(
      () =>
        flattenCourtRecordsEventTree({
          rootEventIds: [first.eventId],
          nodes: [
            { ...first, childEventIds: [] },
            second,
          ],
        }),
      "EVENT_TREE_INVALID",
    );
  });
});

describe("Court Records transitive browser bounds", () => {
  it("rejects oversized lifecycle histories and model-attempt collections", () => {
    const view = makeView();
    const transition = {
      eventId: "event:records:1",
      sequence: 1,
      status: "verified",
    } as const;
    const oversizedTransitions = Array.from(
      { length: COURT_RECORDS_MAX_LIFECYCLE_TRANSITIONS + 1 },
      () => transition,
    );
    expect(
      CourtRecordsViewSchema.safeParse({
        ...view,
        lifecycles: {
          ...view.lifecycles,
          facts: [
            {
              factId: "fact:bounded",
              title: "Bounded fact",
              status: "verified",
              visibility: "public",
              transitions: oversizedTransitions,
            },
          ],
        },
      }).success,
    ).toBe(false);

    const call = modelCallFixture("call:bounded", {
      latencyMs: 1,
      estimatedCostUsd: null,
      withUsage: false,
      repair: false,
    });
    const oversizedAttempts = Array.from(
      { length: COURT_RECORDS_MAX_MODEL_CALL_ATTEMPTS + 1 },
      (_, index) => ({ ...call.attempts[0], attempt: index + 1 }),
    );
    expect(
      CourtRecordsViewSchema.safeParse({
        ...view,
        summary: { ...view.summary, modelCallCount: 1 },
        modelCalls: [{ ...call, attempts: oversizedAttempts }],
      }).success,
    ).toBe(false);
  });
});

describe("Court Records citation resolution", () => {
  it("keys resources by namespace and kind, never by identifier alone", () => {
    const sharedId = "shared:record-id";
    const view = makeView({
      citationResources: [
        citationResource("admitted_fact", sharedId),
        citationResource("admitted_evidence", sharedId),
        citationResource("event", sharedId),
      ],
    });
    const index = createCourtRecordsCitationIndex(view);
    const resolutions = index.resolveTrialSet({
      factIds: [sharedId],
      evidenceIds: [sharedId],
      testimonyIds: [],
      eventIds: [sharedId],
      sourceSegmentIds: [],
    });

    expect(
      resolutions.map((resolution) =>
        resolution.status === "resolved" ? resolution.resource.kind : null,
      ),
    ).toEqual(["admitted_fact", "admitted_evidence", "event"]);
    expect(index.resolveExact("hidden_fact", sharedId)).toMatchObject({
      status: "unavailable",
      reference: { namespace: "fact", requestedKind: "hidden_fact" },
    });
  });

  it("coalesces identical final-debrief resources and rejects ambiguity", () => {
    const exact = citationResource("admitted_fact", "fact:one");
    const debrief = {
      ...finalDebriefFixture(),
      citationResources: [exact],
    };
    const view = makeView({ citationResources: [exact], finalDebrief: debrief });
    expect(createCourtRecordsCitationIndex(view).resources).toHaveLength(1);

    const ambiguous = makeView({
      citationResources: [
        citationResource("admitted_fact", "fact:one"),
        citationResource("hidden_fact", "fact:one"),
      ],
    });
    expectViewModelError(
      () => createCourtRecordsCitationIndex(ambiguous),
      "CITATION_INDEX_INVALID",
    );
  });
});

describe("Court Records metrics and debrief", () => {
  it("keeps unavailable metrics distinct from valid zero values", () => {
    const view = makeView({
      modelCalls: [
        modelCallFixture("call:known-zero", {
          latencyMs: 0,
          estimatedCostUsd: 0,
          withUsage: true,
          repair: true,
        }),
        modelCallFixture("call:unavailable", {
          latencyMs: null,
          estimatedCostUsd: null,
          withUsage: false,
          repair: false,
        }),
      ],
    });
    const metrics = summarizeCourtRecordsMetrics(view);

    expect(metrics.models.latencyMs).toEqual({
      knownCount: 1,
      unavailableCount: 1,
      knownSum: 0,
      knownAverage: 0,
      knownP95: 0,
      knownMaximum: 0,
    });
    expect(metrics.models.estimatedCostUsd.knownSum).toBe(0);
    expect(metrics.models.usage).toEqual({
      knownCallCount: 1,
      unavailableCallCount: 1,
      knownTotals: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
      },
    });
    expect(metrics.models.repairAttemptCount).toBe(1);
    expect(metrics.models.fallbackUsedCount).toBe(0);
    expect(COURT_RECORDS_HONEST_COPY.unavailableMetric).toContain("not zero");
  });

  it("flattens debrief sections in stable display order", () => {
    const points = flattenCourtRecordsDebrief(finalDebriefFixture());

    expect(points.map((point) => point.section)).toEqual([
      "overallAssessment",
      "strengths",
      "improvedClosing",
      "limitations",
    ]);
    expect(points.map((point) => point.ordinal)).toEqual([1, 2, 3, 4]);
    expect(points[2]).toMatchObject({
      kind: "closing_segment",
      title: "Closing segment 1",
      basis: "admitted_record",
    });
    expect(Object.isFrozen(points)).toBe(true);
    expect(Object.isFrozen(points[0])).toBe(true);
  });
});

describe("Court Records panel pagination and labels", () => {
  it("keeps each rendered event page bounded and clamps stale pages", () => {
    const model = createCourtRecordsWorkspaceViewModel(
      makeView({ eventCount: 101 }),
    );
    const first = paginateCourtRecordsPanel(model, "eventTree", 1);
    const stale = paginateCourtRecordsPanel(model, "eventTree", 999);

    expect(first.items).toHaveLength(COURT_RECORDS_PANEL_PAGE_SIZES.eventTree);
    expect(stale).toMatchObject({ page: 3, pageCount: 3, start: 101, end: 101 });
    expect(stale.items).toHaveLength(1);
  });

  it("uses a fixed bounded list page without mutating summaries", () => {
    const summary = makeView().summary;
    const summaries = Array.from({ length: 13 }, (_, index) => ({
      ...summary,
      trialId: `${TRIAL_ID.slice(0, -2)}${String(index).padStart(2, "0")}`,
    }));
    const page = paginateCourtRecordsList(summaries, 1);

    expect(page.items).toHaveLength(COURT_RECORDS_LIST_PAGE_SIZE);
    expect(page.total).toBe(13);
    expect(summaries).toHaveLength(13);
  });

  it("has an explicit safe label for every canonical event type", () => {
    expect(Object.keys(COURT_RECORDS_EVENT_TYPE_LABELS).sort()).toEqual(
      [...TRIAL_EVENT_TYPES].sort(),
    );
    for (const label of Object.values(COURT_RECORDS_EVENT_TYPE_LABELS)) {
      expect(label).not.toMatch(/^[A-Z_]+$/u);
    }
  });
});
