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

api.interceptors.request.use((c) => {
  const t = localStorage.getItem("sv.token");
  if (t) c.headers.Authorization = `Bearer ${t}`;
  return c;
});

api.interceptors.response.use(
  (r) => r,
  (e) => {
    if (e?.response?.status === 401 && location.pathname !== "/login") {
      localStorage.removeItem("sv.token");
    }
    return Promise.reject(e);
  }
);

export function setToken(token: string | null) {
  if (token) localStorage.setItem("sv.token", token);
  else localStorage.removeItem("sv.token");
}

export type Role = "user" | "admin";

export interface AuthInfo {
  token: string | null;
  role: Role | null;
  userId: number | null;
  email: string | null;
}

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
  data_source: string;
  statistics: PlayerStatistics[];
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
  duels: number; duels_won: number; crosses: number;
  shots_per_90: number; shots_on_target_per_90: number;
  xg_per_90: number; xa_per_90: number;
  key_passes_per_90: number; touches_in_box_per_90: number;
  corners_per_90: number; goals_per_90: number; assists_per_90: number;
  tackle_pct: number; dribble_success_pct: number; pass_accuracy_pct: number;
  pace: number | null; dribbling: number | null;
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
  feature: string; factor: string; weight: number; value: number; direction: "positive" | "negative";
}

export interface ZoneOpportunity {
  zone: PitchZone;
  opportunity_score: number;
  offensive_strength: number;
  defensive_weakness: number;
  player_frequency: number;
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
export async function me() { return api.get("/auth/me").then((r) => r.data); }
export async function login(email: string, password: string) {
  const fd = new FormData();
  fd.append("username", email);
  fd.append("password", password);
  return api.post("/auth/login", fd, { headers: { "Content-Type": "multipart/form-data" } }).then((r) => r.data);
}

export async function listCompetitions() { return api.get<Competition[]>("/competitions").then((r) => r.data); }
export async function listSeasons(params?: { competition_id?: number }) { return api.get<Season[]>("/seasons", { params }).then((r) => r.data); }
export async function listTeams(params?: { q?: string; season_id?: number; skip?: number; limit?: number }) { return api.get<Team[]>("/teams", { params }).then((r) => r.data); }
export async function getTeam(id: number) { return api.get<Team>(`/teams/${id}`).then((r) => r.data); }
export async function getTeamStatistics(id: number) { return api.get<TeamStatistics[]>(`/teams/${id}/statistics`).then((r) => r.data); }
export async function getTeamWeaknesses(id: number) { return api.get<DefensiveWeakness[]>(`/teams/${id}/weaknesses`).then((r) => r.data); }

export async function listPlayers(params?: { q?: string; position?: string; team_id?: number; skip?: number; limit?: number }) { return api.get<Player[]>("/players", { params }).then((r) => r.data); }
export async function getPlayer(id: number) { return api.get<Player>(`/players/${id}`).then((r) => r.data); }
export async function getPlayerStatistics(id: number) { return api.get<PlayerStatistics[]>(`/players/${id}/statistics`).then((r) => r.data); }
export async function getPlayerZones(id: number) { return api.get<PlayerZoneStat[]>(`/players/${id}/zones`).then((r) => r.data); }
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
  predictions?: PlayerMatchPrediction[];
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
  model_versions?: number;
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
export async function triggerUnderstatSync(params: {
  leagues?: string; season?: number; shots_only?: boolean; max_matches?: number;
}) {
  return api.post("/understat/sync", null, { params }).then((r) => r.data);
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
}
export interface StudioApiLineupPlayer {
  player_id: number | null; name: string | null; position: string | null;
  line: string | null; line_label: string | null; shirt_number: number | null;
  estimated: boolean; pitch_x: number; pitch_y: number; detail_key?: string;
}
export interface StudioApiPlayer {
  key: string; player_id: number | null; name: string; team: "home" | "away";
  shirt_number: number | null; position: string | null; minutes: number | null;
  match: { goals: number; assists: number; shots: number; shots_on_target: number; xg: number; xa: number; key_passes: number };
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
