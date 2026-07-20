# SUITS

SUITS is a voice-first, evidence-grounded AI courtroom simulator for fictional educational cases. A user can select a seeded matter or upload a case packet, review the structured case compiled by GPT-5.6, conduct a multi-witness hearing against AI courtroom participants, and inspect a transcript-grounded coaching record afterward.

SUITS is an educational simulation. It does not provide legal advice, predict outcomes of real disputes, or impersonate a licensed lawyer.

## Current product boundary

The canonical application now includes:

- three provenance-grounded seeded cases plus private TXT, Markdown, JSON, text-based PDF, and DOCX upload;
- a review-and-publish workbench for the compiled `case-graph.v1`;
- an append-only, event-sourced multi-witness hearing with evidence, objections, settlement, jury, and debrief flows;
- server-side GPT-5.6 role reasoning with role-specific knowledge views;
- a local Python STT/TTS companion and a production voice-first courtroom with no visible text composer;
- an animated React Three Fiber courtroom; and
- owner-bound Court Records with a privacy-safe event ledger, transcript, procedure history, model-call observability, metadata-only audio audit, coaching, and stable JSON export.

Automated tests exercise these paths with deterministic model and speech adapters. A real GPT-5.6 trial and an in-memory RTX 5070 Kokoro-to-Nemotron smoke have been recorded separately. A human-microphone browser hearing, physical speaker audibility, production deployment, and self-service case/trial deletion are not verified or implemented as complete product capabilities.

## Prerequisites

