import { memo, useEffect, useMemo, useRef, useState, type MutableRefObject, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { MaterialIcon } from "./MaterialIcon";
import { BALL_R, GL, clamp, clamp01, lerp, smooth, v3, type ShotResult } from "./realism/common";
import { buildPlan, ballAt, type Plan } from "./realism/plan";
import { Humanoid, applyPose, makeKit, newPose, useRig, type Kit } from "./realism/Rig";
import { poseDefender, poseExtra, poseKeeper, poseKicker } from "./realism/poses";
import {
  AdBoards, Crowd, Flashes, Floodlights, GoalFrame, GoalNet, Pitch, StandsStructure, type NetImpact,
} from "./realism/Stadium";

export type { ShotResult };
export type CamMode = "auto" | "back" | "side" | "goal" | "air";

const CAM_LABEL: Record<CamMode, string> = { auto: "Auto", back: "Atrás", side: "Lateral", goal: "Gol", air: "Aérea" };

/* ------------------------------ Câmera lenta ------------------------------ */
/** Mapeia o progresso linear (tempo real) para o tempo da cena, desacelerando em volta do contato. */
function makeWarp(center: number, enabled: boolean) {
  const N = 400;
  const t = new Float32Array(N + 1);
  let acc = 0;
  for (let i = 0; i <= N; i++) {
    const q = i / N;
    const bump = smooth((q - (center - 0.07)) / 0.05) * (1 - smooth((q - (center + 0.05)) / 0.09));
    const speed = enabled ? 1 - 0.74 * bump : 1;
    t[i] = acc;
    acc += 1 / N / speed;
  }
  const total = t[N];
  for (let i = 0; i <= N; i++) t[i] /= total;
  return (p: number) => {
    const x = clamp01(p);
    let lo = 0, hi = N;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (t[mid] <= x) lo = mid; else hi = mid; }
    const span = t[hi] - t[lo] || 1;
    return (lo + (x - t[lo]) / span) / N;
  };
}

/* ------------------------------ Bola -------------------------------------- */
const PHI = (1 + Math.sqrt(5)) / 2;
const PENTAGON_DIRS = [
  [0, 1, PHI], [0, -1, PHI], [0, 1, -PHI], [0, -1, -PHI],
  [1, PHI, 0], [-1, PHI, 0], [1, -PHI, 0], [-1, -PHI, 0],
  [PHI, 0, 1], [-PHI, 0, 1], [PHI, 0, -1], [-PHI, 0, -1],
] as const;

