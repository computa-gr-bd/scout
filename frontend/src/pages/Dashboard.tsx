import { useMemo, useState } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  listMatches, getMatch, getMatchStudio,
  listUnderstatLeagues, listUnderstatMatches, getUnderstatLeagueTable,
  type Match, type MatchStudioPayload, type StudioApiShot, type UnderstatTableRow,
} from "../api/client";
import { payloadToDataset } from "../api/studioReal";
import { EmptyState, ErrorState, LeagueLogo, Panel, Skeleton, TeamLogo } from "../components/ui";
import { MatchRow, MatchRowsSkeleton } from "../components/MatchRow";
import { PitchStudio } from "../components/PitchStudio";
import { MaterialIcon } from "../components/MaterialIcon";

const HOME_COLOR = "rgb(var(--sv-info))";
const AWAY_COLOR = "rgb(var(--sv-away))";

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
  const hasCompleteXg = own.length > 0 && own.every((shot) => shot.xg != null);
  return {
    shots: own.length,
    onTarget: own.filter((s) => s.on_target === true || s.result === "goal" || s.result === "saved").length,
    goals: own.filter((s) => s.result === "goal").length,
    xg: hasCompleteXg ? own.reduce((acc, s) => acc + (s.xg ?? 0), 0) : null,
    own,
  };
}

