/**
 * ShotHeat3D.tsx — mapa de calor 3D dos chutes ("relevo de calor") com reprodução.
 *
 * Usa a mesma densidade (KDE em metros) do mapa de calor do Studio, então altura e cor significam
 * "concentração de chutes (ou de xG) por m²". O que o 3D acrescenta ao mapa 2D:
 *   • o relevo CRESCE e ENCOLHE com animação quando o filme (minuto a minuto ou jogo a jogo) avança,
 *     sempre na escala do período inteiro, para dar para ver a montanha se formando;
 *   • cada chute é uma bola sobre o relevo (tamanho = xG, cor = resultado, anel = partida);
 *   • passe o mouse / clique numa bola e ela diz em qual partida foi ("Arsenal vs Man United");
 *   • chips de partidas: clique para destacar só os chutes daquele jogo;
 *   • relevo × colunas, altura, corte (esconde o que está abaixo de X % do pico) e suavização;
 *   • pico marcado no campo, sonda de região ao passar o mouse sobre o relevo;
 *   • câmeras prontas (3/4, aérea, rasante, atrás do gol / visão do goleiro) com voo suave e giro automático.
 */
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { CameraRig, type CameraPreset } from "./CameraRig";
import { PitchTurf3D, TURF_L, TURF_W } from "./PitchTurf3D";
import { ShotDetailCard } from "./ShotDetailCard";
import type { Shot3DItem, ShotViewMode } from "./ShotPitch3D";
import {
  HEAT_CUTOFF, RAMP_SPECTRAL, buildLut, chooseBandwidth, computeKde, eventsWithin, toMeters, zoneAt,
  type KdeGrid, type KdeSample,
} from "../lib/heatmapKde";
import { RESULT_META, fmt, resultKey, toWorld } from "../lib/shotAnalytics";
import type { MatchInfo } from "../lib/matchLabel";

type CamKey = "tilt" | "aerial" | "low" | "goal";
type TerrainMode = "relief" | "columns";
type Smooth = "precise" | "normal" | "smooth";

const CELL = 1; // m — resolução da grade de densidade
const TILE = 3; // m — lado de cada coluna
const HMAX = 14; // m — altura do pico (100 % da escala) com Altura = 1×
const BASE_Y = 0.05;
const HALF = TURF_L / 2;
const PROBE_R = 8; // m
const SMOOTH_FACTOR: Record<Smooth, number> = { precise: 0.78, normal: 1, smooth: 1.35 };
const SMOOTH_LABEL: Record<Smooth, string> = { precise: "Preciso", normal: "Padrão", smooth: "Suave" };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const nf = (v: number, d = 1) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });

/** Altura (m, ×1) de uma célula com densidade normalizada `t`; `cut` esconde o que fica abaixo do corte. */
function heightOf(t: number, cut: number) {
  const v = clamp(t, 0, 1);
  const vis = smoothstep(HEAT_CUTOFF, HEAT_CUTOFF + 0.1, v) * (cut > 0 ? smoothstep(cut, cut + 0.06, v) : 1);
  return HMAX * Math.pow(v, 0.9) * vis;
}

/** LUT sRGB (RGBA 8 bits) → cores lineares, que é o que o three espera em vertexColors. */
function linearLut(lut: Uint8ClampedArray): Float32Array {
  const out = new Float32Array(256 * 3);
  const c = new THREE.Color();
  for (let k = 0; k < 256; k++) {
    c.setRGB(lut[k * 4] / 255, lut[k * 4 + 1] / 255, lut[k * 4 + 2] / 255, THREE.SRGBColorSpace);
    out[k * 3] = c.r; out[k * 3 + 1] = c.g; out[k * 3 + 2] = c.b;
  }
  return out;
}

const worldX = (mx: number) => mx - HALF;
const worldZ = (my: number) => TURF_W / 2 - my; // mesma convenção de toWorld()

