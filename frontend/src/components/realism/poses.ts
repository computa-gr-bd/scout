import * as THREE from "three";
import { GL, STAND_HIPS, clamp01, lerp, smooth } from "./common";
import { mirrorPose, mixPose, newPose, resetPose, type Pose } from "./Rig";
import type { Plan } from "./plan";

const KP = (o: Partial<Pose>): Pose => ({ ...newPose(), ...o });

/* Poses-chave do chute (escritas para destro; canhoto = espelho). */
const WIND = KP({
  hipsY: 0.9, lean: 0.1, twist: -0.28, head: -0.35,
  hipR: -0.78, kneeR: 1.6, ankleR: -0.3, hipL: 0.22, kneeL: 0.3, hipLz: 0.1, hipRz: 0.06,
  shR: 0.85, shRz: 0.25, elR: 0.7, shL: -0.4, shLz: 0.95, elL: 0.5,
});
const CONTACT = KP({
  hipsY: 0.85, lean: 0.24, twist: 0.12, head: -0.55,
  hipR: 0.8, kneeR: 0.38, ankleR: -0.75, hipL: 0.12, kneeL: 0.36, hipLz: 0.08, hipRz: 0.05,
  shR: -0.55, shRz: 0.5, elR: 0.5, shL: 0.45, shLz: 1.05, elL: 0.45,
});
const FOLLOW = KP({
  hipsY: 0.93, lean: 0.14, twist: 0.38, head: -0.25,
  hipR: 1.38, kneeR: 0.16, ankleR: -0.55, hipL: 0.1, kneeL: 0.14, hipLz: 0.06, hipRz: 0.05,
  shR: -0.95, shRz: 0.55, elR: 0.5, shL: 0.8, shLz: 0.85, elL: 0.6,
});
/* Cabeceio */
const HEAD_WIND = KP({
  hipsY: 0.93, lean: -0.38, head: 0.35,
  hipR: 0.55, kneeR: 1.25, hipL: 0.35, kneeL: 1.0, hipLz: 0.2, hipRz: 0.2,
  shR: 0.9, shL: 0.9, shRz: 0.75, shLz: 0.75, elR: 0.5, elL: 0.5,
});
const HEAD_HIT = KP({
  hipsY: 0.93, lean: 0.62, head: 0.0,
  hipR: 0.35, kneeR: 1.1, hipL: 0.1, kneeL: 0.9, hipLz: 0.18, hipRz: 0.18,
  shR: 0.3, shL: 0.3, shRz: 0.9, shLz: 0.9, elR: 0.8, elL: 0.8,
});
/* Reações */
const HANDS_HEAD = KP({
  hipsY: 0.92, lean: 0.22, head: -0.5,
  shR: 2.55, shL: 2.55, shRz: 0.3, shLz: 0.3, elR: 2.35, elL: 2.35,
  hipLz: 0.08, hipRz: 0.08,
});
const FIST = KP({
  hipsY: 0.9, lean: -0.02, head: 0.3,
  shR: 2.9, shL: 2.9, shRz: 0.55, shLz: 0.55, elR: 0.4, elL: 0.4,
});

const cur = newPose();
const tmp = newPose();

/** Ciclo de corrida (destro). `amp` 0 = parado. */
function runCycle(p: Pose, ph: number, amp: number, lean = 0.2) {
  const s = Math.sin(ph), c = Math.cos(ph);
  p.hipR = 0.66 * amp * s; p.hipL = -0.66 * amp * s;
  p.kneeR = 0.18 + 1.0 * amp * Math.max(0, c); p.kneeL = 0.18 + 1.0 * amp * Math.max(0, -c);
  p.shR = -0.75 * amp * s; p.shL = 0.75 * amp * s;
  p.elR = 0.3 + 0.95 * amp; p.elL = 0.3 + 0.95 * amp;
  p.shRz = 0.12; p.shLz = 0.12;
  p.lean = 0.05 + (lean - 0.05) * amp;
  p.twist = 0.14 * amp * s;
  p.hipsY = STAND_HIPS - 0.045 * amp + 0.03 * amp * Math.abs(c);
}

