import axios from "axios";

const base = import.meta.env.PROD
  ? "/api"
  : import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api";

export const api = axios.create({
  baseURL: base,
  timeout: 20000,
  headers: {
    "Content-Type": "application/json",
  },
});

// ---------- Typed Endpoints ----------
export interface Team {
  id: number;
  name: string;
  short_name: string | null;
  code: string | null;
  country: string | null;
  founded: number | null;
  logo_url: string | null;
  data_source: string;
  statistics: TeamStatistics[];
}

export interface TeamStatistics {
  id: number;
  team_id: number;
  season_id?: number | null;
  scope: string;
  matches_played: number;
  wins: number; draws: number; losses: number;
  goals_for: number; goals_against: number;
  shots_per_90: number | null; shots_on_target_per_90: number | null;
  xg_per_90: number | null; xga_per_90: number | null;
  goals_conceded_per_90: number | null; shots_conceded_per_90: number | null;
  corners_per_90: number | null; points_per_game: number;
  recent_form:
    | { result: "W" | "D" | "L"; opponent_id: number }[]
    | Record<string, unknown>
    | null;
}

export type TeamDefensiveMetricKey = "tackles" | "interceptions" | "clearances" | "shots_blocked" | "saves";

export interface TeamDefensiveMetric {
  total: number | null;
  per_match: number | null;
  matches: number;
  sources: string[];
}

export interface TeamGoalkeeperStats {
  player_id: number;
  name: string;
  appearances: number;
  saves: number | null;
  saves_per_match: number | null;
  goals_conceded: number | null;
  goals_conceded_per_match: number | null;
  shots_faced: number | null;
  shots_faced_per_match: number | null;
  sources: string[];
}

export interface TeamDefensiveStats {
  team_id: number;
  season_id: number | null;
  season_name: string | null;
  competition_code: string | null;
  available: boolean;
  matches_with_stats: number;
  metrics: Record<TeamDefensiveMetricKey, TeamDefensiveMetric>;
  goalkeepers: TeamGoalkeeperStats[];
}

export interface DefensiveWeakness {
  id: number;
  team_id: number;
  zone: PitchZone;
  weakness_score: number;
  shots_conceded_per_90: number;
  xga_per_90: number;
  goals_conceded_per_90: number;
  sample_size: number;
}

export interface Player {
  id: number;
  first_name: string | null;
  last_name: string;
  display_name: string | null;
  date_of_birth: string | null;
  country: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  preferred_foot: string | null;
  position: string | null;
  team_id: number | null;
  /** Time atual e liga (None quando o provedor não informa). */
  team_name?: string | null;
  team_short_name?: string | null;
  team_logo_url?: string | null;
  league_code?: string | null;
  league_name?: string | null;
  data_source: string;
  statistics: PlayerStatistics[];
  /** Zonas já embutidas no detalhe (só dados demo). */
  zone_statistics?: PlayerZoneStat[];
}

export interface PlayerStatistics {
  id: number; player_id: number;
  season_id?: number | null;
  scope: string;
  matches_played: number; minutes_played: number; starts: number;
  goals: number; assists: number; shots: number; shots_on_target: number;
  xg_total: number; xa_total: number;
  passes: number; passes_completed: number; key_passes: number;
  touches_in_box: number; dribbles: number;
  fouls_suffered: number; tackles: number; interceptions: number;
  clearances: number; duels: number; duels_won: number;
  aerials_won: number; aerials_lost: number;
  shots_per_90: number; shots_on_target_per_90: number;
  xg_per_90: number; xa_per_90: number;
  key_passes_per_90: number; touches_in_box_per_90: number;
  corners_per_90: number; goals_per_90: number; assists_per_90: number;
  tackle_pct: number; dribble_success_pct: number; pass_accuracy_pct: number;
  supplemental_stats?: Record<string, unknown> | null;
  pace: number | null; dribbling: number | null;
  /** Extras do Understat (npxG, xGChain, xGBuildup, cartões…) quando a fonte é o Understat. */
  recent_form?: Record<string, unknown> | unknown[] | null;
}

export interface PlayerZoneStat {
  zone: PitchZone;
  touches: number; shots: number; goals: number; xg: number;
  touches_per_90: number; shots_per_90: number; xg_per_90: number;
  zone_frequency_pct: number; offensive_strength: number;
}

export interface Competition {
  id: number; external_id: string | null; name: string; code: string | null;
  country: string | null; type: string | null; data_source: string;
}

export interface Season {
  id: number;
  competition_id: number;
  name: string;
  start_date: string | null;
  end_date: string | null;
  current: boolean;
  data_source: string;
}

export type PitchZone =
  | "own_box" | "own_left_channel" | "own_right_channel" | "own_central_midfield"
  | "own_left_flank" | "own_right_flank"
  | "neutral_midfield" | "neutral_left_flank" | "neutral_right_flank"
  | "opp_left_flank" | "opp_right_flank"
  | "opp_left_channel" | "opp_right_channel" | "opp_central_midfield"
  | "outside_box_left" | "outside_box_right" | "outside_box_central"
  | "central_box";

