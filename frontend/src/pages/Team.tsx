import { useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  getTeam, getTeamDefensiveStats, getTeamProfile, getTeamStatistics, listMatches, listPlayers, getStandings,
  type Match, type Player, type SquadGroupKey, type StandingRow,
  type TeamDefensiveMetricKey, type TeamProfile, type TeamProfileMatch, type TeamProfilePlayer,
  type TeamZoneWeakness,
} from "../api/client";
import { Badge, EmptyState, SectionTitle, StatCard, TeamLogo } from "../components/ui";
import { TeamZoneMaps, WeaknessRanking, useTeamZoneData } from "../components/TeamZones";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { positionLabel } from "../lib/positionLabel";

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Linha de confronto (mesmo template da lista de partidas) com escudos reais. */
function TeamMatchRow({ m, teamId, showResult }: { m: Match; teamId: number; showResult?: boolean }) {
  const finished = m.status === "finished" && m.home_score != null && m.away_score != null;
  let result: "V" | "E" | "D" | null = null;
  if (finished && showResult) {
    const mine = m.home_team.id === teamId ? m.home_score! : m.away_score!;
    const theirs = m.home_team.id === teamId ? m.away_score! : m.home_score!;
    result = mine > theirs ? "V" : mine === theirs ? "E" : "D";
  }
  const resultCls = result === "V" ? "bg-sv-accent2/15 text-sv-accent3 border-sv-accent2/40"
    : result === "E" ? "bg-sv-warn/15 text-sv-warn border-sv-warn/40"
    : result === "D" ? "bg-sv-danger/15 text-sv-danger border-sv-danger/40"
    : "bg-sv-panel2 text-sv-muted border-sv-border";
  return (
    <Link to={`/analysis/${m.id}`} className="sv-card block hover:bg-sv-panel2 transition">
      <div className="px-3 sm:px-4 py-2.5 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <TeamLogo name={m.home_team.name} src={m.home_team.logo_url} className="w-7 h-7 shrink-0" />
          <div className={`truncate text-sm ${m.home_team.id === teamId ? "font-semibold" : ""}`}>
            {m.home_team.name}
          </div>
        </div>
        <div className="text-center">
          <div className="text-[10px] text-sv-muted">{fmtDate(m.kickoff_time)}</div>
          <div className="font-mono text-sm font-semibold">
            {finished ? `${m.home_score}–${m.away_score}` : "VS"}
          </div>
          {result && <span className={`sv-chip !py-0 !text-[10px] border ${resultCls}`}>{result}</span>}
        </div>
        <div className="flex items-center gap-2 min-w-0 justify-end">
          <div className={`text-right text-sm truncate ${m.away_team.id === teamId ? "font-semibold" : ""}`}>
            {m.away_team.name}
          </div>
          <TeamLogo name={m.away_team.name} src={m.away_team.logo_url} className="w-7 h-7 shrink-0" />
        </div>
      </div>
    </Link>
  );
}

/** Linhas do elenco (football-data: Goalkeeper/Defence/Midfield/Offence; Understat: GK/D/M/F). */
const SQUAD_GROUPS: { key: SquadGroupKey; label: string }[] = [
  { key: "gk", label: "Goleiros" },
  { key: "def", label: "Defensores" },
  { key: "mid", label: "Meio-campistas" },
  { key: "att", label: "Atacantes" },
];

function groupOfFootballData(position: string | null | undefined): SquadGroupKey {
  const p = (position || "").toUpperCase();
  if (p.includes("GOAL") || p === "GK") return "gk";
  if (p.includes("DEF") || p === "DF") return "def";
  if (p.includes("MID") || p === "MF") return "mid";
  return "att";
}

/** Um atleta do elenco já combinado com as estatísticas da Understat (quando o nome bate). */
interface SquadEntry {
  key: string;
  name: string;
  position: string | null;
  born: number | null;
  group: SquadGroupKey;
  games: number | null;
  goals: number | null;
  xg: number | null;
  hasStats: boolean;
}

