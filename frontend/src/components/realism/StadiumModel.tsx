import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { GL, clamp01 } from "./common";
import { MODEL_URLS } from "./modelMeta";
import { Crowd, Flashes, type NetImpact } from "./Stadium";

/** Materiais do gramado: recebem a sombra dos jogadores. */
const PITCH_MATS = new Set(["Material.001", "Material.003", "Material.004", "Material.005", "Material.027"]);

/** Começa a baixar o estádio (chamado junto com os jogadores). */
export function preloadStadium() {
  useGLTF.preload(MODEL_URLS.stadium);
  useLoader.preload(THREE.FileLoader, MODEL_URLS.crowd);
}

/**
 * Estádio 3D (arena otimizada a partir do modelo do Sketchfab): gramado com as linhas, gol com rede,
 * arquibancadas com torcida e placas. A rede balança onde a bola bate; os torcedores 3D pulam no gol.
 */
export function StadiumModel({ impactRef, exciteRef }: { impactRef: MutableRefObject<NetImpact>; exciteRef: MutableRefObject<number> }) {
  const gltf = useGLTF(MODEL_URLS.stadium);
  const seatsJson = useLoader(THREE.FileLoader, MODEL_URLS.crowd) as string;
  const { camera } = useThree();

  const seats = useMemo(() => {
    try { return new Float32Array((JSON.parse(seatsJson) as { positions: number[][] }).positions.flat()); }
    catch { return undefined; }
  }, [seatsJson]);

  const net = useMemo(() => {
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = false;
      const mat = m.material as THREE.Material;
      m.receiveShadow = PITCH_MATS.has(mat.name);
      m.matrixAutoUpdate = false;
      m.updateMatrix();
    });
    const mesh = gltf.scene.getObjectByName("GoalNetNeg") as THREE.Mesh | undefined;
    if (!mesh) return null;
    mesh.frustumCulled = false;
    const attr = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    return { attr, base: Float32Array.from(attr.array as Float32Array) };
  }, [gltf]);

  // o estádio é grande: alcança mais longe que o cenário simples
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const far = cam.far;
    cam.far = 900; cam.updateProjectionMatrix();
    return () => { cam.far = far; cam.updateProjectionMatrix(); };
  }, [camera]);

  // rede do gol balançando (mesma física da rede simples)
  const wasActive = useRef(false);
  useFrame(() => {
    if (!net) return;
    const imp = impactRef.current;
    const active = imp.amp > 0.002;
    if (!active && !wasActive.current) return;
    wasActive.current = active;
    const arr = net.attr.array as Float32Array, base = net.base;
    for (let i = 0; i < base.length; i += 3) {
      const depth = clamp01((GL - base[i + 2]) / 0.9);                // a borda presa nos postes não se move
      const dx = base[i] - imp.x, dy = base[i + 1] - imp.y;
      const w = Math.exp(-(dx * dx + dy * dy) / (2 * 0.85 * 0.85)) * depth;
      arr[i] = base[i] - dx * 0.12 * w * imp.amp;
      arr[i + 1] = base[i + 1] - dy * 0.12 * w * imp.amp;
      arr[i + 2] = base[i + 2] - imp.amp * w;
    }
    net.attr.needsUpdate = true;
  });

  return (
    <>
      <primitive object={gltf.scene} />
      <Crowd exciteRef={exciteRef} positions={seats} />
      <Flashes anchors={seats} />
    </>
  );
}
