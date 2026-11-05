import * as THREE from "three";
import { BALL_R, GL, GOAL_H, GOAL_W, PENALTY_DIST, clamp, clamp01, hash, netZ, v3, type ShotResult } from "./common";
import { CONTACT_CLIPS } from "./clipCatalog";
import { ANIM_SEC_CORNER, ANIM_SEC_OPEN, type ClipKey, type ContactKey } from "./modelMeta";

export type Kind = "open" | "penalty" | "header";
type Ease = "out" | "lin" | "quad" | "outq";

/** Trecho do voo da bola: interpolação a→b com arco (apex, em metros) e curva lateral. */
export type Seg = { t0: number; t1: number; a: THREE.Vector3; b: THREE.Vector3; apex: number; curl: number; ease: Ease };

export type Extra = { pos: THREE.Vector3; yaw: number; own: boolean; seed: number };

/** Um jogador que toca na bola (chute, cabeceio, carrinho): qual clipe, onde e quando. */
export type Contact = {
  clip: ContactKey;
  /** -1 = clipe espelhado (para o pé contrário). */
  mirror: 1 | -1;
  /** Instante (0..1) do contato com a bola. */
  contactQ: number;
  /** Centro da bola no mundo no instante do contato. */
  ball: THREE.Vector3;
  /** Direção do corpo (rad, em torno de Y; 0 = olhando para +Z). */
  yaw: number;
  /** Clipe de corrida até a bola (null = espera parado). */
  approach: ClipKey | null;
};

export type Plan = {
  kind: Kind; result: ShotResult; left: boolean;
  /** Segundos de animação por unidade de tempo da cena (lances de escanteio são mais longos). */
  animSec: number;
  /** Bola no momento do contato de quem finaliza. */
  S: THREE.Vector3;
  /** Ponto onde a bola cruza a linha do gol (ou a linha de fundo, se for pra fora). */
  aim: THREE.Vector3;
  /** Instante (0..1) do contato e do fim do voo. */
  TC: number; TE: number;
  segs: Seg[];
  /** Rede balançando (gol): ponto e instante. */
  net?: { x: number; y: number; q: number };
  catches: boolean;
  shooter: Contact;
  /** Escanteio: quem bate e onde/quando. */
  taker?: Contact;
  corner?: { side: number; ballAt: THREE.Vector3; qKick: number };
  celebTo: THREE.Vector3;
  keeper: {
    mode: "reach" | "track";
    /** Clipe de mergulho/bloqueio/defesa (reach) ou deslocamento lateral (track). */
    clip: ClipKey | null;
    side: number; hipX: number; qReach: number;
    /** Ponto (lateral x, altura y) que as luvas devem alcançar. */
    target: { x: number; y: number };
  };
  defender?: { pos: THREE.Vector3; touch: THREE.Vector3; contactQ: number; contact: Contact };
  extras: Extra[];
  crossFrom?: THREE.Vector3;
  /** Pra fora: a bola vai por cima (true) ou pelo lado. */
  offHigh: boolean;
  /** Clipes de animação necessários para este lance (só eles são baixados). */
  clips: ClipKey[];
};

export type PlanInput = {
  goalX?: number; goalY?: number; originX: number; originY: number;
  team: "home" | "away"; result: ShotResult; penalty: boolean; header: boolean; left: boolean; seed: number; xg?: number | null;
  /** Lance veio de escanteio: mostra a batida, o cruzamento e só então a finalização. */
  corner?: boolean;
};

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

const yawTo = (from: THREE.Vector3, to: THREE.Vector3) => Math.atan2(to.x - from.x, to.z - from.z);

