import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseCourtRecordsInitialSelection } from "../../domain/court-records/navigation";
import {
  COURT_RECORDS_MAX_PAGE_SIZE,
  paginateCourtRecords,
} from "./court-records-pagination";
import {
  COURT_RECORDS_AUDIO_BINDING_LABELS,
  COURT_RECORDS_FACT_VISIBILITY_LABELS,
  COURT_RECORDS_HONEST_COPY,
  COURT_RECORDS_LIST_PAGE_SIZE,
  COURT_RECORDS_PANEL_PAGE_SIZES,
  COURT_RECORDS_TRANSCRIPT_STATUS_LABELS,
  flattenCourtRecordsEventTree,
} from "./court-records-view-model";

const SOURCE_PATHS = {
  workspace: fileURLToPath(
    new URL("./court-records-workspace.tsx", import.meta.url),
  ),
  detail: fileURLToPath(
    new URL("./court-record-detail.tsx", import.meta.url),
  ),
  client: fileURLToPath(
    new URL("./court-records-client.ts", import.meta.url),
  ),
  viewModel: fileURLToPath(
    new URL("./court-records-view-model.ts", import.meta.url),
  ),
  workspaceCss: fileURLToPath(
    new URL("./court-records-workspace.module.css", import.meta.url),
  ),
  globalCss: fileURLToPath(
    new URL("../../app/globals.css", import.meta.url),
  ),
} as const;

async function sources(): Promise<Record<keyof typeof SOURCE_PATHS, string>> {
  const entries = await Promise.all(
    Object.entries(SOURCE_PATHS).map(async ([name, sourcePath]) => [
      name,
      await readFile(sourcePath, "utf8"),
    ]),
  );
  return Object.fromEntries(entries) as Record<
    keyof typeof SOURCE_PATHS,
    string
  >;
}

function occurrenceCount(source: string, fragment: string): number {
  return source.split(fragment).length - 1;
}

