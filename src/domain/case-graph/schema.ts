import { z } from "zod";

export const CASE_GRAPH_SCHEMA_VERSION = "case-graph.v1" as const;
export const CASE_GRAPH_VERSION = 1 as const;

const entityIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const sha256Pattern = /^[a-f0-9]{64}$/;

export const CaseGraphEntityIdSchema = z
  .string()
  .trim()
  .min(3)
  .max(128)
  .regex(entityIdPattern, "IDs may contain only letters, numbers, dot, underscore, colon, and hyphen");

const Sha256Schema = z.string().regex(sha256Pattern, "Expected a lowercase SHA-256 digest");
const DateTimeSchema = z.string().datetime({ offset: true });

const UniqueEntityIdArraySchema = z.array(CaseGraphEntityIdSchema).superRefine((ids, ctx) => {
  const seen = new Set<string>();
  ids.forEach((id, index) => {
    if (seen.has(id)) {
      ctx.addIssue({
        code: "custom",
        path: [index],
        message: `Duplicate reference: ${id}`,
      });
    }
    seen.add(id);
  });
});

export const SourceLocatorSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("page"),
      page: z.number().int().positive(),
      label: z.string().trim().min(1).max(120).nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("text"),
      startOffset: z.number().int().nonnegative(),
      endOffset: z.number().int().positive(),
    })
    .strict()
    .superRefine((locator, ctx) => {
      if (locator.endOffset <= locator.startOffset) {
        ctx.addIssue({
          code: "custom",
          path: ["endOffset"],
          message: "Text locator endOffset must be greater than startOffset",
        });
      }
    }),
]);

export const SourceSegmentSchema = z
  .object({
    sourceSegmentId: CaseGraphEntityIdSchema,
    sourceId: CaseGraphEntityIdSchema,
    documentName: z.string().trim().min(1).max(240),
    mimeType: z.string().trim().min(1).max(120),
    locator: SourceLocatorSchema,
    excerpt: z.string().trim().min(1).max(8_000),
    sha256: Sha256Schema,
  })
  .strict();

export const ProvenanceSchema = z
  .object({
    provenanceId: CaseGraphEntityIdSchema,
    kind: z.enum(["source", "authoring", "inferred"]),
    sourceSegmentIds: UniqueEntityIdArraySchema,
    note: z.string().trim().min(1).max(1_000),
    confidence: z.number().min(0).max(1),
  })
  .strict()
  .superRefine((provenance, ctx) => {
    if (provenance.kind === "source" && provenance.sourceSegmentIds.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["sourceSegmentIds"],
        message: "Source provenance must cite at least one source segment",
      });
    }
    if (provenance.kind === "inferred" && provenance.confidence === 1) {
      ctx.addIssue({
        code: "custom",
        path: ["confidence"],
        message: "Inferred provenance cannot claim certainty",
      });
    }
  });

const ProvenanceListSchema = z.array(ProvenanceSchema).min(1);

export const PartySchema = z
  .object({
    partyId: CaseGraphEntityIdSchema,
    name: z.string().trim().min(1).max(200),
    kind: z.enum(["person", "organization", "government"]),
    proceduralRole: z.enum(["claimant", "respondent", "prosecution", "defense", "third_party"]),
    simulationSide: z.enum(["user", "opposing", "neutral"]),
    description: z.string().trim().min(1).max(2_000),
    counselName: z.string().trim().min(1).max(200).nullable(),
    provenance: ProvenanceListSchema,
  })
  .strict();

export const LegalIssueSchema = z
  .object({
    issueId: CaseGraphEntityIdSchema,
    title: z.string().trim().min(1).max(240),
    question: z.string().trim().min(1).max(2_000),
    burdenPartyId: CaseGraphEntityIdSchema.nullable(),
    standard: z.string().trim().min(1).max(1_000),
    relatedFactIds: UniqueEntityIdArraySchema,
    relatedEvidenceIds: UniqueEntityIdArraySchema,
    provenance: ProvenanceListSchema,
  })
  .strict();

