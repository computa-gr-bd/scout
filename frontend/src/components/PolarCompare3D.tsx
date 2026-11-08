import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { Billboard, Line, OrbitControls, Text } from "@react-three/drei";
import * as THREE from "three";
import type { PolarSeries } from "./PolarCompare";

type Axis = { key: string; label: string };
type Hover = { si: number; i: number } | null;

const R3 = 3;                 // raio do gráfico no mundo 3D (nota 100)
const MAX_H = 2.4;            // altura máxima no modo "Relevo" (nota 100)
const RINGS = [25, 50, 75, 100];

/** Mesma convenção do 2D: ângulo em tela (y para baixo) → posição no plano XZ do mundo. */
const world = (a: number, r: number, y = 0): [number, number, number] => [r * Math.cos(a), y, r * Math.sin(a)];

/** Setor extrudado para cima (eixo Y do mundo), de ``a0`` a ``a1`` radianos, com raio ``r`` e altura ``h``. */
function wedgeGeometry(a0: number, a1: number, r: number, h: number) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  const seg = Math.max(4, Math.ceil((a1 - a0) / 0.07));
  for (let i = 0; i <= seg; i++) {
    const a = a0 + ((a1 - a0) * i) / seg;
    shape.lineTo(r * Math.cos(a), -r * Math.sin(a));
  }
  shape.lineTo(0, 0);
  const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
  g.rotateX(-Math.PI / 2); // (x, y, z) → (x, z, -y): a extrusão passa a subir em Y
  return g;
}

function circlePoints(r: number, y = 0.003, n = 96): [number, number, number][] {
  return Array.from({ length: n + 1 }, (_, i) => world((i / n) * Math.PI * 2, r, y));
}

/* ------------------------------------------------------------------ setor 3D */
function Wedge({
  a0, a1, r, h, y, color, dim, active, offset, layered, onOver, onOut, onMove, onClick,
}: {
  a0: number; a1: number; r: number; h: number; y: number; color: string;
  dim: boolean; active: boolean; offset: [number, number]; layered: boolean;
  onOver: () => void; onOut: () => void; onMove: (e: ThreeEvent<PointerEvent>) => void; onClick: () => void;
}) {
  const geo = useMemo(() => wedgeGeometry(a0, a1, r, h), [a0, a1, r, h]);
  const edges = useMemo(() => new THREE.EdgesGeometry(geo, 30), [geo]);
  useEffect(() => () => { geo.dispose(); edges.dispose(); }, [geo, edges]);

  const group = useRef<THREE.Group>(null);
  const grow = useRef(0);
  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    const k = Math.min(1, dt * 5);
    grow.current += (1 - grow.current) * k;                    // entrada: cresce do centro
    g.scale.set(grow.current, grow.current, grow.current);
    g.position.x += (offset[0] - g.position.x) * k;          // "explodir" / destaque do eixo
    g.position.z += (offset[1] - g.position.z) * k;
  });

  return (
    <group ref={group} position={[0, y, 0]}>
      <mesh
        geometry={geo}
        onPointerOver={(e) => { e.stopPropagation(); onOver(); }}
        onPointerOut={onOut}
        onPointerMove={(e) => { e.stopPropagation(); onMove(e); }}
        onClick={(e) => { e.stopPropagation(); onClick(); }}
      >
        <meshStandardMaterial
          color={color}
          transparent
          opacity={dim ? 0.18 : active ? 0.95 : 0.78}
          depthWrite={!layered}
          emissive={color}
          emissiveIntensity={active ? 0.6 : 0.14}
          roughness={0.45}
          metalness={0.1}
        />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={color} transparent opacity={dim ? 0.2 : 1} />
      </lineSegments>
    </group>
  );
}

