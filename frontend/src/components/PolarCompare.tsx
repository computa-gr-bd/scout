import { useId } from "react";

export interface PolarSeries {
  id: string | number;
  name: string;
  color: string;
  /** Nota 0–100 por eixo (mesma ordem de ``axes``); ``null`` = sem dado. */
  scores: (number | null)[];
}

const W = 560;
const H = 470;
const CX = W / 2;
const CY = H / 2;
const R = 150;
const RINGS = [25, 50, 75, 100];

const polar = (angle: number, radius: number) => [CX + radius * Math.cos(angle), CY + radius * Math.sin(angle)] as const;

/** Setor circular (de ``a0`` a ``a1``, em radianos) com raio ``r``. */
function wedge(a0: number, a1: number, r: number): string {
  if (r <= 0.5) return "";
  const [x0, y0] = polar(a0, r);
  const [x1, y1] = polar(a1, r);
  return `M ${CX} ${CY} L ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)} Z`;
}

function splitLabel(label: string): string[] {
  if (label.length <= 14 || !label.includes(" ")) return [label];
  const words = label.split(" ");
  let best = 1;
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const diff = Math.abs(words.slice(0, i).join(" ").length - words.slice(i).join(" ").length);
    if (diff < bestDiff) { best = i; bestDiff = diff; }
  }
  return [words.slice(0, best).join(" "), words.slice(best).join(" ")];
}

/**
 * Gráfico polar de dimensões (estilo "comparison" do print de referência): um setor por dimensão com
 * raio proporcional à nota (percentil 0–100 no contexto posição/liga). Modo ``radar`` desenha polígonos.
 */
export function PolarCompare({ axes, series, mode = "polar" }: {
  axes: { key: string; label: string }[];
  series: PolarSeries[];
  mode?: "polar" | "radar";
}) {
  const uid = useId();
  const n = axes.length;
  if (n < 3) return null;
  const step = (2 * Math.PI) / n;
  const start = -Math.PI / 2 - step / 2;       // o 1º setor fica centrado no topo
  const gap = 0.012;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Comparação por dimensões">
      <defs>
        {series.map((s, i) => (
          <radialGradient key={s.id} id={`${uid}-g${i}`} cx={CX} cy={CY} r={R} gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={s.color} stopOpacity={0.15} />
            <stop offset="100%" stopColor={s.color} stopOpacity={0.55} />
          </radialGradient>
        ))}
      </defs>

      {/* anéis e eixos */}
      {RINGS.map((v) => (
        <g key={v}>
          <circle cx={CX} cy={CY} r={(R * v) / 100} fill="none" stroke="#22314f" strokeWidth={v === 50 ? 1.2 : 0.7} strokeDasharray={v === 50 ? "4 3" : undefined} />
          <text x={CX + 3} y={CY - (R * v) / 100 - 2} fontSize={8.5} fill="#8794ad">{v}</text>
        </g>
      ))}
      {axes.map((a, i) => {
        const [x, y] = polar(start + i * step, R);
        return <line key={a.key} x1={CX} y1={CY} x2={x} y2={y} stroke="#22314f" strokeWidth={0.7} />;
      })}

      {/* dados */}
      {series.map((s, si) => {
        if (mode === "radar") {
          const pts = axes.map((_, i) => {
            const [x, y] = polar(start + (i + 0.5) * step, (R * (s.scores[i] ?? 0)) / 100);
            return `${x.toFixed(1)},${y.toFixed(1)}`;
          }).join(" ");
          return (
            <polygon key={s.id} points={pts} fill={s.color} fillOpacity={0.18} stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
          );
        }
        return (
          <g key={s.id}>
            {axes.map((a, i) => {
              const score = s.scores[i];
              if (score == null) return null;
              const a0 = start + i * step + gap;
              const a1 = start + (i + 1) * step - gap;
              return (
                <path key={a.key} d={wedge(a0, a1, (R * score) / 100)} fill={`url(#${uid}-g${si})`} stroke={s.color} strokeWidth={1.6} strokeLinejoin="round">
                  <title>{`${s.name} · ${a.label}: ${score.toFixed(0)}`}</title>
                </path>
              );
            })}
          </g>
        );
      })}

      {/* rótulos */}
      {axes.map((a, i) => {
        const mid = start + (i + 0.5) * step;
        const [x, y] = polar(mid, R + 22);
        const cos = Math.cos(mid);
        const anchor = Math.abs(cos) < 0.25 ? "middle" : cos > 0 ? "start" : "end";
        const lines = splitLabel(a.label);
        return (
          <text key={a.key} x={x} y={y - ((lines.length - 1) * 5.5)} textAnchor={anchor} fontSize={11} fill="#cbd5e1">
            {lines.map((line, li) => (
              <tspan key={li} x={x} dy={li === 0 ? 0 : 12}>{line}</tspan>
            ))}
          </text>
        );
      })}
    </svg>
  );
}
