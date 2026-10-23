# Composite og-scena.png on paper #F2EFF7 with the 24 px grid -> web/img/og-sfondo.png (opaque; og_titolo.py adds the title).
import os
from PIL import Image, ImageDraw
qui = os.path.dirname(os.path.abspath(__file__))
scena = Image.open(os.path.join(qui, 'controllo', 'og-scena.png')).convert('RGBA')
W, H = 1200, 630
bg = Image.new('RGBA', (W, H), (0xF2, 0xEF, 0xF7, 255))
grid = Image.new('RGBA', (W, H), (0, 0, 0, 0))
g = ImageDraw.Draw(grid)
a = round(255 * 0.07)
for x in range(0, W, 24):
    g.line([(x, 0), (x, H)], fill=(13, 11, 17, a), width=1)
for y in range(0, H, 24):
    g.line([(0, y), (W, y)], fill=(13, 11, 17, a), width=1)
bg = Image.alpha_composite(bg, grid)
bg = Image.alpha_composite(bg, scena.resize((W, H)) if scena.size != (W, H) else scena)
bg.convert('RGB').save(os.path.join(qui, '..', '..', 'web', 'img', 'og-sfondo.png'), optimize=True)
print('og-sfondo.png ok')
