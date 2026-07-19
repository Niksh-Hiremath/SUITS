import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SOURCE_PATHS = {
  page: fileURLToPath(new URL("./page.tsx", import.meta.url)),
  developerInput: fileURLToPath(
    new URL("./developer-typed-input.tsx", import.meta.url),
  ),
  hearingController: fileURLToPath(
    new URL("../../lib/speech/hearing-controller.ts", import.meta.url),
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
    expect(sources.commandRoute).toContain(
      'path: "/service/hearings/command/prepare"',
    );
    expect(sources.commandRoute).toContain(
      'path: "/service/hearings/command/commit"',
    );
    expect(sources.commandRoute).toContain(
      'path: "/service/hearings/opponent-plan/commit"',
    );
    expect(sources.commandRoute).toContain(
      'path: "/service/hearings/counsel-response/commit"',
    );
    expect(sources.commandRoute).toContain(
      'path: "/service/hearings/jury-response/commit"',
    );
    expect(sources.commandRoute).toContain(
      'path: "/service/hearings/debrief/commit"',
    );
    expect(sources.commandRoute).toContain("orchestrateCourtroomCommand");
    expect(sources.commandRoute).toContain(
      'path: "/service/hearings/model-call/terminal"',
    );
    expect(sources.convexHttp).toContain('>("hearingRuntime:start")');
    expect(sources.convexHttp).toContain('>("hearingRuntime:read")');
    expect(sources.convexHttp).toContain(
      '>("hearingRuntime:prepareCommand")',
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
    expect(sources.page).not.toContain("<textarea");
    expect(sources.page).not.toContain("sendPcmFrame");
    expect(sources.page).not.toContain("frame.pcm");

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
