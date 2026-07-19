"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import {
  MathUtils,
  Vector3,
  type Group,
  type Mesh,
  type Vector3Tuple,
} from "three";

import type {
  CourtroomAnimation,
  CourtroomPresentationFrame,
  CourtroomPresentationRuntimeSnapshot,
  CourtroomPresentationRuntimeState,
  CourtroomMouthShape,
  SceneActorKey,
} from "@/domain/courtroom-presentation";
import { selectCourtroomPresentationRuntime } from "@/domain/courtroom-presentation";

type CameraShot = CourtroomPresentationFrame["camera"]["shot"];
type CameraTransition = CourtroomPresentationFrame["camera"]["transition"];

type CourtroomCanvasProps = Readonly<{
  cameraShot: CameraShot;
  cameraTransition: CameraTransition;
  frame: CourtroomPresentationFrame;
  onContextLost: () => void;
  onContextRestored: () => void;
  onReady: () => void;
  presentationRuntime: CourtroomPresentationRuntimeState;
}>;

type CharacterFigureProps = Readonly<{
  frame: CourtroomPresentationFrame;
  presentationRuntime: CourtroomPresentationRuntimeState;
  runtimeSnapshot: CourtroomPresentationRuntimeSnapshot;
  slot: SceneActorKey;
  position: Vector3Tuple;
  color: string;
  scale?: number;
  rotationY?: number;
}>;

const cameraPoses = {
  courtroom_wide: {
    position: [0, 6.8, 13] as Vector3Tuple,
    target: [0, 1.4, -1.6] as Vector3Tuple,
  },
  judge_close: {
    position: [0, 4.5, 4.2] as Vector3Tuple,
    target: [0, 2.9, -4.7] as Vector3Tuple,
  },
  user_counsel_close: {
    position: [1.1, 3.1, 7.2] as Vector3Tuple,
    target: [-2.5, 1.35, 1.5] as Vector3Tuple,
  },
  opposing_counsel_close: {
    position: [-1.1, 3.1, 7.2] as Vector3Tuple,
    target: [2.5, 1.35, 1.5] as Vector3Tuple,
  },
  witness_close: {
    position: [0.8, 3.2, 4.8] as Vector3Tuple,
    target: [3.8, 1.35, -1.7] as Vector3Tuple,
  },
  jury_box: {
    position: [1.2, 4.4, 6.5] as Vector3Tuple,
    target: [-4.9, 1.25, -1.4] as Vector3Tuple,
  },
  evidence_display: {
    position: [0.6, 3.6, 6.5] as Vector3Tuple,
    target: [-2.7, 2.05, -3.6] as Vector3Tuple,
  },
  witness_counsel_two_shot: {
    position: [-0.5, 4, 8.4] as Vector3Tuple,
    target: [1.4, 1.3, -0.5] as Vector3Tuple,
  },
} as const;

