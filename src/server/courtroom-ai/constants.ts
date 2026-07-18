import type {
  CourtroomModel,
  CourtroomModelCallClass,
  CourtroomModelCallTask,
} from "@/domain/courtroom-ai/model-call-trace";

export const COURTROOM_MODEL_PROVIDER_PROTOCOL_VERSION =
  "courtroom-model-provider.v1" as const;
export const COURTROOM_RUNTIME_MODEL = "gpt-5.6-luna" as const;
export const COURTROOM_FINAL_DEBRIEF_MODEL = "gpt-5.6-terra" as const;
export const COURTROOM_PROMPT_CACHE_TTL = "30m" as const;
export const COURTROOM_PROVIDER_COMPONENT = "suits-courtroom-ai" as const;
export const DEFAULT_COURTROOM_MAX_OUTPUT_TOKENS = 16_000 as const;
export const MAX_COURTROOM_RETRY_DELAY_MS = 10_000 as const;

export const COURTROOM_RUNTIME_TASKS_BY_CALL_CLASS = {
  opponent_planner: ["plan_opponent"],
  role_responder: [
    "witness_answer",
    "counsel_response",
    "judge_response",
    "jury_deliberation",
  ],
  objection_resolver: ["resolve_objection"],
  negotiation_agent: ["evaluate_settlement"],
  debrief_generator: ["generate_debrief"],
} as const satisfies Readonly<
  Record<
    Exclude<CourtroomModelCallClass, "case_compiler">,
    readonly CourtroomModelCallTask[]
  >
>;

export type CourtroomRuntimeCallClass =
  keyof typeof COURTROOM_RUNTIME_TASKS_BY_CALL_CLASS;

export type CourtroomRuntimeCall = {
  [CallClass in CourtroomRuntimeCallClass]: Readonly<{
    callClass: CallClass;
    task: (typeof COURTROOM_RUNTIME_TASKS_BY_CALL_CLASS)[CallClass][number];
  }>;
}[CourtroomRuntimeCallClass];

export type CourtroomRuntimeTask = CourtroomRuntimeCall["task"];

export function isCourtroomRuntimeCall(
  call: Readonly<{ callClass: string; task: string }>,
): call is CourtroomRuntimeCall {
  if (!Object.hasOwn(COURTROOM_RUNTIME_TASKS_BY_CALL_CLASS, call.callClass)) {
    return false;
  }
  const callClass = call.callClass as CourtroomRuntimeCallClass;
  return (
    COURTROOM_RUNTIME_TASKS_BY_CALL_CLASS[callClass] as readonly string[]
  ).includes(call.task);
}

export function expectedCourtroomModelForCall(
  call: CourtroomRuntimeCall,
): CourtroomModel {
  return call.callClass === "debrief_generator"
    ? COURTROOM_FINAL_DEBRIEF_MODEL
    : COURTROOM_RUNTIME_MODEL;
}
