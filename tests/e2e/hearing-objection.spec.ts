import {
  expect,
  test,
  type Locator,
  type Page,
  type Response,
  type TestInfo,
} from "@playwright/test";

import {
  HearingPlayerCommandSchema,
  HearingRuntimeViewV1Schema,
  HearingTrialIdSchema,
  type HearingRuntimeViewV1,
} from "../../src/domain/hearing-runtime";
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

type LocalAudioEvent = Readonly<{
  order: number;
  atMs: number;
  scheduledStartAtMs: number | null;
  event:
    | "dialogue_synthesize"
    | "ended"
    | "interruption_fetch"
    | "objection_synthesize"
    | "ruling_synthesize"
    | "start"
    | "stop";
  sourceId: number | null;
}>;

type PerformanceActorObservation = Readonly<{
  slot: string;
  animation: string | null;
  posture: string | null;
  mouthActive: string | null;
}>;

type PerformanceObservation = Readonly<{
  order: number;
  atMs: number;
  activeSceneActor: string | null;
  performanceSource: string | null;
  performancePurpose: string | null;
  cameraShot: string | null;
  cameraTransition: string | null;
  actors: readonly PerformanceActorObservation[];
  canvasMouthActor: string | null;
  canvasMouthShape: string | null;
}>;

test.use({ video: "on" });

async function saveSuccessVideo(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  const video = page.video();
  await page.close();
  if (video === null) return;
  const outputPath = testInfo.outputPath(`${name}.webm`);
  await video.saveAs(outputPath);
  await testInfo.attach(name, {
    path: outputPath,
    contentType: "video/webm",
  });
}

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
        events: LocalAudioEvent[];
      };
    };
    const state = {
      slowNextStart: false,
      nextOrder: 0,
      nextSourceId: 0,
      events: [] as LocalAudioEvent[],
    };
    Object.defineProperty(scope, "__suitsE2EAudioState", {
      configurable: false,
      enumerable: false,
      value: state,
      writable: false,
    });
    const recordLocal = (
      event:
        | "dialogue_synthesize"
        | "ended"
        | "interruption_fetch"
        | "objection_synthesize"
        | "ruling_synthesize"
        | "start"
        | "stop",
      sourceId: number | null = null,
      scheduledStartAtMs: number | null = null,
    ): void => {
      state.events.push({
        order: ++state.nextOrder,
        atMs: performance.now(),
        event,
        scheduledStartAtMs,
        sourceId,
      });
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
      const contextTime = this.context.currentTime;
      const observedAtMs = performance.now();
      const scheduledContextTime = Math.max(
        contextTime,
        arguments_[0] ?? 0,
      );
      const scheduledStartAtMs =
        observedAtMs + (scheduledContextTime - contextTime) * 1_000;
      const result = Reflect.apply(originalStart, this, arguments_);
      recordLocal("start", sourceId, scheduledStartAtMs);
      return result;
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
          } else if (
            control.type === "synthesize" &&
            typeof control.text === "string"
          ) {
            recordLocal("dialogue_synthesize");
          }
        } catch {
          // Binary audio and invalid data remain outside the observation ledger.
        }
      }
      return Reflect.apply(originalWebSocketSend, this, [data]);
    };
  });
}