function SoccerBall() {
  const patches = useMemo(() => PENTAGON_DIRS.map(([x, y, z]) => {
    const n = new THREE.Vector3(x, y, z).normalize();
    return { pos: n.clone().multiplyScalar(BALL_R * 1.004), quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n) };
  }), []);
  return (
    <group>
      <mesh castShadow>
        <sphereGeometry args={[BALL_R, 28, 20]} />
        <meshStandardMaterial color="#fafafa" roughness={0.34} metalness={0.02} />
      </mesh>
      {patches.map((p, i) => (
        <mesh key={i} position={p.pos} quaternion={p.quat}>
          <circleGeometry args={[BALL_R * 0.4, 5]} />
          <meshStandardMaterial color="#121826" roughness={0.45} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

const TRAIL_N = 16;
function BallTrail({ ballRef, plan, qRef }: { ballRef: RefObject<THREE.Group>; plan: Plan; qRef: MutableRefObject<number> }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const hist = useRef<THREE.Vector3[]>(Array.from({ length: TRAIL_N }, () => new THREE.Vector3()));
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const lastQ = useRef(-1);
  useFrame(() => {
    const m = mesh.current, b = ballRef.current;
    if (!m || !b) return;
    const q = qRef.current;
    const active = q > plan.TC && q < plan.TE + 0.1;
    if (Math.abs(q - lastQ.current) > 1e-5) {
      lastQ.current = q;
      const h = hist.current;
      const last = h.pop() as THREE.Vector3;
      last.copy(b.position);
      h.unshift(last);
    }
    for (let i = 0; i < TRAIL_N; i++) {
      const f = 1 - i / TRAIL_N;
      dummy.position.copy(hist.current[i]);
      dummy.scale.setScalar(active ? BALL_R * 0.9 * f : 0.0001);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, TRAIL_N]} frustumCulled={false}>
      <sphereGeometry args={[1, 8, 6]} />
      <meshBasicMaterial color="#e8f6ff" transparent opacity={0.22} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </instancedMesh>
  );
}

/* ------------------------------ Câmera ------------------------------------ */
type CamShot = { pos: THREE.Vector3; look: THREE.Vector3; fov: number; key: number; k: number };

function directCamera(mode: CamMode, q: number, plan: Plan, kPos: THREE.Vector3, ball: THREE.Vector3, out: CamShot) {
  const { S, TC, TE, aim } = plan;
  const sx = S.x >= 0 ? 1 : -1;
  const mid = (S.z + GL) / 2;

  if (mode === "back") {
    out.pos.set(S.x * 0.55, 2.6, S.z + 5.8); out.look.set(S.x * 0.2, 1.05, GL - 1); out.fov = 44; out.key = 100; out.k = 3; return;
  }
  if (mode === "side") {
    out.pos.set(sx * -17, 3.8, mid + 1); out.look.set(lerp(S.x, aim.x, 0.4) * 0.6, 1.0, mid - 0.5); out.fov = 36; out.key = 101; out.k = 3; return;
  }
  if (mode === "goal") {
    out.pos.set(aim.x * 0.25, 1.15, GL - 3.4); out.look.set(S.x * 0.5, 1.3, S.z - 3); out.fov = 46; out.key = 102; out.k = 3; return;
  }
  if (mode === "air") {
    out.pos.set(S.x * 0.3 + 5, 15, mid + 10); out.look.set(0, 0.2, mid - 1); out.fov = 42; out.key = 103; out.k = 3; return;
  }

  // AUTO: direção de transmissão
  const b1 = TC - 0.045;
  const b2 = TC + 0.1;
  const b3 = Math.max(b2 + 0.01, TE - 0.02);
  const b4 = b3 + (plan.result === "goal" || plan.result === "own_goal" ? 0.24 : 0.17);
  const header = plan.kind === "header";

  if (q < b1) {
    // acompanha quem vai chutar
    const dolly = 1 - smooth(q / b1);
    if (plan.kind === "penalty") {
      out.pos.set(S.x + 1.3 - 0.4 * dolly, 1.5, S.z + 4.8 + dolly * 0.8); out.look.set(0, 1.05, GL + 1);
    } else if (header) {
      out.pos.set(S.x - 4.2, 1.9, S.z + 5.4 + dolly); out.look.set(S.x, 1.7, S.z - 1.5);
    } else {
      out.pos.set(kPos.x - 1.7 * sx, 1.35, kPos.z + 3.5 + dolly * 0.9); out.look.set(kPos.x * 0.8 + S.x * 0.2, 1.0, kPos.z - 3);
    }
    out.fov = 38; out.key = 0; out.k = 4;
  } else if (q < b2) {
    // close no pé (ou na cabeça), em câmera lenta
    const orbit = (q - b1) / (b2 - b1);
    const tgt = header ? S : v3(S.x, 0.35, S.z - 0.15);
    out.pos.set(tgt.x + (header ? 2.8 : 2.15) * sx * (1 - orbit * 0.25), header ? 1.7 : 0.75 + orbit * 0.25, tgt.z + 1.1 + orbit * 0.9);
    out.look.copy(tgt); out.look.x += -0.1 * sx; out.fov = header ? 34 : 30; out.key = 1; out.k = 9;
  } else if (q < b3) {
    // câmera segue a bola
    const dx = aim.x - S.x, dz = aim.z - S.z;
    const l = Math.hypot(dx, dz) || 1;
    out.pos.set(ball.x - (dx / l) * 3.1, ball.y + 1.15, ball.z - (dz / l) * 3.1);
    out.look.set(lerp(ball.x, aim.x, 0.4), Math.max(0.9, lerp(ball.y, aim.y, 0.5)), lerp(ball.z, GL, 0.5));
    out.fov = 42; out.key = 2; out.k = 6;
  } else if (q < b4) {
    // desfecho
    if (plan.result === "goal" || plan.result === "own_goal") {
      out.pos.set(aim.x * 0.3 + 2.8 * sx, 1.0, GL - 3.4); out.look.set(aim.x * 0.5, 1.15, GL + 2.5); out.fov = 46;
    } else if (plan.result === "saved") {
      out.pos.set(aim.x + sx * -7.5, 1.5, GL + 4.5); out.look.set(aim.x, 1.0, GL + 0.5); out.fov = 38;
    } else if (plan.result === "blocked") {
      const d = plan.defender;
      out.pos.set((d?.pos.x ?? aim.x) + 4.5 * sx, 1.4, (d?.pos.z ?? S.z) + 4.0); out.look.set(d?.touch.x ?? aim.x, 0.7, d?.touch.z ?? S.z); out.fov = 34;
    } else {
      out.pos.set(ball.x * 0.4 + 5 * sx, 1.8, GL + 6.5); out.look.set(lerp(ball.x, 0, 0.2), Math.max(0.8, ball.y * 0.8), lerp(ball.z, GL, 0.2)); out.fov = 40;
    }
    out.key = 3; out.k = 3.2;
  } else {
    // reação de quem chutou
    const goal = plan.result === "goal";
    if (goal) {
      const dir = new THREE.Vector3(plan.celebTo.x - kPos.x, 0, plan.celebTo.z - kPos.z);
      if (dir.lengthSq() < 0.04) dir.set(sx, 0, 0); else dir.normalize();
      out.pos.set(kPos.x + dir.x * 4.4, 1.35, kPos.z + dir.z * 4.4); out.look.set(kPos.x, 1.2, kPos.z); out.fov = 40;
    } else {
      out.pos.set(kPos.x + 1.5 * sx, 1.4, kPos.z - 4.0); out.look.set(kPos.x, 1.25, kPos.z); out.fov = 36;
    }
    out.key = 4; out.k = 2.6;
  }
}

/* ------------------------------ Cena -------------------------------------- */
const KEEPER_KIT: Partial<Kit> = { shirt: "#f59e0b", shorts: "#111827", socks: "#111827", glove: "#22c55e" };

const Scene = memo(function Scene({ plan, qRef, teamColor, foeColor, camMode, number, name, seed }: {
  plan: Plan; qRef: MutableRefObject<number>; teamColor: string; foeColor: string; camMode: CamMode; number?: number; name?: string; seed: number;
}) {
  const { camera } = useThree();

  const kRig = useRig(), gRig = useRig(), dRig = useRig();
  const e0 = useRig(), e1 = useRig(), e2 = useRig(), e3 = useRig();
  const extraRigs = [e0, e1, e2, e3];

  const kKit = useMemo(() => makeKit(teamColor, seed, { number, name }), [teamColor, seed, number, name]);
  const gKit = useMemo(() => makeKit(KEEPER_KIT.shirt as string, seed + 3, KEEPER_KIT), [seed]);
  const dKit = useMemo(() => makeKit(foeColor, seed + 5, { shorts: "#0f172a" }), [foeColor, seed]);
  const exKits = useMemo(() => plan.extras.map((e, i) => makeKit(e.own ? teamColor : foeColor, seed + 11 + i, { shorts: e.own ? "#f1f5f9" : "#0f172a" })), [plan, teamColor, foeColor, seed]);

  const ball = useRef<THREE.Group>(null);
  const impact = useRef<NetImpact>({ x: 0, y: 1, amp: 0 });
  const excite = useRef(0);
  const sun = useRef<THREE.DirectionalLight>(null);
  const target = useMemo(() => { const o = new THREE.Object3D(); o.position.set(0, 0, 8); return o; }, []);

  const poses = useMemo(() => ({ k: newPose(), g: newPose(), d: newPose(), e: newPose() }), []);
  const tmp = useMemo(() => ({
    ball: new THREE.Vector3(), prev: new THREE.Vector3(), hand: new THREE.Vector3(),
    axis: new THREE.Vector3(), quat: new THREE.Quaternion(), kPos: new THREE.Vector3(),
    shot: { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 40, key: -1, k: 4 } as CamShot,
    lookCur: new THREE.Vector3(0, 1, GL), lastKey: -999, lastQ: 0,
  }), []);

  useEffect(() => { sun.current?.shadow.camera.updateProjectionMatrix(); }, []);

  useFrame((_, delta) => {
    const qq = qRef.current;
    const { k, g, d, e } = poses;

    poseKicker(k, qq, plan); applyPose(kRig, k);
    poseKeeper(g, qq, plan); applyPose(gRig, g);
    if (plan.defender) { poseDefender(d, qq, plan); applyPose(dRig, d); }
    extraRigs.forEach((r, i) => { if (plan.extras[i]) { poseExtra(e, qq, plan, i); applyPose(r, e); } });
    tmp.kPos.set(k.x, 0, k.z);

    // bola
    const b = ball.current;
    if (b) {
      tmp.prev.copy(b.position);
      ballAt(plan, qq, tmp.ball);
      if (plan.catches && qq >= plan.TE) {
        gRig.root.current?.updateMatrixWorld(true);
        const hold = gRig.hold.current;
        if (hold) {
          hold.getWorldPosition(tmp.hand);
          tmp.ball.lerp(tmp.hand, smooth((qq - plan.TE) / 0.09));
        }
      }
      b.position.copy(tmp.ball);
      // giro coerente com o deslocamento (rolamento)
      const dv = tmp.ball.clone().sub(tmp.prev);
      const dist = dv.length();
      if (dist > 1e-4 && dist < 2.5 && qq >= tmp.lastQ) {
        tmp.axis.set(dv.z, 0, -dv.x);
        if (tmp.axis.lengthSq() < 1e-8) tmp.axis.set(1, 0, 0);
        tmp.axis.normalize();
        tmp.quat.setFromAxisAngle(tmp.axis, dist / BALL_R);
        b.quaternion.premultiply(tmp.quat);
      }
      tmp.lastQ = qq;
    }

    // rede balançando
    if (plan.net) {
      const t = (qq - plan.net.q) / 0.22;
      const amp = t < 0 ? 0 : 0.55 * Math.exp(-3.6 * t) * (0.45 + 0.55 * Math.cos(11 * t));
      impact.current.x = plan.net.x; impact.current.y = plan.net.y; impact.current.amp = Math.max(0, amp);
    } else impact.current.amp = 0;

    // torcida
    const goal = plan.result === "goal" || plan.result === "own_goal";
    excite.current = goal ? smooth((qq - plan.TE) / 0.08) : plan.result === "saved" ? 0.35 * smooth((qq - plan.TE) / 0.1) : 0.1 + 0.2 * smooth((qq - plan.TE) / 0.1);

    // câmera
    const cam = camera as THREE.PerspectiveCamera;
    directCamera(camMode, qq, plan, tmp.kPos, tmp.ball, tmp.shot);
    const shot = tmp.shot;
    const key = shot.key + (camMode === "auto" ? 0 : 1000);
    const snap = key !== tmp.lastKey && (camMode !== "auto" || shot.key === 1 || shot.key === 3 || shot.key === 4 || tmp.lastKey === -999);
    const a = 1 - Math.exp(-shot.k * Math.min(delta, 0.05));
    if (snap || tmp.lastKey === -999) { cam.position.copy(shot.pos); tmp.lookCur.copy(shot.look); }
    else { cam.position.lerp(shot.pos, a); tmp.lookCur.lerp(shot.look, Math.min(1, a * 1.4)); }
    tmp.lastKey = key;
    const punch = Math.exp(-Math.pow((qq - plan.TC) / 0.03, 2)) * 2.5;
    const fov = shot.fov - punch;
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = lerp(cam.fov, fov, snap ? 1 : 0.2); cam.updateProjectionMatrix(); }
    cam.lookAt(tmp.lookCur);
  });

  return (
    <>
      <color attach="background" args={["#060f1f"]} />
      <fog attach="fog" args={["#08142b", 70, 190]} />
      <ambientLight intensity={0.55} />
      <hemisphereLight args={["#bcd7ff", "#1c3b27", 0.8]} />
      <directionalLight
        ref={sun} target={target} position={[10, 26, 22]} intensity={2.4} color="#fff3dc" castShadow
        shadow-mapSize={[1024, 1024]} shadow-camera-left={-22} shadow-camera-right={22} shadow-camera-top={24} shadow-camera-bottom={-20}
        shadow-camera-near={1} shadow-camera-far={80} shadow-bias={-0.0005}
      />
      <primitive object={target} />

      <Pitch />
      <GoalFrame />
      <GoalNet impactRef={impact} />
      <AdBoards />
      <StandsStructure />
      <Crowd exciteRef={excite} />
      <Flashes />
      <Floodlights />

      <Humanoid rig={kRig} kit={kKit} />
      <Humanoid rig={gRig} kit={gKit} />
      {plan.defender && <Humanoid rig={dRig} kit={dKit} />}
      {plan.extras.map((_, i) => <Humanoid key={i} rig={extraRigs[i]} kit={exKits[i]} />)}

      <group ref={ball}>
        <SoccerBall />
      </group>
      <BallTrail ballRef={ball} plan={plan} qRef={qRef} />
    </>
  );
});

/* ------------------------------ Componente público ------------------------ */
export type RealisticReplayInfo = { player: string; subtitle: string; xg?: number | null };

const RESULT_LABEL: Record<ShotResult, { text: string; tone: string }> = {
  goal: { text: "GOL!", tone: "#5ef2b8" },
  own_goal: { text: "GOL CONTRA", tone: "#fb923c" },
  saved: { text: "DEFENDIDO!", tone: "#fbbf24" },
  off_target: { text: "PRA FORA", tone: "#cbd5e1" },
  blocked: { text: "CHUTE BLOQUEADO", tone: "#38bdf8" },
};

export function RealisticReplay3D({
  goalLoc, shotOrigin, team = "home", result = "goal", teamColor, foeColor = "#e2e8f0", progress, penalty = false, header = false,
  leftFooted = false, shirtNumber, info, seed = 1, onClose,
}: {
  goalLoc?: { x: number; y: number };
  shotOrigin: { x: number; y: number };
  team?: "home" | "away";
  result?: ShotResult;
  teamColor: string;
  foeColor?: string;
  progress: number;
  penalty?: boolean;
  header?: boolean;
  leftFooted?: boolean;
  shirtNumber?: number;
  info?: RealisticReplayInfo;
  seed?: number;
  onClose?: () => void;
}) {
  const [camMode, setCamMode] = useState<CamMode>("auto");
  const [slow, setSlow] = useState(true);

  const gx = goalLoc?.x, gy = goalLoc?.y, ox = shotOrigin.x, oy = shotOrigin.y;
  const plan = useMemo(() => buildPlan({
    goalX: gx, goalY: gy, originX: ox, originY: oy, team, result, penalty, header, left: leftFooted, seed,
  }), [gx, gy, ox, oy, team, result, penalty, header, leftFooted, seed]);

  const warp = useMemo(() => makeWarp(plan.TC, slow), [plan.TC, slow]);
  const q = warp(progress);
  // O tempo da cena é lido por ref dentro do useFrame: a cena 3D não re-renderiza no React a cada frame.
  const qRef = useRef(q);
  qRef.current = q;

  const label = RESULT_LABEL[plan.result];
  const showResult = q > plan.TE + 0.03;
  const showLower = q > 0.015;
  const inSlow = slow && q > plan.TC - 0.06 && q < plan.TC + 0.12;
  const title = penalty ? `PÊNALTI · ${label.text}` : label.text;

  return (
    <div className="goal-replay-3d goal-replay-real" role="img" aria-label="Replay realista do chute">
      <Canvas
        shadows
        dpr={[1, 1.5]}
        camera={{ position: [0, 2.7, 9.5], fov: 40, near: 0.1, far: 260 }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => { gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 1.08; }}
      >
        <Scene plan={plan} qRef={qRef} teamColor={teamColor} foeColor={foeColor} camMode={camMode} number={shirtNumber} name={info?.player} seed={seed} />
      </Canvas>

      {/* vinheta + tarjas de cinema na câmera lenta */}
      <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%)" }} aria-hidden="true" />
      <div className="pointer-events-none absolute inset-x-0 top-0 bg-black transition-all duration-300" style={{ height: inSlow ? "7%" : "0%" }} aria-hidden="true" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-black transition-all duration-300" style={{ height: inSlow ? "7%" : "0%" }} aria-hidden="true" />

      <div className="goal-replay-tag" aria-hidden="true">REPLAY · REALISMO{inSlow ? " · CÂMERA LENTA" : ""}</div>

      {/* seleção de câmera */}
      <div className="absolute left-2.5 top-2.5 z-[5] flex max-w-[calc(100%-110px)] flex-wrap items-center gap-1">
        {(Object.keys(CAM_LABEL) as CamMode[]).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={camMode === m}
            onClick={() => setCamMode(m)}
            className={`rounded-full border px-2 py-[3px] text-[10px] font-bold uppercase tracking-wide backdrop-blur transition ${camMode === m ? "border-emerald-300/70 bg-emerald-500/80 text-white" : "border-white/25 bg-slate-900/70 text-slate-200 hover:bg-slate-700/80"}`}
          >
            {CAM_LABEL[m]}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={slow}
          onClick={() => setSlow((s) => !s)}
          title="Câmera lenta no contato com a bola"
          className={`rounded-full border px-2 py-[3px] text-[10px] font-bold uppercase tracking-wide backdrop-blur transition ${slow ? "border-sky-300/70 bg-sky-500/80 text-white" : "border-white/25 bg-slate-900/70 text-slate-200 hover:bg-slate-700/80"}`}
        >
          <MaterialIcon name="slow_motion_video" className="mr-0.5 align-middle text-[13px]" />Lenta
        </button>
      </div>

      {/* tarja de transmissão */}
      {showLower && info && (
        <div className="pointer-events-none absolute bottom-9 left-3 right-3 z-[4] flex items-end justify-between gap-2" aria-hidden="true">
          <div className="flex min-w-0 items-stretch overflow-hidden rounded-md border border-white/15 bg-slate-950/80 shadow-lg backdrop-blur">
            <div className="w-1.5 shrink-0" style={{ background: teamColor }} />
            <div className="min-w-0 px-2.5 py-1.5">
              <div className="truncate text-[13px] font-extrabold leading-tight text-white">{info.player}</div>
              <div className="truncate text-[10.5px] leading-tight text-slate-300">{info.subtitle}</div>
            </div>
            {info.xg != null && (
              <div className="border-l border-white/10 px-2.5 py-1.5 text-right">
                <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">xG</div>
                <div className="text-[13px] font-extrabold leading-tight text-white">{info.xg.toFixed(2)}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* resultado */}
      {showResult && (
        <div
          className="pointer-events-none absolute left-1/2 top-[18%] z-[4] -translate-x-1/2 whitespace-nowrap rounded-full border bg-slate-950/75 px-5 py-2 text-[18px] font-black tracking-[0.12em] shadow-2xl backdrop-blur sm:text-[22px]"
          style={{ color: label.tone, borderColor: `${label.tone}66`, opacity: clamp(1 - (q - plan.TE - 0.03) * 0.4, 0.55, 1), transform: `translateX(-50%) scale(${1 + 0.12 * (1 - smooth((q - plan.TE - 0.03) / 0.08))})` }}
          aria-hidden="true"
        >
          {title}
        </div>
      )}

      {onClose && (
        <button type="button" className="goal-replay-close" onClick={onClose} title="Fechar (Esc)" aria-label="Fechar replay realista">
          <MaterialIcon name="close" className="mr-1 align-middle" />Fechar
        </button>
      )}
    </div>
  );
}

