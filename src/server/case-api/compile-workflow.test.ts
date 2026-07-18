import { afterEach, describe, expect, it, vi } from "vitest";

import type { AcquireCaseCompileClaimResponse } from "../../../convex/caseCompileClaims";
import {
  CASE_COMPILE_WORKFLOW_HEARTBEAT_INTERVAL_MS,
  runCaseCompileWorkflow,
  type CaseCompileClaimCoordinator,
  type CaseCompileWorkflowDependencies,
  type CaseCompileWorkflowFailureClassification,
} from "./compile-workflow";

type Source = Readonly<{ packet: string }>;
type Ingestion = Readonly<{ segments: readonly string[] }>;
type Compilation = Readonly<{ title: string }>;
type Stored = Readonly<{ storageId: string }>;
type Registration = Readonly<{ caseId: string }>;
type Replay = Readonly<{ caseId: string; replayed: true }>;

const SOURCE: Source = { packet: "fictional packet" };
const INGESTION: Ingestion = { segments: ["segment-1"] };
const COMPILATION: Compilation = { title: "Nadia Flores v. Bellwether" };
const STORED: Stored = { storageId: "storage-1" };
const REGISTRATION: Registration = { caseId: `case:${"b".repeat(48)}` };
const REPLAY: Replay = { caseId: REGISTRATION.caseId, replayed: true };

const CLAIM_REQUEST = {
  ownerId: `owner:${"a".repeat(48)}`,
  uploadId: `upload:${"c".repeat(48)}`,
  caseId: REGISTRATION.caseId,
  contentDigest: "d".repeat(64),
  clientKeyHash: "e".repeat(64),
  leaseToken: "f".repeat(64),
} as const;

const ACQUIRED = {
  outcome: "acquired",
  acquisition: "new",
  claimId: `claim:${"1".repeat(64)}`,
  generation: 4,
  leaseToken: CLAIM_REQUEST.leaseToken,
  leaseExpiresAt: 60_000,
  heartbeatIntervalMs: CASE_COMPILE_WORKFLOW_HEARTBEAT_INTERVAL_MS,
} as const satisfies AcquireCaseCompileClaimResponse;

