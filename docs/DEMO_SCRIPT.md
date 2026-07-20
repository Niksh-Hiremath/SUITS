# SUITS three-minute demo and recovery runbook

SUITS is a fictional educational courtroom simulation. It is not legal advice, does not predict a real case, and does not impersonate a licensed lawyer.

## Evidence boundary

Use only the visible courtroom controls and the microphone during a product demo. The production hearing has no text composer, and the demo must not expose a development-only control.

The repeatable Playwright proof is intentionally different from a live demonstration: Chromium supplies fake media, output is muted, the loopback speech companion is deterministic, and courtroom model decisions are server-scripted. That automation exercises the real page, controller, WebSocket, BFF, Convex persistence, renderer, reload, Records, export, and privacy boundaries. It does **not** prove human-microphone recognition, audible speakers, CUDA speech quality, live GPT-5.6 behavior, or a deployed production origin.

Separate historical checks have exercised a live GPT-5.6 complete trial and a real RTX 5070 in-memory Kokoro-to-Nemotron smoke. Neither was a human-microphone browser hearing. Keep those claims separate on stage.

## Before the clock starts

Complete setup from `README.md` and `docs/LOCAL_SPEECH.md` before the audience arrives. Use separate PowerShell windows for Convex, the Next.js application, and the local speech companion.

1. Synchronize the intended Convex development deployment with `npx convex dev --once`. Do not print service or API secrets.
2. Start the configured local CPU or CUDA speech companion and confirm `/healthz` plus `/v1/capabilities`. Liveness alone is not model readiness.
3. Start the application with `npm run dev` and open `/preflight`.
4. Select **Run server checks**. A cold successful check makes two small, billable, server-owned GPT-5.6 probes containing no case, transcript, or audio data.
5. Select **Prepare local audio**, grant microphone access if appropriate, and wait for ready provider/capture status. Select **Test speakers** and personally confirm audibility.
6. Open `/hearing?case=redwood-signal-retaliation`, but do not begin until the stopwatch starts.
7. Keep the latest verified deterministic success video available as a clearly labelled fallback. Never present it as a live microphone, GPU, or GPT run.

## Primary staged path: target 2:55

The automated budget starts immediately before hearing navigation and ends only after three consecutive stable Court Records projections. The staged operator path uses the same product checkpoints.

| Time | Operator action | Audience-facing point |
| ---: | --- | --- |
| 0:00 | Show **Rina Shah v. Redwood Signal Systems** and select **Begin V3 hearing**. | “The model proposes dialogue and actions; the deterministic engine validates and commits the record.” |
| 0:20 | Call **Rina Shah** and select **Prepare local audio** if the hearing has not connected yet. | Point out that the production courtroom is voice-first and has no text composer. |
| 0:35 | Ask: “Ms. Shah, when did you send the battery-safety complaint, and what did it report?” | Let the answer finish, then select **End examination**. |
| 1:00 | Call **Theo Morgan**. | Explain that each witness receives a role-specific knowledge view. |
| 1:10 | Ask: “Mr. Morgan, when did you open the complaint, and what change did you later make to the termination memorandum?” | Let the answer finish, then select **End examination**. |
| 1:40 | Select **Start spoken closing argument** and say: “The complaint preceded the revised rationale on the same day. The admitted record supports causation by a preponderance.” Select **Stop, rest, and close**. | The generated jury decision and coaching must cite the committed record. |
| 2:10 | When **Durable record complete** appears, reload the hearing once. | Show that the exact completed record resumes without another courtroom command. |
| 2:25 | Select **Open Court Records** and wait for the workspace to become ready. | Show the owner-bound privacy-safe projection and stable record hash. |
| 2:40 | Briefly open **Transcript**, **Model calls**, **Audio audit**, and **Debrief**. | Call out citations, explicit no-fallback policy, metadata-only audio audit, and transcript-grounded coaching. |
| 2:55 | Stop. | Reiterate that the case and result are fictional and educational. |

