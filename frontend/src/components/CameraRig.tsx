import { useEffect, useRef, type ElementRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Vector3 } from "three";

export type CameraPreset = { label: string; position: [number, number, number]; target: [number, number, number] };

const ease = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * OrbitControls com transição suave entre câmeras prontas. Em vez de recriar o <Canvas> a cada troca
 * (o que perdia a animação em curso e o contexto WebGL), a câmera "voa" até o novo ponto de vista.
 */
export function CameraRig({
  preset, autoRotate = false, minDistance = 14, maxDistance = 150,
}: { preset: CameraPreset; autoRotate?: boolean; minDistance?: number; maxDistance?: number }) {
  const controls = useRef<ElementRef<typeof OrbitControls>>(null);
  const camera = useThree((s) => s.camera);
  const anim = useRef<{ t: number; fromPos: Vector3; fromTarget: Vector3 } | null>(null);
  const first = useRef(true);

  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    if (first.current) {
      first.current = false;
      c.target.set(...preset.target);
      c.update();
      return;
    }
    anim.current = { t: 0, fromPos: camera.position.clone(), fromTarget: c.target.clone() };
  }, [preset, camera]);

  useFrame((_, dt) => {
    const c = controls.current;
    const a = anim.current;
    if (!c || !a) return;
    a.t = Math.min(1, a.t + Math.min(dt, 0.05) / 0.9);
    const k = ease(a.t);
    camera.position.lerpVectors(a.fromPos, new Vector3(...preset.position), k);
    c.target.lerpVectors(a.fromTarget, new Vector3(...preset.target), k);
    c.update();
    if (a.t >= 1) anim.current = null;
  });

  return (
    <OrbitControls
      ref={controls} makeDefault enablePan={false}
      minDistance={minDistance} maxDistance={maxDistance} maxPolarAngle={Math.PI / 2.05}
      autoRotate={autoRotate} autoRotateSpeed={0.6}
    />
  );
}
