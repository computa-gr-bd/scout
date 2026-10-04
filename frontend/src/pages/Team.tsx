import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getTeam, getTeamStatistics, getTeamWeaknesses, listMatches, type DefensiveWeakness } from "../api/client";
import { Badge, EmptyState, ProbabilityBar, SectionTitle, StatCard, TeamLogo } from "../components/ui";
import { Pitch2D } from "../components/Pitch";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

export default function TeamPage() {
  const { id } = useParams();
  const teamId = Number(id);
  const t = useQuery({ queryKey: ["team", teamId], queryFn: () => getTeam(teamId) });
  const stats = useQuery({ queryKey: ["team-stats", teamId], queryFn: () => getTeamStatistics(teamId) });
  const weaknesses = useQuery({ queryKey: ["team-weaknesses", teamId], queryFn: () => getTeamWeaknesses(teamId) });
  const matches = useQuery({ queryKey: ["matches-team", teamId], queryFn: () => listMatches({ scope: "all", team_id: teamId }) });

  const s = stats.data?.[0];
  const form = s?.recent_form || [];
  const formData = form.map((r, i) => ({ i, pts: r.result === "W" ? 3 : r.result === "D" ? 1 : 0, label: r.result }));

  const weaknessMap: Record<string, number> = {};
  (weaknesses.data || []).forEach((w) => { weaknessMap[w.zone] = w.weakness_score; });

  return (
    <div className="space-y-6">
      {t.data ? (
        <div className="sv-card sv-ring">
          <div className="sv-card-inner flex flex-col md:flex-row items-start md:items-center gap-4">
            <TeamLogo name={t.data.name} className="w-16 h-16 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-bold tracking-tight">{t.data.name}</h1>
                <Badge>{t.data.code}</Badge>
                <Badge kind="accent">{t.data.country || "DemoLand"}</Badge>
              </div>
              <div className="text-sm text-sv-muted mt-1">Fundado em {t.data.founded || "—"} · Estádio: {(t.data as any).stadium?.name || "—"} ({(t.data as any).stadium?.capacity || "—"})</div>
            </div>
            <div className="flex gap-2">
              <Link to="/matches" className="sv-btn">Jogos</Link>
              <Link to={`/analysis?team=${teamId}`} className="sv-btn-primary">Analisar</Link>
            </div>
          </div>
        </div>
      ) : <EmptyState title="Carregando time" />}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <StatCard label="Partidas jogadas" value={s?.matches_played ?? "—"} sub={`${s?.wins ?? 0}V ${s?.draws ?? 0}E ${s?.losses ?? 0}D`} />
        <StatCard label="Pontos por jogo" value={s ? s.points_per_game.toFixed(2) : "—"} accent="sv-accent" sub={`GP ${(s?.goals_for ?? 0).toFixed(0)} · GC ${(s?.goals_against ?? 0).toFixed(0)}`} />
        <StatCard label="Ataque (xG/90)" value={s ? s.xg_per_90.toFixed(2) : "—"} accent="sv-accent" sub={`Chutes/90 ${(s?.shots_per_90 ?? 0).toFixed(1)}`} />
        <StatCard label="Defesa (xGA/90)" value={s ? s.xga_per_90.toFixed(2) : "—"} accent="sv-danger" sub={`Sofridos/90 ${(s?.goals_conceded_per_90 ?? 0).toFixed(2)}`} />
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <div className="sv-card">
          <div className="sv-card-inner">
            <SectionTitle title="Forma recente" hint="Últimos 5 jogos · 3 = vitória, 1 = empate, 0 = derrota" />
            <div className="h-56">
              <ResponsiveContainer>
                <BarChart data={formData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#22314f" />
                  <XAxis dataKey="label" stroke="#8794ad" fontSize={11} />
                  <YAxis stroke="#8794ad" fontSize={11} />
                  <Tooltip contentStyle={{ background: "#111a2b", border: "1px solid #22314f", borderRadius: 8 }} />
                  <Bar dataKey="pts" radius={[6, 6, 0, 0]} fill="#37b486" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex gap-2 mt-3">
              {form.map((r, i) => (
                <span key={i} className={`sv-pill ${r.result === "W" ? "bg-sv-accent2/20 text-sv-accent3" : r.result === "D" ? "bg-sv-warn/15 text-sv-warn" : "bg-sv-danger/15 text-sv-danger"}`}>{r.result}</span>
              ))}
            </div>
          </div>
        </div>
        <div className="sv-card">
          <div className="sv-card-inner">
            <SectionTitle title="Próximos jogos & recentes" />
            <div className="space-y-2 max-h-80 overflow-auto pr-1">
              {(matches.data || []).slice(0, 10).map((m) => (
                <Link key={m.id} to={`/matches/${m.id}`} className="sv-card block hover:bg-sv-panel2 transition">
                  <div className="px-4 py-2.5 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <TeamLogo name={m.home_team.name} className="w-8 h-8" />
                      <div className="truncate text-sm font-medium">{m.home_team.name}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-[10px] text-sv-muted">{new Date(m.kickoff_time).toLocaleDateString()}</div>
                      <div className="font-mono text-sm font-semibold">
                        {m.status === "finished" ? `${m.home_score}–${m.away_score}` : "VS"}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 min-w-0 justify-end">
                      <div className="text-right text-sm font-medium truncate">{m.away_team.name}</div>
                      <TeamLogo name={m.away_team.name} className="w-8 h-8" />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div>
        <SectionTitle title="Fraquezas defensivas por zona" hint="Zonas onde o time sofre mais chutes, xG e gols" />
        <Pitch2D
          awayWeakness={weaknessMap}
          title="Mapa de calor defensivo do time, na perspectiva do adversário (lado direito)"
        />
      </div>

      <div className="sv-card">
        <div className="sv-card-inner">
          <SectionTitle title="Ranking de fraquezas" hint="Maior = mais vulnerável" />
          <div className="space-y-2.5">
            {([...(weaknesses.data || [])] as DefensiveWeakness[])
              .sort((a, b) => b.weakness_score - a.weakness_score)
              .map((w, i) => (
                <div key={w.id}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <div className="flex items-center gap-2">
                      <span className="sv-chip">#{i + 1}</span>
                      <span className="font-medium capitalize">{(w.zone as string).replace(/_/g, " ")}</span>
                    </div>
                    <div className="text-sv-muted">
                      amostra {w.sample_size} · xGA {(w.xga_per_90).toFixed(2)} · gols {(w.goals_conceded_per_90).toFixed(2)}
                    </div>
                  </div>
                  <ProbabilityBar p={Math.min(1, w.weakness_score)} />
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
