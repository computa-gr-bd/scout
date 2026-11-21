/**
 * PitchTurf3D.tsx — gramado 3D com as marcações CORRETAS (medidas FIFA) e traves com rede.
 *
 * As linhas são desenhadas numa textura de canvas (em metros) em vez de dezenas de caixas
 * sobrepostas: assim não há "briga de profundidade" (z-fighting) ao girar a câmera, as linhas ficam
 * nítidas com anisotropia e os arcos (grande área, círculo central, escanteios) saem perfeitos.
 *
 * Mundo: x = comprimento (−52,5 … +52,5), z = largura (−34 … +34), y = altura. O gol da direita é o
 * do ataque (x = +52,5), igual a `toWorld()` de lib/shotAnalytics.
 */
import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";

export const TURF_L = 105;
export const TURF_W = 68;
const PAD = 7; // grama além das linhas (m)
const PX = 22; // pixels por metro da textura
const GOAL_W = 7.32;
const GOAL_H = 2.44;
const GOAL_D = 2.2;

function drawTurfTexture(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.round((TURF_L + PAD * 2) * PX);
  c.height = Math.round((TURF_W + PAD * 2) * PX);
  const g = c.getContext("2d")!;
  const X = (m: number) => (m + PAD) * PX;
  const Y = (m: number) => (m + PAD) * PX;

  // gramado + faixas de corte
  g.fillStyle = "#14502f";
  g.fillRect(0, 0, c.width, c.height);
  const bands = 15;
  const bw = TURF_L / bands;
  for (let i = 0; i < bands; i++) {
    g.fillStyle = i % 2 === 0 ? "#1b6b40" : "#175c36";
    g.fillRect(X(i * bw), Y(0), bw * PX + 1, TURF_W * PX);
  }

  // linhas
  g.strokeStyle = "rgba(255,255,255,0.94)";
  g.fillStyle = "rgba(255,255,255,0.94)";
  g.lineWidth = 0.17 * PX;
  g.lineJoin = "miter";
  g.lineCap = "butt";
  const cy = TURF_W / 2;
  const rect = (x: number, y: number, w: number, h: number) => g.strokeRect(X(x), Y(y), w * PX, h * PX);
  const arc = (cx: number, cyy: number, r: number, a0: number, a1: number) => {
    g.beginPath();
    g.arc(X(cx), Y(cyy), r * PX, a0, a1);
    g.stroke();
  };
  const dot = (x: number, y: number, r = 0.28) => {
    g.beginPath();
    g.arc(X(x), Y(y), r * PX, 0, Math.PI * 2);
    g.fill();
  };

  rect(0, 0, TURF_L, TURF_W); // limites
  g.beginPath(); // linha do meio
  g.moveTo(X(TURF_L / 2), Y(0));
  g.lineTo(X(TURF_L / 2), Y(TURF_W));
  g.stroke();
  arc(TURF_L / 2, cy, 9.15, 0, Math.PI * 2); // círculo central
  dot(TURF_L / 2, cy);

  const phi = Math.acos(5.5 / 9.15); // trecho do arco que fica fora da grande área
  rect(0, cy - 20.16, 16.5, 40.32); // grande área esquerda
  rect(0, cy - 9.16, 5.5, 18.32); // pequena área esquerda
  dot(11, cy);
  arc(11, cy, 9.15, -phi, phi);
  rect(TURF_L - 16.5, cy - 20.16, 16.5, 40.32); // grande área direita
  rect(TURF_L - 5.5, cy - 9.16, 5.5, 18.32); // pequena área direita
  dot(TURF_L - 11, cy);
  arc(TURF_L - 11, cy, 9.15, Math.PI - phi, Math.PI + phi);

  // escanteios (raio 1 m)
  arc(0, 0, 1, 0, Math.PI / 2);
  arc(TURF_L, 0, 1, Math.PI / 2, Math.PI);
  arc(TURF_L, TURF_W, 1, Math.PI, Math.PI * 1.5);
  arc(0, TURF_W, 1, Math.PI * 1.5, Math.PI * 2);
  return c;
}

