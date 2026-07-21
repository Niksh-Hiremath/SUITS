# SUITS OpenAI Build Week delta

SUITS was not created from an empty repository during Build Week. This document separates the preserved Hermes foundation from the post-baseline event engine, GPT-5.6 runtime, local speech, courtroom, and Court Records work.

The evidence boundary is:

- legacy Hermes runtime tag: [`hermes-hackathon-v1`](https://github.com/Niksh-Hiremath/SUITS/tree/hermes-hackathon-v1) at [`2fec9bc`](https://github.com/Niksh-Hiremath/SUITS/commit/2fec9bc);
- audited pre-implementation repository: [`92c00e3`](https://github.com/Niksh-Hiremath/SUITS/commit/92c00e3), which added the new engineering contract/planning material but no SUITS 2.0 runtime milestone; and
- first post-baseline implementation commit: [`023a9fe`](https://github.com/Niksh-Hiremath/SUITS/commit/023a9fe).

The full environment and code inventory at that boundary is preserved in [BASELINE.md](./BASELINE.md). Commit anchors below are review aids, not a claim that one commit contains an entire milestone.

## What Hermes already provided

Before the Build Week implementation, the repository already contained meaningful product and reliability foundations:

| Preserved foundation | Pre-existing behavior |
| --- | --- |
| Web stack | Next.js/React/TypeScript, Tailwind, Convex, Zod, Vitest, and an OpenAI SDK integration |
| Golden case | The authored Asha Mehta v. Vertex Logistics matter and hardcoded domain-specific roleplay |
| Deterministic workflow | A fixed phase machine with transition rejection and URL-oriented resume concepts |
| Persistence and observability | Mutable trial rows plus ordered turns, traces, cost/latency fields, jury/debrief/eval tables |
| Model reliability concepts | Zod parsing, bounded repair/fallback, citations, and a Court Director manager/specialist/reviewer experiment |
| Voice foundation | Browser microphone capture and cloud ElevenLabs STT/TTS actions |
| Product surfaces | A basic hearing UI, Court Records direction, transcript-grounded debrief, and a five-run evaluation gate |

Those foundations are part of the project history and should be credited as Hermes work. Build Week preserved the useful deterministic, validation, durability, trace, debrief, and evaluation ideas while replacing the unsafe or hardcoded canonical paths.

## What changed after the baseline

### Milestone 1: event-sourced domain and persistence

Anchors: [`023a9fe`](https://github.com/Niksh-Hiremath/SUITS/commit/023a9fe) through [`d1c0857`](https://github.com/Niksh-Hiremath/SUITS/commit/d1c0857).

Added strict versioned CaseGraph, TrialAction, TrialEvent, TrialState, and KnowledgeView contracts; a pure reducer/validator/commit/replay engine; explicit fact/evidence/testimony/settlement lifecycles; idempotency and stale-head protection; additive Convex event/projection/snapshot/receipt persistence; and a conservative legacy migration/checkpoint path.

This replaced direct mutable-state authority with append-only events and deterministic replay without deleting historical tables or data.

### Milestone 2: private uploads, Terra compilation, and review

Anchors: [`06589aa`](https://github.com/Niksh-Hiremath/SUITS/commit/06589aa) through [`bc1a23a`](https://github.com/Niksh-Hiremath/SUITS/commit/bc1a23a).

Added bounded TXT/Markdown/JSON/PDF/DOCX ingestion, private Convex storage, source/page/offset provenance, prompt-injection flags, a strict streamed `gpt-5.6-terra` compiler, owner-bound compilation claims and quotas, deterministic validation/targeted repair, a review/edit/publish workbench, recovery/idempotent replay, orphan cleanup, and three seeded fictional cases.

This is new user-supplied case support; Hermes had one authored golden case and no general packet compiler/review workflow.

The later Cloudflare deployment decision retired active DOCX ingestion because its bounded Mammoth adapter required `node:worker_threads`, which Cloudflare exposes only as a non-functional compatibility stub. TXT, Markdown, JSON, and text-based PDF remain supported; the legacy MIME value remains readable solely for existing durable upload records.

### Milestone 3: general multi-witness hearing engine

Anchors: [`348ac0c`](https://github.com/Niksh-Hiremath/SUITS/commit/348ac0c), [`8641028`](https://github.com/Niksh-Hiremath/SUITS/commit/8641028), and [`b43bb0c`](https://github.com/Niksh-Hiremath/SUITS/commit/b43bb0c).

Added dynamic phase/action permissions; both-side call, recall, release, direct, cross, redirect, and recross; evidence foundation/offer/ruling; strike motions; hidden-fact reveal and proposed assertions; bilateral private settlement; opposing strategy state; pause/reload/replay; and an owner-bound Next.js/Convex V3 hearing facade.

The canonical hearing stopped using Asha-specific golden answers, the fixed one-witness workflow, and direct browser authority.

### Milestone 4: focused GPT-5.6 courtroom intelligence

Gate anchors: [`e622142`](https://github.com/Niksh-Hiremath/SUITS/commit/e622142) and [`ea27f4e`](https://github.com/Niksh-Hiremath/SUITS/commit/ea27f4e).

Added server-side Responses API adapters with `store: false`, strict call-class schemas, streamed provider handling, role-specific prompts/KnowledgeViews, one targeted semantic repair, cancellation and stale-response fences, immutable model-call/attempt audits, published cost estimates, and focused Luna/Terra orchestration for witnesses, opposing planning/dialogue, judge rulings, settlement, jury, and final coaching.

The gate recorded a real protected two-witness trial with 30/30 accepted model calls, exact durable reload, one judge ruling, one settlement evaluation, one jury deliberation, and one Terra debrief. This is live model evidence, not deployment or live-audio evidence.

### Milestone 5: local speech and voice-first browser path

Anchors: [`76b93b9`](https://github.com/Niksh-Hiremath/SUITS/commit/76b93b9) through [`d52864c`](https://github.com/Niksh-Hiremath/SUITS/commit/d52864c).

Added the Python/FastAPI `suits.speech.v1` companion, local energy VAD, revisioned streaming STT, bounded phrase TTS, binary PCM framing, backpressure/ACKs, cancellation/barge-in, fixed reaction cache, fake providers, cache-only Nemotron/Kokoro adapters, locked CPU/CUDA profiles, setup/doctor/smoke tooling, the exact-loopback browser client, AudioWorklet capture/playback, a voice-first hearing controller, double-gated developer typed input, and preflight readiness.

One real RTX 5070 in-memory Kokoro-to-Nemotron smoke passed. A human microphone, physical speaker, and complete real-GPU browser hearing remain unverified; Milestone 5 is therefore not represented as fully closed.

### Milestone 6: mid-sentence objection orchestration

Anchors: [`6e5b874`](https://github.com/Niksh-Hiremath/SUITS/commit/6e5b874) through [`0dcf8c2`](https://github.com/Niksh-Hiremath/SUITS/commit/0dcf8c2).

Added the high-confidence partial candidate detector, local interrupt coordinator, cached-objection-before-model ordering, final-revision durable binding, owner-derived rule/actor context, strict Luna ruling, atomic objection/interruption/ruling/resolve events, exact overruled resume, sustained rephrase/cancel, strike grant/deny continuation, leases/recovery, and late model/audio fencing.

The production-path deterministic browser fixture proves the cached reaction is dispatched before final STT, active audio is cancelled, the validated ruling commits, and witness speech resumes coherently. It uses fake media and muted output, so it does not claim physical audibility.

### Milestone 7: semantic animated courtroom

Anchors: [`00a4782`](https://github.com/Niksh-Hiremath/SUITS/commit/00a4782) through [`1ccb2ff`](https://github.com/Niksh-Hiremath/SUITS/commit/1ccb2ff).

Added the procedural React Three Fiber courtroom; judge, counsel, witness, clerk/display, and jury figures; strict semantic presentation and performance contracts; eleven animation states; camera priority/hysteresis; mouth timing from exact local playback; bounded model emotion/style metadata; evidence, settlement, and ruling transitions; reduced-quality/reduced-motion behavior; WebGL recovery; a deterministic visual atlas; and tracked Windows/Chromium baselines.

The renderer consumes semantic state only. GPT output cannot directly manipulate Three.js or authorize courtroom actions.

### Milestone 8: advanced debrief, Court Records, and repeated evals

Anchors: [`37ca52f`](https://github.com/Niksh-Hiremath/SUITS/commit/37ca52f) through [`57d6d65`](https://github.com/Niksh-Hiremath/SUITS/commit/57d6d65), with plan closure at [`e5fc508`](https://github.com/Niksh-Hiremath/SUITS/commit/e5fc508).

Added strict admitted/stricken/hidden/inference debrief strata; jury/debrief admissibility hardening; a three-case ten-run evaluation gate; canonical event/model/artifact audit readers; metadata-only audio lifecycle persistence; a fail-closed privacy-safe `court-records-view.v2` projector; owner-bound list/read/download routes; a bounded responsive records workspace; normalized procedure/recovery history; citation resources; replay hashes; exact-trial navigation; and byte-stable JSON export.

The complete deterministic browser flow now runs from voice hearing through durable reload, every Records panel, metadata-only audio rows, and two byte-identical exports without exposing owner IDs, raw event payloads, private strategy, raw audio, or hidden artifacts.

## Canonical replacements, not parallel claims

The following Hermes code remains available as historical/migration proof but is outside the normal runtime:

- `answerGoldenWitness`, `replyAsOpposingCounsel`, and authored verdict overrides;
- the Asha/Vertex-specific one-witness journey;
- the default Court Director manager/specialist/reviewer experiment;
- Convex `participatory`/`autonomous` legacy actions and mutable legacy trial surfaces; and
- `src/server/elevenlabs.ts` plus the old cloud-audio flow.

Build Week internalized the legacy Convex functions rather than deleting them or rewriting history. The active browser flow is the seeded/private CaseGraph catalog, owner-bound V3 event runtime, focused GPT-5.6 adapters, local speech companion, semantic courtroom, and v2 Court Records projector described in [ARCHITECTURE.md](../ARCHITECTURE.md).

## Evidence boundary

The post-baseline repository has deterministic unit/integration/eval/browser evidence, a real GPT-5.6 trial, and a synthetic in-memory real-CUDA speech smoke. It does not yet have recorded proof of:

- a human microphone utterance through the real Nemotron browser path;
- physical speaker audibility through the real Kokoro browser path;
- a complete browser trial using the real CUDA speech providers; or
- a production deployment.

Those boundaries must remain explicit in the final verification report. No Codex session ID or `/feedback` ID is recorded here; those belong in the separate session ledger and must never be fabricated.
