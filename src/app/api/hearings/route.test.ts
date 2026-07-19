import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HEARING_COMMAND_PREPARATION_SCHEMA_VERSION,
  HEARING_PLAYER_COMMAND_SCHEMA_VERSION,
  HEARING_START_SCHEMA_VERSION,
  HearingRuntimeViewV1Schema,
  type HearingRuntimeViewV1,
} from "@/domain/hearing-runtime";
import {
  FINAL_BOUND_INTERRUPTION_REQUEST_SCHEMA_VERSION,
  FINAL_BOUND_INTERRUPTION_RESPONSE_SCHEMA_VERSION,
  FinalBoundInterruptionRequestSchema,
  type FinalBoundInterruptionRequest,
} from "@/domain/objections/final-bound-contracts";
import {
  FINAL_BOUND_INTERRUPTION_LEASE_CLOCK_SKEW_MS,
  FINAL_BOUND_INTERRUPTION_LEASE_DURATION_MS,
} from "@/domain/objections/final-bound-lease";
import {
  WITNESS_ANSWER_REQUEST_SCHEMA_VERSION,
  WitnessAnswerRequestSchema,
} from "@/domain/courtroom-ai";
import {
  HEARING_FINAL_BOUND_INTERRUPTION_CLAIM_SCHEMA_VERSION,
  HEARING_FINAL_BOUND_INTERRUPTION_PREPARATION_SCHEMA_VERSION,
  HEARING_FINAL_BOUND_INTERRUPTION_RECOVERY_SCHEMA_VERSION,
  HearingFinalBoundInterruptionClaimResultSchema,
  HearingFinalBoundInterruptionPreparationSchema,
  HearingFinalBoundInterruptionRecoveryPreparationSchema,
  deriveFinalBoundInterruptionPersistenceIds,
  type HearingFinalBoundInterruptionRecoveryPreparation,
} from "@/domain/objections/final-bound-persistence";
import {
  CASE_OWNER_COOKIE_NAME,
  resolveCaseOwnerSession,
} from "@/server/case-api";
import {
  createObjectionRulingOutputFixture,
  createObjectionRulingRequestFixture,
} from "@/server/courtroom-ai/judicial-response.test-fixtures";
import { createOpponentPlannerRequestFixture } from "@/server/courtroom-ai/opponent-planner.test-fixtures";

const courtroomProviderHarness = vi.hoisted(() => ({
  steps: [] as import("@/server/courtroom-ai").ScriptedCourtroomModelStep[],
  providers: [] as Array<{
    readonly requests: import("@/server/courtroom-ai").CourtroomModelProviderRequest[];
  }>,
}));

vi.mock("@/server/courtroom-ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/courtroom-ai")>();
  return {
    ...actual,
    EnvironmentCourtroomModelProvider: class extends actual.ScriptedCourtroomModelProvider {
      constructor() {
        super(
          courtroomProviderHarness.steps.length > 0
            ? [...courtroomProviderHarness.steps]
            : [
                {
                  type: "error",
                  code: "unexpected_model_dispatch",
                  message: "The route dispatched an unconfigured model step",
                  retryable: false,
                },
              ],
          { repeatLastStep: false },
        );
        courtroomProviderHarness.providers.push(this);
      }
    },
  };
});

import { GET as readHearing } from "./[trialId]/route";
import { POST as commandHearing } from "./[trialId]/commands/route";
import { POST as interruptHearing } from "./[trialId]/interruptions/route";
import { POST as recoverInterruption } from "./[trialId]/interruptions/recover/route";
import { POST as startHearing } from "./route";

const PUBLIC_ORIGIN = "https://suits.test";
const SESSION_SECRET = "test-session-secret-that-is-longer-than-thirty-two-characters";
const SERVICE_SECRET = "test-convex-service-secret-longer-than-thirty-two-characters";
const SESSION_ID = "123e4567-e89b-42d3-a456-426614174000";
const REQUEST_ID = "223e4567-e89b-42d3-a456-426614174000";
const TRIAL_ID = `trial_${REQUEST_ID.replaceAll("-", "")}`;

const VIEW = HearingRuntimeViewV1Schema.parse({
  schemaVersion: "hearing-runtime-view.v1",
  case: {
    caseId: "case_redwood_signal_v1",
    version: 1,
    title: "Rina Shah v. Redwood Signal Systems",
    summary: "A fictional workplace retaliation simulation.",
    educationalDisclaimer: "Educational simulation only; not legal advice.",
    jurisdiction: {
      profileId: "jurisdiction_fictional_civil",
      name: "Fictional Civil Court",
      rulesVersion: "rules.v1",
      governingLaw: "Fictional civil law",
      burdenOfProof: "preponderance",
    },
    issues: [],
  },
  trial: {
    trialId: TRIAL_ID,
    phase: "case_in_chief",
    status: "active",
    version: 3,
    sequence: 3,
    lastEventId: "event:action:phase-case-in-chief",
    userSide: "user",
  },
  activeAppearance: null,
  activeQuestion: null,
  capabilities: {
    canAskQuestion: false,
    canFinishExamination: false,
    canFinishTrial: true,
    canObject: false,
    canContinueResponse: false,
    canProposeSettlement: false,
    counterableSettlementOfferIds: [],
    acceptableSettlementOfferIds: [],
    rejectableSettlementOfferIds: [],
    withdrawableSettlementOfferIds: [],
  },
  witnesses: [],
  player: {
    actorId: "actor:counsel:party_rina_shah",
    actorRole: "user_counsel",
    side: "user",
    partyId: "party_rina_shah",
    facts: [],
    evidence: [],
    settlement: null,
  },
  transcript: [],
  permittedObjectionGrounds: ["relevance"],
});

function configureEnvironment(): void {
  vi.stubEnv("SUITS_PUBLIC_ORIGIN", PUBLIC_ORIGIN);
  vi.stubEnv("SUITS_SESSION_SECRET", SESSION_SECRET);
  vi.stubEnv("SUITS_CONVEX_SERVICE_SECRET", SERVICE_SECRET);
  vi.stubEnv("NEXT_PUBLIC_CONVEX_SITE_URL", "https://convex.test");
}

function sessionCookie(): string {
  return resolveCaseOwnerSession(undefined, {
    secret: SESSION_SECRET,
    createSessionId: () => SESSION_ID,
  }).cookieValue;
}

function finalBoundRequest(
  trialId = TRIAL_ID,
  finalText = "Isn't it true that you ignored the alert that morning?",
): FinalBoundInterruptionRequest {
  return FinalBoundInterruptionRequestSchema.parse({
    schemaVersion: FINAL_BOUND_INTERRUPTION_REQUEST_SCHEMA_VERSION,
    head: {
      trialId,
      stateVersion: VIEW.trial.version,
      lastEventId: VIEW.trial.lastEventId,
    },
    utterance: { generation: 4, utteranceId: "utterance:question:004" },
    trigger: {
      revision: 2,
      text: "Isn't it true that you ignored the alert?",
      confidence: 0.99,
    },
    final: { revision: 3, text: finalText },
  });
}