If the live path has not reached durable completion by 2:15, do not race the UI or invent an outcome. State which external component is still pending, preserve the durable trial, and switch to the labelled deterministic proof video or the already completed owner-bound record.

## Recovery card

These are operator recoveries, not instructions to bypass validation. Never claim a recovery was browser/video-proven unless the evidence column says so.

| Failure | Safe on-stage recovery | Evidence currently available |
| --- | --- | --- |
| Microphone permission denied | Keep the denial visible, explain that access is explicit, allow the site in browser permissions, then select **Prepare local audio** again. If permission cannot be granted, stop the live voice claim and use the labelled deterministic recording. | `src/lib/speech/audio-capture.test.ts` proves `NotAllowedError` becomes a safe `PERMISSION_DENIED`; `src/app/preflight/preflight-client.tsx` renders fixed retry guidance. The current mounted preflight smoke does not click or deny permission, so live browser recovery is still pending. |
| Speech companion disconnects | Restart the exact loopback companion if needed. Select **Prepare local audio again** for a recoverable disconnect; for a fatal connection state, reload the hearing only after the service is healthy. Do not accept a late transcript from the old connection. | `src/lib/speech/hearing-controller.test.ts` proves readiness revocation, active-speech termination, and late-final fencing. `src/app/hearing/page.tsx` exposes the safe re-prepare/reload actions. A mounted disconnect-and-reconnect recording is still pending. |
| OpenAI request times out | Leave the safe error visible. Select **Retry pending action** to retry the retained intent, or **Reload durable record** to return to the last committed state. Do not substitute authored dialogue or another provider. | `src/server/courtroom-ai/openai-errors.ts` classifies timeout failures; `src/server/hearing-api/http.test.ts` proves safe retry guidance; the hearing page retains the pending intent. A timeout-specific mounted recovery is still pending. |
| Model output is malformed | Explain that invalid structured output is rejected. After the bounded repair is exhausted, use **Retry pending action**; do not turn the invalid text into testimony, a ruling, or a verdict. | `src/server/courtroom-ai/structured-call.test.ts` proves one targeted semantic repair and fail-closed exhaustion across the shared structured-call boundary. A mounted malformed-output recovery is still pending. |
| Browser refresh | After a confirmed response, reload normally and show exact durable equality. If an action is pending, use **Reload durable record** and allow the owner-bound recovery endpoint to reconcile it; never repeat speech or a ruling manually. | `tests/e2e/hearing-objection.spec.ts` proves exact completed-hearing and Records reload with no extra command. Controller tests prove pending interruption recovery without duplicate ruling/playback. A mounted refresh during a pending action is still pending. |

The unavailable-WebGL browser fixture is an additional renderer fallback, not a substitute for any of the five required recoveries above.

## Repeatable deterministic proof

Run from the repository root in PowerShell:

```powershell
npm run test:e2e -- tests/e2e/hearing-objection.spec.ts --grep "completes two witnesses by voice"
```

The selected test fails if the staged path from initial hearing navigation through three consecutive stable Records projections exceeds `180000` ms. On success it attaches:

- `primary-demo-timing` (`application/json`) with the measured duration and limit;
- `complete-two-witness-trial` (`image/png`) at durable hearing completion;
- `complete-two-witness-records` (`image/png`) after the final Records/privacy/export assertions; and
- `complete-two-witness-trial` (`video/webm`) for the full automated run.

Playwright output is generated and git-ignored. Record the exact command, measured duration, artifact paths, hashes, and repeat count in `docs/build-week/VERIFICATION.md`; do not describe a local file as durable evidence unless it is retained by an agreed artifact store.

For reliability evidence before the hackathon, run the same selected test three times serially:

```powershell
npm run test:e2e -- tests/e2e/hearing-objection.spec.ts --grep "completes two witnesses by voice" --repeat-each=3 --workers=1
```

Report every run, including failures. A repeated deterministic pass does not widen the live microphone/GPU/GPT claim.
