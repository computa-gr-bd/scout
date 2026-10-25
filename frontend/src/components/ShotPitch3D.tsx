import { Suspense, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { Line, OrbitControls, Text } from "@react-three/drei";
import type { Group } from "three";
import type { UnderstatShot } from "../api/client";
import { Lines, PitchMesh, WIDTH } from "./Pitch3D";
import {
  RESULT_META, bodyLabel, distanceToGoal, estimatedTrajectory, fmt, resultKey, situationLabel, toWorld,
  type AttackSide,
} from "../lib/shotAnalytics";

export interface Shot3DItem {
  shot: UnderstatShot;
  color: string;
  /** Cor do anel na base (time). */
  ring: string;
  /** Posição de exibição (0-100) quando o time é espelhado para o outro lado do campo. */
  pos?: { x: number; y: number };
  /** Gol que o time ataca (padrão: direita). */
  side?: AttackSide;
}

type CameraView = "broadcast" | "goal" | "top";

type CameraPreset = { label: string; position: [number, number, number]; target: [number, number, number] };

// Um time só (ataque para a direita): câmera focada na metade ofensiva.
const CAMERA_PRESETS: Record<CameraView, CameraPreset> = {
  broadcast: { label: "Transmissão", position: [18, 40, 54], target: [26, 0, 0] },
  goal: { label: "Atrás do gol", position: [WIDTH / 2 + 26, 11, 0], target: [WIDTH / 2 - 14, 1.5, 0] },
  top: { label: "Vista aérea", position: [30, 78, 0.01], target: [30, 0, 0] },
};

// Cada time em um lado: câmera centrada no campo inteiro.
const CAMERA_PRESETS_BOTH: Record<CameraView, CameraPreset> = {
  broadcast: { label: "Transmissão", position: [0, 62, 78], target: [0, 0, 0] },
  goal: { label: "Atrás do gol", position: [WIDTH / 2 + 26, 11, 0], target: [WIDTH / 2 - 14, 1.5, 0] },
  top: { label: "Vista aérea", position: [0, 105, 0.01], target: [0, 0, 0] },
};

function radiusFor(xg: number | null) {
  return 0.55 + Math.min(0.9, (xg ?? 0) * 2.6);
}

function ShotMarker({
  item, index, selected, onSelect,
}: { item: Shot3DItem; index: number; selected: boolean; onSelect: (i: number) => void }) {
  const { shot } = item;
  const haloRef = useRef<Group>(null);
  const isGoal = resultKey(shot) === "goal";
  const r = radiusFor(shot.xg);
  const pos = toWorld(item.pos?.x ?? shot.x ?? 0, item.pos?.y ?? shot.y ?? 0, r);

  useFrame(({ clock }) => {
    if (!haloRef.current) return;
    if (isGoal || selected) {
      const k = 1 + Math.sin(clock.elapsedTime * 3 + index) * 0.12;
      haloRef.current.scale.set(k, k, k);
    }
  });

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onSelect(index);
  };

  return (
    <group position={pos}>
      <mesh castShadow onClick={handleClick}
        onPointerOver={() => { document.body.style.cursor = "pointer"; }}
        onPointerOut={() => { document.body.style.cursor = ""; }}>
        <sphereGeometry args={[r, 24, 24]} />
        <meshStandardMaterial color={item.color} emissive={item.color} emissiveIntensity={isGoal ? 0.55 : 0.2}
          roughness={0.35} metalness={0.1} />
      </mesh>
      {/* anel do time na base */}
      <mesh position={[0, -r + 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[r * 1.05, r * 1.35, 32]} />
        <meshBasicMaterial color={item.ring} transparent opacity={0.9} />
      </mesh>
      {(isGoal || selected) && (
        <group ref={haloRef}>
          <mesh position={[0, -r + 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[r * 1.7, r * 1.85, 40]} />
            <meshBasicMaterial color={selected ? "#ffffff" : item.color} transparent opacity={0.75} />
          </mesh>
        </group>
      )}
    </group>
  );
}

function Trajectory({ item, index, active, dim }: { item: Shot3DItem; index: number; active: boolean; dim: boolean }) {
  const points = useMemo(
    () => estimatedTrajectory(
      item.shot, item.shot.event_id ?? index, 22,
      item.pos ? { x: item.pos.x, y: item.pos.y, side: item.side ?? "right" } : undefined,
    ),
    [item.shot, item.pos, item.side, index]
  );
  return (
    <Line
      points={points}
      color={item.color}
      lineWidth={active ? 2.6 : 1}
      transparent
      opacity={active ? 0.95 : dim ? 0.12 : 0.38}
    />
  );
}

export function ShotPitch3D({
  items, showTrails = true, selected, onSelect, homeLabel, awayLabel, bothSides = false,
}: {
  items: Shot3DItem[];
  showTrails?: boolean;
  selected: number | null;
  onSelect: (index: number | null) => void;
  homeLabel?: string;
  awayLabel?: string;
  /** Cada time ataca um lado do campo (câmera mostra o campo inteiro). */
  bothSides?: boolean;
}) {
  const [view, setView] = useState<CameraView>("broadcast");
  const presets = bothSides ? CAMERA_PRESETS_BOTH : CAMERA_PRESETS;
  const preset = presets[view];
  const picked = selected != null ? items[selected] : null;

  return (
    <div className="relative rounded-2xl overflow-hidden border border-white/10" style={{ height: 520 }}>
      <Canvas key={`${view}-${bothSides}`} shadows camera={{ position: preset.position, fov: 42 }} dpr={[1, 2]}
        onPointerMissed={() => onSelect(null)}>
        <color attach="background" args={["#0a0f1a"]} />
        <ambientLight intensity={0.65} />
        <directionalLight position={[30, 60, -20]} intensity={1.2} castShadow />
        <directionalLight position={[-30, 40, 30]} intensity={0.5} />
        <Suspense fallback={null}>
          <PitchMesh />
          <Lines />
          {items.map((it, i) =>
            (showTrails || selected === i) ? (
              <Trajectory key={`t-${it.shot.event_id}-${i}`} item={it} index={i}
                active={selected === i} dim={selected != null && selected !== i} />
            ) : null
          )}
          {items.map((it, i) => (
            <ShotMarker key={`m-${it.shot.event_id}-${i}`} item={it} index={i}
              selected={selected === i} onSelect={onSelect} />
          ))}
          {bothSides ? (
            <>
              <Text position={[WIDTH / 2 - 10, 0.1, 40]} fontSize={1.8} color="#8794ad" anchorX="center">
                {`${homeLabel ?? "mandante"} ataca →`}
              </Text>
              <Text position={[-(WIDTH / 2) + 10, 0.1, 40]} fontSize={1.8} color="#8794ad" anchorX="center">
                {`← ${awayLabel ?? "visitante"} ataca`}
              </Text>
            </>
          ) : (
            <Text position={[WIDTH / 2 - 8, 0.1, 40]} fontSize={1.8} color="#8794ad" anchorX="center">
              gol de ataque →
            </Text>
          )}
        </Suspense>
        <OrbitControls enablePan={false} target={preset.target} minDistance={18} maxDistance={140}
          maxPolarAngle={Math.PI / 2.05} />
      </Canvas>

      <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
        {(Object.keys(presets) as CameraView[]).map((v) => (
          <button key={v} onClick={() => setView(v)}
            className={`sv-btn !px-2.5 !py-1 text-[11px] ${view === v ? "!border-sv-accent3 !bg-sv-accent text-white" : ""}`}>
            {presets[v].label}
          </button>
        ))}
      </div>

      <div className="absolute right-3 top-3 max-w-[55%] text-right text-[10px] leading-snug text-sv-muted">
        Esfera maior = maior xG · anel azul/vermelho = {homeLabel ?? "mandante"}/{awayLabel ?? "visitante"}
        <br />Trajetórias são estimadas: a fonte informa só a origem do chute.
      </div>

      {picked && (
        <div className="absolute left-3 bottom-3 right-3 sm:right-auto sm:max-w-sm rounded-xl border border-sv-border bg-sv-panel/95 p-3 text-xs shadow-lg backdrop-blur">
          <div className="mb-1 flex items-center justify-between gap-2">
            <div className="truncate text-sm font-semibold">
              {picked.shot.minute != null ? `${picked.shot.minute}' · ` : ""}{picked.shot.player ?? "Jogador desconhecido"}
            </div>
            <button className="text-sv-muted hover:text-white" onClick={() => onSelect(null)} aria-label="Fechar">×</button>
          </div>
          <div className="mb-2 flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: picked.color }} />
            <span>{RESULT_META[resultKey(picked.shot)].label}</span>
            <span className="text-sv-muted">· {picked.shot.team ?? "—"}</span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <span className="text-sv-muted">xG <b className="ml-1 text-white">{fmt(picked.shot.xg)}</b></span>
            <span className="text-sv-muted">Distância <b className="ml-1 text-white">
              {picked.shot.x != null && picked.shot.y != null ? `${distanceToGoal(picked.shot.x, picked.shot.y).toFixed(1)} m` : "—"}
            </b></span>
            <span className="text-sv-muted">Situação <b className="ml-1 text-white">{situationLabel(picked.shot.situation)}</b></span>
            <span className="text-sv-muted">Parte do corpo <b className="ml-1 text-white">{bodyLabel(picked.shot.body_part)}</b></span>
            {picked.shot.assisted_by && (
              <span className="col-span-2 text-sv-muted">Assistência <b className="ml-1 text-white">{picked.shot.assisted_by}</b></span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
