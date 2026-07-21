# SUITS build-week verification

This document records concrete verification evidence without treating deterministic browser fixtures as live-model, live-microphone, audible-speaker, or GPU proof. It preserves the Milestone 7 history, records the completed Milestone 8 gate through `e5fc508`, and tracks Milestone 9 proof separately rather than replacing earlier results.

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

The browser gate uses Chromium fake media, the dedicated deterministic loopback fake speech companion, deterministic server-only scripted model decisions, and `--mute-audio`. It exercises the production page/controller/WebSocket/BFF/Convex/renderer path, but that browser run does not verify:

- human microphone permission or STT accuracy;
- physical speaker audibility;
- CUDA provider readiness, latency, or quality;
- live GPT-5.6 behavior in the browser hearing; or
- production deployment behavior.

Separate evidence already exists for a complete live GPT-5.6 protected trial and a real CUDA in-memory speech smoke; it is summarized below. Those checks do not prove an integrated live browser hearing. At the Milestone 7 checkpoint, `npm run verify` was still a future deliverable; the completed classified Milestone 9 run is recorded below.

## Historical live-model and GPU evidence

These checks were executed separately on 2026-07-19 and are not results of the deterministic Playwright or Milestone 8 gates:

- With the opt-in flag and the already-configured Convex service secret loaded into one PowerShell process without printing or persisting it, `npm run test:live:courtroom-witness` passed a real protected GPT-5.6 trial in 228.802 seconds. Trial `trial_c2e0b65b75fa478ebe4cde79476f4a28` completed 30/30 accepted calls across two witnesses, opposing planning/dialogue, one objection ruling, one settlement evaluation, jury deliberation, and Terra debrief, followed by exact owner reload. This is live server-side model evidence, not a microphone/browser or production-deployment run.
- `scripts/setup-local-speech.ps1 -Runtime local-cuda -DownloadModels` completed against an RTX 5070 and the pinned Nemotron/Kokoro snapshots. From `services/speech`, the opt-in CUDA `python -m suits_speech.smoke` then passed in 13.6 seconds: 109 ordered 20 ms frames, four partial revisions, first partial at 1,112 ms, finalization in 54 ms, and a fixed normalized transcript match in 12,001 ms total. The phrase and PCM were synthetic and in memory. This proves real local providers on that GPU, not human microphone input, physical speaker output, browser audio, or sustained performance.
- A direct same-origin `/api/preflight` request returned ready in 5,161 ms with real Convex, Luna, and Terra probes. The browser preflight controls were not interactively exercised, and microphone/speaker permission was not granted by that check.

The three live-only root tests are skipped unless explicitly opted in. A later deterministic gate that reports those skips does not invalidate the historical live runs, and it also does not count as a fresh live pass.

## Milestone 8 gate

Executed from the repository root in PowerShell on 2026-07-20 (IST):

| Command | Result |
| --- | --- |
| `npm test -- --reporter=dot` | Passed in 17.99 s: 173 files and 1,557 tests passed; three intentional live-only files/tests skipped. Nine expected interruption diagnostics came only from named negative-path BFF tests. |
| `npm run eval -- --reporter=dot` | Passed in 1.86 s: three files and 17 tests, including the deterministic 10/10 repeated gate and its 9/10-pass/8/10-fail threshold checks. |
| `npm run lint` | Passed in 14.573 s with zero errors and four existing warnings in generated Convex files. |
| `npm run typecheck -- --pretty false` | Passed in 2.480 s. |
| `npx tsc --noEmit -p convex/tsconfig.json --pretty false` | Passed in 5.328 s. |
| `npm run build` | Passed in 28.3 s; Next.js compiled/typechecked, generated 20/20 pages, and retained the owner-bound Records routes as dynamic server boundaries. |
| `uv sync --extra dev` from `services/speech` | Passed after resolving 146 and checking 34 packages. |
| `uv run pytest` from `services/speech` | Passed in 7.25 s: 182 tests, zero skipped, and one upstream Starlette deprecation warning. This was CPU/fake test evidence, not the historical CUDA smoke. |
| `npm run test:e2e` | Passed in 147.1 s: all five Chromium scenarios using four workers. Individual timings were 1.0 s preflight, 5.0 s WebGL fallback, 20.5 s atlas, 29.2 s objection, and 1.6 minutes for the complete voice-to-Records trial. |

The primary browser scenario started a fresh Redwood trial, called and released Rina and Theo exactly once, committed two spoken questions and a spoken closing, reached jury/debrief completion, reloaded the exact hearing, opened the exact owner-bound Records route, stabilized metadata-only audio, reloaded exact list/detail state, exercised all nine panels, downloaded byte-identical schema-valid exports twice, rejected private keys/canaries/owner ID, and retained empty browser/product-error ledgers. It also asserted that no production text composer was mounted.

This completed Milestone 8 through documentation commit `e5fc508`. No live OpenAI call, real microphone/speaker, or GPU model was executed by this particular gate. Those are correctly separated from the historical live checks above.

