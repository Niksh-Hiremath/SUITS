import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  HEARING_PLAYER_COMMAND_SCHEMA_VERSION,
  HEARING_START_SCHEMA_VERSION,
  HearingCommandPreparationSchema,
  HearingRuntimeViewV1Schema,
  isHearingWitnessModelRequiredPreparation,
  type HearingCounselResponsePrecommit,
  type HearingCommandPreparation,
  type HearingDebriefGeneratorPrecommit,
  type HearingJuryResponsePrecommit,
  type HearingOpponentPlanPrecommit,
  type HearingPlayerIntent,
  type HearingRuntimeViewV1,
  type HearingWitnessGenerationPrecommit,
} from "@/domain/hearing-runtime";
import {
  callConvexCaseService,
  readConvexCaseServiceConfig,
} from "@/server/case-api";
import {
  orchestrateCourtroomCommand,
  type CourtroomCommandDurableService,
} from "@/server/hearing-api/courtroom-command";

import { EnvironmentCourtroomModelProvider } from "./environment-provider";

const liveDescribe =
  process.env.RUN_OPENAI_LIVE_COURTROOM === "1" ? describe : describe.skip;

const TerminalModelCallResponseSchema = z
  .object({
    callId: z.string().trim().min(1).max(240),
    attemptCount: z.number().int().nonnegative(),
    replayed: z.boolean(),
  })
  .strict();

function commandFor(
  view: HearingRuntimeViewV1,
  intent: HearingPlayerIntent,
) {
  return {
    schemaVersion: HEARING_PLAYER_COMMAND_SCHEMA_VERSION,
    requestId: crypto.randomUUID(),
    requestedAt: new Date().toISOString(),
    expectedStateVersion: view.trial.version,
    expectedLastEventId: view.trial.lastEventId,
    intent,
  } as const;
}