async function installPerformanceProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const actorSlots = [
      "judge",
      "user_counsel",
      "opposing_counsel",
      "witness",
      "clerk",
      "jury",
    ] as const;
    const scope = window as typeof window & {
      __suitsE2EPerformanceState: {
        nextOrder: number;
        lastSignature: string | null;
        observations: PerformanceObservation[];
      };
    };
    const state = {
      nextOrder: 0,
      lastSignature: null as string | null,
      observations: [] as PerformanceObservation[],
    };
    Object.defineProperty(scope, "__suitsE2EPerformanceState", {
      configurable: false,
      enumerable: false,
      value: state,
      writable: false,
    });

    const capture = (): void => {
      const stage = document.querySelector<HTMLElement>(
        '[data-testid="courtroom-stage"]',
      );
      if (stage === null) return;
      const actors = actorSlots.flatMap((slot) => {
        const actor = stage.querySelector<HTMLElement>(
          `[data-actor-slot="${slot}"]`,
        );
        return actor === null
          ? []
          : [
              {
                slot,
                animation: actor.getAttribute("data-animation"),
                posture: actor.getAttribute("data-posture"),
                mouthActive: actor.getAttribute("data-mouth-active"),
              },
            ];
      });
      const canvas = stage.querySelector<HTMLCanvasElement>("canvas");
      const semanticState = {
        activeSceneActor: stage.getAttribute("data-active-scene-actor"),
        performanceSource: stage.getAttribute("data-performance-source"),
        performancePurpose: stage.getAttribute("data-performance-purpose"),
        cameraShot: stage.getAttribute("data-camera-shot"),
        cameraTransition: stage.getAttribute("data-camera-transition"),
        actors,
        canvasMouthActor: canvas?.getAttribute("data-mouth-actor") ?? null,
        canvasMouthShape: canvas?.getAttribute("data-mouth-shape") ?? null,
      };
      const signature = JSON.stringify(semanticState);
      if (signature === state.lastSignature) return;
      state.lastSignature = signature;
      state.observations.push({
        order: ++state.nextOrder,
        atMs: performance.now(),
        ...semanticState,
      });
      if (state.observations.length > 12_000) state.observations.shift();
    };

    const observer = new MutationObserver(capture);
    observer.observe(document, {
      attributes: true,
      attributeFilter: [
        "data-active-scene-actor",
        "data-performance-source",
        "data-performance-purpose",
        "data-camera-shot",
        "data-camera-transition",
        "data-actor-slot",
        "data-animation",
        "data-posture",
        "data-mouth-active",
        "data-mouth-actor",
        "data-mouth-shape",
      ],
      childList: true,
      subtree: true,
    });
    queueMicrotask(capture);
  });
}

async function readPerformanceObservations(
  page: Page,
): Promise<PerformanceObservation[]> {
  return page.evaluate(() =>
    (
      window as typeof window & {
        __suitsE2EPerformanceState: {
          observations: PerformanceObservation[];
        };
      }
    ).__suitsE2EPerformanceState.observations,
  );
}

function performanceActor(
  observation: PerformanceObservation,
  slot: string,
): PerformanceActorObservation | undefined {
  return observation.actors.find((actor) => actor.slot === slot);
}

function isNonRestMouth(observation: PerformanceObservation): boolean {
  return (
    observation.canvasMouthShape !== null &&
    observation.canvasMouthShape !== "rest"
  );
}

async function waitForPerformanceObservation(
  page: Page,
  predicate: (observation: PerformanceObservation) => boolean,
  afterOrder = 0,
  timeout = 30_000,
): Promise<PerformanceObservation> {
  let matched: PerformanceObservation | undefined;
  await expect
    .poll(
      async () => {
        const observations = await readPerformanceObservations(page);
        matched = observations.find(
          (observation) =>
            observation.order > afterOrder && predicate(observation),
        );
        return matched !== undefined;
      },
      { timeout },
    )
    .toBe(true);
  if (matched === undefined) {
    throw new Error("Expected courtroom performance state was not recorded");
  }
  return matched;
}

function witnessCard(page: Page, name: string): Locator {
  return page
    .getByRole("complementary", { name: "Case and witness controls" })
    .locator(".case-timeline")
    .filter({ hasText: name });
}

function isCommandResponseFor(
  response: Response,
  intentType: "call_witness" | "finish_witness" | "finish_trial",
): boolean {
  const request = response.request();
  if (request.method() !== "POST") return false;
  if (!/\/api\/hearings\/[^/]+\/commands$/u.test(new URL(response.url()).pathname)) {
    return false;
  }
  try {
    const command = HearingPlayerCommandSchema.parse(request.postDataJSON());
    return command.intent.type === intentType;
  } catch {
    return false;
  }
}

