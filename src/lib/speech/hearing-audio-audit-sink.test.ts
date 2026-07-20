import { describe, expect, it, vi } from "vitest";

import {
  HearingAudioAuditIngestRequestSchema,
  type HearingAudioAuditRecord,
} from "./hearing-audio-audit";
import {
  createHearingAudioAuditSink,
  createMonotonicEpochClock,
  type HearingAudioAuditSink,
  type HearingAudioAuditSinkFetch,
  type HearingAudioAuditSinkScheduler,
} from "./hearing-audio-audit-sink";
import {
  HEARING_PERFORMANCE_EVENT_SCHEMA_VERSION,
  freezeHearingPerformanceEvent,
  type HearingPerformanceEvent,
} from "./hearing-performance";

const TRIAL_ID = `trial_${"a".repeat(32)}`;
const OTHER_TRIAL_ID = `trial_${"b".repeat(32)}`;

type ScheduledTask = {
  readonly callback: () => void;
  readonly delayMs: number;
  cancelled: boolean;
};

class FakeScheduler implements HearingAudioAuditSinkScheduler {
  readonly tasks: ScheduledTask[] = [];

  schedule = (callback: () => void, delayMs: number): (() => void) => {
    const task: ScheduledTask = { callback, delayMs, cancelled: false };
    this.tasks.push(task);
    return () => {
      task.cancelled = true;
    };
  };

  get pending(): readonly ScheduledTask[] {
    return this.tasks.filter((task) => !task.cancelled);
  }

  runNext(): void {
    const task = this.pending[0];
    if (task === undefined) throw new Error("No scheduled task");
    task.cancelled = true;
    task.callback();
  }
}

function deferred<T>(): Readonly<{
  promise: Promise<T>;
  resolve: (value: T) => void;
}> {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value: T): void => {
      if (resolvePromise === undefined) throw new Error("Deferred is unavailable");
      resolvePromise(value);
    },
  };
}

async function drainMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

function createEpochSource(start = 10_000): () => number {
  let epochMs = start;
  return () => {
    epochMs += 10;
    return epochMs;
  };
}

function userSpeechEvent(
  generation: number,
  type: "user_speech_started" | "user_speech_ended",
  utteranceId = `utterance:audit:${generation}`,
  mode: "question" | "closing" = "question",
): HearingPerformanceEvent {
  const common = {
    schemaVersion: HEARING_PERFORMANCE_EVENT_SCHEMA_VERSION,
    generation,
    utteranceId,
    sceneActor: "user_counsel" as const,
    mode,
    observedAtMs: generation * 100,
    timestampSource: "speech_service" as const,
  };
  return type === "user_speech_started"
    ? freezeHearingPerformanceEvent({
        ...common,
        type: "user_speech_started",
      })
    : freezeHearingPerformanceEvent({
        ...common,
        type: "user_speech_ended",
        reason: "vad_end",
      });
}

function completeUserSpeech(
  sink: HearingAudioAuditSink,
  generation: number,
  utteranceId = `utterance:audit:${generation}`,
  mode: "question" | "closing" = "question",
): readonly [string, string] {
  return [
    sink.observe(
      userSpeechEvent(generation, "user_speech_started", utteranceId, mode),
    ),
    sink.observe(
      userSpeechEvent(generation, "user_speech_ended", utteranceId, mode),
    ),
  ];
}

function requestFrom(init: RequestInit): Readonly<{
  record: HearingAudioAuditRecord;
}> {
  return HearingAudioAuditIngestRequestSchema.parse(
    JSON.parse(String(init.body)),
  );
}

function acceptedResponse(init: RequestInit, replayed = false): Response {
  const request = requestFrom(init);
  return Response.json({ recordId: request.record.recordId, replayed });
}

