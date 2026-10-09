import { Link } from "react-router-dom";
import { TeamLogo } from "./ui";

export interface LineupPlayer {
  player_id: number;
  player_name: string | null;
  position: string | null;
  shirt_number?: number | null;
  minutes_played?: number | null;
  line?: string | null;
  pitch_x?: number | null;
  pitch_y?: number | null;
  estimated?: boolean;
}

export interface MatchLineups {
  match_id: number;
  source: "official" | "estimated" | "none";
  formation: string | null;
  home: LineupPlayer[];
  away: LineupPlayer[];
  goals: MatchGoal[];
  home_team?: { id: number; name: string | null; logo_url: string | null } | null;
  away_team?: { id: number; name: string | null; logo_url: string | null } | null;
}

export interface MatchGoal {
  minute: number | null;
  team_id: number | null;
  scorer_player_id: number;
  scorer_name: string | null;
  assist_name?: string | null;
  is_penalty: boolean;
  is_own_goal: boolean;
}

const HOME_COLOR = "#2563eb";
const AWAY_COLOR = "#e1534e";
const STROKE = "rgba(255,255,255,0.9)";
const SW = 0.28;

/** Campo em pé, proporções alongadas de um campo real (68 x 105 m). */
const FIELD_W = 76;
const FIELD_H = 160;
const CENTER_Y = 80;
const R = 4.5;

/** Linhas do 4-3-3: cada time ocupa só a sua metade, então nunca se sobrepõem.
 *  As duas linhas de ataque ficam a 24 de distância, o que garante espaço para
 *  o nome desenhado abaixo de cada círculo. */
const ROWS: Record<string, { home: number; away: number }> = {
  GK: { home: 146, away: 14 },
  DEF: { home: 128, away: 32 },
  MID: { home: 110, away: 50 },
  ATT: { home: 92, away: 68 },
};

function initials(name?: string | null) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function lastName(name?: string | null) {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(-2).join(" ") : name;
}

/** Linha declarada pelo backend; sem ela, cai na faixa de profundidade. */
function lineOf(p: LineupPlayer): string {
  if (p.line && ROWS[p.line]) return p.line;
  const x = p.pitch_x ?? 0;
  if (x < 17) return "GK";
  if (x < 38) return "DEF";
  if (x < 62) return "MID";
  return "ATT";
}

/** `pitch_y` (0..100, lateral) vira a largura do campo retrato. */
function xOf(p: LineupPlayer) {
  return 6 + ((p.pitch_y ?? 50) / 100) * (FIELD_W - 12);
}

function PlayerMark({ p, y, color, goals, estimated }: {
  p: LineupPlayer;
  y: number;
  color: string;
  goals: number;
  estimated: boolean;
}) {
  const x = xOf(p);
  return (
    <g>
      <circle cx={x} cy={y} r={R} fill={color} stroke="white" strokeWidth="0.6" />
      {estimated && (
        <circle cx={x} cy={y} r={R + 1.4} fill="none" stroke="white"
                strokeWidth="0.35" strokeDasharray="1.6 1.4" opacity="0.75" />
      )}
      <text x={x} y={y + 1.6} textAnchor="middle" fontSize="4.6"
            fill="white" fontWeight="700">
        {p.shirt_number ?? initials(p.player_name)}
      </text>
      {goals > 0 && (
        <g>
          <circle cx={x + 4.6} cy={y - 4.6} r="3.1" fill="#facc15" stroke="#1f2937" strokeWidth="0.4" />
          <text x={x + 4.6} y={y - 3.3} textAnchor="middle" fontSize="3.6"
                fill="#1f2937" fontWeight="800">
            {goals}
          </text>
        </g>
      )}
      <text x={x} y={y + R + 5} textAnchor="middle" fontSize="3.5" fill="white"
            fontWeight="600" style={{ paintOrder: "stroke" }}
            stroke="rgba(0,0,0,0.8)" strokeWidth="1.1">
        {lastName(p.player_name)}
      </text>
    </g>
  );
}

