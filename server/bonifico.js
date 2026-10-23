// Il pagamento con bonifico, senza nessuno in mezzo: il business manda un bonifico (istantaneo, se la sua banca lo fa: dal
// 9 ottobre 2025 nell'area euro costa come uno normale, regolamento UE 2024/886) all'IBAN della piattaforma, con una causale
// unica per ordine. Chi gestisce la piattaforma lo segna ricevuto dal pannello, a mano o incollando l'estratto conto: qui le
// parti pure (IBAN, causale, il QR EPC che le app delle banche leggono, la lettura dell'estratto conto).
import { randomInt } from 'node:crypto';

// ---------------- IBAN ----------------
// le lunghezze dei paesi SEPA più comuni; gli altri passano col solo controllo mod-97
const LUNGHEZZE = { IT: 27, SM: 27, VA: 22, DE: 22, FR: 27, ES: 24, PT: 25, NL: 18, BE: 16, LU: 20, AT: 20, IE: 22, CH: 21, LI: 21,
  MT: 31, GR: 27, CY: 28, SI: 19, HR: 21, SK: 24, CZ: 24, PL: 28, HU: 28, RO: 24, BG: 22, LT: 20, LV: 21, EE: 20, FI: 18, DK: 18,
  SE: 24, NO: 15, IS: 26, GB: 22, MC: 27 };
export const ibanPulito = s => String(s || '').replace(/[\s-]+/g, '').toUpperCase();
export function ibanValido(s) {
  const x = ibanPulito(s);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(x)) return false;
  if (LUNGHEZZE[x.slice(0, 2)] && LUNGHEZZE[x.slice(0, 2)] !== x.length) return false;
  // mod-97 (ISO 13616): le prime quattro in fondo, le lettere in numeri (A = 10), il resto a pezzi per non uscire dai Number
  const numeri = (x.slice(4) + x.slice(0, 4)).replace(/[A-Z]/g, c => String(c.charCodeAt(0) - 55));
  let r = 0; for (let i = 0; i < numeri.length; i += 7) r = Number(String(r) + numeri.slice(i, i + 7)) % 97;
  return r === 1;
}
export const ibanLeggibile = s => ibanPulito(s).replace(/(.{4})(?=.)/g, '$1 ');   // IT60 X054 2811 1010 0000 0123 456

// ---------------- causale ----------------
// «RB-7K2Q9M»: corta da scrivere a mano, senza lettere che si confondono (0/O, 1/I/L, 5/S, 8/B, 2/Z)
const ALFABETO = 'ACDEFGHJKMNPQRTUVWXY34679';
export const CAUSALE = /^RB-[ACDEFGHJKMNPQRTUVWXY34679]{6}$/;
export function causaleNuova(occupata = () => false) {
  for (let i = 0; i < 50; i++) {
    const c = 'RB-' + Array.from({ length: 6 }, () => ALFABETO[randomInt(ALFABETO.length)]).join('');
    if (!occupata(c)) return c;
  }
  throw new Error('Non trovo una causale libera');
}

