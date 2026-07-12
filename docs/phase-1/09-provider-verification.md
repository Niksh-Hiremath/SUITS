# Phase 1 — Provider Verification Matrix

Never record credential values in this repository. Record only provider, exact model/service identifier, test time, latency, status, and sanitized error/fallback.

## Current verified state

| Dependency | Required proof | Status | Fallback |
|---|---|---|---|
| Hermes coding partner | `hermes status --all`, working session, retained receipt | Verified: Hermes runs with `gpt-5.6-sol` through OpenAI Codex OAuth | Re-authenticate Codex; coding receipts remain the eligibility path |
| GitHub | Authenticated account and public repo | Verified: `Niksh-Hiremath/SUITS` public repository exists | Local Git plus later push |
| OpenAI application API | Minimal structured-output request using exact API model ID | Not tested; no OpenAI API key detected by Hermes status | Deterministic authored content cannot replace the core model indefinitely; obtain key/credits before event |
| Convex | CLI/account/project access and minimal read/write | Not tested | No substitute selected; core persistence dependency |
| Cloudflare | Account/CLI/deployment permission and fresh-browser URL | Not tested | Fastest organizer-approved public host after 20-minute event-day timebox |
| ElevenLabs TTS | Generate one short sentence with `eleven_flash_v2_5`; record voice/latency | Model and API capability verified from official docs; authenticated request pending local key | Visible text remains nonblocking, but one voiced AI response is required |
| Wispr Flow STT | Public developer API/SDK suitable for app integration | Rejected for critical path: official public site exposed a product help center, not public developer API documentation | ElevenLabs Scribe v2 |
| ElevenLabs STT | `POST /v1/speech-to-text` with `model_id=scribe_v2` | Endpoint and model verified from official API reference; authenticated request pending local key | Typed input |
| Linkup | Account/API minimal request | Not tested, optional | Omit integration |
| Dodo Payments | Account/test checkout capability | Not tested, optional | Omit integration |

## Local toolchain readiness

Checked on the pre-event machine:

- Node.js `v24.13.1`, npm/npx `11.12.1` are available.
- `pnpm` and `bun` are not installed; npm is the default package manager.
- Convex CLI is not installed globally; prefer an event-day project-local dependency/`npx convex` after scaffolding.
- A stale global Wrangler shim exists, but its package is missing and `wrangler --version` fails with `MODULE_NOT_FOUND`. Repair or use a project-local Wrangler package before testing Cloudflare authentication.

## Locked fallback chains

### Input

1. ElevenLabs Scribe v2 (`scribe_v2`).
2. Typed input, always available.

### Output

1. ElevenLabs Flash v2.5 (`eleven_flash_v2_5`) for at least one AI response and planned multi-voice juror playback.
2. Visible text immediately if TTS fails or autoplay is blocked.

### Hosting

1. Cloudflare.
2. If blocked for more than 20 focused minutes on event day, fastest organizer-approved public host; return to Cloudflare only after golden path is live.

### Optional providers

Timebox Linkup or Dodo to 30 focused minutes each before event; neither may block the core. During the event, implement at most one after Gate 3. Wispr is not part of the product dependency chain.

## Test-record template

| Field | Value |
|---|---|
| Provider/service | |
| Account/project | Non-secret label only |
| Exact model/API ID | |
| Timestamp/timezone | |
| Request type | |
| HTTP/CLI result | Sanitized |
| Latency | |
| Output schema valid | |
| Error/retry | |
| Final decision | Primary / fallback / omit |

## Required environment-variable names

See root `.env.example`. Values belong only in ignored local files or provider secret stores.

## Security checklist

- [ ] Real keys exist only in ignored/provider stores.
- [ ] `.env` and audio files are excluded by `.gitignore`.
- [ ] No secrets appear in screenshots or Court Records.
- [ ] Environment validation reports missing variable names, never values.
- [ ] Git tracked-file scan is clean before every push.

## Exit check

Every core provider must have a real minimal successful request or an explicit tested fallback. The unresolved application OpenAI, Convex, Cloudflare, TTS, and STT checks prevent Phase 1 completion until credentials/accounts are available.
