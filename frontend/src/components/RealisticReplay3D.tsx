import { Component, Suspense, memo, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { MaterialIcon } from "./MaterialIcon";
import { clamp, clamp01, smooth, type ShotResult } from "./realism/common";
import { buildPlan, type Plan } from "./realism/plan";
import { Humanoid, applyPose, makeKit, newPose, useRig, type Kit } from "./realism/Rig";
import { poseDefender, poseExtra, poseKeeper, poseKicker } from "./realism/poses";
import { BallWithTrail, Env, useBallAndCamera, type CamMode } from "./realism/shared";
import { ProScene, preloadRealisticModels } from "./realism/ProScene";

export { preloadRealisticModels };
export type { ShotResult };
export type { CamMode };

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

/* ------------------------------ Cena procedural (reserva) ----------------- */
const KEEPER_KIT: Partial<Kit> = { shirt: "#f59e0b", shorts: "#111827", socks: "#111827", glove: "#22c55e" };

/** Cena com bonecos procedurais: usada enquanto os modelos carregam ou se não puderem ser carregados. */
const Scene = memo(function Scene({ plan, qRef, teamColor, foeColor, camMode, number, name, seed }: {
  plan: Plan; qRef: MutableRefObject<number>; teamColor: string; foeColor: string; camMode: CamMode; number?: number; name?: string; seed: number;
}) {
  const kRig = useRig(), gRig = useRig(), dRig = useRig();
  const e0 = useRig(), e1 = useRig(), e2 = useRig(), e3 = useRig();
  const extraRigs = [e0, e1, e2, e3];

  const kKit = useMemo(() => makeKit(teamColor, seed, { number, name }), [teamColor, seed, number, name]);
  const gKit = useMemo(() => makeKit(KEEPER_KIT.shirt as string, seed + 3, KEEPER_KIT), [seed]);
  const dKit = useMemo(() => makeKit(foeColor, seed + 5, { shorts: "#0f172a" }), [foeColor, seed]);
  const exKits = useMemo(() => plan.extras.map((e, i) => makeKit(e.own ? teamColor : foeColor, seed + 11 + i, { shorts: e.own ? "#f1f5f9" : "#0f172a" })), [plan, teamColor, foeColor, seed]);

  const poses = useMemo(() => ({ k: newPose(), g: newPose(), d: newPose(), e: newPose() }), []);
  const kPos = useRef(new THREE.Vector3());

  useFrame(() => {
    const qq = qRef.current;
    const { k, g, d, e } = poses;
    poseKicker(k, qq, plan); applyPose(kRig, k);
    poseKeeper(g, qq, plan); applyPose(gRig, g);
    if (plan.defender) { poseDefender(d, qq, plan); applyPose(dRig, d); }
    extraRigs.forEach((r, i) => { if (plan.extras[i]) { poseExtra(e, qq, plan, i); applyPose(r, e); } });
    kPos.current.set(k.x, 0, k.z);
  });

  const getHold = useMemo(() => (out: THREE.Vector3) => {
    gRig.root.current?.updateMatrixWorld(true);
    gRig.hold.current?.getWorldPosition(out);
  }, [gRig.root, gRig.hold]);

  const { ball, impact, excite } = useBallAndCamera({ plan, qRef, camMode, kPos, getHold });

  return (
    <>
      <Env impactRef={impact} exciteRef={excite} />
      <Humanoid rig={kRig} kit={kKit} />
      <Humanoid rig={gRig} kit={gKit} />
      {plan.defender && <Humanoid rig={dRig} kit={dKit} />}
      {plan.extras.map((_, i) => <Humanoid key={i} rig={extraRigs[i]} kit={exKits[i]} />)}
      <BallWithTrail ballRef={ball} plan={plan} qRef={qRef} />
    </>
  );
});

/** Se os modelos falharem (arquivo ausente, WebGL…), cai para os bonecos procedurais. */
class ModelBoundary extends Component<{ fallback: ReactNode; onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

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
        {(() => {
          const fallback = <Scene plan={plan} qRef={qRef} teamColor={teamColor} foeColor={foeColor} camMode={camMode} number={shirtNumber} name={info?.player} seed={seed} />;
          return (
            <ModelBoundary fallback={fallback} onError={() => console.warn("[realismo] modelos 3D indisponíveis; usando jogadores simples")}>
              <Suspense fallback={fallback}>
                <ProScene plan={plan} qRef={qRef} teamColor={teamColor} foeColor={foeColor} camMode={camMode} number={shirtNumber} name={info?.player} />
              </Suspense>
            </ModelBoundary>
          );
        })()}
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

