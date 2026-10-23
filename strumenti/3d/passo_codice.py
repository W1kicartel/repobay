# Step 1 (code): the laptop with a 3D git branch rising from the screen.  Blender -b -P passo_codice.py -- [prova]
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scena as S
from mathutils import Vector


def costruisci():
    S.portatile((0, 0, 0), math.radians(28), 1.6, seed=7)
    # git branch floating above the lid, facing the camera
    S.ramo_git((-0.95, 0.55, 2.45), (0, math.radians(-6), math.radians(45)), 1.2)
    # a floating "</>" made of capsules (cobalt) and two chunky code blocks
    tag = S.empty('tag', (-2.0, -0.2, 2.6), (0, math.radians(-10), math.radians(45)), 0.9)
    r = 0.075
    S.capsule((-0.55, 0, 0.0), (-0.85, 0, 0.3), r, 'cobalto', tag)
    S.capsule((-0.85, 0, 0.3), (-0.55, 0, 0.6), r, 'cobalto', tag)
    S.capsule((-0.15, 0, -0.05), (0.15, 0, 0.65), r, 'segnale', tag)
    S.capsule((0.55, 0, 0.0), (0.85, 0, 0.3), r, 'cobalto', tag)
    S.capsule((0.85, 0, 0.3), (0.55, 0, 0.6), r, 'cobalto', tag)
    S.rbox((0.5, 0.2, 0.2), (1.1, 1.9, 3.3), 'sole', 0.08, (0, math.radians(-12), math.radians(45)))

if __name__ == '__main__':
    prova = 'prova' in S.args()
    S.reset(); costruisci(); S.pavimento(); S.luci()
    cam = S.camera(); res = (1600, 1600)
    S.inquadra(cam, res, 0.08)
    S.render('passo-codice.png', res, samples=64, prova=prova)
