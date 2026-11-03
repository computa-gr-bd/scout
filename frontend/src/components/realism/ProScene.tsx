import { memo, useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { Actor, buildAssets, sampleRoot, type Assets, type KitColors } from "./Actors";
import { choreoDefender, choreoExtra, choreoKeeper, choreoKicker, newChoreo, type Choreo, type ClipTable } from "./choreo";
import { CLIP_KEYS, MODEL_URLS } from "./modelMeta";
import type { Plan } from "./plan";
import { BallWithTrail, Env, useBallAndCamera, type CamMode } from "./shared";

const clipUrls = CLIP_KEYS.map((k) => MODEL_URLS.clips[k]);

/** Começa a baixar os modelos antes do replay (chamado quando o modo Realismo é escolhido). */
export function preloadRealisticModels() {
  useGLTF.preload(MODEL_URLS.player);
  useGLTF.preload(clipUrls);
}

function useModelAssets(): Assets {
  const player = useGLTF(MODEL_URLS.player);
  const files = useGLTF(clipUrls) as unknown as { animations: THREE.AnimationClip[] }[];
  const mask = useLoader(THREE.TextureLoader, MODEL_URLS.mask);
  return useMemo(() => buildAssets(player, files, mask), [player, files, mask]);
}

const KEEPER: KitColors = { shirt: "#f59e0b", shorts: "#111827", socks: "#111827" };

/** Cena com os modelos reais (Mixamo): jogadores com esqueleto, animações de captura de movimento. */
export const ProScene = memo(function ProScene({ plan, qRef, teamColor, foeColor, camMode, number, name }: {
  plan: Plan; qRef: MutableRefObject<number>; teamColor: string; foeColor: string; camMode: CamMode; number?: number; name?: string;
}) {
  const assets = useModelAssets();

  const table = useMemo<ClipTable>(() => {
    const t = {} as ClipTable;
    const o = { x: 0, z: 0 };
    for (const k of CLIP_KEYS) {
      const pc = assets.clips[k];
      sampleRoot(pc, pc.dur, o); const endZ = o.z;
      t[k] = { dur: pc.dur, stride: Math.max(0.01, endZ), sample: (time, out) => { sampleRoot(pc, time, o); out.x = o.x; out.z = o.z; } };
    }
    return t;
  }, [assets]);

  const actors = useMemo(() => {
    const kit = (shirt: string, shorts: string): KitColors => ({ shirt, shorts, socks: shirt });
    return {
      k: new Actor(assets, kit(teamColor, "#f8fafc"), { number, name, cast: true }),
      g: new Actor(assets, KEEPER, { cast: true }),
      d: plan.defender ? new Actor(assets, kit(foeColor, "#111827"), { cast: true }) : null,
      e: plan.extras.map((x) => new Actor(assets, x.own ? kit(teamColor, "#f8fafc") : kit(foeColor, "#111827"))),
    };
  }, [assets, plan, teamColor, foeColor, number, name]);

  useEffect(() => () => {
    actors.k.dispose(); actors.g.dispose(); actors.d?.dispose(); actors.e.forEach((a) => a.dispose());
  }, [actors]);

  const ch = useMemo<Choreo>(() => newChoreo(), []);
  const kPos = useRef(new THREE.Vector3());

  useFrame(() => {
    const q = qRef.current;
    const apply = (a: Actor, c: Choreo) => { a.place(c.x, c.y, c.z, c.yaw, c.mirror); a.pose(c.entries, assets); };
    choreoKicker(ch, q, plan, table); apply(actors.k, ch);
    kPos.current.set(ch.x, 0, ch.z);
    choreoKeeper(ch, q, plan, table); apply(actors.g, ch);
    if (actors.d) { choreoDefender(ch, q, plan, table); apply(actors.d, ch); }
    actors.e.forEach((a, i) => { choreoExtra(ch, q, plan, table, i); apply(a, ch); });
  });

  const getHold = useMemo(() => (out: THREE.Vector3) => { actors.g.handsMid(out); }, [actors]);
  const { ball, impact, excite } = useBallAndCamera({ plan, qRef, camMode, kPos, getHold });

  return (
    <>
      <Env impactRef={impact} exciteRef={excite} />
      <primitive object={actors.k.outer} />
      <primitive object={actors.g.outer} />
      {actors.d && <primitive object={actors.d.outer} />}
      {actors.e.map((a, i) => <primitive key={i} object={a.outer} />)}
      <BallWithTrail ballRef={ball} plan={plan} qRef={qRef} />
    </>
  );
});