function MatchSummary({ payload, match }: { payload: MatchStudioPayload; match: Match }) {
  const home = teamTotals(payload.shots, "home");
  const away = teamTotals(payload.shots, "away");
  const finished = match.status === "finished";
  const rows: Array<{ label: string; h: number | null; a: number | null; digits: number }> = [
    { label: "Gols", h: finished ? match.home_score : home.goals, a: finished ? match.away_score : away.goals, digits: 0 },
    { label: "xG", h: home.xg, a: away.xg, digits: 2 },
    { label: "Chutes", h: home.shots, a: away.shots, digits: 0 },
    { label: "No alvo", h: home.onTarget, a: away.onTarget, digits: 0 },
  ];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-center">
        <div className="flex items-center gap-2 min-w-0 font-semibold text-sm">
          <span className="w-1 h-4 rounded-sm shrink-0" style={{ background: HOME_COLOR }} aria-hidden="true" />
          <TeamLogo name={match.home_team.name} src={match.home_team.logo_url} className="w-5 h-5" />
          <span className="truncate">{match.home_team.name}</span>
        </div>
        <span className="text-[11px] text-sv-faint">vs</span>
        <div className="flex items-center justify-end gap-2 min-w-0 font-semibold text-sm">
          <span className="truncate">{match.away_team.name}</span>
          <TeamLogo name={match.away_team.name} src={match.away_team.logo_url} className="w-5 h-5" />
          <span className="w-1 h-4 rounded-sm shrink-0" style={{ background: AWAY_COLOR }} aria-hidden="true" />
        </div>
      </div>
      {rows.map(({ label, h, a, digits }) => {
        const hv = h ?? 0, av = a ?? 0;
        const total = hv + av;
        const hp = total > 0 ? (hv / total) * 100 : 50;
        const fmt = (v: number | null) => (v == null ? "—" : v.toFixed(digits));
        return (
          <div key={label}>
            <div className="flex items-baseline justify-between text-sm">
              <span className="sv-num font-semibold text-base">{fmt(h)}</span>
              <span className="text-xs text-sv-muted">{label}</span>
              <span className="sv-num font-semibold text-base">{fmt(a)}</span>
            </div>
            <div className="mt-1 flex h-1.5 gap-0.5" aria-hidden="true">
              <div className="rounded-sm" style={{ width: `${hp}%`, background: HOME_COLOR, opacity: total > 0 ? 1 : 0.25 }} />
              <div className="rounded-sm flex-1" style={{ background: AWAY_COLOR, opacity: total > 0 ? 1 : 0.25 }} />
            </div>
          </div>
        );
      })}
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
    <div className="space-y-3.5">
      {data.map((d) => (
        <div key={d.zone}>
          <div className="text-xs font-medium mb-1">{ZONE_LABEL[d.zone]}</div>
          {([["home", HOME_COLOR, d.home], ["away", AWAY_COLOR, d.away]] as const).map(([side, color, v]) => (
            <div key={side} className="flex items-center gap-2 mb-1">
              <div className="flex-1 h-1.5 rounded-sm bg-sv-panel3 overflow-hidden">
                <div className="h-full rounded-sm" style={{ width: `${(v.n / max) * 100}%`, background: color }} />
              </div>
              <div className="w-24 text-right text-[11px] text-sv-muted whitespace-nowrap sv-num">
                <span className="text-sv-text font-semibold">{v.n}</span> · xG {v.xg.toFixed(2)}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Líder de uma métrica entre as tabelas reais das ligas. */
function Leader({ label, row, value, tone }: {
  label: string; row?: UnderstatTableRow & { league: string }; value: string; tone: "good" | "warn" | "info";
}) {
  const color = tone === "good" ? "text-sv-accent3" : tone === "warn" ? "text-sv-warn" : "text-sv-info";
  return (
    <div className="px-4 py-3 min-w-0">
      <div className="sv-label">{label}</div>
      {row ? (
        <Link to={`/teams/${row.team_id}`} className="mt-1.5 flex items-center gap-2.5 min-w-0 group">
          <TeamLogo name={row.team} src={row.logo_url} className="w-8 h-8" />
          <span className="min-w-0 leading-tight">
            <span className="block text-sm font-semibold truncate group-hover:text-sv-accent3 transition-colors">{row.team}</span>
            <span className="block text-[11px] text-sv-muted truncate">{row.league}</span>
          </span>
          <span className={`ml-auto sv-display text-2xl ${color}`}>{value}</span>
        </Link>
      ) : <div className="mt-2 text-sm text-sv-faint">—</div>}
    </div>
  );
}

const SHORTCUTS: { to: string; label: string; hint: string; icon: string }[] = [
  { to: "/analysis", label: "Estúdio de análise", hint: "Chutes, zonas e confrontos pré-jogo", icon: "query_stats" },
  { to: "/compare", label: "Comparar jogadores", hint: "Radar por posição e liga", icon: "compare_arrows" },
  { to: "/players", label: "Jogadores", hint: "Busca nas cinco ligas", icon: "person_search" },
  { to: "/teams", label: "Times", hint: "Perfil e forma dos clubes", icon: "groups" },
  { to: "/ligas", label: "Ligas", hint: "Classificações e sincronização", icon: "emoji_events" },
  { to: "/models", label: "Modelos", hint: "Como as estimativas são feitas", icon: "function" },
];

// ---------------------------------------------------------------- Página

export default function Dashboard() {
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
    queryFn: () => listUnderstatMatches({ finished_only: true, limit: 50 }),
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
  const allRows = useMemo(() => {
    const rows: Array<UnderstatTableRow & { league: string }> = [];
    tableQs.forEach((q, i) => {
      for (const r of q.data?.table ?? []) rows.push({ ...r, league: syncedLeagues[i]?.name ?? "" });
    });
    return rows.filter((r) => r.matches_played >= 3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableQs.map((q) => q.dataUpdatedAt).join(","), syncedLeagues]);
  const topTeams = useMemo(
    () => [...allRows].sort((a, b) => b.points_per_game - a.points_per_game || b.xg - a.xg).slice(0, 8),
    [allRows],
  );
  // Destaques estatísticos (calculados das mesmas tabelas reais).
  const bestAttack = useMemo(
    () => [...allRows].sort((a, b) => b.xg / b.matches_played - a.xg / a.matches_played)[0],
    [allRows],
  );
  const bestDefense = useMemo(
    () => [...allRows].sort((a, b) => a.xga / a.matches_played - b.xga / b.matches_played)[0],
    [allRows],
  );
  const bestPpg = topTeams[0];
  const tablesLoading = leaguesQ.isPending || tableQs.some((q) => q.isPending);

  const matchesFailed = upcomingQ.isError || recentQ.isError;

  return (
    <div className="space-y-5">
      {/* Estúdio */}
      <Panel
        title="Estúdio de campo"
        right={
          <>
            {pool.length > 1 && (
              <button type="button" className="sv-btn !py-1 text-[12px]" onClick={() => setSeed(Math.random())}>
                <MaterialIcon name="shuffle" />Sortear outra
              </button>
            )}
            <Link to={highlightMatch ? `/analysis/${highlightMatch.id}` : "/analysis"} className="sv-btn-primary !py-1 text-[12px]">
              Abrir estúdio completo
            </Link>
          </>
        }
        bodyClassName="p-3 sm:p-4"
      >
        <p className="text-xs text-sv-muted mb-3">
          {highlightMatch
            ? (isRandomPick
                ? "Partida sorteada entre as já disputadas, com lances reais."
                : "Partida mais próxima disponível · sem chutes reais ainda, exibe o padrão recente dos times.")
            : "Aguardando uma partida com dados."}
        </p>
        {!highlightMatch
          ? (matchesFailed
              ? <ErrorState title="Não foi possível consultar as partidas"
                  description="A API está indisponível. Confira a conexão e tente novamente."
                  onRetry={() => { upcomingQ.refetch(); recentQ.refetch(); }} />
              : (upcomingQ.isPending || recentQ.isPending)
                ? <Skeleton className="h-[320px] w-full" />
                : <EmptyState title="Nenhuma partida disponível" description="Sincronize o Understat para trazer partidas e chutes reais." />)
          : studioDataset
            ? <PitchStudio dataset={studioDataset} />
            : studioQ.isError
              ? <ErrorState title="Não foi possível carregar os lances"
                  description="Tente sortear outra partida ou abra o estúdio completo." onRetry={() => studioQ.refetch()} />
              : <Skeleton className="h-[320px] w-full" />}
      </Panel>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 md:gap-5">
        {/* Partida em destaque: confronto + resumo + zonas num único painel */}
        <Panel className="xl:col-span-2" title="Partida em destaque"
          right={highlightMatch ? <Link to={`/analysis/${highlightMatch.id}`} className="sv-btn !py-1 text-[12px]">Análise completa</Link> : undefined}>
          {highlightMatch ? (
            <>
              <div className="border-b border-sv-border/60">
                <MatchRow m={highlightMatch} showDate />
              </div>
              {studioQ.data && hasShots ? (
                <div className="grid md:grid-cols-2 md:divide-x divide-sv-border">
                  <div className="p-4"><div className="sv-label mb-3">Resumo da partida</div><MatchSummary payload={studioQ.data} match={highlightMatch} /></div>
                  <div className="p-4 border-t md:border-t-0 border-sv-border"><div className="sv-label mb-3">Chutes por zona</div><ZoneBreakdown payload={studioQ.data} /></div>
                </div>
              ) : studioQ.isPending ? (
                <div className="p-4 grid md:grid-cols-2 gap-4"><Skeleton className="h-28" /><Skeleton className="h-28" /></div>
              ) : (
                <div className="p-4"><EmptyState title="Sem chutes coletados nesta partida"
                  description="Quando a fonte publicar os chutes, o resumo (xG, chutes, no alvo) e a análise por zonas aparecem aqui." /></div>
              )}
            </>
          ) : (
            <div className="p-4">
              {upcomingQ.isPending || recentQ.isPending
                ? <Skeleton className="h-24" />
                : <EmptyState title={matchesFailed ? "Não foi possível consultar as partidas" : "Nenhuma partida em destaque"}
                    description={matchesFailed ? "A API está indisponível. Confira a conexão e tente novamente."
                      : "A API ainda não retornou partidas para as competições sincronizadas."} />}
            </div>
          )}
        </Panel>

        {/* Próximas partidas */}
        <Panel title="Próximas partidas" right={<Link to="/matches" className="text-xs text-sv-accent3 hover:underline">Ver todas</Link>}>
          {upcomingQ.isPending ? <MatchRowsSkeleton rows={5} />
            : upcomingQ.isError ? <div className="p-3"><ErrorState title="Falha ao carregar próximas partidas" onRetry={() => upcomingQ.refetch()} /></div>
            : upcoming.length ? (
              <div className="divide-y divide-sv-border/60">
                {upcoming.slice(0, 6).map((m) => <MatchRow key={m.id} m={m} showDate showCompetition={false} />)}
              </div>
            ) : <div className="p-3"><EmptyState title="Nenhuma próxima partida sincronizada" /></div>}
        </Panel>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 md:gap-5">
        {/* Equipes em evidência */}
        <Panel className="xl:col-span-2" title="Equipes em evidência"
          right={<Link to="/ligas" className="text-xs text-sv-accent3 hover:underline">Ver tabelas</Link>}>
          <div className="grid sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-sv-border border-b border-sv-border">
            <Leader label="Melhor ataque (xG/jogo)" tone="good" row={bestAttack}
                    value={bestAttack ? (bestAttack.xg / bestAttack.matches_played).toFixed(2) : "—"} />
            <Leader label="Melhor defesa (xGA/jogo)" tone="info" row={bestDefense}
                    value={bestDefense ? (bestDefense.xga / bestDefense.matches_played).toFixed(2) : "—"} />
            <Leader label="Melhor aproveitamento" tone="warn" row={bestPpg}
                    value={bestPpg ? `${bestPpg.points_per_game.toFixed(2)}` : "—"} />
          </div>
          <div className="sv-table-wrap">
            <table className="sv-table">
              <caption className="sr-only">Principais times por pontos por jogo entre as ligas sincronizadas</caption>
              <thead><tr>
                <th scope="col" className="w-8">#</th><th scope="col">Time</th>
                <th scope="col" className="text-right">Pts/jogo</th><th scope="col" className="text-right">xG/jogo</th><th scope="col" className="text-right">xGA/jogo</th>
              </tr></thead>
              <tbody>
                {topTeams.map((r, i) => (
                  <tr key={`${r.season_id}-${r.team_id}`}>
                    <td className="sv-num text-sv-muted">{i + 1}</td>
                    <td>
                      <Link to={`/teams/${r.team_id}`} className="flex items-center gap-2.5 hover:text-sv-accent3 transition-colors">
                        <TeamLogo name={r.team} src={r.logo_url} className="w-6 h-6" />
                        <span className="leading-tight min-w-0">
                          <span className="font-medium block truncate">{r.team}</span>
                          <span className="text-[11px] text-sv-muted">{r.league}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="text-right sv-num font-semibold">{r.points_per_game.toFixed(2)}</td>
                    <td className="text-right sv-num text-sv-accent3">{(r.xg / r.matches_played).toFixed(2)}</td>
                    <td className="text-right sv-num text-sv-warn">{(r.xga / r.matches_played).toFixed(2)}</td>
                  </tr>
                ))}
                {!topTeams.length && (
                  <tr><td colSpan={5} className="text-sm text-sv-muted py-4">
                    {tablesLoading ? "Carregando tabelas…" : (
                      <>Nenhuma liga sincronizada. <Link to="/ligas" className="underline">Sincronizar agora</Link></>
                    )}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        {/* Resultados recentes */}
        <Panel title="Resultados recentes" right={<Link to="/matches?scope=recent" className="text-xs text-sv-accent3 hover:underline">Ver todos</Link>}>
          {recentQ.isPending ? <MatchRowsSkeleton rows={5} />
            : recentQ.isError ? <div className="p-3"><ErrorState title="Falha ao carregar resultados recentes" onRetry={() => recentQ.refetch()} /></div>
            : recent.length ? (
              <div className="divide-y divide-sv-border/60">
                {recent.slice(0, 6).map((m) => <MatchRow key={m.id} m={m} showDate showCompetition={false} />)}
              </div>
            ) : <div className="p-3"><EmptyState title="Nenhum resultado sincronizado"
                description="Use Sincronizar agora na tela Ligas para trazer os jogos já disputados." /></div>}
        </Panel>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-5">
        {/* Competições disponíveis */}
        <Panel title="Competições disponíveis" right={<Link to="/ligas" className="text-xs text-sv-accent3 hover:underline">Gerenciar</Link>}>
          {leaguesQ.isPending ? <div className="p-3 space-y-2"><Skeleton className="h-9" /><Skeleton className="h-9" /><Skeleton className="h-9" /></div>
            : leaguesQ.isError ? <div className="p-3"><ErrorState title="Falha ao carregar as competições" onRetry={() => leaguesQ.refetch()} /></div>
            : syncedLeagues.length ? (
              <ul className="divide-y divide-sv-border/60">
                {syncedLeagues.map((l) => (
                  <li key={l.key}>
                    <Link to="/ligas" className="sv-row-link px-4 py-2 flex items-center gap-3">
                      <LeagueLogo code={l.code} name={l.name} className="w-11 h-11" />
                      <span className="min-w-0 flex-1 leading-tight">
                        <span className="block text-sm font-medium truncate">{l.name}</span>
                        <span className="block text-[11px] text-sv-muted truncate">{l.country}</span>
                      </span>
                      <span className="text-xs text-sv-muted shrink-0">{l.seasons.find((s) => s.current)?.name ?? l.seasons[0]?.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : <div className="p-3"><EmptyState title="Nenhuma competição sincronizada"
                description="Abra a tela Ligas para sincronizar as competições." /></div>}
        </Panel>

        {/* Atalhos */}
        <Panel title="Atalhos">
          <ul className="grid sm:grid-cols-2 divide-y sm:divide-y-0 divide-sv-border/60">
            {SHORTCUTS.map((sc, i) => (
              <li key={sc.to} className={i % 2 === 1 ? "sm:border-l sm:border-sv-border/60" : ""}>
                <Link to={sc.to} className="sv-row-link px-4 py-3 flex items-center gap-3 sm:border-b sm:border-sv-border/60">
                  <MaterialIcon name={sc.icon} className="text-sv-accent3 !text-[20px]" />
                  <span className="leading-tight min-w-0">
                    <span className="block text-sm font-medium">{sc.label}</span>
                    <span className="block text-[11px] text-sv-muted truncate">{sc.hint}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