async function waitForLocalAudioReady(page: Page): Promise<void> {
  await expect(
    page.getByText("Local courtroom audio ready", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
}

async function callWitnessByName(page: Page, name: string): Promise<void> {
  const card = witnessCard(page, name);
  await expect(card).toHaveCount(1);
  const responsePromise = page.waitForResponse(
    (response) => isCommandResponseFor(response, "call_witness"),
    { timeout: 45_000 },
  );
  const call = card.getByRole("button", { name: "Call witness", exact: true });
  await expect(call).toBeVisible({ timeout: 30_000 });
  await expect(call).toBeEnabled();
  await call.click();
  expect((await responsePromise).ok()).toBe(true);
  await expect(page.getByText(`direct · ${name}`, { exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

async function submitFakeSpokenQuestion(
  page: Page,
  expectedAnswerCount: number,
): Promise<void> {
  await waitForLocalAudioReady(page);
  const start = page.getByRole("button", {
    name: "Start spoken question",
    exact: true,
  });
  await expect(start).toBeVisible({ timeout: 30_000 });
  await expect(start).toBeEnabled();
  await start.click();
  await expect(
    page.getByText("I do not recall that.", { exact: true }),
  ).toHaveCount(expectedAnswerCount, { timeout: 45_000 });
  await waitForLocalAudioReady(page);
}

async function finishWitnessByName(page: Page, name: string): Promise<void> {
  const card = witnessCard(page, name);
  const finishLeg = async (): Promise<void> => {
    await waitForLocalAudioReady(page);
    const responsePromise = page.waitForResponse(
      (response) => isCommandResponseFor(response, "finish_witness"),
      { timeout: 45_000 },
    );
    const finish = page.getByRole("button", {
      name: "End examination",
      exact: true,
    });
    await expect(finish).toBeVisible({ timeout: 30_000 });
    await expect(finish).toBeEnabled({ timeout: 30_000 });
    await finish.click();
    expect((await responsePromise).ok()).toBe(true);
  };

  await finishLeg();
  const redirect = page.getByText(`redirect · ${name}`, { exact: true });
  await expect
    .poll(
      async () =>
        (await card.innerText()).includes("released · called 1 time") ||
        (await redirect.isVisible()),
      { timeout: 30_000 },
    )
    .toBe(true);
  if (await redirect.isVisible()) await finishLeg();
  await expect(card).toContainText("released · called 1 time", {
    timeout: 30_000,
  });
}

async function readDurableHearing(
  page: Page,
  trialId: string,
): Promise<HearingRuntimeViewV1> {
  const response = await page.request.get(
    `/api/hearings/${encodeURIComponent(trialId)}`,
  );
  expect(response.ok()).toBe(true);
  return HearingRuntimeViewV1Schema.parse(await response.json());
}

test.describe("production-path partial objection", () => {
  test.describe.configure({ mode: "serial" });

  test("interrupts before final STT, cancels playback, commits a ruling, and resumes", async ({
    page,
  }, testInfo) => {
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
    await installPerformanceProbe(page);

    const response = await page.goto("/hearing/");
    expect(response?.ok()).toBe(true);
    await page.getByRole("button", { name: "Begin V3 hearing" }).click();
    const courtroomStage = page.getByTestId("courtroom-stage");
    await expect(courtroomStage).toBeVisible({ timeout: 30_000 });
    await expect(courtroomStage).toHaveAttribute(
      "data-renderer-ready",
      "true",
      { timeout: 30_000 },
    );
    await page.getByRole("button", { name: "reduced", exact: true }).click();
    await expect(courtroomStage).toHaveAttribute("data-quality", "reduced");
    await expect(courtroomStage).toHaveAttribute("data-renderer-ready", "true");
    await page.getByRole("button", { name: "balanced", exact: true }).click();
    await expect(courtroomStage).toHaveAttribute("data-quality", "balanced");
    const callWitness = page.getByRole("button", { name: "Call witness" }).first();
    await expect(callWitness).toBeVisible({ timeout: 30_000 });
    await callWitness.click();
    await expect(
      page.getByRole("button", { name: "Start spoken question" }),
    ).toBeVisible({ timeout: 30_000 });
    await testInfo.attach("procedural-courtroom-stage", {
      body: await courtroomStage.screenshot(),
      contentType: "image/png",
    });

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
    await page.evaluate(() => {
      (
        window as typeof window & {
          __suitsE2EAudioState: { slowNextStart: boolean };
        }
      ).__suitsE2EAudioState.slowNextStart = true;
    });

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
    await expect(courtroomStage).toHaveAttribute(
      "data-performance-purpose",
      "objection",
      { timeout: 15_000 },
    );
    await testInfo.attach("mid-sentence-objection", {
      body: await courtroomStage.screenshot(),
      contentType: "image/png",
    });
    await page.evaluate(() => {
      (
        window as typeof window & {
          __suitsE2EAudioState: { slowNextStart: boolean };
        }
      ).__suitsE2EAudioState.slowNextStart = true;
    });
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
    await expect(courtroomStage).toHaveAttribute(
      "data-ruling-phase",
      "gavel",
      { timeout: 15_000 },
    );
    await testInfo.attach("judge-ruling-gavel", {
      body: await courtroomStage.screenshot(),
      contentType: "image/png",
    });
    await page.evaluate(() => {
      (
        window as typeof window & {
          __suitsE2EAudioState: { slowNextStart: boolean };
        }
      ).__suitsE2EAudioState.slowNextStart = true;
    });
    const resumedWitness = await waitForObservation(
      observations,
      (entry) =>
        controlIs(entry, "ws_sent", "synthesize") &&
        entry.control.text === "I do not recall that.",
      30_000,
    );
    await expect(courtroomStage).toHaveAttribute(
      "data-performance-purpose",
      "testimony",
      { timeout: 15_000 },
    );
    await testInfo.attach("resumed-witness-testimony", {
      body: await courtroomStage.screenshot(),
      contentType: "image/png",
    });
    expect(objectionClip.order).toBeLessThan(overruledClip.order);
    expect(overruledClip.order).toBeLessThan(resumedWitness.order);
    const localAudioEvents = await page.evaluate(() =>
      (
        window as typeof window & {
          __suitsE2EAudioState: {
            events: LocalAudioEvent[];
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

    const objectionPerformance = await waitForPerformanceObservation(
      page,
      (entry) => {
        const actor = performanceActor(entry, "opposing_counsel");
        return (
          entry.activeSceneActor === "opposing_counsel" &&
          entry.performanceSource === "playback" &&
          entry.performancePurpose === "objection" &&
          entry.cameraShot === "opposing_counsel_close" &&
          entry.cameraTransition === "blend" &&
          actor?.animation === "objecting" &&
          actor.posture === "standing"
        );
      },
    );
    const rulingPerformance = await waitForPerformanceObservation(
      page,
      (entry) => {
        const actor = performanceActor(entry, "judge");
        return (
          entry.activeSceneActor === "judge" &&
          entry.performanceSource === "playback" &&
          entry.performancePurpose === "ruling" &&
          entry.cameraShot === "judge_close" &&
          entry.cameraTransition === "blend" &&
          actor?.animation === "ruling" &&
          actor.posture === "seated"
        );
      },
      objectionPerformance.order,
    );
    const resumedPerformance = await waitForPerformanceObservation(
      page,
      (entry) => {
        const actor = performanceActor(entry, "witness");
        return (
          entry.activeSceneActor === "witness" &&
          entry.performanceSource === "playback" &&
          entry.performancePurpose === "testimony" &&
          entry.cameraShot === "witness_close" &&
          entry.cameraTransition === "blend" &&
          actor?.animation === "speaking" &&
          actor.posture === "seated" &&
          actor.mouthActive === "true" &&
          entry.canvasMouthActor === "witness" &&
          isNonRestMouth(entry)
        );
      },
      rulingPerformance.order,
    );
    const terminalPerformance = await waitForPerformanceObservation(
      page,
      (entry) =>
        entry.performanceSource === "base" &&
        entry.performancePurpose === "base" &&
        entry.canvasMouthActor === "none" &&
        entry.canvasMouthShape === "rest" &&
        entry.actors.length === 6 &&
        entry.actors.every((actor) => actor.mouthActive === "false"),
      resumedPerformance.order,
    );
    expect(terminalPerformance.order).toBeGreaterThan(
      resumedPerformance.order,
    );
    const settledCameraPerformance = await waitForPerformanceObservation(
      page,
      (entry) =>
        entry.performanceSource === "base" &&
        entry.cameraShot === "witness_counsel_two_shot" &&
        entry.cameraTransition === "blend" &&
        entry.canvasMouthShape === "rest",
      terminalPerformance.order,
    );

    const completedAudioEvents = await page.evaluate(() =>
      (
        window as typeof window & {
          __suitsE2EAudioState: { events: LocalAudioEvent[] };
        }
      ).__suitsE2EAudioState.events,
    );
    const completedRulingSynthesis = completedAudioEvents.find(
      (entry) => entry.event === "ruling_synthesize",
    );
    const dialogueSynthesis = completedAudioEvents.find(
      (entry) =>
        entry.event === "dialogue_synthesize" &&
        entry.order >
          (completedRulingSynthesis?.order ?? Number.POSITIVE_INFINITY),
    );
    const firstObjectionStart = completedAudioEvents.find(
      (entry) =>
        entry.event === "start" &&
        entry.order >
          (objectionSynthesis?.order ?? Number.POSITIVE_INFINITY) &&
        entry.order <
          (completedRulingSynthesis?.order ?? Number.NEGATIVE_INFINITY),
    );
    const firstRulingStart = completedAudioEvents.find(
      (entry) =>
        entry.event === "start" &&
        entry.order >
          (completedRulingSynthesis?.order ?? Number.POSITIVE_INFINITY) &&
        entry.order <
          (dialogueSynthesis?.order ?? Number.NEGATIVE_INFINITY),
    );
    const firstResumedStart = completedAudioEvents.find(
      (entry) =>
        entry.event === "start" &&
        entry.order > (dialogueSynthesis?.order ?? Number.POSITIVE_INFINITY),
    );
    expect(dialogueSynthesis).toBeDefined();
    expect(firstObjectionStart).toBeDefined();
    expect(firstRulingStart).toBeDefined();
    expect(firstResumedStart).toBeDefined();

    const performanceLedger = await readPerformanceObservations(page);
    const mouthChecks = [
      {
        purpose: "objection",
        actor: "opposing_counsel",
        start: firstObjectionStart,
        afterOrder: objectionPerformance.order,
        beforeOrder: rulingPerformance.order,
      },
      {
        purpose: "ruling",
        actor: "judge",
        start: firstRulingStart,
        afterOrder: rulingPerformance.order,
        beforeOrder: resumedPerformance.order,
      },
      {
        purpose: "testimony",
        actor: "witness",
        start: firstResumedStart,
        afterOrder: resumedPerformance.order,
        beforeOrder: terminalPerformance.order,
      },
    ] as const;
    for (const check of mouthChecks) {
      const scheduledStart = check.start;
      if (scheduledStart === undefined) {
        throw new Error(`Expected a Web Audio source start for ${check.purpose}`);
      }
      const scheduledStartAtMs = scheduledStart.scheduledStartAtMs;
      if (scheduledStartAtMs === null) {
        throw new Error(`Expected a scheduled audio start for ${check.purpose}`);
      }
      const actorMouthStates = performanceLedger.filter(
        (entry) =>
          entry.order >= check.afterOrder &&
          entry.order < check.beforeOrder &&
          entry.performancePurpose === check.purpose &&
          entry.canvasMouthActor === check.actor &&
          isNonRestMouth(entry),
      );
      expect(actorMouthStates.length).toBeGreaterThan(0);
      expect(actorMouthStates[0]?.atMs).toBeGreaterThanOrEqual(
        scheduledStartAtMs,
      );
      expect(
        performanceLedger.some(
          (entry) =>
            entry.performancePurpose === check.purpose &&
            entry.atMs < scheduledStartAtMs &&
            entry.canvasMouthActor === check.actor &&
            isNonRestMouth(entry),
        ),
      ).toBe(false);
      for (const mouthState of actorMouthStates) {
        expect(
          mouthState.actors
            .filter((actor) => actor.slot !== check.actor)
            .every((actor) => actor.mouthActive === "false"),
        ).toBe(true);
      }
    }

    await expect(courtroomStage).toHaveAttribute("data-performance-purpose", "base");
    await expect(courtroomStage).toHaveAttribute("data-camera-transition", "blend");
    await expect(courtroomStage.locator("canvas")).toHaveAttribute(
      "data-mouth-shape",
      "rest",
    );

    await page.emulateMedia({ reducedMotion: "reduce" });
    const reducedBase = await waitForPerformanceObservation(
      page,
      (entry) =>
        entry.performanceSource === "base" &&
        entry.performancePurpose === "base" &&
        entry.cameraTransition === "cut" &&
        entry.canvasMouthShape === "rest",
      settledCameraPerformance.order,
    );
    await page.getByRole("button", { name: "Test speaker" }).click();
    const reducedSpeakerTest = await waitForPerformanceObservation(
      page,
      (entry) => {
        const actor = performanceActor(entry, "judge");
        return (
          entry.activeSceneActor === "judge" &&
          entry.performancePurpose === "speaker_test" &&
          entry.cameraShot === "judge_close" &&
          entry.cameraTransition === "cut" &&
          actor?.animation === "speaking" &&
          actor.mouthActive === "true" &&
          entry.canvasMouthActor === "judge" &&
          entry.canvasMouthShape === "narrow"
        );
      },
      reducedBase.order,
    );
    await waitForPerformanceObservation(
      page,
      (entry) =>
        entry.performanceSource === "base" &&
        entry.performancePurpose === "base" &&
        entry.cameraTransition === "cut" &&
        entry.canvasMouthActor === "none" &&
        entry.canvasMouthShape === "rest",
      reducedSpeakerTest.order,
    );

    const commandRequestsAfterRuling = observations.filter(
      (entry) =>
        entry.kind === "request" &&
        entry.method === "POST" &&
        entry.pathname.endsWith("/commands"),
    ).length;
    expect(commandRequestsAfterRuling).toBe(commandRequestsBeforeRecording);
    expect(browserErrors).toEqual([]);
    await saveSuccessVideo(page, testInfo, "mid-sentence-objection");
  });

  test("completes two witnesses by voice and resumes the exact durable record", async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    const browserErrors: string[] = [];
    const apiFailures: string[] = [];
    const commandIntents: string[] = [];
    let startRequestCount = 0;
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });
    page.on("pageerror", (error) => browserErrors.push(error.message));
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (request.method() === "POST" && pathname === "/api/hearings") {
        startRequestCount += 1;
      }
      if (
        request.method() !== "POST" ||
        !/\/api\/hearings\/[^/]+\/commands$/u.test(pathname)
      ) {
        return;
      }
      try {
        const command = HearingPlayerCommandSchema.parse(
          request.postDataJSON(),
        );
        commandIntents.push(command.intent.type);
      } catch {
        commandIntents.push("invalid");
      }
    });
    page.on("response", (response) => {
      const pathname = new URL(response.url()).pathname;
      if (pathname.startsWith("/api/hearings") && !response.ok()) {
        apiFailures.push(`${response.status()} ${pathname}`);
      }
    });

    const navigation = await page.goto(
      "/hearing/?case=redwood-signal-retaliation",
    );
    expect(navigation?.ok()).toBe(true);
    expect(new URL(page.url()).searchParams.has("trial")).toBe(false);
    const startResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/hearings",
      { timeout: 45_000 },
    );
    await page.getByRole("button", { name: "Begin V3 hearing" }).click();
    const startResponse = await startResponsePromise;
    expect(startResponse.ok()).toBe(true);
    const started = HearingRuntimeViewV1Schema.parse(
      await startResponse.json(),
    );
    const trialId = HearingTrialIdSchema.parse(started.trial.trialId);
    await expect
      .poll(() => new URL(page.url()).searchParams.get("trial"))
      .toBe(trialId);
    expect(startRequestCount).toBe(1);

    await callWitnessByName(page, "Rina Shah");
    await expect(page.getByRole("textbox")).toHaveCount(0);
    await expect(page.getByLabel(/Developer-only typed/u)).toHaveCount(0);
    await page.getByRole("button", { name: "Prepare local audio" }).click();
    await waitForLocalAudioReady(page);
    await submitFakeSpokenQuestion(page, 1);
    await finishWitnessByName(page, "Rina Shah");

    await waitForLocalAudioReady(page);
    await callWitnessByName(page, "Theo Morgan");
    await expect(page.getByRole("textbox")).toHaveCount(0);
    await expect(page.getByLabel(/Developer-only typed/u)).toHaveCount(0);
    await submitFakeSpokenQuestion(page, 2);
    await finishWitnessByName(page, "Theo Morgan");

    await waitForLocalAudioReady(page);
    await expect(page.getByRole("textbox")).toHaveCount(0);
    const startClosing = page.getByRole("button", {
      name: "Start spoken closing argument",
      exact: true,
    });
    await expect(startClosing).toBeVisible({ timeout: 30_000 });
    await expect(startClosing).toBeEnabled();
    const completionResponsePromise = page.waitForResponse(
      (response) => isCommandResponseFor(response, "finish_trial"),
      { timeout: 120_000 },
    );
    await startClosing.click();
    const stopClosing = page.getByRole("button", {
      name: "Stop, rest, and close",
      exact: true,
    });
    await expect(stopClosing).toBeVisible({ timeout: 15_000 });
    await expect(stopClosing).toBeEnabled();
    await stopClosing.click();
    const completionResponse = await completionResponsePromise;
    expect(completionResponse.ok()).toBe(true);
    const finalView = HearingRuntimeViewV1Schema.parse(
      await completionResponse.json(),
    );

    expect(finalView.trial).toMatchObject({
      trialId,
      phase: "complete",
      status: "complete",
    });
    const calledWitnesses = finalView.witnesses.filter(
      ({ callCount }) => callCount > 0,
    );
    expect(
      calledWitnesses.map(({ name }) => name).sort(),
    ).toEqual(["Rina Shah", "Theo Morgan"]);
    expect(
      calledWitnesses.every(
        ({ callCount, status }) => callCount === 1 && status === "released",
      ),
    ).toBe(true);
    const witnessTurns = finalView.transcript.filter(
      ({ actor }) => actor.role === "witness",
    );
    expect(witnessTurns).toHaveLength(2);
    expect(witnessTurns.map(({ text }) => text)).toEqual([
      "I do not recall that.",
      "I do not recall that.",
    ]);
    expect(
      finalView.transcript.filter(
        ({ text }) => text === "No further questions, Your Honor.",
      ),
    ).toHaveLength(2);
    expect(
      finalView.transcript.some(
        ({ text }) =>
          text ===
          "The jury-considerable record does not carry the user's fictional burden.",
      ),
    ).toBe(true);
    await expect(
      page.getByText("Durable record complete", { exact: true }),
    ).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText("2 witnesses called", { exact: true })).toBeVisible();
    await expect(page.getByText("2 answers", { exact: true })).toBeVisible();
    await expect(
      page.getByText(`state v${finalView.trial.version}`, { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("textbox")).toHaveCount(0);
    await expect(page.getByLabel(/Developer-only typed/u)).toHaveCount(0);
    await testInfo.attach("complete-two-witness-trial", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });

    const durableBeforeReload = await readDurableHearing(page, trialId);
    expect(durableBeforeReload).toEqual(finalView);
    const finalUrl = new URL(page.url());
    const commandCountBeforeReload = commandIntents.length;
    const resumedResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname === `/api/hearings/${trialId}`,
      { timeout: 45_000 },
    );
    const reload = await page.reload();
    expect(reload?.ok()).toBe(true);
    const resumedResponse = await resumedResponsePromise;
    expect(resumedResponse.ok()).toBe(true);
    const resumed = HearingRuntimeViewV1Schema.parse(
      await resumedResponse.json(),
    );
    expect(resumed).toEqual(durableBeforeReload);
    await expect(
      page.getByText("Durable record complete", { exact: true }),
    ).toBeVisible({ timeout: 45_000 });
    const resumedUrl = new URL(page.url());
    expect(resumedUrl.origin).toBe(finalUrl.origin);
    expect(resumedUrl.pathname.replace(/\/$/u, "")).toBe(
      finalUrl.pathname.replace(/\/$/u, ""),
    );
    expect(resumedUrl.searchParams.toString()).toBe(
      finalUrl.searchParams.toString(),
    );
    expect(commandIntents).toHaveLength(commandCountBeforeReload);
    expect(commandIntents).not.toContain("invalid");
    expect(
      commandIntents.filter((intent) => intent === "call_witness"),
    ).toHaveLength(2);
    expect(
      commandIntents.filter((intent) => intent === "finish_witness"),
    ).toHaveLength(2);
    expect(
      commandIntents.filter((intent) => intent === "finish_trial"),
    ).toHaveLength(1);
    await expect(page.getByRole("textbox")).toHaveCount(0);
    await expect(page.getByLabel(/Developer-only typed/u)).toHaveCount(0);
    expect(apiFailures).toEqual([]);
    expect(browserErrors).toEqual([]);
    await saveSuccessVideo(page, testInfo, "complete-two-witness-trial");
  });
});
