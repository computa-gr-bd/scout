import type { Match, MatchAnalysis, PlayerMatchPrediction, MatchupScore, ZoneOpportunity, DefensiveWeakness } from "./client";
import { API_MATCHES } from "./studioData";

/** Partidas "demo" (sintéticas) originais. */
const DEMO_MATCHES: Match[] = [
  {
    id: 1,
    season_id: 1,
    competition_name: "Brasileirão Série A",
    round_name: "Rodada 22",
    matchday: 22,
    kickoff_time: "2026-09-21T16:00:00Z",
    status: "finished",
    home_team: { id: 101, name: "Flamengo", short_name: "FLA", logo_url: null },
    away_team: { id: 102, name: "Palmeiras", short_name: "PAL", logo_url: null },
    home_score: 2,
    away_score: 1,
    stadium_name: "Maracanã",
    referee: "Bruno Arleu",
    data_source: "scoutvision_demo",
  },
  {
    id: 2,
    season_id: 1,
    competition_name: "Brasileirão Série A",
    round_name: "Rodada 22",
    matchday: 22,
    kickoff_time: "2026-09-21T20:00:00Z",
    status: "finished",
    home_team: { id: 103, name: "Corinthians", short_name: "COR", logo_url: null },
    away_team: { id: 104, name: "São Paulo", short_name: "SAO", logo_url: null },
    home_score: 1,
    away_score: 1,
    stadium_name: "Neo Química Arena",
    referee: "Raphael Claus",
    data_source: "scoutvision_demo",
  },
  {
    id: 3,
    season_id: 1,
    competition_name: "Libertadores",
    round_name: "Oitavas de Final - Volta",
    matchday: null,
    kickoff_time: "2026-09-24T21:30:00Z",
    status: "upcoming",
    home_team: { id: 105, name: "Fluminense", short_name: "FLU", logo_url: null },
    away_team: { id: 106, name: "Boca Juniors", short_name: "BOC", logo_url: null },
    home_score: 0,
    away_score: 0,
    stadium_name: "Maracanã",
    referee: "Esteban Ostojich",
    data_source: "scoutvision_demo",
  },
  {
    id: 4,
    season_id: 1,
    competition_name: "Brasileirão Série A",
    round_name: "Rodada 23",
    matchday: 23,
    kickoff_time: "2026-09-28T19:00:00Z",
    status: "upcoming",
    home_team: { id: 107, name: "Atlético Mineiro", short_name: "CAM", logo_url: null },
    away_team: { id: 101, name: "Flamengo", short_name: "FLA", logo_url: null },
    home_score: 0,
    away_score: 0,
    stadium_name: "Arena MRV",
    referee: "Anderson Daronco",
    data_source: "scoutvision_demo",
  },
  {
    id: 5,
    season_id: 1,
    competition_name: "Copa do Brasil",
    round_name: "Semifinal - Ida",
    matchday: null,
    kickoff_time: "2026-09-30T20:00:00Z",
    status: "upcoming",
    home_team: { id: 102, name: "Palmeiras", short_name: "PAL", logo_url: null },
    away_team: { id: 108, name: "Cruzeiro", short_name: "CRU", logo_url: null },
    home_score: 0,
    away_score: 0,
    stadium_name: "Allianz Parque",
    referee: "Wilton Pereira Sampaio",
    data_source: "scoutvision_demo",
  },
];

/**
 * Lista de partidas usada como fallback/mock em todo o app.
 * = demo (sintéticas) + dados reais coletados da API football-data.org.
 */
export const MOCK_MATCHES: Match[] = [...DEMO_MATCHES, ...API_MATCHES];

