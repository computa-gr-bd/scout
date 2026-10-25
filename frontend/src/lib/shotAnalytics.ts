import type { UnderstatShot } from "../api/client";

/** Campo em metros (mesma convenção do Pitch3D). */
const PITCH_W = 105;
const PITCH_H = 68;

export type ResultKey = "goal" | "saved" | "blocked" | "post" | "miss";

export const RESULT_META: Record<ResultKey, { label: string; color: string }> = {
  goal: { label: "Gol", color: "#22c55e" },
  saved: { label: "Defendido", color: "#f97316" },
  blocked: { label: "Bloqueado", color: "#94a3b8" },
  post: { label: "Na trave", color: "#a855f7" },
  miss: { label: "Para fora", color: "#eab308" },
};
export const RESULT_ORDER: ResultKey[] = ["goal", "saved", "post", "blocked", "miss"];

export const SITUATION_LABELS: Record<string, string> = {
  OpenPlay: "Bola rolando",
  FromCorner: "Escanteio",
  SetPiece: "Bola parada",
  DirectFreekick: "Falta direta",
  Penalty: "Pênalti",
};

export const BODY_LABELS: Record<string, string> = {
  right_foot: "Pé direito",
  left_foot: "Pé esquerdo",
  head: "Cabeça",
  other: "Outra parte",
};

export const HOME_COLOR = "#3b82f6";
export const AWAY_COLOR = "#ef4444";
export const SOLO_COLOR = "#e2e8f0";

/** Chute com xG a partir deste valor conta como "grande chance". */
export const BIG_CHANCE_XG = 0.3;

export function resultKey(s: Pick<UnderstatShot, "result" | "is_goal">): ResultKey {
  if (s.is_goal || s.result === "Goal") return "goal";
  if (s.result === "SavedShot") return "saved";
  if (s.result === "BlockedShot") return "blocked";
  if (s.result === "ShotOnPost") return "post";
  return "miss";
}

export function shotColor(s: Pick<UnderstatShot, "result" | "is_goal">): string {
  return RESULT_META[resultKey(s)].color;
}

export function situationLabel(v: string | null | undefined): string {
  if (!v) return "—";
  return SITUATION_LABELS[v] ?? v;
}

export function bodyLabel(v: string | null | undefined): string {
  if (!v) return "—";
  return BODY_LABELS[v] ?? v;
}

/** Distância (m) do ponto do chute ao centro do gol. Coordenadas 0-100, gol em x=100. */
export function distanceToGoal(x: number, y: number): number {
  const dx = ((100 - x) / 100) * PITCH_W;
  const dy = ((y - 50) / 100) * PITCH_H;
  return Math.hypot(dx, dy);
}

// ---------- Filtros ----------

export interface ShotFilters {
  team: string; // "all" ou nome do time
  player: string; // "all" ou nome do jogador
  situation: string; // "all" ou chave da situação
  bodyPart: string; // "all" ou chave da parte do corpo
  results: ResultKey[]; // resultados visíveis
  maxMinute: number; // linha do tempo: mostra chutes até este minuto
}

export const DEFAULT_FILTERS: ShotFilters = {
  team: "all",
  player: "all",
  situation: "all",
  bodyPart: "all",
  results: [...RESULT_ORDER],
  maxMinute: 130,
};

export function applyFilters(shots: UnderstatShot[], f: ShotFilters, opts?: { ignoreMinute?: boolean }): UnderstatShot[] {
  return shots.filter((s) => {
    if (f.team !== "all" && s.team !== f.team) return false;
    if (f.player !== "all" && s.player !== f.player) return false;
    if (f.situation !== "all" && s.situation !== f.situation) return false;
    if (f.bodyPart !== "all" && s.body_part !== f.bodyPart) return false;
    if (!f.results.includes(resultKey(s))) return false;
    if (!opts?.ignoreMinute && (s.minute ?? 0) > f.maxMinute) return false;
    return true;
  });
}

