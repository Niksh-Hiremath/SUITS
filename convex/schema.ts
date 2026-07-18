import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const phase = v.union(
  v.literal("briefing"),
  v.literal("opening"),
  v.literal("cross_examination"),
  v.literal("closing"),
  v.literal("deliberation"),
  v.literal("debrief"),
  v.literal("complete"),
  v.literal("failed"),
);

const artifactStatus = v.union(
  v.literal("pending"),
  v.literal("valid"),
  v.literal("fallback"),
  v.literal("failed"),
);

const runtimeOpenAiModel = v.union(
  v.literal("gpt-5.6-luna"),
  v.literal("gpt-5.6-terra"),
);

const trialSide = v.union(
  v.literal("user"),
  v.literal("opposing"),
  v.literal("neutral"),
);

const eventActorRole = v.union(
  v.literal("user_counsel"),
  v.literal("opposing_counsel"),
  v.literal("judge"),
  v.literal("witness"),
  v.literal("clerk"),
  v.literal("jury"),
  v.literal("system"),
  v.literal("debrief_coach"),
);

export default defineSchema({
  cases: defineTable({
    caseId: v.string(),
    slug: v.string(),
    title: v.string(),
    version: v.number(),
    status: v.union(v.literal("active"), v.literal("archived")),
    disclaimer: v.string(),
    neutralSummary: v.string(),
    publicFacts: v.array(v.object({ factId: v.string(), text: v.string() })),
    publicEvidence: v.array(
      v.object({ evidenceId: v.string(), name: v.string(), summary: v.string() }),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_case_id", ["caseId"]),

  privateCases: defineTable({
    caseId: v.string(),
    witnessFacts: v.array(v.object({ factId: v.string(), text: v.string() })),
    hiddenEvidence: v.array(
      v.object({
        evidenceId: v.string(),
        name: v.string(),
        content: v.string(),
      }),
    ),
    canonicalAssessment: v.array(v.string()),
    decisiveAnswer: v.string(),
    unsupportedAnswer: v.string(),
    version: v.number(),
  }).index("by_case_id", ["caseId"]),

  trials: defineTable({
    trialId: v.string(),
    caseId: v.string(),
    caseVersion: v.number(),
    mode: v.union(v.literal("participatory"), v.literal("autonomous")),
    side: v.union(v.literal("claimant"), v.literal("respondent")),
    phase,
    status: v.union(
      v.literal("active"),
      v.literal("waiting_for_user"),
      v.literal("running_actor"),
      v.literal("complete"),
      v.literal("failed"),
    ),
    allowedActions: v.array(v.string()),
    phaseSequence: v.number(),
    stateVersion: v.number(),
    lastCommittedActionId: v.optional(v.string()),
    failureCode: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_trial_id", ["trialId"])
    .index("by_status", ["status"]),

  turns: defineTable({
    turnId: v.string(),
    trialId: v.string(),
    sequence: v.number(),
    speaker: v.string(),
    actor: v.string(),
    phase,
    text: v.string(),
    source: v.string(),
    audioUrl: v.optional(v.string()),
    inputMode: v.optional(v.union(v.literal("typed"), v.literal("stt"))),
    factIds: v.array(v.string()),
    evidenceIds: v.array(v.string()),
    replyToTurnId: v.optional(v.string()),
    schemaVersion: v.string(),
    promptVersion: v.string(),
    createdAt: v.number(),
  })
    .index("by_trial", ["trialId"])
    .index("by_trial_sequence", ["trialId", "sequence"]),

  traces: defineTable({
    traceId: v.string(),
    trialId: v.string(),
    parentId: v.optional(v.string()),
    actor: v.string(),
    action: v.string(),
    phase,
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("succeeded"),
      v.literal("repaired"),
      v.literal("fallback"),
      v.literal("interrupted"),
      v.literal("failed"),
    ),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    latencyMs: v.optional(v.number()),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    inputCharacters: v.optional(v.number()),
    outputCharacters: v.optional(v.number()),
    audioDurationSeconds: v.optional(v.number()),
    estimatedCostUsd: v.optional(v.number()),
    retryCount: v.number(),
    fallbackUsed: v.boolean(),
    errorCode: v.optional(v.string()),
    errorSummary: v.optional(v.string()),
    plan: v.optional(v.array(v.string())),
    selectedSpecialist: v.optional(v.string()),
    persona: v.optional(v.string()),
    contractJson: v.optional(v.string()),
    delegationRationale: v.optional(v.string()),
    reviewJson: v.optional(v.string()),
    escalation: v.optional(v.string()),
    inputTurnIds: v.array(v.string()),
    outputTurnIds: v.array(v.string()),
    artifactIds: v.array(v.string()),
    schemaVersion: v.string(),
    promptVersion: v.string(),
  })
    .index("by_trace_id", ["traceId"])
    .index("by_trial", ["trialId"])
    .index("by_trial_started", ["trialId", "startedAt"]),

  juryVotes: defineTable({
    voteId: v.string(),
    trialId: v.string(),
    juror: v.string(),
    persona: v.string(),
    vote: v.union(
      v.literal("claimant"),
      v.literal("respondent"),
      v.literal("insufficient_record"),
    ),
    confidence: v.number(),
    reasoning: v.string(),
    turnCitations: v.array(v.string()),
    evidenceIds: v.array(v.string()),
    schemaVersion: v.string(),
    promptVersion: v.string(),
    caseVersion: v.number(),
    model: v.string(),
    createdAt: v.number(),
  }).index("by_trial", ["trialId"]),

  debriefs: defineTable({
    debriefId: v.string(),
    trialId: v.string(),
    status: artifactStatus,
    overallAssessment: v.string(),
    strengths: v.array(
      v.object({ finding: v.string(), turnCitations: v.array(v.string()) }),
    ),
    missedOpportunities: v.array(
      v.object({
        finding: v.string(),
        turnCitations: v.array(v.string()),
        recommendedQuestion: v.string(),
      }),
    ),
    contradictions: v.array(
      v.object({
        description: v.string(),
        status: v.union(v.literal("found"), v.literal("missed")),
        turnCitations: v.array(v.string()),
        evidenceIds: v.array(v.string()),
      }),
    ),
    evidenceUsed: v.array(
      v.object({ evidenceId: v.string(), turnCitations: v.array(v.string()) }),
    ),
    evidenceMissed: v.array(
      v.object({ evidenceId: v.string(), reason: v.string() }),
    ),
    jurorMovement: v.array(
      v.object({
        juror: v.string(),
        direction: v.string(),
        reason: v.string(),
        turnCitations: v.array(v.string()),
      }),
    ),
    revisedClosing: v.object({
      text: v.string(),
      basedOnTurnIds: v.array(v.string()),
    }),
    limitations: v.array(v.string()),
    schemaVersion: v.string(),
    promptVersion: v.string(),
    caseVersion: v.number(),
    model: v.string(),
    createdAt: v.number(),
  }).index("by_trial", ["trialId"]),

  evalRuns: defineTable({
    evalId: v.string(),
    trialId: v.string(),
    caseId: v.string(),
    scenarioId: v.string(),
    status: v.union(v.literal("passed"), v.literal("failed")),
    assertions: v.array(
      v.object({ name: v.string(), passed: v.boolean(), evidenceJson: v.string() }),
    ),
    passedCount: v.number(),
    totalCount: v.number(),
    score: v.number(),
    failureReason: v.optional(v.string()),
    schemaVersion: v.string(),
    promptVersion: v.string(),
    caseVersion: v.number(),
    model: v.string(),
    createdAt: v.number(),
    completedAt: v.number(),
  }).index("by_trial", ["trialId"]),

  productEvents: defineTable({
    eventId: v.string(),
    trialId: v.optional(v.string()),
    name: v.union(
      v.literal("hearing_started"),
      v.literal("question_submitted"),
      v.literal("contradiction_exposed"),
      v.literal("closing_submitted"),
      v.literal("hearing_completed"),
      v.literal("debrief_downloaded"),
    ),
    source: v.union(v.literal("product"), v.literal("evaluation")),
    metadataJson: v.string(),
    createdAt: v.number(),
  })
    .index("by_trial", ["trialId"])
    .index("by_name", ["name"]),

  // Additive SUITS 2.0 storage. Legacy tables above remain available while
  // migrations populate these immutable records and event-backed read models.
  caseGraphs: defineTable({
    graphId: v.string(),
    caseId: v.string(),
    version: v.number(),
    lifecycle: v.union(
      v.literal("draft"),
      v.literal("published"),
      v.literal("archived"),
    ),
    visibility: v.union(v.literal("private"), v.literal("seeded_public")),
    ownerId: v.optional(v.string()),
    uploadId: v.optional(v.string()),
    title: v.string(),
    graphJson: v.string(),
    graphSchemaVersion: v.string(),
    compilerMetadataJson: v.optional(v.string()),
    sourceDigest: v.optional(v.string()),
    createdBy: v.union(
      v.literal("user"),
      v.literal("system"),
      v.literal("migration"),
    ),
    createdAt: v.number(),
  })
    .index("by_graph_id", ["graphId"])
    .index("by_case_version", ["caseId", "version"])
    .index("by_owner", ["ownerId"])
    .index("by_owner_lifecycle", ["ownerId", "lifecycle"])
    .index("by_lifecycle", ["lifecycle"]),

  caseSources: defineTable({
    sourceSegmentId: v.string(),
    caseId: v.string(),
    caseVersion: v.number(),
    uploadId: v.optional(v.string()),
    sourceType: v.union(
      v.literal("seed"),
      v.literal("upload"),
      v.literal("extracted"),
      v.literal("inferred"),
    ),
    label: v.string(),
    pageNumber: v.optional(v.number()),
    segmentIndex: v.number(),
    content: v.string(),
    contentDigest: v.optional(v.string()),
    provenanceJson: v.string(),
    schemaVersion: v.string(),
    createdAt: v.number(),
  })
    .index("by_source_segment_id", ["sourceSegmentId"])
    .index("by_case_version", ["caseId", "caseVersion"])
    .index("by_upload", ["uploadId"]),

  caseUploads: defineTable({
    uploadRecordId: v.string(),
    uploadId: v.string(),
    version: v.number(),
    caseId: v.string(),
    caseVersion: v.optional(v.number()),
    ownerId: v.string(),
    storageId: v.optional(v.id("_storage")),
    originalName: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    contentDigest: v.string(),
    status: v.union(
      v.literal("uploaded"),
      v.literal("indexed"),
      v.literal("rejected"),
    ),
    metadataJson: v.string(),
    schemaVersion: v.string(),
    createdAt: v.number(),
  })
    .index("by_upload_record_id", ["uploadRecordId"])
    .index("by_upload_version", ["uploadId", "version"])
    .index("by_case_version", ["caseId", "caseVersion"])
    .index("by_storage_id", ["storageId"])
    .index("by_owner", ["ownerId"]),

  caseCompileQuotas: defineTable({
    clientKeyHash: v.string(),
    attemptedAt: v.array(v.number()),
    updatedAt: v.number(),
  })
    .index("by_client_key_hash", ["clientKeyHash"])
    .index("by_updated_at", ["updatedAt"]),

  caseCompileClaims: defineTable({
    claimId: v.string(),
    ownerId: v.string(),
    uploadId: v.string(),
    caseId: v.string(),
    contentDigest: v.string(),
    clientKeyHash: v.string(),
    status: v.union(
      v.literal("leased"),
      v.literal("retryable_failed"),
      v.literal("terminal_failed"),
      v.literal("completed"),
    ),
    generation: v.number(),
    leaseToken: v.union(v.string(), v.null()),
    leaseExpiresAt: v.union(v.number(), v.null()),
    lastHeartbeatAt: v.union(v.number(), v.null()),
    failureCode: v.union(v.string(), v.null()),
    completedAt: v.union(v.number(), v.null()),
    quotaConsumedAt: v.union(v.number(), v.null()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_claim_id", ["claimId"])
    .index("by_upload_id", ["uploadId"])
    .index("by_case_id", ["caseId"])
    .index("by_owner", ["ownerId"])
    .index("by_content_digest_created_at", ["contentDigest", "createdAt"])
    .index("by_content_digest_updated_at", ["contentDigest", "updatedAt"])
    .index("by_status_lease_expiry", ["status", "leaseExpiresAt"]),

  caseStorageReconcileLocks: defineTable({
    singletonKey: v.string(),
    activeSweepId: v.string(),
    generation: v.number(),
    updatedAt: v.number(),
  }).index("by_singleton_key", ["singletonKey"]),

  caseStorageReconcileSweeps: defineTable({
    sweepId: v.string(),
    generation: v.number(),
    status: v.union(
      v.literal("running"),
      v.literal("completed"),
      v.literal("fenced"),
    ),
    mode: v.union(v.literal("dry_run"), v.literal("delete")),
    cutoff: v.number(),
    cursor: v.union(v.string(), v.null()),
    pages: v.number(),
    scanned: v.number(),
    eligible: v.number(),
    deleted: v.number(),
    dryRunRetained: v.number(),
    missing: v.number(),
    retainedTooYoung: v.number(),
    retainedReferenced: v.number(),
    retainedUnsupported: v.number(),
    retainedUnrecognizedDigest: v.number(),
    retainedNoClaim: v.number(),
    startedAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.union(v.number(), v.null()),
  })
    .index("by_sweep_id", ["sweepId"])
    .index("by_status_updated_at", ["status", "updatedAt"]),

  caseStorageDeletionAudits: defineTable({
    auditId: v.string(),
    sweepId: v.string(),
    generation: v.number(),
    storageId: v.id("_storage"),
    storageCreatedAt: v.number(),
    storageSha256: v.string(),
    contentDigest: v.string(),
    contentType: v.string(),
    sizeBytes: v.number(),
    claimId: v.string(),
    claimCreatedAt: v.number(),
    claimUpdatedAt: v.number(),
    deletedAt: v.number(),
  })
    .index("by_audit_id", ["auditId"])
    .index("by_sweep", ["sweepId"])
    .index("by_storage_id", ["storageId"]),

  trialEvents: defineTable({
    eventId: v.string(),
    trialId: v.string(),
    sequence: v.number(),
    stateVersion: v.number(),
    actionId: v.string(),
    eventType: v.union(
      v.literal("START_TRIAL"),
      v.literal("BEGIN_PHASE"),
      v.literal("CALL_WITNESS"),
      v.literal("SWEAR_WITNESS"),
      v.literal("ASK_QUESTION"),
      v.literal("ANSWER_QUESTION"),
      v.literal("END_EXAMINATION"),
      v.literal("RECALL_WITNESS"),
      v.literal("RELEASE_WITNESS"),
      v.literal("OBJECT"),
      v.literal("RULE_ON_OBJECTION"),
      v.literal("REPHRASE_QUESTION"),
      v.literal("MOVE_TO_STRIKE"),
      v.literal("STRIKE_TESTIMONY"),
      v.literal("OFFER_EVIDENCE"),
      v.literal("RULE_ON_EVIDENCE"),
      v.literal("WITHDRAW_EVIDENCE"),
      v.literal("REVEAL_HIDDEN_FACT"),
      v.literal("PROPOSE_ASSERTION"),
      v.literal("VERIFY_ASSERTION"),
      v.literal("DISPUTE_ASSERTION"),
      v.literal("RULE_ON_ASSERTION"),
      v.literal("REQUEST_RESPONSE"),
      v.literal("CANCEL_RESPONSE"),
      v.literal("COMPLETE_RESPONSE"),
      v.literal("BEGIN_INTERRUPTION"),
      v.literal("RESOLVE_INTERRUPTION"),
      v.literal("RESUME_INTERRUPTED_SPEECH"),
      v.literal("PAUSE_TRIAL"),
      v.literal("REQUEST_RECESS"),
      v.literal("RESUME_TRIAL"),
      v.literal("PROPOSE_SETTLEMENT"),
      v.literal("COUNTER_SETTLEMENT"),
      v.literal("ACCEPT_SETTLEMENT"),
      v.literal("REJECT_SETTLEMENT"),
      v.literal("WITHDRAW_SETTLEMENT"),
      v.literal("EXPIRE_SETTLEMENT"),
      v.literal("REST_CASE"),
      v.literal("GIVE_CLOSING"),
      v.literal("INSTRUCT_JURY"),
      v.literal("DELIBERATE"),
      v.literal("RENDER_VERDICT"),
      v.literal("GENERATE_DEBRIEF"),
      v.literal("FAIL_STEP"),
      v.literal("RECOVER_STEP"),
    ),
    actorId: v.string(),
    actorRole: eventActorRole,
    actorSide: trialSide,
    witnessId: v.optional(v.string()),
    source: v.union(
      v.literal("user"),
      v.literal("ai"),
      v.literal("deterministic"),
      v.literal("speech"),
      v.literal("system"),
    ),
    causationId: v.optional(v.string()),
    correlationId: v.optional(v.string()),
    responseId: v.optional(v.string()),
    interruptId: v.optional(v.string()),
    utteranceId: v.optional(v.string()),
    utteranceRevision: v.optional(v.number()),
    payloadJson: v.string(),
    payloadSchemaVersion: v.string(),
    eventSchemaVersion: v.string(),
    promptVersion: v.optional(v.string()),
    model: v.optional(runtimeOpenAiModel),
    modelRequestId: v.optional(v.string()),
    modelSchemaVersion: v.optional(v.string()),
    modelLatencyMs: v.optional(v.number()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    estimatedCostUsd: v.optional(v.number()),
    retryCount: v.optional(v.number()),
    validationFailureCount: v.optional(v.number()),
    factIds: v.array(v.string()),
    evidenceIds: v.array(v.string()),
    testimonyIds: v.array(v.string()),
    citationEventIds: v.array(v.string()),
    sourceSegmentIds: v.array(v.string()),
    turnIds: v.array(v.string()),
    occurredAt: v.number(),
    committedAt: v.number(),
  })
    .index("by_event_id", ["eventId"])
    .index("by_trial_sequence", ["trialId", "sequence"])
    .index("by_trial_action", ["trialId", "actionId"])
    .index("by_trial_correlation", ["trialId", "correlationId"]),

  actionReceipts: defineTable({
    receiptId: v.string(),
    actionId: v.string(),
    trialId: v.string(),
    status: v.literal("committed"),
    expectedStateVersion: v.number(),
    committedStateVersion: v.number(),
    firstSequence: v.number(),
    lastSequence: v.number(),
    eventIds: v.array(v.string()),
    requestHash: v.optional(v.string()),
    resultJson: v.optional(v.string()),
    schemaVersion: v.string(),
    createdAt: v.number(),
  })
    .index("by_receipt_id", ["receiptId"])
    .index("by_action_id", ["actionId"])
    .index("by_trial_action", ["trialId", "actionId"])
    .index("by_trial_version", ["trialId", "committedStateVersion"]),

  trialProjections: defineTable({
    projectionId: v.string(),
    trialId: v.string(),
    stateVersion: v.number(),
    lastSequence: v.number(),
    stateJson: v.string(),
    stateSchemaVersion: v.string(),
    eventSchemaVersion: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_trial", ["trialId"]),

  trialSnapshots: defineTable({
    snapshotId: v.string(),
    trialId: v.string(),
    stateVersion: v.number(),
    lastSequence: v.number(),
    stateJson: v.string(),
    stateSchemaVersion: v.string(),
    source: v.union(v.literal("event_commit"), v.literal("migration")),
    createdAt: v.number(),
  })
    .index("by_snapshot_id", ["snapshotId"])
    .index("by_trial_version", ["trialId", "stateVersion"]),

  migrationCheckpoints: defineTable({
    checkpointId: v.string(),
    migrationId: v.string(),
    scope: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("complete"),
      v.literal("failed"),
    ),
    cursor: v.optional(v.string()),
    processedCount: v.number(),
    insertedCount: v.number(),
    skippedCount: v.number(),
    errorCount: v.number(),
    lastBatchId: v.optional(v.string()),
    lastBatchInputCursor: v.optional(v.string()),
    lastBatchOutputCursor: v.optional(v.string()),
    lastBatchProcessedCount: v.optional(v.number()),
    lastBatchInsertedCount: v.optional(v.number()),
    lastBatchSkippedCount: v.optional(v.number()),
    detailsJson: v.optional(v.string()),
    schemaVersion: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_checkpoint_id", ["checkpointId"])
    .index("by_migration_scope", ["migrationId", "scope"])
    .index("by_status", ["status"]),
});