export interface Match {
  id: number;
  season_id: number;
  competition_name: string | null;
  round_name: string | null;
  matchday: number | null;
  kickoff_time: string;
  status: string;
  home_team: { id: number; name: string; short_name: string | null; logo_url: string | null };
  away_team: { id: number; name: string; short_name: string | null; logo_url: string | null };
  home_score: number;
  away_score: number;
  stadium_name: string | null;
  referee: string | null;
  data_source: string;
}

export interface MatchAnalysis {
  match_id: number;
  home_team_stats: TeamStatistics | null;
  away_team_stats: TeamStatistics | null;
  h2h_recent: {
    match_id: number; kickoff: string; home_id: number; away_id: number;
    home_name?: string | null; away_name?: string | null;
    home_short_name?: string | null; away_short_name?: string | null;
    home_logo_url?: string | null; away_logo_url?: string | null;
    home_score: number; away_score: number;
  }[];
  form: { home: any[]; away: any[] };
  key_stats: Record<string, number | null>;
}

export interface PredictionFactor {
  feature: string;
  factor: string;
  weight?: number;
  value?: number;
  direction?: "positive" | "negative";
}

export interface ZoneOpportunity {
  zone: PitchZone;
  opportunity_score: number;
  offensive_strength: number;
  defensive_weakness: number;
  player_frequency: number;
}

export interface PredictionDistribution {
  model: "negative_binomial" | "poisson";
  dispersion: number;
  expected: number;
  /** [P(0), P(1), P(2), P(3 ou mais)] */
  probs: number[];
  p_at_least_2: number;
}

export interface PredictionScenarios {
  favorable: number;
  base: number;
  conservative: number;
  spread: number;
  level: "stable" | "moderate" | "sensitive";
  drivers: { amostra: number; contexto: number };
}

export interface PredictionForm {
  structural: number;
  recent: number;
  delta_pct: number;
  trend: "up" | "down" | "stable";
}

export interface PlayerMatchPrediction {
  player_id: number;
  player_name: string;
  team_id: number;
  target: string;
  probability: number;
  baseline_probability: number;
  venue: "home" | "away";
  confidence: "low" | "medium" | "high";
  positive_factors: PredictionFactor[];
  negative_factors: PredictionFactor[];
  zone_opportunities: ZoneOpportunity[];
  model_version: string;
  /** Taxas recentes usadas no cálculo (só no modo Understat). */
  shots_per_match?: number;
  xg_per_match?: number;
  rate_per_match?: number;
  opp_factor?: number;
  /** Minutos esperados (Lineup/FBref); null quando não há minutos recentes registrados. */
  expected_minutes?: number | null;
  minutes_known?: boolean;
  /** Multiplicador do goleiro adversário na chance de gol (1,0 = médio). */
  gk_factor?: number | null;
  /** Distribuição do número de eventos: Binomial Negativa (chutes/no alvo) ou Poisson (gols). */
  distribution?: PredictionDistribution | null;
  /** Cenários condicionais (favorável / base / conservador) e quão sensível é a previsão. */
  scenarios?: PredictionScenarios | null;
  /** Forma recente (média ponderada das últimas partidas) x temporada, em xG por jogo. */
  form?: PredictionForm | null;
  /** Cadeia de conversão suavizada: % no alvo e % de gol por chute no alvo. */
  conversion?: { p_on_target: number; p_goal_given_sot: number } | null;
  /** Só em partidas encerradas com chutes coletados: o que aconteceu de fato na partida. */
  /** played: false = nem entrou em campo; null = sem escalação para afirmar. */
  outcome?: { happened: boolean; count: number; played?: boolean | null } | null;
}

export interface MatchupScore {
  attacker_id: number; defender_id: number; score: number;
  strengths: string[]; weaknesses: string[];
  evidence: any[];
}

export interface PredictionGenerateResp {
  match_id: number;
  predictions: PlayerMatchPrediction[];
  matchups: MatchupScore[];
  generated_at: string;
}

// ---- calls ----
export async function health() { return api.get("/health"); }

export async function listCompetitions() { return api.get<Competition[]>("/competitions").then((r) => r.data); }
export async function listSeasons(params?: { competition_id?: number }) { return api.get<Season[]>("/seasons", { params }).then((r) => r.data); }
export async function listTeams(params?: { q?: string; season_id?: number; skip?: number; limit?: number }) { return api.get<Team[]>("/teams", { params }).then((r) => r.data); }
export async function getTeam(id: number) { return api.get<Team>(`/teams/${id}`).then((r) => r.data); }
export async function getTeamStatistics(id: number) { return api.get<TeamStatistics[]>(`/teams/${id}/statistics`).then((r) => r.data); }
export async function getTeamWeaknesses(id: number) { return api.get<DefensiveWeakness[]>(`/teams/${id}/weaknesses`).then((r) => r.data); }
export async function getTeamDefensiveStats(id: number, seasonId?: number) {
  return api.get<TeamDefensiveStats>(`/teams/${id}/defensive-stats`, {
    params: seasonId == null ? undefined : { season_id: seasonId },
  }).then((r) => r.data);
}

