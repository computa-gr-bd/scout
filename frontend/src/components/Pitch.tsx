import type { PitchZone } from "../api/client";

// Zone geometry on a 100x100 pitch (0-100, 0-100)
// Pitch orientation: attacking team attacks to the right (x: 50..100)
export const ZONE_GEOMETRY: Record<PitchZone, { x: number; y: number; w: number; h: number; label: string }> = {
  own_box:                   { x: 0,   y: 21, w: 16, h: 58, label: "Área própria (6m)" },
  own_left_channel:          { x: 16,  y: 18, w: 14, h: 20, label: "Corredor esquerdo próprio" },
  own_right_channel:         { x: 16,  y: 62, w: 14, h: 20, label: "Corredor direito próprio" },
  own_central_midfield:      { x: 16,  y: 38, w: 14, h: 24, label: "Meio-campo central próprio" },
  own_left_flank:            { x: 16,  y: 0,  w: 14, h: 18, label: "Ala esquerda própria" },
  own_right_flank:           { x: 16,  y: 82, w: 14, h: 18, label: "Ala direita própria" },
  neutral_midfield:          { x: 30,  y: 18, w: 40, h: 64, label: "Meio-campo neutro" },
  neutral_left_flank:        { x: 30,  y: 0,  w: 40, h: 18, label: "Ala esquerda neutra" },
  neutral_right_flank:       { x: 30,  y: 82, w: 40, h: 18, label: "Ala direita neutra" },
  opp_left_flank:            { x: 70,  y: 0,  w: 14, h: 18, label: "Ala esquerda adversária" },
  opp_right_flank:           { x: 70,  y: 82, w: 14, h: 18, label: "Ala direita adversária" },
  opp_left_channel:          { x: 70,  y: 18, w: 14, h: 20, label: "Corredor esquerdo adversário" },
  opp_right_channel:         { x: 70,  y: 62, w: 14, h: 20, label: "Corredor direito adversário" },
  opp_central_midfield:      { x: 70,  y: 38, w: 14, h: 24, label: "Meio-campo central adversário" },
  outside_box_left:          { x: 84,  y: 21, w: 8,  h: 19, label: "Fora da área (E)" },
  outside_box_right:         { x: 84,  y: 60, w: 8,  h: 19, label: "Fora da área (D)" },
  outside_box_central:       { x: 84,  y: 40, w: 8,  h: 20, label: "Fora da área (C)" },
  central_box:               { x: 92,  y: 29, w: 8,  h: 42, label: "Área central" },
};

const ZONE_ORDER: PitchZone[] = [
  "own_box", "own_left_flank", "own_left_channel", "own_central_midfield", "own_right_channel", "own_right_flank",
  "neutral_left_flank", "neutral_midfield", "neutral_right_flank",
  "opp_left_flank", "opp_left_channel", "opp_central_midfield", "opp_right_channel", "opp_right_flank",
  "outside_box_left", "outside_box_central", "outside_box_right",
  "central_box",
];

export function heatColor(value: number, max: number, mode: "danger" | "good" = "good") {
  const v = Math.max(0, Math.min(1, max <= 0 ? 0 : value / max));
  if (mode === "good") {
    const r = Math.round(15 + v * 5);
    const g = Math.round(123 + v * 70);
    const b = Math.round(75 + v * 60);
    return `rgba(${r},${g},${b},${0.18 + v * 0.6})`;
  }
  const r = Math.round(60 + v * 150);
  const g = Math.round(110 - v * 70);
  const b = Math.round(130 - v * 90);
  return `rgba(${r},${g},${b},${0.18 + v * 0.6})`;
}

/** Escala do mapa de calor de chutes: azul-escuro -> amarelo -> vermelho. */
export function shotHeatColor(v: number, max: number) {
  const t = max > 0 ? Math.max(0, Math.min(1, v / max)) : 0;
  const r = Math.round(40 + t * 215);
  const g = Math.round(90 + (t < 0.6 ? t * 250 : (1 - t) * 240 + 20));
  const b = Math.round(220 - t * 200);
  return `rgba(${r},${Math.min(255, g)},${Math.max(0, b)},${0.22 + t * 0.6})`;
}

