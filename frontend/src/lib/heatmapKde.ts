/**
 * heatmapKde.ts — densidade espacial (Kernel Density Estimation) para o mapa de calor.
 *
 * Tudo aqui é matemática pura (sem React/DOM), para poder ser testada isoladamente.
 *
 * Coordenadas de entrada: 0..100 nos dois eixos (x = comprimento, y = largura), como a
 * API entrega. Internamente tudo é convertido para METROS num campo FIFA de 105 × 68,
 * que é a escala em que o Understat/StatsBomb normalizam as coordenadas. Assim o kernel
 * é isotrópico em metros (um círculo de 5 m é um círculo de verdade no campo, e não uma
 * elipse esticada pela proporção do SVG).
 */

export const PITCH_L = 105;
export const PITCH_W = 68;

export type PitchPoint = { mx: number; my: number };

/** Um evento com posição em metros e peso (1 = contagem; xG = ponderado por xG). */
export type KdeSample = PitchPoint & { w: number };

export type KdeGrid = {
  cols: number;
  rows: number;
  /** Lado da célula, em metros. */
  cell: number;
  /** Densidade (peso por m²), linha a linha. */
  data: Float32Array;
  /** Maior valor da grade (pico da densidade). */
  max: number;
  /** Largura de banda usada (m). */
  bandwidth: number;
  /** Número de eventos e soma dos pesos usados. */
  n: number;
  totalWeight: number;
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Converte coordenadas 0..100 da API para metros do campo. */
export function toMeters(x: number, y: number): PitchPoint {
  return {
    mx: (clamp(x, 0, 100) / 100) * PITCH_L,
    my: (clamp(y, 0, 100) / 100) * PITCH_W,
  };
}

/** Inverso de `toMeters`. */
export function toPercent(mx: number, my: number) {
  return { x: (mx / PITCH_L) * 100, y: (my / PITCH_W) * 100 };
}

/**
 * Largura de banda (m) pela regra de Scott aplicada ao espalhamento real dos eventos:
 *   h = σ · n^(-1/6) · 0.6
 * (o 0.6 evita o excesso de suavização típico da regra de Scott em dados de chutes, que
 * são multimodais). O resultado é limitado a [3.2, 7.5] m: abaixo disso viram "bolinhas"
 * individuais, acima disso viram manchas enormes. `factor` é o ajuste escolhido pelo
 * usuário (preciso / padrão / suave).
 */
export const BANDWIDTH_MIN = 3.2;
export const BANDWIDTH_MAX = 7.5;

export function chooseBandwidth(samples: KdeSample[], factor = 1): number {
  const n = samples.length;
  let h = 5.5;
  if (n >= 2) {
    let mx = 0, my = 0;
    for (const s of samples) { mx += s.mx; my += s.my; }
    mx /= n; my /= n;
    let vx = 0, vy = 0;
    for (const s of samples) { vx += (s.mx - mx) ** 2; vy += (s.my - my) ** 2; }
    const sigma = Math.sqrt((vx + vy) / (2 * n));
    h = 0.6 * sigma * Math.pow(n, -1 / 6);
  }
  h = clamp(h, BANDWIDTH_MIN, BANDWIDTH_MAX) * factor;
  return clamp(h, 2.6, 9.5);
}

/**
 * KDE gaussiano em grade regular, com correção de borda por REFLEXÃO.
 *
 * Sem a reflexão, a massa do kernel que "vaza" para fora do campo faz a densidade cair
 * justamente na linha de fundo/na pequena área, onde estão os chutes: o pico ficaria
 * subestimado e deslocado para dentro. Refletir cada evento nas 4 linhas (quando ele está
 * a menos de 3h da linha) conserva a massa dentro do campo.
 *
 * A densidade resultante integra (≈) ao peso total: unidade = peso / m².
 */
export function computeKde(samples: KdeSample[], bandwidth: number, cell = 0.5): KdeGrid {
  const cols = Math.ceil(PITCH_L / cell);
  const rows = Math.ceil(PITCH_W / cell);
  const data = new Float32Array(cols * rows);
  const h2 = 2 * bandwidth * bandwidth;
  const norm = 1 / (Math.PI * h2); // 1 / (2π h²)
  const radius = 3 * bandwidth;
  const r2 = radius * radius;
  let totalWeight = 0;

  const splat = (px: number, py: number, w: number) => {
    const i0 = Math.max(0, Math.floor((px - radius) / cell));
    const i1 = Math.min(cols - 1, Math.ceil((px + radius) / cell));
    const j0 = Math.max(0, Math.floor((py - radius) / cell));
    const j1 = Math.min(rows - 1, Math.ceil((py + radius) / cell));
    if (i0 > i1 || j0 > j1) return;
    for (let j = j0; j <= j1; j++) {
      const dy = (j + 0.5) * cell - py;
      const dy2 = dy * dy;
      if (dy2 > r2) continue;
      const row = j * cols;
      for (let i = i0; i <= i1; i++) {
        const dx = (i + 0.5) * cell - px;
        const d2 = dx * dx + dy2;
        if (d2 > r2) continue;
        data[row + i] += w * norm * Math.exp(-d2 / h2);
      }
    }
  };

  for (const s of samples) {
    if (!(s.w > 0)) continue;
    totalWeight += s.w;
    const xs = [s.mx];
    const ys = [s.my];
    if (s.mx < radius) xs.push(-s.mx);
    if (PITCH_L - s.mx < radius) xs.push(2 * PITCH_L - s.mx);
    if (s.my < radius) ys.push(-s.my);
    if (PITCH_W - s.my < radius) ys.push(2 * PITCH_W - s.my);
    for (const px of xs) for (const py of ys) splat(px, py, s.w);
  }

  let max = 0;
  for (let k = 0; k < data.length; k++) if (data[k] > max) max = data[k];
  return { cols, rows, cell, data, max, bandwidth, n: samples.length, totalWeight };
}

/** Densidade (peso/m²) na posição em metros (vizinho mais próximo da grade). */
export function densityAt(grid: KdeGrid, mx: number, my: number): number {
  const i = clamp(Math.floor(mx / grid.cell), 0, grid.cols - 1);
  const j = clamp(Math.floor(my / grid.cell), 0, grid.rows - 1);
  return grid.data[j * grid.cols + i];
}

// ---------------------------------------------------------------------------
// Rampas de cor
// ---------------------------------------------------------------------------
export type RGB = [number, number, number];
export type RampStop = [number, RGB];

/** Interpola uma rampa [posição 0..1, cor]. */
export function rampAt(stops: RampStop[], t: number): RGB {
  const v = clamp(t, 0, 1);
  for (let k = 1; k < stops.length; k++) {
    const [p1, c1] = stops[k];
    if (v <= p1) {
      const [p0, c0] = stops[k - 1];
      const f = p1 === p0 ? 0 : (v - p0) / (p1 - p0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * f),
        Math.round(c0[1] + (c1[1] - c0[1]) * f),
        Math.round(c0[2] + (c1[2] - c0[2]) * f),
      ];
    }
  }
  return stops[stops.length - 1][1];
}