/** Tornozelo (perna de chute) no mundo, por cinemática direta da pose — para alinhar o pé com a bola. */
function ankleWorld(p: Pose, side: number, root: { x: number; z: number }) {
  const hip = side > 0 ? p.hipR : p.hipL, knee = side > 0 ? p.kneeR : p.kneeL, hz = side > 0 ? p.hipRz : p.hipLz;
  let y = -0.42, z = 0, x = 0;
  const rx = (a: number) => { const ny = y * Math.cos(a) - z * Math.sin(a), nz = y * Math.sin(a) + z * Math.cos(a); y = ny; z = nz; };
  const rz = (a: number) => { const nx = x * Math.cos(a) - y * Math.sin(a), ny = x * Math.sin(a) + y * Math.cos(a); x = nx; y = ny; };
  rx(-knee); y -= 0.44; rx(hip); rz(side > 0 ? hz : -hz); x += side * 0.095; y += p.hipsY - 0.02;
  const wx = x * Math.cos(p.ry) + z * Math.sin(p.ry), wz = -x * Math.sin(p.ry) + z * Math.cos(p.ry);
  return { x: root.x + wx, y, z: root.z + wz };
}
const alignCache = new WeakMap<Plan, { x: number; z: number }>();
/** Deslocamento do ponto de apoio para o tornozelo ficar ~0,30 m atrás do centro da bola no contato. */
function contactAlign(plan: Plan) {
  const hit = alignCache.get(plan);
  if (hit) return hit;
  const p = { ...CONTACT };
  if (plan.left) mirrorPose(p);
  p.ry = plan.run.yawShot;
  const a = ankleWorld(p, plan.left ? -1 : 1, plan.run.P);
  const c = plan.kind === "header" ? { x: 0, z: 0 } : { x: plan.S.x - a.x, z: plan.S.z + 0.3 - a.z };
  alignCache.set(plan, c);
  return c;
}

function facingYaw(from: THREE.Vector3, to: THREE.Vector3) {
  return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}
function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Quem chuta: corrida em arco, passada de apoio, chute, acompanhamento e reação. */
export function poseKicker(out: Pose, q: number, plan: Plan) {
  resetPose(out);
  const { TC, TE, run, kind } = plan;
  const u = clamp01((q - run.start) / (run.end - run.start));
  const ue = u * (2 - u);
  const al = contactAlign(plan);
  let x = lerp(run.A.x, run.P.x + al.x, ue) + run.bend * Math.sin(Math.PI * ue);
  let z = lerp(run.A.z, run.P.z + al.z, ue);

  resetPose(cur);
  runCycle(cur, ue * run.cycles * Math.PI * 2, smooth(u * 6) * (u >= 1 ? 0 : 1));

  const wind = kind === "header" ? HEAD_WIND : WIND;
  const hit = kind === "header" ? HEAD_HIT : CONTACT;
  const wA = smooth((q - (TC - 0.13)) / 0.08);
  const wB = smooth((q - (TC - 0.045)) / 0.045);
  const wC = smooth((q - TC) / 0.05);
  mixPose(cur, cur, wind, wA);
  mixPose(cur, cur, hit, wB);
  if (kind !== "header") mixPose(cur, cur, FOLLOW, wC);

  // salto do cabeceio
  let jump = 0;
  if (kind === "header") {
    const j = clamp01((q - (TC - 0.1)) / 0.22);
    jump = 0.36 * Math.sin(Math.PI * j);
  }

  // impulso depois do chute
  const carry = smooth((q - TC) / 0.1) * (kind === "header" ? 0.1 : 0.35);
  z -= carry;

  // Reação
  let yaw = lerpAngle(run.yawRun, run.yawShot, smooth((q - (TC - 0.2)) / 0.12));
  const wR = smooth((q - (TE + 0.03)) / 0.1);
  if (wR > 0) {
    if (plan.result === "goal") {
      // corre comemorando com os punhos para cima
      const t = Math.max(0, q - TE - 0.03);
      const k = smooth(t / 0.4);
      x = lerp(x, plan.celebTo.x, k);
      z = lerp(z, plan.celebTo.z, k);
      const yawC = facingYaw(new THREE.Vector3(x, 0, z), plan.celebTo);
      yaw = lerpAngle(yaw, Math.abs(plan.celebTo.x - x) < 0.05 ? yaw : yawC, wR);
      resetPose(tmp);
      runCycle(tmp, t * 115, smooth(t / 0.05) * (1 - smooth((t - 0.38) / 0.1) * 0.6), 0.1);
      mixPose(tmp, tmp, FIST, wR);
      mixPose(cur, cur, tmp, wR);
    } else {
      mixPose(cur, cur, HANDS_HEAD, wR);
    }
  }

  Object.assign(out, cur);
  out.x = x; out.z = z; out.y = jump; out.ry = yaw;
  if (plan.left) mirrorPose(out);
}

