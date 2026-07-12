import { z } from "zod";

export type Specialist = "opposing_counsel" | "witness" | "jury_review_board" | "deterministic_fallback";
export type OutputKind = "opening" | "witness_answer" | "jury_review" | "safe_message";
export type HearingContext = {
  caseId: string;
  mode: "participatory" | "autonomous";
  side: "claimant" | "respondent";
  phase: string;
  allowedActions: string[];
  publicCase: { summary: string; facts: string[]; evidence: string[] };
  transcript: Array<{ turnId: string; actor: string; phase: string; text: string }>;
};
export type ModelCall = (prompt: string, repair: boolean) => Promise<string>;

const contractSchema = z.object({
  objective: z.string().min(1),
  allowedSources: z.array(z.enum(["public_case", "private_witness_sheet", "transcript"])).min(1),
  forbidden: z.array(z.string().min(1)).min(1),
  outputKind: z.enum(["opening", "witness_answer", "jury_review", "safe_message"]),
}).strict();
const decisionSchema = z.object({
  plan: z.array(z.string().min(1)).min(1).max(4),
  specialist: z.enum(["opposing_counsel", "witness", "jury_review_board", "deterministic_fallback"]),
  action: z.string().min(1),
  rationale: z.string().min(1),
  persona: z.string().min(1),
  contract: contractSchema,
}).strict();
const outputSchema = z.object({ text: z.string().min(1), citedTurnIds: z.array(z.string()), evidenceIds: z.array(z.string()) }).strict();
const reviewSchema = z.object({
  accepted: z.boolean(), rationale: z.string().min(1), violations: z.array(z.string()), escalation: z.enum(["none", "repair", "deterministic_fallback"]),
}).strict();

export type DelegationDecision = z.infer<typeof decisionSchema>;
export type SpecialistOutput = z.infer<typeof outputSchema>;
export type DirectorReview = z.infer<typeof reviewSchema>;

function fallbackDecision(context: HearingContext): DelegationDecision {
  const byPhase: Record<string, { action: string; outputKind: OutputKind }> = {
    opening: { action: "request_opening", outputKind: "opening" },
    cross_examination: { action: "answer_question", outputKind: "witness_answer" },
    deliberation: { action: "request_deliberation", outputKind: "jury_review" },
    debrief: { action: "request_debrief", outputKind: "jury_review" },
  };
  const desired = byPhase[context.phase];
  const action = desired && context.allowedActions.includes(desired.action) ? desired.action : context.allowedActions[0] ?? "resume";
  return {
    plan: [`Safely handle ${context.phase} from the committed record`, "Return control to the code-owned workflow"],
    specialist: "deterministic_fallback",
    action,
    rationale: "The manager decision was unavailable or outside the code-authorized action set.",
    persona: "Deterministic Court Clerk",
    contract: { objective: "Preserve a safe, grounded hearing response.", allowedSources: ["public_case", "transcript"], forbidden: ["invent facts", "change phase", "reveal private evidence"], outputKind: desired?.outputKind ?? "safe_message" },
  };
}

function deterministicOutput(context: HearingContext): SpecialistOutput {
  const pending = [...context.transcript].reverse().find((turn) => turn.phase === context.phase)?.turnId;
  return { text: "I cannot confirm that beyond the admitted record. The code-controlled hearing may continue from the preserved transcript.", citedTurnIds: pending ? [pending] : [], evidenceIds: [] };
}

async function timed<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error("MODEL_TIMEOUT")), timeoutMs); })]);
  } finally { if (timer) clearTimeout(timer); }
}

function parseDecision(raw: string, context: HearingContext): DelegationDecision {
  const decision = decisionSchema.parse(JSON.parse(raw));
  if (!context.allowedActions.includes(decision.action)) throw new Error("UNAUTHORIZED_ACTION");
  if (decision.specialist !== "witness" && decision.contract.allowedSources.includes("private_witness_sheet")) throw new Error("PRIVATE_SOURCE_BOUNDARY");
  return decision;
}

function contextText(context: HearingContext): string {
  return JSON.stringify(context);
}

