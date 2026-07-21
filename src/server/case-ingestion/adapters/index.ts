import type { DocumentExtractionAdapter } from "../ingestion";
import { PDF_EXTRACTION_ADAPTER } from "./pdf";

export * from "./pdf";
export { MAX_DOCUMENT_EXTRACTION_DURATION_MS } from "./shared";

export const DEFAULT_DOCUMENT_EXTRACTION_ADAPTERS: readonly DocumentExtractionAdapter[] =
  Object.freeze([PDF_EXTRACTION_ADAPTER]);
