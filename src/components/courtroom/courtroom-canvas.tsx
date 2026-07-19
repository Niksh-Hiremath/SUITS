"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import type { Vector3Tuple } from "three";

import type {
  CourtroomPresentationFrame,
  SceneActorKey,
} from "@/domain/courtroom-presentation";

type CourtroomCanvasProps = Readonly<{
  frame: CourtroomPresentationFrame;
  onContextLost: () => void;
  onContextRestored: () => void;
  onReady: () => void;
}>;

type CharacterFigureProps = Readonly<{
  frame: CourtroomPresentationFrame;
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

function CameraDirector({ frame }: Readonly<{ frame: CourtroomPresentationFrame }>) {
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    const pose = cameraPoses[frame.camera.shot];
    camera.position.set(...pose.position);
    camera.lookAt(...pose.target);
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, frame.camera.shot, invalidate]);

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

function CharacterFigure({
  frame,
  slot,
  position,
  color,
  scale = 1,
  rotationY = 0,
}: CharacterFigureProps) {
  const state = frame.characters.find((character) => character.slot === slot);
  if (!state?.present) return null;
  const standing = state.posture === "standing";
  const activeLift = state.animation === "objecting" ? 0.14 : 0;
  const lean =
    state.animation === "thinking"
      ? -0.08
      : state.animation === "presenting_evidence"
        ? 0.1
        : 0;
  const scaleBoost = 1 + state.emphasis * 0.035;
  const skin = slot === "jury" ? "#8b654f" : "#a97a5c";
  const headHeight = standing ? 2.18 : 1.72;
  const bodyHeight = standing ? 1.2 : 0.92;

  return (
    <group
      position={[position[0], position[1] + activeLift, position[2]]}
      rotation={[lean, rotationY, 0]}
      scale={scale * scaleBoost}
    >
      <mesh castShadow position={[0, headHeight, 0]}>
        <sphereGeometry args={[0.28, 18, 14]} />
        <meshStandardMaterial color={skin} roughness={0.78} />
      </mesh>
      <mesh castShadow position={[0, headHeight - 0.52, 0]}>
        <capsuleGeometry args={[0.34, bodyHeight, 6, 12]} />
        <meshStandardMaterial color={color} roughness={0.66} />
      </mesh>
      <mesh
        castShadow
        position={[
          state.animation === "presenting_evidence" ? -0.45 : -0.33,
          headHeight - 0.5,
          0,
        ]}
        rotation={[0, 0, state.animation === "presenting_evidence" ? -0.9 : -0.15]}
      >
        <capsuleGeometry args={[0.09, 0.64, 4, 8]} />
        <meshStandardMaterial color={color} roughness={0.68} />
      </mesh>
      <mesh
        castShadow
        position={[
          state.animation === "objecting" ? 0.52 : 0.33,
          state.animation === "objecting" ? headHeight - 0.18 : headHeight - 0.5,
          0,
        ]}
        rotation={[0, 0, state.animation === "objecting" ? -1.05 : 0.15]}
      >
        <capsuleGeometry args={[0.09, 0.64, 4, 8]} />
        <meshStandardMaterial color={color} roughness={0.68} />
      </mesh>
      {state.animation === "speaking" && (
        <mesh position={[0, headHeight - 0.07, 0.265]}>
          <boxGeometry args={[0.12, 0.035, 0.025]} />
          <meshStandardMaterial color="#391a19" />
        </mesh>
      )}
    </group>
  );
}

function Jury({ frame }: Readonly<{ frame: CourtroomPresentationFrame }>) {
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
          rotationY={0.18}
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

function CourtroomScene({
  frame,
  onContextLost,
  onContextRestored,
  onReady,
}: CourtroomCanvasProps) {
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
        slot="judge"
      />
      <CharacterFigure
        color="#203b58"
        frame={frame}
        position={[-2.5, 0.25, 1.35]}
        rotationY={-0.08}
        slot="user_counsel"
      />
      <CharacterFigure
        color="#6b2638"
        frame={frame}
        position={[2.5, 0.25, 1.35]}
        rotationY={0.08}
        slot="opposing_counsel"
      />
      <CharacterFigure
        color="#315c50"
        frame={frame}
        position={[3.8, 0.45, -1.65]}
        rotationY={-0.22}
        slot="witness"
      />
      <CharacterFigure
        color="#4b4b48"
        frame={frame}
        position={[-2.65, 0.45, -3.05]}
        rotationY={0.1}
        scale={0.82}
        slot="clerk"
      />
      <Jury frame={frame} />
      <CameraDirector frame={frame} />
      <RendererLifecycle
        onContextLost={onContextLost}
        onContextRestored={onContextRestored}
        onReady={onReady}
      />
    </>
  );
}

export default function CourtroomCanvas({
  frame,
  onContextLost,
  onContextRestored,
  onReady,
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
        frame={frame}
        onContextLost={onContextLost}
        onContextRestored={onContextRestored}
        onReady={onReady}
      />
    </Canvas>
  );
}