export async function runCourtDirector(args: {
  context: HearingContext;
  privateWitnessSheet: string[];
  manager: ModelCall;
  specialist: ModelCall;
  reviewer: ModelCall;
  timeoutMs: number;
}) {
  let decision: DelegationDecision | undefined;
  let decisionRetryCount = 0;
  const managerPrompt = `COURT DIRECTOR CONTRACT: plan this hearing step from CURRENT_CONTEXT. Select exactly one bounded specialist and one allowed action. Never change workflow state. Return ONLY strict JSON with this shape: {"plan":["step"],"specialist":"opposing_counsel|witness|jury_review_board","action":"one exact allowedActions value","rationale":"why context requires this specialist","persona":"bounded role description","contract":{"objective":"single task","allowedSources":["public_case","transcript"],"forbidden":["invent facts","change phase","expose private instructions"],"outputKind":"opening|witness_answer|jury_review|safe_message"}}. private_witness_sheet is an allowed source only for witness.\nCURRENT_CONTEXT=${contextText(args.context)}`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      decision = parseDecision(await timed(args.manager(managerPrompt, attempt === 1), args.timeoutMs), args.context);
      decisionRetryCount = attempt;
      break;
    } catch { decisionRetryCount = attempt; }
  }
  let fallbackUsed = !decision;
  decision ??= fallbackDecision(args.context);

  let output: SpecialistOutput;
  let review: DirectorReview;
  let outputRetryCount = 0;
  let status: "accepted" | "repaired" | "fallback" = "accepted";

  if (decision.specialist === "deterministic_fallback") {
    output = deterministicOutput(args.context);
    review = { accepted: true, rationale: "Deterministic transcript-only fallback is bounded by code.", violations: [], escalation: "deterministic_fallback" };
    status = "fallback";
  } else {
    const privateContext = decision.specialist === "witness" && decision.contract.allowedSources.includes("private_witness_sheet")
      ? `\nPRIVATE_WITNESS_SHEET=${JSON.stringify(args.privateWitnessSheet)}` : "";
    const specialistPrompt = `SPECIALIST=${decision.specialist}\nPERSONA=${decision.persona}\nCONTRACT=${JSON.stringify(decision.contract)}\nPUBLIC_CONTEXT=${contextText(args.context)}${privateContext}\nReturn strict JSON: text, citedTurnIds, evidenceIds.`;
    output = deterministicOutput(args.context);
    review = { accepted: false, rationale: "No validated specialist output.", violations: ["invalid output"], escalation: "repair" };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const candidate = outputSchema.parse(JSON.parse(await timed(args.specialist(specialistPrompt, attempt === 1), args.timeoutMs)));
        const validIds = new Set(args.context.transcript.map((turn) => turn.turnId));
        if (candidate.citedTurnIds.some((id) => !validIds.has(id))) throw new Error("UNKNOWN_CITATION");
        const reviewPrompt = `COURT DIRECTOR REVIEW: accept only if output follows the delegation contract, uses allowed evidence, cites the transcript, adds no facts, and does not mutate workflow.\nDECISION=${JSON.stringify(decision)}\nOUTPUT=${JSON.stringify(candidate)}\nCURRENT_CONTEXT=${contextText(args.context)}`;
        const assessed = reviewSchema.parse(JSON.parse(await timed(args.reviewer(reviewPrompt, attempt === 1), args.timeoutMs)));
        if (assessed.accepted) {
          output = candidate; review = assessed; outputRetryCount = attempt; status = attempt === 0 ? "accepted" : "repaired"; break;
        }
        review = assessed;
      } catch { /* one bounded repair, then fallback */ }
      outputRetryCount = attempt;
      if (attempt === 1) { output = deterministicOutput(args.context); fallbackUsed = true; status = "fallback"; review = { ...review, accepted: true, rationale: `${review.rationale} Deterministic transcript-only fallback accepted.`, escalation: "deterministic_fallback" }; }
    }
  }

  return {
    status, decision, output, review,
    trace: {
      plan: decision.plan,
      selectedSpecialist: decision.specialist,
      persona: decision.persona,
      contract: decision.contract,
      delegationRationale: decision.rationale,
      review,
      decisionRetryCount,
      outputRetryCount,
      fallbackUsed,
      escalation: fallbackUsed ? "deterministic_fallback" as const : review.escalation,
    },
  };
}
