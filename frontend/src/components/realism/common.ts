import * as THREE from "three";

/** Medidas reais (metros). O gol fica em z = GL e o campo se estende para +Z. */
export const GOAL_W = 7.32;
export const GOAL_H = 2.44;
export const GL = -1.35;
export const BALL_R = 0.13;
export const STAND_HIPS = 0.93;

export type ShotResult = "goal" | "saved" | "off_target" | "blocked" | "own_goal";

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const clamp01 = (v: number) => clamp(v, 0, 1);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (t: number) => { const c = clamp01(t); return c * c * (3 - 2 * c); };
export const smoother = (t: number) => { const c = clamp01(t); return c * c * c * (c * (c * 6 - 15) + 10); };
/** Número pseudo-aleatório estável (0..1): o mesmo lance sempre gera a mesma jogada. */
export const hash = (a: number, b = 0) => {
  const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return x - Math.floor(x);
};
export const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** Profundidade (z) da rede de fundo na altura y: inclinada, mais funda no chão. */
export const netZ = (y: number) => GL - (1.9 - 0.9 * clamp01(y / GOAL_H));

/** Luminância aproximada (0..1) de uma cor hex, para escolher texto claro/escuro. */
export function luminance(hex: string) {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}
