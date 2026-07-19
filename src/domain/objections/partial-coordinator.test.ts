import { describe, expect, it, vi } from "vitest";

import {
  CACHED_OBJECTION_CLIP_ID,
  PARTIAL_OBJECTION_COORDINATOR_SCHEMA_VERSION,
  PARTIAL_OBJECTION_METRICS_SCHEMA_VERSION,
  PartialObjectionCoordinator,
  type CachedObjectionReaction,
  type OpenPartialObjectionUtterance,
  type PartialObjectionCoordinatorError,
  type PartialObjectionEnvelope,
  type PartialObjectionHead,
  type PartialTranscriptRevision,
} from "./partial-coordinator";

type Deferred<T> = Readonly<{
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}>;

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

const HEAD: PartialObjectionHead = {
  trialId: "trial_candidate_001",
  stateVersion: 14,
  lastEventId: "event_head_014",
};

const COMPOUND = "Did you read the report and did you sign the report?";

function open(
  overrides: Partial<OpenPartialObjectionUtterance> = {},
): OpenPartialObjectionUtterance {
  return {
    schemaVersion: PARTIAL_OBJECTION_COORDINATOR_SCHEMA_VERSION,
    generation: 1,
    head: HEAD,
    utteranceId: "utterance_question_001",
    detectorContext: {
      speechKind: "question",
      examinationLeg: "direct",
      permittedGrounds: ["compound", "privilege", "leading"],
      recentQuestionTexts: [],
      evidenceFoundationMissing: false,
      topicRelation: "unknown",
      privilegeContext: "confidential_legal_communication",
      thirdPartyStatementPurpose: "truth_of_assertion",
      thirdPartyStatementException: "none_identified",
      argumentativeContext: "badgering",
      personalKnowledgeContext: "absent",
    },
    ...overrides,
  };
}

function partial(
  revision: number,
  text = COMPOUND,
  overrides: Partial<PartialTranscriptRevision> = {},
): PartialTranscriptRevision {
  return {
    generation: 1,
    head: HEAD,
    utteranceId: "utterance_question_001",
    revision,
    text,
    confidence: 0.99,
    ...overrides,
  };
}

function harness() {
  const requests: Array<{
    signal: AbortSignal;
    deferred: Deferred<string>;
  }> = [];
  const order: string[] = [];
  const reactions = vi.fn(
    (reaction: CachedObjectionReaction, signal: AbortSignal) => {
      void reaction;
      void signal;
      order.push("reaction");
    },
  );
  const results = vi.fn(
    async (envelope: PartialObjectionEnvelope, result: string) => {
      void envelope;
      void result;
      order.push("result");
    },
  );
  const errors: PartialObjectionCoordinatorError[] = [];
  let now = 100;
  const coordinator = new PartialObjectionCoordinator<string>({
    now: () => now,
    onCachedReaction: reactions,
    requestModelCandidate: (_envelope, signal) => {
      order.push("request");
      const request = { signal, deferred: deferred<string>() };
      requests.push(request);
      return request.deferred.promise;
    },
    onModelResult: results,
    onError: (error) => errors.push(error),
  });
  return {
    coordinator,
    requests,
    reactions,
    results,
    errors,
    order,
    setNow: (value: number) => {
      now = value;
    },
  };
}

