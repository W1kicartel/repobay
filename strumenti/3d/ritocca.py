# Post-process of the transparent PNGs: shadows (semi-transparent pixels) fade out near the edges
# so they never end with a hard cut, and the faint ground residue (alpha <= 6) goes to zero.
#   python3 ritocca.py web/img/eroe.png [...]
import sys
import numpy as np
from PIL import Image

for p in sys.argv[1:]:
    im = np.array(Image.open(p).convert('RGBA')).astype(np.float32)
    a = im[..., 3]
    h, w = a.shape
    ys, xs = np.mgrid[0:h, 0:w]
    d = np.minimum.reduce([xs, w - 1 - xs, ys, h - 1 - ys]).astype(np.float32)
    zona = 0.045 * min(w, h)
    t = np.clip(d / zona, 0, 1)
    f = t * t * (3 - 2 * t)  # smoothstep
    ombra = a < 250
    a2 = np.where(ombra, a * f, a)
    a2 = np.where(ombra & (a2 <= 6), 0, a2)
    im[..., 3] = a2
    Image.fromarray(np.clip(im + 0.5, 0, 255).astype(np.uint8), 'RGBA').save(p, optimize=True)
    print('ritoccato', p)