export const TimelineEventSchema = z
  .object({
    timelineEventId: CaseGraphEntityIdSchema,
    occurredAt: DateTimeSchema,
    summary: z.string().trim().min(1).max(2_000),
    relatedFactIds: UniqueEntityIdArraySchema,
    relatedEvidenceIds: UniqueEntityIdArraySchema,
    witnessIds: UniqueEntityIdArraySchema,
    provenance: ProvenanceListSchema,
  })
  .strict();

export const FactSchema = z
  .object({
    factId: CaseGraphEntityIdSchema,
    proposition: z.string().trim().min(1).max(3_000),
    classification: z.enum(["authoring_truth", "party_allegation", "inference"]),
    initialStatus: z.enum(["hidden", "proposed", "verified"]),
    visibility: z.enum(["public", "restricted"]),
    assertedByPartyIds: UniqueEntityIdArraySchema,
    relatedIssueIds: UniqueEntityIdArraySchema,
    relatedEvidenceIds: UniqueEntityIdArraySchema,
    witnessIds: UniqueEntityIdArraySchema,
    provenance: ProvenanceListSchema,
  })
  .strict()
  .superRefine((fact, ctx) => {
    if (fact.initialStatus === "hidden" && fact.visibility !== "restricted") {
      ctx.addIssue({
        code: "custom",
        path: ["visibility"],
        message: "A hidden fact must have restricted visibility",
      });
    }
    if (fact.classification === "inference" && fact.initialStatus === "verified") {
      ctx.addIssue({
        code: "custom",
        path: ["initialStatus"],
        message: "An inference cannot begin as a verified fact",
      });
    }
  });

export const EvidenceItemSchema = z
  .object({
    evidenceId: CaseGraphEntityIdSchema,
    name: z.string().trim().min(1).max(240),
    description: z.string().trim().min(1).max(3_000),
    kind: z.enum(["document", "audio", "video", "image", "physical", "digital", "other"]),
    initialStatus: z.enum(["uploaded", "indexed"]),
    authoringAdmissibility: z.enum(["undetermined", "likely_admissible", "likely_excluded"]),
    offeredByPartyIds: UniqueEntityIdArraySchema,
    relatedFactIds: UniqueEntityIdArraySchema,
    relatedIssueIds: UniqueEntityIdArraySchema,
    custodianWitnessIds: UniqueEntityIdArraySchema,
    authenticatingWitnessIds: UniqueEntityIdArraySchema,
    provenance: ProvenanceListSchema,
  })
  .strict();

export const PriorStatementSchema = z
  .object({
    priorStatementId: CaseGraphEntityIdSchema,
    madeAt: DateTimeSchema,
    kind: z.enum(["interview", "email", "deposition", "affidavit", "report", "other"]),
    text: z.string().trim().min(1).max(5_000),
    relatedFactIds: UniqueEntityIdArraySchema,
    relatedEvidenceIds: UniqueEntityIdArraySchema,
    provenance: ProvenanceListSchema,
  })
  .strict();

export const KnowledgeBoundarySchema = z
  .object({
    knownFactIds: UniqueEntityIdArraySchema,
    perceivedFactIds: UniqueEntityIdArraySchema,
    seenEvidenceIds: UniqueEntityIdArraySchema,
    availablePriorStatementIds: UniqueEntityIdArraySchema,
    unknownFactIds: UniqueEntityIdArraySchema,
    allowedTopics: z.array(z.string().trim().min(1).max(500)),
    forbiddenTopics: z.array(z.string().trim().min(1).max(500)),
  })
  .strict()
  .superRefine((boundary, ctx) => {
    const known = new Set(boundary.knownFactIds);
    boundary.perceivedFactIds.forEach((factId, index) => {
      if (!known.has(factId)) {
        ctx.addIssue({
          code: "custom",
          path: ["perceivedFactIds", index],
          message: `A perceived fact must also be known: ${factId}`,
        });
      }
    });
    boundary.unknownFactIds.forEach((factId, index) => {
      if (known.has(factId)) {
        ctx.addIssue({
          code: "custom",
          path: ["unknownFactIds", index],
          message: `A fact cannot be both known and unknown: ${factId}`,
        });
      }
    });
  });

