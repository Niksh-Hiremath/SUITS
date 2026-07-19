import { createHash } from "node:crypto";

const SAFE_ISSUE_PATH_COMPONENT = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const UNSAFE_ISSUE_PATH_COMPONENT = "$unsafe";
const MAX_REPAIR_CANDIDATE_CHARACTERS = 20_000;
const MAX_REPAIR_ISSUES = 64;
const MAX_SEGMENTS = 16;
const MAX_IDS = 128;

type JsonPrimitive = string | number | boolean | null;

export type JudicialRepairIssue = Readonly<{
  code: string;
  path: readonly (string | number)[];
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function safePrimitive(value: unknown): JsonPrimitive | string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return "[invalid value omitted]";
}

function copyPrimitiveField(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  key: string,
): void {
  if (hasOwn(source, key)) target[key] = safePrimitive(source[key]);
}

function boundedPrimitiveArray(value: unknown): unknown {
  if (!Array.isArray(value)) return safePrimitive(value);
  return value.slice(0, MAX_IDS).map((entry) => safePrimitive(entry));
}

function projectCitations(value: unknown): unknown {
  if (!isRecord(value)) return safePrimitive(value);
  const projected: Record<string, unknown> = {};
  for (const key of [
    "factIds",
    "evidenceIds",
    "testimonyIds",
    "transcriptTurnIds",
    "sourceSegmentIds",
    "priorStatementIds",
    "issueIds",
    "instructionIds",
    "ruleIds",
    "settlementOfferIds",
  ]) {
    if (hasOwn(value, key)) projected[key] = boundedPrimitiveArray(value[key]);
  }
  return projected;
}

function projectObjectFields(
  value: unknown,
  fields: readonly string[],
): unknown {
  if (!isRecord(value)) return safePrimitive(value);
  const projected: Record<string, unknown> = {};
  fields.forEach((field) => copyPrimitiveField(value, projected, field));
  for (const field of [
    "instructionIds",
    "testimonyIds",
    "presentedEvidenceIds",
  ]) {
    if (hasOwn(value, field)) {
      projected[field] = boundedPrimitiveArray(value[field]);
    }
  }
  return projected;
}

function projectRejectedCandidate(candidate: unknown): unknown {
  if (!isRecord(candidate)) return safePrimitive(candidate);
  const projected: Record<string, unknown> = {};
  for (const field of ["schemaVersion", "ruling", "remedy", "reason"]) {
    copyPrimitiveField(candidate, projected, field);
  }
  if (hasOwn(candidate, "citations")) {
    projected.citations = projectCitations(candidate.citations);
  }
  if (hasOwn(candidate, "speechSegments")) {
    projected.speechSegments = Array.isArray(candidate.speechSegments)
      ? candidate.speechSegments.slice(0, MAX_SEGMENTS).map((segment) => {
          if (!isRecord(segment)) return safePrimitive(segment);
          const projectedSegment: Record<string, unknown> = {};
          copyPrimitiveField(segment, projectedSegment, "text");
          if (hasOwn(segment, "citations")) {
            projectedSegment.citations = projectCitations(segment.citations);
          }
          return projectedSegment;
        })
      : safePrimitive(candidate.speechSegments);
  }
  if (hasOwn(candidate, "proposedAction")) {
    projected.proposedAction = projectObjectFields(
      candidate.proposedAction,
      ["kind", "ruling", "reason", "decision"],
    );
  }
  if (hasOwn(candidate, "performance")) {
    projected.performance = projectObjectFields(candidate.performance, [
      "activity",
      "emotion",
      "intensity",
      "gazeTarget",
      "gesture",
      "speakingStyle",
    ]);
  }
  return projected;
}

export function serializeJudicialRepairCandidate(candidate: unknown): Readonly<{
  serialized: string;
  truncated: boolean;
  originalCharacterCount: number;
}> {
  let serialized: string;
  try {
    serialized = JSON.stringify(projectRejectedCandidate(candidate)) ?? "null";
  } catch {
    serialized = JSON.stringify("[unserializable candidate omitted]");
  }
  const originalCharacterCount = serialized.length;
  return originalCharacterCount <= MAX_REPAIR_CANDIDATE_CHARACTERS
    ? { serialized, truncated: false, originalCharacterCount }
    : {
        serialized: serialized.slice(0, MAX_REPAIR_CANDIDATE_CHARACTERS),
        truncated: true,
        originalCharacterCount,
      };
}

function safeIssuePath(
  path: readonly (string | number)[],
): Array<string | number> {
  return path.slice(0, 16).map((component) => {
    if (typeof component === "number") {
      return Number.isInteger(component) && component >= 0
        ? component
        : UNSAFE_ISSUE_PATH_COMPONENT;
    }
    return SAFE_ISSUE_PATH_COMPONENT.test(component)
      ? component
      : UNSAFE_ISSUE_PATH_COMPONENT;
  });
}

export function safeJudicialRepairIssues(
  issues: readonly JudicialRepairIssue[],
): JudicialRepairIssue[] {
  return issues.slice(0, MAX_REPAIR_ISSUES).map((validationIssue) => ({
    code: validationIssue.code,
    path: safeIssuePath(validationIssue.path),
  }));
}

export function sha256Json(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}
