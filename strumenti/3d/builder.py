# The developer alone: sitting on an R box, laptop on the legs.  Blender -b -P builder.py -- [prova]
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scena as S
from mathutils import Vector

d = math.radians


def costruisci():
    rz = d(100)
    S.scatola((0, 0, 0), (0, 0, 0), 0.62)  # R faces left, free of the legs
    seat_z = 0.62 * 0.8 + 0.0
    fig = S.figura('dev', 'seduto', (0, 0, seat_z), rz, 1.0,
                   mano_d=(0.24, -0.5, 0.42), mano_s=(-0.22, -0.52, 0.42))
    # laptop on the thighs, hinge away from him (screen faces him), stickers on the lid back
    lap = S.portatile((0, -0.42, 0.25), d(180), 0.42, fig, apertura=-12, seed=2)
    hinge = [o for o in lap.children if o.name.startswith('cerniera')][0]
    for (x, z, col, r) in ((-0.4, 0.75, 'rosa', 0.12), (0.3, 0.45, 'menta', 0.1), (0.42, 0.85, 'sole', 0.08)):
        S.cyl(r, 0.02, (x, 0.045, z), col, (d(90), 0, 0), 0.008, parent=hinge)
    S.rbox((0.22, 0.02, 0.22), (-0.05, 0.045, 0.3), 'segnale', 0.04, (0, d(12), 0), hinge)


if __name__ == '__main__':
    prova = 'prova' in S.args()
    S.reset(); costruisci(); S.pavimento(); S.luci()
    cam = S.camera(); res = (1600, 1600)
    S.inquadra(cam, res, 0.1)
    S.render('builder.png', res, samples=64, prova=prova)
