# Il marchio Repobay: la porta del negozio (architrave spesso come l'insegna, due stipiti) e dentro, a terra, il quadrato viola,
# il programma che entra nell'attività. La parola è Mona Sans 800, larghezza 110, tracciata come contorni: i file non dipendono
# da nessun carattere. Scrive web/marchio/*.svg e web/icona.svg; i PNG li fa png.mjs. Le regole d'uso: web/marchio/README.md.
#
#   pip install fonttools uharfbuzz        (solo per rigenerare i file; Repobay non ne ha bisogno)
#   python3 strumenti/marchio/logo.py
#
# Il carattere variabile MonaSans[wdth,wght].ttf sta qui accanto, con la sua licenza (OFL-MonaSans.txt, github.com/github/mona-sans).
import os, sys, io
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
import uharfbuzz as hb

QUI = os.path.dirname(os.path.abspath(__file__)); RADICE = os.path.normpath(os.path.join(QUI, '..', '..'))
OUT = os.path.join(RADICE, 'web', 'marchio'); FONT = os.path.join(QUI, 'MonaSans[wdth,wght].ttf')
INK, VIOLA, VIOLA_NOTTE, BIANCO = '#15112B', '#6D3BFF', '#8B63FF', '#FFFFFF'

# ---- il segno, su un quadrato di 100 unità ----
PORTA = 'M12 10H88V90H74V32H26V90H12Z'
def segno(porta, prodotto, x=0, y=0, s=1.0):
    return (f'<g transform="translate({x} {y}) scale({s})"><path fill="{porta}" d="{PORTA}"/>'
            f'<rect x="38" y="66" width="24" height="24" fill="{prodotto}"/></g>')
def svg(corpo, vb, w, h): return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" width="{w}" height="{h}">{corpo}</svg>'
def tessera(fondo, porta, prodotto, rx=22, s=0.74):
    o = 50 - 50 * s
    return f'<rect width="100" height="100" rx="{rx}" fill="{fondo}"/>' + segno(porta, prodotto, o, o, s)

# ---- la parola: Mona Sans istanziata a 800/110, modellata con HarfBuzz (crenatura compresa), ogni glifo come tracciato ----
class Parola:
    def __init__(self, wght=800, wdth=110, tracking=-0.025):
        self.f = instantiateVariableFont(TTFont(FONT), {'wght': wght, 'wdth': wdth}, inplace=False)
        self.upm = self.f['head'].unitsPerEm; self.cap = self.f['OS/2'].sCapHeight / self.upm
        b = io.BytesIO(); self.f.save(b); self.hb = hb.Font(hb.Face(b.getvalue())); self.hb.scale = (self.upm, self.upm)
        self.glifi = self.f.getGlyphSet(); self.ordine = self.f.getGlyphOrder(); self.tracking = tracking
    def tracciati(self, testo, size, x0, baseline):
        """→ (i path della parola, la sua larghezza), con il corpo `size` e la base a y=baseline"""
        buf = hb.Buffer(); buf.add_str(testo); buf.guess_segment_properties()
        hb.shape(self.hb, buf, {'kern': True, 'liga': True})
        k = size / self.upm; x = x0; out = []
        for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
            pen = SVGPathPen(self.glifi, ntos=lambda v: f'{v:.2f}'.rstrip('0').rstrip('.'))
            # dal sistema del carattere (y verso l'alto) al disegno (y verso il basso): scala, specchio, traslazione
            self.glifi[self.ordine[info.codepoint]].draw(TransformPen(pen, (k, 0, 0, -k, x + pos.x_offset * k, baseline - pos.y_offset * k)))
            d = pen.getCommands()
            if d: out.append(d)
            x += pos.x_advance * k + self.tracking * size
        return ' '.join(out), x - self.tracking * size - x0   # niente spaziatura dopo l'ultima lettera

def scrivi():
    os.makedirs(OUT, exist_ok=True); P = Parola(); pad = 10
    def f(nome, contenuto): open(os.path.join(OUT, nome), 'w').write(contenuto)
    # il simbolo da solo
    f('simbolo.svg', svg(segno(INK, VIOLA), '0 0 100 100', 100, 100))
    f('simbolo-chiaro.svg', svg(segno(BIANCO, VIOLA_NOTTE), '0 0 100 100', 100, 100))
    f('simbolo-mono.svg', svg(segno('currentColor', 'currentColor'), '0 0 100 100', 100, 100))
    for nome, col in [('nero', INK), ('bianco', BIANCO), ('viola', VIOLA)]: f(f'simbolo-mono-{nome}.svg', svg(segno(col, col), '0 0 100 100', 100, 100))
    # la tessera (icona dell'app, favicon, segnalibri) e la sua versione notte; la favicon del sito è la tessera
    f('simbolo-piatto.svg', svg(tessera(VIOLA, BIANCO, BIANCO), '0 0 100 100', 100, 100))
    f('simbolo-piatto-notte.svg', svg(tessera(INK, BIANCO, VIOLA_NOTTE), '0 0 100 100', 100, 100))
    open(os.path.join(RADICE, 'web', 'icona.svg'), 'w').write(svg(tessera(VIOLA, BIANCO, BIANCO), '0 0 100 100', 100, 100))
    # la firma orizzontale: segno 100, parola con le maiuscole alte 58 (la luce della porta), base sulla soglia (y 90), 26 di aria
    size = 58 / P.cap; x0 = 100 + 26
    percorso, larg = P.tracciati('Repobay', size, x0, 90); W = x0 + larg
    vb = f'{-pad} {-pad} {W + 2*pad:.1f} {100 + 2*pad}'
    for nome, porta, prodotto, testo in [('logo', INK, VIOLA, INK), ('logo-chiaro', BIANCO, VIOLA_NOTTE, BIANCO), ('logo-mono', 'currentColor', 'currentColor', 'currentColor')]:
        f(f'{nome}.svg', svg(segno(porta, prodotto) + f'<path fill="{testo}" d="{percorso}"/>', vb, round(W + 2*pad, 1), 100 + 2*pad))
    # la firma impilata: segno 100 centrato sopra, parola con le maiuscole alte 40, 24 di aria
    size2 = 40 / P.cap
    _, larg2 = P.tracciati('Repobay', size2, 0, 0)
    W2 = max(100, larg2); cx = W2 / 2; base2 = 100 + 24 + 40; H2 = base2 + 0.22 * size2   # sotto, lo spazio della discendente della y
    percorso2, _ = P.tracciati('Repobay', size2, cx - larg2 / 2, base2)
    vb2 = f'{-pad} {-pad} {W2 + 2*pad:.1f} {H2 + 2*pad:.1f}'
    for nome, porta, prodotto, testo in [('logo-impilato', INK, VIOLA, INK), ('logo-impilato-chiaro', BIANCO, VIOLA_NOTTE, BIANCO)]:
        f(f'{nome}.svg', svg(segno(porta, prodotto, cx - 50, 0) + f'<path fill="{testo}" d="{percorso2}"/>', vb2, round(W2 + 2*pad, 1), round(H2 + 2*pad, 1)))
    # l'avatar per i social: la tessera senza angoli (li taglia il cerchio del profilo), segno più piccolo per stare nel tondo
    f('avatar.svg', svg(f'<rect width="100" height="100" fill="{VIOLA}"/>' + segno(BIANCO, BIANCO, 17, 17, 0.66), '0 0 100 100', 1080, 1080))
    print('scritti i file SVG in web/marchio e web/icona.svg; ora: node strumenti/marchio/png.mjs')

if __name__ == '__main__':
    scrivi()
