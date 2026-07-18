import {
  CASE_GRAPH_SCHEMA_VERSION,
  CASE_GRAPH_VERSION,
  parseCaseGraphV1,
  type CaseGraphV1,
} from "../case-graph";
import { authoringProvenance, sourceProvenance } from "./provenance";

const rawHarborlightCase = {
  schemaVersion: CASE_GRAPH_SCHEMA_VERSION,
  caseId: "case_harborlight_rig_v1",
  version: CASE_GRAPH_VERSION,
  title: "Elena Park v. Harborlight Community Theater",
  summary:
    "A fictional negligence dispute about a falling stage-light rig, a maintenance warning, and an inspection checklist edited after rehearsal.",
  status: "published",
  educationalDisclaimer:
    "Fictional educational simulation only. This case is not legal advice, does not involve real people, and does not predict any real dispute.",
  jurisdictionProfile: {
    profileId: "harbor_jurisdiction_civil_v1",
    name: "Harbor County Fictional Civil Rules",
    rulesVersion: "harbor-rules.v1",
    governingLaw:
      "Fictional negligence, evidence, and civil procedure rules authored only for educational simulation.",
    burdenOfProof: "preponderance",
    permittedObjectionGrounds: [
      "relevance",
      "hearsay",
      "leading",
      "speculation",
      "foundation",
      "asked_and_answered",
      "argumentative",
      "compound",
      "privilege",
    ],
    provenance: [
      authoringProvenance(
        "harbor_prov_jurisdiction",
        "The fictional rule profile is authored simulation configuration.",
      ),
    ],
  },
  parties: [
    {
      partyId: "harbor_party_elena",
      name: "Elena Park",
      kind: "person",
      proceduralRole: "claimant",
      simulationSide: "user",
      description: "A volunteer performer injured when a lighting bar fell during evening rehearsal.",
      counselName: null,
      provenance: [
        sourceProvenance(
          "harbor_prov_party_elena",
          ["harbor_segment_incident"],
          "The incident report identifies Elena as the injured performer.",
        ),
      ],
    },
    {
      partyId: "harbor_party_theater",
      name: "Harborlight Community Theater",
      kind: "organization",
      proceduralRole: "respondent",
      simulationSide: "opposing",
      description: "A fictional nonprofit theater responsible for the stage and its lighting equipment.",
      counselName: "Noah Bennett",
      provenance: [
        sourceProvenance(
          "harbor_prov_party_theater",
          ["harbor_segment_checklist"],
          "The inspection checklist names Harborlight as the facility operator.",
        ),
      ],
    },
  ],
  issues: [
    {
      issueId: "harbor_issue_negligence",
      title: "Reasonable inspection and repair",
      question:
        "Did Harborlight fail to use reasonable care after receiving a warning about the lighting rig?",
      burdenPartyId: "harbor_party_elena",
      standard: "Elena must prove breach by a preponderance of the jury-considerable record.",
      relatedFactIds: [
        "harbor_fact_warning_logged",
        "harbor_fact_checklist_clear",
        "harbor_fact_checklist_backfilled",
        "harbor_fact_rig_fell",
      ],
      relatedEvidenceIds: [
        "harbor_evidence_warning_ticket",
        "harbor_evidence_checklist",
        "harbor_evidence_metadata_audit",
        "harbor_evidence_incident_report",
      ],
      provenance: [
        sourceProvenance(
          "harbor_prov_issue_negligence",
          ["harbor_segment_ticket", "harbor_segment_checklist"],
          "The maintenance warning and checklist frame the disputed standard of care.",
        ),
      ],
    },
    {
      issueId: "harbor_issue_causation",
      title: "Causation and injury",
      question:
        "Did the unrepaired rig condition cause Elena's injury, or did her position on stage independently cause the event?",
      burdenPartyId: "harbor_party_elena",
      standard: "Elena must prove factual and proximate causation by a preponderance.",
      relatedFactIds: [
        "harbor_fact_rig_fell",
        "harbor_fact_injury",
        "harbor_fact_actor_moved_mark",
      ],
      relatedEvidenceIds: ["harbor_evidence_incident_report", "harbor_evidence_medical_summary"],
      provenance: [
        sourceProvenance(
          "harbor_prov_issue_causation",
          ["harbor_segment_incident", "harbor_segment_medical"],
          "The incident and medical records frame the causation dispute.",
        ),
      ],
    },
  ],
  timeline: [
    {
      timelineEventId: "harbor_timeline_warning",
      occurredAt: "2026-02-12T08:05:00Z",
      summary: "Lighting technician Iris Campos logged a frayed suspension-cable warning.",
      relatedFactIds: ["harbor_fact_warning_logged"],
      relatedEvidenceIds: ["harbor_evidence_warning_ticket"],
      witnessIds: ["harbor_witness_iris"],
      provenance: [
        sourceProvenance(
          "harbor_prov_timeline_warning",
          ["harbor_segment_ticket"],
          "The maintenance ticket records its creation time and author.",
        ),
      ],
    },
    {
      timelineEventId: "harbor_timeline_checklist",
      occurredAt: "2026-02-12T18:42:00Z",
      summary: "The daily rig checklist was saved with every inspection box marked clear.",
      relatedFactIds: ["harbor_fact_checklist_clear", "harbor_fact_checklist_backfilled"],
      relatedEvidenceIds: ["harbor_evidence_checklist", "harbor_evidence_metadata_audit"],
      witnessIds: ["harbor_witness_malik", "harbor_witness_iris"],
      provenance: [
        sourceProvenance(
          "harbor_prov_timeline_checklist",
          ["harbor_segment_checklist", "harbor_segment_audit"],
          "The checklist and metadata audit establish the save time.",
        ),
      ],
    },
    {
      timelineEventId: "harbor_timeline_accident",
      occurredAt: "2026-02-12T19:12:00Z",
      summary: "A lighting bar fell during rehearsal and struck Elena's shoulder.",
      relatedFactIds: ["harbor_fact_rig_fell", "harbor_fact_injury"],
      relatedEvidenceIds: ["harbor_evidence_incident_report", "harbor_evidence_medical_summary"],
      witnessIds: ["harbor_witness_elena", "harbor_witness_malik"],
      provenance: [
        sourceProvenance(
          "harbor_prov_timeline_accident",
          ["harbor_segment_incident", "harbor_segment_medical"],
          "The incident and clinic records establish the time and immediate injury.",
        ),
      ],
    },
  ],
  facts: [
    {
      factId: "harbor_fact_warning_logged",
      proposition: "Iris logged a frayed suspension cable before the evening rehearsal.",
      classification: "authoring_truth",
      initialStatus: "hidden",
      visibility: "restricted",
      assertedByPartyIds: [],
      relatedIssueIds: ["harbor_issue_negligence"],
      relatedEvidenceIds: ["harbor_evidence_warning_ticket"],
      witnessIds: ["harbor_witness_iris"],
      provenance: [
        sourceProvenance(
          "harbor_prov_fact_warning",
          ["harbor_segment_ticket"],
          "The maintenance system export directly records the warning.",
        ),
      ],
    },
    {
      factId: "harbor_fact_checklist_clear",
      proposition: "The saved daily checklist marked every lighting-rig inspection item clear.",
      classification: "authoring_truth",
      initialStatus: "verified",
      visibility: "public",
      assertedByPartyIds: ["harbor_party_theater"],
      relatedIssueIds: ["harbor_issue_negligence"],
      relatedEvidenceIds: ["harbor_evidence_checklist"],
      witnessIds: ["harbor_witness_malik", "harbor_witness_iris"],
      provenance: [
        sourceProvenance(
          "harbor_prov_fact_checklist",
          ["harbor_segment_checklist"],
          "The saved checklist directly shows all-clear marks.",
        ),
      ],
    },
    {
      factId: "harbor_fact_checklist_backfilled",
      proposition: "Checklist metadata shows that Malik filled the rig section after rehearsal began.",
      classification: "authoring_truth",
      initialStatus: "hidden",
      visibility: "restricted",
      assertedByPartyIds: [],
      relatedIssueIds: ["harbor_issue_negligence"],
      relatedEvidenceIds: ["harbor_evidence_metadata_audit"],
      witnessIds: ["harbor_witness_malik", "harbor_witness_iris"],
      provenance: [
        sourceProvenance(
          "harbor_prov_fact_backfill",
          ["harbor_segment_audit"],
          "The audit export records the section-level edit time and account.",
        ),
      ],
    },
    {
      factId: "harbor_fact_rig_fell",
      proposition: "A lighting bar detached and fell during the February 12 rehearsal.",
      classification: "authoring_truth",
      initialStatus: "verified",
      visibility: "public",
      assertedByPartyIds: ["harbor_party_elena", "harbor_party_theater"],
      relatedIssueIds: ["harbor_issue_negligence", "harbor_issue_causation"],
      relatedEvidenceIds: ["harbor_evidence_incident_report"],
      witnessIds: ["harbor_witness_elena", "harbor_witness_malik"],
      provenance: [
        sourceProvenance(
          "harbor_prov_fact_fall",
          ["harbor_segment_incident"],
          "Both parties signed the incident report describing the falling bar.",
        ),
      ],
    },
    {
      factId: "harbor_fact_injury",
      proposition: "Elena was treated that night for a fractured left clavicle.",
      classification: "authoring_truth",
      initialStatus: "verified",
      visibility: "public",
      assertedByPartyIds: ["harbor_party_elena"],
      relatedIssueIds: ["harbor_issue_causation"],
      relatedEvidenceIds: ["harbor_evidence_medical_summary"],
      witnessIds: ["harbor_witness_elena"],
      provenance: [
        sourceProvenance(
          "harbor_prov_fact_injury",
          ["harbor_segment_medical"],
          "The fictional clinic summary records the diagnosis and treatment time.",
        ),
      ],
    },
    {
      factId: "harbor_fact_actor_moved_mark",
      proposition: "Harborlight alleges Elena stepped outside her taped rehearsal mark before the bar fell.",
      classification: "party_allegation",
      initialStatus: "proposed",
      visibility: "public",
      assertedByPartyIds: ["harbor_party_theater"],
      relatedIssueIds: ["harbor_issue_causation"],
      relatedEvidenceIds: ["harbor_evidence_incident_report"],
      witnessIds: ["harbor_witness_elena", "harbor_witness_malik"],
      provenance: [
        sourceProvenance(
          "harbor_prov_fact_mark",
          ["harbor_segment_manager_interview"],
          "Malik makes this allegation in his interview; no camera footage resolves it.",
          0.72,
        ),
      ],
    },
  ],
  evidence: [
    {
      evidenceId: "harbor_evidence_incident_report",
      name: "Rehearsal incident report",
      description: "A timestamped report describing the falling light bar and Elena's position on stage.",
      kind: "document",
      initialStatus: "indexed",
      authoringAdmissibility: "likely_admissible",
      offeredByPartyIds: ["harbor_party_elena", "harbor_party_theater"],
      relatedFactIds: ["harbor_fact_rig_fell", "harbor_fact_actor_moved_mark"],
      relatedIssueIds: ["harbor_issue_negligence", "harbor_issue_causation"],
      custodianWitnessIds: ["harbor_witness_malik"],
      authenticatingWitnessIds: ["harbor_witness_elena", "harbor_witness_malik"],
      provenance: [
        sourceProvenance(
          "harbor_prov_evidence_incident",
          ["harbor_segment_incident"],
          "The case packet contains the full fictional incident report.",
        ),
      ],
    },
    {
      evidenceId: "harbor_evidence_checklist",
      name: "Daily lighting-rig checklist",
      description: "The saved inspection checklist showing all rig items marked clear.",
      kind: "document",
      initialStatus: "indexed",
      authoringAdmissibility: "likely_admissible",
      offeredByPartyIds: ["harbor_party_theater"],
      relatedFactIds: ["harbor_fact_checklist_clear"],
      relatedIssueIds: ["harbor_issue_negligence"],
      custodianWitnessIds: ["harbor_witness_malik"],
      authenticatingWitnessIds: ["harbor_witness_malik"],
      provenance: [
        sourceProvenance(
          "harbor_prov_evidence_checklist",
          ["harbor_segment_checklist"],
          "The case packet contains the exported checklist.",
        ),
      ],
    },
    {
      evidenceId: "harbor_evidence_warning_ticket",
      name: "Cable warning ticket",
      description: "Iris's maintenance ticket reporting visible fraying on the suspension cable.",
      kind: "digital",
      initialStatus: "indexed",
      authoringAdmissibility: "likely_admissible",
      offeredByPartyIds: ["harbor_party_elena"],
      relatedFactIds: ["harbor_fact_warning_logged"],
      relatedIssueIds: ["harbor_issue_negligence"],
      custodianWitnessIds: ["harbor_witness_iris"],
      authenticatingWitnessIds: ["harbor_witness_iris"],
      provenance: [
        sourceProvenance(
          "harbor_prov_evidence_ticket",
          ["harbor_segment_ticket"],
          "The case packet contains the maintenance-system export.",
        ),
      ],
    },
    {
      evidenceId: "harbor_evidence_metadata_audit",
      name: "Checklist metadata audit",
      description: "An audit export listing section-level edit times and the editing account.",
      kind: "digital",
      initialStatus: "indexed",
      authoringAdmissibility: "undetermined",
      offeredByPartyIds: ["harbor_party_elena"],
      relatedFactIds: ["harbor_fact_checklist_backfilled"],
      relatedIssueIds: ["harbor_issue_negligence"],
      custodianWitnessIds: ["harbor_witness_iris"],
      authenticatingWitnessIds: ["harbor_witness_iris"],
      provenance: [
        sourceProvenance(
          "harbor_prov_evidence_audit",
          ["harbor_segment_audit"],
          "The packet contains the fictional system-audit export.",
        ),
      ],
    },
    {
      evidenceId: "harbor_evidence_medical_summary",
      name: "Urgent-care summary",
      description: "A fictional clinical summary recording Elena's shoulder injury and treatment.",
      kind: "document",
      initialStatus: "indexed",
      authoringAdmissibility: "likely_admissible",
      offeredByPartyIds: ["harbor_party_elena"],
      relatedFactIds: ["harbor_fact_injury"],
      relatedIssueIds: ["harbor_issue_causation"],
      custodianWitnessIds: ["harbor_witness_elena"],
      authenticatingWitnessIds: ["harbor_witness_elena"],
      provenance: [
        sourceProvenance(
          "harbor_prov_evidence_medical",
          ["harbor_segment_medical"],
          "The packet contains a deliberately fictionalized treatment summary.",
        ),
      ],
    },
  ],
  witnesses: [
    {
      witnessId: "harbor_witness_elena",
      name: "Elena Park",
      kind: "fact",
      role: "Injured performer and claimant",
      alignedPartyId: "harbor_party_elena",
      callableByPartyIds: ["harbor_party_elena", "harbor_party_theater"],
      summary: "Elena perceived the falling bar and disputes that she left her rehearsal mark.",
      emotionalBaseline: "nervous",
      knowledgeBoundary: {
        knownFactIds: [
          "harbor_fact_rig_fell",
          "harbor_fact_injury",
          "harbor_fact_actor_moved_mark",
        ],
        perceivedFactIds: ["harbor_fact_rig_fell", "harbor_fact_actor_moved_mark"],
        seenEvidenceIds: ["harbor_evidence_incident_report", "harbor_evidence_medical_summary"],
        availablePriorStatementIds: ["harbor_statement_elena"],
        unknownFactIds: [
          "harbor_fact_warning_logged",
          "harbor_fact_checklist_clear",
          "harbor_fact_checklist_backfilled",
        ],
        allowedTopics: ["rehearsal position", "the falling bar", "injury and treatment"],
        forbiddenTopics: ["maintenance-system administration", "Malik's private reasoning"],
      },
      priorStatements: [
        {
          priorStatementId: "harbor_statement_elena",
          madeAt: "2026-02-13T10:30:00Z",
          kind: "interview",
          text: "I stayed on my taped mark; I heard a snap and the bar came down toward my left side.",
          relatedFactIds: ["harbor_fact_rig_fell", "harbor_fact_actor_moved_mark"],
          relatedEvidenceIds: ["harbor_evidence_incident_report"],
          provenance: [
            sourceProvenance(
              "harbor_prov_statement_elena",
              ["harbor_segment_incident"],
              "Elena's signed addendum contains this account.",
            ),
          ],
        },
      ],
      provenance: [
        sourceProvenance(
          "harbor_prov_witness_elena",
          ["harbor_segment_incident"],
          "The incident report identifies Elena as a percipient witness.",
        ),
      ],
    },
    {
      witnessId: "harbor_witness_malik",
      name: "Malik Reed",
      kind: "fact",
      role: "Harborlight stage manager",
      alignedPartyId: "harbor_party_theater",
      callableByPartyIds: ["harbor_party_elena", "harbor_party_theater"],
      summary: "Malik controlled the checklist, supervised rehearsal, and disputes receiving an unresolved warning.",
      emotionalBaseline: "defensive",
      knowledgeBoundary: {
        knownFactIds: [
          "harbor_fact_checklist_clear",
          "harbor_fact_checklist_backfilled",
          "harbor_fact_rig_fell",
          "harbor_fact_actor_moved_mark",
        ],
        perceivedFactIds: ["harbor_fact_rig_fell", "harbor_fact_actor_moved_mark"],
        seenEvidenceIds: [
          "harbor_evidence_incident_report",
          "harbor_evidence_checklist",
          "harbor_evidence_metadata_audit",
        ],
        availablePriorStatementIds: ["harbor_statement_malik"],
        unknownFactIds: ["harbor_fact_warning_logged", "harbor_fact_injury"],
        allowedTopics: ["inspection routine", "rehearsal supervision", "checklist edits"],
        forbiddenTopics: ["Elena's private medical history", "Iris's uncommunicated observations"],
      },
      priorStatements: [
        {
          priorStatementId: "harbor_statement_malik",
          madeAt: "2026-02-13T09:10:00Z",
          kind: "interview",
          text: "The rig was checked before rehearsal, and no unresolved cable warning reached me that day.",
          relatedFactIds: ["harbor_fact_checklist_clear", "harbor_fact_warning_logged"],
          relatedEvidenceIds: ["harbor_evidence_checklist", "harbor_evidence_warning_ticket"],
          provenance: [
            sourceProvenance(
              "harbor_prov_statement_malik",
              ["harbor_segment_manager_interview"],
              "Malik's recorded interview contains this statement.",
            ),
          ],
        },
      ],
      provenance: [
        sourceProvenance(
          "harbor_prov_witness_malik",
          ["harbor_segment_manager_interview"],
          "The interview and checklist identify Malik as stage manager.",
        ),
      ],
    },
    {
      witnessId: "harbor_witness_iris",
      name: "Iris Campos",
      kind: "fact",
      role: "Lighting technician and maintenance-system custodian",
      alignedPartyId: null,
      callableByPartyIds: ["harbor_party_elena", "harbor_party_theater"],
      summary: "Iris inspected the cable, created the warning ticket, and exported the audit records.",
      emotionalBaseline: "neutral",
      knowledgeBoundary: {
        knownFactIds: [
          "harbor_fact_warning_logged",
          "harbor_fact_checklist_clear",
          "harbor_fact_checklist_backfilled",
        ],
        perceivedFactIds: ["harbor_fact_warning_logged"],
        seenEvidenceIds: [
          "harbor_evidence_warning_ticket",
          "harbor_evidence_checklist",
          "harbor_evidence_metadata_audit",
        ],
        availablePriorStatementIds: ["harbor_statement_iris"],
        unknownFactIds: [
          "harbor_fact_rig_fell",
          "harbor_fact_injury",
          "harbor_fact_actor_moved_mark",
        ],
        allowedTopics: ["cable inspection", "maintenance ticket", "checklist audit metadata"],
        forbiddenTopics: ["Elena's stage position", "medical causation"],
      },
      priorStatements: [
        {
          priorStatementId: "harbor_statement_iris",
          madeAt: "2026-02-13T14:00:00Z",
          kind: "affidavit",
          text: "I logged visible fraying at 8:05 AM and marked the ticket for repair before the next rehearsal.",
          relatedFactIds: ["harbor_fact_warning_logged"],
          relatedEvidenceIds: ["harbor_evidence_warning_ticket"],
          provenance: [
            sourceProvenance(
              "harbor_prov_statement_iris",
              ["harbor_segment_ticket"],
              "Iris's declaration is attached to the ticket export.",
            ),
          ],
        },
      ],
      provenance: [
        sourceProvenance(
          "harbor_prov_witness_iris",
          ["harbor_segment_ticket", "harbor_segment_audit"],
          "The ticket and audit export identify Iris and her custodian role.",
        ),
      ],
    },
  ],
  contradictions: [
    {
      contradictionId: "harbor_contradiction_warning",
      summary: "Malik said no unresolved warning reached him, while the ticket was routed to his stage-manager queue.",
      left: { kind: "prior_statement", priorStatementId: "harbor_statement_malik" },
      right: { kind: "evidence", evidenceId: "harbor_evidence_warning_ticket" },
      witnessIds: ["harbor_witness_malik", "harbor_witness_iris"],
      relatedIssueIds: ["harbor_issue_negligence"],
      severity: "decisive",
      provenance: [
        sourceProvenance(
          "harbor_prov_contradiction_warning",
          ["harbor_segment_manager_interview", "harbor_segment_ticket"],
          "The interview and routing field conflict about notice.",
        ),
      ],
    },
    {
      contradictionId: "harbor_contradiction_timing",
      summary: "The checklist presents a pre-rehearsal inspection, but its audit record shows the rig section was edited later.",
      left: { kind: "evidence", evidenceId: "harbor_evidence_checklist" },
      right: { kind: "evidence", evidenceId: "harbor_evidence_metadata_audit" },
      witnessIds: ["harbor_witness_malik", "harbor_witness_iris"],
      relatedIssueIds: ["harbor_issue_negligence"],
      severity: "material",
      provenance: [
        sourceProvenance(
          "harbor_prov_contradiction_timing",
          ["harbor_segment_checklist", "harbor_segment_audit"],
          "The displayed completion time and section audit timestamp differ.",
        ),
      ],
    },
  ],
  settlement: {
    enabled: true,
    currency: "USD",
    participants: [
      {
        partyId: "harbor_party_elena",
        minimumAuthority: 40_000,
        maximumAuthority: 180_000,
        reservationValue: 82_000,
        targetValue: 135_000,
        confidentialPriorities: ["fund rehabilitation", "obtain a written safety commitment"],
        permittedNonMonetaryTerms: ["documented rig-inspection policy", "neutral safety training"],
      },
      {
        partyId: "harbor_party_theater",
        minimumAuthority: 20_000,
        maximumAuthority: 125_000,
        reservationValue: 88_000,
        targetValue: 48_000,
        confidentialPriorities: ["avoid an admission of wrongdoing", "preserve donor confidence"],
        permittedNonMonetaryTerms: ["safety-policy update", "confidentiality"],
      },
    ],
    opensAtPhase: "recess",
    expiresAfterEventCount: 24,
    allowCounteroffers: true,
    provenance: [
      authoringProvenance(
        "harbor_prov_settlement",
        "Private settlement ranges are authored simulation controls, not sourced factual claims.",
      ),
    ],
  },
  juryInstructions: [
    {
      instructionId: "harbor_instruction_negligence",
      title: "Reasonable care",
      text:
        "Decide whether Harborlight failed to use the care a reasonably careful fictional theater operator would use under similar circumstances.",
      relatedIssueIds: ["harbor_issue_negligence"],
      requiredFactIds: ["harbor_fact_warning_logged", "harbor_fact_checklist_clear"],
      relatedEvidenceIds: ["harbor_evidence_warning_ticket", "harbor_evidence_checklist"],
      provenance: [
        authoringProvenance(
          "harbor_prov_instruction_negligence",
          "This instruction is authored for the fictional educational rule profile.",
        ),
      ],
    },
    {
      instructionId: "harbor_instruction_causation",
      title: "Causation",
      text:
        "Consider only admitted evidence when deciding whether the lighting-rig condition was a substantial cause of Elena's injury.",
      relatedIssueIds: ["harbor_issue_causation"],
      requiredFactIds: ["harbor_fact_rig_fell", "harbor_fact_injury"],
      relatedEvidenceIds: ["harbor_evidence_incident_report", "harbor_evidence_medical_summary"],
      provenance: [
        authoringProvenance(
          "harbor_prov_instruction_causation",
          "This instruction is authored for the fictional educational rule profile.",
        ),
      ],
    },
  ],
  sourceSegments: [
    {
      sourceSegmentId: "harbor_segment_incident",
      sourceId: "harbor_source_packet",
      documentName: "rehearsal-incident-report.txt",
      mimeType: "text/plain",
      locator: { kind: "text", startOffset: 0, endOffset: 540 },
      excerpt: "At 7:12 PM a lighting bar detached above stage-left and struck Elena Park.",
      sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
    {
      sourceSegmentId: "harbor_segment_checklist",
      sourceId: "harbor_source_packet",
      documentName: "daily-rig-checklist.md",
      mimeType: "text/markdown",
      locator: { kind: "text", startOffset: 541, endOffset: 980 },
      excerpt: "Rig inspection: cable, clamps, safety line — CLEAR. Saved 18:42 by M. Reed.",
      sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    },
    {
      sourceSegmentId: "harbor_segment_ticket",
      sourceId: "harbor_source_packet",
      documentName: "maintenance-ticket-184.txt",
      mimeType: "text/plain",
      locator: { kind: "text", startOffset: 981, endOffset: 1_430 },
      excerpt: "08:05 — Iris Campos: visible fraying; repair before next rehearsal; routed to Stage Manager.",
      sha256: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    },
    {
      sourceSegmentId: "harbor_segment_manager_interview",
      sourceId: "harbor_source_packet",
      documentName: "malik-reed-interview.txt",
      mimeType: "text/plain",
      locator: { kind: "text", startOffset: 1_431, endOffset: 1_980 },
      excerpt: "No unresolved cable warning reached me. Elena had stepped beyond her taped mark.",
      sha256: "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    },
    {
      sourceSegmentId: "harbor_segment_audit",
      sourceId: "harbor_source_packet",
      documentName: "checklist-audit.csv",
      mimeType: "text/csv",
      locator: { kind: "text", startOffset: 1_981, endOffset: 2_420 },
      excerpt: "rig_section,last_modified=2026-02-12T18:42:17Z,account=mreed",
      sha256: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    },
    {
      sourceSegmentId: "harbor_segment_medical",
      sourceId: "harbor_source_packet",
      documentName: "fictional-urgent-care-summary.txt",
      mimeType: "text/plain",
      locator: { kind: "text", startOffset: 2_421, endOffset: 2_860 },
      excerpt: "Elena Park was treated at 21:05 for a fractured left clavicle after a stage accident.",
      sha256: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    },
  ],
  compilerMetadata: {
    method: "seeded",
    model: null,
    requestId: null,
    promptVersion: "case-compiler.seeded.v1",
    compiledAt: "2026-07-18T12:30:00Z",
    sourceContentHash: "abababababababababababababababababababababababababababababababab",
    sourceSegmentCount: 6,
    warnings: [],
    uncertainties: [
      {
        uncertaintyId: "harbor_uncertainty_stage_mark",
        description: "The packet contains conflicting recollections and no camera view of Elena's stage mark.",
        relatedFactIds: ["harbor_fact_actor_moved_mark"],
        relatedEvidenceIds: ["harbor_evidence_incident_report"],
        relatedWitnessIds: ["harbor_witness_elena", "harbor_witness_malik"],
        sourceSegmentIds: ["harbor_segment_incident", "harbor_segment_manager_interview"],
      },
    ],
  },
} satisfies CaseGraphV1;

export const HARBORLIGHT_CASE_GRAPH_V1 = parseCaseGraphV1(rawHarborlightCase);

export function createHarborlightCaseGraph(): CaseGraphV1 {
  return structuredClone(HARBORLIGHT_CASE_GRAPH_V1);
}
