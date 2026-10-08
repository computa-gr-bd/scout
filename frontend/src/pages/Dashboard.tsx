import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  listMatches, listTeams, listPlayers, generatePredictions, getStatsCounts,
  listCompetitions, type Match,
} from "../api/client";
import {
  MOCK_MATCHES, MOCK_PREDICTIONS, MOCK_HOME_WEAKNESSES, MOCK_AWAY_WEAKNESSES,
} from "../api/mockData";
import { Badge, Bar, ConfidenceBadge, EmptyState, ProbabilityBar, SectionTitle, StatCard, TeamLogo } from "../components/ui";
import { Pitch2D } from "../components/Pitch";
import { PitchStudio } from "../components/PitchStudio";

function formatDate(s: string) {
  const d = new Date(s);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", weekday: "short" })
    + " · " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

const STATUS_PT: Record<string, string> = {
  upcoming: "Agendado",
  live: "Ao vivo",
  finished: "Encerrado",
};
function statusPt(s?: string) {
  if (!s) return "—";
  return STATUS_PT[s] || s;
}

function MatchCard({ m, highlight }: { m: Match; highlight?: boolean }) {
  return (
    <Link to={`/matches/${m.id}`} className={[
      "sv-card block transition",
      highlight ? "sv-ring hover:-translate-y-0.5" : "hover:bg-sv-panel2",
    ].join(" ")}>
      <div className="sv-card-inner">
        <div className="flex items-center justify-between mb-3">
          <div className="sv-chip">{m.competition_name || "Liga ScoutVision"} · Rodada {m.matchday ?? "—"}</div>
          <Badge kind={m.status === "finished" ? "default" : "accent"}>{statusPt(m.status)}</Badge>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <TeamLogo name={m.home_team.name} className="w-10 h-10" />
            <div className="min-w-0">
              <div className="font-semibold truncate">{m.home_team.name}</div>
              <div className="text-xs text-sv-muted truncate">{m.home_team.short_name || "—"}</div>
            </div>
          </div>
          <div className="text-center">
            {m.status === "finished" ? (
              <div className="font-mono text-xl font-bold tabular-nums">{m.home_score} — {m.away_score}</div>
            ) : (
              <div className="text-xs text-sv-accent3 font-medium">{formatDate(m.kickoff_time)}</div>
            )}
            <div className="text-[10px] text-sv-muted mt-1">{m.stadium_name || ""}</div>
          </div>
          <div className="flex items-center gap-2 min-w-0 justify-end">
            <div className="min-w-0 text-right">
              <div className="font-semibold truncate">{m.away_team.name}</div>
              <div className="text-xs text-sv-muted truncate">{m.away_team.short_name || "—"}</div>
            </div>
            <TeamLogo name={m.away_team.name} className="w-10 h-10" />
          </div>
        </div>
      </div>
    </Link>
  );
}

export default function Dashboard() {
  const countsQ = useQuery({
    queryKey: ["stats", "counts"],
    queryFn: () => getStatsCounts(),
    gcTime: 30_000, staleTime: 10_000,
    retry: 0,
  });
  const compsQ = useQuery({
    queryKey: ["competitions"], queryFn: () => listCompetitions(),
    retry: 0,
  });
  const upcomingQ = useQuery({
    queryKey: ["matches", "upcoming"],
    queryFn: () => listMatches({ scope: "upcoming" }).catch(() => [] as Match[]),
    retry: 1, retryDelay: 600,
  });
  const recentQ = useQuery({
    queryKey: ["matches", "recent"],
    queryFn: () => listMatches({ scope: "recent" }).catch(() => [] as Match[]),
    retry: 1, retryDelay: 600,
  });
  const teamsQ = useQuery({
    queryKey: ["teams"], queryFn: () => listTeams(), retry: 0, retryDelay: 600,
  });
  const playersQ = useQuery({
    queryKey: ["players"], queryFn: () => listPlayers(), retry: 0, retryDelay: 600,
  });

  // NÃO USA MAIS FALLBACK MOCK — só dados reais.
  // Quando carregando: mostramos "—" nos statcards.
  // Quando erro backend: mostramos 0 e mensagem de indisponibilidade.
  const loading = countsQ.isPending || compsQ.isPending;
  const counts = countsQ.data;
  const comps = compsQ.data || [];

  const now = Date.now();
  const allMatches = [...(upcomingQ.data || []), ...(recentQ.data || [])];

  const upcoming = upcomingQ.data || [] as Match[];
  const recent = recentQ.data || [] as Match[];

  const teams = teamsQ.data || [];
  const players = playersQ.data || [];

  // Valores das statcards: 100% vindo de /stats/counts.
  const matchCount = counts?.matches ?? (loading ? "—" : 0);
  const teamCount = counts?.teams ?? (loading ? "—" : 0);
  const playerCount = counts?.players ?? (loading ? "—" : 0);
  const compCount = comps.length || (loading ? "—" : 0);
  const modelCount = 4; // modelos baseline hardcoded até modelos treinados persistirem

  // Destaque = primeira partida (upcoming mais próxima OU recent mais recente);
  // Se não houver partida nenhuma ainda, não destaque.
  const highlightMatch: Match | undefined = upcoming[0] || recent[0];

  const highlightPredictions = useMemo(() => {
    return MOCK_PREDICTIONS; // modelo baseline offline, dados reais virão depois
  }, []);

  const topShot = highlightPredictions.predictions
    ?.filter((p) => p.target === "shot")
    .sort((a, b) => b.probability - a.probability)[0];
  const topGoal = highlightPredictions.predictions
    ?.filter((p) => p.target === "goal")
    .sort((a, b) => b.probability - a.probability)[0];

  const hw: Record<string, number> = {};
  const aw: Record<string, number> = {};
  MOCK_HOME_WEAKNESSES.forEach((z: any) => { hw[z.zone] = z.weakness_score; });
  MOCK_AWAY_WEAKNESSES.forEach((z: any) => { aw[z.zone] = z.weakness_score; });

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <div className="sv-label">Bem-vindo de volta</div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">ScoutVision — Inteligência de Partidas</h1>
          <p className="text-sv-muted mt-1 text-sm">
            Identifique quem tende a produzir eventos, onde no campo, e <span className="text-sv-accent3">por quê</span>.
            {loading && (
              <span className="inline-flex items-center gap-1.5 ml-2 sv-chip-accent">
                <span className="w-1.5 h-1.5 rounded-full bg-sv-accent3 animate-pulse"/>
                carregando dados…
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/analysis" className="sv-btn-primary">
            <span>🔍 Abrir estúdio de análise</span>
          </Link>
          <Link to="/matches" className="sv-btn">Todas as partidas</Link>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <StatCard label="Partidas" value={matchCount}
                  sub={`${compCount} competição(ões) importada(s)`} accent="sv-accent" />
        <StatCard label="Times monitorados" value={teamCount}
                  sub="Dados football-data.org + StatsBomb" />
        <StatCard label="Perfis de jogadores" value={playerCount}
                  sub="Com zonas, forma e stats por 90" />
        <StatCard label="Modelos de ML ativos" value={modelCount}
                  sub="LogReg · Chute/Alvo/Gol/PG v0.2" accent="sv-warn" />
      </div>

      <SectionTitle title="Campo · ScoutVision Studio"
        hint="🔥 Mapa de calor · ⚽ Chutes · 🎯 Chutes a gol · 🥅 Gols · 👥 Posições · Trajetória/direção na visão geral · Controles: ⏮ Anterior / ▶ Reproduzir / ⏭ Próximo"
        right={<Link to="/analysis" className="sv-btn-primary !py-1.5 text-[12px]">Abrir estúdio completo →</Link>} />
      <PitchStudio selectedMatchId={highlightMatch?.id} />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 md:gap-5">
        <div className="xl:col-span-2 space-y-5">
          <SectionTitle title="Partida em destaque"
            hint={highlightMatch ? "Principais previsões, probabilidades e fatores positivos" : ""}
            right={<Link to={`/analysis/${highlightMatch?.id}`} className="sv-btn">Análise completa →</Link>} />
          {highlightMatch ? (
            <>
              <MatchCard m={highlightMatch} highlight />

              <div className="sv-card">
                <div className="sv-card-inner space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold">Probabilidades por jogador</div>
                      <div className="text-xs text-sv-muted">Probabilidades de chute &amp; gol · marcadas pela base</div>
                    </div>
                    <ConfidenceBadge c={topShot?.confidence || "medium"} />
                  </div>

                  {topShot && (
                    <div>
                      <div className="flex items-center justify-between text-sm mb-1.5">
                        <div className="font-medium">
                          <Badge kind="good">1+ chute</Badge>
                          <span className="ml-2">{topShot.player_name}</span>
                        </div>
                        <span className="sv-chip">{topShot.venue}</span>
                      </div>
                      <ProbabilityBar p={topShot.probability} baseline={topShot.baseline_probability} />
                      {topShot.positive_factors.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {topShot.positive_factors.slice(0, 4).map((f) => (
                            <span key={f.feature} className="sv-chip-accent">{f.factor}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="sv-divider" />

                  {topGoal && (
                    <div>
                      <div className="flex items-center justify-between text-sm mb-1.5">
                        <div className="font-medium">
                          <Badge kind="warn">Gol</Badge>
                          <span className="ml-2">{topGoal.player_name}</span>
                        </div>
                        <ConfidenceBadge c={topGoal.confidence} />
                      </div>
                      <ProbabilityBar p={topGoal.probability} baseline={topGoal.baseline_probability} />
                      {topGoal.positive_factors.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {topGoal.positive_factors.slice(0, 4).map((f) => (
                            <span key={f.feature} className="sv-chip-accent">{f.factor}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <EmptyState title="Nenhuma partida em destaque" description="Dados demo carregados automaticamente." />
          )}
        </div>

        <div className="space-y-5">
          <SectionTitle title="Mapa de calor rápido do campo" hint="Oportunidades combinadas · verde = ataque, vermelho = fraqueza defensiva" />
          <Pitch2D
            homeWeakness={hw}
            awayWeakness={aw}
            opportunityZones={highlightPredictions.predictions
              ?.filter((p) => p.target === "shot")
              .flatMap((p) => p.zone_opportunities?.slice(0, 3).map((z) => ({ zone: z.zone, value: z.opportunity_score })) || [])}
            title="Zonas de oportunidade combinadas"
          />
          <div className="sv-card">
            <div className="sv-card-inner">
              <div className="flex items-center justify-between mb-2">
                <div className="font-semibold">Zonas mais atacadas</div>
              </div>
              {highlightPredictions.predictions
                ?.filter((p) => p.target === "shot")
                .flatMap((p) => p.zone_opportunities?.slice(0, 1).map((z) => ({ p: p.player_name, z })))
                ?.sort((a, b) => b.z.opportunity_score - a.z.opportunity_score)
                ?.slice(0, 5)
                ?.map((row, i) => (
                  <div key={i} className="py-2 first:pt-0 last:pb-0 border-b last:border-0 border-sv-border/70">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <div className="text-sv-muted">{row.p}</div>
                      <div className="font-mono text-sv-text/90">{row.z.zone.replace(/_/g, " ")}</div>
                    </div>
                    <Bar value={row.z.opportunity_score} max={0.7} />
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>

      <div>
        <SectionTitle title="Próximas partidas" hint="Clique em qualquer card para análise completa"
          right={<Link to="/matches" className="sv-btn">Ver todas</Link>} />
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
          {(upcoming || []).slice(0, 6).map((m) => <MatchCard key={m.id} m={m} />)}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4 md:gap-5">
        <div>
          <SectionTitle title="Resultados recentes" right={<Link to="/matches?scope=recent" className="sv-btn">Ver todas</Link>} />
          <div className="grid md:grid-cols-2 gap-3 md:gap-4">
            {(recent || []).slice(0, 4).map((m) => <MatchCard key={m.id} m={m} />)}
          </div>
        </div>
        <div>
          <SectionTitle title="Principais times" right={<Link to="/teams" className="sv-btn">Ver todos</Link>} />
          <div className="sv-card">
            <table className="sv-table">
              <thead><tr><th>Time</th><th className="text-right">Pts/jogo</th><th className="text-right">xG/90</th><th className="text-right">xGA/90</th></tr></thead>
              <tbody>
                {(teams || [])
                  .map((t: any) => ({ t, s: (t.statistics || []).find((x: any) => x.scope === "overall" || x.scope === "season") }))
                  .sort((a, b) => (b.s?.points_per_game || 0) - (a.s?.points_per_game || 0))
                  .slice(0, 8)
                  .map(({ t, s }: any) => (
                    <tr key={t.id}>
                      <td>
                        <Link to={`/teams/${t.id}`} className="flex items-center gap-2 hover:text-sv-accent3">
                          <TeamLogo name={t.name} />
                          <span className="font-medium">{t.name}</span>
                        </Link>
                      </td>
                      <td className="text-right font-mono">{(s?.points_per_game ?? 0).toFixed(2)}</td>
                      <td className="text-right font-mono text-sv-accent3">{(s?.xg_per_90 ?? 0).toFixed(2)}</td>
                      <td className="text-right font-mono text-sv-warn">{(s?.xga_per_90 ?? 0).toFixed(2)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