export const WitnessProfileSchema = z
  .object({
    witnessId: CaseGraphEntityIdSchema,
    name: z.string().trim().min(1).max(200),
    kind: z.enum(["fact", "expert", "character"]),
    role: z.string().trim().min(1).max(500),
    alignedPartyId: CaseGraphEntityIdSchema.nullable(),
    callableByPartyIds: UniqueEntityIdArraySchema,
    summary: z.string().trim().min(1).max(2_000),
    emotionalBaseline: z.enum(["neutral", "confident", "nervous", "defensive", "empathetic"]),
    knowledgeBoundary: KnowledgeBoundarySchema,
    priorStatements: z.array(PriorStatementSchema),
    provenance: ProvenanceListSchema,
  })
  .strict();

export const ContradictionEndpointSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fact"), factId: CaseGraphEntityIdSchema }).strict(),
  z.object({ kind: z.literal("evidence"), evidenceId: CaseGraphEntityIdSchema }).strict(),
  z.object({ kind: z.literal("prior_statement"), priorStatementId: CaseGraphEntityIdSchema }).strict(),
  z.object({ kind: z.literal("timeline_event"), timelineEventId: CaseGraphEntityIdSchema }).strict(),
]);

export const ContradictionSchema = z
  .object({
    contradictionId: CaseGraphEntityIdSchema,
    summary: z.string().trim().min(1).max(2_000),
    left: ContradictionEndpointSchema,
    right: ContradictionEndpointSchema,
    witnessIds: UniqueEntityIdArraySchema,
    relatedIssueIds: UniqueEntityIdArraySchema,
    severity: z.enum(["minor", "material", "decisive"]),
    provenance: ProvenanceListSchema,
  })
  .strict();

export const SettlementPartyPositionSchema = z
  .object({
    partyId: CaseGraphEntityIdSchema,
    minimumAuthority: z.number().nonnegative(),
    maximumAuthority: z.number().nonnegative(),
    reservationValue: z.number().nonnegative(),
    targetValue: z.number().nonnegative(),
    confidentialPriorities: z.array(z.string().trim().min(1).max(500)).min(1),
    permittedNonMonetaryTerms: z.array(z.string().trim().min(1).max(500)),
  })
  .strict()
  .superRefine((position, ctx) => {
    if (position.maximumAuthority < position.minimumAuthority) {
      ctx.addIssue({
        code: "custom",
        path: ["maximumAuthority"],
        message: "maximumAuthority must be at least minimumAuthority",
      });
    }
    if (position.reservationValue < position.minimumAuthority || position.reservationValue > position.maximumAuthority) {
      ctx.addIssue({
        code: "custom",
        path: ["reservationValue"],
        message: "reservationValue must fall within the authority range",
      });
    }
    if (position.targetValue < position.minimumAuthority || position.targetValue > position.maximumAuthority) {
      ctx.addIssue({
        code: "custom",
        path: ["targetValue"],
        message: "targetValue must fall within the authority range",
      });
    }
  });

export const SettlementConfigurationSchema = z
  .object({
    enabled: z.boolean(),
    currency: z.string().regex(/^[A-Z]{3}$/, "Expected an ISO-style three-letter currency"),
    participants: z.array(SettlementPartyPositionSchema).min(2),
    opensAtPhase: z.enum(["pretrial", "opening", "case_in_chief", "recess", "pre_closing"]),
    expiresAfterEventCount: z.number().int().positive(),
    allowCounteroffers: z.boolean(),
    provenance: ProvenanceListSchema,
  })
  .strict();

export const JuryInstructionSchema = z
  .object({
    instructionId: CaseGraphEntityIdSchema,
    title: z.string().trim().min(1).max(240),
    text: z.string().trim().min(1).max(5_000),
    relatedIssueIds: UniqueEntityIdArraySchema,
    requiredFactIds: UniqueEntityIdArraySchema,
    relatedEvidenceIds: UniqueEntityIdArraySchema,
    provenance: ProvenanceListSchema,
  })
  .strict();

