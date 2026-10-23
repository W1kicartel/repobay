# Check a PNG: composite on paper (#F2EFF7) + a 400 px thumbnail, alpha stats, sample colors.
import sys
from PIL import Image
import os
p = os.path.abspath(sys.argv[1])
im = Image.open(p).convert('RGBA')
bg = Image.new('RGBA', im.size, (0xF2, 0xEF, 0xF7, 255))
comp = Image.alpha_composite(bg, im)
out = p.replace('.png', '') + '-su-carta.jpg'
os.makedirs(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'controllo'), exist_ok=True)
comp.convert('RGB').save(out.replace('/web/img/', '/strumenti/3d/controllo/'), quality=88)
small = comp.copy(); small.thumbnail((400, 400))
small.convert('RGB').save(out.replace('/web/img/', '/strumenti/3d/controllo/').replace('-su-carta', '-400'), quality=88)
a = im.getchannel('A')
h = a.histogram()
semi = sum(h[1:255])
print(p, im.size, 'alfa: pieni', h[255], 'vuoti', h[0], 'semitrasparenti', semi)
# dark halo check: semi-transparent pixels with alpha>100 that are much darker than expected?
for xy in sys.argv[2:]:
    x, y = map(int, xy.split(','))
    print(xy, '%02X%02X%02X a=%d' % im.getpixel((x, y)))
