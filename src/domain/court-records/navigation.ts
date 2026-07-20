import { z } from "zod";

import { HearingTrialIdSchema } from "../hearing-runtime";

export const CourtRecordsInitialSelectionSchema = z.discriminatedUnion(
  "kind",
  [
    z.object({ kind: z.literal("none") }).strict(),
    z
      .object({
        kind: z.literal("valid"),
        trialId: HearingTrialIdSchema,
      })
      .strict(),
    z.object({ kind: z.literal("invalid") }).strict(),
  ],
);

export type CourtRecordsInitialSelection = z.infer<
  typeof CourtRecordsInitialSelectionSchema
>;

/**
 * Convert the untrusted records query into a small serializable page contract.
 * Duplicate or malformed trial parameters remain invalid without retaining the
 * attacker-controlled input for rendering.
 */
export function parseCourtRecordsInitialSelection(
  value: string | readonly string[] | undefined,
): CourtRecordsInitialSelection {
  if (value === undefined) return Object.freeze({ kind: "none" });
  if (typeof value !== "string") return Object.freeze({ kind: "invalid" });
  const trialId = HearingTrialIdSchema.safeParse(value);
  return trialId.success
    ? Object.freeze({ kind: "valid", trialId: trialId.data })
    : Object.freeze({ kind: "invalid" });
}