describe("Court Records workspace source boundary", () => {
  it("uses only the strict same-origin list, detail, and download client", async () => {
    const source = await sources();

    expect(source.workspace).toContain(
      "listCourtRecords({ signal: controller.signal })",
    );
    expect(source.workspace).toContain(
      "readCourtRecord(selectedTrialId, { signal: controller.signal })",
    );
    expect(source.workspace).toContain("downloadCourtRecord(trialId, {");
    expect(source.workspace).toContain("signal: controller.signal");
    expect(source.workspace).toContain(
      "downloadExactJson(record.fileName, record.json)",
    );
    expect(source.workspace).not.toMatch(/\bfetch\s*\(/u);
    expect(source.detail).not.toMatch(/\bfetch\s*\(/u);

    expect(source.client).toContain('credentials: "same-origin"');
    expect(source.client).toContain('cache: "no-store"');
    expect(source.client).toContain('headers: { Accept: "application/json" }');
    expect(source.client).toContain('requestJson("/api/records"');
    expect(source.client).toContain(
      "`/api/records/${encodeURIComponent(parsedTrialId)}`",
    );
    expect(source.client).toContain(
      "`/api/records/${encodeURIComponent(parsedTrialId)}/download`",
    );
  });

  it("contains no persistence, cookie, storage, or owner-secret authority", async () => {
    const source = await sources();
    const browserSurface = [
      source.workspace,
      source.detail,
      source.client,
      source.viewModel,
    ].join("\n");

    for (const forbidden of [
      /convex\/react/iu,
      /_generated\/api/iu,
      /\bownerId\b/u,
      /CASE_OWNER_COOKIE_NAME/u,
      /document\.cookie/u,
      /\blocalStorage\b/u,
      /\bsessionStorage\b/u,
      /SUITS_CONVEX_SERVICE_SECRET/u,
      /\bAuthorization\b/iu,
      /\bBearer\s/iu,
      /\bOPENAI_API_KEY\b/u,
    ]) {
      expect(browserSurface).not.toMatch(forbidden);
    }
  });

  it("downloads the exact validated JSON bytes and always revokes the object URL", async () => {
    const { workspace, client } = await sources();

    expect(workspace).toContain(
      'new Blob([json], { type: "application/json;charset=utf-8" })',
    );
    expect(workspace).not.toContain("JSON.stringify(json)");
    expect(workspace).not.toContain("JSON.parse(json)");
    expect(client).toContain("const json = await response.text()");
    expect(client).toContain("view: parseBoundView(payload, parsedTrialId)");

    const createUrl = workspace.indexOf("URL.createObjectURL(");
    const assignName = workspace.indexOf("anchor.download = fileName");
    const click = workspace.indexOf("anchor.click()");
    const finallyBlock = workspace.indexOf("} finally {");
    const remove = workspace.indexOf("anchor.remove()", finallyBlock);
    const revoke = workspace.indexOf("URL.revokeObjectURL(objectUrl)", finallyBlock);

    expect(createUrl).toBeGreaterThan(-1);
    expect(assignName).toBeGreaterThan(createUrl);
    expect(click).toBeGreaterThan(assignName);
    expect(finallyBlock).toBeGreaterThan(click);
    expect(remove).toBeGreaterThan(finallyBlock);
    expect(revoke).toBeGreaterThan(remove);
  });

  it("aborts obsolete reads and cannot render stale detail or download state", async () => {
    const { workspace } = await sources();

    expect(occurrenceCount(workspace, "new AbortController()")).toBe(3);
    expect(occurrenceCount(workspace, "let active = true")).toBe(2);
    expect(occurrenceCount(workspace, "active = false")).toBe(2);
    expect(occurrenceCount(workspace, "controller.abort();")).toBeGreaterThanOrEqual(2);
    expect(workspace).toContain("downloadGenerationRef");
    expect(workspace).toContain("useLayoutEffect(() =>");
    expect(workspace).toContain("downloadRequestRef.current?.generation !== generation");
    expect(workspace).toContain("selectedTrialRef.current !== trialId");
    expect(workspace).toContain("downloadRequestRef.current?.controller.abort()");
    expect(workspace).toContain(
      "detailState.view.summary.trialId === selectedTrialId",
    );
    expect(workspace).toContain(
      "detailState.trialId === selectedTrialId",
    );
    expect(workspace).toContain(
      "downloadState.trialId === selectedTrialId",
    );
    expect(workspace).toContain(
      ': { status: "loading", trialId: selectedTrialId }',
    );
  });

  it("mounts exactly one switched detail panel and exposes every required inspector", async () => {
    const { detail } = await sources();
    const requiredPanels = {
      overview: "Overview",
      transcript: "Transcript",
      procedure: "Procedure",
      lifecycles: "Facts & evidence",
      modelCalls: "Model calls",
      audio: "Audio audit",
      citations: "Citations",
      debrief: "Debrief",
      eventTree: "Event ledger",
    } as const;

    expect(detail).toContain(
      'const [active, setActive] = useState<RecordSection>("overview")',
    );
    expect(detail).toContain("switch (active)");
    expect(occurrenceCount(detail, "<ActivePanel ")).toBe(1);
    expect(occurrenceCount(detail, "data-records-section=")).toBe(9);
    expect(detail).toContain('aria-label="Record sections"');
    expect(detail).not.toMatch(/\bhidden=\{active/iu);

    for (const [key, label] of Object.entries(requiredPanels)) {
      expect(detail).toContain(`${key}: "${label}"`);
      expect(detail).toContain(`data-records-section="${key}"`);
      expect(detail).toContain(`case "${key}"`);
    }

    for (const key of [
      "transcript",
      "objections",
      "rulings",
      "recoveries",
      "interruptions",
      "facts",
      "evidence",
      "modelCalls",
      "audio",
      "citations",
      "debrief",
      "eventTree",
    ] as const) {
      expect(detail).toContain(
        `paginateCourtRecordsPanel(model, "${key}"`,
      );
    }
  });

  it("exposes retry, focus, responsive-overflow, and section-control semantics", async () => {
    const { workspace, detail, workspaceCss, globalCss } = await sources();

    expect(workspace).toContain("Retry archive");
    expect(workspace).toContain("Retry record");
    expect(workspace).toContain("setListRequestGeneration");
    expect(workspace).toContain("setDetailRequestGeneration");
    expect(workspace).toContain(
      '<nav className={styles.pagination} aria-label="Record list pagination">',
    );
    expect(workspace).toContain("Start a hearing to create its owner-bound record.");

    expect(detail).toContain("aria-controls={`record-panel-${section}`}");
    expect(detail).toContain("aria-pressed={active === section}");
    expect(detail).not.toContain('aria-current={active === section ? "page"');
    expect(detail).toContain('id="record-panel-overview"');
    expect(detail).toContain('id="record-panel-eventTree"');

    expect(workspaceCss).toMatch(
      /\.recordLink:focus-visible[\s\S]*outline: 3px solid var\(--wine\)/u,
    );
    expect(workspaceCss).toMatch(
      /\.tab:focus-visible[\s\S]*outline: 3px solid var\(--wine\)/u,
    );
    expect(workspaceCss).toMatch(
      /\.activeTab:focus-visible[\s\S]*outline-color: var\(--gold\)/u,
    );
    expect(workspaceCss).toContain("overflow-wrap: anywhere");
    expect(workspaceCss).not.toContain(".citationChip:hover");
    expect(globalCss).toMatch(
      /@media \(max-width: 650\.98px\)[\s\S]*\.hearing-header-links[\s\S]*flex-wrap: wrap/u,
    );
  });

  it("keeps every collection page bounded and event rows flat", async () => {
    const { workspace, detail } = await sources();
    const sizes = Object.values(COURT_RECORDS_PANEL_PAGE_SIZES);

    expect(COURT_RECORDS_LIST_PAGE_SIZE).toBe(12);
    expect(COURT_RECORDS_PANEL_PAGE_SIZES.eventTree).toBe(50);
    expect(Math.min(...sizes)).toBeGreaterThan(0);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(
      COURT_RECORDS_MAX_PAGE_SIZE,
    );
    expect(workspace).toContain("const RECORD_LIST_PAGE_SIZE = 12");
    expect(workspace).toContain(
      "paginateCourtRecords(records, page, RECORD_LIST_PAGE_SIZE)",
    );
    expect(detail).toContain("page.items.map((row) =>");
    expect(detail).toContain("data-record-event-row");
    expect(detail).toContain("Math.min(row.depth, 6)");
    expect(detail).not.toContain("row.node.childEventIds.map(");
    expect(detail).toContain("const INLINE_CITATION_LIMIT = 12");
    expect(detail).toContain("const INLINE_HISTORY_LIMIT = 8");
    expect(detail).toContain("resolutions.slice(0, INLINE_CITATION_LIMIT)");
    expect(occurrenceCount(detail, ".slice(0, INLINE_HISTORY_LIMIT)")).toBe(3);
  });

  it("renders honest privacy, audio, fallback, and unavailable-value labels", async () => {
    const { workspace, detail } = await sources();

    expect(COURT_RECORDS_TRANSCRIPT_STATUS_LABELS.stricken).toMatch(
      /retained for audit and excluded from jury consideration/iu,
    );
    expect(COURT_RECORDS_FACT_VISIBILITY_LABELS.restricted).toMatch(
      /owner-visible restricted record/iu,
    );
    expect(COURT_RECORDS_HONEST_COPY.rawAudio).toMatch(
      /raw audio and transcript fragments are not retained/iu,
    );
    expect(COURT_RECORDS_HONEST_COPY.fallback).toMatch(
      /no alternate-provider or deterministic fallback is available/iu,
    );
    expect(COURT_RECORDS_HONEST_COPY.unavailableMetric).toMatch(
      /unavailable.+not zero/iu,
    );
    expect(COURT_RECORDS_HONEST_COPY.knowledgeScope).toMatch(
      /counts only.+content is not disclosed/iu,
    );
    expect(COURT_RECORDS_AUDIO_BINDING_LABELS.local_observation).toMatch(
      /metadata.+no canonical content binding/iu,
    );
    expect(
      COURT_RECORDS_AUDIO_BINDING_LABELS.transcript_turn_verified,
    ).toMatch(/audio content not verified/iu);

    for (const copy of [
      "Raw microphone audio is not retained.",
      "Hidden authoring truth",
      "Fallback: unavailable and unused.",
      "Repairs are not fallbacks.",
      "Scoped content is not disclosed.",
      "Raw audio retained",
      "Coaching inference is not admitted courtroom proof.",
      "privacy-safe projection",
    ]) {
      expect(`${workspace}\n${detail}`).toContain(copy);
    }
  });

  it("handles malformed selections with fixed copy and without retaining raw input", async () => {
    const { workspace } = await sources();
    const trialId = `trial_${"a".repeat(32)}`;

    for (const value of [
      "ATTACKER_PRIVATE_CANARY",
      ` ${trialId}`,
      [trialId, `trial_${"b".repeat(32)}`],
    ] as const) {
      const selection = parseCourtRecordsInitialSelection(value);
      expect(selection).toEqual({ kind: "invalid" });
      expect(Object.keys(selection)).toEqual(["kind"]);
    }

    expect(workspace).toContain(
      'initialSelection.kind === "valid" ? initialSelection.trialId : null',
    );
    expect(workspace).toContain('initialSelection.kind === "invalid"');
    expect(workspace).toContain("Invalid Court Record link");
    expect(workspace).toContain("Choose a hearing from your private archive.");
    expect(workspace).not.toContain("JSON.stringify(initialSelection)");
    expect(workspace).not.toContain("ATTACKER_PRIVATE_CANARY");
  });

  it("flattens the maximum event stream iteratively before paging rows", async () => {
    type EventTree = Parameters<typeof flattenCourtRecordsEventTree>[0];
    type EventNode = EventTree["nodes"][number];
    const eventCount = 20_000;
    const eventId = (sequence: number): string => `event:bounded:${sequence}`;
    const nodes: EventNode[] = Array.from(
      { length: eventCount },
      (_, index): EventNode => {
        const sequence = index + 1;
        return {
          eventId: eventId(sequence),
          sequence,
          stateVersion: sequence,
          type: sequence === 1 ? "START_TRIAL" : "BEGIN_PHASE",
          actor: {
            actorId: "actor:system",
            role: "system",
            side: "neutral",
            witnessId: null,
          },
          source: "system",
          occurredAt: "2026-07-20T00:00:00.000Z",
          parentEventId: sequence === 1 ? null : eventId(sequence - 1),
          childEventIds:
            sequence === eventCount ? [] : [eventId(sequence + 1)],
          responseId: null,
          interruptId: null,
          citations: {
            factIds: [],
            evidenceIds: [],
            testimonyIds: [],
            eventIds: [],
            sourceSegmentIds: [],
          },
        };
      },
    );
    const eventTree: EventTree = {
      rootEventIds: [eventId(1)],
      nodes,
    };

    const rows = flattenCourtRecordsEventTree(eventTree);
    const finalPage = paginateCourtRecords(
      rows,
      eventCount / COURT_RECORDS_PANEL_PAGE_SIZES.eventTree,
      COURT_RECORDS_PANEL_PAGE_SIZES.eventTree,
    );

    expect(rows).toHaveLength(eventCount);
    expect(rows[0]).toMatchObject({ ordinal: 1, depth: 0, isRoot: true });
    expect(rows.at(-1)).toMatchObject({
      ordinal: eventCount,
      depth: eventCount - 1,
      isRoot: false,
    });
    expect(finalPage.items).toHaveLength(
      COURT_RECORDS_PANEL_PAGE_SIZES.eventTree,
    );
    expect(finalPage.start).toBe(eventCount - 49);
    expect(finalPage.end).toBe(eventCount);

    const { viewModel } = await sources();
    const flattenStart = viewModel.indexOf(
      "export function flattenCourtRecordsEventTree",
    );
    const flattenEnd = viewModel.indexOf(
      "export type CourtRecordsCitationNamespace",
      flattenStart,
    );
    const flattenSource = viewModel.slice(flattenStart, flattenEnd);
    expect(flattenSource).toContain("const stack =");
    expect(flattenSource).toContain("while (stack.length > 0)");
    expect(
      occurrenceCount(flattenSource, "flattenCourtRecordsEventTree"),
    ).toBe(1);
  });
});
