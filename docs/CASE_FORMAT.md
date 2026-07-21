# SUITS case packet and CaseGraph format

SUITS accepts a fictional case packet as untrusted source material, extracts bounded text with provenance, and asks `gpt-5.6-terra` to propose a strict `case-graph.v1`. The uploaded file is not itself an instruction, executable format, or automatically trusted statement of fact.

This document distinguishes the **packet format** a user uploads from the **CaseGraph contract** the application validates, reviews, publishes, and uses during a hearing.

## Accepted packet formats

The `/cases/new` workbench accepts one file per compilation request:

| Extension | Accepted MIME | Extraction behavior |
| --- | --- | --- |
| `.txt` | `text/plain` | UTF-8 text |
| `.md`, `.markdown` | `text/markdown` or `text/x-markdown` | UTF-8 text |
| `.json` | `application/json` | Parsed only to normalize its textual JSON representation for compilation |
| `.pdf` | `application/pdf` | Text extracted page by page with the serverless `unpdf` PDF.js build |

JSON upload is **not** a direct CaseGraph import. It is still untrusted source text and must pass the same Terra compilation, grounding, deterministic validation, review, and publication path.

Image files are not accepted. PDF extraction does not run OCR, so an image-only or scanned PDF without extractable text is not a supported packet. Combine multiple source documents into one accepted file before upload.

## Ingestion and compiler limits

| Limit | Current value | Source |
| --- | ---: | --- |
| Uploaded file | 20 MiB | [`src/server/case-ingestion/schema.ts`](../src/server/case-ingestion/schema.ts) |
| Multipart overhead accepted by the route | 1 MiB beyond the file limit | [`src/app/api/cases/compile/route.ts`](../src/app/api/cases/compile/route.ts) |
| Extracted characters | 2,000,000 | [`src/server/case-ingestion/schema.ts`](../src/server/case-ingestion/schema.ts) |
| Extracted blocks | 2,000 | [`src/server/case-ingestion/schema.ts`](../src/server/case-ingestion/schema.ts) |
| One source-segment text slice | 6,000 characters | [`src/server/case-ingestion/schema.ts`](../src/server/case-ingestion/schema.ts) |
| PDF pages | 300 | [`src/server/case-ingestion/adapters/pdf.ts`](../src/server/case-ingestion/adapters/pdf.ts) |
| Extraction deadline | 30 seconds | [`src/server/case-ingestion/adapters/shared.ts`](../src/server/case-ingestion/adapters/shared.ts) |
| Source segments sent to one compiler call | 200 | [`src/server/case-compiler/constants.ts`](../src/server/case-compiler/constants.ts) |
| Source characters sent to one compiler call | 500,000 | [`src/server/case-compiler/constants.ts`](../src/server/case-compiler/constants.ts) |

Extraction capacity is intentionally larger than one compiler request boundary. A packet that extracts successfully can still be rejected as too large for safe compilation rather than being silently truncated.

DOCX is not an accepted packet format. The former Mammoth extractor used `node:worker_threads`, which is not functional in the planned Cloudflare Workers runtime, so the parser and its ZIP-processing dependency were removed rather than retaining a deployment-only failure path. Durable metadata for a DOCX uploaded by an earlier build remains schema-readable, but new registrations, MIME normalization, the upload UI, and extraction all reject DOCX.

The route derives the accepted type from the filename, declared MIME, and leading file bytes where applicable. Filenames are bounded and cannot contain paths or control characters. The server hashes the bytes and binds retry-safe upload/case IDs to the owner, request ID, and digest.

## Source segments and provenance

Extraction produces immutable source segments. Each segment contains:

- a stable `sourceSegmentId` and source/document identity;
- the normalized MIME type;
- either a one-based page locator or exact text offsets;
- a bounded excerpt; and
- a lowercase SHA-256 digest.

Every provenance-owning CaseGraph record carries at least one `Provenance` entry:

- `source`: directly supported by one or more source segments;
- `inferred`: a bounded inference with confidence below certainty; or
- `authoring`: deliberate simulation configuration, primarily used by seeded/manual cases.

Terra also returns a compact owner-bound grounding review. The server expands it over the exact scalar fields, checks that cited segments belong to the claimed record, and records warnings and unresolved uncertainties. A generated assertion does not become a verified courtroom fact merely because it appears in the compiled graph.

## `case-graph.v1`

The authoritative schema is [`src/domain/case-graph/schema.ts`](../src/domain/case-graph/schema.ts). Do not maintain a second hand-written JSON schema in documentation.

At the top level, a graph contains:

```text
schemaVersion: "case-graph.v1"
version: 1
caseId, title, summary, status, educationalDisclaimer
jurisdictionProfile
parties[]
issues[]
timeline[]
facts[]
evidence[]
witnesses[]
contradictions[]
settlement
juryInstructions[]
sourceSegments[]
compilerMetadata
```

