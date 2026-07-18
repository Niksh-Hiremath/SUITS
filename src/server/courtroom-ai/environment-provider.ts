import OpenAI from "openai";
import type { z } from "zod";

import { readServerEnv, type ServerEnv } from "@/lib/env";

import { COURTROOM_MODEL_PROVIDER_PROTOCOL_VERSION } from "./constants";
import { OpenAICourtroomModelProvider } from "./openai-provider";
import type {
  CourtroomModelProvider,
  CourtroomModelProviderRequest,
  CourtroomModelProviderResponse,
} from "./provider";
import { CourtroomModelProviderError } from "./provider";

type EnvironmentCourtroomModelProviderOptions = Readonly<{
  readEnvironment?: () => ServerEnv;
  createProvider?: (apiKey: string) => CourtroomModelProvider;
}>;

/**
 * Lazily reads the server-only API key so deterministic hearing commands do
 * not depend on model credentials. The first actual model call constructs and
 * then reuses one Responses API provider for any targeted repair attempt.
 */
export class EnvironmentCourtroomModelProvider
  implements CourtroomModelProvider
{
  readonly protocolVersion = COURTROOM_MODEL_PROVIDER_PROTOCOL_VERSION;
  readonly providerName = "openai-responses";

  readonly #readEnvironment: () => ServerEnv;
  readonly #createProvider: (apiKey: string) => CourtroomModelProvider;
  #delegate: CourtroomModelProvider | null = null;

  constructor(options: EnvironmentCourtroomModelProviderOptions = {}) {
    this.#readEnvironment = options.readEnvironment ?? (() => readServerEnv());
    this.#createProvider =
      options.createProvider ??
      ((apiKey) =>
        new OpenAICourtroomModelProvider(new OpenAI({ apiKey })));
  }

  async generate<TSchema extends z.ZodObject>(
    request: CourtroomModelProviderRequest<TSchema>,
  ): Promise<CourtroomModelProviderResponse<z.output<TSchema>>> {
    if (this.#delegate === null) {
      try {
        this.#delegate = this.#createProvider(
          this.#readEnvironment().OPENAI_API_KEY,
        );
      } catch (error) {
        throw new CourtroomModelProviderError(
          "openai_configuration_error",
          "The courtroom model provider is not configured",
          false,
          { cause: error },
        );
      }
    }
    return await this.#delegate.generate(request);
  }
}
