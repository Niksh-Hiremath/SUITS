import { z } from "zod";

export const COURTROOM_PRESENTATION_FRAME_SCHEMA_VERSION =
  "courtroom-presentation-frame.v1" as const;

export const SceneActorKeySchema = z.enum([
  "judge",
  "user_counsel",
  "opposing_counsel",
  "witness",
  "clerk",
  "jury",
]);

export const CourtroomAnimationSchema = z.enum([
  "idle",
  "listening",
  "thinking",
  "speaking",
  "objecting",
  "standing",
  "sitting",
  "presenting_evidence",
  "reacting",
  "ruling",
  "gavel",
]);

export const CourtroomPostureSchema = z.enum(["seated", "standing"]);
export const CourtroomQualitySchema = z.enum([
  "high",
  "balanced",
  "reduced",
]);
export const CourtroomCameraShotSchema = z.enum([
  "courtroom_wide",
  "judge_close",
  "user_counsel_close",
  "opposing_counsel_close",
  "witness_close",
  "jury_box",
  "evidence_display",
  "witness_counsel_two_shot",
]);

const IdentifierSchema = z.string().trim().min(1).max(256);
const LabelSchema = z.string().trim().min(1).max(160);

export const CourtroomEvidenceDisplayStatusSchema = z.enum([
  "uploaded",
  "indexed",
  "offered",
  "admitted",
  "excluded",
  "withdrawn",
]);

export const CourtroomSettlementDisplayStatusSchema = z.enum([
  "open",
  "countered",
  "accepted",
  "rejected",
  "withdrawn",
  "expired",
]);

export const CourtroomCharacterStateSchema = z
  .object({
    slot: SceneActorKeySchema,
    actorId: IdentifierSchema.nullable(),
    label: LabelSchema,
    present: z.boolean(),
    animation: CourtroomAnimationSchema,
    posture: CourtroomPostureSchema,
    emphasis: z.number().min(0).max(1),
  })
  .strict();

export const CourtroomCameraStateSchema = z
  .object({
    shot: CourtroomCameraShotSchema,
    target: SceneActorKeySchema.nullable(),
    transition: z.enum(["blend", "cut"]),
  })
  .strict();

export const CourtroomDisplayDescriptorSchema = z
  .discriminatedUnion("mode", [
    z
      .object({
        mode: z.literal("idle"),
        itemId: z.null(),
        label: z.null(),
        status: z.null(),
      })
      .strict(),
    z
      .object({
        mode: z.literal("evidence"),
        itemId: IdentifierSchema,
        label: LabelSchema,
        status: CourtroomEvidenceDisplayStatusSchema,
      })
      .strict(),
    z
      .object({
        mode: z.literal("settlement"),
        itemId: IdentifierSchema,
        label: LabelSchema.refine(
          (label) => label === "Private settlement conference",
          "Settlement display labels must remain private and generic",
        ),
        status: CourtroomSettlementDisplayStatusSchema,
      })
      .strict(),
  ])
  .readonly();

export const CourtroomDisplayStateSchema = CourtroomDisplayDescriptorSchema;

export const CourtroomPresentationHeadSchema = z
  .object({
    trialId: IdentifierSchema,
    stateVersion: z.number().int().nonnegative(),
    lastEventId: IdentifierSchema,
  })
  .strict()
  .readonly();

export const CourtroomPresentationFrameSchema = z
  .object({
    schemaVersion: z.literal(COURTROOM_PRESENTATION_FRAME_SCHEMA_VERSION),
    head: CourtroomPresentationHeadSchema,
    quality: CourtroomQualitySchema,
    reducedMotion: z.boolean(),
    camera: CourtroomCameraStateSchema,
    characters: z.array(CourtroomCharacterStateSchema).length(6),
    display: CourtroomDisplayStateSchema,
    statusSummary: z.string().trim().min(1).max(320),
  })
  .strict()
  .superRefine((frame, context) => {
    const slots = frame.characters.map(({ slot }) => slot);
    if (new Set(slots).size !== slots.length) {
      context.addIssue({
        code: "custom",
        path: ["characters"],
        message: "Courtroom character slots must be unique",
      });
    }
  });

export type SceneActorKey = z.infer<typeof SceneActorKeySchema>;
export type CourtroomAnimation = z.infer<typeof CourtroomAnimationSchema>;
export type CourtroomQuality = z.infer<typeof CourtroomQualitySchema>;
export type CourtroomDisplayDescriptor = z.infer<
  typeof CourtroomDisplayDescriptorSchema
>;
export type CourtroomDisplayState = CourtroomDisplayDescriptor;
export type CourtroomPresentationHead = z.infer<
  typeof CourtroomPresentationHeadSchema
>;
export type CourtroomPresentationFrame = z.infer<
  typeof CourtroomPresentationFrameSchema
>;
