# Phase 1 — Eligibility and Locked Scope

## Declared starting point

SUITS begins the hackathon as a concept and planning package only. Before kickoff, the repository contains event reference material, an execution plan, and permitted design artifacts such as schemas, fictional case fixtures, prompt contracts, evaluation definitions, and verification scripts. The scored application, working orchestration, provider integrations, deployment, and user-facing product will be built on-site.

**Mentor disclosure (one sentence):** “Before kickoff I prepared only the SUITS concept, architecture notes, fictional case data, schemas, prompts, eval definitions, and provider checks; the scored application and integrations are being built here through Hermes.”

If a mentor interprets any prepared artifact as product implementation, do not use it until the mentor approves it and the answer is recorded below.

## Eligibility decisions

| Item | Decision | Basis / proof |
|---|---|---|
| Track | AI as Agency | Confirmed by the participant; must still be rechecked against any day-of organizer change. |
| Team | Solo | Confirmed by the participant; allowed by handbook Rule 01. |
| Hermes use | Coding partner | Preserve this session and later Hermes receipts plus event-day commits. Hermes as an end-user harness is optional only after the core product is reliable. |
| Starting point | Planning and permitted preparatory artifacts only | Handbook allows ideas, sketches, wireframes, standard scaffolding, BaaS, SDKs, and helper utilities; it prohibits an existing scored product. |
| Build location | On-site | Product implementation must happen on the build floor during the sprint. |
| Submission | Public live URL through event-day form | No zip file or slide deck substitutes for the live product. |
| Source repository | Public GitHub repository | `https://github.com/Niksh-Hiremath/SUITS`; local `main` branch is connected as `origin`. |

## Pre-hackathon inventory

Inventory captured before product implementation:

| Path / item | Classification | Notes |
|---|---|---|
| `AGENTS.md` | Allowed helper | Agent operating instruction only. |
| `PLAN.md` | Allowed planning artifact | Product decisions, architecture, gates, demo, and cut order. |
| `ROADMAP.md` | Allowed planning artifact | Ordered pre-event and event-day execution checklist. |
| `HANDBOOK.md` | Allowed reference | Organizer rules, scoring, submission, and demo guidance. |
| `HACKATHON.md` | Allowed reference | Event details and partner list. |
| `docs/phase-1/*` | Allowed preparatory artifact, subject to mentor confirmation | Specifications and fixtures only; no runnable scored product. |
| Existing application code | None | Participant confirmed SUITS has no code; file inventory contained only Markdown at the time of review. |
| Existing deployment | None | Participant confirmed no SUITS product exists outside this folder. |
| Existing prompts/case fixtures | None outside planning documents | New preparatory versions must remain specifications rather than a deployed product. |

## Kickoff confirmations

Record these before writing scored product code:

- [x] Registration confirms **AI as Agency**.
- [x] Solo participation remains accurate.
- [ ] Exact submission URL and deadline are recorded.
- [ ] Any day-of rule changes are copied into the roadmap notes.
- [ ] A mentor accepts the declared starting point, or their requested restrictions are recorded.
- [ ] Hermes session receipts are visible and retained.
- [x] The product repository is initialized and connected to the public GitHub repository.
- [ ] The event-day starting commit is identifiable after the permitted planning artifacts are committed.

### Mentor decision record

- Mentor:
- Time:
- Starting-point decision:
- Restrictions or required disclosure:

## Locked product definition

**One-liner:** SUITS is a voiced moot-court coach that runs a fictional hearing and produces a transcript-grounded coaching debrief.

**Primary user:** A law student, junior advocate, or professional practicing oral advocacy.

**Product boundary:** Fictional cases and educational coaching only. SUITS does not provide legal advice.

**Real work product:** A downloadable Case Debrief grounded in stable transcript-turn citations.

## Golden path scope

- Exactly one required fictional case.
- Participatory mode is the user-facing product.
- Autonomous mode runs the same workflow only for evals and regression testing.
- Live summary hearing lasts 60–120 seconds.
- One witness; cross-examination only; no direct examination.
- One decisive cross-examination exchange with a deterministic contradiction-unlock path.
- Short closing, transcript-only jury verdict, and three-part juror dialogue.
- At least one AI response is voiced; all essential content remains visible as text.
- Typed input is the guaranteed fallback.
- Trial refresh resumes from the last committed phase.
- Court Records exposes real handoffs, timing, tokens, cost, retries, fallbacks, status, and assertions.
- Case Debrief includes at least one strength, missed opportunity, evidence references, and revised closing.
- Public deployment works in a fresh browser.

## Classification rule for proposed work

Every proposed feature must fit exactly one category:

1. **Golden path:** Required to complete the hearing and create the debrief.
2. **Proof and observability:** Required to verify execution, grounding, reliability, cost, or latency.
3. **Optional partner integration:** Attempt only after Gate 3 passes and only if it performs mentor-verifiable real work.
4. **Deferred:** Everything else.

## Not now

- Cases two and three.
- Multiple witnesses or direct examination.
- Open-ended legal research or real client matters.
- Objection flow unless every earlier gate has passed with time remaining.
- User accounts, collaboration, or team workspaces.
- Elaborate avatars or a mobile application.
- Full billing system.
- Full-length trial mode.
- Cross-trial Hermes personalization.
- Telegram Clerk of Court.
- More than one optional partner integration unless the first is stable and at least 15 minutes remain before feature freeze.

## Exit check

This step passes when the participant can explain the starting point honestly in under 30 seconds, the registered track and solo status are confirmed, no questionable prebuilt product is scheduled for use without mentor approval, and every feature is classified using the four categories above.