export type PlayerOrder = "name" | "goals" | "assists" | "xg" | "minutes";
export async function listPlayers(params?: {
  q?: string; position?: string; team_id?: number; skip?: number; limit?: number;
  /** Só jogadores de times das 5 ligas (PL, PD, BL1, SA, FL1). */
  top5?: boolean;
  /** Código de uma das 5 ligas; implica top5. */
  league?: string;
  order?: PlayerOrder;
}) { return api.get<Player[]>("/players", { params }).then((r) => r.data); }
export async function getPlayer(id: number) { return api.get<Player>(`/players/${id}`).then((r) => r.data); }
export async function getPlayerStatistics(id: number) { return api.get<PlayerStatistics[]>(`/players/${id}/statistics`).then((r) => r.data); }
export async function getPlayerZones(id: number) { return api.get<PlayerZoneStat[]>(`/players/${id}/zones`).then((r) => r.data); }

export interface PlayerRecentMatch {
  match_id: number; date: string | null; opponent: string | null; is_home: boolean;
  result: "W" | "D" | "L" | null;
  goals: number; assists: number; shots: number; xg: number;
}
export interface PlayerLeagueAverage {
  n_players: number; min_minutes: number; league: string | null;
  shots_per_90: number; xg_per_90: number; xa_per_90: number; key_passes_per_90: number;
  goals_per_90: number; assists_per_90: number;
  npxg_per_90: number; xg_chain_per_90: number; xg_buildup_per_90: number;
}
export type PlayerRole = "GK" | "DEF" | "MID" | "ATT";
export interface PlayerOverview {
  player_id: number;
  role?: PlayerRole | null;
  team: { id: number | null; name: string | null; short_name: string | null; logo_url: string | null };
  league: { code: string | null; name: string | null };
  extras: {
    npxg_per_90: number; xg_chain_per_90: number; xg_buildup_per_90: number;
    npg: number; yellow_cards: number; red_cards: number;
  };
  recent: PlayerRecentMatch[];
  next_match: {
    match_id: number; kickoff_time: string | null; is_home: boolean;
    opponent_id: number | null; opponent_name: string | null; opponent_logo_url: string | null;
    competition: string | null;
  } | null;
  league_average: PlayerLeagueAverage | null;
}
/** Índice por função: defensivo (DEF) ou de goleiro (GK). MID/ATT voltam com available=false. */
export interface IndexMetric {
  key: string; label: string; unit: string; value: number | null; score: number | null;
  league_avg: number | null; higher_is_better: boolean; method?: "percentile" | "anchor";
  /** Desvios-padrão do grupo (positivo = melhor) e versão robusta (mediana/MAD); só no método percentil. */
  z?: number | null; robust_z?: number | null;
}
export interface IndexComponent {
  key: string; label: string; weight: number; hint?: string; score: number | null; metrics: IndexMetric[];
}
export interface IndexKpi {
  key: string; label: string; unit: string; value: number | null; sub?: string | null; league_avg?: number | null;
}
export interface PlayerIndex {
  player_id: number;
  role: PlayerRole | null;
  role_label?: string | null;
  available: boolean;
  index: number | null;
  raw_index?: number | null;
  name?: string;
  reason?: string;
  coverage?: number;
  reliability?: number;
  peers?: number;
  method?: "percentile" | "anchor" | "mixed";
  components?: IndexComponent[];
  kpis?: IndexKpi[];
  sample?: { minutes: number | null; matches: number | null; season_id: number | null; league: string | null; peers: number };
  notes?: string[];
  /** De onde vieram os números (Understat, derivado dos chutes, FBref). */
  data_sources?: string[];
  /** Totais da temporada das partidas gravadas no banco (chutes, faltas, cartões) para as estatísticas complementares. */
  season_totals?: Record<string, number>;
}
export async function getPlayerIndex(id: number) { return api.get<PlayerIndex>(`/players/${id}/index`).then((r) => r.data); }

export async function getPlayerOverview(id: number) { return api.get<PlayerOverview>(`/players/${id}/overview`).then((r) => r.data); }
export async function getShotProbability(playerId: number, opponentTeamId: number, venue: "home" | "away" = "home") {
  return api.get(`/players/${playerId}/shot-probability`, { params: { opponent_team_id: opponentTeamId, venue } }).then((r) => r.data);
}
export async function getGoalProbability(playerId: number, opponentTeamId: number, venue: "home" | "away" = "home") {
  return api.get(`/players/${playerId}/goal-probability`, { params: { opponent_team_id: opponentTeamId, venue } }).then((r) => r.data);
}

export async function listMatches(params?: {
  scope?: "upcoming" | "recent" | "all"; team_id?: number; skip?: number; limit?: number;
  /** Tela de Análise: jogos passados só da Understat; jogos futuros de qualquer fonte. */
  analysis?: boolean;
}) {
  return api.get<Match[]>("/matches", { params }).then((r) => r.data);
}