liveDescribe("live Luna courtroom runtime", () => {
  it(
    "completes a multi-role Luna/Terra trial through protected Convex boundaries",
    async () => {
      const config = readConvexCaseServiceConfig();
      const ownerId = `owner:${crypto.randomUUID()}`;
      const provider = new EnvironmentCourtroomModelProvider();
      const startRequest = {
        schemaVersion: HEARING_START_SCHEMA_VERSION,
        requestId: crypto.randomUUID(),
        requestedAt: new Date().toISOString(),
        case: {
          kind: "seeded" as const,
          slug: "redwood-signal-retaliation",
        },
        userSide: "user" as const,
      };
      let view = await callConvexCaseService({
        path: "/service/hearings/start",
        body: { ownerId, request: startRequest },
        responseSchema: HearingRuntimeViewV1Schema,
        config,
        timeoutMs: 120_000,
      });
      const trialId = view.trial.trialId;
      const captures: {
        preparation: HearingCommandPreparation | null;
        generation: HearingWitnessGenerationPrecommit | null;
        witnessCalls: HearingWitnessGenerationPrecommit[];
        opponentPlans: HearingOpponentPlanPrecommit[];
        counselResponses: HearingCounselResponsePrecommit[];
        juryResponses: HearingJuryResponsePrecommit[];
        debriefs: HearingDebriefGeneratorPrecommit[];
      } = {
        preparation: null,
        generation: null,
        witnessCalls: [],
        opponentPlans: [],
        counselResponses: [],
        juryResponses: [],
        debriefs: [],
      };
      const capturedPreparation = (): HearingCommandPreparation | null =>
        captures.preparation;
      const capturedGeneration =
        (): HearingWitnessGenerationPrecommit | null => captures.generation;
      const durableService: CourtroomCommandDurableService = {
        prepare: async (command, signal) => {
          const preparation = await callConvexCaseService({
            path: "/service/hearings/command/prepare",
            body: { ownerId, trialId, command },
            responseSchema: HearingCommandPreparationSchema,
            config,
            timeoutMs: 120_000,
            signal,
          });
          captures.preparation = preparation;
          return preparation;
        },
        commitWitness: async (generation, signal) => {
          captures.generation = generation;
          captures.witnessCalls.push(generation);
          return await callConvexCaseService({
            path: "/service/hearings/command/commit",
            body: { ownerId, trialId, generation },
            responseSchema: HearingCommandPreparationSchema,
            config,
            timeoutMs: 120_000,
            signal,
          });
        },
        commitOpponentPlan: async (generation, signal) => {
          captures.opponentPlans.push(generation);
          return await callConvexCaseService({
            path: "/service/hearings/opponent-plan/commit",
            body: { ownerId, trialId, generation },
            responseSchema: HearingCommandPreparationSchema,
            config,
            timeoutMs: 120_000,
            signal,
          });
        },
        commitCounselResponse: async (generation, signal) => {
          captures.counselResponses.push(generation);
          return await callConvexCaseService({
            path: "/service/hearings/counsel-response/commit",
            body: { ownerId, trialId, generation },
            responseSchema: HearingCommandPreparationSchema,
            config,
            timeoutMs: 120_000,
            signal,
          });
        },
        commitObjectionRuling: async (generation, signal) => {
          return await callConvexCaseService({
            path: "/service/hearings/objection-ruling/commit",
            body: { ownerId, trialId, generation },
            responseSchema: HearingCommandPreparationSchema,
            config,
            timeoutMs: 120_000,
            signal,
          });
        },
        commitNegotiationDecision: async (generation, signal) => {
          return await callConvexCaseService({
            path: "/service/hearings/negotiation/commit",
            body: { ownerId, trialId, generation },
            responseSchema: HearingCommandPreparationSchema,
            config,
            timeoutMs: 120_000,
            signal,
          });
        },
        commitJuryResponse: async (generation, signal) => {
          captures.juryResponses.push(generation);
          return await callConvexCaseService({
            path: "/service/hearings/jury-response/commit",
            body: { ownerId, trialId, generation },
            responseSchema: HearingCommandPreparationSchema,
            config,
            timeoutMs: 120_000,
            signal,
          });
        },
        commitDebrief: async (generation, signal) => {
          captures.debriefs.push(generation);
          return await callConvexCaseService({
            path: "/service/hearings/debrief/commit",
            body: { ownerId, trialId, generation },
            responseSchema: HearingCommandPreparationSchema,
            config,
            timeoutMs: 120_000,
            signal,
          });
        },
        recordTerminalTrace: async (trace, signal) => {
          await callConvexCaseService({
            path: "/service/hearings/model-call/terminal",
            body: { ownerId, trialId, trace },
            responseSchema: TerminalModelCallResponseSchema,
            config,
            timeoutMs: 120_000,
            signal,
          });
        },
      };

      const execute = async (intent: HearingPlayerIntent) => {
        const command = commandFor(view, intent);
        view = await orchestrateCourtroomCommand({
          command,
          provider,
          durableService,
        });
      };

      const witnessIds = ["witness_rina_shah", "witness_theo_morgan"];
      const acceptedCalls: HearingWitnessGenerationPrecommit[] = [];
      for (const witnessId of witnessIds) {
        await execute({ type: "call_witness", witnessId });
        expect(view.activeAppearance).toMatchObject({ witnessId });
        captures.preparation = null;
        captures.generation = null;
        await execute({
          type: "ask_question",
          witnessId,
          examinationKind: "direct",
          text:
            "Please describe one event you personally observed that matters to this fictional case.",
          presentedEvidenceIds: [],
        });
        const preparation = capturedPreparation();
        const generation = capturedGeneration();
        expect(preparation).toMatchObject({ status: "model_required" });
        expect(generation).not.toBeNull();
        if (
          preparation === null ||
          !isHearingWitnessModelRequiredPreparation(preparation) ||
          generation === null
        ) {
          throw new Error("Live witness generation did not reach commit");
        }
        expect(preparation.request.witnessId).toBe(witnessId);
        expect(preparation.request.knowledgeView.witness.witnessId).toBe(
          witnessId,
        );
        const permittedFactIds = new Set(
          preparation.request.knowledgeView.witness.facts.map(
            (fact) => fact.factId,
          ),
        );
        const permittedEvidenceIds = new Set([
          ...preparation.request.knowledgeView.witness.admittedSeenEvidence.map(
            (evidence) => evidence.evidenceId,
          ),
          ...preparation.request.knowledgeView.presentedEvidence.map(
            (evidence) => evidence.evidenceId,
          ),
        ]);
        expect(
          generation.output.segments.every((segment) =>
            segment.factIds.every((factId) => permittedFactIds.has(factId)),
          ),
        ).toBe(true);
        expect(
          generation.output.segments.every((segment) =>
            segment.evidenceIds.every((evidenceId) =>
              permittedEvidenceIds.has(evidenceId),
            ),
          ),
        ).toBe(true);
        expect(generation.trace).toMatchObject({
          status: "accepted",
          model: "gpt-5.6-luna",
          task: "witness_answer",
          actorRole: "witness",
        });
        expect(generation.trace.estimatedCostUsd).not.toBeNull();
        expect(generation.trace.usage?.totalTokens).toBeGreaterThan(0);
        acceptedCalls.push(generation);

        await execute({
          type: "finish_witness",
          witnessId,
          examinationKind: "direct",
        });
        expect(view.activeAppearance).toMatchObject({
          witnessId,
          stage: "redirect",
        });
        await execute({
          type: "finish_witness",
          witnessId,
          examinationKind: "redirect",
        });
        expect(view.activeAppearance).toBeNull();
      }

      await execute({
        type: "finish_trial",
        closingText:
          "The admitted testimony establishes the sequence and supports relief under the fictional instructions.",
      });
      expect(view.trial).toMatchObject({ phase: "complete", status: "complete" });
      expect(captures.juryResponses).toHaveLength(1);
      expect(captures.debriefs).toHaveLength(1);
      expect(captures.juryResponses[0]?.trace).toMatchObject({
        status: "accepted",
        model: "gpt-5.6-luna",
        task: "jury_deliberation",
        actorRole: "jury",
      });
      expect(captures.debriefs[0]?.trace).toMatchObject({
        status: "accepted",
        model: "gpt-5.6-terra",
        task: "generate_debrief",
        actorRole: "debrief",
      });
      expect(captures.juryResponses[0]?.trace.usage?.totalTokens).toBeGreaterThan(
        0,
      );
      expect(captures.debriefs[0]?.trace.usage?.totalTokens).toBeGreaterThan(0);
      expect(captures.debriefs[0]?.output.limitations.length).toBeGreaterThan(0);

      const reloaded = await callConvexCaseService({
        path: "/service/hearings/read",
        body: { ownerId, trialId },
        responseSchema: HearingRuntimeViewV1Schema,
        config,
        timeoutMs: 120_000,
      });
      expect(reloaded).toEqual(view);
      expect(
        new Set(
          reloaded.transcript
            .filter((turn) => turn.actor.role === "witness")
            .map((turn) => turn.actor.witnessId),
        ),
      ).toEqual(new Set(witnessIds));
      expect(new Set(acceptedCalls.map((call) => call.callId)).size).toBe(2);
      expect(captures.opponentPlans.length).toBeGreaterThanOrEqual(2);
      expect(captures.counselResponses.length).toBeGreaterThanOrEqual(2);
      expect(
        captures.opponentPlans.every(
          (generation) =>
            generation.trace.status === "accepted" &&
            generation.trace.model === "gpt-5.6-luna" &&
            generation.trace.task === "plan_opponent",
        ),
      ).toBe(true);
      expect(
        captures.counselResponses.every(
          (generation) =>
            generation.trace.status === "accepted" &&
            generation.trace.model === "gpt-5.6-luna" &&
            generation.trace.task === "counsel_response",
        ),
      ).toBe(true);
      expect(reloaded.trial).toMatchObject({ phase: "complete", status: "complete" });

      console.info("live_courtroom_complete_trial_smoke", {
        trialId,
        witnessIds,
        calls: acceptedCalls.map((call) => ({
          callId: call.callId,
          responseId: call.responseId,
          costUsd: call.trace.estimatedCostUsd,
          inputTokens: call.trace.usage?.inputTokens ?? null,
          outputTokens: call.trace.usage?.outputTokens ?? null,
          retries: call.trace.retryCount,
        })),
        opponentPlanCalls: captures.opponentPlans.map((call) => call.callId),
        counselResponseCalls: captures.counselResponses.map(
          (call) => call.callId,
        ),
        juryCall: captures.juryResponses[0]?.callId ?? null,
        debriefCall: captures.debriefs[0]?.callId ?? null,
        juryCostUsd: captures.juryResponses[0]?.trace.estimatedCostUsd ?? null,
        debriefCostUsd: captures.debriefs[0]?.trace.estimatedCostUsd ?? null,
      });
    },
    600_000,
  );
});
