# Local speech companion

SUITS uses a local FastAPI companion for speech-to-text (STT), voice activity detection (VAD), and text-to-speech (TTS). The service accepts microphone PCM from the browser over a loopback WebSocket and returns transcripts, synthesized PCM, and timing metadata. It has no Convex or OpenAI integration, so raw microphone audio stays inside the browser-to-local-service boundary.

The current companion and real Nemotron/Kokoro adapters are implemented and covered by deterministic tests. A synthetic in-memory CUDA provider smoke has passed on the target RTX 5070. Browser transport and AudioWorklet modules are being integrated in parallel, but production hearing-page integration and a real browser microphone/audible-playback run have not been verified. The provider smoke is therefore not proof of live microphone capture, audible browser playback, or a full voice-first hearing.

## Runtime choices

| Mode | Install profile | Providers | Intended use | What it proves |
| --- | --- | --- | --- | --- |
| `cuda` | `local-cuda` | Nemotron STT and Kokoro TTS on CUDA | Target Windows/NVIDIA runtime | Real local provider behavior when the live smoke or a browser flow is run |
| `cpu` | `local-cpu` | Nemotron STT and Kokoro TTS on CPU | Functional local fallback | Local provider behavior only; it does not verify GPU performance |
| `fake` | `dev` only | Deterministic fake STT/TTS plus real protocol/VAD/queues | CI and development | Protocol, lifecycle, cancellation, and backpressure behavior; it does not verify speech quality or hardware |

`local-cpu` and `local-cuda` are mutually exclusive uv extras. Both are resolved in `services/speech/uv.lock`; select one at a time. The CUDA profile obtains PyTorch 2.11 from the official CUDA 13.0 wheel index, while the CPU profile uses the official CPU index.

Prerequisites on Windows:

- 64-bit CPython 3.12 and `uv` available in PowerShell;
- for `cuda`, a working NVIDIA driver such that `nvidia-smi` succeeds;
- at least 6 GB free on the selected model-cache drive during setup;
- an HTTP browser origin matching the service allowlist when a browser client is used.

## Windows PowerShell setup

Run all commands from the repository root unless a command changes location explicitly.

### Inspect the plan without changing anything

The plan includes the locked dependency command, exact model allowlists, immutable revisions, cache directory, and doctor command. `-PlanOnly` does not sync packages, create the cache, download models, or run the doctor.

```powershell
.\scripts\setup-local-speech.ps1 -Runtime local-cuda -DownloadModels -PlanOnly
```

Use `-Runtime local-cpu` to inspect the CPU plan.

### Install the target CUDA runtime

Model downloads are opt-in. This command syncs the checked-in lock, downloads only the allowlisted files at the pinned commits, and runs the read-only doctor:

```powershell
.\scripts\setup-local-speech.ps1 -Runtime local-cuda -DownloadModels
```

Omitting `-DownloadModels` syncs dependencies and diagnoses the existing cache without requesting either model snapshot:

```powershell
.\scripts\setup-local-speech.ps1 -Runtime local-cuda
```

### Install the CPU runtime

```powershell
.\scripts\setup-local-speech.ps1 -Runtime local-cpu -DownloadModels
```

CPU mode uses the same model snapshots and protocol. It can be substantially slower and is not a substitute for the CUDA performance gate.

### Use a different cache drive

The default Windows cache is `%LOCALAPPDATA%\SUITS\speech`. A custom cache must be an absolute, non-root path. Set the same cache when starting or diagnosing the service:

```powershell
$speechCache = 'D:\SUITS\speech-cache'
.\scripts\setup-local-speech.ps1 `
  -Runtime local-cuda `
  -DownloadModels `
  -CacheDir $speechCache

