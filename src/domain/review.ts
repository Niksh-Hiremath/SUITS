import { z } from "zod";

export type TranscriptTurn = { turnId: string; actor: string; phase: string; text: string };

const citedFinding = z.object({ finding: z.string().min(1), turnCitations: z.array(z.string()).min(1) });
const reviewValidator = z.object({
  verdict: z.enum(["claimant", "respondent", "insufficient_record"]),
  confidence: z.number().min(0).max(1),
  jurorParts: z.array(z.object({ juror: z.string().min(1), persona: z.string().min(1), text: z.string().min(1), turnCitations: z.array(z.string()).min(1) })).length(3),
  overallAssessment: z.string().min(1),
  strength: citedFinding,
  missedOpportunity: citedFinding.extend({ recommendedQuestion: z.string().min(1) }),
  revisedClosing: z.object({ text: z.string().min(1), basedOnTurnIds: z.array(z.string()).min(1) }),
}).strict();

export type Review = z.infer<typeof reviewValidator>;

export function validateReview(value: unknown, validTurnIds: Set<string>): Review {
  const parsed = reviewValidator.safeParse(value);
  if (!parsed.success) {
    const citationFailure = parsed.error.issues.some((issue) => issue.path.includes("turnCitations") || issue.path.includes("basedOnTurnIds"));
    throw new Error(citationFailure ? "Invalid transcript citation" : "Invalid structured review");
  }
  const citations = [
    ...parsed.data.jurorParts.flatMap((part) => part.turnCitations),
    ...parsed.data.strength.turnCitations,
    ...parsed.data.missedOpportunity.turnCitations,
    ...parsed.data.revisedClosing.basedOnTurnIds,
  ];
  if (citations.some((id) => !validTurnIds.has(id))) throw new Error("Invalid transcript citation");
  return parsed.data;
}

export function deterministicReview(turns: TranscriptTurn[]): Review {
  const last = turns.at(-1)?.turnId ?? "unavailable";
  const witness = turns.find((turn) => turn.actor === "Witness")?.turnId ?? last;
  const question = turns.find((turn) => turn.phase === "cross_examination" && turn.actor !== "Witness")?.turnId ?? witness;
  return {
    verdict: "insufficient_record",
    confidence: 0.5,
    jurorParts: ["Chronology", "Evidence", "Advocacy"].map((persona, index) => ({ juror: `Juror ${index + 1}`, persona, text: "The provider was unavailable, so I rely only on the preserved transcript.", turnCitations: [witness] })),
    overallAssessment: "The model review could not be validated. This deterministic debrief preserves the record without adding facts.",
    strength: { finding: "The advocate created a reviewable transcript record.", turnCitations: [question] },
    missedOpportunity: { finding: "A validated model assessment was unavailable; verify the cited exchange directly.", turnCitations: [witness], recommendedQuestion: "Please confirm the timing shown in the admitted record." },
    revisedClosing: { text: "The decision should rest only on the cited testimony and admitted timeline.", basedOnTurnIds: [last] },
  };
}

async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error("MODEL_TIMEOUT")), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runReview(args: { turns: TranscriptTurn[]; call: (repair: boolean) => Promise<string>; timeoutMs: number }) {
  const validIds = new Set(args.turns.map((turn) => turn.turnId));
  let errorCode = "INVALID_MODEL_OUTPUT";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const output = await withTimeout(args.call(attempt === 1), args.timeoutMs);
      const review = validateReview(JSON.parse(output), validIds);
      return { review, status: attempt === 0 ? "succeeded" as const : "repaired" as const, retryCount: attempt, fallbackUsed: false, errorCode: undefined };
    } catch (error) {
      if (error instanceof Error && error.message === "MODEL_TIMEOUT") errorCode = "MODEL_TIMEOUT";
    }
  }
  return { review: deterministicReview(args.turns), status: "fallback" as const, retryCount: 1, fallbackUsed: true, errorCode };
}
