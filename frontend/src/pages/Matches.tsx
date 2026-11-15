import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { EmptyState, ErrorState, Segmented } from "../components/ui";
import { MatchRow, MatchRowsSkeleton } from "../components/MatchRow";
import { listMatches } from "../api/client";
import type { Match } from "../api/client";
import { dayKey, formatDay, matchPhase } from "../lib/matchStatus";

type Scope = "upcoming" | "recent" | "all";
const PAGE = 40;

/** Remove acentos/caixa para a busca por time ser tolerante. */
function norm(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export default function MatchesPage() {
  const [params, setParams] = useSearchParams();
  const requestedScope = params.get("scope");
  const initialScope: Scope =
    requestedScope === "recent" || requestedScope === "all" ? requestedScope : "upcoming";
  const [scope, setScope] = useState<Scope>(initialScope);
  const [search, setSearch] = useState("");
  const [competition, setCompetition] = useState("");
  const [visible, setVisible] = useState(PAGE);

  const q = useQuery({
    queryKey: ["matches", scope],
    queryFn: () => listMatches({ scope }),
    retry: 1, retryDelay: 600,
  });

  const changeScope = (s: Scope) => {
    setScope(s);
    setCompetition("");
    setVisible(PAGE);
    setParams(s === "upcoming" ? {} : { scope: s }, { replace: true });
  };

  const all = useMemo<Match[]>(() => q.data ?? [], [q.data]);

  // Competições presentes no resultado atual (dado real) para o filtro.
  const competitions = useMemo(
    () => Array.from(new Set(all.map((m) => m.competition_name).filter((c): c is string => !!c))).sort(),
    [all],
  );

  const filtered = useMemo(() => {
    const term = norm(search.trim());
    const rows = all.filter((m) => {
      if (competition && m.competition_name !== competition) return false;
      if (!term) return true;
      return norm(m.home_team.name).includes(term) || norm(m.away_team.name).includes(term)
        || norm(m.home_team.short_name || "").includes(term) || norm(m.away_team.short_name || "").includes(term);
    });
    // Próximas em ordem cronológica; resultados e "todas" do mais recente para o mais antigo.
    const dir = scope === "upcoming" ? 1 : -1;
    return [...rows].sort((a, b) => dir * (new Date(a.kickoff_time).getTime() - new Date(b.kickoff_time).getTime()));
  }, [all, search, competition, scope]);

  const shown = useMemo(() => filtered.slice(0, visible), [filtered, visible]);
  const clearFilters = () => { setSearch(""); setCompetition(""); setVisible(PAGE); };
  const groups = useMemo(() => {
    const map = new Map<string, Match[]>();
    for (const m of shown) {
      const k = dayKey(m.kickoff_time);
      const arr = map.get(k);
      if (arr) arr.push(m); else map.set(k, [m]);
    }
    return Array.from(map.entries());
  }, [shown]);

  const liveCount = all.filter((m) => matchPhase(m.status) === "live").length;
  const hasFilters = !!search || !!competition;

  return (
    <div className="space-y-4">
      {/* Barra de filtros */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <Segmented<Scope>
          label="Filtrar por período"
          value={scope}
          onChange={changeScope}
          options={[
            { key: "upcoming", label: "Próximas" },
            { key: "recent", label: "Resultados recentes" },
            { key: "all", label: "Todas" },
          ]}
        />
        <div className="flex flex-1 flex-col sm:flex-row gap-2 lg:justify-end">
          <label className="relative sm:w-64">
            <span className="sr-only">Buscar time</span>
            <svg viewBox="0 0 24 24" fill="none" width="16" height="16" stroke="currentColor" strokeWidth="2"
                 strokeLinecap="round" className="absolute left-3 top-1/2 -translate-y-1/2 text-sv-faint pointer-events-none" aria-hidden="true">
              <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
            </svg>
            <input type="search" value={search} onChange={(e) => { setSearch(e.target.value); setVisible(PAGE); }}
                   placeholder="Buscar time" className="sv-input w-full !pl-9" />
          </label>
          <label>
            <span className="sr-only">Filtrar por competição</span>
            <select value={competition} onChange={(e) => { setCompetition(e.target.value); setVisible(PAGE); }}
                    className="sv-input w-full sm:w-56" disabled={!competitions.length}>
              <option value="">Todas as competições</option>
              {competitions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-sv-muted min-h-[20px]" aria-live="polite">
        <span>
          {q.isSuccess && (
            <>
              <span className="sv-num text-sv-text font-semibold">{filtered.length}</span>{" "}
              {filtered.length === 1 ? "partida" : "partidas"}
              {hasFilters && all.length !== filtered.length ? ` de ${all.length}` : ""}
              {liveCount > 0 && <span className="ml-2 inline-flex items-center gap-1.5 text-sv-danger font-medium"><span className="sv-live-dot" aria-hidden="true" />{liveCount} ao vivo</span>}
            </>
          )}
        </span>
        {hasFilters && (
          <button type="button" className="text-sv-accent3 hover:underline" onClick={clearFilters}>
            Limpar filtros
          </button>
        )}
      </div>

      {q.isLoading ? (
        <MatchRowsSkeleton rows={10} />
      ) : q.isError ? (
        <ErrorState title="Não foi possível carregar as partidas"
                    description="A API está indisponível no momento. Tente novamente em instantes."
                    onRetry={() => q.refetch()} />
      ) : all.length === 0 ? (
        <EmptyState title="Nenhuma partida neste período"
          description="A API não retornou partidas para este filtro. Dados de demonstração não são exibidos como dados atuais." />
      ) : filtered.length === 0 ? (
        <EmptyState title="Nenhuma partida encontrada"
          description="Nenhum jogo corresponde à busca ou à competição selecionada."
          action={<button type="button" className="sv-btn" onClick={clearFilters}>Limpar filtros</button>} />
      ) : (
        <div className="space-y-4">
          {groups.map(([key, rows]) => (
            <section key={key} aria-label={formatDay(rows[0].kickoff_time)}>
              <h2 className="px-1 mb-1.5 text-sm font-semibold text-sv-text/90 capitalize">{formatDay(rows[0].kickoff_time)}</h2>
              <div className="sv-card overflow-hidden divide-y divide-sv-border/60">
                {rows.map((m) => <MatchRow key={m.id} m={m} showCompetition={!competition} />)}
              </div>
            </section>
          ))}
          {visible < filtered.length && (
            <div className="flex justify-center pt-1">
              <button type="button" className="sv-btn" onClick={() => setVisible((v) => v + PAGE)}>
                Mostrar mais ({filtered.length - visible} restantes)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
