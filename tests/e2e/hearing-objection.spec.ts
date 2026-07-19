import { expect, test, type Page } from "@playwright/test";

import {
  FinalBoundInterruptionRequestSchema,
  FinalBoundInterruptionResolutionSchema,
} from "../../src/domain/objections/final-bound-contracts";

type JsonControl = Readonly<Record<string, unknown>>;

type Observation =
  | Readonly<{
      order: number;
      kind: "audio";
      event: "ended" | "start" | "stop";
    }>
  | Readonly<{
      order: number;
      kind: "request";
      method: string;
      pathname: string;
    }>
  | Readonly<{
      order: number;
      kind: "ws_received" | "ws_sent";
      control: JsonControl;
    }>;

type UnorderedObservation = Observation extends infer Entry
  ? Entry extends { order: number }
    ? Omit<Entry, "order">
    : never
  : never;

function parseControl(payload: unknown): JsonControl | null {
  if (typeof payload !== "string") return null;
  try {
    const parsed = JSON.parse(payload) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as JsonControl)
      : null;
  } catch {
    return null;
  }
}

async function waitForObservation(
  observations: readonly Observation[],
  predicate: (observation: Observation) => boolean,
  timeout = 15_000,
): Promise<Observation> {
  let matched: Observation | undefined;
  await expect
    .poll(
      () => {
        matched = observations.find(predicate);
        return matched !== undefined;
      },
      { timeout },
    )
    .toBe(true);
  if (matched === undefined) throw new Error("Expected observation was not recorded");
  return matched;
}

function controlIs(
  observation: Observation,
  kind: "ws_received" | "ws_sent",
  type: string,
): observation is Extract<Observation, { kind: "ws_received" | "ws_sent" }> {
  return observation.kind === kind && observation.control.type === type;
}

async function installAudioProbe(
  page: Page,
  record: (
    observation: Omit<Extract<Observation, { kind: "audio" }>, "order">,
  ) => void,
): Promise<void> {
  await page.exposeFunction(
    "__suitsE2EAudioProbe",
    (event: "ended" | "start" | "stop") => record({ kind: "audio", event }),
  );
  await page.addInitScript(() => {
    const scope = window as typeof window & {
      __suitsE2EAudioProbe: (event: "ended" | "start" | "stop") => void;
      __suitsE2EAudioState: {
        slowNextStart: boolean;
        nextOrder: number;
        nextSourceId: number;
        events: Array<{
          order: number;
          event:
            | "ended"
            | "interruption_fetch"
            | "objection_synthesize"
            | "ruling_synthesize"
            | "start"
            | "stop";
          sourceId: number | null;
        }>;
      };
    };
    const state = {
      slowNextStart: false,
      nextOrder: 0,
      nextSourceId: 0,
      events: [] as Array<{
        order: number;
        event:
          | "ended"
          | "interruption_fetch"
          | "objection_synthesize"
          | "ruling_synthesize"
          | "start"
          | "stop";
        sourceId: number | null;
      }>,
    };
    Object.defineProperty(scope, "__suitsE2EAudioState", {
      configurable: false,
      enumerable: false,
      value: state,
      writable: false,
    });
    const recordLocal = (
      event:
        | "ended"
        | "interruption_fetch"
        | "objection_synthesize"
        | "ruling_synthesize"
        | "start"
        | "stop",
      sourceId: number | null = null,
    ): void => {
      state.events.push({ order: ++state.nextOrder, event, sourceId });
      if (event === "ended" || event === "start" || event === "stop") {
        scope.__suitsE2EAudioProbe(event);
      }
    };
    const sourceIds = new WeakMap<AudioBufferSourceNode, number>();
    const prototype = AudioBufferSourceNode.prototype;
    const originalStart = prototype.start;
    const originalStop = prototype.stop;
    prototype.start = function (...arguments_: Parameters<AudioBufferSourceNode["start"]>) {
      if (scope.__suitsE2EAudioState.slowNextStart) {
        scope.__suitsE2EAudioState.slowNextStart = false;
        this.playbackRate.value = 0.05;
      }
      const sourceId = ++state.nextSourceId;
      sourceIds.set(this, sourceId);
      const runtimeOnEnded = this.onended;
      this.onended = function (event) {
        recordLocal("ended", sourceId);
        runtimeOnEnded?.call(this, event);
      };
      recordLocal("start", sourceId);
      return Reflect.apply(originalStart, this, arguments_);
    };
    prototype.stop = function (...arguments_: Parameters<AudioBufferSourceNode["stop"]>) {
      recordLocal("stop", sourceIds.get(this) ?? null);
      return Reflect.apply(originalStop, this, arguments_);
    };
    const originalFetch = scope.fetch.bind(scope);
    scope.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const requestUrl =
        typeof input === "string"
          ? new URL(input, scope.location.href)
          : input instanceof URL
            ? input
            : new URL(input.url, scope.location.href);
      if (/\/api\/hearings\/[^/]+\/interruptions$/u.test(requestUrl.pathname)) {
        recordLocal("interruption_fetch");
      }
      return originalFetch(input, init);
    }) as typeof scope.fetch;
    const originalWebSocketSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data: string | ArrayBufferLike | Blob | ArrayBufferView) {
      if (typeof data === "string") {
        try {
          const control = JSON.parse(data) as Record<string, unknown>;
          if (
            control.type === "synthesize" &&
            control.clipId === "courtroom.objection.v1"
          ) {
            recordLocal("objection_synthesize");
          } else if (
            control.type === "synthesize" &&
            control.clipId === "courtroom.overruled.v1"
          ) {
            recordLocal("ruling_synthesize");
          }
        } catch {
          // Binary audio and invalid data remain outside the observation ledger.
        }
      }
      return Reflect.apply(originalWebSocketSend, this, [data]);
    };
  });
}

