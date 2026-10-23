# Generic floating coins with engraved abstract symbols + a small phone with an abstract QR.
#   Blender -b -P crypto.py -- [prova]
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scena as S
from mathutils import Vector

d = math.radians


def telefono(loc, rot_z, scale=1.0):
    root = S.empty('telefono', loc, (0, 0, rot_z), scale)
    tilt = S.empty('incl', (0, 0, 0), (d(-12), 0, 0), 1.0, root)
    W, T, H = 1.0, 0.11, 1.95
    S.rbox((W, T, H), (0, 0, H / 2), 'inchiostro', 0.1, parent=tilt)
    S.rbox((W - 0.12, 0.02, H - 0.2), (0, -T / 2, H / 2), 'bianco', 0.06, parent=tilt)
    # abstract QR: 9x9 grid, three finder squares
    n, c = 9, 0.075
    x0, z0 = -(n - 1) * c / 2, H / 2 + 0.12
    rnd = random.Random(11)
    def cell(i, j):
        S.rbox((c * 0.92, 0.02, c * 0.92), (x0 + i * c, -T / 2 - 0.015, z0 + (n - 1 - j) * c - (n - 1) * c / 2), 'inchiostro', 0.008, parent=tilt)
    finder = set()
    for (fi, fj) in ((0, 0), (6, 0), (0, 6)):
        for i in range(3):
            for j in range(3):
                finder.add((fi + i, fj + j))
                if (i, j) != (1, 1) or True:
                    if i in (0, 2) or j in (0, 2) or (i, j) == (1, 1):
                        cell(fi + i, fj + j)
    for i in range(n):
        for j in range(n):
            if (i, j) not in finder and rnd.random() < 0.45:
                cell(i, j)
    # a mint "paid" pill under the code
    S.capsule((-0.22, -T / 2 - 0.02, H / 2 - 0.55), (0.22, -T / 2 - 0.02, H / 2 - 0.55), 0.07, 'menta', tilt)
    return root


def costruisci():
    telefono((1.2, -1.2, 0), d(40), 1.35)
    coins = [
        ((-1.2, 0.6, 2.9), (d(62), d(15), d(30)), 'segnale', 'cerchio'),
        ((0.3, 1.3, 3.9), (d(48), d(-20), d(60)), 'cobalto', 'rombo'),
        ((-2.3, -0.3, 1.5), (d(70), d(-25), d(10)), 'menta', 'esagono'),
        ((1.2, 1.6, 2.2), (d(75), d(30), d(80)), 'sole', 'cerchio'),
        ((-1.2, -2.6, 0.95), (d(40), d(10), d(-30)), 'rosa', 'rombo'),
        ((-0.9, 1.9, 1.2), (d(20), d(-12), d(15)), 'cobalto', 'esagono'),
    ]
    for loc, rot, col, sym in coins:
        S.moneta(loc, rot, col, r=0.5, depth=0.14, simbolo=sym, scale=1.1)


if __name__ == '__main__':
    prova = 'prova' in S.args()
    S.reset(); costruisci(); S.pavimento(); S.luci()
    cam = S.camera(); res = (1600, 1600)
    S.inquadra(cam, res, 0.08)
    S.render('crypto.png', res, samples=64, prova=prova)
