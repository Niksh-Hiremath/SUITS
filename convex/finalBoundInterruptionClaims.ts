import { v } from "convex/values";

import { TrialStateV3Schema } from "../src/domain/trial-engine";
import { internalMutation, type MutationCtx } from "./_generated/server";

export const FINAL_BOUND_INTERRUPTION_LEASE_DURATION_MS = 30_000;

function nextLeaseGeneration(current: number): number {
  if (!Number.isSafeInteger(current) || current < 1) return invalidClaim();
  return current === Number.MAX_SAFE_INTEGER ? 1 : current + 1;
}

type TargetPhase = Readonly<{
  phase: "ruling_pending" | "witness_pending" | "complete";
}>;

function staleClaim(): never {
  throw new Error("FINAL_BOUND_INTERRUPTION_CLAIM_STALE");
}

function invalidClaim(): never {
  throw new Error("FINAL_BOUND_INTERRUPTION_CLAIM_INVALID");
}

async function requireTarget(
  ctx: MutationCtx,
  input: Readonly<{
    ownerId: string;
    trialId: string;
    interruptId: string;
  }>,
): Promise<TargetPhase> {
  const projection = await ctx.db
    .query("trialProjections")
    .withIndex("by_trial", (index) => index.eq("trialId", input.trialId))
    .unique();
  if (projection === null || projection.ownerId !== input.ownerId) {
    throw new Error("TRIAL_NOT_FOUND");
  }
  const state = TrialStateV3Schema.parse(JSON.parse(projection.stateJson));
  const active = state.activeInterruption;
  if (active === null || active.interruptId !== input.interruptId) {
    return staleClaim();
  }
  const objection =
    active.objectionId === null
      ? undefined
      : state.objections[active.objectionId];
  if (objection === undefined) return invalidClaim();
  if (objection.status === "pending") {
    if (active.status !== "active") return invalidClaim();
    return { phase: "ruling_pending" };
  }
  const response = state.pendingResponses[active.interruptedResponseId];
  if (response === undefined) return invalidClaim();
  if (
    objection.status === "overruled" &&
    objection.remedy === "resume_response" &&
    active.status === "resumed" &&
    (response.status === "pending" || response.status === "streaming")
  ) {
    return { phase: "witness_pending" };
  }
  if (
    (objection.status === "sustained" && response.status === "cancelled") ||
    (objection.status === "overruled" && response.status === "committed")
  ) {
    return { phase: "complete" };
  }
  return invalidClaim();
}

export const claim = internalMutation({
  args: {
    ownerId: v.string(),
    trialId: v.string(),
    interruptId: v.string(),
    decisionId: v.string(),
    leaseTokenHash: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    if (!Number.isSafeInteger(args.now) || args.now < 0) return invalidClaim();
    const target = await requireTarget(ctx, args);
    if (target.phase === "complete") return { status: "outcome" as const };
    const existing = await ctx.db
      .query("finalBoundInterruptionClaims")
      .withIndex("by_interrupt", (index) =>
        index.eq("interruptId", args.interruptId),
      )
      .unique();
    if (existing !== null) {
      if (
        existing.ownerId !== args.ownerId ||
        existing.trialId !== args.trialId ||
        existing.decisionId !== args.decisionId
      ) {
        return invalidClaim();
      }
      if (
        existing.status === "active" &&
        existing.leaseExpiresAt > args.now
      ) {
        return {
          status: "wait" as const,
          leaseGeneration: existing.leaseGeneration,
          leaseExpiresAt: existing.leaseExpiresAt,
        };
      }
      const leaseGeneration = nextLeaseGeneration(existing.leaseGeneration);
      const leaseExpiresAt =
        args.now + FINAL_BOUND_INTERRUPTION_LEASE_DURATION_MS;
      await ctx.db.patch(existing._id, {
        leaseGeneration,
        leaseTokenHash: args.leaseTokenHash,
        leaseExpiresAt,
        status: "active",
        updatedAt: args.now,
      });
      return {
        status: "claimed" as const,
        leaseGeneration,
        leaseExpiresAt,
      };
    }
    const leaseGeneration = 1;
    const leaseExpiresAt =
      args.now + FINAL_BOUND_INTERRUPTION_LEASE_DURATION_MS;
    await ctx.db.insert("finalBoundInterruptionClaims", {
      claimId: `claim:${args.interruptId}`,
      ownerId: args.ownerId,
      trialId: args.trialId,
      interruptId: args.interruptId,
      decisionId: args.decisionId,
      leaseGeneration,
      leaseTokenHash: args.leaseTokenHash,
      leaseExpiresAt,
      status: "active",
      createdAt: args.now,
      updatedAt: args.now,
    });
    return {
      status: "claimed" as const,
      leaseGeneration,
      leaseExpiresAt,
    };
  },
});

