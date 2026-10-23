# Step 2 (install): the open toolbox with the R box coming out.  Blender -b -P passo_installa.py -- [prova]
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scena as S
from mathutils import Vector


def costruisci():
    S.cassetta((0, 0, 0), math.radians(25), 1.0)
    S.scatola((0.42, 0.22, 0.98), (math.radians(10), math.radians(-18), math.radians(22)), 0.92)
    # pop lines above the box
    for k, (dx, dz) in enumerate(((-0.55, 0.0), (0.0, 0.2), (0.55, 0.0))):
        base = Vector((0.42 + dx * 0.7071, 0.22 + dx * 0.7071, 2.3 + dz))
        S.capsule(base, base + Vector((dx * 0.25, dx * 0.25, 0.38)), 0.04, 'inchiostro')
    # tools on the floor
    S.chiave_inglese((1.15, -1.25, 0.04), (math.radians(90), 0, math.radians(70)), 0.8)
    S.cyl(0.07, 0.42, (-1.0, -1.05, 0.07), 'segnale', (0, math.radians(90), math.radians(20)), 0.03)
    S.capsule((-0.75, -0.96, 0.07), (-0.45, -0.85, 0.07), 0.025, 'inchiostro2')
    for i, (x, y) in enumerate(((0.35, -1.45), (0.55, -1.75), (-0.3, -1.6))):
        S.cyl(0.06, 0.05, (x, y, 0.025), 'inchiostro2', bevel=0.015, verts=6)


if __name__ == '__main__':
    prova = 'prova' in S.args()
    S.reset(); costruisci(); S.pavimento(); S.luci()
    cam = S.camera(); res = (1600, 1600)
    S.inquadra(cam, res, 0.08)
    S.render('passo-installa.png', res, samples=64, prova=prova)
