import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getUnderstatLeagueTable, getUnderstatMatchShots, getUnderstatStats,
  getUnderstatSyncStatus, getUnderstatTeamForm, listUnderstatLeagues, listUnderstatMatches,
  syncUnderstatFast, leagueMetrics,
  type UnderstatLeague, type UnderstatMatch, type UnderstatStats, type UnderstatTableRow,
} from "../api/client";
import { Link } from "react-router-dom";
import { ShotExplorer } from "../components/ShotExplorer";
import { Modal, PlayerShotsModal } from "../components/PlayerShotsModal";
import { TeamCompare, type CompareTeam } from "../components/TeamCompare";
import { XgScatter, type ScatterPoint } from "../components/XgScatter";
import { Badge, EmptyState, ErrorState, LeagueLogo, SectionTitle, TeamLogo } from "../components/ui";
import { fmt } from "../lib/shotAnalytics";

// Renomeado: Understat -> Ligas

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isNaN(n) ? null : n;
}

type Logos = Record<string, string | null | undefined>;
const EMPTY_UNDERSTAT_LEAGUES: UnderstatLeague[] = [];

function LoadingCard({ lines = 4 }: { lines?: number }) {
  return (
    <div className="sv-card">
      <div className="sv-card-inner space-y-3">
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="h-4 skeleton" style={{ width: `${90 - i * 9}%` }} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Tabela

type SortKey =
  | "position" | "team" | "matches_played" | "wins" | "draws" | "losses" | "goals_for" | "goals_against"
  | "goal_difference" | "points" | "xpts" | "pts_diff" | "xg" | "xga" | "finishing" | "ppda" | "deep" | "shots";

function sortValue(r: UnderstatTableRow, key: SortKey): number | string {
  const rf = r.partial_understat?.recent_form ?? r.recent_form ?? {};
  const xpts = num(rf.xpts);
  const metrics = leagueMetrics(r);
  switch (key) {
    case "team": return r.team;
    case "xpts": return xpts ?? -Infinity;
    case "pts_diff": return !r.partial_understat && xpts != null && r.points != null ? r.points - xpts : -Infinity;
    case "finishing": return metrics.source !== "Understat" || r.xg == null || r.goals_for == null ? -Infinity : r.goals_for - r.xg;
    case "ppda": return num(rf.ppda) ?? Infinity;
    case "deep": return num(rf.deep) ?? -Infinity;
    case "xg": return metrics.xg ?? -Infinity;
    case "xga": return metrics.xga ?? -Infinity;
    case "shots": return metrics.shots ?? -Infinity;
    default: return (r[key as keyof UnderstatTableRow] as number) ?? 0;
  }
}

const COLUMNS: { key: SortKey; label: string; hint?: string; align?: "left" | "center" }[] = [
  { key: "position", label: "#", align: "left" },
  { key: "team", label: "Time", align: "left" },
  { key: "matches_played", label: "J" },
  { key: "wins", label: "V" },
  { key: "draws", label: "E" },
  { key: "losses", label: "D" },
  { key: "goals_for", label: "GP" },
  { key: "goals_against", label: "GC" },
  { key: "goal_difference", label: "SG" },
  { key: "points", label: "Pts" },
  { key: "xpts", label: "xPts", hint: "Pontos esperados pelo xG criado e cedido em cada jogo" },
  { key: "pts_diff", label: "Pts−xPts", hint: "Positivo: somou mais pontos do que o desempenho sugere" },
  { key: "xg", label: "xG", hint: "Gols esperados a favor" },
  { key: "xga", label: "xGA", hint: "Gols esperados contra" },
  { key: "finishing", label: "GP−xG", hint: "Gols marcados menos xG: positivo = finaliza acima do esperado" },
  { key: "ppda", label: "PPDA", hint: "Passes do adversário por ação defensiva. Menor = pressão mais intensa" },
  { key: "deep", label: "Deep", hint: "Passes e finalizações dentro de ~20 m do gol rival" },
  { key: "shots", label: "Chutes" },
];

function signed(v: number | null, digits = 1) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}`;
}
function diffColor(v: number | null) {
  if (v == null || Math.abs(v) < 0.05) return "";
  return v > 0 ? "text-sv-accent3" : "text-sv-warn";
}

function LeagueTable({
  leagueKey, seasonId, selectedTeamId, onSelectTeam,
}: {
  leagueKey: string; seasonId?: number; selectedTeamId: number | null; onSelectTeam: (r: UnderstatTableRow) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "position", dir: 1 });
  const q = useQuery({
    queryKey: ["understat", "table", leagueKey, seasonId],
    queryFn: () => getUnderstatLeagueTable(leagueKey, seasonId),
    retry: 1,
  });

  const rows = useMemo(() => {
    const data = (q.data?.table ?? []).slice();
    data.sort((a, b) => {
      const va = sortValue(a, sort.key);
      const vb = sortValue(b, sort.key);
      if (typeof va === "string" && typeof vb === "string") return va.localeCompare(vb) * sort.dir;
      return ((va as number) - (vb as number)) * sort.dir;
    });
    return data;
  }, [q.data, sort]);

  if (q.isLoading) return <LoadingCard lines={6} />;
  if (q.isError) {
    return (
      <EmptyState
        title="Erro ao carregar a tabela"
        description="Não foi possível consultar a classificação Understat desta liga. Tente novamente."
        action={<button className="sv-btn" onClick={() => q.refetch()}>Tentar novamente</button>}
      />
    );
  }
  if (!rows.length) {
    return (
      <EmptyState
        title="Nenhum dado desta temporada"
        description="A liga está cadastrada, mas ainda não há estatísticas para a temporada selecionada. Execute a sincronização."
      />
    );
  }

  const toggle = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === "position" || key === "team" || key === "ppda" ? 1 : -1 }));

  return (
    <div className="sv-card overflow-hidden">
      <div className="px-4 py-3 border-b border-sv-border bg-sv-panel2/40 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{q.data?.league}</div>
          <div className="text-xs text-sv-muted">
            Temporada {q.data?.season} · Classificação: {q.data?.source === "football_data" ? "football-data.org" : "Understat"}.
            {" "}xG, xGA e chutes usam a fonte com mais jogos (P: PitchAPI; U: Understat). xPts, PPDA e Deep são Understat. Jogos de cada fonte indicados ao lado do time.
          </div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-sv-muted text-[11px] bg-sv-panel2/30 border-b border-sv-border">
              {COLUMNS.map((c) => (
                <th key={c.key} title={c.hint} scope="col"
                  aria-sort={sort.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
                  className={`px-2 py-2 font-medium whitespace-nowrap ${c.align === "left" ? "text-left px-3" : "text-center"} ${c.key === "team" ? "sticky left-0 z-[1] bg-sv-panel" : ""} ${sort.key === c.key ? "text-sv-accent3" : ""}`}>
                  <button onClick={() => toggle(c.key)} className="hover:text-sv-text transition-colors">
                    {c.label}{sort.key === c.key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const partial = r.partial_understat;
              const metrics = leagueMetrics(r);
              const rf = partial?.recent_form ?? r.recent_form ?? {};
              const xpts = num(rf.xpts);
              const ptsDiff = !partial && xpts != null && r.points != null ? r.points - xpts : null;
              const finishing = metrics.source !== "Understat" || r.xg == null || r.goals_for == null ? null : r.goals_for - r.xg;
              return (
                <tr key={r.team_id} onClick={() => onSelectTeam(r)}
                  className={`group cursor-pointer border-t border-sv-border/60 hover:bg-sv-panel2/60 transition-colors ${selectedTeamId === r.team_id ? "bg-sv-panel3/60 shadow-[inset_3px_0_0_rgb(var(--sv-accent3))]" : ""}`}>
                  <td className="px-3 py-2 text-sv-muted tabular-nums">{r.position ?? "—"}</td>
                  <td className={`px-3 py-2 sticky left-0 z-[1] ${selectedTeamId === r.team_id ? "bg-sv-panel3" : "bg-sv-panel group-hover:bg-sv-panel2"}`}>
                    <div className="flex items-center gap-2 min-w-0">
                      <TeamLogo name={r.team} src={r.logo_url} className="w-6 h-6" />
                      <span className="truncate whitespace-nowrap">{r.team}</span>
                      {metrics.matchesPlayed != null && <span className="text-[10px] text-sv-warn whitespace-nowrap"
                        title={`${metrics.source}: ${metrics.matchesPlayed} jogos; Understat: ${partial?.matches_played ?? r.matches_played ?? "indisponível"} jogos; classificação: ${r.matches_played ?? "indisponível"}`}>
                        {metrics.source === "PitchAPI" ? "P" : "U"} {metrics.matchesPlayed} J{metrics.source === "PitchAPI" && partial ? ` · U ${partial.matches_played} J` : ""}
                      </span>}
                    </div>
                  </td>
                  <td className="text-center px-2 py-2 tabular-nums">{r.matches_played ?? "—"}</td>
                  <td className="text-center px-2 py-2 tabular-nums">{r.wins ?? "—"}</td>
                  <td className="text-center px-2 py-2 tabular-nums">{r.draws ?? "—"}</td>
                  <td className="text-center px-2 py-2 tabular-nums">{r.losses ?? "—"}</td>
                  <td className="text-center px-2 py-2 tabular-nums">{r.goals_for ?? "—"}</td>
                  <td className="text-center px-2 py-2 tabular-nums">{r.goals_against ?? "—"}</td>
                  <td className="text-center px-2 py-2 tabular-nums">{r.goal_difference == null ? "—" : r.goal_difference > 0 ? `+${r.goal_difference}` : r.goal_difference}</td>
                  <td className="text-center px-2 py-2 tabular-nums font-semibold text-sv-accent3">{r.points ?? "—"}</td>
                  <td className="text-center px-2 py-2 tabular-nums">{xpts != null ? xpts.toFixed(1) : "—"}</td>
                  <td className={`text-center px-2 py-2 tabular-nums ${diffColor(ptsDiff)}`}>{signed(ptsDiff)}</td>
                  <td className="text-center px-2 py-2 tabular-nums">{fmt(metrics.xg)}</td>
                  <td className="text-center px-2 py-2 tabular-nums text-sv-warn">{fmt(metrics.xga)}</td>
                  <td className={`text-center px-2 py-2 tabular-nums ${diffColor(finishing)}`}>{signed(finishing)}</td>
                  <td className="text-center px-2 py-2 tabular-nums">{fmt(num(rf.ppda), 1)}</td>
                  <td className="text-center px-2 py-2 tabular-nums">{num(rf.deep) != null ? Math.round(num(rf.deep) as number) : "—"}</td>
                  <td className="text-center px-2 py-2 tabular-nums">{metrics.shots == null ? "—" : Math.round(metrics.shots)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Forma recente

const RESULT_PT: Record<string, { label: string; cls: string }> = {
  W: { label: "V", cls: "bg-sv-accent/20 text-sv-accent3 border-sv-accent3/40" },
  D: { label: "E", cls: "bg-sv-panel3 text-sv-muted border-sv-border-strong" },
  L: { label: "D", cls: "bg-sv-danger/15 text-sv-danger border-sv-danger/40" },
};

function TeamFormPanel({
  team, seasonId, onClose, logos,
}: { team: { id: number; name: string; logo_url: string | null }; seasonId?: number; onClose: () => void; logos?: Logos }) {
  const q = useQuery({
    queryKey: ["understat", "form", team.id, seasonId],
    queryFn: () => getUnderstatTeamForm(team.id, { limit: 5, season_id: seasonId }),
    retry: 1,
  });
  const matches = q.data?.matches ?? [];
  const withShots = matches.filter((m) => m.has_shots);
  const avgFor = withShots.length ? withShots.reduce((a, m) => a + m.xg_for, 0) / withShots.length : null;
  const avgAgainst = withShots.length ? withShots.reduce((a, m) => a + m.xg_against, 0) / withShots.length : null;
  const maxXg = Math.max(1, ...matches.flatMap((m) => [m.xg_for, m.xg_against]));

  return (
    <div className="sv-card overflow-hidden">
      <div className="px-4 py-3 border-b border-sv-border bg-sv-panel2/40 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <TeamLogo name={team.name} src={team.logo_url} className="w-6 h-6" />
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">Forma recente · {team.name}</div>
            <div className="text-xs text-sv-muted">Últimos {matches.length || 5} jogos finalizados, do mais antigo ao mais recente</div>
          </div>
        </div>
        <button className="sv-btn" onClick={onClose}>Fechar</button>
      </div>

      <div className="sv-card-inner">
        {q.isLoading && <div className="text-sm text-sv-muted">Carregando…</div>}
        {q.isError && <div className="text-sm text-sv-muted">Não foi possível carregar a forma deste time.</div>}
        {!q.isLoading && !q.isError && !matches.length && (
          <div className="text-sm text-sv-muted">Sem jogos finalizados sincronizados para este time.</div>
        )}
        {matches.length > 0 && (
          <>
            <div className="mb-4 grid grid-cols-3 gap-3 text-sm">
              <div><div className="text-[11px] text-sv-muted">xG médio a favor</div><div className="font-mono text-lg">{fmt(avgFor)}</div></div>
              <div><div className="text-[11px] text-sv-muted">xG médio contra</div><div className="font-mono text-lg text-sv-warn">{fmt(avgAgainst)}</div></div>
              <div>
                <div className="text-[11px] text-sv-muted">Saldo de xG por jogo</div>
                <div className={`font-mono text-lg ${diffColor(avgFor != null && avgAgainst != null ? avgFor - avgAgainst : null)}`}>
                  {signed(avgFor != null && avgAgainst != null ? avgFor - avgAgainst : null, 2)}
                </div>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {matches.map((m) => {
                const res = m.result ? RESULT_PT[m.result] : null;
                return (
                  <div key={m.match_id} className="rounded-xl border border-sv-border bg-sv-bg p-3">
                    <div className="mb-1 flex items-center justify-between">
                      <span className={`rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${res?.cls ?? ""}`}>{res?.label ?? "—"}</span>
                      <span className="text-[11px] text-sv-muted">{m.home ? "casa" : "fora"}</span>
                    </div>
                    <div className="flex items-center gap-1.5 min-w-0 text-sm">
                      {m.opponent && <TeamLogo name={m.opponent} src={logos?.[m.opponent]} className="h-4 w-4" />}
                      <span className="truncate">{m.opponent ?? "—"}</span>
                    </div>
                    <div className="mb-2 font-mono text-base tabular-nums">{m.goals_for ?? "-"} × {m.goals_against ?? "-"}</div>
                    {m.has_shots ? (
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-[11px]">
                          <span className="w-8 text-sv-muted">xG</span>
                          <div className="h-1.5 flex-1 rounded-full bg-sv-panel3"><div className="h-full rounded-full bg-sv-accent3" style={{ width: `${(m.xg_for / maxXg) * 100}%` }} /></div>
                          <span className="w-8 text-right tabular-nums">{m.xg_for.toFixed(2)}</span>
                        </div>
                        <div className="flex items-center gap-2 text-[11px]">
                          <span className="w-8 text-sv-muted">xGA</span>
                          <div className="h-1.5 flex-1 rounded-full bg-sv-panel3"><div className="h-full rounded-full bg-sv-warn" style={{ width: `${(m.xg_against / maxXg) * 100}%` }} /></div>
                          <span className="w-8 text-right tabular-nums">{m.xg_against.toFixed(2)}</span>
                        </div>
                        <div className="text-[11px] text-sv-muted">Chutes {m.shots_for}–{m.shots_against}</div>
                      </div>
                    ) : (
                      <div className="text-[11px] text-sv-muted">Chutes ainda não coletados</div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Rankings

function Leaders({
  title, rows, metric, unit, onPick, logos,
}: {
  title: string;
  rows: { player_id?: number; player: string | null; team: string | null; goals?: number; shots?: number; xg?: number }[];
  metric: "goals" | "xg" | "shots";
  unit?: string;
  onPick?: (playerId: number, name: string) => void;
  logos?: Logos;
}) {
  if (!rows.length) {
    return (
      <div className="sv-card overflow-hidden">
        <div className="sv-panel-head"><h3 className="sv-panel-title">{title}</h3></div>
        <div className="sv-card-inner text-sm text-sv-muted">Sem dados.</div>
      </div>
    );
  }
  return (
    <div className="sv-card overflow-hidden">
      <div className="sv-panel-head"><h3 className="sv-panel-title">{title}</h3></div>
      <div className="sv-card-inner">
        <ol className="space-y-1">
          {rows.map((r, i) => {
            const clickable = !!onPick && r.player_id != null;
            return (
              <li key={`${r.player}-${i}`}>
                <button disabled={!clickable}
                  className="flex w-full items-center gap-3 rounded-lg px-1.5 py-1 text-left text-sm enabled:hover:bg-sv-panel2/60"
                  onClick={() => clickable && onPick!(r.player_id as number, r.player ?? "Jogador")}>
                  <span className={`w-5 tabular-nums ${i === 0 ? "text-sv-accent3 font-semibold" : "text-sv-muted"}`}>{i + 1}</span>
                  <TeamLogo name={r.team ?? undefined} src={r.team ? logos?.[r.team] : undefined} className="h-6 w-6" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{r.player ?? "—"}</div>
                    <div className="text-[11px] text-sv-muted truncate">{r.team ?? "—"}</div>
                  </div>
                  <span className="font-mono tabular-nums">
                    {metric === "goals" ? r.goals ?? 0 : metric === "shots" ? r.shots ?? 0 : fmt(r.xg)}
                    {unit && <span className="text-sv-muted text-[10px] ml-1">{unit}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        {onPick && <div className="mt-2 text-[11px] text-sv-muted">Clique num jogador para ver o mapa de chutes.</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Desempenho vs esperado

type PerfMode = "players" | "attack" | "defense";

function PerformancePanel({
  stats, onPickPlayer, logos,
}: { stats: UnderstatStats | undefined; onPickPlayer: (id: number, name: string) => void; logos?: Logos }) {
  const [mode, setMode] = useState<PerfMode>("players");

  const { points, over, under, xLabel, yLabel, invert } = useMemo(() => {
    const pts: ScatterPoint[] = mode === "players"
      ? (stats?.players ?? [])
        .filter((p) => p.shots >= 8)
        .map((p) => ({ id: p.player_id, label: p.player ?? "—", sub: p.team, x: p.xg, y: p.goals }))
      : (stats?.teams ?? []).map((t) => ({
        id: t.team_id ?? t.team,
        label: t.team,
        x: mode === "attack" ? t.xg ?? 0 : t.xga ?? 0,
        y: mode === "attack" ? t.goals_for ?? 0 : t.goals_against ?? 0,
      }));
    const diff = (p: ScatterPoint) => p.y - p.x;
    const sorted = pts.slice().sort((a, b) => diff(b) - diff(a));
    return {
      points: pts,
      over: sorted.slice(0, 5),
      under: sorted.slice(-5).reverse(),
      xLabel: mode === "defense" ? "xGA (gols esperados contra)" : "xG (gols esperados)",
      yLabel: mode === "defense" ? "Gols sofridos" : "Gols marcados",
      invert: mode === "defense",
    };
  }, [stats, mode]);

  const tabs: { key: PerfMode; label: string }[] = [
    { key: "players", label: "Jogadores" },
    { key: "attack", label: "Times · ataque" },
    { key: "defense", label: "Times · defesa" },
  ];
  const listTitle = (a: boolean) =>
    mode === "defense" ? (a ? "Sofrem mais que o esperado" : "Sofrem menos que o esperado") : a ? "Acima do esperado" : "Abaixo do esperado";

  const MiniList = ({ title, rows }: { title: string; rows: ScatterPoint[] }) => (
    <div>
      <div className="sv-label mb-2">{title}</div>
      <ul className="space-y-1 text-sm">
        {rows.map((r) => (
          <li key={r.id}>
            <button className="flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-0.5 text-left enabled:hover:bg-sv-panel2/60"
              disabled={mode !== "players"} onClick={() => mode === "players" && onPickPlayer(Number(r.id), r.label)}>
              <span className="flex min-w-0 items-center gap-1.5">
                <TeamLogo name={(mode === "players" ? r.sub : r.label) ?? undefined}
                  src={logos?.[(mode === "players" ? r.sub : r.label) ?? ""]} className="h-5 w-5" />
                <span className="truncate">{r.label}{r.sub ? <span className="ml-1.5 text-[11px] text-sv-muted">{r.sub}</span> : null}</span>
              </span>
              <span className="shrink-0 font-mono text-xs tabular-nums text-sv-muted">
                {r.y} vs {r.x.toFixed(1)} <b className="text-sv-text">{signed(r.y - r.x)}</b>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <div className="sv-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-sv-border bg-sv-panel2/40">
        <div>
          <div className="text-sm font-semibold">Desempenho vs. esperado</div>
          <div className="text-xs text-sv-muted">
            {mode === "players" ? "Jogadores com ao menos 8 chutes na temporada" : "Todos os times da temporada"}
          </div>
        </div>
        <div className="sv-seg" role="group" aria-label="Tipo de comparação">
          {tabs.map((t) => (
            <button key={t.key} type="button" onClick={() => setMode(t.key)} aria-pressed={mode === t.key}
              className="sv-seg-item !px-2.5 !py-1 text-[12px]">
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="sv-card-inner grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <XgScatter points={points} xLabel={xLabel} yLabel={yLabel} invert={invert}
          onPick={mode === "players" ? (id) => { const p = points.find((x) => x.id === id); onPickPlayer(Number(id), p?.label ?? "Jogador"); } : undefined} />
        <div className="space-y-5">
          <MiniList title={listTitle(true)} rows={over} />
          <MiniList title={listTitle(false)} rows={under} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Chutes de um jogador

// ---------------------------------------------------------------- Partidas

function MatchList({ leagueKey, seasonId }: { leagueKey: string; seasonId?: number }) {
  const [selected, setSelected] = useState<UnderstatMatch | null>(null);
  const [search, setSearch] = useState("");
  const q = useQuery({
    queryKey: ["understat", "matches", leagueKey, seasonId],
    queryFn: () => listUnderstatMatches({ league_key: leagueKey, season_id: seasonId, finished_only: true, limit: 100 }),
    retry: 1,
  });
  const shotsQ = useQuery({
    queryKey: ["understat", "shots", selected?.id],
    queryFn: () => getUnderstatMatchShots(selected!.id),
    enabled: !!selected,
    retry: 1,
  });

  const matches = useMemo(() => {
    const term = search.trim().toLowerCase();
    const all = q.data ?? [];
    if (!term) return all;
    return all.filter((m) => `${m.home_team?.name ?? ""} ${m.away_team?.name ?? ""}`.toLowerCase().includes(term));
  }, [q.data, search]);

  if (q.isLoading) return <LoadingCard lines={5} />;
  if (q.isError) {
    return (
      <EmptyState
        title="Erro ao carregar as partidas"
        description="Não foi possível consultar as partidas Understat desta liga."
        action={<button className="sv-btn" onClick={() => q.refetch()}>Tentar novamente</button>}
      />
    );
  }
  if (!(q.data ?? []).length) {
    return (
      <EmptyState
        title="Nenhuma partida finalizada"
        description="Ainda não há partidas com resultado sincronizado para esta liga/temporada."
      />
    );
  }

  const homeName = selected?.home_team?.name ?? "Casa";
  const awayName = selected?.away_team?.name ?? "Fora";

  return (
    <>
      <div className="sv-card overflow-hidden">
        <div className="px-4 py-3 border-b border-sv-border bg-sv-panel2/40 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold">Partidas ({matches.length})</div>
          <input className="sv-input" placeholder="Buscar time" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar time" />
        </div>
        <ul className="divide-y divide-sv-border/60">
          {matches.map((m) => {
            const dateLabel = m.kickoff_time ? new Date(m.kickoff_time).toLocaleDateString("pt-BR") : "—";
            const hs = m.home_score, aw = m.away_score;
            const sides = [
              { team: m.home_team, score: hs, win: hs != null && aw != null && hs > aw },
              { team: m.away_team, score: aw, win: hs != null && aw != null && aw > hs },
            ];
            return (
            <li key={m.id} className="hover:bg-sv-panel2/60">
              {/* Mobile: cartão com um time por linha e nomes completos (sem truncar em "A…") */}
              <div className="sm:hidden px-3 py-3">
                <button className="block w-full text-left" onClick={() => setSelected(m)}>
                  <div className="mb-2 flex items-center justify-between text-[11px] text-sv-muted">
                    <span>{dateLabel}</span>
                    {m.has_shots ? <Badge kind="good">chutes</Badge> : <Badge>—</Badge>}
                  </div>
                  {sides.map((sd, i) => (
                    <div key={i} className="flex items-center gap-2.5 py-1">
                      <TeamLogo name={sd.team?.name} src={sd.team?.logo_url} className="h-6 w-6" />
                      <span className={`min-w-0 flex-1 break-words text-sm leading-tight ${sd.win ? "font-semibold text-sv-text" : "text-sv-text/85"}`}>
                        {sd.team?.name ?? "—"}
                      </span>
                      <span className={`w-6 text-right font-mono text-base tabular-nums ${sd.win ? "font-bold" : ""}`}>{sd.score ?? "-"}</span>
                    </div>
                  ))}
                </button>
                <Link
                  to={`/analysis/${m.id}`}
                  className={`sv-btn mt-2 flex w-full items-center justify-center !py-1.5 !text-xs ${m.has_shots ? "" : "opacity-60"}`}
                  aria-label={`Analisar ${m.home_team?.name ?? "casa"} contra ${m.away_team?.name ?? "fora"} no Estúdio`}
                >
                  Análise
                </Link>
              </div>

              {/* Tablet/desktop: linha única */}
              <div className="hidden sm:flex items-center">
              <button
                  className="flex-1 min-w-0 text-left px-4 py-3 flex items-center gap-3"
                  onClick={() => setSelected(m)}
                >
                  <div className="flex-1 min-w-0 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                    <div className="flex items-center gap-2 justify-end min-w-0">
                      <span className="truncate">{m.home_team?.name ?? "—"}</span>
                      <TeamLogo name={m.home_team?.name} src={m.home_team?.logo_url} className="w-5 h-5" />
                    </div>
                    <div className="font-mono tabular-nums px-2 text-sm">
                      {m.home_score ?? "-"} × {m.away_score ?? "-"}
                    </div>
                    <div className="flex items-center gap-2 min-w-0">
                      <TeamLogo name={m.away_team?.name} src={m.away_team?.logo_url} className="w-5 h-5" />
                      <span className="truncate">{m.away_team?.name ?? "—"}</span>
                    </div>
                  </div>
                  <div className="shrink-0 text-[11px] text-sv-muted w-20 text-right">
                    {m.kickoff_time ? new Date(m.kickoff_time).toLocaleDateString("pt-BR") : "—"}
                  </div>
                  <div className="shrink-0">
                    {m.has_shots ? <Badge kind="good">chutes</Badge> : <Badge>—</Badge>}
                  </div>
                </button>
                {/* Abre esta partida direto no Estúdio de análise (chutes, gols, replay 2D/3D) */}
                <Link
                  to={`/analysis/${m.id}`}
                  className={`sv-btn shrink-0 mr-4 !px-3 !py-1 !text-xs ${m.has_shots ? "" : "opacity-60"}`}
                  title={m.has_shots
                    ? "Abrir esta partida no Estúdio de análise"
                    : "Esta partida ainda não tem chutes coletados — a análise abrirá sem eventos"}
                  aria-label={`Analisar ${m.home_team?.name ?? "casa"} contra ${m.away_team?.name ?? "fora"} no Estúdio`}
                >
                  Análise
                </Link>
              </div>
            </li>
            );
          })}
          {!matches.length && <li className="px-4 py-6 text-sm text-sv-muted">Nenhuma partida encontrada para “{search}”.</li>}
        </ul>
      </div>

      {selected && (
        <Modal onClose={() => setSelected(null)}>
          <div className="px-4 py-3 border-b border-sv-border bg-sv-panel2/40 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-semibold min-w-0">
                <TeamLogo name={homeName} src={selected.home_team?.logo_url} className="h-6 w-6" />
                <span className="truncate">{homeName}</span>
                <span className="font-mono tabular-nums">{selected.home_score ?? "-"} × {selected.away_score ?? "-"}</span>
                <span className="truncate">{awayName}</span>
                <TeamLogo name={awayName} src={selected.away_team?.logo_url} className="h-6 w-6" />
              </div>
              <div className="text-xs text-sv-muted">
                {selected.kickoff_time ? new Date(selected.kickoff_time).toLocaleDateString("pt-BR") : ""}
                {shotsQ.data ? ` · ${shotsQ.data.shots.length} chutes · coordenadas Understat` : ""}
              </div>
            </div>
            <button className="sv-btn" onClick={() => setSelected(null)}>Fechar</button>
          </div>
          <div className="p-3 sm:p-5">
            {shotsQ.isLoading && <div className="text-sm text-sv-muted">Carregando chutes…</div>}
            {shotsQ.isError && (
              <div className="text-sm text-sv-muted">Erro ao carregar chutes. Esta partida pode ainda não ter chutes coletados.</div>
            )}
            {shotsQ.data && (
              <ShotExplorer shots={shotsQ.data.shots} homeName={homeName} awayName={awayName}
                logos={{ [homeName]: selected.home_team?.logo_url, [awayName]: selected.away_team?.logo_url }} />
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

// ---------------------------------------------------------------- Sincronização rápida

/**
 * Botão "Sincronizar agora": só Understat, todas as ligas. Cada chamada ao backend tem um
 * orçamento de tempo curto; repetimos até não faltar mais nada (ou a fonte não ter mais
 * chutes publicados), mostrando o andamento.
 */
function FastSyncButton({ season, className = "sv-btn-primary" }: { season: number; className?: string }) {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);

  const [detail, setDetail] = useState<string>("");

  const run = useMutation({
    mutationFn: async () => {
      let added = 0;
      let empty = 0;
      let errors = 0;
      const samples: string[] = [];
      const failedLeagues = new Set<string>();
      let last: Awaited<ReturnType<typeof syncUnderstatFast>> | null = null;
      for (let round = 1; round <= 15; round++) {
        setMsg(round === 1 ? "Sincronizando…" : `Sincronizando… +${added} partidas, faltam ${last?.remaining ?? "?"}`);
        // Calendário só na 1ª rodada; as demais só buscam chutes (rodadas curtas, sem estourar o tempo).
        last = await syncUnderstatFast({ season, max_seconds: 8, max_matches: 24, calendar: round === 1 });
        added += last.progress;
        for (const [lg, v] of Object.entries(last.leagues)) {
          empty += v.empty ?? 0;
          errors += v.shot_errors ?? 0;
          if (v.error) failedLeagues.add(lg);
          for (const s of v.error_samples ?? []) if (samples.length < 6) samples.push(`${lg} ${s}`);
        }
        // Para quando acabou o que falta ou quando não há mais nada novo para tentar.
        if (last.done || last.candidates === 0) break;
      }
      return { added, empty, errors, samples, failedLeagues: [...failedLeagues], last: last! };
    },
    onSuccess: ({ added, empty, errors, samples, failedLeagues, last }) => {
      const parts = [`+${added} partidas com chutes`];
      if (last.remaining > 0) {
        const why: string[] = [];
        if (empty > 0) why.push(`${empty} a fonte ainda não publicou`);
        if (errors > 0) why.push(`${errors} com erro`);
        parts.push(`${last.remaining} sem chutes${why.length ? ` (${why.join(", ")})` : ""}`);
      }
      if (failedLeagues.length) parts.push(`calendário falhou em: ${failedLeagues.join(", ")}`);
      setMsg(parts.join(" · "));
      setDetail(samples.join("\n"));
      if (samples.length) console.warn("Understat sync — amostras de erro:\n" + samples.join("\n"));
      for (const key of ["understat", "matches-analysis", "match-studio"]) qc.invalidateQueries({ queryKey: [key] });
    },
    onError: (err: unknown) => {
      const e = err as { response?: { status?: number; data?: { detail?: string } }; message?: string };
      setMsg(e.response?.status === 409
        ? "Já existe uma sincronização em andamento. Aguarde um instante."
        : `Falha ao sincronizar: ${e.response?.data?.detail ?? e.message ?? "erro desconhecido"}. O que já foi coletado ficou salvo: clique de novo para continuar.`);
      qc.invalidateQueries({ queryKey: ["understat"] });
    },
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button className={className} onClick={() => run.mutate()} disabled={run.isPending}
        title="Atualiza calendário, resultados e chutes de todas as ligas do Understat">
        {run.isPending ? "Sincronizando…" : "Sincronizar agora"}
      </button>
      {msg && <span className="text-xs text-sv-muted max-w-[320px]" title={detail || undefined}>{msg}</span>}
    </div>
  );
}

// ---------------------------------------------------------------- Página

export default function UnderstatPage() {
  const qc = useQueryClient();
  const leaguesQ = useQuery({ queryKey: ["understat", "leagues"], queryFn: listUnderstatLeagues, retry: 1 });
  const statusQ = useQuery({ queryKey: ["understat", "sync-status"], queryFn: getUnderstatSyncStatus, retry: 0, refetchInterval: 15000 });

  const [leagueKey, setLeagueKey] = useState<string | null>(null);
  const [seasonId, setSeasonId] = useState<number | "">("");
  const [formTeam, setFormTeam] = useState<{ id: number; name: string; logo_url: string | null } | null>(null);
  const [player, setPlayer] = useState<{ id: number; name: string } | null>(null);

  const leagues = leaguesQ.data?.leagues ?? EMPTY_UNDERSTAT_LEAGUES;
  const current: UnderstatLeague | undefined = useMemo(
    () => leagues.find((l) => l.key === leagueKey) ?? leagues.find((l) => l.synced) ?? leagues[0],
    [leagues, leagueKey]
  );
  const selectedSeason = seasonId === "" ? current?.seasons?.[0]?.id : Number(seasonId);

  const statsQ = useQuery({
    queryKey: ["understat", "stats", current?.competition_id, selectedSeason],
    queryFn: () => getUnderstatStats({ competition_id: current?.competition_id ?? undefined, season_id: selectedSeason }),
    enabled: !!current?.competition_id,
    retry: 1,
  });

  // Escudos por nome de time (vindos das estatísticas da liga), usados nas listas e tabelas.
  const logoByName = useMemo<Logos>(() => {
    const m: Logos = {};
    (statsQ.data?.teams ?? []).forEach((t) => { if (t.team) m[t.team] = t.logo_url ?? null; });
    return m;
  }, [statsQ.data]);

  // Times disponíveis no comparador (ordem das estatísticas da liga).
  const compareTeams = useMemo<CompareTeam[]>(
    () => (statsQ.data?.teams ?? [])
      .filter((t) => t.team_id != null)
      .map((t) => ({ id: t.team_id as number, name: t.team, logo_url: t.logo_url ?? null })),
    [statsQ.data]
  );

  const shots = Number(statusQ.data?.leagues?.find((l) => l.resource === current?.key)?.summary?.["shots"] ?? 0);

  if (leaguesQ.isLoading) {
    return (
      <div className="space-y-4">
        <LoadingCard lines={3} />
        <LoadingCard lines={6} />
      </div>
    );
  }
  if (leaguesQ.isError) {
    return (
      <ErrorState
        title="Erro ao consultar as ligas Understat"
        description="A API não respondeu. Verifique se o backend está disponível."
        onRetry={() => leaguesQ.refetch()}
      />
    );
  }

  const syncedLeagues = leagues.filter((l) => l.synced);
  if (!syncedLeagues.length) {
    return (
      <div className="space-y-4">
        <SectionTitle title="Understat" hint="Dados reais de xG, chutes e finalizações por partida" />
        <EmptyState
          title="Sem cobertura Understat"
          description="Nenhuma liga foi sincronizada ainda. Execute a sincronização para carregar os dados da temporada."
          action={<FastSyncButton season={2026} />}
        />
      </div>
    );
  }

  const pickPlayer = (id: number, name: string) => setPlayer({ id, name });

  return (
    <div className="space-y-6">
      <section className="sv-card sv-ring" aria-label="Competição selecionada">
        <div className="sv-card-inner pt-5 flex flex-col xl:flex-row xl:items-center gap-4">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <LeagueLogo code={current?.code} name={current?.name} className="w-16 h-16 text-2xl" />
            <div className="min-w-0 leading-tight">
              <h2 className="sv-display text-2xl truncate">{current?.name ?? "Ligas"}</h2>
              <p className="text-sm text-sv-muted truncate">
                {[current?.country,
                  current?.seasons?.find((x) => x.id === selectedSeason)?.name ? `Temporada ${current?.seasons?.find((x) => x.id === selectedSeason)?.name}` : null,
                  shots > 0 ? `${shots.toLocaleString("pt-BR")} chutes sincronizados` : null,
                ].filter(Boolean).join(" · ")}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="sv-input"
              aria-label="Liga"
              value={current?.key ?? ""}
              onChange={(e) => { setLeagueKey(e.target.value); setSeasonId(""); setFormTeam(null); }}
            >
              {leagues.map((l) => (
                <option key={l.key} value={l.key} disabled={!l.synced}>
                  {l.name}{l.synced ? "" : " (não sincronizada)"}
                </option>
              ))}
            </select>
            <select
              className="sv-input"
              aria-label="Temporada"
              value={seasonId === "" ? String(current?.seasons?.[0]?.id ?? "") : String(seasonId)}
              onChange={(e) => { setSeasonId(e.target.value ? Number(e.target.value) : ""); setFormTeam(null); }}
            >
              {(current?.seasons ?? []).map((s) => (
                <option key={s.id} value={s.id}>Temporada {s.name}</option>
              ))}
            </select>
            <FastSyncButton season={current?.seasons?.[0] ? Number(current.seasons[0].name) || 2026 : 2026} />
          </div>
        </div>
      </section>

      <LeagueTable
        leagueKey={current?.key ?? "epl"}
        seasonId={selectedSeason}
        selectedTeamId={formTeam?.id ?? null}
        onSelectTeam={(r) => setFormTeam(formTeam?.id === r.team_id ? null : { id: r.team_id, name: r.team, logo_url: r.logo_url })}
      />

      {formTeam && <TeamFormPanel team={formTeam} seasonId={selectedSeason} onClose={() => setFormTeam(null)} logos={logoByName} />}

      <TeamCompare teams={compareTeams} seasonId={selectedSeason} />

      <div className="grid md:grid-cols-3 gap-3">
        <Leaders title="Artilheiros" rows={statsQ.data?.top_scorers ?? []} metric="goals" onPick={pickPlayer} logos={logoByName} />
        <Leaders title="Top xG" rows={statsQ.data?.top_xg ?? []} metric="xg" onPick={pickPlayer} logos={logoByName} />
        <Leaders title="Mais chutes" rows={statsQ.data?.top_shots ?? []} metric="shots" onPick={pickPlayer} logos={logoByName} />
      </div>

      <PerformancePanel stats={statsQ.data} onPickPlayer={pickPlayer} logos={logoByName} />

      <MatchList leagueKey={current?.key ?? "epl"} seasonId={selectedSeason} />

      {player && <PlayerShotsModal playerId={player.id} name={player.name} onClose={() => setPlayer(null)} />}
    </div>
  );
}
