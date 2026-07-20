import { z } from "zod";

import {
  computeCaseGraphContentHash,
  type CaseGraph,
} from "../domain/case-graph";
import {
  DEBRIEF_GENERATOR_OUTPUT_SCHEMA_VERSION,
  type DebriefCitationSet,
  type DebriefGeneratorModelOutput,
} from "../domain/courtroom-ai/call-contracts";
import {
  DEBRIEF_GENERATOR_REQUEST_SCHEMA_VERSION,
  DebriefGeneratorRequestSchema,
  validateDebriefGeneratorOutput,
} from "../domain/courtroom-ai/debrief-generator";
import { buildJuryRecord, buildKnowledgeView } from "../domain/knowledge";
import {
  getSeededCaseBySlug,
  listSeededCases,
} from "../domain/seeded-cases";
import {
  TRIAL_ACTION_SCHEMA_VERSION,
  TrialActionSchema,
  commitAction,
  createStartTrialAction,
  reduceTrial,
  type ActorRef,
  type TrialAction,
  type TrialActionByType,
  type TrialActionType,
  type TrialEvent,
  type TrialEventByType,
  type TrialState,
} from "../domain/trial-engine";
import type { TrialPolicyActorBindingInput } from "../domain/trial-policy";

export const V3_REPEATED_EVAL_RUN_COUNT = 10 as const;
export const V3_REPEATED_EVAL_PASS_THRESHOLD = 9 as const;
export const V3_EVAL_DRIVER_VERSION = "v3-scripted-replay-driver.v1" as const;

export const V3EvalInvariantNameSchema = z.enum([
  "trial_completion",
  "exact_double_replay",
  "jury_considerable_exclusion",
  "debrief_citation_admissibility",
  "knowledge_isolation",
  "event_trace_completeness",
]);
export type V3EvalInvariantName = z.infer<typeof V3EvalInvariantNameSchema>;

const INVARIANT_NAMES = V3EvalInvariantNameSchema.options;

const JsonEvidenceSchema = z
  .string()
  .min(2)
  .max(20_000)
  .refine((value) => {
    try {
      const parsed: unknown = JSON.parse(value);
      return typeof parsed === "object" && parsed !== null;
    } catch {
      return false;
    }
  }, "Invariant evidence must be a JSON object or array");

export const V3EvalInvariantEvidenceSchema = z
  .object({
    name: V3EvalInvariantNameSchema,
    passed: z.boolean(),
    summary: z.string().trim().min(1).max(500),
    evidenceJson: JsonEvidenceSchema,
  })
  .strict();
export type V3EvalInvariantEvidence = z.infer<
  typeof V3EvalInvariantEvidenceSchema
>;

export const V3EvalCaughtFailureSchema = z
  .object({
    code: z.literal("scenario_execution_failed"),
    errorName: z.string().trim().min(1).max(100),
    message: z.string().trim().min(1).max(500),
  })
  .strict();

export const V3EvalScenarioDescriptorSchema = z
  .object({
    scenarioId: z.string().regex(/^v3-eval\.[a-z0-9-]+\.v1$/),
    catalogId: z.string().trim().min(1).max(128),
    slug: z.string().regex(/^[a-z0-9-]+$/),
    caseId: z.string().trim().min(1).max(128),
    title: z.string().trim().min(1).max(500),
    caseGraphContentHash: z.string().regex(/^[a-f0-9]{64}$/),
    driverVersion: z.literal(V3_EVAL_DRIVER_VERSION),
  })
  .strict();
export type V3EvalScenarioDescriptor = z.infer<
  typeof V3EvalScenarioDescriptorSchema
>;

export const V3EvalRunResultSchema = z
  .object({
    schemaVersion: z.literal("v3-eval-run-result.v1"),
    runIndex: z.number().int().min(1).max(V3_REPEATED_EVAL_RUN_COUNT),
    seed: z.number().int().nonnegative(),
    scenarioId: z.string().regex(/^v3-eval\.[a-z0-9-]+\.v1$/),
    caseId: z.string().trim().min(1).max(128),
    driverVersion: z.literal(V3_EVAL_DRIVER_VERSION),
    status: z.enum(["passed", "failed"]),
    invariants: z.array(V3EvalInvariantEvidenceSchema).length(INVARIANT_NAMES.length),
    caughtFailure: V3EvalCaughtFailureSchema.nullable(),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.seed !== result.runIndex) {
      context.addIssue({
        code: "custom",
        path: ["seed"],
        message: "The deterministic seed must equal the bound run index",
      });
    }
    const names = result.invariants.map((invariant) => invariant.name);
    const uniqueNames = new Set(names);
    if (JSON.stringify(names) !== JSON.stringify(INVARIANT_NAMES)) {
      context.addIssue({
        code: "custom",
        path: ["invariants"],
        message: "Invariants must use the canonical deterministic order",
      });
    }
    for (const name of INVARIANT_NAMES) {
      if (!uniqueNames.has(name)) {
        context.addIssue({
          code: "custom",
          path: ["invariants"],
          message: `Missing invariant ${name}`,
        });
      }
    }
    if (uniqueNames.size !== INVARIANT_NAMES.length) {
      context.addIssue({
        code: "custom",
        path: ["invariants"],
        message: "Invariant names must be unique",
      });
    }
    const allPassed = result.invariants.every((invariant) => invariant.passed);
    const expectedStatus = allPassed && result.caughtFailure === null ? "passed" : "failed";
    if (result.status !== expectedStatus) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "Run status must match its invariant and caught-failure evidence",
      });
    }
    if (
      result.caughtFailure !== null &&
      result.invariants.some((invariant) => invariant.passed)
    ) {
      context.addIssue({
        code: "custom",
        path: ["invariants"],
        message: "A caught execution failure cannot report passing invariants",
      });
    }
  });
