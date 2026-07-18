# SUITS 2.0 baseline — 2026-07-18

This document records the repository state before SUITS 2.0 implementation. It supplements the authoritative evidence in `PLAN.md`; it does not replace the milestone gates.

## Git boundary

- Branch: `main`
- HEAD: `92c00e3ccca51ae6c4734fe621de68ce81d839b0`
- Upstream: exactly aligned with `origin/main` at audit time
- Worktree: clean before implementation
- Legacy tag: `hermes-hackathon-v1` at `2fec9bc87cfda70a7b8cb46b966b65699cfe5c20`

The existing tag is the correct final Hermes runtime boundary. The single commit between it and HEAD changes only the new engineering contract, plan, environment example, and historical planning/static proof files. The tag must not be moved or force-updated.

## Environment

| Capability | Observed value |
| --- | --- |
| Node | 24.17.0 |
| npm | 11.17.0 |
| Python | 3.12.10 |
| uv | 0.11.25 |
| GPU | NVIDIA GeForce RTX 5070 |
| GPU memory | 12,227 MiB |
| Driver | 610.62 |
| Compute capability | 12.0 |
| CUDA compiler | 13.3 / V13.3.33 |

Python and uv were already installed under `C:\Users\niksh\AppData\Local\Programs\Python\Python312`. Initial failures inside Codex were caused by the previous workspace sandbox denying execution outside the workspace. Both commands were verified after Full access was enabled.

## Repository map

### Application routes

- `src/app/page.tsx` — single Asha/Vertex landing page.
- `src/app/hearing/page.tsx` — monolithic participatory hearing, microphone capture, typed fallback, whole-file playback, transcript, and debrief download.
- `src/app/records/page.tsx` — global trial/eval/trace records UI.

The app has no case library/upload route, review editor, server API routes, courtroom component tree, settings/preflight route, or e2e harness. `next.config.ts` sets `output: "export"`.

### Domain and tests

Nine framework-independent domain modules exist with paired tests. Useful foundations include deterministic transition rejection, Zod validation, citation checks, bounded repair/fallback, cost accounting, URL-based resume parsing, and named eval assertions. Hardcoded Asha/Vertex roleplay, the singular witness journey, Harbor/Northstar contradiction logic, and the fixed phase list must leave the normal runtime path.

Baseline verification:

- lint: exit 0 with five warnings;
- strict typecheck: exit 0;
- unit tests: 60/60 passed across 12 files;
- pure eval tests: 3/3 passed;
- production build: compilation/typecheck passed, static prerender failed because `NEXT_PUBLIC_CONVEX_URL` is absent.

### Convex

Baseline tables:

1. `cases`
2. `privateCases`
3. `trials`
4. `turns`
5. `traces`
6. `juryVotes`
7. `debriefs`
8. `evalRuns`
9. `productEvents`

There are 23 public functions and one internal function. Convex is already the durable transport/source for legacy records, but material trial state is a directly patched snapshot rather than an event-reduced projection. Public low-level mutations have no ownership or authorization checks. The repo contains no linked-deployment evidence, migrations, upload metadata, material event log, witness-specific knowledge model, fact/evidence/testimony lifecycle, objection state, settlement state, snapshots, or replay checkpoints.

## Legacy behavior map

The baseline runtime is:

```text
Next client pages
  -> public Convex functions
  -> Convex Node actions
       -> non-streaming OpenAI Responses calls
       -> cloud ElevenLabs STT/TTS
  -> mutable trial rows + append-style turns/traces
  -> transcript/card UI and Court Records
```

Material defects that must not be preserved as normal behavior:

- user audio crosses Browser -> Convex -> ElevenLabs;
- TTS is a complete MP3 response with no phrase stream, timing, backpressure, or barge-in;
- production textareas remain visible;
- `askWitness` pays for manager/specialist/reviewer output and then commits an authored answer instead;
- opposing counsel is authored without GPT;
- the final GPT verdict is overwritten deterministically;
- runtime defaulted to a now-removed, forbidden legacy model literal;
- the autonomous Harbor/Northstar transcript is persisted under the Asha case and can evade shallow eval assertions;
- debrief replacement deletes the prior debrief record;
- global public queries expose all trials and traces without ownership checks.

## Preserve, migrate, retire

### Preserve and extend

- deterministic ownership of legal transitions;
- Convex durability and URL resume direction;
- ordered transcript turns and citations;
- trace hierarchy, latency, usage, cost, retry, and fallback fields;
- Zod parsing, citation rejection, bounded repair, and bounded fallback;
- the public/private knowledge-boundary concept and its regression tests;
- Court Records, debrief, and named evaluation concepts;
- generated Convex files as generated artifacts only.

### Migrate/generalize

- cases/private cases -> immutable, versioned CaseGraph plus source provenance;
- mutable trial/turn rows -> append-only TrialEvents plus reducer/projection;
- traces -> request/schema/prompt versions, knowledge scope, validation, interruption, cache, and audio timing;
- one-witness orchestration -> actor-specific KnowledgeViews and focused role calls;
- single-case eval -> multi-case replay/invariant gates;
- transcript/card hearing -> semantic rendered courtroom;
- static export -> server-capable Next runtime with server-only OpenAI routes;
- cloud speech -> local versioned speech protocol and companion service.

### Retire from the canonical path

- `answerGoldenWitness`, `replyAsOpposingCounsel`, and `assessGoldenVerdict`;
- Harbor/Northstar autonomous authored runtime as product behavior;
- ElevenLabs/Convex raw-audio actions;
- visible production typed composer and typed-fallback messaging;
- fixed one-cross/one-closing workflow;
- forbidden legacy model default;
- default three-call manager/specialist/reviewer chain.

## Baseline blockers

- `NEXT_PUBLIC_CONVEX_URL` and `CONVEX_DEPLOYMENT` are absent from the checked local environment. The linked deployment and its existing data must be inspected safely before schema migration.
- A local `OPENAI_API_KEY` variable exists, but model access and live GPT-5.6 behavior remain unverified until an explicit live smoke test succeeds.
- GPU and CUDA are visible. Nemotron/Kokoro model files, microphone permission, warmup, and measured local speech behavior remain unverified until the speech milestone.
- The dependency audit reports two moderate vulnerabilities. They require investigation; no force upgrade was applied during baseline collection.
