import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  COURTROOM_MODEL_PROVIDER_PROTOCOL_VERSION,
  COURTROOM_RUNTIME_MODEL,
} from "./constants";
import { ScriptedCourtroomModelProvider } from "./fake-provider";
import {
  CourtroomModelProviderError,
  type CourtroomModelProviderRequest,
  type CourtroomModelStreamEvent,
} from "./provider";

const OUTPUT_SCHEMA = z
  .object({
    dialogue: z.string(),
    citations: z.array(z.string()),
  })
  .strict();

const REQUEST = {
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
  callClass: "role_responder",
  task: "witness_answer",
} as const satisfies CourtroomModelProviderRequest<typeof OUTPUT_SCHEMA>;

const OUTPUT = {
  dialogue: "The signal was red.",
  citations: ["fact_signal"],
} as const;

describe("ScriptedCourtroomModelProvider", () => {
  it("records requests and emits replayable structured deltas", async () => {
    const serialized = JSON.stringify(OUTPUT);
    const chunks = [serialized.slice(0, 12), serialized.slice(12, 35), serialized.slice(35)];
    const events: CourtroomModelStreamEvent[] = [];
    const provider = new ScriptedCourtroomModelProvider([
      { type: "output", output: OUTPUT, chunks },
    ]);

    const first = await provider.generate({
      ...REQUEST,
      onStreamEvent: (event) => events.push(event),
    });
    const replay = await provider.generate(REQUEST);

    expect(provider.requests).toHaveLength(2);
    expect(events.map((event) => event.type)).toEqual([
      "response_started",
      "structured_delta",
      "structured_delta",
      "structured_delta",
      "response_completed",
    ]);
    expect(
      events
        .filter((event) => event.type === "structured_delta")
        .map((event) => event.delta)
        .join(""),
    ).toBe(serialized);
    expect(first).toMatchObject({
      model: COURTROOM_RUNTIME_MODEL,
      output: OUTPUT,
      responseId: "fake-courtroom-response-1-1",
      requestId: "fake-courtroom-request-1-1",
      streamEventCount: 5,
      structuredDeltaCount: 3,
      streamedCharacterCount: serialized.length,
    });
    expect(first.usage?.totalTokens).toBe(
      (first.usage?.inputTokens ?? 0) + (first.usage?.outputTokens ?? 0),
    );
    expect(replay.responseId).toBe(first.responseId);

    provider.rewind();
    const rewound = await provider.generate(REQUEST);
    expect(rewound.responseId).toBe(first.responseId);
  });

  it("honors cancellation between streamed deltas", async () => {
    const controller = new AbortController();
    const events: CourtroomModelStreamEvent[] = [];
    const provider = new ScriptedCourtroomModelProvider(
      [{ type: "output", output: OUTPUT }],
      { defaultChunkSize: 5 },
    );

    await expect(
      provider.generate({
        ...REQUEST,
        signal: controller.signal,
        onStreamEvent: (event) => {
          events.push(event);
          if (event.type === "structured_delta") controller.abort("barge-in");
        },
      }),
    ).rejects.toMatchObject({
      code: "request_aborted",
      retryable: false,
    } satisfies Partial<CourtroomModelProviderError>);

    expect(events.map((event) => event.type)).toEqual([
      "response_started",
      "structured_delta",
      "response_failed",
    ]);
    expect(events.at(-1)).toMatchObject({ code: "request_aborted" });
  });

  it("rejects schema-invalid scripted output without leaking validation detail", async () => {
    const provider = new ScriptedCourtroomModelProvider([
      {
        type: "output",
        output: { dialogue: "Missing citations" },
      },
    ]);

    await expect(provider.generate(REQUEST)).rejects.toMatchObject({
      code: "fake_structured_output_invalid",
      retryable: false,
      message: "The scripted courtroom provider output does not match the requested schema",
    } satisfies Partial<CourtroomModelProviderError>);
  });

  it("can make script exhaustion explicit instead of silently inventing output", async () => {
    const provider = new ScriptedCourtroomModelProvider(
      [{ type: "output", output: OUTPUT }],
      { repeatLastStep: false },
    );

    await provider.generate(REQUEST);
    await expect(provider.generate(REQUEST)).rejects.toMatchObject({
      code: "fake_script_exhausted",
      retryable: false,
    } satisfies Partial<CourtroomModelProviderError>);
  });
});
