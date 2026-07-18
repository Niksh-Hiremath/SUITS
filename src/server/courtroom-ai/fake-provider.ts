import type { z } from "zod";

import type { CourtroomModelTokenUsage } from "@/domain/courtroom-ai/model-call-trace";

import { COURTROOM_MODEL_PROVIDER_PROTOCOL_VERSION } from "./constants";
import {
  assertCourtroomModelProviderRequest,
  CourtroomModelProviderError,
  type CourtroomModelProvider,
  type CourtroomModelProviderRequest,
  type CourtroomModelProviderResponse,
} from "./provider";

export type ScriptedCourtroomOutputFactory = (
  request: CourtroomModelProviderRequest,
) => unknown | Promise<unknown>;

export type ScriptedCourtroomModelStep =
  | Readonly<{
      type: "output";
      output: unknown | ScriptedCourtroomOutputFactory;
      chunks?: readonly string[];
      chunkSize?: number;
      chunkDelayMs?: number;
      requestId?: string;
      responseId?: string;
      usage?: CourtroomModelTokenUsage | null;
    }>
  | Readonly<{
      type: "error";
      code: string;
      message: string;
      retryable: boolean;
      retryAfterMs?: number | null;
    }>;

export type ScriptedCourtroomModelProviderOptions = Readonly<{
  defaultChunkSize?: number;
  defaultChunkDelayMs?: number;
  repeatLastStep?: boolean;
  monotonicNow?: () => number;
}>;

function approximateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

function splitIntoChunks(value: string, chunkSize: number): readonly string[] {
  const chunks: string[] = [];
  for (let offset = 0; offset < value.length; offset += chunkSize) {
    chunks.push(value.slice(offset, offset + chunkSize));
  }
  return chunks;
}

function cancellationError(cause?: unknown): CourtroomModelProviderError {
  return new CourtroomModelProviderError(
    "request_aborted",
    "The courtroom model request was cancelled",
    false,
    cause === undefined ? undefined : { cause },
  );
}

