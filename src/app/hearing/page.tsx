"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";

import { api } from "../../../convex/_generated/api";
import { hearingProgress, hearingUrl, trialIdFromSearch } from "../../domain/hearing-journey";
import { outcomeLabel } from "../../domain/student-debrief";
import { voiceFallbackMessage } from "../../domain/voice";

const sampleQuestion = "Ms. Kapoor, 'disruptive escalation' was added after HR received Asha's safety complaint, correct?";
type VoiceInputTarget = "question" | "closing";

export default function HearingPage() {
  return (
    <Suspense fallback={<main className="hearing-shell"><section className="briefing-panel loading-panel" role="status"><div className="eyebrow">Restoring your session</div><h1>Checking the court record…</h1><p>If you were already in a hearing, you will return to the last completed step.</p></section></main>}>
      <HearingPageContent />
    </Suspense>
  );
}

function HearingPageContent() {
  const startHearing = useAction(api.participatory.start);
  const askWitness = useAction(api.participatory.askWitness);
  const addressCounsel = useAction(api.participatory.addressCounsel);
  const finishHearing = useAction(api.participatory.finish);
  const transcribeAudio = useAction(api.voice.transcribe);
  const synthesizeSpeech = useAction(api.voice.synthesize);
  const trackEvent = useMutation(api.events.track);
  const searchParams = useSearchParams();
  const [createdTrialId, setCreatedTrialId] = useState<string>();
  const [question, setQuestion] = useState("");
  const [interactionTarget, setInteractionTarget] = useState<"witness" | "counsel">("witness");
  const [closing, setClosing] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [voiceStatus, setVoiceStatus] = useState<string>();
  const [voiceInputTarget, setVoiceInputTarget] = useState<VoiceInputTarget>("question");
  const [recordingTarget, setRecordingTarget] = useState<VoiceInputTarget>();
  const [audioReady, setAudioReady] = useState(false);
  const [openingComplete, setOpeningComplete] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const spokenTurnRef = useRef<string | undefined>(undefined);
  const openingAttemptedRef = useRef(false);
  const juryAttemptedRef = useRef(false);
  const trialId = createdTrialId ?? trialIdFromSearch(searchParams.toString());
  const run = useQuery(api.trials.get, trialId ? { trialId } : "skip");

  const phase = run?.trial.phase;
  const outcome = outcomeLabel(run?.votes[0]?.vote);
  const witnessAnswerCount = run?.turns.filter((turn) => turn.actor === "Witness").length ?? 0;
  const progress = hearingProgress(phase, witnessAnswerCount);
  const canClose = useMemo(
    () => witnessAnswerCount > 0,
    [witnessAnswerCount],
  );


  useEffect(() => () => {
    recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    audioRef.current?.pause();
  }, []);

  async function playRoleSpeech(text: string, role: "judge" | "advocate" | "witness" | "juror_1" | "juror_2" | "juror_3") {
    const bytes = await synthesizeSpeech({ trialId: trialId!, text, role });
    const audio = new Audio(URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" })));
    audioRef.current?.pause();
    audioRef.current = audio;
    setAudioReady(true);
    await audio.play();
    await new Promise<void>((resolve, reject) => { audio.onended = () => resolve(); audio.onerror = () => reject(new Error("AUDIO_PLAYBACK_FAILED")); });
  }

  async function playRequiredOpenings() {
    const judge = run?.turns.find((turn) => turn.actor === "Judge");
    const advocate = run?.turns.find((turn) => turn.actor === "Vertex Advocate");
    if (!judge || !advocate) return;
    setVoiceStatus("Required opening 1 of 2 · Judge speaking");
    await playRoleSpeech(judge.text, "judge");
    setVoiceStatus("Required opening 2 of 2 · Vertex advocate speaking");
    await playRoleSpeech(advocate.text, "advocate");
    setOpeningComplete(true);
    setVoiceStatus("Openings complete · you may begin cross-examination.");
  }

  useEffect(() => {
    if (!trialId || phase !== "cross_examination" || openingAttemptedRef.current || !run?.turns.some((turn) => turn.actor === "Judge")) return;
    openingAttemptedRef.current = true;
    void playRequiredOpenings().catch(() => setVoiceStatus("Opening playback is required. Press Play required openings to continue."));
  }, [phase, run?.turns, trialId]);

  useEffect(() => {
    const witness = run?.turns.filter((turn) => turn.actor === "Witness").at(-1);
    if (!trialId || !witness || witness.turnId === spokenTurnRef.current) return;
    spokenTurnRef.current = witness.turnId;
    void (async () => {
      try {
        const bytes = await synthesizeSpeech({ trialId, text: witness.text, role: "witness" });
        const audio = new Audio(URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" })));
        audioRef.current?.pause();
        audioRef.current = audio;
        setAudioReady(true);
        setVoiceStatus("Witness audio ready.");
        try {
          await audio.play();
          setVoiceStatus("Witness speaking · Stop anytime");
        } catch {
          setVoiceStatus(voiceFallbackMessage("autoplay_blocked"));
        }
      } catch {
        setVoiceStatus(voiceFallbackMessage("tts_failed"));
      }
    })();
  }, [run?.turns, synthesizeSpeech, trialId]);

  useEffect(() => {
    if (!trialId || phase !== "complete" || juryAttemptedRef.current || !run?.votes.length) return;
    juryAttemptedRef.current = true;
    void (async () => {
      for (let index = 0; index < Math.min(run.votes.length, 3); index += 1) {
        setVoiceStatus(`Juror ${index + 1} speaking`);
        await playRoleSpeech(run.votes[index].reasoning, `juror_${index + 1}` as "juror_1" | "juror_2" | "juror_3");
      }
      setVoiceStatus("Jury deliberation complete.");
    })().catch(() => setVoiceStatus("Jury audio unavailable; the full deliberation remains visible."));
  }, [phase, run?.votes, trialId]);

  async function toggleRecording(target: VoiceInputTarget) {
    if (recordingTarget === target) {
      recorderRef.current?.stop();
      return;
    }
    setVoiceInputTarget(target);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setVoiceStatus(voiceFallbackMessage("permission_denied", target));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => void (async () => {
        setRecordingTarget(undefined);
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (!blob.size) {
          setVoiceStatus(voiceFallbackMessage("empty_audio", target));
          return;
        }
        setVoiceStatus("Transcribing with Scribe v2…");
        try {
          const transcript = await transcribeAudio({ trialId: trialId!, audio: await blob.arrayBuffer(), mimeType: blob.type });
          if (target === "closing") setClosing(transcript);
          else setQuestion(transcript);
          setVoiceStatus(`Transcript ready. Review or edit it, then ${target === "closing" ? "request the verdict" : interactionTarget === "witness" ? "ask the witness" : "address counsel"}.`);
        } catch {
          setVoiceStatus(voiceFallbackMessage("stt_failed", target));
        }
      })();
      recorder.start();
      setRecordingTarget(target);
      setVoiceStatus("Listening… press Stop recording when finished.");
    } catch {
      setVoiceStatus(voiceFallbackMessage("permission_denied", target));
    }
  }

  function stopPlayback() {
    audioRef.current?.pause();
    if (audioRef.current) audioRef.current.currentTime = 0;
    setVoiceStatus("Playback stopped. Text remains available.");
  }


  async function execute(work: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await work();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The court could not complete that action.");
    } finally {
      setBusy(false);
    }
  }

  async function beginHearing() {
    await execute(async () => {
      const id = await startHearing({});
      setCreatedTrialId(id);
      window.history.replaceState(null, "", hearingUrl(id));
    });
  }

  function downloadDebrief() {
    if (!run?.debrief) return;
    void trackEvent({
      trialId: run.trial.trialId,
      name: "debrief_downloaded",
      metadataJson: JSON.stringify({ format: "txt" }),
    });
    const text = [
      "SUITS — CASE DEBRIEF",
      "",
      `VERDICT: ${outcome.verdict}`,
      "",
      outcome.explanation.toUpperCase(),
      run.debrief.overallAssessment,
      "",
      "WHAT YOU DID WELL — KEY POINTS THAT HELPED YOUR CASE",
      ...run.debrief.strengths.map((item) => `- ${item.finding} [${item.turnCitations.join(", ")}]`),
      "",
      "MISTAKES AND MISSED OPPORTUNITIES",
      ...run.debrief.missedOpportunities.map((item) => `- ${item.finding}\n  Try: ${item.recommendedQuestion}`),
      "",
      "REVISED CLOSING",
      run.debrief.revisedClosing.text,
      "",
      ...run.debrief.limitations,
    ].join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `suits-debrief-${run.trial.trialId}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="hearing-shell">
      <header className="hearing-header">
        <Link className="brand" href="/">
          <span className="brand-mark">S</span><span>SUITS</span>
        </Link>
        <div className="phase-chip">Step {progress.step} of {progress.totalSteps} · {progress.label}</div>
        <Link className="text-link" href="/records/">Court Records</Link>
      </header>

      {!trialId || run === null ? (
        <section className="briefing-panel">
          <div className="eyebrow">Employment retaliation · fictional advocacy exercise</div>
          <h1>Asha Mehta v. Vertex Logistics Ltd.</h1>
          <p>You represent Asha Mehta. Your task is to prove that her May 14 warehouse-safety complaint materially influenced Vertex’s May 15 termination decision—not merely that the two events happened close together.</p>
          <div className="onboarding-grid">
            <article><span>Your burden</span><strong>Prove retaliatory causation</strong><p>Connect HR’s knowledge of the complaint to the final rationale and approval—not timing alone.</p></article>
            <article><span>Vertex’s defense</span><strong>The decision came first</strong><p>A termination draft existed on May 7 and two inventory reports were late.</p></article>
            <article><span>Your witness</span><strong>Elena Kapoor · HR Director</strong><p>Question her about the draft, complaint, revision history, warnings, and final approval.</p></article>
          </div>
          <div className="case-timeline"><strong>Case timeline</strong><span>May 7 · HR creates initial draft</span><span>May 14, 10:14 AM · Asha reports safety issue</span><span>May 14, 4:38 PM · “Disruptive escalation” added</span><span>May 15, 9:20 AM · termination approved</span></div>
          <div className="evidence-docket" aria-label="Available evidence">
            <div><b>E-001</b><span>Safety complaint</span><p>Sent at 10:14 AM on May 14.</p></div>
            <div><b>E-002</b><span>Termination letter</span><p>Approved May 15; cites performance and disruptive escalation.</p></div>
            <div><b>E-003</b><span>Report history</span><p>Two inventory reports were late.</p></div>
            <div><b>E-004</b><span>Initial draft</span><p>Created May 7, before the complaint.</p></div>
            <div><b>E-005</b><span>Revision history</span><p>Complaint-related language added after HR received the report.</p></div>
            <div><b>E-006</b><span>Personnel file</span><p>No formal warning or active performance plan.</p></div>
          </div>
          {(error || run === null) && <div className="error-banner" role="alert">{error ?? "We could not find that saved hearing. Start a new session below."}</div>}
          <button className="primary-button" disabled={busy} onClick={() => void beginHearing()}>
            {busy ? "Creating and saving your court record…" : "I’m ready — begin hearing"}
          </button>
          <p className="resume-note">Your trial ID is saved in this page’s URL, so refresh returns you to the same record.</p>
        </section>
      ) : run === undefined ? (
        <section className="briefing-panel loading-panel" role="status">
          <div className="eyebrow">Saved hearing found</div><h1>Reopening the record…</h1>
          <p>Loading your transcript and returning you to the last committed phase.</p>
        </section>
      ) : phase !== "complete" ? (
        <div className="hearing-grid">
          <section className="transcript-panel">
            <div className="progress-card" aria-live="polite">
              <div className="progress-track"><i style={{ width: `${(progress.step / progress.totalSteps) * 100}%` }} /></div>
              <div><span>Now · {progress.label}</span><strong>{progress.next}</strong></div>
            </div>
            <div className="panel-heading">
              <div><span>Live record</span><h1>Hearing transcript</h1></div>
              <span>{run?.turns.length ?? 0} turns</span>
            </div>
            <div className="transcript-list" aria-live="polite">
              {run?.turns.map((turn) => (
                <article className={`turn turn-${turn.speaker}`} key={turn.turnId}>
                  <div className="turn-meta">
                    <strong>{turn.actor}</strong>
                    <span>{turn.phase.replaceAll("_", " ")} · T-{String(turn.sequence).padStart(3, "0")}</span>
                  </div>
                  <p>{turn.text}</p>
                  {turn.evidenceIds.length > 0 && (
                    <div className="turn-evidence">{turn.evidenceIds.join(" · ")}</div>
                  )}
                </article>
              ))}
              {busy && <div className="thinking-line" role="status"><b>The court is working…</b><span>Your transcript is saved. You can safely refresh and resume from this URL.</span></div>}
            </div>

            {phase === "cross_examination" && (
              <div className="advocacy-box">
                {!openingComplete && <div className="required-opening" role="status"><strong>Required courtroom openings</strong><p>Hear the Judge and Vertex’s advocate in full before cross-examination unlocks.</p><button className="quiet-button" type="button" onClick={() => void playRequiredOpenings().catch(() => setVoiceStatus("Opening audio unavailable. Try again."))}>Play required openings</button></div>}
                <fieldset className="interaction-target">
                  <legend>Who are you addressing?</legend>
                  <label><input type="radio" name="interaction-target" checked={interactionTarget === "witness"} onChange={() => setInteractionTarget("witness")} /> Question witness</label>
                  <label><input type="radio" name="interaction-target" checked={interactionTarget === "counsel"} onChange={() => setInteractionTarget("counsel")} /> Address opposing counsel</label>
                </fieldset>
                <label htmlFor="question">{interactionTarget === "witness" ? "Question Elena Kapoor" : "Respond to Vertex’s counsel"}</label>
                <p className="action-coach">{interactionTarget === "witness" ? (witnessAnswerCount === 0 ? "Ask naturally about the May 7 draft, safety complaint, revision history, warnings, or final approval." : "Follow the answer: distinguish when termination was considered from what influenced final approval.") : "State your causation argument or ask Vertex to answer it from the admitted record."}</p>
                <div className="voice-primary">
                  <span>Primary input · voice</span>
                  <button className="voice-primary-button" type="button" disabled={!openingComplete || Boolean(recordingTarget && recordingTarget !== "question")} onClick={() => void toggleRecording("question")}>
                    {recordingTarget === "question" ? "■ Stop & transcribe" : "● Record your statement"}
                  </button>
                  <small>Your words appear below for review before anything is sent.</small>
                </div>
                {question ? <div className="transcript-preview">
                  <label htmlFor="question">Transcript preview · edit before sending</label>
                  <textarea id="question" value={question} onChange={(event) => setQuestion(event.target.value)} rows={3} />
                </div> : <details className="text-fallback">
                  <summary>Can’t use voice? Type instead</summary>
                  <textarea id="question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={interactionTarget === "witness" ? "For example: What changed in the termination memo after the complaint?" : "For example: The final rationale changed only after HR received Asha’s complaint."} rows={3} />
                </details>}
                <div className="input-actions submit-preview">
                  <button
                    className="primary-button"
                    disabled={!openingComplete || busy || question.trim().length < 8}
                    onClick={() => execute(async () => {
                      if (interactionTarget === "witness") await askWitness({ trialId, question: question.trim() });
                      else await addressCounsel({ trialId, statement: question.trim() });
                      setQuestion("");
                    })}
                  >
                    {interactionTarget === "witness" ? "Ask witness" : "Address counsel"}
                  </button>
                </div>
                {interactionTarget === "witness" && <details className="demo-fallback">
                  <summary>Need a recovery prompt?</summary>
                  <p>If you are stuck, load a focused timeline question and edit it in your own voice.</p>
                  <button className="quiet-button" type="button" onClick={() => setQuestion(sampleQuestion)}>Use recovery question</button>
                </details>}
                {voiceStatus && voiceInputTarget === "question" && <div className="voice-status" role="status">{voiceStatus}</div>}
                {audioReady && (
                  <div className="input-actions voice-controls">
                    <button className="quiet-button" type="button" onClick={() => void audioRef.current?.play().catch(() => setVoiceStatus(voiceFallbackMessage("autoplay_blocked")))}>Play response</button>
                    <button className="quiet-button" type="button" onClick={stopPlayback}>Stop playback</button>
                  </div>
                )}
              </div>
            )}

            {phase === "cross_examination" && canClose && (
              <div className="advocacy-box closing-box">
                <label htmlFor="closing">Deliver your closing</label>
                <p className="action-coach">Connect HR’s knowledge, the post-complaint revision, and final approval—then ask for a verdict for Asha.</p>
                <div className="voice-primary">
                  <span>Primary input · voice</span>
                  <button className="voice-primary-button" type="button" disabled={!openingComplete || Boolean(recordingTarget && recordingTarget !== "closing")} onClick={() => void toggleRecording("closing")}>
                    {recordingTarget === "closing" ? "■ Stop & transcribe" : "● Record your closing"}
                  </button>
                  <small>Your closing is transcribed for review before it reaches the jury.</small>
                </div>
                {closing ? <div className="transcript-preview">
                  <label htmlFor="closing">Transcript preview · edit before sending</label>
                  <textarea id="closing" value={closing} onChange={(event) => setClosing(event.target.value)} rows={4} />
                </div> : <details className="text-fallback">
                  <summary>Can’t use voice? Type your closing instead</summary>
                  <textarea id="closing" value={closing} onChange={(event) => setClosing(event.target.value)} placeholder="Explain why the transcript supports Asha…" rows={4} />
                </details>}
                {voiceStatus && voiceInputTarget === "closing" && <div className="voice-status" role="status">{voiceStatus}</div>}
                <button
                  className="primary-button submit-preview"
                  disabled={!openingComplete || busy || closing.trim().length < 20}
                  onClick={() => execute(async () => {
                    await finishHearing({ trialId, closing: closing.trim() });
                  })}
                >
                  Rest and request verdict
                </button>
              </div>
            )}
            {error && <div className="error-banner">{error}</div>}
          </section>

          <aside className="case-rail">
            <div className="rail-card"><span>Case posture</span><strong>You represent Asha Mehta</strong><p>Claimant · fictional retaliation hearing</p></div>
            <div className="rail-card"><span>Your objective</span><p>Show that the safety complaint influenced Vertex’s final termination rationale.</p></div>
            <div className="rail-card evidence-rail"><span>Key tension</span><p><b>Vertex</b> · May 7 draft</p><p><b>Asha</b> · post-complaint revision</p><p><b>Jury</b> · which fact actually caused the final decision?</p></div>
            <div className="rail-card"><span>System proof</span><p>{run?.traces.length ?? 0} observable agent operations recorded.</p></div>
          </aside>
        </div>
      ) : null}

      {phase === "complete" && run?.debrief && (
        <section className="debrief-panel">
          <div className="verdict-reveal"><span>Hearing complete · the record is closed</span><strong>{outcome.verdict}</strong><p>The verdict reflects this transcript—not the hidden “right answer.” Now turn the result into your next practice goal.</p></div>
          <div className="panel-heading">
            <div><span>Your coaching debrief</span><h1>What moved the jury—and what to try next</h1></div>
            <button className="quiet-button" onClick={downloadDebrief}>Download .txt</button>
          </div>
          <article className="outcome-analysis">
            <span>{outcome.explanation}</span>
            <p className="assessment">{run.debrief.overallAssessment}</p>
          </article>
          <div className="debrief-grid">
            <article><span>What you did well</span><h2>{run.debrief.strengths[0]?.finding}</h2><code>{run.debrief.strengths[0]?.turnCitations.join(" · ")}</code></article>
            <article><span>Mistakes and missed opportunities</span><h2>{run.debrief.missedOpportunities[0]?.finding}</h2><p>Try instead: {run.debrief.missedOpportunities[0]?.recommendedQuestion}</p></article>
            <article><span>How to improve your closing</span><h2>{run.debrief.revisedClosing.text}</h2></article>
          </div>
          <div className="debrief-actions">
            <button className="quiet-button" onClick={downloadDebrief}>Save my debrief</button>
            <Link className="primary-button" href={`/records/?trial=${trialId}`}>Inspect cited transcript & trace</Link>
          </div>
        </section>
      )}
    </main>
  );
}