export type V3EvalRunResult = z.infer<typeof V3EvalRunResultSchema>;

export const V3RepeatedEvalGateResultSchema = z
  .object({
    schemaVersion: z.literal("v3-repeated-eval-gate-result.v1"),
    requiredRuns: z.literal(V3_REPEATED_EVAL_RUN_COUNT),
    passThreshold: z.literal(V3_REPEATED_EVAL_PASS_THRESHOLD),
    status: z.enum(["passed", "failed"]),
    passCount: z.number().int().min(0).max(V3_REPEATED_EVAL_RUN_COUNT),
    failureCount: z.number().int().min(0).max(V3_REPEATED_EVAL_RUN_COUNT),
    scenarioIds: z.array(z.string().regex(/^v3-eval\.[a-z0-9-]+\.v1$/)).min(2),
    runs: z.array(V3EvalRunResultSchema).length(V3_REPEATED_EVAL_RUN_COUNT),
  })
  .strict()
  .superRefine((gate, context) => {
    const passCount = gate.runs.filter((run) => run.status === "passed").length;
    const scenarioIds = [...new Set(gate.runs.map((run) => run.scenarioId))].sort();
    const runIndexes = [...gate.runs.map((run) => run.runIndex)].sort(
      (left, right) => left - right,
    );
    const expectedIndexes = Array.from(
      { length: V3_REPEATED_EVAL_RUN_COUNT },
      (_, index) => index + 1,
    );
    if (JSON.stringify(runIndexes) !== JSON.stringify(expectedIndexes)) {
      context.addIssue({
        code: "custom",
        path: ["runs"],
        message: "Gate runs must contain every index from 1 through 10 exactly once",
      });
    }
    if (gate.passCount !== passCount) {
      context.addIssue({
        code: "custom",
        path: ["passCount"],
        message: "passCount does not match the parsed runs",
      });
    }
    if (gate.failureCount !== V3_REPEATED_EVAL_RUN_COUNT - passCount) {
      context.addIssue({
        code: "custom",
        path: ["failureCount"],
        message: "failureCount does not match the parsed runs",
      });
    }
    if (gate.status !== (passCount >= V3_REPEATED_EVAL_PASS_THRESHOLD ? "passed" : "failed")) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "Gate status does not match the 9-of-10 threshold",
      });
    }
    if (JSON.stringify(gate.scenarioIds) !== JSON.stringify(scenarioIds)) {
      context.addIssue({
        code: "custom",
        path: ["scenarioIds"],
        message: "scenarioIds must be the sorted distinct run scenario IDs",
      });
    }
  });
export type V3RepeatedEvalGateResult = z.infer<
  typeof V3RepeatedEvalGateResultSchema
>;

function evidenceJson(value: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(value);
}

function invariant(
  name: V3EvalInvariantName,
  passed: boolean,
  summary: string,
  evidence: Readonly<Record<string, unknown>>,
): V3EvalInvariantEvidence {
  return V3EvalInvariantEvidenceSchema.parse({
    name,
    passed,
    summary,
    evidenceJson: evidenceJson(evidence),
  });
}

function sanitizeFailure(error: unknown) {
  const errorName = error instanceof Error ? error.name : "UnknownThrownValue";
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = rawMessage.replace(/\s+/g, " ").trim().slice(0, 500) || "Unknown scenario failure";
  return V3EvalCaughtFailureSchema.parse({
    code: "scenario_execution_failed",
    errorName,
    message,
  });
}

function failedInvariants(message: string): V3EvalInvariantEvidence[] {
  return INVARIANT_NAMES.map((name) =>
    invariant(name, false, "Scenario execution failed before invariant proof completed.", {
      failure: message,
    }),
  );
}

export const V3_EVAL_SCENARIOS: readonly V3EvalScenarioDescriptor[] = Object.freeze(
  listSeededCases().map((entry) => {
    const graph = getSeededCaseBySlug(entry.slug);
    if (!graph) throw new Error(`Missing seeded graph for ${entry.slug}`);
    return Object.freeze(
      V3EvalScenarioDescriptorSchema.parse({
        scenarioId: `v3-eval.${entry.slug}.v1`,
        catalogId: entry.catalogId,
        slug: entry.slug,
        caseId: entry.caseId,
        title: entry.title,
        caseGraphContentHash: computeCaseGraphContentHash(graph),
        driverVersion: V3_EVAL_DRIVER_VERSION,
      }),
    );
  }),
);

type EvalActors = Readonly<{
  system: ActorRef;
  judge: ActorRef;
  userCounsel: ActorRef;
  opposingCounsel: ActorRef;
  jury: ActorRef;
  debriefCoach: ActorRef;
  witnessById: ReadonlyMap<string, ActorRef>;
  all: readonly ActorRef[];
  bindings: readonly TrialPolicyActorBindingInput[];
}>;

