/**
 * Dados REAIS coletados da API football-data.org (v4) pela ferramenta
 * `teste-api/football_data_collector.py`.
 *
 * Os arquivos brutos ficam em `teste-api/data/` (`BSA_standings.csv`,
 * `BSA_scorers.csv`, `BSA_upcoming_matches.csv` e `BSA_matches_raw.json`).
 * Aqui eles vêm "tratados" (normalizados/nomeados) para o frontend
 * consumir sem depender de rede.
 *
 * Competição: Campeonato Brasileiro Série A (código BSA) · temporada 2026.
 * Fonte: football-data.org · plano gratuito.
 */

export type StandingRow = {
  position: number;
  team: string;
  played: number;
  won: number;
  draw: number;
  lost: number;
  points: number;
  goals_for: number;
  goals_against: number;
  goal_diff: number;
};

export type ScorerRow = {
  player: string;
  team: string;
  played: number;
  goals: number;
  assists: number;
  penalties: number | null;
};

export type FixtureRow = {
  id: number;
  utc_date: string;
  status: string;
  matchday: number;
  stage: string;
  home: string;
  away: string;
};

export type TeamMeta = {
  id: number;
  name: string;
  short_name: string;
  tla: string;
  crest: string;
};

export const FOOTBALL_DATA_SOURCE = {
  provider: "football-data.org",
  competition: "Campeonato Brasileiro Série A",
  competitionCode: "BSA",
  seasonId: 2474,
  seasonStart: "2026-01-28",
  seasonEnd: "2026-12-02",
  collectedAt: "2026-10-01T01:32:01Z",
  collector: "teste-api/football_data_collector.py",
} as const;