/** Campo 2D em pé: casa na metade de baixo (ataca pra cima), fora na de cima. */
export function LineupPitch({ data }: { data: MatchLineups; title?: string }) {
  const goalsByPlayer = new Map<number, number>();
  data.goals.forEach((g) => {
    if (!g.is_own_goal) {
      goalsByPlayer.set(g.scorer_player_id, (goalsByPlayer.get(g.scorer_player_id) || 0) + 1);
    }
  });

  const render = (side: "home" | "away") =>
    data[side].filter((p) => p.pitch_x != null || p.line).map((p) => ({
      p,
      y: ROWS[lineOf(p)][side],
    }));

  const home = render("home");
  const away = render("away");

  return (
    <div className="sv-card">
      <div className="sv-card-inner space-y-3">
        {/* Cabeçalho: fora em cima, casa embaixo — mesma ordem do campo */}
        <div className="grid grid-cols-2 gap-3">
          {(["away", "home"] as const).map((side) => {
            const team = side === "home" ? data.home_team : data.away_team;
            return (
              <div key={side} className="flex items-center gap-2 min-w-0">
                <span className="w-2.5 h-2.5 rounded-sm shrink-0"
                      style={{ background: side === "home" ? HOME_COLOR : AWAY_COLOR }} />
                <TeamLogo name={team?.name ?? undefined} src={team?.logo_url ?? undefined}
                          className="w-6 h-6 shrink-0" />
                <div className="text-sm font-semibold truncate min-w-0">
                  {team?.name || (side === "home" ? "Casa" : "Fora")}
                </div>
                <span className="sv-chip !py-0 ml-auto shrink-0">{data[side].length}</span>
              </div>
            );
          })}
        </div>

        <div className="rounded-2xl overflow-hidden pitch-gradient border border-white/10">
          <svg viewBox={`0 0 ${FIELD_W} ${FIELD_H}`} width="100%"
               preserveAspectRatio="xMidYMid meet"
               style={{ display: "block", aspectRatio: `${FIELD_W} / ${FIELD_H}` }}>
            <rect x="2" y="2" width={FIELD_W - 4} height={FIELD_H - 4}
                  fill="none" stroke={STROKE} strokeWidth={SW * 1.2} />
            <line x1="2" y1={CENTER_Y} x2={FIELD_W - 2} y2={CENTER_Y}
                  stroke={STROKE} strokeWidth={SW} />
            <circle cx={FIELD_W / 2} cy={CENTER_Y} r="9.15" fill="none"
                    stroke={STROKE} strokeWidth={SW} />
            <circle cx={FIELD_W / 2} cy={CENTER_Y} r="0.6" fill={STROKE} />

            {/* Área do time de cima (gol em cima) */}
            <rect x="16" y="2" width="40" height="16.5" fill="none" stroke={STROKE} strokeWidth={SW} />
            <rect x="26" y="2" width="20" height="5.5" fill="none" stroke={STROKE} strokeWidth={SW} />
            <rect x="32.3" y="0.6" width="7.4" height="1.6" fill="none" stroke={STROKE} strokeWidth={SW} />

            {/* Área do time de baixo (gol embaixo) */}
            <rect x="16" y={FIELD_H - 18.5} width="40" height="16.5"
                  fill="none" stroke={STROKE} strokeWidth={SW} />
            <rect x="26" y={FIELD_H - 7.5} width="20" height="5.5"
                  fill="none" stroke={STROKE} strokeWidth={SW} />
            <rect x="32.3" y={FIELD_H - 2.2} width="7.4" height="1.6"
                  fill="none" stroke={STROKE} strokeWidth={SW} />

            {away.map(({ p, y }) => (
              <PlayerMark key={`a-${p.player_id}`} p={p} y={y} color={AWAY_COLOR}
                          goals={goalsByPlayer.get(p.player_id) || 0}
                          estimated={!!p.estimated} />
            ))}
            {home.map(({ p, y }) => (
              <PlayerMark key={`h-${p.player_id}`} p={p} y={y} color={HOME_COLOR}
                          goals={goalsByPlayer.get(p.player_id) || 0}
                          estimated={!!p.estimated} />
            ))}
          </svg>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-sv-muted">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full inline-block"
                  style={{ background: HOME_COLOR }} /> casa (ataque para cima)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full inline-block"
                  style={{ background: AWAY_COLOR }} /> fora (ataque para baixo)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-grid place-items-center w-3.5 h-3.5 rounded-full bg-[#facc15] text-[#1f2937] text-[9px] font-extrabold">1</span>
            gols na partida
          </span>
          {data.source === "estimated" && (
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full inline-block border border-dashed border-white/70" />
              provável XI (estimado)
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Lista textual dos dois XI, marcando quem fez gol. */
export function LineupLists({ data }: { data: MatchLineups }) {
  const goalsByPlayer = new Map<number, number>();
  data.goals.forEach((g) => {
    if (!g.is_own_goal) {
      goalsByPlayer.set(g.scorer_player_id, (goalsByPlayer.get(g.scorer_player_id) || 0) + 1);
    }
  });
  const teamName = (side: "home" | "away") =>
    (side === "home" ? data.home_team?.name : data.away_team?.name)
    || (side === "home" ? "Casa" : "Fora");

  return (
    <div className="grid md:grid-cols-2 gap-4">
      {(["home", "away"] as const).map((side) => (
        <div key={side} className="sv-card">
          <div className="sv-card-inner">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2.5 h-2.5 rounded-sm"
                    style={{ background: side === "home" ? HOME_COLOR : AWAY_COLOR }} />
              <div className="font-semibold text-sm truncate">{teamName(side)}</div>
              <span className="sv-chip !py-0 ml-auto">{data[side].length} titulares</span>
            </div>
            <div className="space-y-1">
              {data[side].map((p, i) => (
                <div key={p.player_id} className="flex items-center gap-2 text-sm py-0.5">
                  <span className="sv-label w-8 text-right font-mono">
                    {p.shirt_number ?? i + 1}
                  </span>
                  <Link to={`/players/${p.player_id}`}
                        className="hover:text-sv-accent3 truncate min-w-0 flex-1">
                    {p.player_name}
                  </Link>
                  {p.position && <span className="sv-chip !py-0 text-[10px]">{p.position}</span>}
                  {goalsByPlayer.get(p.player_id) ? (
                    <span className="sv-chip-accent !py-0 text-[10px]">
                      ⚽ {goalsByPlayer.get(p.player_id)}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Gols da partida em ordem cronológica. */
export function GoalList({ data }: { data: MatchLineups }) {
  if (!data.goals.length) return null;
  const nameOf = (teamId: number | null) => {
    if (data.home_team?.id === teamId) return data.home_team?.name || "";
    if (data.away_team?.id === teamId) return data.away_team?.name || "";
    return "";
  };
  return (
    <div className="sv-card">
      <div className="sv-card-inner">
        <div className="font-semibold text-sm mb-2">Gols da partida</div>
        <div className="space-y-1.5">
          {data.goals.map((g, i) => (
            <div key={i} className="flex items-center gap-2 text-sm flex-wrap">
              <span className="font-mono tabular-nums text-sv-muted w-10 text-right">
                {g.minute != null ? `${g.minute}'` : "—"}
              </span>
              <span className="font-medium">{g.scorer_name || "—"}</span>
              {g.is_penalty && <span className="sv-chip !py-0 text-[10px]">pênalti</span>}
              {g.is_own_goal && (
                <span className="sv-chip !py-0 text-[10px] text-sv-warn border-sv-warn/40">gol contra</span>
              )}
              {g.assist_name && <span className="text-xs text-sv-muted">assist. {g.assist_name}</span>}
              <span className="sv-chip !py-0 text-[10px] ml-auto">{nameOf(g.team_id)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
