import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SOURCE_PATHS = {
  page: fileURLToPath(new URL("./page.tsx", import.meta.url)),
  globals: fileURLToPath(new URL("../globals.css", import.meta.url)),
  developerInput: fileURLToPath(
    new URL("./developer-typed-input.tsx", import.meta.url),
  ),
  hearingController: fileURLToPath(
    new URL("../../lib/speech/hearing-controller.ts", import.meta.url),
  ),
  courtroomStage: fileURLToPath(
    new URL("../../components/courtroom/courtroom-stage.tsx", import.meta.url),
  ),
  courtroomCanvas: fileURLToPath(
    new URL("../../components/courtroom/courtroom-canvas.tsx", import.meta.url),
  ),
  courtroomPresentation: fileURLToPath(
    new URL("../../domain/courtroom-presentation/derive.ts", import.meta.url),
  ),
  sessionPolicy: fileURLToPath(
    new URL("./session-policy.ts", import.meta.url),
  ),
  startRoute: fileURLToPath(
    new URL("../api/hearings/route.ts", import.meta.url),
  ),
  readRoute: fileURLToPath(
    new URL("../api/hearings/[trialId]/route.ts", import.meta.url),
  ),
  commandRoute: fileURLToPath(
    new URL("../api/hearings/[trialId]/commands/route.ts", import.meta.url),
  ),
  continuationRecoveryRoute: fileURLToPath(
    new URL(
      "../api/hearings/[trialId]/continuation/recover/route.ts",
      import.meta.url,
    ),
  ),
  durableService: fileURLToPath(
    new URL("../../server/hearing-api/durable-service.ts", import.meta.url),
  ),
  interruptionRoute: fileURLToPath(
    new URL(
      "../api/hearings/[trialId]/interruptions/route.ts",
      import.meta.url,
    ),
  ),
  interruptionRecoveryRoute: fileURLToPath(
    new URL(
      "../api/hearings/[trialId]/interruptions/recover/route.ts",
      import.meta.url,
    ),
  ),
  interruptionService: fileURLToPath(
    new URL(
      "../../server/hearing-api/final-bound-interruption.ts",
      import.meta.url,
    ),
  ),
  convexHttp: fileURLToPath(
    new URL("../../../convex/http.ts", import.meta.url),
  ),
  runtime: fileURLToPath(
    new URL("../../../convex/hearingRuntime.ts", import.meta.url),
  ),
} as const;

