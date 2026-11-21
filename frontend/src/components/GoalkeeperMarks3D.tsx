/**
 * GoalkeeperMarks3D.tsx — elementos 3D que dão leitura de goleiro ao campo:
 *  • um goleiro (figura simples, parada na linha do gol, só para identificar a perspectiva);
 *  • anéis de distância ao centro do gol (6 / 12 / 18 / 24 / 30 m);
 *  • as duas linhas que separam os setores (±18°: lado esquerdo, centro e lado direito do goleiro);
 *  • o "cone de abertura": triângulo do chute selecionado até as duas traves, que mostra
 *    quanto do gol o finalizador enxergava.
 */
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import * as THREE from "three";
import { TURF_L } from "./PitchTurf3D";

const GX = TURF_L / 2; // linha do gol da direita
const RINGS = [6, 12, 18, 24, 30];

function Figure() {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    ref.current.position.y = Math.sin(clock.elapsedTime * 2) * 0.03; // "respiração"
  });
  const skin = "#f5c9a0";
  return (
    <group position={[GX - 1.1, 0, 0]} rotation={[0, Math.PI, 0]}>
      <group ref={ref}>
        {/* pernas */}
        {[-0.16, 0.16].map((z) => (
          <mesh key={z} position={[0, 0.5, z]} castShadow>
            <capsuleGeometry args={[0.11, 0.62, 4, 10]} />
            <meshStandardMaterial color="#0f172a" />
          </mesh>
        ))}
        {/* tronco */}
        <mesh position={[0, 1.3, 0]} castShadow>
          <capsuleGeometry args={[0.27, 0.5, 6, 12]} />
          <meshStandardMaterial color="#facc15" emissive="#facc15" emissiveIntensity={0.15} />
        </mesh>
        {/* cabeça */}
        <mesh position={[0, 1.95, 0]} castShadow>
          <sphereGeometry args={[0.2, 16, 16]} />
          <meshStandardMaterial color={skin} />
        </mesh>
        {/* braços abertos + luvas */}
        {[-1, 1].map((s) => (
          <group key={s} position={[0, 1.55, s * 0.32]} rotation={[s * 0.9, 0, 0]}>
            <mesh position={[0, 0, s * 0.3]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <capsuleGeometry args={[0.075, 0.5, 4, 8]} />
              <meshStandardMaterial color="#facc15" />
            </mesh>
            <mesh position={[0, 0, s * 0.68]} castShadow>
              <sphereGeometry args={[0.14, 12, 12]} />
              <meshStandardMaterial color="#22c55e" />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
}

export function GoalkeeperMarks3D({
  selectedPos,
}: {
  /** Posição do chute selecionado em metros do mundo (x, z). */
  selectedPos?: { x: number; z: number } | null;
}) {
  const a = (18 * Math.PI) / 180;
  const sector = (sign: 1 | -1): [number, number, number][] => [
    [GX, 0.08, 0],
    [GX - 56 * Math.cos(a), 0.08, sign * 56 * Math.sin(a)],
  ];

  const px = selectedPos?.x;
  const pz = selectedPos?.z;
  const cone = useMemo(() => {
    if (px == null || pz == null) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([px, 0.12, pz, GX, 0.12, -3.66, GX, 0.12, 3.66]), 3));
    g.setIndex([0, 1, 2]);
    return g;
  }, [px, pz]);

  return (
    <group>
      <Figure />
      {RINGS.map((r) => (
        <mesh key={r} rotation={[-Math.PI / 2, 0, 0]} position={[GX, 0.07, 0]}>
          <ringGeometry args={[r - 0.07, r + 0.07, 72, 1, Math.PI / 2, Math.PI]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.3} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      ))}
      <Line points={sector(1)} color="#ffffff" lineWidth={1} transparent opacity={0.45} dashed dashSize={1.2} gapSize={0.8} />
      <Line points={sector(-1)} color="#ffffff" lineWidth={1} transparent opacity={0.45} dashed dashSize={1.2} gapSize={0.8} />
      {cone && (
        <mesh geometry={cone}>
          <meshBasicMaterial color="#fde047" transparent opacity={0.22} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}