/** Linha da classificação de uma temporada (com escudo vindo do backend). */
export interface StandingRow {
  team_id: number;
  team_name: string;
  team_logo?: string | null;
  team_code?: string | null;
  position: number;
  group_name: string;
  played: number;
  won: number; draw: number; lost: number;
  points: number;
  goals_for: number; goals_against: number; goal_difference: number;
  updated_at?: string | null;
}
export async function getStandings(seasonId: number) {
  return api.get<StandingRow[]>(`/seasons/${seasonId}/standings`).then((r) => r.data);
}
export async function getMatch(id: number) { return api.get(`/matches/${id}`).then((r) => r.data); }
export async function getMatchAnalysis(id: number) { return api.get<MatchAnalysis>(`/matches/${id}/analysis`).then((r) => r.data); }
export async function getMatchPredictions(id: number) { return api.get(`/matches/${id}/predictions`).then((r) => r.data); }
/** Análise tática calculada dos chutes reais (Understat): zonas fracas, previsões por jogador e confrontos. */
export interface TeamGoalkeeper {
  player_id: number; name: string; minutes: number | null; matches?: number | null;
  /** true quando há defesas/chutes sofridos de qualquer fonte (FBref ou derivados dos chutes do Understat). */
  has_data?: boolean;
  data_source?: "fbref" | "derived" | "match_stats";
  has_fbref: boolean; index: number | null; reliability?: number;
  components?: Array<{ key: string; label: string; score: number | null }>;
  save_pct?: number | null; psxg_diff_p90?: number | null; ga_p90?: number | null;
  clean_sheet_pct?: number | null;
  /** true quando "gols evitados" é estimado pela média de defesa da liga (sem PSxG). */
  psxg_diff_estimated?: boolean;
  goal_factor: number | null; shots_on_target_faced?: number | null;
}
export interface MatchInsights {
  available: boolean;
  match_id: number;
  method?: string;
  notes?: string[];
  sample?: { home_matches: number; away_matches: number; league_matches: number };
  zones?: {
    home_team_weaknesses: any[]; away_team_weaknesses: any[];
    home_team_attack?: any[]; away_team_attack?: any[];
  };
  goalkeepers?: { home: TeamGoalkeeper | null; away: TeamGoalkeeper | null };
  predictions?: PlayerMatchPrediction[];
  /** true quando a partida já acabou e as estimativas foram conferidas com os chutes reais. */
  results_checked?: boolean;
  matchups?: Array<MatchupScore & { attacker_name?: string; defender_name?: string | null }>;
}
export async function getMatchInsights(id: number) {
  return api.get<MatchInsights>(`/matches/${id}/insights`, { timeout: 60000 }).then((r) => r.data);
}

export async function getMatchZones(id: number) { return api.get(`/matches/${id}/zones`).then((r) => r.data); }