function actorsFor(graph: CaseGraph): EvalActors {
  const system: ActorRef = {
    actorId: "eval_actor_system",
    role: "system",
    side: "neutral",
    witnessId: null,
  };
  const judge: ActorRef = {
    actorId: "eval_actor_judge",
    role: "judge",
    side: "neutral",
    witnessId: null,
  };
  const userCounsel: ActorRef = {
    actorId: "eval_actor_user_counsel",
    role: "user_counsel",
    side: "user",
    witnessId: null,
  };
  const opposingCounsel: ActorRef = {
    actorId: "eval_actor_opposing_counsel",
    role: "opposing_counsel",
    side: "opposing",
    witnessId: null,
  };
  const jury: ActorRef = {
    actorId: "eval_actor_jury",
    role: "jury",
    side: "neutral",
    witnessId: null,
  };
  const debriefCoach: ActorRef = {
    actorId: "eval_actor_debrief",
    role: "debrief_coach",
    side: "neutral",
    witnessId: null,
  };
  const partySideById = new Map(
    graph.parties.map((party) => [party.partyId, party.simulationSide]),
  );
  const witnessActors = graph.witnesses.map<ActorRef>((witness, index) => ({
    actorId: `eval_actor_witness_${String(index + 1).padStart(2, "0")}`,
    role: "witness",
    side:
      witness.alignedPartyId === null
        ? "neutral"
        : (partySideById.get(witness.alignedPartyId) ?? "neutral"),
    witnessId: witness.witnessId,
  }));
  const all = [
    system,
    judge,
    userCounsel,
    opposingCounsel,
    jury,
    debriefCoach,
    ...witnessActors,
  ];
  const bindings: TrialPolicyActorBindingInput[] = all.map((actor) => ({
    actor,
    representedPartyIds:
      actor.role === "user_counsel"
        ? graph.parties
            .filter((party) => party.simulationSide === "user")
            .map((party) => party.partyId)
        : actor.role === "opposing_counsel"
          ? graph.parties
              .filter((party) => party.simulationSide === "opposing")
              .map((party) => party.partyId)
          : [],
  }));
  return {
    system,
    judge,
    userCounsel,
    opposingCounsel,
    jury,
    debriefCoach,
    witnessById: new Map(
      witnessActors.map((actor) => [actor.witnessId as string, actor]),
    ),
    all,
    bindings,
  };
}

type EvalHarness = ReturnType<typeof createHarness>;

function createHarness(
  graph: CaseGraph,
  scenario: V3EvalScenarioDescriptor,
  runIndex: number,
  actors: EvalActors,
) {
  let state: TrialState | null = null;
  let identity = 0;
  const events: TrialEvent[] = [];
  const trialId = `eval_trial_${scenario.slug.replaceAll("-", "_")}_${runIndex}`;
  const baseTimeMs = Date.parse("2026-07-20T00:00:00.000Z") + runIndex * 1_000_000;

  function nextIdentity(type: string): { actionId: string; requestedAt: string } {
    identity += 1;
    return {
      actionId: `eval_${runIndex}_${String(identity).padStart(3, "0")}_${type.toLowerCase()}`,
      requestedAt: new Date(baseTimeMs + identity * 1_000).toISOString(),
    };
  }

  function start(): void {
    const result = commitAction(
      null,
      createStartTrialAction({
        trialId,
        ...nextIdentity("start_trial"),
        graph,
        actors: [...actors.all],
        actorBindings: actors.bindings,
      }),
    );
    state = result.state;
    events.push(result.event);
  }

  function draft<K extends TrialActionType>(
    type: K,
    payload: TrialActionByType<K>["payload"],
    actor: ActorRef,
  ): TrialAction {
    if (state === null) throw new Error("Eval trial must be started before drafting");
    const payloadRecord = payload as unknown as Record<string, unknown>;
    return TrialActionSchema.parse({
      schemaVersion: TRIAL_ACTION_SCHEMA_VERSION,
      ...nextIdentity(type),
      trialId,
      expectedStateVersion: state.version,
      actor,
      source: "deterministic",
      causationId: events.at(-1)?.eventId ?? null,
      correlationId: trialId,
      responseId:
        typeof payloadRecord.responseId === "string"
          ? payloadRecord.responseId
          : null,
      interruptId:
        typeof payloadRecord.interruptId === "string"
          ? payloadRecord.interruptId
          : null,
      modelMetadata: null,
      type,
      payload,
    });
  }

  function commit<K extends TrialActionType>(
    type: K,
    payload: TrialActionByType<K>["payload"],
    actor: ActorRef,
  ): TrialEventByType<K> {
    const result = commitAction(state, draft(type, payload, actor));
    state = result.state;
    events.push(result.event);
    return result.event as TrialEventByType<K>;
  }

  return {
    trialId,
    events,
    start,
    commit,
    get state(): TrialState {
      if (state === null) throw new Error("Eval trial has not started");
      return state;
    },
  };
}

type TestimonyProof = Readonly<{
  testimonyId: string;
  witnessId: string;
  evidenceIds: readonly string[];
}>;

function counselForSide(actors: EvalActors, side: "user" | "opposing"): ActorRef {
  return side === "user" ? actors.userCounsel : actors.opposingCounsel;
}

function callingSideForWitness(
  graph: CaseGraph,
  witness: CaseGraph["witnesses"][number],
): "user" | "opposing" {
  const parties = new Map(graph.parties.map((party) => [party.partyId, party]));
  const alignedSide = witness.alignedPartyId
    ? parties.get(witness.alignedPartyId)?.simulationSide
    : undefined;
  if (
    (alignedSide === "user" || alignedSide === "opposing") &&
    witness.callableByPartyIds.some(
      (partyId) => parties.get(partyId)?.simulationSide === alignedSide,
    )
  ) {
    return alignedSide;
  }
  const callableSide = witness.callableByPartyIds
    .map((partyId) => parties.get(partyId)?.simulationSide)
    .find((side): side is "user" | "opposing" =>
      side === "user" || side === "opposing",
    );
  if (!callableSide) {
    throw new Error(`No user/opposing caller is permitted for ${witness.witnessId}`);
  }
  return callableSide;
}

