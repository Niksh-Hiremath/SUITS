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
  #inFlight: Promise<ServerPreflightResponse> | null = null;

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
    if (this.#inFlight !== null) return this.#inFlight;

    const inFlight = probe()
      .then((response) => {
        if (this.#inFlight !== inFlight) return response;
        this.#cached = Object.freeze({
          expiresAt:
            this.#now() +
            (response.overallStatus === "ready"
              ? this.#ttlMs
              : this.#degradedTtlMs),
          response,
        });
        this.#inFlight = null;
        return response;
      })
      .catch((error: unknown) => {
        if (this.#inFlight === inFlight) this.#inFlight = null;
        throw error;
      });
    this.#inFlight = inFlight;
    return inFlight;
  }

  clear(): void {
    this.#cached = null;
  }
}

export const serverPreflightCache = new ServerPreflightCache();
