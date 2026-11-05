import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { EmptyState, SectionTitle, TeamLogo } from "../components/ui";
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

function PlayerRow({ p }: { p: Player }) {
  // Estatística mais recente (maior season_id) do escopo geral.
  const s = [...p.statistics.filter((x: any) => x.scope === "overall")]
    .sort((a, b) => (b.season_id ?? 0) - (a.season_id ?? 0))[0];
  return (
    <Link to={`/players/${p.id}`} className="sv-card block hover:bg-sv-panel2 transition">
      <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,0.9fr)_minmax(0,0.8fr)_minmax(0,1.4fr)] gap-x-3 gap-y-2 items-center">
        <div className="col-span-2 sm:col-span-1 flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-full bg-sv-panel2 grid place-items-center text-xs font-semibold border border-sv-border shrink-0">
            {(p.display_name || p.last_name).slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="font-medium truncate">{p.display_name || `${p.first_name || ""} ${p.last_name}`.trim()}</div>
            <div className="text-[11px] text-sv-muted truncate">{p.country || "—"} · {positionLabel(p.position)}</div>
          </div>
        </div>
        <div className="col-span-2 sm:col-span-1 flex items-center gap-2 min-w-0">
          {p.team_name ? (
            <>
              <TeamLogo name={p.team_name} src={p.team_logo_url} className="w-6 h-6" />
              <div className="min-w-0">
                <div className="text-sm truncate">{p.team_name}</div>
                {p.league_name && <div className="text-[11px] text-sv-muted truncate">{p.league_name}</div>}
              </div>
            </>
          ) : (
            <span className="text-xs text-sv-muted">Sem time</span>
          )}
        </div>
        <div className="col-span-2 sm:col-span-1 grid grid-cols-3 gap-1 text-xs text-center">
          <div>
            <div className="sv-stat-k">J</div><div className="sv-stat-v text-sm">{s?.matches_played ?? "—"}</div>
          </div>
          <div>
            <div className="sv-stat-k">Min</div><div className="sv-stat-v text-sm">{s?.minutes_played ?? "—"}</div>
          </div>
          <div>
            <div className="sv-stat-k">G/A</div>
            <div className="sv-stat-v text-sm text-sv-accent3">{s ? `${s.goals}/${s.assists}` : "—"}</div>
          </div>
        </div>
        <div className="col-span-2 sm:col-span-1 grid grid-cols-3 gap-2 text-xs text-right">
          <div>
            <div className="sv-stat-k">Chutes/90</div>
            <div className="font-mono">{s?.shots_per_90?.toFixed(2) ?? "—"}</div>
          </div>
          <div>
            <div className="sv-stat-k">xG/90</div>
            <div className="font-mono text-sv-accent3">{s?.xg_per_90?.toFixed(2) ?? "—"}</div>
          </div>
          <div>
            <div className="sv-stat-k">xA/90</div>
            <div className="font-mono">{s?.xa_per_90?.toFixed(2) ?? "—"}</div>
          </div>
        </div>
      </div>
    </Link>
  );
}

export default function PlayersPage() {
  const [q, setQ] = useState("");
  const [pos, setPos] = useState("");
  const [league, setLeague] = useState(""); // "" = todas as 5 ligas
  const [order, setOrder] = useState<PlayerOrder>("minutes");
  // Paginação incremental: 50 por vez (limite do backend), "Carregar mais" acrescenta.
  const [pages, setPages] = useState(1);
  const PAGE_SIZE = 50;
  const qry = useQuery({
    queryKey: ["players", q, pos, league, order, pages],
    queryFn: () =>
      listPlayers({
        q, position: pos, order, skip: 0, limit: pages * PAGE_SIZE,
        // Só jogadores de times das 5 ligas.
        top5: true, league: league || undefined,
      }),
    placeholderData: (prev) => prev,
  });

  const resetAnd = (fn: () => void) => { setPages(1); fn(); };
  const hasMore = (qry.data?.length ?? 0) >= pages * PAGE_SIZE;

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Jogadores"
        hint={`${qry.data?.length ?? 0} atletas no resultado atual · só times das 5 ligas (${LEAGUES.map((l) => l.code).join(", ")}). Cadastro não significa que existam estatísticas individuais.`}
      >
        <div className="flex gap-2 flex-wrap">
          <input value={q} onChange={(e) => resetAnd(() => setQ(e.target.value))} placeholder="Buscar jogador…" className="sv-btn !py-1.5 md:w-56 text-left" />
          <select value={pos} onChange={(e) => resetAnd(() => setPos(e.target.value))}
            className="sv-btn !py-1.5 bg-sv-panel text-sv-text">
            {POSITIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
          <select value={order} onChange={(e) => resetAnd(() => setOrder(e.target.value as PlayerOrder))}
            className="sv-btn !py-1.5 bg-sv-panel text-sv-text">
            {ORDERS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </SectionTitle>

      {/* filtro por liga */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {[{ code: "", label: "Todas" }, ...LEAGUES].map((l) => (
          <button
            key={l.code || "all"}
            onClick={() => resetAnd(() => setLeague(l.code))}
            className={league === l.code ? "sv-chip-accent whitespace-nowrap" : "sv-chip whitespace-nowrap hover:bg-sv-panel"}
          >
            {l.label}
          </button>
        ))}
      </div>

      {qry.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 12 }).map((_, i) => <div key={i} className="sv-card h-[72px] skeleton" />)}</div>
      ) : qry.isError ? (
        <EmptyState title="Não foi possível carregar os jogadores" description="Verifique a conexão com a API e tente novamente." />
      ) : !qry.data?.length ? (
        <EmptyState
          title="Nenhum jogador encontrado"
          description="Tente outros filtros. Só aparecem jogadores ligados a times das 5 ligas; se a lista estiver vazia, sincronize os elencos (football-data) e o Understat."
        />
      ) : (
        <>
          <div className="space-y-2">
            {qry.data.map((p) => <PlayerRow key={p.id} p={p} />)}
          </div>
          <div className="flex justify-center pt-1">
            {qry.isFetching ? (
              <div className="sv-card h-10 w-48 skeleton" />
            ) : hasMore ? (
              <button className="sv-btn" onClick={() => setPages((n) => n + 1)}>
                Carregar mais ({qry.data.length} exibidos)
              </button>
            ) : (
              <span className="sv-chip">Fim da lista · {qry.data.length} jogadores</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