$env:SUITS_SPEECH_CACHE_DIR = $speechCache
```

Normal service startup never downloads weights. There is no `auto-download` environment switch; the runtime loads only complete, pinned snapshots already in the configured cache.

### Set up fake mode for tests

Fake mode does not need PyTorch, Kokoro, Transformers, CUDA, eSpeak NG, or model files:

```powershell
Push-Location .\services\speech
uv sync --locked --no-python-downloads --extra dev
$env:SUITS_SPEECH_MODE = 'fake'
uv run --no-sync --no-python-downloads python -m suits_speech.doctor
Pop-Location
```

## Pinned local artifacts

The setup script downloads these files with `hf download --revision <commit> --cache-dir <path>`. No broad repository snapshot or mutable branch is accepted.

### NVIDIA Nemotron streaming English STT

- Repository: [`nvidia/nemotron-speech-streaming-en-0.6b`](https://huggingface.co/nvidia/nemotron-speech-streaming-en-0.6b)
- Commit: [`df1f0fe9dfdf05152936192b4c8c7653d53bf557`](https://huggingface.co/nvidia/nemotron-speech-streaming-en-0.6b/tree/df1f0fe9dfdf05152936192b4c8c7653d53bf557)
- License: [NVIDIA Open Model License](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/)
- Allowlist: `config.json`, `generation_config.json`, `model.safetensors`, `processor_config.json`, `tokenizer.json`, and `tokenizer_config.json`
- Approximate allowlisted download: 2.5 GB

The adapter uses the model's native Transformers streaming interface; it does not fall back to repeatedly transcribing a growing whole-audio buffer. It requires 16 kHz mono signed 16-bit little-endian PCM, one active recognizer session, and Transformers `>=5.13,<5.14`. It sets `local_files_only=True`, `trust_remote_code=False`, the exact revision, and the explicit local snapshot path.

`SUITS_STT_LOOKAHEAD_TOKENS` accepts the four values published for this checkpoint:

| Tokens | Model streaming latency |
| ---: | ---: |
| `0` | 80 ms |
| `1` (default) | 160 ms |
| `6` | 560 ms |
| `13` | 1,120 ms |

The latency values are the model's configured streaming windows, not measured SUITS end-to-end latency.

### Kokoro TTS

- Repository: [`hexgrad/Kokoro-82M`](https://huggingface.co/hexgrad/Kokoro-82M)
- Commit: [`f3ff3571791e39611d31c381e3a41a3af07b4987`](https://huggingface.co/hexgrad/Kokoro-82M/tree/f3ff3571791e39611d31c381e3a41a3af07b4987)
- License: [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)
- Allowlist: `config.json`, `kokoro-v1_0.pth`, `voices/am_michael.pt`, `voices/bm_george.pt`, and `voices/af_heart.pt`
- Approximate allowlisted download: 329 MB

The configured roles are `judge=am_michael`, `opposing_counsel=bm_george`, and `witness=af_heart`. The adapter loads the config, weights, and allowlisted voice tensors by explicit local paths and emits 24 kHz mono PCM with phrase and word timing metadata. It does not use Kokoro's missing-file Hub download path.

Both real profiles also install:

- `en_core_web_sm==3.8.0`, so Kokoro/Misaki English processing is available offline instead of attempting a language-model download during provider load;
- `librosa>=0.11,<0.12`, required by the Transformers Nemotron audio path;
- `kokoro==0.9.4`, `torch==2.11.0`, and `transformers>=5.13,<5.14`;
- their locked transitive dependencies, including Hugging Face Hub, safetensors, NumPy, Misaki, and an eSpeak NG runtime.

Do not install `en_core_web_sm` or `librosa` ad hoc with `pip`; rerun the matching locked setup profile so the environment remains reproducible.

## Diagnose readiness

The setup script runs the doctor automatically. To rerun it in the selected environment:

```powershell
Push-Location .\services\speech
$env:SUITS_SPEECH_MODE = 'cuda'
$env:SUITS_SPEECH_CACHE_DIR = Join-Path $env:LOCALAPPDATA 'SUITS\speech'
uv run --no-sync --no-python-downloads python -m suits_speech.doctor
Pop-Location
```

Use `cpu` or `fake` for `SUITS_SPEECH_MODE` when that is the environment being diagnosed. The doctor emits privacy-safe `speech-doctor.v1` JSON and is read-only: it does not import optional model providers, contact the Hub, create directories, or download artifacts.

Exit codes:

- `0`: ready;
- `1`: usable checks completed with a warning/attention item;
- `2`: blocked by invalid configuration, a missing dependency/artifact, or required CUDA visibility.

It checks CPython 3.12, platform/architecture, CUDA visibility for CUDA mode, known provider IDs, optional dependency discoverability, eSpeak NG availability, the cache directory, exact model IDs/revisions, every allowlisted file, and every configured Kokoro voice tensor. It does not load models or prove transcription/synthesis quality.

## Start the service

After setup, start from the speech project so uv uses its environment:

```powershell
Push-Location .\services\speech
$env:SUITS_SPEECH_MODE = 'cuda'
$env:SUITS_SPEECH_CACHE_DIR = Join-Path $env:LOCALAPPDATA 'SUITS\speech'
uv run --no-sync --no-python-downloads suits-speech
```

For fake mode, use `$env:SUITS_SPEECH_MODE = 'fake'`. For CPU mode, use `cpu` and ensure the `local-cpu` profile is the one currently synced.

The default endpoints are:

- `GET http://127.0.0.1:8765/healthz` — process liveness only;
- `GET http://127.0.0.1:8765/v1/capabilities` — non-loading provider, CUDA, cached-clip, and queue capability snapshot;
- `WS ws://127.0.0.1:8765/v1/speech` — speech control and binary PCM transport using subprotocol `suits.speech.v1`.