describe("V3 hearing page boundary", () => {
  it("uses the owner-bound hearing API and keeps legacy runtime paths out of the page", async () => {
    const entries = await Promise.all(
      Object.entries(SOURCE_PATHS).map(async ([name, path]) => [
        name,
        await readFile(path, "utf8"),
      ]),
    );
    const sources = Object.fromEntries(entries) as Record<
      keyof typeof SOURCE_PATHS,
      string
    >;
    const boundedCallGraph = Object.values(sources).join("\n");

    expect(sources.page).toContain('fetch("/api/hearings"');
    expect(sources.page).toContain("/commands");
    expect(sources.page).not.toContain('href="/records/"');
    expect(sources.startRoute).toContain('path: "/service/hearings/start"');
    expect(sources.readRoute).toContain('path: "/service/hearings/read"');
    expect(sources.durableService).toContain(
      'path: "/service/hearings/command/prepare"',
    );
    expect(sources.durableService).toContain(
      'path: "/service/hearings/continuation/prepare"',
    );
    expect(sources.durableService).toContain(
      'path: "/service/hearings/command/commit"',
    );
    expect(sources.durableService).toContain(
      'path: "/service/hearings/opponent-plan/commit"',
    );
    expect(sources.durableService).toContain(
      'path: "/service/hearings/counsel-response/commit"',
    );
    expect(sources.durableService).toContain(
      'path: "/service/hearings/jury-response/commit"',
    );
    expect(sources.durableService).toContain(
      'path: "/service/hearings/debrief/commit"',
    );
    expect(sources.commandRoute).toContain("orchestrateCourtroomCommand");
    expect(sources.continuationRecoveryRoute).toContain(
      "orchestratePreparedCourtroomCommand",
    );
    expect(sources.continuationRecoveryRoute).toContain(
      "prepareCourtroomContinuationForOwner",
    );
    expect(sources.durableService).toContain(
      'path: "/service/hearings/model-call/terminal"',
    );
    expect(sources.page).toContain("/interruptions");
    expect(sources.page).toContain("/continuation/recover");
    expect(sources.page).toContain("recoverDurableContinuation");
    expect(sources.page).toContain("interruptFinal:");
    expect(sources.interruptionService).toContain(
      'path: "/service/hearings/interruption/prepare"',
    );
    expect(sources.interruptionService).toContain(
      "assertFinalBoundInterruptionPreparationMatchesRequest",
    );
    expect(sources.interruptionService).toContain(
      "orchestratePreparedCourtroomCommandResult",
    );
    expect(sources.interruptionService).toContain(
      'path: "/service/hearings/interruption/claim"',
    );
    expect(sources.interruptionService).toContain(
      'path: "/service/hearings/interruption/claim/renew"',
    );
    expect(sources.interruptionService).toContain(
      'path: "/service/hearings/interruption/claim/release"',
    );
    expect(sources.interruptionRoute).toContain(
      "resolveFinalBoundInterruption",
    );
    expect(sources.interruptionRecoveryRoute).toContain(
      "recoverFinalBoundInterruption",
    );
    expect(sources.page).toContain("FinalBoundInterruptionResolutionSchema");
    expect(sources.page).toContain("adoptRecoveredInterruption");
    expect(sources.page).toContain("Retry interrupted response");
    expect(sources.convexHttp).toContain('>("hearingRuntime:start")');
    expect(sources.convexHttp).toContain('>("hearingRuntime:read")');
    expect(sources.convexHttp).toContain(
      '>("hearingRuntime:prepareCommand")',
    );
    expect(sources.convexHttp).toContain(
      '>("hearingRuntime:prepareContinuation")',
    );
    expect(sources.convexHttp).toContain(
      '>("hearingRuntime:commitWitnessGeneration")',
    );
    expect(sources.convexHttp).toContain(
      '>("hearingRuntime:commitOpponentPlanGeneration")',
    );
    expect(sources.convexHttp).toContain(
      '>("hearingRuntime:commitCounselGeneration")',
    );
    expect(sources.convexHttp).toContain(
      '>("hearingRuntime:commitJuryGeneration")',
    );
    expect(sources.convexHttp).toContain(
      '>("hearingRuntime:commitDebriefGeneration")',
    );
    expect(sources.convexHttp).not.toContain(
      '>("hearingRuntime:command")',
    );
    expect(sources.convexHttp).not.toContain(
      'path: "/service/hearings/command"',
    );
    expect(sources.runtime).toContain("export const start = internalAction");
    expect(sources.runtime).toContain("export const read = internalAction");
    expect(sources.runtime).toContain(
      "export const prepareCommand = internalAction",
    );
    expect(sources.runtime).toContain(
      "export const prepareContinuation = internalAction",
    );
    expect(sources.runtime).toContain(
      "export const commitWitnessGeneration = internalAction",
    );
    expect(sources.runtime).toContain(
      "export const commitJuryGeneration = internalAction",
    );
    expect(sources.runtime).toContain(
      "export const commitDebriefGeneration = internalAction",
    );
    expect(sources.runtime).not.toContain("createDeterministicWitnessAnswer");

    expect(sources.page).toContain("new HearingController");
    expect(sources.page).toContain(
      "initialTrialId === createdTrialIdRef.current",
    );
    expect(sources.page).toContain(
      "createdTrialIdRef.current = parsed.data.trial.trialId",
    );
    expect(sources.page).toContain("window.location.reload()");
    expect(sources.page).toContain("Reload durable record");
    expect(sources.page).toContain("shouldReloadHearingSession");
    expect(sources.page).toContain("hearingLifecycleBlocksCourtroomControls");
    expect(sources.sessionPolicy).toContain('lifecycle === "preparing"');
    expect(sources.page).toContain('className="voice-status" role="alert"');
    expect(sources.page).toContain(".baselineView(parsed.data)");
    expect(sources.page).toContain(".adoptView(");
    expect(sources.page).toContain('source: "new_hearing"');
    expect(sources.page).toContain('source: "command"');
    expect(sources.page).toContain('source: "recovery"');
    expect(sources.page).toContain(".startRecording(mode)");
    expect(sources.page).toContain(".stopRecording()");
    expect(sources.page).toContain(".speakerTest()");
    expect(sources.page).toContain("deriveOpponentResponseWindow(view)");
    expect(sources.page).toContain("buildObjectIntent(");
    expect(sources.page).toContain("buildContinueResponseIntent(");
    expect(sources.page).toContain(".interruptForCourtroomAction()");
    expect(sources.page).toContain("Object: {readable(ground)}");
    expect(sources.page).toContain("Let the witness answer");
    expect(sources.page).toContain("Objection telemetry");
    expect(sources.page).toContain("Local audio telemetry");
    expect(sources.page).toContain("deriveCourtroomPresentation({");
    expect(sources.page).toContain("createCourtroomPresentationRuntime()");
    expect(sources.page).toContain("controller.subscribePerformance((event)");
    expect(sources.page).toContain(
      "reduceCourtroomPresentationRuntime(current, event, observedAtMs)",
    );
    expect(sources.page).toContain("unsubscribePerformance();");
    expect(sources.page.indexOf("unsubscribePerformance();")).toBeLessThan(
      sources.page.indexOf("controller.close()"),
    );
    expect(sources.page).toContain("resetCourtroomPresentationRuntime({");
    expect(sources.page).toContain(
      "presentationTrialIdRef.current !== next.trial.trialId",
    );
    const publishViewStart = sources.page.indexOf("const publishView = useCallback");
    const resetStart = sources.page.indexOf(
      "resetCourtroomPresentationRuntime({",
      publishViewStart,
    );
    const durableViewWrite = sources.page.indexOf(
      "viewRef.current = next",
      publishViewStart,
    );
    expect(publishViewStart).toBeGreaterThan(-1);
    expect(resetStart).toBeGreaterThan(publishViewStart);
    expect(resetStart).toBeLessThan(durableViewWrite);
    expect(sources.page).toContain(
      "presentationBaseCameraShot,\n    presentationBaseFocus",
    );
    expect(sources.page).toContain("rebaseCourtroomPresentationRuntime(");
    expect(sources.page).toContain("baseDisplay: presentationDisplay");
    expect(sources.page).toContain("trialId: presentationHead.trialId");
    expect(sources.page).toContain(
      "stateVersion: presentationHead.stateVersion",
    );
    expect(sources.page).toContain("lastEventId: presentationHead.lastEventId");
    expect(sources.page).toContain("nextCourtroomPresentationWakeAt(");
    expect(sources.page).toContain(
      "advanceCourtroomPresentationRuntime(current, observedAtMs)",
    );
    expect(sources.page).toContain("<CourtroomStage");
    expect(sources.page).toContain("presentationRuntime={presentationRuntime}");
    expect(sources.page).toContain("onQualityChange={setCourtroomQuality}");
    expect(sources.page).toContain('(prefers-reduced-motion: reduce)');
    expect(sources.courtroomStage).toContain("ssr: false");
    expect(sources.courtroomStage).toContain('data-testid="courtroom-stage"');
    expect(sources.courtroomStage).toContain('aria-label="Courtroom rendering quality"');
    expect(sources.courtroomStage).toContain("data-quality-option={quality}");
    expect(sources.courtroomStage).toContain('probe.getContext("webgl2")');
    expect(sources.courtroomCanvas).toContain('useFrame(() => {');
    expect(sources.courtroomCanvas).toContain('"webglcontextlost"');
    expect(sources.courtroomCanvas).not.toContain("onCreated={onReady}");
    expect(sources.courtroomPresentation).not.toContain("case.summary");
    expect(sources.courtroomPresentation).not.toContain("knownFactIds");
    expect(sources.page).not.toContain("<textarea");
    expect(sources.page).not.toContain("sendPcmFrame");
    expect(sources.page).not.toContain("frame.pcm");
    expect(sources.globals).toMatch(
      /\.case-rail\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/u,
    );
    expect(sources.globals).toMatch(
      /\.rail-card\s*\{[^}]*min-width:\s*0[^}]*overflow-wrap:\s*anywhere/u,
    );
    expect(sources.globals).toContain(
      "grid-template-columns: repeat(3, minmax(0, 1fr));",
    );
    expect(sources.globals).toContain("@media (max-width: 650.98px)");

    for (const gate of [
      'process.env.NODE_ENV !== "production"',
      'process.env.NEXT_PUBLIC_SUITS_DEV_TYPED_INPUT === "1"',
    ]) {
      expect(sources.page).toContain(gate);
      expect(sources.developerInput).toContain(gate);
    }
    expect(sources.developerInput).toContain("<textarea");
    expect(sources.developerInput).toContain("submitDeveloperFinal(mode, normalized)");
    expect(sources.hearingController).not.toMatch(
      /\bfetch\s*\(|\bXMLHttpRequest\b|\bsendBeacon\b|\bMediaRecorder\b/u,
    );

    for (const forbidden of [
      "convex/react",
      "api.participatory",
      "api.trials",
      "api.voice",
      "answerGoldenWitness",
      "replyAsOpposingCounsel",
      "assessGoldenVerdict",
      "ElevenLabs",
      "Asha",
      "Vertex",
      "Elena",
    ]) {
      expect(
        boundedCallGraph,
        `legacy hearing dependency: ${forbidden}`,
      ).not.toContain(forbidden);
    }
  });
});
