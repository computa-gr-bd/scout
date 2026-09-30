import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  listMatches, generatePredictions, getMatchZones, getMatchAnalysis, type PlayerMatchPrediction,
  type ZoneOpportunity, type MatchupScore, type Match,
} from "../api/client";
import {
  MOCK_MATCHES, MOCK_MATCH_ANALYSIS, MOCK_HOME_WEAKNESSES, MOCK_AWAY_WEAKNESSES, MOCK_PREDICTIONS,
} from "../api/mockData";
import { Badge, ConfidenceBadge, EmptyState, ProbabilityBar, SectionTitle, TeamLogo } from "../components/ui";
import { Pitch2D } from "../components/Pitch";
import { Pitch3D } from "../components/Pitch3D";
import { PitchStudio } from "../components/PitchStudio";
import { ScatterChart, Scatter, XAxis as SXAxis, YAxis as SYAxis, CartesianGrid, Tooltip as STooltip, ResponsiveContainer as SResponsiveContainer, ZAxis, Legend as SLegend } from "recharts";

function filterMatchesByScope(list: Match[], scope: "upcoming" | "recent" | "all") {
  if (scope === "all") return list;
  const now = Date.now();
  return list.filter((m) => {
    const t = new Date(m.kickoff_time).getTime();
    if (scope === "upcoming") return m.status === "upcoming" || t > now;
    return m.status === "finished" || t <= now;
  });
}

