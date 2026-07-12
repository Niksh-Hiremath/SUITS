export type GroundedRoleplayReply = {
  kind: "grounded" | "unsupported";
  text: string;
  factIds: string[];
  evidenceIds: string[];
};

const has = (text: string, pattern: RegExp) => pattern.test(text.normalize("NFKC").toLowerCase());

export function answerGoldenWitness(question: string): GroundedRoleplayReply {
  if (has(question, /when.*(?:learn|receive|know)|10[:.]?14|safety complaint|complaint email/)) return {
    kind: "grounded", text: "I received Asha's safety complaint email at 10:14 AM on May 14, before the final termination approval.",
    factIds: ["F-WIT-001"], evidenceIds: ["E-001"],
  };
  if (has(question, /first draft|initial draft|when.*(?:draft|memo)|may 7|before.*complaint/)) return {
    kind: "grounded", text: "HR created the first termination memorandum draft on May 7, one week before Asha's complaint. It had not yet received final approval.",
    factIds: ["F-WIT-002"], evidenceIds: ["E-004"],
  };
  if (has(question, /language.*add|what.*(?:change|revision)|disruptive|4[:.]?38|after.*complaint|final memo/)) return {
    kind: "grounded", text: "At 4:38 PM on May 14, after the complaint, the final memorandum was revised to add the phrase 'disruptive escalation.' That referred to Asha's safety escalation.",
    factIds: ["F-WIT-003", "F-WIT-004"], evidenceIds: ["E-005"],
  };
  if (has(question, /warning|performance improvement|\bpip\b|personnel file/)) return {
    kind: "grounded", text: "No formal written warning or active performance-improvement plan appears in Asha's personnel file before her termination.",
    factIds: ["F-WIT-005"], evidenceIds: ["E-006"],
  };
  if (has(question, /inventory|late report|performance problem|performance issue/)) return {
    kind: "grounded", text: "Asha submitted two inventory reports late during the preceding month. Those delays were documented in the report history.",
    factIds: ["F-WIT-006"], evidenceIds: ["E-003"],
  };
  if (has(question, /approv|terminat(?:e|ed|ion)|may 15|9[:.]?20/)) return {
    kind: "grounded", text: "The termination received final approval at 9:20 AM on May 15. The final letter cited performance failures and disruptive escalation.",
    factIds: ["F-WIT-007"], evidenceIds: ["E-002"],
  };
  if (has(question, /personally|your role|who are you|responsib/)) return {
    kind: "grounded", text: "I am Vertex's HR Director. I reviewed the complaint, the personnel file, and the termination documents, but I cannot testify to anyone's undocumented private thoughts.",
    factIds: ["F-PUB-006"], evidenceIds: [],
  };
  return { kind: "unsupported", text: "That detail is not documented in the case records, and I did not personally observe it.", factIds: [], evidenceIds: [] };
}

export function replyAsOpposingCounsel(statement: string): GroundedRoleplayReply {
  if (has(statement, /complaint|retaliat|caus|disruptive|after/)) return {
    kind: "grounded", text: "The May 7 termination draft predates Asha's complaint by a week, and two late inventory reports were already documented. Vertex says the later wording did not create the underlying decision.",
    factIds: ["F-PUB-004", "F-PUB-003"], evidenceIds: ["E-004", "E-003"],
  };
  if (has(statement, /warning|performance plan|personnel/)) return {
    kind: "grounded", text: "A formal warning is not required to recognize two documented late reports. Vertex relies on the report history and the pre-complaint draft.",
    factIds: ["F-PUB-003", "F-PUB-004"], evidenceIds: ["E-003", "E-004"],
  };
  return {
    kind: "grounded", text: "Vertex's position is that performance concerns and a May 7 draft show termination was already underway before the May 14 safety complaint.",
    factIds: ["F-PUB-003", "F-PUB-004"], evidenceIds: ["E-003", "E-004"],
  };
}

export function assessGoldenVerdict(turns: Array<{ actor: string; text: string }>): "claimant" | "respondent" | "insufficient_record" {
  const record = turns.map((turn) => turn.text.toLowerCase()).join(" ");
  const claimantArgument = turns.filter((turn) => turn.actor === "Advocate").map((turn) => turn.text.toLowerCase()).join(" ");
  const claimantProof = /disruptive escalation|4:38/.test(record) && /retaliat|caus|because|post-complaint/.test(claimantArgument);
  if (claimantProof) return "claimant";
  const respondentProof = /may 7|first termination|initial.*draft/.test(record) && /two.*late|late.*report|performance/.test(record);
  if (respondentProof) return "respondent";
  return "insufficient_record";
}