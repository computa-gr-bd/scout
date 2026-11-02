import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  getMatch, getMatchInsights, getMatchStudio, listMatches,
  type Match, type MatchInsights, type PitchZone, type PlayerMatchPrediction,
  type ZoneOpportunity,
} from "../api/client";
import { payloadToDataset } from "../api/studioReal";
import { PitchStudio } from "../components/PitchStudio";
import { Pitch3D } from "../components/Pitch3D";
import { ZoneMap2D } from "../components/ZoneMap2D";
import { GoalkeeperCompare } from "../components/GoalkeeperCompare";
import type { WeaknessDetail, ZoneStatEntry } from "../components/ZoneInfoPanel";
import { ZONE_GEOMETRY } from "../components/Pitch";
import {
  Badge, ConfidenceBadge, EmptyState, ProbabilityBar, SectionTitle, TeamLogo,
} from "../components/ui";
import {
  CartesianGrid, Legend, ResponsiveContainer, Scatter, ScatterChart, Tooltip,
  XAxis, YAxis, ZAxis,
} from "recharts";

const predictionTargets = [
  ["shot", "Chute"],
  ["shot_on_target", "No Alvo"],
  ["goal", "Gol"],
  ["goal_involvement", "Particip. em Gol"],
] as const;

type PredictionTarget = (typeof predictionTargets)[number][0];

const opportunityZones: PitchZone[] = [
  "central_box", "outside_box_central", "outside_box_left", "outside_box_right",
  "opp_left_channel", "opp_right_channel", "opp_central_midfield", "opp_left_flank", "opp_right_flank",
];

function isDemoMatch(match: Match) {
  return match.data_source.toLowerCase() === "demo";
}

function matchLabel(match: Match) {
  const date = new Date(match.kickoff_time);
  const dateLabel = Number.isNaN(date.getTime())
    ? "Data indisponível"
    : date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  const score = match.home_score == null || match.away_score == null
    ? "vs"
    : `${match.home_score}–${match.away_score}`;
  return `${dateLabel} · ${score}`;
}

