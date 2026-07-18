import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ScriptedCourtroomModelProvider } from "./fake-provider";
import { generateStructuredCourtroomCall } from "./structured-call";

const OutputSchema = z
  .object({
    schemaVersion: z.literal("structured-test.output.v1"),
    decision: z.enum(["repair", "accept"]),
    factIds: z.array(z.string()),
  })
  .strict();

type Request = Readonly<{
  callId: string;
  trialId: string;
  actorId: string;
  expectedStateVersion: number;
  expectedLastEventId: string;
}>;

type Report = Readonly<{
  status: "accepted" | "rejected";
  issues: readonly Readonly<{ code: string }>[];
}>;

const REQUEST: Request = {
  callId: "call:structured:test",
  trialId: "trial_structured_test",
  actorId: "actor_opposing_counsel",
  expectedStateVersion: 4,
  expectedLastEventId: "event_structured_head",
};

const REPAIR_OUTPUT = {
  schemaVersion: "structured-test.output.v1",
  decision: "repair",
  factIds: ["fact_permitted"],
} as const;

const ACCEPTED_OUTPUT = {
  ...REPAIR_OUTPUT,
  decision: "accept",
} as const;

function run(
  provider: ScriptedCourtroomModelProvider,
  signal?: AbortSignal,
) {
  return generateStructuredCourtroomCall<Request, typeof OutputSchema, Report>({
    provider,
    request: REQUEST,
    signal,
    schema: OutputSchema,
    schemaName: "structured_test_output_v1",
    schemaVersion: "structured-test.output.v1",
    promptVersion: "structured-test.prompt.v1",
    call: { callClass: "opponent_planner", task: "plan_opponent" },
    model: "gpt-5.6-luna",
    parseRequest: (request) => ({ ...request }),
    buildPrompt: (context) => ({
      promptVersion: "structured-test.prompt.v1",
      cacheKey: "suits:structured-test:v1",
      developerPrefix: "Stable structured-call rules",
      developerContext: JSON.stringify({
        mode: context.mode,
        callId: context.request.callId,
        issueCodes:
          context.mode === "repair"
            ? context.validationIssues.map((issue) => issue.code)
            : [],
      }),
      untrustedUserContent: JSON.stringify(
        context.mode === "repair"
          ? { request: context.request, rejected: context.rejectedCandidate }
          : { request: context.request },
      ),
    }),
    validate: (_request, candidate) => {
      const output = OutputSchema.parse(candidate);
      return output.decision === "accept"
        ? {
            accepted: true as const,
            output,
            report: { status: "accepted", issues: [] } as const,
          }
        : {
            accepted: false as const,
            report: {
              status: "rejected",
              issues: [{ code: "decision_requires_repair" }],
            } as const,
          };
    },
    traceBinding: (request) => ({
      callId: request.callId,
      trialId: request.trialId,
      responseId: null,
      actorId: request.actorId,
      actorRole: "counsel",
      inputEventIds: [request.expectedLastEventId],
      expectedStateVersion: request.expectedStateVersion,
      expectedLastEventId: request.expectedLastEventId,
      knowledgeScope: {
        knowledgeSchemaVersion: "knowledge-view.test.v1",
        knowledgeViewHash: "a".repeat(64),
        stateVersion: request.expectedStateVersion,
        factCount: 1,
        evidenceCount: 0,
        testimonyCount: 0,
        priorStatementCount: 0,
        sourceSegmentCount: 0,
        publicRecordEventCount: 0,
        currentExchangeCount: 0,
      },
    }),
    acceptedCitations: (output) => ({
      factIds: output.factIds,
      evidenceIds: [],
      testimonyIds: [],
      eventIds: [],
      sourceSegmentIds: [],
      priorStatementIds: [],
    }),
    proposedCitationCount: (output) => output.factIds.length,
    safeValidationFailureCode: "structured_test_validation_failed",
  });
}

describe("generateStructuredCourtroomCall", () => {
  it("allows exactly one semantic repair and returns a redacted accepted trace", async () => {
    const provider = new ScriptedCourtroomModelProvider([
      { type: "output", output: REPAIR_OUTPUT },
      { type: "output", output: ACCEPTED_OUTPUT },
    ]);

    const generated = await run(provider);

    expect(provider.requests).toHaveLength(2);
    expect(provider.requests.map((request) => request.mode)).toEqual([
      "initial",
      "repair",
    ]);
    expect(generated.output).toEqual(ACCEPTED_OUTPUT);
    expect(generated.trace).toMatchObject({
      status: "accepted",
      callClass: "opponent_planner",
      task: "plan_opponent",
      model: "gpt-5.6-luna",
      retryCount: 1,
      validationFailureCount: 1,
      acceptedAttempt: 2,
      acceptedCitations: { factIds: ["fact_permitted"] },
      committedActionId: null,
      committedEventId: null,
    });
    expect(generated.trace.attempts[0]?.validationIssueCodes).toEqual([
      "decision_requires_repair",
    ]);
    expect(JSON.stringify(generated.trace)).not.toContain(
      '"decision":"repair"',
    );
    expect(JSON.stringify(generated.trace)).not.toContain(
      "Stable structured-call rules",
    );
    expect(generated.modelMetadata).toMatchObject({
      model: "gpt-5.6-luna",
      retryCount: 1,
      validationFailureCount: 1,
    });
  });

  it("does not retry provider failures", async () => {
    const provider = new ScriptedCourtroomModelProvider([
      {
        type: "error",
        code: "provider_offline",
        message: "raw provider detail",
        retryable: true,
      },
    ]);

    await expect(run(provider)).rejects.toMatchObject({
      category: "provider_failed",
      trace: {
        status: "failed",
        retryCount: 0,
        safeFailureCode: "provider_offline",
      },
    });
    expect(provider.requests).toHaveLength(1);
  });

  it("fails after one rejected repair", async () => {
    const provider = new ScriptedCourtroomModelProvider([
      { type: "output", output: REPAIR_OUTPUT },
      { type: "output", output: REPAIR_OUTPUT },
    ]);

    await expect(run(provider)).rejects.toMatchObject({
      category: "validation_failed",
      trace: {
        status: "failed",
        retryCount: 1,
        validationFailureCount: 2,
        safeFailureCode: "structured_test_validation_failed",
      },
    });
    expect(provider.requests).toHaveLength(2);
  });

  it("honors cancellation before the provider is called", async () => {
    const controller = new AbortController();
    controller.abort("browser disconnected");
    const provider = new ScriptedCourtroomModelProvider([
      { type: "output", output: ACCEPTED_OUTPUT },
    ]);

    await expect(run(provider, controller.signal)).rejects.toMatchObject({
      category: "cancelled",
      trace: { status: "cancelled", safeFailureCode: "request_aborted" },
    });
    expect(provider.requests).toHaveLength(0);
  });
});