Inspect the HTTP endpoints from another PowerShell window:

```powershell
Invoke-RestMethod http://127.0.0.1:8765/healthz
Invoke-RestMethod http://127.0.0.1:8765/v1/capabilities |
  ConvertTo-Json -Depth 8
```

`healthz` does not mean models are ready. Model construction and fixed-clip prewarming happen only after an accepted WebSocket client sends `load_models`. The resulting `capabilities` event reports each provider's configured/loaded/ready state, device, exact model ID and commit, streaming/timing support, measured load latency, CUDA facts, and the all-or-nothing cached clip IDs.

## Loopback and origin security

- `SUITS_SPEECH_HOST` accepts only `localhost` or a loopback IP address. A non-loopback bind fails configuration validation.
- Real CPU/CUDA WebSocket sessions also reject non-loopback peers.
- Every WebSocket session, including fake mode, requires an exact origin from `SUITS_SPEECH_ALLOWED_ORIGINS`. Wildcards, `null`, credentials, paths, queries, and fragments are rejected.
- The client must request the exact `suits.speech.v1` WebSocket subprotocol.
- `hello` must be the first control message and arrive within the configured deadline.
- Control messages are strict camelCase JSON objects. Unknown keys, snake_case keys, oversized messages, invalid nesting, and the wrong protocol discriminator are rejected.
- Raw audio is never accepted as JSON or base64. Each `audio_chunk` metadata message must be followed immediately by its exact binary frame.

The defaults allow `http://localhost:3000` and `http://127.0.0.1:3000`. If the Next.js development port changes, set an exact comma-separated allowlist before starting the speech service:

```powershell
$env:SUITS_SPEECH_ALLOWED_ORIGINS = 'http://localhost:3100,http://127.0.0.1:3100'
```

## Versioned WebSocket flow

Every JSON control or event includes `"protocol": "suits.speech.v1"`. The public schema is defined in `services/speech/src/suits_speech/protocol.py`.

### Handshake and load

1. Connect to `/v1/speech` while requesting subprotocol `suits.speech.v1` and using an allowed `Origin`.
2. Send `hello` first with stable `requestId` and `clientId`.
3. Receive `ready`, the initial non-loading `capabilities`, and `flow_control`.
4. Send `load_models` with a stable `requestId` and the configured provider IDs if supplied.
5. Receive a request-bound `capabilities` event after both providers load and all three fixed clips prewarm atomically. A failure emits `MODEL_LOAD_FAILED` and publishes no partial fixed-clip cache.

