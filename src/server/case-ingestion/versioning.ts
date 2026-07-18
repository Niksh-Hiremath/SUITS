import {
  CaseUploadStatusSchema,
  type CaseUploadStatus,
} from "./schema";

const ALLOWED_TRANSITIONS = {
  uploaded: ["indexed", "rejected"],
  indexed: [],
  rejected: [],
} as const satisfies Record<CaseUploadStatus, readonly CaseUploadStatus[]>;

export type UploadVersionTransition = {
  version: number;
  status: CaseUploadStatus;
};

export function nextUploadVersion(
  current: UploadVersionTransition | undefined,
  requestedStatus: CaseUploadStatus,
): UploadVersionTransition {
  const status = CaseUploadStatusSchema.parse(requestedStatus);
  if (!current) {
    if (status !== "uploaded") {
      throw new Error("UPLOAD_INITIAL_STATUS_INVALID");
    }
    return { version: 1, status };
  }

  if (!Number.isSafeInteger(current.version) || current.version < 1) {
    throw new Error("UPLOAD_VERSION_INVALID");
  }
  const allowed: readonly CaseUploadStatus[] = ALLOWED_TRANSITIONS[current.status];
  if (!allowed.includes(status)) {
    throw new Error("UPLOAD_STATUS_TRANSITION_INVALID");
  }
  return { version: current.version + 1, status };
}
