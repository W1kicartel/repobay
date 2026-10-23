// La versione che gira: il commit del repository pubblico (e il tag del rilascio) da cui viene il codice. La scrive chi pubblica
// in versione.json, nella radice del codice (node strumenti/versione.mjs, lo fa deploy/pubblica.sh); il server la legge all'avvio e
// la mostra su /versione e nell'intestazione x-versione. Chi vuole controllare confronta il commit con il repository e lancia
// strumenti/controlla-versione.mjs, che scarica dal sito script, stili e pagine e li confronta con quel commit.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RADICE = fileURLToPath(new URL('..', import.meta.url));

// → { commit, tag, data, modificato }; commit null se il file manca o non è valido (in locale, o pubblicato senza git)
export function leggiVersione(radice = RADICE) {
  let v;
  try { v = JSON.parse(readFileSync(join(radice, 'versione.json'), 'utf8')); } catch { return { commit: null, tag: null, data: null, modificato: false }; }
  const commit = typeof v?.commit === 'string' && /^[0-9a-f]{40}$/.test(v.commit) ? v.commit : null;
  return {
    commit,
    tag: commit && typeof v.tag === 'string' && /^[\w.\/-]{1,100}$/.test(v.tag) ? v.tag : null,
    data: commit && typeof v.data === 'string' && !Number.isNaN(Date.parse(v.data)) ? v.data : null,
    // il codice pubblicato aveva modifiche non salvate in un commit: il commit da solo non lo descrive
    modificato: !!commit && v.modificato === true,
  };
}