/**
 * Escala de análise (um time): azul-escuro → azul → ciano → verde → amarelo → laranja.
 * Os tons foram dessaturados e escurecidos nas pontas para assentar no gramado sem
 * "brilhar" como efeito de luz.
 */
export const RAMP_SPECTRAL: RampStop[] = [
  [0.00, [16, 34, 84]],
  [0.22, [30, 84, 168]],
  [0.42, [28, 156, 190]],
  [0.60, [92, 190, 112]],
  [0.76, [214, 214, 74]],
  [0.90, [240, 160, 52]],
  [1.00, [226, 104, 44]],
];

/** Escalas por time (quando os dois são mostrados juntos e precisam ser distinguíveis). */
export const RAMP_HOME: RampStop[] = [
  [0.00, [14, 36, 104]],
  [0.35, [36, 98, 220]],
  [0.70, [64, 184, 240]],
  [1.00, [190, 244, 252]],
];
export const RAMP_AWAY: RampStop[] = [
  [0.00, [92, 18, 54]],
  [0.35, [196, 44, 62]],
  [0.70, [244, 118, 40]],
  [1.00, [252, 222, 96]],
];

/** Tabela de 256 cores (RGBA) para uma rampa, com a transparência dependente da densidade. */
export function buildLut(stops: RampStop[]): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 4);
  for (let k = 0; k < 256; k++) {
    const t = k / 255;
    const [r, g, b] = rampAt(stops, t);
    lut[k * 4] = r; lut[k * 4 + 1] = g; lut[k * 4 + 2] = b;
    lut[k * 4 + 3] = Math.round(255 * heatAlpha(t));
  }
  return lut;
}

