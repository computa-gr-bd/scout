import { Component, Suspense, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import { MaterialIcon } from "./MaterialIcon";
import { clamp, clamp01, smooth, type ShotResult } from "./realism/common";
import { buildPlan } from "./realism/plan";
import type { CamMode } from "./realism/shared";
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

/** Se os modelos falharem (arquivo ausente, WebGL…), mostra um aviso no lugar da cena. */
class ModelBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? null : this.props.children; }
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
  leftFooted = false, shirtNumber, info, seed = 1, corner = false, onReady, onClose,
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
  /** O lance veio de escanteio: mostra a batida e o cruzamento antes da finalização. */
  corner?: boolean;
  /** Chamado quando os modelos terminaram de carregar (o replay só começa a andar depois disso). */
  onReady?: () => void;
  onClose?: () => void;
}) {
  const [camMode, setCamMode] = useState<CamMode>("auto");
  const [slow, setSlow] = useState(true);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  const gx = goalLoc?.x, gy = goalLoc?.y, ox = shotOrigin.x, oy = shotOrigin.y;
  const plan = useMemo(() => buildPlan({
    goalX: gx, goalY: gy, originX: ox, originY: oy, team, result, penalty, header, left: leftFooted, seed, corner,
  }), [gx, gy, ox, oy, team, result, penalty, header, leftFooted, seed, corner]);

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
    <div className="goal-replay-3d goal-replay-real" role="img" aria-label="Replay 3D do chute">
      <Canvas
        shadows
        dpr={[1, 1.5]}
        camera={{ position: [0, 2.7, 9.5], fov: 40, near: 0.1, far: 900 }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => { gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 1.08; }}
      >
        <ModelBoundary onError={() => { setStatus("error"); onReady?.(); }}>
          <Suspense fallback={null}>
            <ProScene
              plan={plan} qRef={qRef} teamColor={teamColor} foeColor={foeColor} camMode={camMode} number={shirtNumber} name={info?.player}
              onReady={() => { setStatus("ready"); onReady?.(); }}
            />
          </Suspense>
        </ModelBoundary>
      </Canvas>

      {/* vinheta + tarjas de cinema na câmera lenta */}
      <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%)" }} aria-hidden="true" />
      <div className="pointer-events-none absolute inset-x-0 top-0 bg-black transition-all duration-300" style={{ height: inSlow ? "7%" : "0%" }} aria-hidden="true" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-black transition-all duration-300" style={{ height: inSlow ? "7%" : "0%" }} aria-hidden="true" />

      {status !== "ready" && (
        <div className="absolute inset-0 z-[7] flex flex-col items-center justify-center gap-2 bg-[#060f1f] px-6 text-center" role="status">
          {status === "loading" ? (
            <>
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-emerald-300/30 border-t-emerald-300" aria-hidden="true" />
              <div className="text-xs font-semibold text-slate-200">Carregando replay 3D…</div>
              <div className="text-[11px] text-slate-400">Estádio, jogadores e animações (só na primeira vez)</div>
            </>
          ) : (
            <>
              <MaterialIcon name="error" className="text-2xl text-amber-300" />
              <div className="text-xs font-semibold text-slate-200">Não foi possível carregar o replay 3D.</div>
              <div className="text-[11px] text-slate-400">Use o modo 2D ou tente novamente.</div>
            </>
          )}
        </div>
      )}

      {plan.corner && q < plan.corner.qKick + 0.2 && (
        <div className="pointer-events-none absolute left-1/2 top-[14%] z-[4] -translate-x-1/2 rounded-full border border-white/20 bg-slate-950/75 px-3.5 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-white backdrop-blur" aria-hidden="true">
          Escanteio
        </div>
      )}

      <div className="goal-replay-tag" aria-hidden="true">REPLAY · 3D{inSlow ? " · CÂMERA LENTA" : ""}</div>

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
        <button type="button" className="goal-replay-close" onClick={onClose} title="Fechar (Esc)" aria-label="Fechar replay 3D">
          <MaterialIcon name="close" className="mr-1 align-middle" />Fechar
        </button>
      )}
    </div>
  );
}

