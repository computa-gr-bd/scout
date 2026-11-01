import { useMemo, useState } from "react";
import type { PitchZone, TeamProfile, TeamZoneWeakness } from "../api/client";
import { ZONE_GEOMETRY } from "./Pitch";
import { Pitch3D } from "./Pitch3D";
import { ZoneMap2D } from "./ZoneMap2D";
import type { WeaknessDetail, ZoneStatEntry } from "./ZoneInfoPanel";
import { EmptyState, ProbabilityBar } from "./ui";

/** Dados de zona de um time, prontos para o ranking e para os mapas 2D/3D. */
export function useTeamZoneData(
  weaknesses: TeamZoneWeakness[] | undefined,
  opportunities: TeamProfile["opportunities"],
) {
  return useMemo(() => {
    const weakness: Record<string, number> = {};
    const details: WeaknessDetail[] = [];
    (weaknesses ?? []).forEach((w) => {
      weakness[w.zone] = w.weakness_score;
      details.push({
        zone: w.zone,
        weakness_score: w.weakness_score,
        shots_conceded_per_90: w.shots_conceded_per_90,
        xga_per_90: w.xga_per_90,
        goals_conceded_per_90: w.goals_conceded_per_90,
        sample_size: w.sample_size,
      });
    });
    const entries: ZoneStatEntry[] = (opportunities ?? [])
      .filter((o) => o.opportunity_score > 0.001)
      .map((o) => ({
        zone: o.zone,
        value: o.opportunity_score,
        player_name: o.player_name,
        offensive_strength: o.offensive_strength,
        player_frequency: o.player_frequency,
      }));
    const ranked = [...(weaknesses ?? [])]
      .filter((w) => w.weakness_score > 0)
      .sort((a, b) => b.weakness_score - a.weakness_score);
    return { weakness, details, entries, ranked };
  }, [weaknesses, opportunities]);
}

/** Ranking de zonas onde o time mais sofre (mesma leitura da tela de Análise). */
export function WeaknessRanking({
  ranked, limit = 8,
}: {
  ranked: TeamZoneWeakness[];
  limit?: number;
}) {
  if (ranked.length === 0) {
    return (
      <EmptyState
        title="Sem ranking de fraquezas"
        description="Ainda não há chutes reais sofridos suficientes para este time."
      />
    );
  }
  return (
    <div className="space-y-2.5">
      {ranked.slice(0, limit).map((w, i) => {
        const above = w.ratio_vs_league >= 1.1;
        return (
          <div key={w.zone}>
            <div className="mb-1 flex items-center justify-between gap-2 text-xs">
              <div className="flex min-w-0 items-center gap-2">
                <span className="sv-chip">#{i + 1}</span>
                <span className="truncate font-medium">{ZONE_GEOMETRY[w.zone as PitchZone]?.label ?? w.zone}</span>
              </div>
              <div className="shrink-0 text-right text-sv-muted">
                xGA {w.xga_per_90.toFixed(2)} · chutes {w.shots_conceded_per_90.toFixed(1)} · gols {w.goals_conceded_per_90.toFixed(2)}
              </div>
            </div>
            <ProbabilityBar p={Math.min(1, w.weakness_score)} />
            <div className={`mt-0.5 pl-[108px] text-[10.5px] ${above ? "text-sv-warn" : "text-sv-muted"}`}>
              {w.ratio_vs_league.toFixed(1)}× a média da liga
            </div>
          </div>
        );
      })}
      {ranked.length > limit && (
        <p className="text-[11px] text-sv-muted">
          Mostrando {limit} de {ranked.length} zonas com chutes sofridos. Clique nas zonas do mapa abaixo para ver todas.
        </p>
      )}
    </div>
  );
}

/** Mapa de zonas do time (2D ou 3D), clicável como na tela de Análise. */
export function TeamZoneMaps({
  teamName, weakness, details, entries,
}: {
  teamName: string;
  weakness: Record<string, number>;
  details: WeaknessDetail[];
  entries: ZoneStatEntry[];
}) {
  const [view, setView] = useState<"2d" | "3d">("2d");
  const hasData = Object.values(weakness).some((v) => v > 0) || entries.length > 0;

  return (
    <div className="space-y-3">
      <div className="flex gap-1" role="group" aria-label="Tipo de mapa">
        {([["2d", "Mapa 2D"], ["3d", "Campo 3D"]] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={view === key}
            onClick={() => setView(key)}
            className={`sv-btn !py-1.5 text-[11.5px] ${view === key ? "!bg-sv-accent text-white !border-sv-accent3" : ""}`}
          >
            {label}
          </button>
        ))}
      </div>
      {!hasData ? (
        <EmptyState
          title="Sem dados reais de zonas"
          description="Este time ainda não tem chutes reais importados da Understat. Sincronize a liga na aba Understat."
        />
      ) : view === "2d" ? (
        <ZoneMap2D
          singleTeam
          homeWeakness={weakness}
          homeWeaknessDetails={details}
          teamNames={{ home: teamName }}
          opportunities={entries}
          title="Zonas defensivas (vermelho = fraqueza) · ofensivas (verde = oportunidade) · clique numa zona"
        />
      ) : (
        <Pitch3D
          singleTeam
          title="Campo 3D · clique numa zona para ver as estatísticas"
          homeWeakness={weakness}
          homeWeaknessDetails={details}
          teamNames={{ home: teamName }}
          opportunityZones={entries}
        />
      )}
    </div>
  );
}
