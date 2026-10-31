import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { EmptyState, SectionTitle, TeamLogo } from "../components/ui";
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

/**
 * Card for teams returned by the backend.
 */
function TeamCard({ t, league }: { t: Team & { league_id: string }; league?: League }) {
  const s = t.statistics.find((x) => x.scope === "overall");
  const inner = (
    <div className="sv-card-inner">
      <div className="flex items-center gap-3 mb-3">
        <TeamLogo name={t.name} src={t.logo_url} className="w-10 h-10 transition-transform duration-200 group-hover:scale-110" />
        <div className="min-w-0">
          <div className="font-semibold truncate">{t.name}</div>
          <div className="text-xs text-sv-muted">
            {t.code || t.short_name || "—"} · {t.country || "—"}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
        <div>
          <div className="sv-stat-k">J</div>
          <div className="sv-stat-v">{s?.matches_played ?? "—"}</div>
        </div>
        <div>
          <div className="sv-stat-k">Pts/J</div>
          <div className="sv-stat-v text-sv-accent3">{s?.points_per_game != null ? s.points_per_game.toFixed(2) : "—"}</div>
        </div>
        <div>
          <div className="sv-stat-k">xG/90</div>
          <div className="sv-stat-v">{s?.xg_per_90 != null ? s.xg_per_90.toFixed(2) : "—"}</div>
        </div>
        <div>
          <div className="sv-stat-k">xGA/90</div>
          <div className="sv-stat-v text-sv-warn">{s?.xga_per_90 != null ? s.xga_per_90.toFixed(2) : "—"}</div>
        </div>
      </div>
      <div className="mt-3 pt-3 border-t border-sv-border/60 flex items-center justify-between gap-2 text-[11px]">
        <span className="text-sv-muted truncate">
          {league ? `${league.short_name} · ${league.season}` : "Competição indisponível"}
        </span>
        <span className="sv-chip-accent !py-0 opacity-0 translate-x-1 transition group-hover:opacity-100 group-hover:translate-x-0">
          abrir time →
        </span>
      </div>
    </div>
  );
  return (
    <Link to={`/teams/${t.id}`} className="sv-card group cursor-pointer transition-all duration-200 hover:-translate-y-1 hover:border-sv-accent/60 hover:bg-sv-panel2 hover:shadow-glow">
      {inner}
    </Link>
  );
}

export default function TeamsPage() {
  const [q, setQ] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [leagueId, setLeagueId] = useState("all");

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

  // Descobrir o season_id corrente da liga selecionada.
  // O /competitions não devolve a season embutida, então consultamos /seasons e
  // usamos a temporada marcada como current (ou a de finalização mais recente).
  const seasonIdForLeague = useMemo<number | undefined>(() => {
    if (leagueId === "all") return undefined;
    const compId = Number(leagueId);
    if (!Number.isFinite(compId)) return undefined;
    const fromComp = (seasonsQ.data ?? []).filter((s) => s.competition_id === compId);
    if (!fromComp.length) return undefined;
    const current = fromComp.find((s) => s.current);
    if (current) return current.id;
    const byEnd = [...fromComp].sort((a, b) => String(b.end_date ?? "").localeCompare(String(a.end_date ?? "")));
    return byEnd[0]?.id;
  }, [leagueId, seasonsQ.data]);

  const teamsQ = useInfiniteQuery({
    queryKey: ["teams-page", leagueId, seasonIdForLeague, searchTerm],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => listTeams({
      q: searchTerm || undefined,
      season_id: seasonIdForLeague,
      skip: pageParam,
      limit: TEAM_PAGE_SIZE,
    }),
    getNextPageParam: (lastPage, pages) =>
      lastPage.length === TEAM_PAGE_SIZE ? pages.length * TEAM_PAGE_SIZE : undefined,
    enabled: leagueId === "all" || seasonIdForLeague !== undefined,
    retry: 1, retryDelay: 600,
  });

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

  const loading = compsQ.isPending
    || (leagueId !== "all" && seasonsQ.isPending)
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

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Times"
        hint={`${teams.length} times carregados · ${comps.length} ligas · estatísticas disponíveis na API`}
      >
        <div className="flex gap-2 flex-wrap">
          <input
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar times…"
            className="sv-btn !py-1.5 md:w-64 text-left"
          />
          <select
            value={leagueId} onChange={(e) => setLeagueId(e.target.value)}
            aria-label="Filtrar por liga"
            className="sv-btn !py-1.5 bg-sv-panel text-sv-text"
          >
            <option value="all">Todas as ligas</option>
            {comps.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </div>
      </SectionTitle>

      {/* Lista de ligas selecionável */}
      <div className="flex flex-wrap gap-2">
        {[
          { id: "all", label: "Todas as ligas", count: teams.length },
          ...comps.map((l) => ({
            id: l.id,
            label: l.short_name,
            count: teams.filter((t) => t.league_id === l.id).length,
          })),
        ].map((opt) => {
          const active = leagueId === opt.id;
          return (
            <button
              key={opt.id}
              onClick={() => setLeagueId(opt.id)}
              className={`sv-btn !py-1.5 ${active ? "!bg-sv-accent !border-sv-accent3 text-white shadow-glow" : ""}`}
            >
              {opt.label}{" "}
              <span className={`sv-chip !py-0 ${active ? "!bg-white/15 !border-white/25 text-white" : ""}`}>
                {opt.count}
              </span>
            </button>
          );
        })}
      </div>

      {teams.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <div className="space-y-4">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
            {teams.map((t) => (
              <TeamCard key={t.id} t={t} league={leagueById[t.league_id]} />
            ))}
          </div>
          {teamsQ.hasNextPage && (
            <div className="flex justify-center">
              <button
                type="button"
                className="sv-btn"
                onClick={() => teamsQ.fetchNextPage()}
                disabled={teamsQ.isFetchingNextPage}
              >
                {teamsQ.isFetchingNextPage ? "Carregando…" : "Carregar mais times"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
