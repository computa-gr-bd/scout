import { useEffect, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { EmptyState, ErrorState, Segmented, Skeleton, TeamLogo } from "../components/ui";
import { listPlayers, type Player, type PlayerOrder } from "../api/client";
import { positionLabel } from "../lib/positionLabel";

/** As 5 ligas do projeto (mesmos códigos da tela de Times / Understat). */
const LEAGUES: { code: string; label: string }[] = [
  { code: "PL", label: "Premier League" },
  { code: "PD", label: "La Liga" },
  { code: "BL1", label: "Bundesliga" },
  { code: "SA", label: "Serie A" },
  { code: "FL1", label: "Ligue 1" },
];

const POSITIONS: { value: string; label: string }[] = [
  { value: "", label: "Todas as posições" },
  { value: "GK", label: "Goleiros" },
  { value: "DEF", label: "Defensores" },
  { value: "MID", label: "Meio-campistas" },
  { value: "ATT", label: "Atacantes" },
];

const ORDERS: { value: PlayerOrder; label: string }[] = [
  { value: "minutes", label: "Mais minutos" },
  { value: "goals", label: "Mais gols" },
  { value: "assists", label: "Mais assistências" },
  { value: "xg", label: "Maior xG" },
  { value: "name", label: "Nome (A–Z)" },
];

/** Cor do selo de posição por grupo (apenas leitura rápida; o texto continua sendo a informação). */
function posTone(position: string | null | undefined): string {
  const k = (position ?? "").toLowerCase();
  if (/^(g|gk|goalkeeper|keeper)/.test(k)) return "text-sv-warn border-sv-warn/40 bg-sv-warn/10";
  if (/^(d|df|def|defen|centre-back|center-back|left-back|right-back)/.test(k)) return "text-sv-info border-sv-info/40 bg-sv-info/10";
  if (/^(m|mf|mid|defensive|central|attacking|left mid|right mid)/.test(k)) return "text-sv-accent3 border-sv-accent3/40 bg-sv-accent/10";
  if (k) return "text-sv-danger border-sv-danger/40 bg-sv-danger/10";
  return "text-sv-muted border-sv-border bg-sv-panel2";
}

function PlayerRow({ p, order }: { p: Player; order: PlayerOrder }) {
  const navigate = useNavigate();
  // Estatística mais recente (maior season_id) do escopo geral.
  const s = [...p.statistics.filter((x: any) => x.scope === "overall")]
    .sort((a, b) => (b.season_id ?? 0) - (a.season_id ?? 0))[0];
  const partial = !s?.minutes_played ? p.pitchapi_summary : null;
  const total = (key: string) => partial?.totals[key]?.value;
  const coverage = (key: string) => {
    const metric = partial?.totals[key];
    return metric && partial ? `Dados em ${metric.matches} de ${partial.matches} partidas PitchAPI` : undefined;
  };
  const per90 = (key: string) => {
    const metric = partial?.totals[key];
    const minutes = partial?.totals.minutes_played;
    if (!partial || !metric || !minutes || minutes.value <= 0 ||
        metric.matches !== partial.matches || minutes.matches !== partial.matches) return null;
    return metric.value * 90 / minutes.value;
  };
  const name = p.display_name || `${p.first_name || ""} ${p.last_name}`.trim();
  // A coluna usada na ordenação ganha destaque.
  const hl = (k: PlayerOrder) => (order === k ? "text-sv-accent3 font-semibold" : "");
  return (
    <tr className="cursor-pointer" onClick={() => navigate(`/players/${p.id}`)}>
      <td>
        <Link to={`/players/${p.id}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-3 min-w-0 hover:text-sv-accent3 transition-colors">
          <span className="w-8 h-8 rounded-md bg-sv-panel2 grid place-items-center text-[11px] font-semibold border border-sv-border shrink-0" aria-hidden="true">
            {(p.display_name || p.last_name).slice(0, 2).toUpperCase()}
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block font-semibold truncate">{name}</span>
            {p.country && <span className="block text-[11px] text-sv-muted truncate">{p.country}</span>}
            {partial && <span className="block text-[11px] text-sv-muted"
              title={`${partial.competition} · ${partial.matches} partidas registradas`}>PitchAPI · parcial</span>}
          </span>
        </Link>
      </td>
      <td className="whitespace-nowrap">
        {p.position
          ? <span className={`inline-block rounded-sm border px-1.5 py-0.5 text-[11px] font-medium ${posTone(p.position)}`}>{positionLabel(p.position)}</span>
          : <span className="text-sv-faint">—</span>}
      </td>
      <td className="hidden md:table-cell">
        {p.team_name ? (
          <span className="flex items-center gap-2 min-w-0">
            <TeamLogo name={p.team_name} src={p.team_logo_url} className="w-6 h-6" />
            <span className="min-w-0 leading-tight">
              <span className="block text-sm truncate">{p.team_name}</span>
              {p.league_name && <span className="block text-[11px] text-sv-muted truncate">{p.league_name}</span>}
            </span>
          </span>
        ) : <span className="text-xs text-sv-muted">Sem time</span>}
      </td>
      <td className="text-right sv-num hidden sm:table-cell">{partial ? partial.matches : s?.matches_played ?? "—"}</td>
      <td className={`text-right sv-num hidden sm:table-cell ${hl("minutes")}`} title={coverage("minutes_played")}>{partial ? total("minutes_played") ?? "—" : s?.minutes_played ?? "—"}</td>
      <td className={`text-right sv-num ${hl("goals")}`} title={coverage("goals")}>{partial ? total("goals") ?? "—" : s?.goals ?? "—"}</td>
      <td className={`text-right sv-num ${hl("assists")}`} title={coverage("assists")}>{partial ? total("assists") ?? "—" : s?.assists ?? "—"}</td>
      <td className="text-right sv-num hidden lg:table-cell">{partial ? per90("shots")?.toFixed(2) ?? "—" : s?.shots_per_90?.toFixed(2) ?? "—"}</td>
      <td className={`text-right sv-num ${order === "xg" ? "text-sv-accent3 font-semibold" : "text-sv-accent3"}`}>{partial ? per90("xg")?.toFixed(2) ?? "—" : s?.xg_per_90?.toFixed(2) ?? "—"}</td>
      <td className="text-right sv-num hidden lg:table-cell">{partial ? per90("xa")?.toFixed(2) ?? "—" : s?.xa_per_90?.toFixed(2) ?? "—"}</td>
    </tr>
  );
}

export default function PlayersPage() {
  const [q, setQ] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [pos, setPos] = useState("");
  const [league, setLeague] = useState(""); // "" = todas as 5 ligas
  const [order, setOrder] = useState<PlayerOrder>("minutes");
  useEffect(() => {
    const timer = window.setTimeout(() => setSearchTerm(q.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [q]);

  const PAGE_SIZE = 50;
  const qry = useInfiniteQuery({
    queryKey: ["players", searchTerm, pos, league, order],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      listPlayers({
        q: searchTerm, position: pos, order, skip: pageParam, limit: PAGE_SIZE,
        top5: true, league: league || undefined,
      }),
    getNextPageParam: (lastPage, pages) =>
      lastPage.length < PAGE_SIZE ? undefined : pages.length * PAGE_SIZE,
  });
  const players = qry.data?.pages.flat() ?? [];

  return (
    <div className="space-y-4">
      {/* Barra de filtros */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="overflow-x-auto max-w-full">
          <Segmented<string>
            label="Filtrar por liga"
            value={league}
            onChange={setLeague}
            options={[{ key: "", label: "Todas" }, ...LEAGUES.map((l) => ({ key: l.code, label: l.label }))]}
          />
        </div>
        <div className="flex flex-1 flex-col sm:flex-row gap-2 lg:justify-end">
          <label className="relative sm:w-56">
            <span className="sr-only">Buscar jogador</span>
            <svg viewBox="0 0 24 24" fill="none" width="16" height="16" stroke="currentColor" strokeWidth="2"
                 strokeLinecap="round" className="absolute left-3 top-1/2 -translate-y-1/2 text-sv-faint pointer-events-none" aria-hidden="true">
              <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
            </svg>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)}
                   placeholder="Buscar jogador" className="sv-input w-full !pl-9" />
          </label>
          <label>
            <span className="sr-only">Filtrar por posição</span>
            <select value={pos} onChange={(e) => setPos(e.target.value)} className="sv-input w-full sm:w-48">
              {POSITIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </label>
          <label>
            <span className="sr-only">Ordenar por</span>
            <select value={order} onChange={(e) => setOrder(e.target.value as PlayerOrder)} className="sv-input w-full sm:w-44">
              {ORDERS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        </div>
      </div>

      {qry.isLoading ? (
        <div className="sv-card p-3 space-y-2" aria-busy="true" aria-label="Carregando jogadores">
          {Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="h-11 w-full" />)}
        </div>
      ) : qry.isError && !qry.data ? (
        <ErrorState title="Não foi possível carregar os jogadores"
                    description="Verifique a conexão com a API e tente novamente." onRetry={() => qry.refetch()} />
      ) : !players.length ? (
        <EmptyState
          title="Nenhum jogador encontrado"
          description="Tente outros filtros. Só aparecem jogadores ligados a times das 5 ligas; se a lista estiver vazia, sincronize os elencos (football-data) e o Understat."
        />
      ) : (
        <>
          <p className="text-xs text-sv-muted">
            Dados PitchAPI são parciais e não entram na ordenação por estatísticas de temporada.
          </p>
          <div className="sv-card overflow-hidden">
            <div className="sv-table-wrap">
              <table className="sv-table">
                <caption className="sr-only">Jogadores das cinco ligas com estatísticas da temporada</caption>
                <thead>
                  <tr>
                    <th scope="col">Jogador</th>
                    <th scope="col">Posição</th>
                    <th scope="col" className="hidden md:table-cell">Time</th>
                    <th scope="col" className="text-right hidden sm:table-cell" title="Jogos">J</th>
                    <th scope="col" className="text-right hidden sm:table-cell" title="Minutos">Min</th>
                    <th scope="col" className="text-right" title="Gols">G</th>
                    <th scope="col" className="text-right" title="Assistências">A</th>
                    <th scope="col" className="text-right hidden lg:table-cell" title="Chutes por 90 minutos">Chutes/90</th>
                    <th scope="col" className="text-right" title="xG por 90 minutos">xG/90</th>
                    <th scope="col" className="text-right hidden lg:table-cell" title="xA por 90 minutos">xA/90</th>
                  </tr>
                </thead>
                <tbody>
                  {players.map((p) => <PlayerRow key={p.id} p={p} order={order} />)}
                </tbody>
              </table>
            </div>
          </div>
          <div className="flex justify-center pt-1">
            {qry.isFetchingNextPage ? (
              <Skeleton className="h-9 w-48" />
            ) : qry.hasNextPage ? (
              <button className="sv-btn" onClick={() => qry.fetchNextPage()}>
                {qry.isFetchNextPageError ? "Tentar carregar mais novamente" : `Carregar mais (${players.length} exibidos)`}
              </button>
            ) : (
              <span className="text-xs text-sv-muted">Fim da lista · {players.length} jogadores</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
