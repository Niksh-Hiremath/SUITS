import { describe, expect, it } from "vitest";

import {
  HEARING_PLAYER_COMMAND_SCHEMA_VERSION,
  HEARING_START_SCHEMA_VERSION,
  HearingPlayerCommandSchema,
  StartHearingRequestSchema,
} from "./contracts";

const REQUEST_ID = "123e4567-e89b-42d3-a456-426614174000";

describe("hearing runtime contracts", () => {
  it("accepts seeded and owner-resolved start requests without owner or graph IDs", () => {
    expect(
      StartHearingRequestSchema.parse({
        schemaVersion: HEARING_START_SCHEMA_VERSION,
        requestId: REQUEST_ID,
        requestedAt: "2026-07-19T00:00:00.000Z",
        case: { kind: "seeded", slug: "redwood-signal-retaliation" },
      }),
    ).toMatchObject({ userSide: "user" });
    expect(
      StartHearingRequestSchema.parse({
        schemaVersion: HEARING_START_SCHEMA_VERSION,
        requestId: REQUEST_ID,
        requestedAt: "2026-07-19T00:00:00.000Z",
        case: { kind: "owned", uploadId: "upload:packet-1" },
        userSide: "opposing",
      }).case,
    ).toEqual({ kind: "owned", uploadId: "upload:packet-1" });
    expect(
      StartHearingRequestSchema.safeParse({
        schemaVersion: HEARING_START_SCHEMA_VERSION,
        requestId: REQUEST_ID,
        requestedAt: "2026-07-19T00:00:00.000Z",
        case: { kind: "seeded", slug: "redwood-signal-retaliation" },
        ownerId: "owner:browser-choice",
      }).success,
    ).toBe(false);
  });

  it("accepts only strict high-level player intents", () => {
    const command = {
      schemaVersion: HEARING_PLAYER_COMMAND_SCHEMA_VERSION,
      requestId: REQUEST_ID,
      requestedAt: "2026-07-19T00:01:00.000Z",
      expectedStateVersion: 4,
      expectedLastEventId: "event:action:phase:case-in-chief",
      intent: {
        type: "ask_question",
        witnessId: "witness_rina_shah",
        examinationKind: "direct",
        text: "What did you observe after the complaint was sent?",
        presentedEvidenceIds: [],
      },
    } as const;
    expect(HearingPlayerCommandSchema.parse(command)).toEqual(command);
    expect(
      HearingPlayerCommandSchema.safeParse({
        ...command,
        controlledActorId: "actor:counsel:party_other",
      }).success,
    ).toBe(false);
    expect(
      HearingPlayerCommandSchema.safeParse({
        ...command,
        actor: {
          actorId: "actor:judge",
          role: "judge",
          side: "neutral",
        },
      }).success,
    ).toBe(false);
    expect(
      HearingPlayerCommandSchema.safeParse({
        ...command,
        intent: { type: "BEGIN_PHASE", phase: "complete" },
      }).success,
    ).toBe(false);
  });

  it("accepts bounded objection, response-window, and settlement intents", () => {
    const base = {
      schemaVersion: HEARING_PLAYER_COMMAND_SCHEMA_VERSION,
      requestId: REQUEST_ID,
      requestedAt: "2026-07-19T00:01:00.000Z",
      expectedStateVersion: 12,
      expectedLastEventId: "event:action:pending-response",
    } as const;
    for (const intent of [
      {
        type: "object",
        questionId: "question:opposing-1",
        responseId: "response:opposing-1",
        ground: "hearsay",
      },
      { type: "continue_response", responseId: "response:opposing-1" },
      {
        type: "propose_settlement",
        terms: {
          amount: 75_000,
          nonMonetaryTerms: ["Neutral employment reference"],
          summary: "Resolve the fictional claim for the stated terms.",
        },
      },
      {
        type: "counter_settlement",
        offerId: "offer:opposing-1",
        terms: {
          amount: null,
          nonMonetaryTerms: ["Mutual non-disparagement"],
          summary: "Counter with a non-monetary resolution.",
        },
      },
      { type: "accept_settlement", offerId: "offer:opposing-1" },
      { type: "reject_settlement", offerId: "offer:opposing-1" },
      { type: "withdraw_settlement", offerId: "offer:user-1" },
    ] as const) {
      expect(
        HearingPlayerCommandSchema.safeParse({ ...base, intent }).success,
      ).toBe(true);
    }
    expect(
      HearingPlayerCommandSchema.safeParse({
        ...base,
        intent: {
          type: "propose_settlement",
          terms: {
            amount: null,
            nonMonetaryTerms: [],
            summary: "An empty offer must be rejected.",
          },
        },
      }).success,
    ).toBe(false);
    expect(
      HearingPlayerCommandSchema.safeParse({
        ...base,
        intent: {
          type: "object",
          questionId: "question:opposing-1",
          responseId: "response:opposing-1",
          ground: "made_up_ground",
        },
      }).success,
    ).toBe(false);
  });

  it("requires a stable UUIDv4 id and offset timestamp", () => {
    const base = {
      schemaVersion: HEARING_START_SCHEMA_VERSION,
      requestedAt: "2026-07-19T00:00:00.000Z",
      case: { kind: "seeded", slug: "redwood-signal-retaliation" },
      userSide: "user",
    } as const;
    expect(StartHearingRequestSchema.safeParse({ ...base, requestId: "retry-me" }).success).toBe(false);
    expect(
      StartHearingRequestSchema.safeParse({
        ...base,
        requestId: REQUEST_ID,
        requestedAt: "not-a-date",
      }).success,
    ).toBe(false);
  });
});