function askAndAnswer(
  harness: EvalHarness,
  actors: EvalActors,
  input: Readonly<{
    id: string;
    witnessId: string;
    counsel: ActorRef;
    examinationKind: "direct" | "cross";
    factIds: readonly string[];
    evidenceIds: readonly string[];
  }>,
): string {
  const witnessActor = actors.witnessById.get(input.witnessId);
  if (!witnessActor) throw new Error(`Missing eval witness actor for ${input.witnessId}`);
  const questionId = `eval_question_${input.id}`;
  const responseId = `eval_response_${input.id}`;
  const testimonyId = `eval_testimony_${input.id}`;
  harness.commit(
    "ASK_QUESTION",
    {
      questionId,
      witnessId: input.witnessId,
      examinationKind: input.examinationKind,
      text: `Please describe the record within your personal knowledge for ${input.id}.`,
      turnId: `eval_turn_question_${input.id}`,
      presentedEvidenceIds: [...input.evidenceIds],
    },
    input.counsel,
  );
  harness.commit(
    "REQUEST_RESPONSE",
    {
      responseId,
      actorId: witnessActor.actorId,
      purpose: "answer_question",
    },
    actors.system,
  );
  harness.commit(
    "ANSWER_QUESTION",
    {
      responseId,
      questionId,
      witnessId: input.witnessId,
      testimonyId,
      turnId: `eval_turn_answer_${input.id}`,
      text: `This deterministic answer is limited to ${input.witnessId}'s scoped knowledge.`,
      factIds: [...input.factIds],
      evidenceIds: [...input.evidenceIds],
    },
    witnessActor,
  );
  return testimonyId;
}

function endExamination(
  harness: EvalHarness,
  witnessId: string,
  examinationKind: "direct" | "cross" | "redirect",
  counsel: ActorRef,
  disposition: "completed" | "waived" = "completed",
): void {
  harness.commit(
    "END_EXAMINATION",
    { witnessId, examinationKind, disposition },
    counsel,
  );
}

function emptyTrialCitations() {
  return {
    factIds: [],
    evidenceIds: [],
    testimonyIds: [],
    eventIds: [],
    sourceSegmentIds: [],
  };
}

function runWitnesses(
  harness: EvalHarness,
  graph: CaseGraph,
  actors: EvalActors,
): Readonly<{
  directProofs: readonly TestimonyProof[];
  strickenTestimonyId: string;
}> {
  const directProofs: TestimonyProof[] = [];
  let strickenTestimonyId: string | null = null;

  graph.witnesses.forEach((witness, index) => {
    const callingSide = callingSideForWitness(graph, witness);
    const callingCounsel = counselForSide(actors, callingSide);
    const crossingCounsel = counselForSide(
      actors,
      callingSide === "user" ? "opposing" : "user",
    );
    harness.commit(
      "CALL_WITNESS",
      { witnessId: witness.witnessId, calledBySide: callingSide },
      callingCounsel,
    );
    harness.commit(
      "SWEAR_WITNESS",
      { witnessId: witness.witnessId },
      actors.judge,
    );
    const directEvidenceIds = [...witness.knowledgeBoundary.seenEvidenceIds];
    const directTestimonyId = askAndAnswer(harness, actors, {
      id: `${index + 1}_direct`,
      witnessId: witness.witnessId,
      counsel: callingCounsel,
      examinationKind: "direct",
      factIds: witness.knowledgeBoundary.knownFactIds,
      evidenceIds: directEvidenceIds,
    });
    directProofs.push({
      testimonyId: directTestimonyId,
      witnessId: witness.witnessId,
      evidenceIds: directEvidenceIds,
    });
    endExamination(harness, witness.witnessId, "direct", callingCounsel);

    const crossTestimonyId = askAndAnswer(harness, actors, {
      id: `${index + 1}_cross`,
      witnessId: witness.witnessId,
      counsel: crossingCounsel,
      examinationKind: "cross",
      factIds: [],
      evidenceIds: [],
    });
    if (index === 0) {
      const motionId = "eval_motion_strike_first_cross";
      harness.commit(
        "MOVE_TO_STRIKE",
        {
          motionId,
          testimonyIds: [crossTestimonyId],
          reason: "The deterministic cross answer is excluded from jury consideration.",
        },
        callingCounsel,
      );
      harness.commit(
        "STRIKE_TESTIMONY",
        { motionId, testimonyIds: [crossTestimonyId], factIds: [] },
        actors.judge,
      );
      strickenTestimonyId = crossTestimonyId;
    }
    endExamination(harness, witness.witnessId, "cross", crossingCounsel);
    endExamination(
      harness,
      witness.witnessId,
      "redirect",
      callingCounsel,
      "waived",
    );
    harness.commit(
      "RELEASE_WITNESS",
      { witnessId: witness.witnessId },
      callingCounsel,
    );
  });

  if (strickenTestimonyId === null) {
    throw new Error("Eval scenario requires at least one witness");
  }
  return { directProofs, strickenTestimonyId };
}

type EvidenceProof = Readonly<{
  evidenceId: string;
  offeredBySide: "user" | "opposing";
  foundationTestimonyId: string;
}>;

