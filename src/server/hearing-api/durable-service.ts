import { z } from "zod";

import { HearingCommandPreparationSchema } from "@/domain/hearing-runtime";
import { callConvexCaseService } from "@/server/case-api";

import type { CourtroomCommandDurableService } from "./courtroom-command";

const TerminalModelCallResponseSchema = z
  .object({
    callId: z.string().trim().min(1).max(240),
    attemptCount: z.number().int().nonnegative(),
    replayed: z.boolean(),
  })
  .strict();

/** Build the owner-bound durable adapter shared by protected hearing routes. */
export function createCourtroomCommandDurableService(input: Readonly<{
  ownerId: string;
  trialId: string;
}>): CourtroomCommandDurableService {
  const { ownerId, trialId } = input;
  return {
    prepare: async (command, signal) =>
      await callConvexCaseService({
        path: "/service/hearings/command/prepare",
        body: { ownerId, trialId, command },
        responseSchema: HearingCommandPreparationSchema,
        signal,
      }),
    commitWitness: async (generation, signal) =>
      await callConvexCaseService({
        path: "/service/hearings/command/commit",
        body: { ownerId, trialId, generation },
        responseSchema: HearingCommandPreparationSchema,
        signal,
      }),
    commitOpponentPlan: async (generation, signal) =>
      await callConvexCaseService({
        path: "/service/hearings/opponent-plan/commit",
        body: { ownerId, trialId, generation },
        responseSchema: HearingCommandPreparationSchema,
        signal,
      }),
    commitCounselResponse: async (generation, signal) =>
      await callConvexCaseService({
        path: "/service/hearings/counsel-response/commit",
        body: { ownerId, trialId, generation },
        responseSchema: HearingCommandPreparationSchema,
        signal,
      }),
    commitJudgeResponse: async (generation, signal) =>
      await callConvexCaseService({
        path: "/service/hearings/judge-response/commit",
        body: { ownerId, trialId, generation },
        responseSchema: HearingCommandPreparationSchema,
        signal,
      }),
    commitObjectionRuling: async (generation, signal) =>
      await callConvexCaseService({
        path: "/service/hearings/objection-ruling/commit",
        body: { ownerId, trialId, generation },
        responseSchema: HearingCommandPreparationSchema,
        signal,
      }),
    commitNegotiationDecision: async (generation, signal) =>
      await callConvexCaseService({
        path: "/service/hearings/negotiation/commit",
        body: { ownerId, trialId, generation },
        responseSchema: HearingCommandPreparationSchema,
        signal,
      }),
    commitJuryResponse: async (generation, signal) =>
      await callConvexCaseService({
        path: "/service/hearings/jury-response/commit",
        body: { ownerId, trialId, generation },
        responseSchema: HearingCommandPreparationSchema,
        signal,
      }),
    commitDebrief: async (generation, signal) =>
      await callConvexCaseService({
        path: "/service/hearings/debrief/commit",
        body: { ownerId, trialId, generation },
        responseSchema: HearingCommandPreparationSchema,
        signal,
      }),
    recordTerminalTrace: async (trace, signal) => {
      await callConvexCaseService({
        path: "/service/hearings/model-call/terminal",
        body: { ownerId, trialId, trace },
        responseSchema: TerminalModelCallResponseSchema,
        signal,
      });
    },
  };
}
