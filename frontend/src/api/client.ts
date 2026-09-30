import axios from "axios";

const base = (import.meta as any).env?.VITE_API_BASE_URL || "http://localhost:8000/api";

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
  scope: string;
  matches_played: number;
  wins: number; draws: number; losses: number;
  goals_for: number; goals_against: number;
  shots_per_90: number; shots_on_target_per_90: number;
  xg_per_90: number; xga_per_90: number;
  goals_conceded_per_90: number; shots_conceded_per_90: number;
  corners_per_90: number; points_per_game: number;
  recent_form: { result: "W" | "D" | "L"; opponent_id: number }[] | null;
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
  data_source: string;
  statistics: PlayerStatistics[];
}

export interface PlayerStatistics {
  id: number; player_id: number;
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
  h2h_recent: { match_id: number; kickoff: string; home_id: number; away_id: number; home_score: number; away_score: number }[];
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
export async function listTeams(params?: { q?: string }) { return api.get<Team[]>("/teams", { params }).then((r) => r.data); }
export async function getTeam(id: number) { return api.get<Team>(`/teams/${id}`).then((r) => r.data); }
export async function getTeamStatistics(id: number) { return api.get<TeamStatistics[]>(`/teams/${id}/statistics`).then((r) => r.data); }
export async function getTeamWeaknesses(id: number) { return api.get<DefensiveWeakness[]>(`/teams/${id}/weaknesses`).then((r) => r.data); }

export async function listPlayers(params?: { q?: string; position?: string }) { return api.get<Player[]>("/players", { params }).then((r) => r.data); }
export async function getPlayer(id: number) { return api.get<Player>(`/players/${id}`).then((r) => r.data); }
export async function getPlayerStatistics(id: number) { return api.get<PlayerStatistics[]>(`/players/${id}/statistics`).then((r) => r.data); }
export async function getPlayerZones(id: number) { return api.get<PlayerZoneStat[]>(`/players/${id}/zones`).then((r) => r.data); }
export async function getShotProbability(playerId: number, opponentTeamId: number, venue: "home" | "away" = "home") {
  return api.get(`/players/${playerId}/shot-probability`, { params: { opponent_team_id: opponentTeamId, venue } }).then((r) => r.data);
}
export async function getGoalProbability(playerId: number, opponentTeamId: number, venue: "home" | "away" = "home") {
  return api.get(`/players/${playerId}/goal-probability`, { params: { opponent_team_id: opponentTeamId, venue } }).then((r) => r.data);
}

export async function listMatches(params?: { scope?: "upcoming" | "recent" | "all"; team_id?: number }) {
  return api.get<Match[]>("/matches", { params }).then((r) => r.data);
}
export async function getMatch(id: number) { return api.get(`/matches/${id}`).then((r) => r.data); }
export async function getMatchAnalysis(id: number) { return api.get<MatchAnalysis>(`/matches/${id}/analysis`).then((r) => r.data); }
export async function getMatchPredictions(id: number) { return api.get(`/matches/${id}/predictions`).then((r) => r.data); }
export async function getMatchZones(id: number) { return api.get(`/matches/${id}/zones`).then((r) => r.data); }
export async function getMatchTactical(id: number) { return api.get(`/matches/${id}/tactical-analysis`).then((r) => r.data); }

export async function generatePredictions(match_id: number, opts?: {
  targets?: string[]; include_zone_details?: boolean; include_matchups?: boolean;
}) {
  const body: any = { match_id, targets: opts?.targets ?? ["shot", "goal"],
    include_zone_details: opts?.include_zone_details ?? true, include_matchups: opts?.include_matchups ?? true };
  return api.post<PredictionGenerateResp>("/predictions/generate", body).then((r) => r.data);
}

export async function listModels() { return api.get("/models").then((r) => r.data); }