/* ------------------------------------------------------------------ radar 3D */
function RadarShape({
  pts, color, relevo, dim,
}: {
  pts: { x: number; z: number; y: number }[];
  color: string; relevo: boolean; dim: boolean;
}) {
  const geo = useMemo(() => {
    const cy = pts.reduce((s, p) => s + p.y, 0) / Math.max(1, pts.length);
    const pos: number[] = [0, cy, 0];
    pts.forEach((p) => pos.push(p.x, p.y, p.z));
    const idx: number[] = [];
    for (let i = 0; i < pts.length; i++) idx.push(0, 1 + i, 1 + ((i + 1) % pts.length));
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }, [pts]);
  useEffect(() => () => geo.dispose(), [geo]);

  const group = useRef<THREE.Group>(null);
  const grow = useRef(0);
  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    grow.current += (1 - grow.current) * Math.min(1, dt * 4);
    g.scale.set(grow.current, grow.current, grow.current);
  });

  const outline = useMemo(
    () => [...pts, pts[0]].map((p) => [p.x, p.y + 0.01, p.z] as [number, number, number]),
    [pts],
  );

  return (
    <group ref={group}>
      <mesh geometry={geo}>
        <meshStandardMaterial
          color={color}
          side={THREE.DoubleSide}
          transparent
          opacity={dim ? 0.1 : 0.32}
          depthWrite={false}
          flatShading
          emissive={color}
          emissiveIntensity={0.18}
        />
      </mesh>
      <Line points={outline} color={color} lineWidth={2.2} transparent opacity={dim ? 0.3 : 1} />
      {relevo && pts.map((p, i) => (
        <Line key={i} points={[[p.x, 0, p.z], [p.x, p.y, p.z]]} color={color} lineWidth={1} transparent opacity={0.35} />
      ))}
    </group>
  );
}

/** Um jogador no radar 3D: polígono + vértices clicáveis (memoizado para não recriar a malha a cada hover). */
function RadarSeries({
  series, si, n, start, step, relevo, selected, hover, setHover, onMove, onPick,
}: {
  series: PolarSeries; si: number; n: number; start: number; step: number;
  relevo: boolean; selected: number | null; hover: Hover;
  setHover: (h: Hover) => void; onMove: (e: ThreeEvent<PointerEvent>) => void; onPick: (i: number) => void;
}) {
  const layerY = si * 0.12 + 0.03;
  const pts = useMemo(
    () => Array.from({ length: n }, (_, i) => {
      const score = series.scores[i] ?? 0;
      const [x, , z] = world(start + (i + 0.5) * step, (R3 * score) / 100);
      return { x, z, y: relevo ? (score / 100) * MAX_H : layerY };
    }),
    [series, n, start, step, relevo, layerY],
  );
  return (
    <group>
      <RadarShape pts={pts} color={series.color} relevo={relevo} dim={selected !== null} />
      {pts.map((p, i) => {
        const on = (hover?.si === si && hover.i === i) || selected === i;
        return (
          <mesh
            key={i}
            position={[p.x, p.y, p.z]}
            scale={on ? 1.8 : 1}
            onPointerOver={(e) => { e.stopPropagation(); setHover({ si, i }); }}
            onPointerOut={() => setHover(null)}
            onPointerMove={(e) => { e.stopPropagation(); onMove(e); }}
            onClick={(e) => { e.stopPropagation(); onPick(i); }}
          >
            <sphereGeometry args={[0.085, 20, 20]} />
            <meshStandardMaterial color={series.color} emissive={series.color} emissiveIntensity={on ? 0.9 : 0.35} />
          </mesh>
        );
      })}
    </group>
  );
}

/* ------------------------------------------------------------------ grade e rótulos */
function Grid({ n, step, start, mode }: { n: number; step: number; start: number; mode: "polar" | "radar" }) {
  const spokeAngles = Array.from({ length: n }, (_, i) => (mode === "radar" ? start + (i + 0.5) * step : start + i * step));
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <circleGeometry args={[R3, 96]} />
        <meshBasicMaterial color="#111a2b" transparent opacity={0.85} />
      </mesh>
      {RINGS.map((v) => (
        <group key={v}>
          <Line
            points={circlePoints((R3 * v) / 100)}
            color={v === 50 ? "#3b5280" : "#22314f"}
            lineWidth={v === 50 ? 1.4 : 1}
            dashed={v === 50}
            dashSize={0.12}
            gapSize={0.09}
          />
          <Billboard position={world(-Math.PI / 2 + 0.07, (R3 * v) / 100, 0.02)}>
            <Text fontSize={0.12} color="#8794ad" anchorX="left" anchorY="middle">{String(v)}</Text>
          </Billboard>
        </group>
      ))}
      {spokeAngles.map((a, i) => (
        <Line key={i} points={[world(a, 0, 0.003), world(a, R3, 0.003)]} color="#22314f" lineWidth={1} />
      ))}
    </group>
  );
}

