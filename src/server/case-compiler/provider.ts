import {
  CASE_COMPILER_MODEL,
  CASE_COMPILER_PROVIDER_PROTOCOL_VERSION,
} from "./constants";
import type { CaseCompilerPrompt, CaseCompilerPromptMode } from "./prompt";
import type { CaseCompilerTokenUsage } from "./schemas";

export type CaseCompilerStreamEvent =
  | Readonly<{
      type: "response_started";
      responseId: string;
    }>
  | Readonly<{
      type: "structured_delta";
      delta: string;
    }>
  | Readonly<{
      type: "response_completed";
      responseId: string;
    }>
  | Readonly<{
      type: "response_failed";
      code: string;
    }>;

export type CaseCompilerProviderRequest = Readonly<{
  protocolVersion: typeof CASE_COMPILER_PROVIDER_PROTOCOL_VERSION;
  model: typeof CASE_COMPILER_MODEL;
  mode: CaseCompilerPromptMode;
  attempt: number;
  prompt: CaseCompilerPrompt;
  signal?: AbortSignal;
  onStreamEvent?: (event: CaseCompilerStreamEvent) => void;
}>;

export type CaseCompilerProviderResponse = Readonly<{
  output: unknown;
  requestId: string;
  responseId: string;
  latencyMs: number;
  streamEventCount: number;
  streamedCharacterCount: number;
  usage: CaseCompilerTokenUsage | null;
}>;

export interface CaseCompilerProvider {
  readonly protocolVersion: typeof CASE_COMPILER_PROVIDER_PROTOCOL_VERSION;
  readonly model: typeof CASE_COMPILER_MODEL;
  readonly providerName: string;
  generate(request: CaseCompilerProviderRequest): Promise<CaseCompilerProviderResponse>;
}

export type CaseCompilerProviderErrorOptions = ErrorOptions & Readonly<{
  retryAfterMs?: number | null;
}>;

export class CaseCompilerProviderError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;

  constructor(
    code: string,
    message: string,
    retryable: boolean,
    options?: CaseCompilerProviderErrorOptions,
  ) {
    super(message, options);
    this.name = "CaseCompilerProviderError";
    this.code = code;
    this.retryable = retryable;
    this.retryAfterMs = options?.retryAfterMs ?? null;
  }
}
