# The split: three coin stacks (cobalt tall = builder, sun medium = installer, orange low = platform)
# on a base with measuring ticks.  Blender -b -P divisione.py -- [prova]
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scena as S
from mathutils import Vector


def pila(x, n, col, seed):
    rnd = random.Random(seed)
    h = 0.17
    z = 0.25
    for i in range(n - 1):
        S.cyl(0.55, h - 0.01, (x + rnd.uniform(-0.035, 0.035), rnd.uniform(-0.035, 0.035), z + h / 2), col, bevel=0.04)
        z += h
    S.moneta((x, 0, z + h / 2), (0, 0, 0), col, r=0.55, depth=h - 0.01)
    return z + h


def costruisci():
    S.rbox((5.6, 2.3, 0.25), (0, 0, 0.125), 'bianco', 0.07)
    # measuring ticks along the front (-y) edge of the top and down the -y face
    for i in range(29):
        x = -2.6 + i * 0.1857
        long = i % 7 == 0
        S.rbox((0.035, 0.32 if long else 0.18, 0.012), (x, -1.13 + (0.16 if long else 0.09), 0.251), 'inchiostro', 0.005)
    # dimension line on the +x face side: small end marks
    tops = [pila(-1.75, 13, 'cobalto', 1), pila(0.0, 8, 'sole', 2), pila(1.75, 4, 'segnale', 3)]
    # dimension line along the +x end of the base: end marks
    for i in range(3):
        pass

if __name__ == '__main__':
    prova = 'prova' in S.args()
    S.reset(); costruisci(); S.pavimento(); S.luci()
    cam = S.camera(); res = (2000, 1500)
    S.inquadra(cam, res, 0.07)
    S.render('divisione.png', res, samples=64, prova=prova)