function evidenceProofs(
  graph: CaseGraph,
  directProofs: readonly TestimonyProof[],
): readonly [EvidenceProof, EvidenceProof] {
  const proofByWitness = new Map(
    directProofs.map((proof) => [proof.witnessId, proof]),
  );
  const partyById = new Map(graph.parties.map((party) => [party.partyId, party]));
  const candidates = graph.evidence.flatMap((evidence) => {
    const foundation = evidence.authenticatingWitnessIds
      .map((witnessId) => proofByWitness.get(witnessId))
      .find((proof) => proof?.evidenceIds.includes(evidence.evidenceId));
    const side = evidence.offeredByPartyIds
      .map((partyId) => partyById.get(partyId)?.simulationSide)
      .find((candidate): candidate is "user" | "opposing" =>
        candidate === "user" || candidate === "opposing",
      );
    return foundation && side
      ? [{
          evidenceId: evidence.evidenceId,
          offeredBySide: side,
          foundationTestimonyId: foundation.testimonyId,
        }]
      : [];
  });
  if (candidates.length < 2) {
    throw new Error(`Case ${graph.caseId} lacks two authenticated offerable exhibits`);
  }
  return [candidates[0], candidates[1]];
}

function offerAndRuleEvidence(
  harness: EvalHarness,
  actors: EvalActors,
  proof: EvidenceProof,
  ruling: "admitted" | "excluded",
): void {
  const counsel = counselForSide(actors, proof.offeredBySide);
  harness.commit(
    "OFFER_EVIDENCE",
    {
      evidenceId: proof.evidenceId,
      offeredBySide: proof.offeredBySide,
      foundationTestimonyIds: [proof.foundationTestimonyId],
    },
    counsel,
  );
  harness.commit(
    "RULE_ON_EVIDENCE",
    {
      evidenceId: proof.evidenceId,
      ruling,
      reason:
        ruling === "admitted"
          ? "The scripted foundation authenticates this exhibit."
          : "The exhibit is excluded for this deterministic evaluation.",
    },
    actors.judge,
  );
}

function completeTrial(
  harness: EvalHarness,
  graph: CaseGraph,
  actors: EvalActors,
  admittedEvidenceId: string,
  activeTestimonyId: string,
): Readonly<{ userClosingTurnId: string; opposingClosingTurnId: string }> {
  harness.commit("REST_CASE", { side: "user" }, actors.userCounsel);
  harness.commit("REST_CASE", { side: "opposing" }, actors.opposingCounsel);
  harness.commit("BEGIN_PHASE", { phase: "pre_closing" }, actors.judge);
  harness.commit("BEGIN_PHASE", { phase: "closing" }, actors.judge);
  const citations = {
    ...emptyTrialCitations(),
    evidenceIds: [admittedEvidenceId],
    testimonyIds: [activeTestimonyId],
  };
  const userClosingTurnId = "eval_turn_closing_user";
  const opposingClosingTurnId = "eval_turn_closing_opposing";
  harness.commit(
    "GIVE_CLOSING",
    {
      side: "user",
      turnId: userClosingTurnId,
      text: "The jury-considerable record supports the user's position.",
      citations,
    },
    actors.userCounsel,
  );
  harness.commit(
    "GIVE_CLOSING",
    {
      side: "opposing",
      turnId: opposingClosingTurnId,
      text: "The jury-considerable record also permits the opposing inference.",
      citations,
    },
    actors.opposingCounsel,
  );
  harness.commit("BEGIN_PHASE", { phase: "jury_instructions" }, actors.judge);
  harness.commit(
    "INSTRUCT_JURY",
    { instructionIds: [graph.juryInstructions[0].instructionId] },
    actors.judge,
  );
  harness.commit("BEGIN_PHASE", { phase: "deliberation" }, actors.judge);
  harness.commit("DELIBERATE", {}, actors.jury);
  harness.commit("BEGIN_PHASE", { phase: "verdict" }, actors.judge);
  harness.commit(
    "RENDER_VERDICT",
    {
      verdictId: "eval_verdict",
      decision: "The jury returns a fictional educational verdict on the admitted record.",
      citations,
    },
    actors.judge,
  );
  harness.commit("BEGIN_PHASE", { phase: "debrief" }, actors.judge);
  harness.commit(
    "GENERATE_DEBRIEF",
    { debriefId: "eval_debrief" },
    actors.debriefCoach,
  );
  harness.commit("BEGIN_PHASE", { phase: "complete" }, actors.judge);
  return { userClosingTurnId, opposingClosingTurnId };
}

function emptyDebriefCitations(): DebriefCitationSet {
  return {
    admittedFactIds: [],
    admittedEvidenceIds: [],
    activeTestimonyIds: [],
    transcriptTurnIds: [],
    unadmittedFactIds: [],
    unadmittedEvidenceIds: [],
    excludedFactIds: [],
    excludedEvidenceIds: [],
    strickenTestimonyIds: [],
    hiddenFactIds: [],
    hiddenSourceSegmentIds: [],
    coachingInferenceIds: [],
  };
}

