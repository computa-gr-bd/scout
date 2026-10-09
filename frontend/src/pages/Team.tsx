import { useParams, Link } from "react-router-dom";
import MockTeamDetail from "./TeamMock";
import { MOCK_TEAMS } from "../api/teamsData";
import { useQuery } from "@tanstack/react-query";
import {
  getTeam, getTeamStatistics, getTeamWeaknesses, listMatches, listPlayers, getStandings,
  type DefensiveWeakness, type Match, type Player, type StandingRow,
} from "../api/client";
import { Badge, EmptyState, ProbabilityBar, SectionTitle, StatCard, TeamLogo } from "../components/ui";
import { Pitch2D } from "../components/Pitch";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

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
    <Link to={`/matches/${m.id}`} className="sv-card block hover:bg-sv-panel2 transition">
      <div className="px-4 py-2.5 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
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

/** Agrupa o elenco por linha (football-data: Goalkeeper/Defender/Midfielder/Attacker). */
const SQUAD_GROUPS = [
  { key: "goleiros", label: "Goleiros", match: (p: string) => p.includes("GOAL") || p === "GK" },
  { key: "defensores", label: "Defensores", match: (p: string) => p.includes("DEF") || p === "DF" },
  { key: "meio", label: "Meio-campistas", match: (p: string) => p.includes("MID") || p === "MF" },
  { key: "atacantes", label: "Atacantes", match: () => true },
];

function SquadRow({ p }: { p: Player }) {
  const s = p.statistics.find((x) => x.scope === "overall");
  const name = p.display_name || `${p.first_name || ""} ${p.last_name}`.trim();
  const initials = name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className="flex items-center gap-3 py-2 border-b border-sv-border/40 last:border-0">
      <div className="w-8 h-8 shrink-0 rounded-full bg-sv-panel2 grid place-items-center text-[11px] font-semibold border border-sv-border">
        {initials}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{name}</div>
        <div className="text-[11px] text-sv-muted">
          {p.position || "—"}{p.date_of_birth ? ` · ${new Date(p.date_of_birth).getFullYear()}` : ""}
        </div>
      </div>
      <div className="flex gap-3 text-xs font-mono text-right shrink-0">
        <div><div className="sv-stat-k">J</div><div>{s?.matches_played ?? 0}</div></div>
        <div><div className="sv-stat-k">G</div><div className="text-sv-accent3">{s?.goals ?? 0}</div></div>
        <div><div className="sv-stat-k">A</div><div>{s?.assists ?? 0}</div></div>
      </div>
    </div>
  );
}