export interface PitchShot {
  x: number;
  y: number;
  r?: number;
  color?: string;
  /** Cor do contorno (ex.: time). */
  stroke?: string;
  label?: string;
  title?: string;
  /** Gol para o qual o time ataca (padrão: direita). Define o destino da linha do chute. */
  side?: "left" | "right";
  isGoal?: boolean;
}

export function Pitch2D({
  width = 1000,
  height = 650,
  homeWeakness,
  awayWeakness,
  opportunityZones,
  homePlayers,
  awayPlayers,
  shots,
  heatCells,
  heatMax,
  shotLines,
  selectedShot,
  onShotClick,
  title,
  header,
  onZoneClick,
  onZoneHover,
  hoverZone,
  selectedZone,
}: {
  width?: number;
  height?: number;
  homeWeakness?: Record<string, number>; // zone -> weakness score
  awayWeakness?: Record<string, number>; // zone -> weakness score (from attacking-to-right perspective: this should be flipped)
  /** `side: "away"` desenha a zona espelhada (o visitante ataca para a esquerda). */
  opportunityZones?: { zone: PitchZone; value: number; side?: "home" | "away" }[];
  homePlayers?: { x: number; y: number; label: string; pos?: string }[];
  awayPlayers?: { x: number; y: number; label: string; pos?: string }[];
  /** Chutes sobre o gramado (coordenadas 0-100, ataque para a direita). */
  shots?: PitchShot[];
  /** Mapa de calor em células (coordenadas 0-100). */
  heatCells?: { x: number; y: number; w: number; h: number; value: number }[];
  heatMax?: number;
  /** Desenha uma linha de cada chute até o centro do gol. */
  shotLines?: boolean;
  selectedShot?: number | null;
  onShotClick?: (index: number) => void;
  title?: string;
  /** Conteúdo acima do gramado (ex.: logos dos times e sentido do ataque). */
  header?: React.ReactNode;
  /** Torna as 18 zonas clicáveis (como no campo 3D). `zone` é a zona como DESENHADA. */
  onZoneClick?: (zone: PitchZone, e: React.MouseEvent<SVGRectElement>) => void;
  onZoneHover?: (zone: PitchZone | null) => void;
  hoverZone?: PitchZone | null;
  selectedZone?: PitchZone | null;
}) {
  const vb = "-2 0 104 100";
  const stroke = "rgba(255,255,255,0.88)";
  // Linhas finas e nítidas (referência visual: traço delicado sobre o gramado).
  const sw = 0.16;
  const opp = (weakness: Record<string, number> | undefined, flip: boolean) => {
    if (!weakness) return null;
    const maxV = Math.max(0.001, ...Object.values(weakness));
    return ZONE_ORDER.map((z) => {
      let zone = z;
      if (flip) zone = flipZone(z);
      const g = ZONE_GEOMETRY[zone];
      if (!g) return null;
      const v = weakness[z] || 0;
      return (
        <rect key={`w-${flip ? "f" : "n"}-${z}`} x={g.x} y={g.y} width={g.w} height={g.h}
              fill={heatColor(v, maxV, "danger")} />
      );
    });
  };

  const opps = opportunityZones?.map((o, i) => {
    const g = ZONE_GEOMETRY[o.side === "away" ? flipZone(o.zone) : o.zone];
    if (!g) return null;
    const maxV = Math.max(0.001, ...(opportunityZones?.map((a) => a.value) || [1]));
    return (
      <rect key={`o-${i}-${o.zone}`} x={g.x} y={g.y} width={g.w} height={g.h}
            fill={heatColor(o.value, maxV, "good")} />
    );
  });

  return (
    <div className="sv-card">
      {title && <div className="px-5 pt-4 pb-2 text-sm font-semibold flex items-center justify-between">
        <div>{title}</div>
        <div className="flex gap-2 text-[10px] text-sv-muted">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: heatColor(0.7, 1, "good") }} />Oportunidade</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: heatColor(0.7, 1, "danger") }} />Fraqueza defensiva</span>
        </div>
      </div>}
      <div className="p-3 md:p-5">
        {header}
        <div className="rounded-2xl overflow-hidden pitch-gradient border border-white/10">
          <svg viewBox={vb} width="100%" preserveAspectRatio="xMidYMid meet" style={{ display: "block", aspectRatio: `${width} / ${height}` }}>
            {/* weaknesses: home team defends left 0-50, away right 50-100 */}
            {opp(homeWeakness, false)}
            {opp(awayWeakness, true)}
            {opps}
            {heatCells?.map((c, i) => (
              <rect key={`hc-${i}`} x={c.x} y={c.y} width={c.w} height={c.h}
                    fill={shotHeatColor(c.value, heatMax ?? 1)}>
                <title>{`${c.value.toFixed(2)}`}</title>
              </rect>
            ))}

            {/* sidelines */}
            <rect x="1" y="1" width="98" height="98" fill="none" stroke={stroke} strokeWidth={sw * 1.2} />
            {/* halfway */}
            <line x1="50" y1="1" x2="50" y2="99" stroke={stroke} strokeWidth={sw} />
            <circle cx="50" cy="50" r="9.15" fill="none" stroke={stroke} strokeWidth={sw} />
            <circle cx="50" cy="50" r="0.6" fill={stroke} />
            {/* own penalty area (left) */}
            <rect x="1" y="21" width="16" height="58" fill="none" stroke={stroke} strokeWidth={sw} />
            <rect x="1" y="34" width="6" height="32" fill="none" stroke={stroke} strokeWidth={sw} />
            <circle cx="11.5" cy="50" r="0.6" fill={stroke} />
            {/* away penalty area (right) */}
            <rect x="83" y="21" width="16" height="58" fill="none" stroke={stroke} strokeWidth={sw} />
            <rect x="93" y="34" width="6" height="32" fill="none" stroke={stroke} strokeWidth={sw} />
            <circle cx="88.5" cy="50" r="0.6" fill={stroke} />
            {/* penalty arc Ds: marca a 11 m do gol, raio de 9,15 m (elipse, pois o campo é normalizado 100x100) */}
            <path d={`M17,${50 - 10.4} A8.7 13.5 0 0 1 17,${50 + 10.4}`} fill="none" stroke={stroke} strokeWidth={sw} />
            <path d={`M83,${50 - 10.4} A8.7 13.5 0 0 0 83,${50 + 10.4}`} fill="none" stroke={stroke} strokeWidth={sw} />
            {/* gols: boca na linha de fundo, rede para fora do campo */}
            <rect x="-1" y="44" width="2" height="12" fill="none" stroke={stroke} strokeWidth={sw * 1.4} />
            <line x1="1" y1="44" x2="1" y2="56" stroke={stroke} strokeWidth={sw * 1.8} strokeLinecap="round" />
            <rect x="99" y="44" width="2" height="12" fill="none" stroke={stroke} strokeWidth={sw * 1.4} />
            <line x1="99" y1="44" x2="99" y2="56" stroke={stroke} strokeWidth={sw * 1.8} strokeLinecap="round" />
            {/* corner arcs */}
            <path d="M1,1 A2,2 0 0 0 3,3" fill="none" stroke={stroke} strokeWidth={sw} />
            <path d="M99,1 A2,2 0 0 1 97,3" fill="none" stroke={stroke} strokeWidth={sw} />
            <path d="M1,99 A2,2 0 0 1 3,97" fill="none" stroke={stroke} strokeWidth={sw} />
            <path d="M99,99 A2,2 0 0 0 97,97" fill="none" stroke={stroke} strokeWidth={sw} />

            {/* players */}
            {homePlayers?.map((p, i) => (
              <g key={`hp-${i}`}>
                <circle cx={p.x} cy={p.y} r="2.6" fill="#2563eb" stroke="white" strokeWidth="0.5"/>
                <text x={p.x} y={p.y + 0.8} textAnchor="middle" fontSize="2.2" fill="white" fontWeight="700">{p.label}</text>
              </g>
            ))}
            {awayPlayers?.map((p, i) => (
              <g key={`ap-${i}`}>
                <circle cx={p.x} cy={p.y} r="2.6" fill="#e1534e" stroke="white" strokeWidth="0.5"/>
                <text x={p.x} y={p.y + 0.8} textAnchor="middle" fontSize="2.2" fill="white" fontWeight="700">{p.label}</text>
              </g>
            ))}

            {/* linhas do chute até o centro do gol que o time ataca */}
            {shotLines && shots?.map((sh, i) => {
              const picked = selectedShot === i;
              const goalX = sh.side === "left" ? 1 : 99;
              return (
                <line key={`sl-${i}`} x1={sh.x} y1={sh.y} x2={goalX} y2={50}
                      stroke={sh.color ?? "#facc15"}
                      strokeOpacity={picked ? 0.95 : sh.isGoal ? 0.85 : 0.5}
                      strokeWidth={picked ? 0.45 : sh.isGoal ? 0.32 : 0.2}
                      strokeLinecap="round"
                      strokeDasharray={sh.isGoal || picked ? undefined : "1 0.7"} />
              );
            })}

            {/* chutes */}
            {shots?.map((sh, i) => {
              const picked = selectedShot === i;
              return (
                <g key={`sh-${i}`} style={onShotClick ? { cursor: "pointer" } : undefined}
                   onClick={onShotClick ? () => onShotClick(i) : undefined}>
                  <title>{sh.title}</title>
                  {picked && (
                    <circle cx={sh.x} cy={sh.y} r={(sh.r ?? 2.2) + 1.1} fill="none" stroke="white" strokeWidth="0.35" />
                  )}
                  <circle cx={sh.x} cy={sh.y} r={sh.r ?? 2.2} fill={sh.color ?? "#facc15"}
                          fillOpacity="0.8" stroke={sh.stroke ?? "white"} strokeWidth={sh.stroke ? 0.55 : 0.25} />
                  {sh.label && (
                    <text x={sh.x} y={sh.y + 0.75} textAnchor="middle" fontSize="1.9"
                          fill="#0b1220" fontWeight="700" pointerEvents="none">{sh.label}</text>
                  )}
                </g>
              );
            })}
            {/* camada clicável das zonas (por cima de tudo); destaque no hover e na zona selecionada */}
            {onZoneClick && ZONE_ORDER.map((z) => {
              const g = ZONE_GEOMETRY[z];
              const selected = selectedZone === z;
              const hovered = hoverZone === z;
              return (
                <rect key={`hit-${z}`} x={g.x} y={g.y} width={g.w} height={g.h}
                  fill={selected ? "rgba(255,255,255,0.14)" : hovered ? "rgba(255,255,255,0.09)" : "transparent"}
                  stroke={selected ? "rgba(255,255,255,0.95)" : hovered ? "rgba(255,255,255,0.55)" : "none"}
                  strokeWidth={selected ? 0.45 : 0.3}
                  style={{ cursor: "pointer" }}
                  tabIndex={0}
                  role="button"
                  aria-label={`Zona: ${g.label}`}
                  onClick={(e) => onZoneClick(z, e)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onZoneClick(z, e as unknown as React.MouseEvent<SVGRectElement>);
                    }
                  }}
                  onMouseEnter={() => onZoneHover?.(z)}
                  onMouseLeave={() => onZoneHover?.(null)} />
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}

export function flipZone(z: PitchZone): PitchZone {
  // Attack direction: right. When viewing an opponent's weakness, we invert left↔right and own↔opp.
  const map: Partial<Record<PitchZone, PitchZone>> = {
    own_box: "central_box",
    own_left_channel: "opp_right_channel",
    own_right_channel: "opp_left_channel",
    own_central_midfield: "opp_central_midfield",
    own_left_flank: "opp_right_flank",
    own_right_flank: "opp_left_flank",
    opp_left_flank: "own_right_flank",
    opp_right_flank: "own_left_flank",
    opp_left_channel: "own_right_channel",
    opp_right_channel: "own_left_channel",
    opp_central_midfield: "own_central_midfield",
    outside_box_left: "outside_box_right",
    outside_box_right: "outside_box_left",
    central_box: "own_box",
  };
  return (map[z] as PitchZone) || z;
}
