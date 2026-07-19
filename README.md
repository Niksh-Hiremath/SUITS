# SUITS

SUITS is a voice-first, evidence-grounded AI courtroom simulator for fictional educational cases. Users compile a case packet, review its structured record, conduct a multi-witness hearing against AI courtroom participants, and receive transcript-grounded coaching.

SUITS is an educational simulation. It does not provide legal advice, predict outcomes of real disputes, or impersonate a licensed lawyer.

## Prerequisites

- Node.js and npm compatible with the checked-in application lockfile;
- 64-bit CPython 3.12 and [uv](https://docs.astral.sh/uv/);
- a linked Convex development environment and the ignored local settings required by the application;
- an OpenAI API key for explicit live GPT-5.6 checks;
- for local CUDA speech, a supported NVIDIA driver and at least 6 GB free on the model-cache drive.

Run commands in PowerShell from the repository root.

## Web application setup

```powershell
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Keep API keys and `SUITS_CONVEX_SERVICE_SECRET` server-side; never expose them through `NEXT_PUBLIC_*` variables.

The current hearing page still has an interim typed development surface. The production voice-only browser control, animated courtroom, migrated Court Records, and final verification/demo gates remain in progress and must not be represented as complete.

## Local speech quick start

The local companion keeps raw microphone PCM out of OpenAI and Convex. It provides a strict loopback WebSocket, local energy VAD, revisioned streaming STT, phrase-queued TTS with timing metadata, cancellation/barge-in, playback backpressure, and cached courtroom reactions.

Inspect the target CUDA setup without changing the machine:

```powershell
.\scripts\setup-local-speech.ps1 -Runtime local-cuda -DownloadModels -PlanOnly
```

Install the locked CUDA runtime and explicitly download the pinned Nemotron/Kokoro allowlists:

```powershell
.\scripts\setup-local-speech.ps1 -Runtime local-cuda -DownloadModels
```

Use `-Runtime local-cpu` for the real CPU fallback. For deterministic fake mode with no model weights:

```powershell
Push-Location .\services\speech
uv sync --locked --no-python-downloads --extra dev
$env:SUITS_SPEECH_MODE = 'fake'
uv run --no-sync --no-python-downloads python -m suits_speech.doctor
uv run --no-sync --no-python-downloads suits-speech
```

The default service listens at `127.0.0.1:8765`. `GET /healthz` is liveness only; `GET /v1/capabilities` reports non-loading capability state; model construction and fixed-clip prewarming require the versioned WebSocket `load_models` control.

See [Local speech companion](./docs/LOCAL_SPEECH.md) for the exact pinned commits and licenses, explicit cache/download behavior, CPU/CUDA/fake modes, environment variables, protocol flow, live provider smoke, and troubleshooting. See [Assets and licenses](./docs/ASSETS.md) for the model artifact record.

## Test and verification

Application checks currently available from the repository root:

```powershell
npm run lint
npm run typecheck
npm test
npm run eval
npm run build
```

Speech-service CI/mock gate:

```powershell
Push-Location .\services\speech
uv sync --locked --no-python-downloads --extra dev
uv run --no-sync ruff format --check src tests
uv run --no-sync ruff check src tests
uv run --no-sync mypy --strict src/suits_speech
uv run --no-sync pytest -q
Pop-Location
```

After the real CUDA profile and pinned model artifacts are ready, run the explicit in-memory provider smoke:

```powershell
Push-Location .\services\speech
$env:SUITS_RUN_LIVE_SPEECH_SMOKE = '1'
$env:SUITS_SPEECH_MODE = 'cuda'
$env:SUITS_SPEECH_CACHE_DIR = Join-Path $env:LOCALAPPDATA 'SUITS\speech'
uv run --no-sync --no-python-downloads python -m suits_speech.smoke
Pop-Location
```

That smoke proves a fixed local Kokoro-to-Nemotron loop with PCM kept in memory. It does not prove microphone permission, human speech, browser capture/playback, or a full voice hearing. Skipped live checks must never be reported as passing.