function AxisLabel({
  axis, mid, selected, onClick,
}: { axis: Axis; mid: number; selected: boolean; onClick: () => void }) {
  return (
    <Billboard position={world(mid, R3 + 0.6, 0.05)}>
      <Text
        fontSize={selected ? 0.24 : 0.2}
        color={selected ? "#5ef2b8" : "#cbd5e1"}
        anchorX="center"
        anchorY="middle"
        maxWidth={1.7}
        textAlign="center"
        onClick={(e) => { e.stopPropagation(); onClick(); }}
      >
        {axis.label}
      </Text>
    </Billboard>
  );
}

/* ------------------------------------------------------------------ cena */
function Scene({
  axes, series, mode, relevo, explode, selected, hover, setHover, setTip, setSelected, auto,
}: {
  axes: Axis[]; series: PolarSeries[]; mode: "polar" | "radar";
  relevo: boolean; explode: boolean; selected: number | null; hover: Hover;
  setHover: (h: Hover) => void; setTip: (t: { x: number; y: number }) => void;
  setSelected: (i: number | null) => void; auto: boolean;
}) {
  const n = axes.length;
  const step = (2 * Math.PI) / n;
  const start = -Math.PI / 2 - step / 2;
  const gap = 0.02;
  const ns = Math.max(1, series.length);
  const controls = useRef<any>(null);

  const toggleSel = (i: number) => setSelected(selected === i ? null : i);
  const move = (e: ThreeEvent<PointerEvent>) => setTip({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY });

  return (
    <>
      <color attach="background" args={["#0a0f1a"]} />
      <fog attach="fog" args={["#0a0f1a", 9, 22]} />
      <ambientLight intensity={0.75} />
      <directionalLight position={[4, 8, 3]} intensity={1.1} />
      <directionalLight position={[-5, 5, -4]} intensity={0.45} />

      <Grid n={n} step={step} start={start} mode={mode} />

      {axes.map((a, i) => (
        <AxisLabel key={a.key} axis={a} mid={start + (i + 0.5) * step} selected={selected === i} onClick={() => toggleSel(i)} />
      ))}

      {mode === "polar" && series.map((s, si) =>
        axes.map((a, i) => {
          const score = s.scores[i];
          if (score == null) return null;
          const sa = start + i * step + gap;
          const ea = start + (i + 1) * step - gap;
          // Relevo: cada jogador ganha uma fatia do setor (barras lado a lado, altura = nota).
          const a0 = relevo ? sa + ((ea - sa) * si) / ns + (si > 0 ? 0.006 : 0) : sa;
          const a1 = relevo ? sa + ((ea - sa) * (si + 1)) / ns - (si < ns - 1 ? 0.006 : 0) : ea;
          const h = relevo ? 0.08 + (score / 100) * MAX_H : 0.09;
          const y = relevo ? 0 : si * 0.11;
          const mid = start + (i + 0.5) * step;
          const lift = (explode ? 0.4 : 0) + (selected === i ? 0.22 : 0);
          const active = hover?.si === si && hover.i === i;
          return (
            <Wedge
              key={`${s.id}-${a.key}`}
              a0={a0} a1={a1} r={(R3 * score) / 100} h={h} y={y}
              color={s.color}
              dim={selected !== null && selected !== i}
              active={active || selected === i}
              layered={!relevo}
              offset={[Math.cos(mid) * lift, Math.sin(mid) * lift]}
              onOver={() => setHover({ si, i })}
              onOut={() => setHover(null)}
              onMove={move}
              onClick={() => toggleSel(i)}
            />
          );
        }),
      )}

      {mode === "radar" && series.map((s, si) => (
        <RadarSeries
          key={s.id}
          series={s} si={si} n={n} start={start} step={step}
          relevo={relevo} selected={selected} hover={hover}
          setHover={setHover} onMove={move} onPick={toggleSel}
        />
      ))}

      <OrbitControls
        ref={controls}
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        minDistance={4.5}
        maxDistance={13}
        maxPolarAngle={Math.PI / 2.05}
        autoRotate={auto && !hover}
        autoRotateSpeed={1.4}
      />
    </>
  );
}

/* ------------------------------------------------------------------ componente público */
/**
 * Versão 3D (giratória) do gráfico de comparação: arraste para girar, role para aproximar.
 * Setores ou radar, "Relevo" (altura = nota), "Explodir" os setores, rotação automática,
 * hover com a nota e clique num eixo para isolá-lo e comparar os jogadores.
 */