export default function AnalysisPage() {
  const { matchId } = useParams<{ matchId: string }>();
  const routeMatchId = matchId && Number.isFinite(Number(matchId)) ? Number(matchId) : null;
  const [searchParams] = useSearchParams();
  const teamParam = Number(searchParams.get("team"));
  const requestedTeamId = Number.isSafeInteger(teamParam) && teamParam > 0 ? teamParam : null;
  const [selectedMatchId, setSelectedMatchId] = useState<number | null>(routeMatchId);
  const [scope, setScope] = useState<"upcoming" | "recent">("upcoming");
  const [teamFallbackHandledFor, setTeamFallbackHandledFor] = useState<number | null>(null);
  const [predictionTarget, setPredictionTarget] = useState<PredictionTarget>("shot");
  const [zoneView, setZoneView] = useState<"2d" | "3d">("2d");

  const matchesQuery = useQuery({
    queryKey: ["matches", "analysis", scope, requestedTeamId],
    queryFn: () => listMatches({
      scope,
      team_id: requestedTeamId ?? undefined,
      limit: 100,
      analysis: true,
    }),
  });
  const matches = useMemo(
    () => (matchesQuery.data ?? []).filter((match) => !isDemoMatch(match)),
    [matchesQuery.data],
  );
  const selectedInList = matches.find((match) => match.id === selectedMatchId);

  const selectedQuery = useQuery({
    queryKey: ["match", selectedMatchId],
    queryFn: () => getMatch(selectedMatchId!),
    enabled: selectedMatchId != null && !selectedInList && matchesQuery.isSuccess,
  });
  const selectedMatch = selectedInList ?? selectedQuery.data;
  const selectedRealMatch = selectedMatch && !isDemoMatch(selectedMatch) ? selectedMatch : undefined;

  useEffect(() => {
    if (routeMatchId != null && selectedQuery.data?.status === "finished" && scope !== "recent") {
      setScope("recent");
    }
  }, [routeMatchId, scope, selectedQuery.data?.status]);

  useEffect(() => {
    if (
      routeMatchId != null
      || requestedTeamId == null
      || teamFallbackHandledFor === requestedTeamId
      || !matchesQuery.isSuccess
    ) return;
    if (scope === "upcoming" && matches.length === 0) {
      setScope("recent");
    }
    setTeamFallbackHandledFor(requestedTeamId);
  }, [
    matches.length,
    matchesQuery.isSuccess,
    requestedTeamId,
    routeMatchId,
    scope,
    teamFallbackHandledFor,
  ]);

  useEffect(() => {
    if (requestedTeamId == null) {
      setTeamFallbackHandledFor(null);
    }
  }, [requestedTeamId]);

  const studioQuery = useQuery({
    queryKey: ["match-studio", selectedMatchId],
    queryFn: () => getMatchStudio(selectedMatchId!),
    enabled: selectedMatchId != null && selectedRealMatch != null,
  });
  const insightsQuery = useQuery({
    queryKey: ["match-insights", selectedMatchId],
    queryFn: () => getMatchInsights(selectedMatchId!),
    enabled: selectedMatchId != null && selectedRealMatch != null,
  });
  const predictions = useMemo(
    () => (insightsQuery.data?.predictions ?? [])
      .filter((prediction) => prediction.target === predictionTarget)
      .sort((a, b) => b.probability - a.probability),
    [insightsQuery.data?.predictions, predictionTarget],
  );
  const insights = insightsQuery.data?.available ? insightsQuery.data : undefined;
  const zones = insights?.zones;
  const { homeWeakness, awayWeakness } = useMemo(() => {
    const home: Record<string, number> = {};
    const away: Record<string, number> = {};
    zones?.home_team_weaknesses?.forEach((zone) => { home[zone.zone] = zone.weakness_score; });
    zones?.away_team_weaknesses?.forEach((zone) => { away[zone.zone] = zone.weakness_score; });
    return { homeWeakness: home, awayWeakness: away };
  }, [zones]);
  const zoneEntries = useMemo<ZoneStatEntry[]>(
    () => (insights?.predictions ?? [])
      .filter((prediction) => prediction.target === "shot")
      .flatMap((prediction) => (prediction.zone_opportunities ?? [])
        .filter((zone) => zone.opportunity_score > 0.001)
        .map((zone) => ({
          zone: zone.zone,
          value: zone.opportunity_score,
          side: prediction.venue,
          player_name: prediction.player_name,
          offensive_strength: zone.offensive_strength,
          defensive_weakness: zone.defensive_weakness,
          player_frequency: zone.player_frequency,
        }))),
    [insights?.predictions],
  );
  const scatterHasRates = predictions.some((prediction) => prediction.shots_per_match != null);
  const scatterData = predictions.slice(0, 40).map((prediction) => {
    const opportunity = prediction.zone_opportunities ?? [];
    const totalOpportunity = opportunity.reduce((sum, zone) => sum + zone.opportunity_score, 0);
    const attackShare = opportunity
      .filter((zone) => opportunityZones.includes(zone.zone))
      .reduce((sum, zone) => sum + zone.player_frequency, 0);
    return {
      name: prediction.player_name,
      x: scatterHasRates
        ? Number((prediction.shots_per_match ?? 0).toFixed(2))
        : Math.round(100 * attackShare),
      y: Number((prediction.probability * 100).toFixed(1)),
      baseline: Number((prediction.baseline_probability * 100).toFixed(1)),
      z: Math.max(1, Number((totalOpportunity * 100).toFixed(1))),
      venue: prediction.venue,
      oppFactor: prediction.opp_factor,
    };
  });
  const opportunityRows = predictions.slice(0, 8).map((prediction) => {
    const values: Partial<Record<PitchZone, number>> = {};
    prediction.zone_opportunities?.forEach((zone) => {
      values[zone.zone] = Math.round(zone.opportunity_score * 100);
    });
    return { player: prediction.player_name, values };
  });

  useEffect(() => {
    setSelectedMatchId(routeMatchId);
  }, [routeMatchId]);

  useEffect(() => {
    if (routeMatchId != null || !matches.length) return;
    if (!matches.some((match) => match.id === selectedMatchId)) {
      setSelectedMatchId(matches[0].id);
    }
  }, [matches, routeMatchId, selectedMatchId]);

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Análise de partidas"
        hint={scope === "upcoming"
          ? "Calendário real e forma recente, com estimativas experimentais identificadas à parte."
          : "Eventos reais de partidas encerradas e estimativas baseadas apenas em jogos anteriores."}
      />

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar partidas da análise">
        {([
          ["upcoming", "Próximas"],
          ["recent", "Resultados recentes"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={scope === key}
            onClick={() => setScope(key)}
            className={`sv-btn ${scope === key ? "!bg-sv-accent !border-sv-accent3 text-white" : ""}`}
          >
            {label}
            <span className="sv-chip ml-1.5 !py-0">
              {scope === key ? matches.length : "—"}
            </span>
          </button>
        ))}
      </div>

      {matchesQuery.isError ? (
        <EmptyState
          title="Não foi possível carregar as partidas"
          description="Confira a conexão com a API e tente novamente."
        />
      ) : matchesQuery.isPending ? (
        <div className="sv-card h-24 skeleton" />
      ) : matches.length === 0 ? (
        <EmptyState
          title={scope === "upcoming" ? "Nenhuma partida futura disponível" : "Nenhum resultado recente disponível"}
          description={scope === "upcoming"
            ? "A API não retornou partidas futuras para as competições sincronizadas."
            : "Sincronize dados reais para consultar partidas encerradas e suas finalizações."}
          action={<Link className="sv-btn" to="/ligas">Abrir Ligas</Link>}
        />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(240px,320px)_1fr]">
          <section className="sv-card min-w-0">
            <div className="sv-card-inner space-y-3">
              <div>
                <h2 className="font-semibold">Partidas</h2>
                <p className="text-xs text-sv-muted">
                  {requestedTeamId != null
                    ? scope === "upcoming"
                      ? "Próximas partidas do time selecionado."
                      : "Resultados recentes do time selecionado."
                    : scope === "upcoming"
                    ? "Próximas partidas das competições sincronizadas."
                    : "Partidas encerradas da Understat."}
                </p>
              </div>
              <div className="max-h-[70vh] space-y-2 overflow-auto">
                {matches.map((match) => {
                  const isSelected = match.id === selectedMatchId;
                  return (
                    <button
                      key={match.id}
                      type="button"
                      onClick={() => setSelectedMatchId(match.id)}
                      className={`w-full rounded-lg border p-3 text-left transition ${
                        isSelected
                          ? "border-sv-accent3 bg-sv-accent/10"
                          : "border-sv-border bg-sv-panel hover:border-sv-accent3/60"
                      }`}
                    >
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="truncate text-xs text-sv-muted">
                          {match.competition_name || "Competição"}
                        </span>
                        <Badge kind={match.status === "finished" ? "good" : "default"}>
                          {match.status === "finished" ? "Encerrada" : match.status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <TeamLogo name={match.home_team.name} src={match.home_team.logo_url} className="h-[22px] w-[22px]" />
                        <span className="min-w-0 flex-1 truncate">{match.home_team.name}</span>
                        <span className="text-sv-muted">{matchLabel(match).split(" · ")[1]}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-sm font-medium">
                        <TeamLogo name={match.away_team.name} src={match.away_team.logo_url} className="h-[22px] w-[22px]" />
                        <span className="min-w-0 flex-1 truncate">{match.away_team.name}</span>
                        <span className="w-8" />
                      </div>
                      <div className="mt-2 text-xs text-sv-muted">{matchLabel(match).split(" · ")[0]}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="min-w-0 space-y-5">
            {selectedQuery.isError ? (
              <EmptyState
                title="Não foi possível carregar esta partida"
                description="Selecione outra partida ou tente novamente."
              />
            ) : !selectedRealMatch ? (
              <div className="sv-card h-48 skeleton" />
            ) : (
              <>
                <section aria-label="ScoutVision Studio">
                  <SectionTitle
                    title="Campo · ScoutVision Studio"
                    hint={`${selectedRealMatch.home_team.name} vs ${selectedRealMatch.away_team.name} · mapa, chutes, gols e posições`}
                  />
                  {studioQuery.isError ? (
                    <EmptyState
                      title="Não foi possível carregar os eventos"
                      description="A API não retornou os dados desta partida. Tente novamente mais tarde."
                    />
                  ) : studioQuery.isPending ? (
                    <div className="sv-card h-[420px] skeleton" />
                  ) : studioQuery.data ? (
                    <>
                      {!studioQuery.data.coverage.has_shots && (
                        <div className="sv-card mb-4">
                          <div className="sv-card-inner text-sm text-sv-muted">
                            Ainda não há finalizações registradas para esta partida. O estúdio não exibirá eventos simulados.
                          </div>
                        </div>
                      )}
                      <PitchStudio dataset={payloadToDataset(studioQuery.data)} />
                    </>
                  ) : null}
                </section>

                <section aria-label="Análise de zonas">
                  <SectionTitle
                    title="Análise de zonas · vulnerabilidades defensivas"
                    hint="Fraquezas por zona e oportunidades ofensivas · clique numa zona para ver as estatísticas"
                    right={
                      <div className="flex gap-1">
                        <button
                          type="button"
                          aria-pressed={zoneView === "2d"}
                          onClick={() => setZoneView("2d")}
                          className={`sv-btn !py-1.5 text-[11.5px] ${zoneView === "2d" ? "!bg-sv-accent text-white !border-sv-accent3" : ""}`}
                        >
                          Mapa 2D
                        </button>
                        <button
                          type="button"
                          aria-pressed={zoneView === "3d"}
                          onClick={() => setZoneView("3d")}
                          className={`sv-btn !py-1.5 text-[11.5px] ${zoneView === "3d" ? "!bg-sv-accent text-white !border-sv-accent3" : ""}`}
                        >
                          Campo 3D
                        </button>
                      </div>
                    }
                  />
                  {insightsQuery.isError ? (
                    <EmptyState
                      title="Não foi possível carregar a análise de zonas"
                      description="A API não retornou dados históricos para esta partida."
                    />
                  ) : insightsQuery.isPending ? (
                    <div className="sv-card h-[420px] skeleton" />
                  ) : !insights ? (
                    <EmptyState
                      title="Sem dados reais de zonas"
                      description="Não há finalizações anteriores suficientes para analisar as zonas."
                    />
                  ) : zoneView === "2d" ? (
                    <ZoneMap2D
                      homeWeakness={homeWeakness}
                      awayWeakness={awayWeakness}
                      homeWeaknessDetails={zones?.home_team_weaknesses}
                      awayWeaknessDetails={zones?.away_team_weaknesses}
                      teamNames={{
                        home: selectedRealMatch.home_team.name,
                        away: selectedRealMatch.away_team.name,
                      }}
                      opportunities={zoneEntries}
                      title="Zonas defensivas (vermelho = fraqueza) · ofensivas (verde = oportunidade)"
                    />
                  ) : (
                    <Pitch3D
                      title="Campo 3D · clique numa zona para ver as estatísticas"
                      homeWeakness={homeWeakness}
                      awayWeakness={awayWeakness}
                      homeWeaknessDetails={zones?.home_team_weaknesses}
                      awayWeaknessDetails={zones?.away_team_weaknesses}
                      teamNames={{
                        home: selectedRealMatch.home_team.name,
                        away: selectedRealMatch.away_team.name,
                      }}
                      opportunityZones={zoneEntries}
                    />
                  )}
                  {insights?.notes?.length ? (
                    <p className="mt-2 text-[11.5px] text-sv-muted">{insights.notes.slice(0, 2).join(" ")}</p>
                  ) : null}
                </section>

                <section aria-label="Probabilidades estimadas por jogador">
                  <SectionTitle
                    title="Probabilidades de eventos por jogador"
                    hint="Cálculos experimentais com eventos reais anteriores; não são resultados observados nem garantias."
                    right={<Badge kind="warn">Poisson + minutos + goleiro · experimental</Badge>}
                  />
                  {insightsQuery.isError ? (
                    <EmptyState
                      title="Não foi possível calcular as estimativas"
                      description="A API não retornou os dados históricos necessários. Tente novamente mais tarde."
                    />
                  ) : insightsQuery.isPending ? (
                    <div className="sv-card h-24 skeleton" />
                  ) : !insightsQuery.data?.available ? (
                    <EmptyState
                      title="Sem amostra histórica de finalizações"
                      description="Não há chutes reais anteriores suficientes para calcular estas estimativas."
                    />
                  ) : (
                    <div className="space-y-4">
                      <div className="sv-card">
                        <div className="sv-card-inner space-y-3">
                          <p className="text-sm text-sv-muted">
                            Chance estimada de pelo menos um evento na partida. A barra compara o cálculo ajustado
                            (adversário, minutos esperados e goleiro) à taxa recente do jogador sem esses ajustes; estimativas experimentais, não validadas.
                            Amostra:{" "}
                            <strong className="text-sv-text">{insightsQuery.data.sample?.home_matches ?? 0}</strong>{" "}
                            jogos anteriores de {selectedRealMatch.home_team.name} e{" "}
                            <strong className="text-sv-text">{insightsQuery.data.sample?.away_matches ?? 0}</strong>{" "}
                            de {selectedRealMatch.away_team.name}; média da liga baseada em{" "}
                            <strong className="text-sv-text">{insightsQuery.data.sample?.league_matches ?? 0}</strong>{" "}
                            jogos.
                          </p>
                        </div>
                      </div>
                      {insightsQuery.data.goalkeepers && (
                        <div className="space-y-2">
                          <div className="text-sm font-semibold">Goleiros titulares</div>
                          <GoalkeeperCompare
                            homeName={selectedRealMatch.home_team.name}
                            awayName={selectedRealMatch.away_team.name}
                            home={insightsQuery.data.goalkeepers.home}
                            away={insightsQuery.data.goalkeepers.away}
                          />
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2" role="group" aria-label="Tipo de estimativa">
                        {predictionTargets.map(([target, label]) => (
                          <button
                            key={target}
                            type="button"
                            aria-pressed={predictionTarget === target}
                            onClick={() => setPredictionTarget(target)}
                            className={`sv-btn ${predictionTarget === target ? "!bg-sv-accent !border-sv-accent3 text-white" : ""}`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      {insightsQuery.data.results_checked && predictions.some((p) => p.outcome) && (
                        <OutcomeSummary predictions={predictions} target={predictionTarget} />
                      )}
                      {predictions.length === 0 ? (
                        <EmptyState
                          title="Ainda sem estimativas para este critério"
                          description="Os jogadores precisam ter finalizações registradas nos jogos anteriores considerados."
                        />
                      ) : (
                        <div className="space-y-2.5">
                          {predictions.map((prediction, index) => (
                            <PlayerEstimateCard
                              key={`${prediction.player_id}-${prediction.target}`}
                              prediction={prediction}
                              rank={index + 1}
                              homeName={selectedRealMatch.home_team.name}
                              awayName={selectedRealMatch.away_team.name}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </section>

                <div className="grid gap-5 lg:grid-cols-2">
                  <section className="sv-card min-w-0">
                    <div className="sv-card-inner">
                      <SectionTitle
                        title="Dispersão Oportunidade × Frequência"
                        hint={scatterHasRates
                          ? "Cada bolha = um jogador · X = chutes por jogo · Y = probabilidade estimada · tamanho = oportunidade contra a defesa"
                          : "Cada bolha = um jogador · X = % dos chutes em zonas de ataque · Y = probabilidade estimada"}
                      />
                      {insightsQuery.isPending ? (
                        <div className="h-80 skeleton rounded-lg" />
                      ) : scatterData.length === 0 ? (
                        <EmptyState title="Sem dados para o gráfico" />
                      ) : (
                        <div className="h-80">
                          <ResponsiveContainer width="100%" height="100%">
                            <ScatterChart margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
                              <CartesianGrid stroke="#22314f" />
                              <XAxis
                                type="number"
                                dataKey="x"
                                name={scatterHasRates ? "Chutes por jogo" : "% dos chutes em zonas de ataque"}
                                domain={scatterHasRates ? [0, "auto"] : [0, 100]}
                                stroke="#8794ad"
                                fontSize={10}
                                tick={{ fill: "#a9b6cc" }}
                              />
                              <YAxis
                                type="number"
                                dataKey="y"
                                name="Probabilidade (%)"
                                domain={[0, 100]}
                                stroke="#8794ad"
                                fontSize={10}
                                tick={{ fill: "#a9b6cc" }}
                              />
                              <ZAxis type="number" dataKey="z" range={[60, 420]} name="Oportunidade" />
                              <Tooltip
                                cursor={{ strokeDasharray: "3 3" }}
                                content={<PredictionScatterTooltip
                                  xLabel={scatterHasRates ? "Chutes por jogo" : "% dos chutes em zonas de ataque"}
                                />}
                              />
                              <Legend />
                              <Scatter
                                name="Mandante"
                                data={scatterData.filter((point) => point.venue === "home")}
                                fill="#3b82f6"
                              />
                              <Scatter
                                name="Visitante"
                                data={scatterData.filter((point) => point.venue === "away")}
                                fill="#e1534e"
                              />
                            </ScatterChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </div>
                  </section>

                  <section className="sv-card min-w-0">
                    <div className="sv-card-inner">
                      <SectionTitle title="Confrontos: principais vantagens" />
                      {insightsQuery.isPending ? (
                        <div className="h-80 skeleton rounded-lg" />
                      ) : insights?.matchups?.length ? (
                        <div className="max-h-80 space-y-2 overflow-auto pr-1">
                          {insights.matchups.slice(0, 20).map((matchup, index) => (
                            <article key={`${matchup.attacker_id}-${index}`} className="sv-card !p-3">
                              <div className="mb-2 flex items-center justify-between gap-2">
                                <div className="flex min-w-0 items-center gap-2 text-sm">
                                  <Badge kind={matchup.score > 0.55 ? "good" : "default"}>
                                    {(matchup.score * 100).toFixed(0)}%
                                  </Badge>
                                  <span className="truncate font-medium">
                                    {matchup.attacker_name ?? `Jogador ${matchup.attacker_id}`} vs{" "}
                                    {matchup.defender_name ?? "defesa adversária"}
                                  </span>
                                </div>
                                <span className="sv-chip">
                                  {matchup.score > 0.55 ? "Vantagem ataque" : "Vantagem defesa"}
                                </span>
                              </div>
                              <div className="grid grid-cols-2 gap-2 text-xs">
                                <div className="space-y-1">
                                  <div className="sv-label">Pontos fortes</div>
                                  {matchup.strengths?.length
                                    ? matchup.strengths.map((strength, i) => <div key={i} className="sv-chip-accent">{strength}</div>)
                                    : <div className="text-sv-muted">—</div>}
                                </div>
                                <div className="space-y-1 text-right">
                                  <div className="sv-label">Fraquezas adversárias</div>
                                  {matchup.weaknesses?.length
                                    ? matchup.weaknesses.map((weakness, i) => <div key={i} className="sv-chip border-sv-warn/40 text-sv-warn">{weakness}</div>)
                                    : <div className="text-sv-muted">—</div>}
                                </div>
                              </div>
                            </article>
                          ))}
                        </div>
                      ) : (
                        <EmptyState title="Sem dados de confrontos" />
                      )}
                    </div>
                  </section>
                </div>

                <section className="sv-card">
                  <div className="sv-card-inner">
                    <SectionTitle
                      title="Mapa de calor de oportunidade · jogador × zona"
                      hint="Linhas: principais jogadores · colunas: zonas de ataque · mais claro = maior oportunidade estimada"
                    />
                    {insightsQuery.isPending ? (
                      <div className="h-48 skeleton rounded-lg" />
                    ) : opportunityRows.length === 0 ? (
                      <EmptyState title="Sem dados de oportunidade por zona" />
                    ) : (
                      <div className="overflow-auto">
                        <table className="sv-table min-w-[820px]">
                          <thead>
                            <tr>
                              <th>Jogador</th>
                              {opportunityZones.map((zone) => (
                                <th key={zone} className="whitespace-nowrap text-right !py-3">
                                  {ZONE_GEOMETRY[zone].label}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {opportunityRows.map((row) => (
                              <tr key={row.player}>
                                <td className="whitespace-nowrap font-medium">{row.player}</td>
                                {opportunityZones.map((zone) => {
                                  const value = row.values[zone] ?? 0;
                                  const background = value > 0
                                    ? `rgba(30, ${Math.round(130 + value * 1.2)}, ${Math.round(90 + value * 1.5)}, ${0.12 + Math.min(0.78, value / 100)})`
                                    : "transparent";
                                  return (
                                    <td key={zone} className="text-right font-mono text-xs" style={{ background }}>
                                      {value > 0 ? value : ""}
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
                </section>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

/** Texto do que de fato aconteceu, por tipo de estimativa. */
function outcomeText(target: string, outcome: { happened: boolean; count: number }) {
  const n = outcome.count;
  const plural = (one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  switch (target) {
    case "shot":
      return outcome.happened ? `${plural("chute", "chutes")} na partida` : "não finalizou";
    case "shot_on_target":
      return outcome.happened ? `${plural("chute no alvo", "chutes no alvo")}` : "nenhum chute no alvo";
    case "goal":
      return outcome.happened ? `${plural("gol", "gols")}` : "não marcou";
    default:
      return outcome.happened ? `${plural("participação em gol", "participações em gol")}` : "sem gol nem assistência";
  }
}

/** Resumo de acertos da lista exibida (só partidas encerradas). */
function OutcomeSummary({ predictions, target }: { predictions: PlayerMatchPrediction[]; target: string }) {
  const checked = predictions.filter((p) => p.outcome);
  const hit = (list: PlayerMatchPrediction[]) => list.filter((p) => p.outcome?.happened).length;
  const top = checked.slice(0, 5);
  const label: Record<string, string> = {
    shot: "finalizou", shot_on_target: "chutou no alvo", goal: "marcou", goal_involvement: "participou de gol",
  };
  const total = hit(checked);
  const pct = checked.length ? Math.round((100 * total) / checked.length) : 0;
  return (
    <div className="sv-card !border-emerald-400/25">
      <div className="sv-card-inner flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
        <span className="font-semibold">Conferência com o jogo real</span>
        <span>
          <strong className="text-emerald-300">{total}</strong> de {checked.length} jogadores listados {label[target] ?? "fizeram o evento"}
          <span className="text-sv-muted"> ({pct}%)</span>
        </span>
        <span className="text-sv-muted">
          Top 5 mais prováveis: <strong className="text-sv-text">{hit(top)}</strong> de {top.length}
        </span>
      </div>
    </div>
  );
}

function PlayerEstimateCard({
  prediction, rank, homeName, awayName,
}: {
  prediction: PlayerMatchPrediction;
  rank: number;
  homeName: string;
  awayName: string;
}) {
  const factors = [
    ...(prediction.positive_factors ?? []).map((item) => ({ item, negative: false })),
    ...(prediction.negative_factors ?? []).map((item) => ({ item, negative: true })),
  ];
  const outcome = prediction.outcome;
  // Partida encerrada: borda/fundo verde se aconteceu, vermelho discreto se não.
  const tone = !outcome ? "" : outcome.happened
    ? "!border-emerald-400/60 !bg-emerald-500/[0.07]"
    : "!border-rose-400/35 !bg-rose-500/[0.05]";

  return (
    <article className={`sv-card ${tone}`}>
      <div className="sv-card-inner space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="sv-chip">#{rank}</span>
          <h3 className="min-w-0 flex-1 truncate font-semibold">{prediction.player_name}</h3>
          <Badge kind="default">{prediction.venue === "home" ? homeName : awayName}</Badge>
          <ConfidenceBadge c={prediction.confidence} />
        </div>
        {outcome && (
          <div
            role="status"
            className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-semibold ${
              outcome.happened
                ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-300"
                : "border-rose-400/40 bg-rose-500/10 text-rose-300"
            }`}
          >
            <span aria-hidden>{outcome.happened ? "✓" : "✕"}</span>
            <span>Aconteceu: {outcome.happened ? "Sim" : "Não"}</span>
            <span className="font-normal text-[12px] opacity-90">· {outcomeText(prediction.target, outcome)}</span>
          </div>
        )}
        <ProbabilityBar p={prediction.probability} baseline={prediction.baseline_probability} />
        {(prediction.expected_minutes != null || prediction.gk_factor != null) && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-sv-muted">
            {prediction.expected_minutes != null && <span>Minutos esperados: ~{prediction.expected_minutes}&apos;</span>}
            {prediction.gk_factor != null && prediction.target.startsWith("goal") && (
              <span>Goleiro adversário: x{prediction.gk_factor.toFixed(2)}</span>
            )}
          </div>
        )}
        {factors.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {factors.map(({ item, negative }, index) => (
              <span
                key={`${item.feature}-${index}`}
                className={`inline-flex rounded-full border px-3 py-1 text-sm ${
                  negative
                    ? "border-sv-warn/30 bg-sv-warn/5 text-sv-warn"
                    : "border-sv-accent2/20 bg-sv-accent2/5 text-sv-accent3"
                }`}
              >
                {item.factor}
              </span>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

function PredictionScatterTooltip({
  active, payload, xLabel,
}: {
  active?: boolean;
  payload?: Array<{ payload: { name: string; venue: "home" | "away"; x: number; y: number; baseline: number; z: number; oppFactor?: number } }>;
  xLabel: string;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  const delta = point.y - point.baseline;
  return (
    <div className="min-w-[190px] rounded-lg border border-white/15 bg-[#0c1322] px-3 py-2 text-xs text-sv-text shadow-2xl">
      <div className="font-semibold">{point.name}</div>
      <div className="mb-1 text-[10px] text-sv-muted">{point.venue === "home" ? "Mandante" : "Visitante"}</div>
      <div className="flex justify-between gap-4"><span className="text-sv-muted">{xLabel}</span><strong>{point.x}{xLabel.startsWith("%") ? "%" : ""}</strong></div>
      <div className="flex justify-between gap-4"><span className="text-sv-muted">Probabilidade</span><strong>{point.y}%</strong></div>
      {point.baseline > 0 && (
        <div className="flex justify-between gap-4">
          <span className="text-sv-muted">vs. taxa recente</span>
          <strong className={delta >= 0 ? "text-emerald-300" : "text-rose-300"}>{delta >= 0 ? "+" : ""}{delta.toFixed(1)} p.p.</strong>
        </div>
      )}
      {point.oppFactor != null && (
        <div className="flex justify-between gap-4"><span className="text-sv-muted">Fator da defesa</span><strong>x{point.oppFactor.toFixed(2)}</strong></div>
      )}
      <div className="flex justify-between gap-4"><span className="text-sv-muted">Oportunidade</span><strong>{point.z}</strong></div>
    </div>
  );
}