const leaseArgs = {
  ownerId: v.string(),
  trialId: v.string(),
  interruptId: v.string(),
  decisionId: v.string(),
  leaseGeneration: v.number(),
  leaseTokenHash: v.string(),
  now: v.number(),
};

async function requireLease(
  ctx: MutationCtx,
  args: {
    ownerId: string;
    trialId: string;
    interruptId: string;
    decisionId: string;
    leaseGeneration: number;
    leaseTokenHash: string;
    now: number;
  },
) {
  if (
    !Number.isSafeInteger(args.now) ||
    args.now < 0 ||
    !Number.isSafeInteger(args.leaseGeneration) ||
    args.leaseGeneration < 1
  ) {
    return invalidClaim();
  }
  const target = await requireTarget(ctx, args);
  const lease = await ctx.db
    .query("finalBoundInterruptionClaims")
    .withIndex("by_interrupt", (index) =>
      index.eq("interruptId", args.interruptId),
    )
    .unique();
  if (
    lease === null ||
    lease.ownerId !== args.ownerId ||
    lease.trialId !== args.trialId ||
    lease.decisionId !== args.decisionId ||
    lease.leaseGeneration !== args.leaseGeneration ||
    lease.leaseTokenHash !== args.leaseTokenHash ||
    lease.status !== "active" ||
    lease.leaseExpiresAt <= args.now
  ) {
    return staleClaim();
  }
  return { lease, target };
}

/**
 * Recheck a provider-owner credential in the same Convex transaction that
 * appends its generated events. An action-level authorization alone leaves a
 * lease-expiry window before the eventual mutation; this helper closes that
 * window because claim takeover and event append are serialized by Convex.
 */
export async function requireFinalBoundInterruptionLeaseForAppend(
  ctx: MutationCtx,
  args: {
    ownerId: string;
    trialId: string;
    interruptId: string;
    decisionId: string;
    leaseGeneration: number;
    leaseTokenHash: string;
    now: number;
  },
  expectedPhase: "ruling_pending" | "witness_pending",
): Promise<void> {
  const { target } = await requireLease(ctx, args);
  if (target.phase !== expectedPhase) return staleClaim();
}

export const renew = internalMutation({
  args: leaseArgs,
  handler: async (ctx, args) => {
    const current = await requireTarget(ctx, args);
    if (current.phase === "complete") return { status: "outcome" as const };
    const { lease, target } = await requireLease(ctx, args);
    if (target.phase === "complete") return { status: "outcome" as const };
    const leaseExpiresAt =
      args.now + FINAL_BOUND_INTERRUPTION_LEASE_DURATION_MS;
    await ctx.db.patch(lease._id, { leaseExpiresAt, updatedAt: args.now });
    return { status: "renewed" as const, leaseExpiresAt };
  },
});

export const release = internalMutation({
  args: leaseArgs,
  handler: async (ctx, args) => {
    const current = await requireTarget(ctx, args);
    if (current.phase === "complete") return { status: "outcome" as const };
    const { lease, target } = await requireLease(ctx, args);
    if (target.phase === "complete") return { status: "outcome" as const };
    await ctx.db.patch(lease._id, {
      status: "released",
      leaseExpiresAt: args.now,
      updatedAt: args.now,
    });
    return { status: "released" as const };
  },
});

export const authorizeCommit = internalMutation({
  args: leaseArgs,
  handler: async (ctx, args) => {
    const current = await requireTarget(ctx, args);
    if (current.phase === "complete") return { status: "outcome" as const };
    const { target } = await requireLease(ctx, args);
    if (target.phase === "complete") return { status: "outcome" as const };
    if (target.phase !== "ruling_pending") return staleClaim();
    return { status: "authorized" as const };
  },
});

export const authorizeWitnessCommit = internalMutation({
  args: leaseArgs,
  handler: async (ctx, args) => {
    const current = await requireTarget(ctx, args);
    if (current.phase === "complete") return { status: "outcome" as const };
    const { target } = await requireLease(ctx, args);
    if (target.phase === "complete") return { status: "outcome" as const };
    if (target.phase !== "witness_pending") return staleClaim();
    return { status: "authorized" as const };
  },
});