/** Tabela da competição do time, com a linha do próprio time destacada. */
function StandingsTable({ rows, teamId }: { rows: StandingRow[]; teamId: number }) {
  const sorted = [...rows].sort((a, b) => a.position - b.position);
  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full text-sm">
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
            const mine = r.team_id === teamId;
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


/** Página de time da API (ids reais do backend). */
function ApiTeamPage({ teamId }: { teamId: number }) {
  const t = useQuery({ queryKey: ["team", teamId], queryFn: () => getTeam(teamId) });
  const stats = useQuery({ queryKey: ["team-stats", teamId], queryFn: () => getTeamStatistics(teamId) });
  const weaknesses = useQuery({ queryKey: ["team-weaknesses", teamId], queryFn: () => getTeamWeaknesses(teamId) });
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
  const seasonId = s?.season_id ?? null;
  const standingsQ = useQuery({
    queryKey: ["standings", seasonId],
    queryFn: () => getStandings(seasonId!),
    enabled: seasonId != null,
    retry: 1, retryDelay: 600,
  });

  // Forma recente derivada dos resultados reais (a football-data não preenche
  // recent_form, então o gráfico antigo ficava sempre vazio).
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

  const weaknessMap: Record<string, number> = {};
  (weaknesses.data || []).forEach((w) => { weaknessMap[w.zone] = w.weakness_score; });

  const squad = squadQ.data || [];
  const upcoming = upcomingQ.data || [];
  const recent = recentQ.data || [];
  const standings = standingsQ.data || [];
  const myStanding = standings.find((r) => r.team_id === teamId);

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
                  <Badge kind="accent">{t.data.country || "DemoLand"}</Badge>
                  {myStanding && <Badge kind="warn">{myStanding.position}º · {myStanding.points} pts</Badge>}
                </div>
                <div className="text-sm text-sv-muted mt-1">Fundado em {t.data.founded || "—"} · Estádio: {(t.data as any).stadium?.name || "—"} ({(t.data as any).stadium?.capacity || "—"})</div>
              </div>
              <div className="flex gap-2">
                <Link to="/matches" className="sv-btn">Jogos</Link>
                <Link to={`/analysis?team=${teamId}`} className="sv-btn-primary">Analisar</Link>
              </div>
            </div>
          </div>
        </>
      ) : <EmptyState title="Carregando time" />}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <StatCard label="Partidas jogadas" value={s?.matches_played ?? "—"} sub={`${s?.wins ?? 0}V ${s?.draws ?? 0}E ${s?.losses ?? 0}D`} />
        <StatCard label="Pontos por jogo" value={s ? s.points_per_game.toFixed(2) : "—"} accent="sv-accent" sub={`GP ${(s?.goals_for ?? 0).toFixed(0)} · GC ${(s?.goals_against ?? 0).toFixed(0)}`} />
        <StatCard label="Ataque (xG/90)" value={s ? s.xg_per_90.toFixed(2) : "—"} accent="sv-accent" sub={`Chutes/90 ${(s?.shots_per_90 ?? 0).toFixed(1)}`} />
        <StatCard label="Defesa (xGA/90)" value={s ? s.xga_per_90.toFixed(2) : "—"} accent="sv-danger" sub={`Sofridos/90 ${(s?.goals_conceded_per_90 ?? 0).toFixed(2)}`} />
      </div>

      {/* Próximos confrontos e resultados recentes — filtrados por este time */}
      <div className="grid lg:grid-cols-2 gap-5">
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
      <div className="grid lg:grid-cols-2 gap-5">
        <div className="sv-card">
          <div className="sv-card-inner">
            <SectionTitle title="Classificação" hint={myStanding ? `Este time: ${myStanding.position}º com ${myStanding.points} pontos` : "Temporada atual"} />
            {standingsQ.isPending ? (
              <div className="sv-card h-40 skeleton" />
            ) : standings.length === 0 ? (
              <EmptyState title="Sem classificação" description="Ainda não há tabela importada para esta temporada." />
            ) : (
              <StandingsTable rows={standings} teamId={teamId} />
            )}
          </div>
        </div>
        <div className="sv-card">
          <div className="sv-card-inner">
            <SectionTitle title="Elenco" hint={`${squad.length} atletas · jogos, gols e assistências`} />
            {squadQ.isPending ? (
              <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="sv-card h-12 skeleton" />)}</div>
            ) : squad.length === 0 ? (
              <EmptyState title="Elenco em breve" description="Rode a coleta da liga deste time para importar o elenco." />
            ) : (
              <div className="max-h-96 overflow-auto pr-1">
                {SQUAD_GROUPS.map((g) => {
                  const group = squad.filter((p) => g.match((p.position || "").toUpperCase()));
                  if (!group.length) return null;
                  return (
                    <div key={g.key} className="mb-3">
                      <div className="sv-label mb-1">{g.label}</div>
                      {group.map((p) => <SquadRow key={p.id} p={p} />)}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Forma recente + fraquezas defensivas */}
      <div className="grid lg:grid-cols-2 gap-5">
        <div className="sv-card">
          <div className="sv-card-inner">
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
                <div className="flex gap-2 mt-3">
                  {formData.map((d, i) => (
                    <span key={i} className={`sv-pill ${d.label === "V" ? "bg-sv-accent2/20 text-sv-accent3" : d.label === "E" ? "bg-sv-warn/15 text-sv-warn" : "bg-sv-danger/15 text-sv-danger"}`}>{d.label}</span>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
        <div className="sv-card">
          <div className="sv-card-inner">
            <SectionTitle title="Ranking de fraquezas" hint="Maior = mais vulnerável" />
            <div className="space-y-2.5">
              {([...(weaknesses.data || [])] as DefensiveWeakness[])
                .sort((a, b) => b.weakness_score - a.weakness_score)
                .map((w, i) => (
                  <div key={w.id}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <div className="flex items-center gap-2">
                        <span className="sv-chip">#{i + 1}</span>
                        <span className="font-medium capitalize">{(w.zone as string).replace(/_/g, " ")}</span>
                      </div>
                      <div className="text-sv-muted">
                        amostra {w.sample_size} · xGA {(w.xga_per_90).toFixed(2)} · gols {(w.goals_conceded_per_90).toFixed(2)}
                      </div>
                    </div>
                    <ProbabilityBar p={Math.min(1, w.weakness_score)} />
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>

      <div>
        <SectionTitle title="Fraquezas defensivas por zona" hint="Zonas onde o time sofre mais chutes, xG e gols" />
        <Pitch2D
          awayWeakness={weaknessMap}
          title="Mapa de calor defensivo do time, na perspectiva do adversário (lado direito)"
        />
      </div>
    </div>
  );
}


/**
 * Rota `/teams/:id` — ids mockados (≥1001, ex.: Bayern) renderizam a página
 * mock com elenco/classificação/estatísticas; ids da API seguem para a
 * página com dados reais do backend.
 */
export default function TeamPage() {
  const { id } = useParams();
  const teamId = Number(id);
  const mockTeam = MOCK_TEAMS.find((t) => t.id === teamId);
  if (mockTeam) return <MockTeamDetail team={mockTeam} />;
  return <ApiTeamPage teamId={teamId} />;
}

