import type { Team, TeamStatistics } from "./client";

/**
 * Ligas disponíveis no seletor da tela de Times.
 * Por enquanto só Brasileirão e Bundesliga têm times mockados;
 * La Liga e Premier League ficam na lista aguardando dados.
 */
export interface League {
  id: string;
  name: string;
  short_name: string;
  country: string;
  season: string;
  /** Jogos de uma temporada completa (base para as estatísticas mock). */
  matches_per_season: number;
}

export const LEAGUES: League[] = [
  { id: "brasileirao", name: "Brasileirão Série A", short_name: "Brasileirão", country: "Brasil", season: "2026", matches_per_season: 38 },
  { id: "bundesliga", name: "Bundesliga", short_name: "Bundesliga", country: "Alemanha", season: "2026/27", matches_per_season: 34 },
  { id: "laliga", name: "La Liga", short_name: "La Liga", country: "Espanha", season: "2026/27", matches_per_season: 38 },
  { id: "premierleague", name: "Premier League", short_name: "Premier League", country: "Inglaterra", season: "2026/27", matches_per_season: 38 },
];

/** Time mockado = mesmo shape do `Team` da API + liga de origem. */
export type MockTeam = Team & { league_id: string };

/** Temporada 2026 (Brasileirão) e 2026/27 (Bundesliga) — listas reais. */
const TEAM_NAMES: Record<string, [name: string, code: string][]> = {
  brasileirao: [
    ["Flamengo", "FLA"],
    ["Palmeiras", "PAL"],
    ["Cruzeiro", "CRU"],
    ["Mirassol", "MIR"],
    ["Fluminense", "FLU"],
    ["Bahia", "BAH"],
    ["Botafogo", "BOT"],
    ["São Paulo", "SAO"],
    ["Red Bull Bragantino", "RBB"],
    ["Corinthians", "COR"],
    ["Grêmio", "GRE"],
    ["Vasco da Gama", "VAS"],
    ["Atlético-MG", "CAM"],
    ["Santos", "SAN"],
    ["Vitória", "VIT"],
    ["Internacional", "INT"],
    ["Coritiba", "CTR"],
    ["Athletico-PR", "ATH"],
    ["Chapecoense", "CHA"],
    ["Remo", "REM"],
  ],
  bundesliga: [
    ["Bayern Munich", "BAY"],
    ["Borussia Dortmund", "BVB"],
    ["RB Leipzig", "RBL"],
    ["VfB Stuttgart", "VFB"],
    ["Hoffenheim", "TSG"],
    ["Bayer Leverkusen", "B04"],
    ["Freiburg", "SCF"],
    ["Eintracht Frankfurt", "SGE"],
    ["Augsburg", "FCA"],
    ["Mainz 05", "M05"],
    ["Union Berlin", "FCU"],
    ["Borussia Mönchengladbach", "BMG"],
    ["Hamburg", "HSV"],
    ["Köln", "KOE"],
    ["Werder Bremen", "SVW"],
    ["Schalke 04", "S04"],
    ["Elversberg", "ELV"],
    ["Paderborn", "PAD"],
  ],
};

// --- geração determinística das estatísticas (mesmo time = mesmos números) ---

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function buildStats(name: string, league: League, id: number): TeamStatistics {
  const rnd = mulberry32(hash(name) ^ 0x9e3779b9);
  const strength = rnd(); // 0 (fraco) … 1 (forte)
  const played = league.matches_per_season;

  const wins = Math.min(played - 4, Math.max(2, Math.round(played * (0.16 + strength * 0.55))));
  const draws = Math.min(played - wins - 1, Math.max(3, Math.round(played * (0.3 - strength * 0.16))));
  const losses = played - wins - draws;

  const goalsFor = Math.round(played * (0.75 + strength * 1.7));
  const goalsAgainst = Math.round(played * (2.1 - strength * 1.35));
  const points = wins * 3 + draws;

  return {
    id,
    team_id: id,
    scope: "overall",
    matches_played: played,
    wins,
    draws,
    losses,
    goals_for: goalsFor,
    goals_against: goalsAgainst,
    shots_per_90: round2(8 + strength * 7),
    shots_on_target_per_90: round2(3 + strength * 3.5),
    xg_per_90: round2((goalsFor / played) * (0.92 + rnd() * 0.16)),
    xga_per_90: round2((goalsAgainst / played) * (0.92 + rnd() * 0.16)),
    goals_conceded_per_90: round2(goalsAgainst / played),
    shots_conceded_per_90: round2(9.5 - strength * 3.5),
    corners_per_90: round2(4 + rnd() * 3),
    points_per_game: round2(points / played),
    recent_form: null,
  };
}

function buildTeam(name: string, code: string, league: League, id: number): MockTeam {
  return {
    id,
    name,
    short_name: code,
    code,
    country: league.country,
    founded: 1900 + (hash(name) % 100),
    logo_url: null,
    data_source: "scoutvision_mock",
    statistics: [buildStats(name, league, id)],
    league_id: league.id,
  };
}

/** Base mock da tela de Times: 20 do Brasileirão + 18 da Bundesliga. */
export const MOCK_TEAMS: MockTeam[] = LEAGUES.flatMap((league, li) => {
  const baseId = 1001 + li * 100; // ids reservados p/ mock (não colidem com a API)
  return (TEAM_NAMES[league.id] || []).map(([name, code], i) => buildTeam(name, code, league, baseId + i));
});

const COUNT_BY_LEAGUE: Record<string, number> = Object.fromEntries(
  LEAGUES.map((l) => [l.id, MOCK_TEAMS.filter((t) => t.league_id === l.id).length] as const),
);

/** Quantidade de times mockados por liga (0 = liga ainda sem dados). */
export function leagueTeamCount(leagueId: string): number {
  return COUNT_BY_LEAGUE[leagueId] ?? 0;
}
