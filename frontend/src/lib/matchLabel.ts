import type { UnderstatShot } from "../api/client";

/** Nomes curtos para caber em chips e etiquetas ("Arsenal vs Man United"). */
const SHORT_NAMES: Record<string, string> = {
  "Manchester United": "Man United",
  "Manchester City": "Man City",
  "Tottenham Hotspur": "Tottenham",
  "Wolverhampton Wanderers": "Wolves",
  "Newcastle United": "Newcastle",
  "West Ham United": "West Ham",
  "Brighton & Hove Albion": "Brighton",
  "Nottingham Forest": "Nott'm Forest",
  "Leeds United": "Leeds",
  "Leicester City": "Leicester",
  "Sheffield United": "Sheffield Utd",
  "Paris Saint Germain": "PSG",
  "Paris Saint-Germain": "PSG",
  "Bayern Munich": "Bayern",
  "Borussia Dortmund": "Dortmund",
  "Borussia M.Gladbach": "Gladbach",
  "Bayer Leverkusen": "Leverkusen",
  "Atletico Madrid": "Atlético",
  "Athletic Club": "Athletic",
  "Real Sociedad": "R. Sociedad",
};

export function shortTeamName(name: string | null | undefined): string {
  if (!name) return "—";
  return SHORT_NAMES[name] ?? name.replace(/\s+(FC|CF|AFC)$/i, "");
}

/** Cores para distinguir as partidas no 3D (anel da bola e chips). */
export const MATCH_COLORS = [
  "#38bdf8", "#f472b6", "#fbbf24", "#a3e635", "#c084fc",
  "#fb923c", "#2dd4bf", "#f87171", "#818cf8", "#e879f9",
];

export interface MatchLike {
  match_id?: number | null;
  home_team?: string | null;
  away_team?: string | null;
  home_score?: number | null;
  away_score?: number | null;
  match_date?: string | null;
  match_label?: string | null;
}

export interface MatchInfo {
  id: number;
  /** "Arsenal vs Man United" */
  label: string;
  home: string | null;
  away: string | null;
  /** "2–1" quando o placar é conhecido. */
  score: string | null;
  /** "12 out. 2026" */
  dateLabel: string | null;
  ts: number;
  color: string;
  /** Chutes na seleção atual (preenchido por buildMatchIndex). */
  shots: number;
}

export function formatMatchDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: "numeric" });
}

function infoFrom(m: MatchLike): Omit<MatchInfo, "color" | "shots"> | null {
  if (m.match_id == null) return null;
  const home = m.home_team ?? null;
  const away = m.away_team ?? null;
  const label = home && away ? `${shortTeamName(home)} vs ${shortTeamName(away)}` : m.match_label ?? `Partida #${m.match_id}`;
  const hasScore = m.home_score != null && m.away_score != null;
  const t = m.match_date ? new Date(m.match_date).getTime() : NaN;
  return {
    id: m.match_id,
    label,
    home,
    away,
    score: hasScore ? `${m.home_score}–${m.away_score}` : null,
    dateLabel: formatMatchDate(m.match_date),
    ts: Number.isNaN(t) ? 0 : t,
  };
}

/** Partida de um chute (null quando a fonte não informa a partida). */
export function matchOfShot(s: UnderstatShot): Omit<MatchInfo, "color" | "shots"> | null {
  return infoFrom(s);
}

/**
 * Lista de partidas (da mais antiga para a mais recente) presentes nos chutes. `extra` permite incluir
 * partidas sem nenhum chute (ex.: jogo em que o goleiro não sofreu finalizações).
 */
export function buildMatchIndex(shots: UnderstatShot[], extra: MatchLike[] = []): MatchInfo[] {
  const map = new Map<number, Omit<MatchInfo, "color" | "shots"> & { shots: number }>();
  for (const m of extra) {
    const i = infoFrom(m);
    if (i && !map.has(i.id)) map.set(i.id, { ...i, shots: 0 });
  }
  for (const s of shots) {
    const i = infoFrom(s);
    if (!i) continue;
    const cur = map.get(i.id);
    if (cur) cur.shots += 1;
    else map.set(i.id, { ...i, shots: 1 });
  }
  return [...map.values()]
    .sort((a, b) => a.ts - b.ts || a.id - b.id)
    .map((m, i) => ({ ...m, color: MATCH_COLORS[i % MATCH_COLORS.length] }));
}
