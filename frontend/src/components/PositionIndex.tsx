import type { ReactNode } from "react";
import {
  Cell, Pie, PieChart, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart,
  ResponsiveContainer, Tooltip,
} from "recharts";
import type { IndexComponent, IndexKpi, IndexMetric, PlayerIndex } from "../api/client";

const COLORS = ["#22e3d0", "#19b8c9", "#1f8bff", "#2f5fe0", "#2a3fb8", "#6d5bd0"];
const TIP_TEXT = { color: "#e5e7eb" };
const TIP = { background: "#0f1830", border: "1px solid #22314f", borderRadius: 8, fontSize: 12, color: "#e5e7eb" };

function fmt(value: number | null | undefined, unit: string, decimals = 2) {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value.toFixed(decimals)}${unit === "%" ? "%" : ""}`;
}

function Panel({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="sv-card">
      <div className="sv-card-inner">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="text-sm font-semibold tracking-tight">{title}</div>
          {right}
        </div>
        {children}
      </div>
    </div>
  );
}

/** Cartões de KPI da função (goleiro ou defensor), com a média da liga quando existe. */
export function IndexKpiGrid({ kpis }: { kpis: IndexKpi[] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {kpis.map((k, i) => (
        <div key={k.key} className="sv-card">
          <div className="sv-card-inner !p-3 sm:!p-4">
            <div className="sv-label">{k.label}</div>
            <div className={`text-2xl font-semibold tracking-tight mt-1 ${i % 3 === 0 ? "text-sv-accent3" : ""}`}>
              {fmt(k.value, k.unit, k.unit === "%" ? 1 : 2)}
            </div>
            {k.sub && <div className="text-xs text-sv-muted mt-0.5">{k.sub}</div>}
            {k.league_avg != null && (
              <div className="text-[11px] text-sv-muted mt-0.5">Liga: {fmt(k.league_avg, k.unit, k.unit === "%" ? 1 : 2)}</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function MetricRow({ m }: { m: IndexMetric }) {
  const score = m.score ?? 0;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="flex-1 min-w-0 truncate">{m.label}</span>
      <span className="font-mono w-16 text-right">
        {m.value == null ? "—" : `${m.value}${m.unit === "%" ? "%" : ""}`}
      </span>
      <span className="font-mono w-14 text-right text-sv-muted">{m.league_avg == null ? "" : `liga ${m.league_avg}`}</span>
      <span
        className={`font-mono w-10 text-right ${m.robust_z == null ? "text-sv-muted" : m.robust_z >= 1 ? "text-emerald-300" : m.robust_z <= -1 ? "text-rose-300" : "text-sv-muted"}`}
        title={m.z == null && m.robust_z == null ? "Sem variação no grupo" : `Z ${m.z ?? "—"} (média/desvio) · Z robusto ${m.robust_z ?? "—"} (mediana/MAD). Positivo = melhor que o típico.`}
      >
        {m.robust_z == null ? "" : `${m.robust_z > 0 ? "+" : ""}${m.robust_z.toFixed(1)}σ`}
      </span>
      <span className="inline-block h-1.5 w-16 overflow-hidden rounded-full bg-white/10">
        <span className="block h-full rounded-full bg-sv-accent3" style={{ width: `${score}%`, opacity: m.score == null ? 0.2 : 1 }} />
      </span>
      <span className="font-mono w-7 text-right text-sv-muted">{m.score == null ? "—" : Math.round(m.score)}</span>
    </div>
  );
}

function ComponentBlock({ c, color }: { c: IndexComponent; color: string }) {
  return (
    <div className="rounded-lg border border-sv-border p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
        <span className="text-sm font-medium flex-1">{c.label} ({Math.round(c.weight * 100)}%)</span>
        <span className="font-mono text-sm">{c.score == null ? "—" : Math.round(c.score)}</span>
      </div>
      {c.hint && <div className="text-[11px] text-sv-muted">{c.hint}</div>}
      <div className="space-y-1.5">{c.metrics.map((m) => <MetricRow key={m.key} m={m} />)}</div>
    </div>
  );
}

/** Radar + rosca + detalhamento do índice de uma função (defensivo ou goleiro). */
export function PositionIndexSection({ data }: { data: PlayerIndex }) {
  const comps = (data.components ?? []).filter((c) => c.score != null);
  const title = data.role === "GK" ? "Índice de goleiro ScoutVision" : "Índice defensivo ScoutVision";
  const centerLabel = data.role === "GK" ? "Índice de goleiro" : "Índice defensivo";
  const radar = comps.map((c) => ({ m: c.label, Jogador: Math.round(c.score ?? 0) }));

  return (
    <>
      <div className="grid lg:grid-cols-2 gap-4">
        <Panel title={data.role === "GK" ? "Perfil do goleiro" : "Perfil defensivo"}
          right={data.sample ? <span className="text-[11px] text-sv-muted">{data.sample.minutes ?? 0} min</span> : undefined}>
          <div className="h-72">
            {radar.length >= 3 ? (
              <ResponsiveContainer>
                <RadarChart data={radar} outerRadius="72%">
                  <PolarGrid stroke="#22314f" />
                  <PolarAngleAxis dataKey="m" tick={{ fill: "#8794ad", fontSize: 11 }} />
                  <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                  <Radar name="Jogador" dataKey="Jogador" stroke="#22e3d0" fill="#22e3d0" fillOpacity={0.35} />
                  <Tooltip contentStyle={TIP} itemStyle={TIP_TEXT} labelStyle={TIP_TEXT} formatter={(v: any) => [`${v}/100`, "Nota"]} />
                </RadarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full grid place-items-center text-xs text-sv-muted text-center px-4">
                Dados insuficientes para o radar: menos de 3 componentes com dado para esta temporada.
              </div>
            )}
          </div>
          <div className="text-[11px] text-sv-muted mt-1">
            Cada eixo é a nota 0–100 do componente
            {data.method === "percentile" ? ` (percentil entre ${data.peers} jogadores da liga).` : " (faixas típicas do futebol europeu)."}
          </div>
        </Panel>

        <Panel title={title}>
          {data.available && data.index != null ? (
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <div className="relative w-52 h-52 shrink-0">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={comps.map((c) => ({ name: c.label, value: Math.max(0.5, (c.score ?? 0) * c.weight) }))}
                      dataKey="value" innerRadius="66%" outerRadius="100%" paddingAngle={1} stroke="none" startAngle={90} endAngle={-270}
                    >
                      {comps.map((c, i) => <Cell key={c.key} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={TIP} itemStyle={TIP_TEXT} labelStyle={TIP_TEXT} formatter={(v: any) => Number(v).toFixed(1)} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 grid place-items-center pointer-events-none">
                  <div className="text-center leading-tight">
                    <div className="text-4xl font-bold">{data.index}</div>
                    <div className="text-[10px] text-sv-muted uppercase tracking-wider">{centerLabel}</div>
                  </div>
                </div>
              </div>
              <ul className="space-y-1.5 text-xs w-full">
                {comps.map((c, i) => (
                  <li key={c.key} className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                    <span className="flex-1">{c.label} ({Math.round(c.weight * 100)}%)</span>
                    <span className="font-mono text-sv-muted">{Math.round(c.score ?? 0)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="h-52 grid place-items-center text-xs text-sv-muted text-center px-4">
              {data.reason ?? "Sem dados para calcular o índice."}
            </div>
          )}
          <div className="text-[11px] text-sv-muted mt-2 space-y-0.5">
            {(data.notes ?? []).map((n, i) => <div key={i}>{n}</div>)}
            {(data.data_sources ?? []).length > 0 && <div>Fontes: {(data.data_sources ?? []).join(" · ")}.</div>}
            {data.available && data.reliability != null && data.reliability < 1 && (
              <div>Poucos minutos: a nota é puxada para 50 (confiabilidade {Math.round(data.reliability * 100)}%; bruta {data.raw_index}).</div>
            )}
            {data.available && (data.coverage ?? 1) < 1 && (
              <div>Alguns componentes sem dado ({Math.round((data.coverage ?? 0) * 100)}% do peso calculado).</div>
            )}
          </div>
        </Panel>
      </div>

      {comps.length > 0 && (
        <Panel title="Como a nota é formada" right={<span className="text-[11px] text-sv-muted">valor · média da liga · nota</span>}>
          <div className="grid lg:grid-cols-2 gap-3">
            {(data.components ?? []).map((c, i) => <ComponentBlock key={c.key} c={c} color={COLORS[i % COLORS.length]} />)}
          </div>
        </Panel>
      )}
    </>
  );
}
