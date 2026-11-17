/**
 * HeatmapTerrain3D.tsx — mapa de calor em 3D ("relevo de calor") do ScoutVision.
 *
 * Reaproveita EXATAMENTE a mesma grade KDE que o mapa 2D (`KdeGrid`), então os números
 * batem: altura e cor = concentração (peso por m²), normalizada pelo pico da escala escolhida.
 *
 * O que o 3D acrescenta em relação ao 2D:
 *   • relevo (superfície suave) ou colunas (cada bloco de 3 × 3 m);
 *   • curvas de nível em altura real (25 / 50 / 75 % do pico) — "degraus" da montanha;
 *   • picos numerados com % do peso do time na região e a zona do campo;
 *   • centro de gravidade do time (média ponderada) e distância até o gol atacado;
 *   • corte horizontal: esconde tudo abaixo de X % do pico e deixa só as "ilhas" quentes;
 *   • câmeras prontas (aérea, 3/4, rasante, atrás de cada gol) e giro automático;
 *   • sonda: passe o mouse (ou toque) para ler a região; clique para fixar.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Html, Line, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import {
  HEAT_CUTOFF, PITCH_L, PITCH_W, contourSegments, densityAt, zoneAt, type KdeGrid,
} from "../lib/heatmapKde";
import { PITCH_PAD } from "./HeatmapPitch";

type TeamKey = "home" | "away";
type CamKey = "tilt" | "aerial" | "low" | "atkHome" | "atkAway";
type Mode = "relief" | "columns";

export type TerrainLayer = {
  team: TeamKey;
  grid: KdeGrid;
  norm: number;
  lut: Uint8ClampedArray;
  contour: [number, number, number];
};
export type TerrainEvent = { team: TeamKey; mx: number; my: number; w: number; goal: boolean };
export type TerrainRegionRow = {
  team: TeamKey; count: number; goals: number; xg: number; xgKnown: number; density: number;
};
export type TerrainInfo = {
  zone: { zone: string; goalSide: "left" | "right" };
  stats: TerrainRegionRow[];
};
type Pt = { mx: number; my: number };

export type HeatmapTerrain3DProps = {
  layers: TerrainLayer[];
  events: TerrainEvent[];
  showEvents: boolean;
  real: boolean;
  unit: string;
  radius: number;
  homeName: string;
  awayName: string;
  teamName: (t: TeamKey) => string;
  teamColor: (t: TeamKey) => string;
  hover: Pt | null;
  pinned: Pt | null;
  info: TerrainInfo | null;
  onHover: (p: Pt | null) => void;
  onPick: (p: Pt) => void;
};

// ---------------------------------------------------------------------------
// Constantes e helpers
// ---------------------------------------------------------------------------
const HMAX = 16; // altura (m) do pico = 100 % da escala, com Altura = 1×
const BASE_Y = 0.05; // o relevo "flutua" um pouco acima do gramado (evita z-fighting)
const CONTOUR_LEVELS = [0.25, 0.5, 0.75];
const PEAK_SEP = 10; // m entre picos
const PX_PER_M = 16; // resolução da textura do campo

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const nf = (v: number, d = 0) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });

/** Altura (sem o fator de Altura) de uma célula cuja densidade normalizada é `t`. */
const hOf = (t: number) => {
  const v = clamp(t, 0, 1);
  return HMAX * Math.pow(v, 0.9) * smoothstep(HEAT_CUTOFF, HEAT_CUTOFF + 0.1, v);
};

const worldX = (mx: number) => mx - PITCH_L / 2;
const worldZ = (my: number) => my - PITCH_W / 2; // my=0 fica no topo na vista aérea, igual ao 2D

/** LUT sRGB (RGBA 8 bits) → tabela de cores lineares, que é o que o three espera em vertexColors. */
function linearLut(lut: Uint8ClampedArray): Float32Array {
  const out = new Float32Array(256 * 3);
  const c = new THREE.Color();
  for (let k = 0; k < 256; k++) {
    c.setRGB(lut[k * 4] / 255, lut[k * 4 + 1] / 255, lut[k * 4 + 2] / 255, THREE.SRGBColorSpace);
    out[k * 3] = c.r; out[k * 3 + 1] = c.g; out[k * 3 + 2] = c.b;
  }
  return out;
}

const tOf = (l: TerrainLayer, mx: number, my: number) =>
  l.norm > 0 ? Math.min(1, densityAt(l.grid, mx, my) / l.norm) : 0;

// ---------------------------------------------------------------------------
// Análises (picos, centro de gravidade, zona quente, zonas do campo)
// ---------------------------------------------------------------------------
type Peak = { team: TeamKey; mx: number; my: number; t: number; share: number; zone: string };

