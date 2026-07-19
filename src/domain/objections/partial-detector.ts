import type { TrialPolicyObjectionGround } from "../trial-policy";

export const PARTIAL_OBJECTION_DETECTOR_SCHEMA_VERSION =
  "partial-objection-detector.input.v1" as const;
export const PARTIAL_OBJECTION_CANDIDATE_SCHEMA_VERSION =
  "partial-objection-candidate.v1" as const;
export const PARTIAL_OBJECTION_MINIMUM_STT_CONFIDENCE = 0.94 as const;

export type PartialObjectionSignal =
  | "privileged_communication_request"
  | "explicit_outside_scope_topic"
  | "repeated_question"
  | "accusatory_question"
  | "repeated_auxiliary_question"
  | "unfounded_exhibit_contents"
  | "leading_tag_or_assumption"
  | "explicit_guess_or_other_mind"
  | "third_party_statement_request";

export type PartialObjectionDetectorInput = Readonly<{
  schemaVersion: typeof PARTIAL_OBJECTION_DETECTOR_SCHEMA_VERSION;
  partialText: string;
  sttConfidence: number | null;
  speechKind: "question" | "testimony" | "argument";
  examinationLeg: "direct" | "cross" | "redirect" | "recross" | null;
  permittedGrounds: readonly TrialPolicyObjectionGround[];
  recentQuestionTexts: readonly string[];
  evidenceFoundationMissing: boolean;
  topicRelation: "unknown" | "within_scope" | "outside_scope";
  privilegeContext:
    "unknown" | "confidential_legal_communication" | "public_or_waived";
  thirdPartyStatementPurpose: "unknown" | "truth_of_assertion" | "non_truth";
  thirdPartyStatementException:
    | "unknown"
    | "none_identified"
    | "opposing_party_admission"
    | "recognized_exception";
  argumentativeContext: "unknown" | "badgering" | "ordinary_impeachment";
  personalKnowledgeContext: "unknown" | "perception_grounded" | "absent";
}>;

/**
 * A local interruption candidate, not an objection, ruling, or legal finding.
 * The exact partial is intentionally present for a later server-side resolver;
 * callers must never put it in metrics or logs.
 */
export type PartialObjectionCandidate = Readonly<{
  schemaVersion: typeof PARTIAL_OBJECTION_CANDIDATE_SCHEMA_VERSION;
  ground: TrialPolicyObjectionGround;
  signal: PartialObjectionSignal;
  partialText: string;
  normalizedText: string;
  sttConfidence: number;
}>;

type SignalMatch = Readonly<{
  ground: TrialPolicyObjectionGround;
  signal: PartialObjectionSignal;
}>;

const MAXIMUM_PARTIAL_CHARACTERS = 2_000;
const MINIMUM_QUESTION_WORDS = 5;
const MAXIMUM_RECENT_QUESTIONS = 32;

function compactText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeText(value: string): string {
  return compactText(value)
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9']+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function wordCount(normalizedText: string): number {
  return normalizedText === "" ? 0 : normalizedText.split(" ").length;
}

function isGroundPermitted(
  permittedGrounds: readonly TrialPolicyObjectionGround[],
  ground: TrialPolicyObjectionGround,
): boolean {
  return permittedGrounds.includes(ground);
}

function isRepeatedQuestion(
  normalizedText: string,
  recentQuestionTexts: readonly string[],
): boolean {
  if (normalizedText.length < 18) return false;
  return recentQuestionTexts
    .slice(-8)
    .some((question) => normalizeText(question) === normalizedText);
}

