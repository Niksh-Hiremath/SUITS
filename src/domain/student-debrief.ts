export function outcomeLabel(vote: string | undefined) {
  if (vote === "claimant") return { verdict: "Asha Mehta wins", explanation: "Why you won" };
  if (vote === "respondent") return { verdict: "Vertex Logistics wins", explanation: "Why you lost" };
  return { verdict: "Insufficient record", explanation: "Why the jury could not rule for you" };
}