function buildSquad(fdPlayers: Player[], profile: TeamProfile | undefined): SquadEntry[] {
  // O backend já junta o elenco de todas as fontes (vale para o id do football-data e da Understat).
  if (profile?.squad?.length) {
    return profile.squad.map((m) => ({
      key: m.key, name: m.name, position: m.position, born: m.born, group: m.group,
      games: m.games, goals: m.goals, xg: m.xg, hasStats: m.has_stats,
    }));
  }
  const understat = profile?.players ?? [];
  const byFdId = new Map<number, TeamProfilePlayer>();
  understat.forEach((u) => { if (u.fd_player_id != null) byFdId.set(u.fd_player_id, u); });

  const entries: SquadEntry[] = fdPlayers.map((p) => {
    const overall = p.statistics.find((x) => x.scope === "overall");
    const u = byFdId.get(p.id);
    const name = p.display_name || `${p.first_name || ""} ${p.last_name}`.trim();
    return {
      key: `fd-${p.id}`,
      name,
      position: p.position,
      born: p.date_of_birth ? new Date(p.date_of_birth).getFullYear() : null,
      group: groupOfFootballData(p.position),
      games: u?.games ?? overall?.matches_played ?? null,
      goals: u?.goals ?? overall?.goals ?? null,
      xg: u?.xg ?? null,
      hasStats: u != null || overall != null,
    };
  });
  // Jogadores da Understat sem par no elenco cadastrado (ou time sem elenco): entram com a posição da Understat.
  understat.filter((u) => u.fd_player_id == null).forEach((u) => {
    entries.push({
      key: `us-${u.player_id}`, name: u.name, position: u.position, born: null, group: u.group,
      games: u.games, goals: u.goals, xg: u.xg, hasStats: true,
    });
  });
  return entries;
}

const bySquadStats = (a: SquadEntry, b: SquadEntry) =>
  (b.goals ?? -1) - (a.goals ?? -1) || (b.xg ?? -1) - (a.xg ?? -1) || (b.games ?? -1) - (a.games ?? -1)
  || a.name.localeCompare(b.name);

function SquadRow({ p }: { p: SquadEntry }) {
  const initials = p.name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const dash = "—";
  return (
    <div className="flex items-center gap-3 py-2 border-b border-sv-border/40 last:border-0">
      <div className="w-8 h-8 shrink-0 rounded-full bg-sv-panel2 grid place-items-center text-[11px] font-semibold border border-sv-border">
        {initials}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{p.name}</div>
        <div className="text-[11px] text-sv-muted">
          {positionLabel(p.position, dash)}{p.born ? ` · ${p.born}` : ""}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 text-xs font-mono text-right shrink-0 w-[132px]">
        <div><div className="sv-stat-k">J</div><div>{p.games ?? dash}</div></div>
        <div><div className="sv-stat-k">G</div><div className="text-sv-accent3">{p.goals ?? dash}</div></div>
        <div><div className="sv-stat-k">xG</div><div>{p.xg != null ? p.xg.toFixed(2) : dash}</div></div>
      </div>
    </div>
  );
}

type SquadView = "posicao" | "gols" | "xg";

/** Elenco com jogos, gols e xG; agrupado por posição ou ranqueado por gols/xG. */
function SquadCard({ squad, pending, season }: { squad: SquadEntry[]; pending: boolean; season?: string }) {
  const [view, setView] = useState<SquadView>("posicao");
  const withStats = squad.filter((p) => p.hasStats && (p.games ?? 0) > 0).length;
  const flat = useMemo(() => {
    return [...squad].sort(view === "xg"
      ? (a, b) => (b.xg ?? -1) - (a.xg ?? -1) || bySquadStats(a, b)
      : bySquadStats);
  }, [squad, view]);

  return (
    <div className="sv-card">
      <div className="sv-card-inner">
        <SectionTitle
          title="Elenco"
          hint={withStats > 0
            ? `${withStats} de ${squad.length} atletas com dados da temporada · jogos, gols e xG da Understat${season ? ` (${season})` : ""}`
            : `${squad.length} atletas cadastrados; estatísticas individuais podem não estar disponíveis`}
          right={withStats > 0 ? (
            <div className="flex gap-1" role="group" aria-label="Ordenar elenco">
              {([["posicao", "Posição"], ["gols", "Gols"], ["xg", "xG"]] as const).map(([key, label]) => (
                <button key={key} type="button" aria-pressed={view === key} onClick={() => setView(key)}
                  className={`sv-btn !py-1 text-[11.5px] ${view === key ? "!bg-sv-accent text-white !border-sv-accent3" : ""}`}>
                  {label}
                </button>
              ))}
            </div>
          ) : undefined}
        />
        {pending ? (
          <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="sv-card h-12 skeleton" />)}</div>
        ) : squad.length === 0 ? (
          <EmptyState title="Elenco em breve" description="Rode a coleta da liga deste time para importar o elenco." />
        ) : (
          <div className="max-h-96 overflow-auto pr-1">
            {view === "posicao" ? SQUAD_GROUPS.map((g) => {
              const group = squad.filter((p) => p.group === g.key).sort(bySquadStats);
              if (!group.length) return null;
              return (
                <div key={g.key} className="mb-3">
                  <div className="sv-label mb-1">{g.label}</div>
                  {group.map((p) => <SquadRow key={p.key} p={p} />)}
                </div>
              );
            }) : flat.map((p) => <SquadRow key={p.key} p={p} />)}
          </div>
        )}
      </div>
    </div>
  );
}

