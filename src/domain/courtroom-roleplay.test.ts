import { describe, expect, it } from "vitest";

import { answerGoldenWitness, assessGoldenVerdict, replyAsOpposingCounsel } from "./courtroom-roleplay";

describe("Asha v Vertex witness role-play", () => {
  it("reveals when HR learned of the safety complaint", () => {
    expect(answerGoldenWitness("When did you learn about Asha's safety complaint?")).toMatchObject({
      text: expect.stringContaining("10:14 AM"), evidenceIds: ["E-001"],
    });
  });

  it("explains the pre-complaint termination draft", () => {
    expect(answerGoldenWitness("When was the termination memo first drafted?")).toMatchObject({
      text: expect.stringContaining("May 7"), evidenceIds: ["E-004"],
    });
  });

  it("reveals the post-complaint revision", () => {
    const answer = answerGoldenWitness("What language was added after the complaint?");
    expect(answer.text).toContain("disruptive escalation");
    expect(answer.text).toContain("4:38 PM");
    expect(answer.evidenceIds).toEqual(["E-005"]);
  });

  it("answers performance and warning questions", () => {
    expect(answerGoldenWitness("Was Asha ever given a formal written warning?").text).toMatch(/no formal written warning/i);
    expect(answerGoldenWitness("Were her inventory reports late?").text).toMatch(/two.*late/i);
  });

  it("refuses facts outside the authored record", () => {
    expect(answerGoldenWitness("What did the CEO privately think?")).toMatchObject({ kind: "unsupported", factIds: [], evidenceIds: [] });
  });
});

describe("opposing counsel role-play", () => {
  it("answers a retaliation argument with the May 7 draft", () => {
    const reply = replyAsOpposingCounsel("The complaint caused the termination.");
    expect(reply.text).toContain("May 7");
    expect(reply.evidenceIds).toContain("E-004");
  });
});

describe("dynamic verdict", () => {
  it("finds for Asha when the revision is exposed and connected in closing", () => {
    expect(assessGoldenVerdict([
      { actor: "Witness", text: "Disruptive escalation was added at 4:38 PM after the complaint." },
      { actor: "Advocate", text: "The post-complaint revision shows retaliation caused the final termination." },
    ])).toBe("claimant");
  });

  it("finds for Vertex when only the pre-existing performance case is established", () => {
    expect(assessGoldenVerdict([
      { actor: "Witness", text: "The termination memorandum was drafted on May 7 and two reports were late." },
      { actor: "Advocate", text: "Timing alone proves our case." },
    ])).toBe("respondent");
  });

  it("returns insufficient record when neither causal theory is developed", () => {
    expect(assessGoldenVerdict([{ actor: "Advocate", text: "Please find for my client." }])).toBe("insufficient_record");
  });
});