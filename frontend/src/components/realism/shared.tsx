import { useEffect, useMemo, useRef, type MutableRefObject, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { BALL_R, GL, lerp, smooth, v3 } from "./common";
import { ballAt, type Plan } from "./plan";
import type { NetImpact } from "./Stadium";
import { StadiumModel } from "./StadiumModel";

export type CamMode = "auto" | "back" | "side" | "goal" | "air";

/* ------------------------------ Bola -------------------------------------- */
/** Bola 3D (modelo GLB): centralizada e escalada para o raio BALL_R (um pouco maior que a real, para ler melhor). */
export function SoccerBall({ model }: { model: THREE.Object3D }) {
  const ball = useMemo(() => {
    const clone = model.clone(true);
    const box = new THREE.Box3().setFromObject(clone);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    clone.position.sub(center);
    clone.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = false; } });
    const pivot = new THREE.Group();
    pivot.scale.setScalar((2 * BALL_R) / Math.max(size.x, size.y, size.z, 1e-6));
    pivot.add(clone);
    return pivot;
  }, [model]);
  return <primitive object={ball} />;
}

const TRAIL_N = 16;
export function BallTrail({ ballRef, plan, qRef }: { ballRef: RefObject<THREE.Group>; plan: Plan; qRef: MutableRefObject<number> }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const hist = useRef<THREE.Vector3[]>(Array.from({ length: TRAIL_N }, () => new THREE.Vector3()));
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const lastQ = useRef(-1);
  useFrame(() => {
    const m = mesh.current, b = ballRef.current;
    if (!m || !b) return;
    const q = qRef.current;
    const active = q > plan.TC && q < plan.TE + 0.1;
    if (Math.abs(q - lastQ.current) > 1e-5) {
      lastQ.current = q;
      const h = hist.current;
      const last = h.pop() as THREE.Vector3;
      last.copy(b.position);
      h.unshift(last);
    }
    for (let i = 0; i < TRAIL_N; i++) {
      const f = 1 - i / TRAIL_N;
      dummy.position.copy(hist.current[i]);
      dummy.scale.setScalar(active ? BALL_R * 0.9 * f : 0.0001);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, TRAIL_N]} frustumCulled={false}>
      <sphereGeometry args={[1, 8, 6]} />
      <meshBasicMaterial color="#e8f6ff" transparent opacity={0.22} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </instancedMesh>
  );
}

/* ------------------------------ Câmera ------------------------------------ */
export type CamShot = { pos: THREE.Vector3; look: THREE.Vector3; fov: number; key: number; k: number };

