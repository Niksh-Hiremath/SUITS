# Security and privacy

SUITS is an educational simulator for fictional cases. It is not a secure legal case-management system, does not provide legal advice, and should not receive privileged, regulated, or real-client material. This document describes the implemented controls and the remaining deployment responsibilities; it is not a certification.

## Trust boundaries

SUITS deliberately separates five trust zones:

1. The browser is untrusted. It may request an action, but it cannot select the durable owner, courtroom actor, event payload, evidence status, model identity, or privileged role context.
2. Same-origin Next.js route handlers verify the signed owner session, validate bounded input, derive trusted action metadata, call OpenAI from server-only code, and call Convex through a server-only service credential.
3. Convex is the durable source of truth. Material changes are append-only `TrialEvent` records committed only after deterministic validation and projected by a pure reducer.
4. The local speech companion accepts raw microphone PCM only over its loopback WebSocket. It emits text and local audio; raw audio is not sent to Convex or OpenAI by the canonical path.
5. The renderer receives an allowlisted semantic presentation frame. It never receives arbitrary Three.js commands or executable model output.

The high-level data flow and ownership boundaries are also documented in [Architecture](./ARCHITECTURE.md).

## Anonymous owner identity and request authorization

The current application uses a pseudonymous browser session, not an account system:

- the cookie contains a random UUIDv4 plus an HMAC-SHA256 signature;
- it is `HttpOnly`, `SameSite=Strict`, valid for up to 30 days, and `Secure` in production;
- the server derives `owner:<uuid>` from the verified cookie; owner IDs supplied in query parameters, headers, or request bodies are not authority;
- material routes enforce the externally visible origin. Non-loopback deployments must set an HTTPS `SUITS_PUBLIC_ORIGIN`; otherwise the origin check fails closed;
- `SUITS_TRUSTED_PROXY` is opt-in and must name only a reverse-proxy header that the deployment overwrites;
- cross-owner case, hearing, record, artifact, and audio-audit requests are rejected server-side.

This is suitable for a single-browser hackathon workspace, not multi-user organizational authentication. Clearing the cookie, changing `SUITS_SESSION_SECRET`, or using another browser loses access to the pseudonymous workspace even though its records remain stored.

The browser-facing Next.js service calls Convex HTTP actions with `SUITS_CONVEX_SERVICE_SECRET`. Convex accepts no browser-selected credential as a function argument. The source gate maintains an exact POST-only allowlist for all 34 `/service/*` routes and proves every `httpAction` factory calls `authorizeCaseServiceRequest`. The deployed Convex function-spec gate separately permits only six public functions, all of which require a Convex identity inside their handlers:

- `caseUploads:generateUploadUrl`
- `caseUploads:getDownloadUrl`
- `caseUploads:getLatest`
- `caseUploads:listMine`
- `caseUploads:listSourceSegments`
- `caseUploads:registerStoredUpload`

All active hearing, model, record, and anonymous-upload mutations are internal or service-secret protected. Legacy implementations remain in history but are not part of the canonical browser call graph.

## Upload controls and untrusted packet text

Uploads are private and owner-scoped. The canonical upload path checks:

- accepted types: TXT, Markdown, JSON, text-based PDF, and DOCX;
- maximum uploaded file size: 20 MiB;
- maximum extracted content: 2,000,000 characters and 2,000 blocks;
- maximum source-segment size: 6,000 characters;
- maximum PDF page count: 300;
- maximum extraction time: 30 seconds;
- PDF and DOCX type/signature consistency;
- DOCX ZIP limits of 8 MiB per uncompressed entry and 32 MiB total;
- stored-object size, MIME type, and SHA-256 digest before association;
- bounded publication JSON of 4 MiB with strict schema validation.

Scanned-image OCR is not implemented. A PDF must contain extractable text.

Packet text is never concatenated into the system instruction channel. The compiler wraps it in a delimited untrusted-data section, detects instruction-like patterns, validates strict structured output, validates source IDs and grounding, and requires human review before publication. Detection does not delete suspicious text: it remains evidence data and is recorded as an injection signal. Tests cover instruction override, role impersonation, tool invocation, secret exfiltration, and safety-bypass patterns.

## Model boundary and knowledge isolation

Only server-side code reads `OPENAI_API_KEY`. The normal model paths use the Responses API with `store: false` and exact model roles:

- `gpt-5.6-terra` for case compilation and final coaching;
- `gpt-5.6-luna` for interactive roles, strategy, rulings, negotiation, and jury work.

Case excerpts, final transcript text, and bounded state may be sent to OpenAI when a live model action requires them. Raw microphone audio is not. Anyone operating SUITS must understand that live case text leaves the local machine for the configured OpenAI API; use only fictional or otherwise appropriate content.

Every role call receives a server-built `KnowledgeView`:

- witnesses receive only their allowed facts, perceptions, statements, seen exhibits, emotional state, and current exchange;
- opposing counsel receives permitted side material and private strategy/negotiation state, not another actor's hidden reasoning;
- the judge receives the record and simulation rules, not privileged settlement content unless the scenario permits it;
- the jury receives only admitted, jury-considerable material;
- coaching may inspect the audit record but labels admitted proof, excluded/stricken content, hidden authoring truth, and coaching inference separately.

