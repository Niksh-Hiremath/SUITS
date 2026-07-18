import { makeFunctionReference } from "convex/server";
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import {
  HEARING_PLAYER_COMMAND_SCHEMA_VERSION,
  HEARING_START_SCHEMA_VERSION,
  HearingRuntimeViewV1Schema,
  type HearingPlayerIntent,
  type HearingRuntimeViewV1,
} from "../src/domain/hearing-runtime";
import schema from "./schema";

const modules = {
  "./_generated/server.ts": () => import("./_generated/server"),
  "./hearingRuntime.ts": () => import("./hearingRuntime"),
  "./trialEvents.ts": () => import("./trialEvents"),
};

type TestBackend = TestConvex<typeof schema>;

const OWNER_ID = "owner:123e4567-e89b-42d3-a456-426614174000";
const OTHER_OWNER_ID = "owner:223e4567-e89b-42d3-a456-426614174000";
const START_REQUEST_ID = "11111111-1111-4111-8111-111111111111";

const startReference = makeFunctionReference<
  "action",
  Readonly<{ ownerId: string; requestJson: string }>,
  HearingRuntimeViewV1
>("hearingRuntime:start");
const commandReference = makeFunctionReference<
  "action",
  Readonly<{ ownerId: string; trialId: string; commandJson: string }>,
  HearingRuntimeViewV1
>("hearingRuntime:command");
const readReference = makeFunctionReference<
  "action",
  Readonly<{ ownerId: string; trialId: string }>,
  HearingRuntimeViewV1
>("hearingRuntime:read");

function startRequest() {
  return {
    schemaVersion: HEARING_START_SCHEMA_VERSION,
    requestId: START_REQUEST_ID,
    requestedAt: "2026-07-19T03:00:00.000Z",
    case: { kind: "seeded", slug: "redwood-signal-retaliation" },
    userSide: "user",
  } as const;
}

function playerCommand(
  view: HearingRuntimeViewV1,
  requestId: string,
  requestedAt: string,
  intent: HearingPlayerIntent,
) {
  return {
    schemaVersion: HEARING_PLAYER_COMMAND_SCHEMA_VERSION,
    requestId,
    requestedAt,
    expectedStateVersion: view.trial.version,
    expectedLastEventId: view.trial.lastEventId,
    intent,
  } as const;
}

async function start(backend: TestBackend) {
  return HearingRuntimeViewV1Schema.parse(
    await backend.action(startReference, {
      ownerId: OWNER_ID,
      requestJson: JSON.stringify(startRequest()),
    }),
  );
}

async function command(
  backend: TestBackend,
  view: HearingRuntimeViewV1,
  requestId: string,
  requestedAt: string,
  intent: HearingPlayerIntent,
) {
  const request = playerCommand(view, requestId, requestedAt, intent);
  return {
    request,
    view: HearingRuntimeViewV1Schema.parse(
      await backend.action(commandReference, {
        ownerId: OWNER_ID,
        trialId: view.trial.trialId,
        commandJson: JSON.stringify(request),
      }),
    ),
  };
}

