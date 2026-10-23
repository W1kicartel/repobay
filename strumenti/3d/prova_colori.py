# Calibration: palette cubes + the two figures. Prints the projected pixel of the top and left face of each cube.
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scena as S
from bpy_extras.object_utils import world_to_camera_view
import bpy
from mathutils import Vector
S.reset()
cols = ['segnale', 'cobalto', 'sole', 'menta', 'rosa', 'bianco', 'carta2', 'inchiostro', 'inchiostro2', 'kraft']
cubes = []
for i, c in enumerate(cols):
    x = (i % 5) * 1.6 - 3.2
    y = (i // 5) * 1.6
    S.rbox((1, 1, 1), (x, y, 0.5), c, 0.08)
    cubes.append((c, Vector((x, y, 1.0)), Vector((x, y - 0.5, 0.5)), Vector((x + 0.5, y, 0.5))))
S.figura('dev', 'in_piedi', (-2.0, -2.6, 0), 0.0, mano_d=(0.7, -0.1, 1.55))
S.figura('inst', 'in_piedi', (1.0, -2.6, 0), 0.0)
S.pavimento()
S.luci()
cam = S.camera()
res = (1200, 900)
S.inquadra(cam, res, 0.04)
p = S.render('calibra.png', res, samples=32)
sc = bpy.context.scene
for c, top, left, right in cubes:
    out = []
    for q in (top, left, right):
        v = world_to_camera_view(sc, cam, q)
        out.append((round(v.x * res[0]), round((1 - v.y) * res[1])))
    print('PX', c, S.HEX[c], out)
