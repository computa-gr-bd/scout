import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, SectionTitle, TeamLogo } from "../components/ui";
import { hasTeamDetail } from "../api/bayernData";
import { LEAGUES, MOCK_TEAMS, leagueTeamCount, type League, type MockTeam } from "../api/teamsData";
import { listTeams, listCompetitions } from "../api/client";

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

  // Descobrir o season_id da liga selecionada.
  // Quando a ligar for do backend (c.id numérico), usamos a season corrente que já
  // voltou em competitions[*].current_season_id, senão null.
  const seasonIdForLeague = useMemo<number | undefined>(() => {
    if (leagueId === "all") return undefined;
    const raw = compsQ.data?.find((c: any) => String(c.id) === String(leagueId));
    return raw?.current_season_id ?? raw?.seasons?.[raw.seasons.length - 1]?.id ?? undefined;
  }, [leagueId, compsQ.data]);

  const teamsQ = useQuery({
    queryKey: ["teams-page", leagueId, seasonIdForLeague],
    queryFn: () => listTeams({ season_id: seasonIdForLeague }),
    retry: 1, retryDelay: 600,
  });
  const compsQ = useQuery({
    queryKey: ["comps-page"], queryFn: () => listCompetitions(),
    retry: 1, retryDelay: 600,
  });

  const comps: League[] = compsQ.data?.length
    ? compsQ.data.map((c: any) => ({
        id: String(c.id),
        name: c.name,
        short_name: c.code || c.name.slice(0, 12),
        season: "atual",
        country: c.country || "",
      }))
    : LEAGUES;

  const leagueById: Record<string, League> = useMemo(() => {
    const r: Record<string, League> = {};
    for (const l of comps) r[l.id] = l;
    for (const l of LEAGUES) r[l.id] = l;
    return r;
  }, [comps]);

  const activeLeague = leagueId === "all" ? null : leagueById[leagueId] ?? null;

  const teams = useMemo(() => {
    const term = q.trim().toLowerCase();
    const source: MockTeam[] = (teamsQ.data || []).map((t: any) => {
      const stats = t.statistics || [];
      const firstStat = stats[0];
      const seasonId = String(firstStat?.season_id || "api-all");
      return {
        id: t.id,
        name: t.name,
        code: t.code || t.short_name || "",
        short_name: t.short_name || t.name.slice(0, 10),
        country: t.country || "",
        logo_url: t.logo_url || null,
        league_id: seasonId,
        statistics: stats.map((s: any) => ({
          ...s,
          scope: s.scope === "overall" ? "overall" : (s.scope || "overall"),
          matches_played: s.matches_played ?? (s.wins ?? 0) + (s.draws ?? 0) + (s.losses ?? 0) ?? 0,
          points_per_game: s.points_per_game ?? 0,
          xg_per_90: s.xg_per_90 ?? 0,
          xga_per_90: s.xga_per_90 ?? 0,
        })),
      };
    });
    return source.filter((t) => {
      const searchOk = !term || t.name.toLowerCase().includes(term) || (t.code || "").toLowerCase().includes(term);
      if (leagueId === "all") return searchOk;
      // Times já vieram filtrados por season_id do backend.
      // Só filtra aqui se por algum acaso veio time de outra season com statistics na
      // season correta.
      return searchOk;
    });
  }, [q, leagueId, teamsQ.data, compsQ.data, comps, leagueById]);

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
          ...comps.map((l) => ({ id: l.id, label: l.short_name, count: 0 })),
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
