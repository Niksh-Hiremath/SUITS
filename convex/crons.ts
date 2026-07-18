import { cronJobs, makeFunctionReference } from "convex/server";

const startOrphanStorageSweep = makeFunctionReference<"mutation", Record<string, never>>(
  "caseStorageReconciler:startOrphanStorageSweep",
);

const crons = cronJobs();

crons.daily(
  "reconcile orphaned case upload storage",
  { hourUTC: 3, minuteUTC: 17 },
  startOrphanStorageSweep,
  {},
);

export default crons;