describe("HearingAudioAuditSink", () => {
  it("posts one exact metadata-only keepalive body only after a terminal event", async () => {
    const calls: Array<{ input: string; init: RequestInit }> = [];
    const fetcher: HearingAudioAuditSinkFetch = async (input, init) => {
      calls.push({ input, init });
      return acceptedResponse(init);
    };
    const sink = createHearingAudioAuditSink({
      trialId: TRIAL_ID,
      fetch: fetcher,
      epochSource: createEpochSource(),
    });

    expect(
      sink.observe(userSpeechEvent(1, "user_speech_started")),
    ).toBe("accepted");
    expect(calls).toHaveLength(0);
    expect(sink.observe(userSpeechEvent(1, "user_speech_ended"))).toBe(
      "record_ready",
    );
    expect(calls).toHaveLength(1);

    const call = calls[0];
    if (call === undefined) throw new Error("Missing fetch call");
    expect(call.input).toBe(`/api/hearings/${TRIAL_ID}/audio-audits`);
    expect(call.init.method).toBe("POST");
    expect(call.init.credentials).toBe("same-origin");
    expect(call.init.cache).toBe("no-store");
    expect(call.init.keepalive).toBe(true);
    expect(new Headers(call.init.headers).get("content-type")).toBe(
      "application/json",
    );
    const request = requestFrom(call.init);
    expect(JSON.parse(String(call.init.body))).toEqual(request);
    expect(call.init.body).toBe(JSON.stringify({ record: request.record }));
    expect(String(call.init.body)).not.toMatch(
      /rawAudio|transcript|timingMarks|providerError|ownerId/u,
    );

    await drainMicrotasks();
    expect(sink.snapshot).toEqual({
      schemaVersion: "hearing-audio-audit-sink-diagnostic.v1",
      status: "active",
      queueDepth: 0,
      inFlight: false,
      attempt: 0,
      lastDiagnosticCode: "none",
    });
    expect(JSON.stringify(sink.snapshot)).not.toContain(TRIAL_ID);
    expect(JSON.stringify(sink.snapshot)).not.toContain(request.record.recordId);
    await sink.close();
  });

  it("retries the identical serialized bytes and accepts an idempotent replay receipt", async () => {
    const scheduler = new FakeScheduler();
    const calls: Array<{ input: string; init: RequestInit }> = [];
    const fetcher: HearingAudioAuditSinkFetch = async (input, init) => {
      calls.push({ input, init });
      if (calls.length === 1) throw new TypeError("network unavailable");
      return acceptedResponse(init, true);
    };
    const sink = createHearingAudioAuditSink({
      trialId: TRIAL_ID,
      fetch: fetcher,
      scheduler,
      retryDelaysMs: [20],
      random: () => 0.5,
      epochSource: createEpochSource(),
    });

    completeUserSpeech(sink, 1);
    await drainMicrotasks();
    expect(calls).toHaveLength(1);
    expect(scheduler.pending.map((task) => task.delayMs)).toEqual([20]);
    expect(sink.snapshot.status).toBe("retry_wait");

    scheduler.runNext();
    expect(calls).toHaveLength(2);
    expect(calls[1]?.input).toBe(calls[0]?.input);
    expect(calls[1]?.init.body).toBe(calls[0]?.init.body);
    await drainMicrotasks();
    expect(sink.snapshot.queueDepth).toBe(0);
    expect(sink.snapshot.status).toBe("active");
    await sink.close();
  });

  it("never retries permanent 4xx responses or mismatched receipts", async () => {
    const cases = [
      {
        expectedDiagnostic: "request_rejected" as const,
        response: (): Response =>
          Response.json({ error: { code: "REJECTED" } }, { status: 422 }),
      },
      {
        expectedDiagnostic: "receipt_mismatch" as const,
        response: (): Response =>
          Response.json({ recordId: "f".repeat(64), replayed: false }),
      },
    ];

    for (const testCase of cases) {
      const scheduler = new FakeScheduler();
      const fetcher = vi.fn<HearingAudioAuditSinkFetch>(async () =>
        testCase.response(),
      );
      const sink = createHearingAudioAuditSink({
        trialId: TRIAL_ID,
        fetch: fetcher,
        scheduler,
        retryDelaysMs: [10, 20],
        epochSource: createEpochSource(),
      });

      completeUserSpeech(sink, 1);
      await drainMicrotasks();
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(scheduler.pending).toHaveLength(0);
      expect(sink.snapshot).toMatchObject({
        status: "disabled",
        queueDepth: 0,
        lastDiagnosticCode: testCase.expectedDiagnostic,
      });
      expect(
        sink.observe(userSpeechEvent(2, "user_speech_started")),
      ).toBe("disabled");
      await sink.close();
    }
  });

  it("drains multiple utterances from one controller generation in order", async () => {
    const first = deferred<Response>();
    const calls: Array<RequestInit> = [];
    const fetcher: HearingAudioAuditSinkFetch = (input, init) => {
      void input;
      calls.push(init);
      if (calls.length === 1) return first.promise;
      return Promise.resolve(acceptedResponse(init));
    };
    const sink = createHearingAudioAuditSink({
      trialId: TRIAL_ID,
      fetch: fetcher,
      epochSource: createEpochSource(),
    });

    expect(completeUserSpeech(sink, 1, "utterance:question:1")).toEqual([
      "accepted",
      "record_ready",
    ]);
    expect(completeUserSpeech(sink, 1, "utterance:question:2")).toEqual([
      "accepted",
      "record_ready",
    ]);
    expect(
      completeUserSpeech(sink, 1, "utterance:closing:1", "closing"),
    ).toEqual(["accepted", "record_ready"]);
    expect(calls).toHaveLength(1);
    expect(sink.snapshot).toMatchObject({ queueDepth: 3, inFlight: true });

    const firstCall = calls[0];
    if (firstCall === undefined) throw new Error("Missing first request");
    first.resolve(acceptedResponse(firstCall));
    await sink.close();
    expect(calls).toHaveLength(3);
    const records = calls.map((call) => requestFrom(call).record);
    const userRecords = records.map((record) => {
      if (record.kind !== "user_speech") {
        throw new Error("Expected a user speech audit record");
      }
      return record;
    });
    expect(userRecords.map(({ identity }) => identity.utteranceId)).toEqual([
      "utterance:question:1",
      "utterance:question:2",
      "utterance:closing:1",
    ]);
    expect(userRecords.map(({ identity }) => identity.generation)).toEqual([
      1, 1, 1,
    ]);
    expect(userRecords).toEqual([
      expect.objectContaining({ mode: "question" }),
      expect.objectContaining({ mode: "question" }),
      expect.objectContaining({ mode: "closing" }),
    ]);
    expect(sink.snapshot).toMatchObject({
      status: "closed",
      queueDepth: 0,
      inFlight: false,
    });
  });

  it("fails stop at the queue bound without disturbing the in-flight request", async () => {
    const first = deferred<Response>();
    const calls: RequestInit[] = [];
    const fetcher: HearingAudioAuditSinkFetch = (input, init) => {
      void input;
      calls.push(init);
      return first.promise;
    };
    const sink = createHearingAudioAuditSink({
      trialId: TRIAL_ID,
      fetch: fetcher,
      maxQueueRecords: 1,
      epochSource: createEpochSource(),
    });

    completeUserSpeech(sink, 1);
    expect(completeUserSpeech(sink, 2)).toEqual([
      "accepted",
      "capacity_rejected",
    ]);
    expect(calls).toHaveLength(1);
    expect(sink.snapshot).toMatchObject({
      status: "disabled",
      queueDepth: 1,
      inFlight: true,
      lastDiagnosticCode: "queue_capacity_exceeded",
    });
    expect(sink.observe(userSpeechEvent(3, "user_speech_started"))).toBe(
      "disabled",
    );

    const firstCall = calls[0];
    if (firstCall === undefined) throw new Error("Missing first request");
    first.resolve(acceptedResponse(firstCall));
    await drainMicrotasks();
    expect(calls).toHaveLength(1);
    expect(sink.snapshot).toMatchObject({ queueDepth: 0, inFlight: false });
    await sink.close();
  });

  it("expedites backoff once without allowing the cancelled timer to duplicate delivery", async () => {
    const scheduler = new FakeScheduler();
    const calls: RequestInit[] = [];
    const fetcher: HearingAudioAuditSinkFetch = async (input, init) => {
      void input;
      calls.push(init);
      if (calls.length === 1) throw new TypeError("offline");
      return acceptedResponse(init);
    };
    const sink = createHearingAudioAuditSink({
      trialId: TRIAL_ID,
      fetch: fetcher,
      scheduler,
      retryDelaysMs: [1_000],
      random: () => 0.5,
      epochSource: createEpochSource(),
    });

    completeUserSpeech(sink, 1);
    await drainMicrotasks();
    expect(calls).toHaveLength(1);
    expect(scheduler.pending).toHaveLength(1);

    sink.expedite();
    expect(calls).toHaveLength(2);
    expect(scheduler.pending).toHaveLength(0);
    await drainMicrotasks();
    expect(calls).toHaveLength(2);
    expect(sink.snapshot.queueDepth).toBe(0);
    await sink.close();
  });

  it("cancels backoff and makes one immediate exact-body final attempt on close", async () => {
    const scheduler = new FakeScheduler();
    const calls: RequestInit[] = [];
    const fetcher: HearingAudioAuditSinkFetch = async (input, init) => {
      void input;
      calls.push(init);
      if (calls.length === 1) throw new TypeError("temporarily offline");
      return acceptedResponse(init, true);
    };
    const sink = createHearingAudioAuditSink({
      trialId: TRIAL_ID,
      fetch: fetcher,
      scheduler,
      retryDelaysMs: [2_000],
      random: () => 0.5,
      epochSource: createEpochSource(),
    });

    completeUserSpeech(sink, 1);
    await drainMicrotasks();
    expect(calls).toHaveLength(1);
    expect(scheduler.pending.map((task) => task.delayMs)).toEqual([2_000]);

    const closing = sink.close();
    expect(calls).toHaveLength(2);
    expect(calls[1]?.body).toBe(calls[0]?.body);
    expect(scheduler.pending).toHaveLength(0);
    await closing;
    expect(calls).toHaveLength(2);
    expect(scheduler.pending).toHaveLength(0);
    expect(sink.snapshot).toMatchObject({
      status: "closed",
      queueDepth: 0,
      inFlight: false,
    });
  });

  it("pins a strict V3 trial path even if the source options object changes", async () => {
    const calls: string[] = [];
    const fetcher: HearingAudioAuditSinkFetch = async (input, init) => {
      calls.push(input);
      return acceptedResponse(init);
    };
    const options = {
      trialId: TRIAL_ID,
      fetch: fetcher,
      epochSource: createEpochSource(),
    };
    const sink = createHearingAudioAuditSink(options);
    options.trialId = OTHER_TRIAL_ID;

    completeUserSpeech(sink, 1);
    await drainMicrotasks();
    expect(sink.trialId).toBe(TRIAL_ID);
    expect(calls).toEqual([`/api/hearings/${TRIAL_ID}/audio-audits`]);
    expect(() =>
      createHearingAudioAuditSink({ trialId: "trial_legacy", fetch: fetcher }),
    ).toThrow(/Expected a V3 hearing trial ID/u);
    await sink.close();
  });

  it("clamps regressing or invalid epoch sources monotonically", () => {
    const values: Array<number | Error> = [
      1_000.4,
      900.2,
      Number.POSITIVE_INFINITY,
      new Error("clock failed"),
      1_100.6,
    ];
    const clock = createMonotonicEpochClock(() => {
      const value = values.shift();
      if (value instanceof Error) throw value;
      if (value === undefined) throw new Error("Clock fixture exhausted");
      return value;
    });

    expect(Array.from({ length: 5 }, () => clock.nowEpochMs())).toEqual([
      1_000,
      1_000,
      1_000,
      1_000,
      1_101,
    ]);
  });

  it("keeps observation and diagnostics no-throw and waits for the final close drain", async () => {
    const pending = deferred<Response>();
    let request: RequestInit | null = null;
    const sink = createHearingAudioAuditSink({
      trialId: TRIAL_ID,
      fetch: (input, init) => {
        void input;
        request = init;
        return pending.promise;
      },
      epochSource: createEpochSource(),
      onDiagnostic: () => {
        throw new Error("observer failure");
      },
    });

    expect(() =>
      sink.observe({ type: "not-an-event" } as unknown as HearingPerformanceEvent),
    ).not.toThrow();
    expect(
      sink.observe({ type: "not-an-event" } as unknown as HearingPerformanceEvent),
    ).toBe("event_rejected");
    completeUserSpeech(sink, 1);
    const closing = sink.close();
    let closed = false;
    void closing.then(() => {
      closed = true;
    });
    await drainMicrotasks();
    expect(closed).toBe(false);
    expect(sink.observe(userSpeechEvent(2, "user_speech_started"))).toBe(
      "closed",
    );

    if (request === null) throw new Error("Missing close-drain request");
    pending.resolve(acceptedResponse(request));
    await closing;
    expect(sink.snapshot.status).toBe("closed");
    expect(closed).toBe(true);
  });
});
