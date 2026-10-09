import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Badge, EmptyState, SectionTitle, TeamLogo } from "../components/ui";
import { listMatches } from "../api/client";
import type { Match } from "../api/client";
import { MOCK_MATCHES } from "../api/mockData";

function filterByScope(list: Match[], scope: "upcoming" | "recent" | "all") {
  if (scope === "all") return list;
  const now = Date.now();
  return list.filter((m) => {
    const t = new Date(m.kickoff_time).getTime();
    return scope === "upcoming" ? m.status === "upcoming" || t > now : m.status === "finished" || t <= now;
  });
}

function formatDate(s: string) {
  const d = new Date(s);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", weekday: "short" })
    + " · " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function MatchRow({ m }: { m: Match }) {
  return (
    <Link to={`/matches/${m.id}`} className="sv-card block hover:bg-sv-panel2 transition">
      <div className="px-4 py-3 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <TeamLogo name={m.home_team.name} src={m.home_team.logo_url} />
          <div className="min-w-0">
            <div className="font-medium truncate">{m.home_team.name}</div>
          </div>
        </div>
        <div className="text-center min-w-[140px]">
          <div className="flex items-center justify-center gap-2">
            <Badge kind={m.status === "finished" ? "default" : "accent"}>{m.status}</Badge>
          </div>
          <div className="mt-1 font-mono font-semibold">
            {m.status === "finished" ? `${m.home_score}–${m.away_score}` : formatDate(m.kickoff_time)}
          </div>
          <div className="text-[11px] text-sv-muted truncate">{m.competition_name || ""}{m.matchday ? ` · Rodada ${m.matchday}` : ""}</div>
        </div>
        <div className="flex items-center gap-2 min-w-0 justify-end">
          <div className="min-w-0 text-right">
            <div className="font-medium truncate">{m.away_team.name}</div>
          </div>
          <TeamLogo name={m.away_team.name} src={m.away_team.logo_url} />
        </div>
      </div>
    </Link>
  );
}

export default function MatchesPage() {
  const [params] = useSearchParams();
  const initialScope: any = params.get("scope") || "upcoming";
  const [scope, setScope] = useState<"upcoming" | "recent" | "all">(initialScope);

  const q = useQuery({
    queryKey: ["matches", scope],
    queryFn: () => listMatches({ scope }),
    retry: 1, retryDelay: 600,
  });

  const scopes: { key: "upcoming" | "recent" | "all"; label: string }[] = [
    { key: "upcoming", label: "Próximas" },
    { key: "recent", label: "Resultados recentes" },
    { key: "all", label: "Todas" },
  ];

  // Fallback: dados demo + dados reais da API (football-data.org)
  const list = useMemo(() => {
    if (q.data && q.data.length) return q.data;
    if (q.isLoading || q.isFetching) return [];
    return filterByScope(MOCK_MATCHES, scope);
  }, [q.data, q.isLoading, q.isFetching, scope]);

  return (
    <div className="space-y-5">
      <SectionTitle title="Partidas" hint="Veja jogos, escalações e gere previsões contextuais pré-jogo">
        <div className="flex gap-1">
          {scopes.map((s) => (
            <button key={s.key}
              onClick={() => setScope(s.key)}
              className={[
                "sv-btn !py-1.5", scope === s.key ? "!bg-sv-accent !border-sv-accent3 text-white" : "",
              ].join(" ")}>
              {s.label} <span className="sv-chip ml-1.5 !py-0">{list.length}</span>
            </button>
          ))}
        </div>
      </SectionTitle>

      {q.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="sv-card h-[72px] skeleton" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState title="Nenhuma partida neste filtro" />
      ) : (
        <div className="space-y-2">
          {list.map((m) => <MatchRow key={m.id} m={m} />)}
        </div>
      )}
    </div>
  );
}
