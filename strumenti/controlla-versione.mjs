// Controlla che il sito mandi ai browser il codice di questo repository: legge /versione (il commit che dichiara il server), poi
// scarica script, stili, immagini e pagine e li confronta, byte per byte, con i file di questa cartella.
//
//   git checkout <commit di /versione>
//   node strumenti/controlla-versione.mjs https://repobay.net
//
// Esce con 0 solo se il commit è quello di questa cartella, il server non dichiara modifiche e ogni file è uguale.
// Cosa dimostra e cosa no: vedi «Che codice gira sul sito» in deploy/LEGGIMI.md.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGINE } from '../server/app.js';

const STATICI = /^[a-z0-9/_.-]+\.(css|js|json|woff2|svg|png|webp|jpg|ico|txt|webmanifest)$/i;   // come in server/app.js
const impronta = b => createHash('sha256').update(b).digest('hex');

function fileDi(cartella) {
  return readdirSync(cartella, { withFileTypes: true, recursive: true }).filter(f => f.isFile())
    .map(f => relative(cartella, join(f.parentPath ?? f.path, f.name)).split('\\').join('/')).sort();
}

// → { versione, commitLocale, uguali, diversi: [percorso], mancanti: [percorso], saltati }
export async function controllaVersione({ url, radice = fileURLToPath(new URL('..', import.meta.url)), chiedi = fetch, insieme = 8 }) {
  const base = String(url).replace(/\/+$/, '');
  const r = await chiedi(`${base}/versione`);
  if (!r.ok) throw new Error(`${base}/versione risponde ${r.status}`);
  const versione = await r.json();
  let commitLocale = null;
  try { commitLocale = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: radice, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { }
  // le pagine HTML hanno tre segnaposto che il server riempie ({{NOME}}, {{LINGUA}}, {{URL}}): si riempiono uguali qui, in italiano
  const rotta = Object.fromEntries(Object.entries(PAGINE).map(([p, f]) => [f, p]));
  const web = join(radice, 'web'), lavori = [];
  let saltati = 0;
  for (const f of fileDi(web)) {
    if (extname(f) === '.html') {
      if (!rotta[f]) { saltati++; continue; }   // le pagine con un indirizzo variabile (/p/…, /u/…, 404) non hanno un indirizzo fisso
      lavori.push({ f, indirizzo: rotta[f], atteso: () => Buffer.from(readFileSync(join(web, f), 'utf8')
        .replaceAll('{{NOME}}', versione.nome).replaceAll('{{LINGUA}}', 'it').replaceAll('{{URL}}', versione.url)) });
    } else if (STATICI.test(f) && !f.includes('..')) lavori.push({ f, indirizzo: `/${f}`, atteso: () => readFileSync(join(web, f)) });
    else saltati++;
  }
  const diversi = [], mancanti = [];
  let uguali = 0;
  for (let i = 0; i < lavori.length; i += insieme) {
    await Promise.all(lavori.slice(i, i + insieme).map(async ({ f, indirizzo, atteso }) => {
      const x = await chiedi(base + indirizzo, { headers: { cookie: 'lingua=it', 'accept-language': 'it' } });
      if (!x.ok) { mancanti.push(f); return; }
      if (impronta(Buffer.from(await x.arrayBuffer())) === impronta(atteso())) uguali++; else diversi.push(f);
    }));
  }
  return { versione, commitLocale, uguali, diversi: diversi.sort(), mancanti: mancanti.sort(), saltati };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.argv[2];
  if (!url) { console.error('uso: node strumenti/controlla-versione.mjs https://<sito>'); process.exit(2); }
  const e = await controllaVersione({ url });
  const v = e.versione;
  console.log(`${v.nome} su ${v.url}`);
  console.log(`  commit dichiarato: ${v.commit || 'nessuno (versione.json manca sul server)'}${v.tag ? `  (tag ${v.tag})` : ''}${v.data ? `, pubblicato il ${v.data}` : ''}`);
  if (v.link) console.log(`  nel repository:    ${v.link}`);
  console.log(`  questa cartella:   ${e.commitLocale || 'non è un repository git'}`);
  let ok = !!v.commit && v.commit === e.commitLocale && !v.modificato;
  if (v.modificato) console.log('  ATTENZIONE: il server dichiara modifiche non salvate in un commit');
  if (v.commit && e.commitLocale && v.commit !== e.commitLocale) console.log(`  ATTENZIONE: commit diversi. Prima:  git checkout ${v.commit}`);
  console.log(`  file uguali: ${e.uguali}, diversi: ${e.diversi.length}, che il sito non manda: ${e.mancanti.length} (non confrontabili: ${e.saltati})`);
  for (const f of e.diversi) console.log(`    diverso:  web/${f}`);
  for (const f of e.mancanti) console.log(`    manca:    web/${f}`);
  if (e.diversi.length || e.mancanti.length) ok = false;
  console.log(ok ? 'Tutto uguale.' : 'Non coincide: vedi sopra.');
  process.exit(ok ? 0 : 1);
}
