import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { MaterialIcon } from "./MaterialIcon";

const GOAL_WIDTH = 7.32;
const GOAL_HEIGHT = 2.44;
const GOAL_LINE_Z = -1.35;
/** Fração do replay em que o pé encosta na bola (antes disso o jogador corre e prepara o chute). */
const KICK_AT = 0.22;
/** A bola só sai depois do contato do pé. */
const BALL_START = KICK_AT + 0.05;

const BALL_PATCH_NORMALS = [
  [0, 0, 1], [0.8, 0.3, 0.5], [-0.8, 0.3, 0.5],
  [0.4, -0.8, 0.5], [-0.4, -0.8, 0.5],
] as const;

type ShotResult = "goal" | "saved" | "off_target" | "blocked";

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => { const c = clamp01(t); return c * c * (3 - 2 * c); };

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
      <mesh castShadow>
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

/**
 * Jogador (low-poly) que corre até a bola e chuta. O modelo olha para -Z (em direção ao gol).
 * Perna direita = perna do chute. Ângulo positivo em X = perna balançando PARA A FRENTE.
 */
function Kicker({ progress, start, teamColor }: {
  progress: number;
  start: THREE.Vector3;
  teamColor: string;
}) {
  const root = useRef<THREE.Group>(null);
  const torso = useRef<THREE.Group>(null);
  const legR = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);

  useFrame(() => {
    const p = clamp01(progress);
    const run = clamp01(p / KICK_AT);

    // Aproximação: corre de trás até ficar ao lado/atrás da bola.
    if (root.current) {
      root.current.position.set(start.x - 0.12, 0, start.z + 0.55 + (1 - smooth(run)) * 2.2);
    }

    // Passada (corrida) que vai sumindo conforme ele arma o chute.
    const wind = smooth((run - 0.5) / 0.5);
    const stride = Math.sin(run * Math.PI * 3.4) * 0.62 * (1 - wind);

    let kick: number;
    let support: number;
    if (p < KICK_AT) {
      kick = lerp(stride, -0.95, wind);          // perna do chute vai para trás
      support = lerp(-stride, 0.12, wind);
    } else if (p < KICK_AT + 0.08) {
      kick = lerp(-0.95, 1.3, smooth((p - KICK_AT) / 0.08)); // chicote para a frente
      support = 0.12;
    } else {
      const settle = smooth((p - KICK_AT - 0.08) / 0.4);
      kick = lerp(1.3, 0.28, settle);            // acompanha o movimento
      support = lerp(0.12, 0, settle);
    }

    if (legR.current) legR.current.rotation.x = kick;
    if (legL.current) legL.current.rotation.x = support;
    if (armR.current) { armR.current.rotation.x = -kick * 0.55; armR.current.rotation.z = 0.28; }
    if (armL.current) { armL.current.rotation.x = -support * 0.55 + (p >= KICK_AT ? 0.35 : 0); armL.current.rotation.z = -0.28; }
    if (torso.current) {
      const strike = p >= KICK_AT ? smooth((p - KICK_AT) / 0.1) * (1 - smooth((p - KICK_AT - 0.25) / 0.3)) : 0;
      torso.current.rotation.x = 0.1 + strike * 0.22;
    }
  });

  const skin = "#d8a47f";
  const shorts = "#f1f5f9";
  const boot = "#0f172a";

  return (
    <group ref={root}>
      {/* sombra */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <circleGeometry args={[0.5, 20]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.22} />
      </mesh>

      {/* pernas (pivô no quadril) */}
      {([
        { ref: legR, x: 0.11 },
        { ref: legL, x: -0.11 },
      ] as const).map(({ ref, x }) => (
        <group key={x} ref={ref} position={[x, 0.88, 0]}>
          <mesh position={[0, -0.16, 0]} castShadow>
            <boxGeometry args={[0.18, 0.32, 0.2]} />
            <meshStandardMaterial color={shorts} roughness={0.8} />
          </mesh>
          <mesh position={[0, -0.57, 0]} castShadow>
            <boxGeometry args={[0.12, 0.5, 0.14]} />
            <meshStandardMaterial color={teamColor} roughness={0.8} />
          </mesh>
          <mesh position={[0, -0.84, -0.05]} castShadow>
            <boxGeometry args={[0.13, 0.09, 0.27]} />
            <meshStandardMaterial color={boot} roughness={0.6} />
          </mesh>
        </group>
      ))}

      {/* tronco + cabeça */}
      <group ref={torso} position={[0, 0.88, 0]}>
        <mesh position={[0, 0.33, 0]} castShadow>
          <boxGeometry args={[0.48, 0.6, 0.26]} />
          <meshStandardMaterial color={teamColor} roughness={0.7} />
        </mesh>
        <mesh position={[0, 0.69, 0]}>
          <cylinderGeometry args={[0.055, 0.065, 0.1, 10]} />
          <meshStandardMaterial color={skin} roughness={0.8} />
        </mesh>
        <mesh position={[0, 0.84, 0]} castShadow>
          <sphereGeometry args={[0.14, 16, 12]} />
          <meshStandardMaterial color={skin} roughness={0.8} />
        </mesh>
        <mesh position={[0, 0.86, 0.015]}>
          <sphereGeometry args={[0.148, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
          <meshStandardMaterial color="#1f2937" roughness={0.9} />
        </mesh>

        {/* braços (pivô no ombro) */}
        {([
          { ref: armR, x: 0.3 },
          { ref: armL, x: -0.3 },
        ] as const).map(({ ref, x }) => (
          <group key={x} ref={ref} position={[x, 0.56, 0]}>
            <mesh position={[0, -0.1, 0]}>
              <boxGeometry args={[0.12, 0.2, 0.13]} />
              <meshStandardMaterial color={teamColor} roughness={0.7} />
            </mesh>
            <mesh position={[0, -0.34, 0]}>
              <boxGeometry args={[0.09, 0.3, 0.1]} />
              <meshStandardMaterial color={skin} roughness={0.8} />
            </mesh>
          </group>
        ))}
      </group>
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

function ShotScene({ goalLoc, shotOrigin, team, result, teamColor, progress }: {
  goalLoc?: { x: number; y: number };
  shotOrigin: { x: number; y: number };
  team: "home" | "away";
  result: ShotResult;
  teamColor: string;
  progress: number;
}) {
  const ball = useRef<THREE.Group>(null);
  const pulse = useRef<THREE.Mesh>(null);
  const net = useRef<THREE.Group>(null);
  const { camera } = useThree();

  const goalX = Math.max(0.06, Math.min(0.94, goalLoc?.x ?? 0.5));
  const goalY = Math.max(0.1, Math.min(0.92, goalLoc?.y ?? 0.5));
  const originX = shotOrigin.x;
  const originY = shotOrigin.y;

  // Ponto de saída da bola: distância até o gol (do lado que o time ataca) e posição lateral.
  const start = useMemo(() => {
    const metersToGoal = (team === "home" ? 100 - originX : originX) * 1.05;
    const distance = Math.max(3.8, Math.min(9.2, 3.4 + metersToGoal * 0.16));
    const lateralRaw = (originY - 50) * 0.68 * 0.38 * (team === "home" ? 1 : -1);
    const lateral = Math.max(-6.5, Math.min(6.5, lateralRaw));
    return new THREE.Vector3(lateral, 0.22, GOAL_LINE_Z + distance);
  }, [originX, originY, team]);

  // Onde a bola termina, conforme o resultado do lance.
  const end = useMemo(() => {
    const tx = (goalX - 0.5) * GOAL_WIDTH * 0.82;
    const ty = GOAL_HEIGHT * (1 - goalY) * 0.8 + 0.23;
    if (result === "off_target") {
      const dir = start.x > 0 ? -1 : 1;
      return new THREE.Vector3(dir * (GOAL_WIDTH / 2 + 1.3), 1.5, GOAL_LINE_Z - 1.6);
    }
    if (result === "blocked") {
      return new THREE.Vector3(start.x * 0.9, 0.22, start.z - 1.7);
    }
    if (result === "saved") return new THREE.Vector3(tx, ty, GOAL_LINE_Z + 0.3);
    return new THREE.Vector3(tx, ty, GOAL_LINE_Z - 0.9); // gol: dentro da rede
  }, [goalX, goalY, result, start]);

  const curve = useMemo(() => {
    const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
    const lift = result === "blocked" ? 0.9 : Math.max(1.8, end.y + 1.15);
    return new THREE.QuadraticBezierCurve3(start, new THREE.Vector3(mid.x, lift, mid.z), end);
  }, [start, end, result]);

  // Câmera atrás do jogador, mirando o gol.
  useEffect(() => {
    camera.position.set(start.x * 0.55, 2.7, start.z + 5.8);
    camera.lookAt(start.x * 0.2, 1.05, GOAL_LINE_Z - 1);
    camera.updateProjectionMatrix();
  }, [camera, start]);

  useFrame((state) => {
    const ballP = clamp01((progress - BALL_START) / (1 - BALL_START));
    const eased = 1 - (1 - ballP) ** 3;
    if (ball.current) {
      if (ballP <= 0) {
        ball.current.position.copy(start);
        ball.current.rotation.set(0, 0, 0);
      } else {
        ball.current.position.copy(curve.getPoint(eased));
        ball.current.rotation.set(eased * 6, eased * 8, eased * 3);
      }
    }

    if (net.current) {
      const impact = result === "goal" ? Math.max(0, 1 - Math.abs(ballP - 1) / 0.16) : 0;
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
        <planeGeometry args={[22, 30]} />
        <meshStandardMaterial color="#286d3d" roughness={0.95} />
      </mesh>
      {Array.from({ length: 10 }, (_, index) => (
        <mesh key={index} rotation={[-Math.PI / 2, 0, 0]} position={[-9 + index * 2, 0, 4.5]}>
          <planeGeometry args={[0.85, 30]} />
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

      {(result === "goal" || result === "saved") && (
        <mesh ref={pulse} position={[end.x, end.y, GOAL_LINE_Z + 0.05]}>
          <ringGeometry args={[0.28, 0.34, 32]} />
          <meshBasicMaterial color={teamColor} transparent opacity={0.35} side={THREE.DoubleSide} />
        </mesh>
      )}

      <Kicker progress={progress} start={start} teamColor={teamColor} />
      <group ref={ball}>
        <SoccerBall />
      </group>
    </>
  );
}

export function GoalReplay3D({ goalLoc, shotOrigin, team = "home", result = "goal", teamColor, progress, onClose }: {
  goalLoc?: { x: number; y: number };
  shotOrigin: { x: number; y: number };
  /** Lado que o time ataca (define de que ponta do campo o jogador chuta). */
  team?: "home" | "away";
  result?: ShotResult;
  teamColor: string;
  progress: number;
  /** Quando informado, mostra o botão "Fechar" no canto do replay. */
  onClose?: () => void;
}) {
  return (
    <div className="goal-replay-3d" role="img" aria-label="Replay 3D do chute">
      <Canvas
        dpr={[1, 1.25]}
        camera={{ position: [0, 2.7, 9.5], fov: 42, near: 0.1, far: 100 }}
      >
        <ShotScene goalLoc={goalLoc} shotOrigin={shotOrigin} team={team} result={result} teamColor={teamColor} progress={progress} />
      </Canvas>
      <div className="goal-replay-tag" aria-hidden="true">REPLAY 3D</div>
      {onClose && (
        <button type="button" className="goal-replay-close" onClick={onClose} title="Fechar (Esc)" aria-label="Fechar replay 3D">
          <MaterialIcon name="close" className="mr-1 align-middle" />Fechar
        </button>
      )}
    </div>
  );
}
