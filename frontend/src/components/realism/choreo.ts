import { GL, clamp, clamp01, lerp, smooth } from "./common";
import { ANIM_SEC_PER_Q as A, KICK_END_BLEND, MODEL_META, type ClipKey } from "./modelMeta";
import type { Plan } from "./plan";

/** O que a coreografia precisa saber de cada clipe (duração e deslocamento de raiz). */
export type ClipInfo = {
  dur: number;
  /** Quanto o quadril avança em um ciclo/duração inteira (m). */
  stride: number;
  sample: (t: number, out: { x: number; z: number }) => void;
};
export type ClipTable = Record<ClipKey, ClipInfo>;
export type Entry = { key: ClipKey; time: number; weight: number };
export type Choreo = { x: number; y: number; z: number; yaw: number; mirror: number; entries: Entry[] };
export const newChoreo = (): Choreo => ({ x: 0, y: 0, z: 0, yaw: 0, mirror: 1, entries: [] });

const tmp = { x: 0, z: 0 };

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
const add = (c: Choreo, key: ClipKey, time: number, weight: number) => { if (weight > 1e-4) c.entries.push({ key, time, weight }); };
const rot = (lx: number, lz: number, yaw: number) => ({ x: lx * Math.cos(yaw) + lz * Math.sin(yaw), z: -lx * Math.sin(yaw) + lz * Math.cos(yaw) });

/** Reação de quem chutou depois do clipe de chute/cabeceio: comemoração (gol) ou lamento. */
function reaction(c: Choreo, plan: Plan, clips: ClipTable, u: number, endX: number, endZ: number, yawEnd: number, heldClip: ClipKey, heldTime: number) {
  const wR = smooth(u / 0.35);                         // mistura com o clipe anterior
  if (plan.result === "goal") {
    const vC = 3.6, tau = 0.35;
    const dx = plan.celebTo.x - endX, dz = plan.celebTo.z - endZ;
    const dist = Math.hypot(dx, dz) || 1;
    const dMax = Math.min(4.8, dist);
    const uStop = dMax / vC + tau;
    const uu = Math.max(0, u);
    const d = Math.min(dMax, vC * (uu - tau * (1 - Math.exp(-uu / tau))));
    c.x = endX + (dx / dist) * d; c.z = endZ + (dz / dist) * d;
    const yawC = Math.atan2(dx, dz);
    c.yaw = lerpAngle(yawEnd, yawC, smooth(uu / 0.45));
    const run = clips.run;
    const runT = (((d / run.stride) % 1) + 1) % 1 * run.dur;
    const wCel = smooth((uu - uStop + 0.2) / 0.35);
    const runW = wR * (1 - wCel);
    add(c, heldClip, heldTime, 1 - wR);
    add(c, "run", runT, runW);
    add(c, "celebrate", 1.5 + Math.max(0, uu - uStop), wCel * wR);
  } else {
    c.x = endX; c.z = endZ; c.yaw = yawEnd;
    add(c, heldClip, heldTime, 1 - wR);
    add(c, "lamento", Math.max(0, u), wR);
  }
}

/** Quem chuta (ou cabeceia): corrida até a bola, contato exato no instante TC, reação. */
export function choreoKicker(c: Choreo, q: number, plan: Plan, clips: ClipTable) {
  c.entries.length = 0; c.y = 0;
  const m = plan.left ? -1 : 1;
  const yaw = Math.atan2(plan.aim.x - plan.S.x, plan.aim.z - plan.S.z);
  c.mirror = m;

  if (plan.kind === "header") {
    const h = clips.header;
    const [bx, , bz] = MODEL_META.header.ball;
    const off = rot(bx * m, bz, yaw);
    const rx = plan.S.x - off.x, rz = plan.S.z - off.z;
    const qH0 = plan.TC - MODEL_META.header.contact / A;
    const tH = (q - qH0) * A;
    c.x = rx; c.z = rz; c.yaw = yaw;
    const wH = smooth((tH + 0.25) / 0.25);
    const rStart = h.dur - 0.55;                         // começa a reagir antes do fim do clipe de cabeceio
    if (tH < rStart) {
      add(c, "idle", pingPong(q * A, clips.idle.dur), 1 - wH);
      add(c, "header", Math.max(0, tH), wH);
    } else {
      reaction(c, plan, clips, tH - rStart, rx, rz, yaw, "header", Math.min(tH, h.dur));
    }
    return c;
  }

  const kick = clips.kick, run = clips.run;
  const [bx, , bz] = MODEL_META.kick.ball;
  const off = rot(bx * m, bz, yaw);
  const rootX = plan.S.x - off.x, rootZ = plan.S.z - off.z;       // onde o corpo fica no início do clipe de chute
  const qK0 = plan.TC - MODEL_META.kick.contact / A;
  const tK = (q - qK0) * A;
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const speed = run.stride / run.dur;

  if (tK < 0) {
    // corrida em linha reta até o ponto de partida do chute
    const behind = speed * -tK;
    c.x = rootX - fx * behind; c.z = rootZ - fz * behind; c.yaw = yaw;
    const runT = ((((speed * q * A) / run.stride) % 1) + 1) % 1 * run.dur;
    const wK = smooth((tK + KICK_END_BLEND) / KICK_END_BLEND);
    add(c, "run", runT, 1 - wK);
    add(c, "kick", 0, wK);
    return c;
  }
  kick.sample(Math.min(tK, kick.dur), tmp);
  const p = rot(tmp.x * m, tmp.z, yaw);
  c.x = rootX + p.x; c.z = rootZ + p.z; c.yaw = yaw;
  const rStart = kick.dur - 0.3;
  if (tK < rStart) { add(c, "kick", tK, 1); return c; }
  reaction(c, plan, clips, tK - rStart, c.x, c.z, yaw, "kick", Math.min(tK, kick.dur));
  return c;
}

