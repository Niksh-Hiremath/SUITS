import { z } from "zod";

import { CaseGraphEntityIdSchema } from "../case-graph";
import { ObjectionGroundSchema } from "../courtroom-ai";

export const HEARING_START_SCHEMA_VERSION = "hearing-start.v1" as const;
export const HEARING_PLAYER_COMMAND_SCHEMA_VERSION =
  "hearing-player-command.v1" as const;

export const HearingTrialIdSchema = z
  .string()
  .regex(/^trial_[a-f0-9]{32}$/u, "Expected a V3 hearing trial ID");

const UuidV4Schema = z
  .string()
  .uuid()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    "Expected a lowercase UUIDv4",
  );

export const HearingCaseSelectorSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("seeded"),
      slug: z
        .string()
        .trim()
        .min(1)
        .max(120)
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
    })
    .strict(),
  z
    .object({
      kind: z.literal("owned"),
      uploadId: CaseGraphEntityIdSchema,
    })
    .strict(),
]);

export const StartHearingRequestSchema = z
  .object({
    schemaVersion: z.literal(HEARING_START_SCHEMA_VERSION),
    requestId: UuidV4Schema,
    requestedAt: z.string().datetime({ offset: true }),
    case: HearingCaseSelectorSchema,
    userSide: z.enum(["user", "opposing"]).default("user"),
  })
  .strict();

const CallWitnessIntentSchema = z
  .object({
    type: z.literal("call_witness"),
    witnessId: CaseGraphEntityIdSchema,
  })
  .strict();

const AskQuestionIntentSchema = z
  .object({
    type: z.literal("ask_question"),
    witnessId: CaseGraphEntityIdSchema,
    examinationKind: z.enum(["direct", "cross", "redirect", "recross"]),
    text: z.string().trim().min(1).max(8_000),
    presentedEvidenceIds: z.array(CaseGraphEntityIdSchema).max(32),
  })
  .strict();

const FinishWitnessIntentSchema = z
  .object({
    type: z.literal("finish_witness"),
    witnessId: CaseGraphEntityIdSchema,
    examinationKind: z.enum(["direct", "cross", "redirect", "recross"]),
  })
  .strict();

const FinishTrialIntentSchema = z
  .object({
    type: z.literal("finish_trial"),
    closingText: z.string().trim().min(1).max(20_000),
  })
  .strict();

const ObjectIntentSchema = z
  .object({
    type: z.literal("object"),
    questionId: CaseGraphEntityIdSchema,
    responseId: CaseGraphEntityIdSchema,
    ground: ObjectionGroundSchema,
  })
  .strict();

const ContinueResponseIntentSchema = z
  .object({
    type: z.literal("continue_response"),
    responseId: CaseGraphEntityIdSchema,
  })
  .strict();

export const HearingSettlementTermsInputSchema = z
  .object({
    amount: z.number().nonnegative().nullable(),
    nonMonetaryTerms: z
      .array(z.string().trim().min(1).max(1_000))
      .max(24)
      .superRefine((terms, context) => {
        const seen = new Set<string>();
        terms.forEach((term, index) => {
          const normalized = term.toLocaleLowerCase("en-US");
          if (seen.has(normalized)) {
            context.addIssue({
              code: "custom",
              path: [index],
              message: "Settlement terms must be unique",
            });
          }
          seen.add(normalized);
        });
      }),
    summary: z.string().trim().min(1).max(4_000),
  })
  .strict()
  .superRefine((terms, context) => {
    if (terms.amount === null && terms.nonMonetaryTerms.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["amount"],
        message: "A settlement offer requires monetary or non-monetary terms",
      });
    }
  });

const ProposeSettlementIntentSchema = z
  .object({
    type: z.literal("propose_settlement"),
    terms: HearingSettlementTermsInputSchema,
  })
  .strict();

const CounterSettlementIntentSchema = z
  .object({
    type: z.literal("counter_settlement"),
    offerId: CaseGraphEntityIdSchema,
    terms: HearingSettlementTermsInputSchema,
  })
  .strict();

const SettlementOfferIntentSchema = (type: "accept_settlement" | "reject_settlement" | "withdraw_settlement") =>
  z
    .object({
      type: z.literal(type),
      offerId: CaseGraphEntityIdSchema,
    })
    .strict();

export const HearingPlayerIntentSchema = z.discriminatedUnion("type", [
  CallWitnessIntentSchema,
  AskQuestionIntentSchema,
  FinishWitnessIntentSchema,
  FinishTrialIntentSchema,
  ObjectIntentSchema,
  ContinueResponseIntentSchema,
  ProposeSettlementIntentSchema,
  CounterSettlementIntentSchema,
  SettlementOfferIntentSchema("accept_settlement"),
  SettlementOfferIntentSchema("reject_settlement"),
  SettlementOfferIntentSchema("withdraw_settlement"),
]);

export const HearingPlayerCommandSchema = z
  .object({
    schemaVersion: z.literal(HEARING_PLAYER_COMMAND_SCHEMA_VERSION),
    requestId: UuidV4Schema,
    requestedAt: z.string().datetime({ offset: true }),
    expectedStateVersion: z.number().int().nonnegative(),
    expectedLastEventId: CaseGraphEntityIdSchema,
    intent: HearingPlayerIntentSchema,
  })
  .strict();

export type HearingCaseSelector = z.infer<typeof HearingCaseSelectorSchema>;
export type StartHearingRequest = z.infer<typeof StartHearingRequestSchema>;
export type HearingPlayerIntent = z.infer<typeof HearingPlayerIntentSchema>;
export type HearingSettlementTermsInput = z.infer<
  typeof HearingSettlementTermsInputSchema
>;
export type HearingPlayerCommand = z.infer<typeof HearingPlayerCommandSchema>;
