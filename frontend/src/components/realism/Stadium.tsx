import { memo, useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { GL, GOAL_H, GOAL_W, PENALTY_DIST, netZ, clamp01 } from "./common";

/* ------------------------------ Texturas ---------------------------------- */
function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  if (g) draw(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function makeGrass() {
  const t = canvasTexture(1024, 1024, (g) => {
    for (let i = 0; i < 16; i++) {
      g.fillStyle = i % 2 === 0 ? "#2f8a47" : "#287a3e";
      g.fillRect(i * 64, 0, 64, 1024);
    }
    // ruído de grama
    for (let i = 0; i < 26000; i++) {
      const v = Math.random();
      g.fillStyle = v > 0.5 ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.05)";
      g.fillRect(Math.random() * 1024, Math.random() * 1024, 2, 3 + Math.random() * 3);
    }
  });
  return t;
}

function makeBoard() {
  return canvasTexture(1024, 96, (g) => {
    const grad = g.createLinearGradient(0, 0, 1024, 0);
    grad.addColorStop(0, "#0b3b2e"); grad.addColorStop(0.5, "#0f5a43"); grad.addColorStop(1, "#0b3b2e");
    g.fillStyle = grad; g.fillRect(0, 0, 1024, 96);
    g.fillStyle = "#5ef2b8"; g.font = "bold 54px Arial, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("SCOUTVISION", 280, 50);
    g.fillStyle = "#e2e8f0"; g.font = "600 30px Arial, sans-serif";
    g.fillText("ANÁLISE PRÉ-JOGO", 720, 50);
    g.fillStyle = "#5ef2b8"; g.fillRect(498, 22, 4, 52);
  });
}

function makeGlow() {
  return canvasTexture(128, 128, (g) => {
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.25, "rgba(255,244,214,0.55)"); r.addColorStop(1, "rgba(255,244,214,0)");
    g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  });
}

/* ------------------------------ Gramado + linhas -------------------------- */
const LINE_W = 0.12;

export const Pitch = memo(function Pitch() {
  const grass = useMemo(makeGrass, []);
  useEffect(() => () => grass.dispose(), [grass]);

  const lines = useMemo(() => {
    const L: { x: number; z: number; w: number; d: number }[] = [];
    const halfW = 34;
    L.push({ x: 0, z: GL, w: halfW * 2, d: LINE_W });                       // linha de fundo
    L.push({ x: -halfW, z: GL + 40, w: LINE_W, d: 80 });                    // laterais
    L.push({ x: halfW, z: GL + 40, w: LINE_W, d: 80 });
    L.push({ x: 0, z: GL + 16.5, w: 40.32, d: LINE_W });                    // grande área
    L.push({ x: -20.16, z: GL + 8.25, w: LINE_W, d: 16.5 });
    L.push({ x: 20.16, z: GL + 8.25, w: LINE_W, d: 16.5 });
    L.push({ x: 0, z: GL + 5.5, w: 18.32, d: LINE_W });                     // pequena área
    L.push({ x: -9.16, z: GL + 2.75, w: LINE_W, d: 5.5 });
    L.push({ x: 9.16, z: GL + 2.75, w: LINE_W, d: 5.5 });
    return L;
  }, []);

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.002, GL + 30]} receiveShadow>
        <planeGeometry args={[110, 110]} />
        <meshStandardMaterial map={grass} roughness={0.96} />
      </mesh>
      {lines.map((l, i) => (
        <mesh key={i} rotation-x={-Math.PI / 2} position={[l.x, 0.006, l.z]}>
          <planeGeometry args={[l.w, l.d]} />
          <meshBasicMaterial color="#f1f5f1" />
        </mesh>
      ))}
      {/* marca do pênalti (11 m) e meia-lua da área */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.007, GL + PENALTY_DIST]}>
        <circleGeometry args={[0.13, 20]} />
        <meshBasicMaterial color="#f1f5f1" />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.007, GL + PENALTY_DIST]} rotation-z={Math.PI / 2 - 0.93}>
        <ringGeometry args={[9.15 - LINE_W / 2, 9.15 + LINE_W / 2, 64, 1, 0, 1.86]} />
        <meshBasicMaterial color="#f1f5f1" side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
});

