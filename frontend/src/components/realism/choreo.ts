import { GL, clamp, clamp01, smooth } from "./common";
import { CONTACT_CLIPS, REACH_CLIPS } from "./clipCatalog";
import { KICK_END_BLEND, type ClipKey, type ReachKey } from "./modelMeta";
import type { Contact, Plan } from "./plan";

/** O que a coreografia precisa saber de cada clipe carregado: duração, velocidade de raiz e caminho do quadril. */
export type ClipInfo = {
  dur: number;
  /** Velocidade média do quadril no clipe (m/s): lateral (+X do modelo) e para a frente (+Z). Útil para corridas. */
  vx: number; vz: number;
  /** Deslocamento do quadril desde o início do clipe no instante t (m). */
  sample: (t: number, out: { x: number; z: number }) => void;
};
export type ClipTable = Partial<Record<ClipKey, ClipInfo>>;
export type Entry = { key: ClipKey; time: number; weight: number };
export type Choreo = { x: number; y: number; z: number; yaw: number; mirror: number; entries: Entry[] };
export const newChoreo = (): Choreo => ({ x: 0, y: 0, z: 0, yaw: 0, mirror: 1, entries: [] });

const tmp = { x: 0, z: 0 };
const IDLE: ClipKey = "idle_offensive";
const GK_IDLE: ClipKey = "gk_idle_1";

/** Tempo de um clipe de espera que vai e volta (sem “pulo” no fim do loop). */
export const pingPong = (t: number, dur: number) => {
  const m = ((t % (2 * dur)) + 2 * dur) % (2 * dur);
  return m < dur ? m : 2 * dur - m;
};
function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
const info = (clips: ClipTable, k: ClipKey) => clips[k] as ClipInfo;
const add = (c: Choreo, key: ClipKey, time: number, weight: number) => { if (weight > 1e-4) c.entries.push({ key, time, weight }); };
const rot = (lx: number, lz: number, yaw: number) => ({ x: lx * Math.cos(yaw) + lz * Math.sin(yaw), z: -lx * Math.sin(yaw) + lz * Math.cos(yaw) });

type After = "shooter" | "lamento" | "idle";

/** Depois do contato: comemora (gol) ou lamenta; ou apenas volta para a espera. */
function reaction(c: Choreo, plan: Plan, clips: ClipTable, after: After, u: number, endX: number, endZ: number, yawEnd: number, heldClip: ClipKey, heldTime: number) {
  const wR = smooth(u / 0.35);                               // mistura com o clipe anterior
  c.x = endX; c.z = endZ; c.yaw = yawEnd;
  if (after === "idle") {
    add(c, heldClip, heldTime, 1 - wR);
    add(c, IDLE, pingPong(Math.max(0, u) + 1.1, info(clips, IDLE).dur), wR);
    return;
  }
  if (after === "shooter" && plan.result === "goal") {
    const run = info(clips, "anim_run");
    const vC = 3.6, tau = 0.35;
    const dx = plan.celebTo.x - endX, dz = plan.celebTo.z - endZ;
    const dist = Math.hypot(dx, dz) || 1;
    const dMax = Math.min(4.8, dist);
    const uStop = dMax / vC + tau;
    const uu = Math.max(0, u);
    const d = Math.min(dMax, vC * (uu - tau * (1 - Math.exp(-uu / tau))));
    c.x = endX + (dx / dist) * d; c.z = endZ + (dz / dist) * d;
    c.yaw = lerpAngle(yawEnd, Math.atan2(dx, dz), smooth(uu / 0.45));
    const stride = Math.max(0.5, run.vz * run.dur);
    const runT = (((d / stride) % 1) + 1) % 1 * run.dur;
    const wCel = smooth((uu - uStop + 0.2) / 0.35);
    add(c, heldClip, heldTime, 1 - wR);
    add(c, "anim_run", runT, wR * (1 - wCel));
    add(c, "anim_celebrate", 1.5 + Math.max(0, uu - uStop), wCel * wR);
    return;
  }
  add(c, heldClip, heldTime, 1 - wR);
  add(c, "anim_lamento", Math.max(0, u), wR);
}

