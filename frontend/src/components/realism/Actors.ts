import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { clamp } from "./common";
import { CLIP_KEYS, MODEL_META, type ClipKey } from "./modelMeta";
import { makeBackTexture } from "./Rig";

/** Clipe pronto para uso: sem deslocamento do quadril (ficamos no lugar) e com o caminho de raiz guardado. */
export type PreparedClip = {
  clip: THREE.AnimationClip;
  dur: number;
  rootT: Float32Array;
  /** Deslocamento lateral (+X do modelo) e para a frente (+Z do modelo) do quadril, em metros, relativo ao início. */
  rootX: Float32Array;
  rootZ: Float32Array;
};

export type Assets = {
  scene: THREE.Object3D;
  clips: Record<ClipKey, PreparedClip>;
  mask: THREE.Texture;
};

/**
 * Remove o deslocamento horizontal do quadril do clipe (para o jogador ficar no lugar) e devolve esse
 * deslocamento separado. O Blender exporta o quadril em cm, com Y = frente e X = lateral.
 * `mode`: "first" fixa no 1º frame; "mean" fixa na média (bom para clipes de espera, que balançam).
 */
export function prepareClip(src: THREE.AnimationClip, mode: "first" | "mean"): PreparedClip {
  const clip = src.clone();
  const track = clip.tracks.find((t) => /Hips\.position$/.test(t.name));
  const n = track ? track.times.length : 0;
  const rootT = new Float32Array(n);
  const rootX = new Float32Array(n);
  const rootZ = new Float32Array(n);
  if (track) {
    const v = track.values as Float32Array;
    let mx = v[0], my = v[1];
    if (mode === "mean") {
      mx = 0; my = 0;
      for (let i = 0; i < n; i++) { mx += v[i * 3]; my += v[i * 3 + 1]; }
      mx /= n; my /= n;
    }
    const x0 = v[0], y0 = v[1];
    for (let i = 0; i < n; i++) {
      rootT[i] = track.times[i];
      rootX[i] = (v[i * 3] - x0) * 0.01;
      rootZ[i] = (v[i * 3 + 1] - y0) * 0.01;
      v[i * 3] = mx;
      v[i * 3 + 1] = my;
    }
  }
  return { clip, dur: clip.duration, rootT, rootX, rootZ };
}

/** Deslocamento de raiz do clipe no instante t (interpolado). */
export function sampleRoot(pc: PreparedClip, t: number, out: { x: number; z: number }) {
  const n = pc.rootT.length;
  if (n === 0) { out.x = 0; out.z = 0; return out; }
  const tt = clamp(t, pc.rootT[0], pc.rootT[n - 1]);
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pc.rootT[mid] <= tt) lo = mid; else hi = mid; }
  const span = pc.rootT[hi] - pc.rootT[lo];
  const u = span > 0 ? (tt - pc.rootT[lo]) / span : 0;
  out.x = pc.rootX[lo] + (pc.rootX[hi] - pc.rootX[lo]) * u;
  out.z = pc.rootZ[lo] + (pc.rootZ[hi] - pc.rootZ[lo]) * u;
  return out;
}

const MODE: Record<ClipKey, "first" | "mean"> = {
  idle: "mean", run: "first", kick: "first", header: "first", celebrate: "mean", lamento: "mean",
  gkIdle: "mean", gkDive: "first", gkCatch: "first",
};

export function buildAssets(player: { scene: THREE.Object3D }, clipFiles: { animations: THREE.AnimationClip[] }[], mask: THREE.Texture): Assets {
  const clips = {} as Record<ClipKey, PreparedClip>;
  CLIP_KEYS.forEach((k, i) => { clips[k] = prepareClip(clipFiles[i].animations[0], MODE[k]); });
  mask.flipY = false;                       // convenção do glTF: v = 0 no topo
  mask.colorSpace = THREE.NoColorSpace;
  mask.needsUpdate = true;
  return { scene: player.scene, clips, mask };
}

export type KitColors = { shirt: string; shorts: string; socks: string };
export type ClipEntry = { key: ClipKey; time: number; weight: number };

/** Um jogador: modelo 3D com esqueleto, uniforme tingido, número nas costas e mixer de animação. */
export class Actor {
  /** Posição no campo e giro (yaw). */
  readonly outer = new THREE.Group();
  /** Espelho esquerda/direita (escala X = ±1). */
  readonly mirror = new THREE.Group();
  readonly model: THREE.Object3D;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<ClipKey, THREE.AnimationAction>();
  private readonly handL: THREE.Object3D | null;
  private readonly handR: THREE.Object3D | null;
  private readonly owned: { dispose(): void }[] = [];
  private readonly decal: THREE.Mesh | null = null;
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();