/** Linhas de uma grade retangular (rede) a partir de `o`, ao longo de `a` e `b`. */
function gridLines(o: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, na: number, nb: number, out: number[]) {
  for (let i = 0; i <= na; i++) {
    const p = o.clone().addScaledVector(a, i / na);
    const q = p.clone().add(b);
    out.push(p.x, p.y, p.z, q.x, q.y, q.z);
  }
  for (let j = 0; j <= nb; j++) {
    const p = o.clone().addScaledVector(b, j / nb);
    const q = p.clone().add(a);
    out.push(p.x, p.y, p.z, q.x, q.y, q.z);
  }
}

/** Trave com rede. Em +x o gol abre para dentro do campo (rede para fora, em +x). */
function Goal({ side }: { side: 1 | -1 }) {
  const netGeo = useMemo(() => {
    const out: number[] = [];
    const hw = GOAL_W / 2;
    // fundo
    gridLines(new THREE.Vector3(GOAL_D, 0, -hw), new THREE.Vector3(0, 0, GOAL_W), new THREE.Vector3(0, GOAL_H, 0), 24, 10, out);
    // teto
    gridLines(new THREE.Vector3(0, GOAL_H, -hw), new THREE.Vector3(0, 0, GOAL_W), new THREE.Vector3(GOAL_D, 0, 0), 24, 8, out);
    // laterais
    gridLines(new THREE.Vector3(0, 0, -hw), new THREE.Vector3(GOAL_D, 0, 0), new THREE.Vector3(0, GOAL_H, 0), 8, 10, out);
    gridLines(new THREE.Vector3(0, 0, hw), new THREE.Vector3(GOAL_D, 0, 0), new THREE.Vector3(0, GOAL_H, 0), 8, 10, out);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(out, 3));
    return g;
  }, []);
  useEffect(() => () => netGeo.dispose(), [netGeo]);

  const post = 0.06;
  return (
    <group position={[side * (TURF_L / 2), 0, 0]} scale={[side, 1, 1]}>
      {/* traves e travessão */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0, GOAL_H / 2, s * (GOAL_W / 2)]} castShadow>
          <cylinderGeometry args={[post, post, GOAL_H, 12]} />
          <meshStandardMaterial color="#f8fafc" roughness={0.4} />
        </mesh>
      ))}
      <mesh position={[0, GOAL_H, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[post, post, GOAL_W + post * 2, 12]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.4} />
      </mesh>
      {/* suportes traseiros */}
      {[-1, 1].map((s) => (
        <mesh key={`b${s}`} position={[GOAL_D, GOAL_H / 2, s * (GOAL_W / 2)]}>
          <cylinderGeometry args={[0.03, 0.03, GOAL_H, 8]} />
          <meshStandardMaterial color="#cbd5e1" />
        </mesh>
      ))}
      <lineSegments geometry={netGeo}>
        <lineBasicMaterial color="#e2e8f0" transparent opacity={0.34} />
      </lineSegments>
    </group>
  );
}

export function PitchTurf3D({ showGoals = true }: { showGoals?: boolean }) {
  const maxAniso = useThree((s) => s.gl.capabilities.getMaxAnisotropy());
  const tex = useMemo(() => {
    const t = new THREE.CanvasTexture(drawTurfTexture());
    t.colorSpace = THREE.SRGBColorSpace;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  }, []);
  useEffect(() => {
    tex.anisotropy = Math.min(16, maxAniso || 1);
    tex.needsUpdate = true;
  }, [tex, maxAniso]);
  useEffect(() => () => tex.dispose(), [tex]);

  return (
    <group>
      {/* entorno escuro, para o campo "flutuar" */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.06, 0]}>
        <planeGeometry args={[TURF_L * 3, TURF_W * 3]} />
        <meshBasicMaterial color="#0a0f1a" />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[TURF_L + PAD * 2, TURF_W + PAD * 2]} />
        <meshStandardMaterial map={tex} roughness={1} metalness={0} />
      </mesh>
      {showGoals && (
        <>
          <Goal side={1} />
          <Goal side={-1} />
        </>
      )}
    </group>
  );
}
