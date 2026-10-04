import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Text } from "@react-three/drei";
import type { PitchZone } from "../api/client";
import { ZONE_GEOMETRY, flipZone } from "./Pitch";

const WIDTH = 105;
const HEIGHT = 68;

/** Lado que dona das zonas exibidas: mandante (casa) ou visitante. */
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
interface ZoneAgg {
  drawn: PitchZone;
  avg: number;
  max: number;
  count: number;
  items: ZoneStatEntry[];
}

const ALL_ZONES = Object.keys(ZONE_GEOMETRY) as PitchZone[];

function toPitch(xNorm: number, yNorm: number, z: number = 0.02) {
  // xNorm 0..100 -> x 0..WIDTH, centered
  const x = (xNorm / 100) * WIDTH - WIDTH / 2;
  const y = (yNorm / 100) * HEIGHT - HEIGHT / 2;
  return [x, z, -y] as [number, number, number];
}

/** Centro e tamanho (em unidades do mundo) de uma zona do gramado. */
function zoneRect(zone: PitchZone) {
  const g = ZONE_GEOMETRY[zone];
  const [cx, , cz] = toPitch(g.x + g.w / 2, g.y + g.h / 2, 0.05);
  return { cx, cz, w: (g.w / 100) * WIDTH, h: (g.h / 100) * HEIGHT };
}

function pct(value: number) {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function severity(t: number) {
  if (t >= 0.8) return { label: "Crítica", color: "#ef4444" };
  if (t >= 0.6) return { label: "Alta", color: "#f97316" };
  if (t >= 0.4) return { label: "Moderada", color: "#eab308" };
  return { label: "Controlada", color: "#22c55e" };
}

function PitchMesh() {
  return (
    <group>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[WIDTH + 4, HEIGHT + 4]} />
        <meshStandardMaterial color="#0f3d26" />
      </mesh>
      {/* alternating stripes */}
      {Array.from({ length: 10 }).map((_, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[-(WIDTH / 2) + (i + 0.5) * (WIDTH / 10), 0.001, 0]}>
          <planeGeometry args={[WIDTH / 10 - 0.15, HEIGHT - 0.3]} />
          <meshStandardMaterial color={i % 2 === 0 ? "#1f8352" : "#196e45"} />
        </mesh>
      ))}
    </group>
  );
}

function Lines() {
  const stroke = "white";
  const lw = 0.02;
  return (
    <group>
      <lineSegments>
        <edgesGeometry args={[/* placeholder */]} />
      </lineSegments>
      {/* outside */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <ringGeometry args={[1, 1.01, 4]} />
      </mesh>
      {/* use individual boxes for lines */}
      {[
        { pos: [0, 0.01, -HEIGHT / 2], size: [WIDTH, lw, 0.04] },
        { pos: [0, 0.01, HEIGHT / 2], size: [WIDTH, lw, 0.04] },
        { pos: [-WIDTH / 2, 0.01, 0], size: [0.04, lw, HEIGHT] },
        { pos: [WIDTH / 2, 0.01, 0], size: [0.04, lw, HEIGHT] },
        { pos: [0, 0.01, 0], size: [0.04, lw, HEIGHT] },
        // penalty boxes left
        { pos: [-WIDTH / 2 + 16.5, 0.01, -20.15], size: [33, lw, 0.04] },
        { pos: [-WIDTH / 2 + 16.5 / 2, 0.01, 20.15], size: [16.5, lw, 0.04] },
        { pos: [-WIDTH / 2 + 16.5 / 2, 0.01, -20.15], size: [16.5, lw, 0.04] },
        { pos: [-WIDTH / 2 + 16.5, 0.01, 20.15], size: [0.04, lw, 40.3] },
        // goal area left
        { pos: [-WIDTH / 2 + 5.5, 0.01, -9.16], size: [11, lw, 0.04] },
        { pos: [-WIDTH / 2 + 2.75, 0.01, 9.16], size: [5.5, lw, 0.04] },
        { pos: [-WIDTH / 2 + 2.75, 0.01, -9.16], size: [5.5, lw, 0.04] },
        { pos: [-WIDTH / 2 + 5.5, 0.01, 9.16], size: [0.04, lw, 18.32] },
        // penalty boxes right
        { pos: [WIDTH / 2 - 16.5, 0.01, -20.15], size: [33, lw, 0.04] },
        { pos: [WIDTH / 2 - 16.5 / 2, 0.01, 20.15], size: [16.5, lw, 0.04] },
        { pos: [WIDTH / 2 - 16.5 / 2, 0.01, -20.15], size: [16.5, lw, 0.04] },
        { pos: [WIDTH / 2 - 16.5, 0.01, 20.15], size: [0.04, lw, 40.3] },
        { pos: [WIDTH / 2 - 5.5, 0.01, -9.16], size: [11, lw, 0.04] },
        { pos: [WIDTH / 2 - 2.75, 0.01, 9.16], size: [5.5, lw, 0.04] },
        { pos: [WIDTH / 2 - 2.75, 0.01, -9.16], size: [5.5, lw, 0.04] },
        { pos: [WIDTH / 2 - 5.5, 0.01, 9.16], size: [0.04, lw, 18.32] },
      ].map((b, i) => (
        <mesh key={i} position={b.pos as [number, number, number]}>
          <boxGeometry args={b.size as [number, number, number]} />
          <meshStandardMaterial color={stroke} />
        </mesh>
      ))}
      {/* center circle */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
        <ringGeometry args={[9.15, 9.25, 64]} />
        <meshStandardMaterial color={stroke} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
        <circleGeometry args={[0.2, 20]} />
        <meshStandardMaterial color={stroke} />
      </mesh>
      {/* penalty dots */}
      {[-11, 11].map((x) => (
        <mesh key={x} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.012, 0]}>
          <circleGeometry args={[0.2, 20]} />
          <meshStandardMaterial color={stroke} />
        </mesh>
      ))}
      {/* goals */}
      {[-1, 1].map((s) => (
        <group key={s} position={[(s * (WIDTH / 2 + 1.2)), 1.2, 0]}>
          <mesh position={[0, 0.6, -3.7]}><boxGeometry args={[0.1, 2.4, 0.1]} /><meshStandardMaterial color="white" /></mesh>
          <mesh position={[0, 0.6, 3.7]}><boxGeometry args={[0.1, 2.4, 0.1]} /><meshStandardMaterial color="white" /></mesh>
          <mesh position={[0, 1.8, 0]}><boxGeometry args={[0.1, 0.1, 7.4]} /><meshStandardMaterial color="white" /></mesh>
        </group>
      ))}
    </group>
  );
}

