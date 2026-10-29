/**
 * Tipos e helpers de dados da football-data.org usados pelo frontend.
 *
 * O Brasileirão Série A (BSA) foi REMOVIDO do projeto: os dados eram escassos e difíceis
 * de coletar. Os catálogos estáticos abaixo ficam vazios de propósito (os helpers continuam
 * existindo para não quebrar quem os importa) e a tela usa só dados reais vindos da API.
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
  competition: "Competição de exemplo",
  competitionCode: "",
  seasonId: 0,
  seasonStart: "",
  seasonEnd: "",
  collectedAt: "",
  collector: "teste-api/football_data_collector.py",
} as const;

/** Tabela de classificação (real). */
export const BSA_STANDINGS: StandingRow[] = [];
/** Artilheiros (real). `penalties: null` quando a API não retornou o valor. */
export const BSA_SCORERS: ScorerRow[] = [];

/** Próximas partidas (real) — janela coletada de 2026-10-02 a 2026-10-08. */
export const BSA_UPCOMING: FixtureRow[] = [];
/** Metadados dos times (id + escudo reais da API). */
export const BSA_TEAMS: Record<string, TeamMeta> = {};

/**
 * Escudo do time para exibição — casa por nome completo, nome curto ou chave do
 * catálogo. Retorna `null` quando não há escudo conhecido (o `TeamLogo` usa o
 * logo por hash como fallback).
 */
export function crestFor(name?: string | null): string | null {
  if (!name) return null;
  const hit = BSA_TEAMS[name]
    ?? Object.values(BSA_TEAMS).find((t) => t.name === name || t.short_name === name);
  return hit?.crest ?? null;
}

export function standingFor(team: string): StandingRow | undefined {
  return BSA_STANDINGS.find((s) => s.team === team);
}

export function scorersFor(team: string): ScorerRow[] {
  return BSA_SCORERS.filter((s) => s.team === team).sort((a, b) => b.goals - a.goals);
}