/** Goleiro: espera, mergulho (alcance calibrado pelo alvo) ou defesa agarrada; segura a bola depois. */
export function choreoKeeper(c: Choreo, q: number, plan: Plan, clips: ClipTable) {
  c.entries.length = 0; c.y = 0; c.yaw = 0; c.mirror = 1;
  const K = plan.keeper;
  const z0 = GL - 0.2;
  c.x = 0; c.z = z0;
  const idleT = pingPong(q * A + 0.7, clips.gkIdle.dur);
  const sgn = Math.abs(K.target.x) < 0.05 ? (K.side || 1) : Math.sign(K.target.x);

  if (plan.catches) {
    const cl = clips.gkCatch;
    const tC = (q - (K.qReach - MODEL_META.catch.contact / A)) * A;
    c.mirror = -sgn;
    const hipsAtContact = Math.abs(MODEL_META.catch.hipsLateral);
    const sc = clamp((Math.abs(K.target.x) - Math.abs(MODEL_META.catch.handLateralFromHips) - 0) / hipsAtContact, 0, 5);
    cl.sample(clamp(tC, 0, cl.dur), tmp);
    c.x = c.mirror * tmp.x * sc; c.z = z0 + tmp.z;
    const w = smooth((tC + 0.12) / 0.12);
    add(c, "gkIdle", idleT, 1 - w);
    add(c, "gkCatch", Math.max(0, tC), w);
    return c;
  }
  if (K.mode === "dive") {
    const cl = clips.gkDive;
    const d = MODEL_META.dive;
    const tD = (q - (K.qReach - d.contact / A)) * A;
    c.mirror = sgn;
    const sx = Math.max(0.15, (Math.abs(K.target.x) - d.handLateralFromHips) / d.hipsLateral);
    const lift = clamp(K.target.y - d.handY, -0.3, 0.85);
    cl.sample(clamp(tD, 0, cl.dur), tmp);
    const t = clamp(tD, 0, cl.dur);
    const bump = Math.pow(Math.sin(Math.PI * clamp01((t - 0.35) / 1.3)), 2);
    c.x = sgn * sx * tmp.x; c.z = z0 + 0.12 * tmp.z; c.y = lift * bump;
    const w = smooth((tD + 0.12) / 0.12);
    add(c, "gkIdle", idleT, 1 - w);
    add(c, "gkDive", Math.max(0, tD), w);
    return c;
  }
  // sem mergulho: acompanha a bola na linha
  c.x = lerp(0, K.hipX * 0.7, smooth((q - plan.TC) / Math.max(0.03, plan.TE - plan.TC)));
  add(c, "gkIdle", idleT, 1);
  return c;
}

/** Defensor do bloqueio / gol contra: dá o “chute” que desvia a bola, no instante do toque. */
export function choreoDefender(c: Choreo, q: number, plan: Plan, clips: ClipTable) {
  c.entries.length = 0; c.y = 0; c.mirror = 1;
  const d = plan.defender;
  if (!d) return c;
  const kick = clips.kick;
  const dest = plan.segs[1].b;                                   // para onde a bola vai depois do toque
  const yaw = Math.atan2(dest.x - d.touch.x, dest.z - d.touch.z);
  const [bx, , bz] = MODEL_META.kick.ball;
  const off = rot(bx, bz, yaw);
  const rootX = d.touch.x - off.x, rootZ = d.touch.z - off.z;
  const tK = (q - (d.contactQ - MODEL_META.kick.contact / A)) * A;
  c.yaw = yaw;
  const idleT = pingPong(q * A + 1.3, clips.idle.dur);
  if (tK < 0) {
    c.x = rootX; c.z = rootZ;
    const w = smooth((tK + 0.25) / 0.25);
    add(c, "idle", idleT, 1 - w);
    add(c, "kick", 0, w);
    return c;
  }
  kick.sample(Math.min(tK, kick.dur), tmp);
  const p = rot(tmp.x, tmp.z, yaw);
  c.x = rootX + p.x; c.z = rootZ + p.z;
  const tail = smooth((tK - (kick.dur - 0.3)) / 0.3);
  if (plan.result === "own_goal") {
    add(c, "kick", Math.min(tK, kick.dur), 1 - tail);
    add(c, "lamento", Math.max(0, tK - (kick.dur - 0.3)), tail);
  } else add(c, "kick", Math.min(tK, kick.dur), 1);
  return c;
}

/** Jogadores de apoio: parados, atentos à bola e depois ao desfecho. */
export function choreoExtra(c: Choreo, q: number, plan: Plan, clips: ClipTable, i: number) {
  c.entries.length = 0; c.y = 0; c.mirror = 1;
  const e = plan.extras[i];
  if (!e) return c;
  c.x = e.pos.x; c.z = e.pos.z;
  const toBall = Math.atan2(plan.S.x - e.pos.x, plan.S.z - e.pos.z);
  const toOutcome = Math.atan2(plan.aim.x - e.pos.x, plan.aim.z - e.pos.z);
  c.yaw = lerpAngle(toBall, toOutcome, smooth((q - plan.TE) / 0.25));
  add(c, "idle", pingPong(q * A + e.seed * 1.7, clips.idle.dur), 1);
  return c;
}