function deferred<T>(): Readonly<{
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}> {
  let resolvePromise: (value: T) => void = () => undefined;
  let rejectPromise: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

async function waitForCall(mock: ReturnType<typeof vi.fn>): Promise<void> {
  for (let attempt = 0; attempt < 20 && mock.mock.calls.length === 0; attempt += 1) {
    await Promise.resolve();
  }
  expect(mock).toHaveBeenCalled();
}

function createHarness(options: Readonly<{
  lookupCompleted?: CaseCompileClaimCoordinator<Replay>["lookupCompleted"];
  acquire?: CaseCompileClaimCoordinator<Replay>["acquire"];
  heartbeat?: CaseCompileClaimCoordinator<Replay>["heartbeat"];
  release?: CaseCompileClaimCoordinator<Replay>["release"];
  ingest?: CaseCompileWorkflowDependencies<
    Source,
    Ingestion,
    Compilation,
    Stored,
    Registration,
    Replay
  >["ingest"];
  compile?: CaseCompileWorkflowDependencies<
    Source,
    Ingestion,
    Compilation,
    Stored,
    Registration,
    Replay
  >["compile"];
  upload?: CaseCompileWorkflowDependencies<
    Source,
    Ingestion,
    Compilation,
    Stored,
    Registration,
    Replay
  >["upload"];
  register?: CaseCompileWorkflowDependencies<
    Source,
    Ingestion,
    Compilation,
    Stored,
    Registration,
    Replay
  >["register"];
  cleanup?: CaseCompileWorkflowDependencies<
    Source,
    Ingestion,
    Compilation,
    Stored,
    Registration,
    Replay
  >["cleanup"];
  classifyFailure?: (
    error: unknown,
    context: Parameters<
      NonNullable<
        CaseCompileWorkflowDependencies<
          Source,
          Ingestion,
          Compilation,
          Stored,
          Registration,
          Replay
        >["classifyFailure"]
      >
    >[1],
  ) => CaseCompileWorkflowFailureClassification;
}> = {}): Readonly<{
  dependencies: CaseCompileWorkflowDependencies<
    Source,
    Ingestion,
    Compilation,
    Stored,
    Registration,
    Replay
  >;
  coordinator: CaseCompileClaimCoordinator<Replay>;
  ingest: ReturnType<typeof vi.fn>;
  compile: ReturnType<typeof vi.fn>;
  upload: ReturnType<typeof vi.fn>;
  register: ReturnType<typeof vi.fn>;
  cleanup: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
}> {
  const lookupCompleted = vi.fn(options.lookupCompleted ?? (async () => null));
  const acquire = vi.fn(options.acquire ?? (async () => ACQUIRED));
  const heartbeat = vi.fn(options.heartbeat ?? (async () => ({
    claimId: ACQUIRED.claimId,
    generation: ACQUIRED.generation,
    leaseExpiresAt: 120_000,
    heartbeatIntervalMs: CASE_COMPILE_WORKFLOW_HEARTBEAT_INTERVAL_MS,
  })));
  const release = vi.fn(options.release ?? (async () => undefined));
  const ingest = vi.fn(options.ingest ?? (async () => INGESTION));
  const compile = vi.fn(options.compile ?? (async () => COMPILATION));
  const upload = vi.fn(options.upload ?? (async () => STORED));
  const register = vi.fn(options.register ?? (async () => REGISTRATION));
  const cleanup = vi.fn(options.cleanup ?? (async () => undefined));
  const coordinator: CaseCompileClaimCoordinator<Replay> = {
    lookupCompleted,
    acquire,
    heartbeat,
    release,
  };
  const dependencies: CaseCompileWorkflowDependencies<
    Source,
    Ingestion,
    Compilation,
    Stored,
    Registration,
    Replay
  > = {
    coordinator,
    ingest,
    compile,
    upload,
    register,
    cleanup,
    classifyFailure: options.classifyFailure,
  };
  return { dependencies, coordinator, ingest, compile, upload, register, cleanup, release };
}

function run(
  dependencies: CaseCompileWorkflowDependencies<
    Source,
    Ingestion,
    Compilation,
    Stored,
    Registration,
    Replay
  >,
  signal?: AbortSignal,
) {
  return runCaseCompileWorkflow({
    claimRequest: CLAIM_REQUEST,
    source: SOURCE,
    signal,
    dependencies,
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("case compile singleflight workflow", () => {
  it("allows one acquired worker while a concurrent request receives busy", async () => {
    const ingestionGate = deferred<Ingestion>();
    let acquisition = 0;
    const harness = createHarness({
      acquire: async () => {
        acquisition += 1;
        return acquisition === 1
          ? ACQUIRED
          : {
              outcome: "busy",
              claimId: ACQUIRED.claimId,
              retryAfterSeconds: 42,
            };
      },
      ingest: async () => ingestionGate.promise,
    });

    const first = run(harness.dependencies);
    await waitForCall(harness.ingest);
    const second = await run(harness.dependencies);

    expect(second).toEqual({
      outcome: "busy",
      claimId: ACQUIRED.claimId,
      retryAfterSeconds: 42,
    });
    expect(harness.ingest).toHaveBeenCalledTimes(1);
    expect(harness.compile).not.toHaveBeenCalled();

    ingestionGate.resolve(INGESTION);
    await expect(first).resolves.toMatchObject({ outcome: "compiled" });
    expect(harness.compile).toHaveBeenCalledTimes(1);
    expect(harness.upload).toHaveBeenCalledTimes(1);
  });

  it("replays a completed claim without ingestion, compilation, or storage", async () => {
    let lookup = 0;
    const harness = createHarness({
      lookupCompleted: async () => {
        lookup += 1;
        return lookup === 1 ? null : REPLAY;
      },
      acquire: async () => ({
        outcome: "completed",
        claimId: ACQUIRED.claimId,
        uploadId: CLAIM_REQUEST.uploadId,
        caseId: CLAIM_REQUEST.caseId,
        generation: ACQUIRED.generation,
      }),
    });

    await expect(run(harness.dependencies)).resolves.toEqual({
      outcome: "replayed",
      source: "completed_claim",
      replay: REPLAY,
    });
    expect(harness.ingest).not.toHaveBeenCalled();
    expect(harness.compile).not.toHaveBeenCalled();
    expect(harness.upload).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "quota",
      decision: { outcome: "quota_exceeded", retryAfterSeconds: 120 } as const,
      expected: { outcome: "quota_exceeded", retryAfterSeconds: 120 },
    },
    {
      name: "terminal claim",
      decision: {
        outcome: "terminal_failed",
        claimId: ACQUIRED.claimId,
        generation: ACQUIRED.generation,
      } as const,
      expected: {
        outcome: "terminal_failed",
        claimId: ACQUIRED.claimId,
        generation: ACQUIRED.generation,
      },
    },
  ])("returns the $name decision without starting work", async ({ decision, expected }) => {
    const harness = createHarness({ acquire: async () => decision });
    await expect(run(harness.dependencies)).resolves.toEqual(expected);
    expect(harness.ingest).not.toHaveBeenCalled();
    expect(harness.upload).not.toHaveBeenCalled();
  });

  it("rejects a semantically mismatched acquired lease before starting work", async () => {
    const harness = createHarness({
      acquire: async () => ({ ...ACQUIRED, leaseToken: "2".repeat(64) }),
    });

    await expect(run(harness.dependencies)).resolves.toMatchObject({
      outcome: "failed",
      error: { code: "CASE_COMPILE_CLAIM_FAILED", stage: "claim_acquire" },
      recovery: { release: "not_acquired" },
    });
    expect(harness.ingest).not.toHaveBeenCalled();
  });

  it("aborts work on request cancellation and releases a retryable claim", async () => {
    const controller = new AbortController();
    const harness = createHarness({
      ingest: async (_source, signal) => new Promise<Ingestion>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
    });

    const resultPromise = run(harness.dependencies, controller.signal);
    await waitForCall(harness.ingest);
    controller.abort(new Error("client disconnected"));
    const result = await resultPromise;

    expect(result).toMatchObject({
      outcome: "failed",
      error: {
        code: "CASE_COMPILE_REQUEST_CANCELLED",
        category: "cancelled",
        stage: "ingestion",
        retryable: true,
      },
      recovery: { release: "completed" },
    });
    expect(harness.release).toHaveBeenCalledWith(expect.objectContaining({
      claimId: ACQUIRED.claimId,
      generation: ACQUIRED.generation,
      leaseToken: ACQUIRED.leaseToken,
      disposition: "retryable_failed",
      failureCode: "CASE_COMPILE_REQUEST_CANCELLED",
    }));
    expect(harness.compile).not.toHaveBeenCalled();
  });

  it("reconciles and cleans uploaded storage when cancellation reaches registration", async () => {
    const controller = new AbortController();
    const harness = createHarness({
      register: async (_input, signal) => new Promise<Registration>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
    });

    const resultPromise = run(harness.dependencies, controller.signal);
    await waitForCall(harness.register);
    controller.abort(new Error("client disconnected after upload"));
    const result = await resultPromise;

    expect(result).toMatchObject({
      outcome: "failed",
      error: {
        code: "CASE_COMPILE_REQUEST_CANCELLED",
        category: "cancelled",
        stage: "registration",
      },
      recovery: {
        reconciliation: "miss",
        cleanup: "completed",
        release: "completed",
      },
    });
    expect(harness.cleanup).toHaveBeenCalledWith(expect.objectContaining({ storage: STORED }));
  });

  it("aborts on heartbeat lease loss and clears the heartbeat timer", async () => {
    vi.useFakeTimers();
    const harness = createHarness({
      heartbeat: async () => {
        throw new Error("CASE_COMPILE_CLAIM_FENCE");
      },
      ingest: async (_source, signal) => new Promise<Ingestion>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
    });

    const resultPromise = run(harness.dependencies);
    await waitForCall(harness.ingest);
    await vi.advanceTimersByTimeAsync(CASE_COMPILE_WORKFLOW_HEARTBEAT_INTERVAL_MS);
    const result = await resultPromise;

    expect(result).toMatchObject({
      outcome: "failed",
      error: {
        code: "CASE_COMPILE_LEASE_LOST",
        category: "lease_lost",
        stage: "heartbeat",
        retryable: true,
      },
    });
    expect(harness.release).toHaveBeenCalledWith(expect.objectContaining({
      claimId: ACQUIRED.claimId,
      generation: ACQUIRED.generation,
      leaseToken: ACQUIRED.leaseToken,
      disposition: "retryable_failed",
    }));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not register or clean up when storage fails", async () => {
    const harness = createHarness({
      upload: async () => {
        throw new Error("storage unavailable");
      },
    });

    const result = await run(harness.dependencies);
    expect(result).toMatchObject({
      outcome: "failed",
      error: { code: "CASE_STORAGE_FAILED", stage: "storage", retryable: true },
      recovery: { cleanup: "not_needed", release: "completed" },
    });
    expect(harness.register).not.toHaveBeenCalled();
    expect(harness.cleanup).not.toHaveBeenCalled();
  });

  it("reconciles a lost registration response before cleanup or release", async () => {
    let lookup = 0;
    const harness = createHarness({
      lookupCompleted: async () => {
        lookup += 1;
        return lookup === 1 ? null : REPLAY;
      },
      register: async () => {
        throw new Error("connection lost after commit");
      },
    });

    await expect(run(harness.dependencies)).resolves.toEqual({
      outcome: "replayed",
      source: "registration_reconciled",
      replay: REPLAY,
    });
    expect(harness.cleanup).not.toHaveBeenCalled();
    expect(harness.release).not.toHaveBeenCalled();
  });

  it("cleans uploaded storage and terminally releases a definite registration failure", async () => {
    const harness = createHarness({
      register: async () => {
        throw new Error("strict registration rejected");
      },
      classifyFailure: (_error, context) => {
        expect(context.stage).toBe("registration");
        return {
          code: "CASE_PACKET_REJECTED",
          category: "invalid_input",
          disposition: "terminal_failed",
          registrationOutcome: "definite_not_committed",
        };
      },
    });

    const result = await run(harness.dependencies);
    expect(result).toMatchObject({
      outcome: "failed",
      error: { code: "CASE_PACKET_REJECTED", retryable: false },
      recovery: { cleanup: "completed", release: "completed" },
    });
    expect(harness.cleanup).toHaveBeenCalledWith({
      identity: {
        ownerId: CLAIM_REQUEST.ownerId,
        uploadId: CLAIM_REQUEST.uploadId,
        caseId: CLAIM_REQUEST.caseId,
        contentDigest: CLAIM_REQUEST.contentDigest,
      },
      source: SOURCE,
      storage: STORED,
    });
    expect(harness.release).toHaveBeenCalledWith(expect.objectContaining({
      disposition: "terminal_failed",
      failureCode: "CASE_PACKET_REJECTED",
    }));
  });

  it("uses the acquired generation and lease token when a fenced release fails", async () => {
    const release = vi.fn(async (request: Parameters<CaseCompileClaimCoordinator<Replay>["release"]>[0]) => {
      expect(request).toMatchObject({
        ownerId: CLAIM_REQUEST.ownerId,
        uploadId: CLAIM_REQUEST.uploadId,
        caseId: CLAIM_REQUEST.caseId,
        contentDigest: CLAIM_REQUEST.contentDigest,
        claimId: ACQUIRED.claimId,
        generation: ACQUIRED.generation,
        leaseToken: ACQUIRED.leaseToken,
      });
      throw new Error("CASE_COMPILE_CLAIM_FENCE");
    });
    const harness = createHarness({
      compile: async () => {
        throw new Error("provider unavailable");
      },
      release,
    });

    const result = await run(harness.dependencies);
    expect(result).toMatchObject({
      outcome: "failed",
      error: { stage: "compilation" },
      recovery: { release: "failed" },
    });
    expect(release).toHaveBeenCalledTimes(1);
    expect(harness.upload).not.toHaveBeenCalled();
  });
});