export const MOCK_MATCH_ANALYSIS: MatchAnalysis = {
  match_id: 1,
  home_team_stats: {
    id: 1, team_id: 101, scope: "season",
    matches_played: 21, wins: 13, draws: 5, losses: 3,
    goals_for: 38, goals_against: 15,
    shots_per_90: 16.4, shots_on_target_per_90: 5.8,
    xg_per_90: 1.82, xga_per_90: 0.74,
    goals_conceded_per_90: 0.71, shots_conceded_per_90: 7.8,
    corners_per_90: 5.6, points_per_game: 2.1,
    recent_form: [
      { result: "W", opponent_id: 102 },
      { result: "W", opponent_id: 105 },
      { result: "D", opponent_id: 103 },
      { result: "W", opponent_id: 107 },
      { result: "W", opponent_id: 108 },
    ],
  },
  away_team_stats: {
    id: 2, team_id: 102, scope: "season",
    matches_played: 21, wins: 12, draws: 6, losses: 3,
    goals_for: 34, goals_against: 16,
    shots_per_90: 15.1, shots_on_target_per_90: 5.2,
    xg_per_90: 1.65, xga_per_90: 0.78,
    goals_conceded_per_90: 0.76, shots_conceded_per_90: 8.4,
    corners_per_90: 5.1, points_per_game: 2.0,
    recent_form: [
      { result: "L", opponent_id: 101 },
      { result: "W", opponent_id: 108 },
      { result: "D", opponent_id: 107 },
      { result: "W", opponent_id: 105 },
      { result: "W", opponent_id: 104 },
    ],
  },
  h2h_recent: [
    { match_id: 1001, kickoff: "2026-05-12", home_id: 102, away_id: 101, home_score: 1, away_score: 2 },
    { match_id: 1002, kickoff: "2026-02-28", home_id: 101, away_id: 102, home_score: 3, away_score: 1 },
    { match_id: 1003, kickoff: "2025-10-18", home_id: 102, away_id: 101, home_score: 2, away_score: 2 },
    { match_id: 1004, kickoff: "2025-07-06", home_id: 101, away_id: 102, home_score: 1, away_score: 0 },
    { match_id: 1005, kickoff: "2025-04-05", home_id: 102, away_id: 101, home_score: 0, away_score: 1 },
  ],
  form: { home: [], away: [] },
  key_stats: {},
};

function mockZones(team: "home" | "away"): DefensiveWeakness[] {
  const zones = ["own_box", "outside_box_central", "outside_box_left", "outside_box_right",
    "opp_left_channel", "opp_right_channel", "opp_central_midfield",
    "opp_left_flank", "opp_right_flank", "central_box"];
  return zones.map((z, i) => ({
    id: (team === "home" ? 1 : 100) + i,
    team_id: team === "home" ? 101 : 102,
    zone: z as any,
    weakness_score: +(0.2 + Math.random() * 0.7).toFixed(2),
    shots_conceded_per_90: +(0.1 + Math.random() * 1.2).toFixed(2),
    xga_per_90: +(0.03 + Math.random() * 0.25).toFixed(3),
    goals_conceded_per_90: +(0.01 + Math.random() * 0.1).toFixed(3),
    sample_size: 21,
  }));
}

export const MOCK_HOME_WEAKNESSES: DefensiveWeakness[] = mockZones("home");
export const MOCK_AWAY_WEAKNESSES: DefensiveWeakness[] = mockZones("away");

const FACTORS_POS = [
  { feature: "form", factor: "Últimos 3 jogos com gol", weight: 0.18, value: 1.3, direction: "positive" as const },
  { feature: "h2h", factor: "Boa campanha vs este adversário", weight: 0.14, value: 1.2, direction: "positive" as const },
  { feature: "venue", factor: "Jogando em casa", weight: 0.12, value: 1.15, direction: "positive" as const },
  { feature: "rest", factor: "Descanso superior a 72h", weight: 0.08, value: 1.08, direction: "positive" as const },
  { feature: "zone_strength", factor: "Alta produção na zona central_box", weight: 0.16, value: 1.4, direction: "positive" as const },
  { feature: "opp_weakness", factor: "Adversário frágil em outside_box_central", weight: 0.13, value: 1.2, direction: "positive" as const },
];
const FACTORS_NEG = [
  { feature: "opp_defense", factor: "Defesa adversária consistente (0.74 xGA/90)", weight: 0.12, value: 0.9, direction: "negative" as const },
  { feature: "rotation", factor: "Rotação esperada no ataque", weight: 0.08, value: 0.93, direction: "negative" as const },
];

const PLAYERS_HOME = [
  { id: 201, name: "Pedro", number: 9 },
  { id: 202, name: "Bruno Henrique", number: 27 },
  { id: 203, name: "Giorgian De Arrascaeta", number: 14 },
  { id: 204, name: "Gerson", number: 8 },
  { id: 205, name: "Éverton Ribeiro", number: 7 },
  { id: 206, name: "Luiz Araújo", number: 11 },
];
const PLAYERS_AWAY = [
  { id: 301, name: "Endrick", number: 16 },
  { id: 302, name: "Raphael Veiga", number: 23 },
  { id: 303, name: "Dudu", number: 7 },
  { id: 304, name: "Lorran", number: 30 },
  { id: 305, name: "Gabriel Menino", number: 25 },
  { id: 306, name: "José López", number: 19 },
];

