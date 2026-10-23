# The social preview with the title: og_titolo.html (black panel + og-sfondo.png) -> web/img/og.png and og.webp.
#   python3 og_titolo.py   (after og.py in Blender and og_componi.py)
import asyncio, os
from playwright.async_api import async_playwright
from PIL import Image
QUI = os.path.dirname(os.path.abspath(__file__)); IMG = os.path.normpath(os.path.join(QUI, '..', '..', 'web', 'img'))
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width': 1200, 'height': 630})
        await pg.goto('file://' + os.path.join(QUI, 'og_titolo.html')); await pg.wait_for_timeout(800)
        await pg.screenshot(path=os.path.join(IMG, 'og.png')); await b.close()
    Image.open(os.path.join(IMG, 'og.png')).convert('RGB').save(os.path.join(IMG, 'og.webp'), 'WEBP', quality=88, method=6)
    print('og.png, og.webp ok')
asyncio.run(main())
