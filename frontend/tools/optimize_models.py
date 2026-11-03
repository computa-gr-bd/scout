#!/usr/bin/env python3
"""
Otimiza os modelos do replay "Realismo" (Mixamo -> GLB do Blender).

Uso:  python3 tools/optimize_models.py <pasta_com_os_glb> [<saida>=public/models]

- jogador.glb: reduz as texturas 4096 PNG (55 MB) para JPEG 2048/1024 (~3 MB), remove mapas
  que o app não usa e apaga o número "7" pintado nas costas da camisa (o número real do
  jogador é desenhado por cima, em tempo real).
- kit_mask.png: máscara por canal (R = camisa, G = calção, B = meião) feita a partir das UVs
  dos submeshes. O app usa essa máscara para pintar o uniforme na cor do time.
- anim/*.glb: copiados como estão (são pequenos).
Requer: Pillow e numpy.
"""
import io, json, shutil, struct, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SRC = Path(sys.argv[1]); OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "public/models")
(OUT / "anim").mkdir(parents=True, exist_ok=True)

def read_glb(p):
    b = Path(p).read_bytes()
    clen, _ = struct.unpack("<I4s", b[12:20])
    j = json.loads(b[20:20 + clen]); off = 20 + clen
    blen, _ = struct.unpack("<I4s", b[off:off + 8])
    return j, b[off + 8:off + 8 + blen]

def accessor(j, bl, i):
    a = j["accessors"][i]; bv = j["bufferViews"][a["bufferView"]]
    n = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[a["type"]]
    dt = {5126: np.float32, 5123: np.uint16, 5125: np.uint32}[a["componentType"]]
    o = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    return np.frombuffer(bl, dtype=dt, count=a["count"] * n, offset=o).reshape(a["count"], n)

def write_glb(path, j, bl):
    js = json.dumps(j, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4); bl += b"\0" * (-len(bl) % 4)
    total = 12 + 8 + len(js) + 8 + len(bl)
    Path(path).write_bytes(struct.pack("<4sII", b"glTF", 2, total) + struct.pack("<I4s", len(js), b"JSON") + js + struct.pack("<I4s", len(bl), b"BIN\0") + bl)

def png_bytes(img, **kw):
    b = io.BytesIO(); img.save(b, "PNG", optimize=True, **kw); return b.getvalue()
def jpg_bytes(img, q):
    b = io.BytesIO(); img.convert("RGB").save(b, "JPEG", quality=q, optimize=True, progressive=True); return b.getvalue()

j, bl = read_glb(SRC / "jogador.glb")
imgs = {im["name"]: im for im in j["images"]}
def load_img(name):
    bv = j["bufferViews"][imgs[name]["bufferView"]]
    return Image.open(io.BytesIO(bl[bv.get("byteOffset", 0):bv.get("byteOffset", 0) + bv["byteLength"]]))

# ---------- difuso do corpo: 2048, sem o número 7 ----------
diff = load_img("Ch38_1001_Diffuse").convert("RGB").resize((2048, 2048), Image.LANCZOS)
NUM_BOX = (1030, 1390, 1250, 1720)             # região do "7" nas costas (px em 2048)
pad = 36
box = (NUM_BOX[0] - pad, NUM_BOX[1] - pad, NUM_BOX[2] + pad, NUM_BOX[3] + pad)
crop = diff.crop(box)
clean = crop.filter(ImageFilter.MaxFilter(61)).filter(ImageFilter.GaussianBlur(14))   # apaga o traço escuro
feather = Image.new("L", crop.size, 0)
ImageDraw.Draw(feather).rectangle((pad // 2, pad // 2, crop.size[0] - pad // 2, crop.size[1] - pad // 2), fill=255)
feather = feather.filter(ImageFilter.GaussianBlur(pad // 2))
diff.paste(Image.composite(clean, crop, feather), box)
diff_jpg = jpg_bytes(diff, 86)
normal = load_img("Ch38_1001_Normal").convert("RGB").resize((1024, 1024), Image.LANCZOS)
normal_jpg = jpg_bytes(normal, 88)
hair = load_img("Ch38_1002_Diffuse").convert("RGBA").resize((512, 512), Image.LANCZOS)
hair_png = png_bytes(hair)
tiny = png_bytes(Image.new("RGB", (1, 1), (128, 128, 255)))

# ---------- máscara do uniforme (R camisa, G calção, B meião) ----------
S = 1024
mask = {c: Image.new("L", (S, S), 0) for c in "RGB"}
role = {"Mesh.001": "R", "Mesh": "G", "Mesh.002": "B"}
for m in j["meshes"]:
    ch = role.get(m["name"])
    if not ch: continue
    d = ImageDraw.Draw(mask[ch])
    for p in m["primitives"]:
        uv = accessor(j, bl, p["attributes"]["TEXCOORD_0"]); idx = accessor(j, bl, p["indices"])[:, 0].astype(int).reshape(-1, 3)
        for t in idx:
            d.polygon([(float(uv[i, 0] * S), float(uv[i, 1] * S)) for i in t], fill=255)
# dilata alguns pixels para não aparecer costura nas bordas das UVs
mask = {c: im.filter(ImageFilter.MaxFilter(7)) for c, im in mask.items()}
Image.merge("RGB", (mask["R"], mask["G"], mask["B"])).save(OUT / "kit_mask.png", optimize=True)

# ---------- remonta o GLB ----------
new_data = {"Ch38_1001_Diffuse": (diff_jpg, "image/jpeg"), "Ch38_1001_Normal": (normal_jpg, "image/jpeg"),
            "Ch38_1002_Diffuse": (hair_png, "image/png")}
view_data = {}
for im in j["images"]:
    data, mime = new_data.get(im["name"], (tiny, "image/png"))
    view_data[im["bufferView"]] = data; im["mimeType"] = mime
out = bytearray(); views = []
for i, bv in enumerate(j["bufferViews"]):
    raw = view_data.get(i, bl[bv.get("byteOffset", 0):bv.get("byteOffset", 0) + bv["byteLength"]])
    out += b"\0" * (-len(out) % 4)
    nb = dict(bv); nb["byteOffset"] = len(out); nb["byteLength"] = len(raw); views.append(nb); out += raw
j["bufferViews"] = views; j["buffers"] = [{"byteLength": len(out)}]
# materiais simples: o app aplica brilho/rugosidade e o tingimento por conta própria
for m in j["materials"]:
    m.pop("extensions", None)
    pbr = m.get("pbrMetallicRoughness", {})
    pbr.pop("metallicRoughnessTexture", None); pbr["metallicFactor"] = 0; pbr["roughnessFactor"] = 0.8
    if m["name"] == "Ch38_hair": m.pop("normalTexture", None)
for k in ("extensionsUsed", "extensionsRequired"):
    if k in j:
        j[k] = [e for e in j[k] if e != "KHR_materials_specular"]
        if not j[k]: j.pop(k)
write_glb(OUT / "jogador.glb", j, bytes(out))

for f in sorted(SRC.glob("*.glb")):
    if f.name != "jogador.glb": shutil.copy(f, OUT / "anim" / f.name)
print("ok:", {p.name: round(p.stat().st_size / 1e6, 2) for p in sorted(OUT.rglob("*")) if p.is_file()})