## Milestone 9 demo and recovery proof

Current work adds a hard `180000` ms assertion around the primary staged path from initial hearing navigation through three consecutive stable Court Records projections. The longer nine-panel, export, privacy, and error-ledger checks remain intact outside that timed checkpoint. A final full-page Records screenshot, timing JSON, hearing screenshot, and success video are attached only on the successful path.

Current local checks:

| Command | Result |
| --- | --- |
| `npm exec -- eslint tests/e2e/hearing-objection.spec.ts --max-warnings 0` | Passed. |
| `npm run typecheck -- --pretty false` | Passed. |
| `npm run test:e2e -- tests/e2e/hearing-objection.spec.ts -g "completes two witnesses by voice"` | Passed once on 2026-07-20 in 124.2 s wall time / 123.054 s Playwright report time. The test body was 99.686 s, and the new navigation-to-three-stable-Records measurement was **87,098 ms**, below the hard 180,000 ms limit. One Chromium worker ran; the linked Convex development functions became ready in 8.78 s. |

The successful local report attached the following generated artifacts:

| Attachment | Local report path | Bytes | Duration | SHA-256 |
| --- | --- | ---: | ---: | --- |
| Durable hearing screenshot | `playwright-report/data/ec5fa28f3168d28cab89be0d8b79a1266cc5e9a5.png` | 148,167 | n/a | `81219ddce0dbc9948e917546ec1367e529265917ca9024bef056947e6cea6b13` |
| Final Records screenshot | `playwright-report/data/3005f6773634238d0e6a9bb385cecf92037c74d1.png` | 1,415,327 | n/a | `73451e5f9fd7b0f71d541166149c05b2eaebb4fd075d53d9b47b2b816492b3b6` |
| Full selected-run video | `playwright-report/data/a8214d99c4656e6911cb0355eedcbb246f1805ec.webm` | 2,874,539 | 100.120 s | `a1c8bdb7bf12256f7953c27acda8d04208a0dc64042dc53743b5b93e569197e7` |

The inline `primary-demo-timing` JSON attachment records limit `180000`, measured duration `87098`, the checkpoint `three consecutive stable Court Records projections`, and trial `trial_bf122135e775427d868af3d9572d01b5`. The same video is also present in the selected test's `test-results` directory. `playwright-report/`, `test-results/`, and WebM files are git-ignored/generated and may be replaced by the next run; these paths and hashes are local evidence, not a committed or externally retained artifact claim.

The final Records PNG was visually inspected after the run. It shows the selected Rina Shah record, the educational disclaimer, stable summary counts, all nine section controls, and the bounded chronological event ledger without a visible error banner or text composer.

Documentation now provides a staged sub-three-minute operator path, an honest fake-media/muted/scripted automation boundary, and recovery cards for microphone denial, speech disconnect, OpenAI timeout, malformed structured output, and refresh. Existing implementation/unit evidence supports each safe behavior; only completed-state hearing/Records refresh currently has mounted browser proof. The required aggregate and repeated-demo evidence are recorded next.

## Milestone 9 aggregate verification

Executed from the repository root in PowerShell on 2026-07-20 (IST):

| Command | Result |
| --- | --- |
| `npm ci` | Passed in 21.6 s; 457 packages installed and 458 audited. Two moderate advisories and three unapproved lifecycle scripts remain reported. No breaking fix or implicit approval was applied. |
| `npm run verify` | Passed in 218.9 s with 14 required groups passed, no failed group, three explicit OpenAI skips, and one explicit GPU skip. |

The aggregate result was:

- root test: 177 files and 1,577 tests passed; three live-only files/tests skipped;
- deterministic eval: three files and 17 tests passed;
- root and Convex TypeScript passed;
- lint passed with zero errors and four unused-disable warnings only in generated Convex files;
- deployed Convex surface remained exactly six authenticated public functions;
- locked speech sync, Ruff format/lint, strict mypy over 20 source files, and all 182 pytest cases passed; one upstream Starlette/httpx warning remains;
- Next.js 16.2.10 compiled in 3.4 s, typechecked in 11.1 s, and generated 20/20 pages;
- the production boundary scanned 539 tracked files and 33 client assets without finding a tracked secret, server sentinel/environment name, or production typed-input marker; and
- all five Chromium scenarios passed in 2.5 minutes: preflight 1.1 s, WebGL fallback 4.9 s, atlas 20.9 s, objection 29.5 s, and complete voice-to-Records 1.6 minutes.

`SKIPPED-OPENAI` named the Terra compiler, Terra injection, and Luna courtroom suites because `-LiveOpenAI` was not supplied. `SKIPPED-GPU` named the Kokoro-to-Nemotron smoke because `-LiveCudaSmoke` was not supplied. They were not counted as passes. The separately recorded real 30-call GPT-5.6 trial and RTX 5070 smoke above remain the live evidence for this build.