export function directCamera(mode: CamMode, q: number, plan: Plan, kPos: THREE.Vector3, ball: THREE.Vector3, out: CamShot) {
  const { S, TC, TE, aim } = plan;
  const sx = S.x >= 0 ? 1 : -1;
  const mid = (S.z + GL) / 2;

  if (mode === "back") {
    out.pos.set(S.x * 0.55, 2.6, S.z + 5.8); out.look.set(S.x * 0.2, 1.05, GL - 1); out.fov = 44; out.key = 100; out.k = 3; return;
  }
  if (mode === "side") {
    out.pos.set(sx * -17, 3.8, mid + 1); out.look.set(lerp(S.x, aim.x, 0.4) * 0.6, 1.0, mid - 0.5); out.fov = 36; out.key = 101; out.k = 3; return;
  }
  if (mode === "goal") {
    out.pos.set(aim.x * 0.25, 1.15, GL - 3.4); out.look.set(S.x * 0.5, 1.3, S.z - 3); out.fov = 46; out.key = 102; out.k = 3; return;
  }
  if (mode === "air") {
    out.pos.set(S.x * 0.3 + 5, 15, mid + 10); out.look.set(0, 0.2, mid - 1); out.fov = 42; out.key = 103; out.k = 3; return;
  }

  // AUTO: direção de transmissão
  const b1 = TC - 0.045;
  const b2 = TC + 0.1;
  const b3 = Math.max(b2 + 0.01, TE - 0.02);
  const b4 = b3 + (plan.result === "goal" || plan.result === "own_goal" ? 0.24 : 0.17);
  const header = plan.kind === "header";

  const cr = plan.corner;
  if (cr && q < b1) {
    if (q < cr.qKick + 0.03) {
      // quem bate o escanteio, visto de dentro do campo, com a área ao fundo
      out.pos.set(cr.ballAt.x - cr.side * 6.5, 1.8, cr.ballAt.z + 5.5); out.look.set(cr.ballAt.x, 1.0, cr.ballAt.z - 0.5);
      out.fov = 40; out.key = 5; out.k = 3;
    } else {
      // o cruzamento: câmera alta e aberta, olhando a bola até a área
      out.pos.set(-cr.side * 6, 4.4, GL + 20); out.look.set(ball.x, ball.y + 0.8, ball.z);
      out.fov = 38; out.key = 6; out.k = 5;
    }
  } else if (q < b1) {
    // acompanha quem vai chutar
    const dolly = 1 - smooth(q / b1);
    if (plan.kind === "penalty") {
      out.pos.set(S.x + 1.3 - 0.4 * dolly, 1.5, S.z + 4.8 + dolly * 0.8); out.look.set(0, 1.05, GL + 1);
    } else if (header) {
      out.pos.set(S.x - 4.2, 1.9, S.z + 5.4 + dolly); out.look.set(S.x, 1.7, S.z - 1.5);
    } else {
      out.pos.set(kPos.x - 1.7 * sx, 1.35, kPos.z + 3.5 + dolly * 0.9); out.look.set(kPos.x * 0.8 + S.x * 0.2, 1.0, kPos.z - 3);
    }
    out.fov = 38; out.key = 0; out.k = 4;
  } else if (q < b2) {
    // close no pé (ou na cabeça), em câmera lenta
    const orbit = (q - b1) / (b2 - b1);
    const tgt = header ? S : v3(S.x, 0.35, S.z - 0.15);
    out.pos.set(tgt.x + (header ? 2.8 : 2.15) * sx * (1 - orbit * 0.25), header ? 1.7 : 0.75 + orbit * 0.25, tgt.z + 1.1 + orbit * 0.9);
    out.look.copy(tgt); out.look.x += -0.1 * sx; out.fov = header ? 34 : 30; out.key = 1; out.k = 9;
  } else if (q < b3) {
    // câmera segue a bola
    const dx = aim.x - S.x, dz = aim.z - S.z;
    const l = Math.hypot(dx, dz) || 1;
    out.pos.set(ball.x - (dx / l) * 3.1, ball.y + 1.15, ball.z - (dz / l) * 3.1);
    out.look.set(lerp(ball.x, aim.x, 0.4), Math.max(0.9, lerp(ball.y, aim.y, 0.5)), lerp(ball.z, GL, 0.5));
    out.fov = 42; out.key = 2; out.k = 6;
  } else if (q < b4) {
    // desfecho
    if (plan.result === "goal" || plan.result === "own_goal") {
      out.pos.set(aim.x * 0.3 + 2.8 * sx, 1.0, GL - 3.4); out.look.set(aim.x * 0.5, 1.15, GL + 2.5); out.fov = 46;
    } else if (plan.result === "saved") {
      out.pos.set(aim.x + sx * -7.5, 1.5, GL + 4.5); out.look.set(aim.x, 1.0, GL + 0.5); out.fov = 38;
    } else if (plan.result === "blocked") {
      const d = plan.defender;
      out.pos.set((d?.pos.x ?? aim.x) + 4.5 * sx, 1.4, (d?.pos.z ?? S.z) + 4.0); out.look.set(d?.touch.x ?? aim.x, 0.7, d?.touch.z ?? S.z); out.fov = 34;
    } else {
      out.pos.set(ball.x * 0.4 + 5 * sx, 1.8, GL + 6.5); out.look.set(lerp(ball.x, 0, 0.2), Math.max(0.8, ball.y * 0.8), lerp(ball.z, GL, 0.2)); out.fov = 40;
    }
    out.key = 3; out.k = 3.2;
  } else {
    // reação de quem chutou
    const goal = plan.result === "goal";
    if (goal) {
      const dir = new THREE.Vector3(plan.celebTo.x - kPos.x, 0, plan.celebTo.z - kPos.z);
      if (dir.lengthSq() < 0.04) dir.set(sx, 0, 0); else dir.normalize();
      out.pos.set(kPos.x + dir.x * 4.4, 1.35, kPos.z + dir.z * 4.4); out.look.set(kPos.x, 1.2, kPos.z); out.fov = 40;
    } else {
      out.pos.set(kPos.x + 1.5 * sx, 1.4, kPos.z - 4.0); out.look.set(kPos.x, 1.25, kPos.z); out.fov = 36;
    }
    out.key = 4; out.k = 2.6;
  }
}


/* ------------------------------ Cenário (luzes + estádio) ----------------- */
export function Env({ impactRef, exciteRef }: { impactRef: MutableRefObject<NetImpact>; exciteRef: MutableRefObject<number> }) {
  const sun = useRef<THREE.DirectionalLight>(null);
  const target = useMemo(() => { const o = new THREE.Object3D(); o.position.set(0, 0, 8); return o; }, []);
  useEffect(() => { sun.current?.shadow.camera.updateProjectionMatrix(); }, []);
  return (
    <>
      <color attach="background" args={["#060f1f"]} />
      <fog attach="fog" args={["#08142b", 120, 520]} />
      <ambientLight intensity={0.55} />
      <hemisphereLight args={["#bcd7ff", "#1c3b27", 0.8]} />
      <directionalLight
        ref={sun} target={target} position={[10, 26, 22]} intensity={2.4} color="#fff3dc" castShadow
        shadow-mapSize={[1024, 1024]} shadow-camera-left={-22} shadow-camera-right={22} shadow-camera-top={24} shadow-camera-bottom={-20}
        shadow-camera-near={1} shadow-camera-far={80} shadow-bias={-0.0005}
      />
      <primitive object={target} />
      <StadiumModel impactRef={impactRef} exciteRef={exciteRef} />
    </>
  );
}

