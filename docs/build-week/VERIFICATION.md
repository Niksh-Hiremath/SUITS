# SUITS build-week verification

This document records concrete verification evidence without treating deterministic browser fixtures as live-model, live-microphone, audible-speaker, or GPU proof. The current evidence closes Milestone 7 through implementation commit `1ccb2ff`; later milestones must extend this ledger rather than replace it.

## Milestone 7 gate

Executed from the repository root in PowerShell on 2026-07-20 (IST):

| Command | Result |
| --- | --- |
| `npm ci` | Passed in 21.1 s; 457 packages installed. npm reported two moderate advisories and three lifecycle scripts pending explicit approval. |
| `npm run lint` | Passed in 18.5 s with zero errors and four warnings from generated Convex files. |
| `npm run typecheck` | Passed in 11.3 s. |
| `npm exec -- tsc -p convex/tsconfig.json --noEmit --pretty false` | Passed in 14.6 s. |
| `npm test -- --reporter=dot` | Passed in 14.29 s: 156 files and 1,363 tests passed; three live-only files/tests skipped. |
| `npm run eval` | Passed in 1.86 s: two files and six tests. |
| `npm run verify:convex-surface` | Passed: exactly six authenticated public Convex functions. |
| `uv sync --project services/speech --locked --extra dev` | Completed with the locked dev environment. |
| `uv run --project services/speech python -m pytest services/speech/tests -q` | Passed in 7.9 s: 182 tests; one upstream Starlette/httpx deprecation warning. |
| `npm run build` | Passed in 17.5 s: Next.js compiled/typechecked and generated 19/19 pages. |
| `npm run test:e2e` | Passed in 123.1 s: all five Chromium tests. |

The first immediate speech-test process after sync reported 87 async-test failures because the pytest async plugin did not autoload. That run is not reported as a pass. Diagnostics confirmed `pytest_asyncio` was installed and registered, and the standalone locked-environment command above then passed all 182 tests. The future `npm run verify` orchestrator must make this setup deterministic and surface any recurrence.

`npm ci` reported two moderate dependency advisories. No breaking `npm audit fix --force` was applied. It also reported pending install scripts for `esbuild`, `sharp`, and `unrs-resolver`; no package was implicitly approved during this run.

## Browser coverage

The five-test Playwright gate covered:

- a production-path partial objection before final STT, active-playback cancellation, validated ruling, exact resumed testimony, and terminal renderer state;
- a voice-only fresh Redwood trial with Rina and Theo, exactly two calls/releases and two canonical witness answers, the player's spoken closing, opposing close, jury decision, debrief completion, and exact durable-view equality after reload with no extra command;
- every deterministic courtroom animation and transition fixture at 1,280 x 800, DPR 1, reduced quality, and reduced motion;
- an unavailable-WebGL fallback that retains hearing controls; and
- the preflight workspace without starting audio checks.

Both hearing tests assert that the production typed composer is absent and retain empty page-error and console-error ledgers. The atlas asserts that it makes no hearing API request, opens no speech socket, and requests no microphone.

## Committed visual baselines

The directory `tests/e2e/courtroom-visual-atlas.spec.ts-snapshots/` contains 24 tracked PNGs totaling 2,410,104 bytes. It covers all eleven semantic character animations, evidence enter/steady/update/switch/exit, settlement enter/steady/update/exit, ruling ready/gavel/holding, and reduced-motion inert `stand`, `sit`, and `gavel` proposals.

The SHA-256 of the UTF-8, LF-joined, name-sorted lines `<filename> <lowercase sha256>` is:

```text
ae3b5aee91c86f0be16f5f13f2529dbd7b23796ce2603053760185ca661b506e
```

The comparison gate allows at most 0.5% differing pixels at a 0.2 per-pixel threshold. Baselines are Chromium/Windows-specific by filename and are regenerated only through the explicit atlas test.

## Local video evidence

Playwright videos are generated evidence and remain ignored rather than entering git. The stable local copies are under `docs/build-week/artifacts/m7/`:

| File | Bytes | Duration | SHA-256 |
| --- | ---: | ---: | --- |
| `mid-sentence-objection.webm` | 1,481,208 | 26.920 s | `f217cb1aa40647a4c3d5fe4730fd69e6fb948b7fcd647a3376b877099ff5b50e` |
| `complete-two-witness-trial.webm` | 2,004,921 | 72.440 s | `448639d15ca559fb8efa2099a291033ef6ba50897addd8a35a279b1303961de8` |
| `courtroom-visual-atlas.webm` | 1,641,624 | 21.600 s | `7433776a51f3718c143b7bfb5ca5fc0fe1c670982df38506c66c497db0d3d62c` |

The mid-sentence run also attaches objection, judge-gavel, and resumed-testimony screenshots to the Playwright report.

## Evidence boundary and open verification

The browser gate uses Chromium fake media, the dedicated deterministic loopback fake speech companion, deterministic server-only scripted model decisions, and `--mute-audio`. It exercises the production page/controller/WebSocket/BFF/Convex/renderer path, but it does not verify:

- human microphone permission or STT accuracy;
- physical speaker audibility;
- CUDA provider readiness, latency, or quality;
- a complete live GPT-5.6 trial; or
- production deployment behavior.

Those checks remain separate acceptance gates. `npm run verify` is also still a Milestone 9 deliverable; the commands above were executed individually and must later be orchestrated with explicit passed, skipped-live, skipped-GPU, and failed sections.
