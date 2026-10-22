import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
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
  const [leagueId, setLeagueId] = useState("all");

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

  const teamsQ = useQuery({
    queryKey: ["teams-page", leagueId, seasonIdForLeague],
    queryFn: () => listTeams({ season_id: seasonIdForLeague, limit: 500 }),
    enabled: leagueId === "all" || seasonIdForLeague !== undefined,
    retry: 1, retryDelay: 600,
  });

  const comps: League[] = (compsQ.data ?? []).map((c: Competition) => ({
    id: String(c.id),
    name: c.name,
    short_name: c.code || c.name.slice(0, 12),
    season: seasonLabel((seasonsQ.data ?? []).find((s) => s.competition_id === c.id && s.current)
      ?? (seasonsQ.data ?? []).filter((s) => s.competition_id === c.id)
        .sort((a, b) => String(b.end_date ?? "").localeCompare(String(a.end_date ?? "")))[0]),
    country: c.country || "",
    matches_per_season: 38,
  }));

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
    const term = q.trim().toLowerCase();
    return (teamsQ.data ?? []).map((team) => {
      const seasonId = team.statistics[0]?.season_id;
      const competitionId = seasonId != null ? compIdBySeasonId[seasonId] : undefined;
      return { ...team, league_id: competitionId != null ? String(competitionId) : "api-all" };
    }).filter((team) =>
      !term || team.name.toLowerCase().includes(term)
      || (team.code || "").toLowerCase().includes(term)
    );
  }, [q, teamsQ.data, compIdBySeasonId]);

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
        hint={`${teams.length} times · ${comps.length} ligas · estatísticas disponíveis na API`}
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
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
          {teams.map((t) => (
            <TeamCard key={t.id} t={t} league={leagueById[t.league_id]} />
          ))}
        </div>
      )}
    </div>
  );
}