/** Escalação da partida: oficial quando existe no banco, provável XI pelo elenco. */
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
export interface MatchGoal {
  minute: number | null;
  team_id: number | null;
  scorer_player_id: number;
  scorer_name: string | null;
  assist_player_id?: number | null;
  assist_name?: string | null;
  is_penalty: boolean;
  is_own_goal: boolean;
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
export async function getMatchLineups(id: number) {
  return api.get<MatchLineups>(`/matches/${id}/lineups`).then((r) => r.data);
}
export async function getMatchTactical(id: number) { return api.get(`/matches/${id}/tactical-analysis`).then((r) => r.data); }

export async function generatePredictions(match_id: number, opts?: {
  targets?: string[]; include_zone_details?: boolean; include_matchups?: boolean;
}) {
  const body: any = { match_id, targets: opts?.targets ?? ["shot", "goal"],
    include_zone_details: opts?.include_zone_details ?? true, include_matchups: opts?.include_matchups ?? true };
  return api.post<PredictionGenerateResp>("/predictions/generate", body).then((r) => r.data);
}

export async function listModels() { return api.get("/models").then((r) => r.data); }

export interface StatsCounts {
  competitions?: number;
  teams?: number;
  matches?: number;
  players?: number;
  standings?: number;
  events?: number;
  shots?: number;
  passes?: number;
  team_statistics?: number;
}
export async function getStatsCounts() {
  return api.get<StatsCounts>("/stats/counts").then((r) => r.data);
}

export interface DataCollectionStatus {
  sync_interval_hours: number;
  competitions: {
    provider: string;
    resource: string;
    status: string;
    last_success_at: string | null;
    updated_at: string;
    summary: Record<string, unknown> | null;
    is_stale: boolean;
  }[];
}
/** Catálogo {nome do time: url do escudo} usado para preencher logos ausentes em qualquer tela. */
export async function getCrests() {
  return api.get<Record<string, string>>("/crests").then((r) => r.data);
}

export async function getDataStatus() {
  return api.get<DataCollectionStatus>("/data/status").then((r) => r.data);
}

// ---------- Understat ----------
export interface UnderstatSeason {
  id: number;
  name: string;
  current: boolean;
}
export interface UnderstatLeague {
  key: string;
  name: string;
  code: string;
  country: string;
  synced: boolean;
  competition_id: number | null;
  seasons: UnderstatSeason[];
}
export interface UnderstatLeaguesResp {
  leagues: UnderstatLeague[];
  default_season: number;
}
export async function listUnderstatLeagues() {
  return api.get<UnderstatLeaguesResp>("/understat/leagues").then((r) => r.data);
}

export interface UnderstatTableRow {
  position: number;
  team_id: number;
  team: string;
  short_name: string | null;
  logo_url: string | null;
  matches_played: number;
  wins: number; draws: number; losses: number;
  goals_for: number; goals_against: number; goal_difference: number;
  points: number; points_per_game: number;
  xg: number; xga: number;
  shots: number; shots_on_target: number; corners: number;
  recent_form: Record<string, number | string> | null;
  season_id: number;
  season_name: string;
}
export interface UnderstatLeagueTable {
  league: string;
  league_key: string;
  season: string;
  season_id: number;
  table: UnderstatTableRow[];
}
export async function getUnderstatLeagueTable(leagueKey: string, seasonId?: number) {
  return api
    .get<UnderstatLeagueTable>(`/understat/league-table/${leagueKey}`, { params: { season_id: seasonId } })
    .then((r) => r.data);
}

export interface UnderstatMatch {
  id: number;
  external_id: string | null;
  competition: string | null;
  season: string | null;
  season_id: number;
  home_team: { id: number; name: string; logo_url: string | null } | null;
  away_team: { id: number; name: string; logo_url: string | null } | null;
  home_score: number | null;
  away_score: number | null;
  status: string;
  kickoff_time: string | null;
  has_shots: boolean;
}
export async function listUnderstatMatches(params?: {
  league_key?: string; season_id?: number; team_id?: number; finished_only?: boolean; skip?: number; limit?: number;
}) {
  return api.get<UnderstatMatch[]>("/understat/matches", { params }).then((r) => r.data);
}

export interface UnderstatShot {
  event_id: number;
  minute: number | null;
  period: string | null;
  player: string | null;
  team: string | null;
  result: string | null;
  on_target: boolean | null;
  is_goal: boolean | null;
  xg: number | null;
  x: number | null;
  y: number | null;
  end_x: number | null;
  end_y: number | null;
  situation: string | null;
  body_part?: string | null;
  shot_type?: string | null;
  last_action?: string | null;
  assisted_by?: string | null;
  match_id?: number;
  details?: Record<string, unknown> | null;
}
export interface UnderstatMatchShots {
  match_id: number;
  external_id: string | null;
  home_team: { id: number; name: string } | null;
  away_team: { id: number; name: string } | null;
  home_score: number | null;
  away_score: number | null;
  summary: {
    home_shots: number; home_shots_on_target: number; home_xg: number;
    away_shots: number; away_shots_on_target: number; away_xg: number;
  };
  shots: UnderstatShot[];
}
export async function getUnderstatMatchShots(matchId: number) {
  return api.get<UnderstatMatchShots>(`/understat/matches/${matchId}/shots`).then((r) => r.data);
}

export interface UnderstatLeaderRow {
  player_id?: number;
  player: string | null;
  team: string | null;
  goals?: number;
  shots?: number;
  xg?: number;
}
export interface UnderstatTopTeamRow {
  team_id?: number;
  team: string;
  logo_url?: string | null;
  matches_played: number;
  wins: number; draws: number; losses: number;
  goals_for: number; goals_against: number;
  xg: number; xga: number; points_per_game: number;
  ppda?: number | null; deep?: number | null; xpts?: number | null; points?: number | null;
}
export interface UnderstatPlayerAgg {
  player_id: number;
  player: string | null;
  team: string | null;
  matches_played: number;
  minutes: number;
  goals: number; assists: number;
  shots: number; shots_on_target: number;
  xg: number; xa: number;
  xg_diff: number;
  xg_per_shot: number | null;
}
export interface UnderstatStats {
  top_scorers: UnderstatLeaderRow[];
  top_xg: UnderstatLeaderRow[];
  top_shots: UnderstatLeaderRow[];
  top_teams: UnderstatTopTeamRow[];
  players: UnderstatPlayerAgg[];
  teams: UnderstatTopTeamRow[];
}
export async function getUnderstatStats(params?: { competition_id?: number; season_id?: number }) {
  return api.get<UnderstatStats>("/understat/stats", { params }).then((r) => r.data);
}

export interface UnderstatFormMatch {
  match_id: number;
  kickoff_time: string | null;
  home: boolean;
  opponent: string | null;
  goals_for: number | null;
  goals_against: number | null;
  result: "W" | "D" | "L" | null;
  xg_for: number;
  xg_against: number;
  shots_for: number;
  shots_against: number;
  has_shots: boolean;
}
export interface UnderstatTeamForm {
  team_id: number;
  team: string;
  matches: UnderstatFormMatch[];
}
export async function getUnderstatTeamForm(teamId: number, params?: { limit?: number; season_id?: number }) {
  return api.get<UnderstatTeamForm>(`/understat/teams/${teamId}/form`, { params }).then((r) => r.data);
}

export interface UnderstatSyncStatus {
  provider: string;
  leagues: {
    resource: string;
    status: string;
    last_success_at: string | null;
    updated_at: string | null;
    summary: Record<string, unknown> | null;
  }[];
}
export async function getUnderstatSyncStatus() {
  return api.get<UnderstatSyncStatus>("/understat/sync/status").then((r) => r.data);
}
/** Resultado de uma rodada da sincronização rápida (POST /understat/sync/fast). */
export interface UnderstatFastSyncResult {
  /** Partidas que ganharam chutes nesta rodada. */
  progress: number;
  /** Partidas consultadas na Understat nesta rodada. */
  attempted: number;
  /** Ainda não tentadas há pouco: vale chamar de novo. */
  candidates: number;
  /** Finalizadas ainda sem chutes (algumas a Understat ainda não publicou). */
  remaining: number;
  done: boolean;
  elapsed: number;
  leagues: Record<string, {
    error?: string; matches?: number; shots?: number; pending_after?: number;
    /** Partidas em que a fonte ainda não tem chutes. */
    empty?: number; shot_errors?: number; error_samples?: string[];
  }>;
}
export async function syncUnderstatFast(params?: {
  leagues?: string; season?: number; max_seconds?: number; max_matches?: number;
  /** false nas rodadas seguintes: não refaz o calendário (mais rápido). */
  calendar?: boolean;
}) {
  return api
    .post<UnderstatFastSyncResult>("/understat/sync/fast", null, { params, timeout: 120000 })
    .then((r) => r.data);
}
export type UnderstatPlayerShot = UnderstatShot & { match_id: number };
export async function getUnderstatPlayerShots(playerId: number) {
  return api
    .get<{ player_id: number; player: string | null; shots: UnderstatPlayerShot[] }>(
      `/understat/players/${playerId}/shots`
    )
    .then((r) => r.data);
}

// ---------- Studio (dados reais p/ a tela de Análise) ----------
export interface StudioApiShot {
  id: number; match_id: number; match_label: string | null;
  minute: number; team: "home" | "away";
  player_id: number | null; player: string | null;
  result: "goal" | "saved" | "off_target" | "blocked"; outcome: string | null;
  on_target: boolean | null; xg: number | null; xgot: number | null;
  x: number; y: number; end_x: number; end_y: number; end_known: boolean;
  situation: string | null; shot_type: string | null; body_part: string | null;
  assisted_by: string | null; last_action: string | null;
  /** Gol contra: `team` é quem RECEBE o gol; o autor joga em `player_team` / `own_goal_team`. */
  own_goal?: boolean; own_goal_team?: "home" | "away" | null; player_team?: "home" | "away";
}
export interface StudioApiLineupPlayer {
  player_id: number | null; name: string | null; position: string | null;
  line: string | null; line_label: string | null; shirt_number: number | null;
  estimated: boolean; pitch_x: number; pitch_y: number; detail_key?: string;
}
export interface StudioApiPlayer {
  key: string; player_id: number | null; name: string; team: "home" | "away";
  shirt_number: number | null; position: string | null; minutes: number | null;
  match: {
    goals: number; assists: number; shots: number; shots_on_target: number; xg: number;
    xa: number; key_passes: number; tackles: number; interceptions: number;
    fouls_committed: number; fouls_suffered: number;
  };
  season: { matches: number | null; minutes: number | null; goals: number | null; assists: number | null; shots: number | null;
            shots_on_target: number | null; xg: number | null; xa: number | null; key_passes: number | null } | null;
}
export interface StudioApiHeat { x: number; y: number; intensity: number }
export interface StudioApiTeam { id: number; name: string | null; logo_url: string | null }
export interface MatchStudioPayload {
  match_id: number; linked_match_id: number | null;
  mode: "match" | "recent_form" | "none"; source: string | null;
  match: {
    home: StudioApiTeam; away: StudioApiTeam; home_score: number | null; away_score: number | null;
    status: string; kickoff_time: string | null; competition: string | null; round_name: string | null;
    venue: string | null; match_data_source: string | null;
  };
  recent_match_ids: { home: number[]; away: number[] };
  shots: StudioApiShot[];
  heatmap: { kind: string; home: StudioApiHeat[]; away: StudioApiHeat[] };
  lineups: { home: StudioApiLineupPlayer[]; away: StudioApiLineupPlayer[]; source: string | null; formation: string | null };
  players: StudioApiPlayer[];
  coverage: { shots: number; has_shots: boolean; has_lineup: boolean; has_xg: boolean; has_end_location: boolean; notes: string[] };
}
export async function getMatchStudio(id: number) {
  return api.get<MatchStudioPayload>(`/matches/${id}/studio`).then((r) => r.data);
}

// ---------- Understat: chutes recentes por time (comparação de times) ----------
export interface UnderstatTeamShotsMatch {
  match_id: number; kickoff_time: string | null; home: boolean; opponent: string | null;
  goals_for: number | null; goals_against: number | null; result: "W" | "D" | "L" | null;
  shots_count: number;
}
export interface UnderstatTeamShots {
  team_id: number; team: string; logo_url: string | null;
  matches: UnderstatTeamShotsMatch[];
  shots: UnderstatShot[];
}
export async function getUnderstatTeamShots(teamId: number, params?: { limit?: number; season_id?: number }) {
  return api.get<UnderstatTeamShots>(`/understat/teams/${teamId}/shots`, { params }).then((r) => r.data);
}

// ---------- Understat: perfil completo de um time (qualquer fonte) ----------
export interface TeamZoneWeakness {
  zone: PitchZone;
  weakness_score: number;
  ratio_vs_league: number;
  shots_conceded_per_90: number;
  xga_per_90: number;
  goals_conceded_per_90: number;
  sample_size: number;
}
export interface TeamProfileMatch {
  match_id: number; kickoff_time: string | null; home: boolean;
  opponent: string | null; opponent_logo?: string | null;
  goals_for: number | null; goals_against: number | null; result: "W" | "D" | "L" | null;
  xg_for: number; xg_against: number; shots_for: number; shots_against: number;
}
export interface TeamProfileOpportunity {
  zone: PitchZone; opportunity_score: number;
  player_id: number; player_name: string;
  offensive_strength: number; player_frequency: number; shots: number; xg: number;
}
export type SquadGroupKey = "gk" | "def" | "mid" | "att";
export interface TeamProfilePlayer {
  player_id: number;
  /** Id do mesmo jogador no elenco do football-data (quando o nome bate). */
  fd_player_id: number | null;
  name: string; position: string | null; group: SquadGroupKey;
  games: number; minutes: number | null; goals: number; assists: number | null;
  shots: number | null; key_passes: number | null;
  xg: number | null; xa: number | null; xg_per_90: number | null; goals_per_90: number | null;
  source: "understat" | "shots";
}
export interface TeamProfileSquadMember {
  key: string;
  /** Id do jogador (preferindo o da Understat, que tem as estatísticas) para abrir /players/:id. */
  player_id?: number | null; name: string; position: string | null; born: number | null; group: SquadGroupKey;
  games: number | null; goals: number | null; assists: number | null; xg: number | null; has_stats: boolean;
}
export interface TeamProfileSummary {
  matches: number; wins: number; draws: number; losses: number;
  goals_for: number; goals_against: number; xg_for: number; xg_against: number;
  xg_per_90: number | null; xga_per_90: number | null; xg_diff_per_90: number | null;
  shots_per_90: number | null; shots_against_per_90: number | null;
  goals_per_90: number | null; goals_conceded_per_90: number | null;
  goals_minus_xg: number | null;
}
export interface TeamProfile {
  available: boolean;
  team: { id: number; name: string; logo_url: string | null };
  team_ids: number[];
  season?: { id: number | null; name: string | null; competition: string | null; code: string | null };
  sample?: { matches: number; league_matches: number };
  summary?: TeamProfileSummary;
  matches?: TeamProfileMatch[];
  weaknesses?: TeamZoneWeakness[];
  attack?: { zone: PitchZone; strength_score: number }[];
  opportunities?: TeamProfileOpportunity[];
  players: TeamProfilePlayer[];
  /** Elenco completo (todas as fontes) já com jogos/gols/xG da Understat quando o nome bate. */
  squad?: TeamProfileSquadMember[];
  /** Classificação da temporada pela tabela da Understat. */
  standings?: StandingRow[];
  notes?: string[];
}
export async function getTeamProfile(teamId: number, params?: { season_id?: number }) {
  return api.get<TeamProfile>(`/understat/teams/${teamId}/profile`, { params }).then((r) => r.data);
}

// ---------- Relatório de análise pré-jogo ----------
export type ReportSide = "home" | "away";
export interface ReportTeam { id: number; name: string; logo_url: string | null }
export interface ReportWeakness {
  zone: string; label: string; ratio_vs_league: number; xga: number | null; shots_conceded: number | null;
  goals_conceded: number | null; share_of_xga_pct: number | null; trend: "worse" | "better" | "stable";
  reliability: "low" | "medium" | "high"; text: string;
}
export interface ReportLane {
  lane: "left" | "center" | "right"; label: string; attack_share_pct: number; attack_ratio: number;
  defense_ratio: number; opportunity: number;
}
export interface ReportLaneBlock {
  lanes: ReportLane[]; best: "left" | "center" | "right"; best_label: string; best_prep: string;
  best_opportunity: number; text: string;
}
export interface ReportPlayer {
  player_id: number; name: string; shots_per_match: number | null; xg_per_match: number | null;
  expected_minutes: number | null; confidence?: string; involvement_rate?: number; xg_share_pct: number | null;
  p_shot?: number; p_shot_on_target?: number; p_goal?: number; p_goal_involvement?: number;
  top_zone: string | null; reasons: string[];
}
export interface ReportTrend {
  team: ReportSide; metric: string; recent: number; window: number; change_pct: number;
  direction: "up" | "down" | "stable"; reading: "positiva" | "negativa" | "neutra"; text: string;
}
export interface ReportFactor { kind: string; text: string; impact: number }
export interface ReportRange { mean: number; low: number; high: number }
export interface ReportConceded {
  shots_per_match: number; on_target_per_match: number; xga_per_match: number; goals_per_match: number;
  set_piece_share: number | null;
}
export interface ReviewCheck {
  key: string; group: string; label: string; predicted: string; observed: string;
  status: "hit" | "miss" | "na"; detail: string;
}
export interface ReviewPlayer {
  player_id: number; name: string; p_involvement: number | null; shots: number; sot: number;
  goals: number; assists: number; hit: boolean;
}
/** Relatório pós-jogo: previsões do pré-jogo confrontadas com o que aconteceu. */
export interface MatchReview {
  headline: string; hits: number; total: number; pct: number;
  final: { home: number; away: number }; xg: { home: number; away: number };
  checks: ReviewCheck[]; players: { home: ReviewPlayer[]; away: ReviewPlayer[] };
  right: string[]; wrong: string[]; caveat: string;
}
export interface MatchReport {
  available: boolean;
  /** ``pre`` = antes da partida; ``post`` = partida encerrada (traz ``review``). */
  mode?: "pre" | "post";
  review?: MatchReview;
  match_id: number;
  method?: string;
  notes?: string[];
  generated_at?: string;
  teams?: { home: ReportTeam; away: ReportTeam };
  sample?: { home_matches: number; away_matches: number; league_matches: number };
  headline?: { text: string; favorite: "home" | "away" | "even"; confidence: "low" | "medium" | "high" };
  estimates?: {
    expected_goals: { home: number; away: number; total: number };
    expected_shots: { home: ReportRange; away: ReportRange };
    expected_shots_on_target: { home: ReportRange; away: ReportRange };
    outcome: { home: number; draw: number; away: number };
    over_2_5: number; btts: number;
    sensitivity: PredictionScenarios & { focus: ReportSide };
    method: string;
  };
  defensive_weaknesses?: { home: ReportWeakness[]; away: ReportWeakness[] };
  shots_conceded?: { home: ReportConceded; away: ReportConceded; more: "home" | "away" | "even"; text: string };
  attack_sides?: { home: ReportLaneBlock; away: ReportLaneBlock };
  key_players?: { home: ReportPlayer[]; away: ReportPlayer[] };
  trends?: {
    home: ReportTrend[]; away: ReportTrend[];
    h2h: { matches: number; home_wins: number; draws: number; away_wins: number; avg_goals: number; text: string } | null;
  };
  factors?: { home: ReportFactor[]; away: ReportFactor[] };
  conclusion?: { text: string; bullets: string[]; confidence: string; favorite: string };
}
export async function getMatchReport(id: number) {
  return api.get<MatchReport>(`/matches/${id}/report`, { timeout: 60000 }).then((r) => r.data);
}

// ---------- Comparação de jogadores (mesmos índices da tela do jogador) ----------
export type CompareTemplate = "auto" | "ATT" | "MID" | "DEF" | "GK";
export type CompareScope = "league" | "top5";
export interface CompareMetric {
  key: string; label: string; unit: string; value: number | null; league_avg: number | null;
  /** Nota 0–100 da métrica (a mesma que alimenta o componente). */
  score: number | null; z?: number | null;
}
export interface CompareAxis {
  key: string; label: string; hint: string; weight: number; score: number | null; metrics: CompareMetric[];
}
export interface CompareSeason {
  id: number; name: string; label: string; league_code: string; league_name: string; minutes: number; matches: number;
}
export interface ComparePlayer {
  available: boolean;
  player_id: number;
  name: string;
  reason?: string;
  position?: string | null;
  role?: PlayerRole | null;
  role_label?: string | null;
  age?: number | null;
  country?: string | null;
  team?: { id: number | null; name: string | null; logo_url: string | null };
  league?: { code: string; name: string };
  season?: { id: number; name: string; label: string };
  seasons?: CompareSeason[];
  minutes?: number; matches?: number; goals?: number; assists?: number;
  family?: "OFF" | "DEF" | "GK";
  index_name?: string;
  axes?: CompareAxis[];
  overall?: number | null;
  reliability?: number;
  context?: string;
  strengths?: string[];
  weaknesses?: string[];
}
export interface CompareResult {
  available: boolean;
  reason?: string;
  template: { key: "OFF" | "DEF" | "GK"; label: string; axes: { key: string; label: string; hint: string }[] } | null;
  players: ComparePlayer[];
  comparison?: {
    leaders: { axis: string; label: string; player_id: number | null; name: string | null; gap: number }[];
    lines: string[];
  };
  notes?: string[];
}
/** ``entries``: jogador[:temporada]. */
export async function comparePlayers(params: { entries: string; template?: CompareTemplate }) {
  return api.get<CompareResult>("/compare/players", { params, timeout: 60000 }).then((r) => r.data);
}
export interface SimilarPlayer {
  player_id: number; name: string; position: string | null; age: number | null;
  team: { id: number | null; name: string | null; logo_url: string | null };
  league: { code: string; name: string };
  season_id: number; minutes: number; similarity: number; better_at: string[]; worse_at: string[];
}
export interface SimilarResult {
  available: boolean; reason?: string; player_id?: number; role?: PlayerRole; role_label?: string;
  scope?: CompareScope; season?: { id: number; label: string }; pool_size?: number; items: SimilarPlayer[]; notes?: string[];
}
export async function getSimilarPlayers(params: {
  player_id: number; season_id?: number; scope?: CompareScope; league?: string; max_age?: number; limit?: number;
}) {
  return api.get<SimilarResult>("/compare/similar", { params, timeout: 60000 }).then((r) => r.data);
}
  