import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getUnderstatLeagueTable, getUnderstatMatchShots, getUnderstatPlayerShots, getUnderstatStats,
  getUnderstatSyncStatus, getUnderstatTeamForm, listUnderstatLeagues, listUnderstatMatches,
  triggerUnderstatSync,
  type UnderstatLeague, type UnderstatMatch, type UnderstatStats, type UnderstatTableRow,
} from "../api/client";
import { ShotExplorer } from "../components/ShotExplorer";
import { XgScatter, type ScatterPoint } from "../components/XgScatter";
import { Badge, EmptyState, SectionTitle, StatCard, TeamLogo } from "../components/ui";
import { fmt } from "../lib/shotAnalytics";
import { useAuth } from "../store/auth";

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isNaN(n) ? null : n;
}

function LoadingCard({ lines = 4 }: { lines?: number }) {
  return (
    <div className="sv-card">
      <div className="sv-card-inner space-y-3">
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="h-4 rounded skeleton" style={{ width: `${90 - i * 9}%` }} />
        ))}
      </div>
    </div>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-black/70 p-3 sm:p-6" onClick={onClose}>
      <div className="mx-auto max-w-[1200px]" onClick={(e) => e.stopPropagation()}>
        <div className="sv-card">{children}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Tabela

type SortKey =
  | "position" | "team" | "matches_played" | "wins" | "draws" | "losses" | "goals_for" | "goals_against"
  | "goal_difference" | "points" | "xpts" | "pts_diff" | "xg" | "xga" | "finishing" | "ppda" | "deep" | "shots";

