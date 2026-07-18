import { parseCaseGraphV1, type CaseGraphV1 } from "../case-graph/schema";
import {
  type TrialPolicyActorBindingInput,
  type TrialPolicySnapshot,
  type TrialPolicySnapshotV1,
} from "./schema";
import {
  createTrialPolicySnapshotV2,
  createTrialPolicySnapshotV1,
  parseTrialPolicySnapshotV1,
} from "./snapshot";

export const TRIAL_POLICY_MIGRATION_ERROR_CODES = [
  "CASE_GRAPH_HASH_MISMATCH",
  "CASE_GRAPH_CONTENT_MISMATCH",
  "V1_POLICY_CONTEXT_MISMATCH",
] as const;

export type TrialPolicyMigrationErrorCode =
  (typeof TRIAL_POLICY_MIGRATION_ERROR_CODES)[number];

export class TrialPolicyMigrationError extends Error {
  readonly code: TrialPolicyMigrationErrorCode;

  constructor(code: TrialPolicyMigrationErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "TrialPolicyMigrationError";
    this.code = code;
  }
}

export type TrialPolicyV1ToV2MigrationContext = Readonly<{
  /** Trusted, immutable CaseGraph used to rebuild both policy versions. */
  graph: CaseGraphV1;
  /** Explicit bindings pinned by the trial start boundary. */
  actorBindings: readonly TrialPolicyActorBindingInput[];
  /** Hash already pinned by the enclosing trial stream or projection. */
  expectedCaseGraphHash: string;
  /** Exact immutable CaseGraph JSON loaded from the durable case-version row. */
  expectedCaseGraphJson: string;
}>;

function structurallyEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Enriches a canonical v1 policy only after proving it belongs to the trusted
 * graph, actor bindings, and enclosing pinned graph hash. No private v2 facts
 * are inferred from the persisted v1 object itself.
 */
export function migrateTrialPolicySnapshotV1ToV2(
  snapshotInput: unknown,
  context: TrialPolicyV1ToV2MigrationContext,
): TrialPolicySnapshot {
  const snapshot: TrialPolicySnapshotV1 =
    parseTrialPolicySnapshotV1(snapshotInput);
  const graph = parseCaseGraphV1(context.graph);

  if (
    context.expectedCaseGraphHash !== graph.compilerMetadata.sourceContentHash
  ) {
    throw new TrialPolicyMigrationError(
      "CASE_GRAPH_HASH_MISMATCH",
      "The trusted CaseGraph does not match the enclosing pinned hash",
    );
  }
  if (context.expectedCaseGraphJson !== JSON.stringify(graph)) {
    throw new TrialPolicyMigrationError(
      "CASE_GRAPH_CONTENT_MISMATCH",
      "The trusted CaseGraph content does not match the immutable stored case version",
    );
  }

  const canonicalV1 = createTrialPolicySnapshotV1({
    graph,
    actorBindings: context.actorBindings,
  });
  if (!structurallyEqual(snapshot, canonicalV1)) {
    throw new TrialPolicyMigrationError(
      "V1_POLICY_CONTEXT_MISMATCH",
      "The persisted v1 policy is not the canonical policy for the trusted graph and actor bindings",
    );
  }

  return createTrialPolicySnapshotV2({
    graph,
    actorBindings: context.actorBindings,
  });
}
