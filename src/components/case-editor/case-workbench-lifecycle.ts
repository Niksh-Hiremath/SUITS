export type PublicationTarget = Readonly<{
  generation: number;
  uploadId: string;
  caseId: string;
}>;

export type PublicationCurrentCase = Readonly<{
  upload: Readonly<{ uploadId: string }>;
  caseGraph: Readonly<{ caseId: string }>;
}>;

export function publicationTargetIsCurrent<T extends PublicationCurrentCase>(
  target: PublicationTarget,
  currentGeneration: number,
  current: T | null,
): current is T {
  return target.generation === currentGeneration
    && current?.upload.uploadId === target.uploadId
    && current.caseGraph.caseId === target.caseId;
}
