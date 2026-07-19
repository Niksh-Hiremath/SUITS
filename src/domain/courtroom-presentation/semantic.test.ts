import { describe, expect, it } from "vitest";

import {
  HearingCommittedPerformanceSchema,
  HearingRuntimeViewV1Schema,
} from "../hearing-runtime";
import { freezeHearingPerformanceEvent } from "../../lib/speech/hearing-performance";

import {
  createCourtroomPresentationRuntime,
  reduceCourtroomPresentationRuntime,
  selectCourtroomPresentationRuntime,
} from "./runtime";
import { selectAudibleCourtroomSemanticPerformance } from "./semantic";

const witness = {
  actorId: "actor:witness",
  role: "witness" as const,
  side: "neutral" as const,
  witnessId: "witness:one",
};
const judge = {
  actorId: "actor:judge",
  role: "judge" as const,
  side: "neutral" as const,
  witnessId: null,
};

function committedPerformance(
  kind: "witness_answer" | "objection_ruling",
) {
  const isWitness = kind === "witness_answer";
  return HearingCommittedPerformanceSchema.parse({
    schemaVersion: "hearing-committed-performance.v2",
    kind,
    context: "courtroom",
    head: {
      trialId: "trial:semantic",
      stateVersion: 2,
      lastEventId: "event:action:head",
    },
    source: {
      callId: isWitness ? "call:witness" : "call:ruling",
      actionId: isWitness ? "action:answer" : "action:ruling",
      eventId: isWitness ? "event:action:answer" : "event:action:ruling",
      turnId: isWitness ? "turn:answer" : null,
      responseId: "response:durable",
      interruptId: isWitness ? null : "interrupt:one",
      model: "gpt-5.6-luna",
      outputSchemaVersion: isWitness
        ? "role-responder.witness-answer.output.v1"
        : "objection-resolver.ruling.output.v1",
      outputHash: (isWitness ? "a" : "b").repeat(64),
    },
    actor: isWitness ? witness : judge,
    evidenceIds: [],
    semantic: isWitness
      ? {
          kind: "witness",
          emotion: "nervous",
          intensity: 0.62,
          delivery: "hesitant",
          gesture: "look_away",
          gazeTarget: "questioning_counsel",
        }
      : {
          kind: "role",
          activity: "ruling",
          emotion: "neutral",
          intensity: 0.7,
          gazeTarget: "questioning_counsel",
          gesture: "gavel",
          speakingStyle: "formal",
        },
  });
}

function view() {
  const witnessCue = committedPerformance("witness_answer");
  return HearingRuntimeViewV1Schema.parse({
    schemaVersion: "hearing-runtime-view.v2",
    case: {
      caseId: "case:semantic",
      version: 1,
      title: "Semantic fixture",
      summary: "A fictional educational case.",
      educationalDisclaimer: "Educational simulation only; not legal advice.",
      jurisdiction: {
        profileId: "jurisdiction:semantic",
        name: "Fictional Court",
        rulesVersion: "rules.v1",
        governingLaw: "Fictional law",
        burdenOfProof: "preponderance",
      },
      issues: [],
    },
    trial: {
      trialId: "trial:semantic",
      phase: "case_in_chief",
      status: "active",
      version: 2,
      sequence: 2,
      lastEventId: "event:action:head",
      userSide: "user",
    },
    activeAppearance: null,
    activeQuestion: null,
    capabilities: {
      canAskQuestion: false,
      canFinishExamination: false,
      canFinishTrial: false,
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
      actorId: "actor:user",
      actorRole: "user_counsel",
      side: "user",
      partyId: "party:user",
      facts: [],
      evidence: [],
      settlement: null,
    },
    transcript: [
      {
        ordinal: 1,
        turnId: "turn:answer",
        actor: witness,
        text: "I remember the exchange.",
        testimonyId: "testimony:one",
        status: "active",
        citations: {
          factIds: [],
          evidenceIds: [],
          testimonyIds: [],
          eventIds: [witnessCue.source.eventId],
          sourceSegmentIds: [],
        },
        semanticCue: witnessCue,
      },
    ],
    currentSemanticCue: committedPerformance("objection_ruling"),
    permittedObjectionGrounds: [],
  });
}

function snapshot(input: Readonly<{
  purpose: "testimony" | "ruling";
  turnId: string | null;
  interruptId: string | null;
  actor: string;
  sceneActor: "witness" | "judge";
  started?: boolean;
  terminal?: boolean;
}>) {
  const identity = {
    schemaVersion: "hearing-performance-event.v1" as const,
    generation: 1,
    playbackFence: 1,
    jobId: "job:semantic",
    responseId: "response:local",
    actor: input.actor,
    sequence: 0,
    sceneActor: input.sceneActor,
    purpose: input.purpose,
    turnId: input.turnId,
    interruptId: input.interruptId,
  };
  let runtime = createCourtroomPresentationRuntime();
  runtime = reduceCourtroomPresentationRuntime(
    runtime,
    freezeHearingPerformanceEvent({
      type: "playback_requested",
      ...identity,
    }),
    10,
  );
  if (input.started ?? true) {
    runtime = reduceCourtroomPresentationRuntime(
      runtime,
      freezeHearingPerformanceEvent({
        type: "playback_started",
        ...identity,
      }),
      20,
    );
  }
  if (input.terminal) {
    runtime = reduceCourtroomPresentationRuntime(
      runtime,
      freezeHearingPerformanceEvent({
        type: "playback_terminal",
        ...identity,
        status: "completed",
        reason: "completed",
      }),
      30,
    );
  }
  return selectCourtroomPresentationRuntime(runtime, 30);
}

