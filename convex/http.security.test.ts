import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const EXPECTED_SERVICE_ROUTES = [
  ["POST", "/service/health", "serviceHealth"],
  ["POST", "/service/preflight-permit/acquire", "acquirePreflightPermit"],
  ["POST", "/service/case-compile-claim/acquire", "acquireCaseCompileClaim"],
  ["POST", "/service/case-compile-claim/heartbeat", "heartbeatCaseCompileClaim"],
  ["POST", "/service/case-compile-claim/release", "releaseCaseCompileClaim"],
  ["POST", "/service/case-draft/lookup", "lookupCaseCompileReplay"],
  ["POST", "/service/case-upload/cleanup", "cleanupCaseUpload"],
  ["POST", "/service/case-upload-url", "generateUploadUrl"],
  ["POST", "/service/case-draft/register", "registerDraft"],
  ["POST", "/service/case-draft/publish", "publishDraft"],
  ["POST", "/service/cases/owned/list", "listOwnedCases"],
  ["POST", "/service/hearings/start", "startHearing"],
  ["POST", "/service/hearings/command/prepare", "prepareHearingCommand"],
  ["POST", "/service/hearings/continuation/prepare", "prepareHearingContinuation"],
  ["POST", "/service/hearings/interruption/prepare", "prepareFinalBoundInterruption"],
  ["POST", "/service/hearings/interruption/resume", "resumeFinalBoundInterruption"],
  ["POST", "/service/hearings/interruption/claim", "claimFinalBoundInterruption"],
  ["POST", "/service/hearings/interruption/claim/renew", "renewFinalBoundInterruptionClaim"],
  ["POST", "/service/hearings/interruption/claim/release", "releaseFinalBoundInterruptionClaim"],
  ["POST", "/service/hearings/interruption/claim/commit", "commitClaimedFinalBoundInterruption"],
  ["POST", "/service/hearings/interruption/claim/witness/commit", "commitClaimedFinalBoundWitness"],
  ["POST", "/service/hearings/command/commit", "commitWitnessGeneration"],
  ["POST", "/service/hearings/opponent-plan/commit", "commitOpponentPlanGeneration"],
  ["POST", "/service/hearings/counsel-response/commit", "commitCounselGeneration"],
  ["POST", "/service/hearings/judge-response/commit", "commitJudgeGeneration"],
  ["POST", "/service/hearings/objection-ruling/commit", "commitObjectionRulingGeneration"],
  ["POST", "/service/hearings/negotiation/commit", "commitNegotiationGeneration"],
  ["POST", "/service/hearings/jury-response/commit", "commitJuryGeneration"],
  ["POST", "/service/hearings/debrief/commit", "commitDebriefGeneration"],
  ["POST", "/service/hearings/model-call/terminal", "recordTerminalModelCall"],
  ["POST", "/service/hearings/read", "readHearing"],
  ["POST", "/service/court-records/list", "listCourtRecords"],
  ["POST", "/service/court-records/read", "readCourtRecords"],
  ["POST", "/service/hearings/audio-audit/record", "recordHearingAudioAudit"],
] as const;

function hasAuthorizationCall(node: ts.Node): boolean {
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "authorizeCaseServiceRequest"
  ) {
    return true;
  }
  return node.getChildren().some(hasAuthorizationCall);
}

describe("Convex HTTP service surface", () => {
  const source = readFileSync(new URL("./http.ts", import.meta.url), "utf8");

  it("keeps an exact POST-only route allowlist", () => {
    const routePattern = /http\.route\(\{\s*path:\s*"([^"]+)",\s*method:\s*"([^"]+)",\s*handler:\s*([A-Za-z0-9_]+)\s*\}\);/gu;
    const routes = [...source.matchAll(routePattern)].map((match) => [
      match[2],
      match[1],
      match[3],
    ]);
    const registrationCount = [...source.matchAll(/http\.route\s*\(/gu)].length;

    expect(routes).toHaveLength(registrationCount);
    expect(routes).toEqual(EXPECTED_SERVICE_ROUTES);
    expect(routes.every(([method, path]) => method === "POST" && path.startsWith("/service/"))).toBe(true);
  });

  it("requires service-secret authorization inside every HTTP action factory", () => {
    const sourceFile = ts.createSourceFile(
      "http.ts",
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const httpActions: ts.CallExpression[] = [];
    function collect(node: ts.Node): void {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "httpAction"
      ) {
        httpActions.push(node);
      }
      ts.forEachChild(node, collect);
    }
    collect(sourceFile);

    expect(httpActions).not.toHaveLength(0);
    for (const action of httpActions) {
      expect(hasAuthorizationCall(action), `unauthorized httpAction near offset ${action.pos}`).toBe(true);
    }
  });
});
