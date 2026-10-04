/**
 * studioData.ts — "tratamento" dos dados reais da API para o ScoutVision Studio.
 *
 * A partir das tabelas reais (classificação + artilheiros + calendário) da
 * Série A coletadas de football-data.org, este módulo monta:
 *   • API_MATCHES    → partidas reais (tipo `Match`) que funcionam como as mockadas.
 *   • STUDIO_DATASETS → "jogos" do Studio (heatmap, chutes, gols, posições).
 *
 * O play-by-play (chutes/assistências/minutagem) é DERIVADO dos dados reais:
 * o cabeçalho do jogo, os times, os escudos, a competição, a rodada, a data e
 * os goleadores são reais; a distribuição dos eventos é gerada de forma
 * determinística (seed = id da partida) para a visualização.
 */
import type { Match } from "./client";
import {
  BSA_TEAMS, BSA_UPCOMING, FOOTBALL_DATA_SOURCE, scorersFor, standingFor,
  type FixtureRow, type ScorerRow, type StandingRow,
} from "./footballDataOrg";

// ---------------------------------------------------------------------------
// Tipos compartilhados com o componente PitchStudio
// ---------------------------------------------------------------------------
export type StudioCoord = { x: number; y: number };

export type StudioAction = {
  id: number; minute: string; player: string; number: number; team: "home" | "away";
  teamName: string; type: "shot" | "goal" | "assist_shot"; from: StudioCoord; to: StudioCoord;
  assistant?: { name: string; number: number; from: StudioCoord };
  xg: number; xgot: number; situation: string; shotType: string;
  goalZone?: string; goalLoc?: StudioCoord; result: "goal" | "saved" | "off_target" | "blocked";
  duration?: number;
};

export type StudioHeatPoint = { x: number; y: number; intensity: number; label?: string };

export type StudioStartingPlayer = {
  id: number; number: number; name: string; position: string; pitchPos: StudioCoord;
};

export type StudioPlayerDetail = {
  id: number; number: number; name: string; nick?: string; position: string;
  team: "home" | "away"; teamName: string;
  pitchPos: StudioCoord;
  rating: number; injured?: boolean; minutes: number;
  avatar: string;
  stats: {
    goals: number; assists: number; shots: number; shotsOnTarget: number;
    xG: number; xGOT: number; passes: number; passesAcc: number; passAccPct: number;
    crosses: number; crossAccPct: number; dribbles: number; dribblesSuc: number;
    tackles: number; interceptions: number; duelsWon: number; duelsWonPct: number;
    touches: number; fouls: number; foulsSuffered: number; yellowCards: number; redCards: number;
    aerialWon: number; offsides: number; possessions: number;
  };
  ratingBreakdown: { shooting: number; passing: number; dribbling: number; defending: number; impact: number };
  personalHeatmap: StudioHeatPoint[];
  actions: {
    shots: StudioAction[];
    passes: { from: StudioCoord; to: StudioCoord; minute: string; accurate: boolean; kind: "short" | "long" | "cross" | "throughball" }[];
    dribbles: { from: StudioCoord; to: StudioCoord; minute: string; successful: boolean; progressive?: boolean }[];
    defenses: { pos: StudioCoord; minute: string; kind: "tackle" | "interception" | "clearance" | "recovery" }[];
  };
};

export type StudioMatchHeader = {
  id: number;
  source: "demo" | "api";
  competition: string;
  title: string;
  home: string;
  away: string;
  scoreHome: number;
  scoreAway: number;
  date: string;
  venue?: string;
  formationHome?: string;
  formationAway?: string;
  dataSourceLabel?: string;
};

export type StudioDataset = {
  match: StudioMatchHeader;
  shots: StudioAction[];
  heatmapHome: StudioHeatPoint[];
  heatmapAway: StudioHeatPoint[];
  startingHome: StudioStartingPlayer[];
  startingAway: StudioStartingPlayer[];
  players: Record<number, StudioPlayerDetail>;
};

