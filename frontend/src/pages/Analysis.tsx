import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  listMatches, generatePredictions, getMatchZones, getMatchStudio, type PlayerMatchPrediction,
  type ZoneOpportunity, type MatchupScore, type Match,
} from "../api/client";
import {
  MOCK_MATCHES, MOCK_HOME_WEAKNESSES, MOCK_AWAY_WEAKNESSES, MOCK_PREDICTIONS,
} from "../api/mockData";
import { payloadToDataset } from "../api/studioReal";
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

/** Texto curto do motivo de uma falha de rede/API (para diagnóstico na tela). */
function describeError(err: unknown): string {
  const e = err as any;
  if (e?.code === "ECONNABORTED") return "tempo esgotado (a API demorou mais de 20 s)";
  if (e?.response?.status) return `a API respondeu ${e.response.status}${e.response.data?.detail ? ` — ${String(e.response.data.detail).slice(0, 120)}` : ""}`;
  if (e?.message) return String(e.message).slice(0, 140);
  return "erro desconhecido";
}

const EMPTY_ZONES = { home_team_weaknesses: [] as any[], away_team_weaknesses: [] as any[] };
const EMPTY_PREDS = { predictions: [] as any[], matchups: [] as any[] };

/** Partida padrão: a mais recente já finalizada (tem chutes/xG); senão a primeira da lista. */
function pickDefaultMatch(list: Match[]): number {
  const now = Date.now();
  const done = list.find((m) => m.status === "finished" && new Date(m.kickoff_time).getTime() <= now);
  return (done ?? list[0]).id;
}