function debriefEvidence(
  harness: EvalHarness,
  graph: CaseGraph,
  actors: EvalActors,
  admittedEvidenceId: string,
  excludedEvidenceId: string,
  activeTestimonyId: string,
  closingTurnIds: readonly [string, string],
): Readonly<{
  validAccepted: boolean;
  excludedAsAdmittedRejected: boolean;
  rejectionCodes: readonly string[];
}> {
  const knowledgeView = buildKnowledgeView(
    { trial: harness.state, caseGraph: graph },
    actors.debriefCoach.actorId,
  );
  if (knowledgeView.actorRole !== "debrief") {
    throw new Error("Debrief actor received the wrong KnowledgeView variant");
  }
  const verdictEvent = harness.events.find(
    (event): event is TrialEventByType<"RENDER_VERDICT"> =>
      event.type === "RENDER_VERDICT",
  );
  if (!verdictEvent) throw new Error("Completed eval trial has no verdict event");
  const request = DebriefGeneratorRequestSchema.parse({
    schemaVersion: DEBRIEF_GENERATOR_REQUEST_SCHEMA_VERSION,
    callId: `eval_debrief_call_${harness.trialId}`,
    trialId: harness.trialId,
    expectedStateVersion: harness.state.version,
    expectedLastEventId: harness.events.at(-1)?.eventId,
    actorId: actors.debriefCoach.actorId,
    knowledgeView,
    transcript: harness.state.transcriptTurnIds.map((turnId) => {
      const turn = harness.state.transcriptTurns[turnId];
      return {
        turnId: turn.turnId,
        actorId: turn.actor.actorId,
        actorRole: turn.actor.role,
        text: turn.text,
        testimonyId: turn.testimonyId,
        status: turn.status,
        sourceEventId: turn.sourceEventId,
        citations: turn.citations,
      };
    }),
    procedure: {
      objections: [],
      settlementOffers: [],
      closingTurnIds: [...closingTurnIds],
      restedSides: [...harness.state.restedSides],
      deliberated: harness.state.deliberated,
      verdict: {
        verdictId: verdictEvent.payload.verdictId,
        decision: verdictEvent.payload.decision,
        sourceEventId: verdictEvent.eventId,
        citations: verdictEvent.payload.citations,
      },
    },
  });
  const proofCitations: DebriefCitationSet = {
    ...emptyDebriefCitations(),
    admittedEvidenceIds: [admittedEvidenceId],
    activeTestimonyIds: [activeTestimonyId],
  };
  const output: DebriefGeneratorModelOutput = {
    schemaVersion: DEBRIEF_GENERATOR_OUTPUT_SCHEMA_VERSION,
    overallAssessment: {
      text: "The advocacy stayed tied to the admitted record.",
      basis: "admitted_record",
      citations: proofCitations,
    },
    strengths: [
      {
        title: "Grounded record use",
        assessment: "The closing used admitted proof.",
        recommendation: "Continue distinguishing proof from historical audit material.",
        basis: "admitted_record",
        citations: proofCitations,
      },
    ],
    weakQuestions: [],
    missedEvidence: [],
    contradictions: [],
    objectionAccuracy: [],
    witnessStrategy: [],
    settlementChoices: [],
    juryMovement: [],
    improvedClosing: {
      segments: [
        {
          text: "The admitted exhibit and active testimony establish the jury-considerable case.",
          citations: proofCitations,
        },
      ],
    },
    limitations: ["This deterministic replay does not substitute for live-model quality evidence."],
  };
  const valid = validateDebriefGeneratorOutput(request, output);
  const tampered: DebriefGeneratorModelOutput = {
    ...output,
    overallAssessment: {
      ...output.overallAssessment,
      citations: {
        ...proofCitations,
        admittedEvidenceIds: [excludedEvidenceId],
      },
    },
  };
  const invalid = validateDebriefGeneratorOutput(request, tampered);
  return {
    validAccepted: valid.accepted,
    excludedAsAdmittedRejected: !invalid.accepted,
    rejectionCodes: invalid.accepted
      ? []
      : invalid.report.issues.map((issue) => issue.code),
  };
}

function knowledgeIsolationEvidence(
  state: TrialState,
  graph: CaseGraph,
  actors: EvalActors,
): Readonly<{
  passed: boolean;
  checkedWitnesses: number;
  mismatches: readonly string[];
}> {
  const admittedEvidenceIds = new Set(
    Object.values(state.evidence)
      .filter((evidence) => evidence.status === "admitted")
      .map((evidence) => evidence.evidenceId),
  );
  const mismatches: string[] = [];
  for (const witness of graph.witnesses) {
    const actor = actors.witnessById.get(witness.witnessId);
    if (!actor) {
      mismatches.push(`${witness.witnessId}:missing_actor`);
      continue;
    }
    const view = buildKnowledgeView({ trial: state, caseGraph: graph }, actor.actorId);
    if (view.actorRole !== "witness") {
      mismatches.push(`${witness.witnessId}:wrong_view`);
      continue;
    }
    const expectedFacts = [...witness.knowledgeBoundary.knownFactIds].sort();
    const actualFacts = view.witness.facts.map((fact) => fact.factId).sort();
    const expectedEvidence = witness.knowledgeBoundary.seenEvidenceIds
      .filter((evidenceId) => admittedEvidenceIds.has(evidenceId))
      .sort();
    const actualEvidence = view.witness.admittedSeenEvidence
      .map((evidence) => evidence.evidenceId)
      .sort();
    const exposedUnknown = witness.knowledgeBoundary.unknownFactIds.filter(
      (factId) => actualFacts.includes(factId),
    );
    if (JSON.stringify(actualFacts) !== JSON.stringify(expectedFacts)) {
      mismatches.push(`${witness.witnessId}:fact_scope`);
    }
    if (JSON.stringify(actualEvidence) !== JSON.stringify(expectedEvidence)) {
      mismatches.push(`${witness.witnessId}:evidence_scope`);
    }
    if (exposedUnknown.length > 0) {
      mismatches.push(`${witness.witnessId}:unknown_fact_exposed`);
    }
    if (view.publicRecord.testimony.length > 0 || view.publicRecord.instructions.length > 0) {
      mismatches.push(`${witness.witnessId}:unscoped_public_record`);
    }
  }
  return {
    passed: mismatches.length === 0,
    checkedWitnesses: graph.witnesses.length,
    mismatches,
  };
}

