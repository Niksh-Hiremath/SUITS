import {
  TRIAL_ACTION_TYPES,
  type ActorRole,
  type TrialActionType,
} from "./schemas";

export type TrialActionPermissionMatrix = Readonly<{
  [ActionType in TrialActionType]: readonly ActorRole[];
}>;

function roles<const Roles extends readonly ActorRole[]>(
  ...allowedRoles: Roles
): Readonly<Roles> {
  return Object.freeze(allowedRoles);
}

const trialActionPermissionMatrix = {
  START_TRIAL: roles("system"),
  BEGIN_PHASE: roles("judge", "system"),
  CALL_WITNESS: roles("user_counsel", "opposing_counsel"),
  SWEAR_WITNESS: roles("judge", "clerk", "system"),
  ASK_QUESTION: roles("user_counsel", "opposing_counsel"),
  ANSWER_QUESTION: roles("witness"),
  END_EXAMINATION: roles("user_counsel", "opposing_counsel"),
  RECALL_WITNESS: roles("user_counsel", "opposing_counsel"),
  RELEASE_WITNESS: roles("user_counsel", "opposing_counsel"),
  OBJECT: roles("user_counsel", "opposing_counsel"),
  RULE_ON_OBJECTION: roles("judge", "system"),
  REPHRASE_QUESTION: roles("user_counsel", "opposing_counsel"),
  MOVE_TO_STRIKE: roles("user_counsel", "opposing_counsel"),
  STRIKE_TESTIMONY: roles("judge", "system"),
  OFFER_EVIDENCE: roles("user_counsel", "opposing_counsel"),
  RULE_ON_EVIDENCE: roles("judge", "system"),
  WITHDRAW_EVIDENCE: roles("user_counsel", "opposing_counsel"),
  REVEAL_HIDDEN_FACT: roles("judge", "system"),
  PROPOSE_ASSERTION: roles("user_counsel", "opposing_counsel"),
  VERIFY_ASSERTION: roles("judge", "system"),
  DISPUTE_ASSERTION: roles("user_counsel", "opposing_counsel"),
  RULE_ON_ASSERTION: roles("judge", "system"),
  REQUEST_RESPONSE: roles("system"),
  CANCEL_RESPONSE: roles("system"),
  COMPLETE_RESPONSE: roles("system"),
  BEGIN_INTERRUPTION: roles("user_counsel", "opposing_counsel", "system"),
  RESOLVE_INTERRUPTION: roles("judge", "system"),
  RESUME_INTERRUPTED_SPEECH: roles("system"),
  PAUSE_TRIAL: roles("judge", "system"),
  REQUEST_RECESS: roles("judge", "system"),
  RESUME_TRIAL: roles("judge", "system"),
  PROPOSE_SETTLEMENT: roles("user_counsel", "opposing_counsel"),
  COUNTER_SETTLEMENT: roles("user_counsel", "opposing_counsel"),
  ACCEPT_SETTLEMENT: roles("user_counsel", "opposing_counsel"),
  REJECT_SETTLEMENT: roles("user_counsel", "opposing_counsel"),
  WITHDRAW_SETTLEMENT: roles("user_counsel", "opposing_counsel"),
  EXPIRE_SETTLEMENT: roles("system"),
  REST_CASE: roles("user_counsel", "opposing_counsel"),
  GIVE_CLOSING: roles("user_counsel", "opposing_counsel"),
  INSTRUCT_JURY: roles("judge", "system"),
  DELIBERATE: roles("jury"),
  RENDER_VERDICT: roles("judge", "system"),
  GENERATE_DEBRIEF: roles("debrief_coach"),
  FAIL_STEP: roles("system"),
  RECOVER_STEP: roles("system"),
} as const satisfies TrialActionPermissionMatrix;

/**
 * Canonical actor-role policy for every trial action. Adding an action to the
 * schema without assigning it here is a TypeScript error; there is no
 * unrestricted fallback.
 */
export const TRIAL_ACTION_PERMISSION_MATRIX: TrialActionPermissionMatrix =
  Object.freeze(trialActionPermissionMatrix);

export function allowedActorRolesForAction(
  actionType: TrialActionType,
): readonly ActorRole[] {
  return TRIAL_ACTION_PERMISSION_MATRIX[actionType];
}

export function isActionAllowedForActor(
  actorRole: ActorRole,
  actionType: TrialActionType,
): boolean {
  return allowedActorRolesForAction(actionType).includes(actorRole);
}

export function allowedActionsForActor(
  actorRole: ActorRole,
): readonly TrialActionType[] {
  return Object.freeze(
    TRIAL_ACTION_TYPES.filter((actionType) =>
      isActionAllowedForActor(actorRole, actionType),
    ),
  );
}