/** Tabela de classificação (real). */
export const BSA_STANDINGS: StandingRow[] = [
  { position: 1, team: "CR Flamengo", played: 28, won: 18, draw: 6, lost: 4, points: 60, goals_for: 55, goals_against: 23, goal_diff: 32 },
  { position: 2, team: "SE Palmeiras", played: 28, won: 16, draw: 9, lost: 3, points: 57, goals_for: 47, goals_against: 21, goal_diff: 26 },
  { position: 3, team: "CA Paranaense", played: 28, won: 14, draw: 7, lost: 7, points: 49, goals_for: 43, goals_against: 32, goal_diff: 11 },
  { position: 4, team: "Fluminense FC", played: 28, won: 13, draw: 9, lost: 6, points: 48, goals_for: 44, goals_against: 36, goal_diff: 8 },
  { position: 5, team: "EC Bahia", played: 28, won: 12, draw: 10, lost: 6, points: 46, goals_for: 43, goals_against: 35, goal_diff: 8 },
  { position: 6, team: "Cruzeiro EC", played: 28, won: 13, draw: 6, lost: 9, points: 45, goals_for: 42, goals_against: 40, goal_diff: 2 },
  { position: 7, team: "CA Mineiro", played: 27, won: 11, draw: 7, lost: 9, points: 40, goals_for: 36, goals_against: 32, goal_diff: 4 },
  { position: 8, team: "Santos FC", played: 27, won: 10, draw: 8, lost: 9, points: 38, goals_for: 41, goals_against: 40, goal_diff: 1 },
  { position: 9, team: "Coritiba FBC", played: 28, won: 10, draw: 8, lost: 10, points: 38, goals_for: 37, goals_against: 43, goal_diff: -6 },
  { position: 10, team: "RB Bragantino", played: 27, won: 10, draw: 6, lost: 11, points: 36, goals_for: 33, goals_against: 31, goal_diff: 2 },
  { position: 11, team: "São Paulo FC", played: 27, won: 10, draw: 6, lost: 11, points: 36, goals_for: 32, goals_against: 30, goal_diff: 2 },
  { position: 12, team: "Botafogo FR", played: 28, won: 9, draw: 8, lost: 11, points: 35, goals_for: 41, goals_against: 45, goal_diff: -4 },
  { position: 13, team: "EC Vitória", played: 28, won: 9, draw: 6, lost: 13, points: 33, goals_for: 28, goals_against: 42, goal_diff: -14 },
  { position: 14, team: "SC Corinthians Paulista", played: 28, won: 8, draw: 8, lost: 12, points: 32, goals_for: 29, goals_against: 32, goal_diff: -3 },
  { position: 15, team: "Mirassol FC", played: 28, won: 8, draw: 8, lost: 12, points: 32, goals_for: 33, goals_against: 42, goal_diff: -9 },
  { position: 16, team: "CR Vasco da Gama", played: 27, won: 8, draw: 7, lost: 12, points: 31, goals_for: 34, goals_against: 41, goal_diff: -7 },
  { position: 17, team: "Grêmio FBPA", played: 28, won: 7, draw: 8, lost: 13, points: 29, goals_for: 30, goals_against: 38, goal_diff: -8 },
  { position: 18, team: "SC Internacional", played: 28, won: 6, draw: 10, lost: 12, points: 28, goals_for: 30, goals_against: 36, goal_diff: -6 },
  { position: 19, team: "Clube do Remo", played: 28, won: 5, draw: 8, lost: 15, points: 23, goals_for: 32, goals_against: 47, goal_diff: -15 },
  { position: 20, team: "Chapecoense AF", played: 27, won: 3, draw: 9, lost: 15, points: 18, goals_for: 29, goals_against: 53, goal_diff: -24 },
];
/** Artilheiros (real). `penalties: null` quando a API não retornou o valor. */
export const BSA_SCORERS: ScorerRow[] = [
  { player: "Kevin Viveros", team: "CA Paranaense", played: 26, goals: 18, assists: 3, penalties: 4 },
  { player: "Pedro", team: "CR Flamengo", played: 28, goals: 16, assists: 6, penalties: null },
  { player: "Gabriel Barbosa", team: "Santos FC", played: 20, goals: 11, assists: 3, penalties: 2 },
  { player: "Carlos Vinícius", team: "Grêmio FBPA", played: 27, goals: 10, assists: 1, penalties: 1 },
  { player: "Danilo dos Santos de Oliveira", team: "Botafogo FR", played: 18, goals: 9, assists: 2, penalties: null },
  { player: "John Kennedy", team: "Fluminense FC", played: 19, goals: 9, assists: 1, penalties: null },
  { player: "Matheus Pereira", team: "Cruzeiro EC", played: 25, goals: 9, assists: 4, penalties: null },
  { player: "Luciano Juba", team: "EC Bahia", played: 25, goals: 9, assists: 1, penalties: 4 },
  { player: "Samuel Lino", team: "CR Flamengo", played: 27, goals: 9, assists: 7, penalties: null },
  { player: "José Manuel López", team: "SE Palmeiras", played: 25, goals: 8, assists: 4, penalties: null },
  { player: "Luciano", team: "São Paulo FC", played: 23, goals: 8, assists: 1, penalties: 1 },
  { player: "Jonathan Calleri", team: "São Paulo FC", played: 25, goals: 8, assists: 1, penalties: 2 },
  { player: "Breno Lopes", team: "Coritiba FBC", played: 24, goals: 8, assists: 2, penalties: null },
  { player: "Pedro Rocha", team: "Coritiba FBC", played: 27, goals: 8, assists: 1, penalties: null },
  { player: "Carlos Renê", team: "EC Vitória", played: 21, goals: 8, assists: 1, penalties: null },
  { player: "Arthur Cabral", team: "Botafogo FR", played: 25, goals: 7, assists: 1, penalties: null },
  { player: "Mauricio", team: "SE Palmeiras", played: 25, goals: 7, assists: 1, penalties: null },
  { player: "Kaio Jorge", team: "Cruzeiro EC", played: 22, goals: 7, assists: 1, penalties: 4 },
  { player: "Hulk", team: "Fluminense FC", played: 21, goals: 7, assists: 4, penalties: 1 },
  { player: "Johan Carbonero", team: "SC Internacional", played: 27, goals: 7, assists: 4, penalties: null },
];