function interruptionMetadata(request: FinalBoundInterruptionRequest) {
  const ids = deriveFinalBoundInterruptionPersistenceIds(request);
  const interruptionEventId = `event:${ids.beginInterruptionActionId}`;
  return {
    interruptId: ids.interruptId,
    objectionId: ids.objectionId,
    questionId: ids.questionId,
    responseId: ids.responseId,
    questionEventId: `event:${ids.questionActionId}`,
    objectionEventId: `event:${ids.objectionActionId}`,
    interruptionEventId,
    ground: "leading" as const,
    triggerRevision: request.trigger.revision,
    finalRevision: request.final.revision,
    sourceHead: request.head,
    committedHead: {
      trialId: request.head.trialId,
      stateVersion: request.head.stateVersion + 4,
      lastEventId: interruptionEventId,
    },
    prefixReplayed: true,
  };
}

function completedInterruptionPreparation(
  request: FinalBoundInterruptionRequest,
  view: HearingRuntimeViewV1,
) {
  return {
    schemaVersion: HEARING_FINAL_BOUND_INTERRUPTION_PREPARATION_SCHEMA_VERSION,
    phase: "ruling_committed" as const,
    interrupt: interruptionMetadata(request),
    outcome: { ruling: "overruled" as const, remedy: "resume_response" as const },
    outcomeReplayed: true as const,
    preparation: {
      schemaVersion: HEARING_COMMAND_PREPARATION_SCHEMA_VERSION,
      status: "completed" as const,
      view,
    },
  };
}

function recoveryMetadata(
  request: FinalBoundInterruptionRequest,
  targetCompletionHead: Readonly<{
    trialId: string;
    stateVersion: number;
    lastEventId: string;
  }>,
  answerTurnId: string | null,
) {
  const prepared = interruptionMetadata(request);
  const scope = {
    interruptId: prepared.interruptId,
    objectionId: prepared.objectionId,
    questionId: prepared.questionId,
    responseId: prepared.responseId,
    questionEventId: prepared.questionEventId,
    objectionEventId: prepared.objectionEventId,
    interruptionEventId: prepared.interruptionEventId,
    ground: prepared.ground,
    sourceHead: prepared.sourceHead,
    committedHead: prepared.committedHead,
  };
  return {
    ...scope,
    decisionId: `decision:${scope.objectionId}`,
    answerTurnId,
    targetCompletionHead,
  };
}

function witnessAnswerTurn(
  turnId: string,
): HearingRuntimeViewV1["transcript"][number] {
  return {
    ordinal: 1,
    turnId,
    actor: {
      actorId: "actor:witness:rina",
      role: "witness",
      side: "neutral",
      witnessId: "witness_rina",
    },
    text: "I saw the alert that morning.",
    testimonyId: "testimony:final-bound:rina",
    status: "active",
    citations: {
      factIds: [],
      evidenceIds: [],
      testimonyIds: [],
      eventIds: [],
      sourceSegmentIds: [],
    },
  };
}

function completedInterruptionRecovery(
  request: FinalBoundInterruptionRequest,
  view: HearingRuntimeViewV1,
) {
  const answerTurnId = view.transcript.at(-1)?.turnId ?? null;
  return HearingFinalBoundInterruptionRecoveryPreparationSchema.parse({
    schemaVersion: HEARING_FINAL_BOUND_INTERRUPTION_RECOVERY_SCHEMA_VERSION,
    phase: "ruling_committed",
    interrupt: recoveryMetadata(
      request,
      {
        trialId: view.trial.trialId,
        stateVersion: view.trial.version,
        lastEventId: view.trial.lastEventId,
      },
      answerTurnId,
    ),
    outcome: { ruling: "overruled", remedy: "resume_response" },
    preparation: {
      schemaVersion: HEARING_COMMAND_PREPARATION_SCHEMA_VERSION,
      status: "completed",
      view,
    },
    view,
    continuation: "complete",
  });
}

function rulingRequiredRecovery(request: FinalBoundInterruptionRequest) {
  const pending = rulingRequiredInterruptionPreparation(request);
  if (pending.phase !== "ruling_required") {
    throw new Error("Expected a ruling-required fixture");
  }
  const head = pending.interrupt.committedHead;
  const view = HearingRuntimeViewV1Schema.parse({
    ...VIEW,
    trial: {
      ...VIEW.trial,
      version: head.stateVersion,
      sequence: head.stateVersion,
      lastEventId: head.lastEventId,
    },
  });
  return HearingFinalBoundInterruptionRecoveryPreparationSchema.parse({
    schemaVersion: HEARING_FINAL_BOUND_INTERRUPTION_RECOVERY_SCHEMA_VERSION,
    phase: "ruling_required",
    interrupt: recoveryMetadata(request, head, null),
    outcome: null,
    preparation: pending.preparation,
    view,
    continuation: "pending",
  });
}

function sustainedInterruptionRecovery(
  request: FinalBoundInterruptionRequest,
) {
  const committed = interruptionMetadata(request).committedHead;
  const target = {
    trialId: committed.trialId,
    stateVersion: committed.stateVersion + 2,
    lastEventId: "event:final-bound-resolution:sustained",
  };
  const view = HearingRuntimeViewV1Schema.parse({
    ...VIEW,
    trial: {
      ...VIEW.trial,
      version: target.stateVersion,
      sequence: target.stateVersion,
      lastEventId: target.lastEventId,
    },
  });
  return HearingFinalBoundInterruptionRecoveryPreparationSchema.parse({
    schemaVersion: HEARING_FINAL_BOUND_INTERRUPTION_RECOVERY_SCHEMA_VERSION,
    phase: "ruling_committed",
    interrupt: recoveryMetadata(request, target, null),
    outcome: { ruling: "sustained", remedy: "rephrase" },
    preparation: {
      schemaVersion: HEARING_COMMAND_PREPARATION_SCHEMA_VERSION,
      status: "completed",
      view,
    },
    view,
    continuation: "complete",
  });
}

function witnessPendingInterruptionRecovery(
  request: FinalBoundInterruptionRequest,
) {
  const committed = interruptionMetadata(request).committedHead;
  const target = {
    trialId: committed.trialId,
    stateVersion: committed.stateVersion + 3,
    lastEventId: "event:final-bound-resume:overruled",
  };
  const view = HearingRuntimeViewV1Schema.parse({
    ...VIEW,
    trial: {
      ...VIEW.trial,
      version: target.stateVersion,
      sequence: target.stateVersion,
      lastEventId: target.lastEventId,
    },
  });
  const witnessRequest = targetWitnessRequest(request);
  return HearingFinalBoundInterruptionRecoveryPreparationSchema.parse({
    schemaVersion: HEARING_FINAL_BOUND_INTERRUPTION_RECOVERY_SCHEMA_VERSION,
    phase: "ruling_committed",
    interrupt: recoveryMetadata(request, target, null),
    outcome: { ruling: "overruled", remedy: "resume_response" },
    preparation: {
      schemaVersion: HEARING_COMMAND_PREPARATION_SCHEMA_VERSION,
      status: "model_required",
      request: {
        ...witnessRequest,
        expectedStateVersion: target.stateVersion,
        expectedLastEventId: target.lastEventId,
        knowledgeView: {
          ...witnessRequest.knowledgeView,
          stateVersion: target.stateVersion,
          publicRecord: {
            ...witnessRequest.knowledgeView.publicRecord,
            stateVersion: target.stateVersion,
          },
        },
      },
    },
    view,
    continuation: "pending",
  });
}

function claimedInterruption(
  recovery: HearingFinalBoundInterruptionRecoveryPreparation,
  leaseExpiresAt = Date.now() + 30_000,
) {
  return HearingFinalBoundInterruptionClaimResultSchema.parse({
    schemaVersion: HEARING_FINAL_BOUND_INTERRUPTION_CLAIM_SCHEMA_VERSION,
    status: "claimed",
    decisionId: recovery.interrupt.decisionId,
    interruptId: recovery.interrupt.interruptId,
    leaseGeneration: 1,
    leaseToken: `lease_${"a".repeat(64)}_123e4567-e89b-42d3-a456-426614174000`,
    leaseExpiresAt,
    recovery,
  });
}

