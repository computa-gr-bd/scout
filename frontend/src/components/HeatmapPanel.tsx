/**
 * HeatmapPanel.tsx — mapa de calor profissional do ScoutVision.
 *
 * Substitui as "manchas" (elipses com blur) por uma estimativa de densidade por kernel
 * (KDE gaussiano) calculada em METROS sobre as coordenadas reais dos eventos. Ver
 * `lib/heatmapKde.ts` para a matemática e `HeatmapPitch.tsx` para o campo.
 *
 * Fonte de dados (nada é inventado nem estático):
 *   • dados reais  → cada chute de `dataset.shots` (x, y, xG, resultado, jogador), exceto
 *                    gols contra (a fonte não garante o referencial de coordenadas deles);
 *   • demonstração → os pontos de ocupação de `dataset.heatmapHome/Away` (já existentes),
 *                    rotulados como "demonstração" na legenda.
 */
import {
  useEffect, useMemo, useRef, useState,
  type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode,
} from "react";
import type { StudioAction, StudioDataset } from "../api/studioData";
import { TeamLogo } from "./ui";
import {
  PITCH_BOX_H, PITCH_BOX_W, PITCH_PAD, PitchMarkings, PitchTurf,
} from "./HeatmapPitch";
import {
  BANDWIDTH_MAX, BANDWIDTH_MIN, HEAT_CUTOFF, PITCH_L, PITCH_W, RAMP_AWAY, RAMP_HOME, RAMP_SPECTRAL,
  buildLut, chooseBandwidth, computeKde, contourSegments, densityAt, eventsWithin, heatAlpha, rampAt,
  toMeters, zoneAt, type KdeGrid, type KdeSample, type RampStop,
} from "../lib/heatmapKde";

type TeamKey = "home" | "away";
type TeamSel = TeamKey | "both";
type Metric = "count" | "xg";
type Smooth = "precise" | "normal" | "smooth";
type Scale = "team" | "shared";

type HeatEvent = KdeSample & { team: TeamKey; shot?: StudioAction; occ?: number };

type Layer = { team: TeamKey; grid: KdeGrid; norm: number; lut: Uint8ClampedArray; contour: [number, number, number] };

const SMOOTH_FACTOR: Record<Smooth, number> = { precise: 0.78, normal: 1, smooth: 1.35 };
const SMOOTH_LABEL: Record<Smooth, string> = { precise: "Preciso", normal: "Padrão", smooth: "Suave" };
const REGION_RADIUS = 8; // m — raio da região consultada (hover/clique)
const CONTOUR_LEVELS = [0.25, 0.5, 0.75];
const RESULT_LABEL: Record<StudioAction["result"], string> = {
  goal: "Gol", saved: "Defendido", off_target: "Fora", blocked: "Bloqueado",
};

const nf = (v: number, d = 0) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
/** Número com casas decimais proporcionais à grandeza (escala de densidade pode ser < 1). */
const nfAuto = (v: number) => (v >= 100 ? nf(v, 0) : v >= 10 ? nf(v, 1) : v >= 1 ? nf(v, 2) : nf(v, 3));

/** Barra da legenda: exatamente as cores e opacidades pintadas no campo, sobre o gramado. */
function legendGradient(stops: RampStop[]) {
  const steps = 14;
  const parts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const [r, g, b] = rampAt(stops, t);
    parts.push(`rgba(${r},${g},${b},${heatAlpha(t).toFixed(3)}) ${(t * 100).toFixed(1)}%`);
  }
  return `linear-gradient(90deg, ${parts.join(", ")})`;
}