const ZONE_OPPS: { zone: ZoneOpportunity["zone"]; v: number; freq: number }[] = [
  { zone: "central_box", v: 0.88, freq: 0.34 },
  { zone: "outside_box_central", v: 0.72, freq: 0.22 },
  { zone: "outside_box_left", v: 0.55, freq: 0.14 },
  { zone: "outside_box_right", v: 0.6, freq: 0.16 },
  { zone: "opp_left_channel", v: 0.42, freq: 0.1 },
  { zone: "opp_right_channel", v: 0.45, freq: 0.11 },
];

export function mockPredictions(): { predictions: PlayerMatchPrediction[]; matchups: MatchupScore[] } {
  const preds: PlayerMatchPrediction[] = [];
  let pid = 1;
  for (const [venue, list] of [["home", PLAYERS_HOME], ["away", PLAYERS_AWAY]] as const) {
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const baseProb = 0.08 + (PLAYERS_HOME.length - i + list.length - i) * 0.02 + Math.random() * 0.12;
      for (const target of ["shot", "shot_on_target", "goal", "goal_involvement"]) {
        const tmult = target === "shot" ? 1 : target === "shot_on_target" ? 0.55 : target === "goal" ? 0.28 : 0.45;
        const prob = Math.min(0.82, baseProb * tmult * (0.85 + Math.random() * 0.3));
        preds.push({
          player_id: p.id,
          player_name: p.name,
          team_id: venue === "home" ? 101 : 102,
          target,
          probability: +prob.toFixed(3),
          baseline_probability: +(prob * (0.7 + Math.random() * 0.15)).toFixed(3),
          venue,
          confidence: prob > 0.25 ? "high" : prob > 0.12 ? "medium" : "low",
          positive_factors: FACTORS_POS.slice(0, 2 + Math.floor(Math.random() * 3)),
          negative_factors: Math.random() > 0.5 ? FACTORS_NEG.slice(0, 1 + Math.floor(Math.random() * 2)) : [],
          zone_opportunities: ZONE_OPPS.map((z) => ({
            zone: z.zone,
            opportunity_score: +(z.v * (0.7 + Math.random() * 0.5)).toFixed(2),
            offensive_strength: +(0.4 + Math.random() * 0.6).toFixed(2),
            defensive_weakness: +(0.3 + Math.random() * 0.6).toFixed(2),
            player_frequency: +(z.freq * (0.75 + Math.random() * 0.5)).toFixed(2),
          })),
          model_version: "sv-logreg-v0.2",
        });
        pid++;
      }
    }
  }
  const matchups: MatchupScore[] = [
    { attacker_id: 201, defender_id: 401, score: 0.62, strengths: ["Finalização precisa", "Movimento inteligente na área"], weaknesses: ["Baixa velocidade de recuperação", "Duelo aéreo irregular"] , evidence: [] },
    { attacker_id: 202, defender_id: 402, score: 0.58, strengths: ["Drible em alta velocidade", "Falta sofrida no último terço"], weaknesses: ["Marcação física adversária"], evidence: [] },
    { attacker_id: 301, defender_id: 410, score: 0.66, strengths: ["Imprevisibilidade", "Arremate de ambos os pés"], weaknesses: ["Posição fora do jogo frequente"], evidence: [] },
    { attacker_id: 203, defender_id: 403, score: 0.54, strengths: ["Visão de jogo", "Passes em profundidade"], weaknesses: ["Cobertura defensiva do meio-campo"], evidence: [] },
    { attacker_id: 302, defender_id: 404, score: 0.51, strengths: ["Cobranças de falta", "Arremate de fora da área"], weaknesses: [], evidence: [] },
    { attacker_id: 303, defender_id: 405, score: 0.48, strengths: ["Cruzamentos precisos"], weaknesses: ["Pressão alta no lateral"], evidence: [] },
  ];
  return { predictions: preds, matchups };
}

export const MOCK_PREDICTIONS = mockPredictions();