### STT

1. Send `start_utterance` with a new `utteranceId`, 16,000 Hz, one channel, `pcm_s16le`, and the desired VAD silence window.
2. For each available input credit, send one contiguous `audio_chunk` metadata control, immediately followed by the declared binary PCM frame.
3. Observe `speech_started`, zero or more `stt_partial` events, and updated `flow_control` credits.
4. Send `end_utterance`, or allow local energy VAD to end the utterance after the configured silence.
5. Receive exactly one later `stt_final` revision and `speech_ended` for a successful utterance.

Partial and final events carry the same `utteranceId`; revisions increase monotonically, duplicate partial text is suppressed, and stale/cancelled utterance output is fenced. `cancel_utterance` cancels local provider work and emits `cancelled`. Only one utterance may be active per connection, and the default Nemotron runtime admits one process-wide recognizer session.

Starting an utterance with `bargeIn: true` cancels all queued/current synthesis before admitting microphone audio.

### TTS

1. Send `synthesize` with stable `jobId`, `responseId`, actor, contiguous phrase `sequence`, and exactly one of `text` or `clipId`.
2. Receive `tts_started` and `tts_timing`.
3. For each `tts_audio` metadata event, consume the immediately following binary PCM frame.
4. Send `ack_tts_audio` with the exact job/response/frame identities, token, and byte length. This returns playback credit.
5. Receive `tts_finished` only after all audio frames for the phrase are acknowledged.

The Kokoro adapter produces a complete bounded phrase locally; the service then streams it in 40 ms binary frames by default. The phrase queue is bounded and ordered by response/job/sequence. A missing ACK eventually cancels the response with `TTS_ACK_TIMEOUT` rather than allowing unbounded memory growth.

`cancel_synthesis` supports `job`, `response`, and `all` scopes. Cancellation purges unsent frames, releases ACK reservations, fences stale transport batches, and emits `cancelled`. If physical TTS termination cannot be confirmed, the process-wide TTS lane is quarantined and reports `TTS_RESTART_REQUIRED`; restart the service before further synthesis.

### Fixed reaction clips

An explicit successful model load prewarms these immutable, in-memory clips:

| Clip ID | Text | Voice role |
| --- | --- | --- |
| `courtroom.objection.v1` | Objection! | `opposing_counsel` |
| `courtroom.sustained.v1` | Sustained. | `judge` |
| `courtroom.overruled.v1` | Overruled. | `judge` |

The cache is all-or-nothing, is not persisted, and does not expose PCM or text through diagnostics. Sending `synthesize` with a ready `clipId` replays cached PCM without another Kokoro call. The service has this reaction path, but automatic partial-transcript objection detection and browser animation/orchestration belong to the later interruption milestone and are not claimed here.

## Configuration reference

All values are process environment variables. Settings are validated before the server binds.