  constructor(assets: Assets, kit: KitColors, opts: { number?: number; name?: string; cast?: boolean } = {}) {
    this.model = cloneSkinned(assets.scene);
    const uniforms = {
      uKitMask: { value: assets.mask },
      uShirt: { value: new THREE.Color(kit.shirt) },
      uShorts: { value: new THREE.Color(kit.shorts) },
      uSocks: { value: new THREE.Color(kit.socks) },
    };
    const cache = new Map<THREE.Material, THREE.Material>();
    this.model.traverse((o) => {
      if (o.name === "Cube") { o.visible = false; return; }           // sobra do export do Blender
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      mesh.frustumCulled = false;                                     // o corpo sai da caixa do pose de bind (T-pose)
      mesh.castShadow = !!opts.cast;
      mesh.receiveShadow = false;
      const src = mesh.material as THREE.MeshStandardMaterial;
      let mat: THREE.Material | undefined = cache.get(src);
      if (!mat) {
        const created: THREE.Material = this.makeMaterial(src, uniforms);
        cache.set(src, created);
        this.owned.push(created);
        mat = created;
      }
      mesh.material = mat;
    });

    this.mirror.add(this.model);
    this.outer.add(this.mirror);

    // número e nome nas costas, presos ao osso da coluna
    const spine = this.find(MODEL_META.decal.bone);
    if (spine && (opts.number != null || opts.name)) {
      const tex = makeBackTexture(opts.name, opts.number, kit.shirt);
      if (tex) {
        const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
        plane.position.set(...MODEL_META.decal.position);
        plane.quaternion.set(...MODEL_META.decal.quaternion);
        plane.scale.set(MODEL_META.decal.size, MODEL_META.decal.size, 1);
        plane.renderOrder = 2;
        spine.add(plane);
        this.decal = plane;
        this.owned.push(tex, mat, plane.geometry);
      }
    }

    this.handL = this.find("LeftHand");
    this.handR = this.find("RightHand");

    this.mixer = new THREE.AnimationMixer(this.model);
    for (const k of CLIP_KEYS) {
      const a = this.mixer.clipAction(assets.clips[k].clip);
      a.play();
      a.paused = true;
      a.setEffectiveWeight(0);
      this.actions.set(k, a);
    }
  }

  /** Acha um osso pelo nome (o Mixamo usa o prefixo mixamorig e o three remove os “:”). */
  private find(suffix: string) {
    let found: THREE.Object3D | null = null;
    this.model.traverse((o) => { if (!found && o.name.endsWith(suffix) && o.name.includes("mixamorig")) found = o; });
    return found as THREE.Object3D | null;
  }

  private makeMaterial(src: THREE.MeshStandardMaterial, u: Record<string, { value: unknown }>) {
    const mat = src.clone();
    if (/hair/i.test(src.name)) {
      mat.transparent = false; mat.alphaTest = 0.4; mat.depthWrite = true; mat.side = THREE.DoubleSide;
      return mat;
    }
    mat.roughness = 0.78; mat.metalness = 0;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform sampler2D uKitMask;\nuniform vec3 uShirt;\nuniform vec3 uShorts;\nuniform vec3 uSocks;")
        .replace("#include <map_fragment>", `#include <map_fragment>
        {
          vec3 kitMask = texture2D( uKitMask, vMapUv ).rgb;
          float lum = clamp( dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) ) * 1.12, 0.0, 1.0 );
          vec3 tinted = diffuseColor.rgb;
          tinted = mix( tinted, uShirt * lum, kitMask.r );
          tinted = mix( tinted, uShorts * lum, kitMask.g );
          tinted = mix( tinted, uSocks * lum, kitMask.b );
          diffuseColor.rgb = tinted;
        }`);
    };
    mat.customProgramCacheKey = () => "scoutvision-kit-tint-v1";
    return mat;
  }

  place(x: number, y: number, z: number, yaw: number, mirror = 1) {
    this.outer.position.set(x, y, z);
    this.outer.rotation.y = yaw;
    this.mirror.scale.x = mirror;
    if (this.decal) this.decal.scale.x = Math.abs(this.decal.scale.x) * mirror;     // o número não pode sair espelhado
  }

  /** Aplica a pose: mistura os clipes (pesos normalizados) em tempos explícitos. */
  pose(entries: ClipEntry[], assets: Assets) {
    let sum = 0;
    for (const e of entries) sum += e.weight;
    const used = new Set<ClipKey>();
    if (sum > 1e-6) {
      for (const e of entries) {
        if (e.weight <= 1e-4) continue;
        const a = this.actions.get(e.key);
        if (!a) continue;
        a.time = clamp(e.time, 0, assets.clips[e.key].dur - 1e-3);
        a.setEffectiveWeight(e.weight / sum);
        used.add(e.key);
      }
    }
    for (const [k, a] of this.actions) if (!used.has(k)) a.setEffectiveWeight(0);
    this.mixer.update(0);
  }

  /** Ponto entre as duas luvas (um pouco à frente), em coordenadas do mundo. */
  handsMid(out: THREE.Vector3) {
    this.outer.updateMatrixWorld(true);
    if (!this.handL || !this.handR) return out.copy(this.outer.position);
    this.handL.getWorldPosition(this.tmpA);
    this.handR.getWorldPosition(this.tmpB);
    out.copy(this.tmpA).add(this.tmpB).multiplyScalar(0.5);
    const yaw = this.outer.rotation.y;
    out.x += Math.sin(yaw) * 0.09; out.z += Math.cos(yaw) * 0.09; out.y += 0.03;
    return out;
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    this.owned.forEach((o) => o.dispose());
  }
}