function findPeaks(layer: TerrainLayer, events: TerrainEvent[], radius: number): Peak[] {
  const { grid } = layer;
  if (!(grid.max > 0)) return [];
  const { cols, rows, cell, data } = grid;
  const evs = events.filter((e) => e.team === layer.team);
  const total = evs.reduce((a, e) => a + e.w, 0);
  const win = Math.round(4 / cell); // ±4 m
  const cands: { i: number; j: number; v: number }[] = [];
  for (let j = 0; j < rows; j += 2) {
    for (let i = 0; i < cols; i += 2) {
      const v = data[j * cols + i];
      if (v < grid.max * 0.35) continue;
      let ok = true;
      for (let dj = -win; dj <= win && ok; dj++) {
        const jj = j + dj;
        if (jj < 0 || jj >= rows) continue;
        for (let di = -win; di <= win; di++) {
          const ii = i + di;
          if (ii < 0 || ii >= cols) continue;
          if (data[jj * cols + ii] > v) { ok = false; break; }
        }
      }
      if (ok) cands.push({ i, j, v });
    }
  }
  cands.sort((a, b) => b.v - a.v);
  const picked: Peak[] = [];
  for (const c of cands) {
    const mx = (c.i + 0.5) * cell, my = (c.j + 0.5) * cell;
    if (picked.some((p) => Math.hypot(p.mx - mx, p.my - my) < PEAK_SEP)) continue;
    const near = evs.filter((e) => Math.hypot(e.mx - mx, e.my - my) <= radius);
    const share = total > 0 ? near.reduce((a, e) => a + e.w, 0) / total : 0;
    picked.push({ team: layer.team, mx, my, t: Math.min(1, c.v / layer.norm), share, zone: zoneAt(mx, my).zone });
    if (picked.length >= 3) break;
  }
  return picked;
}

const ZONE_ORDER = ["Pequena área", "Grande área", "Entrada da área", "Longa distância", "Meio-campo"];

type Insights = {
  team: TeamKey;
  n: number;
  centroid: Pt | null;
  goalDist: number | null;
  lateral: number | null;
  hotArea: number;
  hotShare: number;
  zones: { name: string; share: number }[];
};

function insightsFor(layer: TerrainLayer, events: TerrainEvent[]): Insights {
  const evs = events.filter((e) => e.team === layer.team);
  const total = evs.reduce((a, e) => a + e.w, 0);
  let centroid: Pt | null = null;
  let goalDist: number | null = null;
  let lateral: number | null = null;
  if (total > 0) {
    const mx = evs.reduce((a, e) => a + e.mx * e.w, 0) / total;
    const my = evs.reduce((a, e) => a + e.my * e.w, 0) / total;
    centroid = { mx, my };
    const goalX = layer.team === "home" ? PITCH_L : 0; // mandante ataca o gol da direita
    goalDist = Math.hypot(goalX - mx, my - PITCH_W / 2);
    lateral = Math.abs(my - PITCH_W / 2);
  }
  const { grid } = layer;
  let hotCells = 0, hotMass = 0;
  if (grid.max > 0) {
    const thr = grid.max * 0.5;
    for (let k = 0; k < grid.data.length; k++) {
      if (grid.data[k] >= thr) { hotCells++; hotMass += grid.data[k]; }
    }
  }
  const cellArea = grid.cell * grid.cell;
  const zoneW = new Map<string, number>(ZONE_ORDER.map((z) => [z, 0]));
  for (const e of evs) {
    const z = zoneAt(e.mx, e.my).zone;
    zoneW.set(z, (zoneW.get(z) ?? 0) + e.w);
  }
  return {
    team: layer.team,
    n: evs.length,
    centroid,
    goalDist,
    lateral,
    hotArea: hotCells * cellArea,
    hotShare: grid.totalWeight > 0 ? clamp((hotMass * cellArea) / grid.totalWeight, 0, 1) : 0,
    zones: ZONE_ORDER.map((name) => ({ name, share: total > 0 ? (zoneW.get(name) ?? 0) / total : 0 })),
  };
}

// ---------------------------------------------------------------------------
// Geometrias
// ---------------------------------------------------------------------------
function buildTerrainGeometry(layer: TerrainLayer): THREE.BufferGeometry {
  const { grid, norm, lut } = layer;
  const { cols, rows, cell, data } = grid;
  const lin = linearLut(lut);
  const pos = new Float32Array(cols * rows * 3);
  const col = new Float32Array(cols * rows * 4);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      const t = norm > 0 ? Math.min(1, data[k] / norm) : 0;
      const idx = Math.round(t * 255);
      pos[k * 3] = worldX((i + 0.5) * cell);
      pos[k * 3 + 1] = hOf(t);
      pos[k * 3 + 2] = worldZ((j + 0.5) * cell);
      col[k * 4] = lin[idx * 3];
      col[k * 4 + 1] = lin[idx * 3 + 1];
      col[k * 4 + 2] = lin[idx * 3 + 2];
      col[k * 4 + 3] = Math.min(1, (lut[idx * 4 + 3] / 255) * 1.12);
    }
  }
  const index = new Uint32Array((cols - 1) * (rows - 1) * 6);
  let q = 0;
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
      index[q++] = a; index[q++] = c; index[q++] = b;
      index[q++] = b; index[q++] = c; index[q++] = d;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 4));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeVertexNormals();
  return g;
}

