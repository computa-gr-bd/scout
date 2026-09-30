import type { PitchZone } from "../api/client";

// Zone geometry on a 100x100 pitch (0-100, 0-100)
// Pitch orientation: attacking team attacks to the right (x: 50..100)
export const ZONE_GEOMETRY: Record<PitchZone, { x: number; y: number; w: number; h: number; label: string }> = {
  own_box:                   { x: 0,   y: 21, w: 16, h: 58, label: "Own 6-yard box" },
  own_left_channel:          { x: 16,  y: 18, w: 14, h: 20, label: "Own left channel" },
  own_right_channel:         { x: 16,  y: 62, w: 14, h: 20, label: "Own right channel" },
  own_central_midfield:      { x: 16,  y: 38, w: 14, h: 24, label: "Own central midfield" },
  own_left_flank:            { x: 16,  y: 0,  w: 14, h: 18, label: "Own left flank" },
  own_right_flank:           { x: 16,  y: 82, w: 14, h: 18, label: "Own right flank" },
  neutral_midfield:          { x: 30,  y: 18, w: 40, h: 64, label: "Neutral midfield" },
  neutral_left_flank:        { x: 30,  y: 0,  w: 40, h: 18, label: "Neutral left flank" },
  neutral_right_flank:       { x: 30,  y: 82, w: 40, h: 18, label: "Neutral right flank" },
  opp_left_flank:            { x: 70,  y: 0,  w: 14, h: 18, label: "Opp. left flank" },
  opp_right_flank:           { x: 70,  y: 82, w: 14, h: 18, label: "Opp. right flank" },
  opp_left_channel:          { x: 70,  y: 18, w: 14, h: 20, label: "Opp. left channel" },
  opp_right_channel:         { x: 70,  y: 62, w: 14, h: 20, label: "Opp. right channel" },
  opp_central_midfield:      { x: 70,  y: 38, w: 14, h: 24, label: "Opp. central midfield" },
  outside_box_left:          { x: 84,  y: 21, w: 8,  h: 19, label: "Outside box (L)" },
  outside_box_right:         { x: 84,  y: 60, w: 8,  h: 19, label: "Outside box (R)" },
  outside_box_central:       { x: 84,  y: 40, w: 8,  h: 20, label: "Outside box (C)" },
  central_box:               { x: 92,  y: 29, w: 8,  h: 42, label: "Central box" },
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

export function Pitch2D({
  width = 1000,
  height = 650,
  homeWeakness,
  awayWeakness,
  opportunityZones,
  homePlayers,
  awayPlayers,
  title,
}: {
  width?: number;
  height?: number;
  homeWeakness?: Record<string, number>; // zone -> weakness score
  awayWeakness?: Record<string, number>; // zone -> weakness score (from attacking-to-right perspective: this should be flipped)
  opportunityZones?: { zone: PitchZone; value: number }[];
  homePlayers?: { x: number; y: number; label: string; pos?: string }[];
  awayPlayers?: { x: number; y: number; label: string; pos?: string }[];
  title?: string;
}) {
  const vb = "0 0 100 100";
  const stroke = "rgba(255,255,255,0.9)";
  const sw = 0.25;
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
    const g = ZONE_GEOMETRY[o.zone];
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
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: heatColor(0.7, 1, "good") }} />Opportunity</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: heatColor(0.7, 1, "danger") }} />Defensive weakness</span>
        </div>
      </div>}
      <div className="p-3 md:p-5">
        <div className="rounded-2xl overflow-hidden pitch-gradient border border-white/10">
          <svg viewBox={vb} width="100%" preserveAspectRatio="xMidYMid meet" style={{ display: "block", aspectRatio: `${width} / ${height}` }}>
            {/* weaknesses: home team defends left 0-50, away right 50-100 */}
            {opp(homeWeakness, false)}
            {opp(awayWeakness, true)}
            {opps}

            {/* sidelines */}
            <rect x="1" y="1" width="98" height="98" fill="none" stroke={stroke} strokeWidth={sw * 1.2} />
            {/* halfway */}
            <line x1="50" y1="1" x2="50" y2="99" stroke={stroke} strokeWidth={sw} />
            <circle cx="50" cy="50" r="9.15" fill="none" stroke={stroke} strokeWidth={sw} />
            <circle cx="50" cy="50" r="0.6" fill={stroke} />
            {/* own penalty area (left) */}
            <rect x="1" y="21" width="16" height="58" fill="none" stroke={stroke} strokeWidth={sw} />
            <rect x="1" y="34" width="6" height="32" fill="none" stroke={stroke} strokeWidth={sw} />
            <circle cx="16" cy="50" r="0.6" fill={stroke} />
            {/* away penalty area (right) */}
            <rect x="83" y="21" width="16" height="58" fill="none" stroke={stroke} strokeWidth={sw} />
            <rect x="93" y="34" width="6" height="32" fill="none" stroke={stroke} strokeWidth={sw} />
            <circle cx="84" cy="50" r="0.6" fill={stroke} />
            {/* penalty arc Ds */}
            <path d={`M16,${50 - 7.3} A9.15 9.15 0 0 1 16,${50 + 7.3}`} fill="none" stroke={stroke} strokeWidth={sw} />
            <path d={`M84,${50 - 7.3} A9.15 9.15 0 0 0 84,${50 + 7.3}`} fill="none" stroke={stroke} strokeWidth={sw} />
            {/* goal boxes */}
            <rect x="0.5" y="44" width="2" height="12" fill="none" stroke={stroke} strokeWidth={sw * 1.5} />
            <rect x="97.5" y="44" width="2" height="12" fill="none" stroke={stroke} strokeWidth={sw * 1.5} />
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
          </svg>
        </div>
      </div>
    </div>
  );
}

function flipZone(z: PitchZone): PitchZone {
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
