/**
 * studioReal.ts — converte o payload REAL de `/matches/{id}/studio`
 * (Understat / StatsBomb / football-data) no `StudioDataset` que o
 * PitchStudio desenha.
 *
 * Regra de ouro: nada aqui é inventado. Campo que a fonte não fornece
 * (xGOT, passes, dribles, nota…) fica `null`/zerado e a UI esconde ou mostra "—".
 */
import type {
  MatchStudioPayload, StudioApiLineupPlayer, StudioApiPlayer, StudioApiShot,
} from "./client";
import type {
  StudioAction, StudioCoord, StudioDataset, StudioHeatPoint, StudioPlayerDetail, StudioStartingPlayer,
} from "./studioData";

const SITUATION_PT: Record<string, string> = {
  openplay: "Jogo corrido", fromcorner: "Escanteio", setpiece: "Bola parada",
  directfreekick: "Falta direta", freekick: "Falta", penalty: "Pênalti",
  corner: "Escanteio", throwin: "Lateral", kickoff: "Saída de bola",
};
const BODY_PT: Record<string, string> = {
  right_foot: "Pé direito", left_foot: "Pé esquerdo", head: "Cabeça", other: "Outra parte do corpo",
  rightfoot: "Pé direito", leftfoot: "Pé esquerdo", otherbodypart: "Outra parte do corpo",
};

const compact = (t: string | null | undefined) => (t ?? "").toLowerCase().replace(/[^a-z]/g, "");
const situationPt = (t: string | null) => SITUATION_PT[compact(t)] ?? (t || "—");
const bodyPt = (b: string | null, shotType: string | null) =>
  (b && BODY_PT[compact(b)]) || (shotType && BODY_PT[compact(shotType)]) || shotType || "—";

