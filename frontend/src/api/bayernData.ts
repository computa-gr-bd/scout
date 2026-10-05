import { MOCK_TEAMS } from "./teamsData";

/**
 * Conteúdo mockado da página de detalhe do time (`/teams/:id`).
 * Por enquanto só o Bayern de Munique tem elenco/jogos/mock completo —
 * os outros times continuam não clicáveis na lista.
 * IDs vêm do `MOCK_TEAMS` (≥1001), nunca colidem com a API.
 */

export type SquadGroupKey = "goleiros" | "defensores" | "meio" | "atacantes";

export interface SquadPlayer {
  name: string;
  age: number;
  position: string;
  group: SquadGroupKey;
  /** Nota média mockada (0–10). */
  rating: number;
  /** Gols na temporada — a soma deve bater com o `gf` do time na classificação. */
  goals: number;
  /** Assistências na temporada. */
  assists: number;
}

/** Ordem de exibição do elenco (separado por linha). */
export const SQUAD_GROUPS = [
  { key: "goleiros", label: "GOLEIROS" },
  { key: "defensores", label: "DEFENSORES" },
  { key: "meio", label: "MEIO-CAMPISTAS" },
  { key: "atacantes", label: "ATACANTES" },
] as const;

export interface ClubFixture {
  /** "17/10/2026" — mock, sempre futuro em relação à temporada. */
  date: string;
  time: string;
  competition: string;
  home: string;
  away: string;
}

export interface StandingRow {
  /** Nome exatamente como em `MOCK_TEAMS` (mesmo logo nos cards). */
  team: string;
  wins: number;
  draws: number;
  losses: number;
  gf: number;
  ga: number;
}

export interface DerivedStanding extends StandingRow {
  pos: number;
  played: number;
  pts: number;
  gd: number;
}

export interface TeamAdvancedStats {
  xg_per_game: number;
  xga_per_game: number;
  shots_per_game: number;
  shots_on_target_per_game: number;
  shots_conceded_per_game: number;
  clean_sheets: number;
  big_chances_per_game: number;
  saves_per_game: number;
  possession: number;
  passes_per_game: number;
  pass_accuracy: number;
}

export interface ClubInfo {
  coach: string;
  founded: string;
  stadium: { name: string; capacity: number; city: string };
  competitions: string[];
  titles: { name: string; count: number }[];
}

export interface TeamDetail {
  teamId: number;
  /** Nome de exibição ("Bayern de Munique") — o `MockTeam.name` continua "Bayern Munich". */
  display_name: string;
  season: string;
  squad: SquadPlayer[];
  fixtures: ClubFixture[];
  standings: StandingRow[];
  advanced: TeamAdvancedStats;
  club: ClubInfo;
}

// ---------------------------------------------------------------------------
// Elenco — BAYERN DE MUNIQUE — ELENCO 2026/27 (fornecido pelo usuário)
// Invariante: soma dos `goals` = 21 (gf do Bayern na classificação);
//             soma dos `assists` = 15 (exibida em Estatísticas).
// ---------------------------------------------------------------------------
const BAYERN_SQUAD: SquadPlayer[] = [
  // GOLEIROS
  { name: "Manuel Neuer", age: 40, position: "Goleiro", group: "goleiros", rating: 7.28, goals: 0, assists: 0 },
  { name: "Sven Ulreich", age: 38, position: "Goleiro", group: "goleiros", rating: 6.9, goals: 0, assists: 0 },
  { name: "Jonas Urbig", age: 23, position: "Goleiro", group: "goleiros", rating: 6.95, goals: 0, assists: 0 },
  // DEFENSORES
  { name: "Dayot Upamecano", age: 29, position: "Zagueiro", group: "defensores", rating: 7.54, goals: 0, assists: 0 },
  { name: "Kim Min-jae", age: 29, position: "Zagueiro", group: "defensores", rating: 7.58, goals: 0, assists: 0 },
  { name: "Jonathan Tah", age: 30, position: "Zagueiro", group: "defensores", rating: 7.83, goals: 1, assists: 0 },
  { name: "Nathaniel Brown", age: 23, position: "Lateral-esquerdo", group: "defensores", rating: 7.22, goals: 0, assists: 0 },
  { name: "Alphonso Davies", age: 25, position: "Lateral-esquerdo", group: "defensores", rating: 7.72, goals: 1, assists: 1 },
  { name: "Hiroki Ito", age: 27, position: "Zagueiro/Lateral-esquerdo", group: "defensores", rating: 7.41, goals: 0, assists: 0 },
  { name: "Sacha Boey", age: 26, position: "Lateral-direito", group: "defensores", rating: 7.3, goals: 0, assists: 0 },
  { name: "Josip Stanišić", age: 26, position: "Lateral-direito/Zagueiro", group: "defensores", rating: 7.36, goals: 0, assists: 0 },
  // MEIO-CAMPISTAS
  { name: "Joshua Kimmich", age: 31, position: "Meio-campista/Volante", group: "meio", rating: 8.08, goals: 1, assists: 3 },
  { name: "Tom Bischof", age: 21, position: "Meio-campista", group: "meio", rating: 7.14, goals: 0, assists: 0 },
  { name: "Jamal Musiala", age: 23, position: "Meia-atacante", group: "meio", rating: 7.96, goals: 3, assists: 2 },
  { name: "Konrad Laimer", age: 29, position: "Meio-campista", group: "meio", rating: 7.45, goals: 0, assists: 1 },
  { name: "Bara Sapoko Ndiaye", age: 18, position: "Meio-campista", group: "meio", rating: 6.98, goals: 0, assists: 0 },
  { name: "Lennart Karl", age: 18, position: "Meia-atacante", group: "meio", rating: 7.1, goals: 0, assists: 1 },
  { name: "Aleksandar Pavlović", age: 22, position: "Volante", group: "meio", rating: 7.65, goals: 0, assists: 1 },
  // ATACANTES
  { name: "Serge Gnabry", age: 31, position: "Ponta/Atacante", group: "atacantes", rating: 7.38, goals: 1, assists: 1 },
  { name: "Harry Kane", age: 33, position: "Centroavante", group: "atacantes", rating: 7.91, goals: 8, assists: 1 },
  { name: "Luis Díaz", age: 29, position: "Ponta-esquerda", group: "atacantes", rating: 7.78, goals: 2, assists: 1 },
  { name: "Michael Olise", age: 24, position: "Ponta-direita/Meia-atacante", group: "atacantes", rating: 8.05, goals: 4, assists: 2 },
  { name: "Ismael Saibari", age: 25, position: "Atacante/Ponta", group: "atacantes", rating: 7.35, goals: 0, assists: 1 },
];

