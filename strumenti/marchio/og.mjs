// L'anteprima social di Repobay (web/img/og.png e og.webp, 1200×630): la firma orizzontale, il titolo, una riga di sottotitolo
// e la tessera del marchio, composti in SVG e resi con resvg. Il titolo è Mona Sans tracciato con fontkit dal carattere variabile
// qui accanto, perciò l'immagine non dipende da nessun carattere installato. Prende il posto della scena 3D di strumenti/3d/og.py.
// I colori sono quelli del marchio (web/marchio/README.md): niente sfumature, niente ombre.
//
//   npm i --no-save --prefix /tmp/og-strumenti @resvg/resvg-js fontkit sharp   (in una cartella fuori dal repo: non sono dipendenze di Repobay)
//   NODE_PATH=/tmp/og-strumenti/node_modules node strumenti/marchio/og.mjs [--carta] [cartella-di-uscita]
//
// Senza opzioni scrive in web/img la versione notte (fondo inchiostro, come l'eroe del sito); --carta la fa su fondo chiaro.
// Va bene anche  npm i --no-save --prefix strumenti/marchio …  come per png.mjs (node_modules è ignorata da git).
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { Resvg } = require('@resvg/resvg-js'), fontkit = require('fontkit'), sharp = require('sharp');
const QUI = fileURLToPath(new URL('.', import.meta.url)), RADICE = join(QUI, '..', '..');
const argomenti = process.argv.slice(2), carta = argomenti.includes('--carta');
const USCITA = argomenti.find(a => !a.startsWith('--')) || join(RADICE, 'web', 'img');

const INK = '#15112B', VIOLA = '#6D3BFF', VIOLA_NOTTE = '#8B63FF', CARTA = '#F7F6FB', BIANCO = '#FFFFFF';
const PORTA = 'M12 10H88V90H74V32H26V90H12Z';   // il segno su un quadrato di 100 unità, come in logo.py
const W = 1200, H = 630, M = 72;                 // misura dell'anteprima e margine

// i colori del testo seguono stile.css: inchiostro/bianco per il titolo, --inchiostro-2 per il sottotitolo, --spento per il dominio
const T = carta
  ? { fondo: CARTA, testo: INK, accento: VIOLA, tenue: '#4B4668', spento: '#716C8C', firma: 'logo.svg' }
  : { fondo: INK, testo: BIANCO, accento: VIOLA_NOTTE, tenue: '#BDB7D8', spento: '#9690B3', firma: 'logo-chiaro.svg' };

const TITOLO = [['Dal repo', T.testo], ['al negozio', T.accento], ['sotto casa.', T.accento]];
const SOTTOTITOLO = ['Il software open source, installato', 'nelle attività vere.'];

// ---- il testo come tracciati: Mona Sans istanziata al peso voluto, modellata da fontkit (crenatura compresa) ----
const mona = fontkit.openSync(join(QUI, 'MonaSans[wdth,wght].ttf')), CAP = mona.capHeight / mona.unitsPerEm;
function traccia(testo, { size, wght, tracking = 0, x, baseline }) {
  const f = mona.getVariation({ wght, wdth: 100 }), run = f.layout(testo, { kern: true, liga: true }), k = size / f.unitsPerEm;
  let cx = x; const d = [];
  for (let i = 0; i < run.glyphs.length; i++) {
    const p = run.positions[i];
    // dal sistema del carattere (y verso l'alto) al disegno (y verso il basso): scala, specchio, traslazione
    const s = run.glyphs[i].path.transform(k, 0, 0, -k, cx + p.xOffset * k, baseline - p.yOffset * k).toSVG();
    if (s) d.push(s.replace(/(\d+\.\d{2})\d+/g, '$1'));
    cx += p.xAdvance * k + tracking * size;
  }
  return d.join(' ');
}

// ---- i pezzi ----
const segno = (porta, prodotto, x, y, s) =>
  `<g transform="translate(${x} ${y}) scale(${s})"><path fill="${porta}" d="${PORTA}"/><rect x="38" y="66" width="24" height="24" fill="${prodotto}"/></g>`;
// la tessera: fondo viola con gli angoli a 22, segno bianco al 74% (le stesse misure di simbolo-piatto.svg)
const tessera = (x, y, lato) => `<g transform="translate(${x} ${y}) scale(${lato / 100})"><rect width="100" height="100" rx="22" fill="${VIOLA}"/>${segno(BIANCO, BIANCO, 13, 13, 0.74)}</g>`;
// la firma orizzontale dal file del marchio, già tracciata: il contenuto senza il tag esterno, col segno alto `altezza` px
function firma(x, y, altezza) {
  const svg = readFileSync(join(RADICE, 'web', 'marchio', T.firma), 'utf8');
  return `<g transform="translate(${x} ${y}) scale(${altezza / 100})">${svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')}</g>`;
}

// ---- la composizione: a sinistra firma, titolo, sottotitolo e dominio; a destra la tessera ----
const parti = [`<rect width="${W}" height="${H}" fill="${T.fondo}"/>`, firma(M, 56, 44)];
const corpo = 88, interlinea = 0.98; let base = 158 + CAP * corpo;   // le maiuscole del titolo partono da y 158
for (const [riga, colore] of TITOLO) { parti.push(`<path fill="${colore}" d="${traccia(riga, { size: corpo, wght: 700, tracking: -0.03, x: M, baseline: base })}"/>`); base += corpo * interlinea; }
base += 48 - corpo * interlinea + corpo * 0.1;
for (const riga of SOTTOTITOLO) { parti.push(`<path fill="${T.tenue}" d="${traccia(riga, { size: 30, wght: 450, tracking: -0.005, x: M, baseline: base })}"/>`); base += 30 * 1.4; }
parti.push(`<path fill="${T.spento}" d="${traccia('repobay.net', { size: 22, wght: 550, x: M, baseline: H - 56 })}"/>`);
const lato = 380; parti.push(tessera(W - M - lato, (H - lato) / 2, lato));
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${parti.join('')}</svg>`;

// ---- PNG con resvg (senza canale alfa: l'immagine è tutta opaca), WebP con sharp, stessa qualità di strumenti/3d/webp.py ----
mkdirSync(USCITA, { recursive: true });
const reso = sharp(new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng()).removeAlpha();
writeFileSync(join(USCITA, 'og.png'), await reso.clone().png({ compressionLevel: 9 }).toBuffer());
await reso.webp({ quality: 86, effort: 6 }).toFile(join(USCITA, 'og.webp'));
console.log(`og.png e og.webp (${W}×${H}, ${carta ? 'carta' : 'notte'}) in ${USCITA}`);
