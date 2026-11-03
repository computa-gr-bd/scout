/**
 * Medidas dos modelos reais (Mixamo exportado pelo Blender), tiradas por cinemática direta dos próprios
 * arquivos .glb. Espaço do modelo: +Z = frente, +X = lado esquerdo do personagem, unidades em metros.
 * Se trocar os arquivos de animação, estes números precisam ser medidos de novo.
 */
const base = (import.meta.env.BASE_URL ?? "/").replace(/\/?$/, "/");

export const MODEL_URLS = {
  player: `${base}models/jogador.glb`,
  mask: `${base}models/kit_mask.png`,
  clips: {
    idle: `${base}models/anim/anim_idle.glb`,
    run: `${base}models/anim/anim_run.glb`,
    kick: `${base}models/anim/anim_kick.glb`,
    header: `${base}models/anim/anim_header.glb`,
    celebrate: `${base}models/anim/anim_celebrate.glb`,
    lamento: `${base}models/anim/anim_lamento.glb`,
    gkIdle: `${base}models/anim/goleiro_idle.glb`,
    gkDive: `${base}models/anim/goalkeeper_dive.glb`,
    gkCatch: `${base}models/anim/goalkeeper_catche.glb`,
  },
} as const;

export type ClipKey = keyof typeof MODEL_URLS.clips;
export const CLIP_KEYS = Object.keys(MODEL_URLS.clips) as ClipKey[];

/** Segundos de animação por unidade de tempo da cena (q = 0..1): a cena inteira dura ~6 s de animação. */
export const ANIM_SEC_PER_Q = 6;

export const MODEL_META = {
  /** Chute (pé direito): instante do contato e posição da bola (centro) em relação ao ponto de partida do clipe. */
  kick: { contact: 0.45, ball: [-0.11, 0.13, 1.68] as const },
  /** Cabeceio: instante do contato e centro da bola em relação ao ponto de partida (parado). */
  header: { contact: 1.22, ball: [0.01, 1.95, 0.4] as const },
  /** Mergulho do goleiro (para o lado esquerdo dele): luvas no ponto de maior alcance. */
  dive: { contact: 1.0, hipsLateral: 1.1, handLateralFromHips: 0.685, handY: 0.895, handForwardFromHips: 0.67 },
  /** Defesa agarrada (pulo e encaixe): luvas no ponto mais alto. */
  catch: { contact: 0.85, hipsLateral: -0.2, handLateralFromHips: -0.2 },
  /** Número/nome nas costas: preso ao osso Spine2 (unidades do osso = cm). */
  decal: { bone: "Spine2", position: [0, -2.84, -12.77] as const, quaternion: [0, 0.9986, 0.0528, 0] as const, size: 28 },
} as const;

export const KICK_END_BLEND = 0.15;
