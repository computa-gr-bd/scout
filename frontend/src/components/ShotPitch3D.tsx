import { Suspense, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { Line, Text } from "@react-three/drei";
import * as THREE from "three";
import type { Group } from "three";
import type { UnderstatShot } from "../api/client";
import { CameraRig, type CameraPreset } from "./CameraRig";
import { PitchTurf3D, TURF_L, TURF_W } from "./PitchTurf3D";
import { estimatedTrajectory, resultKey, toWorld, type AttackSide } from "../lib/shotAnalytics";
import { ShotDetailCard } from "./ShotDetailCard";
import type { MatchInfo } from "../lib/matchLabel";

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
export type ShotViewMode = "attack" | "gk" | "def";

const HALF = TURF_L / 2;

// Um time só (ataque para a direita): câmera focada na metade ofensiva.
function presetsFor(bothSides: boolean, mode: ShotViewMode): Record<CameraView, CameraPreset> {
  const goalLabel = mode === "gk" ? "Visão do goleiro" : "Atrás do gol";
  const goal: CameraPreset = mode === "gk"
    ? { label: goalLabel, position: [HALF - 1.2, 1.9, 0], target: [HALF - 30, 1.2, 0] }
    : { label: goalLabel, position: [HALF + 26, 11, 0], target: [HALF - 14, 1.5, 0] };
  if (bothSides) {
    return {
      broadcast: { label: "Transmissão", position: [0, 62, 78], target: [0, 0, 0] },
      goal,
      top: { label: "Vista aérea", position: [0, 105, 0.01], target: [0, 0, 0] },
    };
  }
  return {
    broadcast: { label: "Transmissão", position: [16, 38, 52], target: [26, 0, 0] },
    goal,
    top: { label: "Vista aérea", position: [30, 78, 0.01], target: [30, 0, 0] },
  };
}

function radiusFor(xg: number | null) {
  return 0.55 + Math.min(0.9, (xg ?? 0) * 2.6);
}

function ShotMarker({
  item, index, selected, dim, onSelect,
}: { item: Shot3DItem; index: number; selected: boolean; dim: boolean; onSelect: (i: number) => void }) {
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
          roughness={0.35} metalness={0.1} transparent={dim} opacity={dim ? 0.3 : 1} />
      </mesh>
      {/* anel do time na base */}
      <mesh position={[0, -r + 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[r * 1.05, r * 1.35, 32]} />
        <meshBasicMaterial color={item.ring} transparent opacity={dim ? 0.25 : 0.9} />
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

/** Linha do chute até o gol: afina na origem, engrossa com o xG e termina num ponto na boca do gol. */
function Trajectory({ item, index, active, dim }: { item: Shot3DItem; index: number; active: boolean; dim: boolean }) {
  const points = useMemo(
    () => estimatedTrajectory(
      item.shot, item.shot.event_id ?? index, 28,
      item.pos ? { x: item.pos.x, y: item.pos.y, side: item.side ?? "right" } : undefined,
    ),
    [item.shot, item.pos, item.side, index]
  );
  const vertexColors = useMemo(() => {
    const c = new THREE.Color(item.color);
    return points.map((_, i) => {
      const k = 0.3 + 0.7 * (i / (points.length - 1));
      return [c.r * k, c.g * k, c.b * k] as [number, number, number];
    });
  }, [points, item.color]);
  const end = points[points.length - 1];
  const blocked = resultKey(item.shot) === "blocked";
  const w = 0.9 + Math.min(2.2, (item.shot.xg ?? 0) * 5);
  return (
    <group>
      <Line
        points={points}
        vertexColors={vertexColors}
        lineWidth={active ? w + 1.6 : w}
        transparent
        opacity={active ? 1 : dim ? 0.12 : 0.55}
      />
      {!blocked && (
        <mesh position={end}>
          <sphereGeometry args={[active ? 0.34 : 0.22, 12, 12]} />
          <meshBasicMaterial color={item.color} transparent opacity={active ? 1 : dim ? 0.15 : 0.8} />
        </mesh>
      )}
    </group>
  );
}

export function ShotPitch3D({
  items, showTrails = true, selected, onSelect, homeLabel, awayLabel, bothSides = false,
  mode = "attack", matchOf,
}: {
  items: Shot3DItem[];
  showTrails?: boolean;
  selected: number | null;
  onSelect: (index: number | null) => void;
  homeLabel?: string;
  awayLabel?: string;
  /** Cada time ataca um lado do campo (câmera mostra o campo inteiro). */
  bothSides?: boolean;
  /** attack: chutes do jogador · gk/def: chutes sofridos pelo time dele. */
  mode?: ShotViewMode;
  /** Partida de um chute (para identificar "Arsenal vs Man United"). */
  matchOf?: (s: UnderstatShot) => MatchInfo | undefined;
}) {
  const [view, setView] = useState<CameraView>("broadcast");
  const [spin, setSpin] = useState(false);
  const presets = useMemo(() => presetsFor(bothSides, mode), [bothSides, mode]);
  const preset = presets[view];
  const picked = selected != null ? items[selected] : null;
  const pickedMatch = picked && matchOf ? matchOf(picked.shot) : undefined;
  const twoTeams = !!homeLabel && !!awayLabel;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10" style={{ height: 540 }}>
      <Canvas key={String(bothSides)} shadows camera={{ position: preset.position, fov: 42, near: 0.5, far: 700 }} dpr={[1, 2]}
        onPointerMissed={() => onSelect(null)}>
        <color attach="background" args={["#0a0f1a"]} />
        <ambientLight intensity={0.8} />
        <directionalLight position={[30, 60, -20]} intensity={1.15} castShadow />
        <directionalLight position={[-30, 40, 30]} intensity={0.45} />
        <Suspense fallback={null}>
          <PitchTurf3D />
          {items.map((it, i) =>
            (showTrails || selected === i) ? (
              <Trajectory key={`t-${it.shot.event_id}-${i}`} item={it} index={i}
                active={selected === i} dim={selected != null && selected !== i} />
            ) : null
          )}
          {items.map((it, i) => (
            <ShotMarker key={`m-${it.shot.event_id}-${i}`} item={it} index={i}
              selected={selected === i} dim={selected != null && selected !== i} onSelect={onSelect} />
          ))}
          {bothSides ? (
            <>
              <Text position={[HALF - 12, 0.05, TURF_W / 2 + 3.2]} rotation={[-Math.PI / 2, 0, 0]} fontSize={1.8} color="#8794ad" anchorX="center">
                {`${homeLabel ?? "mandante"} ataca →`}
              </Text>
              <Text position={[-(HALF - 12), 0.05, TURF_W / 2 + 3.2]} rotation={[-Math.PI / 2, 0, 0]} fontSize={1.8} color="#8794ad" anchorX="center">
                {`← ${awayLabel ?? "visitante"} ataca`}
              </Text>
            </>
          ) : (
            <Text position={[HALF - 12, 0.05, TURF_W / 2 + 3.2]} rotation={[-Math.PI / 2, 0, 0]} fontSize={1.8} color="#8794ad" anchorX="center">
              {mode === "attack" ? "gol de ataque →" : "gol defendido →"}
            </Text>
          )}
        </Suspense>
        <CameraRig preset={preset} autoRotate={spin} />
      </Canvas>

      <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
        {(Object.keys(presets) as CameraView[]).map((v) => (
          <button key={v} onClick={() => setView(v)}
            className={`sv-btn !px-2.5 !py-1 text-[11px] ${view === v ? "!border-sv-accent3 !bg-sv-accent text-white" : ""}`}>
            {presets[v].label}
          </button>
        ))}
        <button onClick={() => setSpin((v) => !v)} aria-pressed={spin}
          className={`sv-btn !px-2.5 !py-1 text-[11px] ${spin ? "!border-sv-accent3 !bg-sv-accent text-white" : ""}`}>
          Girar
        </button>
      </div>

      <div className="absolute right-3 top-3 max-w-[50%] text-right text-[10px] leading-snug text-sv-muted">
        Esfera maior = maior xG
        {twoTeams && <> · anel azul/vermelho = {homeLabel}/{awayLabel}</>}
      </div>

      {picked && (
        <ShotDetailCard
          shot={picked.shot} color={picked.color} match={pickedMatch} onClose={() => onSelect(null)}
          className="absolute bottom-3 left-3 right-3 sm:right-auto sm:max-w-sm"
        />
      )}
    </div>
  );
}
