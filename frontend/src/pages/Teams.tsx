import { useMemo, useState } from "react";
import { EmptyState, SectionTitle, TeamLogo } from "../components/ui";
import { LEAGUES, MOCK_TEAMS, leagueTeamCount, type League, type MockTeam } from "../api/teamsData";

/** Card de time — por enquanto NÃO clicável (só hover); depois vira navegação. */
function TeamCard({ t, league }: { t: MockTeam; league: League }) {
  const s = t.statistics.find((x) => x.scope === "overall");
  return (
    <div className="sv-card group cursor-pointer transition-all duration-200 hover:-translate-y-1 hover:border-sv-accent/60 hover:bg-sv-panel2 hover:shadow-glow">
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
          <span className="sv-chip-accent !py-0 opacity-0 translate-x-1 transition group-hover:opacity-100 group-hover:translate-x-0">
            em breve
          </span>
        </div>
      </div>
    </div>
  );
}

export default function TeamsPage() {
  const [q, setQ] = useState("");
  const [leagueId, setLeagueId] = useState("all");

  const activeLeague = leagueId === "all" ? null : LEAGUES.find((l) => l.id === leagueId) ?? null;

  const teams = useMemo(() => {
    const term = q.trim().toLowerCase();
    return MOCK_TEAMS.filter((t) => {
      const leagueOk = leagueId === "all" || t.league_id === leagueId;
      const searchOk = !term || t.name.toLowerCase().includes(term) || (t.code || "").toLowerCase().includes(term);
      return leagueOk && searchOk;
    });
  }, [q, leagueId]);

  const emptyTitle = q.trim() ? "Nenhum time encontrado" : "Nenhum time";
  const emptyDescription = q.trim()
    ? `Nada para “${q.trim()}”${activeLeague ? ` em ${activeLeague.name}` : ""}. Tente outro nome ou sigla.`
    : activeLeague
      ? `${activeLeague.name} ainda não tem times mockados — em breve.`
      : "Nenhum time cadastrado.";

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Times"
        hint={`${MOCK_TEAMS.length} times · ${LEAGUES.length} ligas · estatísticas completas e fraquezas defensivas`}
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
            {LEAGUES.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </div>
      </SectionTitle>

      {/* Lista de ligas selecionável (sincronizada com o <select> acima) */}
      <div className="flex flex-wrap gap-2">
        {[
          { id: "all", label: "Todas as ligas", count: MOCK_TEAMS.length },
          ...LEAGUES.map((l) => ({ id: l.id, label: l.short_name, count: leagueTeamCount(l.id) })),
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
            <TeamCard key={t.id} t={t} league={LEAGUES.find((l) => l.id === t.league_id)!} />
          ))}
        </div>
      )}
    </div>
  );
}
