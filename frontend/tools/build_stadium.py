#!/usr/bin/env python3
"""
Converte o estádio do Sketchfab (arena Euro 2020, 60 MB / 1,1 M triângulos) em um GLB leve para o
replay "Realismo" (~3 MB / ~100 mil triângulos).

Uso:  python3 tools/build_stadium.py <stadium.glb> [<saida>=public/models]

O que faz
 - Escala o modelo para metros reais: o eixo longo (Z) fica com 105 m entre as linhas de fundo e o eixo X
   com 68 m entre as laterais; a linha do gol do lado -Z vai para z = GL (-1,35), como no código do app.
 - Reduz o gol (o do modelo é ~30% maior) para 7,32 x 2,44 m e separa a rede em uma malha própria
   ("GoalNetNeg"/"GoalNetPos") para o app poder balançá-la quando a bola entra.
 - Troca as ~1 milhão de cadeiras (36 blocos de ~40 mil triângulos) por uma superfície em degraus suaves
   com textura de torcida, e grava as posições de assentos próximos ao campo (crowd_seats.json) para o app
   colocar torcedores 3D.
 - Remove marcas/escudos da Euro 2020 e das seleções das placas.
Requer: numpy, Pillow, opencv (cv2).
"""
import io, json, struct, sys
from pathlib import Path
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFilter

SRC = Path(sys.argv[1]); OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "public/models"); OUT.mkdir(parents=True, exist_ok=True)

GL = -1.35
SX, SY, SZ = 0.4397, 0.4226, 0.4226          # m por unidade do modelo (x = largura, y = altura, z = comprimento)
Z_GOAL_NEG, Z_GOAL_POS = -124.2, 124.0       # linhas de gol no modelo (unidades)
GOAL_X, GOAL_Y = 0.746, 0.80                 # reduz o gol do modelo para 7,32 x 2,44 m
SEAT_MATS = {"Material.010", "Material.011", "Material.012", "Material.014", "Material.034"}
CELL = 1.6                                   # resolução da superfície das arquibancadas (m)

# ---------------------------------------------------------------- leitura do GLB original
def read_glb(p):
    b = Path(p).read_bytes()
    clen, _ = struct.unpack("<I4s", b[12:20]); j = json.loads(b[20:20 + clen]); off = 20 + clen
    blen, _ = struct.unpack("<I4s", b[off:off + 8]); return j, b[off + 8:off + 8 + blen]

def acc(j, bl, i):
    a = j["accessors"][i]; bv = j["bufferViews"][a["bufferView"]]
    n = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}[a["type"]]
    dt = {5126: np.float32, 5123: np.uint16, 5125: np.uint32, 5121: np.uint8, 5122: np.int16, 5120: np.int8}[a["componentType"]]
    o = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    arr = np.frombuffer(bl, dtype=dt, count=a["count"] * n, offset=o).reshape(a["count"], n)
    if a.get("normalized"): arr = arr / np.iinfo(dt).max
    return arr.astype(np.float64) if dt == np.float32 or a.get("normalized") else arr

def qmat(q):
    x, y, z, w = q
    return np.array([[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)], [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)], [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]])

j, bl = read_glb(SRC)
nodes = j["nodes"]; parent = {}
for i, n in enumerate(nodes):
    for c in n.get("children", []): parent[c] = i
def local(n):
    if "matrix" in n: return np.array(n["matrix"]).reshape(4, 4).T
    M = np.eye(4); R = np.array(n.get("rotation", [0, 0, 0, 1])); S = np.array(n.get("scale", [1, 1, 1]))
    M[:3, :3] = qmat(R) @ np.diag(S); M[:3, 3] = n.get("translation", [0, 0, 0]); return M
_W = {}
def world(i):
    if i not in _W: _W[i] = (world(parent[i]) @ local(nodes[i])) if i in parent else local(nodes[i])
    return _W[i]

# nós do gol (medidos no arquivo): redes e peças dos postes/travessão
NET_NODES = {213: "GoalNetPos", 215: "GoalNetNeg"}
FRAME_NODES_POS = {225, 227, 229, 235, 237, 239, 241, 243}
FRAME_NODES_NEG = {245, 247, 249, 251, 253, 255, 257, 259}

