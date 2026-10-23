# The Repobay mark: the bay (a frame open on one side, also a code bracket) with the box sliding out of it, and the wordmark in
# Bricolage Grotesque. Writes web/marchio/*.svg (+ a preview page). The wordmark SVGs embed the font: outlined versions need fontTools.
#   python3 strumenti/marchio/logo.py
import os, base64
QUI = os.path.dirname(os.path.abspath(__file__)); RADICE = os.path.normpath(os.path.join(QUI, '..', '..'))
OUT = os.path.join(RADICE, 'web', 'marchio'); FONT = os.path.join(RADICE, 'web', 'font')
VIOLA, NERO, BIANCO, CARTA, ORCHIDEA = '#7B3DFF', '#0D0B11', '#FFFFFF', '#F2EFF7', '#FF6BD6'

# ---- the mark, on a 100-unit square: the bay (a thick frame open on the right) and the box sliding out of it ----
def marchio(cornice, scatola, t=14, x0=14, x1=66, y0=14, y1=86, bx=52, bw=32, r=3):
    """cornice/scatola: the two colours (frame and box). The opening is on the right: the box is half inside, half out."""
    cornice_d = (f'M{x0 + r} {y0}H{x1}V{y0 + t}H{x0 + t}V{y1 - t}H{x1}V{y1}H{x0 + r}A{r} {r} 0 0 1 {x0} {y1 - r}V{y0 + r}A{r} {r} 0 0 1 {x0 + r} {y0}Z')
    by = (y0 + y1) / 2 - bw / 2
    return (f'<path fill="{cornice}" d="{cornice_d}"/>'
            f'<rect x="{bx}" y="{by}" width="{bw}" height="{bw}" rx="{r + 1}" fill="{scatola}"/>')

def simbolo(stile='due', scala=1.0, inchiostro=NERO):
    """due: frame in ink, box in purple (the everyday mark). mono: one colour (currentColor or `inchiostro`).
    piatto: on a black rounded square (favicon, app icons). adesivo: tilted purple badge with ink border and hard shadow."""
    testa = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="{100*scala}" height="{100*scala}">'
    if stile == 'due': return testa + marchio(inchiostro, VIOLA) + '</svg>'
    if stile == 'mono': return testa + marchio(inchiostro, inchiostro) + '</svg>'
    if stile == 'piatto':
        return testa + f'<rect width="100" height="100" rx="14" fill="{NERO}"/><g transform="translate(50 50) scale(.78) translate(-50 -50)">{marchio("#F3EFFA", VIOLA)}</g></svg>'
    # the sticker: 120-unit canvas so the rotation and the shadow fit
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="{120*scala}" height="{120*scala}">'
            f'<g transform="translate(60 58) rotate(-4) translate(-50 -50)">'
            f'<rect x="5" y="5" width="100" height="100" rx="6" fill="{inchiostro}"/>'
            f'<rect width="100" height="100" rx="6" fill="{VIOLA}" stroke="{inchiostro}" stroke-width="3"/>'
            f'<g transform="translate(50 50) scale(.74) translate(-50 -50)">{marchio(BIANCO, NERO)}</g></g></svg>')
def dentro(svg): return svg[svg.index('>') + 1:-6]   # the content of an svg, to nest it

def font64(nome):
    with open(os.path.join(FONT, nome), 'rb') as f: return base64.b64encode(f.read()).decode()

STILE = lambda: ('<style>@font-face{font-family:B;src:url(data:font/woff2;base64,' + font64('BricolageGrotesque-normal-latin.woff2')
                 + ') format("woff2");font-weight:200 800;font-stretch:75% 100%}text{font:800 100px B;font-stretch:88%;letter-spacing:-.025em}</style>')

def orizzontale(inchiostro, sfondo=None):
    # symbol 120 tall at the left, the word to its right; the baseline sits on the badge's visual bottom
    fondo = f'<rect width="560" height="140" fill="{sfondo}"/>' if sfondo else ''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 140" width="560" height="140">{STILE()}{fondo}'
            f'<g transform="translate(0 12) scale(1.16)">{dentro(simbolo("due", inchiostro=inchiostro))}</g>'
            f'<text x="134" y="106" fill="{inchiostro}">Repobay</text></svg>')

def impilato(inchiostro, sfondo=None):
    fondo = f'<rect width="400" height="300" fill="{sfondo}"/>' if sfondo else ''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="400" height="300">{STILE()}{fondo}'
            f'<g transform="translate(140 8) scale(1.2)">{dentro(simbolo("due", inchiostro=inchiostro))}</g>'
            f'<text x="200" y="256" text-anchor="middle" fill="{inchiostro}">Repobay</text></svg>')

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    file = {
        'simbolo.svg': simbolo('due'), 'simbolo-chiaro.svg': simbolo('due', inchiostro='#F3EFFA'), 'simbolo-piatto.svg': simbolo('piatto'),
        'simbolo-mono.svg': simbolo('mono', inchiostro='currentColor'), 'simbolo-mono-nero.svg': simbolo('mono'), 'simbolo-mono-bianco.svg': simbolo('mono', inchiostro=BIANCO),
        'simbolo-mono-viola.svg': simbolo('mono', inchiostro=VIOLA), 'adesivo.svg': simbolo('adesivo'), 'adesivo-chiaro.svg': simbolo('adesivo', inchiostro='#F3EFFA'),
        'logo.svg': orizzontale(NERO), 'logo-chiaro.svg': orizzontale(BIANCO),
        'logo-impilato.svg': impilato(NERO), 'logo-impilato-chiaro.svg': impilato(BIANCO),
    }
    for n, s in file.items():
        with open(os.path.join(OUT, n), 'w') as f: f.write(s)
    print('scritti', len(file), 'in', OUT)
    # the PNGs (app icons, social, places that don't take SVG): rendered by Chromium on a transparent background
    import asyncio, base64
    from playwright.async_api import async_playwright
    async def png():
        async with async_playwright() as p:
            b = await p.chromium.launch()
            for nome, w, h, sorgente in [('icona-512.png', 512, 512, 'simbolo-piatto.svg'), ('icona-1024.png', 1024, 1024, 'simbolo-piatto.svg'),
                                         ('simbolo.png', 480, 480, 'simbolo.svg'), ('adesivo.png', 480, 480, 'adesivo.svg'), ('logo.png', 1680, 420, 'logo.svg'), ('logo-chiaro.png', 1680, 420, 'logo-chiaro.svg'),
                                         ('logo-impilato.png', 1200, 900, 'logo-impilato.svg'), ('logo-impilato-chiaro.png', 1200, 900, 'logo-impilato-chiaro.svg')]:
                pg = await b.new_page(viewport={'width': w, 'height': h})
                # the SVG goes in as a data: URL: from the blank page Chromium refuses file:// images (and the PNG came out as a broken image)
                with open(os.path.join(OUT, sorgente), 'rb') as f: dati = base64.b64encode(f.read()).decode()
                await pg.set_content(f'<body style="margin:0;background:transparent"><img src="data:image/svg+xml;base64,{dati}" style="width:{w}px;height:{h}px;display:block"></body>')
                await pg.wait_for_function('document.images[0].complete && document.images[0].naturalWidth > 0')
                await pg.wait_for_timeout(600); await pg.screenshot(path=os.path.join(OUT, nome), omit_background=True); await pg.close()
            await b.close()
    asyncio.run(png()); print('png ok')