function ZoneOverlays({ weakness, opportunities, flip }: {
  weakness?: Record<string, number>;
  opportunities?: ZoneAgg[];
  flip: boolean;
}) {
  const elements: any[] = [];
  if (weakness) {
    const max = Math.max(0.001, ...Object.values(weakness));
    Object.entries(weakness).forEach(([z, v]) => {
      const drawn = flip ? flipZone(z as PitchZone) : (z as PitchZone);
      const { cx, cz, w, h } = zoneRect(drawn);
      const t = Math.max(0, Math.min(1, v / max));
      elements.push(
        <mesh key={`w-${z}`} rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0.03, cz]}>
          <planeGeometry args={[w * 0.98, h * 0.98]} />
          <meshStandardMaterial color={`rgb(180,${Math.round(80 - t * 60)},${Math.round(120 - t * 100)})`}
            transparent opacity={0.15 + t * 0.55} depthWrite={false} />
        </mesh>
      );
    });
  }
  if (opportunities?.length) {
    const max = Math.max(0.001, ...opportunities.map((o) => o.avg));
    opportunities.forEach((agg) => {
      const { cx, cz, w, h } = zoneRect(agg.drawn);
      const t = Math.max(0, Math.min(1, agg.avg / max));
      elements.push(
        <mesh key={`o-${agg.drawn}`} rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0.04, cz]}>
          <planeGeometry args={[w * 0.98, h * 0.98]} />
          <meshStandardMaterial color={`rgb(30,${Math.round(140 + t * 60)},${Math.round(100 + t * 80)})`}
            transparent opacity={0.18 + t * 0.6} depthWrite={false} />
        </mesh>
      );
    });
  }
  return <group>{elements}</group>;
}

/** Realce da zona sob o mouse ou selecionada (placa branca + contorno). */
function ZoneHighlight({ zone, selected }: { zone: PitchZone; selected: boolean }) {
  const { cx, cz, w, h } = zoneRect(zone);
  const borders = [
    { p: [cx, 0.06, cz - h / 2], s: [w * 0.98, 0.06, 0.5] },
    { p: [cx, 0.06, cz + h / 2], s: [w * 0.98, 0.06, 0.5] },
    { p: [cx - w / 2, 0.06, cz], s: [0.5, 0.06, h * 0.98] },
    { p: [cx + w / 2, 0.06, cz], s: [0.5, 0.06, h * 0.98] },
  ];
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0.055, cz]}>
        <planeGeometry args={[w * 0.98, h * 0.98]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={selected ? 0.16 : 0.1} depthWrite={false} />
      </mesh>
      {selected && borders.map((b, i) => (
        <mesh key={i} position={b.p as [number, number, number]}>
          <boxGeometry args={b.s as [number, number, number]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      ))}
    </group>
  );
}

