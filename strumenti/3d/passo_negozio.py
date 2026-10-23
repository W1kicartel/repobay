# Step 3 (shop): the shop with the awning and the "APERTO" sign as a shape.  Blender -b -P passo_negozio.py -- [prova]
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scena as S


def costruisci():
    S.negozio((0, 0, 0), math.radians(24), 1.0, cartello=True)


if __name__ == '__main__':
    prova = 'prova' in S.args()
    S.reset(); costruisci(); S.pavimento(); S.luci()
    cam = S.camera(); res = (1600, 1600)
    S.inquadra(cam, res, 0.08)
    S.render('passo-negozio.png', res, samples=64, prova=prova)
