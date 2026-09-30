import { Link, useParams } from "react-router-dom";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getMatch, getMatchAnalysis, getMatchZones, getMatchTactical,
  generatePredictions, type MatchAnalysis, type ZoneOpportunity, type PlayerMatchPrediction, type MatchupScore,
  listPlayers, getPlayerZones, getTeamWeaknesses,
} from "../api/client";
import { Badge, ConfidenceBadge, EmptyState, ProbabilityBar, SectionTitle, TeamLogo } from "../components/ui";
import { Pitch2D } from "../components/Pitch";
import { Pitch3D } from "../components/Pitch3D";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar } from "recharts";

function formatDateTime(s: string) {
  const d = new Date(s);
  return d.toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function MatchPage() {
  const { id } = useParams();
  const matchId = Number(id);
  const [view, setView] = useState<"2d" | "3d">("2d");
  const [targets, setTargets] = useState<string[]>(["shot", "goal"]);

  const match = useQuery({ queryKey: ["match", matchId], queryFn: () => getMatch(matchId) });
  const analysis = useQuery({ queryKey: ["match-analysis", matchId], queryFn: () => getMatchAnalysis(matchId) });
  const zones = useQuery({ queryKey: ["match-zones", matchId], queryFn: () => getMatchZones(matchId) });
  const tactical = useQuery({ queryKey: ["match-tactical", matchId], queryFn: () => getMatchTactical(matchId) });
  const players = useQuery({
    queryKey: ["players"], queryFn: () => listPlayers(),
  });

  const predictions = useQuery({
    queryKey: ["predictions-generate", matchId, targets.join(",")],
    enabled: !!matchId,
    queryFn: () => generatePredictions(matchId, {
      targets: targets as any, include_zone_details: true, include_matchups: true,
    }),
  });

  const a = analysis.data as MatchAnalysis | undefined;
  const radarData = useMemo(() => {
    if (!a) return [];
    const h = a.home_team_stats; const aw = a.away_team_stats;
    const mapTo100 = (v: number, max: number) => Math.min(100, Math.round((v / max) * 100));
    return [
      { metric: "Shots/90", home: mapTo100(h?.shots_per_90 || 0, 22), away: mapTo100(aw?.shots_per_90 || 0, 22) },
      { metric: "xG/90", home: mapTo100(h?.xg_per_90 || 0, 2.5), away: mapTo100(aw?.xg_per_90 || 0, 2.5) },
      { metric: "SOT/90", home: mapTo100(h?.shots_on_target_per_90 || 0, 10), away: mapTo100(aw?.shots_on_target_per_90 || 0, 10) },
      { metric: "Corners/90", home: mapTo100(h?.corners_per_90 || 0, 10), away: mapTo100(aw?.corners_per_90 || 0, 10) },
      { metric: "xGA/90 (inv)", home: mapTo100(Math.max(0, 3 - (h?.xga_per_90 || 0)), 3), away: mapTo100(Math.max(0, 3 - (aw?.xga_per_90 || 0)), 3) },
      { metric: "Pts/game", home: mapTo100(h?.points_per_game || 0, 3), away: mapTo100(aw?.points_per_game || 0, 3) },
    ];
  }, [a]);

  const keyStats = useMemo(() => {
    if (!a) return [];
    return [
      ["Shots /90", a.home_team_stats?.shots_per_90, a.away_team_stats?.shots_per_90],
      ["Shots on target /90", a.home_team_stats?.shots_on_target_per_90, a.away_team_stats?.shots_on_target_per_90],
      ["xG /90", a.home_team_stats?.xg_per_90, a.away_team_stats?.xg_per_90],
      ["xGA /90", a.home_team_stats?.xga_per_90, a.away_team_stats?.xga_per_90],
      ["Goals conceded /90", a.home_team_stats?.goals_conceded_per_90, a.away_team_stats?.goals_conceded_per_90],
      ["Corners /90", a.home_team_stats?.corners_per_90, a.away_team_stats?.corners_per_90],
      ["Points / game", a.home_team_stats?.points_per_game, a.away_team_stats?.points_per_game],
    ].map(([k, h, aw]) => [k, h ?? 0, aw ?? 0]) as any;
  }, [a]);

  const homeWeakness: Record<string, number> = {};
  const awayWeakness: Record<string, number> = {};
  zones.data?.home_team_weaknesses?.forEach((z: any) => { homeWeakness[z.zone] = z.weakness_score; });
  zones.data?.away_team_weaknesses?.forEach((z: any) => { awayWeakness[z.zone] = z.weakness_score; });

  const oppZones = predictions.data?.predictions
    ?.filter((p) => p.target === "shot")
    .flatMap((p: PlayerMatchPrediction) =>
      (p.zone_opportunities || []).slice(0, 2).map((z: ZoneOpportunity) => ({ zone: z.zone, value: z.opportunity_score }))
    ) || [];

  const playerById: Record<number, { display_name?: string | null; first_name?: string | null; last_name: string }> = {};
  (players.data || []).forEach((p) => {
    playerById[p.id] = p as any;
  });

  const predictionsByTarget: Record<string, PlayerMatchPrediction[]> = {};
  (predictions.data?.predictions || []).forEach((p) => {
    (predictionsByTarget[p.target] ||= []).push(p);
  });
  Object.values(predictionsByTarget).forEach((arr) => arr.sort((a, b) => b.probability - a.probability));

  const m: any = match.data;
  const homeId = m?.home_team?.id;
  const awayId = m?.away_team?.id;

  return (
    <div className="space-y-6">
      {/* header */}
      {m ? (
        <div className="sv-card sv-ring">
          <div className="px-5 py-5 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <TeamLogo name={m.home_team.name} className="w-14 h-14" />
              <div className="min-w-0">
                <div className="text-xl font-bold truncate">{m.home_team.name}</div>
                <div className="text-sm text-sv-muted">Home · {m.home_team.short_name || ""}</div>
              </div>
            </div>
            <div className="text-center min-w-[200px]">
              <div className="sv-chip mb-2">{m.competition_name || "League"} · {m.round_name || `MD ${m.matchday || "—"}`}</div>
              <div className="font-mono text-2xl md:text-3xl font-bold tabular-nums">
                {m.status === "finished" ? `${m.home_score}–${m.away_score}` : "VS"}
              </div>
              <div className="mt-1 text-xs text-sv-muted">{formatDateTime(m.kickoff_time)}</div>
              <div className="mt-0.5 text-[11px] text-sv-muted">Venue: {m.stadium_name || "—"} · Ref: {m.referee || "—"}</div>
              <div className="mt-2 flex items-center justify-center gap-2">
                <Link to={`/analysis/${matchId}`} className="sv-btn-primary">Open analysis</Link>
                <Link to={`/teams/${homeId}`} className="sv-btn">Home</Link>
                <Link to={`/teams/${awayId}`} className="sv-btn">Away</Link>
              </div>
            </div>
            <div className="flex items-center gap-3 min-w-0 justify-end">
              <div className="min-w-0 text-right">
                <div className="text-xl font-bold truncate">{m.away_team.name}</div>
                <div className="text-sm text-sv-muted">Away · {m.away_team.short_name || ""}</div>
              </div>
              <TeamLogo name={m.away_team.name} className="w-14 h-14" />
            </div>
          </div>
        </div>
      ) : (
        <EmptyState title="Loading match" />
      )}

      {/* key stats */}
      {keyStats.length > 0 && (
        <div className="sv-card">
          <div className="sv-card-inner">
            <SectionTitle title="Statistical comparison" hint="Season aggregates · per 90 minutes" />
            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-3">
                {keyStats.map(([k, h, aw]) => {
                  const sum = (h || 0) + (aw || 0) || 1;
                  return (
                    <div key={k}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <div className="text-right w-1/3 pr-2 font-mono tabular-nums">{(h as number).toFixed(2)}</div>
                        <div className="sv-label whitespace-nowrap">{k as string}</div>
                        <div className="w-1/3 pl-2 font-mono tabular-nums">{(aw as number).toFixed(2)}</div>
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        <div className="h-2 rounded-l-full overflow-hidden bg-sv-panel2">
                          <div className="h-full bg-blue-500" style={{ width: `${((h as number) / sum) * 100}%`, marginLeft: "auto" }} />
                        </div>
                        <div className="h-2 rounded-r-full overflow-hidden bg-sv-panel2">
                          <div className="h-full bg-sv-danger" style={{ width: `${((aw as number) / sum) * 100}%` }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="h-64">
                <ResponsiveContainer>
                  <RadarChart data={radarData}>
                    <PolarGrid stroke="#22314f" />
                    <PolarAngleAxis dataKey="metric" tick={{ fill: "#8794ad", fontSize: 11 }} />
                    <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: "#8794ad", fontSize: 10 }} axisLine={false} />
                    <Radar name={m?.home_team?.short_name || "Home"} dataKey="home" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.35} />
                    <Radar name={m?.away_team?.short_name || "Away"} dataKey="away" stroke="#e1534e" fill="#e1534e" fillOpacity={0.3} />
                    <Tooltip contentStyle={{ background: "#111a2b", border: "1px solid #22314f", borderRadius: 8 }} labelStyle={{ color: "#e6eaf2" }} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* recent form / H2H */}
      <div className="grid lg:grid-cols-2 gap-5">
        <div className="sv-card">
          <div className="sv-card-inner">
            <SectionTitle title="Head-to-head" hint="Last 6 meetings" />
            {a?.h2h_recent?.length ? (
              <table className="sv-table">
                <thead><tr><th>Date</th><th>Home</th><th className="text-center">Score</th><th>Away</th></tr></thead>
                <tbody>
                  {a.h2h_recent.map((h) => (
                    <tr key={h.match_id}>
                      <td className="text-xs text-sv-muted">{new Date(h.kickoff).toLocaleDateString()}</td>
                      <td className="font-medium text-right pr-4">
                        <Link to={`/teams/${h.home_id}`} className="hover:text-sv-accent3">{playersById[h.home_id]?.display_name || "Team " + h.home_id}</Link>
                      </td>
                      <td className="text-center font-mono">{h.home_score}–{h.away_score}</td>
                      <td className="font-medium pl-4">
                        <Link to={`/teams/${h.away_id}`} className="hover:text-sv-accent3">{playersById[h.away_id]?.display_name || "Team " + h.away_id}</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <EmptyState title="No H2H data" />}
          </div>
        </div>
        <div className="sv-card">
          <div className="sv-card-inner">
            <SectionTitle title="Matchup ratings" hint="Best attacker vs defender matchups" />
            {tactical.data?.matchups?.length ? (
              <table className="sv-table">
                <thead><tr><th>Attacker</th><th>Defender</th><th>Score</th><th>Edge</th></tr></thead>
                <tbody>
                  {tactical.data.matchups.slice(0, 10).map((mu: MatchupScore, i) => {
                    const a = playerById[mu.attacker_id]; const d = playerById[mu.defender_id];
                    const good = mu.score > 0.55;
                    return (
                      <tr key={i}>
                        <td>{a?.display_name || a?.last_name || "Att " + mu.attacker_id}</td>
                        <td>{d?.display_name || d?.last_name || "Def " + mu.defender_id}</td>
                        <td className="font-mono">{(mu.score * 100).toFixed(0)}%</td>
                        <td>
                          <Badge kind={good ? "good" : "default"}>
                            {good ? "Attacker edge" : "Defender edge"}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : <EmptyState title="No matchup data yet" description="Generate predictions to calculate matchups." />}
          </div>
        </div>
      </div>

      {/* Pitch visualization */}
      <div>
        <SectionTitle title="Pitch analysis"
          hint="Visualize defensive vulnerabilities & best opportunity zones"
          right={
            <div className="flex gap-1">
              <button onClick={() => setView("2d")} className={`sv-btn !py-1.5 ${view === "2d" ? "!bg-sv-accent text-white !border-sv-accent3" : ""}`}>2D</button>
              <button onClick={() => setView("3d")} className={`sv-btn !py-1.5 ${view === "3d" ? "!bg-sv-accent text-white !border-sv-accent3" : ""}`}>3D</button>
            </div>
          }
        />
        {view === "2d" ? (
          <Pitch2D
            homeWeakness={homeWeakness}
            awayWeakness={awayWeakness}
            opportunityZones={oppZones}
            title="2D heatmap · red = defensive weakness · green = player opportunity"
          />
        ) : (
          <Pitch3D
            title="3D pitch · use mouse to rotate/pan/zoom"
            homeWeakness={homeWeakness}
            awayWeakness={awayWeakness}
            opportunityZones={oppZones.slice(0, 24)}
          />
        )}
      </div>

      {/* Probability predictions */}
      <div className="sv-card">
        <div className="sv-card-inner space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-semibold">Player predictions</div>
              <div className="text-xs text-sv-muted">Context-dependent, opponent-aware probabilities · select targets</div>
            </div>
            <div className="flex gap-1">
              {[
                { k: "shot", label: "1+ shot" },
                { k: "shot_on_target", label: "1+ SoT" },
                { k: "goal", label: "Goal" },
                { k: "goal_involvement", label: "Goal inv." },
              ].map((t) => (
                <button key={t.k}
                  onClick={() => setTargets(targets.includes(t.k) ? targets.filter((x) => x !== t.k) : [...targets, t.k])}
                  className={`sv-btn !py-1.5 ${targets.includes(t.k) ? "!bg-sv-accent text-white !border-sv-accent3" : ""}`}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {Object.keys(predictionsByTarget).length === 0 ? (
            <EmptyState title="No predictions yet" />
          ) : (
            <div className="grid md:grid-cols-2 gap-5">
              {Object.entries(predictionsByTarget).map(([t, arr]) => (
                <div key={t}>
                  <div className="flex items-center justify-between mb-2">
                    <Badge kind="accent">P(1+ {t.replace("_", " ")})</Badge>
                    <ConfidenceBadge c={arr[0]?.confidence || "medium"} />
                  </div>
                  <div className="space-y-3">
                    {arr.slice(0, 8).map((p, i) => (
                      <div key={`${t}-${i}-${p.player_id}`} className="sv-card">
                        <div className="p-3 space-y-2">
                          <div className="flex items-center justify-between gap-3">
                            <Link to={`/players/${p.player_id}`} className="font-medium hover:text-sv-accent3 min-w-0 truncate">
                              {i + 1}. {p.player_name}
                            </Link>
                            <span className="sv-chip">{p.venue}</span>
                          </div>
                          <ProbabilityBar p={p.probability} baseline={p.baseline_probability} />
                          {p.positive_factors.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 pt-1">
                              {p.positive_factors.slice(0, 4).map((f) => (
                                <span key={f.feature} className="sv-chip-accent !py-0">{f.factor}</span>
                              ))}
                            </div>
                          )}
                          {p.negative_factors.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {p.negative_factors.slice(0, 3).map((f) => (
                                <span key={f.feature} className="sv-chip !py-0 text-sv-warn border-sv-warn/40">{f.factor}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
