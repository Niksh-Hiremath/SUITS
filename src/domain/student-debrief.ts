export function outcomeLabel(vote: string | undefined) {
  if (vote === "respondent") return { verdict: "Northstar wins", explanation: "Why you won" };
  if (vote === "claimant") return { verdict: "Harbor Lantern wins", explanation: "Why you lost" };
  return { verdict: "Insufficient record", explanation: "Why the jury could not rule for you" };
}