The object is strict: unknown keys and dangling/duplicate references fail validation.

### Identity and references

Entity IDs are 3–128 characters, begin with an ASCII letter or number, and may then contain letters, numbers, `.`, `_`, `:`, or `-`. IDs are stable references, not display labels. Cross-references must point to entities in the same graph and obey type-specific ownership rules.

### Parties, issues, and timeline

- At least two parties identify procedural role and simulation side.
- At least one issue identifies the disputed question, burden party, standard, related facts, and related evidence.
- Timeline entries carry an offset-aware timestamp and cite their facts, evidence, witnesses, and provenance.

### Facts and evidence

A compiled fact separates three concerns:

- classification: `authoring_truth`, `party_allegation`, or `inference`;
- initial status: `hidden`, `proposed`, or `verified`; and
- visibility: `public` or `restricted`.

A hidden fact must be restricted. An inference cannot begin verified. During a hearing, the event engine—not the CaseGraph or model—advances facts through the fuller proposed/disputed/verified/admitted/excluded/stricken lifecycle.

Evidence records describe the item, kind, initial `uploaded`/`indexed` status, authored admissibility expectation, offering parties, related facts/issues, custodians/authenticators, and provenance. `likely_admissible` is simulation authoring guidance, not a courtroom ruling. Only a valid offer/ruling event can admit an exhibit.

### Witness knowledge boundaries

Each witness records:

- the parties permitted to call the witness;
- known and personally perceived fact IDs;
- seen evidence and available prior statements;
- explicitly unknown facts;
- allowed and forbidden topics; and
- an emotional baseline used only as bounded performance context.

A perceived fact must also be known, and the same fact cannot be both known and unknown. At runtime the server intersects this authored boundary with the current admissible/public record and presented exhibits to construct the witness-specific `KnowledgeView`.

### Contradictions, settlement, and jury instructions

Contradictions bind two typed endpoints—fact, evidence, prior statement, or timeline entry—to the affected witnesses/issues and source provenance.

Settlement configuration contains private party authority, reservation/target values, priorities, permitted nonmonetary terms, opening phase, expiry, and counteroffer policy. It is server-side case material and is not exposed to unrelated roles or the jury.

Jury instructions identify the fictional standard and the fact/evidence references relevant to the issue. The runtime jury view still receives only admitted, jury-considerable material.

### Compiler metadata

`compilerMetadata` records the method (`gpt`, `seeded`, or `manual`), exact model when applicable, provider request ID, prompt version, compilation timestamp, source-content hash, segment count, warnings, and uncertainties. A GPT graph must name `gpt-5.6-terra`; seeded/manual graphs cannot pretend to have a provider request.

## Compile, review, and publish lifecycle

1. **Establish session.** The same-origin route creates or verifies the signed pseudonymous owner cookie.
2. **Upload and extract.** The server validates and hashes the file, obtains a bounded Convex storage URL, stores the private bytes, and extracts source blocks/segments.
3. **Compile.** Terra receives the delimited untrusted segments and strict output schema with `store: false`.
4. **Validate or repair once.** The server rejects unsafe structure, references, provenance, source coverage, or semantics; one targeted model repair is allowed when appropriate.
5. **Register draft.** Convex atomically binds the generation, upload, graph, validation report, and audit to the owner. Retry with the same identity replays rather than duplicating billable work.
6. **Review.** The workbench shows the graph, grounding, warnings, and uncertainties and lets the user correct supported fields.
7. **Publish.** The full strict graph is revalidated, a bounded human-review audit is recorded, and an owner-bound immutable published graph becomes eligible for a hearing.

A failed upload/compile path can clean up an unreferenced storage object. The dry-run-first orphan reconciler is operational maintenance, not user-facing case deletion.

## Seeded fictional cases

The repository ships three complete `case-graph.v1` scenarios:

| Slug | Title | Category |
| --- | --- | --- |
| `redwood-signal-retaliation` | Rina Shah v. Redwood Signal Systems | Workplace retaliation |
| `harborlight-rig-negligence` | Elena Park v. Harborlight Community Theater | Premises and equipment negligence |
| `greenline-cold-chain` | Greenline Grocers v. Nimbus Cold Chain | Commercial contract |

The catalog is defined in [`src/domain/seeded-cases/catalog.ts`](../src/domain/seeded-cases/catalog.ts). Redwood's complete three-witness graph in [`src/domain/case-graph/fixture.ts`](../src/domain/case-graph/fixture.ts) is the most compact implementation example.

## Content and privacy guidance

- Use fictional or deliberately anonymized educational packets only.
- Do not include legal instructions to the model; packet text is always treated as untrusted evidence-like content.
- Do not upload privileged, regulated, or real-client data to a development deployment.
- Publishing makes the case available only to the same signed owner session; it does not make the graph a public legal authority.
- Court Records can export the privacy-safe trial projection. SUITS does not currently provide self-service deletion for the uploaded case or its trial records.