/* ------------------------------ Gol + rede -------------------------------- */
export const GoalFrame = memo(function GoalFrame() {
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#f8fafc", roughness: 0.3, metalness: 0.2 }), []);
  const back = useMemo(() => new THREE.MeshStandardMaterial({ color: "#cbd5e1", roughness: 0.5 }), []);
  return (
    <group>
      {[-GOAL_W / 2, GOAL_W / 2].map((x) => (
        <mesh key={x} material={mat} position={[x, GOAL_H / 2, GL]} castShadow>
          <cylinderGeometry args={[0.06, 0.06, GOAL_H, 14]} />
        </mesh>
      ))}
      <mesh material={mat} position={[0, GOAL_H, GL]} rotation-z={Math.PI / 2} castShadow>
        <cylinderGeometry args={[0.06, 0.06, GOAL_W + 0.12, 14]} />
      </mesh>
      {/* travessas/suportes traseiros */}
      {[-GOAL_W / 2, GOAL_W / 2].map((x) => (
        <group key={x}>
          <mesh material={back} position={[x, GOAL_H / 2, netZ(GOAL_H / 2) ]} rotation-x={0}>
            <cylinderGeometry args={[0.025, 0.025, GOAL_H, 8]} />
          </mesh>
          <mesh material={back} position={[x, 0.02, (GL + netZ(0)) / 2]} rotation-x={Math.PI / 2}>
            <cylinderGeometry args={[0.025, 0.025, Math.abs(netZ(0) - GL), 8]} />
          </mesh>
        </group>
      ))}
    </group>
  );
});

export type NetImpact = { x: number; y: number; amp: number };

type Grid = { positions: Float32Array; index: Uint16Array };

function gridSurface(nu: number, nv: number, pt: (u: number, v: number, out: number[]) => void): Grid {
  const positions = new Float32Array((nu + 1) * (nv + 1) * 3);
  const tmp: number[] = [0, 0, 0];
  const id = (i: number, j: number) => j * (nu + 1) + i;
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      pt(i / nu, j / nv, tmp);
      const k = id(i, j) * 3;
      positions[k] = tmp[0]; positions[k + 1] = tmp[1]; positions[k + 2] = tmp[2];
    }
  }
  const idx: number[] = [];
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      if (i < nu) idx.push(id(i, j), id(i + 1, j));
      if (j < nv) idx.push(id(i, j), id(i, j + 1));
    }
  }
  return { positions, index: new Uint16Array(idx) };
}

function toGeometry(g: Grid) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(g.positions.slice(), 3));
  geo.setIndex(new THREE.BufferAttribute(g.index, 1));
  return geo;
}

/** Rede do gol: o fundo balança (bolha + oscilação amortecida) onde a bola bate. */
export function GoalNet({ impactRef }: { impactRef: MutableRefObject<NetImpact> }) {
  const parts = useMemo(() => {
    const W = GOAL_W, H = GOAL_H;
    const back = gridSurface(40, 16, (u, v, o) => { const y = v * H; o[0] = (u - 0.5) * W; o[1] = y; o[2] = netZ(y); });
    const side = (s: number) => gridSurface(10, 12, (u, v, o) => { const y = v * H; o[0] = s * W / 2; o[1] = y; o[2] = GL + u * (netZ(y) - GL); });
    const top = gridSurface(40, 10, (u, v, o) => { o[0] = (u - 0.5) * W; o[1] = H; o[2] = GL + v * (netZ(H) - GL); });
    return {
      backBase: back.positions,
      backGeo: toGeometry(back),
      others: [toGeometry(side(-1)), toGeometry(side(1)), toGeometry(top)],
    };
  }, []);
  const mat = useMemo(() => new THREE.LineBasicMaterial({ color: "#e5e7eb", transparent: true, opacity: 0.5 }), []);

  useEffect(() => () => {
    parts.backGeo.dispose(); parts.others.forEach((g) => g.dispose()); mat.dispose();
  }, [parts, mat]);

  const wasActive = useRef(false);
  useFrame(() => {
    const imp = impactRef.current;
    const active = imp.amp > 0.002;
    if (!active && !wasActive.current) return;
    wasActive.current = active;
    const attr = parts.backGeo.getAttribute("position") as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const base = parts.backBase;
    for (let i = 0; i < base.length; i += 3) {
      const dx = base[i] - imp.x, dy = base[i + 1] - imp.y;
      const w = Math.exp(-(dx * dx + dy * dy) / (2 * 0.85 * 0.85));
      arr[i] = base[i] - dx * 0.06 * w * imp.amp * 2;      // a rede “puxa” para o ponto de impacto
      arr[i + 1] = base[i + 1] - dy * 0.06 * w * imp.amp * 2;
      arr[i + 2] = base[i + 2] - imp.amp * w;
    }
    attr.needsUpdate = true;
  });

  return (
    <group>
      <lineSegments geometry={parts.backGeo} material={mat} frustumCulled={false} />
      {parts.others.map((g, i) => <lineSegments key={i} geometry={g} material={mat} frustumCulled={false} />)}
    </group>
  );
}

