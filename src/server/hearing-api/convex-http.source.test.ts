import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  HEARING_COMMAND_PREPARATION_SCHEMA_VERSION,
  HEARING_COUNSEL_RESPONSE_PRECOMMIT_SCHEMA_VERSION,
  HEARING_DEBRIEF_GENERATOR_PRECOMMIT_SCHEMA_VERSION,
  HEARING_JURY_RESPONSE_PRECOMMIT_SCHEMA_VERSION,
  HEARING_OPPONENT_PLAN_PRECOMMIT_SCHEMA_VERSION,
  HearingCommandPreparationSchema,
  HearingCounselResponsePrecommitSchema,
  HearingDebriefGeneratorPrecommitSchema,
  HearingJuryResponsePrecommitSchema,
  HearingOpponentPlanPrecommitSchema,
} from "@/domain/hearing-runtime";
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
  createOpponentPlannerOutputFixture,
  createOpponentPlannerRequestFixture,
} from "@/server/courtroom-ai/opponent-planner.test-fixtures";
import { generateOpponentPlan } from "@/server/courtroom-ai/opponent-planner";
import { generateJuryResponse } from "@/server/courtroom-ai/jury-response";
import {
  HearingServiceCounselResponseCommitRequestSchema,
  HearingServiceDebriefCommitRequestSchema,
  HearingServiceJuryResponseCommitRequestSchema,
  HearingServiceOpponentPlanCommitRequestSchema,
} from "../../../convex/http";

const HTTP_SOURCE_PATH = fileURLToPath(
  new URL("../../../convex/http.ts", import.meta.url),
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
  it("accepts only strict owner- and trial-bound generation precommits", async () => {
    const opponentGeneration = await validOpponentPlanPrecommit();
    const counselGeneration = await validCounselResponsePrecommit();
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
    const juryBody = {
      ownerId: OWNER_ID,
      trialId: juryGeneration.trialId,
      generation: juryGeneration,
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
      HearingServiceJuryResponseCommitRequestSchema.parse(juryBody),
    ).toEqual(juryBody);
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

    for (const [schema, body] of [
      [HearingServiceOpponentPlanCommitRequestSchema, opponentBody],
      [HearingServiceCounselResponseCommitRequestSchema, counselBody],
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
      '>("hearingRuntime:commitJuryGeneration")',
      '>("hearingRuntime:commitDebriefGeneration")',
      'path: "/service/hearings/opponent-plan/commit", method: "POST"',
      'path: "/service/hearings/counsel-response/commit", method: "POST"',
      'path: "/service/hearings/jury-response/commit", method: "POST"',
      'path: "/service/hearings/debrief/commit", method: "POST"',
    ]) {
      expect(source).toContain(expected);
    }

    const witnessSection = sourceSection(
      source,
      "const commitWitnessGeneration = httpAction",
      "const commitOpponentPlanGeneration = httpAction",
    );
    const opponentSection = sourceSection(
      source,
      "const commitOpponentPlanGeneration = httpAction",
      "const commitCounselGeneration = httpAction",
    );
    const counselSection = sourceSection(
      source,
      "const commitCounselGeneration = httpAction",
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
  });
});