async function settleWithCancellation<T>(
  operation: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (signal === undefined) return operation;
  if (signal.aborted) throw cancellationError(signal.reason);

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(cancellationError(signal.reason));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function pause(milliseconds: number, signal: AbortSignal | undefined): Promise<void> {
  if (milliseconds === 0) {
    return signal?.aborted
      ? Promise.reject(cancellationError(signal.reason))
      : Promise.resolve();
  }
  if (signal === undefined) {
    return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  }
  if (signal.aborted) return Promise.reject(cancellationError(signal.reason));

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(cancellationError(signal.reason));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw cancellationError(signal.reason);
}

export class ScriptedCourtroomModelProvider implements CourtroomModelProvider {
  readonly protocolVersion = COURTROOM_MODEL_PROVIDER_PROTOCOL_VERSION;
  readonly providerName = "scripted-courtroom-model";
  readonly requests: CourtroomModelProviderRequest[] = [];

  readonly #steps: readonly ScriptedCourtroomModelStep[];
  readonly #defaultChunkSize: number;
  readonly #defaultChunkDelayMs: number;
  readonly #repeatLastStep: boolean;
  readonly #monotonicNow: () => number;
  #nextStep = 0;

  constructor(
    steps: readonly ScriptedCourtroomModelStep[],
    options: ScriptedCourtroomModelProviderOptions = {},
  ) {
    if (steps.length === 0) {
      throw new CourtroomModelProviderError(
        "fake_configuration_error",
        "The scripted courtroom provider requires at least one step",
        false,
      );
    }
    this.#defaultChunkSize = options.defaultChunkSize ?? 24;
    this.#defaultChunkDelayMs = options.defaultChunkDelayMs ?? 0;
    this.#repeatLastStep = options.repeatLastStep ?? true;
    this.#monotonicNow = options.monotonicNow ?? (() => performance.now());
    if (
      !Number.isInteger(this.#defaultChunkSize) ||
      this.#defaultChunkSize < 1 ||
      !Number.isFinite(this.#defaultChunkDelayMs) ||
      this.#defaultChunkDelayMs < 0
    ) {
      throw new CourtroomModelProviderError(
        "fake_configuration_error",
        "The scripted courtroom provider chunk configuration is invalid",
        false,
      );
    }
    this.#steps = steps;
  }

  rewind(): void {
    this.#nextStep = 0;
  }

  async generate<TSchema extends z.ZodObject>(
    request: CourtroomModelProviderRequest<TSchema>,
  ): Promise<CourtroomModelProviderResponse<z.output<TSchema>>> {
    const model = assertCourtroomModelProviderRequest(request);
    throwIfAborted(request.signal);
    this.requests.push(request);

    const stepIndex = this.#nextStep;
    if (stepIndex >= this.#steps.length && !this.#repeatLastStep) {
      throw new CourtroomModelProviderError(
        "fake_script_exhausted",
        "The scripted courtroom provider has no remaining step",
        false,
      );
    }
    const step = this.#steps[Math.min(stepIndex, this.#steps.length - 1)];
    this.#nextStep += 1;

    const started = this.#monotonicNow();
    const elapsedMs = () => Math.max(0, this.#monotonicNow() - started);
    let responseId: string | null = null;
    let failureEmitted = false;

    const emitFailure = (code: string) => {
      if (failureEmitted) return;
      failureEmitted = true;
      request.onStreamEvent?.({
        type: "response_failed",
        responseId,
        code,
        elapsedMs: elapsedMs(),
      });
    };

    try {
      if (step.type === "error") {
        emitFailure(step.code);
        throw new CourtroomModelProviderError(
          step.code,
          step.message,
          step.retryable,
          { retryAfterMs: step.retryAfterMs ?? null },
        );
      }

      const outputSource = step.output;
      const output =
        typeof outputSource === "function"
          ? await settleWithCancellation(
              Promise.resolve().then(() => outputSource(request)),
              request.signal,
            )
          : outputSource;
      throwIfAborted(request.signal);

      const parsedOutput = request.schema.safeParse(output);
      if (!parsedOutput.success) {
        throw new CourtroomModelProviderError(
          "fake_structured_output_invalid",
          "The scripted courtroom provider output does not match the requested schema",
          false,
          { cause: parsedOutput.error },
        );
      }

      const serialized = JSON.stringify(parsedOutput.data) ?? "null";
      const chunkSize = step.chunkSize ?? this.#defaultChunkSize;
      const chunkDelayMs = step.chunkDelayMs ?? this.#defaultChunkDelayMs;
      if (
        !Number.isInteger(chunkSize) ||
        chunkSize < 1 ||
        !Number.isFinite(chunkDelayMs) ||
        chunkDelayMs < 0
      ) {
        throw new CourtroomModelProviderError(
          "fake_configuration_error",
          "The scripted courtroom output step has invalid chunk configuration",
          false,
        );
      }
      const chunks = step.chunks ?? splitIntoChunks(serialized, chunkSize);
      if (chunks.length === 0 || chunks.join("") !== serialized) {
        throw new CourtroomModelProviderError(
          "fake_configuration_error",
          "Scripted structured deltas must concatenate to the serialized output",
          false,
        );
      }

      responseId =
        step.responseId ??
        `fake-courtroom-response-${Math.min(stepIndex + 1, this.#steps.length)}-${request.attempt}`;
      const requestId =
        step.requestId ??
        `fake-courtroom-request-${Math.min(stepIndex + 1, this.#steps.length)}-${request.attempt}`;
      request.onStreamEvent?.({
        type: "response_started",
        responseId,
        elapsedMs: elapsedMs(),
      });
      throwIfAborted(request.signal);

      let firstStructuredDeltaMs: number | null = null;
      let streamedCharacterCount = 0;
      for (const [index, delta] of chunks.entries()) {
        await pause(chunkDelayMs, request.signal);
        const deltaElapsedMs = elapsedMs();
        firstStructuredDeltaMs ??= deltaElapsedMs;
        streamedCharacterCount += delta.length;
        request.onStreamEvent?.({
          type: "structured_delta",
          responseId,
          delta,
          index: index + 1,
          elapsedMs: deltaElapsedMs,
        });
        throwIfAborted(request.signal);
      }

      request.onStreamEvent?.({
        type: "response_completed",
        responseId,
        elapsedMs: elapsedMs(),
      });
      throwIfAborted(request.signal);

      const inputText = [
        request.prompt.developerPrefix,
        request.prompt.developerContext,
        request.prompt.untrustedUserContent,
      ].join("\n");
      const inputTokens = approximateTokens(inputText);
      const outputTokens = approximateTokens(serialized);

      return {
        model,
        output: parsedOutput.data,
        requestId,
        responseId,
        latencyMs: elapsedMs(),
        firstStructuredDeltaMs,
        streamEventCount: chunks.length + 2,
        structuredDeltaCount: chunks.length,
        streamedCharacterCount,
        usage:
          step.usage === undefined
            ? {
                inputTokens,
                outputTokens,
                totalTokens: inputTokens + outputTokens,
                cachedInputTokens: 0,
                cacheWriteTokens: 0,
                reasoningTokens: 0,
              }
            : step.usage,
      };
    } catch (error) {
      if (error instanceof CourtroomModelProviderError) {
        if (error.code === "request_aborted") emitFailure(error.code);
        throw error;
      }
      emitFailure("fake_provider_failed");
      throw new CourtroomModelProviderError(
        "fake_provider_failed",
        "The scripted courtroom provider failed",
        false,
        { cause: error },
      );
    }
  }
}