export default function AnalysisPage() {
  const { matchId } = useParams();
  const [params] = useSearchParams();
  const preTeam = params.get("team");
  const [scope, setScope] = useState<"upcoming" | "recent" | "all">("all");
  // `forceDemo` só liga quando a pessoa pede (botão) — ou quando a API não devolve partida nenhuma.
  const [forceDemo, setForceDemo] = useState(false);

  const matchesQuery = useQuery({
    queryKey: ["matches-analysis", scope],
    queryFn: () => listMatches({ scope, limit: 60 }),
    retry: 1,
    retryDelay: 600,
  });
  const realMatches = useMemo(() => matchesQuery.data ?? [], [matchesQuery.data]);
  const demoMode = forceDemo || (!matchesQuery.isLoading && realMatches.length === 0);

  const rawMatches = useMemo(
    () => (demoMode ? filterMatchesByScope(MOCK_MATCHES, scope) : realMatches),
    [demoMode, realMatches, scope],
  );

  const [selected, setSelected] = useState<number | null>(matchId ? Number(matchId) : null);
  useEffect(() => {
    if (!rawMatches.length) return;
    if (selected != null && (rawMatches.some((m) => m.id === selected) || (matchId && selected === Number(matchId)))) return;
    setSelected(pickDefaultMatch(rawMatches));
  }, [rawMatches, selected, matchId]);

  const [view, setView] = useState<"2d" | "3d">("2d");
  const [target, setTarget] = useState<string>("shot");

  // Dados reais do Studio (Understat / StatsBomb / football-data) — nada simulado.
  const studioQuery = useQuery({
    queryKey: ["match-studio", selected],
    enabled: !!selected && !demoMode,
    queryFn: () => getMatchStudio(selected!),
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const studioDataset = useMemo(
    () => (studioQuery.data ? payloadToDataset(studioQuery.data) : null),
    [studioQuery.data],
  );

  // Zonas e previsões: no modo real, se o backend não tem como calcular, mostra vazio (nunca jogadores de exemplo).
  const zonesQuery = useQuery({
    queryKey: ["match-zones-analysis", selected, demoMode],
    enabled: !!selected,
    queryFn: async () => {
      if (demoMode) return { data: { home_team_weaknesses: MOCK_HOME_WEAKNESSES, away_team_weaknesses: MOCK_AWAY_WEAKNESSES } as any, ok: true };
      try { return { data: (await getMatchZones(selected!)) as any, ok: true }; }
      catch { return { data: EMPTY_ZONES as any, ok: false }; }
    },
    retry: 0,
  });
  const zones = zonesQuery.data?.data ?? EMPTY_ZONES;

  const predsQuery = useQuery({
    queryKey: ["predictions", selected, demoMode],
    enabled: !!selected,
    queryFn: async () => {
      if (demoMode) return { data: MOCK_PREDICTIONS as any, ok: true, reason: "" };
      try {
        return {
          data: (await generatePredictions(selected!, {
            targets: ["shot", "shot_on_target", "goal", "goal_involvement"], include_matchups: true,
          })) as any,
          ok: true,
          reason: "",
        };
      } catch (err) {
        const status = (err as any)?.response?.status;
        return {
          data: EMPTY_PREDS as any, ok: false,
          reason: status === 401 ? "É preciso entrar na conta (botão Entrar) para gerar previsões." : describeError(err),
        };
      }
    },
    retry: 0,
  });
  const preds = predsQuery.data?.data ?? EMPTY_PREDS;

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
  const studioReady = !demoMode && !!studioDataset;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Estúdio de análise</h1>
          <p className="text-sv-muted mt-1 text-sm">
            Escolha uma partida para consultar indicadores e visualizações. Probabilidades são estimativas baseline experimentais, não previsões validadas.
            {demoMode ? (
              <span className="inline-flex items-center gap-1.5 ml-2 sv-chip-accent">
                <span className="w-1.5 h-1.5 rounded-full bg-sv-accent3 animate-pulse"/>
                Modo DEMO · dados simulados
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 ml-2 sv-chip-accent">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"/>
                Dados reais · Understat / football-data / StatsBomb
              </span>
            )}
          </p>
        </div>
        {demoMode ? (
          realMatches.length > 0 && (
            <button onClick={() => setForceDemo(false)} className="sv-btn !py-1.5 text-[12px]">
              Voltar aos dados reais
            </button>
          )
        ) : (
          <button onClick={() => setForceDemo(true)} className="sv-btn !py-1.5 text-[12px]">
            Carregar dados demo
          </button>
        )}
      </div>

      <div className="grid lg:grid-cols-[320px_1fr] gap-5">
        <div className="sv-card">
          <div className="sv-card-inner">
            <SectionTitle title="Partidas" hint={demoMode ? `${rawMatches.length} partidas de exemplo` : `${rawMatches.length} partidas reais`}>
              <div className="flex gap-1">
                {([["all", "todas"], ["upcoming", "próximas"], ["recent", "recentes"]] as const).map(([s, label]) => (
                  <button key={s} onClick={() => setScope(s as any)}
                    className={`sv-btn !py-1 text-[11px] capitalize ${scope === s ? "!bg-sv-accent text-white !border-sv-accent3" : ""}`}>{label}</button>
                ))}
              </div>
            </SectionTitle>
            <div className="space-y-2 max-h-[640px] overflow-auto pr-1">
              {matchesQuery.isLoading && <div className="text-xs text-sv-muted p-3">Carregando partidas…</div>}
              {!matchesQuery.isLoading && rawMatches.length === 0 && (
                <div className="text-xs text-sv-muted p-3">Nenhuma partida neste filtro.</div>
              )}
              {(rawMatches || []).slice(0, 60).map((m: Match) => (
                <button key={m.id}
                  onClick={() => setSelected(m.id)}
                  className={[
                    "w-full text-left sv-card transition p-3",
                    selected === m.id ? "sv-ring !bg-sv-panel2" : "hover:bg-sv-panel2",
                  ].join(" ")}>
                  <div className="text-[10px] text-sv-muted mb-1.5 flex justify-between">
                    <span>{m.competition_name || "Liga"}</span>
                    <Badge kind={m.status === "finished" ? "default" : "accent"}>{m.status}</Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <TeamLogo name={m.home_team.name} src={m.home_team.logo_url} className="w-8 h-8" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{m.home_team.name}</div>
                      <div className="text-sm font-medium truncate">{m.away_team.name}</div>
                    </div>
                    <div className="text-right font-mono text-xs">
                      {m.status === "finished" ? `${m.home_score}–${m.away_score}` : new Date(m.kickoff_time).toLocaleDateString()}
                    </div>
                    <TeamLogo name={m.away_team.name} src={m.away_team.logo_url} className="w-8 h-8" />
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-5 min-w-0">
          {!selected ? (
            <>
              <EmptyState title="Selecione uma partida ao lado para análise detalhada"
                description="Escolha uma partida na lista para carregar o estúdio, as análises de zona, previsões e confrontos." />
            </>
          ) : (
            <>
              <div>
                <SectionTitle title="Campo · ScoutVision Studio"
                  hint={selMatch
                    ? `${selMatch.home_team.name} vs ${selMatch.away_team.name}`
                    : `Mapa de calor, chutes, gols e posições${demoMode ? " · dados simulados" : ""}`}
                />
                {demoMode ? (
                  <PitchStudio selectedMatch={selMatch} selectedMatchId={selected} />
                ) : studioQuery.isError ? (
                  <EmptyState
                    title="Não foi possível carregar os dados reais desta partida"
                    description={`Motivo: ${describeError(studioQuery.error)}. Tente novamente ou escolha outra partida.`}
                    action={<button className="sv-btn !py-1.5 text-[12px]" onClick={() => studioQuery.refetch()}>Tentar novamente</button>}
                  />
                ) : !studioReady ? (
                  <div className="sv-card"><div className="sv-card-inner text-sm text-sv-muted">Carregando dados reais da partida…</div></div>
                ) : (
                  <PitchStudio dataset={studioDataset} selectedMatch={selMatch} selectedMatchId={selected} />
                )}
              </div>

              {view !== "3d" ? (
                <div>
                  <SectionTitle title="Análise de zonas · vulnerabilidades defensivas"
                    hint="Visão clássica: fraquezas por zona + melhores oportunidades ofensivas"
                    right={
                      <div className="flex gap-1">
                        <button onClick={() => setView("2d")} aria-pressed={view === "2d"} className={`sv-btn !py-1.5 text-[11.5px] ${view === "2d" ? "!bg-sv-accent text-white !border-sv-accent3" : ""}`}>Mapa 2D</button>
                        <button onClick={() => setView("3d")} className="sv-btn !py-1.5 text-[11.5px]">Campo 3D</button>
                      </div>
                    } />
                  {!demoMode && zonesQuery.data?.ok === false && (
                    <div className="text-[11.5px] text-sv-muted mb-2">
                      Sem vulnerabilidades por zona calculadas para esta partida (faltam eventos com zona ou elenco).
                    </div>
                  )}
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
                    hint="Clique numa zona para ver as estatísticas · alterne mandante/visitante · use o mouse para rotacionar"
                    right={
                      <div className="flex gap-1">
                        <button onClick={() => setView("2d")} className="sv-btn !py-1.5 text-[11.5px]">Mapa 2D</button>
                        <button onClick={() => setView("3d")} aria-pressed={view === "3d"} className="sv-btn !py-1.5 text-[11.5px] !bg-sv-accent text-white !border-sv-accent3">Campo 3D</button>
                      </div>
                    } />
                  <Pitch3D
                    title=""
                    homeWeakness={hw}
                    awayWeakness={aw}
                    homeWeaknessDetails={zones.home_team_weaknesses}
                    awayWeaknessDetails={zones.away_team_weaknesses}
                    teamNames={{ home: selMatch.home_team.name, away: selMatch.away_team.name }}
                    opportunityZones={(preds.predictions || []).filter((p: any) => p.target === "shot")
                      .flatMap((p: PlayerMatchPrediction) =>
                        (p.zone_opportunities || []).map((z: ZoneOpportunity) => ({
                          zone: z.zone,
                          value: z.opportunity_score,
                          side: p.venue,
                          player_name: p.player_name,
                          offensive_strength: z.offensive_strength,
                          defensive_weakness: z.defensive_weakness,
                          player_frequency: z.player_frequency,
                        })))}
                  />
                </div>
              )}

              <div className="sv-card">
                <div className="sv-card-inner space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold">Probabilidades de eventos por jogador</div>
                      <div className="text-xs text-sv-muted">Linha vertical = referência do baseline; estimativas não validadas.</div>
                    </div>
                    <div className="flex gap-1">
                      {[["shot", "chute"], ["shot_on_target", "no alvo"], ["goal", "gol"], ["goal_involvement", "particip. em gol"]].map(([t, label]) => (
                        <button key={t} onClick={() => setTarget(t)}
                          className={`sv-btn !py-1.5 capitalize ${target === t ? "!bg-sv-accent text-white !border-sv-accent3" : ""}`}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {targetPreds.length === 0 ? (
                    <EmptyState
                      title="Ainda sem previsões para este alvo"
                      description={!demoMode && predsQuery.data?.ok === false
                        ? (predsQuery.data.reason || "O modelo não gerou previsões para esta partida.")
                        : undefined} />
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
                    <SectionTitle title="Dispersão Oportunidade × Frequência"
                      hint="Cada bolha = um jogador · x = frequência de zona · y = probabilidade · tamanho = oportunidade total" />
                    <div className="h-80">
                      <SResponsiveContainer>
                        <ScatterChart margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
                          <CartesianGrid stroke="#22314f" />
                          <SXAxis type="number" dataKey="x" name="Freq. zona" stroke="#8794ad" fontSize={10} />
                          <SYAxis type="number" dataKey="y" name="Prob %" stroke="#8794ad" fontSize={10} />
                          <ZAxis type="number" dataKey="z" range={[40, 400]} name="Oportunidade" />
                          <STooltip cursor={{ strokeDasharray: "3 3" }}
                            contentStyle={{ background: "#111a2b", border: "1px solid #22314f", borderRadius: 8 }} />
                          <SLegend />
                          <Scatter name="Casa" data={scatter.filter((s: any) => s.venue === "home")} fill="#3b82f6" />
                          <Scatter name="Fora" data={scatter.filter((s: any) => s.venue === "away")} fill="#e1534e" />
                        </ScatterChart>
                      </SResponsiveContainer>
                    </div>
                  </div>
                </div>
                <div className="sv-card">
                  <div className="sv-card-inner">
                    <SectionTitle title="Motor de confrontos: principais vantagens" />
                    <div className="space-y-2 max-h-80 overflow-auto pr-1">
                      {(preds.matchups || [] as MatchupScore[]).slice(0, 20).map((mu: any, i: number) => (
                        <div key={i} className="sv-card !p-3">
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <div className="flex items-center gap-2 text-sm min-w-0">
                              <Badge kind={mu.score > 0.55 ? "good" : "default"}>
                                {(mu.score * 100).toFixed(0)}%
                              </Badge>
                              <span className="font-medium truncate">
                                Ata#{mu.attacker_id} vs Def#{mu.defender_id}
                              </span>
                            </div>
                            <span className="sv-chip">{mu.score > 0.55 ? "Vantagem ataque" : "Vantagem defesa"}</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="space-y-1">
                              <div className="sv-label">Pontos fortes do atacante</div>
                              {mu.strengths?.length ? mu.strengths.map((s: string, k: number) => (
                                <div key={k} className="sv-chip-accent">{s}</div>
                              )) : <div className="text-sv-muted">—</div>}
                            </div>
                            <div className="space-y-1 text-right">
                              <div className="sv-label">Fraquezas do defensor</div>
                              {mu.weaknesses?.length ? mu.weaknesses.map((s: string, k: number) => (
                                <div key={k} className="sv-chip border-sv-warn/40 text-sv-warn">{s}</div>
                              )) : <div className="text-sv-muted">—</div>}
                            </div>
                          </div>
                        </div>
                      ))}
                      {!preds.matchups?.length && <EmptyState title="Sem dados de confrontos" />}
                    </div>
                  </div>
                </div>
              </div>

              <div className="sv-card">
                <div className="sv-card-inner">
                  <SectionTitle title="Mapa de calor de oportunidade Jogador × Zona"
                    hint="Linhas: principais jogadores · Colunas: zonas de ataque · Mais claro = maior oportunidade (%)" />
                  {heatRows.length === 0 ? <EmptyState title="Sem dados" /> : (
                    <div className="overflow-auto">
                      <table className="sv-table min-w-[820px]">
                        <thead>
                          <tr>
                            <th>Jogador</th>
                            {zoneCols.map((z) => (
                              <th key={z} className="text-right !py-3 whitespace-nowrap">
                                {z.replace(/_/g, " ").slice(0, 14)}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {heatRows.map((r: any, i: number) => (
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