// ---------------- il QR del bonifico (EPC069-12, «GiroCode») ----------------
// versione 002 (il BIC si può lasciare vuoto nello Spazio economico europeo), caratteri UTF-8, bonifico SEPA; la causale come
// testo libero. Molte app bancarie lo leggono e compilano il bonifico; per le altre restano IBAN e causale da copiare
export function payloadEpc({ nome, iban, bic = '', importo, testo }) {
  if (!ibanValido(iban)) throw new Error('IBAN non valido');
  if (!Number.isInteger(importo) || importo < 1 || importo > 99_999_999_999) throw new Error('Importo non valido per un bonifico');
  const pulito = (s, max) => String(s || '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
  return ['BCD', '002', '1', 'SCT', pulito(bic, 11), pulito(nome, 70), ibanPulito(iban), `EUR${(importo / 100).toFixed(2)}`, '', '', pulito(testo, 140)].join('\n');
}

// ---------------- l'estratto conto ----------------
// un importo scritto come lo scrivono le banche: «1.234,56», «1,234.56», «+390,00», «390.5», «€ 29,00», «29,00 EUR» → centesimi;
// null se non è un importo (date, codici, testo)
export function importoDa(s) {
  let x = String(s ?? '').replace(/[\s €]|EUR/gi, '');
  if (!/^[+-]?(\d{1,3}([.,'’]\d{3})*|\d+)([.,]\d{1,2})?$/.test(x)) return null;
  const segno = x.startsWith('-') ? -1 : 1; x = x.replace(/^[+-]/, '').replace(/['’]/g, '');
  const dec = x.match(/[.,](\d{1,2})$/);   // un separatore seguito da una o due cifre in fondo: i decimali
  const intero = (dec ? x.slice(0, -dec[0].length) : x).replace(/[.,]/g, '');
  return segno * (Number(intero) * 100 + (dec ? Number(dec[1].padEnd(2, '0')) : 0));
}
// i campi di una riga CSV, con le virgolette ("a;b" resta un campo, "" è una virgoletta)
export function campiCsv(riga, sep) {
  const out = []; let cur = '', dentro = false;
  for (let i = 0; i < riga.length; i++) {
    const ch = riga[i];
    if (dentro) { if (ch === '"' && riga[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') dentro = false; else cur += ch; }
    else if (ch === '"') dentro = true; else if (ch === sep) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}
// il separatore dei campi: punto e virgola (le banche italiane), tabulazione (righe copiate dalla pagina della banca) o virgola
function separatore(righe) {
  const prime = righe.filter(r => r.trim()).slice(0, 20), quante = ch => prime.filter(r => r.includes(ch)).length;
  return quante(';') >= Math.max(1, prime.length / 2) ? ';' : quante('\t') >= Math.max(1, prime.length / 2) ? '\t' : ',';
}
// cerca le causali degli ordini aperti nell'estratto conto (CSV della banca, o righe copiate dalla sua pagina) e controlla
// l'importo sulla stessa riga. Non serve sapere com'è fatto il file: la causale si cerca nella riga senza spazi né trattini
// (le banche li tolgono o li cambiano), l'importo fra i campi. → { abbinati, diversi }: diversi = causale trovata ma l'importo
// non torna (pagato meno, di più, o in due volte): li guarda chi gestisce.
// L'importo si prende solo dai campi che sono un importo e basta: la descrizione la scrive chi paga, e un numero scritto lì (o una
// causale in più) non vale come pagamento. Una riga con le causali di più ordini è un bonifico solo: va guardata a mano (diversi)
export function abbina(testo, aperti) {
  const righe = String(testo || '').split(/\r?\n/), sep = separatore(righe), visti = new Set(), abbinati = [], diversi = [];
  for (const riga of righe) {
    const compatta = riga.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!compatta.includes('RB')) continue;
    const qui = aperti.filter(o => !visti.has(o.codice) && compatta.includes('RB' + o.causale.slice(3)));
    if (!qui.length) continue;
    const campi = campiCsv(riga, sep).map(c => c.trim());
    const importi = [...new Set(campi.filter(c => !/RB/i.test(c.replace(/[^A-Za-z0-9]/g, ''))).map(importoDa).filter(x => x !== null && x > 0))];
    const testoRiga = riga.trim().slice(0, 300);
    for (const o of qui) {
      visti.add(o.codice);
      if (qui.length === 1 && importi.includes(o.euro)) abbinati.push({ codice: o.codice, causale: o.causale, euro: o.euro, riga: testoRiga });
      else diversi.push({ codice: o.codice, causale: o.causale, euro: o.euro, importi, riga: testoRiga, ...(qui.length > 1 ? { motivo: 'più causali nello stesso bonifico' } : {}) });
    }
  }
  return { abbinati, diversi };
}
