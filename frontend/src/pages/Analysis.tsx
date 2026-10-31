import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getMatch, getMatchStudio, listMatches, type Match } from "../api/client";
import { payloadToDataset } from "../api/studioReal";
import { PitchStudio } from "../components/PitchStudio";
import { Badge, EmptyState, SectionTitle, TeamLogo } from "../components/ui";

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

  const matchesQuery = useQuery({
    queryKey: ["matches", "analysis", "recent"],
    queryFn: () => listMatches({ scope: "recent", limit: 100, analysis: true }),
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

  const studioQuery = useQuery({
    queryKey: ["match-studio", selectedMatchId],
    queryFn: () => getMatchStudio(selectedMatchId!),
    enabled: selectedMatchId != null && selectedRealMatch != null,
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
        hint="Eventos e finalizações registrados para partidas reais."
      />

      {matchesQuery.isError ? (
        <EmptyState
          title="Não foi possível carregar as partidas"
          description="Confira a conexão com a API e tente novamente."
        />
      ) : matchesQuery.isPending ? (
        <div className="sv-card h-24 skeleton" />
      ) : matches.length === 0 ? (
        <EmptyState
          title="Nenhuma partida real disponível"
          description="Sincronize dados reais para consultar eventos e finalizações."
          action={<Link className="sv-btn" to="/understat">Abrir Understat</Link>}
        />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(240px,320px)_1fr]">
          <section className="sv-card min-w-0">
            <div className="sv-card-inner space-y-3">
              <div>
                <h2 className="font-semibold">Partidas</h2>
                <p className="text-xs text-sv-muted">Partidas encerradas da Understat.</p>
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
