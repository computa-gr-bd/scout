import { useMemo } from "react";

export interface ScatterPoint {
  id: string | number;
  label: string;
  sub?: string | null;
  /** Valor esperado (xG ou xGA). */
  x: number;
  /** Valor real (gols). */
  y: number;
}

const W = 560;
const H = 360;
const PAD = { l: 44, r: 18, t: 16, b: 40 };

/**
 * Dispersão "esperado × real". Pontos acima da diagonal superam o esperado;
 * abaixo, ficam devendo. `invert` troca as cores para métricas defensivas
 * (gols sofridos acima do esperado é ruim).
 */
export function XgScatter({
  points, xLabel, yLabel, invert = false, onPick, labelCount = 6,
}: {
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  invert?: boolean;
  onPick?: (id: string | number) => void;
  labelCount?: number;
}) {
  const { max, outliers } = useMemo(() => {
    const m = Math.max(1, ...points.flatMap((p) => [p.x, p.y]));
    const sorted = points.slice().sort((a, b) => Math.abs(b.y - b.x) - Math.abs(a.y - a.x));
    return { max: Math.ceil(m / 5) * 5, outliers: new Set(sorted.slice(0, labelCount).map((p) => p.id)) };
  }, [points, labelCount]);

  const sx = (v: number) => PAD.l + (v / max) * (W - PAD.l - PAD.r);
  const sy = (v: number) => H - PAD.b - (v / max) * (H - PAD.t - PAD.b);
  const ticks: number[] = [];
  const step = max <= 10 ? 2 : max <= 30 ? 5 : 10;
  for (let v = 0; v <= max; v += step) ticks.push(v);

  const good = "#22c55e";
  const bad = "#f97316";
  const colorFor = (p: ScatterPoint) => {
    const diff = p.y - p.x;
    if (Math.abs(diff) < 0.5) return "#94a3b8";
    const over = diff > 0;
    return (invert ? !over : over) ? good : bad;
  };

  if (!points.length) return <div className="text-sm text-sv-muted">Sem dados para o gráfico.</div>;

  return (
    <div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[380px]" role="img"
          aria-label={`${yLabel} por ${xLabel}`}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={PAD.l} x2={W - PAD.r} y1={sy(v)} y2={sy(v)} stroke="rgba(255,255,255,0.07)" />
              <line x1={sx(v)} x2={sx(v)} y1={PAD.t} y2={H - PAD.b} stroke="rgba(255,255,255,0.05)" />
              <text x={PAD.l - 6} y={sy(v) + 3} textAnchor="end" fontSize="10" fill="#8794ad">{v}</text>
              <text x={sx(v)} y={H - PAD.b + 14} textAnchor="middle" fontSize="10" fill="#8794ad">{v}</text>
            </g>
          ))}
          <line x1={sx(0)} y1={sy(0)} x2={sx(max)} y2={sy(max)} stroke="rgba(255,255,255,0.4)" strokeDasharray="4 4" />
          <text x={sx(max) - 4} y={sy(max) + 12} textAnchor="end" fontSize="10" fill="#8794ad">real = esperado</text>
          <text x={(W + PAD.l) / 2} y={H - 6} textAnchor="middle" fontSize="11" fill="#b6c0d4">{xLabel}</text>
          <text transform={`translate(12 ${(H - PAD.b + PAD.t) / 2}) rotate(-90)`} textAnchor="middle" fontSize="11" fill="#b6c0d4">
            {yLabel}
          </text>

          {points.map((p) => {
            const c = colorFor(p);
            return (
              <g key={p.id} style={onPick ? { cursor: "pointer" } : undefined} onClick={onPick ? () => onPick(p.id) : undefined}>
                <title>{`${p.label}${p.sub ? ` (${p.sub})` : ""}: esperado ${p.x.toFixed(1)} · real ${p.y}`}</title>
                <circle cx={sx(p.x)} cy={sy(p.y)} r={outliers.has(p.id) ? 5.5 : 4} fill={c} fillOpacity="0.8" stroke="white" strokeWidth="0.6" />
                {outliers.has(p.id) && (
                  <text x={sx(p.x) + 8} y={sy(p.y) + 3} fontSize="10" fill="#e5ebf7">{p.label}</text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-sv-muted">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: "#22c55e" }} />{invert ? "Sofre menos que o esperado" : "Acima do esperado"}</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: "#f97316" }} />{invert ? "Sofre mais que o esperado" : "Abaixo do esperado"}</span>
        <span>· nomes mostrados nos maiores desvios</span>
      </div>
    </div>
  );
}
