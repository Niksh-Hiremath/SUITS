import { describe, expect, it } from "vitest";

import {
  V3_EVAL_SCENARIOS,
  V3_EVAL_DRIVER_VERSION,
  V3EvalRunResultSchema,
  V3RepeatedEvalGateResultSchema,
  aggregateV3RepeatedEvalGate,
  executeV3EvalScenario,
  runV3EvalScenarioSafely,
  runV3RepeatedEvalGate,
  type V3EvalRunResult,
} from "./v3-repeated-evals";

const invariantNames = [
  "trial_completion",
  "exact_double_replay",
  "jury_considerable_exclusion",
  "debrief_citation_admissibility",
  "knowledge_isolation",
  "event_trace_completeness",
] as const;

function syntheticRun(runIndex: number, passed: boolean): V3EvalRunResult {
  const scenario = V3_EVAL_SCENARIOS[(runIndex - 1) % V3_EVAL_SCENARIOS.length];
  const invariants = invariantNames.map((name, invariantIndex) => ({
    name,
    passed: passed || invariantIndex !== 0,
    summary: "Synthetic aggregator evidence.",
    evidenceJson: JSON.stringify({ runIndex, name }),
  }));
  return V3EvalRunResultSchema.parse({
    schemaVersion: "v3-eval-run-result.v1",
    runIndex,
    seed: runIndex,
    scenarioId: scenario.scenarioId,
    caseId: scenario.caseId,
    driverVersion: V3_EVAL_DRIVER_VERSION,
    status: passed ? "passed" : "failed",
    invariants,
    caughtFailure: null,
  });
}

function syntheticGate(passCount: number) {
  return aggregateV3RepeatedEvalGate(
    Array.from({ length: 10 }, (_, index) =>
      syntheticRun(index + 1, index < passCount),
    ),
  );
}

describe("Milestone 8 V3 repeated evaluation foundation", () => {
  it("describes all three distinct seeded cases with content-pinned contracts", () => {
    expect(V3_EVAL_SCENARIOS).toHaveLength(3);
    expect(new Set(V3_EVAL_SCENARIOS.map((scenario) => scenario.caseId)).size).toBe(3);
    expect(new Set(V3_EVAL_SCENARIOS.map((scenario) => scenario.caseGraphContentHash)).size).toBe(3);
    expect(V3_EVAL_SCENARIOS.every(Object.isFrozen)).toBe(true);
  });

  it.each(V3_EVAL_SCENARIOS)(
    "completes and proves every invariant for $scenarioId",
    (scenario) => {
      const result = executeV3EvalScenario(scenario, 1);

      expect(result.status).toBe("passed");
      expect(result.caughtFailure).toBeNull();
      expect(result.invariants.map((invariant) => invariant.name)).toEqual(
        invariantNames,
      );
      expect(result.invariants.every((invariant) => invariant.passed)).toBe(true);
      expect(
        result.invariants.every(
          (invariant) => Object.keys(JSON.parse(invariant.evidenceJson) as object).length > 0,
        ),
      ).toBe(true);
    },
  );

  it("runs exactly ten real round-robin replays and passes 10/10", () => {
    const gate = runV3RepeatedEvalGate();

    expect(gate).toMatchObject({
      status: "passed",
      requiredRuns: 10,
      passThreshold: 9,
      passCount: 10,
      failureCount: 0,
    });
    expect(gate.runs.map((run) => run.runIndex)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(gate.scenarioIds).toHaveLength(3);
  });

  it("passes the deterministic threshold at exactly 9/10", () => {
    expect(syntheticGate(9)).toMatchObject({
      status: "passed",
      passCount: 9,
      failureCount: 1,
    });
  });

  it("fails the deterministic threshold at 8/10", () => {
    expect(syntheticGate(8)).toMatchObject({
      status: "failed",
      passCount: 8,
      failureCount: 2,
    });
  });

  it("catches scenario exceptions without emitting a stack or fabricated passes", () => {
    const result = runV3EvalScenarioSafely(
      V3_EVAL_SCENARIOS[0],
      1,
      () => {
        throw new TypeError("deliberate fixture failure");
      },
    );

    expect(result.status).toBe("failed");
    expect(result.caughtFailure).toEqual({
      code: "scenario_execution_failed",
      errorName: "TypeError",
      message: "deliberate fixture failure",
    });
    expect(result.invariants.every((invariant) => !invariant.passed)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("at ");
  });

  it("catches a schema-valid executor result bound to a different run", () => {
    const foreign = syntheticRun(2, true);
    const result = runV3EvalScenarioSafely(
      V3_EVAL_SCENARIOS[0],
      1,
      () => foreign,
    );

    expect(result.status).toBe("failed");
    expect(result.caughtFailure?.message).toBe(
      "Scenario executor returned a result outside its requested binding",
    );
    expect(result.invariants.every((invariant) => !invariant.passed)).toBe(true);
  });

  it("rejects unknown result fields and noncanonical invariant order", () => {
    const valid = syntheticRun(1, true);
    expect(() =>
      V3EvalRunResultSchema.parse({ ...valid, unexpected: true }),
    ).toThrow();
    expect(() =>
      V3EvalRunResultSchema.parse({
        ...valid,
        invariants: [...valid.invariants].reverse(),
      }),
    ).toThrow(/canonical deterministic order/);
    expect(() =>
      V3EvalRunResultSchema.parse({ ...valid, seed: 2 }),
    ).toThrow(/deterministic seed must equal the bound run index/);
  });

  it("rejects gates with duplicate run indexes even when counts look valid", () => {
    const gate = syntheticGate(10);
    const duplicateIndexes = gate.runs.map((run, index) =>
      index === 9 ? { ...run, runIndex: 9 } : run,
    );

    expect(() =>
      V3RepeatedEvalGateResultSchema.parse({
        ...gate,
        runs: duplicateIndexes,
      }),
    ).toThrow(/every index from 1 through 10/);
  });
});
