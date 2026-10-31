import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Text } from "@react-three/drei";
import type { PitchZone } from "../api/client";
import { ZONE_GEOMETRY, flipZone } from "./Pitch";
import { MaterialIcon } from "./MaterialIcon";
import {
  PANEL_WIDTH, ZoneDropdown, aggregateZoneEntries,
  type WeaknessDetail, type ZoneAgg, type ZoneSide, type ZoneStatEntry,
} from "./ZoneInfoPanel";

export type { WeaknessDetail, ZoneSide, ZoneStatEntry } from "./ZoneInfoPanel";

export const WIDTH = 105;
export const HEIGHT = 68;

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

export function PitchMesh() {
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

export function Lines() {
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
  const aggs = useMemo<ZoneAgg[]>(
    () => aggregateZoneEntries(entries, (e) => {
      if (e.side && e.side !== side) return null;
      return flip ? flipZone(e.zone) : e.zone;
    }),
    [entries, side, flip],
  );

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
            <MaterialIcon name="home" className="mr-1 align-middle text-[14px]" />{teamNames?.home || "Casa"}
          </button>
          <button onClick={() => setSide("away")}
            className={`sv-btn !px-2.5 !py-1 text-[11px] ${side === "away" ? "!border-sv-accent3 !bg-sv-accent text-white" : ""}`}>
            <MaterialIcon name="flight" className="mr-1 align-middle text-[14px]" />{teamNames?.away || "Visitante"}
          </button>
        </div>
      </div>

      <div ref={wrapRef} className="relative p-3 md:p-5" style={{ height: 520 }}
        onPointerDown={(e) => { downRef.current = [e.clientX, e.clientY]; }}>
        <Canvas shadows camera={{ position: [0, 140, 0.01], up: [0, 0, -1], fov: 42 }} dpr={[1, 2]}
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
