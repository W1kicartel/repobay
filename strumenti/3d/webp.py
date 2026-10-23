# The PNGs in web/img -> WebP for the site: the full one and the "-1x" at half size (srcset 1200w / 2400w).
#   python3 webp.py [name ...]   (no names: all the 3D illustrations)
import os, sys
from PIL import Image
IMG = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'web', 'img'))
TUTTE = ['eroe', 'passo-codice', 'passo-installa', 'passo-negozio', 'divisione', 'crypto', 'builder', 'installatore', 'vuoto']
for n in sys.argv[1:] or TUTTE:
    im = Image.open(os.path.join(IMG, n + '.png'))
    im.save(os.path.join(IMG, n + '.webp'), 'WEBP', quality=86, method=6)
    if n != 'vuoto':
        im.resize((im.width // 2, im.height // 2), Image.LANCZOS).save(os.path.join(IMG, n + '-1x.webp'), 'WEBP', quality=86, method=6)
    print('webp', n)