/** Tabela da competição do time, com a linha do próprio time destacada. */
function StandingsTable({ rows, teamIds }: { rows: StandingRow[]; teamIds: number[] }) {
  const sorted = [...rows].sort((a, b) => a.position - b.position);
  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full text-sm min-w-[420px]">
        <thead>
          <tr className="text-[11px] text-sv-muted border-b border-sv-border">
            <th className="text-left py-2 font-medium">#</th>
            <th className="text-left py-2 font-medium">Time</th>
            <th className="text-center py-2 font-medium">J</th>
            <th className="text-center py-2 font-medium">V</th>
            <th className="text-center py-2 font-medium">E</th>
            <th className="text-center py-2 font-medium">D</th>
            <th className="text-center py-2 font-medium">P</th>
            <th className="text-right py-2 font-medium">SG</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const mine = teamIds.includes(r.team_id);
            return (
              <tr key={r.team_id}
                  className={`border-b border-sv-border/40 last:border-0 ${mine ? "bg-sv-accent/10" : ""}`}>
                <td className="py-2 font-mono text-xs">{r.position}</td>
                <td className="py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <TeamLogo name={r.team_name} src={r.team_logo} className="w-5 h-5 shrink-0" />
                    <span className={`truncate ${mine ? "font-semibold text-white" : ""}`}>{r.team_name}</span>
                  </div>
                </td>
                <td className="text-center font-mono text-xs">{r.played}</td>
                <td className="text-center font-mono text-xs">{r.won}</td>
                <td className="text-center font-mono text-xs">{r.draw}</td>
                <td className="text-center font-mono text-xs">{r.lost}</td>
                <td className="text-center font-mono text-xs font-semibold text-sv-accent3">{r.points}</td>
                <td className="text-right font-mono text-xs">{r.goal_difference > 0 ? `+${r.goal_difference}` : r.goal_difference}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}


const RESULT_PT: Record<"W" | "D" | "L", "V" | "E" | "D"> = { W: "V", D: "E", L: "D" };
const resultChip = (r: "V" | "E" | "D") =>
  r === "V" ? "bg-sv-accent2/20 text-sv-accent3" : r === "E" ? "bg-sv-warn/15 text-sv-warn" : "bg-sv-danger/15 text-sv-danger";

const DEFENSIVE_METRICS: { key: TeamDefensiveMetricKey; label: string }[] = [
  { key: "tackles", label: "Desarmes" },
  { key: "interceptions", label: "Interceptações" },
  { key: "clearances", label: "Cortes" },
  { key: "shots_blocked", label: "Chutes bloqueados" },
  { key: "saves", label: "Defesas coletivas" },
];

function formatDefensiveValue(value: number | null) {
  return value == null ? "—" : Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** xG a favor × xG contra nos últimos jogos (dados reais da Understat), com o resultado de cada um. */
function FormXgChart({ matches }: { matches: TeamProfileMatch[] }) {
  const data = matches.slice(-8).map((m) => ({
    label: (m.opponent || "?").replace(/^(?:1\.\s*)?(?:FC|SC|SV|VfB|TSG|RB|AFC)\s+/i, "").slice(0, 3).toUpperCase(),
    opponent: m.opponent || "Adversário",
    venue: m.home ? "em casa" : "fora",
    score: m.goals_for != null && m.goals_against != null ? `${m.goals_for}–${m.goals_against}` : "—",
    result: m.result ? RESULT_PT[m.result] : null,
    xg_for: m.xg_for,
    xg_against: m.xg_against,
  }));
  return (
    <>
      <div className="h-56">
        <ResponsiveContainer>
          <BarChart data={data} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" stroke="#22314f" />
            <XAxis dataKey="label" stroke="#8794ad" fontSize={11} />
            <YAxis stroke="#8794ad" fontSize={11} />
            <Tooltip
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as (typeof data)[number];
                return (
                  <div className="rounded-lg border border-white/15 bg-[#0c1322] px-3 py-2 text-xs shadow-2xl">
                    <div className="font-semibold">{d.opponent} <span className="font-normal text-sv-muted">({d.venue})</span></div>
                    <div className="mb-1 text-sv-muted">Placar {d.score}{d.result ? ` · ${d.result}` : ""}</div>
                    <div className="flex justify-between gap-4"><span className="text-sv-muted">xG a favor</span><strong>{d.xg_for.toFixed(2)}</strong></div>
                    <div className="flex justify-between gap-4"><span className="text-sv-muted">xG contra</span><strong>{d.xg_against.toFixed(2)}</strong></div>
                  </div>
                );
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="xg_for" name="xG a favor" radius={[6, 6, 0, 0]} fill="#37b486" />
            <Bar dataKey="xg_against" name="xG contra" radius={[6, 6, 0, 0]} fill="#e1534e" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {data.map((d, i) => (
          <span key={i} className={`sv-pill ${d.result ? resultChip(d.result) : ""}`} title={`${d.opponent} (${d.venue})`}>
            {d.result ?? "–"} {d.score} {d.label}
          </span>
        ))}
      </div>
    </>
  );
}

/** Página de time da API (ids reais do backend). */
function ApiTeamPage({ teamId }: { teamId: number }) {
  const t = useQuery({ queryKey: ["team", teamId], queryFn: () => getTeam(teamId) });
  const stats = useQuery({ queryKey: ["team-stats", teamId], queryFn: () => getTeamStatistics(teamId) });
  const defensiveStatsQ = useQuery({
    queryKey: ["team-defensive-stats", teamId],
    queryFn: () => getTeamDefensiveStats(teamId),
    retry: 1, retryDelay: 600, staleTime: 5 * 60 * 1000,
  });
  // xG, zonas, jogo a jogo e jogadores vêm dos chutes reais da Understat (o time pode ser de outra fonte).
  const profileQ = useQuery({
    queryKey: ["team-profile", teamId],
    queryFn: () => getTeamProfile(teamId),
    retry: 1, retryDelay: 600, staleTime: 5 * 60 * 1000,
  });
  // Filtrados por este time — sem o team_id o backend devolvia um "geralzão".
  const upcomingQ = useQuery({
    queryKey: ["matches-team", "upcoming", teamId],
    queryFn: () => listMatches({ scope: "upcoming", team_id: teamId, limit: 5 }),
    retry: 1, retryDelay: 600,
  });
  const recentQ = useQuery({
    queryKey: ["matches-team", "recent", teamId],
    queryFn: () => listMatches({ scope: "recent", team_id: teamId, limit: 5 }),
    retry: 1, retryDelay: 600,
  });
  const squadQ = useQuery({
    queryKey: ["squad-team", teamId],
    queryFn: () => listPlayers({ team_id: teamId, limit: 100 }),
    retry: 1, retryDelay: 600,
  });

  const s = stats.data?.[0];
  const profile = profileQ.data?.available ? profileQ.data : undefined;
  const ps = profile?.summary;
  const seasonId = s?.season_id ?? null;
  const standingsQ = useQuery({
    queryKey: ["standings", seasonId],
    queryFn: () => getStandings(seasonId!),
    enabled: seasonId != null,
    retry: 1, retryDelay: 600,
  });

  // Forma recente derivada dos resultados reais (a football-data não preenche
  // recent_form, então o gráfico antigo ficava sempre vazio). Usada só quando a
  // Understat não tem os jogos do time.
  const formMatches = [...(recentQ.data || [])]
    .filter((m) => m.status === "finished" && m.home_score != null)
    .slice(0, 5)
    .reverse();
  const formData = formMatches.map((m) => {
    const mine = m.home_team.id === teamId ? m.home_score! : m.away_score!;
    const theirs = m.home_team.id === teamId ? m.away_score! : m.home_score!;
    const label = mine > theirs ? "V" : mine === theirs ? "E" : "D";
    return { pts: label === "V" ? 3 : label === "E" ? 1 : 0, label };
  });

  const zoneData = useTeamZoneData(profile?.weaknesses, profile?.opportunities);
  const squad = useMemo(() => buildSquad(squadQ.data || [], profile), [squadQ.data, profile]);
  const upcoming = upcomingQ.data || [];
  const recent = recentQ.data || [];
  // Classificação do football-data; se o time vem da Understat (ou a tabela não existe), usa a da Understat.
  const standings = (standingsQ.data?.length ? standingsQ.data : profile?.standings) || [];
  const myIds = profile?.team_ids ?? [teamId];
  const myStanding = standings.find((r) => myIds.includes(r.team_id));

  // Cartões de ataque/defesa: Understat (calculado dos chutes) primeiro; estatística da liga como reserva.
  const xg90 = ps?.xg_per_90 ?? (s?.xg_per_90 ? s.xg_per_90 : null);
  const xga90 = ps?.xga_per_90 ?? (s?.xga_per_90 ? s.xga_per_90 : null);
  const shots90 = ps?.shots_per_90 ?? (s?.shots_per_90 ? s.shots_per_90 : null);
  const conceded90 = s?.goals_conceded_per_90 ? s.goals_conceded_per_90 : (ps?.goals_conceded_per_90 ?? null);
  const seasonLabel = profile?.season
    ? [profile.season.competition, profile.season.name].filter(Boolean).join(" ")
    : undefined;

  return (
    <div className="space-y-6">
      {t.data ? (
        <>
          <Link to="/teams" className="sv-chip hover:bg-sv-panel2 transition inline-flex">← Times</Link>
          <div className="sv-card sv-ring">
            <div className="sv-card-inner flex flex-col md:flex-row items-start md:items-center gap-4">
              <TeamLogo name={t.data.name} src={t.data.logo_url} className="w-16 h-16 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-2xl font-bold tracking-tight">{t.data.name}</h1>
                  <Badge>{t.data.code}</Badge>
                  {t.data.country && <Badge kind="accent">{t.data.country}</Badge>}
                  {myStanding && <Badge kind="warn">{myStanding.position}º · {myStanding.points} pts</Badge>}
                </div>
                <div className="text-sm text-sv-muted mt-1">Fundado em {t.data.founded || "—"} · Estádio: {(t.data as any).stadium?.name || "—"} ({(t.data as any).stadium?.capacity || "—"})</div>
              </div>
            </div>
          </div>
        </>
      ) : <EmptyState title="Carregando time" />}

      <div className="space-y-2">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
          <StatCard label="Partidas jogadas" value={s?.matches_played || ps?.matches || "—"} sub={`${s?.wins ?? ps?.wins ?? 0}V ${s?.draws ?? ps?.draws ?? 0}E ${s?.losses ?? ps?.losses ?? 0}D`} />
          <StatCard label="Pontos por jogo" value={s ? s.points_per_game.toFixed(2) : "—"} accent="sv-accent" sub={`GP ${(s?.goals_for ?? ps?.goals_for ?? 0).toFixed(0)} · GC ${(s?.goals_against ?? ps?.goals_against ?? 0).toFixed(0)}`} />
          <StatCard label="Ataque (xG/90)" value={xg90 != null ? xg90.toFixed(2) : "—"} accent="sv-accent" sub={`Chutes/90 ${shots90 != null ? shots90.toFixed(1) : "—"}`} />
          <StatCard label="Defesa (xGA/90)" value={xga90 != null ? xga90.toFixed(2) : "—"} accent="sv-danger" sub={`Sofridos/90 ${conceded90 != null ? conceded90.toFixed(2) : "—"}`} />
        </div>
        {profile ? (
          <p className="text-[11.5px] text-sv-muted">
            xG e zonas calculados dos chutes reais da Understat · {profile.sample?.matches ?? 0} jogos{seasonLabel ? ` · ${seasonLabel}` : ""}
            {ps?.xg_diff_per_90 != null ? ` · saldo de xG ${ps.xg_diff_per_90 > 0 ? "+" : ""}${ps.xg_diff_per_90.toFixed(2)}/jogo` : ""}
          </p>
        ) : profileQ.isPending ? null : (
          <p className="text-[11.5px] text-sv-muted">
            Sem chutes da Understat para este time ainda. Sincronize a liga na aba Understat para liberar xG, zonas e gols por jogador.
          </p>
        )}
      </div>

      <section className="sv-card" aria-label="Defesa coletiva e goleiros">
        <div className="sv-card-inner">
          <SectionTitle
            title="Defesa coletiva e goleiros"
            hint={defensiveStatsQ.data?.available
              ? [
                defensiveStatsQ.data.competition_code,
                defensiveStatsQ.data.season_name,
                `${defensiveStatsQ.data.matches_with_stats} jogos com estatísticas coletivas`,
              ].filter(Boolean).join(" · ")
              : "Dados reais de defesa e goleiros, quando disponíveis no banco"}
          />
          {defensiveStatsQ.isPending ? (
            <div className="sv-card h-36 skeleton" />
          ) : defensiveStatsQ.isError ? (
            <p className="text-sm text-sv-danger" role="alert">
              Não foi possível carregar as estatísticas defensivas.
            </p>
          ) : !defensiveStatsQ.data.available ? (
            <EmptyState
              title="Dados defensivos indisponíveis"
              description="Ainda não há estatísticas coletivas ou de goleiros importadas para este time e temporada."
            />
          ) : (
            <div className="space-y-5">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {DEFENSIVE_METRICS.map(({ key, label }) => {
                  const metric = defensiveStatsQ.data.metrics[key];
                  return (
                    <div key={key} className="rounded-lg border border-sv-border/60 bg-sv-panel2/50 p-3">
                      <div className="sv-stat-k">{label}</div>
                      <div className="mt-1 text-xl font-semibold font-mono">
                        {formatDefensiveValue(metric.per_match)}
                      </div>
                      <div className="mt-1 text-[11px] text-sv-muted">
                        por jogo · {metric.matches} jogos
                        {metric.sources.length > 0 ? ` · ${metric.sources.join(", ")}` : ""}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div>
                <h3 className="text-sm font-semibold mb-2">Goleiros</h3>
                {defensiveStatsQ.data.goalkeepers.length === 0 ? (
                  <p className="text-sm text-sv-muted">Sem estatísticas individuais de goleiros disponíveis.</p>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[480px] text-sm">
                        <thead className="text-sv-muted text-xs">
                          <tr className="border-b border-sv-border">
                            <th className="text-left py-2 font-medium">Jogador</th>
                            <th className="text-right py-2 font-medium">J</th>
                            <th className="text-right py-2 font-medium">Defesas</th>
                            <th className="text-right py-2 font-medium">Gols sofridos</th>
                            <th className="text-right py-2 font-medium">Chutes enfrentados</th>
                          </tr>
                        </thead>
                        <tbody>
                          {defensiveStatsQ.data.goalkeepers.map((goalkeeper) => (
                            <tr key={goalkeeper.player_id} className="border-b border-sv-border/40 last:border-0">
                              <td className="py-2 font-medium">
                                <div>{goalkeeper.name}</div>
                                {goalkeeper.sources.length > 0 && (
                                  <div className="text-[10px] font-normal text-sv-muted">
                                    {goalkeeper.sources.join(", ")}
                                  </div>
                                )}
                              </td>
                              <td className="text-right font-mono">{goalkeeper.appearances}</td>
                              <td className="text-right font-mono">{formatDefensiveValue(goalkeeper.saves)}</td>
                              <td className="text-right font-mono">{formatDefensiveValue(goalkeeper.goals_conceded)}</td>
                              <td className="text-right font-mono">{formatDefensiveValue(goalkeeper.shots_faced)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="mt-2 text-[11px] text-sv-muted">
                      Valores somados por temporada. Chutes enfrentados = chutes no alvo (defesas + gols sofridos) quando a fonte não informa o número.
                    </p>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Próximos confrontos e resultados recentes — filtrados por este time */}
      <div className="grid lg:grid-cols-2 items-start gap-5">
        <div className="sv-card">
          <div className="sv-card-inner">
            <SectionTitle title="Próximos confrontos" hint="Só jogos deste time" />
            <div className="space-y-2">
              {upcomingQ.isPending ? (
                Array.from({ length: 3 }).map((_, i) => <div key={i} className="sv-card h-14 skeleton" />)
              ) : upcoming.length === 0 ? (
                <EmptyState title="Sem próximos jogos" description="Nenhum confronto futuro encontrado para este time." />
              ) : upcoming.map((m) => <TeamMatchRow key={m.id} m={m} teamId={teamId} />)}
            </div>
          </div>
        </div>
        <div className="sv-card">
          <div className="sv-card-inner">
            <SectionTitle title="Resultados recentes" hint="Últimos jogos deste time" />
            <div className="space-y-2">
              {recentQ.isPending ? (
                Array.from({ length: 3 }).map((_, i) => <div key={i} className="sv-card h-14 skeleton" />)
              ) : recent.length === 0 ? (
                <EmptyState title="Sem resultados" description="Nenhum jogo finalizado encontrado para este time." />
              ) : recent.map((m) => <TeamMatchRow key={m.id} m={m} teamId={teamId} showResult />)}
            </div>
          </div>
        </div>
      </div>

      {/* Classificação da competição + elenco */}
      <div className="grid lg:grid-cols-2 items-start gap-5">
        <div className="sv-card">
          <div className="sv-card-inner">
            <SectionTitle title="Classificação" hint={myStanding ? `Este time: ${myStanding.position}º com ${myStanding.points} pontos` : "Temporada atual"} />
            {(standingsQ.isPending && standingsQ.fetchStatus !== "idle") || (profileQ.isPending && standings.length === 0) ? (
              <div className="sv-card h-40 skeleton" />
            ) : standings.length === 0 ? (
              <EmptyState title="Sem classificação" description="Ainda não há tabela importada para esta temporada." />
            ) : (
              <StandingsTable rows={standings} teamIds={myIds} />
            )}
          </div>
        </div>
        <SquadCard squad={squad} pending={squad.length === 0 && (squadQ.isPending || profileQ.isPending)} season={seasonLabel} />
      </div>

      {/* Forma recente + ranking de fraquezas */}
      <div className="grid lg:grid-cols-2 items-start gap-5">
        <div className="sv-card">
          <div className="sv-card-inner">
            {profile?.matches?.length ? (
              <>
                <SectionTitle title="Forma recente" hint="xG a favor × xG contra nos últimos jogos · passe o mouse para ver o placar" />
                <FormXgChart matches={profile.matches} />
              </>
            ) : (
              <>
                <SectionTitle title="Forma recente" hint="Últimos 5 jogos · 3 = vitória, 1 = empate, 0 = derrota" />
                {formData.length === 0 ? (
                  <EmptyState title="Sem dados de forma" description="Os resultados recentes ainda não foram importados." />
                ) : (
                  <>
                    <div className="h-56">
                      <ResponsiveContainer>
                        <BarChart data={formData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#22314f" />
                          <XAxis dataKey="label" stroke="#8794ad" fontSize={11} />
                          <YAxis stroke="#8794ad" fontSize={11} domain={[0, 3]} ticks={[0, 1, 3]} />
                          <Tooltip contentStyle={{ background: "#111a2b", border: "1px solid #22314f", borderRadius: 8 }} />
                          <Bar dataKey="pts" radius={[6, 6, 0, 0]} fill="#37b486" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex gap-2 mt-3 flex-wrap">
                      {formData.map((d, i) => (
                        <span key={i} className={`sv-pill ${d.label === "V" ? "bg-sv-accent2/20 text-sv-accent3" : d.label === "E" ? "bg-sv-warn/15 text-sv-warn" : "bg-sv-danger/15 text-sv-danger"}`}>{d.label}</span>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
        <div className="sv-card">
          <div className="sv-card-inner">
            <SectionTitle title="Ranking de fraquezas" hint="Maior = mais vulnerável · xG sofrido por zona contra a média da liga" />
            {profileQ.isPending ? (
              <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-8 skeleton rounded-lg" />)}</div>
            ) : (
              <WeaknessRanking ranked={zoneData.ranked as TeamZoneWeakness[]} />
            )}
          </div>
        </div>
      </div>

      <div>
        <SectionTitle
          title="Zonas do time · fraquezas e oportunidades"
          hint="Vermelho = onde o time mais sofre · verde = onde seus jogadores mais criam perigo · clique numa zona para ver os números"
        />
        {profileQ.isPending ? (
          <div className="sv-card h-[420px] skeleton" />
        ) : (
          <TeamZoneMaps
            teamName={t.data?.name ?? "Time"}
            weakness={zoneData.weakness}
            details={zoneData.details}
            entries={zoneData.entries}
          />
        )}
      </div>
    </div>
  );
}


export default function TeamPage() {
  const { id } = useParams();
  const teamId = Number(id);
  if (!Number.isInteger(teamId) || teamId <= 0) {
    return <EmptyState title="Time não encontrado" description="Selecione um time cadastrado no banco de dados." />;
  }
  return <ApiTeamPage teamId={teamId} />;
}