# ---------------------------------------------------------------- imagens
def img_of(i):
    im = j["images"][i]; bv = j["bufferViews"][im["bufferView"]]
    return Image.open(io.BytesIO(bl[bv.get("byteOffset", 0):bv.get("byteOffset", 0) + bv["byteLength"]])).convert("RGB")

# placas: apaga logo/escudos (inpaint) e reaproveita o padrão turquesa nas três
logo = np.asarray(img_of(0))[:, :, ::-1].copy()
mask = (logo.min(axis=2) > 185).astype(np.uint8) * 255
mask = cv2.dilate(mask, np.ones((9, 9), np.uint8))
clean = cv2.inpaint(logo, mask, 6, cv2.INPAINT_TELEA)
board_img = Image.fromarray(clean[:, :, ::-1]).resize((1024, 512), Image.LANCZOS)

def crowd_texture(size=512, tile_m=8.0, seed=11):
    """Torcida estilizada: cabeças e camisas coloridas em fileiras (repete a cada tile_m metros)."""
    rng = np.random.default_rng(seed)
    img = Image.new("RGB", (size, size), (22, 26, 38)); d = ImageDraw.Draw(img)
    n = int(tile_m / 0.55); step = size / n
    pal = [(214, 40, 57), (245, 245, 245), (30, 100, 220), (250, 204, 21), (40, 48, 64), (22, 163, 74), (249, 115, 22), (148, 163, 184), (124, 58, 237), (16, 185, 129)]
    skin = [(241, 199, 160), (224, 172, 132), (197, 140, 98), (141, 90, 59), (91, 58, 38)]
    for r in range(n):
        for c in range(n):
            if rng.random() < 0.06: continue                      # assento vazio
            x = (c + 0.5 + rng.uniform(-0.1, 0.1)) * step; y = (r + 0.5) * step
            col = pal[rng.integers(len(pal))]; sk = skin[rng.integers(len(skin))]
            d.rounded_rectangle((x - step * 0.42, y - step * 0.05, x + step * 0.42, y + step * 0.52), radius=step * 0.18, fill=col)
            d.ellipse((x - step * 0.2, y - step * 0.5, x + step * 0.2, y - step * 0.06), fill=sk)
            if rng.random() < 0.5: d.pieslice((x - step * 0.21, y - step * 0.52, x + step * 0.21, y - step * 0.12), 180, 360, fill=(30, 24, 20))
    return img.filter(ImageFilter.GaussianBlur(0.6))

def jpg(img, q=84):
    b = io.BytesIO(); img.convert("RGB").save(b, "JPEG", quality=q, optimize=True, progressive=True); return b.getvalue()

new_images = {}           # índice de imagem original -> bytes (jpeg)
keep_idx = [1, 2, 5, 6, 7, 8]
for i in keep_idx:
    im = img_of(i)
    if i == 6: im = im.resize((2048, 1024), Image.LANCZOS)
    new_images[i] = jpg(im, 86 if i in (6, 7) else 82)
for i in (0, 3, 4): new_images[i] = jpg(board_img, 82)
CROWD_IMG = 9
new_images[CROWD_IMG] = jpg(crowd_texture(), 88)

# ---------------------------------------------------------------- geometria
def to_final(p_raw, zg, goal_scale):
    """raw -> metros no sistema do app. `zg`: linha de gol do lado do objeto; goal_scale reduz o gol."""
    u = p_raw / 100.0
    x = u[:, 0] * SX; y = u[:, 1] * SY; z = GL + (u[:, 2] - Z_GOAL_NEG) * SZ
    if goal_scale:
        zline = GL + (zg - Z_GOAL_NEG) * SZ
        x = x * GOAL_X; y = y * GOAL_Y
        z = zline + (z - zline)
    return np.stack([x, y, z], 1)

class Acc:
    def __init__(s): s.P = []; s.N = []; s.UV = []; s.I = []; s.n = 0
    def add(s, P, N, UV, I):
        s.P.append(P); s.N.append(N); s.UV.append(UV); s.I.append(I.reshape(-1) + s.n); s.n += len(P)
    def tris(s): return sum(len(i) for i in s.I) // 3