| Variable | Default | Purpose and constraints |
| --- | --- | --- |
| `SUITS_SPEECH_MODE` | `cuda` | `fake`, `cpu`, or `cuda`; also selects fake defaults versus real providers |
| `SUITS_SPEECH_HOST` | `127.0.0.1` | `localhost` or a loopback IP only |
| `SUITS_SPEECH_PORT` | `8765` | TCP port, 1–65,535 |
| `SUITS_SPEECH_ALLOWED_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | Comma-separated exact HTTP(S) origins; no wildcard or `null` |
| `SUITS_SPEECH_CACHE_DIR` | `%LOCALAPPDATA%\SUITS\speech` | Absolute local model-cache path on Windows |
| `SUITS_STT_PROVIDER` | real: `nemotron-transformers`; fake: `fake-stt` | Supported local STT provider identifier |
| `SUITS_STT_MODEL_ID` | `nvidia/nemotron-speech-streaming-en-0.6b` | Safe owner/name ID for the configured immutable snapshot |
| `SUITS_STT_MODEL_REVISION` | `df1f0fe9dfdf05152936192b4c8c7653d53bf557` | Exact 40-character commit |
| `SUITS_STT_LOOKAHEAD_TOKENS` | `1` | Nemotron: one of `0`, `1`, `6`, or `13` |
| `SUITS_STT_SAMPLE_RATE_HZ` | `16000` | Real and fake canonical STT require 16 kHz mono PCM |
| `SUITS_STT_MAX_SESSIONS` | `1` | Process recognizer slots; Nemotron requires exactly one |
| `SUITS_STT_INPUT_MAX_FRAMES` | `8` | Per-connection pending microphone-frame credits, 1–128 |
| `SUITS_STT_INPUT_MAX_BYTES` | `524288` | Per-connection pending microphone-byte credits |
| `SUITS_STT_IDLE_TIMEOUT_MS` | `10000` | Cancels an idle active utterance |
| `SUITS_STT_MAX_UTTERANCE_MS` | `120000` | Maximum accepted audio duration for one utterance |
| `SUITS_TTS_PROVIDER` | real: `kokoro`; fake: `fake-tts` | Supported local TTS provider identifier |
| `SUITS_TTS_MODEL_ID` | `hexgrad/Kokoro-82M` | Safe owner/name ID for the configured immutable snapshot |
| `SUITS_TTS_MODEL_REVISION` | `f3ff3571791e39611d31c381e3a41a3af07b4987` | Exact 40-character commit |
| `SUITS_TTS_VOICES` | `judge=am_michael,opposing_counsel=bm_george,witness=af_heart` | Unique, allowlisted `actor=voice` mappings; judge and opposing counsel are mandatory for fixed clips |
| `SUITS_TTS_MAX_QUEUE_DEPTH` | `8` | Per-connection bounded phrase queue, 1–256 |
| `SUITS_TTS_ACK_WINDOW_BYTES` | `5760` | Maximum unacknowledged outbound TTS PCM bytes |
| `SUITS_TTS_AUDIO_FRAME_MS` | `40` | Outbound TTS frame size, 20–200 ms |
| `SUITS_TTS_MAX_PHRASE_DURATION_MS` | `15000` | Maximum provider phrase audio duration, 1–30 seconds |
| `SUITS_SPEECH_MAX_CONNECTIONS` | `4` | Process-wide admitted WebSocket connections, 1–32 |
| `SUITS_SPEECH_HELLO_TIMEOUT_MS` | `5000` | Deadline for the first `hello`, 0.5–30 seconds |

## Verification

### Deterministic CI gate

This gate does not download models or claim CUDA/microphone performance:

```powershell
Push-Location .\services\speech
uv sync --locked --no-python-downloads --extra dev
uv run --no-sync ruff format --check src tests
uv run --no-sync ruff check src tests
uv run --no-sync mypy --strict src/suits_speech
uv run --no-sync pytest -q
Pop-Location
```

Tests cover strict protocol parsing, loopback/origin/subprotocol enforcement, VAD, revisioned partial/final transcripts, exact binary-frame ownership, connection/STT capacity, phrase ordering, ACK backpressure, cancellation and stale-result races, provider-load coalescing, physical-worker termination, fixed-clip atomicity, cache-only provider construction, doctor output, and the opt-in live-smoke boundary. Nemotron and Kokoro unit tests use injected backends; they do not by themselves prove the real weights or GPU.

### Explicit live provider smoke

This command requires the real profile and pinned artifacts to be installed. It refuses to run unless `SUITS_RUN_LIVE_SPEECH_SMOKE` is exactly `1`; without opt-in it emits `skipped` JSON and exits `2`.

```powershell
Push-Location .\services\speech
$env:SUITS_RUN_LIVE_SPEECH_SMOKE = '1'
$env:SUITS_SPEECH_MODE = 'cuda'
$env:SUITS_SPEECH_CACHE_DIR = Join-Path $env:LOCALAPPDATA 'SUITS\speech'
uv run --no-sync --no-python-downloads python -m suits_speech.smoke
Pop-Location
```

The smoke synthesizes the fixed educational phrase “May it please the court.” with local Kokoro, keeps PCM in memory, resamples 24 kHz to 16 kHz, feeds exact 20 ms frames to the configured streaming STT at microphone cadence, requires at least one partial, and requires an exact normalized Nemotron final. It imports no Convex or OpenAI integration and prints content-free JSON evidence.

The recorded RTX 5070 CUDA run on 2026-07-19 passed with 109 × 20 ms chunks, four partials, first partial at 1,112 ms, finalization in 54 ms, an exact normalized final, and 12,001 ms total including model load and fixed-clip prewarm. These are one-run observations, not percentile claims. The smoke uses synthetic TTS audio—not a microphone, browser capture, speaker output, or a courtroom hearing.

## Troubleshooting

### The doctor reports missing model artifacts

Rerun the selected setup with explicit downloads and the same cache path:

```powershell
.\scripts\setup-local-speech.ps1 -Runtime local-cuda -DownloadModels
```

If a previous download was interrupted, the setup checks all required files and asks `hf` for only the same pinned allowlists. Do not copy a mutable `main` snapshot into the cache.

### `en_core_web_sm`, `librosa`, eSpeak NG, or another optional module is missing

Resync the matching locked profile:

```powershell
Push-Location .\services\speech
uv sync --locked --no-python-downloads --extra dev --extra local-cuda
Pop-Location
```

Use `local-cpu` instead only when CPU mode is intended. Do not sync both extras together.

### CUDA mode is blocked

First confirm the driver is visible:

```powershell
nvidia-smi
```

Then confirm `local-cuda`, not `local-cpu`, is the current uv profile and rerun the doctor. CPU mode can diagnose and run without CUDA, but its results must not be reported as GPU verification.

### WebSocket closes with 4403 or 4406

- `4403`: connect from loopback and use an exact allowed `Origin`.
- `4406`: request WebSocket subprotocol `suits.speech.v1`.
- `4400`: send a valid `hello` first and use strict `suits.speech.v1` camelCase messages.

### `STT_NOT_READY` or `TTS_NOT_READY`

Complete the handshake and send `load_models` before starting an utterance or a text synthesis job. Check the request-bound `capabilities` event rather than treating `/healthz` as model readiness.

### STT or TTS backpressure

For STT, do not send another metadata/binary pair without advertised frame and byte credit. For TTS, acknowledge each exact metadata/binary frame only after the playback consumer owns it. A full phrase queue is retryable after playback advances; an ACK timeout cancels the affected response.

### `TTS_RESTART_REQUIRED`

The provider did not prove physical termination within its cancellation grace period, so the serialized lane was quarantined to prevent overlapping work. Restart the local speech process; do not retry synthesis in the same process.

## Current verification boundary

Verified now:

- strict local protocol, fake-mode service, VAD, queues, cancellation, backpressure, and fixed clips through automated tests;
- real cache-only Nemotron and Kokoro provider construction through automated/injected tests;
- one explicit real CUDA Kokoro-to-Nemotron in-memory smoke on the target RTX 5070.

Not yet verified:

- production hearing-page integration of the browser transport, AudioWorklet capture, and playback modules;
- browser microphone permission, real human speech, acoustic transcription quality, and audible speaker output in an E2E run;
- browser reconnect/preflight UX;
- automatic high-confidence partial-transcript objection detection and true audible mid-sentence interruption;
- STT/TTS percentile latency targets or sustained-load GPU performance;
- a network/audit capture proving the complete browser hearing keeps raw audio out of Convex/OpenAI, although the local service itself has no such integration and never emits raw STT input through its JSON protocol.
