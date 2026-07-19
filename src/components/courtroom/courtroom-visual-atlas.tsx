"use client";

import { useMemo, useState } from "react";

import {
  CourtroomPresentationFrameSchema,
  type CourtroomQuality,
} from "@/domain/courtroom-presentation";

import { CourtroomStage } from "./courtroom-stage";
import {
  COURTROOM_VISUAL_ATLAS_STATE_IDS,
  createCourtroomVisualFixture,
  type CourtroomVisualAtlasStateId,
} from "./courtroom-visual-fixtures";

function stateLabel(stateId: CourtroomVisualAtlasStateId): string {
  return stateId.replaceAll("_", " ");
}

export function CourtroomVisualAtlas() {
  const [stateId, setStateId] =
    useState<CourtroomVisualAtlasStateId>(
      COURTROOM_VISUAL_ATLAS_STATE_IDS[0],
    );
  const [quality, setQuality] = useState<CourtroomQuality>("balanced");
  const fixture = useMemo(
    () => createCourtroomVisualFixture(stateId),
    [stateId],
  );
  const frame = useMemo(
    () =>
      CourtroomPresentationFrameSchema.parse({
        ...fixture.frame,
        quality,
      }),
    [fixture.frame, quality],
  );
  const sceneActor =
    fixture.runtimeSnapshot.sceneActor ?? frame.camera.target ?? "none";
  const activeCharacter = frame.characters.find(
    ({ slot }) => slot === sceneActor,
  );
  const animation =
    fixture.runtimeSnapshot.animation ?? activeCharacter?.animation ?? "idle";

  return (
    <main
      className="hearing-shell"
      data-atlas-animation={animation}
      data-atlas-display-mode={fixture.runtimeSnapshot.display.mode}
      data-atlas-display-phase={fixture.runtimeSnapshot.displayPhase}
      data-atlas-ruling-phase={fixture.runtimeSnapshot.rulingPhase}
      data-atlas-scene-actor={sceneActor}
      data-atlas-state={stateId}
      data-testid="courtroom-visual-atlas"
    >
      <section className="briefing-panel">
        <div className="eyebrow">Development-only visual verification</div>
        <h1>Deterministic courtroom state atlas</h1>
        <p>
          Synthetic renderer fixtures exercise the allowlisted visual contract.
          This route is unavailable in production and contains no case record,
          transcript, private settlement terms, or model provenance.
        </p>
        <div aria-label="Courtroom visual state" className="input-actions">
          {COURTROOM_VISUAL_ATLAS_STATE_IDS.map((candidate) => (
            <button
              aria-pressed={candidate === stateId}
              className="quiet-button"
              data-atlas-state-option={candidate}
              key={candidate}
              onClick={() => setStateId(candidate)}
              type="button"
            >
              {stateLabel(candidate)}
            </button>
          ))}
        </div>
        <div className="evidence-strip" aria-live="polite">
          <span>{fixture.title}</span>
          <span>{sceneActor}</span>
          <span>{animation}</span>
          <span>{fixture.runtimeSnapshot.displayPhase}</span>
          <span>{fixture.runtimeSnapshot.rulingPhase}</span>
        </div>
      </section>
      <CourtroomStage
        audibleSemanticPerformance={fixture.audibleSemanticPerformance}
        captureAtMs={fixture.captureAtMs}
        frame={frame}
        onQualityChange={setQuality}
        presentationRuntime={fixture.presentationRuntime}
        runtimeSnapshot={fixture.runtimeSnapshot}
      />
    </main>
  );
}