/** Goleiro: posição de espera, mergulho (conforme o resultado), queda e reação. */
export function poseKeeper(out: Pose, q: number, plan: Plan) {
  resetPose(out);
  const K = plan.keeper;
  out.ry = Math.PI;
  out.z = GL + 0.35;

  const c = smooth((q - (plan.TC - 0.14)) / 0.08);
  out.hipsY = lerp(STAND_HIPS, 0.82, c);
  out.hipL = out.hipR = 0.55 * c;
  out.kneeL = out.kneeR = 0.05 + 0.95 * c;
  out.hipLz = out.hipRz = lerp(0.04, 0.34, c);
  out.shL = out.shR = 0.7 * c;
  out.shLz = out.shRz = 0.1 + 0.5 * c;
  out.elL = out.elR = 0.3 + 0.7 * c;
  out.lean = 0.05 + 0.26 * c;
  const shuffle = q < K.qStart ? Math.sin(q * 70) * 0.2 * c : 0;
  out.x = shuffle;

  if (K.mode === "dive") {
    const d = smooth((q - K.qStart) / Math.max(0.02, K.qReach - K.qStart));
    out.x = lerp(shuffle, K.hipX, d);
    out.hipsY = lerp(out.hipsY, K.hipY, d);
    // o corpo está virado para +Z: rotação positiva leva a cabeça para +X do mundo
    out.sideLean = K.side * K.tilt * d;
    out.lean = lerp(out.lean, 0, d);
    out.shL = out.shR = lerp(out.shL, 2.95, d);
    out.shLz = out.shRz = lerp(out.shLz, 0.12, d);
    out.elL = out.elR = lerp(out.elL, 0.12, d);
    out.hipL = lerp(out.hipL, 0.1, d); out.hipR = lerp(out.hipR, -0.1, d);
    out.kneeL = lerp(out.kneeL, 0.2, d); out.kneeR = lerp(out.kneeR, 0.45, d);
    out.hipLz = out.hipRz = lerp(out.hipLz, 0.18, d);
    out.head = 0.2 * d;

    // queda no gramado depois do alcance
    const g = smooth((q - K.qReach) / 0.14);
    if (g > 0 && K.tilt > 0.3) {
      out.hipsY = lerp(K.hipY, 0.26, g);
      out.sideLean = K.side * lerp(K.tilt, 1.45, g);
      out.x += K.side * 0.4 * g;
      out.y = 0;
    }
    if (plan.catches) {
      const k = smooth((q - K.qReach) / 0.08);
      out.shL = out.shR = lerp(out.shL, 1.55, k);
      out.elL = out.elR = lerp(out.elL, 2.0, k);
      out.shLz = out.shRz = lerp(out.shLz, 0.25, k);
    }
  } else {
    // acompanha a jogada sem sair da linha
    const f = smooth((q - plan.TC) / Math.max(0.03, plan.TE - plan.TC));
    out.x = lerp(shuffle, K.hipX, f);
    const r = smooth((q - (plan.TE + 0.05)) / 0.1);
    out.hipsY = lerp(out.hipsY, STAND_HIPS, r);
    out.hipL = out.hipR = lerp(out.hipL, 0, r);
    out.kneeL = out.kneeR = lerp(out.kneeL, 0.08, r);
    out.shL = out.shR = lerp(out.shL, 0.15, r);
    out.shLz = out.shRz = lerp(out.shLz, 0.85, r);
    out.elL = out.elR = lerp(out.elL, 1.9, r);
    out.lean = lerp(out.lean, 0.12, r);
  }
}