The aggregate can opt into those checks with PowerShell switches:

```powershell
npm run verify -- -LiveOpenAI
npm run verify -- -LiveCudaSmoke
```

The OpenAI switch is billable. It rejects a Vitest exit-zero result if any selected suite or test was skipped. The CUDA switch requires the pinned local model cache and reports the speech smoke's strict JSON outcome.

## Three-run demo reliability

```powershell
npm run test:e2e -- tests/e2e/hearing-objection.spec.ts --grep "completes two witnesses by voice" --repeat-each=3 --workers=1
```

Exit 0 in 302.9 seconds: all three serial runs passed. Exact navigation-to-three-stable-Records timings were 84,335 ms, 79,632 ms, and 78,864 ms against the hard 180,000 ms limit. The complete test bodies remained about 1.6, 1.5, and 1.5 minutes and retained the later nine-panel, reload, privacy, byte-stable repeat-export, and empty-error-ledger checks.

Generated local artifacts from that report are ignored and replaceable:

| Run | Records PNG (bytes / SHA-256) | WebM (duration / SHA-256) |
| ---: | --- | --- |
| 1 | `8165686de54fa219b8eb1d02f39db708c1b43503.png` — 1,411,551 / `5cfb080bf54e5410d3631a4356c0f9e6992c86c964dd90d5e05b618d50584f1d` | `ec072c5fd6e568c1343a39ceba67dbb3410dda83.webm` — 96.76 s / `b7906f15aa96e388cceda974556c9c94dbc8aa7e58297a39ee9419f3e2d54c7d` |
| 2 | `7cd2e33239cadbedc4e05c37817b39ebea1599ec.png` — 1,412,460 / `95315a33f509242dd5a8e6a686ffe1e4ac8c8e35895d9cf5cf0310eb9aae2e1b` | `12b732551572ccd24f5168bff492f9550046c889.webm` — 92.00 s / `cd57f24e547958bb54a52ef23bc4b7d256b22fef36fdc7b2a0e07697fa367a45` |
| 3 | `bfa0af414c56197a831e4d35725d485d4ca4a859.png` — 1,416,663 / `3886366488fb9c55f2be7ba5367df98f171431e8909ee15668d9f9707250faeb` | `bdfc591fdc840f042797e8647e71a1d051f32bc8.webm` — 91.28 s / `fe75c733ba4a875838cb5d30f69f469584a74eea7aae5395728acaf3ddc5ef6f` |

All three runs share the durable-hearing screenshot `ec5fa28f3168d28cab89be0d8b79a1266cc5e9a5.png`, 148,167 bytes, SHA-256 `81219ddce0dbc9948e917546ec1367e529265917ca9024bef056947e6cea6b13`. The final repeated Records PNG was visually inspected and showed the expected owner record, disclaimer, stable counts, all nine controls, bounded event ledger, and no visible error/composer.

## Remaining external and deployment boundary

The implementation and deterministic/browser/live-provider gates are complete. A human microphone utterance and physically audible speaker result remain `BLOCKED-EXTERNAL`: a person must grant browser permission, speak, and attest output through the documented CUDA preflight path. Mounted recordings for microphone denial, speech disconnect, timeout, malformed-output recovery, and refresh while an action is pending would strengthen the evidence but are not substituted for by unit tests. Production deployment is unverified and is not claimed as a completed capability.

## Deployment-neutral speech copy checkpoint

Executed from the repository root in PowerShell on 2026-07-21 (IST):

| Command | Result |
| --- | --- |
| Focused six-file Vitest speech/preflight/hearing slice | Passed: six files and 102 tests. |
| Scoped ESLint with `--max-warnings 0` | Passed. |
| `npm run typecheck -- --pretty false` | Passed. |
| Speech Ruff format/lint and `pytest tests/test_app.py -q` | Passed: 38 files already formatted, no Ruff issue, and five API tests; the existing upstream Starlette/httpx warning remains. |
| `$env:PLAYWRIGHT_BASE_URL = 'http://localhost:3000'; npm run test:e2e -- tests/e2e/preflight.smoke.spec.ts --workers=1` | Passed: one Chromium smoke in 866 ms with no page/console errors. |

The mounted preflight DOM and screenshot showed **Raw audio bypasses OpenAI and Convex.**, **Prepare speech runtime**, and no visible `local`, `locally`, `localhost`, `loopback`, or `this/your machine` marker. The regression is enforced in both the server-rendered source test and mounted Playwright smoke.

Two diagnostic Playwright attempts are not counted as passes: the default isolated harness could not acquire the existing Next development lock, and an explicit `127.0.0.1` base URL produced only a development HMR host-spelling WebSocket error. The `localhost` rerun used the already-running app and passed cleanly. This checkpoint changes presentation copy only; it does not verify a remote GCP speech transport. The current speech path remains loopback-only until the WSS/authenticated-gateway work in the security and speech documentation is implemented and tested.