function normName(n: string | null | undefined) {
  return (n ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function formatKickoff(iso: string | null) {
  if (!iso) return "Data não disponível";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Data não disponível";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

const GOAL_X = (team: "home" | "away") => (team === "home" ? 100 : 0);

/** Duração da animação proporcional à distância do chute (só visual). */
function durationFor(from: StudioCoord, to: StudioCoord) {
  const d = Math.hypot(to.x - from.x, (to.y - from.y) * 0.68);
  return Math.round((1.1 + Math.min(d, 45) * 0.025) * 10) / 10;
}

function toAction(s: StudioApiShot, teamName: string): StudioAction {
  const from = { x: s.x, y: s.y };
  const to = { x: s.end_known ? s.end_x : GOAL_X(s.team), y: s.end_known ? s.end_y : 50 };
  return {
    id: s.id,
    minute: String(s.minute),
    player: s.player ?? "Jogador não identificado",
    number: 0,
    team: s.team,
    teamName,
    type: s.result === "goal" ? "goal" : "shot",
    from, to,
    assistant: s.assisted_by ? { name: s.assisted_by, number: 0 } : undefined,
    xg: s.xg ?? 0,
    xgot: s.xgot,
    situation: situationPt(s.situation),
    shotType: bodyPt(s.body_part, s.shot_type),
    result: s.result,
    duration: durationFor(from, to),
    matchLabel: s.match_label ?? undefined,
  };
}

function toHeat(list: { x: number; y: number; intensity: number }[], label: string): StudioHeatPoint[] {
  return list.map((h) => ({ x: h.x, y: h.y, intensity: h.intensity, label }));
}

export function payloadToDataset(p: MatchStudioPayload): StudioDataset {
  const homeName = p.match.home.name ?? "Mandante";
  const awayName = p.match.away.name ?? "Visitante";
  const teamName = (t: "home" | "away") => (t === "home" ? homeName : awayName);
  const finished = p.match.status === "finished" && p.match.home_score != null && p.match.away_score != null;

  // Chutes: no modo "match" ordena por minuto; em "forma recente" mantém jogo a jogo.
  const apiShots = p.mode === "match"
    ? [...p.shots].sort((a, b) => a.minute - b.minute)
    : p.shots;
  const shots = apiShots.map((s) => toAction(s, teamName(s.team)));

  // -------- fichas de jogador --------
  const keyToId = new Map<string, number>();
  p.players.forEach((pl, i) => keyToId.set(pl.key, i + 1));

  const lineupByKey = new Map<string, StudioApiLineupPlayer>();
  [...p.lineups.home, ...p.lineups.away].forEach((lp) => { if (lp.detail_key) lineupByKey.set(lp.detail_key, lp); });

  const players: Record<number, StudioPlayerDetail> = {};
  p.players.forEach((pl: StudioApiPlayer, i) => {
    const id = i + 1;
    const lp = lineupByKey.get(pl.key);
    const mine = shots.filter((s, idx) => {
      const raw = apiShots[idx];
      return raw.team === pl.team && normName(raw.player) === normName(pl.name) && s.id === raw.id;
    });
    const knownXgot = mine.map((s) => s.xgot).filter((v): v is number => v != null);
    const pos: StudioCoord = lp ? { x: lp.pitch_x, y: lp.pitch_y } : { x: pl.team === "home" ? 72 : 28, y: 50 };
    const maxXg = Math.max(0.01, ...mine.map((s) => s.xg));
    const crest = pl.team === "home" ? p.match.home.logo_url : p.match.away.logo_url;
    players[id] = {
      id, number: pl.shirt_number ?? 0, name: pl.name, nick: pl.name,
      position: pl.position ?? lp?.line_label ?? "—",
      team: pl.team, teamName: teamName(pl.team), pitchPos: pos,
      rating: 0, minutes: pl.minutes ?? 0, avatar: crest ?? "",
      stats: {
        goals: pl.match.goals, assists: pl.match.assists, shots: pl.match.shots,
        shotsOnTarget: pl.match.shots_on_target, xG: pl.match.xg,
        xGOT: knownXgot.length ? Math.round(knownXgot.reduce((a, b) => a + b, 0) * 100) / 100 : null,
        passes: 0, passesAcc: 0, passAccPct: 0, crosses: 0, crossAccPct: 0, dribbles: 0, dribblesSuc: 0,
        tackles: 0, interceptions: 0, duelsWon: 0, duelsWonPct: 0, touches: 0, fouls: 0, foulsSuffered: 0,
        yellowCards: 0, redCards: 0, aerialWon: 0, offsides: 0, possessions: 0,
      },
      ratingBreakdown: { shooting: 0, passing: 0, dribbling: 0, defending: 0, impact: 0 },
      personalHeatmap: mine.map((s, k) => ({ x: s.from.x, y: s.from.y, intensity: Math.max(0.35, s.xg / maxXg), label: `s${k}` })),
      real: {
        xa: pl.match.xa, keyPasses: pl.match.key_passes,
        matchLabel: p.mode === "recent_form" ? `Últimos ${Math.max(p.recent_match_ids.home.length, p.recent_match_ids.away.length)} jogos` : undefined,
        season: pl.season ? {
          matches: pl.season.matches, minutes: pl.season.minutes, goals: pl.season.goals, assists: pl.season.assists,
          shots: pl.season.shots, xg: pl.season.xg, xa: pl.season.xa, keyPasses: pl.season.key_passes,
        } : null,
      },
      actions: { shots: mine, passes: [], dribbles: [], defenses: [] },
    };
  });

  // -------- escalação (campo) --------
  const toStarting = (list: StudioApiLineupPlayer[], idOffset: number): StudioStartingPlayer[] =>
    list.map((lp, i) => ({
      id: idOffset + i + 1,
      number: lp.shirt_number ?? 0,
      name: lp.name ?? "—",
      position: lp.line_label ?? lp.position ?? "—",
      pitchPos: { x: lp.pitch_x, y: lp.pitch_y },
      detailKey: lp.detail_key ? keyToId.get(lp.detail_key) : undefined,
      estimated: lp.estimated,
    }));

  const notes = [...p.coverage.notes];
  if (p.mode === "recent_form") notes.unshift("Pré-jogo: mapa e chutes mostram o padrão recente de cada time, não esta partida.");

  const sourceLabel = p.mode === "none"
    ? "sem dados de chutes"
    : p.mode === "recent_form"
      ? "forma recente (Understat/StatsBomb)"
      : (p.source ?? p.match.match_data_source ?? "fonte real");

  return {
    match: {
      id: p.match_id,
      source: "real",
      competition: [p.match.competition, p.match.round_name].filter(Boolean).join(" · ") || "Partida",
      title: [p.match.competition, p.match.round_name].filter(Boolean).join(" · ") || "Partida em análise",
      home: homeName, away: awayName,
      scoreHome: p.match.home_score ?? 0,
      scoreAway: p.match.away_score ?? 0,
      scoreKnown: finished,
      homeLogo: p.match.home.logo_url,
      awayLogo: p.match.away.logo_url,
      date: formatKickoff(p.match.kickoff_time),
      venue: p.match.venue ?? undefined,
      formationHome: p.lineups.home.length ? (p.lineups.formation ?? undefined) : undefined,
      formationAway: p.lineups.away.length ? (p.lineups.formation ?? undefined) : undefined,
      dataSourceLabel: sourceLabel,
      mode: p.mode,
      notes,
    },
    shots,
    heatmapHome: toHeat(p.heatmap.home, "xG"),
    heatmapAway: toHeat(p.heatmap.away, "xG"),
    startingHome: toStarting(p.lineups.home, 0),
    startingAway: toStarting(p.lineups.away, 100),
    players,
  };
}
