import { describe, expect, it } from "vitest";

import { answerGoldenWitness, replyAsOpposingCounsel } from "./courtroom-roleplay";

describe("golden-case witness role-play", () => {
  it.each([
    "What time did Northstar's generator truck arrive at Gate B?",
    "When did the generator reach the gate?",
    "What does the Gate B log say?",
  ])("answers natural arrival discovery questions without requiring the hidden timestamp", (question) => {
    expect(answerGoldenWitness(question)).toMatchObject({
      kind: "grounded",
      text: expect.stringContaining("7:31 PM"),
      factIds: expect.arrayContaining(["F-WIT-005"]),
      evidenceIds: ["E-003"],
    });
  });

  it("distinguishes arrival at the gate from completed delivery", () => {
    const answer = answerGoldenWitness("What time was the generator actually delivered?");
    expect(answer.text).toMatch(/cannot confirm.*exact.*deliver/i);
    expect(answer.text).toContain("7:31 PM");
  });

  it("answers questions about what the witness personally observed", () => {
    expect(answerGoldenWitness("Did you personally see the truck arrive?")).toMatchObject({
      kind: "grounded",
      factIds: expect.arrayContaining(["F-WIT-002", "F-WIT-003"]),
    });
  });

  it("refuses facts outside the authored record specifically", () => {
    const answer = answerGoldenWitness("Was the generator painted blue?");
    expect(answer).toMatchObject({ kind: "unsupported", factIds: [], evidenceIds: [] });
    expect(answer.text).toMatch(/not in the records|did not observe/i);
  });
});

describe("opposing counsel role-play", () => {
  it("rebuts a causation assertion while conceding the supported gate timestamp", () => {
    const reply = replyAsOpposingCounsel("The truck was at Gate B before the lights failed, so Northstar did not cause the outage.");
    expect(reply.text).toContain("7:31 PM");
    expect(reply.text).toContain("6:00 PM");
    expect(reply.factIds).toEqual(expect.arrayContaining(["F-PUB-002", "F-WIT-005"]));
  });

  it("answers a request for opposing counsel's position from the admitted record", () => {
    const reply = replyAsOpposingCounsel("What is Harbor Lantern's response?");
    expect(reply.text).toMatch(/6:00 PM/);
    expect(reply.evidenceIds).toContain("E-001");
  });
});