/** Malha grossa e invisível só para captar o ponteiro (a malha fina custaria caro no raycast). */
function buildPickGeometry(layers: TerrainLayer[]): THREE.BufferGeometry {
  const step = 3; // m
  const nx = Math.round(PITCH_L / step) + 1;
  const ny = Math.round(PITCH_W / step) + 1;
  const pos = new Float32Array(nx * ny * 3);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const mx = Math.min(PITCH_L, i * step), my = Math.min(PITCH_W, j * step);
      let h = 0;
      for (const l of layers) h = Math.max(h, hOf(tOf(l, mx, my)));
      const k = j * nx + i;
      pos[k * 3] = worldX(mx); pos[k * 3 + 1] = h; pos[k * 3 + 2] = worldZ(my);
    }
  }
  const index = new Uint32Array((nx - 1) * (ny - 1) * 6);
  let q = 0;
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      index[q++] = a; index[q++] = c; index[q++] = b;
      index[q++] = b; index[q++] = c; index[q++] = d;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  return g;
}

function buildContourGeometry(layer: TerrainLayer, frac: number): THREE.BufferGeometry | null {
  const level = layer.norm * frac;
  if (!(level > 0) || level > layer.grid.max) return null;
  const segs = contourSegments(layer.grid, level);
  if (!segs.length) return null;
  const { cell } = layer.grid;
  const y = hOf(frac) + 0.04;
  const pos = new Float32Array(segs.length * 6);
  segs.forEach(([x1, y1, x2, y2], s) => {
    pos[s * 6] = worldX((x1 + 0.5) * cell); pos[s * 6 + 1] = y; pos[s * 6 + 2] = worldZ((y1 + 0.5) * cell);
    pos[s * 6 + 3] = worldX((x2 + 0.5) * cell); pos[s * 6 + 4] = y; pos[s * 6 + 5] = worldZ((y2 + 0.5) * cell);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  return g;
}

type Column = { x: number; z: number; h: number; idx: number };
function buildColumns(layer: TerrainLayer, size = 3): Column[] {
  const { grid, norm } = layer;
  if (!(norm > 0)) return [];
  const { cols, rows, cell, data } = grid;
  const per = Math.round(size / cell);
  const out: Column[] = [];
  for (let cj = 0; cj < Math.ceil(PITCH_W / size); cj++) {
    for (let ci = 0; ci < Math.ceil(PITCH_L / size); ci++) {
      let sum = 0, n = 0;
      for (let j = cj * per; j < Math.min(rows, (cj + 1) * per); j++) {
        for (let i = ci * per; i < Math.min(cols, (ci + 1) * per); i++) { sum += data[j * cols + i]; n++; }
      }
      if (!n) continue;
      const t = Math.min(1, sum / n / norm);
      if (t <= HEAT_CUTOFF) continue;
      const h = Math.max(0.25, HMAX * Math.pow(t, 0.9));
      out.push({
        x: worldX(Math.min(PITCH_L, (ci + 0.5) * size)),
        z: worldZ(Math.min(PITCH_W, (cj + 0.5) * size)),
        h, idx: Math.round(t * 255),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Textura do gramado (desenhada em canvas, em metros)
// ---------------------------------------------------------------------------
function drawPitchTexture(): HTMLCanvasElement {
  const S = PX_PER_M, P = PITCH_PAD;
  const c = document.createElement("canvas");
  c.width = Math.round((PITCH_L + P * 2) * S);
  c.height = Math.round((PITCH_W + P * 2) * S);
  const g = c.getContext("2d")!;
  const X = (m: number) => (m + P) * S, Y = (m: number) => (m + P) * S;
  g.fillStyle = "#133f29"; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = "#1c5a38"; g.fillRect(X(0), Y(0), PITCH_L * S, PITCH_W * S);
  const stripes = 15, sw = PITCH_L / stripes;
  for (let i = 0; i < stripes; i++) {
    g.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.06)";
    g.fillRect(X(i * sw), Y(0), sw * S, PITCH_W * S);
  }
  g.strokeStyle = "rgba(255,255,255,0.9)"; g.lineWidth = 0.17 * S; g.lineJoin = "round";
  const line = (x1: number, y1: number, x2: number, y2: number) => { g.beginPath(); g.moveTo(X(x1), Y(y1)); g.lineTo(X(x2), Y(y2)); g.stroke(); };
  const rect = (x: number, y: number, w: number, h: number) => g.strokeRect(X(x), Y(y), w * S, h * S);
  const arc = (cx: number, cy: number, r: number, a0: number, a1: number) => { g.beginPath(); g.arc(X(cx), Y(cy), r * S, a0, a1); g.stroke(); };
  const dot = (x: number, y: number) => { g.fillStyle = "rgba(255,255,255,0.9)"; g.beginPath(); g.arc(X(x), Y(y), 0.3 * S, 0, Math.PI * 2); g.fill(); };
  const cy = PITCH_W / 2;
  rect(0, 0, PITCH_L, PITCH_W);
  line(PITCH_L / 2, 0, PITCH_L / 2, PITCH_W);
  arc(PITCH_L / 2, cy, 9.15, 0, Math.PI * 2); dot(PITCH_L / 2, cy);
  const phi = Math.acos(5.5 / 9.15);
  for (const side of [0, 1]) {
    const dir = side === 0 ? 1 : -1;
    const x0 = side === 0 ? 0 : PITCH_L;
    rect(side === 0 ? 0 : PITCH_L - 16.5, cy - 20.16, 16.5, 40.32);
    rect(side === 0 ? 0 : PITCH_L - 5.5, cy - 9.16, 5.5, 18.32);
    dot(x0 + dir * 11, cy);
    if (side === 0) arc(11, cy, 9.15, -phi, phi); else arc(PITCH_L - 11, cy, 9.15, Math.PI - phi, Math.PI + phi);
    g.strokeRect(X(side === 0 ? -2.44 : PITCH_L), Y(cy - 3.66), 2.44 * S, 7.32 * S); // gol/rede
  }
  const corner = (x: number, y: number, a0: number) => arc(x, y, 1, a0, a0 + Math.PI / 2);
  corner(0, 0, 0); corner(PITCH_L, 0, Math.PI / 2); corner(PITCH_L, PITCH_W, Math.PI); corner(0, PITCH_W, Math.PI * 1.5);
  return c;
}

function PitchPlane() {
  const tex = useMemo(() => {
    const t = new THREE.CanvasTexture(drawPitchTexture());
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, []);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[PITCH_L + PITCH_PAD * 2, PITCH_W + PITCH_PAD * 2]} />
      <meshBasicMaterial map={tex} toneMapped={false} />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// Peças da cena
// ---------------------------------------------------------------------------
/** Grupo cuja escala em Y cresce suavemente até o valor-alvo (animação de "subida" do relevo). */
function GrowGroup({ target, resetKey, children }: { target: number; resetKey: unknown; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  const cur = useRef(0.02);
  useEffect(() => { cur.current = 0.02; }, [resetKey]);
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    cur.current += (target - cur.current) * (1 - Math.exp(-Math.min(dt, 0.1) * 6));
    g.scale.y = Math.max(0.001, cur.current);
  });
  return <group ref={ref} position={[0, BASE_Y, 0]}>{children}</group>;
}

function ReliefMesh({ layer, clip, onPick }: {
  layer: TerrainLayer; clip: THREE.Plane[]; onPick: (e: ThreeEvent<PointerEvent | MouseEvent>, click: boolean) => void;
}) {
  const geo = useMemo(() => buildTerrainGeometry(layer), [layer]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <mesh geometry={geo} onPointerMove={(e) => onPick(e, false)} onClick={(e) => onPick(e, true)}>
      <meshStandardMaterial
        vertexColors transparent side={THREE.DoubleSide} roughness={0.62} metalness={0.05}
        toneMapped={false} clippingPlanes={clip}
      />
    </mesh>
  );
}

function ColumnsMesh({ layer, clip }: { layer: TerrainLayer; clip: THREE.Plane[] }) {
  const items = useMemo(() => buildColumns(layer), [layer]);
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    items.forEach((it, i) => {
      dummy.position.set(it.x, it.h / 2, it.z);
      dummy.scale.set(2.65, it.h, 2.65);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      color.setRGB(layer.lut[it.idx * 4] / 255, layer.lut[it.idx * 4 + 1] / 255, layer.lut[it.idx * 4 + 2] / 255, THREE.SRGBColorSpace);
      m.setColorAt(i, color);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [items, layer.lut]);
  if (!items.length) return null;
  return (
    <instancedMesh key={items.length} ref={ref} args={[undefined, undefined, items.length]} frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial roughness={0.55} metalness={0.05} toneMapped={false} clippingPlanes={clip} />
    </instancedMesh>
  );
}

function Contours({ layer, clip }: { layer: TerrainLayer; clip: THREE.Plane[] }) {
  const geos = useMemo(
    () => CONTOUR_LEVELS.map((f) => buildContourGeometry(layer, f)),
    [layer],
  );
  useEffect(() => () => geos.forEach((g) => g?.dispose()), [geos]);
  const [r, g, b] = layer.contour;
  return (
    <>
      {geos.map((geo, i) => geo && (
        <lineSegments key={i} geometry={geo}>
          <lineBasicMaterial color={`rgb(${r},${g},${b})`} transparent opacity={[0.45, 0.7, 0.95][i]} clippingPlanes={clip} toneMapped={false} />
        </lineSegments>
      ))}
    </>
  );
}

function CameraRig({ target }: { target: { pos: [number, number, number]; look: [number, number, number]; n: number } }) {
  const { camera, controls } = useThree();
  const goal = useRef<{ pos: THREE.Vector3; look: THREE.Vector3; t: number } | null>(null);
  useEffect(() => {
    goal.current = { pos: new THREE.Vector3(...target.pos), look: new THREE.Vector3(...target.look), t: 0 };
  }, [target]);
  useFrame((_, dt) => {
    const g = goal.current;
    if (!g) return;
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * 5);
    camera.position.lerp(g.pos, k);
    const c = controls as unknown as { target: THREE.Vector3; update: () => void } | null;
    if (c) { c.target.lerp(g.look, k); c.update(); } else camera.lookAt(g.look);
    g.t += dt;
    if (g.t > 1.8) goal.current = null;
  });
  return null;
}

function Probe({ p, radius, h, strong, color }: { p: Pt; radius: number; h: number; strong: boolean; color: string }) {
  const x = worldX(p.mx), z = worldZ(p.my);
  return (
    <group position={[x, 0, z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.09, 0]}>
        <ringGeometry args={[radius - (strong ? 0.28 : 0.16), radius, 64]} />
        <meshBasicMaterial color={color} transparent opacity={strong ? 0.95 : 0.6} toneMapped={false} depthWrite={false} />
      </mesh>
      <Line points={[[0, 0.1, 0], [0, h + 4, 0]]} color={color} lineWidth={strong ? 2 : 1.2} transparent opacity={0.9} />
      <mesh position={[0, h + 4, 0]}>
        <sphereGeometry args={[strong ? 0.8 : 0.55, 16, 16]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// UI auxiliar
// ---------------------------------------------------------------------------
function Chip({ active, onClick, children, title }: { active?: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button
      type="button" aria-pressed={active} title={title} onClick={onClick}
      className={`shrink-0 whitespace-nowrap rounded-md border px-2.5 py-1 text-[11.5px] font-semibold transition ${
        active ? "border-sv-accent3 bg-sv-accent text-white" : "border-sv-border bg-sv-panel/70 text-sv-muted hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function Mini({ k, v, sub }: { k: string; v: ReactNode; sub?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-sv-muted">{k}</div>
      <div className="mt-0.5 font-mono text-[14px] font-semibold tabular-nums text-white/95">{v}</div>
      {sub && <div className="truncate text-[10px] text-sv-muted">{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------
export function HeatmapTerrain3D(props: HeatmapTerrain3DProps) {
  const {
    layers, events, showEvents, real, unit, radius, homeName, awayName,
    teamName, teamColor, hover, pinned, info, onHover, onPick,
  } = props;

  const [mode, setMode] = useState<Mode>("relief");
  const [heightK, setHeightK] = useState(1);
  const [cut, setCut] = useState(0); // fração do pico (0..0.8)
  const [contours, setContours] = useState(true);
  const [markers, setMarkers] = useState(true);
  const [rotate, setRotate] = useState(false);
  const [cam, setCam] = useState<{ key: CamKey; n: number }>({ key: "tilt", n: 0 });

  const camTarget = useMemo(() => {
    const hx = PITCH_L / 2;
    const presets: Record<CamKey, { pos: [number, number, number]; look: [number, number, number] }> = {
      tilt: { pos: [0, 64, 84], look: [0, 0, 0] },
      aerial: { pos: [0, 128, 0.1], look: [0, 0, 0] },
      low: { pos: [0, 14, 96], look: [0, 3, 0] },
      atkHome: { pos: [hx + 36, 22, 0], look: [hx - 26, 2, 0] },
      atkAway: { pos: [-(hx + 36), 22, 0], look: [-(hx - 26), 2, 0] },
    };
    return { ...presets[cam.key], n: cam.n };
  }, [cam]);

  const clip = useMemo(
    () => (cut > 0 ? [new THREE.Plane(new THREE.Vector3(0, 1, 0), -(BASE_Y + hOf(cut) * heightK))] : []),
    [cut, heightK],
  );

  const heightAt = (mx: number, my: number) => {
    let h = 0;
    for (const l of layers) h = Math.max(h, hOf(tOf(l, mx, my)));
    return BASE_Y + h * heightK;
  };

  const peaks = useMemo(() => layers.flatMap((l) => findPeaks(l, events, radius)), [layers, events, radius]);
  const insights = useMemo(() => layers.map((l) => insightsFor(l, events)), [layers, events]);
  const pickGeo = useMemo(() => buildPickGeometry(layers), [layers]);
  useEffect(() => () => pickGeo.dispose(), [pickGeo]);
  const growKey = layers;

  const handlePick = (e: ThreeEvent<PointerEvent | MouseEvent>, click: boolean) => {
    const toMeters = (): Pt => ({
      mx: clamp(e.point.x + PITCH_L / 2, 0, PITCH_L),
      my: clamp(e.point.z + PITCH_W / 2, 0, PITCH_W),
    });
    e.stopPropagation();
    if (click) {
      if (e.delta > 5) return; // foi arrasto (giro da câmera), não clique
      onPick(toMeters());
      return;
    }
    if ((e.nativeEvent as PointerEvent).pointerType === "touch") return;
    onHover(toMeters());
  };

  const single = layers.length === 1 ? layers[0].team : null;
  const probe = hover ?? null;

  return (
    <div className="space-y-3">
      {/* Cena */}
      <div className="relative overflow-hidden rounded-2xl border border-white/10" style={{ background: "radial-gradient(120% 90% at 50% 0%, #12332a 0%, #0a1712 70%)" }}>
        <div className="h-[440px] w-full sm:h-[580px]" style={{ touchAction: "none" }}>
          <Canvas
            dpr={[1, 2]}
            camera={{ position: [0, 64, 84], fov: 38, near: 0.5, far: 700 }}
            gl={{ antialias: true, powerPreference: "high-performance" }}
            onCreated={({ gl }) => { gl.localClippingEnabled = true; }}
            onPointerMissed={() => onHover(null)}
          >
            <ambientLight intensity={0.85} />
            <hemisphereLight args={["#cfe8ff", "#1a3b2a", 0.55]} />
            <directionalLight position={[-40, 80, 50]} intensity={1.5} />
            <directionalLight position={[60, 30, -40]} intensity={0.4} color="#9cc8ff" />

            <PitchPlane />

            {layers.map((l) => (
              <GrowGroup key={l.team} target={heightK} resetKey={growKey}>
                {mode === "relief"
                  ? <ReliefMesh layer={l} clip={clip} onPick={handlePick} />
                  : <ColumnsMesh layer={l} clip={clip} />}
                {contours && mode === "relief" && <Contours layer={l} clip={clip} />}
              </GrowGroup>
            ))}

            {/* captação do ponteiro (invisível) */}
            <GrowGroup target={heightK} resetKey={growKey}>
              <mesh geometry={pickGeo} visible={false}
                    onPointerMove={(e) => handlePick(e, false)} onClick={(e) => handlePick(e, true)}>
                <meshBasicMaterial side={THREE.DoubleSide} />
              </mesh>
            </GrowGroup>

            {/* eventos reais */}
            {showEvents && events.map((e, i) => {
              const l = layers.find((x) => x.team === e.team);
              if (!l) return null;
              const r = e.goal ? 1.05 : 0.6;
              const y = BASE_Y + hOf(tOf(l, e.mx, e.my)) * heightK;
              return (
                <group key={i} position={[worldX(e.mx), y + r, worldZ(e.my)]}>
                  <mesh>
                    <sphereGeometry args={[r, 18, 18]} />
                    <meshStandardMaterial color={e.goal ? "#ffffff" : teamColor(e.team)} emissive={e.goal ? "#ffffff" : teamColor(e.team)} emissiveIntensity={e.goal ? 0.5 : 0.25} toneMapped={false} />
                  </mesh>
                  {e.goal && (
                    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -r + 0.05, 0]}>
                      <ringGeometry args={[r * 1.25, r * 1.7, 32]} />
                      <meshBasicMaterial color={teamColor(e.team)} toneMapped={false} />
                    </mesh>
                  )}
                </group>
              );
            })}

            {/* picos + centro de gravidade */}
            {markers && peaks.map((p, i) => {
              const top = BASE_Y + hOf(p.t) * heightK;
              const rank = peaks.filter((q) => q.team === p.team).indexOf(p) + 1;
              const col = teamColor(p.team);
              return (
                <group key={`${p.team}-${i}`} position={[worldX(p.mx), 0, worldZ(p.my)]}>
                  <Line points={[[0, top, 0], [0, top + 3.2, 0]]} color={col} lineWidth={1.6} />
                  <mesh position={[0, top + 3.4, 0]}>
                    <sphereGeometry args={[0.75, 16, 16]} />
                    <meshBasicMaterial color={col} toneMapped={false} />
                  </mesh>
                  <Html position={[0, top + 5.4, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
                    <div className="whitespace-nowrap rounded-md border border-white/20 bg-slate-950/85 px-1.5 py-0.5 text-[10.5px] font-semibold text-white shadow">
                      <span style={{ color: col }}>#{rank}</span> {nf(p.share * 100)}% · {p.zone}
                    </div>
                  </Html>
                </group>
              );
            })}
            {markers && insights.map((s) => {
              if (!s.centroid) return null;
              const col = teamColor(s.team);
              const y = heightAt(s.centroid.mx, s.centroid.my);
              return (
                <group key={`c-${s.team}`} position={[worldX(s.centroid.mx), 0, worldZ(s.centroid.my)]}>
                  <Line points={[[0, 0.1, 0], [0, y + 1.4, 0]]} color="#ffffff" lineWidth={1} transparent opacity={0.6} dashed dashSize={0.8} gapSize={0.6} />
                  <mesh position={[0, y + 1.8, 0]} rotation={[0, Math.PI / 4, 0]}>
                    <octahedronGeometry args={[1.1, 0]} />
                    <meshStandardMaterial color="#ffffff" emissive={col} emissiveIntensity={0.7} toneMapped={false} />
                  </mesh>
                </group>
              );
            })}

            {pinned && <Probe p={pinned} radius={radius} h={heightAt(pinned.mx, pinned.my)} strong color="#ffffff" />}
            {probe && !pinned && <Probe p={probe} radius={radius} h={heightAt(probe.mx, probe.my)} strong={false} color="#e7f0ff" />}

            <CameraRig target={camTarget} />
            <OrbitControls
              makeDefault enableDamping dampingFactor={0.09}
              minDistance={18} maxDistance={190} maxPolarAngle={Math.PI / 2 - 0.02}
              autoRotate={rotate} autoRotateSpeed={0.9}
            />
          </Canvas>
        </div>

        {/* HUD: leitura da região sob o cursor / fixada */}
        <div className="pointer-events-none absolute left-2.5 top-2.5 max-w-[240px] rounded-lg border border-white/15 bg-slate-950/85 p-2.5 text-[11px] shadow-xl backdrop-blur">
          {info ? (
            <>
              <div className="font-semibold text-white">
                {info.zone.zone}
                <span className="font-normal text-sv-muted"> · gol do {info.zone.goalSide === "left" ? homeName : awayName}</span>
              </div>
              <div className="mt-1.5 space-y-1.5">
                {info.stats.map((s) => (
                  <div key={s.team}>
                    <div className="flex items-center gap-1.5 text-white/90">
                      <span className="h-2 w-2 rounded-full" style={{ background: teamColor(s.team) }} />
                      <span className="truncate">{teamName(s.team)}</span>
                    </div>
                    <div className="text-sv-muted">
                      {real
                        ? s.count
                          ? `${s.count} ${s.count === 1 ? "finalização" : "finalizações"} (≤ ${radius} m) · ${s.goals} ${s.goals === 1 ? "gol" : "gols"} · xG ${s.xgKnown ? nf(s.xg, 2) : "—"}`
                          : `Sem finalizações (≤ ${radius} m)`
                        : `Ocupação relativa ${nf(s.density, 2)}`}
                    </div>
                    <div className="text-sv-muted">Altura: {nf(s.density, s.density >= 10 ? 1 : 2)} /100 m²</div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="text-sv-muted">Passe o mouse (ou toque) no relevo para ler a região. Clique/toque para fixar.</div>
          )}
        </div>

        <div className="pointer-events-none absolute bottom-2 left-2.5 right-2.5 flex flex-wrap items-center justify-between gap-x-3 text-[10px] text-white/55">
          <span>Altura e cor = concentração · {unit}</span>
          <span>arraste p/ girar · pinça/scroll p/ zoom · ◆ centro de gravidade</span>
        </div>
      </div>

      {/* Barra de controles 3D */}
      <div className="space-y-2 rounded-xl border border-sv-border bg-sv-panel2/60 p-3">
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          <Chip active={cam.key === "tilt"} onClick={() => setCam((c) => ({ key: "tilt", n: c.n + 1 }))}>3/4</Chip>
          <Chip active={cam.key === "aerial"} onClick={() => setCam((c) => ({ key: "aerial", n: c.n + 1 }))}>Aérea</Chip>
          <Chip active={cam.key === "low"} onClick={() => setCam((c) => ({ key: "low", n: c.n + 1 }))}>Rasante</Chip>
          <Chip active={cam.key === "atkHome"} onClick={() => setCam((c) => ({ key: "atkHome", n: c.n + 1 }))} title="Câmera atrás do gol que o mandante ataca">
            Ataque {homeName}
          </Chip>
          <Chip active={cam.key === "atkAway"} onClick={() => setCam((c) => ({ key: "atkAway", n: c.n + 1 }))} title="Câmera atrás do gol que o visitante ataca">
            Ataque {awayName}
          </Chip>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-sv-muted">Forma</span>
            <Chip active={mode === "relief"} onClick={() => setMode("relief")}>Relevo</Chip>
            <Chip active={mode === "columns"} onClick={() => setMode("columns")} title="Blocos de 3 × 3 m">Colunas</Chip>
          </div>
          <label className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-sv-muted">
            Altura
            <input type="range" min={0.3} max={2} step={0.05} value={heightK} onChange={(e) => setHeightK(Number(e.target.value))}
                   className="w-24 accent-emerald-500" aria-label="Exagero vertical" />
            <span className="w-8 font-mono normal-case text-white/80">{nf(heightK, 1)}×</span>
          </label>
          <label className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-sv-muted" title="Esconde tudo abaixo de X% do pico e deixa só as zonas mais quentes">
            Corte
            <input type="range" min={0} max={0.8} step={0.05} value={cut} onChange={(e) => setCut(Number(e.target.value))}
                   className="w-24 accent-emerald-500" aria-label="Corte horizontal" />
            <span className="w-10 font-mono normal-case text-white/80">{cut > 0 ? `≥${nf(cut * 100)}%` : "off"}</span>
          </label>
          <div className="flex items-center gap-1.5">
            <Chip active={contours} onClick={() => setContours((v) => !v)} title="Curvas de 25/50/75% do pico">Curvas</Chip>
            <Chip active={markers} onClick={() => setMarkers((v) => !v)} title="Picos numerados e centro de gravidade">Picos</Chip>
            <Chip active={rotate} onClick={() => setRotate((v) => !v)}>Girar</Chip>
          </div>
        </div>
      </div>

      {/* Leitura 3D: números que o relevo resume */}
      <div className={`grid grid-cols-1 gap-3 ${single ? "" : "lg:grid-cols-2"}`}>
        {insights.map((s) => {
          const top = peaks.find((p) => p.team === s.team);
          const col = teamColor(s.team);
          return (
            <div key={s.team} className="rounded-xl border border-sv-border bg-sv-panel2/60 p-3.5" style={{ borderTopColor: col, borderTopWidth: 2 }}>
              <div className="mb-2.5 flex items-center gap-2 text-sm font-semibold">
                <span className="h-2 w-2 rounded-full" style={{ background: col }} />
                <span className="truncate">{teamName(s.team)}</span>
                <span className="ml-auto text-[10px] font-normal text-sv-muted">leitura do relevo</span>
              </div>
              {s.n === 0 ? (
                <p className="text-xs text-sv-muted">Sem eventos neste recorte.</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 sm:grid-cols-4">
                    <Mini k="Pico #1" v={top ? `${nf(top.share * 100)}%` : "—"} sub={top ? `${top.zone} (≤ ${radius} m)` : undefined} />
                    <Mini k="Centro de gravidade" v={s.goalDist != null ? `${nf(s.goalDist, 1)} m` : "—"} sub={s.lateral != null ? `do gol · ${nf(s.lateral, 1)} m do eixo` : undefined} />
                    <Mini k="Zona quente" v={`${nf(s.hotArea)} m²`} sub={`${nf((s.hotArea / (PITCH_L * PITCH_W)) * 100, 1)}% do campo (≥ 50% do pico)`} />
                    <Mini k="Concentração" v={`${nf(s.hotShare * 100)}%`} sub={real ? "das finalizações na zona quente" : "da ocupação na zona quente"} />
                  </div>
                  <div className="mt-3 space-y-1">
                    <div className="text-[10px] uppercase tracking-wider text-sv-muted">Onde se concentra</div>
                    {s.zones.map((z) => (
                      <div key={z.name} className="flex items-center gap-2 text-[11px]">
                        <span className="w-28 shrink-0 truncate text-white/80">{z.name}</span>
                        <div className="h-2 flex-1 overflow-hidden rounded-sm bg-white/5">
                          <div className="h-full rounded-sm" style={{ width: `${z.share * 100}%`, background: col, opacity: 0.9 }} />
                        </div>
                        <span className="w-9 shrink-0 text-right font-mono tabular-nums text-sv-muted">{nf(z.share * 100)}%</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      <p className="px-1 text-[10.5px] leading-relaxed text-sv-muted">
        O relevo usa a mesma densidade (KDE) do mapa 2D: altura e cor representam a concentração relativa ao pico da escala escolhida.
        Curvas = 25 / 50 / 75% do pico. Picos = máximos locais separados por ao menos {PEAK_SEP} m; a porcentagem é a fatia do total do time
        dentro de {radius} m do pico. Centro de gravidade = média ponderada das posições; “zona quente” = área com densidade ≥ 50% do pico do time.
        Com o corte ligado, só aparecem as regiões acima do nível escolhido.
      </p>
    </div>
  );
}

export default HeatmapTerrain3D;