test.describe("production-path partial objection", () => {
  test.describe.configure({ mode: "serial" });

  test("interrupts before final STT, cancels playback, commits a ruling, and resumes", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    let nextOrder = 0;
    const observations: Observation[] = [];
    const record = (observation: UnorderedObservation): void => {
      observations.push({ ...observation, order: ++nextOrder } as Observation);
    };
    const browserErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });
    page.on("pageerror", (error) => browserErrors.push(error.message));
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/api/hearings/")) {
        record({
          kind: "request",
          method: request.method(),
          pathname: url.pathname,
        });
      }
    });
    page.on("websocket", (socket) => {
      if (!socket.url().includes("127.0.0.1:18765/v1/speech")) return;
      socket.on("framesent", ({ payload }) => {
        const control = parseControl(payload);
        if (control !== null) record({ kind: "ws_sent", control });
      });
      socket.on("framereceived", ({ payload }) => {
        const control = parseControl(payload);
        if (control !== null) record({ kind: "ws_received", control });
      });
    });
    await installAudioProbe(page, (observation) => record(observation));

    const response = await page.goto("/hearing/");
    expect(response?.ok()).toBe(true);
    await page.getByRole("button", { name: "Begin V3 hearing" }).click();
    const callWitness = page.getByRole("button", { name: "Call witness" }).first();
    await expect(callWitness).toBeVisible({ timeout: 30_000 });
    await callWitness.click();
    await expect(
      page.getByRole("button", { name: "Start spoken question" }),
    ).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "Prepare local audio" }).click();
    await expect(page.getByText("Local courtroom audio ready", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await waitForObservation(
      observations,
      (entry) =>
        controlIs(entry, "ws_received", "ready") &&
        entry.control.mode === "fake",
    );
    await waitForObservation(
      observations,
      (entry) =>
        controlIs(entry, "ws_received", "capabilities") &&
        Array.isArray(entry.control.cachedClipIds) &&
        entry.control.cachedClipIds.includes("courtroom.objection.v1") &&
        Array.isArray(entry.control.providers) &&
        entry.control.providers
          .filter(
            (provider): provider is JsonControl =>
              typeof provider === "object" &&
              provider !== null &&
              !Array.isArray(provider),
          )
          .filter(
            (provider) => provider.kind === "stt" || provider.kind === "tts",
          )
          .every((provider) => provider.ready === true),
    );

    const commandRequestsBeforeRecording = observations.filter(
      (entry) =>
        entry.kind === "request" &&
        entry.method === "POST" &&
        entry.pathname.endsWith("/commands"),
    ).length;
    const audioStartBaseline = observations.filter(
      (entry) => entry.kind === "audio" && entry.event === "start",
    ).length;
    await page.evaluate(() => {
      (
        window as typeof window & {
          __suitsE2EAudioState: { slowNextStart: boolean };
        }
      ).__suitsE2EAudioState.slowNextStart = true;
    });
    await page.getByRole("button", { name: "Test speaker" }).click();
    const speakerStart = await waitForObservation(
      observations,
      (entry) =>
        entry.kind === "audio" &&
        entry.event === "start" &&
        observations
          .filter((candidate) => candidate.kind === "audio" && candidate.event === "start")
          .indexOf(entry) >= audioStartBaseline,
    );
    await page
      .getByRole("button", { name: "Interrupt and ask question" })
      .click();

    const playbackStop = await waitForObservation(
      observations,
      (entry) =>
        entry.kind === "audio" &&
        entry.event === "stop" &&
        entry.order > speakerStart.order,
    );
    const bargeIn = await waitForObservation(
      observations,
      (entry) =>
        controlIs(entry, "ws_sent", "cancel_synthesis") &&
        entry.control.reason === "barge_in",
    );
    const utteranceStart = await waitForObservation(
      observations,
      (entry) => controlIs(entry, "ws_sent", "start_utterance"),
    );
    expect(playbackStop.order).toBeLessThan(utteranceStart.order);
    expect(bargeIn.order).toBeLessThan(utteranceStart.order);

    const triggerPartial = await waitForObservation(
      observations,
      (entry) =>
        controlIs(entry, "ws_received", "stt_partial") &&
        entry.control.revision === 3 &&
        entry.control.text ===
          "Isn't it true that the warning light was already red, correct?",
    );
    const objectionClip = await waitForObservation(
      observations,
      (entry) =>
        controlIs(entry, "ws_sent", "synthesize") &&
        entry.control.clipId === "courtroom.objection.v1",
    );
    const finalTranscript = await waitForObservation(
      observations,
      (entry) =>
        controlIs(entry, "ws_received", "stt_final") &&
        entry.control.revision === 4 &&
        entry.control.text ===
          "Isn't it true that the warning light was already red, correct?",
    );
    expect(triggerPartial.order).toBeLessThan(objectionClip.order);
    expect(objectionClip.order).toBeLessThan(finalTranscript.order);
    expect(
      observations.some(
        (entry) =>
          controlIs(entry, "ws_sent", "audio_chunk") &&
          entry.order > objectionClip.order,
      ),
    ).toBe(false);

    const interruptionResponse = await page.waitForResponse(
      (candidate) =>
        candidate.request().method() === "POST" &&
        /\/api\/hearings\/[^/]+\/interruptions$/u.test(
          new URL(candidate.url()).pathname,
        ),
      { timeout: 45_000 },
    );
    expect(interruptionResponse.ok()).toBe(true);
    const interruptionRequestObservation = observations.find(
      (entry) =>
        entry.kind === "request" &&
        entry.method === "POST" &&
        entry.pathname.endsWith("/interruptions"),
    );
    expect(interruptionRequestObservation).toBeDefined();
    expect(finalTranscript.order).toBeLessThan(
      interruptionRequestObservation?.order ?? Number.POSITIVE_INFINITY,
    );

    const requestBody = FinalBoundInterruptionRequestSchema.parse(
      interruptionResponse.request().postDataJSON(),
    );
    expect(Object.keys(requestBody).sort()).toEqual([
      "final",
      "head",
      "schemaVersion",
      "trigger",
      "utterance",
    ]);
    expect(requestBody.trigger.revision).toBe(3);
    expect(requestBody.final.revision).toBe(4);
    const resolution = FinalBoundInterruptionResolutionSchema.parse(
      await interruptionResponse.json(),
    );
    expect(resolution).toMatchObject({
      disposition: "ruling_committed",
      ruling: "overruled",
      remedy: "resume_response",
      continuation: "complete",
    });
    if (resolution.disposition !== "ruling_committed") {
      throw new Error("Expected a committed interruption ruling");
    }
    expect(resolution.view.trial.version).toBeGreaterThan(
      requestBody.head.stateVersion,
    );

    const overruledClip = await waitForObservation(
      observations,
      (entry) =>
        controlIs(entry, "ws_sent", "synthesize") &&
        entry.control.clipId === "courtroom.overruled.v1",
      30_000,
    );
    const resumedWitness = await waitForObservation(
      observations,
      (entry) =>
        controlIs(entry, "ws_sent", "synthesize") &&
        entry.control.text === "I do not recall that.",
      30_000,
    );
    expect(objectionClip.order).toBeLessThan(overruledClip.order);
    expect(overruledClip.order).toBeLessThan(resumedWitness.order);
    const localAudioEvents = await page.evaluate(() =>
      (
        window as typeof window & {
          __suitsE2EAudioState: {
            events: Array<{
              order: number;
              event:
                | "ended"
                | "interruption_fetch"
                | "objection_synthesize"
                | "ruling_synthesize"
                | "start"
                | "stop";
              sourceId: number | null;
            }>;
          };
        }
      ).__suitsE2EAudioState.events,
    );
    const objectionSynthesis = localAudioEvents.find(
      (entry) => entry.event === "objection_synthesize",
    );
    const rulingSynthesis = localAudioEvents.find(
      (entry) => entry.event === "ruling_synthesize",
    );
    const interruptionFetch = localAudioEvents.find(
      (entry) => entry.event === "interruption_fetch",
    );
    expect(objectionSynthesis).toBeDefined();
    expect(rulingSynthesis).toBeDefined();
    expect(interruptionFetch).toBeDefined();
    const objectionStarts = localAudioEvents.filter(
      (entry) =>
        entry.event === "start" &&
        entry.sourceId !== null &&
        entry.order >
          (objectionSynthesis?.order ?? Number.NEGATIVE_INFINITY) &&
        entry.order < (rulingSynthesis?.order ?? Number.POSITIVE_INFINITY),
    );
    expect(objectionStarts.length).toBeGreaterThan(0);
    for (const start of objectionStarts) {
      expect(
        localAudioEvents.some(
          (entry) =>
            entry.event === "ended" &&
            entry.sourceId === start.sourceId &&
            entry.order > start.order &&
            entry.order <
              (rulingSynthesis?.order ?? Number.POSITIVE_INFINITY),
        ),
      ).toBe(true);
      expect(
        localAudioEvents.some(
          (entry) =>
            entry.event === "stop" &&
            entry.sourceId === start.sourceId &&
            entry.order > start.order &&
            entry.order <
              (rulingSynthesis?.order ?? Number.POSITIVE_INFINITY),
        ),
      ).toBe(false);
    }
    await expect(page.getByText("I do not recall that.", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("Local courtroom audio ready", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/Objection telemetry/u)).toContainText(
      "1 candidate",
    );

    const commandRequestsAfterRuling = observations.filter(
      (entry) =>
        entry.kind === "request" &&
        entry.method === "POST" &&
        entry.pathname.endsWith("/commands"),
    ).length;
    expect(commandRequestsAfterRuling).toBe(commandRequestsBeforeRecording);
    expect(browserErrors).toEqual([]);
  });
});
