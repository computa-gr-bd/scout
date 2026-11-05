/**
 * Arquivos e constantes dos modelos reais (Mixamo exportado pelo Blender).
 * Espaço do modelo: +Z = frente, +X = lado esquerdo do personagem, metros.
 * As medidas de cada animação (contato com a bola, alcance das luvas) ficam em clipCatalog.ts,
 * gerado por tools/measure_clips.py.
 */
import { CLIP_DUR, CONTACT_CLIPS, REACH_CLIPS } from "./clipCatalog";

const base = (import.meta.env.BASE_URL ?? "/").replace(/\/?$/, "/");

export type ClipKey = keyof typeof CLIP_DUR;
/** Clipes com contato medido (chute, cabeceio, carrinho) e clipes de alcance do goleiro. */
export type ContactKey = keyof typeof CONTACT_CLIPS;
export type ReachKey = keyof typeof REACH_CLIPS;
export const clipUrl = (k: ClipKey) => `${base}models/anim/${k}.glb`;

export const MODEL_URLS = {
  player: `${base}models/jogador.glb`,
  mask: `${base}models/kit_mask.png`,
  stadium: `${base}models/stadium.glb`,
  crowd: `${base}models/crowd_seats.json`,
  ball: `${base}models/bola.glb`,
} as const;

/** Clipes que quase todo lance usa: baixados antes mesmo de o replay começar. */
export const COMMON_CLIPS: ClipKey[] = [
  "idle_offensive", "gk_idle_1", "jog_fwd", "kick_jog", "anim_run", "anim_celebrate", "anim_lamento", "gk_dive_1", "gk_dive_2",
];

/** Segundos de animação por unidade de tempo da cena (q = 0..1). Lances com escanteio duram mais. */
export const ANIM_SEC_OPEN = 6;
export const ANIM_SEC_CORNER = 9.5;

/** Mistura ao passar da corrida para o chute (s). */
export const KICK_END_BLEND = 0.15;

/** Número/nome nas costas: preso ao osso Spine2 (unidades do osso = cm). */
export const DECAL = { bone: "Spine2", position: [0, -2.84, -12.77] as const, quaternion: [0, 0.9986, 0.0528, 0] as const, size: 28 };
