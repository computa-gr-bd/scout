import type { ReactNode } from "react";
import type { PitchZone } from "../api/client";
import { ZONE_GEOMETRY, flipZone } from "./Pitch";
import { MaterialIcon } from "./MaterialIcon";

/** Lado dono das zonas exibidas: mandante (casa) ou visitante. */
export type ZoneSide = "home" | "away";

/** Zona ofensiva com estatísticas — `side` identifica o time de origem. */
export interface ZoneStatEntry {
  zone: PitchZone;
  value: number; // opportunity_score
  side?: ZoneSide;
  player_name?: string;
  offensive_strength?: number;
  defensive_weakness?: number;
  player_frequency?: number;
}

/** Detalhes de uma fraqueza defensiva (mesmos campos de DefensiveWeakness da API). */
export interface WeaknessDetail {
  zone: PitchZone;
  weakness_score: number;
  shots_conceded_per_90?: number;
  xga_per_90?: number;
  goals_conceded_per_90?: number;
  sample_size?: number;
}

/** Oportunidades agregadas por zona, já posicionadas no gramado. */
export interface ZoneAgg {
  drawn: PitchZone;
  avg: number;
  max: number;
  count: number;
  items: ZoneStatEntry[];
}

/** Agrupa as oportunidades pela zona em que são DESENHADAS (`drawnOf` devolve null para ignorar). */
export function aggregateZoneEntries(
  entries: ZoneStatEntry[],
  drawnOf: (e: ZoneStatEntry) => PitchZone | null,
): ZoneAgg[] {
  const map = new Map<PitchZone, ZoneAgg>();
  entries.forEach((e) => {
    const drawn = drawnOf(e);
    if (!drawn) return;
    let agg = map.get(drawn);
    if (!agg) {
      agg = { drawn, avg: 0, max: 0, count: 0, items: [] };
      map.set(drawn, agg);
    }
    agg.items.push(e);
    agg.count += 1;
    agg.max = Math.max(agg.max, e.value);
  });
  map.forEach((a) => { a.avg = a.items.reduce((s, i) => s + i.value, 0) / a.items.length; });
  return Array.from(map.values());
}

export const PANEL_WIDTH = 300;

export function pct(value: number) {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

export function severity(t: number) {
  if (t >= 0.8) return { label: "Crítica", color: "#ef4444" };
  if (t >= 0.6) return { label: "Alta", color: "#f97316" };
  if (t >= 0.4) return { label: "Moderada", color: "#eab308" };
  return { label: "Controlada", color: "#22c55e" };
}

function MiniStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-[10px] leading-tight text-sv-muted">{label}</div>
      <div className="font-mono text-white/90">{value}</div>
    </div>
  );
}

function ScoreBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
      <div className="h-full rounded-full" style={{ width: pct(value), background: color }} />
    </div>
  );
}

/** Há alguma informação (fraqueza > 0 ou oportunidade) para esta zona deste time? */
export function zoneSectionHasData(
  zone: PitchZone, flip: boolean, weakness?: Record<string, number>, oppAgg?: ZoneAgg,
): boolean {
  const dataZone = flip ? flipZone(zone) : zone;
  const w = weakness ? weakness[dataZone] : undefined;
  return (w !== undefined && w > 0) || (oppAgg?.items.length ?? 0) > 0;
}

