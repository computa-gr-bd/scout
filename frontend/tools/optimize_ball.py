#!/usr/bin/env python3
"""Reduz o GLB da bola (texturas PNG 1024 -> JPEG) e remove o mapa de metal/rugosidade.
Uso: python3 tools/optimize_ball.py <bola.glb> [<saida>=public/models/bola.glb]"""
import io, json, struct, sys
from pathlib import Path
from PIL import Image

SRC = Path(sys.argv[1]); OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "public/models/bola.glb")
b = SRC.read_bytes(); n, _ = struct.unpack("<I4s", b[12:20]); j = json.loads(b[20:20 + n]); off = 20 + n
bl_len, _ = struct.unpack("<I4s", b[off:off + 8]); bl = b[off + 8:off + 8 + bl_len]

mat = j["materials"][0]; pbr = mat["pbrMetallicRoughness"]
src_of = lambda ti: j["textures"][ti]["source"]
base_img = src_of(pbr["baseColorTexture"]["index"]); normal_img = src_of(mat["normalTexture"]["index"])
pbr.pop("metallicRoughnessTexture", None); pbr["metallicFactor"] = 0.0; pbr["roughnessFactor"] = 0.42   # bola de couro sintético

def jpeg(img, q):
    o = io.BytesIO(); img.convert("RGB").save(o, "JPEG", quality=q, optimize=True, progressive=True); return o.getvalue()
new = {}
for i, im in enumerate(j["images"]):
    bv = j["bufferViews"][im["bufferView"]]; raw = bl[bv.get("byteOffset", 0):bv.get("byteOffset", 0) + bv["byteLength"]]
    img = Image.open(io.BytesIO(raw))
    if i == base_img: new[im["bufferView"]] = jpeg(img, 90)
    elif i == normal_img: new[im["bufferView"]] = jpeg(img, 86)
    else: new[im["bufferView"]] = jpeg(Image.new("RGB", (1, 1), (128, 128, 255)), 80)      # sem uso
    im["mimeType"] = "image/jpeg"
out = bytearray(); views = []
for i, bv in enumerate(j["bufferViews"]):
    data = new.get(i, bl[bv.get("byteOffset", 0):bv.get("byteOffset", 0) + bv["byteLength"]])
    out += b"\0" * (-len(out) % 4); nb = dict(bv); nb["byteOffset"] = len(out); nb["byteLength"] = len(data); views.append(nb); out += data
j["bufferViews"] = views; j["buffers"] = [{"byteLength": len(out)}]
js = json.dumps(j, separators=(",", ":")).encode(); js += b" " * (-len(js) % 4); out += b"\0" * (-len(out) % 4)
OUT.write_bytes(struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(js) + 8 + len(out)) + struct.pack("<I4s", len(js), b"JSON") + js + struct.pack("<I4s", len(out), b"BIN\0") + bytes(out))
print("ok", OUT, round(OUT.stat().st_size / 1e6, 2), "MB")
