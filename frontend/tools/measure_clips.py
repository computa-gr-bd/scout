#!/usr/bin/env python3
"""
Mede as animações do Mixamo (GLB) e gera o catálogo usado pelo replay "Realismo":
  - quando o pé/cabeça toca na bola e onde a bola fica em relação ao ponto de partida do clipe;
  - onde ficam as luvas do goleiro no ponto de maior alcance (mergulho, bloqueio, defesa).
Uso:  python3 tools/measure_clips.py <pasta_com_glb> [<pasta2> ...]  ->  src/components/realism/clipCatalog.ts
Espaço do modelo: +Z = frente, +X = lado esquerdo do personagem, metros. Requer: numpy.
"""
import json, struct, sys
from pathlib import Path
import numpy as np

OUT = Path("src/components/realism/clipCatalog.ts")
DIRS = [Path(p) for p in sys.argv[1:]] or [Path("public/models/anim")]

# ------------------------------------------------------------------ cinemática direta mínima
def read_glb(p):
    b = Path(p).read_bytes(); n, _ = struct.unpack("<I4s", b[12:20]); j = json.loads(b[20:20 + n]); return j, b[20 + n + 8:]
def acc(j, bl, i):
    a = j["accessors"][i]; bv = j["bufferViews"][a["bufferView"]]
    k = {"SCALAR": 1, "VEC3": 3, "VEC4": 4}[a["type"]]; dt = {5126: np.float32}[a["componentType"]]
    return np.frombuffer(bl, dtype=dt, count=a["count"] * k, offset=bv.get("byteOffset", 0) + a.get("byteOffset", 0)).reshape(a["count"], k).astype(float)
def qmat(q):
    x, y, z, w = q
    return np.array([[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)], [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)], [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]])
def slerp(a, b, t):
    d = float(np.dot(a, b))
    if d < 0: b = -b; d = -d
    if d > 0.9995: r = a + (b - a) * t; return r / np.linalg.norm(r)
    th = np.arccos(d); return (np.sin((1 - t) * th) * a + np.sin(t * th) * b) / np.sin(th)

class Clip:
    def __init__(s, path):
        s.j, s.bl = read_glb(path); j = s.j; s.nodes = j["nodes"]
        s.names = [n.get("name", "") for n in s.nodes]; s.parent = {}
        for i, n in enumerate(s.nodes):
            for c in n.get("children", []): s.parent[c] = i
        an = j["animations"][0]; s.tracks = {}
        for ch in an["channels"]:
            sm = an["samplers"][ch["sampler"]]
            s.tracks[(ch["target"]["node"], ch["target"]["path"])] = (acc(j, s.bl, sm["input"])[:, 0], acc(j, s.bl, sm["output"]))
        s.dur = float(max(t[0].max() for t in s.tracks.values()))
        s.ix = {}
        for i, nm in enumerate(s.names):
            if ":" in nm: s.ix[nm.split(":", 1)[1]] = i
    def local(s, i, t):
        n = s.nodes[i]; T = np.array(n.get("translation", [0, 0, 0]), float); R = np.array(n.get("rotation", [0, 0, 0, 1]), float); S = np.array(n.get("scale", [1, 1, 1]), float)
        for path in ("translation", "rotation", "scale"):
            tr = s.tracks.get((i, path))
            if tr is None: continue
            ts, vs = tr; tt = min(max(t, ts[0]), ts[-1])
            if len(ts) == 1: v = vs[0]
            else:
                k = min(max(np.searchsorted(ts, tt, side="right") - 1, 0), len(ts) - 2); u = (tt - ts[k]) / (ts[k + 1] - ts[k]) if ts[k + 1] > ts[k] else 0
                v = slerp(vs[k], vs[k + 1], u) if path == "rotation" else vs[k] + (vs[k + 1] - vs[k]) * u
            if path == "translation": T = v
            elif path == "rotation": R = v
            else: S = v
        M = np.eye(4); M[:3, :3] = qmat(R) @ np.diag(S); M[:3, 3] = T; return M
    def pos(s, t, bone):
        cache = {}
        def w(i):
            if i not in cache:
                m = s.local(i, t); p = s.parent.get(i); cache[i] = (w(p) @ m) if p is not None else m
            return cache[i]
        return w(s.ix[bone])[:3, 3]