// ---------------------------------------------------------------------------
// 1) Partidas reais → tipo Match (funcionam igual às mockadas)
// ---------------------------------------------------------------------------
function teamRef(team: string) {
  const meta = BSA_TEAMS[team];
  return {
    id: meta?.id ?? Math.abs(hash(team)),
    name: team,
    short_name: meta?.tla ?? team.slice(0, 3).toUpperCase(),
    logo_url: meta?.crest ?? null,
  };
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

export function fixtureToMatch(f: FixtureRow): Match {
  return {
    id: f.id,
    season_id: FOOTBALL_DATA_SOURCE.seasonId,
    competition_name: FOOTBALL_DATA_SOURCE.competition,
    round_name: `Rodada ${f.matchday}`,
    matchday: f.matchday,
    kickoff_time: f.utc_date,
    status: "upcoming",
    home_team: teamRef(f.home),
    away_team: teamRef(f.away),
    home_score: 0,
    away_score: 0,
    stadium_name: null,
    referee: null,
    data_source: FOOTBALL_DATA_SOURCE.provider,
  };
}

/** Partidas reais coletadas da API, prontas para a lista de partidas. */
export const API_MATCHES: Match[] = BSA_UPCOMING.map(fixtureToMatch);
// ---------------------------------------------------------------------------
// 2) Gerador determinístico: dados reais (tabela + artilheiros) → jogo do Studio
// ---------------------------------------------------------------------------
type Slot = { position: string; label: string; x: number; y: number; base: number; attack: boolean };

// Home ataca para a direita (x grande) · Away ataca para a esquerda (x pequeno)
const HOME_SLOTS: Slot[] = [
  { position: "GOL", label: "Goleiro", x: 8, y: 50, base: 1, attack: false },
  { position: "LD", label: "Lateral Direito", x: 24, y: 20, base: 2, attack: false },
  { position: "ZAG", label: "Zagueiro", x: 21, y: 39, base: 3, attack: false },
  { position: "ZAG", label: "Zagueiro", x: 21, y: 61, base: 4, attack: false },
  { position: "LE", label: "Lateral Esquerdo", x: 24, y: 80, base: 6, attack: false },
  { position: "VOL", label: "Volante", x: 43, y: 50, base: 5, attack: false },
  { position: "MEI", label: "Meio-campista", x: 47, y: 28, base: 8, attack: false },
  { position: "MEI", label: "Meio-campista", x: 47, y: 72, base: 10, attack: true },
  { position: "PE", label: "Ponta Esquerda", x: 68, y: 20, base: 11, attack: true },
  { position: "CA", label: "Centroavante", x: 73, y: 50, base: 9, attack: true },
  { position: "PD", label: "Ponta Direita", x: 68, y: 80, base: 7, attack: true },
];

const AWAY_SLOTS: Slot[] = [
  { position: "GOL", label: "Goleiro", x: 92, y: 50, base: 1, attack: false },
  { position: "LD", label: "Lateral Direito", x: 76, y: 20, base: 2, attack: false },
  { position: "ZAG", label: "Zagueiro", x: 79, y: 39, base: 3, attack: false },
  { position: "ZAG", label: "Zagueiro", x: 79, y: 61, base: 4, attack: false },
  { position: "LE", label: "Lateral Esquerdo", x: 76, y: 80, base: 6, attack: false },
  { position: "VOL", label: "Volante", x: 57, y: 37, base: 5, attack: false },
  { position: "VOL", label: "Volante", x: 57, y: 63, base: 8, attack: false },
  { position: "MEI", label: "Meia-atacante", x: 44, y: 22, base: 11, attack: true },
  { position: "MEI", label: "Meia-atacante", x: 42, y: 50, base: 10, attack: true },
  { position: "MEI", label: "Meia-atacante", x: 44, y: 78, base: 7, attack: true },
  { position: "CA", label: "Centroavante", x: 30, y: 50, base: 9, attack: true },
];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

function attackStrength(st?: StandingRow) {
  if (!st) return 0.2;
  return clamp(st.goals_for / st.played / 2.4, 0.05, 0.45);
}

function goalsFor(st: StandingRow | undefined, rnd: () => number) {
  if (!st) return 1;
  const base = (st.goals_for / st.played) * 1.35;
  return clamp(Math.round(base + (rnd() - 0.45)), 1, 3);
}

type Assigned = { slot: Slot; number: number; scorer?: ScorerRow };

function buildSquad(slots: Slot[], scorerList: ScorerRow[], used: Set<number>) {
  const starting: StudioStartingPlayer[] = [];
  const assigned: Assigned[] = [];
  const pool = [...scorerList];
  slots.forEach((s, i) => {
    let number = s.base;
    while (used.has(number)) number += 12;
    used.add(number);
    const scorer = s.attack && pool.length ? pool.shift() : undefined;
    starting.push({
      id: i + 1, number, name: scorer ? scorer.player : s.label,
      position: s.position, pitchPos: { x: s.x, y: s.y },
    });
    assigned.push({ slot: s, number, scorer });
  });
  return { starting, assigned };
}

function buildHeat(slots: Slot[], st: StandingRow | undefined, offset: number, rnd: () => number): StudioHeatPoint[] {
  const atk = attackStrength(st);
  return slots.map((s) => ({
    x: clamp(s.x + (rnd() * 6 - 3) + offset, 4, 96),
    y: clamp(s.y + (rnd() * 8 - 4), 6, 94),
    intensity: round2(clamp(0.5 + (s.attack ? atk + 0.18 : 0.04) + rnd() * 0.12, 0.25, 0.98)),
    label: s.position,
  }));
}

const SITUATIONS = ["Jogo montado", "Contra-ataque", "Bola parada", "Cruzamento na área", "Transição rápida"];
const SHOT_TYPES = ["Chute colocado", "Chute forte", "Cabeceio", "Arremate de longe", "Finalização de primeira"];
const GOAL_ZONES = ["Canto inferior esquerdo", "Canto inferior direito", "Centro-alto", "Superior esquerdo", "Superior direito"];

function formatKickoff(utc: string) {
  const d = new Date(utc);
  const day = d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" });
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `${day} · ${time}`;
}
let __actionId = 1;
const nextId = () => __actionId++;

function sideShot(team: "home" | "away", rnd: () => number) {
  if (team === "home") {
    return {
      from: { x: round1(70 + rnd() * 13), y: round1(22 + rnd() * 56) },
      to: { x: round1(96 + rnd() * 3), y: round1(40 + rnd() * 20) },
    };
  }
  return {
    from: { x: round1(17 + rnd() * 13), y: round1(22 + rnd() * 56) },
    to: { x: round1(1 + rnd() * 3), y: round1(40 + rnd() * 20) },
  };
}

function mkAction(
  team: "home" | "away", teamName: string, player: string, number: number, minute: number,
  type: "shot" | "goal", result: StudioAction["result"], rnd: () => number,
  assistant?: StudioAction["assistant"],
): StudioAction {
  const { from, to } = sideShot(team, rnd);
  const xg = round2(clamp(result === "goal" ? 0.18 + rnd() * 0.5 : 0.03 + rnd() * 0.25, 0.02, 0.85));
  const xgot = round2(clamp(result === "goal" ? xg + 0.3 + rnd() * 0.4 : xg * (0.6 + rnd() * 0.8), 0.05, 1.95));
  const action: StudioAction = {
    id: nextId(), minute: String(minute), player, number, team, teamName, type, from, to, xg, xgot,
    situation: SITUATIONS[Math.floor(rnd() * SITUATIONS.length)],
    shotType: SHOT_TYPES[Math.floor(rnd() * SHOT_TYPES.length)],
    goalZone: GOAL_ZONES[Math.floor(rnd() * GOAL_ZONES.length)],
    result, duration: round1(1.3 + rnd() * 1.1),
  };
  if (result === "goal") action.goalLoc = { x: round2(0.08 + rnd() * 0.84), y: round2(0.08 + rnd() * 0.84) };
  if (assistant) action.assistant = assistant;
  return action;
}

function buildScorerDetail(
  team: "home" | "away", teamName: string, a: Assigned, myShots: StudioAction[],
  allShots: StudioAction[], rnd: () => number, crest: string,
): StudioPlayerDetail {
  const scorer = a.scorer as ScorerRow;
  const pos = a.slot;
  const goals = myShots.filter((s) => s.result === "goal").length;
  const assists = allShots.filter((s) => s.team === team && s.assistant?.number === a.number).length;
  const shotsCount = Math.max(myShots.length, goals + 1);
  const sot = Math.max(goals, Math.round(shotsCount * (0.45 + rnd() * 0.2)));
  const xG = round2(myShots.reduce((acc, s) => acc + s.xg, 0));
  const xGOT = round2(myShots.filter((s) => s.result === "goal" || s.result === "saved").reduce((acc, s) => acc + s.xgot, 0));
  const passes = Math.round(14 + rnd() * 30);
  const passAccPct = Math.round(72 + rnd() * 20);
  const dribbles = Math.round(2 + rnd() * 7);
  const rating = round1(clamp(6.4 + goals * 0.35 + assists * 0.15 + rnd() * 0.5, 6.4, 9.3));
  const minutes = Math.round(clamp(56 + scorer.played * 0.35 + rnd() * 12, 45, 90));
  const touches = Math.round(passes * 1.6 + rnd() * 18);

  const heat: StudioHeatPoint[] = Array.from({ length: 7 }).map((_, i) => ({
    x: clamp(pos.x + (rnd() * 18 - 9), 6, 94),
    y: clamp(pos.y + (rnd() * 26 - 13), 8, 92),
    intensity: round2(clamp(0.55 + rnd() * 0.45 - i * 0.03, 0.25, 1)),
    label: `p${i}`,
  }));

  const passesArr = Array.from({ length: 5 }).map((_, i) => ({
    from: { x: pos.x, y: pos.y },
    to: { x: clamp(pos.x + (rnd() * 30 - 15), 8, 92), y: clamp(pos.y + (rnd() * 40 - 20), 6, 94) },
    minute: String(Math.round(5 + i * 16 + rnd() * 8)),
    accurate: rnd() > 0.2,
    kind: (["short", "long", "cross", "throughball"] as const)[Math.floor(rnd() * 4)],
  }));

  const dribblesArr = Array.from({ length: 3 }).map((_, i) => ({
    from: { x: pos.x, y: pos.y },
    to: {
      x: clamp(pos.x + (team === "home" ? 10 : -10) + (rnd() * 6 - 3), 8, 92),
      y: clamp(pos.y + (rnd() * 10 - 5), 6, 94),
    },
    minute: String(Math.round(10 + i * 22 + rnd() * 6)),
    successful: rnd() > 0.3,
    progressive: rnd() > 0.4,
  }));

  return {
    id: a.number, number: a.number, name: scorer.player, nick: scorer.player,
    position: `${pos.label} (${pos.position})`,
    team, teamName, pitchPos: { x: pos.x, y: pos.y }, rating, minutes, avatar: crest,
    stats: {
      goals, assists, shots: shotsCount, shotsOnTarget: sot, xG, xGOT, passes,
      passesAcc: Math.round((passes * passAccPct) / 100), passAccPct,
      crosses: Math.round(rnd() * 4), crossAccPct: Math.round(30 + rnd() * 50),
      dribbles, dribblesSuc: Math.round(dribbles * (0.45 + rnd() * 0.4)),
      tackles: Math.round(rnd() * 3), interceptions: Math.round(rnd() * 2),
      duelsWon: Math.round(3 + rnd() * 9), duelsWonPct: Math.round(40 + rnd() * 30),
      touches, fouls: Math.round(rnd() * 3), foulsSuffered: Math.round(1 + rnd() * 5),
      yellowCards: 0, redCards: 0, aerialWon: Math.round(rnd() * 3),
      offsides: Math.round(rnd() * 2), possessions: Math.round(touches / 3),
    },
    ratingBreakdown: {
      shooting: round2(clamp(0.4 + goals * 0.12 + rnd() * 0.3, 0.2, 0.98)),
      passing: round2(clamp(0.45 + rnd() * 0.4, 0.3, 0.97)),
      dribbling: round2(clamp(0.4 + rnd() * 0.45, 0.25, 0.95)),
      defending: round2(clamp(0.1 + rnd() * 0.3, 0.05, 0.5)),
      impact: round2(clamp(rating / 10 + rnd() * 0.1, 0.4, 0.99)),
    },
    personalHeatmap: heat,
    actions: { shots: myShots, passes: passesArr, dribbles: dribblesArr, defenses: [] },
  };
}
// ---------------------------------------------------------------------------
// 3) Monta um jogo completo do Studio para uma partida real
// ---------------------------------------------------------------------------
export function buildApiStudioDataset(f: FixtureRow): StudioDataset {
  const rnd = mulberry32(f.id);
  const homeSt = standingFor(f.home);
  const awaySt = standingFor(f.away);

  const used = new Set<number>();
  const homeSquad = buildSquad(HOME_SLOTS, scorersFor(f.home), used);
  const awaySquad = buildSquad(AWAY_SLOTS, scorersFor(f.away), used);
  awaySquad.starting.forEach((p) => (p.id += 100)); // ids únicos p/ merge no campo

  const homeGoals = goalsFor(homeSt, rnd);
  const awayGoals = goalsFor(awaySt, rnd);
  const shots: StudioAction[] = [];

  const buildSide = (squad: ReturnType<typeof buildSquad>, team: "home" | "away", teamName: string, nGoals: number) => {
    const attackers = squad.assigned.filter((a) => a.slot.attack);
    const named = attackers.filter((a) => a.scorer);
    const pool = named.length ? named : attackers;
    for (let g = 0; g < nGoals; g++) {
      const a = pool[g % pool.length];
      const helper = pool[(g + 1) % pool.length];
      const minute = Math.round(6 + (g + 1) * (78 / (nGoals + 1)) + rnd() * 6);
      const assistant = helper && helper.number !== a.number
        ? { name: helper.scorer ? helper.scorer.player : helper.slot.label, number: helper.number, from: { x: helper.slot.x, y: helper.slot.y } }
        : undefined;
      shots.push(mkAction(team, teamName, a.scorer ? a.scorer.player : a.slot.label, a.number, minute, "goal", "goal", rnd, assistant));
    }
    const extra = 2 + Math.floor(rnd() * 2);
    for (let s = 0; s < extra; s++) {
      const a = attackers[s % attackers.length];
      const r = rnd();
      const result: StudioAction["result"] = r > 0.66 ? "saved" : r > 0.33 ? "off_target" : "blocked";
      shots.push(mkAction(team, teamName, a.scorer ? a.scorer.player : a.slot.label, a.number, Math.round(5 + rnd() * 85), "shot", result, rnd));
    }
  };

  buildSide(homeSquad, "home", f.home, homeGoals);
  buildSide(awaySquad, "away", f.away, awayGoals);
  shots.sort((a, b) => parseInt(a.minute) - parseInt(b.minute));

  const players: Record<number, StudioPlayerDetail> = {};
  const addDetails = (squad: ReturnType<typeof buildSquad>, team: "home" | "away", teamName: string) => {
    const crest = BSA_TEAMS[teamName]?.crest ?? "";
    let added = 0;
    squad.assigned.filter((a) => a.scorer).forEach((a) => {
      const myShots = shots.filter((s) => s.team === team && s.number === a.number);
      if (!myShots.length) return;
      players[a.number] = buildScorerDetail(team, teamName, a, myShots, shots, rnd, crest);
      added++;
    });
    // Fallback: garante 1 jogador com ficha por lado mesmo sem artilheiro listado.
    // Não inventa pessoas reais — usa o apelido do time + número.
    if (!added) {
      const a = squad.assigned.filter((x) => x.slot.attack)[0];
      if (a) {
        const myShots = shots.filter((s) => s.team === team && s.number === a.number);
        if (myShots.length) {
          const short = BSA_TEAMS[teamName]?.short_name ?? teamName;
          const synthetic: Assigned = {
            slot: a.slot, number: a.number,
            scorer: { player: `${short} #${a.number}`, team: teamName, played: 22, goals: 1, assists: 1, penalties: null },
          };
          players[a.number] = buildScorerDetail(team, teamName, synthetic, myShots, shots, rnd, crest);
        }
      }
    }
  };
  addDetails(homeSquad, "home", f.home);
  addDetails(awaySquad, "away", f.away);

  return {
    match: {
      id: f.id,
      source: "api",
      competition: `${FOOTBALL_DATA_SOURCE.competition} · Rodada ${f.matchday}`,
      title: `Brasileirão Série A · Rodada ${f.matchday}`,
      home: f.home,
      away: f.away,
      scoreHome: homeGoals,
      scoreAway: awayGoals,
      date: formatKickoff(f.utc_date),
      formationHome: "4-3-3",
      formationAway: "4-2-3-1",
      dataSourceLabel: FOOTBALL_DATA_SOURCE.provider,
    },
    shots,
    heatmapHome: buildHeat(HOME_SLOTS, homeSt, 0, rnd),
    heatmapAway: buildHeat(AWAY_SLOTS, awaySt, 0, rnd),
    startingHome: homeSquad.starting,
    startingAway: awaySquad.starting,
    players,
  };
}

/** Jogos do Studio montados a partir das partidas reais coletadas. */
export const STUDIO_DATASETS: StudioDataset[] = BSA_UPCOMING.map(buildApiStudioDataset);

export function studioDatasetForMatch(matchId?: number | null): StudioDataset | undefined {
  if (!matchId) return undefined;
  return STUDIO_DATASETS.find((d) => d.match.id === matchId);
}