function targetObjectionRulingRequest(request: FinalBoundInterruptionRequest) {
  const fixture = createObjectionRulingRequestFixture(request.final.text);
  const metadata = interruptionMetadata(request);
  return {
    ...fixture,
    callId: `call:${metadata.objectionId}`,
    decisionId: `decision:${metadata.objectionId}`,
    trialId: request.head.trialId,
    expectedStateVersion: metadata.committedHead.stateVersion,
    expectedLastEventId: metadata.committedHead.lastEventId,
    objection: {
      ...fixture.objection,
      objectionId: metadata.objectionId,
      sourceEventId: metadata.objectionEventId,
      questionId: metadata.questionId,
      ground: metadata.ground,
      interruptedResponseId: metadata.responseId,
    },
    question: {
      ...fixture.question,
      questionId: metadata.questionId,
      eventId: metadata.questionEventId,
      text: request.final.text,
    },
    interruption: {
      interruptId: metadata.interruptId,
      interruptedResponseId: metadata.responseId,
      sourceEventId: metadata.interruptionEventId,
    },
    knowledgeView: {
      ...fixture.knowledgeView,
      trialId: request.head.trialId,
      stateVersion: metadata.committedHead.stateVersion,
      publicRecord: {
        ...fixture.knowledgeView.publicRecord,
        trialId: request.head.trialId,
        stateVersion: metadata.committedHead.stateVersion,
      },
      rules: {
        ...fixture.knowledgeView.rules,
        permittedObjectionGrounds: [
          ...fixture.knowledgeView.rules.permittedObjectionGrounds,
          "leading" as const,
        ],
      },
      currentExchange: {
        ...fixture.knowledgeView.currentExchange,
        text: request.final.text,
      },
    },
  };
}

function rulingRequiredInterruptionPreparation(
  request: FinalBoundInterruptionRequest,
) {
  return HearingFinalBoundInterruptionPreparationSchema.parse({
    schemaVersion: HEARING_FINAL_BOUND_INTERRUPTION_PREPARATION_SCHEMA_VERSION,
    phase: "ruling_required" as const,
    interrupt: interruptionMetadata(request),
    outcome: null,
    outcomeReplayed: false as const,
    preparation: {
      schemaVersion: HEARING_COMMAND_PREPARATION_SCHEMA_VERSION,
      status: "model_required" as const,
      request: targetObjectionRulingRequest(request),
    },
  });
}

function targetWitnessRequest(request: FinalBoundInterruptionRequest) {
  const metadata = interruptionMetadata(request);
  const stateVersion = metadata.committedHead.stateVersion + 2;
  return WitnessAnswerRequestSchema.parse({
    schemaVersion: WITNESS_ANSWER_REQUEST_SCHEMA_VERSION,
    callId: `call:witness:${metadata.responseId}`,
    trialId: request.head.trialId,
    responseId: metadata.responseId,
    expectedStateVersion: stateVersion,
    expectedLastEventId: "event:malicious-witness-continuation",
    actorId: "actor:witness:rina",
    witnessId: "witness_rina",
    question: {
      questionId: metadata.questionId,
      appearanceId: "appearance:witness:rina",
      turnId: "turn:question:rina",
      eventId: metadata.questionEventId,
      examinationKind: "direct",
      text: request.final.text,
      presentedEvidenceIds: [],
    },
    knowledgeView: {
      schemaVersion: "knowledge-view.v2",
      trialId: request.head.trialId,
      stateVersion,
      actorId: "actor:witness:rina",
      actorRole: "witness",
      case: {
        caseId: "case_redwood_signal_v1",
        caseVersion: 1,
        title: "Rina Shah v. Redwood Signal Systems",
      },
      publicRecord: {
        schemaVersion: "jury-record.v1",
        trialId: request.head.trialId,
        stateVersion,
        facts: [],
        evidence: [],
        testimony: [],
        instructions: [],
      },
      witness: {
        witnessId: "witness_rina",
        name: "Rina Shah",
        role: "Fact witness",
        emotionalState: "neutral",
        facts: [],
        admittedSeenEvidence: [],
        priorStatements: [],
        allowedTopics: ["personal knowledge"],
        forbiddenTopics: ["other witnesses' private knowledge"],
      },
      presentedEvidence: [],
      currentExchange: {
        exchangeId: "turn:question:rina",
        speakerActorId: "actor:counsel:user",
        text: request.final.text,
        factIds: [],
        evidenceIds: [],
      },
    },
  });
}