- Node.js 24 and npm 11 are the currently verified toolchain;
- 64-bit CPython 3.12 and [uv](https://docs.astral.sh/uv/);
- a Convex account/project for durable cases and trials;
- an OpenAI API key for live case compilation and courtroom intelligence; and
- for the real CUDA speech profile, a supported NVIDIA driver and at least 6 GB free on the selected model-cache drive.

Run commands in PowerShell from the repository root unless a section changes directory explicitly.

## Fresh web setup

Install the locked JavaScript dependencies and create an ignored local environment file:

```powershell
npm ci
if (-not (Test-Path -LiteralPath '.env.local')) {
  Copy-Item -LiteralPath '.env.example' -Destination '.env.local'
}
```

Link the checkout to the intended Convex development project and perform one schema/function sync:

```powershell
npx convex dev --once
```

The Convex CLI writes `CONVEX_DEPLOYMENT` and `NEXT_PUBLIC_CONVEX_URL`. Confirm that `.env.local` also contains the deployment's HTTP Actions origin as `NEXT_PUBLIC_CONVEX_SITE_URL` (the `https://...convex.site` URL).

Generate two independent random secrets containing at least 32 characters. Put both in `.env.local`; configure the Convex service secret to the exact same value on the linked deployment. Piping it keeps the value out of the command-line argument list:

```powershell
function New-SuitsSecret {
  $bytes = New-Object byte[] 32
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($bytes)
  } finally {
    $generator.Dispose()
  }
  ([BitConverter]::ToString($bytes) -replace '-', '').ToLowerInvariant()
}

$sessionSecret = New-SuitsSecret
$convexServiceSecret = New-SuitsSecret
$convexServiceSecret | npx convex env set SUITS_CONVEX_SERVICE_SECRET
```

Paste the generated `$sessionSecret` value after `SUITS_SESSION_SECRET=` and the generated `$convexServiceSecret` value after `SUITS_CONVEX_SERVICE_SECRET=` in `.env.local`; do not commit or print either value. Add `OPENAI_API_KEY` there for live product use. Keep `gpt-5.6-luna` and `gpt-5.6-terra` pinned exactly as shown in `.env.example`.

During development, keep Convex and Next.js running in separate PowerShell windows:

```powershell
npx convex dev
```

```powershell
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | Live product/model checks | Server-only OpenAI credential. Never use a `NEXT_PUBLIC_*` name. |
| `OPENAI_LIVE_MODEL` | Optional explicit pin | Must be `gpt-5.6-luna`; used for interactive courtroom reasoning. |
| `OPENAI_DEEP_MODEL` | Optional explicit pin | Must be `gpt-5.6-terra`; used for case compilation and final coaching. |
| `CONVEX_DEPLOYMENT` | Convex | Linked deployment reference written by the Convex CLI. |
| `NEXT_PUBLIC_CONVEX_URL` | Convex | Public Convex client URL written by the Convex CLI. |
| `NEXT_PUBLIC_CONVEX_SITE_URL` | Convex | HTTPS base URL for secret-protected Convex HTTP Actions. |
| `SUITS_CONVEX_SERVICE_SECRET` | Yes | At least 32 characters; identical on Next.js and the Convex deployment. |
| `SUITS_SESSION_SECRET` | Yes | A different random secret used to sign the pseudonymous owner-session cookie. |
| `SUITS_PUBLIC_ORIGIN` | Non-loopback deployments | Exact canonical HTTPS browser origin. Loopback development may leave it blank. |
| `NEXT_PUBLIC_SUITS_SPEECH_URL` | Voice hearing | Exact loopback speech WebSocket; defaults to `ws://127.0.0.1:8765/v1/speech`. |
| `NEXT_PUBLIC_SUITS_DEV_TYPED_INPUT` | Optional local development | `1` exposes the developer typed control only in a non-production build. Production ignores it. |
| `SUITS_TRUSTED_PROXY` | Optional deployment setting | Trust one explicitly named proxy address header only when that proxy overwrites it. |
| `RUN_OPENAI_LIVE` | Explicit test switch | `1` enables the billable live Terra compiler smoke. |
| `RUN_OPENAI_LIVE_INJECTION` | Explicit test switch | `1` enables the billable live compiler injection test. |
| `RUN_OPENAI_LIVE_COURTROOM` | Explicit test switch | `1` enables the billable live Luna witness test. |

The speech companion has its own environment reference in [Local speech](./docs/LOCAL_SPEECH.md). Preflight's server-model check is also live and billable when the cache is cold; it sends two tiny fixed probes and no case, transcript, or microphone content.

## Local speech quick start

The local companion keeps raw microphone PCM on the direct browser-to-loopback-service path. It provides local energy VAD, revisioned streaming STT, phrase-queued TTS with timing metadata, cancellation/barge-in, backpressure, and cached courtroom reactions.

For deterministic fake mode with no model weights:

```powershell
Push-Location .\services\speech
uv sync --locked --no-python-downloads --extra dev
$env:SUITS_SPEECH_MODE = 'fake'
uv run --no-sync --no-python-downloads python -m suits_speech.doctor
uv run --no-sync --no-python-downloads suits-speech
```

The default service listens at `127.0.0.1:8765`. `GET /healthz` is liveness only; `GET /v1/capabilities` is a non-loading capability snapshot; model construction and fixed-clip prewarming require the versioned WebSocket `load_models` control.

Inspect the real CUDA setup without changing the machine:

```powershell
.\scripts\setup-local-speech.ps1 -Runtime local-cuda -DownloadModels -PlanOnly
```

Install the locked CUDA profile and explicitly download only the pinned model allowlists:

```powershell
.\scripts\setup-local-speech.ps1 -Runtime local-cuda -DownloadModels
```

Use `-Runtime local-cpu` for the real CPU fallback. See [Local speech](./docs/LOCAL_SPEECH.md) for pinned revisions, licenses, protocol, security, setup, live smoke, and troubleshooting.

## User flow

1. Open `/preflight` and run the server checks. Prepare local audio explicitly; the app never requests microphone permission on page load.
2. Open `/cases`. Choose Redwood, Harborlight, or Greenline, or open `/cases/new` to upload one fictional packet.
3. For an upload, inspect warnings, uncertainties, provenance, parties, issues, facts, evidence, witnesses, knowledge boundaries, settlement settings, and jury instructions before publishing.
4. Start the hearing. Use the microphone controls to call and examine witnesses, respond to procedure, negotiate when available, and give a closing. The deterministic engine—not the model or browser—authorizes every committed event.
5. Open the exact trial in `/records` to inspect the bounded privacy-safe record and download the same validated `court-records-view.v2` JSON shown by the workspace.

The owner boundary is a signed, HttpOnly, 30-day pseudonymous browser-session cookie, not a user account. Clearing or losing that cookie can make that session's private cases and trials inaccessible from the browser.

## Architecture

- [Architecture](./docs/ARCHITECTURE.md) explains ownership, event sourcing, model boundaries, local audio, animation, and Court Records projection.
- [Case format](./docs/CASE_FORMAT.md) documents accepted packet formats, extraction limits, `case-graph.v1`, provenance, and review/publication.
- [Assets and licenses](./docs/ASSETS.md) records model, typography, procedural-scene, icon, and visual-test assets.
- [Security and privacy](./docs/SECURITY_AND_PRIVACY.md) records the trust model, retention/export reality, secrets, and deployment responsibilities.
- [Three-minute demo](./docs/DEMO_SCRIPT.md) gives the staged path, evidence boundary, and recovery cards.
- [Build-week delta](./docs/build-week/BUILD_WEEK_DELTA.md) separates the preserved Hermes foundation from the new implementation.
- [Verification ledger](./docs/build-week/VERIFICATION.md) records exact executed checks and honest external skips.
- [Codex sessions](./docs/build-week/CODEX_SESSIONS.md) contains placeholders for real task and `/feedback` IDs; no IDs are fabricated.

## Test and verification

Install Chromium once when browser tests are needed:

```powershell
npm run browser-install
```

The complete deterministic surfaces are runnable from the repository root:

```powershell
npm ci
npm run lint
npm run typecheck
npx tsc --noEmit -p convex/tsconfig.json --pretty false
npm test
npm run eval
npm run verify:convex-surface
npm run build
npm run test:e2e
npm run verify
```

`npm run verify` is the canonical orchestration entry point. It must distinguish deterministic passes from live OpenAI or GPU checks that were skipped; a skip is never a pass. The individual commands remain useful for diagnosis. Opt into the billable OpenAI checks with `npm run verify -- -LiveOpenAI`, the real CUDA smoke with `npm run verify -- -LiveCudaSmoke`, or both switches together only when the required credentials, deployment link, models, and hardware are ready.

Speech-service deterministic gate:

```powershell
Push-Location .\services\speech
uv sync --locked --no-python-downloads --extra dev
uv run --no-sync ruff format --check src tests
uv run --no-sync ruff check src tests
uv run --no-sync mypy --strict src/suits_speech
uv run --no-sync pytest -q
Pop-Location
```

Explicit billable live model checks:

```powershell
$env:RUN_OPENAI_LIVE = '1'
npm run test:live:case-compiler

$env:RUN_OPENAI_LIVE_INJECTION = '1'
npm run test:live:case-compiler-injection

$env:RUN_OPENAI_LIVE_COURTROOM = '1'
npm run test:live:courtroom-witness
```

Explicit local CUDA provider smoke:

```powershell
Push-Location .\services\speech
$env:SUITS_RUN_LIVE_SPEECH_SMOKE = '1'
$env:SUITS_SPEECH_MODE = 'cuda'
$env:SUITS_SPEECH_CACHE_DIR = Join-Path $env:LOCALAPPDATA 'SUITS\speech'
uv run --no-sync --no-python-downloads python -m suits_speech.smoke
Pop-Location
```

That smoke keeps a fixed Kokoro-to-Nemotron PCM loop in memory. It does not prove microphone permission, human-speech accuracy, browser capture/playback, speaker audibility, or a complete real-audio hearing.

## Limitations and data handling

- Uploaded packets currently accept one file per compilation and do not OCR image-only/scanned pages.
- Raw microphone PCM is not sent to OpenAI or Convex by the canonical path. Convex stores only bounded, noncanonical audio lifecycle metadata after validating it against the owner-bound trial.
- OpenAI receives extracted packet text for compilation and compact role-specific case/record context during a hearing; Responses calls use `store: false`.
- Court Records exports exist. Self-service deletion for uploaded cases and trial records does not; operators must manage retention in their configured Convex deployment.
- The real CUDA provider smoke used synthetic in-memory audio. The automated browser suite uses fake media, deterministic fake speech/model adapters, and muted playback.
- No production deployment has been verified by the recorded local gates.

Use only fictional or deliberately anonymized educational material. Do not upload privileged, regulated, or real-client data to a development deployment.