export const JurisdictionProfileSchema = z
  .object({
    profileId: CaseGraphEntityIdSchema,
    name: z.string().trim().min(1).max(240),
    rulesVersion: z.string().trim().min(1).max(120),
    governingLaw: z.string().trim().min(1).max(1_000),
    burdenOfProof: z.enum(["preponderance", "clear_and_convincing", "beyond_reasonable_doubt"]),
    permittedObjectionGrounds: z.array(
      z.enum([
        "relevance",
        "hearsay",
        "leading",
        "speculation",
        "foundation",
        "asked_and_answered",
        "argumentative",
        "compound",
        "privilege",
      ]),
    ).min(1),
    provenance: ProvenanceListSchema,
  })
  .strict();

export const CompilerWarningSchema = z
  .object({
    code: CaseGraphEntityIdSchema,
    message: z.string().trim().min(1).max(1_000),
    sourceSegmentIds: UniqueEntityIdArraySchema,
  })
  .strict();

export const CompilerUncertaintySchema = z
  .object({
    uncertaintyId: CaseGraphEntityIdSchema,
    description: z.string().trim().min(1).max(2_000),
    relatedFactIds: UniqueEntityIdArraySchema,
    relatedEvidenceIds: UniqueEntityIdArraySchema,
    relatedWitnessIds: UniqueEntityIdArraySchema,
    sourceSegmentIds: UniqueEntityIdArraySchema,
  })
  .strict();

export const CompilerMetadataSchema = z
  .object({
    method: z.enum(["gpt", "seeded", "manual"]),
    model: z.literal("gpt-5.6-terra").nullable(),
    requestId: z.string().trim().min(1).max(240).nullable(),
    promptVersion: z.string().trim().min(1).max(120),
    compiledAt: DateTimeSchema,
    sourceContentHash: Sha256Schema,
    sourceSegmentCount: z.number().int().nonnegative(),
    warnings: z.array(CompilerWarningSchema),
    uncertainties: z.array(CompilerUncertaintySchema),
  })
  .strict()
  .superRefine((metadata, ctx) => {
    if (metadata.method === "gpt") {
      if (metadata.model !== "gpt-5.6-terra") {
        ctx.addIssue({ code: "custom", path: ["model"], message: "GPT compilation requires gpt-5.6-terra" });
      }
      if (metadata.requestId === null) {
        ctx.addIssue({ code: "custom", path: ["requestId"], message: "GPT compilation requires a request ID" });
      }
    } else if (metadata.model !== null || metadata.requestId !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["model"],
        message: "Seeded and manual compilation must not claim a model request",
      });
    }
  });

export type SourceSegment = z.infer<typeof SourceSegmentSchema>;
export type Provenance = z.infer<typeof ProvenanceSchema>;
export type Party = z.infer<typeof PartySchema>;
export type LegalIssue = z.infer<typeof LegalIssueSchema>;
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;
export type Fact = z.infer<typeof FactSchema>;
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;
export type PriorStatement = z.infer<typeof PriorStatementSchema>;
export type KnowledgeBoundary = z.infer<typeof KnowledgeBoundarySchema>;
export type WitnessProfile = z.infer<typeof WitnessProfileSchema>;
export type Contradiction = z.infer<typeof ContradictionSchema>;
export type SettlementConfiguration = z.infer<typeof SettlementConfigurationSchema>;
export type JuryInstruction = z.infer<typeof JuryInstructionSchema>;
export type JurisdictionProfile = z.infer<typeof JurisdictionProfileSchema>;
export type CompilerMetadata = z.infer<typeof CompilerMetadataSchema>;