/**
 * Quem toca na bola (finalização, batida de escanteio, carrinho do defensor): corre ou espera, faz o gesto
 * e o contato acontece exatamente no instante `contactQ`, com a bola no ponto `ball`.
 */
export function choreoContact(c: Choreo, q: number, spec: Contact, plan: Plan, clips: ClipTable, after: After) {
  c.entries.length = 0; c.y = 0;
  const A = plan.animSec, m = spec.mirror;
  const meta = CONTACT_CLIPS[spec.clip];
  const clip = info(clips, spec.clip);
  c.mirror = m; c.yaw = spec.yaw;
  // onde o corpo precisa estar no início do clipe para a bola cair no pé/cabeça no instante do contato
  const off = rot(meta.ball[0] * m, meta.ball[2], spec.yaw);
  const rootX = spec.ball.x - off.x, rootZ = spec.ball.z - off.z;
  const qK0 = spec.contactQ - meta.contact / A;
  const tK = (q - qK0) * A;

  if (tK < 0) {
    if (spec.approach && clips[spec.approach]) {
      const ap = info(clips, spec.approach);
      const v = rot(ap.vx * m, ap.vz, spec.yaw);              // velocidade no mundo
      c.x = rootX - v.x * -tK; c.z = rootZ - v.z * -tK;
      const w = smooth((tK + KICK_END_BLEND) / KICK_END_BLEND);
      add(c, spec.approach, (q * A) % ap.dur, 1 - w);
      add(c, spec.clip, 0, w);
    } else {
      c.x = rootX; c.z = rootZ;
      const w = smooth((tK + 0.3) / 0.3);
      add(c, IDLE, pingPong(q * A, info(clips, IDLE).dur), 1 - w);
      add(c, spec.clip, 0, w);
    }
    return c;
  }
  clip.sample(Math.min(tK, clip.dur), tmp);
  const p = rot(tmp.x * m, tmp.z, spec.yaw);
  c.x = rootX + p.x; c.z = rootZ + p.z;
  const rStart = Math.max(0.6, clip.dur - 0.3);
  if (tK < rStart) { add(c, spec.clip, tK, 1); return c; }
  reaction(c, plan, clips, after, tK - rStart, c.x, c.z, spec.yaw, spec.clip, Math.min(tK, clip.dur));
  return c;
}

export const choreoKicker = (c: Choreo, q: number, plan: Plan, clips: ClipTable) => choreoContact(c, q, plan.shooter, plan, clips, "shooter");
export function choreoTaker(c: Choreo, q: number, plan: Plan, clips: ClipTable) {
  if (!plan.taker) { c.entries.length = 0; return c; }
  return choreoContact(c, q, plan.taker, plan, clips, "idle");
}
export function choreoDefender(c: Choreo, q: number, plan: Plan, clips: ClipTable) {
  if (!plan.defender) { c.entries.length = 0; return c; }
  return choreoContact(c, q, plan.defender.contact, plan, clips, plan.result === "own_goal" ? "lamento" : "idle");
}

/* ------------------------------------------------------------------------ goleiro */
type KeeperParams = { m: 1 | -1; sx: number; x0: number; zOff: number; fz: number; lift: number; t: number };
const KEEPER_Z0 = GL - 0.2;
const cache = new WeakMap<Plan, KeeperParams | null>();

/**
 * Calibra o mergulho/defesa para as luvas chegarem ao alvo: escolhe o espelho, escala o deslocamento lateral
 * do quadril, ajusta a frente e sobe o corpo se o alvo for mais alto que o alcance do clipe.
 */
