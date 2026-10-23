# Empty state: an open, empty R box with drooping flaps, a bit sad.  Blender -b -P vuoto.py -- [prova]
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scena as S

d = math.radians


def costruisci():
    root = S.empty('vuota', (0, 0, 0), (d(4), d(-9), d(18)), 1.0)
    s, h = 1.4, 1.05
    outer = S.rbox((s, s, h), (0, 0, h / 2), 'kraft', 0.05, parent=root)
    inner = S.rbox((s - 0.1, s - 0.1, h), (0, 0, h / 2 + 0.06), 'kraft', 0.0, parent=root)
    S.boolean(outer, inner)
    outer.modifiers.move(1, 0)
    S.rbox((s - 0.12, s - 0.12, 0.02), (0, 0, 0.07), 'inchiostro2', 0.005, parent=root)  # dark floor inside
    S.letter('R', 0.5, (0, -s / 2 - 0.005, h * 0.27), (d(90), 0, d(-6)), 'segnale', 0.035, root)
    # short flaps hinged on the top edges, drooping outwards at different angles (a bit sad)
    t = 0.035
    L = s * 0.4
    for rot_z, droop in ((0, 70), (d(90), 84), (d(180), 38), (d(270), 80)):
        hinge = S.empty('cerniera', (0, 0, h), (0, 0, rot_z), 1.0, root)
        # a positive turn around X makes the flap fall outwards
        hinge2 = S.empty('cerniera2', (0, -s / 2 - 0.01, 0), (d(droop), 0, 0), 1.0, hinge)
        S.rbox((s - 0.06, L, t), (0, -L / 2, 0), 'kraft', 0.015, parent=hinge2)
    # a small dust cloud: the "sigh" of the empty box
    for (x, y, z, r) in ((0.62, 0.35, 1.98, 0.13), (0.79, 0.4, 2.07, 0.17), (0.97, 0.45, 1.98, 0.12)):
        S.sphere(r, (x, y, z), 'carta2', scale=(1, 1, 0.85))

if __name__ == '__main__':
    prova = 'prova' in S.args()
    S.reset(); costruisci(); S.pavimento(); S.luci()
    cam = S.camera(); res = (1000, 1000)
    S.inquadra(cam, res, 0.12)
    S.render('vuoto.png', res, samples=64, prova=prova)