// ---------------------------------------------------------------------------
// Desenho no canvas
// ---------------------------------------------------------------------------
function drawHeat(canvas: HTMLCanvasElement, layers: Layer[], W: number, H: number) {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  for (const layer of layers) {
    const { grid, norm, lut } = layer;
    if (!(norm > 0)) continue;
    const off = document.createElement("canvas");
    off.width = grid.cols;
    off.height = grid.rows;
    const octx = off.getContext("2d");
    if (!octx) continue;
    const img = octx.createImageData(grid.cols, grid.rows);
    const px = img.data;
    for (let k = 0; k < grid.data.length; k++) {
      const t = Math.min(1, grid.data[k] / norm);
      const li = Math.round(t * 255) * 4;
      const o = k * 4;
      px[o] = lut[li]; px[o + 1] = lut[li + 1]; px[o + 2] = lut[li + 2]; px[o + 3] = lut[li + 3];
    }
    octx.putImageData(img, 0, 0);
    ctx.drawImage(off, 0, 0, W, H);
  }

  // Curvas de nível: marcam onde a concentração cruza 25/50/75 % do pico (da escala usada).
  const lw = Math.max(1, W / 900);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const layer of layers) {
    const { grid, norm, contour } = layer;
    if (!(norm > 0)) continue;
    const sx = (grid.cell / PITCH_L) * W;
    const sy = (grid.cell / PITCH_W) * H;
    CONTOUR_LEVELS.forEach((frac, li) => {
      const level = norm * frac;
      if (level > grid.max) return;
      const segs = contourSegments(grid, level);
      if (!segs.length) return;
      ctx.beginPath();
      for (const [x1, y1, x2, y2] of segs) {
        ctx.moveTo((x1 + 0.5) * sx, (y1 + 0.5) * sy);
        ctx.lineTo((x2 + 0.5) * sx, (y2 + 0.5) * sy);
      }
      ctx.lineWidth = lw * (li === 1 ? 1.15 : 1);
      ctx.strokeStyle = `rgba(${contour[0]},${contour[1]},${contour[2]},${[0.2, 0.32, 0.5][li]})`;
      ctx.stroke();
    });
  }
}

