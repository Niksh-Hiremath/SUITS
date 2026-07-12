export type ContradictionMatch = {
  matched: boolean;
  matchedElements: string[];
  missingElements: string[];
  matcherVersion: "contradiction-matcher.v1";
};

const ELEMENTS = {
  gateLog: /\b(gate\s*b|gate|security)\s*(log|record(?:ed|s)?)\b/i,
  truck: /\b(northstar(?:'s)?\s+)?(generator\s+)?(truck|vehicle)\b/i,
  arrival: /\b(7[:.]31|19[:.]31|seven\s+thirty[- ]one|eleven\s+minutes)\b/i,
  outage:
    /\b((7[:.]42|19[:.]42|seven\s+forty[- ]two).*(outage|lights?|lighting)|(outage|lights?|lighting).*(7[:.]42|19[:.]42|seven\s+forty[- ]two)|before\s+the\s+(lights?|lighting|outage)|eleven\s+minutes\s+before)\b/i,
  confirmation: /\b(correct|right|isn['’]?t\s+that|didn['’]?t\s+it|true)\b/i,
} as const;

export function matchGoldenContradiction(question: string): ContradictionMatch {
  const normalized = question.normalize("NFKC").replace(/\s+/g, " ").trim();
  const matchedElements = Object.entries(ELEMENTS)
    .filter(([, expression]) => expression.test(normalized))
    .map(([name]) => name);
  const missingElements = Object.keys(ELEMENTS).filter(
    (name) => !matchedElements.includes(name),
  );

  return {
    matched: missingElements.length === 0,
    matchedElements,
    missingElements,
    matcherVersion: "contradiction-matcher.v1",
  };
}