# Phase 1 — Repository and Event-Day Queue

## Intended stack

- Next.js + React + TypeScript
- Convex for state, artifacts, and traces
- Cloudflare for public hosting
- OpenAI structured-output model (exact API model ID must be verified)
- ElevenLabs Flash v2.5 TTS (`eleven_flash_v2_5`)
- ElevenLabs Scribe v2 STT (`scribe_v2`); typed input fallback

No application scaffold is created before kickoff unless a mentor explicitly confirms it is permitted.

## Naming conventions

- Components: `PascalCase`
- Functions/variables: `camelCase`
- Constants and authored IDs: descriptive stable strings; env vars: `UPPER_SNAKE_CASE`
- Phases/actions: `snake_case` values from workflow spec
- Convex tables: plural camelCase (`juryVotes`, `evalRuns`)
- API routes: lowercase kebab-case
- Trace actions: exact workflow action names
- Prompt versions: `<actor>.vN`
- Schema versions: `<artifact>.vN`
- Tests: behavior-oriented names matching named assertions

## Minimal routes

| Route | Purpose |
|---|---|
| `/` | Landing, disclaimer, case/side start |
| `/trial/[trialId]` | Courtroom, phase, transcript, text/voice input, resume |
| `/trial/[trialId]/results` | Verdict and downloadable/printable debrief |
| `/records` | Run list |
| `/records/[trialId]` | Trace tree, metrics, assertions, linked turns/artifacts |

## Planned standard scripts

Exact package commands are event-day scaffold work, but the interface is locked:

- `dev` — local app
- `typecheck` — TypeScript validation
- `lint` — static lint
- `test` — unit/integration tests
- `test:watch` — narrow development tests
- `eval` — autonomous golden-case suite
- `build` — production build
- `deploy` — approved Cloudflare deployment path

## Ordered event-day queue

1. Confirm rules/starting point and record mentor response.
2. Scaffold Next.js/Convex app and environment validation.
3. Deploy blank public health page and verify in fresh browser.
4. Implement schemas, seed one golden case, private/public separation, trial/turn/trace persistence, and resume.
5. Implement deterministic Court Director and transition tests.
6. Implement text-only autonomous vertical slice.
7. Pass Gate 1 with two deployed autonomous runs.
8. Implement participatory typed courtroom and printable debrief.
9. Implement Court Records trace/proof surface.
10. Pass Gate 2 in a fresh browser including refresh/resume.
11. Add TTS and verified STT without weakening text path.
12. Implement named evals and five-run sequence.
13. Pass Gate 3 at ≥4/5 fully passing runs.
14. Add at most one authentic partner integration if time permits.
15. Polish golden path, run quality checks, and freeze features.
16. Conduct real-user runs and harvest verifiable proof.
17. Final deployed smoke test, backup recording, submission, and rehearsal.

## Planned commit checkpoints

No commits are made by Hermes without explicit participant approval.

1. `docs: record approved buildathon starting point`
2. `chore: scaffold app and blank deployment`
3. `feat: add case data and persistent trial state`
4. `feat: enforce deterministic hearing workflow`
5. `feat: complete text-only autonomous trial`
6. `feat: add participatory courtroom and debrief`
7. `feat: add court records observability`
8. `feat: add nonblocking voice interaction`
9. `test: add golden-case eval pipeline`
10. `feat: add verified partner integration` (only if authentic)
11. `chore: freeze and verify demo build`

## Gate discipline

- Gate 1 must pass before participatory/voice expansion.
- Gate 2 must pass before voice work.
- Gate 3 must pass before optional integrations or cases.
- Feature freeze at 4:45 PM; after that accept only reliability, proof, and demo-critical fixes.
- Apply `PLAN.md` cut order immediately when behind.

## Pre-event repository tasks

- [x] Local Git repository initialized on `main`.
- [x] Public GitHub repository created and connected as `origin`.
- [x] Phase 1 specifications stored under `docs/phase-1/`.
- [x] Environment-variable names documented without values.
- [x] `.gitignore` prepared to exclude secrets, build output, local state, and raw audio.
- [ ] Participant approves and creates the pre-event planning commit/push.
- [ ] Repository archived locally for venue Wi-Fi independence.
- [ ] At kickoff, tag/record the approved starting commit after mentor confirmation.

## Exit check

At kickoff, implementation can begin from the first approved task without another scope, architecture, naming, route, or task-order discussion.