function presetsFor(bothSides: boolean, mode: ShotViewMode): Record<CamKey, CameraPreset> {
  const goal: CameraPreset = mode === "gk"
    ? { label: "Visão do goleiro", position: [HALF - 1.2, 2.4, 0], target: [HALF - 32, 2, 0] }
    : { label: "Atrás do gol", position: [HALF + 30, 15, 0], target: [HALF - 20, 2, 0] };
  if (bothSides) {
    return {
      tilt: { label: "3/4", position: [0, 72, 92], target: [0, 0, 0] },
      aerial: { label: "Aérea", position: [0, 112, 0.01], target: [0, 0, 0] },
      low: { label: "Rasante", position: [0, 14, 74], target: [0, 3, 0] },
      goal,
    };
  }
  return {
    tilt: { label: "3/4", position: [10, 44, 62], target: [30, 0, 0] },
    aerial: { label: "Aérea", position: [30, 90, 0.01], target: [30, 0, 0] },
    low: { label: "Rasante", position: [22, 9, 60], target: [32, 3, 0] },
    goal,
  };
}

// ---------------------------------------------------------------------------
// Relevo animado
// ---------------------------------------------------------------------------
function Terrain({
  targetT, cols, rows, mode, scale, cut, lut, lin, cellH, onProbe,
}: {
  targetT: Float32Array; cols: number; rows: number; mode: TerrainMode; scale: number; cut: number;
  lut: Uint8ClampedArray; lin: Float32Array; cellH: { current: Float32Array };
  onProbe: (p: { mx: number; my: number } | null) => void;
}) {
  const curT = useRef(new Float32Array(cols * rows));
  const dirty = useRef(true);
  const instRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const tmpColor = useMemo(() => new THREE.Color(), []);

  const geo = useMemo(() => {
    const pos = new Float32Array(cols * rows * 3);
    const col = new Float32Array(cols * rows * 4);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i;
        pos[k * 3] = worldX((i + 0.5) * CELL);
        pos[k * 3 + 2] = worldZ((j + 0.5) * CELL);
      }
    }
    const index = new Uint32Array((cols - 1) * (rows - 1) * 6);
    let q = 0;
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
        index[q++] = a; index[q++] = b; index[q++] = c;
        index[q++] = b; index[q++] = d; index[q++] = c;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 4));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    return g;
  }, [cols, rows]);
  useEffect(() => () => geo.dispose(), [geo]);

  const tilesX = Math.ceil(cols / TILE);
  const tilesY = Math.ceil(rows / TILE);

  useEffect(() => { dirty.current = true; }, [scale, cut, mode, lut, lin]);
  useLayoutEffect(() => { dirty.current = true; }, [geo]);

  useFrame((_, dt) => {
    const cur = curT.current;
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * 4.5);
    let moving = false;
    for (let i = 0; i < cur.length; i++) {
      const d = targetT[i] - cur[i];
      if (d === 0) continue;
      if (Math.abs(d) > 0.0007) cur[i] += d * k;
      else cur[i] = targetT[i];
      moving = true;
    }
    if (!moving && !dirty.current) return;
    dirty.current = false;
    const heights = cellH.current;

    if (mode === "relief") {
      const pos = geo.getAttribute("position") as THREE.BufferAttribute;
      const col = geo.getAttribute("color") as THREE.BufferAttribute;
      const pa = pos.array as Float32Array;
      const ca = col.array as Float32Array;
      for (let n = 0; n < cur.length; n++) {
        const t = cur[n];
        const h = heightOf(t, cut) * scale;
        heights[n] = h;
        pa[n * 3 + 1] = h;
        const idx = Math.round(clamp(t, 0, 1) * 255);
        ca[n * 4] = lin[idx * 3]; ca[n * 4 + 1] = lin[idx * 3 + 1]; ca[n * 4 + 2] = lin[idx * 3 + 2];
        ca[n * 4 + 3] = h > 0.02 ? Math.min(1, (lut[idx * 4 + 3] / 255) * 1.15) : 0;
      }
      pos.needsUpdate = true;
      col.needsUpdate = true;
      geo.computeVertexNormals();
    } else {
      const m = instRef.current;
      if (!m) return;
      for (let tj = 0; tj < tilesY; tj++) {
        for (let ti = 0; ti < tilesX; ti++) {
          let sum = 0, n = 0;
          const j1 = Math.min(rows, (tj + 1) * TILE), i1 = Math.min(cols, (ti + 1) * TILE);
          for (let j = tj * TILE; j < j1; j++) for (let i = ti * TILE; i < i1; i++) { sum += cur[j * cols + i]; n++; }
          const t = n ? sum / n : 0;
          const h = heightOf(t, cut) * scale;
          const id = tj * tilesX + ti;
          for (let j = tj * TILE; j < j1; j++) for (let i = ti * TILE; i < i1; i++) heights[j * cols + i] = h;
          const cx = worldX(Math.min(TURF_L, (ti + 0.5) * TILE));
          const cz = worldZ(Math.min(TURF_W, (tj + 0.5) * TILE));
          dummy.position.set(cx, h / 2, cz);
          dummy.scale.set(TILE * 0.9, Math.max(h, 0.0001), TILE * 0.9);
          dummy.updateMatrix();
          m.setMatrixAt(id, dummy.matrix);
          const idx = Math.round(clamp(t, 0, 1) * 255);
          tmpColor.setRGB(lin[idx * 3], lin[idx * 3 + 1], lin[idx * 3 + 2]);
          m.setColorAt(id, tmpColor);
        }
      }
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  });

  const handleMove = (e: ThreeEvent<PointerEvent>) => {
    onProbe({ mx: e.point.x + HALF, my: TURF_W / 2 - e.point.z });
  };

  return (
    <group position={[0, BASE_Y, 0]}>
      <mesh geometry={geo} visible={mode === "relief"} onPointerMove={handleMove} onPointerOut={() => onProbe(null)}>
        <meshStandardMaterial vertexColors transparent side={THREE.DoubleSide} roughness={0.6} metalness={0.05} toneMapped={false} />
      </mesh>
      <instancedMesh
        ref={instRef} args={[undefined, undefined, tilesX * tilesY]} visible={mode === "columns"} frustumCulled={false}
        onPointerMove={handleMove} onPointerOut={() => onProbe(null)}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.55} metalness={0.05} toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Bolas (chutes) sobre o relevo