afterEach(() => {
  courtroomProviderHarness.steps.splice(0);
  courtroomProviderHarness.providers.splice(0);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("hearing BFF routes", () => {
  it("creates a signed anonymous session and forwards only server-derived ownership", async () => {
    configureEnvironment();
    let forwarded: unknown;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const rawUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      expect(new URL(rawUrl).pathname).toBe(
        "/service/hearings/start",
      );
      expect(init?.headers).toMatchObject({
        Authorization: `Bearer ${SERVICE_SECRET}`,
      });
      forwarded = JSON.parse(String(init?.body)) as unknown;
      return Response.json(VIEW);
    });
    vi.stubGlobal("fetch", fetchMock);
    const response = await startHearing(
      new NextRequest(`${PUBLIC_ORIGIN}/api/hearings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: PUBLIC_ORIGIN,
        },
        body: JSON.stringify({
          schemaVersion: HEARING_START_SCHEMA_VERSION,
          requestId: REQUEST_ID,
          requestedAt: "2026-07-19T03:00:00.000Z",
          case: { kind: "seeded", slug: "redwood-signal-retaliation" },
          userSide: "user",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.cookies.get(CASE_OWNER_COOKIE_NAME)).toMatchObject({
      httpOnly: true,
      sameSite: "strict",
    });
    expect(forwarded).toMatchObject({
      ownerId: expect.stringMatching(/^owner:[0-9a-f-]{36}$/u),
      request: {
        schemaVersion: HEARING_START_SCHEMA_VERSION,
        requestId: REQUEST_ID,
      },
    });
    expect(JSON.stringify(forwarded)).not.toContain("graphId");
    await expect(response.json()).resolves.toEqual(VIEW);
  });

  it("reads and commands through the same owner cookie without exposing trusted actions", async () => {
    configureEnvironment();
    const requests: Array<{ path: string; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const rawUrl =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        requests.push({
          path: new URL(rawUrl).pathname,
          body: JSON.parse(String(init?.body)) as unknown,
        });
        return Response.json(
          new URL(rawUrl).pathname === "/service/hearings/command/prepare"
            ? {
                schemaVersion: HEARING_COMMAND_PREPARATION_SCHEMA_VERSION,
                status: "completed",
                view: VIEW,
              }
            : VIEW,
        );
      }),
    );
    const cookie = `${CASE_OWNER_COOKIE_NAME}=${sessionCookie()}`;
    const readResponse = await readHearing(
      new NextRequest(`${PUBLIC_ORIGIN}/api/hearings/${TRIAL_ID}`, {
        headers: { Cookie: cookie, Origin: PUBLIC_ORIGIN },
      }),
      { params: Promise.resolve({ trialId: TRIAL_ID }) },
    );
    expect(readResponse.status).toBe(200);

    const command = {
      schemaVersion: HEARING_PLAYER_COMMAND_SCHEMA_VERSION,
      requestId: "323e4567-e89b-42d3-a456-426614174000",
      requestedAt: "2026-07-19T03:01:00.000Z",
      expectedStateVersion: VIEW.trial.version,
      expectedLastEventId: VIEW.trial.lastEventId,
      intent: { type: "call_witness", witnessId: "witness_rina_shah" },
    } as const;
    const commandResponse = await commandHearing(
      new NextRequest(`${PUBLIC_ORIGIN}/api/hearings/${TRIAL_ID}/commands`, {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json",
          Origin: PUBLIC_ORIGIN,
        },
        body: JSON.stringify(command),
      }),
      { params: Promise.resolve({ trialId: TRIAL_ID }) },
    );
    expect(commandResponse.status).toBe(200);
    expect(requests).toEqual([
      {
        path: "/service/hearings/read",
        body: { ownerId: `owner:${SESSION_ID}`, trialId: TRIAL_ID },
      },
      {
        path: "/service/hearings/command/prepare",
        body: {
          ownerId: `owner:${SESSION_ID}`,
          trialId: TRIAL_ID,
          command,
        },
      },
    ]);
    expect(JSON.stringify(requests)).not.toContain("appendTrusted");
    expect(JSON.stringify(requests)).not.toContain("actor:judge");
  });

  it("rejects resume without the signed owner session before calling Convex", async () => {
    configureEnvironment();
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const response = await readHearing(
      new NextRequest(`${PUBLIC_ORIGIN}/api/hearings/${TRIAL_ID}`, {
        headers: { Origin: PUBLIC_ORIGIN },
      }),
      { params: Promise.resolve({ trialId: TRIAL_ID }) },
    );
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a browser-selected counsel actor before calling Convex", async () => {
    configureEnvironment();
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const cookie = `${CASE_OWNER_COOKIE_NAME}=${sessionCookie()}`;
    const response = await commandHearing(
      new NextRequest(`${PUBLIC_ORIGIN}/api/hearings/${TRIAL_ID}/commands`, {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json",
          Origin: PUBLIC_ORIGIN,
        },
        body: JSON.stringify({
          schemaVersion: HEARING_PLAYER_COMMAND_SCHEMA_VERSION,
          requestId: "423e4567-e89b-42d3-a456-426614174000",
          requestedAt: "2026-07-19T03:02:00.000Z",
          expectedStateVersion: VIEW.trial.version,
          expectedLastEventId: VIEW.trial.lastEventId,
          controlledActorId: "actor:counsel:party_other",
          intent: { type: "call_witness", witnessId: "witness_rina_shah" },
        }),
      }),
      { params: Promise.resolve({ trialId: TRIAL_ID }) },
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resumes an exact final-bound interruption without browser-selected authority", async () => {
    configureEnvironment();
    const request = finalBoundRequest();
    const ids = deriveFinalBoundInterruptionPersistenceIds(request);
    const answerTurnId = "turn:answer:final-bound:010";
    const interruptedView = HearingRuntimeViewV1Schema.parse({
      ...VIEW,
      trial: {
        ...VIEW.trial,
        version: 10,
        sequence: 10,
        lastEventId: "event:resumed-answer:010",
      },
      transcript: [witnessAnswerTurn(answerTurnId)],
    });
    const recovery = completedInterruptionRecovery(request, interruptedView);
    const forwarded: Array<Readonly<{ path: string; body: unknown }>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const rawUrl =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        const path = new URL(rawUrl).pathname;
        const body = JSON.parse(String(init?.body)) as unknown;
        forwarded.push({ path, body });
        if (path === "/service/hearings/interruption/prepare") {
          return Response.json(
            completedInterruptionPreparation(request, interruptedView),
          );
        }
        if (path === "/service/hearings/interruption/claim") {
          return Response.json({
            schemaVersion:
              HEARING_FINAL_BOUND_INTERRUPTION_CLAIM_SCHEMA_VERSION,
            status: "outcome",
            interruptId: ids.interruptId,
            recovery,
          });
        }
        throw new Error(`Unexpected service path ${path}`);
      }),
    );
    const cookie = `${CASE_OWNER_COOKIE_NAME}=${sessionCookie()}`;

    const response = await interruptHearing(
      new NextRequest(
        `${PUBLIC_ORIGIN}/api/hearings/${TRIAL_ID}/interruptions`,
        {
          method: "POST",
          headers: {
            Cookie: cookie,
            "Content-Type": "application/json",
            Origin: PUBLIC_ORIGIN,
          },
          body: JSON.stringify(request),
        },
      ),
      { params: Promise.resolve({ trialId: TRIAL_ID }) },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({
      schemaVersion: FINAL_BOUND_INTERRUPTION_RESPONSE_SCHEMA_VERSION,
      disposition: "ruling_committed",
      interruptId: ids.interruptId,
      ruling: "overruled",
      remedy: "resume_response",
      replayed: true,
      targetCompletionHead: {
        trialId: TRIAL_ID,
        stateVersion: interruptedView.trial.version,
        lastEventId: interruptedView.trial.lastEventId,
      },
      continuation: "complete",
      performance: { disposition: "current", answerTurnId },
      view: interruptedView,
    });
    expect(forwarded).toEqual([
      {
        path: "/service/hearings/interruption/prepare",
        body: {
          ownerId: `owner:${SESSION_ID}`,
          trialId: TRIAL_ID,
          request,
        },
      },
      {
        path: "/service/hearings/interruption/claim",
        body: {
          ownerId: `owner:${SESSION_ID}`,
          trialId: TRIAL_ID,
          interruptId: ids.interruptId,
        },
      },
    ]);
    expect(JSON.stringify(forwarded)).not.toContain("actorId");
    expect(JSON.stringify(forwarded)).not.toContain("ground");
    expect(JSON.stringify(payload)).not.toContain("leaseToken");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("single-flights concurrent exact interruption requests across the whole ruling", async () => {
    configureEnvironment();
    const request = finalBoundRequest();
    const pending = rulingRequiredInterruptionPreparation(request);
    const initialRecovery = rulingRequiredRecovery(request);
    const completion = sustainedInterruptionRecovery(request);
    const claimed = claimedInterruption(initialRecovery);
    let claimCount = 0;
    courtroomProviderHarness.steps.push({
      type: "output",
      output: {
        ...createObjectionRulingOutputFixture(),
        remedy: "rephrase",
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const rawUrl =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        const path = new URL(rawUrl).pathname;
        if (path === "/service/hearings/interruption/prepare") {
          return Response.json(pending);
        }
        if (path === "/service/hearings/interruption/claim") {
          claimCount += 1;
          if (claimCount === 1) return Response.json(claimed);
          if (claimCount === 2) {
            return Response.json({
              schemaVersion:
                HEARING_FINAL_BOUND_INTERRUPTION_CLAIM_SCHEMA_VERSION,
              status: "wait",
              decisionId: initialRecovery.interrupt.decisionId,
              interruptId: initialRecovery.interrupt.interruptId,
              leaseGeneration: 1,
              retryAfterMs: 100,
            });
          }
          return Response.json({
            schemaVersion:
              HEARING_FINAL_BOUND_INTERRUPTION_CLAIM_SCHEMA_VERSION,
            status: "outcome",
            interruptId: completion.interrupt.interruptId,
            recovery: completion,
          });
        }
        if (
          path === "/service/hearings/interruption/claim/commit" ||
          path === "/service/hearings/interruption/resume"
        ) {
          return Response.json(completion);
        }
        if (path === "/service/hearings/interruption/claim/release") {
          return Response.json({ status: "outcome", recovery: completion });
        }
        throw new Error(`Unexpected service path ${path}`);
      }),
    );
    const cookie = `${CASE_OWNER_COOKIE_NAME}=${sessionCookie()}`;
    const invoke = async () =>
      await interruptHearing(
        new NextRequest(
          `${PUBLIC_ORIGIN}/api/hearings/${TRIAL_ID}/interruptions`,
          {
            method: "POST",
            headers: {
              Cookie: cookie,
              "Content-Type": "application/json",
              Origin: PUBLIC_ORIGIN,
            },
            body: JSON.stringify(request),
          },
        ),
        { params: Promise.resolve({ trialId: TRIAL_ID }) },
      );

    const responses = await Promise.all([invoke(), invoke()]);
    expect(responses.map(({ status }) => status)).toEqual([200, 200]);
    const payloads = await Promise.all(
      responses.map(async (response) => await response.json()),
    );
    expect(payloads).toEqual([
      expect.objectContaining({
        disposition: "ruling_committed",
        ruling: "sustained",
        remedy: "rephrase",
      }),
      expect.objectContaining({
        disposition: "ruling_committed",
        ruling: "sustained",
        remedy: "rephrase",
      }),
    ]);
    expect(JSON.stringify(payloads)).not.toContain("leaseToken");
    expect(courtroomProviderHarness.providers).toHaveLength(1);
    expect(courtroomProviderHarness.providers[0]?.requests).toHaveLength(1);
    expect(claimCount).toBe(3);
  });

  it("renews a delayed claim before dispatching its model request", async () => {
    configureEnvironment();
    const request = finalBoundRequest();
    const pending = rulingRequiredInterruptionPreparation(request);
    const recovery = rulingRequiredRecovery(request);
    const completion = sustainedInterruptionRecovery(request);
    const order: string[] = [];
    courtroomProviderHarness.steps.push({
      type: "output",
      output: () => {
        order.push("model");
        return {
          ...createObjectionRulingOutputFixture(),
          remedy: "rephrase",
        };
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const rawUrl =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        const path = new URL(rawUrl).pathname;
        if (path === "/service/hearings/interruption/prepare") {
          return Response.json(pending);
        }
        if (path === "/service/hearings/interruption/claim") {
          return Response.json(
            claimedInterruption(
              recovery,
              Date.now() +
                FINAL_BOUND_INTERRUPTION_LEASE_CLOCK_SKEW_MS +
                5_000,
            ),
          );
        }
        if (path === "/service/hearings/interruption/claim/renew") {
          order.push("renew");
          return Response.json({
            status: "renewed",
            leaseExpiresAt: Date.now() + 30_000,
          });
        }
        if (
          path === "/service/hearings/interruption/claim/commit" ||
          path === "/service/hearings/interruption/resume"
        ) {
          return Response.json(completion);
        }
        if (path === "/service/hearings/interruption/claim/release") {
          return Response.json({ status: "outcome", recovery: completion });
        }
        throw new Error(`Unexpected service path ${path}`);
      }),
    );
    const cookie = `${CASE_OWNER_COOKIE_NAME}=${sessionCookie()}`;

    const response = await interruptHearing(
      new NextRequest(
        `${PUBLIC_ORIGIN}/api/hearings/${TRIAL_ID}/interruptions`,
        {
          method: "POST",
          headers: {
            Cookie: cookie,
            "Content-Type": "application/json",
            Origin: PUBLIC_ORIGIN,
          },
          body: JSON.stringify(request),
        },
      ),
      { params: Promise.resolve({ trialId: TRIAL_ID }) },
    );

    expect(response.status).toBe(200);
    expect(order).toEqual(["renew", "model"]);
    expect(courtroomProviderHarness.providers).toHaveLength(1);
    expect(courtroomProviderHarness.providers[0]?.requests).toHaveLength(1);
  });

  it("aborts before the skew-adjusted lease expiry when renewal hangs", async () => {
    configureEnvironment();
    const request = finalBoundRequest();
    const pending = rulingRequiredInterruptionPreparation(request);
    const recovery = rulingRequiredRecovery(request);
    const leaseExpiresAt =
      Date.now() +
      FINAL_BOUND_INTERRUPTION_LEASE_CLOCK_SKEW_MS +
      1_300;
    const durableTakeoverDeadline =
      leaseExpiresAt - FINAL_BOUND_INTERRUPTION_LEASE_CLOCK_SKEW_MS;
    let renewalAborted = false;
    const paths: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const rawUrl =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        const path = new URL(rawUrl).pathname;
        paths.push(path);
        if (path === "/service/hearings/interruption/prepare") {
          return Response.json(pending);
        }
        if (path === "/service/hearings/interruption/claim") {
          return Response.json(
            claimedInterruption(recovery, leaseExpiresAt),
          );
        }
        if (path === "/service/hearings/interruption/claim/renew") {
          return await new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal;
            if (signal?.aborted) {
              renewalAborted = true;
              reject(signal.reason);
              return;
            }
            signal?.addEventListener(
              "abort",
              () => {
                renewalAborted = true;
                reject(signal.reason);
              },
              { once: true },
            );
          });
        }
        if (path === "/service/hearings/interruption/resume") {
          return Response.json(recovery);
        }
        if (path === "/service/hearings/interruption/claim/release") {
          return Response.json({ status: "released" });
        }
        throw new Error(`Unexpected service path ${path}`);
      }),
    );
    const cookie = `${CASE_OWNER_COOKIE_NAME}=${sessionCookie()}`;

    const response = await interruptHearing(
      new NextRequest(
        `${PUBLIC_ORIGIN}/api/hearings/${TRIAL_ID}/interruptions`,
        {
          method: "POST",
          headers: {
            Cookie: cookie,
            "Content-Type": "application/json",
            Origin: PUBLIC_ORIGIN,
          },
          body: JSON.stringify(request),
        },
      ),
      { params: Promise.resolve({ trialId: TRIAL_ID }) },
    );

    expect(response.status).toBe(503);
    expect(renewalAborted).toBe(true);
    expect(Date.now()).toBeLessThan(durableTakeoverDeadline);
    expect(paths).toEqual([
      "/service/hearings/interruption/prepare",
      "/service/hearings/interruption/claim",
      "/service/hearings/interruption/claim/renew",
      "/service/hearings/interruption/resume",
      "/service/hearings/interruption/claim/release",
    ]);
    expect(courtroomProviderHarness.providers).toHaveLength(0);
  });

  it("releases a claim whose protected expiry exceeds the lease horizon", async () => {
    configureEnvironment();
    const request = finalBoundRequest();
    const pending = rulingRequiredInterruptionPreparation(request);
    const recovery = rulingRequiredRecovery(request);
    const paths: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const rawUrl =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        const path = new URL(rawUrl).pathname;
        paths.push(path);
        if (path === "/service/hearings/interruption/prepare") {
          return Response.json(pending);
        }
        if (path === "/service/hearings/interruption/claim") {
          return Response.json(
            claimedInterruption(
              recovery,
              Date.now() +
                FINAL_BOUND_INTERRUPTION_LEASE_DURATION_MS +
                FINAL_BOUND_INTERRUPTION_LEASE_CLOCK_SKEW_MS +
                10_000,
            ),
          );
        }
        if (path === "/service/hearings/interruption/claim/release") {
          return Response.json({ status: "released" });
        }
        throw new Error(`Unexpected service path ${path}`);
      }),
    );
    const cookie = `${CASE_OWNER_COOKIE_NAME}=${sessionCookie()}`;

    const response = await interruptHearing(
      new NextRequest(
        `${PUBLIC_ORIGIN}/api/hearings/${TRIAL_ID}/interruptions`,
        {
          method: "POST",
          headers: {
            Cookie: cookie,
            "Content-Type": "application/json",
            Origin: PUBLIC_ORIGIN,
          },
          body: JSON.stringify(request),
        },
      ),
      { params: Promise.resolve({ trialId: TRIAL_ID }) },
    );

    expect(response.status).toBe(500);
    expect(paths).toEqual([
      "/service/hearings/interruption/prepare",
      "/service/hearings/interruption/claim",
      "/service/hearings/interruption/claim/release",
    ]);
    expect(courtroomProviderHarness.providers).toHaveLength(0);
  });

  it("releases a claim that arrives after the bounded acquisition window", async () => {
    configureEnvironment();
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const request = finalBoundRequest();
    const pending = rulingRequiredInterruptionPreparation(request);
    const recovery = rulingRequiredRecovery(request);
    const paths: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const rawUrl =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        const path = new URL(rawUrl).pathname;
        paths.push(path);
        if (path === "/service/hearings/interruption/prepare") {
          return Response.json(pending);
        }
        if (path === "/service/hearings/interruption/claim") {
          now += 60_001;
          return Response.json(
            claimedInterruption(recovery, now + 30_000),
          );
        }
        if (path === "/service/hearings/interruption/claim/release") {
          return Response.json({ status: "released" });
        }
        throw new Error(`Unexpected service path ${path}`);
      }),
    );
    const cookie = `${CASE_OWNER_COOKIE_NAME}=${sessionCookie()}`;

    const response = await interruptHearing(
      new NextRequest(
        `${PUBLIC_ORIGIN}/api/hearings/${TRIAL_ID}/interruptions`,
        {
          method: "POST",
          headers: {
            Cookie: cookie,
            "Content-Type": "application/json",
            Origin: PUBLIC_ORIGIN,
          },
          body: JSON.stringify(request),
        },
      ),
      { params: Promise.resolve({ trialId: TRIAL_ID }) },
    );

    expect(response.status).toBe(503);
    expect(paths).toEqual([
      "/service/hearings/interruption/prepare",
      "/service/hearings/interruption/claim",
      "/service/hearings/interruption/claim/release",
    ]);
    expect(courtroomProviderHarness.providers).toHaveLength(0);
  });

  it("settles a pre-aborted lease guard without dispatching the provider", async () => {
    configureEnvironment();
    const request = finalBoundRequest();
    const pending = rulingRequiredInterruptionPreparation(request);
    const recovery = rulingRequiredRecovery(request);
    const requestAbort = new AbortController();
    const paths: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const rawUrl =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        const path = new URL(rawUrl).pathname;
        paths.push(path);
        if (path === "/service/hearings/interruption/prepare") {
          return Response.json(pending);
        }
        if (path === "/service/hearings/interruption/claim") {
          requestAbort.abort(new Error("test request disconnected"));
          return Response.json(claimedInterruption(recovery));
        }
        if (path === "/service/hearings/interruption/resume") {
          return Response.json(recovery);
        }
        if (path === "/service/hearings/interruption/claim/release") {
          return Response.json({ status: "released" });
        }
        throw new Error(`Unexpected service path ${path}`);
      }),
    );
    const cookie = `${CASE_OWNER_COOKIE_NAME}=${sessionCookie()}`;

    const response = await interruptHearing(
      new NextRequest(
        `${PUBLIC_ORIGIN}/api/hearings/${TRIAL_ID}/interruptions`,
        {
          method: "POST",
          headers: {
            Cookie: cookie,
            "Content-Type": "application/json",
            Origin: PUBLIC_ORIGIN,
          },
          body: JSON.stringify(request),
          signal: requestAbort.signal,
        },
      ),
      { params: Promise.resolve({ trialId: TRIAL_ID }) },
    );

    expect(response.status).toBe(500);
    expect(paths).toEqual([
      "/service/hearings/interruption/prepare",
      "/service/hearings/interruption/claim",
      "/service/hearings/interruption/resume",
      "/service/hearings/interruption/claim/release",
    ]);
    expect(courtroomProviderHarness.providers).toHaveLength(0);
  });

  it("returns the canonical ruling when resumed witness generation fails", async () => {
    configureEnvironment();
    const request = finalBoundRequest();
    const pending = rulingRequiredInterruptionPreparation(request);
    const initialRecovery = rulingRequiredRecovery(request);
    const witnessPending = witnessPendingInterruptionRecovery(request);
    courtroomProviderHarness.steps.push(
      {
        type: "output",
        output: {
          ...createObjectionRulingOutputFixture(),
          ruling: "overruled",
          remedy: "resume_response",
          reason: "The witness may answer from personal knowledge.",
        },
      },
      {
        type: "error",
        code: "witness_temporarily_unavailable",
        message: "untrusted provider detail",
        retryable: true,
      },
    );
    const paths: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const rawUrl =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        const path = new URL(rawUrl).pathname;
        paths.push(path);
        if (path === "/service/hearings/interruption/prepare") {
          return Response.json(pending);
        }
        if (path === "/service/hearings/interruption/claim") {
          return Response.json(claimedInterruption(initialRecovery));
        }
        if (path === "/service/hearings/interruption/claim/commit") {
          return Response.json(witnessPending);
        }
        if (path === "/service/hearings/model-call/terminal") {
          return Response.json({
            callId: witnessPending.preparation.status === "model_required"
              ? witnessPending.preparation.request.callId
              : "call:witness:unavailable",
            attemptCount: 1,
            replayed: false,
          });
        }
        if (path === "/service/hearings/interruption/resume") {
          return Response.json(witnessPending);
        }
        if (path === "/service/hearings/interruption/claim/release") {
          return Response.json({ status: "released" });
        }
        throw new Error(`Unexpected service path ${path}`);
      }),
    );
    const cookie = `${CASE_OWNER_COOKIE_NAME}=${sessionCookie()}`;

    const response = await interruptHearing(
      new NextRequest(
        `${PUBLIC_ORIGIN}/api/hearings/${TRIAL_ID}/interruptions`,
        {
          method: "POST",
          headers: {
            Cookie: cookie,
            "Content-Type": "application/json",
            Origin: PUBLIC_ORIGIN,
          },
          body: JSON.stringify(request),
        },
      ),
      { params: Promise.resolve({ trialId: TRIAL_ID }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      disposition: "ruling_committed",
      ruling: "overruled",
      remedy: "resume_response",
      continuation: "pending",
      performance: { disposition: "current", answerTurnId: null },
      view: witnessPending.view,
    });
    expect(courtroomProviderHarness.providers).toHaveLength(1);
    expect(
      courtroomProviderHarness.providers[0]?.requests.map(({ task }) => task),
    ).toEqual(["resolve_objection", "witness_answer"]);
    expect(paths).toContain(
      "/service/hearings/interruption/claim/commit",
    );
    expect(paths).not.toContain(
      "/service/hearings/interruption/claim/witness/commit",
    );
  });

  it("returns a no-write withdrawal at the unchanged source head", async () => {
    configureEnvironment();
    const request = finalBoundRequest(
      TRIAL_ID,
      "What happened after you saw the alert that morning?",
    );
    const ids = deriveFinalBoundInterruptionPersistenceIds(request);
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const rawUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      expect(new URL(rawUrl).pathname).toBe(
        "/service/hearings/interruption/prepare",
      );
      return Response.json({
        schemaVersion:
          HEARING_FINAL_BOUND_INTERRUPTION_PREPARATION_SCHEMA_VERSION,
        phase: "candidate_withdrawn",
        reason: "final_transcript_withdrew_candidate",
        withdrawalId: ids.withdrawalId,
        sourceHead: request.head,
        triggerRevision: request.trigger.revision,
        finalRevision: request.final.revision,
        interrupt: null,
        preparation: {
          schemaVersion: HEARING_COMMAND_PREPARATION_SCHEMA_VERSION,
          status: "completed",
          view: VIEW,
        },
        outcome: null,
        outcomeReplayed: false,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const cookie = `${CASE_OWNER_COOKIE_NAME}=${sessionCookie()}`;

    const response = await interruptHearing(
      new NextRequest(
        `${PUBLIC_ORIGIN}/api/hearings/${TRIAL_ID}/interruptions`,
        {
          method: "POST",
          headers: {
            Cookie: cookie,
            "Content-Type": "application/json",
            Origin: PUBLIC_ORIGIN,
          },
          body: JSON.stringify(request),
        },
      ),
      { params: Promise.resolve({ trialId: TRIAL_ID }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      schemaVersion: FINAL_BOUND_INTERRUPTION_RESPONSE_SCHEMA_VERSION,
      disposition: "candidate_withdrawn",
      withdrawalId: ids.withdrawalId,
      head: request.head,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("recovers the owner-bound current interruption without browser authority", async () => {
    configureEnvironment();
    const request = finalBoundRequest();
    const answerTurnId = "turn:answer:recovered:010";
    const recoveredView = HearingRuntimeViewV1Schema.parse({
      ...VIEW,
      trial: {
        ...VIEW.trial,
        version: 10,
        sequence: 10,
        lastEventId: "event:recovered-answer:010",
      },
      transcript: [witnessAnswerTurn(answerTurnId)],
    });
    const recovery = completedInterruptionRecovery(request, recoveredView);
    let forwarded: unknown;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const rawUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      expect(new URL(rawUrl).pathname).toBe(
        "/service/hearings/interruption/claim",
      );
      forwarded = JSON.parse(String(init?.body)) as unknown;
      return Response.json({
        schemaVersion: HEARING_FINAL_BOUND_INTERRUPTION_CLAIM_SCHEMA_VERSION,
        status: "outcome",
        interruptId: recovery.interrupt.interruptId,
        recovery,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const cookie = `${CASE_OWNER_COOKIE_NAME}=${sessionCookie()}`;

    const response = await recoverInterruption(
      new NextRequest(
        `${PUBLIC_ORIGIN}/api/hearings/${TRIAL_ID}/interruptions/recover`,
        {
          method: "POST",
          headers: { Cookie: cookie, Origin: PUBLIC_ORIGIN },
        },
      ),
      { params: Promise.resolve({ trialId: TRIAL_ID }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      disposition: "ruling_committed",
      interruptId: recovery.interrupt.interruptId,
      replayed: true,
      performance: { disposition: "current", answerTurnId },
      view: recoveredView,
    });
    expect(forwarded).toEqual({
      ownerId: `owner:${SESSION_ID}`,
      trialId: TRIAL_ID,
    });
    expect(JSON.stringify(forwarded)).not.toContain("interruptId");
    expect(JSON.stringify(forwarded)).not.toContain("leaseToken");
  });

  it("reports no recovery when the durable trial has no final-bound interruption", async () => {
    configureEnvironment();
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json(
        { error: "FINAL_BOUND_INTERRUPTION_INVALID" },
        { status: 422 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const cookie = `${CASE_OWNER_COOKIE_NAME}=${sessionCookie()}`;

    const response = await recoverInterruption(
      new NextRequest(
        `${PUBLIC_ORIGIN}/api/hearings/${TRIAL_ID}/interruptions/recover`,
        {
          method: "POST",
          headers: { Cookie: cookie, Origin: PUBLIC_ORIGIN },
        },
      ),
      { params: Promise.resolve({ trialId: TRIAL_ID }) },
    );

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects valid interruption metadata bound to another request at the same head", async () => {
    configureEnvironment();
    const request = finalBoundRequest();
    const swappedRequest = finalBoundRequest(
      TRIAL_ID,
      "Isn't it true that you ignored a different warning?",
    );
    const interruptedView = HearingRuntimeViewV1Schema.parse({
      ...VIEW,
      trial: {
        ...VIEW.trial,
        version: 10,
        sequence: 10,
        lastEventId: "event:resumed-answer:010",
      },
    });
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json(
        completedInterruptionPreparation(swappedRequest, interruptedView),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const cookie = `${CASE_OWNER_COOKIE_NAME}=${sessionCookie()}`;

    const response = await interruptHearing(
      new NextRequest(
        `${PUBLIC_ORIGIN}/api/hearings/${TRIAL_ID}/interruptions`,
        {
          method: "POST",
          headers: {
            Cookie: cookie,
            "Content-Type": "application/json",
            Origin: PUBLIC_ORIGIN,
          },
          body: JSON.stringify(request),
        },
      ),
      { params: Promise.resolve({ trialId: TRIAL_ID }) },
    );

    expect(response.status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a canonical recovery that switches the prepared objection ground", async () => {
    configureEnvironment();
    const request = finalBoundRequest();
    const pending = rulingRequiredInterruptionPreparation(request);
    const recovery = rulingRequiredRecovery(request);
    const target = targetObjectionRulingRequest(request);
    const switchedGroundRecovery =
      HearingFinalBoundInterruptionRecoveryPreparationSchema.parse({
        ...recovery,
        interrupt: { ...recovery.interrupt, ground: "hearsay" },
        preparation: {
          schemaVersion: HEARING_COMMAND_PREPARATION_SCHEMA_VERSION,
          status: "model_required",
          request: {
            ...target,
            objection: { ...target.objection, ground: "hearsay" },
            knowledgeView: {
              ...target.knowledgeView,
              rules: {
                ...target.knowledgeView.rules,
                permittedObjectionGrounds: [
                  ...target.knowledgeView.rules.permittedObjectionGrounds,
                  "hearsay",
                ],
              },
            },
          },
        },
      });
    const paths: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const rawUrl =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        const path = new URL(rawUrl).pathname;
        paths.push(path);
        if (path === "/service/hearings/interruption/prepare") {
          return Response.json(pending);
        }
        if (path === "/service/hearings/interruption/claim") {
          return Response.json(claimedInterruption(switchedGroundRecovery));
        }
        throw new Error(`Unexpected service path ${path}`);
      }),
    );
    const cookie = `${CASE_OWNER_COOKIE_NAME}=${sessionCookie()}`;

    const response = await interruptHearing(
      new NextRequest(
        `${PUBLIC_ORIGIN}/api/hearings/${TRIAL_ID}/interruptions`,
        {
          method: "POST",
          headers: {
            Cookie: cookie,
            "Content-Type": "application/json",
            Origin: PUBLIC_ORIGIN,
          },
          body: JSON.stringify(request),
        },
      ),
      { params: Promise.resolve({ trialId: TRIAL_ID }) },
    );

    expect(response.status).toBe(500);
    expect(paths).toEqual([
      "/service/hearings/interruption/prepare",
      "/service/hearings/interruption/claim",
    ]);
    expect(courtroomProviderHarness.providers).toHaveLength(0);
  });

  it("rejects a repeated target ruling before a second provider dispatch", async () => {
    configureEnvironment();
    const request = finalBoundRequest();
    const pending = rulingRequiredInterruptionPreparation(request);
    const recovery = rulingRequiredRecovery(request);
    const claim = claimedInterruption(recovery);
    courtroomProviderHarness.steps.push({
      type: "output",
      output: createObjectionRulingOutputFixture(),
    });
    const paths: string[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const rawUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const path = new URL(rawUrl).pathname;
      paths.push(path);
      if (path === "/service/hearings/interruption/prepare") {
        return Response.json(pending);
      }
      if (path === "/service/hearings/interruption/claim") {
        return Response.json(claim);
      }
      if (
        path === "/service/hearings/interruption/claim/commit" ||
        path === "/service/hearings/interruption/resume"
      ) {
        return Response.json(recovery);
      }
      if (path === "/service/hearings/interruption/claim/release") {
        return Response.json({ status: "released" });
      }
      throw new Error(`Unexpected service path ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const cookie = `${CASE_OWNER_COOKIE_NAME}=${sessionCookie()}`;

    const response = await interruptHearing(
      new NextRequest(
        `${PUBLIC_ORIGIN}/api/hearings/${TRIAL_ID}/interruptions`,
        {
          method: "POST",
          headers: {
            Cookie: cookie,
            "Content-Type": "application/json",
            Origin: PUBLIC_ORIGIN,
          },
          body: JSON.stringify(request),
        },
      ),
      { params: Promise.resolve({ trialId: TRIAL_ID }) },
    );

    expect(response.status).toBe(500);
    expect(paths).toEqual([
      "/service/hearings/interruption/prepare",
      "/service/hearings/interruption/claim",
      "/service/hearings/interruption/claim/commit",
      "/service/hearings/interruption/resume",
      "/service/hearings/interruption/claim/release",
    ]);
    expect(courtroomProviderHarness.providers).toHaveLength(1);
    expect(courtroomProviderHarness.providers[0]?.requests).toHaveLength(1);
    expect(courtroomProviderHarness.providers[0]?.requests[0]?.task).toBe(
      "resolve_objection",
    );
  });

  it("rejects witness generation after a committed sustained ruling", async () => {
    configureEnvironment();
    const request = finalBoundRequest();
    const pending = rulingRequiredInterruptionPreparation(request);
    const recovery = rulingRequiredRecovery(request);
    const claim = claimedInterruption(recovery);
    courtroomProviderHarness.steps.push({
      type: "output",
      output: createObjectionRulingOutputFixture(),
    });
    const witnessPreparation = {
      schemaVersion: HEARING_COMMAND_PREPARATION_SCHEMA_VERSION,
      status: "model_required" as const,
      request: targetWitnessRequest(request),
    };
    const paths: string[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const rawUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const path = new URL(rawUrl).pathname;
      paths.push(path);
      if (path === "/service/hearings/interruption/prepare") {
        return Response.json(pending);
      }
      if (path === "/service/hearings/interruption/claim") {
        return Response.json(claim);
      }
      if (path === "/service/hearings/interruption/claim/commit") {
        return Response.json({
          ...recovery,
          phase: "ruling_committed",
          outcome: { ruling: "sustained", remedy: "cancel_response" },
          preparation: witnessPreparation,
        });
      }
      if (path === "/service/hearings/interruption/resume") {
        return Response.json(recovery);
      }
      if (path === "/service/hearings/interruption/claim/release") {
        return Response.json({ status: "released" });
      }
      throw new Error(`Unexpected service path ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const cookie = `${CASE_OWNER_COOKIE_NAME}=${sessionCookie()}`;

    const response = await interruptHearing(
      new NextRequest(
        `${PUBLIC_ORIGIN}/api/hearings/${TRIAL_ID}/interruptions`,
        {
          method: "POST",
          headers: {
            Cookie: cookie,
            "Content-Type": "application/json",
            Origin: PUBLIC_ORIGIN,
          },
          body: JSON.stringify(request),
        },
      ),
      { params: Promise.resolve({ trialId: TRIAL_ID }) },
    );

    expect(response.status).toBe(503);
    expect(paths).toEqual([
      "/service/hearings/interruption/prepare",
      "/service/hearings/interruption/claim",
      "/service/hearings/interruption/claim/commit",
      "/service/hearings/interruption/resume",
      "/service/hearings/interruption/claim/release",
    ]);
    expect(courtroomProviderHarness.providers).toHaveLength(1);
    expect(courtroomProviderHarness.providers[0]?.requests).toHaveLength(1);
    expect(courtroomProviderHarness.providers[0]?.requests[0]?.task).toBe(
      "resolve_objection",
    );
  });

  it("does not dispatch an unrelated model continuation for an old interruption retry", async () => {
    configureEnvironment();
    const request = finalBoundRequest();
    const interruptedView = HearingRuntimeViewV1Schema.parse({
      ...VIEW,
      trial: {
        ...VIEW.trial,
        version: 10,
        sequence: 10,
        lastEventId: "event:newer-objection:010",
      },
    });
    const stored = completedInterruptionPreparation(request, interruptedView);
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        ...stored,
        preparation: {
          schemaVersion: HEARING_COMMAND_PREPARATION_SCHEMA_VERSION,
          status: "model_required",
          request: createOpponentPlannerRequestFixture(),
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const cookie = `${CASE_OWNER_COOKIE_NAME}=${sessionCookie()}`;

    const response = await interruptHearing(
      new NextRequest(
        `${PUBLIC_ORIGIN}/api/hearings/${TRIAL_ID}/interruptions`,
        {
          method: "POST",
          headers: {
            Cookie: cookie,
            "Content-Type": "application/json",
            Origin: PUBLIC_ORIGIN,
          },
          body: JSON.stringify(request),
        },
      ),
      { params: Promise.resolve({ trialId: TRIAL_ID }) },
    );

    expect(response.status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(courtroomProviderHarness.providers).toHaveLength(0);
  });

  it("rejects a final-bound interruption whose body selects another trial", async () => {
    configureEnvironment();
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const cookie = `${CASE_OWNER_COOKIE_NAME}=${sessionCookie()}`;
    const otherTrialId = `trial_${"f".repeat(32)}`;
    const response = await interruptHearing(
      new NextRequest(
        `${PUBLIC_ORIGIN}/api/hearings/${TRIAL_ID}/interruptions`,
        {
          method: "POST",
          headers: {
            Cookie: cookie,
            "Content-Type": "application/json",
            Origin: PUBLIC_ORIGIN,
          },
          body: JSON.stringify({
            schemaVersion: FINAL_BOUND_INTERRUPTION_REQUEST_SCHEMA_VERSION,
            head: {
              trialId: otherTrialId,
              stateVersion: VIEW.trial.version,
              lastEventId: VIEW.trial.lastEventId,
            },
            utterance: { generation: 1, utteranceId: "utterance:other" },
            trigger: {
              revision: 1,
              text: "Isn't that true?",
              confidence: 0.99,
            },
            final: { revision: 2, text: "Isn't that true?" },
          }),
        },
      ),
      { params: Promise.resolve({ trialId: TRIAL_ID }) },
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