/** Próximos jogos (inventados). Adversários da Bundesliga usam os nomes de `MOCK_TEAMS`. */
const BAYERN_FIXTURES: ClubFixture[] = [
  { date: "17/10/2026", time: "15:30", competition: "Bundesliga", home: "Bayern Munich", away: "Hoffenheim" },
  { date: "22/10/2026", time: "16:00", competition: "UEFA Champions League", home: "Bayern Munich", away: "PSV" },
  { date: "25/10/2026", time: "18:30", competition: "Bundesliga", home: "Union Berlin", away: "Bayern Munich" },
  { date: "29/10/2026", time: "16:00", competition: "UEFA Champions League", home: "Real Madrid", away: "Bayern Munich" },
  { date: "01/11/2026", time: "18:30", competition: "Bundesliga", home: "Bayern Munich", away: "VfB Stuttgart" },
  { date: "07/11/2026", time: "18:30", competition: "Bundesliga", home: "Borussia Dortmund", away: "Bayern Munich" },
  { date: "21/11/2026", time: "15:30", competition: "Bundesliga", home: "Bayern Munich", away: "Mainz 05" },
  { date: "25/11/2026", time: "16:00", competition: "UEFA Champions League", home: "Bayern Munich", away: "Barcelona" },
  { date: "28/11/2026", time: "11:30", competition: "Bundesliga", home: "Hamburg", away: "Bayern Munich" },
  { date: "02/12/2026", time: "19:45", competition: "DFB-Pokal", home: "Bayern Munich", away: "Köln" },
  { date: "05/12/2026", time: "15:30", competition: "Bundesliga", home: "Bayern Munich", away: "Paderborn" },
  { date: "08/12/2026", time: "17:00", competition: "UEFA Champions League", home: "Bayern Munich", away: "Slavia Praha" },
  { date: "12/12/2026", time: "15:30", competition: "Bundesliga", home: "Hoffenheim", away: "Bayern Munich" },
];

/**
 * Classificação mockada da Bundesliga 2026/27 — rodada 7.
 * Consistente: cada time 7 jogos; Σvits = Σderrotas = 42; Σempates = 42;
 * ΣGP = ΣGC = 189. Ordenada por pontos (saldo como desempate).
 */
