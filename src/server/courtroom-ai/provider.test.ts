import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  COURTROOM_FINAL_DEBRIEF_MODEL,
  COURTROOM_MODEL_PROVIDER_PROTOCOL_VERSION,
  COURTROOM_RUNTIME_MODEL,
  expectedCourtroomModelForCall,
  isCourtroomRuntimeCall,
  type CourtroomRuntimeCall,
} from "./constants";
import {
  assertCourtroomModelProviderRequest,
  CourtroomModelProviderError,
  type CourtroomModelProviderRequest,
} from "./provider";

const OUTPUT_SCHEMA = z.object({ dialogue: z.string() }).strict();

const BASE_REQUEST = {
  protocolVersion: COURTROOM_MODEL_PROVIDER_PROTOCOL_VERSION,
  mode: "initial",
  attempt: 1,
  prompt: {
    promptVersion: "witness-answer.prompt.v1",
    cacheKey: "suits.witness-answer.v1",
    developerPrefix: "Stable courtroom policy",
    developerContext: "Role-scoped trusted context",
    untrustedUserContent: "Untrusted transcript text",
  },
  schema: OUTPUT_SCHEMA,
  schemaName: "suits_witness_answer_v1",
  schemaVersion: "witness-answer.output.v1",
} as const;

describe("courtroom model provider contract", () => {
  it("routes every interactive call to Luna and only final debrief to Terra", () => {
    const calls = [
      { callClass: "opponent_planner", task: "plan_opponent" },
      { callClass: "role_responder", task: "witness_answer" },
      { callClass: "role_responder", task: "counsel_response" },
      { callClass: "role_responder", task: "judge_response" },
      { callClass: "role_responder", task: "jury_deliberation" },
      { callClass: "objection_resolver", task: "resolve_objection" },
      { callClass: "negotiation_agent", task: "evaluate_settlement" },
      { callClass: "debrief_generator", task: "generate_debrief" },
    ] as const satisfies readonly CourtroomRuntimeCall[];

    expect(calls.map(expectedCourtroomModelForCall)).toEqual([
      COURTROOM_RUNTIME_MODEL,
      COURTROOM_RUNTIME_MODEL,
      COURTROOM_RUNTIME_MODEL,
      COURTROOM_RUNTIME_MODEL,
      COURTROOM_RUNTIME_MODEL,
      COURTROOM_RUNTIME_MODEL,
      COURTROOM_RUNTIME_MODEL,
      COURTROOM_FINAL_DEBRIEF_MODEL,
    ]);
  });

  it("keeps CaseCompiler and mismatched class/task pairs outside this provider", () => {
    expect(
      isCourtroomRuntimeCall({
        callClass: "case_compiler",
        task: "compile_case",
      }),
    ).toBe(false);
    expect(
      isCourtroomRuntimeCall({
        callClass: "debrief_generator",
        task: "witness_answer",
      }),
    ).toBe(false);
  });

  it("rejects malformed runtime requests with stable contract errors", () => {
    const malformed = {
      ...BASE_REQUEST,
      callClass: "debrief_generator",
      task: "witness_answer",
    } as unknown as CourtroomModelProviderRequest;

    expect(() => assertCourtroomModelProviderRequest(malformed)).toThrow(
      expect.objectContaining({
        name: "CourtroomModelProviderError",
        code: "provider_contract_mismatch",
        retryable: false,
      } satisfies Partial<CourtroomModelProviderError>),
    );
  });
});
