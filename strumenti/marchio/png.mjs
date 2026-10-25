// I PNG del marchio dai suoi SVG (web/marchio), con resvg. Si lancia dopo logo.py, dalla cartella del repository:
//
//   npm i --no-save --prefix strumenti/marchio @resvg/resvg-js   (una volta: resvg non è una dipendenza di Repobay)
//   node strumenti/marchio/png.mjs
//
// La parola è già tracciata nei file SVG, quindi non serve nessun carattere installato.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const qui = fileURLToPath(new URL('.', import.meta.url)), marchio = join(qui, '..', '..', 'web', 'marchio');
const { Resvg } = createRequire(join(qui, 'node_modules', '@resvg', 'resvg-js', 'package.json'))('@resvg/resvg-js');

// sorgente → file PNG e larghezza in pixel
const USCITE = [
  ['simbolo.svg', 'simbolo.png', 512], ['simbolo-chiaro.svg', 'simbolo-chiaro.png', 512],
  ['logo.svg', 'logo.png', 1600], ['logo-chiaro.svg', 'logo-chiaro.png', 1600],
  ['logo-impilato.svg', 'logo-impilato.png', 1000], ['logo-impilato-chiaro.svg', 'logo-impilato-chiaro.png', 1000],
  ['simbolo-piatto.svg', 'icona-512.png', 512], ['simbolo-piatto.svg', 'icona-1024.png', 1024], ['simbolo-piatto-notte.svg', 'icona-notte-512.png', 512],
  ['avatar.svg', 'instagram-1080.png', 1080],
];
for (const [da, a, larghezza] of USCITE) {
  const r = new Resvg(readFileSync(join(marchio, da), 'utf8'), { fitTo: { mode: 'width', value: larghezza } }).render();
  writeFileSync(join(marchio, a), r.asPng());
  console.log(a, `${r.width}x${r.height}`);
}
