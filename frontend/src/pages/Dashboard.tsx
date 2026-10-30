import { useMemo, useState } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  listMatches, getMatch, getMatchStudio, getStatsCounts, listCompetitions, getDataStatus,
  listUnderstatLeagues, listUnderstatMatches, getUnderstatLeagueTable,
  type Match, type MatchStudioPayload, type StudioApiShot, type UnderstatTableRow,
} from "../api/client";
import { payloadToDataset } from "../api/studioReal";
import { Badge, EmptyState, SectionTitle, StatCard, TeamLogo } from "../components/ui";
import { PitchStudio } from "../components/PitchStudio";
import { MaterialIcon } from "../components/MaterialIcon";

const HOME_COLOR = "#4f7cff";
const AWAY_COLOR = "#e1534e";

function formatDate(s: string) {
  const d = new Date(s);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", weekday: "short" })
    + " · " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

const STATUS_PT: Record<string, string> = {
  upcoming: "Agendado",
  scheduled: "Agendado",
  timed: "Agendado",
  live: "Ao vivo",
  in_play: "Ao vivo",
  finished: "Encerrado",
};
function statusPt(s?: string) {
  if (!s) return "—";
  return STATUS_PT[s.toLowerCase()] || s;
}

/** "Serie A · Rodada 9" — a rodada só aparece quando a fonte informa (Understat não informa). */
function roundLabel(m: Match) {
  const comp = m.competition_name || "Liga ScoutVision";
  return m.matchday ? `${comp} · Rodada ${m.matchday}` : comp;
}

function MatchCard({ m, highlight }: { m: Match; highlight?: boolean }) {
  // Abreviação só quando acrescenta algo (evita "Frosinone / Frosinone").
  const sub = (t: Match["home_team"]) => (t.short_name && t.short_name !== t.name ? t.short_name : "");
  return (
    <Link to={`/analysis/${m.id}`} className={[
      "sv-card block transition",
      highlight ? "sv-ring hover:-translate-y-0.5" : "hover:bg-sv-panel2",
    ].join(" ")}>
      <div className="sv-card-inner">
        <div className="flex items-center justify-between mb-3">
          <div className="sv-chip">{roundLabel(m)}</div>
          <Badge kind={m.status === "finished" ? "default" : "accent"}>{statusPt(m.status)}</Badge>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <TeamLogo name={m.home_team.name} src={m.home_team.logo_url} className="w-8 h-8 sm:w-10 sm:h-10 shrink-0" />
            <div className="min-w-0">
              <div className="font-semibold text-[13px] sm:text-sm truncate">{m.home_team.name}</div>
              <div className="text-[11px] sm:text-xs text-sv-muted truncate">{sub(m.home_team)}</div>
            </div>
          </div>
          <div className="text-center min-w-0">
            {m.status === "finished" ? (
              <div className="font-mono text-lg sm:text-xl font-bold tabular-nums">{m.home_score} — {m.away_score}</div>
            ) : (
              <div className="text-[11px] sm:text-xs text-sv-accent3 font-medium">{formatDate(m.kickoff_time)}</div>
            )}
            <div className="text-[10px] text-sv-muted mt-1 truncate max-w-[120px]">
              {m.status === "finished" ? new Date(m.kickoff_time).toLocaleDateString("pt-BR") : (m.stadium_name || "")}
            </div>
          </div>
          <div className="flex items-center gap-2 min-w-0 justify-end">
            <div className="min-w-0 text-right">
              <div className="font-semibold text-[13px] sm:text-sm truncate">{m.away_team.name}</div>
              <div className="text-[11px] sm:text-xs text-sv-muted truncate">{sub(m.away_team)}</div>
            </div>
            <TeamLogo name={m.away_team.name} src={m.away_team.logo_url} className="w-8 h-8 sm:w-10 sm:h-10 shrink-0" />
          </div>
        </div>
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------- Resumo e zonas (dados reais dos chutes)

type Zone = "small" | "box" | "outside";
const ZONE_LABEL: Record<Zone, string> = {
  small: "Pequena área",
  box: "Grande área",
  outside: "Fora da área",
};

/** Zona do chute pela distância ao gol atacado (campo 105×68 m; x/y em 0–100 já orientados por time). */
function shotZone(s: StudioApiShot): Zone {
  const distance = (s.team === "home" ? 100 - s.x : s.x) * 1.05;
  const lateral = Math.abs(s.y - 50) * 0.68;
  if (distance <= 5.5 && lateral <= 9.16) return "small";
  if (distance <= 16.5 && lateral <= 20.16) return "box";
  return "outside";
}

function teamTotals(shots: StudioApiShot[], team: "home" | "away") {
  const own = shots.filter((s) => s.team === team);
  return {
    shots: own.length,
    onTarget: own.filter((s) => s.on_target === true || s.result === "goal" || s.result === "saved").length,
    goals: own.filter((s) => s.result === "goal").length,
    xg: own.reduce((acc, s) => acc + (s.xg ?? 0), 0),
    own,
  };
}

function MatchSummary({ payload, match }: { payload: MatchStudioPayload; match: Match }) {
  const home = teamTotals(payload.shots, "home");
  const away = teamTotals(payload.shots, "away");
  const rows: Array<[string, string, string]> = [
    ["Gols", String(match.status === "finished" ? match.home_score : home.goals), String(match.status === "finished" ? match.away_score : away.goals)],
    ["xG", home.xg.toFixed(2), away.xg.toFixed(2)],
    ["Chutes", String(home.shots), String(away.shots)],
    ["No alvo", String(home.onTarget), String(away.onTarget)],
  ];
  return (
    <div className="sv-card">
      <div className="sv-card-inner">
        <div className="text-sm font-semibold mb-3">Resumo da partida</div>
        <div className="grid grid-cols-[1fr_auto_1fr] gap-y-2 items-center text-sm">
          <div className="font-semibold truncate" style={{ color: HOME_COLOR }}>{match.home_team.name}</div>
          <div />
          <div className="font-semibold truncate text-right" style={{ color: AWAY_COLOR }}>{match.away_team.name}</div>
          {rows.map(([label, h, a]) => (
            <div key={label} className="contents">
              <div className="font-mono tabular-nums text-base">{h}</div>
              <div className="text-xs text-sv-muted px-3 text-center">{label}</div>
              <div className="font-mono tabular-nums text-base text-right">{a}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 text-[11px] text-sv-muted">
          Calculado a partir dos {payload.shots.length} chutes reais da partida.
        </div>
      </div>
    </div>
  );
}

function ZoneBreakdown({ payload }: { payload: MatchStudioPayload }) {
  const zones: Zone[] = ["small", "box", "outside"];
  const data = zones.map((zone) => {
    const inZone = (team: "home" | "away") => payload.shots.filter((s) => s.team === team && shotZone(s) === zone);
    const h = inZone("home");
    const a = inZone("away");
    return {
      zone,
      home: { n: h.length, xg: h.reduce((acc, s) => acc + (s.xg ?? 0), 0) },
      away: { n: a.length, xg: a.reduce((acc, s) => acc + (s.xg ?? 0), 0) },
    };
  });
  const max = Math.max(1, ...data.flatMap((d) => [d.home.n, d.away.n]));
  return (
    <div className="sv-card">
      <div className="sv-card-inner space-y-4">
        {data.map((d) => (
          <div key={d.zone}>
            <div className="text-xs font-semibold mb-1.5">{ZONE_LABEL[d.zone]}</div>
            {([["home", HOME_COLOR, d.home], ["away", AWAY_COLOR, d.away]] as const).map(([side, color, v]) => (
              <div key={side} className="flex items-center gap-2 mb-1">
                <div className="h-2 rounded-full" style={{ width: `${Math.max(v.n ? 6 : 0, (v.n / max) * 100)}%`, background: color, opacity: 0.85 }} />
                <div className="text-[11px] text-sv-muted whitespace-nowrap font-mono tabular-nums">
                  {v.n} · xG {v.xg.toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        ))}
        <div className="text-[11px] text-sv-muted">Posição dos chutes reais (Understat), sem simulação.</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Página

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
  // Mesma regra da tela de Análise: jogos passados só do Understat; futuros de qualquer fonte, sem duplicatas.
  const upcomingQ = useQuery({
    queryKey: ["matches-analysis", "upcoming", "home"],
    queryFn: () => listMatches({ scope: "upcoming", analysis: true, limit: 12 }),
    retry: 1, retryDelay: 600,
  });
  const recentQ = useQuery({
    queryKey: ["matches-analysis", "recent", "home"],
    queryFn: () => listMatches({ scope: "recent", analysis: true, limit: 12 }),
    retry: 1, retryDelay: 600,
  });

  const upcoming = upcomingQ.data || ([] as Match[]);
  const recent = recentQ.data || ([] as Match[]);

  // ---- Partida em destaque: sorteada entre as já disputadas que têm chutes (lances reais no estúdio).
  const poolQ = useQuery({
    queryKey: ["understat", "matches", "home-pool"],
    queryFn: () => listUnderstatMatches({ finished_only: true, limit: 120 }),
    staleTime: 5 * 60_000, retry: 0,
  });
  const pool = useMemo(() => (poolQ.data ?? []).filter((m) => m.has_shots), [poolQ.data]);
  const [seed, setSeed] = useState(() => Math.random());
  const pickedId = pool.length ? pool[Math.floor(seed * pool.length) % pool.length].id : undefined;
  const fallbackMatch: Match | undefined = upcoming[0] || recent[0];
  const featuredId = pickedId ?? fallbackMatch?.id;
  const isRandomPick = pickedId != null;

  const featuredQ = useQuery({
    queryKey: ["match-by-id", featuredId],
    enabled: featuredId != null,
    queryFn: () => getMatch(featuredId!) as Promise<Match>,
    staleTime: 5 * 60_000, retry: 1,
  });
  const highlightMatch: Match | undefined = featuredQ.data
    ?? (fallbackMatch && fallbackMatch.id === featuredId ? fallbackMatch : undefined);

  const studioQ = useQuery({
    queryKey: ["match-studio", featuredId],
    enabled: featuredId != null,
    queryFn: () => getMatchStudio(featuredId!),
    staleTime: 5 * 60_000, retry: 1,
  });
  const studioDataset = useMemo(
    () => (studioQ.data ? payloadToDataset(studioQ.data) : null),
    [studioQ.data],
  );
  const hasShots = !!studioQ.data && studioQ.data.shots.length > 0;

  // ---- Principais times: tabelas reais do Understat (todas as ligas sincronizadas).
  const leaguesQ = useQuery({
    queryKey: ["understat", "leagues"], queryFn: listUnderstatLeagues,
    staleTime: 5 * 60_000, retry: 0,
  });
  const syncedLeagues = useMemo(
    () => (leaguesQ.data?.leagues ?? []).filter((l) => l.synced && l.seasons.length > 0),
    [leaguesQ.data],
  );
  const tableQs = useQueries({
    queries: syncedLeagues.map((l) => {
      const season = l.seasons.find((s) => s.current) ?? l.seasons[0];
      return {
        queryKey: ["understat", "league-table", l.key, season?.id],
        queryFn: () => getUnderstatLeagueTable(l.key, season?.id),
        staleTime: 5 * 60_000, retry: 0,
      };
    }),
  });
  const topTeams = useMemo(() => {
    const rows: Array<UnderstatTableRow & { league: string }> = [];
    tableQs.forEach((q, i) => {
      for (const r of q.data?.table ?? []) rows.push({ ...r, league: syncedLeagues[i]?.name ?? "" });
    });
    return rows
      .filter((r) => r.matches_played >= 3)
      .sort((a, b) => b.points_per_game - a.points_per_game || b.xg - a.xg)
      .slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableQs.map((q) => q.dataUpdatedAt).join(","), syncedLeagues]);
  const tablesLoading = leaguesQ.isPending || tableQs.some((q) => q.isPending);

  // ---- Cards e status da coleta
  const loading = countsQ.isPending || compsQ.isPending;
  const counts = countsQ.data;
  const comps = compsQ.data || [];
  const unavailable = "Indisponível";
  const matchCount = counts?.matches ?? (countsQ.isError ? unavailable : loading ? "—" : 0);
  const teamCount = counts?.teams ?? (countsQ.isError ? unavailable : loading ? "—" : 0);
  const playerCount = counts?.players ?? (countsQ.isError ? unavailable : loading ? "—" : 0);
  const shotCount = counts?.shots ?? (countsQ.isError ? unavailable : loading ? "—" : 0);
  const compCount = comps.length || (compsQ.isError ? unavailable : loading ? "—" : 0);

  const states = dataStatusQ.data?.competitions ?? [];
  const lastOf = (provider: string) =>
    states.filter((s) => s.provider === provider)
      .map((s) => s.last_success_at)
      .filter((v): v is string => v !== null)
      .sort()
      .at(-1);
  const lastUnderstat = lastOf("understat");
  const lastFootball = lastOf("football_data");
  const understatStale = !lastUnderstat || Date.now() - new Date(lastUnderstat).getTime() > 24 * 3600_000;
  const footballStale = states.filter((s) => s.provider === "football_data").some((s) => s.is_stale || s.status !== "success");
  const fmtTs = (v?: string) => (v ? new Date(v).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "nunca");

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
          <p className={`mt-1 text-xs ${understatStale || footballStale ? "text-sv-warn" : "text-sv-muted"}`}>
            {dataStatusQ.isError
              ? "Status da coleta indisponível"
              : dataStatusQ.isPending
              ? "Consultando a última coleta…"
              : <>
                  Understat: {fmtTs(lastUnderstat)}{understatStale && <> · <Link to="/understat" className="underline">sincronizar agora</Link></>}
                  {" · "}football-data: {fmtTs(lastFootball)}{footballStale && " · pode estar desatualizado"}
                </>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/analysis" className="sv-btn-primary">
            <span><MaterialIcon name="search" className="mr-1 align-middle" />Abrir estúdio de análise</span>
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
        <StatCard label="Chutes coletados" value={shotCount}
                  sub="Finalizações reais com posição e xG (Understat)" accent="sv-accent" />
      </div>

      <SectionTitle title="Campo · ScoutVision Studio"
        hint={highlightMatch
          ? (isRandomPick
              ? "Partida sorteada entre as já disputadas com chutes · lances reais do Understat."
              : "Partida mais próxima disponível · sem chutes reais ainda, exibe o padrão recente dos times.")
          : "Aguardando uma partida com dados."}
        right={
          <div className="flex gap-2">
            {pool.length > 1 && (
              <button className="sv-btn !py-1.5 text-[12px]" onClick={() => setSeed(Math.random())}>
                <MaterialIcon name="shuffle" className="mr-1 align-middle" />Sortear outra
              </button>
            )}
            <Link to={highlightMatch ? `/analysis/${highlightMatch.id}` : "/analysis"} className="sv-btn-primary !py-1.5 text-[12px]">
              Abrir estúdio completo →
            </Link>
          </div>
        } />
      {!highlightMatch
        ? <EmptyState
            title={upcomingQ.isError || recentQ.isError ? "Não foi possível consultar as partidas" : "Nenhuma partida disponível"}
            description={upcomingQ.isError || recentQ.isError
              ? "A API está indisponível. Confira a conexão e tente novamente."
              : "Sincronize o Understat para trazer partidas e chutes reais."} />
        : studioDataset
          ? <PitchStudio dataset={studioDataset} selectedMatch={highlightMatch} selectedMatchId={highlightMatch.id} />
          : studioQ.isError
            ? <EmptyState title="Não foi possível carregar os lances" description="Tente sortear outra partida ou abra o estúdio completo." />
            : <EmptyState title="Carregando lances da partida…" />}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 md:gap-5">
        <div className="xl:col-span-2 space-y-5">
          <SectionTitle title="Partida em destaque"
            hint={highlightMatch ? (isRandomPick ? "Sorteada entre as já disputadas" : "Partida mais próxima disponível") : ""}
            right={highlightMatch
              ? <Link to={`/analysis/${highlightMatch.id}`} className="sv-btn">Análise completa →</Link>
              : undefined} />
          {highlightMatch ? (
            <>
              <MatchCard m={highlightMatch} highlight />
              {studioQ.data && hasShots
                ? <MatchSummary payload={studioQ.data} match={highlightMatch} />
                : <EmptyState title={studioQ.isPending ? "Carregando resumo…" : "Sem chutes coletados nesta partida"}
                    description={studioQ.isPending ? "" : "Quando a fonte publicar os chutes, o resumo (xG, chutes, no alvo) aparece aqui."} />}
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
          <SectionTitle title="Chutes por zona" hint="Da partida em destaque" />
          {studioQ.data && hasShots
            ? <ZoneBreakdown payload={studioQ.data} />
            : <EmptyState title={studioQ.isPending ? "Carregando…" : "Sem chutes para analisar"}
                description={studioQ.isPending ? "" : "A análise por zonas usa a posição real de cada chute."} />}
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
          <SectionTitle title="Resultados recentes" hint="Partidas do Understat, com chutes e xG"
            right={<Link to="/matches?scope=recent" className="sv-btn">Ver todas</Link>} />
          <div className="grid md:grid-cols-2 gap-3 md:gap-4">
            {recentQ.isError
              ? <EmptyState title="Falha ao carregar resultados recentes" description="Confira a conexão com a API." />
              : recent.length
                ? recent.slice(0, 4).map((m) => <MatchCard key={m.id} m={m} />)
                : <EmptyState title="Nenhum resultado sincronizado"
                    description="Use Sincronizar agora na tela Understat para trazer os jogos já disputados." />}
          </div>
        </div>
        <div>
          <SectionTitle title="Principais times" hint="Melhor aproveitamento entre as ligas do Understat"
            right={<Link to="/understat" className="sv-btn">Ver tabelas</Link>} />
          <div className="sv-card">
            <div className="sv-table-wrap">
              <table className="sv-table">
                <thead><tr><th>Time</th><th className="text-right">Pts/jogo</th><th className="text-right">xG/90</th><th className="text-right">xGA/90</th></tr></thead>
                <tbody>
                  {topTeams.map((r) => (
                    <tr key={`${r.season_id}-${r.team_id}`}>
                      <td>
                        <Link to={`/teams/${r.team_id}`} className="flex items-center gap-2 hover:text-sv-accent3">
                          <TeamLogo name={r.team} src={r.logo_url} className="w-7 h-7" />
                          <span>
                            <span className="font-medium block leading-tight">{r.team}</span>
                            <span className="text-[10px] text-sv-muted">{r.league}</span>
                          </span>
                        </Link>
                      </td>
                      <td className="text-right font-mono">{r.points_per_game.toFixed(2)}</td>
                      <td className="text-right font-mono text-sv-accent3">{(r.xg / r.matches_played).toFixed(2)}</td>
                      <td className="text-right font-mono text-sv-warn">{(r.xga / r.matches_played).toFixed(2)}</td>
                    </tr>
                  ))}
                  {!topTeams.length && (
                    <tr><td colSpan={4} className="text-sm text-sv-muted py-4">
                      {tablesLoading ? "Carregando tabelas…" : (
                        <>Nenhuma liga do Understat sincronizada. <Link to="/understat" className="underline">Sincronizar agora</Link></>
                      )}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