function CameraDirector({
  cameraShot,
  cameraTransition,
  reducedMotion,
}: Readonly<{
  cameraShot: CameraShot;
  cameraTransition: CameraTransition;
  reducedMotion: boolean;
}>) {
  const invalidate = useThree((state) => state.invalidate);
  const desiredPosition = useRef(
    new Vector3(...cameraPoses.courtroom_wide.position),
  );
  const desiredTarget = useRef(
    new Vector3(...cameraPoses.courtroom_wide.target),
  );
  const currentTarget = useRef(
    new Vector3(...cameraPoses.courtroom_wide.target),
  );
  const moving = useRef(false);
  const transition = reducedMotion ? "cut" : cameraTransition;

  useEffect(() => {
    const pose = cameraPoses[cameraShot];
    desiredPosition.current.set(...pose.position);
    desiredTarget.current.set(...pose.target);
    moving.current = true;
    invalidate();
  }, [cameraShot, invalidate, transition]);

  useFrame(({ camera }, rawDelta) => {
    if (!moving.current) return;
    if (transition === "cut") {
      camera.position.copy(desiredPosition.current);
      currentTarget.current.copy(desiredTarget.current);
      camera.lookAt(currentTarget.current);
      moving.current = false;
      return;
    }

    const delta = Math.min(rawDelta, 1 / 15);
    camera.position.x = MathUtils.damp(
      camera.position.x,
      desiredPosition.current.x,
      7.5,
      delta,
    );
    camera.position.y = MathUtils.damp(
      camera.position.y,
      desiredPosition.current.y,
      7.5,
      delta,
    );
    camera.position.z = MathUtils.damp(
      camera.position.z,
      desiredPosition.current.z,
      7.5,
      delta,
    );
    currentTarget.current.x = MathUtils.damp(
      currentTarget.current.x,
      desiredTarget.current.x,
      8.5,
      delta,
    );
    currentTarget.current.y = MathUtils.damp(
      currentTarget.current.y,
      desiredTarget.current.y,
      8.5,
      delta,
    );
    currentTarget.current.z = MathUtils.damp(
      currentTarget.current.z,
      desiredTarget.current.z,
      8.5,
      delta,
    );
    camera.lookAt(currentTarget.current);

    const settled =
      camera.position.distanceToSquared(desiredPosition.current) < 0.0001 &&
      currentTarget.current.distanceToSquared(desiredTarget.current) < 0.0001;
    if (settled) {
      camera.position.copy(desiredPosition.current);
      currentTarget.current.copy(desiredTarget.current);
      camera.lookAt(currentTarget.current);
      moving.current = false;
      return;
    }
    invalidate();
  });

  return null;
}

function RendererLifecycle({
  onContextLost,
  onContextRestored,
  onReady,
}: Readonly<{
  onContextLost: () => void;
  onContextRestored: () => void;
  onReady: () => void;
}>) {
  const canvas = useThree((state) => state.gl.domElement);
  const invalidate = useThree((state) => state.invalidate);
  const reportedReady = useRef(false);

  useEffect(() => {
    const handleContextLost = (event: Event): void => {
      event.preventDefault();
      reportedReady.current = false;
      onContextLost();
    };
    const handleContextRestored = (): void => {
      onContextRestored();
      invalidate();
    };
    canvas.addEventListener("webglcontextlost", handleContextLost);
    canvas.addEventListener("webglcontextrestored", handleContextRestored);
    return () => {
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      canvas.removeEventListener("webglcontextrestored", handleContextRestored);
    };
  }, [canvas, invalidate, onContextLost, onContextRestored]);

  useFrame(() => {
    if (reportedReady.current) return;
    reportedReady.current = true;
    onReady();
  });

  return null;
}

function Box({
  position,
  size,
  color,
  rotation = [0, 0, 0],
  roughness = 0.72,
}: Readonly<{
  position: Vector3Tuple;
  size: Vector3Tuple;
  color: string;
  rotation?: Vector3Tuple;
  roughness?: number;
}>) {
  return (
    <mesh castShadow position={position} receiveShadow rotation={rotation}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={roughness} />
    </mesh>
  );
}

type SemanticPose = Readonly<{
  lift: number;
  leanX: number;
  leanZ: number;
  headPitch: number;
  headRoll: number;
  leftArmX: number;
  leftArmZ: number;
  rightArmX: number;
  rightArmZ: number;
  postureScaleY: number;
}>;

