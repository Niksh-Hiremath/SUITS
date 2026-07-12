export type NamedAssertion = { name: string; passed: boolean; evidenceJson: string };

type Turn = { turnId: string; phase: string; factIds: string[]; evidenceIds: string[] };
type CitationItem = { turnCitations: string[] };
type EvalInput = {
  trial: { phase: string; phaseSequence: number };
  turns: Turn[];
  traces: Array<{ traceId: string; status: string; parentId?: string; endedAt?: number; latencyMs?: number }>;
  votes: Array<CitationItem & { evidenceIds: string[] }>;
  debrief: {
    status: string;
    strengths: CitationItem[];
    missedOpportunities: Array<CitationItem & { recommendedQuestion: string }>;
    contradictions: Array<CitationItem & { evidenceIds: string[] }>;
    evidenceUsed: Array<CitationItem & { evidenceId: string }>;
    jurorMovement: CitationItem[];
    revisedClosing: { text: string; basedOnTurnIds: string[] };
  } | null;
  allowedFactIds: string[];
  allowedEvidenceIds: string[];
};

const expectedPhases = ["briefing", "opening", "cross_examination", "closing"];
const assertion = (name: string, passed: boolean, evidence: unknown): NamedAssertion => ({
  name,
  passed,
  evidenceJson: JSON.stringify(evidence),
});

export function evaluateGoldenRun(input: EvalInput) {
  const turnIds = new Set(input.turns.map((turn) => turn.turnId));
  const actualPhases = [...new Set(input.turns.map((turn) => turn.phase))];
  const debrief = input.debrief;
  const citations = debrief ? [
    ...input.votes.flatMap((vote) => vote.turnCitations),
    ...debrief.strengths.flatMap((item) => item.turnCitations),
    ...debrief.missedOpportunities.flatMap((item) => item.turnCitations),
    ...debrief.contradictions.flatMap((item) => item.turnCitations),
    ...debrief.evidenceUsed.flatMap((item) => item.turnCitations),
    ...debrief.jurorMovement.flatMap((item) => item.turnCitations),
    ...debrief.revisedClosing.basedOnTurnIds,
  ] : [];
  const observedFactIds = input.turns.flatMap((turn) => turn.factIds);
  const observedEvidenceIds = [
    ...input.turns.flatMap((turn) => turn.evidenceIds),
    ...input.votes.flatMap((vote) => vote.evidenceIds),
    ...(debrief?.contradictions.flatMap((item) => item.evidenceIds) ?? []),
    ...(debrief?.evidenceUsed.map((item) => item.evidenceId) ?? []),
  ];
  const unknownFacts = observedFactIds.filter((id) => !input.allowedFactIds.includes(id));
  const unknownEvidence = observedEvidenceIds.filter((id) => !input.allowedEvidenceIds.includes(id));
  const traceIds = new Set(input.traces.map((trace) => trace.traceId));
  const incompleteTraces = input.traces.filter((trace) =>
    trace.status !== "succeeded" || trace.endedAt === undefined || trace.latencyMs === undefined ||
    (trace.parentId !== undefined && !traceIds.has(trace.parentId)),
  );

  const assertions = [
    assertion("valid_phase_order", input.trial.phase === "complete" && input.trial.phaseSequence === 6 && expectedPhases.every((phase, index) => actualPhases[index] === phase), { actualPhases, phase: input.trial.phase, phaseSequence: input.trial.phaseSequence }),
    assertion("schema_valid_output", Boolean(debrief && debrief.status === "valid" && input.votes.length > 0), { debriefStatus: debrief?.status ?? "missing", voteCount: input.votes.length }),
    assertion("citations_resolve", citations.length > 0 && citations.every((id) => turnIds.has(id)), { citationCount: citations.length, unknown: citations.filter((id) => !turnIds.has(id)) }),
    assertion("no_new_facts", unknownFacts.length === 0 && unknownEvidence.length === 0, { unknownFacts, unknownEvidence }),
    assertion("useful_debrief", Boolean(debrief?.strengths.length && debrief.missedOpportunities.length && debrief.revisedClosing.text.trim() && debrief.revisedClosing.basedOnTurnIds.length), { strengths: debrief?.strengths.length ?? 0, missedOpportunities: debrief?.missedOpportunities.length ?? 0, hasRevision: Boolean(debrief?.revisedClosing.text.trim()) }),
    assertion("complete_trace", input.traces.length >= 2 && incompleteTraces.length === 0, { spanCount: input.traces.length, incompleteTraceIds: incompleteTraces.map((trace) => trace.traceId) }),
  ];
  const passedCount = assertions.filter((item) => item.passed).length;
  return {
    status: passedCount === assertions.length ? "passed" as const : "failed" as const,
    assertions,
    passedCount,
    totalCount: assertions.length,
    score: passedCount / assertions.length,
    failureReason: assertions.filter((item) => !item.passed).map((item) => item.name).join(", ") || undefined,
  };
}

export function summarizePromptVersions(runs: Array<{ promptVersion: string; status: string }>) {
  const groups = new Map<string, { passed: number; total: number }>();
  for (const run of runs) {
    const group = groups.get(run.promptVersion) ?? { passed: 0, total: 0 };
    group.total += 1;
    if (run.status === "passed") group.passed += 1;
    groups.set(run.promptVersion, group);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([promptVersion, group]) => ({
    promptVersion,
    ...group,
    passRate: group.passed / group.total,
  }));
}