describe("V3 hearing runtime facade", () => {
  it("idempotently starts a seeded case without writing any legacy trial rows", async () => {
    const backend = convexTest({ schema, modules });
    const first = await start(backend);
    const second = await start(backend);
    expect(second).toEqual(first);
    expect(first).toMatchObject({
      schemaVersion: "hearing-runtime-view.v1",
      case: { caseId: "case_redwood_signal_v1" },
      trial: {
        phase: "case_in_chief",
        status: "active",
        version: 3,
        sequence: 3,
        userSide: "user",
      },
    });
    expect(first.witnesses).toHaveLength(3);
    expect(JSON.stringify(first.player.facts)).not.toContain('"hidden"');

    const stored = await backend.run(async (ctx) => ({
      graphs: await ctx.db.query("caseGraphs").collect(),
      projections: await ctx.db.query("trialProjections").collect(),
      events: await ctx.db
        .query("trialEvents")
        .withIndex("by_trial_sequence", (index) =>
          index.eq("trialId", first.trial.trialId),
        )
        .collect(),
      legacyTrials: await ctx.db.query("trials").collect(),
      legacyTurns: await ctx.db.query("turns").collect(),
    }));
    expect(stored.graphs).toHaveLength(1);
    expect(stored.graphs[0]).toMatchObject({
      lifecycle: "published",
      visibility: "seeded_public",
      createdBy: "system",
    });
    expect(stored.projections).toHaveLength(1);
    expect(stored.events.map((event) => event.eventType)).toEqual([
      "START_TRIAL",
      "BEGIN_PHASE",
      "BEGIN_PHASE",
    ]);
    expect(stored.legacyTrials).toEqual([]);
    expect(stored.legacyTurns).toEqual([]);
  });

  it("calls, questions, releases, switches witnesses, completes, and resumes only from V3 events", async () => {
    const backend = convexTest({ schema, modules });
    let view = await start(backend);

    ({ view } = await command(
      backend,
      view,
      "22222222-2222-4222-8222-222222222222",
      "2026-07-19T03:01:00.000Z",
      { type: "call_witness", witnessId: "witness_rina_shah" },
    ));
    expect(view.activeAppearance).toMatchObject({
      witnessId: "witness_rina_shah",
      stage: "direct",
    });
    expect(view.trial.version).toBe(5);

    const asked = await command(
      backend,
      view,
      "33333333-3333-4333-8333-333333333333",
      "2026-07-19T03:02:00.000Z",
      {
        type: "ask_question",
        witnessId: "witness_rina_shah",
        examinationKind: "direct",
        text: "When did you send the battery safety complaint?",
        presentedEvidenceIds: [],
      },
    );
    view = asked.view;
    expect(view.trial.version).toBe(8);
    expect(view.activeQuestion).toBeNull();
    expect(view.transcript).toHaveLength(2);
    expect(view.transcript.map((turn) => turn.actor.role)).toEqual([
      "user_counsel",
      "witness",
    ]);
    const replayedQuestion = HearingRuntimeViewV1Schema.parse(
      await backend.action(commandReference, {
        ownerId: OWNER_ID,
        trialId: view.trial.trialId,
        commandJson: JSON.stringify(asked.request),
      }),
    );
    expect(replayedQuestion).toEqual(view);

    ({ view } = await command(
      backend,
      view,
      "44444444-4444-4444-8444-444444444444",
      "2026-07-19T03:03:00.000Z",
      {
        type: "finish_witness",
        witnessId: "witness_rina_shah",
        examinationKind: "direct",
      },
    ));
    expect(view.activeAppearance).toBeNull();
    expect(
      view.witnesses.find((witness) => witness.witnessId === "witness_rina_shah"),
    ).toMatchObject({ status: "released", callCount: 1 });

    ({ view } = await command(
      backend,
      view,
      "55555555-5555-4555-8555-555555555555",
      "2026-07-19T03:04:00.000Z",
      { type: "call_witness", witnessId: "witness_theo_morgan" },
    ));
    ({ view } = await command(
      backend,
      view,
      "66666666-6666-4666-8666-666666666666",
      "2026-07-19T03:05:00.000Z",
      {
        type: "ask_question",
        witnessId: "witness_theo_morgan",
        examinationKind: "direct",
        text: "When was the termination draft created?",
        presentedEvidenceIds: [],
      },
    ));
    ({ view } = await command(
      backend,
      view,
      "77777777-7777-4777-8777-777777777777",
      "2026-07-19T03:06:00.000Z",
      {
        type: "finish_witness",
        witnessId: "witness_theo_morgan",
        examinationKind: "direct",
      },
    ));
    expect(view.transcript).toHaveLength(4);
    expect(
      new Set(
        view.transcript
          .filter((turn) => turn.actor.role === "witness")
          .map((turn) => turn.actor.witnessId),
      ),
    ).toEqual(new Set(["witness_rina_shah", "witness_theo_morgan"]));

    ({ view } = await command(
      backend,
      view,
      "88888888-8888-4888-8888-888888888888",
      "2026-07-19T03:07:00.000Z",
      {
        type: "finish_trial",
        closingText: "The testimony shows why the admitted record warrants relief.",
      },
    ));
    expect(view.trial).toMatchObject({ phase: "complete", status: "complete" });
    expect(view.transcript).toHaveLength(6);

    const resumed = HearingRuntimeViewV1Schema.parse(
      await backend.action(readReference, {
        ownerId: OWNER_ID,
        trialId: view.trial.trialId,
      }),
    );
    expect(resumed).toEqual(view);
    await expect(
      backend.action(readReference, {
        ownerId: OTHER_OWNER_ID,
        trialId: view.trial.trialId,
      }),
    ).rejects.toThrow("TRIAL_NOT_FOUND");

    const stored = await backend.run(async (ctx) => ({
      eventCount: (
        await ctx.db
          .query("trialEvents")
          .withIndex("by_trial_sequence", (index) =>
            index.eq("trialId", view.trial.trialId),
          )
          .collect()
      ).length,
      legacyTrials: await ctx.db.query("trials").collect(),
      legacyTurns: await ctx.db.query("turns").collect(),
    }));
    expect(stored.eventCount).toBe(view.trial.sequence);
    expect(stored.legacyTrials).toEqual([]);
    expect(stored.legacyTurns).toEqual([]);
  });
});
