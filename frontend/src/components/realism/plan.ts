import * as THREE from "three";
import { BALL_R, GL, GOAL_H, GOAL_W, clamp, clamp01, hash, netZ, v3, type ShotResult } from "./common";

export type Kind = "open" | "penalty" | "header";
type Ease = "out" | "lin" | "quad" | "outq";

/** Trecho do voo da bola: interpolação a→b com arco (apex, em metros) e curva lateral. */
export type Seg = { t0: number; t1: number; a: THREE.Vector3; b: THREE.Vector3; apex: number; curl: number; ease: Ease };

export type Extra = { pos: THREE.Vector3; yaw: number; own: boolean; seed: number };

export type Plan = {
  kind: Kind; result: ShotResult; left: boolean;
  /** Bola no momento do contato. */
  S: THREE.Vector3;
  /** Ponto onde a bola cruza a linha do gol (ou a linha de fundo, se for pra fora). */
  aim: THREE.Vector3;
  /** Instante (0..1) do contato e do fim do voo. */
  TC: number; TE: number;
  segs: Seg[];
  /** Rede balançando (gol): ponto, instante e profundidade. */
  net?: { x: number; y: number; q: number };
  catches: boolean;
  run: { A: THREE.Vector3; P: THREE.Vector3; bend: number; start: number; end: number; cycles: number; yawRun: number; yawShot: number };
  celebTo: THREE.Vector3;
  keeper: { mode: "dive" | "track"; side: number; hipX: number; hipY: number; tilt: number; qStart: number; qReach: number };
  defender?: { pos: THREE.Vector3; touch: THREE.Vector3 };
  extras: Extra[];
  crossFrom?: THREE.Vector3;
  /** Pra fora: para onde a bola vai (alto/lado). */
  offHigh: boolean;
};

export type PlanInput = {
  goalX?: number; goalY?: number; originX: number; originY: number;
  team: "home" | "away"; result: ShotResult; penalty: boolean; header: boolean; left: boolean; seed: number; xg?: number | null;
};

const REACH = 1.2;

function ease(e: Ease, u: number) {
  switch (e) {
    case "out": return 1 - Math.pow(1 - u, 1.35);
    case "outq": return 1 - (1 - u) * (1 - u);
    case "quad": return u * u;
    default: return u;
  }
}

function seg(t0: number, t1: number, a: THREE.Vector3, b: THREE.Vector3, apex = 0, e: Ease = "lin", curl = 0): Seg {
  return { t0, t1, a: a.clone(), b: b.clone(), apex, curl, ease: e };
}

export function ballAt(plan: Plan, q: number, out: THREE.Vector3) {
  const segs = plan.segs;
  if (!segs.length || q <= segs[0].t0) return out.copy(segs.length ? segs[0].a : plan.S);
  let s = segs[0];
  for (const c of segs) { if (c.t0 <= q) s = c; else break; }
  const u = clamp01((q - s.t0) / Math.max(1e-6, s.t1 - s.t0));
  out.lerpVectors(s.a, s.b, ease(s.ease, u));
  out.y += s.apex * 4 * u * (1 - u);
  out.x += s.curl * Math.sin(Math.PI * u);
  out.y = Math.max(BALL_R, out.y);
  return out;
}

/** Mergulho do goleiro: onde o quadril fica para a ponta da luva chegar a (ax, ay). */
function reachTo(ax: number, ay: number, fallbackSide: number) {
  const side = Math.abs(ax) < 0.05 ? fallbackSide : Math.sign(ax);
  const absX = Math.abs(ax);
  const tiltForHeight = Math.acos(clamp((ay - 0.4) / REACH, 0, 1));
  const tiltMaxForX = Math.asin(Math.min(1, absX / REACH));
  const tilt = Math.min(Math.max(tiltForHeight, 0.6), tiltMaxForX);
  const hipX = side * Math.max(0, absX - REACH * Math.sin(tilt));
  const hipY = Math.max(0.45 + 0.45 * Math.cos(tilt), Math.min(1.6, ay - REACH * Math.cos(tilt)));
  return { side, tilt, hipX, hipY };
}

