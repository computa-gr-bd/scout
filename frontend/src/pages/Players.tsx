 import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Badge, EmptyState, SectionTitle } from "../components/ui";
import { listPlayers, type Player } from "../api/client";

function PlayerRow({ p }: { p: Player }) {
  const s = p.statistics.find((x: any) => x.scope === "overall");
  return (
    <Link to={`/players/${p.id}`} className="sv-card block hover:bg-sv-panel2 transition">
      <div className="px-4 py-3 grid grid-cols-[1.2fr_0.6fr_0.8fr_1.5fr] gap-3 items-center">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-full bg-sv-panel2 grid place-items-center text-xs font-semibold border border-sv-border">
            {(p.display_name || p.last_name).slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="font-medium truncate">{p.display_name || `${p.first_name || ""} ${p.last_name}`.trim()}</div>
            <div className="text-[11px] text-sv-muted">{p.country || "—"} · {p.position || "—"}</div>
          </div>
        </div>
        <div><Badge kind="accent">{p.position || "—"}</Badge></div>
        <div className="grid grid-cols-3 gap-1 text-xs text-center">
          <div>
            <div className="sv-stat-k">J</div><div className="sv-stat-v text-sm">{s?.matches_played ?? 0}</div>
          </div>
          <div>
            <div className="sv-stat-k">Min</div><div className="sv-stat-v text-sm">{s?.minutes_played ?? 0}</div>
          </div>
          <div>
            <div className="sv-stat-k">G/A</div>
            <div className="sv-stat-v text-sm text-sv-accent3">{s?.goals ?? 0}/{s?.assists ?? 0}</div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs text-right">
          <div>
            <div className="sv-stat-k">Chutes/90</div>
            <div className="font-mono">{(s?.shots_per_90 ?? 0).toFixed(2)}</div>
          </div>
          <div>
            <div className="sv-stat-k">xG/90</div>
            <div className="font-mono text-sv-accent3">{(s?.xg_per_90 ?? 0).toFixed(2)}</div>
          </div>
          <div>
            <div className="sv-stat-k">xA/90</div>
            <div className="font-mono">{(s?.xa_per_90 ?? 0).toFixed(2)}</div>
          </div>
        </div>
      </div>
    </Link>
  );
}

export default function PlayersPage() {
  const [q, setQ] = useState("");
  const [pos, setPos] = useState("");
  // Paginação incremental: 50 por vez (limite do backend), "Carregar mais" acrescenta.
  const [pages, setPages] = useState(1);
  const PAGE_SIZE = 50;
  const qry = useQuery({
    queryKey: ["players", q, pos, pages],
    queryFn: () => listPlayers({ q, position: pos, skip: 0, limit: pages * PAGE_SIZE }),
  });

  const resetAnd = (fn: () => void) => { setPages(1); fn(); };
  const hasMore = (qry.data?.length ?? 0) >= pages * PAGE_SIZE;

  return (
    <div className="space-y-5">
      <SectionTitle title="Jogadores" hint={`${qry.data?.length ?? 0} perfis scoutados com zonas, forma e APIs de probabilidade contextual`}>
        <div className="flex gap-2 flex-wrap">
          <input value={q} onChange={(e) => resetAnd(() => setQ(e.target.value))} placeholder="Buscar jogador…" className="sv-btn !py-1.5 md:w-56 text-left" />
          <select value={pos} onChange={(e) => resetAnd(() => setPos(e.target.value))}
            className="sv-btn !py-1.5 bg-sv-panel text-sv-text">
            <option value="">Todas as posições</option>
            {["GK", "CB", "LB", "RB", "CDM", "CM", "CAM", "LW", "RW", "ST", "FW", "MID"].map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
      </SectionTitle>

      {qry.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 12 }).map((_, i) => <div key={i} className="sv-card h-[72px] skeleton" />)}</div>
      ) : !qry.data?.length ? (
        <EmptyState title="Nenhum jogador encontrado" description="Tente outros filtros ou rode o seeder do backend." />
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
