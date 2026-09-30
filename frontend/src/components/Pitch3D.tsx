import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Text } from "@react-three/drei";
import type { PitchZone } from "../api/client";
import { ZONE_GEOMETRY } from "./Pitch";

const WIDTH = 105;
const HEIGHT = 68;

function toPitch(xNorm: number, yNorm: number, z: number = 0.02) {
  // xNorm 0..100 -> x 0..WIDTH, centered
  const x = (xNorm / 100) * WIDTH - WIDTH / 2;
  const y = (yNorm / 100) * HEIGHT - HEIGHT / 2;
  return [x, z, -y] as [number, number, number];
}

function PitchMesh() {
  return (
    <group>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[WIDTH + 4, HEIGHT + 4]} />
        <meshStandardMaterial color="#0f3d26" />
      </mesh>
      {/* alternating stripes */}
      {Array.from({ length: 10 }).map((_, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[-(WIDTH / 2) + (i + 0.5) * (WIDTH / 10), 0.001, 0]}>
          <planeGeometry args={[WIDTH / 10 - 0.15, HEIGHT - 0.3]} />
          <meshStandardMaterial color={i % 2 === 0 ? "#1f8352" : "#196e45"} />
        </mesh>
      ))}
    </group>
  );
}

function Lines() {
  const stroke = "white";
  const lw = 0.02;
  return (
    <group>
      <lineSegments>
        <edgesGeometry args={[/* placeholder */]} />
      </lineSegments>
      {/* outside */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <ringGeometry args={[1, 1.01, 4]} />
      </mesh>
      {/* use individual boxes for lines */}
      {[
        { pos: [0, 0.01, -HEIGHT / 2], size: [WIDTH, lw, 0.04] },
        { pos: [0, 0.01, HEIGHT / 2], size: [WIDTH, lw, 0.04] },
        { pos: [-WIDTH / 2, 0.01, 0], size: [0.04, lw, HEIGHT] },
        { pos: [WIDTH / 2, 0.01, 0], size: [0.04, lw, HEIGHT] },
        { pos: [0, 0.01, 0], size: [0.04, lw, HEIGHT] },
        // penalty boxes left
        { pos: [-WIDTH / 2 + 16.5, 0.01, -20.15], size: [33, lw, 0.04] },
        { pos: [-WIDTH / 2 + 16.5 / 2, 0.01, 20.15], size: [16.5, lw, 0.04] },
        { pos: [-WIDTH / 2 + 16.5 / 2, 0.01, -20.15], size: [16.5, lw, 0.04] },
        { pos: [-WIDTH / 2 + 16.5, 0.01, 20.15], size: [0.04, lw, 40.3] },
        // goal area left
        { pos: [-WIDTH / 2 + 5.5, 0.01, -9.16], size: [11, lw, 0.04] },
        { pos: [-WIDTH / 2 + 2.75, 0.01, 9.16], size: [5.5, lw, 0.04] },
        { pos: [-WIDTH / 2 + 2.75, 0.01, -9.16], size: [5.5, lw, 0.04] },
        { pos: [-WIDTH / 2 + 5.5, 0.01, 9.16], size: [0.04, lw, 18.32] },
        // penalty boxes right
        { pos: [WIDTH / 2 - 16.5, 0.01, -20.15], size: [33, lw, 0.04] },
        { pos: [WIDTH / 2 - 16.5 / 2, 0.01, 20.15], size: [16.5, lw, 0.04] },
        { pos: [WIDTH / 2 - 16.5 / 2, 0.01, -20.15], size: [16.5, lw, 0.04] },
        { pos: [WIDTH / 2 - 16.5, 0.01, 20.15], size: [0.04, lw, 40.3] },
        { pos: [WIDTH / 2 - 5.5, 0.01, -9.16], size: [11, lw, 0.04] },
        { pos: [WIDTH / 2 - 2.75, 0.01, 9.16], size: [5.5, lw, 0.04] },
        { pos: [WIDTH / 2 - 2.75, 0.01, -9.16], size: [5.5, lw, 0.04] },
        { pos: [WIDTH / 2 - 5.5, 0.01, 9.16], size: [0.04, lw, 18.32] },
      ].map((b, i) => (
        <mesh key={i} position={b.pos as [number, number, number]}>
          <boxGeometry args={b.size as [number, number, number]} />
          <meshStandardMaterial color={stroke} />
        </mesh>
      ))}
      {/* center circle */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
        <ringGeometry args={[9.15, 9.25, 64]} />
        <meshStandardMaterial color={stroke} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
        <circleGeometry args={[0.2, 20]} />
        <meshStandardMaterial color={stroke} />
      </mesh>
      {/* penalty dots */}
      {[-11, 11].map((x) => (
        <mesh key={x} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.012, 0]}>
          <circleGeometry args={[0.2, 20]} />
          <meshStandardMaterial color={stroke} />
        </mesh>
      ))}
      {/* goals */}
      {[-1, 1].map((s) => (
        <group key={s} position={[(s * (WIDTH / 2 + 1.2)), 1.2, 0]}>
          <mesh position={[0, 0.6, -3.7]}><boxGeometry args={[0.1, 2.4, 0.1]} /><meshStandardMaterial color="white" /></mesh>
          <mesh position={[0, 0.6, 3.7]}><boxGeometry args={[0.1, 2.4, 0.1]} /><meshStandardMaterial color="white" /></mesh>
          <mesh position={[0, 1.8, 0]}><boxGeometry args={[0.1, 0.1, 7.4]} /><meshStandardMaterial color="white" /></mesh>
        </group>
      ))}
    </group>
  );
}