function semanticPose(
  animation: CourtroomAnimation,
  posture: "seated" | "standing",
  nowMs: number,
): SemanticPose {
  const postureScaleY = posture === "standing" ? 1.24 : 1;
  switch (animation) {
    case "idle":
      return {
        lift: 0,
        leanX: 0,
        leanZ: 0,
        headPitch: 0,
        headRoll: 0,
        leftArmX: 0,
        leftArmZ: -0.15,
        rightArmX: 0,
        rightArmZ: 0.15,
        postureScaleY,
      };
    case "listening":
      return {
        lift: 0,
        leanX: 0.025,
        leanZ: 0,
        headPitch: -0.055,
        headRoll: 0.035,
        leftArmX: 0,
        leftArmZ: -0.14,
        rightArmX: 0,
        rightArmZ: 0.14,
        postureScaleY,
      };
    case "thinking":
      return {
        lift: 0,
        leanX: -0.075,
        leanZ: -0.025,
        headPitch: 0.14,
        headRoll: -0.055,
        leftArmX: 0,
        leftArmZ: -0.12,
        rightArmX: -0.38,
        rightArmZ: -0.52,
        postureScaleY,
      };
    case "speaking": {
      const beat = Math.sin(nowMs * 0.009) * 0.025;
      return {
        lift: Math.sin(nowMs * 0.006) * 0.012,
        leanX: 0.045,
        leanZ: beat,
        headPitch: beat * 0.75,
        headRoll: 0,
        leftArmX: -0.08,
        leftArmZ: -0.38 - beat,
        rightArmX: 0.04,
        rightArmZ: 0.27 + beat,
        postureScaleY,
      };
    }
    case "objecting":
      return {
        lift: 0.14,
        leanX: 0.025,
        leanZ: 0.045,
        headPitch: -0.08,
        headRoll: 0,
        leftArmX: 0,
        leftArmZ: -0.2,
        rightArmX: -0.18,
        rightArmZ: -1.05,
        postureScaleY: 1.24,
      };
    case "standing":
      return {
        lift: 0.025,
        leanX: 0,
        leanZ: 0,
        headPitch: 0,
        headRoll: 0,
        leftArmX: 0,
        leftArmZ: -0.13,
        rightArmX: 0,
        rightArmZ: 0.13,
        postureScaleY: 1.24,
      };
    case "sitting":
      return {
        lift: -0.04,
        leanX: -0.035,
        leanZ: 0,
        headPitch: 0.035,
        headRoll: 0,
        leftArmX: 0,
        leftArmZ: -0.12,
        rightArmX: 0,
        rightArmZ: 0.12,
        postureScaleY: 0.96,
      };
    case "presenting_evidence":
      return {
        lift: 0.04,
        leanX: 0.1,
        leanZ: -0.035,
        headPitch: -0.03,
        headRoll: 0,
        leftArmX: -0.12,
        leftArmZ: -0.9,
        rightArmX: 0.05,
        rightArmZ: 0.32,
        postureScaleY: 1.24,
      };
    case "reacting": {
      const recoil = Math.sin(nowMs * 0.012) * 0.035;
      return {
        lift: 0.025,
        leanX: -0.1,
        leanZ: recoil,
        headPitch: 0.08,
        headRoll: recoil * 1.5,
        leftArmX: 0,
        leftArmZ: -0.24,
        rightArmX: 0,
        rightArmZ: 0.24,
        postureScaleY,
      };
    }
    case "ruling":
      return {
        lift: 0.035,
        leanX: 0.085,
        leanZ: 0,
        headPitch: -0.11,
        headRoll: 0,
        leftArmX: 0,
        leftArmZ: -0.18,
        rightArmX: -0.34,
        rightArmZ: -0.68,
        postureScaleY,
      };
    case "gavel": {
      const strike = Math.max(0, Math.sin(nowMs * 0.014));
      return {
        lift: 0.045,
        leanX: 0.1,
        leanZ: 0,
        headPitch: -0.12,
        headRoll: 0,
        leftArmX: 0,
        leftArmZ: -0.16,
        rightArmX: -0.55 - strike * 0.22,
        rightArmZ: -1.1 + strike * 0.58,
        postureScaleY,
      };
    }
  }
}

function runtimeMouthIsActive(
  snapshot: CourtroomPresentationRuntimeSnapshot,
): boolean {
  if (snapshot.source === "user_speech") return true;
  return snapshot.playback !== null && snapshot.playback.phase !== "requested";
}

function mouthScale(shape: CourtroomMouthShape): readonly [number, number] {
  switch (shape) {
    case "rest":
      return [0.72, 0.12];
    case "closed":
      return [0.92, 0.2];
    case "open":
      return [0.76, 1.2];
    case "wide":
      return [1.28, 0.62];
    case "round":
      return [0.54, 1.3];
    case "narrow":
      return [0.82, 0.34];
  }
}