groups = {}               # chave (material, nome) -> Acc
seat_chunks = []          # vértices finais de cada bloco de cadeiras
tri_in = tri_out_other = 0
for ni, n in enumerate(nodes):
    if "mesh" not in n: continue
    W = world(ni); Lin = W[:3, :3]
    for p in j["meshes"][n["mesh"]]["primitives"]:
        mat = j["materials"][p.get("material", 0)]; mname = mat.get("name")
        pos = acc(j, bl, p["attributes"]["POSITION"])
        idx = acc(j, bl, p["indices"])[:, 0].astype(np.int64) if "indices" in p else np.arange(len(pos))
        tri_in += len(idx) // 3
        nor = acc(j, bl, p["attributes"]["NORMAL"]) if "NORMAL" in p["attributes"] else np.tile([0, 1, 0.], (len(pos), 1))
        uv = acc(j, bl, p["attributes"]["TEXCOORD_0"]) if "TEXCOORD_0" in p["attributes"] else np.zeros((len(pos), 2))
        pw = (W @ np.c_[pos, np.ones(len(pos))].T).T[:, :3]
        nw = (np.linalg.inv(Lin).T @ nor.T).T
        is_seat = mname in SEAT_MATS and len(idx) // 3 > 8000
        net = NET_NODES.get(ni); frame_pos = ni in FRAME_NODES_POS; frame_neg = ni in FRAME_NODES_NEG
        gscale = bool(net or frame_pos or frame_neg)
        zg = Z_GOAL_POS if (net == "GoalNetPos" or frame_pos) else Z_GOAL_NEG
        pf = to_final(pw, zg, gscale)
        if is_seat:
            seat_chunks.append((ni, pf)); continue
        # normais: transforma com a escala final (anisotrópica) e renormaliza
        S = np.diag([1 / SX, 1 / SY, 1 / SZ]); nf = (S @ nw.T).T
        nf /= np.maximum(np.linalg.norm(nf, axis=1, keepdims=True), 1e-9)
        if gscale: nf = nf * np.array([1 / GOAL_X, 1 / GOAL_Y, 1]); nf /= np.maximum(np.linalg.norm(nf, axis=1, keepdims=True), 1e-9)
        if net == "GoalNetPos": continue                # rede do gol distante: quase nunca aparece, pesa ~1 MB
        key = (net or ("GoalFrame" if (frame_pos or frame_neg) else mname))
        a = groups.setdefault(key, Acc()); a.add(pf, nf, uv, idx)
        a.mat = p.get("material", 0)
        tri_out_other += len(idx) // 3

