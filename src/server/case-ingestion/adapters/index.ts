import type { DocumentExtractionAdapter } from "../ingestion";
import { DOCX_EXTRACTION_ADAPTER } from "./docx";
import { PDF_EXTRACTION_ADAPTER } from "./pdf";

export * from "./docx";
export * from "./pdf";

export const DEFAULT_DOCUMENT_EXTRACTION_ADAPTERS: readonly DocumentExtractionAdapter[] =
  Object.freeze([PDF_EXTRACTION_ADAPTER, DOCX_EXTRACTION_ADAPTER]);
