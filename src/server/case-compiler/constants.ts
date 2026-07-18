export const CASE_COMPILER_MODEL = "gpt-5.6-terra" as const;
export const CASE_COMPILER_PROMPT_VERSION = "case-compiler.prompt.v2" as const;
export const CASE_COMPILER_OUTPUT_SCHEMA_VERSION = "case-compiler.output.v2" as const;
export const CASE_COMPILER_VALIDATION_SCHEMA_VERSION = "case-compiler.validation.v2" as const;
export const CASE_COMPILER_PROVIDER_PROTOCOL_VERSION = "case-compiler.provider.v1" as const;
export const CASE_COMPILER_SCHEMA_NAME = "suits_case_compiler_v2" as const;
export const CASE_COMPILER_PROMPT_CACHE_KEY = "suits.case-compiler.v2" as const;

export const CASE_COMPILER_EDUCATIONAL_DISCLAIMER =
  "Fictional educational simulation only. This case is not legal advice and does not predict a real outcome." as const;

export const MAX_CASE_COMPILER_ATTEMPTS = 3 as const;
export const DEFAULT_CASE_COMPILER_ATTEMPTS = 2 as const;
export const BASE_CASE_COMPILER_RETRY_DELAY_MS = 500 as const;
export const MAX_CASE_COMPILER_RETRY_DELAY_MS = 10_000 as const;
export const MAX_CASE_COMPILER_SOURCE_SEGMENTS = 200 as const;
export const MAX_CASE_COMPILER_SOURCE_CHARACTERS = 500_000 as const;
export const MAX_CASE_COMPILER_REPAIR_CANDIDATE_CHARACTERS = 80_000 as const;
export const MAX_CASE_COMPILER_VALIDATION_ISSUES = 50 as const;

export const CASE_COMPILER_PENDING_REQUEST_ID = "pending-provider-request" as const;