/**
 * Bola (trajetória, giro, goleiro segurando), rede balançando, euforia da torcida e a câmera de transmissão.
 * Deve ser chamado DEPOIS do useFrame que posiciona os jogadores (a ordem dos hooks é a ordem de execução).
 */
export function useBallAndCamera({ plan, qRef, camMode, kPos, getHold }: {
  plan: Plan; qRef: MutableRefObject<number>; camMode: CamMode;
  /** Posição atual de quem chuta (para a câmera acompanhar). */
  kPos: MutableRefObject<THREE.Vector3>;
  /** Preenche `out` com o ponto onde o goleiro segura a bola. */
  getHold?: (out: THREE.Vector3) => void;
}) {
  const { camera } = useThree();
  const ball = useRef<THREE.Group>(null);
  const impact = useRef<NetImpact>({ x: 0, y: 1, amp: 0 });
  const excite = useRef(0);
  const tmp = useMemo(() => ({
    ball: new THREE.Vector3(), prev: new THREE.Vector3(), hand: new THREE.Vector3(), dv: new THREE.Vector3(),
    axis: new THREE.Vector3(), quat: new THREE.Quaternion(),
    shot: { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 40, key: -1, k: 4 } as CamShot,
    lookCur: new THREE.Vector3(0, 1, GL), lastKey: -999, lastQ: 0,
  }), []);

  useFrame((_, delta) => {
    const qq = qRef.current;
    const b = ball.current;
    if (b) {
      tmp.prev.copy(b.position);
      ballAt(plan, qq, tmp.ball);
      if (plan.catches && qq >= plan.TE && getHold) {
        getHold(tmp.hand);
        tmp.ball.lerp(tmp.hand, smooth((qq - plan.TE) / 0.07));
      }
      b.position.copy(tmp.ball);
      // giro coerente com o deslocamento (rolamento)
      tmp.dv.copy(tmp.ball).sub(tmp.prev);
      const dist = tmp.dv.length();
      if (dist > 1e-4 && dist < 2.5 && qq >= tmp.lastQ) {
        tmp.axis.set(tmp.dv.z, 0, -tmp.dv.x);
        if (tmp.axis.lengthSq() < 1e-8) tmp.axis.set(1, 0, 0);
        tmp.axis.normalize();
        tmp.quat.setFromAxisAngle(tmp.axis, dist / BALL_R);
        b.quaternion.premultiply(tmp.quat);
      }
      tmp.lastQ = qq;
    }

    // rede balançando
    if (plan.net) {
      const t = (qq - plan.net.q) / 0.22;
      const amp = t < 0 ? 0 : 0.55 * Math.exp(-3.6 * t) * (0.45 + 0.55 * Math.cos(11 * t));
      impact.current.x = plan.net.x; impact.current.y = plan.net.y; impact.current.amp = Math.max(0, amp);
    } else impact.current.amp = 0;

    // torcida
    const goal = plan.result === "goal" || plan.result === "own_goal";
    excite.current = goal ? smooth((qq - plan.TE) / 0.08) : plan.result === "saved" ? 0.35 * smooth((qq - plan.TE) / 0.1) : 0.1 + 0.2 * smooth((qq - plan.TE) / 0.1);

    // câmera
    const cam = camera as THREE.PerspectiveCamera;
    directCamera(camMode, qq, plan, kPos.current, tmp.ball, tmp.shot);
    const shot = tmp.shot;
    const key = shot.key + (camMode === "auto" ? 0 : 1000);
    const snap = key !== tmp.lastKey && (camMode !== "auto" || shot.key === 1 || shot.key === 3 || shot.key === 4 || shot.key === 5 || shot.key === 6 || tmp.lastKey === -999);
    const a = 1 - Math.exp(-shot.k * Math.min(delta, 0.05));
    if (snap || tmp.lastKey === -999) { cam.position.copy(shot.pos); tmp.lookCur.copy(shot.look); }
    else { cam.position.lerp(shot.pos, a); tmp.lookCur.lerp(shot.look, Math.min(1, a * 1.4)); }
    tmp.lastKey = key;
    const punch = Math.exp(-Math.pow((qq - plan.TC) / 0.03, 2)) * 2.5;
    const fov = shot.fov - punch;
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = lerp(cam.fov, fov, snap ? 1 : 0.2); cam.updateProjectionMatrix(); }
    cam.lookAt(tmp.lookCur);
  });

  return { ball, impact, excite };
}

export function BallWithTrail({ ballRef, plan, qRef, model }: { ballRef: RefObject<THREE.Group>; plan: Plan; qRef: MutableRefObject<number>; model: THREE.Object3D }) {
  return (
    <>
      <group ref={ballRef}>
        <SoccerBall model={model} />
      </group>
      <BallTrail ballRef={ballRef} plan={plan} qRef={qRef} />
    </>
  );
}
