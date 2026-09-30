import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Badge, Bar, EmptyState, SectionTitle, StatCard, TeamLogo } from "../components/ui";
import { listTeams, getTeamWeaknesses, type Team } from "../api/client";

function TeamCard({ t }: { t: Team }) {
  const s = t.statistics.find((x) => x.scope === "overall");
  return (
    <Link to={`/teams/${t.id}`} className="sv-card block hover:bg-sv-panel2 transition">
      <div className="sv-card-inner">
        <div className="flex items-center gap-3 mb-3">
          <TeamLogo name={t.name} className="w-10 h-10" />
          <div className="min-w-0">
            <div className="font-semibold truncate">{t.name}</div>
            <div className="text-xs text-sv-muted">
              {t.code} · {t.country || "DemoLand"} · Est. {t.founded || "—"}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2 text-center">
          <div>
            <div className="sv-stat-k">MP</div>
            <div className="sv-stat-v">{s?.matches_played ?? 0}</div>
          </div>
          <div>
            <div className="sv-stat-k">Pts/GM</div>
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
      </div>
    </Link>
  );
}

export default function TeamsPage() {
  const [q, setQ] = useState("");
  const teams = useQuery({ queryKey: ["teams", q], queryFn: () => listTeams(q ? { q } : undefined) });

  return (
    <div className="space-y-5">
      <SectionTitle title="Teams" hint="20 teams · 2 leagues · full statistics and defensive weaknesses">
        <input
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search teams…"
          className="sv-btn !py-1.5 md:w-72 text-left"
        />
      </SectionTitle>

      {teams.isLoading ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
          {Array.from({ length: 9 }).map((_, i) => <div key={i} className="sv-card h-40 skeleton" />)}
        </div>
      ) : !teams.data?.length ? (
        <EmptyState title="No teams" />
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
          {teams.data.map((t) => <TeamCard key={t.id} t={t} />)}
        </div>
      )}
    </div>
  );
}
