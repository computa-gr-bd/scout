import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { EmptyState, ErrorState, Segmented, Skeleton, TeamLogo } from "../components/ui";
import type { League } from "../api/teamsData";
import { listTeams, listCompetitions, listSeasons, type Competition, type Season, type Team } from "../api/client";

/** Rótulo de temporada ("2026/27" quando cruza anos, "2026" quando não cruza). */
function seasonLabel(s: Season | undefined): string {
  if (!s) return "atual";
  const y1 = s.start_date ? new Date(s.start_date).getFullYear() : NaN;
  const y2 = s.end_date ? new Date(s.end_date).getFullYear() : NaN;
  if (y1 && y2 && y2 !== y1) return `${y1}/${String(y2).slice(-2)}`;
  if (y1) return String(y1);
  return "atual";
}

function normalizeLabel(value: string | null | undefined) {
  return (value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

function normalizeTeamName(value: string) {
  return normalizeLabel(value)
    .replace(/^(?:afc|fc|cf|sc)\s+|\s+(?:football club|fc|afc|cf|sc)$/g, "")
    .trim();
}

function competitionKey(competition: Competition) {
  const country = normalizeLabel(competition.country);
  const code = competition.code?.trim().toUpperCase();
  return `${country}:${code || normalizeLabel(competition.name)}`;
}

function competitionPriority(competition: Competition) {
  const source = competition.data_source.toLowerCase();
  return source === "understat" ? 0 : source === "football_data" ? 1 : 2;
}

function teamPriority(team: Team) {
  const hasXg = team.statistics.some((stat) =>
    stat.scope === "overall" && (stat.xg_per_90 != null || stat.xga_per_90 != null)
  );
  return (hasXg ? 2 : 0) + (team.data_source.toLowerCase() === "understat" ? 1 : 0);
}

const TEAM_PAGE_SIZE = 50;

type TeamRowData = Team & { league_id: string };
type TeamSort = "name" | "pts" | "xg" | "xga";

function teamStat(t: Team) {
  return t.statistics.find((x) => x.scope === "overall");
}

/** Barra horizontal pequena que dá contexto visual ao valor dentro da lista. */
function MiniBar({ value, max, tone }: { value: number | null | undefined; max: number; tone: "good" | "warn" }) {
  const pct = value != null && max > 0 ? Math.max(4, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="flex items-center justify-end gap-2">
      <span className={`sv-num font-semibold ${tone === "good" ? "text-sv-accent3" : "text-sv-warn"}`}>
        {value != null ? value.toFixed(2) : "—"}
      </span>
      <span className="hidden lg:block w-14 h-1.5 rounded-sm bg-sv-panel3 overflow-hidden" aria-hidden="true">
        <span className={`block h-full rounded-sm ${tone === "good" ? "bg-sv-accent3" : "bg-sv-warn"}`} style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}

function TeamTableRow({ t, league, maxXg, maxXga }: { t: TeamRowData; league?: League; maxXg: number; maxXga: number }) {
  const s = teamStat(t);
  const navigate = useNavigate();
  return (
    <tr className="cursor-pointer" onClick={() => navigate(`/teams/${t.id}`)}>
      <td>
        <Link to={`/teams/${t.id}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-3 min-w-0 hover:text-sv-accent3 transition-colors">
          <TeamLogo name={t.name} src={t.logo_url} className="w-8 h-8" />
          <span className="min-w-0 leading-tight">
            <span className="block font-semibold truncate">{t.name}</span>
            <span className="block text-[11px] text-sv-muted truncate">{[t.code || t.short_name, t.country].filter(Boolean).join(" · ")}</span>
          </span>
        </Link>
      </td>
      <td className="hidden md:table-cell text-xs text-sv-muted whitespace-nowrap">
        {league ? `${league.short_name} · ${league.season}` : "Competição indisponível"}
      </td>
      <td className="text-right sv-num">{s?.matches_played ?? "—"}</td>
      <td className="text-right sv-num font-semibold">{s?.points_per_game != null ? s.points_per_game.toFixed(2) : "—"}</td>
      <td><MiniBar value={s?.xg_per_90} max={maxXg} tone="good" /></td>
      <td><MiniBar value={s?.xga_per_90} max={maxXga} tone="warn" /></td>
    </tr>
  );
}

export default function TeamsPage() {
  const [q, setQ] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [leagueId, setLeagueId] = useState("all");
  const [sort, setSort] = useState<TeamSort>("name");

  useEffect(() => {
    const timer = window.setTimeout(() => setSearchTerm(q.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [q]);

  // IMPORTANTE: as queries precisam ser declaradas ANTES de quem as referencia.
  // Referenciar compsQ/seasonsQ num useMemo declarado acima quebrava o render com
  // "Cannot access 'compsQ' before initialization" (ReferenceError em tempo de
  // execução) e deixava a rota /teams inteira em branco.
  const compsQ = useQuery({
    queryKey: ["comps-page"], queryFn: () => listCompetitions(),
    retry: 1, retryDelay: 600,
  });
  const seasonsQ = useQuery({
    queryKey: ["seasons-page"], queryFn: () => listSeasons(),
    retry: 1, retryDelay: 600,
  });

  // Temporada corrente de cada competição (a marcada como current, senão a de fim mais recente).
  const currentSeasonByComp = useMemo(() => {
    const byComp = new Map<number, Season>();
    for (const s of seasonsQ.data ?? []) {
      const cur = byComp.get(s.competition_id);
      const better = !cur
        || (s.current && !cur.current)
        || (Boolean(s.current) === Boolean(cur.current)
          && String(s.end_date ?? "") > String(cur.end_date ?? ""));
      if (better) byComp.set(s.competition_id, s);
    }
    return byComp;
  }, [seasonsQ.data]);

  // O /competitions não devolve a season embutida, então usamos /seasons.
  const seasonIdForLeague = useMemo<number | undefined>(() => {
    if (leagueId === "all") return undefined;
    const compId = Number(leagueId);
    if (!Number.isFinite(compId)) return undefined;
    return currentSeasonByComp.get(compId)?.id;
  }, [leagueId, currentSeasonByComp]);

  const comps: League[] = useMemo(() => {
    const unique = new Map<string, Competition>();
    for (const competition of compsQ.data ?? []) {
      const name = normalizeLabel(competition.name);
      if (name.includes("fifa") || name.includes("champions league")) continue;
      const key = competitionKey(competition);
      const current = unique.get(key);
      if (!current || competitionPriority(competition) < competitionPriority(current)) {
        unique.set(key, competition);
      }
    }

    return [...unique.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((competition) => ({
        id: String(competition.id),
        name: competition.name,
        short_name: competition.code || competition.name.slice(0, 12),
        season: seasonLabel((seasonsQ.data ?? []).find((s) => s.competition_id === competition.id && s.current)
          ?? (seasonsQ.data ?? []).filter((s) => s.competition_id === competition.id)
            .sort((a, b) => String(b.end_date ?? "").localeCompare(String(a.end_date ?? "")))[0]),
        country: competition.country || "",
        matches_per_season: 38,
      }));
  }, [compsQ.data, seasonsQ.data]);

  // "Todas as ligas": busca a temporada corrente de CADA liga exibida (mesma consulta do filtro
  // por liga). Antes a lista paginava todos os times por nome, sem temporada, e vinha misturada
  // com times de outras fontes (football-data) que não têm xG/xGA — por isso as 2 métricas
  // sumiam só nesse modo.
  const allSeasonIds = useMemo<number[]>(() => {
    const ids: number[] = [];
    for (const l of comps) {
      const id = currentSeasonByComp.get(Number(l.id))?.id;
      if (id != null && !ids.includes(id)) ids.push(id);
    }
    return ids;
  }, [comps, currentSeasonByComp]);
  const multiLeague = leagueId === "all" && allSeasonIds.length > 0;

  const teamsQ = useInfiniteQuery({
    queryKey: ["teams-page", leagueId, seasonIdForLeague, searchTerm, multiLeague ? allSeasonIds.join(",") : ""],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      if (multiLeague) {
        const perLeague = await Promise.all(allSeasonIds.map((sid) => listTeams({
          q: searchTerm || undefined, season_id: sid, skip: 0, limit: TEAM_PAGE_SIZE,
        })));
        return perLeague.flat();
      }
      return listTeams({
        q: searchTerm || undefined,
        season_id: seasonIdForLeague,
        skip: pageParam,
        limit: TEAM_PAGE_SIZE,
      });
    },
    getNextPageParam: (lastPage, pages) =>
      multiLeague || lastPage.length < TEAM_PAGE_SIZE ? undefined : pages.length * TEAM_PAGE_SIZE,
    // No modo "todas" espera competições e temporadas carregarem para não buscar duas vezes.
    enabled: leagueId === "all"
      ? !compsQ.isPending && !seasonsQ.isPending
      : seasonIdForLeague !== undefined,
    retry: 1, retryDelay: 600,
  });

  const leagueById: Record<string, League> = useMemo(() => {
    const r: Record<string, League> = {};
    for (const l of comps) r[l.id] = l;
    return r;
  }, [comps]);

  const activeLeague = leagueId === "all" ? null : leagueById[leagueId] ?? null;

  // season_id → competition_id (para rotular a liga de origem de cada time)
  const compIdBySeasonId = useMemo(() => {
    const m: Record<number, number> = {};
    for (const s of seasonsQ.data ?? []) m[s.id] = s.competition_id;
    return m;
  }, [seasonsQ.data]);

  const teams = useMemo(() => {
    const competitionsById = new Map((compsQ.data ?? []).map((competition) => [competition.id, competition]));
    const displayedCompetitionIdByKey = new Map<string, string>();
    for (const competition of comps) {
      const source = competitionsById.get(Number(competition.id));
      if (source) displayedCompetitionIdByKey.set(competitionKey(source), competition.id);
    }

    const seasonsById = new Map((seasonsQ.data ?? []).map((season) => [season.id, season]));
    const candidates = (teamsQ.data?.pages.flat() ?? []).flatMap((team) => {
      const statistics = team.statistics.filter((stat) => {
        if (stat.season_id == null) return true;
        const competitionId = compIdBySeasonId[stat.season_id];
        if (competitionId == null) return true;
        const competition = competitionsById.get(competitionId);
        return competition != null && displayedCompetitionIdByKey.has(competitionKey(competition));
      });
      if (!statistics.length) return [];

      statistics.sort((a, b) => {
        const hasXg = (stat: Team["statistics"][number]) =>
          stat.xg_per_90 != null || stat.xga_per_90 != null;
        const xgOrder = Number(hasXg(b)) - Number(hasXg(a));
        if (xgOrder) return xgOrder;

        const seasonA = a.season_id != null ? seasonsById.get(a.season_id) : undefined;
        const seasonB = b.season_id != null ? seasonsById.get(b.season_id) : undefined;
        const currentOrder = Number(Boolean(seasonB?.current)) - Number(Boolean(seasonA?.current));
        if (currentOrder) return currentOrder;
        return String(seasonB?.end_date ?? "").localeCompare(String(seasonA?.end_date ?? ""));
      });

      const seasonId = statistics[0]?.season_id;
      const competitionId = seasonId != null ? compIdBySeasonId[seasonId] : undefined;
      const competition = competitionId != null ? competitionsById.get(competitionId) : undefined;
      return [{
        team: { ...team, statistics },
        name: normalizeTeamName(team.name),
        country: normalizeLabel(team.country) || normalizeLabel(competition?.country),
      }];
    });

    const countriesByName = new Map<string, Set<string>>();
    for (const candidate of candidates) {
      if (!candidate.country) continue;
      const countries = countriesByName.get(candidate.name) ?? new Set<string>();
      countries.add(candidate.country);
      countriesByName.set(candidate.name, countries);
    }

    const unique = new Map<string, { team: Team; name: string; country: string }>();
    for (const candidate of candidates) {
      const knownCountries = countriesByName.get(candidate.name);
      const country = candidate.country || (
        knownCountries?.size === 1 ? [...knownCountries][0] : ""
      );
      const key = `${country}:${candidate.name}`;
      const current = unique.get(key);
      if (!current || teamPriority(candidate.team) > teamPriority(current.team)) {
        unique.set(key, { ...candidate, country });
      }
    }

    return [...unique.values()].map(({ team }) => {
      const seasonId = team.statistics[0]?.season_id;
      const sourceCompetitionId = seasonId != null ? compIdBySeasonId[seasonId] : undefined;
      const sourceCompetition = sourceCompetitionId != null
        ? competitionsById.get(sourceCompetitionId)
        : undefined;
      const displayedCompetitionId = sourceCompetition
        ? displayedCompetitionIdByKey.get(competitionKey(sourceCompetition))
        : undefined;
      return { ...team, league_id: displayedCompetitionId ?? "api-all" };
    });
  }, [teamsQ.data, compIdBySeasonId, comps, compsQ.data, seasonsQ.data]);

  const sortedTeams = useMemo(() => {
    const val = (t: Team, k: "points_per_game" | "xg_per_90" | "xga_per_90") => teamStat(t)?.[k] ?? null;
    const arr = [...teams];
    if (sort === "name") return arr.sort((a, b) => a.name.localeCompare(b.name));
    const key = sort === "pts" ? "points_per_game" : sort === "xg" ? "xg_per_90" : "xga_per_90";
    // Sem dado vai para o fim; xGA: menor é melhor.
    return arr.sort((a, b) => {
      const va = val(a, key), vb = val(b, key);
      if (va == null && vb == null) return a.name.localeCompare(b.name);
      if (va == null) return 1;
      if (vb == null) return -1;
      return sort === "xga" ? va - vb : vb - va;
    });
  }, [teams, sort]);
  const maxXg = Math.max(0, ...teams.map((t) => teamStat(t)?.xg_per_90 ?? 0));
  const maxXga = Math.max(0, ...teams.map((t) => teamStat(t)?.xga_per_90 ?? 0));

  const loading = compsQ.isPending
    || seasonsQ.isPending
    || (teamsQ.isPending && teamsQ.fetchStatus !== "idle");

  const requestFailed = compsQ.isError || teamsQ.isError
    || (leagueId !== "all" && seasonsQ.isError);
  const emptyTitle = loading
    ? "Carregando times"
    : requestFailed
      ? "Não foi possível carregar os times"
      : (q.trim() ? "Nenhum time encontrado" : "Nenhum time");
  const emptyDescription = loading
    ? "Buscando dados da API…"
    : requestFailed
      ? "A API está indisponível no momento. Tente novamente em instantes."
      : q.trim()
        ? `Nada para “${q.trim()}”${activeLeague ? ` em ${activeLeague.name}` : ""}. Tente outro nome ou sigla.`
        : activeLeague
          ? `${activeLeague.name} ainda não tem times importados — rode a coleta desta liga.`
          : "Nenhum time cadastrado pela API.";

  const leagueOptions = [
    { key: "all", label: "Todas as ligas", count: teams.length > 0 && leagueId === "all" ? teams.length : undefined },
    ...comps.map((l) => {
      const count = teams.filter((t) => t.league_id === l.id).length;
      // Só uma liga é carregada por vez: o número das outras seria 0 (falso). Mostra só o que é conhecido.
      const showCount = leagueId === l.id || (leagueId === "all" && count > 0);
      return { key: l.id, label: l.short_name, count: showCount ? count : undefined };
    }),
  ];

  return (
    <div className="space-y-4">
      {/* Barra de filtros */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="hidden sm:block overflow-x-auto max-w-full">
          <Segmented<string> label="Filtrar por liga" value={leagueId} onChange={setLeagueId} options={leagueOptions} />
        </div>
        <label className="sm:hidden">
          <span className="sr-only">Filtrar por liga</span>
          <select value={leagueId} onChange={(e) => setLeagueId(e.target.value)} className="sv-input w-full">
            <option value="all">Todas as ligas</option>
            {comps.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <div className="flex flex-1 flex-col sm:flex-row gap-2 lg:justify-end">
          <label className="relative sm:w-64">
            <span className="sr-only">Buscar times</span>
            <svg viewBox="0 0 24 24" fill="none" width="16" height="16" stroke="currentColor" strokeWidth="2"
                 strokeLinecap="round" className="absolute left-3 top-1/2 -translate-y-1/2 text-sv-faint pointer-events-none" aria-hidden="true">
              <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
            </svg>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar times"
                   className="sv-input w-full !pl-9" />
          </label>
          <label>
            <span className="sr-only">Ordenar por</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as TeamSort)} className="sv-input w-full sm:w-52">
              <option value="name">Nome (A–Z)</option>
              <option value="pts">Mais pontos por jogo</option>
              <option value="xg">Maior xG/90 (ataque)</option>
              <option value="xga">Menor xGA/90 (defesa)</option>
            </select>
          </label>
        </div>
      </div>

      {teams.length === 0 ? (
        loading ? (
          <div className="sv-card p-3 space-y-2" aria-busy="true" aria-label="Carregando times">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-11 w-full" />)}
          </div>
        ) : requestFailed ? (
          <ErrorState title={emptyTitle} description={emptyDescription} onRetry={() => { compsQ.refetch(); seasonsQ.refetch(); teamsQ.refetch(); }} />
        ) : (
          <EmptyState title={emptyTitle} description={emptyDescription} />
        )
      ) : (
        <div className="space-y-4">
          <div className="sv-card overflow-hidden">
            <div className="sv-table-wrap">
              <table className="sv-table">
                <caption className="sr-only">Times com estatísticas da temporada corrente</caption>
                <thead>
                  <tr>
                    <th scope="col">Time</th>
                    <th scope="col" className="hidden md:table-cell">Competição</th>
                    <th scope="col" className="text-right" title="Jogos">J</th>
                    <th scope="col" className="text-right" title="Pontos por jogo">Pts/J</th>
                    <th scope="col" className="text-right" title="xG por 90 minutos (ataque)">xG/90</th>
                    <th scope="col" className="text-right" title="xGA por 90 minutos (defesa)">xGA/90</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTeams.map((t) => (
                    <TeamTableRow key={t.id} t={t} league={leagueById[t.league_id]} maxXg={maxXg} maxXga={maxXga} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="flex items-center justify-between text-xs text-sv-muted">
            <span><span className="sv-num text-sv-text font-semibold">{teams.length}</span> times</span>
            {teamsQ.hasNextPage && (
              <button type="button" className="sv-btn" onClick={() => teamsQ.fetchNextPage()} disabled={teamsQ.isFetchingNextPage}>
                {teamsQ.isFetchingNextPage ? "Carregando…" : "Carregar mais times"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