function detectSignal(
  input: PartialObjectionDetectorInput,
  compact: string,
  normalized: string,
): SignalMatch | null {
  const lower = compact
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[\u2018\u2019]/g, "'");
  const permitted = (ground: TrialPolicyObjectionGround) =>
    isGroundPermitted(input.permittedGrounds, ground);

  if (
    permitted("privilege") &&
    input.privilegeContext === "confidential_legal_communication" &&
    (/\bwhat (?:did|was) (?:your|the) (?:lawyer|attorney|counsel)\b.{0,80}\b(?:tell|say|advise|advice|discuss|communication)/i.test(
      lower,
    ) ||
      /\b(?:describe|repeat|disclose|reveal)\b.{0,60}\b(?:attorney client|lawyer client|legal advice|communications? with (?:your|the) (?:lawyer|attorney|counsel))/i.test(
        lower,
      ))
  ) {
    return {
      ground: "privilege",
      signal: "privileged_communication_request",
    };
  }

  if (permitted("relevance") && input.topicRelation === "outside_scope") {
    return { ground: "relevance", signal: "explicit_outside_scope_topic" };
  }

  if (
    permitted("asked_and_answered") &&
    isRepeatedQuestion(normalized, input.recentQuestionTexts)
  ) {
    return { ground: "asked_and_answered", signal: "repeated_question" };
  }

  if (
    permitted("argumentative") &&
    input.argumentativeContext === "badgering" &&
    (/\b(?:you are|you're) (?:lying|dishonest|making (?:that|it) up)\b/i.test(
      lower,
    ) ||
      /\byou (?:lied|fabricated|invented|made (?:that|it) up)\b/i.test(lower) ||
      /\bisn't it true (?:that )?you (?:lied|fabricated|invented)\b/i.test(
        lower,
      ))
  ) {
    return { ground: "argumentative", signal: "accusatory_question" };
  }

  if (
    permitted("compound") &&
    /\b(?:did|do|does|is|are|was|were|can|could|will|would|have|has|had)\b.{3,180}\band\s+(?:did|do|does|is|are|was|were|can|could|will|would|have|has|had)\b/i.test(
      lower,
    )
  ) {
    return { ground: "compound", signal: "repeated_auxiliary_question" };
  }

  if (
    permitted("foundation") &&
    input.evidenceFoundationMissing &&
    !/\b(?:recognize|authored|created|prepared|maintained|kept|received|familiar with)\b/i.test(
      lower,
    ) &&
    (/\baccording to (?:this|the) (?:document|record|recording|email|report|photo|photograph|exhibit)\b/i.test(
      lower,
    ) ||
      /\bwhat does (?:this|the) (?:document|record|recording|email|report|photo|photograph|exhibit)\b.{0,50}\b(?:show|say|prove|establish)\b/i.test(
        lower,
      ) ||
      /\bread (?:from )?(?:this|the) (?:document|record|email|report|exhibit)\b/i.test(
        lower,
      ))
  ) {
    return { ground: "foundation", signal: "unfounded_exhibit_contents" };
  }

  if (
    permitted("leading") &&
    (input.examinationLeg === "direct" ||
      input.examinationLeg === "redirect") &&
    (/^(?:isn't|wasn't|weren't|didn't|doesn't|don't|can't|couldn't|wouldn't|you agree that|the fact is that)\b/i.test(
      lower,
    ) ||
      /\b(?:correct|right|isn't that true|didn't you|wouldn't you agree)\s*[?.!]*$/i.test(
        lower,
      ))
  ) {
    return { ground: "leading", signal: "leading_tag_or_assumption" };
  }

  if (
    permitted("speculation") &&
    (/\b(?:can|could|would) you (?:guess|speculate)\b/i.test(lower) ||
      (input.personalKnowledgeContext === "absent" &&
        (/\bwhat do you think (?:he|she|they|the [a-z][a-z'-]*) (?:thought|intended|knew|meant|would)\b/i.test(
          lower,
        ) ||
          /\bwhy do you think (?:he|she|they|the [a-z][a-z'-]*)\b/i.test(
            lower,
          ))))
  ) {
    return {
      ground: "speculation",
      signal: "explicit_guess_or_other_mind",
    };
  }

  if (
    permitted("hearsay") &&
    input.thirdPartyStatementPurpose === "truth_of_assertion" &&
    input.thirdPartyStatementException === "none_identified" &&
    (/\bwhat did (?!you\b)(?:[a-z][a-z'-]*\s+){0,2}[a-z][a-z'-]* (?:say to|tell) you\b/i.test(
      normalized,
    ) ||
      /\btell (?:the )?(?:court|jury) what (?!you\b).{1,60}\b(?:said|told) you\b/i.test(
        normalized,
      ))
  ) {
    return { ground: "hearsay", signal: "third_party_statement_request" };
  }

  return null;
}

/**
 * Pure, deterministic and intentionally conservative. A match only authorizes
 * an interruption candidate to be reviewed; it never authorizes an objection
 * event or decides a ruling.
 */
export function detectPartialObjectionCandidate(
  input: PartialObjectionDetectorInput,
): PartialObjectionCandidate | null {
  if (input.schemaVersion !== PARTIAL_OBJECTION_DETECTOR_SCHEMA_VERSION) {
    return null;
  }
  if (
    typeof input.partialText !== "string" ||
    !Array.isArray(input.permittedGrounds) ||
    !Array.isArray(input.recentQuestionTexts) ||
    input.permittedGrounds.length > 32 ||
    input.recentQuestionTexts.length > MAXIMUM_RECENT_QUESTIONS ||
    !input.recentQuestionTexts.every(
      (question) =>
        typeof question === "string" &&
        question.length <= MAXIMUM_PARTIAL_CHARACTERS,
    ) ||
    input.speechKind !== "question" ||
    input.sttConfidence === null ||
    !Number.isFinite(input.sttConfidence) ||
    input.sttConfidence < PARTIAL_OBJECTION_MINIMUM_STT_CONFIDENCE ||
    input.sttConfidence > 1
  ) {
    return null;
  }

  const compact = compactText(input.partialText);
  if (compact.length === 0 || compact.length > MAXIMUM_PARTIAL_CHARACTERS) {
    return null;
  }
  const normalized = normalizeText(compact);
  if (wordCount(normalized) < MINIMUM_QUESTION_WORDS) return null;

  const match = detectSignal(input, compact, normalized);
  if (match === null) return null;
  return Object.freeze({
    schemaVersion: PARTIAL_OBJECTION_CANDIDATE_SCHEMA_VERSION,
    ground: match.ground,
    signal: match.signal,
    partialText: compact,
    normalizedText: normalized,
    sttConfidence: input.sttConfidence,
  });
}
