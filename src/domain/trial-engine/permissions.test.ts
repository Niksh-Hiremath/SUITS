import { describe, expect, it } from "vitest";

import {
  ActorRoleSchema,
  TRIAL_ACTION_TYPES,
  type ActorRole,
  type TrialActionType,
} from "./schemas";
import {
  TRIAL_ACTION_PERMISSION_MATRIX,
  allowedActionsForActor,
  allowedActorRolesForAction,
  isActionAllowedForActor,
} from "./permissions";

const EXPECTED_ACTIONS_BY_ACTOR = {
  user_counsel: [
    "CALL_WITNESS",
    "ASK_QUESTION",
    "END_EXAMINATION",
    "RECALL_WITNESS",
    "RELEASE_WITNESS",
    "OBJECT",
    "REPHRASE_QUESTION",
    "MOVE_TO_STRIKE",
    "OFFER_EVIDENCE",
    "WITHDRAW_EVIDENCE",
    "PROPOSE_ASSERTION",
    "DISPUTE_ASSERTION",
    "BEGIN_INTERRUPTION",
    "PROPOSE_SETTLEMENT",
    "COUNTER_SETTLEMENT",
    "ACCEPT_SETTLEMENT",
    "REJECT_SETTLEMENT",
    "WITHDRAW_SETTLEMENT",
    "REST_CASE",
    "GIVE_CLOSING",
  ],
  opposing_counsel: [
    "CALL_WITNESS",
    "ASK_QUESTION",
    "END_EXAMINATION",
    "RECALL_WITNESS",
    "RELEASE_WITNESS",
    "OBJECT",
    "REPHRASE_QUESTION",
    "MOVE_TO_STRIKE",
    "OFFER_EVIDENCE",
    "WITHDRAW_EVIDENCE",
    "PROPOSE_ASSERTION",
    "DISPUTE_ASSERTION",
    "BEGIN_INTERRUPTION",
    "PROPOSE_SETTLEMENT",
    "COUNTER_SETTLEMENT",
    "ACCEPT_SETTLEMENT",
    "REJECT_SETTLEMENT",
    "WITHDRAW_SETTLEMENT",
    "REST_CASE",
    "GIVE_CLOSING",
  ],
  judge: [
    "BEGIN_PHASE",
    "SWEAR_WITNESS",
    "RULE_ON_OBJECTION",
    "STRIKE_TESTIMONY",
    "RULE_ON_EVIDENCE",
    "REVEAL_HIDDEN_FACT",
    "VERIFY_ASSERTION",
    "RULE_ON_ASSERTION",
    "RESOLVE_INTERRUPTION",
    "PAUSE_TRIAL",
    "REQUEST_RECESS",
    "RESUME_TRIAL",
    "INSTRUCT_JURY",
    "RENDER_VERDICT",
  ],
  witness: ["ANSWER_QUESTION"],
  clerk: ["SWEAR_WITNESS"],
  jury: ["DELIBERATE"],
  system: [
    "START_TRIAL",
    "BEGIN_PHASE",
    "SWEAR_WITNESS",
    "RULE_ON_OBJECTION",
    "STRIKE_TESTIMONY",
    "RULE_ON_EVIDENCE",
    "REVEAL_HIDDEN_FACT",
    "VERIFY_ASSERTION",
    "RULE_ON_ASSERTION",
    "REQUEST_RESPONSE",
    "CANCEL_RESPONSE",
    "COMPLETE_RESPONSE",
    "BEGIN_INTERRUPTION",
    "RESOLVE_INTERRUPTION",
    "RESUME_INTERRUPTED_SPEECH",
    "PAUSE_TRIAL",
    "REQUEST_RECESS",
    "RESUME_TRIAL",
    "EXPIRE_SETTLEMENT",
    "INSTRUCT_JURY",
    "RENDER_VERDICT",
    "FAIL_STEP",
    "RECOVER_STEP",
  ],
  debrief_coach: ["GENERATE_DEBRIEF"],
} as const satisfies Readonly<Record<ActorRole, readonly TrialActionType[]>>;

describe("trial actor/action permissions", () => {
  it("assigns an explicit, non-empty, duplicate-free role set to every action", () => {
    expect(Object.keys(TRIAL_ACTION_PERMISSION_MATRIX)).toEqual(
      TRIAL_ACTION_TYPES,
    );

    for (const actionType of TRIAL_ACTION_TYPES) {
      const allowedRoles = allowedActorRolesForAction(actionType);
      expect(allowedRoles, actionType).not.toHaveLength(0);
      expect(new Set(allowedRoles).size, actionType).toBe(allowedRoles.length);
      expect(
        allowedRoles.every((role) => ActorRoleSchema.options.includes(role)),
        actionType,
      ).toBe(true);
    }
  });

  it("exposes the exact inverse policy for every actor role", () => {
    expect(Object.keys(EXPECTED_ACTIONS_BY_ACTOR)).toEqual(
      ActorRoleSchema.options,
    );

    for (const actorRole of ActorRoleSchema.options) {
      expect(allowedActionsForActor(actorRole), actorRole).toEqual(
        EXPECTED_ACTIONS_BY_ACTOR[actorRole],
      );
    }
  });

  it("answers every actor/action cell from the explicit matrix", () => {
    for (const actionType of TRIAL_ACTION_TYPES) {
      for (const actorRole of ActorRoleSchema.options) {
        expect(
          isActionAllowedForActor(actorRole, actionType),
          `${actorRole}:${actionType}`,
        ).toBe(
          EXPECTED_ACTIONS_BY_ACTOR[actorRole].some(
            (allowedAction) => allowedAction === actionType,
          ),
        );
      }
    }
  });

  it("keeps sensitive responsibilities isolated", () => {
    expect(allowedActorRolesForAction("START_TRIAL")).toEqual(["system"]);
    expect(allowedActorRolesForAction("ANSWER_QUESTION")).toEqual(["witness"]);
    expect(allowedActorRolesForAction("DELIBERATE")).toEqual(["jury"]);
    expect(allowedActorRolesForAction("GENERATE_DEBRIEF")).toEqual([
      "debrief_coach",
    ]);
    expect(allowedActorRolesForAction("REQUEST_RESPONSE")).toEqual(["system"]);
    expect(allowedActorRolesForAction("CANCEL_RESPONSE")).toEqual(["system"]);
    expect(allowedActorRolesForAction("COMPLETE_RESPONSE")).toEqual(["system"]);
    expect(allowedActorRolesForAction("RESUME_INTERRUPTED_SPEECH")).toEqual([
      "system",
    ]);
  });

  it("does not expose mutable permission arrays", () => {
    expect(Object.isFrozen(TRIAL_ACTION_PERMISSION_MATRIX)).toBe(true);
    expect(Object.isFrozen(allowedActorRolesForAction("OBJECT"))).toBe(true);
    expect(Object.isFrozen(allowedActionsForActor("judge"))).toBe(true);
  });
});