function sortValue(r: UnderstatTableRow, key: SortKey): number | string {
  const rf = r.recent_form ?? {};
  const xpts = num(rf.xpts);
  switch (key) {
    case "team": return r.team;
    case "xpts": return xpts ?? -Infinity;
    case "pts_diff": return xpts != null && xpts > 0 ? r.points - xpts : -Infinity;
    case "finishing": return r.goals_for - (r.xg ?? 0);
    case "ppda": return num(rf.ppda) ?? Infinity;
    case "deep": return num(rf.deep) ?? -Infinity;
    case "shots": return r.shots ?? 0;
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
      <div className="px-4 py-3 border-b border-sv-border flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{q.data?.league}</div>
          <div className="text-xs text-sv-muted">
            Temporada {q.data?.season} · {rows.length} times · clique no cabeçalho para ordenar e numa linha para ver a forma recente
          </div>
        </div>
        <Badge kind="accent">understat</Badge>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-sv-muted text-[11px]">
              {COLUMNS.map((c) => (
                <th key={c.key} title={c.hint}
                  className={`px-2 py-2 font-medium whitespace-nowrap ${c.align === "left" ? "text-left px-3" : "text-center"}`}>
                  <button onClick={() => toggle(c.key)} className="hover:text-white">
                    {c.label}{sort.key === c.key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const rf = r.recent_form ?? {};
              const xpts = num(rf.xpts);
              const ptsDiff = xpts != null && xpts > 0 ? r.points - xpts : null;
              const finishing = r.goals_for - (r.xg ?? 0);
              return (
                <tr key={r.team_id} onClick={() => onSelectTeam(r)}
                  className={`cursor-pointer border-t border-sv-border/60 hover:bg-sv-panel2/60 ${selectedTeamId === r.team_id ? "bg-sv-panel2" : ""}`}>
                  <td className="px-3 py-2 text-sv-muted tabular-nums">{r.position}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <TeamLogo name={r.team} src={r.logo_url} className="w-6 h-6" />
                      <span className="truncate whitespace-nowrap">{r.team}</span>
                    </div>
                  </td>
                  <td className="text-center px-2 py-2 tabular-nums">{r.matches_played}</td>
                  <td className="text-center px-2 py-2 tabular-nums">{r.wins}</td>
                  <td className="text-center px-2 py-2 tabular-nums">{r.draws}</td>
                  <td className="text-center px-2 py-2 tabular-nums">{r.losses}</td>
                  <td className="text-center px-2 py-2 tabular-nums">{r.goals_for}</td>
                  <td className="text-center px-2 py-2 tabular-nums">{r.goals_against}</td>
                  <td className="text-center px-2 py-2 tabular-nums">{r.goal_difference > 0 ? `+${r.goal_difference}` : r.goal_difference}</td>
                  <td className="text-center px-2 py-2 tabular-nums font-semibold text-sv-accent3">{r.points}</td>
                  <td className="text-center px-2 py-2 tabular-nums">{xpts != null && xpts > 0 ? xpts.toFixed(1) : "—"}</td>
                  <td className={`text-center px-2 py-2 tabular-nums ${diffColor(ptsDiff)}`}>{signed(ptsDiff)}</td>
                  <td className="text-center px-2 py-2 tabular-nums">{fmt(r.xg)}</td>
                  <td className="text-center px-2 py-2 tabular-nums text-sv-warn">{fmt(r.xga)}</td>
                  <td className={`text-center px-2 py-2 tabular-nums ${diffColor(finishing)}`}>{signed(finishing)}</td>
                  <td className="text-center px-2 py-2 tabular-nums">{fmt(num(rf.ppda), 1)}</td>
                  <td className="text-center px-2 py-2 tabular-nums">{num(rf.deep) != null ? Math.round(num(rf.deep) as number) : "—"}</td>
                  <td className="text-center px-2 py-2 tabular-nums">{Math.round(r.shots ?? 0)}</td>
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
  W: { label: "V", cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" },
  D: { label: "E", cls: "bg-slate-500/20 text-slate-300 border-slate-500/40" },
  L: { label: "D", cls: "bg-rose-500/20 text-rose-300 border-rose-500/40" },
};

function TeamFormPanel({
  team, seasonId, onClose,
}: { team: { id: number; name: string; logo_url: string | null }; seasonId?: number; onClose: () => void }) {
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
    <div className="sv-card">
      <div className="px-4 py-3 border-b border-sv-border flex items-center justify-between gap-3">
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
                  <div key={m.match_id} className="rounded-xl border border-sv-border p-3">
                    <div className="mb-1 flex items-center justify-between">
                      <span className={`rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${res?.cls ?? ""}`}>{res?.label ?? "—"}</span>
                      <span className="text-[11px] text-sv-muted">{m.home ? "casa" : "fora"}</span>
                    </div>
                    <div className="truncate text-sm">{m.opponent ?? "—"}</div>
                    <div className="mb-2 font-mono text-base tabular-nums">{m.goals_for ?? "-"} × {m.goals_against ?? "-"}</div>
                    {m.has_shots ? (
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-[11px]">
                          <span className="w-8 text-sv-muted">xG</span>
                          <div className="h-1.5 flex-1 rounded-full bg-white/10"><div className="h-full rounded-full bg-sv-accent3" style={{ width: `${(m.xg_for / maxXg) * 100}%` }} /></div>
                          <span className="w-8 text-right tabular-nums">{m.xg_for.toFixed(2)}</span>
                        </div>
                        <div className="flex items-center gap-2 text-[11px]">
                          <span className="w-8 text-sv-muted">xGA</span>
                          <div className="h-1.5 flex-1 rounded-full bg-white/10"><div className="h-full rounded-full bg-sv-warn" style={{ width: `${(m.xg_against / maxXg) * 100}%` }} /></div>
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
  title, rows, metric, unit, onPick,
}: {
  title: string;
  rows: { player_id?: number; player: string | null; team: string | null; goals?: number; shots?: number; xg?: number }[];
  metric: "goals" | "xg" | "shots";
  unit?: string;
  onPick?: (playerId: number, name: string) => void;
}) {
  if (!rows.length) {
    return (
      <div className="sv-card">
        <div className="sv-card-inner">
          <div className="sv-label mb-2">{title}</div>
          <div className="text-sm text-sv-muted">Sem dados.</div>
        </div>
      </div>
    );
  }
  return (
    <div className="sv-card">
      <div className="sv-card-inner">
        <div className="sv-label mb-3">{title}</div>
        <ol className="space-y-1">
          {rows.map((r, i) => {
            const clickable = !!onPick && r.player_id != null;
            return (
              <li key={`${r.player}-${i}`}>
                <button disabled={!clickable}
                  className="flex w-full items-center gap-3 rounded-lg px-1.5 py-1 text-left text-sm enabled:hover:bg-sv-panel2/60"
                  onClick={() => clickable && onPick!(r.player_id as number, r.player ?? "Jogador")}>
                  <span className="w-5 text-sv-muted tabular-nums">{i + 1}</span>
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
  stats, onPickPlayer,
}: { stats: UnderstatStats | undefined; onPickPlayer: (id: number, name: string) => void }) {
  const [mode, setMode] = useState<PerfMode>("players");

  const { points, over, under, xLabel, yLabel, invert } = useMemo(() => {
    let pts: ScatterPoint[] = [];
    if (mode === "players") {
      pts = (stats?.players ?? [])
        .filter((p) => p.shots >= 8)
        .map((p) => ({ id: p.player_id, label: p.player ?? "—", sub: p.team, x: p.xg, y: p.goals }));
    } else if (mode === "attack") {
      pts = (stats?.teams ?? []).map((t) => ({ id: t.team_id ?? t.team, label: t.team, x: t.xg ?? 0, y: t.goals_for ?? 0 }));
    } else {
      pts = (stats?.teams ?? []).map((t) => ({ id: t.team_id ?? t.team, label: t.team, x: t.xga ?? 0, y: t.goals_against ?? 0 }));
    }
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
              <span className="truncate">{r.label}{r.sub ? <span className="ml-1.5 text-[11px] text-sv-muted">{r.sub}</span> : null}</span>
              <span className="shrink-0 font-mono text-xs tabular-nums text-sv-muted">
                {r.y} vs {r.x.toFixed(1)} <b className="text-white">{signed(r.y - r.x)}</b>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <div className="sv-card">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-sv-border">
        <div>
          <div className="text-sm font-semibold">Desempenho vs. esperado</div>
          <div className="text-xs text-sv-muted">
            {mode === "players" ? "Jogadores com ao menos 8 chutes na temporada" : "Todos os times da temporada"}
          </div>
        </div>
        <div className="flex gap-1.5">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setMode(t.key)}
              className={`sv-btn !px-3 !py-1 text-[12px] ${mode === t.key ? "!border-sv-accent3 !bg-sv-accent text-white" : ""}`}>
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

function PlayerShotsModal({ playerId, name, onClose }: { playerId: number; name: string; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["understat", "player-shots", playerId],
    queryFn: () => getUnderstatPlayerShots(playerId),
    retry: 1,
  });
  return (
    <Modal onClose={onClose}>
      <div className="px-4 py-3 border-b border-sv-border flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate">{q.data?.player ?? name}</div>
          <div className="text-xs text-sv-muted">Todas as finalizações coletadas · ataque sempre para a direita</div>
        </div>
        <button className="sv-btn" onClick={onClose}>Fechar</button>
      </div>
      <div className="p-3 sm:p-5">
        {q.isLoading && <div className="text-sm text-sv-muted">Carregando chutes…</div>}
        {q.isError && <div className="text-sm text-sv-muted">Não foi possível carregar os chutes deste jogador.</div>}
        {q.data && <ShotExplorer shots={q.data.shots} showXgTimeline={false} />}
      </div>
    </Modal>
  );
}

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
      <div className="sv-card">
        <div className="px-4 py-3 border-b border-sv-border flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold">Partidas ({matches.length})</div>
          <input className="sv-input" placeholder="Buscar time" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar time" />
        </div>
        <ul className="divide-y divide-sv-border/60">
          {matches.map((m) => (
            <li key={m.id}>
              <button
                className="w-full text-left px-4 py-3 hover:bg-sv-panel2/60 flex items-center gap-3"
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
            </li>
          ))}
          {!matches.length && <li className="px-4 py-6 text-sm text-sv-muted">Nenhuma partida encontrada para “{search}”.</li>}
        </ul>
      </div>

      {selected && (
        <Modal onClose={() => setSelected(null)}>
          <div className="px-4 py-3 border-b border-sv-border flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">
                {homeName} {selected.home_score ?? "-"} × {selected.away_score ?? "-"} {awayName}
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
            {shotsQ.data && <ShotExplorer shots={shotsQ.data.shots} homeName={homeName} awayName={awayName} />}
          </div>
        </Modal>
      )}
    </>
  );
}

// ---------------------------------------------------------------- Página

export default function UnderstatPage() {
  const auth = useAuth();
  const qc = useQueryClient();
  const leaguesQ = useQuery({ queryKey: ["understat", "leagues"], queryFn: listUnderstatLeagues, retry: 1 });
  const statusQ = useQuery({ queryKey: ["understat", "sync-status"], queryFn: getUnderstatSyncStatus, retry: 0, refetchInterval: 15000 });

  const [leagueKey, setLeagueKey] = useState<string | null>(null);
  const [seasonId, setSeasonId] = useState<number | "">("");
  const [formTeam, setFormTeam] = useState<{ id: number; name: string; logo_url: string | null } | null>(null);
  const [player, setPlayer] = useState<{ id: number; name: string } | null>(null);

  const leagues = leaguesQ.data?.leagues ?? [];
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

  const sync = useMutation({
    mutationFn: () =>
      triggerUnderstatSync({
        leagues: current?.key ?? "epl",
        season: current?.seasons?.[0] ? Number(current.seasons[0].name) : 2026,
      }),
    onSuccess: () => {
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["understat"] });
      }, 1500);
    },
  });

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
      <EmptyState
        title="Erro ao consultar as ligas Understat"
        description="A API não respondeu. Verifique se o backend está disponível."
        action={<button className="sv-btn" onClick={() => leaguesQ.refetch()}>Tentar novamente</button>}
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
          action={
            auth.role === "admin" ? (
              <button className="sv-btn-primary" onClick={() => sync.mutate()} disabled={sync.isPending}>
                {sync.isPending ? "Sincronizando…" : "Sincronizar Premier League 2026"}
              </button>
            ) : (
              <span className="text-xs text-sv-muted">A sincronização requer usuário administrador.</span>
            )
          }
        />
      </div>
    );
  }

  const syncState = statusQ.data?.leagues?.find((l) => l.resource === current?.key);
  const partial = syncState?.status === "failed" || (syncState?.status === "partial");
  const teamsCount = statsQ.data?.teams?.length;
  const pickPlayer = (id: number, name: string) => setPlayer({ id, name });

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Understat"
        hint="xG, chutes e finalizações por partida — dados reais da biblioteca understat"
        right={
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="sv-input"
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
              value={seasonId === "" ? String(current?.seasons?.[0]?.id ?? "") : String(seasonId)}
              onChange={(e) => { setSeasonId(e.target.value ? Number(e.target.value) : ""); setFormTeam(null); }}
            >
              {(current?.seasons ?? []).map((s) => (
                <option key={s.id} value={s.id}>Temporada {s.name}</option>
              ))}
            </select>
            {auth.role === "admin" && (
              <button className="sv-btn" onClick={() => sync.mutate()} disabled={sync.isPending}>
                {sync.isPending ? "Sincronizando…" : "Atualizar dados"}
              </button>
            )}
          </div>
        }
      />

      {partial && (
        <div className="sv-card">
          <div className="sv-card-inner flex items-center gap-3">
            <Badge kind="warn">sincronização parcial</Badge>
            <span className="text-sm text-sv-muted">
              A última execução reportou problemas. Os dados exibidos são os disponíveis no banco.
            </span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Times" value={teamsCount || "—"} sub={current?.name} />
        <StatCard label="Ligas sincronizadas" value={syncedLeagues.length} sub={`de ${leagues.length} suportadas`} />
        <StatCard label="Chutes coletados" value={shots || "—"} sub="temporada atual" />
        <StatCard
          label="Última sincronização"
          value={syncState?.last_success_at ? new Date(syncState.last_success_at).toLocaleDateString("pt-BR") : "—"}
          sub={syncState?.status ?? "desconhecido"}
        />
      </div>

      <LeagueTable
        leagueKey={current?.key ?? "epl"}
        seasonId={selectedSeason}
        selectedTeamId={formTeam?.id ?? null}
        onSelectTeam={(r) => setFormTeam(formTeam?.id === r.team_id ? null : { id: r.team_id, name: r.team, logo_url: r.logo_url })}
      />

      {formTeam && <TeamFormPanel team={formTeam} seasonId={selectedSeason} onClose={() => setFormTeam(null)} />}

      <div className="grid md:grid-cols-3 gap-3">
        <Leaders title="Artilheiros" rows={statsQ.data?.top_scorers ?? []} metric="goals" onPick={pickPlayer} />
        <Leaders title="Top xG" rows={statsQ.data?.top_xg ?? []} metric="xg" onPick={pickPlayer} />
        <Leaders title="Mais chutes" rows={statsQ.data?.top_shots ?? []} metric="shots" onPick={pickPlayer} />
      </div>

      <PerformancePanel stats={statsQ.data} onPickPlayer={pickPlayer} />

      <MatchList leagueKey={current?.key ?? "epl"} seasonId={selectedSeason} />

      {player && <PlayerShotsModal playerId={player.id} name={player.name} onClose={() => setPlayer(null)} />}
    </div>
  );
}