# ------------------------------------------------------------------ o que medir em cada clipe
# contato com o pé: o pé que mais acelera; instante = 1 quadro antes do pico; bola = ponta do pé + 0,10 m à frente
FOOT_CONTACT = ["kick_jog", "kick_1", "kick_2", "penalty_kick", "scissor_kick", "tackle_1", "tackle_3"]
# cabeceio: instante escolhido a partir da curva da cabeça; bola = cabeça + (0, 0,12, 0,22)
HEAD_CONTACT = {"anim_header": 1.22, "header_1": 1.0}
# alcance das luvas do goleiro: instante de maior alcance (escolhido olhando a trajetória das mãos)
REACH = {"gk_dive_1": 1.0, "gk_dive_2": 1.0, "gk_block_1": 0.95, "gk_block_2": 1.0, "gk_block_3": 1.35,
         "gk_catch_1": 0.95, "gk_catch_2": 0.5, "gk_catch_4": 0.8, "gk_miss": 0.7}

def r2(v): return [round(float(x), 2) for x in v]

clips = {}
for d in DIRS:
    for f in sorted(d.glob("*.glb")):
        if f.stem in ("jogador", "bola", "stadium"): continue
        clips.setdefault(f.stem, Clip(f))
dur = {k: round(c.dur, 3) for k, c in sorted(clips.items())}

contact = {}
for k in FOOT_CONTACT:
    c = clips[k]; best = None
    for foot in ("RightToeBase", "LeftToeBase"):
        ts = np.arange(0, c.dur + 1e-6, 1 / 30); P = np.array([c.pos(t, foot) for t in ts]); v = np.linalg.norm(np.diff(P, axis=0), axis=1) * 30
        if best is None or v.max() > best[0]: best = (float(v.max()), foot, int(v.argmax()))
    _, foot, ip = best; tc = max(0.0, ip / 30 - 1 / 60)
    p = c.pos(tc, foot); d_ = c.pos(min(tc + 1 / 30, c.dur), foot) - c.pos(max(tc - 1 / 30, 0), foot); d_[1] = 0
    d_ = d_ / np.linalg.norm(d_) if np.linalg.norm(d_) > 1e-6 else np.array([0, 0, 1.0])
    ball = p + d_ * 0.10; ball[1] = 0.13 if p[1] < 0.3 else p[1]
    contact[k] = {"contact": round(tc, 3), "foot": foot[0], "ball": r2(ball), "dur": dur[k]}
for k, tc in HEAD_CONTACT.items():
    c = clips[k]; h = c.pos(tc, "Head"); ball = h + np.array([0, 0.12, 0.22])
    if k == "anim_header": ball = np.array([0.01, 1.95, 0.40])      # medido à mão no salto
    contact[k] = {"contact": tc, "foot": "H", "ball": r2(ball), "dur": dur[k]}

reach = {}
for k, t in REACH.items():
    c = clips[k]; h = c.pos(t, "Hips"); hands = (c.pos(t, "LeftHand") + c.pos(t, "RightHand")) / 2
    reach[k] = {"t": t, "hips": r2([h[0], h[2]]), "hand": r2(hands), "dur": dur[k]}

def fmt(v): return json.dumps(v, ensure_ascii=False)
ts = ["// GERADO por tools/measure_clips.py a partir das animações em public/models/anim. Não edite à mão.",
      "// Espaço do modelo: +Z = frente, +X = lado esquerdo do personagem, metros, relativo ao ponto de partida do clipe.", "",
      "export type ContactMeta = { contact: number; foot: \"L\" | \"R\" | \"H\"; ball: readonly [number, number, number]; dur: number };",
      "export type ReachMeta = { t: number; hips: readonly [number, number]; hand: readonly [number, number, number]; dur: number };", "",
      "/** Duração (s) de cada clipe disponível. */", f"export const CLIP_DUR = {fmt(dur)} as const;", "",
      "/** Chutes, cabeceios e carrinhos: instante do contato e centro da bola. */", f"export const CONTACT_CLIPS = {fmt(contact)} as const satisfies Record<string, ContactMeta>;", "",
      "/** Goleiro: alcance das luvas (hips = quadril em x/z; hand = ponto entre as luvas). */", f"export const REACH_CLIPS = {fmt(reach)} as const satisfies Record<string, ReachMeta>;", ""]
OUT.write_text("\n".join(ts), encoding="utf-8")
print("clipes:", len(dur), "| contato:", len(contact), "| alcance:", len(reach))
for k, v in contact.items(): print(f"  {k:13s} t={v['contact']:.2f} {v['foot']} bola={v['ball']}")
for k, v in reach.items(): print(f"  {k:11s} t={v['t']:.2f} quadril={v['hips']} luvas={v['hand']}")
