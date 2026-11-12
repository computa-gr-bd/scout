import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Area, AreaChart, Bar as RBar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  getGoalProbability, getPlayer, getPlayerIndex, getPlayerOverview, getPlayerZones, getUnderstatPlayerShots,
  type PlayerLeagueAverage, type PlayerOverview, type PlayerStatistics, type PlayerZoneStat,
} from "../api/client";
import { Badge, EmptyState, TeamLogo } from "../components/ui";
import { Pitch2D, type PitchShot } from "../components/Pitch";
import { IndexKpiGrid, PositionIndexSection } from "../components/PositionIndex";
import { positionLabel } from "../lib/positionLabel";

/* ------------------------------------------------------------------ paleta (print de referência) */
const C = {
  cyan: "#22e3d0",
  teal: "#19b8c9",
  blue: "#1f8bff",
  indigo: "#2f5fe0",
  navy: "#2a3fb8",
  grid: "#22314f",
  axis: "#8794ad",
  tip: { background: "#0f1830", border: "1px solid #22314f", borderRadius: 8, fontSize: 12, color: "#e5e7eb" },
  tipText: { color: "#e5e7eb" },
};

const nf = (v: number | null | undefined, d = 2) => (v == null || Number.isNaN(v) ? "—" : v.toFixed(d));
const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));
const norm = (v: number | null | undefined, max: number) => clamp(((v ?? 0) / max) * 100);