function isLoopingPose(animation: CourtroomAnimation): boolean {
  return (
    animation === "speaking" ||
    animation === "reacting" ||
    animation === "gavel"
  );
}

function dampValue(
  current: number,
  target: number,
  delta: number,
  immediate: boolean,
): number {
  return immediate ? target : MathUtils.damp(current, target, 10, delta);
}

function CharacterFigure({
  frame,
  presentationRuntime,
  runtimeSnapshot,
  slot,
  position,
  color,
  scale = 1,
  rotationY = 0,
}: CharacterFigureProps) {
  const character = frame.characters.find(
    (candidate) => candidate.slot === slot,
  );
  const figure = useRef<Group>(null);
  const head = useRef<Mesh>(null);
  const leftArm = useRef<Mesh>(null);
  const rightArm = useRef<Mesh>(null);
  const mouth = useRef<Mesh>(null);
  const invalidate = useThree((state) => state.invalidate);
  const runtimeOwnsActor = runtimeSnapshot.sceneActor === slot;
  const animation =
    runtimeOwnsActor && runtimeSnapshot.animation
      ? runtimeSnapshot.animation
      : (character?.animation ?? "idle");
  const posture =
    runtimeOwnsActor && runtimeSnapshot.posture
      ? runtimeSnapshot.posture
      : (character?.posture ?? "seated");
  const mouthIsActive =
    runtimeOwnsActor && runtimeMouthIsActive(runtimeSnapshot);
  const reducedMotion = frame.reducedMotion || presentationRuntime.reducedMotion;
  const emphasis = character?.emphasis ?? 0;

  useEffect(() => {
    invalidate();
  }, [animation, emphasis, invalidate, mouthIsActive, posture, reducedMotion]);

  useFrame((_, rawDelta) => {
    if (
      !figure.current ||
      !head.current ||
      !leftArm.current ||
      !rightArm.current ||
      !mouth.current
    ) {
      return;
    }
    const nowMs = performance.now();
    const pose = semanticPose(
      animation,
      posture,
      reducedMotion ? 0 : nowMs,
    );
    const delta = Math.min(rawDelta, 1 / 15);
    const immediate = reducedMotion;
    const scaleBoost = scale * (1 + emphasis * 0.035);

    figure.current.position.y = dampValue(
      figure.current.position.y,
      position[1] + pose.lift,
      delta,
      immediate,
    );
    figure.current.rotation.x = dampValue(
      figure.current.rotation.x,
      pose.leanX,
      delta,
      immediate,
    );
    figure.current.rotation.z = dampValue(
      figure.current.rotation.z,
      pose.leanZ,
      delta,
      immediate,
    );
    figure.current.scale.x = dampValue(
      figure.current.scale.x,
      scaleBoost,
      delta,
      immediate,
    );
    figure.current.scale.y = dampValue(
      figure.current.scale.y,
      scaleBoost * pose.postureScaleY,
      delta,
      immediate,
    );
    figure.current.scale.z = dampValue(
      figure.current.scale.z,
      scaleBoost,
      delta,
      immediate,
    );
    head.current.rotation.x = dampValue(
      head.current.rotation.x,
      pose.headPitch,
      delta,
      immediate,
    );
    head.current.rotation.z = dampValue(
      head.current.rotation.z,
      pose.headRoll,
      delta,
      immediate,
    );
    leftArm.current.rotation.x = dampValue(
      leftArm.current.rotation.x,
      pose.leftArmX,
      delta,
      immediate,
    );
    leftArm.current.rotation.z = dampValue(
      leftArm.current.rotation.z,
      pose.leftArmZ,
      delta,
      immediate,
    );
    rightArm.current.rotation.x = dampValue(
      rightArm.current.rotation.x,
      pose.rightArmX,
      delta,
      immediate,
    );
    rightArm.current.rotation.z = dampValue(
      rightArm.current.rotation.z,
      pose.rightArmZ,
      delta,
      immediate,
    );

    const sampledRuntime = mouthIsActive
      ? selectCourtroomPresentationRuntime(presentationRuntime, nowMs)
      : null;
    const sampledShape =
      sampledRuntime?.sceneActor === slot
        ? reducedMotion
          ? "narrow"
          : sampledRuntime.mouthShape
        : "rest";
    const hasFutureMouthCue =
      sampledRuntime?.playback?.phase === "timed" &&
      sampledRuntime.mouthCues.some(({ endAtMs }) => endAtMs > nowMs);
    const [mouthWidth, mouthHeight] = mouthScale(sampledShape);
    mouth.current.scale.x = dampValue(
      mouth.current.scale.x,
      mouthWidth,
      delta,
      immediate,
    );
    mouth.current.scale.y = dampValue(
      mouth.current.scale.y,
      mouthHeight,
      delta,
      immediate,
    );

    const unsettled =
      Math.abs(figure.current.position.y - (position[1] + pose.lift)) > 0.001 ||
      Math.abs(figure.current.rotation.x - pose.leanX) > 0.001 ||
      Math.abs(figure.current.rotation.z - pose.leanZ) > 0.001 ||
      Math.abs(figure.current.scale.y - scaleBoost * pose.postureScaleY) >
        0.001 ||
      Math.abs(rightArm.current.rotation.z - pose.rightArmZ) > 0.001 ||
      Math.abs(mouth.current.scale.x - mouthWidth) > 0.001 ||
      Math.abs(mouth.current.scale.y - mouthHeight) > 0.001;
    if (
      unsettled ||
      (!reducedMotion &&
        (hasFutureMouthCue || isLoopingPose(animation)))
    ) {
      invalidate();
    }
  });

  if (!character?.present) return null;
  const skin = slot === "jury" ? "#8b654f" : "#a97a5c";
  const headHeight = 1.78;

  return (
    <group
      position={position}
      ref={figure}
      rotation={[0, rotationY, 0]}
      scale={scale}
    >
      <mesh castShadow position={[0, headHeight, 0]} ref={head}>
        <sphereGeometry args={[0.28, 18, 14]} />
        <meshStandardMaterial color={skin} roughness={0.78} />
      </mesh>
      <mesh castShadow position={[0, headHeight - 0.52, 0]}>
        <capsuleGeometry args={[0.34, 0.92, 6, 12]} />
        <meshStandardMaterial color={color} roughness={0.66} />
      </mesh>
      <mesh
        castShadow
        position={[-0.33, headHeight - 0.5, 0]}
        ref={leftArm}
        rotation={[0, 0, -0.15]}
      >
        <capsuleGeometry args={[0.09, 0.64, 4, 8]} />
        <meshStandardMaterial color={color} roughness={0.68} />
      </mesh>
      <mesh
        castShadow
        position={[0.33, headHeight - 0.5, 0]}
        ref={rightArm}
        rotation={[0, 0, 0.15]}
      >
        <capsuleGeometry args={[0.09, 0.64, 4, 8]} />
        <meshStandardMaterial color={color} roughness={0.68} />
      </mesh>
      <mesh position={[0, headHeight - 0.07, 0.265]} ref={mouth}>
        <boxGeometry args={[0.12, 0.035, 0.025]} />
        <meshStandardMaterial color="#391a19" />
      </mesh>
    </group>
  );
}

