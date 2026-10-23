# The installer alone: wrench on the shoulder, R box under the arm.  Blender -b -P installatore.py -- [prova]
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scena as S

d = math.radians


def costruisci():
    rz = d(30)
    fig = S.figura('inst', 'in_piedi', (0, 0, 0), rz, 1.0,
                   mano_d=(0.5, -0.22, 1.32), mano_s=(-0.88, -0.1, 0.6))
    S.chiave_inglese((0.5, -0.12, 1.45), (d(-48), d(28), 0), 0.95, 'inchiostro2', fig)
    S.scatola((-0.63, -0.02, 0.33), (0, 0, d(-6)), 0.46, fig)


if __name__ == '__main__':
    prova = 'prova' in S.args()
    S.reset(); costruisci(); S.pavimento(); S.luci()
    cam = S.camera(); res = (1600, 1600)
    S.inquadra(cam, res, 0.12)
    S.render('installatore.png', res, samples=64, prova=prova)
