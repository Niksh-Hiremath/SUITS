export type GroundedRoleplayReply = {
  kind: "grounded" | "unsupported";
  text: string;
  factIds: string[];
  evidenceIds: string[];
};

const has = (text: string, pattern: RegExp) => pattern.test(text.normalize("NFKC").toLowerCase());

export function answerGoldenWitness(question: string): GroundedRoleplayReply {
  if (has(question, /personally|yourself|did you (see|watch|observe)/)) {
    return {
      kind: "grounded",
      text: "No. I did not personally see the truck arrive. I first learned it was waiting from a later radio call, then reviewed the Gate B log the following morning.",
      factIds: ["F-WIT-002", "F-WIT-003", "F-WIT-004"],
      evidenceIds: ["E-004", "E-003"],
    };
  }
  if (has(question, /actually deliver|delivered|complete(?:d)? delivery|enter(?:ed|ing)? (?:the )?(?:venue|gate)/)) {
    return {
      kind: "grounded",
      text: "I cannot confirm the exact completed-delivery time. The Gate B log records the truck arriving at 7:31 PM, and Harbor Lantern alleges delivery occurred at 8:05 PM.",
      factIds: ["F-WIT-005", "F-PUB-004"],
      evidenceIds: ["E-003"],
    };
  }
  if (has(question, /arriv|reach|gate\s*b\s*(?:log|record)|(?:log|record).*(?:say|show|state)|what time.*(?:truck|generator)/)) {
    return {
      kind: "grounded",
      text: "The Gate B security log records Northstar's generator truck at Gate B at 7:31 PM. It says entry was held because the lane was obstructed.",
      factIds: ["F-WIT-005"],
      evidenceIds: ["E-003"],
    };
  }
  if (has(question, /obstruct|block|d[eé]cor|lane|clear(?:ed)?/)) {
    return {
      kind: "grounded",
      text: "Harbor Lantern's décor van obstructed Gate B. The movement note says it cleared the lane at 7:58 PM.",
      factIds: ["F-WIT-001", "F-WIT-007"],
      evidenceIds: ["E-005"],
    };
  }
  if (has(question, /light|lighting|outage|fail(?:ed|ure)/)) {
    return {
      kind: "grounded",
      text: "The venue's lighting interruption began at 7:42 PM. The record does not say that the generator itself failed.",
      factIds: ["F-PUB-003"],
      evidenceIds: ["E-002"],
    };
  }
  if (has(question, /due|deadline|contract|6(?::00)?/)) {
    return {
      kind: "grounded",
      text: "The written schedule required the generator at Service Gate B by 6:00 PM.",
      factIds: ["F-PUB-002"],
      evidenceIds: ["E-001"],
    };
  }
  return {
    kind: "unsupported",
    text: "That detail is not in the records I reviewed, and I did not observe it personally.",
    factIds: [],
    evidenceIds: [],
  };
}

export function replyAsOpposingCounsel(statement: string): GroundedRoleplayReply {
  if (has(statement, /before.*(?:light|outage)|(?:light|outage).*after|caus|7[:.]?31|gate\s*b/)) {
    return {
      kind: "grounded",
      text: "The 7:31 PM Gate B entry may precede the 7:42 PM lighting interruption, but Northstar still missed the contractual 6:00 PM delivery deadline. Harbor Lantern maintains that the late delivery left the venue without timely backup power.",
      factIds: ["F-WIT-005", "F-PUB-003", "F-PUB-002"],
      evidenceIds: ["E-003", "E-002", "E-001"],
    };
  }
  if (has(statement, /block|obstruct|d[eé]cor|harbor.*fault/)) {
    return {
      kind: "grounded",
      text: "Even if the lane was obstructed when the truck reached Gate B, Northstar was already overdue under the 6:00 PM schedule. Harbor Lantern disputes that the obstruction excuses the earlier delay.",
      factIds: ["F-WIT-005", "F-PUB-002"],
      evidenceIds: ["E-003", "E-001"],
    };
  }
  return {
    kind: "grounded",
    text: "Harbor Lantern's position is that Northstar promised delivery by 6:00 PM, the generator had not entered before the 7:42 PM interruption, and Northstar therefore failed its delivery obligation.",
    factIds: ["F-PUB-002", "F-PUB-003"],
    evidenceIds: ["E-001", "E-002"],
  };
}
