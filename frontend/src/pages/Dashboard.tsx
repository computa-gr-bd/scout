import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  listMatches, listTeams, listPlayers, getStatsCounts,
  listCompetitions, getDataStatus, type Match,
} from "../api/client";
import { Badge, EmptyState, SectionTitle, StatCard, TeamLogo } from "../components/ui";
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
  const dataStatusQ = useQuery({
    queryKey: ["data", "status"], queryFn: getDataStatus,
    staleTime: 60_000, retry: 0,
  });
  const upcomingQ = useQuery({
    queryKey: ["matches", "upcoming"],
    queryFn: () => listMatches({ scope: "upcoming" }),
    retry: 1, retryDelay: 600,
  });
  const recentQ = useQuery({
    queryKey: ["matches", "recent"],
    queryFn: () => listMatches({ scope: "recent" }),
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

  const upcoming = upcomingQ.data || [] as Match[];
  const recent = recentQ.data || [] as Match[];
  const highlightMatch: Match | undefined = upcoming[0] || recent[0];

  const teams = teamsQ.data || [];
  const players = playersQ.data || [];

  // Valores das statcards: 100% vindo de /stats/counts.
  const unavailable = "Indisponível";
  const matchCount = counts?.matches ?? (countsQ.isError ? unavailable : loading ? "—" : 0);
  const teamCount = counts?.teams ?? (countsQ.isError ? unavailable : loading ? "—" : 0);
  const playerCount = counts?.players ?? (countsQ.isError ? unavailable : loading ? "—" : 0);
  const compCount = comps.length || (compsQ.isError ? unavailable : loading ? "—" : 0);
  const modelCount = counts?.model_versions ?? (countsQ.isError ? unavailable : loading ? "—" : 0);

  const lastCollection = dataStatusQ.data?.competitions
    .map((item) => item.last_success_at)
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1);
  const scheduledCollections = dataStatusQ.data?.competitions
    .filter((item) => item.provider === "football_data") ?? [];
  const collectionIsStale = !scheduledCollections.length
    || scheduledCollections.some((item) => item.is_stale || item.status !== "success");

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <div className="sv-label">Bem-vindo de volta</div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">ScoutVision — dados e análise de futebol</h1>
          <p className="text-sv-muted mt-1 text-sm">
            Consulte partidas, resultados, clubes e classificações das competições disponíveis.
            {loading && (
              <span className="inline-flex items-center gap-1.5 ml-2 sv-chip-accent">
                <span className="w-1.5 h-1.5 rounded-full bg-sv-accent3 animate-pulse"/>
                carregando dados…
              </span>
            )}
          </p>
          <p className={`mt-1 text-xs ${collectionIsStale ? "text-sv-warn" : "text-sv-muted"}`}>
            {dataStatusQ.isError
              ? "Status da coleta indisponível"
              : lastCollection
              ? `Última coleta: ${new Date(lastCollection).toLocaleString("pt-BR")}${collectionIsStale ? " · dados podem estar desatualizados" : ""}`
              : dataStatusQ.isPending
              ? "Consultando a última coleta…"
              : "Nenhuma coleta registrada pela API"}
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
        <StatCard label="Times cadastrados" value={teamCount}
                  sub="Clubes recebidos das fontes conectadas" />
        <StatCard label="Atletas cadastrados" value={playerCount}
                  sub="Cadastro do elenco; estatísticas individuais podem não existir" />
        <StatCard label="Versões no banco" value={modelCount}
                  sub="Baselines experimentais não entram nesta contagem" accent="sv-warn" />
      </div>

      <SectionTitle title="Campo · ScoutVision Studio"
        hint="Demonstração visual com lances simulados; não representa dados de uma partida real."
        right={<Link to="/analysis" className="sv-btn-primary !py-1.5 text-[12px]">Abrir estúdio completo →</Link>} />
      <PitchStudio />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 md:gap-5">
        <div className="xl:col-span-2 space-y-5">
          <SectionTitle title="Partida em destaque"
            hint={highlightMatch ? "Partida mais próxima disponível na API" : ""}
            right={highlightMatch
              ? <Link to={`/analysis/${highlightMatch.id}`} className="sv-btn">Análise completa →</Link>
              : undefined} />
          {highlightMatch ? (
            <>
              <MatchCard m={highlightMatch} highlight />
              <EmptyState title="Previsões atuais indisponíveis"
                description="A coleta de fixtures e classificação não inclui estatísticas de eventos por jogador para sustentar probabilidades reais." />
            </>
          ) : (
            <EmptyState
              title={upcomingQ.isError || recentQ.isError ? "Não foi possível consultar as partidas" : "Nenhuma partida em destaque"}
              description={upcomingQ.isError || recentQ.isError
                ? "A API está indisponível. Confira a conexão e tente novamente."
                : "A API ainda não retornou partidas para as competições sincronizadas."} />
          )}
        </div>

        <div className="space-y-5">
          <SectionTitle title="Análise por zonas" hint="Requer eventos reais de partidas" />
          <EmptyState title="Dados de eventos não disponíveis"
            description="O provedor atual entrega jogos e classificação, mas não fornece play-by-play, xG ou ações por jogador." />
        </div>
      </div>

      <div>
        <SectionTitle title="Próximas partidas" hint="Clique em qualquer card para análise completa"
          right={<Link to="/matches" className="sv-btn">Ver todas</Link>} />
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
          {upcomingQ.isError
            ? <EmptyState title="Falha ao carregar próximas partidas" description="Confira a conexão com a API." />
            : upcoming.length
              ? upcoming.slice(0, 6).map((m) => <MatchCard key={m.id} m={m} />)
              : <EmptyState title="Nenhuma próxima partida sincronizada" />}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4 md:gap-5">
        <div>
          <SectionTitle title="Resultados recentes" right={<Link to="/matches?scope=recent" className="sv-btn">Ver todas</Link>} />
          <div className="grid md:grid-cols-2 gap-3 md:gap-4">
            {recentQ.isError
              ? <EmptyState title="Falha ao carregar resultados recentes" description="Confira a conexão com a API." />
              : recent.length
                ? recent.slice(0, 4).map((m) => <MatchCard key={m.id} m={m} />)
                : <EmptyState title="Nenhum resultado sincronizado" />}
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
                      <td className="text-right font-mono text-sv-accent3">{s?.xg_per_90 != null ? s.xg_per_90.toFixed(2) : "—"}</td>
                      <td className="text-right font-mono text-sv-warn">{s?.xga_per_90 != null ? s.xga_per_90.toFixed(2) : "—"}</td>
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