/** Segmentos da bola entrando na rede: toca, quica na rede e escorrega até o chão. */
function netSegs(segs: Seg[], aim: THREE.Vector3, TE: number, S: THREE.Vector3) {
  const d = new THREE.Vector3(aim.x - S.x, 0, aim.z - S.z).normalize();
  const ny = clamp(aim.y * 0.85 + 0.1, 0.25, GOAL_H - 0.2);
  const N = v3(aim.x + d.x * 0.3, ny, netZ(ny) + 0.12);
  const G1 = v3(N.x, BALL_R, N.z + 0.22);
  const G2 = v3(N.x + (aim.x >= 0 ? 0.35 : -0.35), BALL_R, N.z + 0.7);
  segs.push(seg(TE, TE + 0.05, aim, N, 0, "out"));
  segs.push(seg(TE + 0.05, TE + 0.17, N, G1, 0, "quad"));
  segs.push(seg(TE + 0.17, TE + 0.27, G1, G2, 0.1, "out"));
  return N;
}

export function buildPlan(o: PlanInput): Plan {
  const penalty = o.penalty;
  const kind: Kind = penalty ? "penalty" : o.header ? "header" : "open";
  let result = o.result;
  if (penalty && result === "blocked") result = "saved";
  if (penalty && result === "own_goal") result = "goal";

  const h1 = hash(o.originX, o.originY);
  const h2 = hash(o.originY + 3.7, o.originX + 1.9);
  const h3 = hash(o.seed, 5.1);
  const sgnHome = o.team === "home" ? 1 : -1;

  const metersToGoal = (o.team === "home" ? 100 - o.originX : o.originX) * 1.05;
  let dist = 11;
  let lateral = 0;
  if (kind === "open") {
    dist = clamp(metersToGoal * 0.6 + 2.5, 6, 22);
    lateral = clamp((o.originY - 50) * 0.5 * sgnHome, -13, 13);
  } else if (kind === "header") {
    dist = clamp(metersToGoal * 0.45 + 2.5, 4.5, 10);
    lateral = clamp((o.originY - 50) * 0.3 * sgnHome, -5, 5);
  }
  const S = v3(lateral, kind === "header" ? 1.95 : BALL_R, GL + dist);

  // Alvo no plano do gol
  const hasLoc = o.goalX != null && o.goalY != null;
  const gx = hasLoc ? clamp(o.goalX as number, 0.06, 0.94) : kind === "penalty" ? (h1 < 0.5 ? 0.17 : 0.83) : 0.5 + (h1 - 0.5) * 0.7;
  const gy = hasLoc ? clamp(o.goalY as number, 0.1, 0.92) : kind === "penalty" ? 0.35 + h2 * 0.3 : 0.45 + (h2 - 0.5) * 0.5;
  const tx = (gx - 0.5) * GOAL_W * 0.82;
  const ty = GOAL_H * (1 - gy) * 0.8 + 0.23;

  const TC = kind === "penalty" ? 0.43 : kind === "header" ? 0.36 : 0.38;
  let FL = kind === "penalty" ? 0.11 : kind === "header" ? 0.14 : clamp(0.085 + dist * 0.0045, 0.12, 0.2);
  const apexBase = kind === "penalty" ? 0.12 : kind === "header" ? 0.05 : clamp(0.18 + dist * 0.035, 0.25, 1.3);
  const curl = kind === "open" ? (h3 - 0.5) * clamp(dist * 0.1, 0.4, 1.6) : 0;
  const dirDefault = Math.abs(tx) < 0.4 ? (S.x > 0 ? -1 : 1) : Math.sign(tx);

  const segs: Seg[] = [];
  let TE = TC + FL;
  let aim = v3(tx, ty, GL);
  let net: Plan["net"];
  let catches = false;
  let keeper: Plan["keeper"];
  let defender: Plan["defender"];
  let offHigh = false;
  const stdStart = kind === "penalty" ? TC - 0.005 : TC + 0.012;

  const centerDir = new THREE.Vector3(-S.x, 0, GL - S.z).normalize();
  const sideSgn = S.x >= 0 ? 1 : -1;

  if (result === "goal") {
    segs.push(seg(TC, TE, S, aim, apexBase, "out", curl));
    const N = netSegs(segs, aim, TE, S);
    net = { x: N.x, y: N.y, q: TE };
    const wrongWay = kind === "penalty" && h3 < 0.35;
    if (wrongWay) {
      keeper = { mode: "dive", ...reachTo(-tx * 0.8, Math.max(0.6, ty * 0.7), -dirDefault), qStart: stdStart, qReach: TE };
    } else {
      keeper = { mode: "dive", ...reachTo(tx - dirDefault * 0.75, Math.max(0.5, ty - 0.35), dirDefault), qStart: stdStart, qReach: TE };
    }
  } else if (result === "own_goal") {
    const Dp = v3(S.x * 0.45, 0, GL + 2.3);
    const T = v3(Dp.x, 0.75, Dp.z + 0.32);
    const side = Math.abs(T.x) < 0.3 ? (S.x > 0 ? 1 : -1) : -Math.sign(T.x);
    aim = v3(side * (1.5 + h1 * 1.3), 0.6 + h2 * 0.6, GL);
    const tTouch = TC + (TE - TC) * 0.6;
    segs.push(seg(TC, tTouch, S, T, 0.4, "out"));
    segs.push(seg(tTouch, TE, T, aim, 0.12, "out"));
    const N = netSegs(segs, aim, TE, T);
    net = { x: N.x, y: N.y, q: TE };
    defender = { pos: Dp, touch: T };
    keeper = { mode: "dive", ...reachTo(-side * 2.1, 1.0, -side), qStart: TC + 0.02, qReach: TE };
  } else if (result === "saved") {
    const K = v3(tx, ty, GL + 0.5);
    aim = K.clone();
    segs.push(seg(TC, TE, S, K, apexBase, "out", curl));
    const high = ty > 1.95;
    catches = !high && h3 < 0.42 && kind !== "penalty";
    keeper = { mode: "dive", ...reachTo(tx, ty, dirDefault), qStart: stdStart, qReach: TE };
    if (!catches) {
      if (high) {
        // espalmada por cima da trave
        const over = v3(tx * 1.05, GOAL_H + 0.9, GL - 0.6);
        const down = v3(tx * 1.2, BALL_R, GL - 3.4);
        segs.push(seg(TE, TE + 0.09, K, over, 0.2, "out"));
        segs.push(seg(TE + 0.09, TE + 0.24, over, down, 0, "quad"));
      } else {
        const dir = dirDefault;
        const P1 = v3(tx + dir * (1.3 + h1), BALL_R, GL + 2.4 + h2 * 1.6);
        const P2 = v3(P1.x + dir * 0.9, BALL_R, P1.z + 1.0);
        segs.push(seg(TE, TE + 0.14, K, P1, 0.9 + h2 * 0.7, "outq"));
        segs.push(seg(TE + 0.14, TE + 0.26, P1, P2, 0.22, "out"));
      }
    }
  } else if (result === "blocked") {
    FL = FL * 0.45;
    TE = TC + FL;
    const dd = clamp(dist * 0.28, 1.6, 3.2);
    const Dp = v3(S.x + centerDir.x * dd, 0, S.z + centerDir.z * dd);
    const B = v3(Dp.x, 0.55, Dp.z + 0.3);
    const side = h1 < 0.5 ? -1 : 1;
    const D = v3(B.x + side * (2.6 + h1 * 1.6), BALL_R, B.z + 1.8 + h1);
    const D2 = v3(D.x + side * 1.0, BALL_R, D.z + 1.1);
    aim = B.clone();
    segs.push(seg(TC, TE, S, B, 0.2, "out"));
    segs.push(seg(TE, TE + 0.18, B, D, 1.0, "outq"));
    segs.push(seg(TE + 0.18, TE + 0.3, D, D2, 0.2, "out"));
    defender = { pos: Dp, touch: B };
    keeper = { mode: "track", side: sideSgn, tilt: 0, hipX: clamp(Dp.x * 0.25, -1.2, 1.2), hipY: 0.9, qStart: TC, qReach: TE };
  } else {
    // pra fora
    offHigh = h2 > 0.62;
    const side = hasLoc ? (gx >= 0.5 ? 1 : -1) : h1 < 0.5 ? -1 : 1;
    const HALF = GOAL_W / 2;
    const cross = offHigh
      ? v3((h1 - 0.5) * 4.4, GOAL_H + 0.7 + (h2 - 0.62) * 2.9, GL)
      : v3(side * (HALF + 0.9 + h1 * 1.4), 0.6 + h2 * 1.5, GL);
    const out = offHigh
      ? v3(cross.x + (h1 - 0.5) * 0.8, BALL_R, GL - 4.2)
      : v3(cross.x + side * (0.6 + h1 * 0.8), BALL_R, GL - 3.4);
    const rest = v3(out.x + side * 0.3, BALL_R, GL - 4.9);
    aim = cross.clone();
    segs.push(seg(TC, TE, S, cross, apexBase + (offHigh ? 0.5 : 0), "out", curl));
    segs.push(seg(TE, TE + 0.17, cross, out, 0, "quad"));
    segs.push(seg(TE + 0.17, TE + 0.3, out, rest, 0.12, "out"));
    keeper = { mode: "track", side, tilt: 0, hipX: clamp(cross.x * 0.3, -1.3, 1.3), hipY: 0.9, qStart: TC, qReach: TE };
  }

  // Cabeceio: a bola chega por cruzamento e é cabeceada no alto.
  let crossFrom: THREE.Vector3 | undefined;
  if (kind === "header") {
    crossFrom = v3(clamp(S.x * 1.6 + (S.x >= 0 ? 4 : -4), -16, 16), 0.5, S.z + 4.8);
    segs.unshift(seg(TC - 0.22, TC, crossFrom, S, 2.7, "lin"));
  }

  // Corrida até a bola
  const plantSign = o.left ? -1 : 1;
  const P = v3(S.x - 0.1 * plantSign, 0, S.z + (kind === "header" ? 0.42 : 0.66));
  const runLen = kind === "penalty" ? 5.0 : kind === "header" ? 3.4 : clamp(dist * 0.5, 4.5, 7);
  const approachSide = kind === "penalty" ? -plantSign : (h2 < 0.5 ? -1 : 1);
  const A = v3(P.x + approachSide * (kind === "penalty" ? 2.1 : 2.4), 0, P.z + runLen);
  const runStart = 0.03;
  const runEnd = TC - 0.045;
  const cycles = Math.max(2, Math.round(A.distanceTo(P) / 1.9));
  const hRun = new THREE.Vector3().subVectors(P, A);
  const yawRun = Math.atan2(-hRun.x, -hRun.z);
  const toAim = new THREE.Vector3(aim.x - S.x, 0, aim.z - S.z);
  const yawShot = Math.atan2(-toAim.x, -toAim.z);

  // Comemoração: corre para o lado, perto da lateral/escanteio
  const cs = S.x >= 0 ? 1 : -1;
  const celebTo = v3(cs * clamp(Math.abs(S.x) + 5, 8, 14), 0, GL + (S.z - GL) * 0.55);

  // Elenco de apoio
  const lane = (z: number) => S.x * (z - GL) / Math.max(1, S.z - GL);
  const extras: Extra[] = [];
  const yawBall = (p: THREE.Vector3) => Math.atan2(-(S.x - p.x), -(S.z - p.z));
  if (kind === "penalty") {
    [-9, -3.4, 3.4, 9].forEach((x, i) => {
      const p = v3(x, 0, GL + 17.6 + (i % 2) * 0.7);
      extras.push({ pos: p, yaw: yawBall(p), own: i % 2 === 0, seed: i + 1 });
    });
  } else {
    const place = (x: number, z: number, own: boolean, seed: number) => {
      const lx = lane(z);
      let px = x;
      if (Math.abs(px - lx) < 2.8) px = lx + (px >= lx ? 2.8 : -2.8);
      const p = v3(clamp(px, -13, 13), 0, z);
      extras.push({ pos: p, yaw: yawBall(p), own, seed });
    };
    place(S.x * 0.5 + (S.x >= 0 ? -5 : 5), GL + 4.6, false, 1);
    place(S.x * 0.5 + (S.x >= 0 ? 5 : -5), GL + 6.6, false, 2);
    place(-S.x * 0.2 + (S.x >= 0 ? -7 : 7), GL + 7.6, true, 3);
    place(S.x * 0.2 + (S.x >= 0 ? 8.5 : -8.5), GL + 11.5, false, 4);
  }

  return {
    kind, result, left: o.left, S, aim, TC, TE, segs, net, catches,
    run: { A, P, bend: approachSide * -0.5, start: runStart, end: runEnd, cycles, yawRun, yawShot },
    celebTo, keeper, defender, extras, crossFrom, offHigh,
  };
}

