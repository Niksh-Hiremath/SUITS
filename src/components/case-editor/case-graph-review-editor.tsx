"use client";

import type { CaseGraph } from "@/domain/case-graph";

import styles from "./case-workbench.module.css";

type Props = Readonly<{
  graph: CaseGraph;
  onChange: (graph: CaseGraph) => void;
}>;

type KnowledgeList = "knownFactIds" | "unknownFactIds" | "seenEvidenceIds";

const OBJECTION_GROUNDS = [
  "relevance",
  "hearsay",
  "leading",
  "speculation",
  "foundation",
  "asked_and_answered",
  "argumentative",
  "compound",
  "privilege",
] as const;

function lines(value: string): string[] {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter((item, index, values) => item.length > 0 && values.indexOf(item) === index);
}

function toggleId(values: readonly string[], id: string, checked: boolean): string[] {
  return checked ? [...new Set([...values, id])] : values.filter((value) => value !== id);
}

function isoLocalValue(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

function contradictionEndpointKey(endpoint: CaseGraph["contradictions"][number]["left"]): string {
  if (endpoint.kind === "fact") return `fact:${endpoint.factId}`;
  if (endpoint.kind === "evidence") return `evidence:${endpoint.evidenceId}`;
  if (endpoint.kind === "prior_statement") return `prior_statement:${endpoint.priorStatementId}`;
  return `timeline_event:${endpoint.timelineEventId}`;
}

function contradictionEndpointOptions(graph: CaseGraph): Array<{
  key: string;
  label: string;
  endpoint: CaseGraph["contradictions"][number]["left"];
}> {
  return [
    ...graph.facts.map((fact) => ({
      key: `fact:${fact.factId}`,
      label: `Fact · ${fact.proposition}`,
      endpoint: { kind: "fact" as const, factId: fact.factId },
    })),
    ...graph.evidence.map((evidence) => ({
      key: `evidence:${evidence.evidenceId}`,
      label: `Evidence · ${evidence.name}`,
      endpoint: { kind: "evidence" as const, evidenceId: evidence.evidenceId },
    })),
    ...graph.witnesses.flatMap((witness) => witness.priorStatements.map((statement) => ({
      key: `prior_statement:${statement.priorStatementId}`,
      label: `Prior statement · ${witness.name} · ${statement.text}`,
      endpoint: { kind: "prior_statement" as const, priorStatementId: statement.priorStatementId },
    }))),
    ...graph.timeline.map((timelineEvent) => ({
      key: `timeline_event:${timelineEvent.timelineEventId}`,
      label: `Timeline · ${timelineEvent.summary}`,
      endpoint: { kind: "timeline_event" as const, timelineEventId: timelineEvent.timelineEventId },
    })),
  ];
}

export function CaseGraphReviewEditor({ graph, onChange }: Props) {
  const endpointOptions = contradictionEndpointOptions(graph);

  function updateContradiction(
    contradictionId: string,
    update: (contradiction: CaseGraph["contradictions"][number]) => CaseGraph["contradictions"][number],
  ) {
    onChange({
      ...graph,
      contradictions: graph.contradictions.map((contradiction) =>
        contradiction.contradictionId === contradictionId ? update(contradiction) : contradiction),
    });
  }

  function updateWitnessKnowledge(
    witnessId: string,
    list: KnowledgeList,
    entityId: string,
    checked: boolean,
  ) {
    onChange({
      ...graph,
      witnesses: graph.witnesses.map((witness) => {
        if (witness.witnessId !== witnessId) return witness;
        const boundary = witness.knowledgeBoundary;
        if (list === "knownFactIds") {
          return {
            ...witness,
            knowledgeBoundary: {
              ...boundary,
              knownFactIds: toggleId(boundary.knownFactIds, entityId, checked),
              perceivedFactIds: checked
                ? boundary.perceivedFactIds
                : boundary.perceivedFactIds.filter((id) => id !== entityId),
              unknownFactIds: checked
                ? boundary.unknownFactIds.filter((id) => id !== entityId)
                : boundary.unknownFactIds,
            },
          };
        }
        if (list === "unknownFactIds") {
          return {
            ...witness,
            knowledgeBoundary: {
              ...boundary,
              unknownFactIds: toggleId(boundary.unknownFactIds, entityId, checked),
              knownFactIds: checked
                ? boundary.knownFactIds.filter((id) => id !== entityId)
                : boundary.knownFactIds,
              perceivedFactIds: checked
                ? boundary.perceivedFactIds.filter((id) => id !== entityId)
                : boundary.perceivedFactIds,
            },
          };
        }
        return {
          ...witness,
          knowledgeBoundary: {
            ...boundary,
            seenEvidenceIds: toggleId(boundary.seenEvidenceIds, entityId, checked),
          },
        };
      }),
    });
  }

  return (
    <div className={styles.reviewSections}>
      <details className={styles.reviewDetails} open>
        <summary>Parties and counsel <span>{graph.parties.length}</span></summary>
        {graph.parties.map((party) => (
          <fieldset className={styles.entityEditor} key={party.partyId}>
            <legend>{party.partyId}</legend>
            <div className={styles.editorGrid}>
              <label>Name<input maxLength={200} value={party.name} onChange={(event) => onChange({ ...graph, parties: graph.parties.map((item) => item.partyId === party.partyId ? { ...item, name: event.target.value } : item) })} /></label>
              <label>Counsel<input maxLength={200} value={party.counselName ?? ""} onChange={(event) => onChange({ ...graph, parties: graph.parties.map((item) => item.partyId === party.partyId ? { ...item, counselName: event.target.value || null } : item) })} /></label>
              <label>Procedural role<select value={party.proceduralRole} onChange={(event) => onChange({ ...graph, parties: graph.parties.map((item) => item.partyId === party.partyId ? { ...item, proceduralRole: event.target.value as typeof item.proceduralRole } : item) })}><option value="claimant">Claimant</option><option value="respondent">Respondent</option><option value="prosecution">Prosecution</option><option value="defense">Defense</option><option value="third_party">Third party</option></select></label>
              <label>Simulation side<select value={party.simulationSide} onChange={(event) => onChange({ ...graph, parties: graph.parties.map((item) => item.partyId === party.partyId ? { ...item, simulationSide: event.target.value as typeof item.simulationSide } : item) })}><option value="user">User</option><option value="opposing">Opposing</option><option value="neutral">Neutral</option></select></label>
              <label className={styles.wideField}>Description<textarea maxLength={2_000} rows={3} value={party.description} onChange={(event) => onChange({ ...graph, parties: graph.parties.map((item) => item.partyId === party.partyId ? { ...item, description: event.target.value } : item) })} /></label>
            </div>
          </fieldset>
        ))}
      </details>

      <details className={styles.reviewDetails} open>
        <summary>Issues for trial <span>{graph.issues.length}</span></summary>
        {graph.issues.map((issue) => (
          <fieldset className={styles.entityEditor} key={issue.issueId}>
            <legend>{issue.issueId}</legend>
            <div className={styles.editorGrid}>
              <label>Title<input maxLength={240} value={issue.title} onChange={(event) => onChange({ ...graph, issues: graph.issues.map((item) => item.issueId === issue.issueId ? { ...item, title: event.target.value } : item) })} /></label>
              <label>Standard<input maxLength={1_000} value={issue.standard} onChange={(event) => onChange({ ...graph, issues: graph.issues.map((item) => item.issueId === issue.issueId ? { ...item, standard: event.target.value } : item) })} /></label>
              <label className={styles.wideField}>Question<textarea maxLength={2_000} rows={3} value={issue.question} onChange={(event) => onChange({ ...graph, issues: graph.issues.map((item) => item.issueId === issue.issueId ? { ...item, question: event.target.value } : item) })} /></label>
            </div>
          </fieldset>
        ))}
      </details>

      <details className={styles.reviewDetails}>
        <summary>Timeline <span>{graph.timeline.length}</span></summary>
        {graph.timeline.map((timelineEvent) => (
          <fieldset className={styles.entityEditor} key={timelineEvent.timelineEventId}>
            <legend>{timelineEvent.timelineEventId}</legend>
            <div className={styles.editorGrid}>
              <label>Occurred at<input type="datetime-local" value={isoLocalValue(timelineEvent.occurredAt)} onChange={(event) => {
                const date = new Date(event.target.value);
                if (!Number.isNaN(date.getTime())) onChange({ ...graph, timeline: graph.timeline.map((item) => item.timelineEventId === timelineEvent.timelineEventId ? { ...item, occurredAt: date.toISOString() } : item) });
              }} /></label>
              <label className={styles.wideField}>Summary<textarea maxLength={2_000} rows={3} value={timelineEvent.summary} onChange={(event) => onChange({ ...graph, timeline: graph.timeline.map((item) => item.timelineEventId === timelineEvent.timelineEventId ? { ...item, summary: event.target.value } : item) })} /></label>
            </div>
          </fieldset>
        ))}
      </details>

      <details className={styles.reviewDetails} open>
        <summary>Factual propositions <span>{graph.facts.length}</span></summary>
        {graph.facts.map((fact) => (
          <fieldset className={styles.entityEditor} key={fact.factId}>
            <legend>{fact.factId} · {fact.initialStatus}</legend>
            <label>Proposition<textarea maxLength={3_000} rows={3} value={fact.proposition} onChange={(event) => onChange({ ...graph, facts: graph.facts.map((item) => item.factId === fact.factId ? { ...item, proposition: event.target.value } : item) })} /></label>
          </fieldset>
        ))}
      </details>

      <details className={styles.reviewDetails} open>
        <summary>Evidence index <span>{graph.evidence.length}</span></summary>
        {graph.evidence.map((evidence) => (
          <fieldset className={styles.entityEditor} key={evidence.evidenceId}>
            <legend>{evidence.evidenceId}</legend>
            <div className={styles.editorGrid}>
              <label>Name<input maxLength={240} value={evidence.name} onChange={(event) => onChange({ ...graph, evidence: graph.evidence.map((item) => item.evidenceId === evidence.evidenceId ? { ...item, name: event.target.value } : item) })} /></label>
              <label>Authoring view<select value={evidence.authoringAdmissibility} onChange={(event) => onChange({ ...graph, evidence: graph.evidence.map((item) => item.evidenceId === evidence.evidenceId ? { ...item, authoringAdmissibility: event.target.value as typeof item.authoringAdmissibility } : item) })}><option value="undetermined">Undetermined</option><option value="likely_admissible">Likely admissible</option><option value="likely_excluded">Likely excluded</option></select></label>
              <label className={styles.wideField}>Description<textarea maxLength={3_000} rows={3} value={evidence.description} onChange={(event) => onChange({ ...graph, evidence: graph.evidence.map((item) => item.evidenceId === evidence.evidenceId ? { ...item, description: event.target.value } : item) })} /></label>
            </div>
          </fieldset>
        ))}
      </details>

      <details className={styles.reviewDetails} open>
        <summary>Witnesses and knowledge boundaries <span>{graph.witnesses.length}</span></summary>
        {graph.witnesses.map((witness) => (
          <fieldset className={styles.entityEditor} key={witness.witnessId}>
            <legend>{witness.witnessId}</legend>
            <div className={styles.editorGrid}>
              <label>Name<input maxLength={200} value={witness.name} onChange={(event) => onChange({ ...graph, witnesses: graph.witnesses.map((item) => item.witnessId === witness.witnessId ? { ...item, name: event.target.value } : item) })} /></label>
              <label>Role<input maxLength={500} value={witness.role} onChange={(event) => onChange({ ...graph, witnesses: graph.witnesses.map((item) => item.witnessId === witness.witnessId ? { ...item, role: event.target.value } : item) })} /></label>
              <label className={styles.wideField}>Summary<textarea maxLength={2_000} rows={3} value={witness.summary} onChange={(event) => onChange({ ...graph, witnesses: graph.witnesses.map((item) => item.witnessId === witness.witnessId ? { ...item, summary: event.target.value } : item) })} /></label>
            </div>
            <p className={styles.subheading}>Known and unknown facts</p>
            <div className={styles.knowledgeTable}>
              {graph.facts.map((fact) => (
                <div key={fact.factId}>
                  <span title={fact.proposition}>{fact.factId}</span>
                  <label className={styles.choice}><input checked={witness.knowledgeBoundary.knownFactIds.includes(fact.factId)} onChange={(event) => updateWitnessKnowledge(witness.witnessId, "knownFactIds", fact.factId, event.target.checked)} type="checkbox" />Known</label>
                  <label className={styles.choice}><input checked={witness.knowledgeBoundary.unknownFactIds.includes(fact.factId)} onChange={(event) => updateWitnessKnowledge(witness.witnessId, "unknownFactIds", fact.factId, event.target.checked)} type="checkbox" />Unknown</label>
                </div>
              ))}
            </div>
            <p className={styles.subheading}>Seen evidence</p>
            <div className={styles.choiceGrid}>
              {graph.evidence.map((evidence) => <label className={styles.choice} key={evidence.evidenceId}><input checked={witness.knowledgeBoundary.seenEvidenceIds.includes(evidence.evidenceId)} onChange={(event) => updateWitnessKnowledge(witness.witnessId, "seenEvidenceIds", evidence.evidenceId, event.target.checked)} type="checkbox" />{evidence.name}</label>)}
            </div>
            <div className={styles.editorGrid}>
              <label>Allowed topics<textarea rows={4} value={witness.knowledgeBoundary.allowedTopics.join("\n")} onChange={(event) => onChange({ ...graph, witnesses: graph.witnesses.map((item) => item.witnessId === witness.witnessId ? { ...item, knowledgeBoundary: { ...item.knowledgeBoundary, allowedTopics: lines(event.target.value) } } : item) })} /></label>
              <label>Forbidden topics<textarea rows={4} value={witness.knowledgeBoundary.forbiddenTopics.join("\n")} onChange={(event) => onChange({ ...graph, witnesses: graph.witnesses.map((item) => item.witnessId === witness.witnessId ? { ...item, knowledgeBoundary: { ...item.knowledgeBoundary, forbiddenTopics: lines(event.target.value) } } : item) })} /></label>
            </div>
            {witness.priorStatements.length > 0 && <><p className={styles.subheading}>Prior statements</p>{witness.priorStatements.map((statement) => <label key={statement.priorStatementId}>{statement.kind} · {statement.priorStatementId}<textarea maxLength={5_000} rows={3} value={statement.text} onChange={(event) => onChange({ ...graph, witnesses: graph.witnesses.map((item) => item.witnessId === witness.witnessId ? { ...item, priorStatements: item.priorStatements.map((prior) => prior.priorStatementId === statement.priorStatementId ? { ...prior, text: event.target.value } : prior) } : item) })} /></label>)}</>}
          </fieldset>
        ))}
      </details>

      <details className={styles.reviewDetails} open={graph.contradictions.length > 0}>
        <summary>Contradictions and impeachment paths <span>{graph.contradictions.length}</span></summary>
        {graph.contradictions.length === 0 ? (
          <p className={styles.clearReport}>The compiler did not identify a grounded contradiction.</p>
        ) : graph.contradictions.map((contradiction) => (
          <fieldset className={styles.entityEditor} key={contradiction.contradictionId}>
            <legend>{contradiction.contradictionId}</legend>
            <div className={styles.editorGrid}>
              <label className={styles.wideField}>Summary<textarea maxLength={2_000} rows={3} value={contradiction.summary} onChange={(event) => updateContradiction(contradiction.contradictionId, (item) => ({ ...item, summary: event.target.value }))} /></label>
              <label>Severity<select value={contradiction.severity} onChange={(event) => updateContradiction(contradiction.contradictionId, (item) => ({ ...item, severity: event.target.value as typeof item.severity }))}><option value="minor">Minor</option><option value="material">Material</option><option value="decisive">Decisive</option></select></label>
              <label>Left record<select value={contradictionEndpointKey(contradiction.left)} onChange={(event) => {
                const endpoint = endpointOptions.find((option) => option.key === event.target.value)?.endpoint;
                if (endpoint) updateContradiction(contradiction.contradictionId, (item) => ({ ...item, left: endpoint }));
              }}>{endpointOptions.filter((option) => option.key !== contradictionEndpointKey(contradiction.right)).map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
              <label>Right record<select value={contradictionEndpointKey(contradiction.right)} onChange={(event) => {
                const endpoint = endpointOptions.find((option) => option.key === event.target.value)?.endpoint;
                if (endpoint) updateContradiction(contradiction.contradictionId, (item) => ({ ...item, right: endpoint }));
              }}>{endpointOptions.filter((option) => option.key !== contradictionEndpointKey(contradiction.left)).map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
            </div>
            <p className={styles.subheading}>Related witnesses</p>
            <div className={styles.choiceGrid}>{graph.witnesses.map((witness) => <label className={styles.choice} key={witness.witnessId}><input checked={contradiction.witnessIds.includes(witness.witnessId)} onChange={(event) => updateContradiction(contradiction.contradictionId, (item) => ({ ...item, witnessIds: toggleId(item.witnessIds, witness.witnessId, event.target.checked) }))} type="checkbox" />{witness.name}</label>)}</div>
            <p className={styles.subheading}>Related issues</p>
            <div className={styles.choiceGrid}>{graph.issues.map((issue) => <label className={styles.choice} key={issue.issueId}><input checked={contradiction.relatedIssueIds.includes(issue.issueId)} onChange={(event) => updateContradiction(contradiction.contradictionId, (item) => ({ ...item, relatedIssueIds: toggleId(item.relatedIssueIds, issue.issueId, event.target.checked) }))} type="checkbox" />{issue.title}</label>)}</div>
          </fieldset>
        ))}
      </details>

      <details className={styles.reviewDetails}>
        <summary>Simulation rules and settlement <span>Settings</span></summary>
        <fieldset className={styles.entityEditor}>
          <legend>Jurisdiction profile</legend>
          <div className={styles.editorGrid}>
            <label>Name<input maxLength={240} value={graph.jurisdictionProfile.name} onChange={(event) => onChange({ ...graph, jurisdictionProfile: { ...graph.jurisdictionProfile, name: event.target.value } })} /></label>
            <label>Rules version<input maxLength={120} value={graph.jurisdictionProfile.rulesVersion} onChange={(event) => onChange({ ...graph, jurisdictionProfile: { ...graph.jurisdictionProfile, rulesVersion: event.target.value } })} /></label>
            <label>Burden of proof<select value={graph.jurisdictionProfile.burdenOfProof} onChange={(event) => onChange({ ...graph, jurisdictionProfile: { ...graph.jurisdictionProfile, burdenOfProof: event.target.value as typeof graph.jurisdictionProfile.burdenOfProof } })}><option value="preponderance">Preponderance</option><option value="clear_and_convincing">Clear and convincing</option><option value="beyond_reasonable_doubt">Beyond reasonable doubt</option></select></label>
            <label className={styles.wideField}>Governing law<textarea maxLength={1_000} rows={3} value={graph.jurisdictionProfile.governingLaw} onChange={(event) => onChange({ ...graph, jurisdictionProfile: { ...graph.jurisdictionProfile, governingLaw: event.target.value } })} /></label>
          </div>
          <p className={styles.subheading}>Permitted objection grounds</p>
          <div className={styles.choiceGrid}>{OBJECTION_GROUNDS.map((ground) => <label className={styles.choice} key={ground}><input checked={graph.jurisdictionProfile.permittedObjectionGrounds.includes(ground)} onChange={(event) => onChange({ ...graph, jurisdictionProfile: { ...graph.jurisdictionProfile, permittedObjectionGrounds: toggleId(graph.jurisdictionProfile.permittedObjectionGrounds, ground, event.target.checked) as typeof graph.jurisdictionProfile.permittedObjectionGrounds } })} type="checkbox" />{ground.replaceAll("_", " ")}</label>)}</div>
        </fieldset>
        <fieldset className={styles.entityEditor}>
          <legend>Settlement window</legend>
          <div className={styles.editorGrid}>
            <label className={styles.choice}><input checked={graph.settlement.enabled} onChange={(event) => onChange({ ...graph, settlement: { ...graph.settlement, enabled: event.target.checked } })} type="checkbox" />Settlement enabled</label>
            <label className={styles.choice}><input checked={graph.settlement.allowCounteroffers} onChange={(event) => onChange({ ...graph, settlement: { ...graph.settlement, allowCounteroffers: event.target.checked } })} type="checkbox" />Counteroffers allowed</label>
            <label>Currency<input maxLength={3} value={graph.settlement.currency} onChange={(event) => onChange({ ...graph, settlement: { ...graph.settlement, currency: event.target.value.toUpperCase() } })} /></label>
            <label>Opens at<select value={graph.settlement.opensAtPhase} onChange={(event) => onChange({ ...graph, settlement: { ...graph.settlement, opensAtPhase: event.target.value as typeof graph.settlement.opensAtPhase } })}><option value="pretrial">Pretrial</option><option value="opening">Opening</option><option value="case_in_chief">Case in chief</option><option value="recess">Recess</option><option value="pre_closing">Pre-closing</option></select></label>
            <label>Expires after events<input min={1} type="number" value={graph.settlement.expiresAfterEventCount} onChange={(event) => onChange({ ...graph, settlement: { ...graph.settlement, expiresAfterEventCount: Math.max(1, Number(event.target.value) || 1) } })} /></label>
          </div>
          {graph.settlement.participants.map((position) => <div className={styles.settlementPosition} key={position.partyId}><p className={styles.subheading}>{graph.parties.find((party) => party.partyId === position.partyId)?.name ?? position.partyId}</p><div className={styles.editorGrid}>{(["minimumAuthority", "maximumAuthority", "reservationValue", "targetValue"] as const).map((field) => <label key={field}>{field.replace(/([A-Z])/gu, " $1")}<input min={0} type="number" value={position[field]} onChange={(event) => onChange({ ...graph, settlement: { ...graph.settlement, participants: graph.settlement.participants.map((item) => item.partyId === position.partyId ? { ...item, [field]: Math.max(0, Number(event.target.value) || 0) } : item) } })} /></label>)}</div></div>)}
        </fieldset>
      </details>

      <details className={styles.reviewDetails}>
        <summary>Jury instructions <span>{graph.juryInstructions.length}</span></summary>
        {graph.juryInstructions.map((instruction) => <fieldset className={styles.entityEditor} key={instruction.instructionId}><legend>{instruction.instructionId}</legend><div className={styles.editorGrid}><label>Title<input maxLength={240} value={instruction.title} onChange={(event) => onChange({ ...graph, juryInstructions: graph.juryInstructions.map((item) => item.instructionId === instruction.instructionId ? { ...item, title: event.target.value } : item) })} /></label><label className={styles.wideField}>Instruction<textarea maxLength={5_000} rows={5} value={instruction.text} onChange={(event) => onChange({ ...graph, juryInstructions: graph.juryInstructions.map((item) => item.instructionId === instruction.instructionId ? { ...item, text: event.target.value } : item) })} /></label></div></fieldset>)}
      </details>
    </div>
  );
}
