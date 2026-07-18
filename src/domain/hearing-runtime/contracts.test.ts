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
