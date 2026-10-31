import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  getMatch, getMatchInsights, getMatchStudio, listMatches,
  type Match, type MatchInsights, type PlayerMatchPrediction,
} from "../api/client";
import { payloadToDataset } from "../api/studioReal";
import { PitchStudio } from "../components/PitchStudio";
import { Badge, EmptyState, ProbabilityBar, SectionTitle, TeamLogo } from "../components/ui";

const predictionTargets = [
  ["shot", "Chute"],
  ["shot_on_target", "No Alvo"],
  ["goal", "Gol"],
  ["goal_involvement", "Particip. em Gol"],
] as const;

type PredictionTarget = (typeof predictionTargets)[number][0];

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
  const [selectedMatchId, setSelectedMatchId] = useState<number | null>(routeMatchId);
  const [scope, setScope] = useState<"upcoming" | "recent">("upcoming");
  const [predictionTarget, setPredictionTarget] = useState<PredictionTarget>("shot");

  const matchesQuery = useQuery({
    queryKey: ["matches", "analysis", scope],
    queryFn: () => listMatches({ scope, limit: 100, analysis: true }),
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
          action={<Link className="sv-btn" to="/understat">Abrir Understat</Link>}
        />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(240px,320px)_1fr]">
          <section className="sv-card min-w-0">
            <div className="sv-card-inner space-y-3">
              <div>
                <h2 className="font-semibold">Partidas</h2>
                <p className="text-xs text-sv-muted">
                  {scope === "upcoming"
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

          <section className="min-w-0 space-y-4">
            {selectedQuery.isError ? (
              <EmptyState
                title="Não foi possível carregar esta partida"
                description="Selecione outra partida ou tente novamente."
              />
            ) : !selectedRealMatch ? (
              <div className="sv-card h-48 skeleton" />
            ) : (
              <>
                <div className="sv-card">
                  <div className="sv-card-inner flex flex-wrap items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-xs text-sv-muted">{selectedRealMatch.competition_name}</div>
                      <h2 className="mt-1 text-lg font-semibold">
                        {selectedRealMatch.home_team.name} {selectedRealMatch.home_score ?? "–"}–{selectedRealMatch.away_score ?? "–"} {selectedRealMatch.away_team.name}
                      </h2>
                      <div className="mt-1 text-xs text-sv-muted">
                        {new Date(selectedRealMatch.kickoff_time).toLocaleString("pt-BR")}
                      </div>
                    </div>
                    <Badge kind="accent">{selectedRealMatch.data_source}</Badge>
                  </div>
                </div>

                <section aria-label="Estimativas de desempenho individual">
                  <SectionTitle
                    title="Estimativas por jogador"
                    hint="Cálculos experimentais com eventos reais anteriores; não são resultados observados nem garantias."
                    right={<Badge kind="warn">Poisson · experimental</Badge>}
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
                            Probabilidade calculada de pelo menos um evento, usando Poisson e ajustando pelas zonas
                            de finalização, defesa adversária e mando. “Base” é a taxa individual sem esses ajustes.
                            A amostra inclui{" "}
                            <strong className="text-sv-text">{insightsQuery.data.sample?.home_matches ?? 0}</strong>{" "}
                            jogos anteriores de {selectedRealMatch.home_team.name} e{" "}
                            <strong className="text-sv-text">{insightsQuery.data.sample?.away_matches ?? 0}</strong>{" "}
                            de {selectedRealMatch.away_team.name}; média da liga baseada em{" "}
                            <strong className="text-sv-text">{insightsQuery.data.sample?.league_matches ?? 0}</strong>{" "}
                            jogos.
                          </p>
                          {insightsQuery.data.notes?.map((note) => (
                            <p key={note} className="text-xs text-sv-muted">{note}</p>
                          ))}
                        </div>
                      </div>
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
                      {predictions.length === 0 ? (
                        <EmptyState
                          title="Sem estimativas para este critério"
                          description="Os jogadores precisam ter finalizações registradas nos jogos anteriores considerados."
                        />
                      ) : (
                        <div className="space-y-3">
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
                      <div className="sv-card">
                        <div className="sv-card-inner text-sm text-sv-muted">
                          Ainda não há finalizações registradas para esta partida. O estúdio não exibirá eventos simulados.
                        </div>
                      </div>
                    )}
                    <PitchStudio
                      dataset={payloadToDataset(studioQuery.data)}
                    />
                  </>
                ) : null}
              </>
            )}
          </section>
        </div>
      )}
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

  return (
    <article className="sv-card">
      <div className="sv-card-inner space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="sv-chip">#{rank}</span>
          <h3 className="min-w-0 flex-1 truncate font-semibold">{prediction.player_name}</h3>
          <Badge kind="default">{prediction.venue === "home" ? homeName : awayName}</Badge>
        </div>
        <ProbabilityBar p={prediction.probability} baseline={prediction.baseline_probability} />
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
