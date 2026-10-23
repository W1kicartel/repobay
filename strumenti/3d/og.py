# Social preview (1200x630): the hero scene, smaller, on the right; left free for the HTML title.
# 1) Blender -b -P og.py  -> controllo/og-scena.png (transparent)   2) python3 og_componi.py -> web/img/og.png
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scena as S
import eroe
import bpy

if __name__ == '__main__':
    prova = 'prova' in S.args()
    S.reset(); eroe.costruisci(); S.pavimento(); S.luci()
    cam = S.camera(); res = (1200, 630)
    S.inquadra(cam, res, 0.05, shift=(0.17, -0.01), extra=1.46)
    S.OUT = os.path.join(S.QUI, 'controllo')
    S.render('og-scena.png', res, samples=64, prova=prova)
