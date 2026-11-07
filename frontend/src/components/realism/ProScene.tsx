import { memo, useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { Actor, buildAssets, sampleRoot, type Assets, type KitColors } from "./Actors";
import { choreoDefender, choreoExtra, choreoKeeper, choreoKicker, choreoTaker, newChoreo, type Choreo, type ClipTable } from "./choreo";
import { CLIP_DUR } from "./clipCatalog";
import { COMMON_CLIPS, MODEL_URLS, clipUrl, type ClipKey } from "./modelMeta";
import type { Plan } from "./plan";
import { BallWithTrail, Env, useBallAndCamera, type CamMode } from "./shared";
import { preloadStadium } from "./StadiumModel";

/** Começa a baixar o essencial antes do replay (chamado quando o modo 3D é escolhido). As demais animações vêm por lance. */
export function preloadRealisticModels() {
  useGLTF.preload(MODEL_URLS.player);
  useGLTF.preload(MODEL_URLS.ball);
  useGLTF.preload(COMMON_CLIPS.map(clipUrl));
  preloadStadium();
}

const KEEPER: KitColors = { shirt: "#f59e0b", shorts: "#111827", socks: "#111827" };

/** Cena com os modelos reais (Mixamo): jogadores com esqueleto e animações de captura de movimento. */
export const ProScene = memo(function ProScene({ plan, qRef, teamColor, foeColor, ownKit, foeKit, camMode, number, name, onReady }: {
  plan: Plan; qRef: MutableRefObject<number>; teamColor: string; foeColor: string;
  /** Uniformes completos (camisa, calção, meia). Sem eles, usa só `teamColor`/`foeColor`. */
  ownKit?: KitColors; foeKit?: KitColors;
  camMode: CamMode; number?: number; name?: string;
  onReady?: () => void;
}) {
  const urls = useMemo(() => plan.clips.map(clipUrl), [plan]);
  // pede tudo de uma vez (em paralelo) antes de esperar por qualquer arquivo
  useGLTF.preload(MODEL_URLS.player); useGLTF.preload(MODEL_URLS.ball); useGLTF.preload(urls); preloadStadium();
  useLoader.preload(THREE.TextureLoader, MODEL_URLS.mask);
  const player = useGLTF(MODEL_URLS.player);
  const ballGltf = useGLTF(MODEL_URLS.ball);
  const files = useGLTF(urls) as unknown as { animations: THREE.AnimationClip[] }[];
  const mask = useLoader(THREE.TextureLoader, MODEL_URLS.mask);
  const assets: Assets = useMemo(() => buildAssets(player, plan.clips, files, mask), [player, plan, files, mask]);

  const table = useMemo<ClipTable>(() => {
    const t: ClipTable = {};
    const o = { x: 0, z: 0 };
    for (const k of Object.keys(assets.clips) as ClipKey[]) {
      const pc = assets.clips[k]!;
      sampleRoot(pc, pc.dur, o);
      const endX = o.x, endZ = o.z;
      t[k] = {
        dur: pc.dur || CLIP_DUR[k], vx: endX / Math.max(0.1, pc.dur), vz: endZ / Math.max(0.1, pc.dur),
        sample: (time, out) => { sampleRoot(pc, time, o); out.x = o.x; out.z = o.z; },
      };
    }
    return t;
  }, [assets]);

  const actors = useMemo(() => {
    const legacy = (shirt: string, shorts: string): KitColors => ({ shirt, shorts, socks: shirt });
    const own = ownKit ?? legacy(teamColor, "#f8fafc");
    const foe = foeKit ?? legacy(foeColor, "#111827");
    return {
      k: new Actor(assets, own, { number, name, cast: true }),
      t: plan.taker ? new Actor(assets, own, { cast: true }) : null,
      g: new Actor(assets, KEEPER, { cast: true }),                    // goleiro: uniforme padrão, igual para todos
      d: plan.defender ? new Actor(assets, foe, { cast: true }) : null,
      e: plan.extras.map((x) => new Actor(assets, x.own ? own : foe, { clips: ["idle_offensive"] })),
    };
  }, [assets, plan, teamColor, foeColor, ownKit, foeKit, number, name]);

  useEffect(() => () => {
    actors.k.dispose(); actors.t?.dispose(); actors.g.dispose(); actors.d?.dispose(); actors.e.forEach((a) => a.dispose());
  }, [actors]);

  // só avisa que está pronto depois que tudo (modelos, animações, estádio) foi baixado e montado
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  useEffect(() => { readyRef.current?.(); }, [actors]);

  const ch = useMemo<Choreo>(() => newChoreo(), []);
  const kPos = useRef(new THREE.Vector3());
  const frameN = useRef(0);

  useFrame(() => {
    const q = qRef.current;
    const apply = (a: Actor, c: Choreo) => { a.place(c.x, c.y, c.z, c.yaw, c.mirror); a.pose(c.entries, assets); };
    choreoKicker(ch, q, plan, table); apply(actors.k, ch);
    kPos.current.set(ch.x, 0, ch.z);
    if (actors.t) { choreoTaker(ch, q, plan, table); apply(actors.t, ch); }
    choreoKeeper(ch, q, plan, table); apply(actors.g, ch);
    if (actors.d) { choreoDefender(ch, q, plan, table); apply(actors.d, ch); }
    // figurantes só mexem em ritmo de espera: metade dos frames basta (e poupa o esqueleto de cada um)
    if ((frameN.current++ & 1) === 0) actors.e.forEach((a, i) => { choreoExtra(ch, q, plan, table, i); apply(a, ch); });
  });

  const getHold = useMemo(() => (out: THREE.Vector3) => { actors.g.handsMid(out); }, [actors]);
  const { ball, impact, excite } = useBallAndCamera({ plan, qRef, camMode, kPos, getHold });

  return (
    <>
      <Env impactRef={impact} exciteRef={excite} />
      <primitive object={actors.k.outer} />
      {actors.t && <primitive object={actors.t.outer} />}
      <primitive object={actors.g.outer} />
      {actors.d && <primitive object={actors.d.outer} />}
      {actors.e.map((a, i) => <primitive key={i} object={a.outer} />)}
      <BallWithTrail ballRef={ball} plan={plan} qRef={qRef} model={ballGltf.scene} />
    </>
  );
});