function keeperParams(plan: Plan): KeeperParams | null {
  if (cache.has(plan)) return cache.get(plan) ?? null;
  let out: KeeperParams | null = null;
  const K = plan.keeper;
  const meta = K.mode === "reach" && K.clip ? REACH_CLIPS[K.clip as ReachKey] : undefined;
  if (meta) {
    const dir = Math.sign(meta.hand[0]) || 1;                       // para que lado do personagem o clipe vai
    const tx = K.target.x;
    const sW = Math.abs(tx) < 0.05 ? dir : Math.sign(tx);
    const m = (sW * dir) as 1 | -1;
    const [Dx, Dz] = meta.hips;
    const rx = meta.hand[0] - Dx, ry = meta.hand[1], rz = meta.hand[2] - Dz;      // luvas em relação ao quadril
    const sx = Math.abs(Dx) > 0.35 ? clamp((m * tx - rx) / Dx, 0.12, 2.4) : 0;
    const x0 = clamp(tx - m * (sx * Dx + rx), -0.9, 0.9);
    const kz = GL + (plan.catches ? 0.4 : 0.55);
    const fz = Dz > 0.15 ? clamp((kz - KEEPER_Z0 - rz) / Dz, 0, 1.2) : 0;
    const zOff = clamp(kz - (KEEPER_Z0 + fz * Dz + rz), -0.3, 0.6);
    out = { m, sx, x0, zOff, fz, lift: clamp(K.target.y - ry, -0.35, 0.9), t: meta.t };
  }
  cache.set(plan, out);
  return out;
}

/** Goleiro: espera, mergulha/bloqueia/defende (alcance calibrado) ou só se desloca na linha. */
export function choreoKeeper(c: Choreo, q: number, plan: Plan, clips: ClipTable) {
  c.entries.length = 0; c.y = 0; c.yaw = 0; c.mirror = 1;
  const A = plan.animSec, K = plan.keeper;
  c.x = 0; c.z = KEEPER_Z0;
  const idleT = pingPong(q * A + 0.7, info(clips, GK_IDLE).dur);
  const P = keeperParams(plan);

  if (P && K.clip) {
    const cl = info(clips, K.clip);
    const tD = (q - (K.qReach - P.t / A)) * A;
    const t = clamp(tD, 0, cl.dur);
    cl.sample(t, tmp);
    c.mirror = P.m;
    c.x = P.x0 + P.m * P.sx * tmp.x;
    c.z = KEEPER_Z0 + P.zOff + P.fz * tmp.z;
    const bump = Math.pow(Math.sin(Math.PI * clamp01((t - Math.max(0, P.t - 0.6)) / 1.2)), 2);
    c.y = P.lift * bump;
    const w = smooth((tD + 0.12) / 0.12);
    add(c, GK_IDLE, idleT, 1 - w);
    add(c, K.clip, Math.max(0, tD), w);
    return c;
  }
  if (K.mode === "track" && K.clip && clips[K.clip]) {
    // um pequeno deslocamento lateral na linha, no momento do chute
    const cl = info(clips, K.clip);
    const tS = (q - (plan.TC - 0.03)) * A;
    cl.sample(cl.dur, tmp); const endX = tmp.x;
    cl.sample(clamp(tS, 0, cl.dur), tmp);
    const sc = Math.abs(endX) > 0.2 ? clamp(Math.abs(K.hipX) / Math.abs(endX), 0.2, 1.1) : 0;
    c.x = tmp.x * sc;
    const w = smooth((tS + 0.1) / 0.1) * (1 - smooth((tS - cl.dur + 0.12) / 0.12));
    add(c, GK_IDLE, idleT, 1 - w);
    add(c, K.clip, Math.max(0, tS), w);
    return c;
  }
  add(c, GK_IDLE, idleT, 1);
  return c;
}

/** Jogadores de apoio: parados, atentos à bola e depois ao desfecho. */
export function choreoExtra(c: Choreo, q: number, plan: Plan, clips: ClipTable, i: number) {
  c.entries.length = 0; c.y = 0;
  const e = plan.extras[i];
  if (!e) return c;
  c.x = e.pos.x; c.z = e.pos.z;
  c.mirror = e.seed % 2 ? 1 : -1;
  const toBall = Math.atan2(plan.S.x - e.pos.x, plan.S.z - e.pos.z);
  const toOutcome = Math.atan2(plan.aim.x - e.pos.x, plan.aim.z - e.pos.z);
  c.yaw = lerpAngle(toBall, toOutcome, smooth((q - plan.TE) / 0.25));
  add(c, IDLE, pingPong(q * plan.animSec + e.seed * 1.7, info(clips, IDLE).dur), 1);
  return c;
}