const BUNDESLIGA_STANDINGS: StandingRow[] = [
  { team: "Bayern Munich", wins: 6, draws: 1, losses: 0, gf: 21, ga: 5 },
  { team: "Borussia Dortmund", wins: 5, draws: 1, losses: 1, gf: 16, ga: 7 },
  { team: "RB Leipzig", wins: 4, draws: 2, losses: 1, gf: 14, ga: 8 },
  { team: "Bayer Leverkusen", wins: 4, draws: 1, losses: 2, gf: 15, ga: 9 },
  { team: "Eintracht Frankfurt", wins: 3, draws: 3, losses: 1, gf: 12, ga: 8 },
  { team: "Freiburg", wins: 3, draws: 2, losses: 2, gf: 11, ga: 9 },
  { team: "VfB Stuttgart", wins: 3, draws: 1, losses: 3, gf: 12, ga: 11 },
  { team: "Mainz 05", wins: 2, draws: 3, losses: 2, gf: 10, ga: 10 },
  { team: "Werder Bremen", wins: 2, draws: 3, losses: 2, gf: 10, ga: 11 },
  { team: "Augsburg", wins: 2, draws: 3, losses: 2, gf: 9, ga: 11 },
  { team: "Hoffenheim", wins: 2, draws: 3, losses: 2, gf: 9, ga: 12 },
  { team: "Borussia Mönchengladbach", wins: 2, draws: 2, losses: 3, gf: 9, ga: 12 },
  { team: "Hamburg", wins: 1, draws: 3, losses: 3, gf: 8, ga: 12 },
  { team: "Union Berlin", wins: 1, draws: 3, losses: 3, gf: 7, ga: 12 },
  { team: "Schalke 04", wins: 1, draws: 3, losses: 3, gf: 8, ga: 13 },
  { team: "Köln", wins: 1, draws: 3, losses: 3, gf: 7, ga: 12 },
  { team: "Elversberg", wins: 0, draws: 3, losses: 4, gf: 6, ga: 13 },
  { team: "Paderborn", wins: 0, draws: 2, losses: 5, gf: 5, ga: 14 },
];

/** Faixas de classificação (1-based, inclusivas) com cor da barra lateral. */
export const STANDING_ZONES: { from: number; to: number; label: string; color: string }[] = [
  { from: 1, to: 4, label: "Liga dos Campeões", color: "#37b486" },
  { from: 5, to: 5, label: "Liga Europa UEFA", color: "#3f76eb" },
  { from: 6, to: 6, label: "Qualificação para a Conference League", color: "#22d3ee" },
  { from: 16, to: 16, label: "Playoff de rebaixamento", color: "#f5a524" },
  { from: 17, to: 18, label: "Rebaixamento direto", color: "#f0435f" },
];

/** Deriva pos/jogos/pontos/saldo a partir dos V-E-D (nunca inventa números soltos). */
export function deriveStandings(rows: StandingRow[]): DerivedStanding[] {
  return rows.map((r, i) => ({
    ...r,
    pos: i + 1,
    played: r.wins + r.draws + r.losses,
    pts: r.wins * 3 + r.draws,
    gd: r.gf - r.ga,
  }));
}

const BAYERN_DETAIL: Omit<TeamDetail, "teamId"> = {
  display_name: "Bayern de Munique",
  season: "2026/27",
  squad: BAYERN_SQUAD,
  fixtures: BAYERN_FIXTURES,
  standings: BUNDESLIGA_STANDINGS,
  advanced: {
    xg_per_game: 2.74,
    xga_per_game: 0.68,
    shots_per_game: 21.8,
    shots_on_target_per_game: 8.8,
    shots_conceded_per_game: 8.2,
    clean_sheets: 4,
    big_chances_per_game: 5.3,
    saves_per_game: 3.1,
    possession: 64,
    passes_per_game: 612,
    pass_accuracy: 89,
  },
  club: {
    coach: "Vincent Kompany",
    founded: "27/02/1900",
    stadium: { name: "Allianz Arena", capacity: 75024, city: "Munique" },
    competitions: [
      "UEFA Champions League",
      "Bundesliga",
      "DFB-Pokal",
      "Franz Beckenbauer Supercup",
      "Telekom Cup",
    ],
    titles: [
      { name: "Bundesliga", count: 35 },
      { name: "DFB-Pokal", count: 21 },
      { name: "UEFA Champions League", count: 6 },
      { name: "FIFA Club World Cup", count: 2 },
      { name: "UEFA Europa League", count: 1 },
      { name: "UEFA Super Cup", count: 2 },
      { name: "Cup Winners Cup", count: 1 },
      { name: "Intercontinental Cup", count: 2 },
    ],
  },
};

// ID do Bayern resolvido pelo `MOCK_TEAMS` (1º da Bundesliga → 1101 hoje,
// mas nada aqui depende da posição na lista).
const BAYERN_ID = MOCK_TEAMS.find((t) => t.name === "Bayern Munich")?.id ?? -1;

/** Detalhe mockado por id de time (`undefined` = ainda sem dados). */
const TEAM_DETAILS: Record<number, TeamDetail> = {
  [BAYERN_ID]: { ...BAYERN_DETAIL, teamId: BAYERN_ID },
};

export function getTeamDetail(teamId: number): TeamDetail | undefined {
  return TEAM_DETAILS[teamId];
}

export function hasTeamDetail(teamId: number): boolean {
  return teamId in TEAM_DETAILS;
}