/** Camada invisível (porém clicável) cobrindo as 18 zonas do gramado. */
function ZoneHitLayer({
  onZoneClick, onZoneOver, onZoneOut,
}: {
  onZoneClick: (zone: PitchZone, e: ThreeEvent<MouseEvent>) => void;
  onZoneOver: (zone: PitchZone) => void;
  onZoneOut: () => void;
}) {
  return (
    <group>
      {ALL_ZONES.map((z) => {
        const { cx, cz, w, h } = zoneRect(z);
        return (
          <mesh key={`hit-${z}`} rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0.07, cz]}
            onClick={(e) => onZoneClick(z, e)}
            onPointerOver={(e) => { e.stopPropagation(); onZoneOver(z); }}
            onPointerOut={() => onZoneOut()}>
            <planeGeometry args={[w, h]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0} depthWrite={false} />
          </mesh>
        );
      })}
    </group>
  );
}

const PANEL_WIDTH = 300;

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

/** Dropdown com as estatísticas da zona clicada (fraqueza = vermelho · oportunidade = verde). */
function ZoneDropdown({
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
  const geom = ZONE_GEOMETRY[zone];
  // A fraqueza é indexada na perspectiva do próprio time; o gramado pode estar espelhado.
  const dataZone = flip ? flipZone(zone) : zone;
  const ranked = Object.entries(weakness || {}).sort((a, b) => b[1] - a[1]);
  const wMax = Math.max(0.001, ...ranked.map(([, v]) => v));
  const wVal = weakness ? weakness[dataZone] : undefined;
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

  return (
    <div
      className="absolute z-20 space-y-3 overflow-y-auto rounded-xl border border-white/10 bg-[#0c1322]/95 p-3 shadow-2xl backdrop-blur"
      style={{ left: position.x, top: position.y, width: position.width, maxHeight: position.maxHeight }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold leading-tight text-white">{geom.label}</div>
          <div className="mt-0.5 text-[10px] text-sv-muted">{teamLabel}</div>
        </div>
        <button onClick={onClose} aria-label="Fechar estatísticas da zona"
          className="h-6 w-6 shrink-0 rounded-md border border-white/10 text-[11px] text-sv-muted transition hover:bg-white/10 hover:text-white">
          ✕
        </button>
      </div>

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
            <MiniStat label="Jogadas na zona" value={oppAgg.count} />
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

      {wVal === undefined && oppItems.length === 0 && (
        <p className="text-[11px] leading-snug text-sv-muted">
          Sem dados relevantes nesta zona para {teamLabel}. Alterne o time no seletor ou clique em outra zona.
        </p>
      )}
    </div>
  );
}

export function Pitch3D({
  title, homeWeakness, awayWeakness, homeWeaknessDetails, awayWeaknessDetails,
  opportunityZones, teamNames, defaultSide = "home",
}: {
  title?: string;
  homeWeakness?: Record<string, number>;
  awayWeakness?: Record<string, number>;
  homeWeaknessDetails?: WeaknessDetail[];
  awayWeaknessDetails?: WeaknessDetail[];
  opportunityZones?: ZoneStatEntry[];
  teamNames?: { home?: string; away?: string };
  defaultSide?: ZoneSide;
}) {
  const [side, setSide] = useState<ZoneSide>(defaultSide);
  const [selectedZone, setSelectedZone] = useState<PitchZone | null>(null);
  const [panelPos, setPanelPos] = useState({ x: 0, y: 0, width: PANEL_WIDTH, maxHeight: 320 });
  const [hoverZone, setHoverZone] = useState<PitchZone | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const downRef = useRef<[number, number] | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSelectedZone(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    document.body.style.cursor = hoverZone ? "pointer" : "";
    return () => { document.body.style.cursor = ""; };
  }, [hoverZone]);

  // Convenção do gramado: o mandante ataca para a direita; no lado do visitante tudo espelha.
  const flip = side === "away";
  const weakness = side === "home" ? homeWeakness : awayWeakness;
  const weaknessDetails = side === "home" ? homeWeaknessDetails : awayWeaknessDetails;
  const teamName = teamNames?.[side] || (side === "home" ? "Time da casa" : "Time visitante");
  const teamLabel = `${teamName} · ${side === "home" ? "mandante" : "visitante"}`;

  const entries = opportunityZones ?? [];
  const aggs = useMemo<ZoneAgg[]>(() => {
    const map = new Map<PitchZone, ZoneAgg>();
    entries.forEach((e) => {
      if (e.side && e.side !== side) return;
      const drawn = flip ? flipZone(e.zone) : e.zone;
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
  }, [entries, side, flip]);

  const handleZoneClick = (zone: PitchZone, e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    // Ignora o clique final de um arrasto (arrastar gira a câmera, não seleciona zona).
    const down = downRef.current;
    if (down && Math.hypot(e.nativeEvent.clientX - down[0], e.nativeEvent.clientY - down[1]) > 5) return;
    const rect = wrapRef.current?.getBoundingClientRect();
    const W = rect?.width ?? 640;
    const H = rect?.height ?? 520;
    const relX = rect ? e.nativeEvent.clientX - rect.left : 24;
    const relY = rect ? e.nativeEvent.clientY - rect.top : 24;
    const x = Math.max(8, Math.min(relX + 14, W - PANEL_WIDTH - 8));
    const y = Math.max(8, Math.min(relY + 14, H - 140));
    setPanelPos({ x, y, width: Math.min(PANEL_WIDTH, Math.max(220, W - 16)), maxHeight: Math.max(180, H - y - 8) });
    setSelectedZone(zone);
  };
  return (
    <div className="sv-card">
      {title && <div className="px-5 pt-4 pb-2 text-sm font-semibold">{title}</div>}
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pb-1 pt-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-sv-muted">
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: "rgba(214,60,60,0.9)" }} />
            Fraqueza defensiva
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: "rgba(30,170,110,0.9)" }} />
            Oportunidade ofensiva
          </span>
          <span className="hidden sm:inline">· clique numa zona para ver as estatísticas</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-sv-muted">Zonas de</span>
          <button onClick={() => setSide("home")}
            className={`sv-btn !px-2.5 !py-1 text-[11px] ${side === "home" ? "!border-sv-accent3 !bg-sv-accent text-white" : ""}`}>
            🏠 {teamNames?.home || "Casa"}
          </button>
          <button onClick={() => setSide("away")}
            className={`sv-btn !px-2.5 !py-1 text-[11px] ${side === "away" ? "!border-sv-accent3 !bg-sv-accent text-white" : ""}`}>
            ✈ {teamNames?.away || "Visitante"}
          </button>
        </div>
      </div>

      <div ref={wrapRef} className="relative p-3 md:p-5" style={{ height: 520 }}
        onPointerDown={(e) => { downRef.current = [e.clientX, e.clientY]; }}>
        <Canvas shadows camera={{ position: [0, 70, 75], fov: 42 }} dpr={[1, 2]}
          onPointerMissed={() => setSelectedZone(null)}>
          <color attach="background" args={["#0a0f1a"]} />
          <ambientLight intensity={0.6} />
          <directionalLight position={[30, 60, -20]} intensity={1.2} castShadow />
          <directionalLight position={[-30, 40, 30]} intensity={0.5} />
          <Suspense fallback={null}>
            <PitchMesh />
            <Lines />
            <ZoneOverlays weakness={weakness} opportunities={aggs} flip={flip} />
            {hoverZone && <ZoneHighlight zone={hoverZone} selected={hoverZone === selectedZone} />}
            {selectedZone && hoverZone !== selectedZone && <ZoneHighlight zone={selectedZone} selected />}
            <ZoneHitLayer onZoneClick={handleZoneClick}
              onZoneOver={setHoverZone} onZoneOut={() => setHoverZone(null)} />
            <Text position={[0, 0.1, -HEIGHT / 2 - 3]} fontSize={2} color="#8794ad" anchorX="center">
              {flip ? `← ${teamNames?.away || "Time visitante"} ataca` : `${teamNames?.home || "Time da casa"} ataca →`}
            </Text>
          </Suspense>
          <OrbitControls enablePan={false} minDistance={40} maxDistance={180} maxPolarAngle={Math.PI / 2.1} />
        </Canvas>

        {selectedZone && (
          <ZoneDropdown
            zone={selectedZone}
            teamLabel={teamLabel}
            flip={flip}
            weakness={weakness}
            weaknessDetails={weaknessDetails}
            oppAgg={aggs.find((a) => a.drawn === selectedZone)}
            position={panelPos}
            onClose={() => setSelectedZone(null)}
          />
        )}
      </div>
    </div>
  );
}