/** Defensor do bloqueio (e do gol contra): joga o corpo/perna na frente da bola. */
export function poseDefender(out: Pose, q: number, plan: Plan) {
  resetPose(out);
  const d = plan.defender;
  if (!d) return;
  out.ry = Math.PI;
  out.x = d.pos.x; out.z = d.pos.z;
  const touchQ = plan.result === "own_goal" ? plan.TC + (plan.TE - plan.TC) * 0.6 : plan.TE;
  const c = smooth((q - (plan.TC - 0.14)) / 0.08);
  out.hipsY = lerp(STAND_HIPS, 0.84, c);
  out.hipL = out.hipR = 0.4 * c;
  out.kneeL = out.kneeR = 0.05 + 0.75 * c;
  out.hipLz = out.hipRz = 0.04 + 0.22 * c;
  out.shL = out.shR = 0.4 * c; out.shLz = out.shRz = 0.1 + 0.4 * c; out.elL = out.elR = 0.3 + 0.5 * c;
  out.lean = 0.05 + 0.2 * c;
  const b = smooth((q - (touchQ - 0.07)) / 0.06) * (1 - smooth((q - touchQ - 0.12) / 0.2) * 0.6);
  out.hipR = lerp(out.hipR, 1.25, b); out.kneeR = lerp(out.kneeR, 0.2, b);
  out.hipL = lerp(out.hipL, -0.15, b); out.kneeL = lerp(out.kneeL, 0.5, b);
  out.shLz = out.shRz = lerp(out.shLz, 0.9, b);
  out.lean = lerp(out.lean, -0.12, b);
  out.y = Math.sin(b * Math.PI) * 0.08;
  if (plan.result === "own_goal") {
    const r = smooth((q - (plan.TE + 0.04)) / 0.1);
    mixPose(out, out, HANDS_HEAD, r);
  }
}

/** Jogadores de apoio: parados atentos, olhando a bola e depois o desfecho. */
export function poseExtra(out: Pose, q: number, plan: Plan, i: number) {
  resetPose(out);
  const e = plan.extras[i];
  if (!e) return;
  const sway = Math.sin(q * 90 + e.seed * 2) * 0.03;
  out.x = e.pos.x; out.z = e.pos.z;
  out.ry = lerpAngle(e.yaw, e.yaw + (e.pos.x > 0 ? 0.35 : -0.35), smooth((q - plan.TE) / 0.2));
  out.lean = 0.1 + sway; out.hipsY = 0.9;
  out.hipL = 0.1; out.hipR = -0.05; out.kneeL = 0.2; out.kneeR = 0.12;
  out.shL = 0.15; out.shR = 0.15; out.shLz = 0.25; out.shRz = 0.25; out.elL = 0.7; out.elR = 0.7;
  out.hipLz = out.hipRz = 0.12;
  out.head = sway;
  if (plan.kind !== "penalty") {
    // fica no “pé” da jogada: pequeno trote no lugar
    const t = q * 80 + e.seed;
    out.hipsY = 0.9 + Math.abs(Math.sin(t)) * 0.015;
  }
}
