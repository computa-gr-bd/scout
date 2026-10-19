export const PITCH_LENGTH = 105;
export const PITCH_WIDTH = 68;
export const PITCH_ASPECT = PITCH_LENGTH / PITCH_WIDTH;
export const GOAL_WIDTH = 7.32;
export const PENALTY_DEPTH = 16.5;
export const PENALTY_WIDTH = 40.32;
export const SIX_YARD_DEPTH = 5.5;
export const SIX_YARD_WIDTH = 18.32;
export const PENALTY_SPOT_DIST = 11;
export const CENTER_CIRCLE_R = 9.15;
export const PITCH_VIEWBOX = `0 0 ${PITCH_LENGTH} ${PITCH_WIDTH}`;
export interface PitchPoint { x: number; y: number }
export function safeNum(v: unknown, fallback = 0): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  if (!Number.isFinite(n)) return fallback;
  return n;
}
export function fromNormalized100(x: unknown, y: unknown): PitchPoint | null {
  const nx = safeNum(x, NaN);
  const ny = safeNum(y, NaN);
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return null;
  if (nx < -5 || nx > 105 || ny < -5 || ny > 105) return null;
  return {
    x: Math.min(PITCH_LENGTH, Math.max(0, (nx / 100) * PITCH_LENGTH)),
    y: Math.min(PITCH_WIDTH, Math.max(0, (ny / 100) * PITCH_WIDTH)),
  };
}
export function toNormalized100(p: PitchPoint): { x: number; y: number } {
  return {
    x: (Math.min(PITCH_LENGTH, Math.max(0, p.x)) / PITCH_LENGTH) * 100,
    y: (Math.min(PITCH_WIDTH, Math.max(0, p.y)) / PITCH_WIDTH) * 100,
  };
}
// StatsBomb's Y is stored as "height above the pitch line" in a 120x80 plane,
// but this codebase treats Y as the distance from the audience's perspective
// (bottom-to-top). Import with flipY=false so normalized Y matches pitch Y.
export function fromStatsBomb(x: unknown, y: unknown, flipY = false): PitchPoint | null {
  const sx = safeNum(x, NaN);
  const sy = safeNum(y, NaN);
  if (!Number.isFinite(sx) || !Number.isFinite(sy)) return null;
  if (sx < 0 || sx > 120 || sy < 0 || sy > 80) return null;
  return {
    x: (sx / 120) * PITCH_LENGTH,
    y: flipY ? (sy / 80) * PITCH_WIDTH : ((80 - sy) / 80) * PITCH_WIDTH,
  };
}
export function toSvg(p: PitchPoint): { x: number; y: number } {
  return { x: p.x, y: PITCH_WIDTH - p.y };
}
export function toWorld3D(p: PitchPoint, y = 0.02): [number, number, number] {
  return [p.x - PITCH_LENGTH / 2, y, -(p.y - PITCH_WIDTH / 2)];
}
export function isInsidePitch(p: PitchPoint, margin = 0): boolean {
  return p.x >= -margin && p.x <= PITCH_LENGTH + margin && p.y >= -margin && p.y <= PITCH_WIDTH + margin;
}
export function dedupeByKey<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((it) => {
    const k = key(it);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
