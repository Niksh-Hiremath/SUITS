import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  CaseGraphV1Schema,
  createThreeWitnessCaseGraphV1Fixture,
} from "../../domain/case-graph";

import {
  CaseGraphReviewEditor,
  parseTopicLines,
  updateWitnessCallableParty,
  updateWitnessKnowledgeReference,
  updateWitnessPermittedTopics,
  updateWitnessPriorStatementText,
} from "./case-graph-review-editor";

const RINA_ID = "witness_rina_shah";

function rinaFrom(graph: ReturnType<typeof createThreeWitnessCaseGraphV1Fixture>) {
  const witness = graph.witnesses.find(({ witnessId }) => witnessId === RINA_ID);
  if (!witness) throw new Error("Fixture is missing Rina Shah");
  return witness;
}

function expectValid(graph: ReturnType<typeof createThreeWitnessCaseGraphV1Fixture>) {
  expect(CaseGraphV1Schema.safeParse(graph).success).toBe(true);
}

describe("CaseGraphReviewEditor witness boundaries", () => {
  it("keeps perceived, known, and unknown fact relationships mutually valid", () => {
    const original = createThreeWitnessCaseGraphV1Fixture();
    const factId = "fact_draft_created";

    const perceived = updateWitnessKnowledgeReference(
      original,
      RINA_ID,
      "perceivedFactIds",
      factId,
      true,
    );
    expect(rinaFrom(perceived).knowledgeBoundary).toMatchObject({
      knownFactIds: expect.arrayContaining([factId]),
      perceivedFactIds: expect.arrayContaining([factId]),
    });
    expect(rinaFrom(perceived).knowledgeBoundary.unknownFactIds).not.toContain(factId);
    expectValid(perceived);

    const noLongerPerceived = updateWitnessKnowledgeReference(
      perceived,
      RINA_ID,
      "perceivedFactIds",
      factId,
      false,
    );
    expect(rinaFrom(noLongerPerceived).knowledgeBoundary.perceivedFactIds).not.toContain(factId);
    expect(rinaFrom(noLongerPerceived).knowledgeBoundary.knownFactIds).toContain(factId);
    expectValid(noLongerPerceived);

    const noLongerKnown = updateWitnessKnowledgeReference(
      perceived,
      RINA_ID,
      "knownFactIds",
      factId,
      false,
    );
    expect(rinaFrom(noLongerKnown).knowledgeBoundary.knownFactIds).not.toContain(factId);
    expect(rinaFrom(noLongerKnown).knowledgeBoundary.perceivedFactIds).not.toContain(factId);
    expectValid(noLongerKnown);

    const explicitlyUnknown = updateWitnessKnowledgeReference(
      perceived,
      RINA_ID,
      "unknownFactIds",
      factId,
      true,
    );
    expect(rinaFrom(explicitlyUnknown).knowledgeBoundary.unknownFactIds).toContain(factId);
    expect(rinaFrom(explicitlyUnknown).knowledgeBoundary.knownFactIds).not.toContain(factId);
    expect(rinaFrom(explicitlyUnknown).knowledgeBoundary.perceivedFactIds).not.toContain(factId);
    expectValid(explicitlyUnknown);

    const noLongerUnknown = updateWitnessKnowledgeReference(
      explicitlyUnknown,
      RINA_ID,
      "unknownFactIds",
      factId,
      false,
    );
    expect(rinaFrom(noLongerUnknown).knowledgeBoundary.unknownFactIds).not.toContain(factId);
    expectValid(noLongerUnknown);

    const knownAgain = updateWitnessKnowledgeReference(
      explicitlyUnknown,
      RINA_ID,
      "knownFactIds",
      factId,
      true,
    );
    expect(rinaFrom(knownAgain).knowledgeBoundary.knownFactIds).toContain(factId);
    expect(rinaFrom(knownAgain).knowledgeBoundary.unknownFactIds).not.toContain(factId);
    expectValid(knownAgain);
  });

  it("adds and removes evidence, own statements, caller parties, and permitted topics", () => {
    const original = createThreeWitnessCaseGraphV1Fixture();
    const evidenceId = "evidence_draft_metadata";
    const statementId = "statement_rina_interview";
    const partyId = "party_redwood_signal";

    const withEvidence = updateWitnessKnowledgeReference(
      original,
      RINA_ID,
      "seenEvidenceIds",
      evidenceId,
      true,
    );
    expect(rinaFrom(withEvidence).knowledgeBoundary.seenEvidenceIds).toContain(evidenceId);
    const withoutEvidence = updateWitnessKnowledgeReference(
      withEvidence,
      RINA_ID,
      "seenEvidenceIds",
      evidenceId,
      false,
    );
    expect(rinaFrom(withoutEvidence).knowledgeBoundary.seenEvidenceIds).not.toContain(evidenceId);

    const withoutStatement = updateWitnessKnowledgeReference(
      withoutEvidence,
      RINA_ID,
      "availablePriorStatementIds",
      statementId,
      false,
    );
    expect(rinaFrom(withoutStatement).knowledgeBoundary.availablePriorStatementIds).not.toContain(statementId);
    const withStatement = updateWitnessKnowledgeReference(
      withoutStatement,
      RINA_ID,
      "availablePriorStatementIds",
      statementId,
      true,
    );
    expect(rinaFrom(withStatement).knowledgeBoundary.availablePriorStatementIds).toContain(statementId);

    const withoutCaller = updateWitnessCallableParty(withStatement, RINA_ID, partyId, false);
    expect(rinaFrom(withoutCaller).callableByPartyIds).not.toContain(partyId);
    const withCaller = updateWitnessCallableParty(withoutCaller, RINA_ID, partyId, true);
    expect(rinaFrom(withCaller).callableByPartyIds).toContain(partyId);

    const withTopics = updateWitnessPermittedTopics(
      withCaller,
      RINA_ID,
      "Her complaint\nNewly permitted topic\nHer complaint\n",
    );
    expect(rinaFrom(withTopics).knowledgeBoundary.allowedTopics).toEqual([
      "Her complaint",
      "Newly permitted topic",
    ]);
    const withoutTopic = updateWitnessPermittedTopics(withTopics, RINA_ID, "Her complaint");
    expect(rinaFrom(withoutTopic).knowledgeBoundary.allowedTopics).toEqual(["Her complaint"]);
    expectValid(withoutTopic);
  });

  it("edits statement text but rejects cross-witness statement exposure", () => {
    const original = createThreeWitnessCaseGraphV1Fixture();
    const editedText = "I sent the safety complaint on March 4 and retained the sent copy.";
    const edited = updateWitnessPriorStatementText(
      original,
      RINA_ID,
      "statement_rina_interview",
      editedText,
    );
    expect(rinaFrom(edited).priorStatements[0].text).toBe(editedText);

    const blankAttempt = updateWitnessPriorStatementText(
      edited,
      RINA_ID,
      "statement_rina_interview",
      "   ",
    );
    expect(blankAttempt).toBe(edited);

    const crossWitnessAttempt = updateWitnessKnowledgeReference(
      blankAttempt,
      RINA_ID,
      "availablePriorStatementIds",
      "statement_theo_email",
      true,
    );
    expect(crossWitnessAttempt).toBe(blankAttempt);
    expect(rinaFrom(crossWitnessAttempt).knowledgeBoundary.availablePriorStatementIds).not.toContain(
      "statement_theo_email",
    );
    expectValid(crossWitnessAttempt);
  });

  it("renders an accessible control for every editable witness boundary", () => {
    const graph = createThreeWitnessCaseGraphV1Fixture();
    const rina = rinaFrom(graph);
    const markup = renderToStaticMarkup(
      <CaseGraphReviewEditor graph={graph} onChange={() => undefined} />,
    );

    expect(markup).toContain(`aria-label="${rina.name}: callable by Redwood Signal Systems"`);
    expect(markup).toContain(`aria-label="${rina.name}: knows`);
    expect(markup).toContain(`aria-label="${rina.name}: personally perceived`);
    expect(markup).toContain(`aria-label="${rina.name}: must not know`);
    expect(markup).toContain(`aria-label="${rina.name}: has seen`);
    expect(markup).toContain(`aria-label="${rina.name}: permitted topics"`);
    expect(markup).toContain(`aria-label="${rina.name}: may use statement_rina_interview"`);
    expect(markup).toContain(`aria-label="${rina.name}: text of statement_rina_interview"`);
  });

  it("normalizes duplicate and overlong topic lines to the schema limit", () => {
    expect(parseTopicLines(` one \n\none\n${"x".repeat(600)}`)).toEqual([
      "one",
      "x".repeat(500),
    ]);
  });
});
