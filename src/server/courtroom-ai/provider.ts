import type { z } from "zod";

import type {
  CourtroomModel,
  CourtroomModelTokenUsage,
} from "@/domain/courtroom-ai/model-call-trace";

import {
  COURTROOM_MODEL_PROVIDER_PROTOCOL_VERSION,
  expectedCourtroomModelForCall,
  isCourtroomRuntimeCall,
  type CourtroomRuntimeCall,
} from "./constants";

export type CourtroomModelPromptMode = "initial" | "repair";

export type CourtroomModelPrompt = Readonly<{
  promptVersion: string;
  cacheKey: string;
  developerPrefix: string;
  developerContext: string;
  untrustedUserContent: string;
}>;

export type CourtroomModelStreamEvent =
  | Readonly<{
      type: "response_started";
      responseId: string;
      elapsedMs: number;
    }>
  | Readonly<{
      type: "structured_delta";
      responseId: string | null;
      delta: string;
      index: number;
      elapsedMs: number;
    }>
  | Readonly<{
      type: "response_completed";
      responseId: string;
      elapsedMs: number;
    }>
  | Readonly<{
      type: "response_failed";
      responseId: string | null;
      code: string;
      elapsedMs: number;
    }>;

type CourtroomModelProviderRequestBase<
  TSchema extends z.ZodObject = z.ZodObject,
> = Readonly<{
  protocolVersion: typeof COURTROOM_MODEL_PROVIDER_PROTOCOL_VERSION;
  mode: CourtroomModelPromptMode;
  attempt: number;
  prompt: CourtroomModelPrompt;
  schema: TSchema;
  schemaName: string;
  schemaVersion: string;
  signal?: AbortSignal;
  onStreamEvent?: (event: CourtroomModelStreamEvent) => void;
}>;

export type CourtroomModelProviderRequest<
  TSchema extends z.ZodObject = z.ZodObject,
> = CourtroomModelProviderRequestBase<TSchema> & CourtroomRuntimeCall;

export type CourtroomModelProviderResponse<TOutput = unknown> = Readonly<{
  model: CourtroomModel;
  output: TOutput;
  requestId: string;
  responseId: string;
  latencyMs: number;
  firstStructuredDeltaMs: number | null;
  streamEventCount: number;
  structuredDeltaCount: number;
  streamedCharacterCount: number;
  usage: CourtroomModelTokenUsage | null;
}>;

export interface CourtroomModelProvider {
  readonly protocolVersion: typeof COURTROOM_MODEL_PROVIDER_PROTOCOL_VERSION;
  readonly providerName: string;
  generate<TSchema extends z.ZodObject>(
    request: CourtroomModelProviderRequest<TSchema>,
  ): Promise<CourtroomModelProviderResponse<z.output<TSchema>>>;
}

export type CourtroomModelProviderErrorOptions = ErrorOptions &
  Readonly<{
    retryAfterMs?: number | null;
  }>;

export class CourtroomModelProviderError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;

  constructor(
    code: string,
    message: string,
    retryable: boolean,
    options?: CourtroomModelProviderErrorOptions,
  ) {
    super(message, options);
    this.name = "CourtroomModelProviderError";
    this.code = code;
    this.retryable = retryable;
    this.retryAfterMs = options?.retryAfterMs ?? null;
  }
}

const SAFE_SCHEMA_NAME = /^[A-Za-z0-9_-]+$/;

function hasText(value: string): boolean {
  return value.trim().length > 0;
}

export function assertCourtroomModelProviderRequest(
  request: CourtroomModelProviderRequest,
): CourtroomModel {
  if (request.protocolVersion !== COURTROOM_MODEL_PROVIDER_PROTOCOL_VERSION) {
    throw new CourtroomModelProviderError(
      "provider_contract_mismatch",
      "Courtroom model provider protocol mismatch",
      false,
    );
  }
  if (!isCourtroomRuntimeCall(request)) {
    throw new CourtroomModelProviderError(
      "provider_contract_mismatch",
      "Unsupported courtroom model call class and task",
      false,
    );
  }
  if (!Number.isInteger(request.attempt) || request.attempt < 1) {
    throw new CourtroomModelProviderError(
      "provider_contract_mismatch",
      "Courtroom model attempt must be a positive integer",
      false,
    );
  }
  if (
    !hasText(request.schemaName) ||
    request.schemaName.length > 64 ||
    !SAFE_SCHEMA_NAME.test(request.schemaName) ||
    !hasText(request.schemaVersion) ||
    request.schemaVersion.length > 240
  ) {
    throw new CourtroomModelProviderError(
      "provider_contract_mismatch",
      "Courtroom model schema identity is invalid",
      false,
    );
  }
  if (
    !hasText(request.prompt.promptVersion) ||
    !hasText(request.prompt.cacheKey) ||
    !hasText(request.prompt.developerPrefix)
  ) {
    throw new CourtroomModelProviderError(
      "provider_contract_mismatch",
      "Courtroom model prompt identity is invalid",
      false,
    );
  }
  return expectedCourtroomModelForCall(request);
}