/* ------------------------------ Placas de LED ----------------------------- */
export const AdBoards = memo(function AdBoards() {
  const tex = useMemo(() => { const t = makeBoard(); t.wrapS = THREE.RepeatWrapping; t.repeat.set(3, 1); return t; }, []);
  const texSide = useMemo(() => { const t = makeBoard(); t.wrapS = THREE.RepeatWrapping; t.repeat.set(5, 1); return t; }, []);
  useEffect(() => () => { tex.dispose(); texSide.dispose(); }, [tex, texSide]);
  return (
    <group>
      <mesh position={[0, 0.52, GL - 6]}>
        <boxGeometry args={[60, 1.0, 0.18]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 37, 0.52, GL + 30]} rotation-y={Math.PI / 2}>
          <boxGeometry args={[90, 1.0, 0.18]} />
          <meshBasicMaterial map={texSide} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
});

/* ------------------------------ Arquibancadas + torcida ------------------- */
type Seat = { x: number; y: number; z: number; ph: number; c: THREE.Color };
const CROWD_COLORS = ["#e11d48", "#f8fafc", "#2563eb", "#facc15", "#1e293b", "#16a34a", "#f97316", "#94a3b8", "#7c3aed"];

function buildSeats(): Seat[] {
  const seats: Seat[] = [];
  const rnd = (() => { let s = 7; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();
  const pushSeat = (x: number, y: number, z: number) => {
    seats.push({ x, y, z, ph: rnd() * Math.PI * 2, c: new THREE.Color(CROWD_COLORS[Math.floor(rnd() * CROWD_COLORS.length)]) });
  };
  // atrás do gol
  for (let r = 0; r < 14; r++) for (let c = 0; c < 70; c++) pushSeat((c - 34.5) * 0.85 + (rnd() - 0.5) * 0.1, 0.9 + r * 0.62, GL - 8.4 - r * 0.85);
  // laterais
  for (const s of [-1, 1]) {
    for (let r = 0; r < 9; r++) for (let c = 0; c < 46; c++) pushSeat(s * (40.4 + r * 0.85), 0.9 + r * 0.62, GL - 5 + c * 1.1);
  }
  return seats;
}

/** Excitação da torcida: 0 = calma, 1 = festa (gol). Lida via ref para não re-renderizar. */
export const Crowd = memo(function Crowd({ exciteRef, positions }: { exciteRef: MutableRefObject<number>; positions?: Float32Array }) {
  const bodies = useRef<THREE.InstancedMesh>(null);
  const heads = useRef<THREE.InstancedMesh>(null);
  const seats = useMemo<Seat[]>(() => {
    if (!positions) return buildSeats();
    // posições vindas do estádio 3D (x, y, z de cada assento)
    let s = 7;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const out: Seat[] = [];
    for (let i = 0; i + 2 < positions.length; i += 3) {
      out.push({ x: positions[i], y: positions[i + 1], z: positions[i + 2], ph: rnd() * Math.PI * 2, c: new THREE.Color(CROWD_COLORS[Math.floor(rnd() * CROWD_COLORS.length)]) });
    }
    return out;
  }, [positions]);
  const big = !!positions;                      // torcedores um pouco maiores no estádio 3D (poucos, em primeiro plano)
  const k = big ? 1.3 : 1;
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const frame = useRef(0);

  const heads_c = useMemo(() => {
    const skins = ["#f1c7a0", "#d8a47f", "#b98056", "#8d5a3b", "#5b3a26"].map((c) => new THREE.Color(c));
    return seats.map((_, i) => skins[i % skins.length]);
  }, [seats]);

  useEffect(() => {
    const b = bodies.current, h = heads.current;
    if (!b || !h) return;
    seats.forEach((s, i) => {
      b.setColorAt(i, s.c);
      h.setColorAt(i, heads_c[i]);
      dummy.position.set(s.x, s.y + 0.22 * k, s.z); dummy.scale.setScalar(k); dummy.updateMatrix(); b.setMatrixAt(i, dummy.matrix);
      dummy.position.set(s.x, s.y + 0.6 * k, s.z); dummy.updateMatrix(); h.setMatrixAt(i, dummy.matrix);
    });
    if (b.instanceColor) b.instanceColor.needsUpdate = true;
    if (h.instanceColor) h.instanceColor.needsUpdate = true;
    b.instanceMatrix.needsUpdate = true; h.instanceMatrix.needsUpdate = true;
  }, [seats, heads_c, dummy, k]);

  const calm = useRef(false);
  useFrame((state) => {
    frame.current++;
    const b = bodies.current, h = heads.current;
    if (!b || !h) return;
    const ex = exciteRef.current;
    const ba = b.instanceMatrix.array as Float32Array, ha = h.instanceMatrix.array as Float32Array;
    // torcida calma: o balanço é imperceptível, então volta ao repouso uma vez e não gasta mais nada
    if (ex < 0.03) {
      if (!calm.current) {
        for (let i = 0; i < seats.length; i++) { ba[i * 16 + 13] = seats[i].y + 0.22 * k; ha[i * 16 + 13] = seats[i].y + 0.6 * k; }
        b.instanceMatrix.needsUpdate = true; h.instanceMatrix.needsUpdate = true; calm.current = true;
      }
      return;
    }
    calm.current = false;
    if (frame.current & 1) return;                      // 30 Hz é suficiente para a torcida pulando
    const t = state.clock.elapsedTime;
    const w = 4 + ex * 5, amp = 0.012 + 0.2 * ex;
    for (let i = 0; i < seats.length; i++) {
      const s = seats[i];
      const jump = Math.max(0, Math.sin(t * w + s.ph)) * amp;
      ba[i * 16 + 13] = s.y + 0.22 * k + jump;          // só a translação Y da matriz (sem recompor a matriz inteira)
      ha[i * 16 + 13] = s.y + 0.6 * k + jump;
    }
    b.instanceMatrix.needsUpdate = true; h.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh ref={bodies} args={[undefined, undefined, seats.length]} frustumCulled={false}>
        <boxGeometry args={[0.46, 0.5, 0.34]} />
        <meshStandardMaterial roughness={0.9} />
      </instancedMesh>
      <instancedMesh ref={heads} args={[undefined, undefined, seats.length]} frustumCulled={false}>
        <sphereGeometry args={[0.11, 8, 6]} />
        <meshStandardMaterial roughness={0.8} />
      </instancedMesh>
    </group>
  );
});

/** Degraus de concreto das arquibancadas. */
export const StandsStructure = memo(function StandsStructure() {
  const concrete = useMemo(() => new THREE.MeshStandardMaterial({ color: "#2b3445", roughness: 0.95 }), []);
  return (
    <group>
      {Array.from({ length: 14 }, (_, r) => (
        <mesh key={`b${r}`} material={concrete} position={[0, (0.6 + r * 0.62) / 2 + 0.05, GL - 8.4 - r * 0.85]}>
          <boxGeometry args={[62, 0.6 + r * 0.62, 0.85]} />
        </mesh>
      ))}
      {[-1, 1].flatMap((s) => Array.from({ length: 9 }, (_, r) => (
        <mesh key={`s${s}${r}`} material={concrete} position={[s * (40.4 + r * 0.85), (0.6 + r * 0.62) / 2 + 0.05, GL + 20]}>
          <boxGeometry args={[0.85, 0.6 + r * 0.62, 56]} />
        </mesh>
      )))}
      {/* telhado atrás do gol */}
      <mesh position={[0, 11.5, GL - 17]} rotation-x={0.18}>
        <boxGeometry args={[66, 0.4, 14]} />
        <meshStandardMaterial color="#1b2333" roughness={0.8} />
      </mesh>
    </group>
  );
});

/** Flashes de câmeras do público (piscam em fases diferentes). */
export const Flashes = memo(function Flashes({ anchors }: { anchors?: Float32Array }) {
  const a = useRef<THREE.Points>(null);
  const b = useRef<THREE.Points>(null);
  const geo = useMemo(() => {
    const make = (seed: number) => {
      const pos: number[] = [];
      const n = anchors ? Math.floor(anchors.length / 3) : 0;
      for (let i = 0; i < 70; i++) {
        const r = Math.abs(Math.sin(seed * 31.7 + i * 12.9)), r2 = Math.abs(Math.sin(seed * 7.3 + i * 78.2)), r3 = Math.abs(Math.sin(i * 3.1 + seed));
        if (n > 0) {
          const k = Math.floor(r * n) % n;          // um assento qualquer, um pouco acima da cabeça
          pos.push(anchors![k * 3], anchors![k * 3 + 1] + 1.1, anchors![k * 3 + 2]);
        } else {
          const row = Math.floor(r * 13);
          pos.push((r2 - 0.5) * 56, 1.5 + row * 0.62, GL - 8.4 - row * 0.85 + (r3 - 0.5) * 0.2);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      return g;
    };
    return [make(1), make(2)];
  }, [anchors]);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const ma = a.current?.material as THREE.PointsMaterial | undefined;
    const mb = b.current?.material as THREE.PointsMaterial | undefined;
    if (ma) ma.opacity = clamp01(Math.sin(t * 9.3) * 3 - 1.8);
    if (mb) mb.opacity = clamp01(Math.sin(t * 7.1 + 2) * 3 - 1.8);
  });
  return (
    <group>
      <points ref={a} geometry={geo[0]}><pointsMaterial color="#ffffff" size={0.35} transparent opacity={0} depthWrite={false} toneMapped={false} /></points>
      <points ref={b} geometry={geo[1]}><pointsMaterial color="#fff6d8" size={0.3} transparent opacity={0} depthWrite={false} toneMapped={false} /></points>
    </group>
  );
});

/** Torres de refletores com brilho. */
export const Floodlights = memo(function Floodlights() {
  const glow = useMemo(makeGlow, []);
  useEffect(() => () => glow.dispose(), [glow]);
  const spots: [number, number][] = [[-46, GL - 14], [46, GL - 14], [-46, GL + 62], [46, GL + 62]];
  return (
    <group>
      {spots.map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position={[0, 15, 0]}>
            <cylinderGeometry args={[0.35, 0.55, 30, 8]} />
            <meshStandardMaterial color="#3b4252" roughness={0.7} />
          </mesh>
          <mesh position={[0, 31, 0]} rotation-y={x > 0 ? -0.5 : 0.5}>
            <boxGeometry args={[7, 4, 0.5]} />
            <meshBasicMaterial color="#fff7dd" toneMapped={false} />
          </mesh>
          <sprite position={[x > 0 ? -1 : 1, 31, 1]} scale={[30, 30, 1]}>
            <spriteMaterial map={glow} blending={THREE.AdditiveBlending} transparent depthWrite={false} opacity={0.9} toneMapped={false} />
          </sprite>
        </group>
      ))}
    </group>
  );
});