/** Próximas partidas (real) — janela coletada de 2026-10-02 a 2026-10-08. */
export const BSA_UPCOMING: FixtureRow[] = [
  { id: 554948, utc_date: "2026-10-02T23:00:00Z", status: "TIMED", matchday: 21, stage: "REGULAR_SEASON", home: "São Paulo FC", away: "Santos FC" },
  { id: 554940, utc_date: "2026-10-03T21:30:00Z", status: "TIMED", matchday: 21, stage: "REGULAR_SEASON", home: "CA Mineiro", away: "RB Bragantino" },
  { id: 555022, utc_date: "2026-10-07T22:30:00Z", status: "TIMED", matchday: 29, stage: "REGULAR_SEASON", home: "RB Bragantino", away: "Mirassol FC" },
  { id: 555025, utc_date: "2026-10-07T22:30:00Z", status: "TIMED", matchday: 29, stage: "REGULAR_SEASON", home: "SC Internacional", away: "SC Corinthians Paulista" },
  { id: 555027, utc_date: "2026-10-07T22:30:00Z", status: "TIMED", matchday: 29, stage: "REGULAR_SEASON", home: "Clube do Remo", away: "Grêmio FBPA" },
  { id: 555029, utc_date: "2026-10-07T23:00:00Z", status: "TIMED", matchday: 29, stage: "REGULAR_SEASON", home: "EC Vitória", away: "Chapecoense AF" },
  { id: 555021, utc_date: "2026-10-07T23:30:00Z", status: "TIMED", matchday: 29, stage: "REGULAR_SEASON", home: "Botafogo FR", away: "CR Vasco da Gama" },
  { id: 555023, utc_date: "2026-10-08T00:30:00Z", status: "TIMED", matchday: 29, stage: "REGULAR_SEASON", home: "Cruzeiro EC", away: "São Paulo FC" },
  { id: 555028, utc_date: "2026-10-08T22:30:00Z", status: "TIMED", matchday: 29, stage: "REGULAR_SEASON", home: "Santos FC", away: "CR Flamengo" },
  { id: 555020, utc_date: "2026-10-08T23:00:00Z", status: "TIMED", matchday: 29, stage: "REGULAR_SEASON", home: "CA Paranaense", away: "CA Mineiro" },
];
/** Metadados dos times (id + escudo reais da API). */
export const BSA_TEAMS: Record<string, TeamMeta> = {
  "CR Flamengo": { id: 1783, name: "CR Flamengo", short_name: "Flamengo", tla: "FLA", crest: "https://crests.football-data.org/1783.png" },
  "SE Palmeiras": { id: 1781, name: "SE Palmeiras", short_name: "Palmeiras", tla: "PAL", crest: "https://crests.football-data.org/1781.png" },
  "CA Paranaense": { id: 1768, name: "CA Paranaense", short_name: "Paranaense", tla: "CAP", crest: "https://crests.football-data.org/1768.png" },
  "Fluminense FC": { id: 1769, name: "Fluminense FC", short_name: "Fluminense", tla: "FLU", crest: "https://crests.football-data.org/1769.png" },
  "EC Bahia": { id: 1773, name: "EC Bahia", short_name: "Bahia", tla: "BAH", crest: "https://crests.football-data.org/1773.png" },
  "Cruzeiro EC": { id: 1771, name: "Cruzeiro EC", short_name: "Cruzeiro", tla: "CRU", crest: "https://crests.football-data.org/1771.png" },
  "CA Mineiro": { id: 1766, name: "CA Mineiro", short_name: "Mineiro", tla: "CAM", crest: "https://crests.football-data.org/1766.png" },
  "Santos FC": { id: 6685, name: "Santos FC", short_name: "Santos", tla: "SAN", crest: "https://crests.football-data.org/6685.png" },
  "Coritiba FBC": { id: 1765, name: "Coritiba FBC", short_name: "Coritiba", tla: "CFC", crest: "https://crests.football-data.org/1765.png" },
  "RB Bragantino": { id: 4286, name: "RB Bragantino", short_name: "Bragantino", tla: "RBB", crest: "https://crests.football-data.org/4286.png" },
  "São Paulo FC": { id: 1776, name: "São Paulo FC", short_name: "São Paulo", tla: "PAU", crest: "https://crests.football-data.org/1776.png" },
  "Botafogo FR": { id: 1770, name: "Botafogo FR", short_name: "Botafogo", tla: "BOT", crest: "https://crests.football-data.org/1770.png" },
  "EC Vitória": { id: 1782, name: "EC Vitória", short_name: "Vitória", tla: "VIT", crest: "https://crests.football-data.org/1782.png" },
  "SC Corinthians Paulista": { id: 1779, name: "SC Corinthians Paulista", short_name: "Corinthians", tla: "COR", crest: "https://crests.football-data.org/1779.png" },
  "Mirassol FC": { id: 4364, name: "Mirassol FC", short_name: "Mirassol", tla: "MIR", crest: "https://crests.football-data.org/4364.png" },
  "CR Vasco da Gama": { id: 1780, name: "CR Vasco da Gama", short_name: "Vasco da Gama", tla: "VAS", crest: "https://crests.football-data.org/1780.png" },
  "Grêmio FBPA": { id: 1767, name: "Grêmio FBPA", short_name: "Grêmio", tla: "FBP", crest: "https://crests.football-data.org/1767.png" },
  "SC Internacional": { id: 6684, name: "SC Internacional", short_name: "Internacional", tla: "SCI", crest: "https://crests.football-data.org/6684.png" },
  "Clube do Remo": { id: 4287, name: "Clube do Remo", short_name: "Clube do Remo", tla: "CRE", crest: "https://crests.football-data.org/4287.png" },
  "Chapecoense AF": { id: 1772, name: "Chapecoense AF", short_name: "Chapecoense", tla: "CHA", crest: "https://crests.football-data.org/1772_large.png" },
};

export function standingFor(team: string): StandingRow | undefined {
  return BSA_STANDINGS.find((s) => s.team === team);
}

export function scorersFor(team: string): ScorerRow[] {
  return BSA_SCORERS.filter((s) => s.team === team).sort((a, b) => b.goals - a.goals);
}