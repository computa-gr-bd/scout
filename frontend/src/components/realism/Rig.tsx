import { memo, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import { STAND_HIPS, luminance } from "./common";

/* ----------------------------------------------------------------------------
 * Esqueleto humano articulado (≈1,80 m): pelve, coluna, pescoço, cabeça,
 * coxa/canela/pé e braço/antebraço/mão — tudo com juntas (quadril, joelho,
 * tornozelo, ombro, cotovelo). A pose é descrita em ângulos (rad) e aplicada
 * por `applyPose`. O corpo olha para -Z.
 *
 * Convenções:
 *  - hip/sh > 0  = perna/braço balança PARA A FRENTE;
 *  - knee/el > 0 = joelho/cotovelo dobrado (calcanhar/mão vão para trás/frente);
 *  - hipLz/hipRz/shLz/shRz > 0 = abre a perna/braço para FORA do corpo;
 *  - lean > 0 = tronco inclinado para a frente; head > 0 = olha para cima;
 *  - ankle > 0 = ponta do pé para cima (negativo = pé esticado, chute de peito de pé).
 * -------------------------------------------------------------------------- */
export type Pose = {
  x: number; y: number; z: number; ry: number;
  hipsY: number; lean: number; sideLean: number; pitch: number; twist: number; head: number;
  hipL: number; kneeL: number; ankleL: number; hipR: number; kneeR: number; ankleR: number;
  hipLz: number; hipRz: number;
  shL: number; elL: number; shR: number; elR: number; shLz: number; shRz: number;
};

const BASE_POSE: Pose = {
  x: 0, y: 0, z: 0, ry: 0,
  hipsY: STAND_HIPS, lean: 0.05, sideLean: 0, pitch: 0, twist: 0, head: 0,
  hipL: 0, kneeL: 0.05, ankleL: 0, hipR: 0, kneeR: 0.05, ankleR: 0,
  hipLz: 0.04, hipRz: 0.04,
  shL: 0, elL: 0.3, shR: 0, elR: 0.3, shLz: 0.1, shRz: 0.1,
};

export const newPose = (): Pose => ({ ...BASE_POSE });
export const resetPose = (p: Pose) => { Object.assign(p, BASE_POSE); return p; };

/** Campos de junta (sem posição/orientação do corpo) — usados na interpolação entre poses. */
export const JOINT_FIELDS = (Object.keys(BASE_POSE) as (keyof Pose)[]).filter((k) => !["x", "y", "z", "ry"].includes(k));

/** out = a + (b - a) * t, só nas juntas. */
export function mixPose(out: Pose, a: Pose, b: Pose, t: number) {
  for (const k of JOINT_FIELDS) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

/** Espelha esquerda/direita (poses são escritas para destro; canhoto = espelho). */
export function mirrorPose(p: Pose) {
  const sw = (a: keyof Pose, b: keyof Pose) => { const t = p[a]; p[a] = p[b]; p[b] = t; };
  sw("hipL", "hipR"); sw("kneeL", "kneeR"); sw("ankleL", "ankleR"); sw("hipLz", "hipRz");
  sw("shL", "shR"); sw("elL", "elR"); sw("shLz", "shRz");
  p.twist = -p.twist; p.sideLean = -p.sideLean;
  return p;
}

export type Rig = {
  root: RefObject<THREE.Group>;
  body: RefObject<THREE.Group>;
  spine: RefObject<THREE.Group>;
  head: RefObject<THREE.Group>;
  hipL: RefObject<THREE.Group>; hipR: RefObject<THREE.Group>;
  kneeL: RefObject<THREE.Group>; kneeR: RefObject<THREE.Group>;
  ankleL: RefObject<THREE.Group>; ankleR: RefObject<THREE.Group>;
  shL: RefObject<THREE.Group>; shR: RefObject<THREE.Group>;
  elL: RefObject<THREE.Group>; elR: RefObject<THREE.Group>;
  /** Ponto no peito onde o goleiro segura a bola. */
  hold: RefObject<THREE.Object3D>;
};

export function useRig(): Rig {
  return {
    root: useRef<THREE.Group>(null), body: useRef<THREE.Group>(null),
    spine: useRef<THREE.Group>(null), head: useRef<THREE.Group>(null),
    hipL: useRef<THREE.Group>(null), hipR: useRef<THREE.Group>(null),
    kneeL: useRef<THREE.Group>(null), kneeR: useRef<THREE.Group>(null),
    ankleL: useRef<THREE.Group>(null), ankleR: useRef<THREE.Group>(null),
    shL: useRef<THREE.Group>(null), shR: useRef<THREE.Group>(null),
    elL: useRef<THREE.Group>(null), elR: useRef<THREE.Group>(null),
    hold: useRef<THREE.Object3D>(null),
  };
}

export function applyPose(rig: Rig, p: Pose) {
  const root = rig.root.current;
  const body = rig.body.current;
  if (!root || !body) return;
  root.position.set(p.x, p.y, p.z);
  root.rotation.y = p.ry;
  body.position.y = p.hipsY;
  body.rotation.set(p.pitch, 0, p.sideLean);
  rig.spine.current?.rotation.set(-p.lean, p.twist, 0);
  rig.head.current?.rotation.set(p.head, -p.twist * 0.5, 0);
  rig.hipL.current?.rotation.set(p.hipL, 0, -p.hipLz);
  rig.hipR.current?.rotation.set(p.hipR, 0, p.hipRz);
  rig.kneeL.current?.rotation.set(-p.kneeL, 0, 0);
  rig.kneeR.current?.rotation.set(-p.kneeR, 0, 0);
  rig.ankleL.current?.rotation.set(p.ankleL, 0, 0);
  rig.ankleR.current?.rotation.set(p.ankleR, 0, 0);
  rig.shL.current?.rotation.set(p.shL, 0, -p.shLz);
  rig.shR.current?.rotation.set(p.shR, 0, p.shRz);
  rig.elL.current?.rotation.set(p.elL, 0, 0);
  rig.elR.current?.rotation.set(p.elR, 0, 0);
}

/* ------------------------------ Uniforme / visual ------------------------- */
export type Kit = {
  shirt: string; shorts: string; socks: string;
  skin: string; hair: string; boots: string;
  glove?: string; number?: number; name?: string;
};

export const SKINS = ["#f1c7a0", "#e0ac84", "#c58c62", "#8d5a3b", "#5b3a26"];
export const HAIRS = ["#14110f", "#2a1b12", "#5a3a1e", "#c9a26b", "#0b0b0b"];
export const BOOTS = ["#0f172a", "#f8fafc", "#fb923c", "#22d3ee", "#a3e635"];

export function makeKit(shirt: string, seed: number, extra: Partial<Kit> = {}): Kit {
  const pick = <T,>(arr: T[], s: number) => arr[Math.floor(Math.abs(Math.sin(seed * 91.7 + s * 13.1)) * 997) % arr.length];
  return {
    shirt, shorts: "#f1f5f9", socks: shirt,
    skin: pick(SKINS, 1), hair: pick(HAIRS, 2), boots: pick(BOOTS, 3),
    ...extra,
  };
}

function makeBackTexture(name: string | undefined, num: number | undefined, shirt: string) {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 256;
  const g = c.getContext("2d");
  if (!g) return null;
  const ink = luminance(shirt) > 0.55 ? "#0f172a" : "#f8fafc";
  g.clearRect(0, 0, 256, 256);
  g.fillStyle = ink; g.textAlign = "center";
  if (name) {
    g.font = "bold 34px Arial, sans-serif";
    const txt = name.split(" ").slice(-1)[0].toUpperCase().slice(0, 12);
    g.fillText(txt, 128, 52);
  }
  if (num != null) {
    g.font = "bold 150px Arial, sans-serif";
    g.fillText(String(num), 128, 195);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Jogador articulado. Os refs de `rig` expõem as juntas para `applyPose`. */
export const Humanoid = memo(function Humanoid({ rig, kit, blob = true }: { rig: Rig; kit: Kit; blob?: boolean }) {
  const mats = useMemo(() => ({
    shirt: new THREE.MeshStandardMaterial({ color: kit.shirt, roughness: 0.68 }),
    shorts: new THREE.MeshStandardMaterial({ color: kit.shorts, roughness: 0.7 }),
    socks: new THREE.MeshStandardMaterial({ color: kit.socks, roughness: 0.78 }),
    skin: new THREE.MeshStandardMaterial({ color: kit.skin, roughness: 0.62 }),
    hair: new THREE.MeshStandardMaterial({ color: kit.hair, roughness: 0.9 }),
    boots: new THREE.MeshStandardMaterial({ color: kit.boots, roughness: 0.42, metalness: 0.15 }),
    sole: new THREE.MeshStandardMaterial({ color: "#0b0f19", roughness: 0.7 }),
    glove: new THREE.MeshStandardMaterial({ color: kit.glove ?? kit.skin, roughness: 0.5 }),
  }), [kit.shirt, kit.shorts, kit.socks, kit.skin, kit.hair, kit.boots, kit.glove]);

  const back = useMemo(
    () => (kit.number != null || kit.name ? makeBackTexture(kit.name, kit.number, kit.shirt) : null),
    [kit.number, kit.name, kit.shirt],
  );

  const legs = [
    { key: "L", s: -1, hip: rig.hipL, knee: rig.kneeL, ankle: rig.ankleL },
    { key: "R", s: 1, hip: rig.hipR, knee: rig.kneeR, ankle: rig.ankleR },
  ] as const;
  const arms = [
    { key: "L", s: -1, sh: rig.shL, el: rig.elL },
    { key: "R", s: 1, sh: rig.shR, el: rig.elR },
  ] as const;

  return (
    <group ref={rig.root}>
      {blob && (
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.012, 0]}>
          <circleGeometry args={[0.42, 20]} />
          <meshBasicMaterial color="#000" transparent opacity={0.28} depthWrite={false} />
        </mesh>
      )}
      <group ref={rig.body} position={[0, STAND_HIPS, 0]}>
        {/* pelve + calção */}
        <mesh material={mats.shorts} castShadow position={[0, 0.02, 0]}>
          <boxGeometry args={[0.3, 0.17, 0.2]} />
        </mesh>

        {legs.map(({ key, s, hip, knee, ankle }) => (
          <group key={key} ref={hip} position={[s * 0.095, -0.02, 0]}>
            <mesh material={mats.skin} castShadow position={[0, -0.22, 0]}>
              <capsuleGeometry args={[0.075, 0.3, 4, 10]} />
            </mesh>
            <mesh material={mats.shorts} castShadow position={[0, -0.11, 0]}>
              <cylinderGeometry args={[0.092, 0.098, 0.24, 12]} />
            </mesh>
            <group ref={knee} position={[0, -0.44, 0]}>
              <mesh material={mats.socks} castShadow position={[0, -0.2, 0]}>
                <capsuleGeometry args={[0.058, 0.3, 4, 10]} />
              </mesh>
              <group ref={ankle} position={[0, -0.42, 0]}>
                <mesh material={mats.boots} castShadow position={[0, -0.025, -0.06]}>
                  <boxGeometry args={[0.095, 0.07, 0.26]} />
                </mesh>
                <mesh material={mats.sole} position={[0, -0.067, -0.06]}>
                  <boxGeometry args={[0.1, 0.014, 0.27]} />
                </mesh>
              </group>
            </group>
          </group>
        ))}

        {/* tronco */}
        <group ref={rig.spine} position={[0, 0.07, 0]}>
          <mesh material={mats.shirt} castShadow position={[0, 0.27, 0]} scale={[1.32, 1, 0.78]}>
            <capsuleGeometry args={[0.14, 0.34, 6, 14]} />
          </mesh>
          {back && (
            <mesh position={[0, 0.3, 0.118]}>
              <planeGeometry args={[0.3, 0.3]} />
              <meshBasicMaterial map={back} transparent depthWrite={false} toneMapped={false} />
            </mesh>
          )}
          <object3D ref={rig.hold} position={[0, 0.22, -0.27]} />
          <mesh material={mats.skin} position={[0, 0.63, 0]}>
            <cylinderGeometry args={[0.05, 0.058, 0.1, 10]} />
          </mesh>
          <group ref={rig.head} position={[0, 0.72, 0]}>
            <mesh material={mats.skin} castShadow scale={[0.88, 1.08, 1]}>
              <sphereGeometry args={[0.105, 18, 14]} />
            </mesh>
            <mesh material={mats.hair} position={[0, 0.012, 0.012]} scale={[0.9, 1.1, 1.02]}>
              <sphereGeometry args={[0.109, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.52]} />
            </mesh>
          </group>

          {arms.map(({ key, s, sh, el }) => (
            <group key={key} ref={sh} position={[s * 0.215, 0.47, 0]}>
              <mesh material={mats.shirt} castShadow>
                <sphereGeometry args={[0.062, 12, 10]} />
              </mesh>
              <mesh material={mats.shirt} castShadow position={[0, -0.13, 0]}>
                <capsuleGeometry args={[0.05, 0.14, 4, 10]} />
              </mesh>
              <group ref={el} position={[0, -0.28, 0]}>
                <mesh material={mats.skin} castShadow position={[0, -0.12, 0]}>
                  <capsuleGeometry args={[0.04, 0.16, 4, 10]} />
                </mesh>
                <mesh material={kit.glove ? mats.glove : mats.skin} castShadow position={[0, -0.275, 0]}>
                  <sphereGeometry args={[kit.glove ? 0.062 : 0.048, 12, 10]} />
                </mesh>
              </group>
            </group>
          ))}
        </group>
      </group>
    </group>
  );
});
