import { v } from "convex/values";

import {
  HEARING_AUDIO_AUDIT_MAX_EPOCH_MS,
  HearingAudioAuditRecordSchema,
  type HearingAudioAuditPersistResult,
  type HearingAudioAuditRecord,
} from "../src/lib/speech/hearing-audio-audit";
import {
  TRIAL_EVENT_SCHEMA_VERSION_V3,
  TRIAL_STATE_SCHEMA_VERSION_V3,
  TrialStateV3Schema,
} from "../src/domain/trial-engine";
import { projectCourtRecordsAudioAudits } from "../src/domain/court-records";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { CaseServiceOwnerIdSchema } from "./caseServiceBoundary";
import { loadCanonicalTrialReplayForOwner } from "./trialEvents";

const MAX_RECORD_JSON_CHARACTERS = 128_000;
export const MAX_HEARING_AUDIO_AUDITS_PER_TRIAL = 4_096;

export type PersistHearingAudioAuditResult = HearingAudioAuditPersistResult;

function invalidRecord(): never {
  throw new Error("HEARING_AUDIO_AUDIT_RECORD_INVALID");
}

function parseRecordJson(recordJson: string): Readonly<{
  record: HearingAudioAuditRecord;
  canonicalJson: string;
}> {
  if (
    recordJson.length === 0 ||
    recordJson.length > MAX_RECORD_JSON_CHARACTERS
  ) {
    return invalidRecord();
  }
  let input: unknown;
  try {
    input = JSON.parse(recordJson) as unknown;
  } catch {
    return invalidRecord();
  }
  const parsed = HearingAudioAuditRecordSchema.safeParse(input);
  if (!parsed.success) return invalidRecord();
  return { record: parsed.data, canonicalJson: JSON.stringify(parsed.data) };
}

async function requireOwnedV3Projection(
  ctx: Pick<QueryCtx, "db">,
  ownerIdInput: string,
  trialId: string,
): Promise<string> {
  const owner = CaseServiceOwnerIdSchema.safeParse(ownerIdInput);
  if (!owner.success) throw new Error("HEARING_AUDIO_AUDIT_OWNER_INVALID");
  const projection = await ctx.db
    .query("trialProjections")
    .withIndex("by_trial", (index) => index.eq("trialId", trialId))
    .unique();
  if (!projection || projection.ownerId !== owner.data) {
    throw new Error("TRIAL_NOT_FOUND");
  }
  if (
    projection.stateSchemaVersion !== TRIAL_STATE_SCHEMA_VERSION_V3 ||
    projection.eventSchemaVersion !== TRIAL_EVENT_SCHEMA_VERSION_V3
  ) {
    throw new Error("TRIAL_MIGRATION_REQUIRED");
  }
  let stateInput: unknown;
  try {
    stateInput = JSON.parse(projection.stateJson) as unknown;
  } catch {
    throw new Error("TRIAL_PROJECTION_INVALID");
  }
  const state = TrialStateV3Schema.safeParse(stateInput);
  if (
    !state.success ||
    state.data.trialId !== trialId ||
    state.data.version !== projection.stateVersion ||
    state.data.lastSequence !== projection.lastSequence
  ) {
    throw new Error("TRIAL_PROJECTION_INVALID");
  }
  return owner.data;
}

function rowMatchesRecord(
  row: Doc<"hearingAudioAudits">,
  ownerId: string,
  trialId: string,
  record: HearingAudioAuditRecord,
  canonicalJson: string,
): boolean {
  return (
    row.recordId === record.recordId &&
    row.ownerId === ownerId &&
    row.trialId === trialId &&
    row.recordJson === canonicalJson &&
    row.contentHash === record.contentHash &&
    row.schemaVersion === record.schemaVersion &&
    Number.isSafeInteger(row.persistedAt) &&
    row.persistedAt >= 0 &&
    row.persistedAt <= HEARING_AUDIO_AUDIT_MAX_EPOCH_MS
  );
}