export function uniqueValues(shots: UnderstatShot[], pick: (s: UnderstatShot) => string | null | undefined): string[] {
  const set = new Set<string>();
  shots.forEach((s) => {
    const v = pick(s);
    if (v) set.add(v);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

// ---------- Resumo ----------

export interface ShotSummary {
  shots: number;
  onTarget: number;
  goals: number;
  xg: number;
  xgPerShot: number | null;
  bigChances: number;
  avgDistance: number | null;
  insideBox: number;
}

export function summarize(shots: UnderstatShot[]): ShotSummary {
  let xg = 0;
  let goals = 0;
  let onTarget = 0;
  let big = 0;
  let distSum = 0;
  let distN = 0;
  let inBox = 0;
  shots.forEach((s) => {
    xg += s.xg ?? 0;
    if (resultKey(s) === "goal") goals += 1;
    if (s.on_target || resultKey(s) === "goal" || resultKey(s) === "saved") onTarget += 1;
    if ((s.xg ?? 0) >= BIG_CHANCE_XG) big += 1;
    if (s.x != null && s.y != null) {
      distSum += distanceToGoal(s.x, s.y);
      distN += 1;
      // área grande: x >= 83.5 e y entre 21 e 79 (mesmas medidas do Pitch2D)
      if (s.x >= 83.5 && s.y >= 21 && s.y <= 79) inBox += 1;
    }
  });
  return {
    shots: shots.length,
    onTarget,
    goals,
    xg,
    xgPerShot: shots.length ? xg / shots.length : null,
    bigChances: big,
    avgDistance: distN ? distSum / distN : null,
    insideBox: inBox,
  };
}

// ---------- xG acumulado ----------

export interface XgPoint {
  minute: number;
  value: number;
}
export interface XgGoal {
  minute: number;
  value: number;
  player: string | null;
  xg: number;
}
export interface XgSeries {
  team: string;
  points: XgPoint[];
  goals: XgGoal[];
  total: number;
}

/** Série de xG acumulado por minuto para cada time (degraus a cada chute). */
export function xgTimeline(shots: UnderstatShot[], teams: string[], endMinute = 90): XgSeries[] {
  const last = Math.max(endMinute, ...shots.map((s) => s.minute ?? 0));
  return teams.map((team) => {
    const own = shots
      .filter((s) => s.team === team)
      .slice()
      .sort((a, b) => (a.minute ?? 0) - (b.minute ?? 0));
    let acc = 0;
    const points: XgPoint[] = [{ minute: 0, value: 0 }];
    const goals: XgGoal[] = [];
    own.forEach((s) => {
      const m = s.minute ?? 0;
      points.push({ minute: m, value: acc });
      acc += s.xg ?? 0;
      points.push({ minute: m, value: acc });
      if (resultKey(s) === "goal") goals.push({ minute: m, value: acc, player: s.player, xg: s.xg ?? 0 });
    });
    points.push({ minute: last, value: acc });
    return { team, points, goals, total: acc };
  });
}

// ---------- Mapa de calor ----------

export interface HeatCell {
  x: number;
  y: number;
  w: number;
  h: number;
  value: number;
  count: number;
}

/**
 * Agrupa os chutes numa grade sobre o terço ofensivo (x de 50 a 100).
 * `metric` define se o valor da célula é a soma de xG ou a contagem de chutes.
 */
export function heatGrid(shots: UnderstatShot[], metric: "xg" | "count", cols = 10, rows = 8) {
  const x0 = 50;
  const cw = (100 - x0) / cols;
  const ch = 100 / rows;
  const cells: HeatCell[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      cells.push({ x: x0 + c * cw, y: r * ch, w: cw, h: ch, value: 0, count: 0 });
    }
  }
  shots.forEach((s) => {
    if (s.x == null || s.y == null || s.x < x0) return;
    const c = Math.min(cols - 1, Math.floor((s.x - x0) / cw));
    const r = Math.min(rows - 1, Math.max(0, Math.floor(s.y / ch)));
    const cell = cells[r * cols + c];
    cell.count += 1;
    cell.value += metric === "xg" ? s.xg ?? 0 : 1;
  });
  const max = Math.max(0, ...cells.map((c) => c.value));
  return { cells: cells.filter((c) => c.value > 0), max };
}

// ---------- 3D ----------

/** Mesma conversão do Pitch3D: 0-100 -> metros, centrado. Retorna [x, y, z] do mundo. */
export function toWorld(x: number, y: number, height = 0): [number, number, number] {
  return [(x / 100) * PITCH_W - PITCH_W / 2, height, -((y / 100) * PITCH_H - PITCH_H / 2)];
}

/**
 * Trajetória estimada até o gol. O Understat só informa o ponto de origem do chute,
 * então o destino é uma aproximação determinística (mesmo chute = mesma curva).
 */
export function estimatedTrajectory(s: UnderstatShot, seed: number, steps = 22): [number, number, number][] {
  const start = toWorld(s.x ?? 90, s.y ?? 50, 0.3);
  const rk = resultKey(s);
  const jitter = ((seed * 37) % 100) / 100 - 0.5; // -0.5..0.5
  let endZ = jitter * 6; // dentro das traves (±3.66)
  let endH = 0.6 + (((seed * 53) % 100) / 100) * 1.4;
  if (rk === "miss") {
    endZ = (jitter >= 0 ? 1 : -1) * (4.4 + (seed % 3));
    endH = 1.2 + (seed % 4) * 0.7;
  } else if (rk === "post") {
    endZ = (jitter >= 0 ? 1 : -1) * 3.66;
    endH = 1.2;
  }
  let end: [number, number, number] = [PITCH_W / 2, endH, endZ];
  if (rk === "blocked") {
    // bloqueado: a trajetória termina a ~55% do caminho
    end = [start[0] + (end[0] - start[0]) * 0.55, 0.5, start[2] + (end[2] - start[2]) * 0.55];
  }
  const dist = Math.hypot(end[0] - start[0], end[2] - start[2]);
  const arc = Math.min(5, dist * 0.09);
  const pts: [number, number, number][] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    pts.push([
      start[0] + (end[0] - start[0]) * t,
      start[1] + (end[1] - start[1]) * t + Math.sin(Math.PI * t) * arc,
      start[2] + (end[2] - start[2]) * t,
    ]);
  }
  return pts;
}

export function fmt(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toFixed(digits);
}