function ZoneOverlays({
  homeWeakness, awayWeakness, opportunityZones,
}: {
  homeWeakness?: Record<string, number>; awayWeakness?: Record<string, number>;
  opportunityZones?: { zone: PitchZone; value: number }[];
}) {
  const elements: any[] = [];
  if (homeWeakness) {
    const max = Math.max(0.001, ...Object.values(homeWeakness));
    Object.entries(homeWeakness).forEach(([z, v]) => {
      const g = ZONE_GEOMETRY[z as PitchZone];
      if (!g) return;
      const [cx, , cz] = toPitch(g.x + g.w / 2, g.y + g.h / 2, 0.03);
      const w = (g.w / 100) * WIDTH;
      const h = (g.h / 100) * HEIGHT;
      const alpha = 0.15 + (v / max) * 0.55;
      elements.push(
        <mesh key={`hw-${z}`} rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0.03, cz]}>
          <planeGeometry args={[w * 0.98, h * 0.98]} />
          <meshStandardMaterial color={`rgb(180,${Math.round(80 - v * 60)},${Math.round(120 - v * 100)})`} transparent opacity={alpha} />
        </mesh>
      );
    });
  }
  if (awayWeakness) {
    const max = Math.max(0.001, ...Object.values(awayWeakness));
    Object.entries(awayWeakness).forEach(([z, v]) => {
      // flip
      let actualZone = z as PitchZone;
      const map: any = {
        own_box: "central_box", own_left_channel: "opp_right_channel", own_right_channel: "opp_left_channel",
        own_central_midfield: "opp_central_midfield", own_left_flank: "opp_right_flank", own_right_flank: "opp_left_flank",
        opp_left_flank: "own_right_flank", opp_right_flank: "own_left_flank",
        opp_left_channel: "own_right_channel", opp_right_channel: "own_left_channel",
        opp_central_midfield: "own_central_midfield",
        outside_box_left: "outside_box_right", outside_box_right: "outside_box_left",
        central_box: "own_box",
      };
      actualZone = map[z] || (z as PitchZone);
      const g = ZONE_GEOMETRY[actualZone];
      if (!g) return;
      const [cx, , cz] = toPitch(g.x + g.w / 2, g.y + g.h / 2, 0.03);
      const w = (g.w / 100) * WIDTH;
      const h = (g.h / 100) * HEIGHT;
      const alpha = 0.15 + (v / max) * 0.55;
      elements.push(
        <mesh key={`aw-${z}`} rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0.03, cz]}>
          <planeGeometry args={[w * 0.98, h * 0.98]} />
          <meshStandardMaterial color={`rgb(180,${Math.round(80 - v * 60)},${Math.round(120 - v * 100)})`} transparent opacity={alpha} />
        </mesh>
      );
    });
  }
  if (opportunityZones?.length) {
    const max = Math.max(0.001, ...opportunityZones.map((o) => o.value));
    opportunityZones.forEach((o, i) => {
      const g = ZONE_GEOMETRY[o.zone];
      if (!g) return;
      const [cx, , cz] = toPitch(g.x + g.w / 2, g.y + g.h / 2, 0.04);
      const w = (g.w / 100) * WIDTH;
      const h = (g.h / 100) * HEIGHT;
      const alpha = 0.18 + (o.value / max) * 0.6;
      elements.push(
        <mesh key={`oz-${i}-${o.zone}`} rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0.04, cz]}>
          <planeGeometry args={[w * 0.98, h * 0.98]} />
          <meshStandardMaterial color={`rgb(30,${Math.round(140 + (o.value / max) * 60)},${Math.round(100 + (o.value / max) * 80)})`} transparent opacity={alpha} />
        </mesh>
      );
    });
  }
  return <group>{elements}</group>;
}

export function Pitch3D({
  title, homeWeakness, awayWeakness, opportunityZones,
}: {
  title?: string; homeWeakness?: Record<string, number>; awayWeakness?: Record<string, number>;
  opportunityZones?: { zone: PitchZone; value: number }[];
}) {
  return (
    <div className="sv-card">
      {title && <div className="px-5 pt-4 pb-2 text-sm font-semibold">{title}</div>}
      <div className="p-3 md:p-5" style={{ height: 520 }}>
        <Canvas shadows camera={{ position: [0, 70, 75], fov: 42 }} dpr={[1, 2]}>
          <color attach="background" args={["#0a0f1a"]} />
          <ambientLight intensity={0.6} />
          <directionalLight position={[30, 60, -20]} intensity={1.2} castShadow />
          <directionalLight position={[-30, 40, 30]} intensity={0.5} />
          <Suspense fallback={null}>
            <PitchMesh />
            <Lines />
            <ZoneOverlays homeWeakness={homeWeakness} awayWeakness={awayWeakness} opportunityZones={opportunityZones} />
            <Text position={[0, 0.1, -HEIGHT / 2 - 3]} fontSize={2} color="#8794ad" anchorX="center">Home team attacks →</Text>
          </Suspense>
          <OrbitControls enablePan={false} minDistance={40} maxDistance={180} maxPolarAngle={Math.PI / 2.1} />
        </Canvas>
      </div>
    </div>
  );
}