export default function AnalysisPage() {
  const { matchId } = useParams();
  const [params] = useSearchParams();
  const preTeam = params.get("team");
  const [scope, setScope] = useState<"upcoming" | "recent" | "all">("all");
  const [useMock, setUseMock] = useState(false);

  const matchesQuery = useQuery({
    queryKey: ["matches-analysis", scope],
    queryFn: () => listMatches({ scope }).catch(() => {
      setUseMock(true);
      return [] as Match[];
    }),
    retry: 1,
    retryDelay: 600,
  });

  useEffect(() => {
    if (!matchesQuery.isFetching && (!matchesQuery.data || matchesQuery.data.length === 0)) {
      setUseMock(true);
    }
  }, [matchesQuery.data, matchesQuery.isFetching]);

  const rawMatches = (matchesQuery.data && matchesQuery.data.length > 0)
    ? matchesQuery.data
    : filterMatchesByScope(MOCK_MATCHES, scope);

  const [selected, setSelected] = useState<number | null>(
    matchId ? Number(matchId) : (rawMatches.length ? rawMatches[0].id : MOCK_MATCHES[0].id)
  );

  useEffect(() => {
    if (!selected && rawMatches.length) setSelected(rawMatches[0].id);
  }, [rawMatches, selected]);

  const [view, setView] = useState<"2d" | "3d">("2d");
  const [target, setTarget] = useState<string>("shot");

  const analysisQuery = useQuery({
    queryKey: ["match-analysis", selected, useMock],
    enabled: !!selected,
    queryFn: () =>
      useMock
        ? Promise.resolve(MOCK_MATCH_ANALYSIS)
        : getMatchAnalysis(selected!).catch(() => { setUseMock(true); return MOCK_MATCH_ANALYSIS; }),
    retry: 0,
  });
  const analysis = analysisQuery.data || MOCK_MATCH_ANALYSIS;

  const zonesQuery = useQuery({
    queryKey: ["match-zones-analysis", selected, useMock],
    enabled: !!selected,
    queryFn: () =>
      useMock
        ? Promise.resolve({ home_team_weaknesses: MOCK_HOME_WEAKNESSES, away_team_weaknesses: MOCK_AWAY_WEAKNESSES } as any)
        : getMatchZones(selected!).catch(() => { setUseMock(true); return { home_team_weaknesses: MOCK_HOME_WEAKNESSES, away_team_weaknesses: MOCK_AWAY_WEAKNESSES }; }),
    retry: 0,
  });
  const zones = zonesQuery.data || { home_team_weaknesses: MOCK_HOME_WEAKNESSES, away_team_weaknesses: MOCK_AWAY_WEAKNESSES };

  const predsQuery = useQuery({
    queryKey: ["predictions", selected, useMock],
    enabled: !!selected,
    queryFn: () =>
      useMock
        ? Promise.resolve(MOCK_PREDICTIONS as any)
        : generatePredictions(selected!, {
            targets: ["shot", "shot_on_target", "goal", "goal_involvement"], include_matchups: true,
          }).catch(() => { setUseMock(true); return MOCK_PREDICTIONS as any; }),
    retry: 0,
  });
  const preds = predsQuery.data || MOCK_PREDICTIONS;

  const hw: Record<string, number> = {}; const aw: Record<string, number> = {};
  zones.home_team_weaknesses?.forEach((z: any) => { hw[z.zone] = z.weakness_score; });
  zones.away_team_weaknesses?.forEach((z: any) => { aw[z.zone] = z.weakness_score; });

  const targetPreds = useMemo(() =>
    (preds.predictions || []).filter((p: any) => p.target === target),
  [preds, target]);

  const oppZoneFlat: { zone: string; value: number; team: "home" | "away" }[] = [];
  (preds.predictions || []).filter((p: any) => p.target === "shot").forEach((p: any) => {
    (p.zone_opportunities || []).forEach((z: ZoneOpportunity) => {
      oppZoneFlat.push({ zone: z.zone as string, value: z.opportunity_score, team: p.venue === "home" ? "home" : "away" });
    });
  });

  const heatRows = targetPreds.slice(0, 8).map((p: any) => {
    const row: any = { player: p.player_name };
    (p.zone_opportunities || []).forEach((z: any) => { row[z.zone as string] = +(z.opportunity_score * 100).toFixed(0); });
    return row;
  });
  const zoneCols = ["central_box", "outside_box_central", "outside_box_left", "outside_box_right",
    "opp_left_channel", "opp_right_channel", "opp_central_midfield", "opp_left_flank", "opp_right_flank"];

  const scatter = targetPreds.slice(0, 40).map((p: any) => ({
    name: p.player_name,
    x: +((p.zone_opportunities || []).reduce((a: number, z: any) => a + z.player_frequency, 0).toFixed(2)),
    y: +(p.probability * 100).toFixed(1),
    z: +((p.zone_opportunities || []).reduce((a: number, z: any) => a + z.opportunity_score, 0).toFixed(2)) * 200,
    venue: p.venue,
  }));

  const selMatch = rawMatches.find((m) => m.id === selected) || rawMatches[0] || MOCK_MATCHES[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Analysis studio</h1>
          <p className="text-sv-muted mt-1 text-sm">
            Pick a match · inspect weaknesses, player probabilities, heatmaps and matchups.
            {useMock && (
              <span className="inline-flex items-center gap-1.5 ml-2 sv-chip-accent">
                <span className="w-1.5 h-1.5 rounded-full bg-sv-accent3 animate-pulse"/>
                Modo DEMO · dados simulados
              </span>
            )}
          </p>
        </div>
        {!useMock && (
          <button onClick={() => setUseMock(true)} className="sv-btn !py-1.5 text-[12px]">
            Carregar dados demo
          </button>
        )}
      </div>

      <div className="grid lg:grid-cols-[320px_1fr] gap-5">
        <div className="sv-card">
          <div className="sv-card-inner">
            <SectionTitle title="Matches" hint={useMock ? "5 partidas simuladas" : "Escolha para analisar"}>
              <div className="flex gap-1">
                {(["all", "upcoming", "recent"] as const).map((s) => (
                  <button key={s} onClick={() => setScope(s)}
                    className={`sv-btn !py-1 text-[11px] capitalize ${scope === s ? "!bg-sv-accent text-white !border-sv-accent3" : ""}`}>{s}</button>
                ))}
              </div>
            </SectionTitle>
            <div className="space-y-2 max-h-[640px] overflow-auto pr-1">
              {(rawMatches || []).slice(0, 40).map((m: Match) => (
                <button key={m.id}
                  onClick={() => setSelected(m.id)}
                  className={[
                    "w-full text-left sv-card transition p-3",
                    selected === m.id ? "sv-ring !bg-sv-panel2" : "hover:bg-sv-panel2",
                  ].join(" ")}>
                  <div className="text-[10px] text-sv-muted mb-1.5 flex justify-between">
                    <span>{m.competition_name || "League"}</span>
                    <Badge kind={m.status === "finished" ? "default" : "accent"}>{m.status}</Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <TeamLogo name={m.home_team.name} className="w-8 h-8" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{m.home_team.name}</div>
                      <div className="text-sm font-medium truncate">{m.away_team.name}</div>
                    </div>
                    <div className="text-right font-mono text-xs">
                      {m.status === "finished" ? `${m.home_score}–${m.away_score}` : new Date(m.kickoff_time).toLocaleDateString()}
                    </div>
                    <TeamLogo name={m.away_team.name} className="w-8 h-8" />
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-5 min-w-0">
          {!selected ? (
            <>
              <PitchStudio />
              <EmptyState title="Selecione uma partida ao lado para análise detalhada"
                description="O PitchStudio acima já está funcionando com dados simulados. Clique em qualquer jogo na lista para carregar análises de zona, previsões e matchups." />
            </>
          ) : (
            <>
              <div>
                <SectionTitle title="Campo · ScoutVision Studio"
                  hint={selMatch ? `${selMatch.home_team.name} vs ${selMatch.away_team.name}` : "Mapa de calor, chutes, gols e posições · dados simulados"}
                  right={
                    <div className="flex gap-1">
                      <button onClick={() => setView("2d")} className={`sv-btn !py-1.5 text-[11.5px] ${view === "2d" ? "!bg-sv-accent text-white !border-sv-accent3" : ""}`}>Zonas 2D</button>
                      <button onClick={() => setView("3d")} className={`sv-btn !py-1.5 text-[11.5px] ${view === "3d" ? "!bg-sv-accent text-white !border-sv-accent3" : ""}`}>3D</button>
                    </div>
                  } />
                <PitchStudio />
              </div>

              {view !== "3d" ? (
                <div>
                  <SectionTitle title="Análise de zonas · vulnerabilidades defensivas"
                    hint="Visão clássica: fraquezas por zona + melhores oportunidades ofensivas" />
                  <Pitch2D
                    homeWeakness={hw}
                    awayWeakness={aw}
                    opportunityZones={(preds.predictions || [])
                      .filter((p: any) => p.target === "shot")
                      .flatMap((p: PlayerMatchPrediction) =>
                        (p.zone_opportunities || []).slice(0, 3).map((z: ZoneOpportunity) => ({ zone: z.zone, value: z.opportunity_score })))}
                    title="Zonas defensivas (vermelho = fraqueza) · ofensivas (verde = oportunidade)"
                  />
                </div>
              ) : (
                <div>
                  <SectionTitle title="Visão 3D do gramado"
                    hint="Use o mouse para rotacionar, inclinar e dar zoom" />
                  <Pitch3D
                    title=""
                    homeWeakness={hw}
                    awayWeakness={aw}
                    opportunityZones={
                      (preds.predictions || []).filter((p: any) => p.target === "shot").flatMap((p: any) =>
                        (p.zone_opportunities || []).slice(0, 2).map((z: any) => ({ zone: z.zone, value: z.opportunity_score }))).slice(0, 40)
                    }
                  />
                </div>
              )}

              <div className="sv-card">
                <div className="sv-card-inner space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold">Player event probabilities</div>
                      <div className="text-xs text-sv-muted">Vertical line = baseline probability</div>
                    </div>
                    <div className="flex gap-1">
                      {["shot", "shot_on_target", "goal", "goal_involvement"].map((t) => (
                        <button key={t} onClick={() => setTarget(t)}
                          className={`sv-btn !py-1.5 capitalize ${target === t ? "!bg-sv-accent text-white !border-sv-accent3" : ""}`}>
                          {t.replace("_", " ")}
                        </button>
                      ))}
                    </div>
                  </div>
                  {targetPreds.length === 0 ? (
                    <EmptyState title="No predictions for this target yet" />
                  ) : (
                    <div className="space-y-2.5">
                      {targetPreds.slice(0, 20).map((p: any, i: number) => (
                        <div key={`${p.player_id}-${i}`} className="sv-card">
                          <div className="p-3 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="sv-chip">#{i + 1}</span>
                                <Link to={`/players/${p.player_id}`} className="font-semibold hover:text-sv-accent3 truncate">{p.player_name}</Link>
                                <Badge kind="default">{p.venue}</Badge>
                              </div>
                              <ConfidenceBadge c={p.confidence} />
                            </div>
                            <ProbabilityBar p={p.probability} baseline={p.baseline_probability} />
                            <div className="flex flex-wrap gap-1.5">
                              {(p.positive_factors || []).slice(0, 4).map((f: any) => (
                                <span key={f.feature} className="sv-chip-accent">{f.factor}</span>
                              ))}
                              {(p.negative_factors || []).slice(0, 3).map((f: any) => (
                                <span key={f.feature} className="sv-chip border-sv-warn/40 text-sv-warn">{f.factor}</span>
                              ))}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="grid lg:grid-cols-2 gap-5">
                <div className="sv-card">
                  <div className="sv-card-inner">
                    <SectionTitle title="Opportunity × Frequency scatter"
                      hint="Each bubble = a player · x = zone frequency · y = probability · size = total opportunity" />
                    <div className="h-80">
                      <SResponsiveContainer>
                        <ScatterChart margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
                          <CartesianGrid stroke="#22314f" />
                          <SXAxis type="number" dataKey="x" name="Zone freq" stroke="#8794ad" fontSize={10} />
                          <SYAxis type="number" dataKey="y" name="Prob %" stroke="#8794ad" fontSize={10} />
                          <ZAxis type="number" dataKey="z" range={[40, 400]} name="Opportunity" />
                          <STooltip cursor={{ strokeDasharray: "3 3" }}
                            contentStyle={{ background: "#111a2b", border: "1px solid #22314f", borderRadius: 8 }} />
                          <SLegend />
                          <Scatter name="Home" data={scatter.filter((s) => s.venue === "home")} fill="#3b82f6" />
                          <Scatter name="Away" data={scatter.filter((s) => s.venue === "away")} fill="#e1534e" />
                        </ScatterChart>
                      </SResponsiveContainer>
                    </div>
                  </div>
                </div>
                <div className="sv-card">
                  <div className="sv-card-inner">
                    <SectionTitle title="Matchup engine: top edge matchups" />
                    <div className="space-y-2 max-h-80 overflow-auto pr-1">
                      {(preds.matchups || [] as MatchupScore[]).slice(0, 20).map((mu: any, i: number) => (
                        <div key={i} className="sv-card !p-3">
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <div className="flex items-center gap-2 text-sm min-w-0">
                              <Badge kind={mu.score > 0.55 ? "good" : "default"}>
                                {(mu.score * 100).toFixed(0)}%
                              </Badge>
                              <span className="font-medium truncate">
                                Att#{mu.attacker_id} vs Def#{mu.defender_id}
                              </span>
                            </div>
                            <span className="sv-chip">{mu.score > 0.55 ? "Attack edge" : "Defend edge"}</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="space-y-1">
                              <div className="sv-label">Attacker strengths</div>
                              {mu.strengths?.length ? mu.strengths.map((s: string, k: number) => (
                                <div key={k} className="sv-chip-accent">{s}</div>
                              )) : <div className="text-sv-muted">—</div>}
                            </div>
                            <div className="space-y-1 text-right">
                              <div className="sv-label">Defender weaknesses</div>
                              {mu.weaknesses?.length ? mu.weaknesses.map((s: string, k: number) => (
                                <div key={k} className="sv-chip border-sv-warn/40 text-sv-warn">{s}</div>
                              )) : <div className="text-sv-muted">—</div>}
                            </div>
                          </div>
                        </div>
                      ))}
                      {!preds.matchups?.length && <EmptyState title="No matchup data" />}
                    </div>
                  </div>
                </div>
              </div>

              <div className="sv-card">
                <div className="sv-card-inner">
                  <SectionTitle title="Player × Zone opportunity heatmap"
                    hint="Rows: top players · Columns: attacking zones · Brighter = higher opportunity (%)" />
                  {heatRows.length === 0 ? <EmptyState title="No data" /> : (
                    <div className="overflow-auto">
                      <table className="sv-table min-w-[820px]">
                        <thead>
                          <tr>
                            <th>Player</th>
                            {zoneCols.map((z) => (
                              <th key={z} className="text-right !py-3 whitespace-nowrap">
                                {z.replace(/_/g, " ").slice(0, 14)}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {heatRows.map((r, i) => (
                            <tr key={i}>
                              <td className="font-medium whitespace-nowrap">{r.player}</td>
                              {zoneCols.map((z) => {
                                const v = +(r[z] ?? 0);
                                const bg = v <= 0 ? "transparent"
                                  : `rgba(30, ${Math.round(130 + v * 1.2)}, ${Math.round(90 + v * 1.5)}, ${0.12 + Math.min(0.78, v / 100)})`;
                                return (
                                  <td key={z} className="text-right font-mono text-xs" style={{ background: bg }}>
                                    {v > 0 ? v.toFixed(0) : ""}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
