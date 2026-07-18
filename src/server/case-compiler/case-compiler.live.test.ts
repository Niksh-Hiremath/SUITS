import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import OpenAI from "openai";
import { describe, expect, it } from "vitest";

import { CaseGraphV1Schema } from "../../domain/case-graph";
import { readServerEnv } from "../../lib/env";
import { ingestCaseUpload } from "../case-ingestion";

import { compileCasePacket } from "./compiler";
import { OpenAICaseCompilerProvider } from "./openai-provider";

const LIVE_ENABLED = process.env.RUN_OPENAI_LIVE === "1";
const fixturePath = fileURLToPath(
  new URL("../../../tests/fixtures/case-packets/beacon-row-market.md", import.meta.url),
);

describe.skipIf(!LIVE_ENABLED)("live GPT-5.6 Terra CaseCompiler", () => {
  it("compiles the upload fixture into a grounded draft CaseGraph", async () => {
    const environment = readServerEnv();
    const bytes = Uint8Array.from(await readFile(fixturePath));
    const ingestion = await ingestCaseUpload({
      uploadId: "upload:beacon-row-live-smoke",
      caseId: "case:beacon-row-live-smoke",
      originalName: "beacon-row-market.md",
      mimeType: "text/markdown",
      bytes,
    });
    const streamEvents: string[] = [];
    const result = await compileCasePacket({
      provider: new OpenAICaseCompilerProvider(
        new OpenAI({ apiKey: environment.OPENAI_API_KEY }),
      ),
      input: {
        caseId: ingestion.upload.caseId,
        sourceSegments: ingestion.segments,
      },
      onStreamEvent: (event) => streamEvents.push(event.type),
    });

    expect(CaseGraphV1Schema.safeParse(result.caseGraph).success).toBe(true);
    expect(result.caseGraph.status).toBe("draft");
    expect(result.caseGraph.witnesses.length).toBeGreaterThanOrEqual(3);
    expect(result.validationReport.status).not.toBe("rejected");
    expect(result.validationReport.issues).toEqual([]);
    expect(result.validationReport.grounding.length).toBeGreaterThan(0);
    expect(
      result.validationReport.grounding.every((record) =>
        record.grounding === "source" || record.grounding === "inferred"),
    ).toBe(true);
    expect(streamEvents).toContain("response_started");
    expect(streamEvents).toContain("structured_delta");
    expect(streamEvents).toContain("response_completed");

    const acceptedAttempt = result.observability.attempts.at(-1);
    console.info("LIVE_CASE_COMPILER_EVIDENCE", JSON.stringify({
      model: result.observability.model,
      requestId: acceptedAttempt?.requestId ?? null,
      responseId: acceptedAttempt?.responseId ?? null,
      latencyMs: Math.round(result.observability.latencyMs),
      retryCount: result.observability.retryCount,
      sourceSegmentCount: result.observability.sourceSegmentCount,
      acceptedSourceCitationCount: result.observability.acceptedSourceCitationCount,
      usage: acceptedAttempt?.usage ?? null,
      witnessCount: result.caseGraph.witnesses.length,
      evidenceCount: result.caseGraph.evidence.length,
      factCount: result.caseGraph.facts.length,
      uncertaintyCount: result.caseGraph.compilerMetadata.uncertainties.length,
    }));
  }, 300_000);
});