# ---------------------------------------------------------------- arquibancadas: superfície em degraus + assentos
seat_acc = Acc(); crowd = []
hm_tris = 0
for ni, pf in seat_chunks:
    mn = pf.min(0); mx = pf.max(0)
    nx = int(np.ceil((mx[0] - mn[0]) / CELL)) + 1; nz = int(np.ceil((mx[2] - mn[2]) / CELL)) + 1
    H = np.full((nx, nz), np.nan)
    ix = np.clip(((pf[:, 0] - mn[0]) / CELL).astype(int), 0, nx - 1); iz = np.clip(((pf[:, 2] - mn[2]) / CELL).astype(int), 0, nz - 1)
    for a_, b_, y_ in zip(ix, iz, pf[:, 1]):
        if np.isnan(H[a_, b_]) or y_ > H[a_, b_]: H[a_, b_] = y_
    ok = ~np.isnan(H)
    vid = -np.ones((nx, nz), dtype=np.int64); P = []; 
    for a_ in range(nx):
        for b_ in range(nz):
            if ok[a_, b_]: vid[a_, b_] = len(P); P.append([mn[0] + (a_ + 0.5) * CELL, H[a_, b_], mn[2] + (b_ + 0.5) * CELL])
    P = np.array(P); I = []
    for a_ in range(nx - 1):
        for b_ in range(nz - 1):
            v = [vid[a_, b_], vid[a_ + 1, b_], vid[a_, b_ + 1], vid[a_ + 1, b_ + 1]]
            if min(v) < 0: continue
            I += [v[0], v[2], v[1], v[1], v[2], v[3]]
    if not I: continue
    I = np.array(I)
    # normais por diferenças finitas
    N = np.tile([0, 1., 0], (len(P), 1))
    for a_ in range(nx):
        for b_ in range(nz):
            k = vid[a_, b_]
            if k < 0: continue
            hx = (H[min(a_ + 1, nx - 1), b_] - H[max(a_ - 1, 0), b_]) if ok[min(a_ + 1, nx - 1), b_] and ok[max(a_ - 1, 0), b_] else 0
            hz = (H[a_, min(b_ + 1, nz - 1)] - H[a_, max(b_ - 1, 0)]) if ok[a_, min(b_ + 1, nz - 1)] and ok[a_, max(b_ - 1, 0)] else 0
            nn = np.array([-hx / (2 * CELL), 1, -hz / (2 * CELL)]); N[k] = nn / np.linalg.norm(nn)
    UV = np.c_[P[:, 0] / 8.0, P[:, 2] / 8.0]                       # a textura de torcida repete a cada 8 m
    seat_acc.add(P, N, UV, I); hm_tris += len(I) // 3
    # torcedores 3D só na arquibancada baixa perto do gol -Z e das laterais próximas
    cx = (mn[0] + mx[0]) / 2; cz = (mn[2] + mx[2]) / 2
    if mx[1] < 17 and cz < GL + 48:
        step = 1.15
        for gx in np.arange(mn[0] + 0.6, mx[0], step):
            for gz in np.arange(mn[2] + 0.6, mx[2], step):
                a_ = int(np.clip((gx - mn[0]) / CELL, 0, nx - 1)); b_ = int(np.clip((gz - mn[2]) / CELL, 0, nz - 1))
                if ok[a_, b_]: crowd.append([round(float(gx), 2), round(float(H[a_, b_]), 2), round(float(gz), 2)])

# ---------------------------------------------------------------- escreve o GLB
chunks = []; views = []; accessors = []; meshes = []; mnodes = []; materials = []; textures = []; images = []
def add_view(data, target=None):
    while sum(len(c) for c in chunks) % 4: chunks.append(b"\0")
    off = sum(len(c) for c in chunks); chunks.append(data)
    v = {"buffer": 0, "byteOffset": off, "byteLength": len(data)}
    if target: v["target"] = target
    views.append(v); return len(views) - 1
def add_acc(arr, comp, typ, target, with_minmax=False):
    vi = add_view(arr.tobytes(), target)
    a = {"bufferView": vi, "componentType": comp, "count": int(len(arr)) if typ == "SCALAR" else int(arr.shape[0]), "type": typ}
    if with_minmax: a["min"] = arr.min(0).tolist(); a["max"] = arr.max(0).tolist()
    accessors.append(a); return len(accessors) - 1

# imagens/texturas
img_map = {}
for k in sorted(new_images):
    vi = add_view(new_images[k]); images.append({"bufferView": vi, "mimeType": "image/jpeg", "name": f"img{k}"}); img_map[k] = len(images) - 1
tex_map = {}
def tex_of(orig_tex_index):
    if orig_tex_index in tex_map: return tex_map[orig_tex_index]
    src = j["textures"][orig_tex_index]["source"]
    textures.append({"source": img_map[src], "sampler": 0}); tex_map[orig_tex_index] = len(textures) - 1; return tex_map[orig_tex_index]
mat_cache = {}
def mat_of(orig_idx):
    if orig_idx in mat_cache: return mat_cache[orig_idx]
    m = j["materials"][orig_idx]; p = m.get("pbrMetallicRoughness", {})
    nm = {"name": m.get("name"), "pbrMetallicRoughness": {"baseColorFactor": p.get("baseColorFactor", [1, 1, 1, 1]), "metallicFactor": 0.0, "roughnessFactor": 0.95}, "doubleSided": True}
    if "baseColorTexture" in p: nm["pbrMetallicRoughness"]["baseColorTexture"] = {"index": tex_of(p["baseColorTexture"]["index"])}
    if "normalTexture" in m: nm["normalTexture"] = {"index": tex_of(m["normalTexture"]["index"]), "scale": 0.8}
    materials.append(nm); mat_cache[orig_idx] = len(materials) - 1; return mat_cache[orig_idx]