// ---------------------------------------------------------------------------
// Componentes pequenos de UI
// ---------------------------------------------------------------------------
function Seg<T extends string>({
  label, value, options, onChange, disabled,
}: {
  label: string; value: T; options: { v: T; label: string; disabled?: boolean; title?: string }[];
  onChange: (v: T) => void; disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-sv-muted">{label}</span>
      <div className="flex items-center gap-0.5 rounded-lg border border-sv-border bg-sv-panel/70 p-0.5" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.v} type="button" aria-pressed={value === o.v} title={o.title}
            disabled={disabled || o.disabled}
            onClick={() => onChange(o.v)}
            className={`rounded-md px-2.5 py-1 text-[11.5px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
              value === o.v ? "bg-sv-accent text-white" : "text-sv-muted hover:text-white"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Stat({ k, v, sub }: { k: string; v: ReactNode; sub?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-sv-muted">{k}</div>
      <div className="mt-0.5 font-mono text-[15px] font-semibold tabular-nums text-white/95">{v}</div>
      {sub && <div className="text-[10px] text-sv-muted">{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Painel
// ---------------------------------------------------------------------------
export function HeatmapPanel({
  dataset, team, homeColor, awayColor,
}: {
  dataset: StudioDataset; team: TeamSel; homeColor: string; awayColor: string;
}) {
  const ds = dataset;
  const m = ds.match;
  const real = m.source === "real";
  const teamName = (t: TeamKey) => (t === "home" ? m.home : m.away);
  const teamLogo = (t: TeamKey) => (t === "home" ? m.homeLogo : m.awayLogo);
  const teamColor = (t: TeamKey) => (t === "home" ? homeColor : awayColor);
  const shown: TeamKey[] = team === "both" ? ["home", "away"] : [team];

  const [metric, setMetric] = useState<Metric>("count");
  const [smooth, setSmooth] = useState<Smooth>("normal");
  const [scale, setScale] = useState<Scale>("team");
  const [dots, setDots] = useState(false);
  const [hover, setHover] = useState<{ px: number; py: number; mx: number; my: number } | null>(null);
  const [pinned, setPinned] = useState<{ mx: number; my: number } | null>(null);

  // ---- eventos reais (ou pontos de ocupação, no modo demonstração) ----
  const { events, ownGoalsExcluded } = useMemo(() => {
    const out: HeatEvent[] = [];
    let og = 0;
    if (real) {
      for (const s of ds.shots) {
        if (s.ownGoal) { og++; continue; }
        out.push({ ...toMeters(s.from.x, s.from.y), w: 1, team: s.team, shot: s });
      }
    } else {
      (["home", "away"] as const).forEach((t) => {
        (t === "home" ? ds.heatmapHome : ds.heatmapAway).forEach((p) => {
          out.push({ ...toMeters(p.x, p.y), w: p.intensity, occ: p.intensity, team: t });
        });
      });
    }
    return { events: out, ownGoalsExcluded: og };
  }, [ds, real]);

  const hasXg = useMemo(() => real && events.some((e) => e.shot?.xg != null), [events, real]);
  const effMetric: Metric = hasXg ? metric : "count";

  // ---- KDE por time (sempre os dois: alternar a seleção não recalcula) ----
  const kdes = useMemo(() => {
    const build = (t: TeamKey) => {
      const evs = events.filter((e) => e.team === t);
      const samples: KdeSample[] = [];
      for (const e of evs) {
        const w = !real ? (e.occ ?? 0) : effMetric === "xg" ? (e.shot?.xg ?? 0) : 1;
        if (w > 0) samples.push({ mx: e.mx, my: e.my, w });
      }
      // Largura de banda calculada pela dispersão das POSIÇÕES (não dos pesos): trocar de
      // métrica não muda o raio de suavização.
      const h = chooseBandwidth(evs, SMOOTH_FACTOR[smooth]);
      return { evs, samples, h, grid: computeKde(samples, h) };
    };
    return { home: build("home"), away: build("away") };
  }, [events, real, effMetric, smooth]);

  // ---- camadas a pintar ----
  const layers = useMemo<Layer[]>(() => {
    const sharedMax = Math.max(...shown.map((t) => kdes[t].grid.max));
    return shown.map((t) => {
      const ramp = team === "both" ? (t === "home" ? RAMP_HOME : RAMP_AWAY) : RAMP_SPECTRAL;
      return {
        team: t,
        grid: kdes[t].grid,
        norm: team === "both" && scale === "shared" ? sharedMax : kdes[t].grid.max,
        lut: buildLut(ramp),
        contour: team === "both" ? (t === "home" ? [200, 230, 255] : [255, 226, 190]) : [255, 255, 255],
      } as Layer;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kdes, team, scale]);

  // ---- canvas com crossfade ----
  const fieldRef = useRef<HTMLDivElement>(null);
  const canvasRefs = [useRef<HTMLCanvasElement>(null), useRef<HTMLCanvasElement>(null)];
  const activeRef = useRef(0);
  const drawnRef = useRef<Layer[] | null>(null);
  const [active, setActive] = useState(0);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = fieldRef.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      setSize((s) => (Math.abs(s.w - r.width) < 1 && Math.abs(s.h - r.height) < 1 ? s : { w: r.width, h: r.height }));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!size.w || !size.h) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(2, Math.round(size.w * dpr));
    const H = Math.max(2, Math.round(size.h * dpr));
    const changed = drawnRef.current !== layers;
    const target = changed ? 1 - activeRef.current : activeRef.current;
    const canvas = canvasRefs[target].current;
    if (!canvas) return;
    drawHeat(canvas, layers, W, H);
    if (changed) {
      drawnRef.current = layers;
      activeRef.current = target;
      setActive(target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers, size]);

  // ---- totais por time ----
  const totals = useMemo(() => {
    const calc = (t: TeamKey) => {
      const evs = kdes[t].evs;
      const shots = evs.filter((e) => e.shot);
      const known = shots.filter((e) => e.shot!.xg != null);
      const matches = new Set(shots.map((e) => e.shot!.matchLabel).filter(Boolean)).size;
      return {
        n: evs.length,
        goals: shots.filter((e) => e.shot!.result === "goal").length,
        onTarget: shots.filter((e) => e.shot!.result === "goal" || e.shot!.result === "saved").length,
        xg: known.reduce((a, e) => a + (e.shot!.xg ?? 0), 0),
        xgMissing: shots.length - known.length,
        matches,
      };
    };
    return { home: calc("home"), away: calc("away") };
  }, [kdes]);

  // ---- região (hover / fixada) ----
  const visibleEvents = (t: TeamKey) => kdes[t].evs;
  const regionStats = (mx: number, my: number) =>
    shown.map((t) => {
      const near = eventsWithin(visibleEvents(t), mx, my, REGION_RADIUS);
      const shots = near.filter((e) => e.shot);
      return {
        team: t,
        count: near.length,
        goals: shots.filter((e) => e.shot!.result === "goal").length,
        onTarget: shots.filter((e) => e.shot!.result === "goal" || e.shot!.result === "saved").length,
        xg: shots.reduce((a, e) => a + (e.shot!.xg ?? 0), 0),
        xgKnown: shots.filter((e) => e.shot!.xg != null).length,
        list: shots.map((e) => e.shot!).sort((a, b) => (b.xg ?? -1) - (a.xg ?? -1)),
        density: densityAt(kdes[t].grid, mx, my) * 100,
      };
    });

  const unit = !real ? "ocupação relativa" : effMetric === "xg" ? "xG por 100 m²" : "finalizações por 100 m²";
  const periodLabel = m.mode === "recent_form"
    ? "Forma recente (pré-jogo)"
    : m.mode === "match" ? `Partida · ${m.date}` : real ? m.date : "Dados de demonstração";
  const totalN = shown.reduce((a, t) => a + kdes[t].evs.length, 0);
  const showDots = real && (dots || (totalN > 0 && totalN <= 6));

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (!r.width) return;
    const px = e.clientX - r.left, py = e.clientY - r.top;
    setHover({ px, py, mx: (px / r.width) * PITCH_L, my: (py / r.height) * PITCH_W });
  };
  const onClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (!r.width) return;
    setPinned({ mx: ((e.clientX - r.left) / r.width) * PITCH_L, my: ((e.clientY - r.top) / r.height) * PITCH_W });
  };

  const hoverInfo = hover ? { zone: zoneAt(hover.mx, hover.my), stats: regionStats(hover.mx, hover.my) } : null;
  const pinnedInfo = pinned ? { zone: zoneAt(pinned.mx, pinned.my), stats: regionStats(pinned.mx, pinned.my) } : null;
  const goalOwner = (side: "left" | "right") => (side === "left" ? m.home : m.away); // gol da esquerda = do mandante

  const fieldStyle = {
    left: `${(PITCH_PAD / PITCH_BOX_W) * 100}%`,
    top: `${(PITCH_PAD / PITCH_BOX_H) * 100}%`,
    width: `${(PITCH_L / PITCH_BOX_W) * 100}%`,
    height: `${(PITCH_W / PITCH_BOX_H) * 100}%`,
  };

  const bandwidthText = shown.map((t) => `${shown.length > 1 ? `${teamName(t)} ` : ""}${nf(kdes[t].h, 1)} m`).join(" · ");
  const ariaSummary = `Mapa de calor de ${shown.map((t) => `${teamName(t)} (${kdes[t].evs.length} eventos)`).join(" e ")}`;

  return (
    <div className="space-y-3">
      {/* Controles */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {real && (
          <Seg<Metric> label="Peso" value={effMetric} onChange={setMetric}
            options={[
              { v: "count", label: "Finalizações", title: "Cada finalização conta 1" },
              { v: "xg", label: "xG", disabled: !hasXg, title: hasXg ? "Cada finalização pesa pelo seu xG" : "A fonte não traz xG" },
            ]} />
        )}
        <Seg<Smooth> label="Suavização" value={smooth} onChange={setSmooth}
          options={(["precise", "normal", "smooth"] as Smooth[]).map((v) => ({ v, label: SMOOTH_LABEL[v] }))} />
        {team === "both" && (
          <Seg<Scale> label="Escala" value={scale} onChange={setScale}
            options={[
              { v: "team", label: "Por time", title: "Cada time usa o próprio pico como topo da escala" },
              { v: "shared", label: "Comum", title: "Os dois times usam o maior pico como topo da escala" },
            ]} />
        )}
        {real && (
          <button type="button" aria-pressed={dots} onClick={() => setDots((d) => !d)}
            className={`sv-btn !py-1 !px-2.5 text-[11.5px] ${dots ? "!bg-sv-accent text-white !border-sv-accent3" : ""}`}>
            Mostrar eventos
          </button>
        )}
      </div>

      {/* Sentido de ataque + período */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1 text-[11px] text-sv-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden>←</span>
          <span className="h-2 w-2 rounded-full" style={{ background: awayColor }} />
          <span className="text-white/80">{m.away}</span> ataca
        </span>
        <span className="order-last w-full text-center sm:order-none sm:w-auto">{periodLabel}</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="text-white/80">{m.home}</span> ataca
          <span className="h-2 w-2 rounded-full" style={{ background: homeColor }} />
          <span aria-hidden>→</span>
        </span>
      </div>

      {/* Campo */}
      <div className="overflow-hidden rounded-2xl border border-white/10">
        <div className="relative w-full select-none" style={{ aspectRatio: `${PITCH_BOX_W} / ${PITCH_BOX_H}` }}>
          <PitchTurf />
          <div
            ref={fieldRef}
            className="absolute cursor-crosshair"
            style={{ ...fieldStyle, touchAction: "pan-y" }}
            role="img" aria-label={ariaSummary}
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
            onClick={onClick}
          >
            {[0, 1].map((i) => (
              <canvas key={i} ref={canvasRefs[i]} aria-hidden
                className="absolute inset-0 h-full w-full"
                style={{ opacity: active === i ? 1 : 0, transition: "opacity 380ms ease" }} />
            ))}

            {/* Tooltip */}
            {hover && hoverInfo && size.w > 0 && (
              <div
                className="pointer-events-none absolute z-10 w-[218px] rounded-lg border border-white/15 bg-slate-950/92 p-2.5 text-[11px] shadow-xl backdrop-blur"
                style={{
                  ...(hover.px > size.w * 0.55 ? { right: size.w - hover.px + 14 } : { left: hover.px + 14 }),
                  top: Math.max(4, Math.min(hover.py - 12, size.h - 128)),
                }}
              >
                <div className="font-semibold text-white">
                  {hoverInfo.zone.zone}
                  <span className="font-normal text-sv-muted"> · gol do {goalOwner(hoverInfo.zone.goalSide)}</span>
                </div>
                <div className="mt-1.5 space-y-1.5">
                  {hoverInfo.stats.map((s) => (
                    <div key={s.team}>
                      <div className="flex items-center gap-1.5 text-white/90">
                        <span className="h-2 w-2 rounded-full" style={{ background: teamColor(s.team) }} />
                        <span className="truncate">{teamName(s.team)}</span>
                      </div>
                      <div className="text-sv-muted">
                        {real
                          ? s.count
                            ? `${s.count} ${s.count === 1 ? "finalização" : "finalizações"} (≤ ${REGION_RADIUS} m) · ${s.goals} ${s.goals === 1 ? "gol" : "gols"} · xG ${s.xgKnown ? nf(s.xg, 2) : "—"}`
                            : `Sem finalizações (≤ ${REGION_RADIUS} m)`
                          : `Ocupação relativa ${nfAuto(s.density)}`}
                      </div>
                      {real && (
                        <div className="text-sv-muted">Concentração: {nfAuto(s.density)} {effMetric === "xg" ? "xG" : "fin."}/100 m²</div>
                      )}
                    </div>
                  ))}
                </div>
                <div className="mt-1.5 text-[10px] text-sv-muted/80">Clique para fixar a região</div>
              </div>
            )}
          </div>

          <PitchMarkings>
            {/* eventos reais (opcional) */}
            {showDots && shown.flatMap((t) =>
              kdes[t].evs.map((e, i) => {
                const goal = e.shot?.result === "goal";
                return (
                  <g key={`${t}-${i}`}>
                    <circle cx={e.mx} cy={e.my} r={goal ? 0.95 : 0.6}
                      fill={goal ? "#fff" : teamColor(t)} stroke={goal ? teamColor(t) : "#fff"}
                      strokeWidth={goal ? 0.32 : 0.16} opacity={0.95} />
                  </g>
                );
              }),
            )}
            {/* região consultada */}
            {hover && !pinned && (
              <circle cx={hover.mx} cy={hover.my} r={REGION_RADIUS} fill="none"
                stroke="rgba(255,255,255,0.55)" strokeWidth={0.18} strokeDasharray="0.8 0.7" />
            )}
            {pinned && (
              <g>
                <circle cx={pinned.mx} cy={pinned.my} r={REGION_RADIUS} fill="rgba(255,255,255,0.05)"
                  stroke="rgba(255,255,255,0.9)" strokeWidth={0.24} />
                <circle cx={pinned.mx} cy={pinned.my} r={0.5} fill="#fff" />
              </g>
            )}
          </PitchMarkings>

          {totalN === 0 && (
            <div className="absolute inset-0 z-10 flex items-center justify-center p-6 text-center">
              <div className="max-w-xs rounded-xl border border-white/15 bg-slate-950/80 px-4 py-3 text-sm text-white/90">
                Sem {real ? "finalizações com coordenadas" : "dados de ocupação"} para {shown.map(teamName).join(" e ")} neste recorte.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Cards: legenda por time + região selecionada */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {shown.map((t) => {
          const tt = totals[t];
          const ramp = team === "both" ? (t === "home" ? RAMP_HOME : RAMP_AWAY) : RAMP_SPECTRAL;
          const layer = layers.find((l) => l.team === t);
          const peak = (layer?.norm ?? 0) * 100;
          return (
            <div key={`${t}-${team}`} className="sv-heat-fade rounded-xl border border-sv-border bg-sv-panel2/60 p-3.5"
                 style={{ borderTopColor: teamColor(t), borderTopWidth: 2 }}>
              <div className="mb-2.5 flex items-center gap-2">
                <TeamLogo name={teamName(t)} src={teamLogo(t)} className="h-5 w-5" />
                <div className="truncate text-sm font-semibold">{teamName(t)}</div>
                <span className="ml-auto text-[10px] text-sv-muted">{t === "home" ? "ataca →" : "← ataca"}</span>
              </div>
              {real ? (
                <div className="grid grid-cols-4 gap-2">
                  <Stat k="Chutes" v={tt.n} />
                  <Stat k="No alvo" v={tt.onTarget} />
                  <Stat k="Gols" v={tt.goals} />
                  <Stat k="xG" v={tt.n - tt.xgMissing > 0 ? nf(tt.xg, 2) : "—"} sub={tt.xgMissing ? `${tt.xgMissing} s/ xG` : undefined} />
                </div>
              ) : (
                <Stat k="Pontos de ocupação" v={tt.n} sub="dados de demonstração" />
              )}
              <div className="mt-3">
                <div className="mb-1 flex items-baseline justify-between text-[10px] text-sv-muted">
                  <span>Concentração · {unit}</span>
                </div>
                <div className="h-3 w-full rounded-sm border border-white/10" style={{ background: "#1c5a38" }}>
                  <div className="h-full w-full rounded-sm" style={{ background: legendGradient(ramp) }} />
                </div>
                <div className="mt-1 flex justify-between font-mono text-[10px] tabular-nums text-sv-muted">
                  <span>0</span>
                  <span>{peak > 0 ? nfAuto(peak / 2) : "—"}</span>
                  <span>{peak > 0 ? nfAuto(peak) : "—"}</span>
                </div>
                <div className="mt-1 flex justify-between text-[10px] text-sv-muted/80">
                  <span>sem eventos</span>
                  <span>pico {team === "both" && scale === "team" ? "do time" : team === "both" ? "comum" : ""}</span>
                </div>
              </div>
              {m.mode === "recent_form" && tt.matches > 0 && (
                <div className="mt-2 text-[10px] text-sv-muted">Período: últimos {tt.matches} jogos</div>
              )}
            </div>
          );
        })}

        <div className={`rounded-xl border border-sv-border bg-sv-panel2/60 p-3.5 ${shown.length === 1 ? "lg:col-span-2" : ""}`}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-sm font-semibold">Região selecionada</div>
            {pinned && (
              <button type="button" onClick={() => setPinned(null)} className="sv-btn !py-0.5 !px-2 text-[11px]">Limpar</button>
            )}
          </div>
          {!pinnedInfo ? (
            <p className="text-xs leading-relaxed text-sv-muted">
              Passe o mouse para ver os números de cada ponto do campo. Clique para fixar uma região de {REGION_RADIUS} m de
              raio e listar as finalizações dentro dela.
            </p>
          ) : (
            <div className="space-y-2.5">
              <div className="text-xs text-white/90">
                <span className="font-semibold">{pinnedInfo.zone.zone}</span>
                <span className="text-sv-muted"> · gol do {goalOwner(pinnedInfo.zone.goalSide)} · raio de {REGION_RADIUS} m</span>
              </div>
              {pinnedInfo.stats.map((s) => (
                <div key={s.team}>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                    <span className="h-2 w-2 rounded-full" style={{ background: teamColor(s.team) }} />
                    <span className="font-medium text-white/90">{teamName(s.team)}</span>
                    {real ? (
                      <span className="text-sv-muted">
                        {s.count} {s.count === 1 ? "finalização" : "finalizações"} · {s.onTarget} no alvo · {s.goals} {s.goals === 1 ? "gol" : "gols"} · xG {s.xgKnown ? nf(s.xg, 2) : "—"}
                      </span>
                    ) : (
                      <span className="text-sv-muted">ocupação relativa {nfAuto(s.density)}</span>
                    )}
                  </div>
                  {real && s.list.length > 0 && (
                    <ul className="mt-1 space-y-0.5 border-l border-sv-border/70 pl-2.5 text-[11px]">
                      {s.list.slice(0, 5).map((sh) => (
                        <li key={sh.id} className="flex items-baseline justify-between gap-2">
                          <span className="min-w-0 truncate text-white/85">
                            {sh.minute ? `${sh.minute}' ` : ""}{sh.player}
                            {sh.matchLabel ? <span className="text-sv-muted"> · {sh.matchLabel}</span> : null}
                          </span>
                          <span className="shrink-0 font-mono tabular-nums text-sv-muted">
                            {RESULT_LABEL[sh.result]}{sh.xg != null ? ` · ${nf(sh.xg, 2)}` : ""}
                          </span>
                        </li>
                      ))}
                      {s.list.length > 5 && <li className="text-sv-muted">+ {s.list.length - 5} {s.list.length - 5 === 1 ? "finalização" : "finalizações"}</li>}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Metodologia: de onde vem cada número */}
      <p className="px-1 text-[10.5px] leading-relaxed text-sv-muted">
        {real
          ? <>Densidade por kernel gaussiano (KDE) sobre as coordenadas reais de {effMetric === "xg" ? "cada finalização, ponderada pelo xG" : "cada finalização"}. </>
          : <>Densidade por kernel gaussiano (KDE) sobre os pontos de ocupação de demonstração. </>}
        Largura de banda {bandwidthText} (regra de Scott ajustada, limitada a {nf(BANDWIDTH_MIN, 1)}–{nf(BANDWIDTH_MAX, 1)} m), campo FIFA 105 × 68 m,
        correção de borda por reflexão; regiões abaixo de {nf(HEAT_CUTOFF * 100, 1)}% do pico ficam sem cor. Linhas finas = 25%, 50% e 75% do pico.
        {ownGoalsExcluded > 0 && ` ${ownGoalsExcluded} gol${ownGoalsExcluded > 1 ? "s contra não entram" : " contra não entra"} (a fonte não garante o referencial das coordenadas).`}
        {real && !hasXg && " A fonte não traz xG para este recorte; o mapa usa a contagem de finalizações."}
        {real && " As coordenadas contêm apenas finalizações: o mapa mostra onde cada time chutou, não toda a movimentação em campo."}
        {m.dataSourceLabel ? ` Fonte: ${m.dataSourceLabel}.` : ""}
      </p>
    </div>
  );
}