/** Estatísticas de UM time numa zona (fraqueza = vermelho · oportunidade = verde). */
export function ZoneStatsSection({
  zone, heading, flip, weakness, weaknessDetails, oppAgg,
}: {
  /** Zona como DESENHADA no gramado. */
  zone: PitchZone;
  /** Cabeçalho do time (usado quando há mais de um time no painel). */
  heading?: string;
  flip: boolean;
  weakness?: Record<string, number>;
  weaknessDetails?: WeaknessDetail[];
  oppAgg?: ZoneAgg;
}) {
  // A fraqueza é indexada na perspectiva do próprio time; o gramado pode estar espelhado.
  const dataZone = flip ? flipZone(zone) : zone;
  const ranked = Object.entries(weakness || {}).sort((a, b) => b[1] - a[1]);
  const wMax = Math.max(0.001, ...ranked.map(([, v]) => v));
  const rawW = weakness ? weakness[dataZone] : undefined;
  const wVal = rawW !== undefined && rawW > 0 ? rawW : undefined;
  const wRank = wVal === undefined ? 0 : ranked.findIndex(([k]) => k === dataZone) + 1;
  const wDetail = wVal === undefined ? undefined : weaknessDetails?.find((d) => d.zone === dataZone);
  const sev = wVal === undefined ? null : severity(wVal / wMax);

  const oppItems = oppAgg ? [...oppAgg.items].sort((a, b) => b.value - a.value) : [];
  const mean = (vals: number[]) => (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0);
  const hasField = (f: keyof ZoneStatEntry) => oppItems.some((i) => i[f] !== undefined);
  const offAvg = hasField("offensive_strength") ? mean(oppItems.map((i) => i.offensive_strength || 0)) : null;
  const defAvg = hasField("defensive_weakness") ? mean(oppItems.map((i) => i.defensive_weakness || 0)) : null;
  const freqAvg = hasField("player_frequency") ? mean(oppItems.map((i) => i.player_frequency || 0)) : null;
  const namedPlayers = oppItems.filter((i) => i.player_name);

  const drivers: string[] = [];
  if (offAvg !== null && offAvg >= 0.55) drivers.push("força ofensiva alta do time");
  if (defAvg !== null && defAvg >= 0.55) drivers.push("adversário frágil nesta região");
  if (freqAvg !== null && freqAvg >= 0.15) drivers.push("alto volume de jogadas nesta zona");
  if (!drivers.length) drivers.push("volume + eficiência acima do baseline");

  if (wVal === undefined && oppItems.length === 0) return null;

  return (
    <div className="space-y-3">
      {heading && <div className="text-[11px] font-semibold uppercase tracking-wide text-white/80">{heading}</div>}
      <div className="flex flex-wrap gap-1.5">
        {wVal !== undefined && (
          <span className="sv-chip !px-2 !text-[10px]"
            style={{ borderColor: "rgba(239,68,68,0.45)", background: "rgba(239,68,68,0.12)", color: "#fca5a5" }}>
            Fraqueza defensiva · vermelho
          </span>
        )}
        {oppItems.length > 0 && (
          <span className="sv-chip !px-2 !text-[10px]"
            style={{ borderColor: "rgba(34,197,94,0.45)", background: "rgba(34,197,94,0.12)", color: "#86efac" }}>
            Oportunidade · verde
          </span>
        )}
      </div>

      {wVal !== undefined && (
        <div className="space-y-2 rounded-lg border border-red-500/25 bg-red-500/10 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11.5px] font-semibold text-red-300">Por que é fraqueza</span>
            {sev && (
              <span className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                style={{ background: `${sev.color}2e`, color: sev.color }}>{sev.label}</span>
            )}
          </div>
          <ScoreBar value={wVal / wMax} color="#ef4444" />
          <div className="grid grid-cols-2 gap-2">
            <MiniStat label="Índice de fraqueza" value={wVal.toFixed(2)} />
            <MiniStat label="Posição entre zonas" value={`${wRank}ª / ${ranked.length}`} />
            {wDetail?.shots_conceded_per_90 !== undefined && (
              <MiniStat label="Chutes sofr. /90" value={wDetail.shots_conceded_per_90.toFixed(2)} />
            )}
            {wDetail?.xga_per_90 !== undefined && (
              <MiniStat label="xGA /90" value={wDetail.xga_per_90.toFixed(2)} />
            )}
            {wDetail?.goals_conceded_per_90 !== undefined && (
              <MiniStat label="Gols sofr. /90" value={wDetail.goals_conceded_per_90.toFixed(2)} />
            )}
            {wDetail?.sample_size !== undefined && (
              <MiniStat label="Amostra" value={`${wDetail.sample_size} jogos`} />
            )}
          </div>
          <p className="text-[10.5px] leading-snug text-sv-muted">
            {wDetail
              ? `Concede${wDetail.shots_conceded_per_90 !== undefined ? ` ${wDetail.shots_conceded_per_90.toFixed(2)} chutes` : " ataques"}${wDetail.xga_per_90 !== undefined ? ` e ${wDetail.xga_per_90.toFixed(2)} xGA` : ""} por 90 nesta região — ${wRank}ª pior zona de ${ranked.length} mapeadas.`
              : `Índice em ${pct(wVal / wMax)} da maior fraqueza do time — ${wRank}ª pior de ${ranked.length} zonas mapeadas.`}
          </p>
        </div>
      )}

      {oppItems.length > 0 && oppAgg && (
        <div className="space-y-2 rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-2.5">
          <div className="text-[11.5px] font-semibold text-emerald-300">Por que é oportunidade</div>
          <ScoreBar value={oppAgg.avg} color="#22c55e" />
          <div className="grid grid-cols-2 gap-2">
            <MiniStat label="Score de oportunidade" value={oppAgg.avg.toFixed(2)} />
            <MiniStat label="Jogadores na zona" value={oppAgg.count} />
            {offAvg !== null && <MiniStat label="Força ofensiva" value={offAvg.toFixed(2)} />}
            {defAvg !== null && <MiniStat label="Fraqueza do adversário" value={defAvg.toFixed(2)} />}
            {freqAvg !== null && <MiniStat label="Frequência de jogadas" value={pct(freqAvg)} />}
          </div>
          <p className="text-[10.5px] leading-snug text-sv-muted">{drivers.join(" · ")}.</p>
          {namedPlayers.length > 0 && (
            <div className="space-y-1.5 pt-0.5">
              <div className="text-[10px] uppercase tracking-wide text-sv-muted">Principais jogadores</div>
              {namedPlayers.slice(0, 4).map((p, i) => (
                <div key={`${p.player_name}-${i}`} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-white/85">{p.player_name}</span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className="inline-block h-1.5 w-14 overflow-hidden rounded-full bg-white/10">
                      <span className="block h-full rounded-full bg-emerald-400" style={{ width: pct(p.value) }} />
                    </span>
                    <span className="w-7 text-right font-mono text-[10.5px] text-white/70">{p.value.toFixed(2)}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Moldura flutuante do painel (título, fechar e conteúdo). */
export function ZonePanelFrame({
  title, subtitle, position, onClose, children,
}: {
  title: string;
  subtitle?: string;
  position: { x: number; y: number; width: number; maxHeight: number };
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="absolute z-20 space-y-3 overflow-y-auto rounded-xl border border-white/10 bg-[#0c1322]/95 p-3 shadow-2xl backdrop-blur"
      style={{ left: position.x, top: position.y, width: position.width, maxHeight: position.maxHeight }}
      role="dialog" aria-label={`Estatísticas da zona: ${title}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold leading-tight text-white">{title}</div>
          {subtitle && <div className="mt-0.5 text-[10px] text-sv-muted">{subtitle}</div>}
        </div>
        <button onClick={onClose} aria-label="Fechar estatísticas da zona"
          className="h-6 w-6 shrink-0 rounded-md border border-white/10 text-[11px] text-sv-muted transition hover:bg-white/10 hover:text-white">
          <MaterialIcon name="close" />
        </button>
      </div>
      {children}
    </div>
  );
}

/** Painel de UM time (visão 3D, que alterna entre mandante e visitante). */
export function ZoneDropdown({
  teamLabel, flip, weakness, weaknessDetails, oppAgg, position, onClose, zone,
}: {
  zone: PitchZone;
  teamLabel: string;
  flip: boolean;
  weakness?: Record<string, number>;
  weaknessDetails?: WeaknessDetail[];
  oppAgg?: ZoneAgg;
  position: { x: number; y: number; width: number; maxHeight: number };
  onClose: () => void;
}) {
  const has = zoneSectionHasData(zone, flip, weakness, oppAgg);
  return (
    <ZonePanelFrame title={ZONE_GEOMETRY[zone].label} subtitle={teamLabel} position={position} onClose={onClose}>
      {has ? (
        <ZoneStatsSection zone={zone} flip={flip} weakness={weakness} weaknessDetails={weaknessDetails} oppAgg={oppAgg} />
      ) : (
        <p className="text-[11px] leading-snug text-sv-muted">
          Sem dados relevantes nesta zona para {teamLabel}. Alterne o time no seletor ou clique em outra zona.
        </p>
      )}
    </ZonePanelFrame>
  );
}