// ---------------------------------------------------------------------------
function ballRadius(xg: number | null) {
  return 0.5 + Math.min(0.85, (xg ?? 0) * 2.4);
}

function HeatBall({
  item, index, match, ringColor, selected, dim, show, cellH, cols, rows, segs, onSelect,
}: {
  item: Shot3DItem; index: number; match?: MatchInfo; ringColor: string; selected: boolean; dim: boolean;
  show: boolean; cellH: { current: Float32Array }; cols: number; rows: number; segs: number;
  onSelect: (i: number) => void;
}) {
  const { shot } = item;
  const [hover, setHover] = useState(false);
  const group = useRef<THREE.Group>(null);
  const stalk = useRef<THREE.Mesh>(null);
  const grow = useRef(0);
  const r = ballRadius(shot.xg);
  const isGoal = resultKey(shot) === "goal";
  const [px, , pz] = toWorld(item.pos?.x ?? shot.x ?? 0, item.pos?.y ?? shot.y ?? 0, 0);

  useFrame(({ clock }, dt) => {
    const g = group.current;
    if (!g) return;
    grow.current += (1 - grow.current) * (1 - Math.exp(-Math.min(dt, 0.1) * 7)); // "pop" ao aparecer
    const i = clamp(Math.floor((px + HALF) / CELL), 0, cols - 1);
    const j = clamp(Math.floor((TURF_W / 2 - pz) / CELL), 0, rows - 1);
    const h = cellH.current[j * cols + i] ?? 0;
    const bob = isGoal || selected ? Math.sin(clock.elapsedTime * 3 + index) * 0.12 : 0;
    g.position.set(px, h + r + 0.35 + bob, pz);
    const s = grow.current * (selected || hover ? 1.18 : 1);
    g.scale.setScalar(Math.max(0.001, s));
    if (stalk.current) {
      // haste do chão até o centro da bola (compensa a escala do grupo)
      const sc = Math.max(0.001, g.scale.x);
      const len = h + r + 0.35 + bob;
      stalk.current.scale.y = len / sc;
      stalk.current.position.y = -len / (2 * sc);
    }
  });

  if (!show) return null;
  const click = (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onSelect(index); };
  const opacity = dim ? 0.28 : 1;

  return (
    <group ref={group} scale={0.001}>
      <mesh castShadow onClick={click}
        onPointerOver={(e) => { e.stopPropagation(); setHover(true); document.body.style.cursor = "pointer"; }}
        onPointerOut={() => { setHover(false); document.body.style.cursor = ""; }}>
        <sphereGeometry args={[r, segs, segs]} />
        <meshStandardMaterial color={item.color} emissive={item.color} emissiveIntensity={isGoal ? 0.6 : 0.22}
          roughness={0.35} metalness={0.1} transparent={dim} opacity={opacity} />
      </mesh>
      {/* anel da partida (ou do time) em volta da bola */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[r * 1.18, Math.max(0.07, r * 0.09), 8, 36]} />
        <meshBasicMaterial color={ringColor} transparent opacity={dim ? 0.3 : 0.95} />
      </mesh>
      {/* haste até o chão: mostra de onde o chute saiu */}
      <mesh ref={stalk}>
        <cylinderGeometry args={[0.05, 0.05, 1, 6]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={dim ? 0.1 : 0.35} />
      </mesh>
      {(hover || selected) && (
        <Html position={[0, r + 0.9, 0]} center zIndexRange={[30, 0]} style={{ pointerEvents: "none" }}>
          <div
            className="whitespace-nowrap rounded-lg border border-white/20 bg-slate-950/95 px-2.5 py-1.5 text-[11px] shadow-xl"
            style={{ transform: "translateY(-70%)", borderColor: match?.color ?? undefined }}
          >
            <div className="font-semibold text-white">{match?.label ?? "Partida não identificada"}</div>
            <div className="text-sv-muted">
              {[match?.score, match?.dateLabel].filter(Boolean).join(" · ")}
              {(match?.score || match?.dateLabel) ? " · " : ""}
              {shot.minute != null ? `${shot.minute}'` : ""} {RESULT_META[resultKey(shot)].label} · xG {fmt(shot.xg)}
            </div>
          </div>
        </Html>
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Marcadores do pico e da sonda
// ---------------------------------------------------------------------------
function PeakPin({ mx, my, y, label }: { mx: number; my: number; y: number; label: string }) {
  return (
    <group position={[worldX(mx), BASE_Y, worldZ(my)]}>
      <mesh position={[0, (y + 2.2) / 2, 0]}>
        <cylinderGeometry args={[0.07, 0.07, y + 2.2, 6]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.6} />
      </mesh>
      <Html position={[0, y + 2.6, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
        <div className="whitespace-nowrap rounded-full border border-white/25 bg-slate-950/90 px-2 py-0.5 text-[10px] font-semibold text-white shadow">
          ▲ {label}
        </div>
      </Html>
    </group>
  );
}

function ProbeTag({ mx, my, text }: { mx: number; my: number; text: string[] }) {
  return (
    <group position={[worldX(mx), 0.12, worldZ(my)]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[PROBE_R - 0.12, PROBE_R, 64]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.55} depthWrite={false} />
      </mesh>
      <Html position={[0, 1.2, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
        <div className="rounded-lg border border-white/15 bg-slate-950/92 px-2.5 py-1.5 text-[11px] shadow-xl" style={{ transform: "translateY(-120%)" }}>
          {text.map((t, i) => (
            <div key={i} className={i === 0 ? "font-semibold text-white" : "whitespace-nowrap text-sv-muted"}>{t}</div>
          ))}
        </div>
      </Html>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------
const rampCss = `linear-gradient(90deg, ${RAMP_SPECTRAL.map(([t, [r, g, b]]) => `rgb(${r},${g},${b}) ${(t * 100).toFixed(0)}%`).join(", ")})`;

function Seg<T extends string>({ value, options, onChange, label }: {
  value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-sv-muted">{label}</span>
      <div className="flex items-center gap-0.5 rounded-lg border border-sv-border bg-sv-panel/70 p-0.5" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o.v} type="button" aria-pressed={value === o.v} onClick={() => onChange(o.v)}
            className={`rounded-md px-2.5 py-1 text-[11.5px] font-semibold transition ${value === o.v ? "bg-sv-accent text-white" : "text-sv-muted hover:text-white"}`}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export interface ShotHeat3DProps {
  /** Chutes visíveis agora (muda com o filme). */
  items: Shot3DItem[];
  /** Chutes do período inteiro: fixa a escala de altura/cor para o relevo crescer durante a reprodução. */
  reference: Shot3DItem[];
  metric: "xg" | "count";
  /** true: escala do período inteiro; false: escala própria do recorte atual (ex.: "só este jogo"). */
  fixedScale?: boolean;
  selected: number | null;
  onSelect: (index: number | null) => void;
  bothSides?: boolean;
  homeLabel?: string;
  awayLabel?: string;
  mode?: ShotViewMode;
  /** Partidas presentes nos chutes (para etiquetas, cores e chips). */
  matches?: MatchInfo[];
  /** Legenda do quadro atual da reprodução ("Jogo 3/10 · Arsenal vs Man United"). */
  caption?: string | null;
}

export function ShotHeat3D({
  items, reference, metric, fixedScale = true, selected, onSelect, bothSides = false, homeLabel, awayLabel,
  mode = "attack", matches = [], caption = null,
}: ShotHeat3DProps) {
  const [cam, setCam] = useState<CamKey>("tilt");
  const [spin, setSpin] = useState(false);
  const [terrain, setTerrain] = useState<TerrainMode>("relief");
  const [heightScale, setHeightScale] = useState(1);
  const [cut, setCut] = useState(0);
  const [smooth, setSmooth] = useState<Smooth>("normal");
  const [showBalls, setShowBalls] = useState(true);
  const [showPeak, setShowPeak] = useState(true);
  const [focusMatch, setFocusMatch] = useState<number | null>(null);
  const [probe, setProbe] = useState<{ mx: number; my: number } | null>(null);

  const presets = useMemo(() => presetsFor(bothSides, mode), [bothSides, mode]);
  const multi = matches.length >= 2;
  const matchById = useMemo(() => new Map(matches.map((m) => [m.id, m])), [matches]);
  const matchOf = (it: Shot3DItem) => (it.shot.match_id != null ? matchById.get(it.shot.match_id) : undefined);

  // ---- densidade ----
  const sampleOf = useMemo(() => (it: Shot3DItem): KdeSample => ({
    ...toMeters(it.pos?.x ?? it.shot.x ?? 0, it.pos?.y ?? it.shot.y ?? 0),
    w: metric === "xg" ? (it.shot.xg ?? 0) : 1,
  }), [metric]);
  const refSamples = useMemo(() => reference.map(sampleOf), [reference, sampleOf]);
  const curSamples = useMemo(() => items.map(sampleOf), [items, sampleOf]);
  const bandwidth = useMemo(() => chooseBandwidth(refSamples, SMOOTH_FACTOR[smooth]), [refSamples, smooth]);
  const refGrid = useMemo<KdeGrid>(() => computeKde(refSamples, bandwidth, CELL), [refSamples, bandwidth]);
  const curGrid = useMemo<KdeGrid>(() => computeKde(curSamples, bandwidth, CELL), [curSamples, bandwidth]);
  const norm = fixedScale ? refGrid.max : curGrid.max;
  const { cols, rows } = curGrid;

  const targetT = useMemo(() => {
    const t = new Float32Array(curGrid.data.length);
    if (norm > 0) for (let k = 0; k < t.length; k++) t[k] = Math.min(1, curGrid.data[k] / norm);
    return t;
  }, [curGrid, norm]);

  const lut = useMemo(() => buildLut(RAMP_SPECTRAL), []);
  const lin = useMemo(() => linearLut(lut), [lut]);
  // alturas atuais (m) de cada célula, escritas pelo Terrain a cada quadro e lidas pelas bolas
  const cellH = useMemo(() => ({ current: new Float32Array(cols * rows) }), [cols, rows]);

  // ---- leituras ----
  const peak = useMemo(() => {
    if (!(curGrid.max > 0)) return null;
    let best = 0, bi = 0;
    for (let k = 0; k < curGrid.data.length; k++) if (curGrid.data[k] > best) { best = curGrid.data[k]; bi = k; }
    const i = bi % curGrid.cols, j = Math.floor(bi / curGrid.cols);
    const mx = (i + 0.5) * CELL, my = (j + 0.5) * CELL;
    const t = norm > 0 ? Math.min(1, best / norm) : 0;
    return { mx, my, t, zone: zoneAt(mx, my).zone };
  }, [curGrid, norm]);

  const insights = useMemo(() => {
    let w = 0, gx = 0, gy = 0, dist = 0, inBox = 0;
    const zoneW = new Map<string, number>();
    items.forEach((it, i) => {
      const s = curSamples[i];
      const wt = s.w;
      if (!(wt > 0)) return;
      w += wt; gx += s.mx * wt; gy += s.my * wt;
      const goalX = (it.side ?? "right") === "left" ? 0 : TURF_L;
      dist += Math.hypot(goalX - s.mx, s.my - TURF_W / 2) * wt;
      const px = it.pos?.x ?? it.shot.x ?? 0, py = it.pos?.y ?? it.shot.y ?? 0;
      if ((px >= 83.5 || px <= 16.5) && py >= 21 && py <= 79) inBox += wt;
      const z = zoneAt(s.mx, s.my).zone;
      zoneW.set(z, (zoneW.get(z) ?? 0) + wt);
    });
    if (!(w > 0)) return null;
    const top = [...zoneW.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      centroid: { mx: gx / w, my: gy / w },
      goalDist: dist / w,
      inBox: inBox / w,
      topZone: top ? { name: top[0], share: top[1] / w } : null,
    };
  }, [items, curSamples]);

  const probeText = useMemo(() => {
    if (!probe) return null;
    const near = eventsWithin(items.map((it, i) => ({ ...curSamples[i], it })), probe.mx, probe.my, PROBE_R);
    const goals = near.filter((n) => resultKey(n.it.shot) === "goal").length;
    const xg = near.reduce((a, n) => a + (n.it.shot.xg ?? 0), 0);
    return [
      zoneAt(probe.mx, probe.my).zone,
      `${near.length} ${near.length === 1 ? "chute" : "chutes"} (≤ ${PROBE_R} m) · ${goals} ${goals === 1 ? "gol" : "gols"}`,
      `xG ${nf(xg, 2)}`,
    ];
  }, [probe, items, curSamples]);

  const pickedItem = selected != null ? items[selected] : null;
  const unit = metric === "xg" ? "xG por 100 m²" : "chutes por 100 m²";
  const peakValue = norm * 100;
  const segs = items.length > 140 ? 12 : 20;
  const showCaption = caption ?? null;
  const dimOf = (it: Shot3DItem, i: number) =>
    (selected != null && selected !== i) || (focusMatch != null && it.shot.match_id !== focusMatch && selected !== i);

  return (
    <div className="space-y-2.5">
      <div className="relative overflow-hidden rounded-2xl border border-white/10" style={{ height: 560 }}>
        <Canvas key={String(bothSides)} shadows camera={{ position: presets[cam].position, fov: 42, near: 0.5, far: 700 }} dpr={[1, 2]}
          onPointerMissed={() => onSelect(null)}>
          <color attach="background" args={["#0a0f1a"]} />
          <ambientLight intensity={0.85} />
          <directionalLight position={[30, 60, -20]} intensity={1.1} castShadow />
          <directionalLight position={[-30, 40, 30]} intensity={0.5} />
          <Suspense fallback={null}>
            <PitchTurf3D />
            <Terrain targetT={targetT} cols={cols} rows={rows} mode={terrain} scale={heightScale} cut={cut}
              lut={lut} lin={lin} cellH={cellH} onProbe={setProbe} />
            {items.map((it, i) => (
              <HeatBall key={`${it.shot.event_id}-${i}`} item={it} index={i} match={matchOf(it)}
                ringColor={multi ? (matchOf(it)?.color ?? it.ring) : it.ring}
                selected={selected === i} dim={dimOf(it, i)} show={showBalls}
                cellH={cellH} cols={cols} rows={rows} segs={segs} onSelect={onSelect} />
            ))}
            {showPeak && peak && peak.t > 0.2 && (
              <PeakPin mx={peak.mx} my={peak.my} y={heightOf(peak.t, cut) * heightScale} label={`Pico · ${peak.zone}`} />
            )}
            {probe && probeText && <ProbeTag mx={probe.mx} my={probe.my} text={probeText} />}
          </Suspense>
          <CameraRig preset={presets[cam]} autoRotate={spin} minDistance={mode === "gk" && cam === "goal" ? 10 : 16} />
        </Canvas>

        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          {(Object.keys(presets) as CamKey[]).map((k) => (
            <button key={k} onClick={() => setCam(k)}
              className={`sv-btn !px-2.5 !py-1 text-[11px] ${cam === k ? "!border-sv-accent3 !bg-sv-accent text-white" : ""}`}>
              {presets[k].label}
            </button>
          ))}
          <button onClick={() => setSpin((v) => !v)} aria-pressed={spin}
            className={`sv-btn !px-2.5 !py-1 text-[11px] ${spin ? "!border-sv-accent3 !bg-sv-accent text-white" : ""}`}>
            Girar
          </button>
        </div>

        {showCaption && (
          <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full border border-white/15 bg-slate-950/85 px-3 py-1 text-[11px] font-semibold text-white shadow">
            {showCaption}
          </div>
        )}

        {/* escala de cores */}
        <div className="pointer-events-none absolute right-3 top-3 w-44 rounded-lg border border-white/10 bg-slate-950/70 p-2 text-[10px] text-sv-muted">
          <div className="mb-1">Concentração · {unit}</div>
          <div className="h-2.5 w-full rounded-sm border border-white/10" style={{ background: rampCss }} />
          <div className="mt-0.5 flex justify-between font-mono tabular-nums">
            <span>0</span><span>{peakValue > 0 ? nf(peakValue / 2, peakValue >= 10 ? 1 : 2) : "—"}</span><span>{peakValue > 0 ? nf(peakValue, peakValue >= 10 ? 1 : 2) : "—"}</span>
          </div>
          <div className="mt-1 leading-snug">
            Altura e cor = concentração{fixedScale ? " (escala do período todo)" : " (escala deste recorte)"}.
            {bothSides && homeLabel && awayLabel ? ` ${homeLabel} ataca →, ← ${awayLabel}.` : ""}
          </div>
        </div>

        {pickedItem && (
          <ShotDetailCard
            shot={pickedItem.shot} color={pickedItem.color} match={matchOf(pickedItem)} onClose={() => onSelect(null)}
            className="absolute bottom-3 left-3 right-3 sm:right-auto sm:max-w-sm"
          />
        )}
        {items.length === 0 && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-sv-muted">
            Nenhum chute neste ponto da reprodução.
          </div>
        )}
      </div>

      {/* controles do 3D */}
      <div className="sv-card-inner flex flex-wrap items-center gap-x-4 gap-y-2">
        <Seg<TerrainMode> label="Forma" value={terrain} onChange={setTerrain}
          options={[{ v: "relief", label: "Relevo" }, { v: "columns", label: "Colunas" }]} />
        <Seg<Smooth> label="Suavização" value={smooth} onChange={setSmooth}
          options={(["precise", "normal", "smooth"] as Smooth[]).map((v) => ({ v, label: SMOOTH_LABEL[v] }))} />
        <label className="flex items-center gap-2 text-[11px] text-sv-muted">
          Altura
          <input type="range" min={0.5} max={2} step={0.1} value={heightScale} aria-label="Altura do relevo"
            onChange={(e) => setHeightScale(Number(e.target.value))} className="w-24 accent-emerald-400" />
          <span className="w-8 font-mono tabular-nums">{heightScale.toFixed(1)}×</span>
        </label>
        <label className="flex items-center gap-2 text-[11px] text-sv-muted" title="Esconde o que está abaixo de X % do pico e deixa só as ilhas quentes">
          Corte
          <input type="range" min={0} max={0.6} step={0.05} value={cut} aria-label="Corte do relevo"
            onChange={(e) => setCut(Number(e.target.value))} className="w-24 accent-emerald-400" />
          <span className="w-9 font-mono tabular-nums">{Math.round(cut * 100)}%</span>
        </label>
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-sv-muted">
          <input type="checkbox" checked={showBalls} onChange={(e) => setShowBalls(e.target.checked)} /> Chutes
        </label>
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-sv-muted">
          <input type="checkbox" checked={showPeak} onChange={(e) => setShowPeak(e.target.checked)} /> Pico
        </label>
        <span className="text-[11px] text-sv-muted">Passe o mouse no relevo para ler a região; na bola, para ver a partida.</span>
      </div>

      {/* partidas: clique para destacar */}
      {matches.length > 0 && (
        <div className="sv-card-inner">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="sv-label">Partidas ({matches.length}) · clique para destacar os chutes de um jogo</div>
            {focusMatch != null && (
              <button className="sv-btn !px-2 !py-0.5 text-[11px]" onClick={() => setFocusMatch(null)}>Mostrar todas</button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {matches.map((m) => {
              const on = focusMatch === m.id || pickedItem?.shot.match_id === m.id;
              return (
                <button key={m.id} type="button" aria-pressed={on} onClick={() => setFocusMatch(focusMatch === m.id ? null : m.id)}
                  className={`sv-chip !cursor-pointer ${focusMatch != null && !on ? "opacity-45" : ""}`}
                  style={on ? { borderColor: m.color } : undefined}>
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: m.color }} />
                  {m.label}
                  <span className="text-sv-muted">{[m.score, m.dateLabel].filter(Boolean).join(" · ")}</span>
                  <span className="font-mono text-sv-muted">· {m.shots}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* leituras */}
      {insights && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="sv-card-inner !p-3">
            <div className="sv-label">{mode === "attack" ? "Zona mais quente" : "Onde mais finalizaram"}</div>
            <div className="mt-1 text-sm font-semibold">{peak?.zone ?? "—"}</div>
            <div className="text-[11px] text-sv-muted">pico do relevo</div>
          </div>
          <div className="sv-card-inner !p-3">
            <div className="sv-label">Zona dominante</div>
            <div className="mt-1 text-sm font-semibold">{insights.topZone?.name ?? "—"}</div>
            <div className="text-[11px] text-sv-muted">{insights.topZone ? `${Math.round(insights.topZone.share * 100)}% do ${metric === "xg" ? "xG" : "volume"}` : ""}</div>
          </div>
          <div className="sv-card-inner !p-3">
            <div className="sv-label">Centro de gravidade</div>
            <div className="mt-1 font-mono text-sm font-semibold tabular-nums">{nf(insights.goalDist)} m</div>
            <div className="text-[11px] text-sv-muted">do gol, em média</div>
          </div>
          <div className="sv-card-inner !p-3">
            <div className="sv-label">Dentro da área</div>
            <div className="mt-1 font-mono text-sm font-semibold tabular-nums">{Math.round(insights.inBox * 100)}%</div>
            <div className="text-[11px] text-sv-muted">do {metric === "xg" ? "xG" : "volume"}</div>
          </div>
        </div>
      )}
    </div>
  );
}
