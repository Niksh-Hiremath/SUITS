import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  HEARING_COMMAND_PREPARATION_SCHEMA_VERSION,
  HEARING_COUNSEL_RESPONSE_PRECOMMIT_SCHEMA_VERSION,
  HEARING_DEBRIEF_GENERATOR_PRECOMMIT_SCHEMA_VERSION,
  HEARING_JUDGE_RESPONSE_PRECOMMIT_SCHEMA_VERSION,
  HEARING_JURY_RESPONSE_PRECOMMIT_SCHEMA_VERSION,
  HEARING_NEGOTIATION_PRECOMMIT_SCHEMA_VERSION,
  HEARING_OBJECTION_RULING_PRECOMMIT_SCHEMA_VERSION,
  HEARING_OPPONENT_PLAN_PRECOMMIT_SCHEMA_VERSION,
  HearingCommandPreparationSchema,
  HearingCounselResponsePrecommitSchema,
  HearingDebriefGeneratorPrecommitSchema,
  HearingJudgeResponsePrecommitSchema,
  HearingJuryResponsePrecommitSchema,
  HearingNegotiationPrecommitSchema,
  HearingObjectionRulingPrecommitSchema,
  HearingOpponentPlanPrecommitSchema,
} from "@/domain/hearing-runtime";
import {
  FINAL_BOUND_INTERRUPTION_REQUEST_SCHEMA_VERSION,
  FinalBoundInterruptionRequestSchema,
} from "@/domain/objections/final-bound-contracts";
import {
  createDebriefGeneratorOutputFixture,
  createDebriefGeneratorRequestFixture,
} from "@/domain/courtroom-ai/debrief-generator.test-fixtures";
import {
  createJuryResponseOutputFixture,
  createJuryResponseRequestFixture,
} from "@/domain/courtroom-ai/jury-response.test-fixtures";
import {
  createCounselQuestionOutputFixture,
  createCounselResponseRequestFixture,
} from "@/server/courtroom-ai/counsel-response.test-fixtures";
import { generateCounselResponse } from "@/server/courtroom-ai/counsel-response";
import { generateDebrief } from "@/server/courtroom-ai/debrief-generator";
import { ScriptedCourtroomModelProvider } from "@/server/courtroom-ai/fake-provider";
import {
  createJudgeResponseOutputFixture,
  createJudgeResponseRequestFixture,
  createObjectionRulingOutputFixture,
  createObjectionRulingRequestFixture,
} from "@/server/courtroom-ai/judicial-response.test-fixtures";
import { generateJudgeResponse } from "@/server/courtroom-ai/judge-response";
import {
  createNegotiationAgentOutputFixture,
  createNegotiationAgentRequestFixture,
} from "@/server/courtroom-ai/negotiation-agent.test-fixtures";
import { generateNegotiationDecision } from "@/server/courtroom-ai/negotiation-agent";
import { generateObjectionRuling } from "@/server/courtroom-ai/objection-ruling";
import {
  createOpponentPlannerOutputFixture,
  createOpponentPlannerRequestFixture,
} from "@/server/courtroom-ai/opponent-planner.test-fixtures";
import { generateOpponentPlan } from "@/server/courtroom-ai/opponent-planner";
import { generateJuryResponse } from "@/server/courtroom-ai/jury-response";
import {
  HearingServiceCounselResponseCommitRequestSchema,
  HearingServiceContinuationPrepareRequestSchema,
  HearingServiceDebriefCommitRequestSchema,
  HearingServiceJudgeResponseCommitRequestSchema,
  HearingServiceJuryResponseCommitRequestSchema,
  HearingServiceFinalBoundInterruptionPrepareRequestSchema,
  HearingServiceFinalBoundInterruptionClaimRequestSchema,
  HearingServiceFinalBoundInterruptionLeaseRequestSchema,
  HearingServiceFinalBoundInterruptionResumeRequestSchema,
  HearingServiceNegotiationCommitRequestSchema,
  HearingServiceObjectionRulingCommitRequestSchema,
  HearingServiceOpponentPlanCommitRequestSchema,
} from "../../../convex/http";

const HTTP_SOURCE_PATH = fileURLToPath(
  new URL("../../../convex/http.ts", import.meta.url),
);
const DURABLE_SERVICE_SOURCE_PATH = fileURLToPath(
  new URL("./durable-service.ts", import.meta.url),
);
const OWNER_ID = "owner:123e4567-e89b-42d3-a456-426614174000";