Strict schemas, citation allowlists, exact head/version fences, cancellation IDs, and deterministic action validation prevent malformed, stale, or unauthorized model output from updating the trial or reaching speech playback.

## Speech and audio privacy

The production audio path is browser microphone -> loopback `suits.speech.v1` WebSocket -> local STT/TTS. The companion defaults to `127.0.0.1:8765`; non-loopback speech endpoints are rejected. Local VAD, revisioned partial/final STT, Kokoro TTS, cached reactions, cancellation, and timing metadata stay in that boundary.

Final transcript text becomes part of the durable courtroom record. A high-confidence partial objection candidate may be sent as text for a bounded ruling decision. Normal partial text and every raw PCM frame remain local.

Court Records audio audits are explicitly noncanonical lifecycle aggregates. Their strict schemas exclude:

- PCM, encoded audio, and raw audio;
- transcript fragments;
- individual timing-mark values;
- provider error text;
- browser-supplied owner authority.

They retain only bounded event bindings, counts, statuses, and client-observed timing aggregates needed to explain playback and interruption behavior. Real-person voice cloning, voice enrollment, and user-trained voices are not implemented; the service uses configured fixed local voices.

## Records, logs, and exports

Court Records is produced in two fail-closed stages. Convex first verifies owner scope, canonical replay/projection equality, generated-artifact bindings, and terminal model traces. A pure projector then emits a bounded, redacted `court-records-view.v2` DTO. The UI and download endpoint use the same validated DTO; downloads do not serialize raw action payloads or hidden model reasoning.

Owner-bound case, hearing, record, and download responses use `Cache-Control: no-store`. User-visible errors are bounded and omit service details. Diagnostic logs should contain error codes, request/event identifiers, counts, latency, and usage rather than secrets, raw packet bodies, raw audio, or unnecessary full transcripts. Model audits retain schema/prompt/model versions, request IDs when available, citations, usage, latency, repair/failure status, and estimated cost.

The exact Records JSON export is available from the owner-bound Court Records workspace. It is an audit/debrief export, not an export of the original uploaded binary.

## Retention and deletion reality

There is currently no self-service case or trial deletion control. Clearing the browser cookie does **not** delete Convex rows or stored uploads and can make them inaccessible to that browser. The internal orphan-upload reconciler is dry-run by default and is maintenance tooling, not user deletion.

For this build:

- case graphs, sources, trial events, model audits, generated artifacts, projected snapshots, final transcripts, and metadata-only audio audits remain in the configured Convex deployment until an authorized operator removes them;
- append-only trial history must not be partially deleted because that would invalidate replay and audit integrity;
- an operator deletion process, if used, must resolve the exact owner/case/trial dependency set, preserve required migration/audit policy, and remove storage objects only after confirming no remaining references;
- no automatic retention expiry or verified backup-erasure workflow is claimed.

Do not deploy this build for sensitive data without adding account authentication, a reviewed retention schedule, a complete owner deletion workflow, backup handling, and operator audit controls.

## Secrets and deployment configuration

Real environment files, private keys, generated media, uploads, and local Convex state are ignored by git. `.env.example` contains names and safe defaults only. Generate different random values of at least 32 characters for `SUITS_SESSION_SECRET` and `SUITS_CONVEX_SERVICE_SECRET`; configure the service secret in both Next.js and the linked Convex deployment.

Only these values are intended for browser exposure:

- `NEXT_PUBLIC_CONVEX_URL`
- `NEXT_PUBLIC_CONVEX_SITE_URL`
- `NEXT_PUBLIC_SUITS_SPEECH_URL`
- the development-only `NEXT_PUBLIC_SUITS_DEV_TYPED_INPUT` flag, which production code ignores.

Never prefix an OpenAI key, session secret, or Convex service secret with `NEXT_PUBLIC_`. Never print secrets during setup or verification. Rotate a secret immediately if it enters a tracked file, client bundle, terminal transcript, screenshot, or shared log.

No production hosting configuration has been verified for this repository. The application does not currently define an application-level Content Security Policy, HSTS, or Permissions Policy. A production operator must terminate TLS, configure those headers, limit microphone permission to the application, secure the reverse-proxy trust boundary, configure backup/retention controls, and exercise a production-origin smoke test before accepting users.

## Verification

Run from the repository root in PowerShell:

```powershell
npm ci
npm run verify
```

The verification gate includes unit/integration authorization and injection tests, the exact Convex function and HTTP source surfaces, a production build, a client-bundle/server-secret boundary scan, the production typed-input gate, speech mock checks, and Playwright browser tests. Live OpenAI and local CUDA checks are explicit opt-ins and must be reported as skipped unless actually executed.

Relevant focused checks include:

```powershell
npm exec -- vitest run src/app/api/cases/ownership-routes.test.ts convex/http.security.test.ts
npm run verify:convex-surface
```

See [Build-week verification](./build-week/VERIFICATION.md) for commands that were actually executed, failures retained for audit, and external checks that remain unverified.
