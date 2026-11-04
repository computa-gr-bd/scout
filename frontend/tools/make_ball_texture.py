#!/usr/bin/env python3
"""Gera a textura da bola (icosaedro truncado: 12 pentágonos pretos + 20 hexágonos brancos, com costuras).
Uso: python3 tools/make_ball_texture.py [saida=public/models/ball_pattern.png]"""
import sys
import numpy as np
from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else "public/models/ball_pattern.png"
W, H, SS = 1024, 512, 2                      # tamanho final e supersampling (suaviza as costuras)
phi = (1 + 5 ** 0.5) / 2
pent = np.array([(0, s1, s2 * phi) for s1 in (-1, 1) for s2 in (-1, 1)] +
                [(s1, s2 * phi, 0) for s1 in (-1, 1) for s2 in (-1, 1)] +
                [(s1 * phi, 0, s2) for s1 in (-1, 1) for s2 in (-1, 1)], float)
hexa = np.array([(a, b, c) for a in (-1, 1) for b in (-1, 1) for c in (-1, 1)] +
                [(0, s1 * phi, s2 / phi) for s1 in (-1, 1) for s2 in (-1, 1)] +
                [(s1 / phi, 0, s2 * phi) for s1 in (-1, 1) for s2 in (-1, 1)] +
                [(s1 * phi, s2 / phi, 0) for s1 in (-1, 1) for s2 in (-1, 1)], float)   # dual do icosaedro
C = np.vstack([pent, hexa]); C /= np.linalg.norm(C, axis=1, keepdims=True)
is_pent = np.arange(len(C)) < len(pent)

w, h = W * SS, H * SS
px, py = np.meshgrid((np.arange(w) + 0.5) / w, (np.arange(h) + 0.5) / h)
phi_a, th = px * 2 * np.pi, py * np.pi                     # mesma convenção da SphereGeometry do three.js
d = np.stack([-np.cos(phi_a) * np.sin(th), np.cos(th), np.sin(phi_a) * np.sin(th)], -1).reshape(-1, 3)
dots = d @ C.T
order = np.argsort(-dots, axis=1)[:, :2]
d1 = np.take_along_axis(dots, order[:, :1], 1)[:, 0]; d2 = np.take_along_axis(dots, order[:, 1:2], 1)[:, 0]
pentagon = is_pent[order[:, 0]]
seam = np.clip(1 - (d1 - d2) / 0.020, 0, 1)                  # 1 na costura, 0 longe dela
white = np.array([245, 246, 248.]); black = np.array([22, 26, 36.]); line = np.array([120, 126, 136.])
base = np.where(pentagon[:, None], black, white)
img = base * (1 - seam[:, None] * 0.85) + line * (seam[:, None] * 0.85)
# sombreamento sutil nos hexágonos para não ficar chapado
img = img.reshape(h, w, 3).clip(0, 255).astype(np.uint8)
Image.fromarray(img).resize((W, H), Image.LANCZOS).save(OUT, optimize=True)
print("ok", OUT)
