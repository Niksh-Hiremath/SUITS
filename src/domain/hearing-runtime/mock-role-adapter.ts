import type { KnowledgeView } from "../knowledge";

type WitnessKnowledgeView = Extract<KnowledgeView, { actorRole: "witness" }>;

export type DeterministicWitnessAnswer = Readonly<{
  text: string;
  factIds: string[];
  evidenceIds: string[];
}>;

const STOP_WORDS = new Set([
  "about",
  "after",
  "before",
  "could",
  "did",
  "does",
  "from",
  "have",
  "that",
  "the",
  "their",
  "there",
  "they",
  "this",
  "what",
  "when",
  "where",
  "which",
  "with",
  "would",
  "you",
  "your",
]);

function tokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .match(/[a-z0-9]+/gu)
      ?.filter((token) => token.length >= 3 && !STOP_WORDS.has(token)) ?? [],
  );
}

function overlap(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  let score = 0;
  for (const token of left) if (right.has(token)) score += 1;
  return score;
}

/**
 * Temporary M3/CI adapter. It is case-agnostic and can cite only the supplied
 * witness KnowledgeView; M4 replaces the proposal step with GPT-5.6 while the
 * deterministic engine continues to validate the resulting action.
 */
export function createDeterministicWitnessAnswer(
  view: WitnessKnowledgeView,
  question: string,
  presentedEvidenceIds: readonly string[],
): DeterministicWitnessAnswer {
  const questionTokens = tokens(question);
  const forbiddenScore = Math.max(
    0,
    ...view.witness.forbiddenTopics.map((topic) =>
      overlap(questionTokens, tokens(topic)),
    ),
  );
  const allowedScore = Math.max(
    0,
    ...view.witness.allowedTopics.map((topic) =>
      overlap(questionTokens, tokens(topic)),
    ),
  );
  if (forbiddenScore > 0 && forbiddenScore >= allowedScore) {
    return {
      text: "I cannot answer that from my own permitted knowledge in this simulation.",
      factIds: [],
      evidenceIds: [],
    };
  }

  const rankedFacts = view.witness.facts
    .map((fact) => ({
      fact,
      score: overlap(questionTokens, tokens(fact.proposition)),
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.fact.factId.localeCompare(right.fact.factId),
    );
  const selectedFact = rankedFacts[0]?.score > 0 ? rankedFacts[0].fact : null;
  const presented = new Set(presentedEvidenceIds);
  const evidence = view.presentedEvidence
    .filter((item) => presented.has(item.evidenceId))
    .sort((left, right) => left.evidenceId.localeCompare(right.evidenceId));

  if (!selectedFact && evidence.length === 0) {
    return {
      text: "I do not know that from my own knowledge.",
      factIds: [],
      evidenceIds: [],
    };
  }

  const factSentence = selectedFact
    ? `Based on what I personally knew: ${selectedFact.proposition}`
    : "I can identify the material that was presented to me.";
  const evidenceSentence = evidence.length
    ? ` I recognize ${evidence.map((item) => item.name).join(" and ")}.`
    : "";
  return {
    text: `${factSentence}${evidenceSentence}`,
    factIds: selectedFact ? [selectedFact.factId] : [],
    evidenceIds: evidence.map((item) => item.evidenceId),
  };
}