export function buildPlan(o: PlanInput): Plan {
  const penalty = o.penalty;
  const corner = !!o.corner && !penalty;
  const kind: Kind = penalty ? "penalty" : o.header ? "header" : "open";
  let result = o.result;
  if (penalty && result === "blocked") result = "saved";
  if (penalty && result === "own_goal") result = "goal";

  const h1 = hash(o.originX, o.originY);
  const h2 = hash(o.originY + 3.7, o.originX + 1.9);
  const h3 = hash(o.seed, 5.1);
  const h4 = hash(o.seed + 2.3, o.originX * 0.37);
  const sgnHome = o.team === "home" ? 1 : -1;
  const animSec = corner ? ANIM_SEC_CORNER : ANIM_SEC_OPEN;

  const metersToGoal = (o.team === "home" ? 100 - o.originX : o.originX) * 1.05;
  let dist = PENALTY_DIST;
  let lateral = 0;
  if (kind === "open") {
    dist = clamp(metersToGoal * 0.6 + 2.5, 6, 22);
    lateral = clamp((o.originY - 50) * 0.5 * sgnHome, -13, 13);
  } else if (kind === "header") {
    dist = clamp(metersToGoal * 0.45 + 2.5, 4.5, 10);
    lateral = clamp((o.originY - 50) * 0.3 * sgnHome, -5, 5);
  }
  if (corner) { dist = clamp(dist, 5, 14); lateral = clamp(lateral, -9, 9); }

  /* ------------------------------------------------ quem finaliza: clipe, pé e corrida */
  const foot: "L" | "R" = o.left ? "L" : "R";
  const sideSgn = lateral >= 0 ? 1 : -1;
  const mirrorFor = (clipFoot: "L" | "R"): 1 | -1 => (foot === clipFoot ? 1 : -1);
  let clip: ContactKey;
  let mirror: 1 | -1 = 1;
  let wantsApproach = true;
  if (penalty) { clip = "penalty_kick"; mirror = mirrorFor("R"); wantsApproach = false; }
  else if (kind === "header") {
    clip = (corner ? h3 < 0.6 : h3 < 0.5) ? "anim_header" : "header_1";
    mirror = h2 < 0.5 ? 1 : -1; wantsApproach = false;
  } else if (dist < 8 && !corner) { clip = foot === "L" ? "kick_1" : "kick_2"; }
  else if (corner && dist < 7) { clip = foot === "L" ? "kick_1" : "kick_2"; }
  else if (corner && h3 < 0.5) { clip = "scissor_kick"; mirror = mirrorFor("R"); wantsApproach = false; }
  else { clip = "kick_jog"; mirror = mirrorFor("R"); }

  const S = v3(penalty ? 0 : lateral, CONTACT_CLIPS[clip].ball[1], GL + dist);

  /* ------------------------------------------------ alvo no plano do gol */
  const hasLoc = o.goalX != null && o.goalY != null;
  const gx = hasLoc ? clamp(o.goalX as number, 0.06, 0.94) : penalty ? (h1 < 0.5 ? 0.17 : 0.83) : 0.5 + (h1 - 0.5) * 0.7;
  const gy = hasLoc ? clamp(o.goalY as number, 0.1, 0.92) : penalty ? 0.35 + h2 * 0.3 : 0.45 + (h2 - 0.5) * 0.5;
  const tx = (gx - 0.5) * GOAL_W * 0.82;
  const ty = GOAL_H * (1 - gy) * 0.8 + 0.23;

  /* ------------------------------------------------ linha do tempo */
  const qKc = 0.26;                                            // contato de quem bate o escanteio
  const cs = corner ? ((Math.abs(S.x) > 3 ? -Math.sign(S.x) : (h1 < 0.5 ? -1 : 1)) as 1 | -1) : 1;
  const ballCorner = v3(cs * 33.55, BALL_R, GL + 0.45);
  const crossSec = corner ? clamp(ballCorner.distanceTo(S) / 21, 1.25, 1.9) : 0;
  const TC = corner ? qKc + crossSec / animSec : penalty ? 0.43 : kind === "header" ? 0.36 : 0.38;
  let FL = penalty ? 0.11 : kind === "header" ? 0.14 : clamp(0.085 + dist * 0.0045, 0.12, 0.2);
  const apexBase = penalty ? 0.12 : kind === "header" ? 0.05 : clamp(0.18 + dist * 0.035, 0.25, 1.3);
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
  const clipSet = new Set<ClipKey>(["idle_offensive", "gk_idle_1", "anim_run", "anim_celebrate", "anim_lamento"]);

  const centerDir = new THREE.Vector3(-S.x, 0, GL - S.z).normalize();
  const side0 = S.x >= 0 ? 1 : -1;

  /** Defensor que domina/bloqueia a bola com o pé (clipes de carrinho). */
  const makeDefender = (pos: THREE.Vector3, touch: THREE.Vector3, contactQ: number): NonNullable<Plan["defender"]> => {
    const dclip: ContactKey = h4 < 0.5 ? "tackle_3" : "tackle_1";
    clipSet.add(dclip);
    return { pos, touch, contactQ, contact: { clip: dclip, mirror: 1, contactQ, ball: touch.clone(), yaw: yawTo(touch, S), approach: null } };
  };
  const reachKeeper = (target: { x: number; y: number }, clipChoice: ClipKey, qReach: number): Plan["keeper"] => {
    clipSet.add(clipChoice);
    return { mode: "reach", clip: clipChoice, side: Math.sign(target.x) || dirDefault, hipX: 0, qReach, target };
  };
  const diveClip = (x: number): ClipKey => (x >= 0 ? "gk_dive_1" : "gk_dive_2");
  const trackKeeper = (hipX: number): Plan["keeper"] => {
    const sc: ClipKey = hipX >= 0 ? "gk_sidestep_1" : "gk_sidestep_2";
    clipSet.add(sc);
    return { mode: "track", clip: sc, side: Math.sign(hipX) || side0, hipX, qReach: TE, target: { x: hipX, y: 0 } };
  };

  if (result === "goal") {
    segs.push(seg(TC, TE, S, aim, apexBase, "out", curl));
    const N = netSegs(segs, aim, TE, S);
    net = { x: N.x, y: N.y, q: TE };
    const wrongWay = penalty && h3 < 0.35;
    const target = wrongWay
      ? { x: -tx * 0.8, y: Math.max(0.6, ty * 0.7) }
      : { x: tx - dirDefault * 0.75, y: Math.max(0.5, ty - 0.35) };
    // bola alta e no meio: o goleiro pula e não alcança; senão mergulha curto
    const jumpMiss = !penalty && ty > 1.75 && Math.abs(tx) < 2.2 && h4 < 0.7;
    keeper = reachKeeper(jumpMiss ? { x: tx, y: ty } : target, jumpMiss ? "gk_miss" : diveClip(target.x), TE);
  } else if (result === "own_goal") {
    const Dp = v3(S.x * 0.45, 0, GL + 2.3);
    const T = v3(Dp.x, 0.22, Dp.z + 0.32);
    const side = Math.abs(T.x) < 0.3 ? (S.x > 0 ? 1 : -1) : -Math.sign(T.x);
    aim = v3(side * (1.5 + h1 * 1.3), 0.6 + h2 * 0.6, GL);
    const tTouch = TC + (TE - TC) * 0.6;
    segs.push(seg(TC, tTouch, S, T, 0.4, "out"));
    segs.push(seg(tTouch, TE, T, aim, 0.12, "out"));
    const N = netSegs(segs, aim, TE, T);
    net = { x: N.x, y: N.y, q: TE };
    defender = makeDefender(Dp, T, tTouch);
    keeper = reachKeeper({ x: -side * 2.1, y: 1.0 }, diveClip(-side), TE);
  } else if (result === "saved") {
    // bola alta/média perto do centro: agarra; bola rasteira de perto: bloqueia com o corpo; senão mergulha e espalma
    const highCatch = Math.abs(tx) < 1.1 && ty > 1.45 && h3 < 0.6 && !penalty;
    const lowCatch = !highCatch && Math.abs(tx) < 0.9 && ty < 0.8 && h3 < 0.5 && !penalty;
    const bodyBlock = !highCatch && !lowCatch && dist < 9 && ty < 0.9 && !penalty;
    let kClip: ClipKey; let ky = ty;
    if (highCatch) { kClip = ty > 1.8 ? "gk_catch_4" : "gk_catch_2"; ky = kClip === "gk_catch_4" ? 2.1 : 1.34; }
    else if (lowCatch) { kClip = "gk_catch_1"; ky = 0.56; }
    else if (bodyBlock) { kClip = dirDefault > 0 ? (h4 < 0.5 ? "gk_block_1" : "gk_block_3") : "gk_block_2"; }
    else kClip = diveClip(dirDefault);
    const K = v3(tx, ky, GL + (highCatch || lowCatch ? 0.4 : 0.55));
    aim = K.clone();
    segs.push(seg(TC, TE, S, K, apexBase, "out", curl));
    catches = highCatch || lowCatch;
    keeper = reachKeeper({ x: tx, y: ky }, kClip, TE);
    if (!catches) {
      if (ty > 1.95) {
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
    const B = v3(Dp.x, 0.22, Dp.z + 0.3);
    const side = h1 < 0.5 ? -1 : 1;
    const D = v3(B.x + side * (2.6 + h1 * 1.6), BALL_R, B.z + 1.8 + h1);
    const D2 = v3(D.x + side * 1.0, BALL_R, D.z + 1.1);
    aim = B.clone();
    segs.push(seg(TC, TE, S, B, 0.2, "out"));
    segs.push(seg(TE, TE + 0.18, B, D, 1.0, "outq"));
    segs.push(seg(TE + 0.18, TE + 0.3, D, D2, 0.2, "out"));
    defender = makeDefender(Dp, B, TE);
    keeper = trackKeeper(clamp(Dp.x * 0.25, -1.2, 1.2));
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
    keeper = trackKeeper(clamp(cross.x * 0.3, -1.3, 1.3));
  }

  /* ------------------------------------------------ finalizador: orientação e corrida */
  const yaw = yawTo(S, aim);
  let approach: ClipKey | null = null;
  if (wantsApproach) {
    const wide = Math.abs(S.x) > 3.5;
    if (h2 < (wide ? 0.85 : 0.35)) {
      // corre na diagonal, vindo de fora para dentro
      const want = -(sideSgn);
      approach = want * (mirror * Math.cos(yaw)) > 0 ? "jog_fwd_diag_2" : "jog_fwd_diag_1";
    } else approach = "jog_fwd";
  }
  const shooter: Contact = { clip, mirror, contactQ: TC, ball: S.clone(), yaw, approach };
  clipSet.add(clip); if (approach) clipSet.add(approach);

  /* ------------------------------------------------ bola chegando: cruzamento (cabeceio) ou escanteio */
  let crossFrom: THREE.Vector3 | undefined;
  let taker: Contact | undefined;
  let cornerInfo: Plan["corner"];
  if (corner) {
    const takerClip: ContactKey = h2 < 0.5 ? "kick_1" : "kick_2";
    taker = { clip: takerClip, mirror: 1, contactQ: qKc, ball: ballCorner.clone(), yaw: yawTo(ballCorner, S), approach: "jog_fwd" };
    clipSet.add(takerClip); clipSet.add("jog_fwd");
    cornerInfo = { side: cs, ballAt: ballCorner, qKick: qKc };
    const airborne = S.y > 0.5;                      // cabeceio ou voleio: a bola chega no alto
    const bend = -cs * 1.3;                          // efeito do cruzamento
    if (airborne) segs.unshift(seg(qKc, TC, ballCorner, S, 7, "lin", bend));
    else {
      const back = new THREE.Vector3(ballCorner.x - S.x, 0, ballCorner.z - S.z).normalize();
      const P1 = v3(S.x + back.x * 1.5, BALL_R, S.z + back.z * 1.5);
      segs.unshift(seg(TC - 0.035, TC, P1, S, 0.3, "lin"));
      segs.unshift(seg(qKc, TC - 0.035, ballCorner, P1, 6.5, "lin", bend));
    }
  } else if (kind === "header") {
    crossFrom = v3(clamp(S.x * 1.6 + (S.x >= 0 ? 4 : -4), -16, 16), 0.5, S.z + 4.8);
    segs.unshift(seg(TC - 0.22, TC, crossFrom, S, 2.7, "lin"));
  }

  // comemoração: corre para o lado, perto da lateral/escanteio
  const cel = S.x >= 0 ? 1 : -1;
  const celebTo = v3(cel * clamp(Math.abs(S.x) + 5, 8, 14), 0, GL + (S.z - GL) * 0.55);

  /* ------------------------------------------------ elenco de apoio (parado, olhando a jogada) */
  const lane = (z: number) => S.x * (z - GL) / Math.max(1, S.z - GL);
  const extras: Extra[] = [];
  if (penalty) {
    [-9, -3.4, 3.4, 9].forEach((x, i) => extras.push({ pos: v3(x, 0, GL + 17.6 + (i % 2) * 0.7), yaw: 0, own: i % 2 === 0, seed: i + 1 }));
  } else {
    const place = (x: number, z: number, own: boolean, seed: number) => {
      const lx = lane(z);
      let px = x;
      if (Math.abs(px - lx) < 2.8) px = lx + (px >= lx ? 2.8 : -2.8);
      extras.push({ pos: v3(clamp(px, -13, 13), 0, z), yaw: 0, own, seed });
    };
    place(S.x * 0.5 + (S.x >= 0 ? -5 : 5), GL + 4.6, false, 1);
    place(S.x * 0.5 + (S.x >= 0 ? 5 : -5), GL + 6.6, false, 2);
    place(-S.x * 0.2 + (S.x >= 0 ? -7 : 7), GL + 7.6, true, 3);
    place(S.x * 0.2 + (S.x >= 0 ? 8.5 : -8.5), GL + 11.5, false, 4);
  }

  if (keeper.clip) clipSet.add(keeper.clip);
  return {
    kind, result, left: o.left, animSec, S, aim, TC, TE, segs, net, catches,
    shooter, taker, corner: cornerInfo, celebTo, keeper, defender, extras, crossFrom, offHigh,
    clips: Array.from(clipSet),
  };
}
