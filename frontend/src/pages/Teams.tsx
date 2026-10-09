import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, SectionTitle, TeamLogo } from "../components/ui";
import { hasTeamDetail } from "../api/bayernData";
import { LEAGUES, MOCK_TEAMS, leagueTeamCount, type League, type MockTeam } from "../api/teamsData";
import { listTeams, listCompetitions, listSeasons, type Competition } from "../api/client";

/**
 * Card de time — clicável quando existe detalhe mockado (`bayernData`,
 * hoje só o Bayern); os demais só dão feedback de hover ("em breve").
 */
function TeamCard({ t, league }: { t: MockTeam; league: League }) {
  const s = t.statistics.find((x) => x.scope === "overall");
  const hasDetail = hasTeamDetail(t.id);
  const inner = (
    <div className="sv-card-inner">
      <div className="flex items-center gap-3 mb-3">
        <TeamLogo name={t.name} className="w-10 h-10 transition-transform duration-200 group-hover:scale-110" />
        <div className="min-w-0">
          <div className="font-semibold truncate">{t.name}</div>
          <div className="text-xs text-sv-muted">
            {t.code} · {t.country || "—"}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2 text-center">
        <div>
          <div className="sv-stat-k">J</div>
          <div className="sv-stat-v">{s?.matches_played ?? 0}</div>
        </div>
        <div>
          <div className="sv-stat-k">Pts/J</div>
          <div className="sv-stat-v text-sv-accent3">{(s?.points_per_game ?? 0).toFixed(2)}</div>
        </div>
        <div>
          <div className="sv-stat-k">xG/90</div>
          <div className="sv-stat-v">{(s?.xg_per_90 ?? 0).toFixed(2)}</div>
        </div>
        <div>
          <div className="sv-stat-k">xGA/90</div>
          <div className="sv-stat-v text-sv-warn">{(s?.xga_per_90 ?? 0).toFixed(2)}</div>
        </div>
      </div>
      <div className="mt-3 pt-3 border-t border-sv-border/60 flex items-center justify-between gap-2 text-[11px]">
        <span className="text-sv-muted truncate">
          {league.short_name} · {league.season}
        </span>
        <span
          className={`sv-chip-accent !py-0 opacity-0 translate-x-1 transition group-hover:opacity-100 group-hover:translate-x-0 ${
            hasDetail ? "" : "italic"
          }`}
        >
          {hasDetail ? "abrir elenco →" : "em breve"}
        </span>
      </div>
    </div>
  );
  const cls = `sv-card group transition-all duration-200 hover:-translate-y-1 hover:border-sv-accent/60 hover:bg-sv-panel2 hover:shadow-glow${
    hasDetail ? " cursor-pointer" : ""
  }`;
  if (hasDetail) {
    return (
      <Link to={`/teams/${t.id}`} className={cls}>
        {inner}
      </Link>
    );
  }
  return <div className={cls}>{inner}</div>;
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
    if (!Number.isFinite(compId)) return undefined; // liga mock (id não numérico)
    const fromComp = (seasonsQ.data ?? []).filter((s) => s.competition_id === compId);
    if (!fromComp.length) return undefined;
    const current = fromComp.find((s) => s.current);
    if (current) return current.id;
    const byEnd = [...fromComp].sort((a, b) => String(b.end_date ?? "").localeCompare(String(a.end_date ?? "")));
    return byEnd[0]?.id;
  }, [leagueId, seasonsQ.data]);

  // Espera a season da liga antes de buscar (evita virar a lista toda e
  // refiltrar); se /seasons falhar, segue sem season_id mesmo.
  const seasonsSettled = seasonsQ.isSuccess || seasonsQ.isError;
  const teamsQ = useQuery({
    queryKey: ["teams-page", leagueId, seasonIdForLeague],
    queryFn: () => listTeams({ season_id: seasonIdForLeague, limit: 500 }),
    enabled: leagueId === "all" || seasonIdForLeague !== undefined || seasonsSettled,
    retry: 1, retryDelay: 600,
  });

  const comps: League[] = compsQ.data?.length
    ? compsQ.data.map((c: Competition) => ({
        id: String(c.id),
        name: c.name,
        short_name: c.code || c.name.slice(0, 12),
        season: "atual",
        country: c.country || "",
        matches_per_season: 38,
      }))
    : LEAGUES;

  const leagueById: Record<string, League> = useMemo(() => {
    const r: Record<string, League> = {};
    for (const l of comps) r[l.id] = l;
    for (const l of LEAGUES) r[l.id] = l;
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
    const source: MockTeam[] = (teamsQ.data || []).map((t: any) => {
      const stats = t.statistics || [];
      const firstStat = stats[0];
      const compId = firstStat?.season_id != null ? compIdBySeasonId[firstStat.season_id] : undefined;
      return {
        id: t.id,
        name: t.name,
        code: t.code || t.short_name || "",
        short_name: t.short_name || t.name.slice(0, 10),
        country: t.country || "",
        founded: t.founded ?? null,
        logo_url: t.logo_url || null,
        data_source: t.data_source || "api",
        league_id: compId != null ? String(compId) : "api-all",
        statistics: stats.map((s: any) => ({
          ...s,
          scope: s.scope === "overall" ? "overall" : (s.scope || "overall"),
          matches_played: s.matches_played ?? ((s.wins ?? 0) + (s.draws ?? 0) + (s.losses ?? 0)),
          points_per_game: s.points_per_game ?? 0,
          xg_per_90: s.xg_per_90 ?? 0,
          xga_per_90: s.xga_per_90 ?? 0,
        })),
      };
    });
    // A filtragem por liga já veio do backend (season_id); aqui só o busca por texto.
    return source.filter((t) =>
      !term || t.name.toLowerCase().includes(term) || (t.code || "").toLowerCase().includes(term)
    );
  }, [q, teamsQ.data, compIdBySeasonId]);

  const loading = teamsQ.isPending || compsQ.isPending;

  const emptyTitle = loading ? "Carregando times" : (q.trim() ? "Nenhum time encontrado" : "Nenhum time");
  const emptyDescription = loading
    ? "Buscando dados do banco Neon…"
    : q.trim()
      ? `Nada para “${q.trim()}”${activeLeague ? ` em ${activeLeague.name}` : ""}. Tente outro nome ou sigla.`
      : activeLeague
        ? `${activeLeague.name} ainda não tem times importados — rode a coleta desta liga.`
        : "Nenhum time cadastrado.";

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Times"
        hint={`${teams.length} times · ${comps.length} ligas · estatísticas completas e fraquezas defensivas`}
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
            <TeamCard key={t.id} t={t} league={leagueById[t.league_id] ?? comps[0] ?? LEAGUES[0]} />
          ))}
        </div>
      )}
    </div>
  );
}
