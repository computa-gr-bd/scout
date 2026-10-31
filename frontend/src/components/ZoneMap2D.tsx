import { useEffect, useMemo, useRef, useState } from "react";
import type { PitchZone } from "../api/client";
import { Pitch2D, ZONE_GEOMETRY, flipZone } from "./Pitch";
import {
  PANEL_WIDTH, ZonePanelFrame, ZoneStatsSection, aggregateZoneEntries, zoneSectionHasData,
  type WeaknessDetail, type ZoneStatEntry,
} from "./ZoneInfoPanel";

/**
 * Mapa 2D das zonas (fraqueza defensiva × oportunidade ofensiva) — clicável como o campo 3D.
 * Mostra os dois times ao mesmo tempo: o mandante defende a esquerda, o visitante a direita.
 * Ao clicar numa zona abre o painel com as estatísticas de cada time naquela região.
 */
export function ZoneMap2D({
  title, homeWeakness, awayWeakness, homeWeaknessDetails, awayWeaknessDetails, opportunities, teamNames,
}: {
  title?: string;
  homeWeakness?: Record<string, number>;
  awayWeakness?: Record<string, number>;
  homeWeaknessDetails?: WeaknessDetail[];
  awayWeaknessDetails?: WeaknessDetail[];
  /** Oportunidades por jogador e zona (zona na visão do atacante). Sem `side`, conta como mandante. */
  opportunities: ZoneStatEntry[];
  teamNames?: { home?: string; away?: string };
}) {
  const [selectedZone, setSelectedZone] = useState<PitchZone | null>(null);
  const [hoverZone, setHoverZone] = useState<PitchZone | null>(null);
  const [panelPos, setPanelPos] = useState({ x: 0, y: 0, width: PANEL_WIDTH, maxHeight: 320 });
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSelectedZone(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // A partida mudou (ou os dados): fecha o painel para não mostrar números de outra análise.
  useEffect(() => { setSelectedZone(null); }, [homeWeakness, awayWeakness, opportunities]);

  const homeName = teamNames?.home || "Time da casa";
  const awayName = teamNames?.away || "Time visitante";

  const homeAgg = useMemo(
    () => aggregateZoneEntries(opportunities, (e) => (e.side === "away" ? null : e.zone)),
    [opportunities],
  );
  const awayAgg = useMemo(
    () => aggregateZoneEntries(opportunities, (e) => (e.side === "away" ? flipZone(e.zone) : null)),
    [opportunities],
  );

  // Desenho: só as 3 melhores zonas de cada jogador (senão o gramado vira uma mancha verde).
  const drawn = useMemo(() => {
    const byPlayer = new Map<string, ZoneStatEntry[]>();
    opportunities.forEach((e) => {
      const key = `${e.side ?? "home"}|${e.player_name ?? ""}`;
      byPlayer.set(key, [...(byPlayer.get(key) ?? []), e]);
    });
    return Array.from(byPlayer.values()).flatMap((list) =>
      [...list].sort((a, b) => b.value - a.value).slice(0, 3)
        .map((e) => ({ zone: e.zone, value: e.value, side: e.side ?? ("home" as const) })));
  }, [opportunities]);

  const handleZoneClick = (zone: PitchZone, e: React.MouseEvent<SVGRectElement>) => {
    if (selectedZone === zone) { setSelectedZone(null); return; }
    const rect = wrapRef.current?.getBoundingClientRect();
    const W = rect?.width ?? 640;
    const H = rect?.height ?? 520;
    const relX = rect ? e.clientX - rect.left : 24;
    const relY = rect ? e.clientY - rect.top : 24;
    const width = Math.min(PANEL_WIDTH, Math.max(220, W - 16));
    const x = Math.max(8, Math.min(relX + 14, W - width - 8));
    const y = Math.max(8, Math.min(relY + 14, H - 140));
    setPanelPos({ x, y, width, maxHeight: Math.max(180, H - y - 8) });
    setSelectedZone(zone);
  };

  const homeHas = selectedZone ? zoneSectionHasData(selectedZone, false, homeWeakness, homeAgg.find((a) => a.drawn === selectedZone)) : false;
  const awayHas = selectedZone ? zoneSectionHasData(selectedZone, true, awayWeakness, awayAgg.find((a) => a.drawn === selectedZone)) : false;

  return (
    <div ref={wrapRef} className="relative">
      <Pitch2D
        title={title}
        homeWeakness={homeWeakness}
        awayWeakness={awayWeakness}
        opportunityZones={drawn}
        onZoneClick={handleZoneClick}
        onZoneHover={setHoverZone}
        hoverZone={hoverZone}
        selectedZone={selectedZone}
      />
      {selectedZone && (
        <ZonePanelFrame
          title={ZONE_GEOMETRY[selectedZone].label}
          subtitle={`${homeName} (mandante) × ${awayName} (visitante)`}
          position={panelPos}
          onClose={() => setSelectedZone(null)}
        >
          {!homeHas && !awayHas && (
            <p className="text-[11px] leading-snug text-sv-muted">
              Sem dados relevantes nesta zona para os dois times. Clique em outra zona.
            </p>
          )}
          {homeHas && (
            <ZoneStatsSection zone={selectedZone} flip={false} heading={`${homeName} · mandante`}
              weakness={homeWeakness} weaknessDetails={homeWeaknessDetails}
              oppAgg={homeAgg.find((a) => a.drawn === selectedZone)} />
          )}
          {awayHas && (
            <ZoneStatsSection zone={selectedZone} flip heading={`${awayName} · visitante`}
              weakness={awayWeakness} weaknessDetails={awayWeaknessDetails}
              oppAgg={awayAgg.find((a) => a.drawn === selectedZone)} />
          )}
        </ZonePanelFrame>
      )}
    </div>
  );
}