function Jury({
  frame,
  presentationRuntime,
  runtimeSnapshot,
}: Readonly<{
  frame: CourtroomPresentationFrame;
  presentationRuntime: CourtroomPresentationRuntimeState;
  runtimeSnapshot: CourtroomPresentationRuntimeSnapshot;
}>) {
  const positions: Vector3Tuple[] = [
    [-5.35, 0.42, -2.05],
    [-4.65, 0.42, -2.05],
    [-3.95, 0.42, -2.05],
    [-5.35, 0.42, -0.75],
    [-4.65, 0.42, -0.75],
    [-3.95, 0.42, -0.75],
  ];
  return (
    <group>
      {positions.map((position, index) => (
        <CharacterFigure
          color={index % 2 === 0 ? "#31485d" : "#6b4952"}
          frame={frame}
          key={`${position.join(":")}`}
          position={position}
          presentationRuntime={presentationRuntime}
          rotationY={0.18}
          runtimeSnapshot={runtimeSnapshot}
          scale={0.67}
          slot="jury"
        />
      ))}
    </group>
  );
}

function CourtroomArchitecture({ frame }: Readonly<{ frame: CourtroomPresentationFrame }>) {
  const displayColor =
    frame.display.mode === "evidence"
      ? "#c8d8d0"
      : "#25323b";
  return (
    <group>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[18, 18]} />
        <meshStandardMaterial color="#5a3c2b" roughness={0.91} />
      </mesh>
      <Box color="#31241f" position={[0, 4, -6]} size={[18, 8, 0.35]} />
      <Box color="#472d22" position={[0, 1.35, -4.9]} size={[5.4, 2.45, 1.5]} />
      <Box color="#6c4933" position={[0, 2.72, -5.12]} size={[4.1, 0.34, 1.05]} />
      <Box color="#513326" position={[-2.45, 0.7, 1.8]} size={[3.5, 1.15, 1.55]} />
      <Box color="#513326" position={[2.45, 0.7, 1.8]} size={[3.5, 1.15, 1.55]} />
      <Box color="#5d3b2b" position={[3.8, 0.78, -1.7]} size={[2.05, 1.4, 1.75]} />
      <Box color="#422b22" position={[-4.75, 0.6, -1.4]} size={[2.9, 1.08, 3.55]} />
      <Box color="#594033" position={[-2.65, 0.72, -3.25]} size={[2.35, 1.25, 1.35]} />
      <Box color="#2b211e" position={[-2.65, 2.25, -3.72]} size={[2.9, 2.15, 0.18]} />
      <Box
        color={displayColor}
        position={[-2.65, 2.25, -3.61]}
        roughness={0.42}
        size={[2.5, 1.75, 0.08]}
      />
      {[-6.7, -4.5, -2.3, 2.3, 4.5, 6.7].map((x) => (
        <Box
          color="#70503d"
          key={x}
          position={[x, 2.2, -5.75]}
          size={[0.08, 3.9, 0.08]}
        />
      ))}
    </group>
  );
}

