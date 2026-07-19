import { z } from "zod";

import {
  COURTROOM_FINAL_DEBRIEF_MODEL,
  COURTROOM_INTERACTIVE_MODEL,
} from "./courtroom-ai/call-contracts";

export const DURABLE_SERVICE_HEALTH_SCHEMA_VERSION =
  "suits.durable-service.health.v1" as const;
export const DURABLE_PREFLIGHT_PERMIT_SCHEMA_VERSION =
  "suits.durable-preflight-permit.v1" as const;
export const SERVER_PREFLIGHT_SCHEMA_VERSION =
  "suits.server-preflight.v1" as const;

export const DurableServiceHealthRequestSchema = z.object({}).strict();

export const DurableServiceHealthResponseSchema = z
  .object({
    schemaVersion: z.literal(DURABLE_SERVICE_HEALTH_SCHEMA_VERSION),
    status: z.literal("ready"),
  })
  .strict();

export const DurablePreflightPermitRequestSchema = z.object({}).strict();

export const DurablePreflightPermitResponseSchema = z
  .object({
    schemaVersion: z.literal(DURABLE_PREFLIGHT_PERMIT_SCHEMA_VERSION),
    allowed: z.boolean(),
    retryAfterSeconds: z.number().int().min(0).max(600),
  })
  .strict()
  .superRefine((response, context) => {
    if (response.allowed !== (response.retryAfterSeconds === 0)) {
      context.addIssue({
        code: "custom",
        path: ["retryAfterSeconds"],
        message: "Allowed permits must have no retry delay",
      });
    }
  });

const PreflightLatencySchema = z.number().int().nonnegative().max(120_000);
const ReadyCheckSchema = z
  .object({
    status: z.literal("ready"),
    latencyMs: PreflightLatencySchema,
    code: z.null(),
  })
  .strict();

const unavailableCheck = <TCode extends string>(code: TCode) =>
  z
    .object({
      status: z.literal("unavailable"),
      latencyMs: PreflightLatencySchema,
      code: z.literal(code),
    })
    .strict();

const ConvexCheckSchema = z.discriminatedUnion("status", [
  ReadyCheckSchema,
  unavailableCheck("CONVEX_UNAVAILABLE"),
]);

const modelCheck = <TModel extends string, TCode extends string>(
  model: TModel,
  code: TCode,
) =>
  z.discriminatedUnion("status", [
    ReadyCheckSchema.extend({ model: z.literal(model) }).strict(),
    unavailableCheck(code).extend({ model: z.literal(model) }).strict(),
  ]);

const LunaCheckSchema = modelCheck(
  COURTROOM_INTERACTIVE_MODEL,
  "OPENAI_LUNA_UNAVAILABLE",
);
const TerraCheckSchema = modelCheck(
  COURTROOM_FINAL_DEBRIEF_MODEL,
  "OPENAI_TERRA_UNAVAILABLE",
);
const OpenAIReadySchema = z
  .object({
    status: z.literal("ready"),
    latencyMs: PreflightLatencySchema,
    code: z.null(),
    models: z.tuple([
      ReadyCheckSchema.extend({
        model: z.literal(COURTROOM_INTERACTIVE_MODEL),
      }).strict(),
      ReadyCheckSchema.extend({
        model: z.literal(COURTROOM_FINAL_DEBRIEF_MODEL),
      }).strict(),
    ]),
  })
  .strict();
const OpenAIUnavailableSchema = z
  .object({
    status: z.literal("unavailable"),
    latencyMs: PreflightLatencySchema,
    code: z.literal("OPENAI_MODELS_UNAVAILABLE"),
    models: z.tuple([LunaCheckSchema, TerraCheckSchema]),
  })
  .strict();

export const ServerPreflightRequestSchema = z.object({}).strict();

export const ServerPreflightResponseSchema = z
  .object({
    schemaVersion: z.literal(SERVER_PREFLIGHT_SCHEMA_VERSION),
    checkedAt: z.string().datetime({ offset: true }),
    overallStatus: z.enum(["ready", "degraded"]),
    session: z
      .object({
        status: z.literal("ready"),
      })
      .strict(),
    convex: ConvexCheckSchema,
    openai: z.discriminatedUnion("status", [
      OpenAIReadySchema,
      OpenAIUnavailableSchema,
    ]),
  })
  .strict()
  .superRefine((response, context) => {
    const componentsReady =
      response.convex.status === "ready" &&
      response.openai.status === "ready";
    if ((response.overallStatus === "ready") !== componentsReady) {
      context.addIssue({
        code: "custom",
        path: ["overallStatus"],
        message: "Overall readiness must match the Convex and OpenAI checks",
      });
    }
    if (
      response.openai.status === "unavailable" &&
      response.openai.models.every((model) => model.status === "ready")
    ) {
      context.addIssue({
        code: "custom",
        path: ["openai", "models"],
        message: "Unavailable OpenAI readiness requires an unavailable model",
      });
    }
  });

export type DurableServiceHealthResponse = z.infer<
  typeof DurableServiceHealthResponseSchema
>;
export type DurablePreflightPermitResponse = z.infer<
  typeof DurablePreflightPermitResponseSchema
>;
export type ServerPreflightResponse = z.infer<
  typeof ServerPreflightResponseSchema
>;