function traceCompletenessEvidence(events: readonly TrialEvent[]) {
  const incompleteEventIds: string[] = [];
  events.forEach((event, index) => {
    const previousEventId = index === 0 ? null : events[index - 1].eventId;
    const citations = event.citations;
    const complete =
      event.sequence === index + 1 &&
      event.stateVersion === index + 1 &&
      event.eventId === `event:${event.actionId}` &&
      event.causationId === previousEventId &&
      event.correlationId === event.trialId &&
      Number.isFinite(Date.parse(event.occurredAt)) &&
      typeof event.actor.actorId === "string" &&
      event.actor.actorId.length > 0 &&
      typeof event.source === "string" &&
      Array.isArray(citations.factIds) &&
      Array.isArray(citations.evidenceIds) &&
      Array.isArray(citations.testimonyIds) &&
      Array.isArray(citations.eventIds) &&
      Array.isArray(citations.sourceSegmentIds);
    if (!complete) incompleteEventIds.push(event.eventId);
  });
  return {
    passed: incompleteEventIds.length === 0,
    eventCount: events.length,
    incompleteEventIds,
  };
}

export function executeV3EvalScenario(
  scenarioInput: V3EvalScenarioDescriptor,
  runIndex: number,
): V3EvalRunResult {
  const scenario = V3EvalScenarioDescriptorSchema.parse(scenarioInput);
  const parsedRunIndex = z
    .number()
    .int()
    .min(1)
    .max(V3_REPEATED_EVAL_RUN_COUNT)
    .parse(runIndex);
  const graph = getSeededCaseBySlug(scenario.slug);
  if (!graph) throw new Error(`Unknown seeded eval scenario ${scenario.slug}`);
  if (
    graph.caseId !== scenario.caseId ||
    computeCaseGraphContentHash(graph) !== scenario.caseGraphContentHash
  ) {
    throw new Error(`Seeded scenario descriptor drifted for ${scenario.scenarioId}`);
  }
  const actors = actorsFor(graph);
  const harness = createHarness(graph, scenario, parsedRunIndex, actors);
  harness.start();
  harness.commit("BEGIN_PHASE", { phase: "case_in_chief" }, actors.judge);
  const witnessResult = runWitnesses(harness, graph, actors);
  const [admittedProof, excludedProof] = evidenceProofs(
    graph,
    witnessResult.directProofs,
  );
  offerAndRuleEvidence(harness, actors, admittedProof, "admitted");
  offerAndRuleEvidence(harness, actors, excludedProof, "excluded");
  const closing = completeTrial(
    harness,
    graph,
    actors,
    admittedProof.evidenceId,
    admittedProof.foundationTestimonyId,
  );

  const finalState = harness.state;
  const firstReplay = reduceTrial(harness.events);
  const secondReplay = reduceTrial(
    JSON.parse(JSON.stringify(harness.events)) as unknown[],
  );
  const finalJson = JSON.stringify(finalState);
  const firstReplayJson = JSON.stringify(firstReplay);
  const secondReplayJson = JSON.stringify(secondReplay);
  const juryRecord = buildJuryRecord({ trial: finalState, caseGraph: graph });
  const juryEvidenceIds = juryRecord.evidence.map((evidence) => evidence.evidenceId);
  const juryTestimonyIds = juryRecord.testimony.map(
    (testimony) => testimony.testimonyId,
  );
  const juryEmbeddedEvidenceIds = juryRecord.testimony.flatMap(
    (testimony) => testimony.evidenceIds,
  );
  const debrief = debriefEvidence(
    harness,
    graph,
    actors,
    admittedProof.evidenceId,
    excludedProof.evidenceId,
    admittedProof.foundationTestimonyId,
    [closing.userClosingTurnId, closing.opposingClosingTurnId],
  );
  const isolation = knowledgeIsolationEvidence(finalState, graph, actors);
  const traces = traceCompletenessEvidence(harness.events);
  const completionPassed =
    finalState.phase === "complete" &&
    finalState.status === "complete" &&
    finalState.activeWitnessId === null &&
    finalState.activeAppearanceId === null &&
    finalState.verdictId === "eval_verdict" &&
    finalState.debriefId === "eval_debrief" &&
    finalState.restedSides.includes("user") &&
    finalState.restedSides.includes("opposing");
  const replayPassed =
    finalJson === firstReplayJson &&
    firstReplayJson === secondReplayJson;
  const juryExclusionPassed =
    juryEvidenceIds.includes(admittedProof.evidenceId) &&
    !juryEvidenceIds.includes(excludedProof.evidenceId) &&
    !juryEmbeddedEvidenceIds.includes(excludedProof.evidenceId) &&
    !juryTestimonyIds.includes(witnessResult.strickenTestimonyId) &&
    juryTestimonyIds.includes(admittedProof.foundationTestimonyId);
  const debriefPassed =
    debrief.validAccepted &&
    debrief.excludedAsAdmittedRejected &&
    debrief.rejectionCodes.includes("citation_outside_audit");

  const invariants = [
    invariant(
      "trial_completion",
      completionPassed,
      "The pure V3 engine reached a closed, verdict-and-debrief-complete trial.",
      {
        phase: finalState.phase,
        status: finalState.status,
        eventCount: harness.events.length,
        witnessCount: graph.witnesses.length,
        restedSides: finalState.restedSides,
      },
    ),
    invariant(
      "exact_double_replay",
      replayPassed,
      "Two independent reductions, including one JSON round trip, equal the committed state byte-for-byte.",
      {
        firstReplayEqual: finalJson === firstReplayJson,
        secondReplayEqual: firstReplayJson === secondReplayJson,
        stateVersion: finalState.version,
        lastEventId: harness.events.at(-1)?.eventId ?? null,
      },
    ),
    invariant(
      "jury_considerable_exclusion",
      juryExclusionPassed,
      "The jury record includes admitted proof while excluding the ruled-out exhibit and stricken testimony.",
      {
        admittedEvidenceId: admittedProof.evidenceId,
        excludedEvidenceId: excludedProof.evidenceId,
        strickenTestimonyId: witnessResult.strickenTestimonyId,
        juryEvidenceIds,
        juryTestimonyCount: juryTestimonyIds.length,
      },
    ),
    invariant(
      "debrief_citation_admissibility",
      debriefPassed,
      "A grounded debrief validates and the same claim relabeled with excluded evidence is rejected.",
      {
        validAccepted: debrief.validAccepted,
        excludedAsAdmittedRejected: debrief.excludedAsAdmittedRejected,
        rejectionCodes: debrief.rejectionCodes,
      },
    ),
    invariant(
      "knowledge_isolation",
      isolation.passed,
      "Every witness view exactly matches authored fact/evidence boundaries and omits other testimony.",
      {
        checkedWitnesses: isolation.checkedWitnesses,
        mismatches: isolation.mismatches,
      },
    ),
    invariant(
      "event_trace_completeness",
      traces.passed,
      "Every event has contiguous sequence/version, stable identity, causation, correlation, actor, source, time, and citation fields.",
      {
        eventCount: traces.eventCount,
        incompleteEventIds: traces.incompleteEventIds,
      },
    ),
  ];
  const status = invariants.every((entry) => entry.passed) ? "passed" : "failed";
  return V3EvalRunResultSchema.parse({
    schemaVersion: "v3-eval-run-result.v1",
    runIndex: parsedRunIndex,
    seed: parsedRunIndex,
    scenarioId: scenario.scenarioId,
    caseId: scenario.caseId,
    driverVersion: scenario.driverVersion,
    status,
    invariants,
    caughtFailure: null,
  });
}

