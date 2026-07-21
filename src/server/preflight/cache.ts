import type { ServerPreflightResponse } from "@/domain/preflight";

export const SERVER_PREFLIGHT_CACHE_TTL_MS = 5 * 60 * 1_000;
export const SERVER_PREFLIGHT_DEGRADED_CACHE_TTL_MS = 15_000;

export class ServerPreflightCache {
  readonly #ttlMs: number;
  readonly #degradedTtlMs: number;
  readonly #now: () => number;
  #cached: Readonly<{
    expiresAt: number;
    response: ServerPreflightResponse;
  }> | null = null;
  #refreshSequence = 0;

  constructor(
    options: Readonly<{
      ttlMs?: number;
      degradedTtlMs?: number;
      now?: () => number;
    }> = {},
  ) {
    this.#ttlMs = options.ttlMs ?? SERVER_PREFLIGHT_CACHE_TTL_MS;
    this.#degradedTtlMs =
      options.degradedTtlMs ?? SERVER_PREFLIGHT_DEGRADED_CACHE_TTL_MS;
    this.#now = options.now ?? Date.now;
    if (!Number.isSafeInteger(this.#ttlMs) || this.#ttlMs < 1) {
      throw new Error("Server preflight cache TTL must be a positive integer");
    }
    if (
      !Number.isSafeInteger(this.#degradedTtlMs) ||
      this.#degradedTtlMs < 1
    ) {
      throw new Error(
        "Server preflight degraded cache TTL must be a positive integer",
      );
    }
  }

  get(
    probe: () => Promise<ServerPreflightResponse>,
  ): Promise<ServerPreflightResponse> {
    const cached = this.#cached;
    if (cached !== null && cached.expiresAt > this.#now()) {
      return Promise.resolve(cached.response);
    }

    // A pending promise can carry request-scoped I/O in Cloudflare Workers and
    // must never be shared through module state. Each cache miss owns its probe;
    // the sequence only prevents a slower result from replacing a newer one.
    const refreshSequence = ++this.#refreshSequence;
    return probe().then((response) => {
      if (this.#refreshSequence === refreshSequence) {
        this.#cached = Object.freeze({
          expiresAt:
            this.#now() +
            (response.overallStatus === "ready"
              ? this.#ttlMs
              : this.#degradedTtlMs),
          response,
        });
      }
      return response;
    });
  }

  clear(): void {
    this.#cached = null;
    this.#refreshSequence += 1;
  }
}

export const serverPreflightCache = new ServerPreflightCache();