function CanvasPerformanceMetadata({
  presentationRuntime,
  reducedMotion,
}: Readonly<{
  presentationRuntime: CourtroomPresentationRuntimeState;
  reducedMotion: boolean;
}>) {
  const canvas = useThree((state) => state.gl.domElement);
  const invalidate = useThree((state) => state.invalidate);
  const lastActor = useRef<string | null>(null);
  const lastShape = useRef<string | null>(null);

  useEffect(() => {
    invalidate();
  }, [invalidate, presentationRuntime.revision, reducedMotion]);

  useFrame(() => {
    const nowMs = performance.now();
    const snapshot = selectCourtroomPresentationRuntime(
      presentationRuntime,
      nowMs,
    );
    const active = runtimeMouthIsActive(snapshot);
    const shape = active && reducedMotion ? "narrow" : snapshot.mouthShape;
    const actor = active ? (snapshot.sceneActor ?? "none") : "none";
    if (lastActor.current !== actor) {
      canvas.setAttribute("data-mouth-actor", actor);
      lastActor.current = actor;
    }
    if (lastShape.current !== shape) {
      canvas.setAttribute("data-mouth-shape", shape);
      lastShape.current = shape;
    }
    const hasFutureMouthCue =
      snapshot.playback?.phase === "timed" &&
      snapshot.mouthCues.some(({ endAtMs }) => endAtMs > nowMs);
    if (!reducedMotion && hasFutureMouthCue) invalidate();
  });

  return null;
}