describe("audible courtroom semantic performance", () => {
  it("selects an exact started turn cue without exposing provenance", () => {
    const semantic = selectAudibleCourtroomSemanticPerformance(
      view(),
      snapshot({
        purpose: "testimony",
        turnId: "turn:answer",
        interruptId: null,
        actor: "actor.witness.local",
        sceneActor: "witness",
      }),
    );
    expect(semantic).toEqual({
      kind: "witness",
      emotion: "nervous",
      intensity: 0.62,
      delivery: "hesitant",
      gesture: "look_away",
      gazeTarget: "questioning_counsel",
    });
    expect(JSON.stringify(semantic)).not.toContain("call:witness");
    expect(JSON.stringify(semantic)).not.toContain("outputHash");
  });

  it("never applies a cue before audible start or across actor/turn fences", () => {
    const current = view();
    expect(
      selectAudibleCourtroomSemanticPerformance(
        current,
        snapshot({
          purpose: "testimony",
          turnId: "turn:answer",
          interruptId: null,
          actor: "actor.witness.local",
          sceneActor: "witness",
          started: false,
        }),
      ),
    ).toBeNull();
    expect(
      selectAudibleCourtroomSemanticPerformance(
        current,
        snapshot({
          purpose: "testimony",
          turnId: "turn:answer",
          interruptId: "interrupt:one",
          actor: "actor.witness.local",
          sceneActor: "witness",
        }),
      ),
    ).toBeNull();
    expect(
      selectAudibleCourtroomSemanticPerformance(
        current,
        snapshot({
          purpose: "testimony",
          turnId: "turn:other",
          interruptId: null,
          actor: "actor.witness.local",
          sceneActor: "witness",
        }),
      ),
    ).toBeNull();
    expect(
      selectAudibleCourtroomSemanticPerformance(
        current,
        snapshot({
          purpose: "testimony",
          turnId: "turn:answer",
          interruptId: null,
          actor: "actor.local.wrong-scene",
          sceneActor: "judge",
        }),
      ),
    ).toBeNull();
  });

  it("rejects stricken turns plus cross-trial and future cue heads", () => {
    const audible = snapshot({
      purpose: "testimony",
      turnId: "turn:answer",
      interruptId: null,
      actor: "actor.witness.local",
      sceneActor: "witness",
    });

    const stricken = view();
    const strickenTurn = stricken.transcript[0];
    if (strickenTurn === undefined) throw new Error("Missing fixture turn");
    strickenTurn.status = "stricken";
    expect(
      selectAudibleCourtroomSemanticPerformance(stricken, audible),
    ).toBeNull();

    const crossTrial = view();
    const crossTrialCue = crossTrial.transcript[0]?.semanticCue;
    if (crossTrialCue === null || crossTrialCue === undefined) {
      throw new Error("Missing fixture cue");
    }
    crossTrialCue.head.trialId = "trial:other";
    expect(
      selectAudibleCourtroomSemanticPerformance(crossTrial, audible),
    ).toBeNull();

    const future = view();
    const futureCue = future.transcript[0]?.semanticCue;
    if (futureCue === null || futureCue === undefined) {
      throw new Error("Missing fixture cue");
    }
    futureCue.head.stateVersion = future.trial.version + 1;
    expect(
      selectAudibleCourtroomSemanticPerformance(future, audible),
    ).toBeNull();
  });

  it("binds the current ruling cue only to its exact local interrupt", () => {
    const current = view();
    const exact = selectAudibleCourtroomSemanticPerformance(
      current,
      snapshot({
        purpose: "ruling",
        turnId: null,
        interruptId: "interrupt:one",
        actor: "actor.judge",
        sceneActor: "judge",
      }),
    );
    expect(exact).toMatchObject({
      kind: "role",
      gesture: "gavel",
      speakingStyle: "formal",
    });
    expect(JSON.stringify(exact)).not.toContain("activity");
    expect(
      selectAudibleCourtroomSemanticPerformance(
        current,
        snapshot({
          purpose: "ruling",
          turnId: null,
          interruptId: "interrupt:other",
          actor: "actor.judge",
          sceneActor: "judge",
        }),
      ),
    ).toBeNull();

    const staleHead = view();
    const staleRuling = staleHead.currentSemanticCue;
    if (staleRuling === null || staleRuling === undefined) {
      throw new Error("Missing fixture ruling");
    }
    staleRuling.head.lastEventId = "event:stale";
    expect(
      selectAudibleCourtroomSemanticPerformance(
        staleHead,
        snapshot({
          purpose: "ruling",
          turnId: null,
          interruptId: "interrupt:one",
          actor: "actor.judge",
          sceneActor: "judge",
        }),
      ),
    ).toBeNull();
  });

  it("retires semantic influence with terminal playback", () => {
    expect(
      selectAudibleCourtroomSemanticPerformance(
        view(),
        snapshot({
          purpose: "testimony",
          turnId: "turn:answer",
          interruptId: null,
          actor: "actor.witness.local",
          sceneActor: "witness",
          terminal: true,
        }),
      ),
    ).toBeNull();
  });
});