describe("PartialObjectionCoordinator", () => {
  it("plays the cached reaction before sending one exact head-bound candidate", async () => {
    const test = harness();
    expect(test.coordinator.openUtterance(open())).toBe(true);

    const accepted = test.coordinator.acceptPartial(partial(1));

    expect(accepted.disposition).toBe("candidate_started");
    expect(test.order).toEqual(["reaction", "request"]);
    expect(test.reactions).toHaveBeenCalledWith(
      {
        clipId: CACHED_OBJECTION_CLIP_ID,
        interruptId: "interrupt:partial:1:utterance_question_001:1",
        generation: 1,
        utteranceId: "utterance_question_001",
        revision: 1,
      },
      expect.anything(),
    );
    expect(accepted.envelope).toMatchObject({
      head: HEAD,
      generation: 1,
      utteranceId: "utterance_question_001",
      revision: 1,
      candidate: { ground: "compound" },
    });
    expect(test.requests).toHaveLength(1);

    test.requests[0]!.deferred.resolve("model proposal");
    await test.coordinator.waitForIdle();
    expect(test.results).toHaveBeenCalledTimes(1);
    expect(test.order).toEqual(["reaction", "request", "result"]);
  });

  it("awaits an asynchronous cached reaction before model dispatch", async () => {
    const reaction = deferred<void>();
    const request = deferred<string>();
    const order: string[] = [];
    const coordinator = new PartialObjectionCoordinator<string>({
      onCachedReaction: async () => {
        order.push("reaction_started");
        await reaction.promise;
        order.push("reaction_ready");
      },
      requestModelCandidate: () => {
        order.push("request");
        return request.promise;
      },
      onModelResult: () => undefined,
      onError: vi.fn(),
    });
    coordinator.openUtterance(open());

    coordinator.acceptPartial(partial(1));
    expect(order).toEqual(["reaction_started"]);

    reaction.resolve();
    await vi.waitFor(() =>
      expect(order).toEqual(["reaction_started", "reaction_ready", "request"]),
    );
    request.resolve("proposal");
    await coordinator.waitForIdle();
  });

  it("contains an asynchronous reaction failure before continuing review", async () => {
    const reaction = deferred<void>();
    const request = deferred<string>();
    const errors: PartialObjectionCoordinatorError[] = [];
    const coordinator = new PartialObjectionCoordinator<string>({
      onCachedReaction: () => reaction.promise,
      requestModelCandidate: () => request.promise,
      onModelResult: () => undefined,
      onError: (error) => errors.push(error),
    });
    coordinator.openUtterance(open());
    coordinator.acceptPartial(partial(1));

    reaction.reject(new Error("audio queue unavailable"));
    await vi.waitFor(() =>
      expect(coordinator.getMetrics().modelRequestsStarted).toBe(1),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: "cached_reaction_failed" });

    request.resolve("proposal");
    await coordinator.waitForIdle();
  });

  it("never sends low-confidence or otherwise non-candidate partials", async () => {
    const test = harness();
    test.coordinator.openUtterance(open());

    expect(
      test.coordinator.acceptPartial(partial(1, COMPOUND, { confidence: 0.8 }))
        .disposition,
    ).toBe("non_candidate");
    expect(
      test.coordinator.acceptPartial(
        partial(2, "Please state your full name for the record."),
      ).disposition,
    ).toBe("non_candidate");
    await test.coordinator.waitForIdle();

    expect(test.reactions).not.toHaveBeenCalled();
    expect(test.requests).toHaveLength(0);
    expect(test.results).not.toHaveBeenCalled();
  });

  it("rejects stale revisions and rebinds equivalent candidates to the newest revision", async () => {
    const test = harness();
    test.coordinator.openUtterance(open());
    expect(test.coordinator.acceptPartial(partial(1)).disposition).toBe(
      "candidate_started",
    );
    expect(test.coordinator.acceptPartial(partial(1)).disposition).toBe(
      "stale_revision",
    );
    expect(
      test.coordinator.acceptPartial(partial(2, `  ${COMPOUND}  `)).disposition,
    ).toBe("candidate_started");
    expect(test.requests).toHaveLength(2);
    expect(test.requests[0]!.signal.aborted).toBe(true);
    expect(test.requests[0]!.signal.reason).toBe(
      "superseded_equivalent_revision",
    );

    test.requests[0]!.deferred.resolve("stale proposal");
    test.requests[1]!.deferred.resolve("current proposal");
    await test.coordinator.waitForIdle();
    expect(test.results).toHaveBeenCalledTimes(1);
    expect(test.results.mock.calls[0]?.[0].revision).toBe(2);
    expect(test.coordinator.getMetrics()).toMatchObject({
      staleRevisions: 1,
      duplicateCandidates: 0,
      modelRequestsStarted: 2,
    });
  });

  it("keeps only one in-flight request when a revised candidate supersedes it", async () => {
    const test = harness();
    test.coordinator.openUtterance(open());
    test.coordinator.acceptPartial(partial(1));
    const replacement = test.coordinator.acceptPartial(
      partial(2, "What did your attorney tell you about the settlement terms?"),
    );

    expect(replacement.disposition).toBe("candidate_started");
    expect(test.requests).toHaveLength(2);
    expect(test.requests[0]!.signal.aborted).toBe(true);
    expect(test.requests[0]!.signal.reason).toBe("superseded_revision");
    expect(test.requests[1]!.signal.aborted).toBe(false);
    expect(test.reactions).toHaveBeenCalledTimes(1);

    test.requests[0]!.deferred.resolve("late compound proposal");
    test.requests[1]!.deferred.resolve("current privilege proposal");
    await test.coordinator.waitForIdle();
    expect(test.results).toHaveBeenCalledTimes(1);
    expect(test.results.mock.calls[0]?.[0].candidate.ground).toBe("privilege");
  });

  it("withdraws an in-flight candidate when a newer revision no longer matches", async () => {
    const test = harness();
    test.coordinator.openUtterance(open());
    test.coordinator.acceptPartial(partial(1));
    expect(
      test.coordinator.acceptPartial(
        partial(2, "Please state your full name for the record."),
      ).disposition,
    ).toBe("non_candidate");
    expect(test.requests[0]!.signal.aborted).toBe(true);
    expect(test.requests[0]!.signal.reason).toBe("candidate_withdrawn");

    test.requests[0]!.deferred.resolve("late proposal");
    await test.coordinator.waitForIdle();
    expect(test.results).not.toHaveBeenCalled();
  });

  it("allows the same candidate to recover after withdrawal", async () => {
    const test = harness();
    test.coordinator.openUtterance(open());
    test.coordinator.acceptPartial(partial(1));
    test.coordinator.acceptPartial(
      partial(2, "Please state your full name for the record."),
    );

    expect(test.coordinator.acceptPartial(partial(3)).disposition).toBe(
      "candidate_started",
    );
    expect(test.requests).toHaveLength(2);
    test.requests[0]!.deferred.resolve("withdrawn proposal");
    test.requests[1]!.deferred.resolve("current proposal");
    await test.coordinator.waitForIdle();

    expect(test.results).toHaveBeenCalledTimes(1);
    expect(test.results.mock.calls[0]?.[0].revision).toBe(3);
  });

  it("aborts and fences the model result at the final transcript", async () => {
    const test = harness();
    test.coordinator.openUtterance(open());
    test.coordinator.acceptPartial(partial(3));

    expect(test.coordinator.finalize({ ...partial(3), revision: 3 })).toBe(
      true,
    );
    expect(test.requests[0]!.signal.aborted).toBe(true);
    expect(test.requests[0]!.signal.reason).toBe("final_transcript");
    expect(test.coordinator.acceptPartial(partial(4)).disposition).toBe(
      "after_final",
    );

    test.requests[0]!.deferred.resolve("late proposal");
    await test.coordinator.waitForIdle();
    expect(test.results).not.toHaveBeenCalled();
  });

  it("seals a final STT revision while retaining the partial candidate", async () => {
    const request = deferred<string>();
    const deliveries: Array<{
      triggerRevision: number;
      expectedRevision: number;
      signalAborted: boolean;
    }> = [];
    const coordinator = new PartialObjectionCoordinator<string>({
      onCachedReaction: () => undefined,
      requestModelCandidate: () => request.promise,
      onModelResult: (envelope, _result, fence) => {
        deliveries.push({
          triggerRevision: envelope.revision,
          expectedRevision: fence.expectedRevision,
          signalAborted: fence.signal.aborted,
        });
      },
      onError: vi.fn(),
    });
    coordinator.openUtterance(open());
    coordinator.acceptPartial(partial(3));

    expect(coordinator.sealFinalCandidate(partial(4))).toBe(true);
    request.resolve("proposal from final-bound request");
    await coordinator.waitForIdle();

    expect(deliveries).toEqual([
      {
        triggerRevision: 3,
        expectedRevision: 4,
        signalAborted: false,
      },
    ]);
    expect(coordinator.getMetrics()).toMatchObject({
      finalCandidatesSealed: 1,
      resultsDelivered: 1,
    });
  });

  it("can defer all model work until the final candidate is sealed", async () => {
    const requestModelCandidate = vi.fn(async () => "proposal");
    const onModelResult = vi.fn();
    const coordinator = new PartialObjectionCoordinator<string>({
      modelDispatch: "after_final_seal",
      onCachedReaction: () => undefined,
      requestModelCandidate,
      onModelResult,
      onError: vi.fn(),
    });
    coordinator.openUtterance(open());
    coordinator.acceptPartial(partial(2));

    expect(requestModelCandidate).not.toHaveBeenCalled();
    expect(coordinator.sealFinalCandidate(partial(3))).toBe(true);
    await coordinator.waitForIdle();

    expect(requestModelCandidate).toHaveBeenCalledTimes(1);
    expect(onModelResult).toHaveBeenCalledTimes(1);
    expect(onModelResult.mock.calls[0]?.[2].expectedRevision).toBe(3);
  });

  it("rejects a final seal once async delivery has started", async () => {
    const deliveryStarted = deferred<void>();
    const releaseDelivery = deferred<void>();
    const deliveryState: { fence?: { signal: AbortSignal } } = {};
    const coordinator = new PartialObjectionCoordinator<string>({
      onCachedReaction: () => undefined,
      requestModelCandidate: async () => "proposal",
      onModelResult: async (_envelope, _result, fence) => {
        deliveryState.fence = fence;
        deliveryStarted.resolve();
        await releaseDelivery.promise;
      },
      onError: vi.fn(),
    });
    coordinator.openUtterance(open());
    coordinator.acceptPartial(partial(1));
    await deliveryStarted.promise;

    expect(coordinator.sealFinalCandidate(partial(2))).toBe(false);
    expect(deliveryState.fence?.signal.aborted).toBe(true);
    releaseDelivery.resolve();
    await coordinator.waitForIdle();
    expect(coordinator.getMetrics().resultsDelivered).toBe(0);
  });

  it("rejects a stale final without cancelling the current request", async () => {
    const test = harness();
    test.coordinator.openUtterance(open());
    test.coordinator.acceptPartial(partial(4));

    expect(test.coordinator.finalize({ ...partial(3), revision: 3 })).toBe(
      false,
    );
    expect(test.requests[0]!.signal.aborted).toBe(false);
    test.requests[0]!.deferred.resolve("proposal");
    await test.coordinator.waitForIdle();
    expect(test.results).toHaveBeenCalledTimes(1);
  });

  it("invalidates an exact utterance when the canonical head changes", async () => {
    const test = harness();
    test.coordinator.openUtterance(open());
    test.coordinator.acceptPartial(partial(1));
    const changedHead = { ...HEAD, stateVersion: HEAD.stateVersion + 1 };

    expect(test.coordinator.invalidateHead(changedHead)).toBe(true);
    expect(test.requests[0]!.signal.aborted).toBe(true);
    expect(test.requests[0]!.signal.reason).toBe("head_changed");
    expect(
      test.coordinator.acceptPartial(
        partial(2, COMPOUND, { head: changedHead }),
      ).disposition,
    ).toBe("no_active_utterance");

    test.requests[0]!.deferred.resolve("late proposal");
    await test.coordinator.waitForIdle();
    expect(test.results).not.toHaveBeenCalled();
  });

  it("ignores stale generations and older head notifications", async () => {
    const test = harness();
    const generation = 2;
    test.coordinator.openUtterance(open({ generation }));
    test.coordinator.acceptPartial(partial(1, COMPOUND, { generation }));

    expect(
      test.coordinator.openUtterance(
        open({ generation: 1, utteranceId: "utterance_delayed" }),
      ),
    ).toBe(false);
    expect(
      test.coordinator.acceptPartial(partial(2, COMPOUND, { generation: 1 }))
        .disposition,
    ).toBe("stale_generation");
    expect(
      test.coordinator.finalize({
        ...partial(2, COMPOUND, { generation: 1 }),
      }),
    ).toBe(false);
    expect(test.coordinator.invalidateHead({ ...HEAD, stateVersion: 13 })).toBe(
      false,
    );
    expect(test.requests[0]!.signal.aborted).toBe(false);

    test.requests[0]!.deferred.resolve("proposal");
    await test.coordinator.waitForIdle();
    expect(test.results).toHaveBeenCalledTimes(1);
    expect(test.coordinator.getMetrics()).toMatchObject({
      staleGenerations: 2,
      staleHeadsIgnored: 1,
    });
  });

  it("retains generation and canonical-head high-water after invalidation", async () => {
    const test = harness();
    const newerHead = { ...HEAD, stateVersion: HEAD.stateVersion + 1 };
    test.coordinator.openUtterance(open({ generation: 2 }));
    test.coordinator.acceptPartial(partial(1, COMPOUND, { generation: 2 }));

    expect(test.coordinator.invalidateHead(newerHead)).toBe(true);
    expect(test.requests[0]!.signal.aborted).toBe(true);
    expect(
      test.coordinator.openUtterance(
        open({ generation: 1, utteranceId: "utterance_delayed" }),
      ),
    ).toBe(false);
    expect(
      test.coordinator.openUtterance(
        open({ generation: 3, utteranceId: "utterance_old_head" }),
      ),
    ).toBe(false);
    expect(
      test.coordinator.openUtterance(
        open({
          generation: 3,
          head: newerHead,
          utteranceId: "utterance_current",
        }),
      ),
    ).toBe(true);

    expect(
      test.coordinator.acceptPartial(
        partial(1, COMPOUND, {
          generation: 3,
          head: newerHead,
          utteranceId: "utterance_current",
        }),
      ).disposition,
    ).toBe("candidate_started");
    test.requests[0]!.deferred.resolve("stale proposal");
    test.requests[1]!.deferred.resolve("current proposal");
    await test.coordinator.waitForIdle();
    expect(test.results).toHaveBeenCalledTimes(1);
  });

  it("rejects wrong-utterance events without disturbing the active request", async () => {
    const test = harness();
    test.coordinator.openUtterance(open());
    test.coordinator.acceptPartial(partial(1));

    expect(
      test.coordinator.acceptPartial(
        partial(2, COMPOUND, { utteranceId: "utterance_other" }),
      ).disposition,
    ).toBe("wrong_utterance");
    expect(test.requests[0]!.signal.aborted).toBe(false);
    test.requests[0]!.deferred.resolve("proposal");
    await test.coordinator.waitForIdle();
    expect(test.results).toHaveBeenCalledTimes(1);
  });

  it("aborts and fences all work after close", async () => {
    const test = harness();
    test.coordinator.openUtterance(open());
    test.coordinator.acceptPartial(partial(1));
    test.coordinator.close();

    expect(test.requests[0]!.signal.aborted).toBe(true);
    expect(test.requests[0]!.signal.reason).toBe("coordinator_closed");
    expect(test.coordinator.acceptPartial(partial(2)).disposition).toBe(
      "closed",
    );
    expect(test.coordinator.openUtterance(open())).toBe(false);

    test.requests[0]!.deferred.resolve("late proposal");
    await test.coordinator.waitForIdle();
    expect(test.results).not.toHaveBeenCalled();
  });

  it("cancels a never-settling reaction barrier at finalization", async () => {
    const reaction = deferred<void>();
    const requestModelCandidate = vi.fn(async () => "proposal");
    const reactionState: { signal?: AbortSignal } = {};
    const coordinator = new PartialObjectionCoordinator<string>({
      onCachedReaction: (_reaction, signal) => {
        reactionState.signal = signal;
        return reaction.promise;
      },
      requestModelCandidate,
      onModelResult: vi.fn(),
      onError: vi.fn(),
    });
    coordinator.openUtterance(open());
    coordinator.acceptPartial(partial(1));

    expect(requestModelCandidate).not.toHaveBeenCalled();
    expect(coordinator.finalize(partial(1))).toBe(true);
    expect(reactionState.signal?.aborted).toBe(true);
    await expect(coordinator.waitForIdle()).resolves.toBeUndefined();
    expect(requestModelCandidate).not.toHaveBeenCalled();
    expect(coordinator.getMetrics()).toMatchObject({
      reactionsAborted: 1,
      candidatePipelinesAborted: 1,
      modelRequestsAborted: 0,
    });
    reaction.resolve();
  });

  it("releases idle waits when a cancelled model request ignores its signal", async () => {
    const request = deferred<string>();
    const coordinator = new PartialObjectionCoordinator<string>({
      onCachedReaction: () => undefined,
      requestModelCandidate: () => request.promise,
      onModelResult: vi.fn(),
      onError: vi.fn(),
    });
    coordinator.openUtterance(open());
    coordinator.acceptPartial(partial(1));

    coordinator.close();
    await expect(coordinator.waitForIdle()).resolves.toBeUndefined();
    request.resolve("late ignored proposal");
  });

  it("releases idle waits when a cancelled result callback ignores its signal", async () => {
    const deliveryStarted = deferred<void>();
    const delivery = deferred<void>();
    const coordinator = new PartialObjectionCoordinator<string>({
      onCachedReaction: () => undefined,
      requestModelCandidate: async () => "proposal",
      onModelResult: async () => {
        deliveryStarted.resolve();
        await delivery.promise;
      },
      onError: vi.fn(),
    });
    coordinator.openUtterance(open());
    coordinator.acceptPartial(partial(1));
    await deliveryStarted.promise;

    coordinator.close();
    await expect(coordinator.waitForIdle()).resolves.toBeUndefined();
    delivery.resolve();
  });

  it("reports reaction failure and still sends the candidate for review", async () => {
    const errors: PartialObjectionCoordinatorError[] = [];
    const request = deferred<string>();
    const coordinator = new PartialObjectionCoordinator<string>({
      onCachedReaction: () => {
        throw new Error("speaker unavailable");
      },
      requestModelCandidate: () => request.promise,
      onModelResult: vi.fn(),
      onError: (error) => errors.push(error),
    });
    coordinator.openUtterance(open());

    expect(coordinator.acceptPartial(partial(1)).disposition).toBe(
      "candidate_started",
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      stage: "cached_reaction",
      code: "cached_reaction_failed",
    });
    request.resolve("proposal");
    await coordinator.waitForIdle();
    expect(coordinator.getMetrics()).toMatchObject({ reactionFailures: 1 });
  });

  it("contains a throwing error observer without stranding candidate work", async () => {
    const request = deferred<string>();
    const result = vi.fn();
    const coordinator = new PartialObjectionCoordinator<string>({
      onCachedReaction: () => {
        throw new Error("speaker unavailable");
      },
      requestModelCandidate: () => request.promise,
      onModelResult: result,
      onError: () => {
        throw new Error("diagnostic sink unavailable");
      },
    });
    coordinator.openUtterance(open());

    expect(() => coordinator.acceptPartial(partial(1))).not.toThrow();
    request.resolve("proposal");
    await expect(coordinator.waitForIdle()).resolves.toBeUndefined();

    expect(result).toHaveBeenCalledTimes(1);
    expect(coordinator.getMetrics()).toMatchObject({
      reactionFailures: 1,
      errorHandlerFailures: 1,
      coordinatorTaskFailures: 0,
    });
  });

  it("reports model failures without exposing error or transcript data in metrics", async () => {
    const test = harness();
    test.coordinator.openUtterance(open());
    test.coordinator.acceptPartial(partial(1));
    test.requests[0]!.deferred.reject(
      new Error(`provider failed: ${COMPOUND}`),
    );
    await test.coordinator.waitForIdle();

    expect(test.errors).toHaveLength(1);
    expect(test.errors[0]).toMatchObject({
      stage: "model_candidate",
      code: "model_candidate_failed",
    });
    const metrics = test.coordinator.getMetrics();
    expect(metrics).toMatchObject({
      schemaVersion: PARTIAL_OBJECTION_METRICS_SCHEMA_VERSION,
      modelRequestFailures: 1,
      resultsDelivered: 0,
    });
    const serialized = JSON.stringify(metrics);
    expect(serialized).not.toContain("report");
    expect(serialized).not.toContain("actor_");
    expect(serialized).not.toContain("utterance_");
    expect(serialized).not.toContain("trial_");
    expect(serialized).not.toContain("provider failed");
  });

  it("allows a candidate retry after a transient model failure", async () => {
    const test = harness();
    test.coordinator.openUtterance(open());
    test.coordinator.acceptPartial(partial(1));
    test.requests[0]!.deferred.reject(new Error("temporary provider failure"));
    await test.coordinator.waitForIdle();

    expect(test.coordinator.acceptPartial(partial(2)).disposition).toBe(
      "candidate_started",
    );
    test.requests[1]!.deferred.resolve("recovered proposal");
    await test.coordinator.waitForIdle();

    expect(test.results).toHaveBeenCalledTimes(1);
    expect(test.results.mock.calls[0]?.[0].revision).toBe(2);
  });

  it("allows one final-bound retry after a transient model failure", async () => {
    const requests = [deferred<string>(), deferred<string>()];
    let requestIndex = 0;
    const result = vi.fn();
    const coordinator = new PartialObjectionCoordinator<string>({
      modelDispatch: "after_final_seal",
      onCachedReaction: () => undefined,
      requestModelCandidate: () => requests[requestIndex++]!.promise,
      onModelResult: result,
      onError: vi.fn(),
    });
    coordinator.openUtterance(open());
    coordinator.acceptPartial(partial(1));
    coordinator.sealFinalCandidate(partial(2));
    requests[0].reject(new Error("temporary provider failure"));
    await coordinator.waitForIdle();

    expect(coordinator.retrySealedCandidate()).toBe(true);
    requests[1].resolve("recovered proposal");
    await coordinator.waitForIdle();

    expect(result).toHaveBeenCalledTimes(1);
    expect(coordinator.retrySealedCandidate()).toBe(false);
    expect(coordinator.getMetrics()).toMatchObject({
      sealedRetriesStarted: 1,
      resultsDelivered: 1,
    });
  });

  it("allows the sealed retry after a transient delivery failure", async () => {
    let deliveryAttempt = 0;
    const coordinator = new PartialObjectionCoordinator<string>({
      modelDispatch: "after_final_seal",
      onCachedReaction: () => undefined,
      requestModelCandidate: async () => "proposal",
      onModelResult: () => {
        deliveryAttempt += 1;
        if (deliveryAttempt === 1) throw new Error("temporary commit failure");
      },
      onError: vi.fn(),
    });
    coordinator.openUtterance(open());
    coordinator.acceptPartial(partial(1));
    coordinator.sealFinalCandidate(partial(2));
    await coordinator.waitForIdle();

    expect(coordinator.retrySealedCandidate()).toBe(true);
    await coordinator.waitForIdle();

    expect(deliveryAttempt).toBe(2);
    expect(coordinator.getMetrics()).toMatchObject({
      resultDeliveryFailures: 1,
      sealedRetriesStarted: 1,
      resultsDelivered: 1,
    });
  });

  it("aborts a different request before returning a delivered duplicate", async () => {
    const test = harness();
    const privilegeQuestion =
      "What did your attorney tell you about the settlement terms?";
    test.coordinator.openUtterance(open());
    test.coordinator.acceptPartial(partial(1));
    test.requests[0]!.deferred.resolve("compound proposal");
    await test.coordinator.waitForIdle();

    test.coordinator.acceptPartial(partial(2, privilegeQuestion));
    expect(test.requests[1]!.signal.aborted).toBe(false);
    expect(test.coordinator.acceptPartial(partial(3)).disposition).toBe(
      "duplicate_candidate",
    );
    expect(test.requests[1]!.signal.aborted).toBe(true);
    expect(test.requests[1]!.signal.reason).toBe("superseded_revision");

    test.requests[1]!.deferred.resolve("stale privilege proposal");
    expect(
      test.coordinator.acceptPartial(partial(4, privilegeQuestion)).disposition,
    ).toBe("candidate_started");
    test.requests[2]!.deferred.resolve("current privilege proposal");
    await test.coordinator.waitForIdle();
    expect(test.results).toHaveBeenCalledTimes(2);
  });

  it("aborts an asynchronous delivery fence when the utterance finalizes", async () => {
    const deliveryStarted = deferred<void>();
    const releaseDelivery = deferred<void>();
    let committed = false;
    const deliveryState: { signal?: AbortSignal } = {};
    const coordinator = new PartialObjectionCoordinator<string>({
      onCachedReaction: () => undefined,
      requestModelCandidate: async () => "proposal",
      onModelResult: async (_envelope, _result, fence) => {
        deliveryState.signal = fence.signal;
        deliveryStarted.resolve();
        await releaseDelivery.promise;
        if (!fence.signal.aborted && fence.isCurrent()) committed = true;
      },
      onError: vi.fn(),
    });
    coordinator.openUtterance(open());
    coordinator.acceptPartial(partial(1));
    await deliveryStarted.promise;

    expect(coordinator.finalize(partial(1))).toBe(true);
    expect(deliveryState.signal?.aborted).toBe(true);
    releaseDelivery.resolve();
    await coordinator.waitForIdle();

    expect(committed).toBe(false);
    expect(coordinator.getMetrics()).toMatchObject({
      resultsDelivered: 0,
      staleResultsFenced: 1,
    });
  });

  it("records bounded safe latencies without clocks or identities in metrics", async () => {
    const test = harness();
    test.setNow(250);
    test.coordinator.openUtterance(open());
    test.coordinator.acceptPartial(partial(1));
    test.setNow(275);
    test.requests[0]!.deferred.resolve("proposal");
    await test.coordinator.waitForIdle();

    expect(test.coordinator.getMetrics()).toMatchObject({
      lastReactionDispatchLatencyMs: 0,
      maximumReactionDispatchLatencyMs: 0,
      lastModelLatencyMs: 25,
      maximumModelLatencyMs: 25,
    });
  });
});