function CourtroomScene({
  cameraShot,
  cameraTransition,
  frame,
  onContextLost,
  onContextRestored,
  onReady,
  presentationRuntime,
}: CourtroomCanvasProps) {
  const runtimeSnapshot = selectCourtroomPresentationRuntime(
    presentationRuntime,
  );
  const reducedMotion = frame.reducedMotion || presentationRuntime.reducedMotion;
  return (
    <>
      <color args={["#17120f"]} attach="background" />
      <fog args={["#17120f", 12, 24]} attach="fog" />
      <ambientLight intensity={0.88} />
      <directionalLight
        castShadow={frame.quality !== "reduced"}
        intensity={2.15}
        position={[3, 9, 7]}
        shadow-mapSize-height={frame.quality === "high" ? 2048 : 1024}
        shadow-mapSize-width={frame.quality === "high" ? 2048 : 1024}
      />
      <pointLight color="#d9b36d" intensity={32} position={[-4, 4, 2]} />
      <CourtroomArchitecture frame={frame} />
      <CharacterFigure
        color="#4e2632"
        frame={frame}
        position={[0, 1.45, -4.72]}
        presentationRuntime={presentationRuntime}
        runtimeSnapshot={runtimeSnapshot}
        slot="judge"
      />
      <CharacterFigure
        color="#203b58"
        frame={frame}
        position={[-2.5, 0.25, 1.35]}
        presentationRuntime={presentationRuntime}
        rotationY={-0.08}
        runtimeSnapshot={runtimeSnapshot}
        slot="user_counsel"
      />
      <CharacterFigure
        color="#6b2638"
        frame={frame}
        position={[2.5, 0.25, 1.35]}
        presentationRuntime={presentationRuntime}
        rotationY={0.08}
        runtimeSnapshot={runtimeSnapshot}
        slot="opposing_counsel"
      />
      <CharacterFigure
        color="#315c50"
        frame={frame}
        position={[3.8, 0.45, -1.65]}
        presentationRuntime={presentationRuntime}
        rotationY={-0.22}
        runtimeSnapshot={runtimeSnapshot}
        slot="witness"
      />
      <CharacterFigure
        color="#4b4b48"
        frame={frame}
        position={[-2.65, 0.45, -3.05]}
        presentationRuntime={presentationRuntime}
        rotationY={0.1}
        runtimeSnapshot={runtimeSnapshot}
        scale={0.82}
        slot="clerk"
      />
      <Jury
        frame={frame}
        presentationRuntime={presentationRuntime}
        runtimeSnapshot={runtimeSnapshot}
      />
      <CameraDirector
        cameraShot={cameraShot}
        cameraTransition={cameraTransition}
        reducedMotion={reducedMotion}
      />
      <CanvasPerformanceMetadata
        presentationRuntime={presentationRuntime}
        reducedMotion={reducedMotion}
      />
      <RendererLifecycle
        onContextLost={onContextLost}
        onContextRestored={onContextRestored}
        onReady={onReady}
      />
    </>
  );
}

export default function CourtroomCanvas({
  cameraShot,
  cameraTransition,
  frame,
  onContextLost,
  onContextRestored,
  onReady,
  presentationRuntime,
}: CourtroomCanvasProps) {
  const dpr: number | [number, number] =
    frame.quality === "reduced"
      ? 1
      : frame.quality === "high"
        ? [1, 1.75]
        : [1, 1.35];
  return (
    <Canvas
      aria-hidden="true"
      camera={{ fov: 38, near: 0.1, far: 40, position: [0, 6.8, 13] }}
      dpr={dpr}
      fallback={<div>WebGL is unavailable. The hearing controls remain usable.</div>}
      frameloop="demand"
      gl={{
        antialias: frame.quality !== "reduced",
        powerPreference: "high-performance",
      }}
      shadows={frame.quality !== "reduced" ? "percentage" : false}
    >
      <CourtroomScene
        cameraShot={cameraShot}
        cameraTransition={cameraTransition}
        frame={frame}
        onContextLost={onContextLost}
        onContextRestored={onContextRestored}
        onReady={onReady}
        presentationRuntime={presentationRuntime}
      />
    </Canvas>
  );
}
