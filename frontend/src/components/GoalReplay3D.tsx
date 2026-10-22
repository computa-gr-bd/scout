import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

const GOAL_WIDTH = 7.32;
const GOAL_HEIGHT = 2.44;
const GOAL_LINE_Z = -1.35;
const BALL_PATCH_NORMALS = [
  [0, 0, 1], [0.8, 0.3, 0.5], [-0.8, 0.3, 0.5],
  [0.4, -0.8, 0.5], [-0.4, -0.8, 0.5],
] as const;

function SoccerBall() {
  const patches = useMemo(() => BALL_PATCH_NORMALS.map((normal) => {
    const direction = new THREE.Vector3(...normal).normalize();
    const quaternion = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      direction,
    );
    return {
      position: direction.clone().multiplyScalar(0.218),
      quaternion,
    };
  }), []);

  return (
    <group>
      <mesh>
        <sphereGeometry args={[0.21, 24, 16]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.42} />
      </mesh>
      {patches.map((patch, index) => (
        <mesh key={index} position={patch.position} quaternion={patch.quaternion}>
          <circleGeometry args={[0.066, 5]} />
          <meshStandardMaterial color="#111827" roughness={0.55} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

function Stands() {
  const seats = useMemo(() => Array.from({ length: 5 }, (_, row) =>
    Array.from({ length: 25 }, (_, seat) => {
      const shade = (seat * 7 + row * 11) % 4;
      return {
        x: (seat - 12) * 0.78,
        y: 2.1 + row * 0.3,
        z: -7.6 - row * 0.3,
        color: ["#87343a", "#984047", "#783039", "#a4494d"][shade],
      };
    }),
  ).flat(), []);

  return (
    <group>
      <mesh position={[0, 2.5, -8.6]}>
        <boxGeometry args={[21, 1.7, 0.6]} />
        <meshStandardMaterial color="#59616b" />
      </mesh>
      {seats.map((seat, index) => (
        <mesh key={index} position={[seat.x, seat.y, seat.z]}>
          <boxGeometry args={[0.55, 0.2, 0.3]} />
          <meshStandardMaterial color={seat.color} roughness={0.8} />
        </mesh>
      ))}
      <mesh position={[0, 1.88, -7.05]}>
        <boxGeometry args={[19.6, 0.22, 0.16]} />
        <meshStandardMaterial color="#d8e0e8" />
      </mesh>
    </group>
  );
}

function ShotScene({ goalLoc, shotOrigin, teamColor, progress }: {
  goalLoc?: { x: number; y: number };
  shotOrigin: { x: number; y: number };
  teamColor: string;
  progress: number;
}) {
  const ball = useRef<THREE.Group>(null);
  const pulse = useRef<THREE.Mesh>(null);
  const net = useRef<THREE.Group>(null);
  const goalX = Math.max(0.06, Math.min(0.94, goalLoc?.x ?? 0.5));
  const goalY = Math.max(0.1, Math.min(0.92, goalLoc?.y ?? 0.5));
  const target = useMemo(
    () => new THREE.Vector3((goalX - 0.5) * GOAL_WIDTH * 0.82, GOAL_HEIGHT * (1 - goalY) * 0.8 + 0.23, GOAL_LINE_Z + 0.2),
    [goalX, goalY],
  );
  const originX = shotOrigin.x;
  const originY = shotOrigin.y;
  const flight = useMemo(() => {
    const distance = Math.max(4.2, Math.min(9, 4.2 + Math.abs(originX - 50) * 0.095));
    const start = new THREE.Vector3(
      Math.max(-5.2, Math.min(5.2, (originY - 50) * 0.095)),
      0.24,
      GOAL_LINE_Z + distance,
    );
    const control = new THREE.Vector3((start.x + target.x) * 0.5, Math.max(1.8, target.y + 1.15), (start.z + target.z) * 0.5);
    const curve = new THREE.QuadraticBezierCurve3(start, control, target);
    return { curve };
  }, [originX, originY, target]);

  useFrame((state) => {
    const eased = 1 - (1 - Math.max(0, Math.min(1, progress))) ** 3;
    if (ball.current) {
      ball.current.position.copy(flight.curve.getPoint(eased));
      ball.current.rotation.set(eased * 6, eased * 8, eased * 3);
    }

    if (net.current) {
      const impact = Math.max(0, 1 - Math.abs(progress - 1) / 0.16);
      net.current.position.z = GOAL_LINE_Z - 1.7 - impact * 0.08;
    }
    if (pulse.current) {
      const pulseScale = 0.65 + (Math.sin(state.clock.elapsedTime * 4) + 1) * 0.12;
      pulse.current.scale.setScalar(pulseScale);
      const material = pulse.current.material as THREE.MeshBasicMaterial;
      material.opacity = 0.12 + (Math.sin(state.clock.elapsedTime * 4) + 1) * 0.08;
    }
  });

  return (
    <>
      <color attach="background" args={["#a8c4d1"]} />
      <ambientLight intensity={1.25} />
      <directionalLight position={[-5, 10, 6]} intensity={2.1} castShadow />
      <hemisphereLight args={["#e8f5ff", "#234735", 0.65]} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, 4.5]} receiveShadow>
        <planeGeometry args={[22, 26]} />
        <meshStandardMaterial color="#286d3d" roughness={0.95} />
      </mesh>
      {Array.from({ length: 10 }, (_, index) => (
        <mesh key={index} rotation={[-Math.PI / 2, 0, 0]} position={[-9 + index * 2, 0, 4.5]}>
          <planeGeometry args={[0.85, 26]} />
          <meshStandardMaterial color={index % 2 === 0 ? "#2b7140" : "#286d3d"} roughness={0.95} />
        </mesh>
      ))}
      {[
        { x: 0, z: GOAL_LINE_Z, width: 22, depth: 0.035 },
        { x: 0, z: GOAL_LINE_Z + 16.5, width: 16.5, depth: 0.035 },
        { x: -8.25, z: GOAL_LINE_Z + 8.25, width: 0.035, depth: 16.5 },
        { x: 8.25, z: GOAL_LINE_Z + 8.25, width: 0.035, depth: 16.5 },
        { x: 0, z: GOAL_LINE_Z + 5.5, width: 11, depth: 0.035 },
        { x: -5.5, z: GOAL_LINE_Z + 2.75, width: 0.035, depth: 5.5 },
        { x: 5.5, z: GOAL_LINE_Z + 2.75, width: 0.035, depth: 5.5 },
      ].map((line, index) => (
        <mesh key={index} rotation={[-Math.PI / 2, 0, 0]} position={[line.x, 0.012, line.z]}>
          <planeGeometry args={[line.width, line.depth]} />
          <meshBasicMaterial color="#edf3ed" />
        </mesh>
      ))}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.014, GOAL_LINE_Z + 11]}>
        <circleGeometry args={[0.09, 16]} />
        <meshBasicMaterial color="#edf3ed" />
      </mesh>

      <Stands />
      <group ref={net} position={[0, 0, GOAL_LINE_Z - 1.7]}>
        <mesh position={[0, GOAL_HEIGHT / 2, 0]}>
          <planeGeometry args={[GOAL_WIDTH, GOAL_HEIGHT, 18, 8]} />
          <meshBasicMaterial color="#e2e8f0" wireframe transparent opacity={0.4} />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh key={side} position={[side * GOAL_WIDTH / 2, GOAL_HEIGHT / 2, 0.85]} rotation={[0, side * Math.PI / 2, 0]}>
            <planeGeometry args={[1.7, GOAL_HEIGHT, 5, 8]} />
            <meshBasicMaterial color="#e2e8f0" wireframe transparent opacity={0.3} />
          </mesh>
        ))}
        <mesh position={[0, GOAL_HEIGHT, 0.85]} rotation={[Math.PI / 2, 0, 0]}>
          <planeGeometry args={[GOAL_WIDTH, 1.7, 18, 5]} />
          <meshBasicMaterial color="#e2e8f0" wireframe transparent opacity={0.28} />
        </mesh>
      </group>
      <group>
        {[-GOAL_WIDTH / 2, GOAL_WIDTH / 2].map((x) => (
          <mesh key={x} position={[x, GOAL_HEIGHT / 2, GOAL_LINE_Z]} castShadow>
            <cylinderGeometry args={[0.07, 0.07, GOAL_HEIGHT, 12]} />
            <meshStandardMaterial color="#f8fafc" metalness={0.16} roughness={0.28} />
          </mesh>
        ))}
        <mesh position={[0, GOAL_HEIGHT, GOAL_LINE_Z]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.07, 0.07, GOAL_WIDTH, 12]} />
          <meshStandardMaterial color="#f8fafc" metalness={0.16} roughness={0.28} />
        </mesh>
      </group>

      <mesh ref={pulse} position={[target.x, target.y, target.z + 0.4]}>
        <ringGeometry args={[0.28, 0.34, 32]} />
        <meshBasicMaterial color={teamColor} transparent opacity={0.35} side={THREE.DoubleSide} />
      </mesh>
      <group ref={ball}>
        <SoccerBall />
      </group>
    </>
  );
}

export function GoalReplay3D({ goalLoc, shotOrigin, teamColor, progress }: {
  goalLoc?: { x: number; y: number };
  shotOrigin: { x: number; y: number };
  teamColor: string;
  progress: number;
}) {
  return (
    <div className="goal-replay-3d" role="img" aria-label="Replay 3D da bola entrando no gol">
      <Canvas
        dpr={[1, 1.25]}
        camera={{ position: [0, 2.55, 9.5], fov: 42, near: 0.1, far: 100 }}
      >
        <ShotScene goalLoc={goalLoc} shotOrigin={shotOrigin} teamColor={teamColor} progress={progress} />
      </Canvas>
      <div className="goal-replay-tag" aria-hidden="true">REPLAY 3D</div>
    </div>
  );
}