export type V3EvalScenarioExecutor = (
  scenario: V3EvalScenarioDescriptor,
  runIndex: number,
) => V3EvalRunResult;

export function runV3EvalScenarioSafely(
  scenarioInput: V3EvalScenarioDescriptor,
  runIndex: number,
  executor: V3EvalScenarioExecutor = executeV3EvalScenario,
): V3EvalRunResult {
  const scenario = V3EvalScenarioDescriptorSchema.parse(scenarioInput);
  const parsedRunIndex = z
    .number()
    .int()
    .min(1)
    .max(V3_REPEATED_EVAL_RUN_COUNT)
    .parse(runIndex);
  try {
    const result = V3EvalRunResultSchema.parse(
      executor(scenario, parsedRunIndex),
    );
    if (
      result.runIndex !== parsedRunIndex ||
      result.seed !== parsedRunIndex ||
      result.scenarioId !== scenario.scenarioId ||
      result.caseId !== scenario.caseId ||
      result.driverVersion !== scenario.driverVersion
    ) {
      throw new Error("Scenario executor returned a result outside its requested binding");
    }
    return result;
  } catch (error) {
    const failure = sanitizeFailure(error);
    return V3EvalRunResultSchema.parse({
      schemaVersion: "v3-eval-run-result.v1",
      runIndex: parsedRunIndex,
      seed: parsedRunIndex,
      scenarioId: scenario.scenarioId,
      caseId: scenario.caseId,
      driverVersion: scenario.driverVersion,
      status: "failed",
      invariants: failedInvariants(failure.message),
      caughtFailure: failure,
    });
  }
}

export function aggregateV3RepeatedEvalGate(
  runInputs: readonly V3EvalRunResult[],
): V3RepeatedEvalGateResult {
  const runs = z
    .array(V3EvalRunResultSchema)
    .length(V3_REPEATED_EVAL_RUN_COUNT)
    .parse(runInputs);
  const orderedRuns = [...runs].sort((left, right) => left.runIndex - right.runIndex);
  const passCount = orderedRuns.filter((run) => run.status === "passed").length;
  const scenarioIds = [...new Set(orderedRuns.map((run) => run.scenarioId))].sort();
  return V3RepeatedEvalGateResultSchema.parse({
    schemaVersion: "v3-repeated-eval-gate-result.v1",
    requiredRuns: V3_REPEATED_EVAL_RUN_COUNT,
    passThreshold: V3_REPEATED_EVAL_PASS_THRESHOLD,
    status: passCount >= V3_REPEATED_EVAL_PASS_THRESHOLD ? "passed" : "failed",
    passCount,
    failureCount: V3_REPEATED_EVAL_RUN_COUNT - passCount,
    scenarioIds,
    runs: orderedRuns,
  });
}

export function runV3RepeatedEvalGate(
  scenarios: readonly V3EvalScenarioDescriptor[] = V3_EVAL_SCENARIOS,
): V3RepeatedEvalGateResult {
  const parsedScenarios = z
    .array(V3EvalScenarioDescriptorSchema)
    .min(2)
    .parse(scenarios);
  const runs = Array.from(
    { length: V3_REPEATED_EVAL_RUN_COUNT },
    (_, index) => {
      const runIndex = index + 1;
      const scenario = parsedScenarios[index % parsedScenarios.length];
      return runV3EvalScenarioSafely(scenario, runIndex);
    },
  );
  return aggregateV3RepeatedEvalGate(runs);
}