/** Métricas por 90 usadas no radar e nas barras (máximos "típicos" para normalizar em 0–100). */
interface MetricDef {
  key: string;
  label: string;
  max: number;
  pick: (s: PlayerStatistics | undefined, ex: PlayerOverview["extras"] | undefined) => number;
  pickAvg: (a: PlayerLeagueAverage) => number;
}
const METRICS: MetricDef[] = [
  { key: "shots", label: "Chutes/90", max: 5, pick: (s) => s?.shots_per_90 ?? 0, pickAvg: (a) => a.shots_per_90 },
  { key: "xg", label: "xG/90", max: 0.9, pick: (s) => s?.xg_per_90 ?? 0, pickAvg: (a) => a.xg_per_90 },
  { key: "goals", label: "Gols/90", max: 0.9, pick: (s) => s?.goals_per_90 ?? 0, pickAvg: (a) => a.goals_per_90 },
  { key: "xa", label: "xA/90", max: 0.5, pick: (s) => s?.xa_per_90 ?? 0, pickAvg: (a) => a.xa_per_90 },
  { key: "assists", label: "Assist./90", max: 0.5, pick: (s) => s?.assists_per_90 ?? 0, pickAvg: (a) => a.assists_per_90 },
  { key: "kp", label: "Passes-chave/90", max: 3, pick: (s) => s?.key_passes_per_90 ?? 0, pickAvg: (a) => a.key_passes_per_90 },
  { key: "chain", label: "xGChain/90", max: 1.2, pick: (_s, ex) => ex?.xg_chain_per_90 ?? 0, pickAvg: (a) => a.xg_chain_per_90 },
];
const RADAR_KEYS = ["shots", "xg", "xa", "kp", "chain", "goals"];
const BAR_KEYS = ["goals", "assists", "xg", "xa", "shots", "kp"];
const SUPPLEMENTAL_FBREF_METRICS = [
  { key: "shots", label: "Chutes" },
  { key: "shots_on_target", label: "Chutes no alvo" },
  { key: "tackles", label: "Desarmes ganhos" },
  { key: "interceptions", label: "Interceptações" },
  { key: "recoveries", label: "Recuperações" },
  { key: "fouls", label: "Faltas cometidas" },
  { key: "fouled", label: "Faltas sofridas" },
  { key: "yellow_cards", label: "Cartões amarelos" },
  { key: "red_cards", label: "Cartões vermelhos" },
  { key: "offsides", label: "Impedimentos" },
  { key: "crosses", label: "Cruzamentos" },
  { key: "pens_won", label: "Pênaltis sofridos" },
  { key: "pens_conceded", label: "Pênaltis cometidos" },
  { key: "own_goals", label: "Gols contra" },
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/* ------------------------------------------------------------------ índice ScoutVision */
const RATING_PARTS = [
  { key: "fin", label: "Finalização", weight: 0.3, color: C.cyan },
  { key: "cre", label: "Criação", weight: 0.25, color: C.teal },
  { key: "pro", label: "Produção", weight: 0.25, color: C.blue },
  { key: "con", label: "Construção", weight: 0.1, color: C.indigo },
  { key: "reg", label: "Regularidade", weight: 0.1, color: C.navy },
] as const;

/** Meias pesam mais criação e construção; atacantes mantêm o peso em finalização/produção. */
const MID_WEIGHTS: Record<string, number> = { fin: 0.15, cre: 0.3, pro: 0.15, con: 0.25, reg: 0.15 };
const ratingParts = (role?: string | null) =>
  RATING_PARTS.map((p) => ({ ...p, weight: role === "MID" ? MID_WEIGHTS[p.key] : p.weight }));

function computeRating(s: PlayerStatistics | undefined, ex: PlayerOverview["extras"] | undefined, role?: string | null) {
  if (!s || !s.minutes_played) return null;
  const avg = (...v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  const parts: Record<string, number> = {
    fin: avg(norm(s.shots_per_90, 4), norm(ex?.npxg_per_90 ?? s.xg_per_90, 0.7)),
    cre: avg(norm(s.xa_per_90, 0.4), norm(s.key_passes_per_90, 2.5), norm(ex?.xg_chain_per_90, 1.0)),
    pro: avg(norm(s.goals_per_90, 0.7), norm(s.assists_per_90, 0.4)),
    con: norm(ex?.xg_buildup_per_90, 0.8),
    reg: clamp((s.minutes_played / Math.max(1, s.matches_played * 90)) * 100),
  };
  const overall = ratingParts(role).reduce((acc, p) => acc + parts[p.key] * p.weight, 0);
  return { overall: Math.round(overall), parts };
}

/* ------------------------------------------------------------------ pequenos componentes */
function Panel({ title, right, children, className = "" }: {
  title: string; right?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={`sv-card ${className}`}>
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

function Empty({ text }: { text: string }) {
  return <div className="h-full min-h-[120px] grid place-items-center text-center text-xs text-sv-muted px-4">{text}</div>;
}

function Kpi({ label, value, sub, accent }: { label: string; value: React.ReactNode; sub?: React.ReactNode; accent?: boolean }) {
  return (
    <div className="sv-card">
      <div className="sv-card-inner !p-3 sm:!p-4">
        <div className="sv-label">{label}</div>
        <div className={`text-2xl font-semibold tracking-tight mt-1 ${accent ? "text-sv-accent3" : ""}`}>{value}</div>
        {sub && <div className="text-xs text-sv-muted mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

function ResultDot({ r }: { r: "W" | "D" | "L" | null }) {
  if (!r) return null;
  const cls = r === "W" ? "bg-sv-accent2" : r === "D" ? "bg-sv-warn" : "bg-sv-danger";
  return <span className={`inline-block w-2 h-2 rounded-full ${cls}`} title={r === "W" ? "Vitória" : r === "D" ? "Empate" : "Derrota"} />;
}

function ageFrom(dob?: string | null) {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000));
}

const shortOpp = (name: string | null) => (name ? name.replace(/\s+(FC|CF|AFC)$/i, "").slice(0, 10) : "—");

/* ------------------------------------------------------------------ página */
export default function PlayerPage() {
  const { id } = useParams();
  const playerId = Number(id);
  const [tab, setTab] = useState<"overview" | "zones">("overview");
  const [showAvg, setShowAvg] = useState(true);

  const player = useQuery({ queryKey: ["player", playerId], queryFn: () => getPlayer(playerId) });
  const overview = useQuery({ queryKey: ["player-overview", playerId], queryFn: () => getPlayerOverview(playerId), retry: 0 });
  const zones = useQuery({ queryKey: ["player-zones", playerId], queryFn: () => getPlayerZones(playerId), retry: 0 });
  const shotsQ = useQuery({ queryKey: ["player-shots", playerId], queryFn: () => getUnderstatPlayerShots(playerId), retry: 0 });
  const indexQ = useQuery({ queryKey: ["player-index", playerId], queryFn: () => getPlayerIndex(playerId), retry: 0 });

  const p = player.data;
  const ov = overview.data;
  const stats = useMemo(() => {
    const all = (p?.statistics ?? []).filter((x) => x.scope === "overall");
    // temporada mais recente primeiro
    return [...all].sort((a, b) => (b.season_id ?? 0) - (a.season_id ?? 0))[0];
  }, [p]);
  const soccerdataStats = isRecord(stats?.supplemental_stats?.soccerdata)
    ? stats.supplemental_stats.soccerdata
    : null;
  const avg = ov?.league_average ?? null;
  const role = indexQ.data?.role ?? ov?.role ?? null;
  // Goleiros e defensores têm índice próprio (backend); atacantes e meias usam o índice ofensivo.
  const specialRole = role === "GK" || role === "DEF";
  // Estatísticas complementares: FBref/SoccerData quando trouxe o jogador; senão (bloco vazio ou tudo
  // zerado) os totais das partidas gravadas no banco (ESPN). Goleiros não usam este painel.
  const seasonTotals = useMemo(() => indexQ.data?.season_totals ?? {}, [indexQ.data?.season_totals]);
  const supplementalMetrics = useMemo(() => {
    if (role === "GK") return [] as Array<{ key: string; label: string; value: number }>;
    const providerLooksEmpty = !soccerdataStats || ["tackles", "interceptions", "recoveries", "shots", "fouls"]
      .every((k) => !(typeof soccerdataStats[k] === "number" && (soccerdataStats[k] as number) > 0));
    return SUPPLEMENTAL_FBREF_METRICS.flatMap(({ key, label }) => {
      const provider = soccerdataStats?.[key];
      const fallback = seasonTotals[key];
      let value: number | undefined;
      if (!providerLooksEmpty && typeof provider === "number" && Number.isFinite(provider)) value = provider;
      else if (typeof fallback === "number" && Number.isFinite(fallback)) value = fallback;
      return value === undefined ? [] : [{ key, label, value }];
    });
  }, [role, soccerdataStats, seasonTotals]);
  const parts = useMemo(() => ratingParts(role), [role]);
  const rating = useMemo(() => computeRating(stats, ov?.extras, role), [stats, ov, role]);

  // Probabilidade de gol no próximo jogo (baseline do backend); falha em silêncio.
  const nm = ov?.next_match;
  const goalProb = useQuery({
    queryKey: ["player-goal-prob", playerId, nm?.opponent_id, nm?.is_home],
    queryFn: () => getGoalProbability(playerId, nm!.opponent_id!, nm!.is_home ? "home" : "away"),
    enabled: !!nm?.opponent_id,
    retry: 0,
  });

  /* ---- radar (jogador × média da liga) ---- */
  const radarData = useMemo(
    () =>
      METRICS.filter((m) => RADAR_KEYS.includes(m.key)).map((m) => ({
        m: m.label,
        Jogador: Math.round(norm(m.pick(stats, ov?.extras), m.max)),
        Liga: avg ? Math.round(norm(m.pickAvg(avg), m.max)) : undefined,
        real: m.pick(stats, ov?.extras),
        realAvg: avg ? m.pickAvg(avg) : undefined,
      })),
    [stats, ov, avg],
  );

  /* ---- barras de atributos ---- */
  const barData = useMemo(
    () =>
      METRICS.filter((m) => BAR_KEYS.includes(m.key)).map((m) => ({
        name: m.label.replace("/90", ""),
        Jogador: Math.round(norm(m.pick(stats, ov?.extras), m.max)),
        Liga: avg ? Math.round(norm(m.pickAvg(avg), m.max)) : undefined,
        real: m.pick(stats, ov?.extras),
        realAvg: avg ? m.pickAvg(avg) : undefined,
      })),
    [stats, ov, avg],
  );

  /* ---- desempenho recente / evolução ---- */
  const recent = useMemo(
    () =>
      (ov?.recent ?? []).map((r) => ({
        label: shortOpp(r.opponent),
        Gols: r.goals, Assistências: r.assists, Chutes: r.shots, xG: r.xg,
        opponent: r.opponent, date: r.date, result: r.result,
      })),
    [ov],
  );
  const evolution = useMemo(() => {
    let g = 0, x = 0;
    return recent.map((r) => {
      g += r.Gols; x += r.xG;
      return { label: r.label, "Gols acum.": g, "xG acum.": +x.toFixed(2) };
    });
  }, [recent]);

  /* ---- zonas / chutes ---- */
  const zoneList = useMemo(() => [...((zones.data ?? []) as PlayerZoneStat[])], [zones.data]);
  const zoneBarData = useMemo(
    () =>
      [...zoneList]
        .sort((a, b) => b.zone_frequency_pct - a.zone_frequency_pct)
        .slice(0, 8)
        .map((z) => ({
          zone: String(z.zone).replace(/_/g, " ").slice(0, 14),
          Freq: +z.zone_frequency_pct.toFixed(1),
          Força: +(z.offensive_strength * 100).toFixed(0),
          "xG/90": +z.xg_per_90.toFixed(3),
        })),
    [zoneList],
  );
  const oppZones = useMemo(
    () => zoneList.map((z) => ({ zone: z.zone, value: z.offensive_strength * Math.max(0.01, z.zone_frequency_pct / 100) })),
    [zoneList],
  );
  const pitchShots: PitchShot[] = useMemo(
    () =>
      (shotsQ.data?.shots ?? [])
        .filter((s) => s.x != null && s.y != null)
        .map((s) => ({
          x: s.x as number,
          y: s.y as number,
          r: Math.max(1.2, Math.min(4, 1.2 + (s.xg ?? 0) * 6)),
          color: s.is_goal ? "#5ef2b8" : s.on_target ? "#60a5fa" : "#f2a64c",
          title: `${s.minute ?? "?"}' · xG ${(s.xg ?? 0).toFixed(2)} · ${s.result ?? ""}`,
          isGoal: !!s.is_goal,
        })),
    [shotsQ.data],
  );

  const displayName = p ? p.display_name || `${p.first_name || ""} ${p.last_name}`.trim() : "";
  const age = ageFrom(p?.date_of_birth);
  const prob = goalProb.data as { probability?: number; baseline_probability?: number } | undefined;

  if (player.isLoading) return <EmptyState title="Carregando jogador" />;
  if (player.isError || !p) {
    return (
      <EmptyState
        title="Jogador não encontrado"
        action={<Link to="/players" className="sv-btn">Voltar à lista</Link>}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------ cabeçalho */}
      <div className="sv-card sv-ring">
        <div className="sv-card-inner flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="w-20 h-20 shrink-0 rounded-2xl bg-sv-panel2 border border-sv-border grid place-items-center text-2xl font-bold">
            {(p.display_name || p.last_name).slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight">{displayName}</h1>
              {p.position && <Badge kind="accent">{positionLabel(p.position)}</Badge>}
              {p.country && <Badge kind="warn">{p.country}</Badge>}
            </div>
            {/* time atual */}
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              {p.team_name ? (
                <>
                  <TeamLogo name={p.team_name} src={p.team_logo_url} className="w-6 h-6" />
                  <Link to={`/teams/${p.team_id}`} className="font-medium hover:text-sv-accent3 transition">{p.team_name}</Link>
                  {p.league_name && <Badge>{p.league_name}</Badge>}
                </>
              ) : (
                <span className="text-sm text-sv-muted">Time atual não informado</span>
              )}
            </div>
            <div className="text-xs text-sv-muted mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {age != null && <span>Idade: {age}</span>}
              {p.height_cm != null && <span>Altura: {p.height_cm} cm</span>}
              {p.weight_kg != null && <span>Peso: {p.weight_kg} kg</span>}
              {p.preferred_foot && <span>Pé: {p.preferred_foot === "left" ? "canhoto" : p.preferred_foot === "right" ? "destro" : p.preferred_foot}</span>}
              <span>Jogos: {stats?.matches_played ?? "—"} · Titular: {stats?.starts ?? "—"} · Minutos: {stats?.minutes_played ?? "—"}</span>
            </div>
          </div>
          <div className="shrink-0 flex flex-wrap gap-2">
            <Link to={`/compare?p=${p.id}`} className="sv-btn sv-btn-primary">Comparar</Link>
            <Link to="/players" className="sv-btn">Voltar à lista</Link>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------ abas */}
      <div className="flex items-center gap-1 border-b border-sv-border text-sm">
        {([["overview", "Visão geral"], ["zones", "Zonas e chutes"]] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-3 py-2 -mb-px border-b-2 transition ${tab === k ? "border-sv-accent3 text-sv-accent3" : "border-transparent text-sv-muted hover:text-sv-text"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <>
          {/* ---------------------------------------------- KPIs */}
          {specialRole ? (
            indexQ.data?.kpis?.length ? <IndexKpiGrid kpis={indexQ.data.kpis} /> : null
          ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi label="Gols / 90" value={nf(stats?.goals_per_90)} sub={`Total: ${stats?.goals ?? "—"}`} accent />
            <Kpi label="Assistências / 90" value={nf(stats?.assists_per_90)} sub={`Total: ${stats?.assists ?? "—"}`} />
            <Kpi label="xG / 90" value={nf(stats?.xg_per_90)} sub={`Total: ${nf(stats?.xg_total)}`} accent />
            <Kpi label="xA / 90" value={nf(stats?.xa_per_90)} sub={`Total: ${nf(stats?.xa_total)}`} />
          </div>
          )}

          {supplementalMetrics.length > 0 ? (
            <Panel title="Estatísticas complementares" right={<Badge kind="accent">FBref · SoccerData · ESPN</Badge>}>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {supplementalMetrics.map((metric) => (
                  <Kpi key={metric.key} label={metric.label} value={metric.value} sub="Total na temporada" />
                ))}
              </div>
            </Panel>
          ) : null}

          {specialRole ? (
            indexQ.isLoading
              ? <div className="sv-card h-24 skeleton" />
              : indexQ.data ? <PositionIndexSection data={indexQ.data} /> : null
          ) : (
            <>
          <div className="grid lg:grid-cols-2 gap-4">
            {/* ---------------------------------------------- radar */}
            <Panel
              title="Métricas de desempenho"
              right={
                avg ? (
                  <button className="sv-btn !py-1 !px-2.5 text-xs" onClick={() => setShowAvg((v) => !v)}>
                    {showAvg ? "Média da liga: ligada" : "Média da liga: desligada"}
                  </button>
                ) : undefined
              }
            >
              <div className="h-72">
                {stats ? (
                  <ResponsiveContainer>
                    <RadarChart data={radarData} outerRadius="72%">
                      <PolarGrid stroke={C.grid} />
                      <PolarAngleAxis dataKey="m" tick={{ fill: C.axis, fontSize: 11 }} />
                      <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                      {avg && showAvg && (
                        <Radar name="Média da liga" dataKey="Liga" stroke={C.indigo} fill={C.indigo} fillOpacity={0.15} strokeDasharray="4 3" />
                      )}
                      <Radar name="Jogador" dataKey="Jogador" stroke={C.cyan} fill={C.cyan} fillOpacity={0.35} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Tooltip
                        contentStyle={C.tip} itemStyle={C.tipText} labelStyle={C.tipText}
                        formatter={(v: any, name: any, item: any) => [
                          `${v}/100 (${nf(name === "Jogador" ? item.payload.real : item.payload.realAvg)} por 90)`,
                          name,
                        ]}
                      />
                    </RadarChart>
                  </ResponsiveContainer>
                ) : (
                  <Empty text="Sem estatísticas individuais para este jogador nas fontes conectadas." />
                )}
              </div>
              <div className="text-[11px] text-sv-muted mt-1">
                Normalizado vs. máximos típicos por 90 min.
                {avg ? ` Média da liga: ${avg.n_players} jogadores de linha com ≥ ${avg.min_minutes} min.` : ""}
              </div>
            </Panel>

            {/* ---------------------------------------------- rosca / índice */}
            <Panel title="Índice ofensivo ScoutVision">
              {rating ? (
                <div className="flex flex-col sm:flex-row items-center gap-4">
                  <div className="relative w-52 h-52 shrink-0">
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie
                          data={parts.map((r) => ({ name: r.label, value: Math.max(0.5, rating.parts[r.key] * r.weight) }))}
                          dataKey="value" innerRadius="66%" outerRadius="100%" paddingAngle={1} stroke="none" startAngle={90} endAngle={-270}
                        >
                          {parts.map((r) => <Cell key={r.key} fill={r.color} />)}
                        </Pie>
                        <Tooltip contentStyle={C.tip} itemStyle={C.tipText} labelStyle={C.tipText} formatter={(v: any) => Number(v).toFixed(1)} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 grid place-items-center pointer-events-none">
                      <div className="text-center leading-tight">
                        <div className="text-4xl font-bold">{rating.overall}</div>
                        <div className="text-[10px] text-sv-muted uppercase tracking-wider">Índice<br />ofensivo</div>
                      </div>
                    </div>
                  </div>
                  <ul className="space-y-1.5 text-xs w-full">
                    {parts.map((r) => (
                      <li key={r.key} className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: r.color }} />
                        <span className="flex-1">{r.label} ({Math.round(r.weight * 100)}%)</span>
                        <span className="font-mono text-sv-muted">{Math.round(rating.parts[r.key])}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="h-52"><Empty text="Sem minutos jogados registrados para calcular o índice." /></div>
              )}
              <div className="text-[11px] text-sv-muted mt-2">
                Índice 0–100 calculado com os dados disponíveis (Understat / football-data); não é um modelo treinado.
              </div>
            </Panel>
          </div>

          {/* ---------------------------------------------- atributos-chave */}
          <Panel
            title="Atributos-chave"
            right={<span className="text-[11px] text-sv-muted">{avg ? "Jogador × média da liga" : "Jogador"}</span>}
          >
            <div className="h-64">
              {stats ? (
                <ResponsiveContainer>
                  <BarChart data={barData} barGap={4}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
                    <XAxis dataKey="name" stroke={C.axis} fontSize={11} />
                    <YAxis domain={[0, 100]} stroke={C.axis} fontSize={10} width={28} />
                    <Tooltip
                      contentStyle={C.tip} itemStyle={C.tipText} labelStyle={C.tipText}
                      cursor={{ fill: "rgba(255,255,255,0.04)" }}
                      formatter={(v: any, name: any, item: any) => [
                        `${v}/100 (${nf(name === "Jogador" ? item.payload.real : item.payload.realAvg)} por 90)`,
                        name,
                      ]}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <RBar dataKey="Jogador" fill={C.cyan} radius={[4, 4, 0, 0]} />
                    {avg && <RBar dataKey="Liga" name="Média da liga" fill={C.blue} radius={[4, 4, 0, 0]} />}
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <Empty text="Sem estatísticas individuais para este jogador." />
              )}
            </div>
          </Panel>

          <div className="grid lg:grid-cols-2 gap-4">
            {/* ---------------------------------------------- desempenho recente */}
            <Panel title="Desempenho recente" right={<span className="text-[11px] text-sv-muted">últimos {recent.length || 0} jogos</span>}>
              <div className="h-52">
                {recent.length ? (
                  <ResponsiveContainer>
                    <LineChart data={recent}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.grid} />
                      <XAxis dataKey="label" stroke={C.axis} fontSize={10} />
                      <YAxis stroke={C.axis} fontSize={10} width={24} allowDecimals />
                      <Tooltip contentStyle={C.tip} itemStyle={C.tipText} labelStyle={C.tipText} labelFormatter={(_l, pl: any) => {
                        const r = pl?.[0]?.payload;
                        return r ? `${r.opponent ?? ""}${r.date ? ` · ${new Date(r.date).toLocaleDateString("pt-BR")}` : ""}` : "";
                      }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line type="monotone" dataKey="Gols" stroke={C.cyan} strokeWidth={2} dot={{ r: 3 }} />
                      <Line type="monotone" dataKey="Assistências" stroke={C.teal} strokeWidth={2} dot={{ r: 3 }} />
                      <Line type="monotone" dataKey="Chutes" stroke={C.blue} strokeWidth={2} dot={{ r: 3 }} />
                      <Line type="monotone" dataKey="xG" stroke={C.indigo} strokeWidth={2} strokeDasharray="4 3" dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <Empty text="Ainda não há chutes/gols por partida deste jogador. Rode a sincronização de chutes do Understat para preencher." />
                )}
              </div>
              {recent.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-sv-muted">
                  {recent.map((r, i) => (
                    <span key={i} className="inline-flex items-center gap-1"><ResultDot r={r.result} />{r.label}</span>
                  ))}
                </div>
              )}
            </Panel>

            {/* ---------------------------------------------- evolução */}
            <Panel title="Evolução recente" right={<span className="text-[11px] text-sv-muted">xG × gols acumulados</span>}>
              <div className="h-52">
                {evolution.length ? (
                  <ResponsiveContainer>
                    <AreaChart data={evolution}>
                      <defs>
                        <linearGradient id="evoXg" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={C.cyan} stopOpacity={0.45} />
                          <stop offset="100%" stopColor={C.cyan} stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.grid} />
                      <XAxis dataKey="label" stroke={C.axis} fontSize={10} />
                      <YAxis stroke={C.axis} fontSize={10} width={24} />
                      <Tooltip contentStyle={C.tip} itemStyle={C.tipText} labelStyle={C.tipText} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Area type="monotone" dataKey="xG acum." stroke={C.cyan} fill="url(#evoXg)" strokeWidth={2} />
                      <Area type="monotone" dataKey="Gols acum." stroke={C.blue} fill="transparent" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <Empty text="Sem partidas com chutes registrados para montar a evolução." />
                )}
              </div>
            </Panel>
          </div>
            </>
          )}

          <div className="grid lg:grid-cols-2 gap-4">
            {/* ---------------------------------------------- resumo */}
            <Panel title="Resumo da temporada">
              <div className="grid grid-cols-2 gap-3">
                <Kpi label="Jogos" value={stats?.matches_played ?? "—"} sub={`Titular: ${stats?.starts ?? "—"}`} />
                <Kpi label="Minutos" value={stats?.minutes_played ?? "—"} />
                <Kpi label="Gols" value={stats?.goals ?? "—"} sub={ov?.extras?.npg ? `Sem pênaltis: ${ov.extras.npg}` : undefined} accent />
                <Kpi label="Assistências" value={stats?.assists ?? "—"} />
                <Kpi label="Chutes" value={stats?.shots ?? "—"} sub={`${nf(stats?.shots_per_90)} / 90`} />
                <Kpi label="Cartões" value={`${ov?.extras?.yellow_cards ?? 0} / ${ov?.extras?.red_cards ?? 0}`} sub="amarelos / vermelhos" />
              </div>
            </Panel>

            {/* ---------------------------------------------- próximo jogo */}
            <Panel title="Próximo jogo">
              {nm ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <TeamLogo name={nm.opponent_name ?? undefined} src={nm.opponent_logo_url} className="w-10 h-10" />
                    <div className="min-w-0">
                      <div className="font-medium truncate">{nm.is_home ? "vs" : "@"} {nm.opponent_name}</div>
                      <div className="text-xs text-sv-muted">
                        {nm.kickoff_time ? new Date(nm.kickoff_time).toLocaleString("pt-BR", { dateStyle: "medium", timeStyle: "short" }) : "Data a definir"}
                        {nm.competition ? ` · ${nm.competition}` : ""}
                      </div>
                    </div>
                  </div>
                  {prob?.probability != null ? (
                    <div>
                      <div className="flex items-end justify-between text-xs mb-1">
                        <span className="text-sv-muted">Chance de gol (baseline experimental)</span>
                        <span className="font-mono text-sv-accent3 text-sm">{(prob.probability * 100).toFixed(1)}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-sv-panel2 overflow-hidden">
                        <div className="h-full rounded-full bg-gradient-to-r from-sv-accent via-sv-accent2 to-sv-accent3"
                             style={{ width: `${clamp(prob.probability * 100)}%` }} />
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-sv-muted">
                      {goalProb.isLoading ? "Calculando probabilidade…" : "Probabilidade indisponível para este confronto."}
                    </div>
                  )}
                  <Link to={`/analysis/${nm.match_id}`} className="sv-btn !py-1.5 inline-flex">Ver partida</Link>
                </div>
              ) : (
                <div className="h-32"><Empty text="Nenhum jogo agendado encontrado para o time atual." /></div>
              )}
            </Panel>
          </div>
        </>
      )}

      {tab === "zones" && (
        <>
          <Panel
            title="Mapa de chutes e zonas"
            right={<span className="text-[11px] text-sv-muted">{pitchShots.length} chutes · ataque →</span>}
          >
            {pitchShots.length || oppZones.length ? (
              <>
                <Pitch2D opportunityZones={oppZones} shots={pitchShots} />
                <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-sv-muted">
                  <span className="inline-flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: "#5ef2b8" }} />Gol</span>
                  <span className="inline-flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: "#60a5fa" }} />No alvo</span>
                  <span className="inline-flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: "#f2a64c" }} />Fora / bloqueado</span>
                  <span>Tamanho = xG do chute</span>
                </div>
              </>
            ) : (
              <Empty text="Este jogador ainda não tem chutes com posição registrados (Understat)." />
            )}
          </Panel>

          <Panel title="Principais zonas · frequência, força ofensiva, xG/90">
            <div className="h-64">
              {zoneBarData.length ? (
                <ResponsiveContainer>
                  <BarChart data={zoneBarData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} />
                    <XAxis dataKey="zone" stroke={C.axis} fontSize={10} />
                    <YAxis stroke={C.axis} fontSize={10} width={28} />
                    <Tooltip contentStyle={C.tip} itemStyle={C.tipText} labelStyle={C.tipText} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <RBar dataKey="Freq" name="Frequência %" fill={C.cyan} radius={[3, 3, 0, 0]} />
                    <RBar dataKey="Força" name="Força ofensiva" fill={C.blue} radius={[3, 3, 0, 0]} />
                    <RBar dataKey="xG/90" fill="#f2a64c" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <Empty text="Sem zonas para este jogador: não há chutes com posição nas fontes conectadas." />
              )}
            </div>
            {zoneList.length > 0 && (
              <>
                <div className="mt-3 grid md:grid-cols-2 gap-x-6 gap-y-2">
                  {[...zoneList].sort((a, b) => b.offensive_strength - a.offensive_strength).slice(0, 8).map((z, i) => (
                    <div key={`${z.zone}-${i}`}>
                      <div className="flex items-center justify-between text-xs mb-1 gap-2">
                        <span className="sv-chip">#{i + 1}</span>
                        <span className="capitalize font-medium flex-1 truncate">{String(z.zone).replace(/_/g, " ")}</span>
                        <span className="text-sv-muted">freq {z.zone_frequency_pct.toFixed(1)}% · xG {z.xg_per_90.toFixed(2)}</span>
                      </div>
                      <div className="sv-bar"><span style={{ width: `${clamp(z.offensive_strength * 100)}%` }} /></div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
