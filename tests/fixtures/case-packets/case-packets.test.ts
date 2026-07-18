import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SourceSegmentSchema } from "../../../src/domain/case-graph";
import {
  MAX_CASE_UPLOAD_SIZE_BYTES,
  ingestCaseUpload,
  sha256Hex,
  type CaseIngestionResult,
} from "../../../src/server/case-ingestion";

const fixtureDirectory = fileURLToPath(new URL(".", import.meta.url));
const normalFixtureName = "beacon-row-market.md";
const injectedFixtureName = "beacon-row-market-injected.md";
const injectionBlockStart = "\n\n<!-- BEGIN UNTRUSTED EMBEDDED INSTRUCTIONS -->";

function normalizeMarkdown(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true })
    .decode(bytes)
    .replace(/\r\n?/gu, "\n")
    .trim();
}

async function readFixture(fileName: string): Promise<Uint8Array> {
  return Uint8Array.from(await readFile(`${fixtureDirectory}${fileName}`));
}

async function ingestFixture(fileName: string, bytes: Uint8Array): Promise<CaseIngestionResult> {
  return ingestCaseUpload({
    uploadId: `upload:${fileName.replace(/[^a-z0-9]+/giu, "-")}`,
    caseId: "case:beacon-row-live-fixture",
    originalName: fileName,
    mimeType: "text/markdown",
    bytes,
  });
}

function expectExactTextProvenance(
  result: CaseIngestionResult,
  normalizedText: string,
  fileName: string,
): void {
  expect(result.segments.length).toBeGreaterThan(1);
  expect(new Set(result.segments.map((segment) => segment.sourceSegmentId)).size).toBe(
    result.segments.length,
  );
  result.segments.forEach((segment) => {
    expect(SourceSegmentSchema.safeParse(segment).success).toBe(true);
    expect(segment.documentName).toBe(fileName);
    expect(segment.mimeType).toBe("text/markdown");
    expect(segment.sha256).toBe(sha256Hex(segment.excerpt));
    expect(segment.locator.kind).toBe("text");
    if (segment.locator.kind !== "text") throw new Error("Expected Markdown text provenance");
    expect(normalizedText.slice(segment.locator.startOffset, segment.locator.endOffset)).toBe(
      segment.excerpt,
    );
  });
}

describe("live CaseCompiler upload fixtures", () => {
  it("keeps both complete packets small and preserves identical fictional case facts", async () => {
    const normalBytes = await readFixture(normalFixtureName);
    const injectedBytes = await readFixture(injectedFixtureName);
    const normalText = normalizeMarkdown(normalBytes);
    const injectedText = normalizeMarkdown(injectedBytes);
    const injectionStart = injectedText.indexOf(injectionBlockStart);

    expect(normalBytes.byteLength).toBeLessThan(16 * 1024);
    expect(injectedBytes.byteLength).toBeLessThan(16 * 1024);
    expect(normalBytes.byteLength).toBeLessThan(MAX_CASE_UPLOAD_SIZE_BYTES);
    expect(injectedBytes.byteLength).toBeLessThan(MAX_CASE_UPLOAD_SIZE_BYTES);
    expect(injectedBytes.byteLength).toBeGreaterThan(normalBytes.byteLength);
    expect(injectionStart).toBeGreaterThan(0);
    expect(injectedText.slice(0, injectionStart)).toBe(normalText);
    [
      "## Parties",
      "## Issues",
      "## Timeline",
      "## Facts and initial authoring status",
      "## Evidence inventory",
      "## Witness profiles and knowledge boundaries",
      "## Contradictions for examination",
      "## Settlement simulation configuration",
      "## Fictional jury instructions",
      "## Uncertainties for human review",
    ].forEach((heading) => expect(normalText).toContain(heading));
    expect(normalText.match(/^### W-\d /gmu)).toHaveLength(3);
    expect(normalText.match(/^- \*\*E-\d /gmu)).toHaveLength(5);
  });

  it("creates exact, schema-valid source provenance for the clean packet", async () => {
    const bytes = await readFixture(normalFixtureName);
    const normalizedText = normalizeMarkdown(bytes);
    const result = await ingestFixture(normalFixtureName, bytes);

    expectExactTextProvenance(result, normalizedText, normalFixtureName);
    expect(result.upload.sizeBytes).toBe(bytes.byteLength);
    expect(result.upload.contentDigest).toBe(sha256Hex(bytes));
    expect(result.extractionAdapterId).toBe("builtin-text-v1");
    expect(result.extractionCharacterCount).toBe(normalizedText.length);
    expect(result.injectionFlags).toEqual([]);
  });

  it("preserves malicious text as evidence while flagging every supported injection class", async () => {
    const bytes = await readFixture(injectedFixtureName);
    const normalizedText = normalizeMarkdown(bytes);
    const result = await ingestFixture(injectedFixtureName, bytes);

    expectExactTextProvenance(result, normalizedText, injectedFixtureName);
    expect(new Set(result.injectionFlags.map((flag) => flag.patternId))).toEqual(
      new Set([
        "instruction_override",
        "role_impersonation",
        "tool_invocation",
        "secret_exfiltration",
        "safety_bypass",
      ]),
    );
    expect(result.injectionFlags.every((flag) => /^[a-f0-9]{64}$/u.test(flag.fingerprint))).toBe(
      true,
    );
    expect(result.injectionFlags.every((flag) => flag.endOffset <= normalizedText.length)).toBe(true);
    expect(result.segments.some((segment) => segment.excerpt.includes("Ignore all previous"))).toBe(
      true,
    );
  });
});