const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Cobertura mínima de densidade (fração do pico) abaixo da qual NÃO se pinta nada. */
export const HEAT_CUTOFF = 0.045;

/**
 * Opacidade da célula em função da densidade normalizada (0..1). Regiões sem eventos
 * ficam 100% transparentes (aparece só o gramado); a opacidade sobe suavemente a partir
 * do corte, para não haver borda dura, e satura em ~0.9 para o gramado ainda ser visto.
 */
export function heatAlpha(t: number): number {
  if (t <= HEAT_CUTOFF) return 0;
  return smoothstep(HEAT_CUTOFF, HEAT_CUTOFF + 0.1, t) * (0.34 + 0.56 * Math.pow(t, 0.8));
}

// ---------------------------------------------------------------------------
// Curvas de nível (marching squares)
// ---------------------------------------------------------------------------
export type Segment = [number, number, number, number];

/** Segmentos (em coordenadas de grade) da isolinha `level` do campo escalar. */
export function contourSegments(grid: KdeGrid, level: number): Segment[] {
  const { cols, rows, data } = grid;
  const segs: Segment[] = [];
  const v = (i: number, j: number) => data[j * cols + i];
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = v(i, j), b = v(i + 1, j), c = v(i + 1, j + 1), d = v(i, j + 1);
      const idx = (a >= level ? 8 : 0) | (b >= level ? 4 : 0) | (c >= level ? 2 : 0) | (d >= level ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const top: [number, number] = [i + (level - a) / (b - a), j];
      const right: [number, number] = [i + 1, j + (level - b) / (c - b)];
      const bottom: [number, number] = [i + (level - d) / (c - d), j + 1];
      const left: [number, number] = [i, j + (level - a) / (d - a)];
      const push = (p: [number, number], q: [number, number]) => segs.push([p[0], p[1], q[0], q[1]]);
      switch (idx) {
        case 1: case 14: push(left, bottom); break;
        case 2: case 13: push(bottom, right); break;
        case 3: case 12: push(left, right); break;
        case 4: case 11: push(top, right); break;
        case 5: push(top, right); push(left, bottom); break;
        case 6: case 9: push(top, bottom); break;
        case 7: case 8: push(top, left); break;
        case 10: push(top, left); push(bottom, right); break;
      }
    }
  }
  return segs;
}

// ---------------------------------------------------------------------------
// Resumo de uma região (tooltip / região selecionada)
// ---------------------------------------------------------------------------
export type RegionStats<T> = {
  items: T[];
  count: number;
  weight: number;
};

/** Eventos a no máximo `radius` metros do ponto. */
export function eventsWithin<T extends PitchPoint>(events: T[], mx: number, my: number, radius: number): T[] {
  const r2 = radius * radius;
  return events.filter((e) => (e.mx - mx) ** 2 + (e.my - my) ** 2 <= r2);
}

/** Nome da zona do campo (relativo ao gol mais próximo). */
export type ZoneInfo = { zone: string; goalSide: "left" | "right" };

export function zoneAt(mx: number, my: number): ZoneInfo {
  const goalSide: "left" | "right" = mx < PITCH_L / 2 ? "left" : "right";
  const dxg = goalSide === "left" ? mx : PITCH_L - mx;
  const dy = Math.abs(my - PITCH_W / 2);
  let zone: string;
  if (dxg <= 5.5 && dy <= 9.16) zone = "Pequena área";
  else if (dxg <= 16.5 && dy <= 20.16) zone = "Grande área";
  else if (dxg <= 26 && dy <= 24) zone = "Entrada da área";
  else if (dxg <= 35) zone = "Longa distância";
  else zone = "Meio-campo";
  return { zone, goalSide };
}
