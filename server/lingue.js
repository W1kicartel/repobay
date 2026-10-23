// Le lingue. L'italiano è la lingua del codice e delle pagine; per l'inglese un dizionario in web/lingue/en.json, con le
// frasi italiane come chiavi (pagine, script e messaggi d'errore del server usano lo stesso). Le frasi con parti variabili
// hanno i segnaposto {nome}: «{n} installatori» → «{n} installers».
import { readFileSync, readdirSync } from 'node:fs';

let dizionari = null;
function carica() {
  if (dizionari) return dizionari;
  dizionari = { it: {} };
  // un file per area (web/lingue/en/*.json: pagine, server, email…), uniti in un dizionario solo
  dizionari.en = {};
  const cartella = new URL('../web/lingue/en/', import.meta.url);
  try { for (const f of readdirSync(cartella).filter(x => x.endsWith('.json')).sort()) Object.assign(dizionari.en, JSON.parse(readFileSync(new URL(f, cartella), 'utf8'))); }
  catch (e) { console.error('dizionario inglese:', e.message); }
  // le frasi con segnaposto diventano espressioni regolari, per tradurre anche i messaggi già composti
  dizionari.enModelli = Object.entries(dizionari.en).filter(([k]) => /\{\w+\}/.test(k)).map(([k, v]) => {
    const nomi = []; const re = new RegExp('^' + k.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\?\{(\w+)\\?\}/g, (_, n) => { nomi.push(n); return '(.+?)'; }) + '$');
    return { re, nomi, v };
  });
  return dizionari;
}

// traduce una frase già composta (es. un messaggio d'errore); se non è nel dizionario resta com'è
export function traduci(frase, lingua) {
  if (lingua !== 'en' || !frase) return frase;
  const d = carica();
  if (d.en[frase]) return d.en[frase];
  for (const m of d.enModelli) { const x = frase.match(m.re); if (x) return m.nomi.reduce((s, n, i) => s.replaceAll(`{${n}}`, () => x[i + 1]), m.v); }
  return frase;
}

// il dizionario intero per le pagine (lingua.js lo chiede a /lingue/en.json); in sviluppo si rilegge a ogni richiesta
export function dizionario(lingua) {
  if (process.env.NODE_ENV !== 'production') dizionari = null;
  return lingua === 'en' ? carica().en : {};
}