function sourceSection(
  source: string,
  startMarker: string,
  endMarker: string,
): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(start, `missing source marker: ${startMarker}`).toBeGreaterThanOrEqual(0);
  expect(end, `missing source marker: ${endMarker}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

async function validOpponentPlanPrecommit() {
  const request = createOpponentPlannerRequestFixture();
  const output = createOpponentPlannerOutputFixture();
  const generated = await generateOpponentPlan({
    request,
    provider: new ScriptedCourtroomModelProvider([
      {
        type: "output",
        output,
        requestId: "request:http-opponent-plan:001",
        responseId: "response:http-opponent-plan:001",
      },
    ]),
  });
  return HearingOpponentPlanPrecommitSchema.parse({
    schemaVersion: HEARING_OPPONENT_PLAN_PRECOMMIT_SCHEMA_VERSION,
    trialId: request.trialId,
    callId: request.callId,
    decisionId: request.decisionId,
    output: generated.output,
    modelMetadata: generated.modelMetadata,
    trace: generated.trace,
  });
}

async function validCounselResponsePrecommit() {
  const request = createCounselResponseRequestFixture();
  const output = createCounselQuestionOutputFixture();
  const generated = await generateCounselResponse({
    request,
    provider: new ScriptedCourtroomModelProvider([
      {
        type: "output",
        output,
        requestId: "request:http-counsel-response:001",
        responseId: "response:http-counsel-response:001",
      },
    ]),
  });
  return HearingCounselResponsePrecommitSchema.parse({
    schemaVersion: HEARING_COUNSEL_RESPONSE_PRECOMMIT_SCHEMA_VERSION,
    trialId: request.trialId,
    callId: request.callId,
    decisionId: request.decisionId,
    expectedStateVersion: request.expectedStateVersion,
    expectedLastEventId: request.expectedLastEventId,
    planBinding: request.planBinding,
    output: generated.output,
    modelMetadata: generated.modelMetadata,
    trace: generated.trace,
  });
}

async function validJudgeResponsePrecommit() {
  const request = createJudgeResponseRequestFixture();
  const generated = await generateJudgeResponse({
    request,
    provider: new ScriptedCourtroomModelProvider([
      {
        type: "output",
        output: createJudgeResponseOutputFixture(),
        requestId: "request:http-judge-response:001",
        responseId: "response:http-judge-response:001",
      },
    ]),
  });
  return HearingJudgeResponsePrecommitSchema.parse({
    schemaVersion: HEARING_JUDGE_RESPONSE_PRECOMMIT_SCHEMA_VERSION,
    trialId: request.trialId,
    callId: request.callId,
    decisionId: request.decisionId,
    expectedStateVersion: request.expectedStateVersion,
    expectedLastEventId: request.expectedLastEventId,
    output: generated.output,
    modelMetadata: generated.modelMetadata,
    trace: generated.trace,
  });
}

async function validJuryResponsePrecommit() {
  const request = createJuryResponseRequestFixture();
  const generated = await generateJuryResponse({
    request,
    provider: new ScriptedCourtroomModelProvider([
      { type: "output", output: createJuryResponseOutputFixture() },
    ]),
  });
  return HearingJuryResponsePrecommitSchema.parse({
    schemaVersion: HEARING_JURY_RESPONSE_PRECOMMIT_SCHEMA_VERSION,
    trialId: request.trialId,
    callId: request.callId,
    decisionId: request.decisionId,
    expectedStateVersion: request.expectedStateVersion,
    expectedLastEventId: request.expectedLastEventId,
    output: generated.output,
    modelMetadata: generated.modelMetadata,
    trace: generated.trace,
  });
}

async function validObjectionRulingPrecommit() {
  const request = createObjectionRulingRequestFixture();
  const generated = await generateObjectionRuling({
    request,
    provider: new ScriptedCourtroomModelProvider([
      {
        type: "output",
        output: createObjectionRulingOutputFixture(),
        requestId: "request:http-objection-ruling:001",
        responseId: "response:http-objection-ruling:001",
      },
    ]),
  });
  if (request.interruption === null) {
    throw new Error("Objection fixture must bind an interrupted response");
  }
  return HearingObjectionRulingPrecommitSchema.parse({
    schemaVersion: HEARING_OBJECTION_RULING_PRECOMMIT_SCHEMA_VERSION,
    trialId: request.trialId,
    callId: request.callId,
    decisionId: request.decisionId,
    expectedStateVersion: request.expectedStateVersion,
    expectedLastEventId: request.expectedLastEventId,
    objectionEventId: request.objection.sourceEventId,
    responseId: request.interruption.interruptedResponseId,
    questionEventBinding: {
      turnId: request.question.turnId,
      sourceEventId: request.question.eventId,
    },
    output: generated.output,
    modelMetadata: generated.modelMetadata,
    trace: generated.trace,
  });
}

async function validNegotiationPrecommit() {
  const request = createNegotiationAgentRequestFixture();
  const generated = await generateNegotiationDecision({
    request,
    provider: new ScriptedCourtroomModelProvider([
      {
        type: "output",
        output: createNegotiationAgentOutputFixture(),
        requestId: "request:http-negotiation:001",
        responseId: "response:http-negotiation:001",
      },
    ]),
  });
  return HearingNegotiationPrecommitSchema.parse({
    schemaVersion: HEARING_NEGOTIATION_PRECOMMIT_SCHEMA_VERSION,
    trialId: request.trialId,
    callId: request.callId,
    decisionId: request.decisionId,
    expectedStateVersion: request.expectedStateVersion,
    expectedLastEventId: request.expectedLastEventId,
    output: generated.output,
    modelMetadata: generated.modelMetadata,
    trace: generated.trace,
  });
}

async function validDebriefPrecommit() {
  const request = createDebriefGeneratorRequestFixture();
  const generated = await generateDebrief({
    request,
    provider: new ScriptedCourtroomModelProvider([
      { type: "output", output: createDebriefGeneratorOutputFixture() },
    ]),
  });
  return HearingDebriefGeneratorPrecommitSchema.parse({
    schemaVersion: HEARING_DEBRIEF_GENERATOR_PRECOMMIT_SCHEMA_VERSION,
    trialId: request.trialId,
    callId: request.callId,
    expectedStateVersion: request.expectedStateVersion,
    expectedLastEventId: request.expectedLastEventId,
    transcriptEventBindings: [
      { turnId: "turn_answer", sourceEventId: "event:answer" },
      { turnId: "turn_question", sourceEventId: "event:question" },
    ],
    output: generated.output,
    modelMetadata: generated.modelMetadata,
    trace: generated.trace,
  });
}

describe("secret hearing model-loop HTTP boundary", () => {
  it("accepts only an actorless continuation request", () => {
    const body = {
      ownerId: OWNER_ID,
      trialId: "trial_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    };
    expect(HearingServiceContinuationPrepareRequestSchema.parse(body)).toEqual(
      body,
    );
    for (const forged of [
      { ...body, actorId: "actor:browser-selected" },
      { ...body, command: { intent: "browser-selected" } },
      { ...body, privateDirective: { raw: true } },
    ]) {
      expect(
        HearingServiceContinuationPrepareRequestSchema.safeParse(forged)
          .success,
      ).toBe(false);
    }
  });

  it("accepts only an actorless exact final-bound interruption request", () => {
    const request = FinalBoundInterruptionRequestSchema.parse({
      schemaVersion: FINAL_BOUND_INTERRUPTION_REQUEST_SCHEMA_VERSION,
      head: {
        trialId: "trial_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        stateVersion: 12,
        lastEventId: "event:head:12",
      },
      utterance: { generation: 2, utteranceId: "utterance:final-bound" },
      trigger: {
        revision: 4,
        text: "You signed the delivery report, correct?",
        confidence: 0.99,
      },
      final: {
        revision: 5,
        text: "You signed the delivery report, correct?",
      },
    });
    const body = {
      ownerId: OWNER_ID,
      trialId: request.head.trialId,
      request,
    };
    expect(
      HearingServiceFinalBoundInterruptionPrepareRequestSchema.parse(body),
    ).toEqual(body);
    for (const forged of [
      { ...body, actorId: "actor:browser-selected" },
      { ...body, ground: "leading" },
      { ...body, trialId: "trial_mismatched" },
      { ...body, request: { ...request, ground: "leading" } },
    ]) {
      expect(
        HearingServiceFinalBoundInterruptionPrepareRequestSchema.safeParse(
          forged,
        ).success,
      ).toBe(false);
    }

    const resume = {
      ownerId: OWNER_ID,
      trialId: request.head.trialId,
      interruptId:
        "interrupt:final-bound:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    };
    expect(
      HearingServiceFinalBoundInterruptionResumeRequestSchema.parse(resume),
    ).toEqual(resume);
    expect(
      HearingServiceFinalBoundInterruptionResumeRequestSchema.parse({
        ownerId: OWNER_ID,
        trialId: request.head.trialId,
      }),
    ).toEqual({ ownerId: OWNER_ID, trialId: request.head.trialId });
    expect(
      HearingServiceFinalBoundInterruptionResumeRequestSchema.safeParse({
        ...resume,
        actorId: "actor:forged",
      }).success,
    ).toBe(false);

    expect(
      HearingServiceFinalBoundInterruptionClaimRequestSchema.parse({
        ownerId: OWNER_ID,
        trialId: request.head.trialId,
      }),
    ).toEqual({ ownerId: OWNER_ID, trialId: request.head.trialId });
    const credential = {
      decisionId:
        "decision:objection-ruling:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      interruptId:
        "interrupt:final-bound:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      leaseGeneration: 1,
      leaseToken: `lease_${"b".repeat(64)}_11111111-1111-4111-8111-111111111111`,
    };
    const leaseBody = {
      ownerId: OWNER_ID,
      trialId: request.head.trialId,
      credential,
    };
    expect(
      HearingServiceFinalBoundInterruptionLeaseRequestSchema.parse(leaseBody),
    ).toEqual(leaseBody);
    expect(
      HearingServiceFinalBoundInterruptionLeaseRequestSchema.safeParse({
        ...leaseBody,
        actorId: "actor:forged",
      }).success,
    ).toBe(false);
    expect(
      HearingServiceFinalBoundInterruptionLeaseRequestSchema.safeParse({
        ...leaseBody,
        ground: "leading",
      }).success,
    ).toBe(false);
    expect(
      HearingServiceFinalBoundInterruptionResumeRequestSchema.safeParse({
        ...resume,
        ground: "leading",
      }).success,
    ).toBe(false);
  });

  it("accepts only strict owner- and trial-bound generation precommits", async () => {
    const opponentGeneration = await validOpponentPlanPrecommit();
    const counselGeneration = await validCounselResponsePrecommit();
    const judgeGeneration = await validJudgeResponsePrecommit();
    const objectionGeneration = await validObjectionRulingPrecommit();
    const negotiationGeneration = await validNegotiationPrecommit();
    const juryGeneration = await validJuryResponsePrecommit();
    const debriefGeneration = await validDebriefPrecommit();
    const opponentBody = {
      ownerId: OWNER_ID,
      trialId: opponentGeneration.trialId,
      generation: opponentGeneration,
    };
    const counselBody = {
      ownerId: OWNER_ID,
      trialId: counselGeneration.trialId,
      generation: counselGeneration,
    };
    const judgeBody = {
      ownerId: OWNER_ID,
      trialId: judgeGeneration.trialId,
      generation: judgeGeneration,
    };
    const juryBody = {
      ownerId: OWNER_ID,
      trialId: juryGeneration.trialId,
      generation: juryGeneration,
    };
    const objectionBody = {
      ownerId: OWNER_ID,
      trialId: objectionGeneration.trialId,
      generation: objectionGeneration,
    };
    const negotiationBody = {
      ownerId: OWNER_ID,
      trialId: negotiationGeneration.trialId,
      generation: negotiationGeneration,
    };
    const debriefBody = {
      ownerId: OWNER_ID,
      trialId: debriefGeneration.trialId,
      generation: debriefGeneration,
    };

    expect(
      HearingServiceOpponentPlanCommitRequestSchema.parse(opponentBody),
    ).toEqual(opponentBody);
    expect(
      HearingServiceCounselResponseCommitRequestSchema.parse(counselBody),
    ).toEqual(counselBody);
    expect(
      HearingServiceJudgeResponseCommitRequestSchema.parse(judgeBody),
    ).toEqual(judgeBody);
    expect(
      HearingServiceJuryResponseCommitRequestSchema.parse(juryBody),
    ).toEqual(juryBody);
    expect(
      HearingServiceObjectionRulingCommitRequestSchema.parse(objectionBody),
    ).toEqual(objectionBody);
    expect(
      HearingServiceNegotiationCommitRequestSchema.parse(negotiationBody),
    ).toEqual(negotiationBody);
    expect(HearingServiceDebriefCommitRequestSchema.parse(debriefBody)).toEqual(
      debriefBody,
    );
    expect(
      HearingServiceOpponentPlanCommitRequestSchema.safeParse({
        ...opponentBody,
        generation: counselGeneration,
      }).success,
    ).toBe(false);
    expect(
      HearingServiceCounselResponseCommitRequestSchema.safeParse({
        ...counselBody,
        generation: opponentGeneration,
      }).success,
    ).toBe(false);
    expect(
      HearingServiceJudgeResponseCommitRequestSchema.safeParse({
        ...judgeBody,
        generation: counselGeneration,
      }).success,
    ).toBe(false);
    expect(
      HearingServiceObjectionRulingCommitRequestSchema.safeParse({
        ...objectionBody,
        generation: negotiationGeneration,
      }).success,
    ).toBe(false);
    expect(
      HearingServiceNegotiationCommitRequestSchema.safeParse({
        ...negotiationBody,
        generation: objectionGeneration,
      }).success,
    ).toBe(false);

    for (const [schema, body] of [
      [HearingServiceOpponentPlanCommitRequestSchema, opponentBody],
      [HearingServiceCounselResponseCommitRequestSchema, counselBody],
      [HearingServiceJudgeResponseCommitRequestSchema, judgeBody],
      [HearingServiceObjectionRulingCommitRequestSchema, objectionBody],
      [HearingServiceNegotiationCommitRequestSchema, negotiationBody],
      [HearingServiceJuryResponseCommitRequestSchema, juryBody],
      [HearingServiceDebriefCommitRequestSchema, debriefBody],
    ] as const) {
      expect(
        schema.safeParse({ ...body, ownerId: "owner:browser-selected" })
          .success,
      ).toBe(false);
      expect(
        schema.safeParse({ ...body, trialId: "trial_mismatched" }).success,
      ).toBe(false);
      expect(
        schema.safeParse({ ...body, actorId: "actor_browser_selected" })
          .success,
      ).toBe(false);
      expect(
        schema.safeParse({ ...body, privateDirective: { raw: true } }).success,
      ).toBe(false);
      expect(
        schema.safeParse({
          ...body,
          generation: { ...body.generation, browserPayload: true },
        }).success,
      ).toBe(false);
    }
  });

  it("allows only the preparation union across commit responses", () => {
    const preparation = {
      schemaVersion: HEARING_COMMAND_PREPARATION_SCHEMA_VERSION,
      status: "model_required" as const,
      request: createCounselResponseRequestFixture(),
    };
    expect(HearingCommandPreparationSchema.parse(preparation)).toEqual(
      preparation,
    );

    for (const rawField of ["stateJson", "graphJson", "privateDirective"] as const) {
      expect(
        HearingCommandPreparationSchema.safeParse({
          ...preparation,
          [rawField]: "server-only",
        }).success,
      ).toBe(false);
    }
  });

  it("registers secret POST commits with exact function and response schemas", async () => {
    const source = await readFile(HTTP_SOURCE_PATH, "utf8");

    for (const expected of [
      '>("hearingRuntime:commitOpponentPlanGeneration")',
      '>("hearingRuntime:commitCounselGeneration")',
      '>("hearingRuntime:commitJudgeGeneration")',
      '>("hearingRuntime:commitObjectionRulingGeneration")',
      '>("hearingRuntime:commitNegotiationGeneration")',
      '>("hearingRuntime:commitJuryGeneration")',
      '>("hearingRuntime:commitDebriefGeneration")',
      '>("hearingRuntime:prepareContinuation")',
      '>("hearingRuntime:prepareFinalBoundInterruption")',
      '>("hearingRuntime:resumeFinalBoundInterruption")',
      '>("hearingRuntime:claimFinalBoundInterruption")',
      '>("hearingRuntime:renewFinalBoundInterruptionClaim")',
      '>("hearingRuntime:releaseFinalBoundInterruptionClaim")',
      '>("hearingRuntime:commitClaimedFinalBoundInterruption")',
      '>("hearingRuntime:commitClaimedFinalBoundWitness")',
      'path: "/service/hearings/opponent-plan/commit", method: "POST"',
      'path: "/service/hearings/counsel-response/commit", method: "POST"',
      'path: "/service/hearings/judge-response/commit", method: "POST"',
      'path: "/service/hearings/objection-ruling/commit", method: "POST"',
      'path: "/service/hearings/negotiation/commit", method: "POST"',
      'path: "/service/hearings/jury-response/commit", method: "POST"',
      'path: "/service/hearings/debrief/commit", method: "POST"',
      'path: "/service/hearings/continuation/prepare", method: "POST"',
      'path: "/service/hearings/interruption/prepare", method: "POST"',
      'path: "/service/hearings/interruption/resume", method: "POST"',
      'path: "/service/hearings/interruption/claim", method: "POST"',
      'path: "/service/hearings/interruption/claim/renew", method: "POST"',
      'path: "/service/hearings/interruption/claim/release", method: "POST"',
      'path: "/service/hearings/interruption/claim/commit", method: "POST"',
      'path: "/service/hearings/interruption/claim/witness/commit", method: "POST"',
    ]) {
      expect(source).toContain(expected);
    }

    const witnessSection = sourceSection(
      source,
      "const commitWitnessGeneration = httpAction",
      "const commitOpponentPlanGeneration = httpAction",
    );
    const continuationSection = sourceSection(
      source,
      "const prepareHearingContinuation = httpAction",
      "const prepareFinalBoundInterruption = httpAction",
    );
    expect(continuationSection).toContain("authorizeCaseServiceRequest(");
    expect(continuationSection).toContain(
      "HearingServiceContinuationPrepareRequestSchema",
    );
    expect(continuationSection).toContain(
      "ctx.runAction(\n      prepareHearingContinuationReference",
    );
    expect(continuationSection).toContain(
      "HearingCommandPreparationSchema.parse(result)",
    );
    expect(continuationSection).not.toMatch(
      /actorId|commandJson|stateJson|graphJson|privateDirective/u,
    );
    const finalBoundSection = sourceSection(
      source,
      "const prepareFinalBoundInterruption = httpAction",
      "const resumeFinalBoundInterruption = httpAction",
    );
    expect(finalBoundSection).toContain("authorizeCaseServiceRequest(");
    expect(finalBoundSection).toContain(
      "HearingServiceFinalBoundInterruptionPrepareRequestSchema",
    );
    expect(finalBoundSection).toContain(
      "HearingFinalBoundInterruptionPreparationSchema.parse(result)",
    );
    expect(finalBoundSection).toContain(
      "assertFinalBoundInterruptionPreparationMatchesRequest(",
    );
    expect(finalBoundSection).not.toMatch(
      /stateJson|graphJson|privateDirective|browserPayload/u,
    );
    const finalBoundResumeSection = sourceSection(
      source,
      "const resumeFinalBoundInterruption = httpAction",
      "const claimFinalBoundInterruption = httpAction",
    );
    expect(finalBoundResumeSection).toContain("authorizeCaseServiceRequest(");
    expect(finalBoundResumeSection).toContain(
      "HearingServiceFinalBoundInterruptionResumeRequestSchema",
    );
    expect(finalBoundResumeSection).toContain(
      "HearingFinalBoundInterruptionRecoveryPreparationSchema.parse(result)",
    );
    expect(finalBoundResumeSection).toContain(
      "assertFinalBoundInterruptionRecoveryPreparation(",
    );
    expect(finalBoundResumeSection).not.toMatch(/actorId|ground|stateJson|graphJson/u);
    const finalBoundClaimSection = sourceSection(
      source,
      "const claimFinalBoundInterruption = httpAction",
      "function finalBoundLeaseAction",
    );
    expect(finalBoundClaimSection).toContain("authorizeCaseServiceRequest(");
    expect(finalBoundClaimSection).toContain(
      "HearingServiceFinalBoundInterruptionClaimRequestSchema",
    );
    expect(finalBoundClaimSection).toContain(
      "HearingFinalBoundInterruptionClaimResultSchema.parse(",
    );
    expect(finalBoundClaimSection).not.toMatch(/actorId|ground|stateJson|graphJson/u);
    const claimedCommitSection = sourceSection(
      source,
      "const commitClaimedFinalBoundInterruption = httpAction",
      "const commitClaimedFinalBoundWitness = httpAction",
    );
    const claimedWitnessSection = sourceSection(
      source,
      "const commitClaimedFinalBoundWitness = httpAction",
      "const commitWitnessGeneration = httpAction",
    );
    for (const section of [claimedCommitSection, claimedWitnessSection]) {
      expect(section).toContain("authorizeCaseServiceRequest(");
      expect(section).toContain(
        "HearingFinalBoundInterruptionRecoveryPreparationSchema.parse(",
      );
      expect(section).not.toMatch(/actorId|ground|stateJson|graphJson/u);
    }
    const opponentSection = sourceSection(
      source,
      "const commitOpponentPlanGeneration = httpAction",
      "const commitCounselGeneration = httpAction",
    );
    const counselSection = sourceSection(
      source,
      "const commitCounselGeneration = httpAction",
      "const commitJudgeGeneration = httpAction",
    );
    const judgeSection = sourceSection(
      source,
      "const commitJudgeGeneration = httpAction",
      "const commitObjectionRulingGeneration = httpAction",
    );
    const objectionSection = sourceSection(
      source,
      "const commitObjectionRulingGeneration = httpAction",
      "const commitNegotiationGeneration = httpAction",
    );
    const negotiationSection = sourceSection(
      source,
      "const commitNegotiationGeneration = httpAction",
      "const commitJuryGeneration = httpAction",
    );
    const jurySection = sourceSection(
      source,
      "const commitJuryGeneration = httpAction",
      "const commitDebriefGeneration = httpAction",
    );
    const debriefSection = sourceSection(
      source,
      "const commitDebriefGeneration = httpAction",
      "const recordTerminalModelCall = httpAction",
    );

    for (const section of [
      witnessSection,
      opponentSection,
      counselSection,
      judgeSection,
      objectionSection,
      negotiationSection,
      jurySection,
      debriefSection,
    ]) {
      expect(section).toContain("authorizeCaseServiceRequest(");
      expect(section).toContain(
        "HearingCommandPreparationSchema.parse(result)",
      );
      expect(section).not.toContain("HearingRuntimeViewV1Schema.parse(result)");
      expect(section).not.toContain("caseServiceJson(result)");
      expect(section).not.toMatch(/stateJson|graphJson|privateDirective/u);
    }
    expect(opponentSection).toContain(
      "HearingServiceOpponentPlanCommitRequestSchema",
    );
    expect(counselSection).toContain(
      "HearingServiceCounselResponseCommitRequestSchema",
    );
    expect(judgeSection).toContain(
      "HearingServiceJudgeResponseCommitRequestSchema",
    );
    expect(judgeSection).toContain(
      "ctx.runAction(commitJudgeGenerationReference",
    );
    expect(objectionSection).toContain(
      "HearingServiceObjectionRulingCommitRequestSchema",
    );
    expect(negotiationSection).toContain(
      "HearingServiceNegotiationCommitRequestSchema",
    );
    expect(jurySection).toContain(
      "HearingServiceJuryResponseCommitRequestSchema",
    );
    expect(debriefSection).toContain(
      "HearingServiceDebriefCommitRequestSchema",
    );

    const terminalSchema = sourceSection(
      source,
      "const UnsuccessfulCourtroomModelCallTraceSchema",
      "const HearingServiceTerminalModelCallRequestSchema",
    );
    expect(terminalSchema).toContain('trace.status === "failed"');
    expect(terminalSchema).toContain('trace.status === "cancelled"');
    expect(terminalSchema).toContain('trace.status === "stale"');
    expect(terminalSchema).not.toContain('trace.status === "accepted"');

    const durableServiceSource = await readFile(
      DURABLE_SERVICE_SOURCE_PATH,
      "utf8",
    );
    const judgeDurableSection = sourceSection(
      durableServiceSource,
      "commitJudgeResponse:",
      "commitObjectionRuling:",
    );
    const objectionDurableSection = sourceSection(
      durableServiceSource,
      "commitObjectionRuling:",
      "commitNegotiationDecision:",
    );
    const negotiationDurableSection = sourceSection(
      durableServiceSource,
      "commitNegotiationDecision:",
      "commitJuryResponse:",
    );
    expect(objectionDurableSection).toContain(
      'path: "/service/hearings/objection-ruling/commit"',
    );
    expect(judgeDurableSection).toContain(
      'path: "/service/hearings/judge-response/commit"',
    );
    expect(negotiationDurableSection).toContain(
      'path: "/service/hearings/negotiation/commit"',
    );
    for (const section of [
      judgeDurableSection,
      objectionDurableSection,
      negotiationDurableSection,
    ]) {
      expect(section).toContain("body: { ownerId, trialId, generation }");
      expect(section).toContain(
        "responseSchema: HearingCommandPreparationSchema",
      );
      expect(section).not.toMatch(/actorId|stateJson|graphJson|privateDirective/u);
    }
  });
});
