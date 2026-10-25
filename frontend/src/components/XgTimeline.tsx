import { useMemo } from "react";
import type { UnderstatShot } from "../api/client";
import { AWAY_COLOR, HOME_COLOR, SOLO_COLOR, fmt, xgTimeline } from "../lib/shotAnalytics";

const W = 640;
const H = 240;
const PAD = { l: 38, r: 16, t: 16, b: 30 };

/** Linha de xG acumulado por time ao longo da partida, com marcadores nos gols. */
export function XgTimeline({
  shots, teams, cutoff, title = "xG acumulado por minuto",
}: {
  shots: UnderstatShot[];
  /** Times na ordem [mandante, visitante]. */
  teams: string[];
  /** Linha vertical do filtro de minuto (opcional). */
  cutoff?: number;
  title?: string;
}) {
  const series = useMemo(() => xgTimeline(shots, teams, 90), [shots, teams]);
  const endMinute = Math.max(90, ...series.flatMap((s) => s.points.map((p) => p.minute)));
  const maxY = Math.max(0.5, ...series.map((s) => s.total));
  const yTop = Math.ceil(maxY * 2) / 2 + 0.25;

  const sx = (m: number) => PAD.l + (m / endMinute) * (W - PAD.l - PAD.r);
  const sy = (v: number) => H - PAD.b - (v / yTop) * (H - PAD.t - PAD.b);
  const colors = teams.length > 1 ? [HOME_COLOR, AWAY_COLOR] : [SOLO_COLOR];

  const yTicks: number[] = [];
  for (let v = 0; v <= yTop; v += yTop > 3 ? 1 : 0.5) yTicks.push(v);
  const xTicks = [0, 15, 30, 45, 60, 75, 90].filter((m) => m <= endMinute);

  if (!shots.length) {
    return (
      <div className="sv-card-inner text-sm text-sv-muted">Sem chutes para montar o gráfico de xG.</div>
    );
  }

  return (
    <div className="sv-card-inner">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="sv-label">{title}</div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-sv-muted">
          {series.map((s, i) => (
            <span key={s.team} className="flex items-center gap-1">
              <span className="inline-block h-2 w-3 rounded-sm" style={{ background: colors[i] }} />
              {s.team} <b className="text-white">{fmt(s.total)}</b>
            </span>
          ))}
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full border border-white bg-transparent" />gol
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[420px]" role="img"
          aria-label="Gráfico de xG acumulado por minuto">
          {yTicks.map((v) => (
            <g key={`y-${v}`}>
              <line x1={PAD.l} x2={W - PAD.r} y1={sy(v)} y2={sy(v)} stroke="rgba(255,255,255,0.08)" />
              <text x={PAD.l - 6} y={sy(v) + 3} textAnchor="end" fontSize="10" fill="#8794ad">{v.toFixed(1)}</text>
            </g>
          ))}
          {xTicks.map((m) => (
            <g key={`x-${m}`}>
              <line x1={sx(m)} x2={sx(m)} y1={PAD.t} y2={H - PAD.b} stroke="rgba(255,255,255,0.05)" />
              <text x={sx(m)} y={H - PAD.b + 14} textAnchor="middle" fontSize="10" fill="#8794ad">{m}'</text>
            </g>
          ))}
          {/* intervalo */}
          {endMinute >= 45 && (
            <line x1={sx(45)} x2={sx(45)} y1={PAD.t} y2={H - PAD.b} stroke="rgba(255,255,255,0.18)" strokeDasharray="3 3" />
          )}

          {series.map((s, i) => {
            const d = s.points.map((p, k) => `${k === 0 ? "M" : "L"}${sx(p.minute).toFixed(1)},${sy(p.value).toFixed(1)}`).join(" ");
            return (
              <g key={s.team}>
                <path d={d} fill="none" stroke={colors[i]} strokeWidth="2.2" strokeLinejoin="round" />
                {s.goals.map((g, k) => (
                  <g key={`g-${k}`}>
                    <title>{`${g.minute}' ${g.player ?? "Gol"} · xG ${fmt(g.xg)}`}</title>
                    <circle cx={sx(g.minute)} cy={sy(g.value)} r="5" fill="#0b1220" stroke={colors[i]} strokeWidth="2" />
                    <circle cx={sx(g.minute)} cy={sy(g.value)} r="1.8" fill={colors[i]} />
                  </g>
                ))}
              </g>
            );
          })}

          {cutoff != null && cutoff < endMinute && (
            <line x1={sx(cutoff)} x2={sx(cutoff)} y1={PAD.t} y2={H - PAD.b} stroke="#facc15" strokeWidth="1.2" />
          )}
        </svg>
      </div>
    </div>
  );
}