const CaseGraphV1ObjectSchema = z
  .object({
    schemaVersion: z.literal(CASE_GRAPH_SCHEMA_VERSION),
    caseId: CaseGraphEntityIdSchema,
    version: z.literal(CASE_GRAPH_VERSION),
    title: z.string().trim().min(1).max(300),
    summary: z.string().trim().min(1).max(5_000),
    status: z.enum(["draft", "published", "archived"]),
    educationalDisclaimer: z.string().trim().min(1).max(1_000),
    jurisdictionProfile: JurisdictionProfileSchema,
    parties: z.array(PartySchema).min(2),
    issues: z.array(LegalIssueSchema).min(1),
    timeline: z.array(TimelineEventSchema).min(1),
    facts: z.array(FactSchema).min(1),
    evidence: z.array(EvidenceItemSchema).min(1),
    witnesses: z.array(WitnessProfileSchema).min(1),
    contradictions: z.array(ContradictionSchema),
    settlement: SettlementConfigurationSchema,
    juryInstructions: z.array(JuryInstructionSchema).min(1),
    sourceSegments: z.array(SourceSegmentSchema).min(1),
    compilerMetadata: CompilerMetadataSchema,
  })
  .strict();

/**
 * Structural CaseGraph shape for boundaries that must keep extracted source
 * payloads server-owned. Canonical CaseGraph validation still happens through
 * CaseGraphV1Schema after trusted source segments are attached.
 */
export const CaseGraphV1WithoutSourceSegmentsSchema = CaseGraphV1ObjectSchema.omit({
  sourceSegments: true,
}).strict();