export function PolarCompare3D({ axes, series, mode = "polar" }: {
  axes: Axis[];
  series: PolarSeries[];
  mode?: "polar" | "radar";
}) {
  const [auto, setAuto] = useState(
    () => typeof window !== "undefined" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [relevo, setRelevo] = useState(false);
  const [explode, setExplode] = useState(false);
  const [hover, setHover] = useState<Hover>(null);
  const [tip, setTip] = useState({ x: 0, y: 0 });
  const [selected, setSelected] = useState<number | null>(null);
  const [resetKey, setResetKey] = useState(0);

  if (axes.length < 3) return null;

  const hoverSeries = hover ? series[hover.si] : null;
  const hoverScore = hover && hoverSeries ? hoverSeries.scores[hover.i] : null;

  const chip = (on: boolean) =>
    `rounded-full border px-3 py-1 text-xs transition ${on ? "border-sv-accent3 text-sv-accent3 bg-sv-accent/10" : "border-sv-border text-sv-muted hover:text-sv-text"}`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Controles do gráfico 3D">
        <button type="button" aria-pressed={auto} onClick={() => setAuto((v) => !v)} className={chip(auto)}>Girar sozinho</button>
        <button type="button" aria-pressed={relevo} onClick={() => setRelevo((v) => !v)} className={chip(relevo)} title="A altura passa a representar a nota">Relevo</button>
        {mode === "polar" && (
          <button type="button" aria-pressed={explode} onClick={() => setExplode((v) => !v)} className={chip(explode)}>Explodir</button>
        )}
        <button type="button" onClick={() => { setResetKey((k) => k + 1); setSelected(null); }} className={chip(false)}>Resetar câmera</button>
      </div>

      <div className={`relative h-[460px] overflow-hidden rounded-lg border border-sv-border bg-sv-bg ${hover ? "cursor-pointer" : "cursor-grab"}`}>
        <Canvas
          key={resetKey}
          camera={{ position: [0, 5.6, 6.8], fov: 40, near: 0.1, far: 60 }}
          dpr={[1, 2]}
          gl={{ antialias: true }}
          onPointerMissed={() => setSelected(null)}
        >
          <Suspense fallback={null}>
            <Scene
              axes={axes} series={series} mode={mode}
              relevo={relevo} explode={explode} selected={selected}
              hover={hover} setHover={setHover} setTip={setTip} setSelected={setSelected} auto={auto}
            />
          </Suspense>
        </Canvas>

        {hover && hoverSeries && hoverScore != null && (
          <div
            className="pointer-events-none absolute z-10 rounded-lg border border-sv-border bg-sv-panel/95 px-2.5 py-1.5 text-xs shadow-lg"
            style={{ left: tip.x + 14, top: tip.y + 14 }}
          >
            <div className="flex items-center gap-1.5 font-medium">
              <span className="h-2 w-2 rounded-full" style={{ background: hoverSeries.color }} />
              {hoverSeries.name}
            </div>
            <div className="text-sv-muted">
              {axes[hover.i].label}: <span className="font-mono font-semibold text-sv-text">{hoverScore.toFixed(0)}</span>
            </div>
          </div>
        )}

        <p className="pointer-events-none absolute bottom-2 left-3 text-[10.5px] text-sv-muted">
          Arraste para girar · role para aproximar · clique num eixo para isolar
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Isolar eixo">
        {axes.map((a, i) => (
          <button key={a.key} type="button" aria-pressed={selected === i} onClick={() => setSelected(selected === i ? null : i)} className={chip(selected === i)}>
            {a.label}
          </button>
        ))}
      </div>

      {selected !== null && (
        <div className="space-y-1.5 rounded-lg border border-sv-border bg-sv-panel2/40 p-3 text-xs">
          <div className="font-medium">{axes[selected].label}</div>
          {[...series]
            .map((s) => ({ s, v: s.scores[selected] }))
            .sort((a, b) => (b.v ?? -1) - (a.v ?? -1))
            .map(({ s, v }) => (
              <div key={s.id} className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
                <span className="w-32 shrink-0 truncate">{s.name}</span>
                <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-sv-panel2">
                  <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${v ?? 0}%`, background: s.color }} />
                </div>
                <span className="w-8 shrink-0 text-right font-mono tabular-nums">{v == null ? "—" : v.toFixed(0)}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