/** Persist one exact, metadata-only client observation after owner binding. */
export async function persistHearingAudioAuditForOwner(
  ctx: MutationCtx,
  input: Readonly<{
    ownerId: string;
    trialId: string;
    recordJson: string;
  }>,
): Promise<PersistHearingAudioAuditResult> {
  const { record, canonicalJson } = parseRecordJson(input.recordJson);
  const ownerId = CaseServiceOwnerIdSchema.parse(input.ownerId);
  const replay = await loadCanonicalTrialReplayForOwner(ctx, {
    ownerId,
    trialId: input.trialId,
  });
  try {
    projectCourtRecordsAudioAudits({
      trialState: replay.state,
      events: replay.events,
      records: [record],
    });
  } catch {
    throw new Error("HEARING_AUDIO_AUDIT_SEMANTICS_INVALID");
  }
  const existing = await ctx.db
    .query("hearingAudioAudits")
    .withIndex("by_owner_trial_record", (index) =>
      index
        .eq("ownerId", ownerId)
        .eq("trialId", input.trialId)
        .eq("recordId", record.recordId),
    )
    .take(2);
  if (existing.length > 0) {
    if (
      existing.length !== 1 ||
      !rowMatchesRecord(
        existing[0],
        ownerId,
        input.trialId,
        record,
        canonicalJson,
      )
    ) {
      throw new Error("HEARING_AUDIO_AUDIT_CONFLICT");
    }
    return { recordId: record.recordId, replayed: true };
  }
  // An exhausted owner/trial range participates in Convex OCC, so concurrent
  // distinct identities cannot both cross the append-only capacity boundary.
  const rowsAtCapacity = await ctx.db
    .query("hearingAudioAudits")
    .withIndex("by_owner_trial", (index) =>
      index.eq("ownerId", ownerId).eq("trialId", input.trialId),
    )
    .take(MAX_HEARING_AUDIO_AUDITS_PER_TRIAL);
  if (rowsAtCapacity.length >= MAX_HEARING_AUDIO_AUDITS_PER_TRIAL) {
    throw new Error("HEARING_AUDIO_AUDIT_LIMIT_EXCEEDED");
  }
  await ctx.db.insert("hearingAudioAudits", {
    recordId: record.recordId,
    ownerId,
    trialId: input.trialId,
    recordJson: canonicalJson,
    contentHash: record.contentHash,
    schemaVersion: record.schemaVersion,
    persistedAt: Date.now(),
  });
  return { recordId: record.recordId, replayed: false };
}

export const recordForOwner = internalMutation({
  args: {
    ownerId: v.string(),
    trialId: v.string(),
    recordJson: v.string(),
  },
  handler: async (ctx, args) =>
    await persistHearingAudioAuditForOwner(ctx, args),
});

function validatedStoredRecord(
  row: Doc<"hearingAudioAudits">,
  ownerId: string,
  trialId: string,
): HearingAudioAuditRecord {
  let parsed: ReturnType<typeof parseRecordJson>;
  try {
    parsed = parseRecordJson(row.recordJson);
  } catch {
    throw new Error("HEARING_AUDIO_AUDIT_INVALID");
  }
  if (
    !rowMatchesRecord(
      row,
      ownerId,
      trialId,
      parsed.record,
      parsed.canonicalJson,
    )
  ) {
    throw new Error("HEARING_AUDIO_AUDIT_INVALID");
  }
  return parsed.record;
}

/** Strict owner/trial read for the server-side Court Records projection. */
export const listForOwnerTrial = internalQuery({
  args: {
    ownerId: v.string(),
    trialId: v.string(),
  },
  handler: async (ctx, args): Promise<HearingAudioAuditRecord[]> => {
    const ownerId = await requireOwnedV3Projection(
      ctx,
      args.ownerId,
      args.trialId,
    );
    const rows = await ctx.db
      .query("hearingAudioAudits")
      .withIndex("by_owner_trial", (index) =>
        index.eq("ownerId", ownerId).eq("trialId", args.trialId),
      )
      .take(MAX_HEARING_AUDIO_AUDITS_PER_TRIAL + 1);
    if (rows.length > MAX_HEARING_AUDIO_AUDITS_PER_TRIAL) {
      throw new Error("HEARING_AUDIO_AUDIT_LIMIT_EXCEEDED");
    }
    const seen = new Set<string>();
    const records = rows.map((row) => {
      if (seen.has(row.recordId)) {
        throw new Error("HEARING_AUDIO_AUDIT_INVALID");
      }
      seen.add(row.recordId);
      return validatedStoredRecord(row, ownerId, args.trialId);
    });
    return records.sort(
      (left, right) =>
        left.observedAtEpochMs - right.observedAtEpochMs ||
        left.recordId.localeCompare(right.recordId),
    );
  },
});