export const CaseGraphV1Schema = CaseGraphV1ObjectSchema.superRefine((graph, ctx) => {
  type Path = Array<string | number>;
  const addIssue = (path: Path, message: string) => ctx.addIssue({ code: "custom", path, message });

  const registerUnique = <T>(
    items: readonly T[],
    getId: (item: T) => string,
    pathName: string,
    label: string,
  ): Set<string> => {
    const ids = new Set<string>();
    items.forEach((item, index) => {
      const id = getId(item);
      if (ids.has(id)) addIssue([pathName, index], `Duplicate ${label} ID: ${id}`);
      ids.add(id);
    });
    return ids;
  };

  const partyIds = registerUnique(graph.parties, (item) => item.partyId, "parties", "party");
  const issueIds = registerUnique(graph.issues, (item) => item.issueId, "issues", "issue");
  const timelineEventIds = registerUnique(graph.timeline, (item) => item.timelineEventId, "timeline", "timeline event");
  const factIds = registerUnique(graph.facts, (item) => item.factId, "facts", "fact");
  const evidenceIds = registerUnique(graph.evidence, (item) => item.evidenceId, "evidence", "evidence");
  const witnessIds = registerUnique(graph.witnesses, (item) => item.witnessId, "witnesses", "witness");
  const contradictionIds = registerUnique(
    graph.contradictions,
    (item) => item.contradictionId,
    "contradictions",
    "contradiction",
  );
  const instructionIds = registerUnique(
    graph.juryInstructions,
    (item) => item.instructionId,
    "juryInstructions",
    "jury instruction",
  );
  const sourceSegmentIds = registerUnique(
    graph.sourceSegments,
    (item) => item.sourceSegmentId,
    "sourceSegments",
    "source segment",
  );
  void contradictionIds;
  void instructionIds;

  const priorStatements = graph.witnesses.flatMap((witness, witnessIndex) =>
    witness.priorStatements.map((statement, statementIndex) => ({ statement, witnessIndex, statementIndex })),
  );
  const priorStatementIds = new Set<string>();
  const priorStatementOwner = new Map<string, string>();
  priorStatements.forEach(({ statement, witnessIndex, statementIndex }) => {
    if (priorStatementIds.has(statement.priorStatementId)) {
      addIssue(
        ["witnesses", witnessIndex, "priorStatements", statementIndex, "priorStatementId"],
        `Duplicate prior statement ID: ${statement.priorStatementId}`,
      );
    }
    priorStatementIds.add(statement.priorStatementId);
    priorStatementOwner.set(statement.priorStatementId, graph.witnesses[witnessIndex].witnessId);
  });

  const checkReferences = (
    references: readonly string[],
    allowed: ReadonlySet<string>,
    path: Path,
    label: string,
  ) => {
    references.forEach((id, index) => {
      if (!allowed.has(id)) addIssue([...path, index], `Unknown ${label} reference: ${id}`);
    });
  };

  graph.issues.forEach((issue, index) => {
    if (issue.burdenPartyId !== null && !partyIds.has(issue.burdenPartyId)) {
      addIssue(["issues", index, "burdenPartyId"], `Unknown party reference: ${issue.burdenPartyId}`);
    }
    checkReferences(issue.relatedFactIds, factIds, ["issues", index, "relatedFactIds"], "fact");
    checkReferences(issue.relatedEvidenceIds, evidenceIds, ["issues", index, "relatedEvidenceIds"], "evidence");
  });

  graph.timeline.forEach((event, index) => {
    checkReferences(event.relatedFactIds, factIds, ["timeline", index, "relatedFactIds"], "fact");
    checkReferences(event.relatedEvidenceIds, evidenceIds, ["timeline", index, "relatedEvidenceIds"], "evidence");
    checkReferences(event.witnessIds, witnessIds, ["timeline", index, "witnessIds"], "witness");
  });

  graph.facts.forEach((fact, index) => {
    checkReferences(fact.assertedByPartyIds, partyIds, ["facts", index, "assertedByPartyIds"], "party");
    checkReferences(fact.relatedIssueIds, issueIds, ["facts", index, "relatedIssueIds"], "issue");
    checkReferences(fact.relatedEvidenceIds, evidenceIds, ["facts", index, "relatedEvidenceIds"], "evidence");
    checkReferences(fact.witnessIds, witnessIds, ["facts", index, "witnessIds"], "witness");
  });

  graph.evidence.forEach((evidence, index) => {
    checkReferences(evidence.offeredByPartyIds, partyIds, ["evidence", index, "offeredByPartyIds"], "party");
    checkReferences(evidence.relatedFactIds, factIds, ["evidence", index, "relatedFactIds"], "fact");
    checkReferences(evidence.relatedIssueIds, issueIds, ["evidence", index, "relatedIssueIds"], "issue");
    checkReferences(evidence.custodianWitnessIds, witnessIds, ["evidence", index, "custodianWitnessIds"], "witness");
    checkReferences(
      evidence.authenticatingWitnessIds,
      witnessIds,
      ["evidence", index, "authenticatingWitnessIds"],
      "witness",
    );
  });

  graph.witnesses.forEach((witness, witnessIndex) => {
    if (witness.alignedPartyId !== null && !partyIds.has(witness.alignedPartyId)) {
      addIssue(
        ["witnesses", witnessIndex, "alignedPartyId"],
        `Unknown party reference: ${witness.alignedPartyId}`,
      );
    }
    checkReferences(
      witness.callableByPartyIds,
      partyIds,
      ["witnesses", witnessIndex, "callableByPartyIds"],
      "party",
    );
    checkReferences(
      witness.knowledgeBoundary.knownFactIds,
      factIds,
      ["witnesses", witnessIndex, "knowledgeBoundary", "knownFactIds"],
      "fact",
    );
    checkReferences(
      witness.knowledgeBoundary.perceivedFactIds,
      factIds,
      ["witnesses", witnessIndex, "knowledgeBoundary", "perceivedFactIds"],
      "fact",
    );
    checkReferences(
      witness.knowledgeBoundary.unknownFactIds,
      factIds,
      ["witnesses", witnessIndex, "knowledgeBoundary", "unknownFactIds"],
      "fact",
    );
    checkReferences(
      witness.knowledgeBoundary.seenEvidenceIds,
      evidenceIds,
      ["witnesses", witnessIndex, "knowledgeBoundary", "seenEvidenceIds"],
      "evidence",
    );
    checkReferences(
      witness.knowledgeBoundary.availablePriorStatementIds,
      priorStatementIds,
      ["witnesses", witnessIndex, "knowledgeBoundary", "availablePriorStatementIds"],
      "prior statement",
    );
    witness.knowledgeBoundary.availablePriorStatementIds.forEach((statementId, statementIndex) => {
      const owner = priorStatementOwner.get(statementId);
      if (owner !== undefined && owner !== witness.witnessId) {
        addIssue(
          ["witnesses", witnessIndex, "knowledgeBoundary", "availablePriorStatementIds", statementIndex],
          `Witness cannot receive another witness's prior statement: ${statementId}`,
        );
      }
    });
    witness.priorStatements.forEach((statement, statementIndex) => {
      checkReferences(
        statement.relatedFactIds,
        factIds,
        ["witnesses", witnessIndex, "priorStatements", statementIndex, "relatedFactIds"],
        "fact",
      );
      checkReferences(
        statement.relatedEvidenceIds,
        evidenceIds,
        ["witnesses", witnessIndex, "priorStatements", statementIndex, "relatedEvidenceIds"],
        "evidence",
      );
    });
  });

  const endpointKey = (endpoint: z.infer<typeof ContradictionEndpointSchema>): string => {
    switch (endpoint.kind) {
      case "fact":
        return `fact:${endpoint.factId}`;
      case "evidence":
        return `evidence:${endpoint.evidenceId}`;
      case "prior_statement":
        return `prior_statement:${endpoint.priorStatementId}`;
      case "timeline_event":
        return `timeline_event:${endpoint.timelineEventId}`;
    }
  };
  const checkEndpoint = (
    endpoint: z.infer<typeof ContradictionEndpointSchema>,
    path: Path,
  ) => {
    switch (endpoint.kind) {
      case "fact":
        if (!factIds.has(endpoint.factId)) addIssue([...path, "factId"], `Unknown fact reference: ${endpoint.factId}`);
        break;
      case "evidence":
        if (!evidenceIds.has(endpoint.evidenceId)) {
          addIssue([...path, "evidenceId"], `Unknown evidence reference: ${endpoint.evidenceId}`);
        }
        break;
      case "prior_statement":
        if (!priorStatementIds.has(endpoint.priorStatementId)) {
          addIssue(
            [...path, "priorStatementId"],
            `Unknown prior statement reference: ${endpoint.priorStatementId}`,
          );
        }
        break;
      case "timeline_event":
        if (!timelineEventIds.has(endpoint.timelineEventId)) {
          addIssue(
            [...path, "timelineEventId"],
            `Unknown timeline event reference: ${endpoint.timelineEventId}`,
          );
        }
        break;
    }
  };
  graph.contradictions.forEach((contradiction, index) => {
    checkEndpoint(contradiction.left, ["contradictions", index, "left"]);
    checkEndpoint(contradiction.right, ["contradictions", index, "right"]);
    if (endpointKey(contradiction.left) === endpointKey(contradiction.right)) {
      addIssue(["contradictions", index, "right"], "A contradiction must compare two distinct records");
    }
    checkReferences(
      contradiction.witnessIds,
      witnessIds,
      ["contradictions", index, "witnessIds"],
      "witness",
    );
    checkReferences(
      contradiction.relatedIssueIds,
      issueIds,
      ["contradictions", index, "relatedIssueIds"],
      "issue",
    );
  });

  const settlementPartyIds = new Set<string>();
  graph.settlement.participants.forEach((participant, index) => {
    if (settlementPartyIds.has(participant.partyId)) {
      addIssue(["settlement", "participants", index, "partyId"], `Duplicate settlement party ID: ${participant.partyId}`);
    }
    settlementPartyIds.add(participant.partyId);
    if (!partyIds.has(participant.partyId)) {
      addIssue(
        ["settlement", "participants", index, "partyId"],
        `Unknown party reference: ${participant.partyId}`,
      );
    }
  });

  graph.juryInstructions.forEach((instruction, index) => {
    checkReferences(
      instruction.relatedIssueIds,
      issueIds,
      ["juryInstructions", index, "relatedIssueIds"],
      "issue",
    );
    checkReferences(
      instruction.requiredFactIds,
      factIds,
      ["juryInstructions", index, "requiredFactIds"],
      "fact",
    );
    checkReferences(
      instruction.relatedEvidenceIds,
      evidenceIds,
      ["juryInstructions", index, "relatedEvidenceIds"],
      "evidence",
    );
  });

  const provenanceOwners: Array<{ provenance: Provenance[]; path: Path }> = [
    { provenance: graph.jurisdictionProfile.provenance, path: ["jurisdictionProfile", "provenance"] },
    ...graph.parties.map((item, index) => ({ provenance: item.provenance, path: ["parties", index, "provenance"] })),
    ...graph.issues.map((item, index) => ({ provenance: item.provenance, path: ["issues", index, "provenance"] })),
    ...graph.timeline.map((item, index) => ({ provenance: item.provenance, path: ["timeline", index, "provenance"] })),
    ...graph.facts.map((item, index) => ({ provenance: item.provenance, path: ["facts", index, "provenance"] })),
    ...graph.evidence.map((item, index) => ({ provenance: item.provenance, path: ["evidence", index, "provenance"] })),
    ...graph.witnesses.map((item, index) => ({ provenance: item.provenance, path: ["witnesses", index, "provenance"] })),
    ...priorStatements.map(({ statement, witnessIndex, statementIndex }) => ({
      provenance: statement.provenance,
      path: ["witnesses", witnessIndex, "priorStatements", statementIndex, "provenance"],
    })),
    ...graph.contradictions.map((item, index) => ({
      provenance: item.provenance,
      path: ["contradictions", index, "provenance"],
    })),
    { provenance: graph.settlement.provenance, path: ["settlement", "provenance"] },
    ...graph.juryInstructions.map((item, index) => ({
      provenance: item.provenance,
      path: ["juryInstructions", index, "provenance"],
    })),
  ];
  const provenanceIds = new Set<string>();
  provenanceOwners.forEach(({ provenance, path }) => {
    provenance.forEach((entry, index) => {
      if (provenanceIds.has(entry.provenanceId)) {
        addIssue([...path, index, "provenanceId"], `Duplicate provenance ID: ${entry.provenanceId}`);
      }
      provenanceIds.add(entry.provenanceId);
      checkReferences(entry.sourceSegmentIds, sourceSegmentIds, [...path, index, "sourceSegmentIds"], "source segment");
    });
  });

  graph.compilerMetadata.warnings.forEach((warning, index) => {
    checkReferences(
      warning.sourceSegmentIds,
      sourceSegmentIds,
      ["compilerMetadata", "warnings", index, "sourceSegmentIds"],
      "source segment",
    );
  });
  const uncertaintyIds = new Set<string>();
  graph.compilerMetadata.uncertainties.forEach((uncertainty, index) => {
    if (uncertaintyIds.has(uncertainty.uncertaintyId)) {
      addIssue(
        ["compilerMetadata", "uncertainties", index, "uncertaintyId"],
        `Duplicate uncertainty ID: ${uncertainty.uncertaintyId}`,
      );
    }
    uncertaintyIds.add(uncertainty.uncertaintyId);
    checkReferences(
      uncertainty.relatedFactIds,
      factIds,
      ["compilerMetadata", "uncertainties", index, "relatedFactIds"],
      "fact",
    );
    checkReferences(
      uncertainty.relatedEvidenceIds,
      evidenceIds,
      ["compilerMetadata", "uncertainties", index, "relatedEvidenceIds"],
      "evidence",
    );
    checkReferences(
      uncertainty.relatedWitnessIds,
      witnessIds,
      ["compilerMetadata", "uncertainties", index, "relatedWitnessIds"],
      "witness",
    );
    checkReferences(
      uncertainty.sourceSegmentIds,
      sourceSegmentIds,
      ["compilerMetadata", "uncertainties", index, "sourceSegmentIds"],
      "source segment",
    );
  });

  if (graph.compilerMetadata.sourceSegmentCount !== graph.sourceSegments.length) {
    addIssue(
      ["compilerMetadata", "sourceSegmentCount"],
      `sourceSegmentCount must equal sourceSegments.length (${graph.sourceSegments.length})`,
    );
  }
});

export type CaseGraphV1 = z.infer<typeof CaseGraphV1Schema>;
export type CaseGraphV1WithoutSourceSegments = z.infer<typeof CaseGraphV1WithoutSourceSegmentsSchema>;
export const CaseGraphSchema = CaseGraphV1Schema;
export type CaseGraph = CaseGraphV1;

export function parseCaseGraphV1(input: unknown): CaseGraphV1 {
  return CaseGraphV1Schema.parse(input);
}

export function parseCaseGraph(input: unknown): CaseGraph {
  return CaseGraphSchema.parse(input);
}