seat_mat = len(materials)
textures.append({"source": img_map[CROWD_IMG], "sampler": 0}); materials.append({"name": "Seats", "pbrMetallicRoughness": {"baseColorTexture": {"index": len(textures) - 1}, "metallicFactor": 0.0, "roughnessFactor": 1.0}, "doubleSided": True})

def add_mesh(name, a, mat_index):
    P = np.vstack(a.P).astype(np.float32); N = np.vstack(a.N).astype(np.float32); UV = np.vstack(a.UV).astype(np.float32); I = np.concatenate(a.I)
    # solda vértices idênticos (o modelo original repete os vértices a cada triângulo)
    textured = "baseColorTexture" in materials[mat_index]["pbrMetallicRoughness"] or "normalTexture" in materials[mat_index]
    key = np.round(np.c_[P, N * 100, UV * 1000] if textured else np.c_[P, N * 100], 3)
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    P, N, UV = P[first], N[first], UV[first]; I = inv.reshape(-1)[I]
    keep = (I.reshape(-1, 3)[:, 0] != I.reshape(-1, 3)[:, 1]) & (I.reshape(-1, 3)[:, 1] != I.reshape(-1, 3)[:, 2]) & (I.reshape(-1, 3)[:, 0] != I.reshape(-1, 3)[:, 2])
    I = I.reshape(-1, 3)[keep].reshape(-1)
    I = I.astype(np.uint16 if len(P) < 65535 else np.uint32)
    attrs = {"POSITION": add_acc(P, 5126, "VEC3", 34962, True), "NORMAL": add_acc(N, 5126, "VEC3", 34962)}
    pb = materials[mat_index]["pbrMetallicRoughness"]
    if "baseColorTexture" in pb or "normalTexture" in materials[mat_index]:
        attrs["TEXCOORD_0"] = add_acc(UV, 5126, "VEC2", 34962)
    ia = add_acc(I, 5123 if I.dtype == np.uint16 else 5125, "SCALAR", 34963)
    meshes.append({"name": name, "primitives": [{"attributes": attrs, "indices": ia, "material": mat_index}]})
    mnodes.append({"name": name, "mesh": len(meshes) - 1})

for key, a in sorted(groups.items(), key=lambda kv: str(kv[0])):
    add_mesh(str(key), a, mat_of(a.mat))
add_mesh("Seats", seat_acc, seat_mat)

blob = b"".join(chunks); blob += b"\0" * (-len(blob) % 4)
gj = {"asset": {"version": "2.0", "generator": "scoutvision build_stadium.py"}, "scene": 0, "scenes": [{"nodes": list(range(len(mnodes)))}],
      "nodes": mnodes, "meshes": meshes, "materials": materials, "textures": textures, "images": images,
      "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}],
      "accessors": accessors, "bufferViews": views, "buffers": [{"byteLength": len(blob)}]}
js = json.dumps(gj, separators=(",", ":")).encode(); js += b" " * (-len(js) % 4)
(OUT / "stadium.glb").write_bytes(struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(js) + 8 + len(blob)) + struct.pack("<I4s", len(js), b"JSON") + js + struct.pack("<I4s", len(blob), b"BIN\0") + blob)
(OUT / "crowd_seats.json").write_text(json.dumps({"positions": crowd}, separators=(",", ":")))
tot = sum(a.tris() for a in groups.values()) + seat_acc.tris()
print(f"entrada: {tri_in:,} triângulos | saída: {tot:,} (estrutura {tri_out_other:,}, arquibancadas {hm_tris:,}) | torcedores 3D: {len(crowd):,}")
print({p.name: round(p.stat().st_size / 1e6, 2) for p in OUT.glob("stadium.glb")}, "MB", [ (k, a.tris()) for k, a in groups.items() if a.tris() > 5000])
