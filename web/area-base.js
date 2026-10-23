// Gli attrezzi dell'area personale: lo stato (i dati di /api/io), i «blocchi» che si ridisegnano da soli dopo un'azione
// (senza toccare il resto della pagina: quello che si sta scrivendo altrove resta), stati vuoti, caricamento, piccoli pezzi.
import { el, t, chiama, pillola, euro, data } from './comune.js';

export const S = { io: null, preso: 0 };
export async function prendiIo() {
  S.io = await chiama('GET', '/api/io'); S.preso = Date.now();
  document.dispatchEvent(new CustomEvent('area:io'));
  return S.io;
}

// un blocco: un pezzo di sezione con la sua funzione di disegno (anche asincrona); aggiorna(id) lo ridisegna con i dati nuovi
const blocchi = new Map();
export function blocco(id, disegna, classe = '') {
  const b = el('div', { class: `blocco ${classe}`.trim(), dati: { blocco: id } });
  blocchi.set(id, disegna);
  riempi(b, disegna);
  return b;
}
async function riempi(b, disegna) {
  const prima = fotografa(b), r = disegna(S.io);
  if (r instanceof Promise) {
    if (!b.childElementCount) b.replaceChildren(scheletro(3));
    try { b.replaceChildren(...[await r].flat().filter(Boolean)); }
    catch (e) { b.replaceChildren(el('div', { class: 'avviso errore' }, e.message || t('Qualcosa non ha funzionato: riprova'))); }
  } else b.replaceChildren(...[r].flat().filter(Boolean));
  rimetti(b, prima);
}
// quello che si stava scrivendo (e le parti aperte) sopravvive al ridisegno del blocco
const chiaveDi = (x, i) => `${x.closest('[data-chiave]')?.dataset.chiave || ''}|${x.name || x.querySelector?.('summary')?.textContent || ''}|${i}`;
function fotografa(b) {
  const f = { campi: new Map(), aperti: new Set() }, conta = new Map();
  for (const x of b.querySelectorAll('input[name]:not([type=checkbox]):not([type=radio]):not([type=hidden]), textarea[name]')) {
    const k0 = chiaveDi(x, 0), i = conta.get(k0) || 0; conta.set(k0, i + 1);
    if (x.value !== x.defaultValue) f.campi.set(chiaveDi(x, i), x.value);
  }
  b.querySelectorAll('details[open]').forEach(d => f.aperti.add(chiaveDi(d, 0)));
  return f;
}
function rimetti(b, f) {
  if (!f.campi.size && !f.aperti.size) return;
  const conta = new Map();
  for (const x of b.querySelectorAll('input[name]:not([type=checkbox]):not([type=radio]):not([type=hidden]), textarea[name]')) {
    const k0 = chiaveDi(x, 0), i = conta.get(k0) || 0; conta.set(k0, i + 1);
    const v = f.campi.get(chiaveDi(x, i)); if (v !== undefined && x.value === x.defaultValue) x.value = v;
  }
  b.querySelectorAll('details').forEach(d => { if (f.aperti.has(chiaveDi(d, 0))) d.open = true; });
}
// ridisegna i blocchi indicati (dopo aver riletto /api/io, se serve)
export async function aggiorna(ids, { rileggi = true } = {}) {
  if (rileggi) { try { await prendiIo(); } catch { } }
  for (const id of [ids].flat()) {
    const b = document.querySelector(`[data-blocco="${id}"]`), f = blocchi.get(id);
    if (b && f) await riempi(b, f);
  }
}

export const scheletro = (n = 3, alto = false) => el('div', { class: 'scheletri', 'aria-busy': 'true', 'aria-label': t('Caricamento') },
  ...Array.from({ length: n }, (_, i) => el('div', { class: `scheletro${alto ? ' alto' : ''}${i === n - 1 ? ' corto' : ''}` })));
// lo stato vuoto: l'illustrazione (la scatola vuota), il titolo, il testo e (se c'è) un'azione
export const vuoto = (titolo, testo, azione = null) => el('div', { class: 'vuoto vuoto-area' },
  el('div', { class: 'vuoto-img', 'aria-hidden': 'true' }, el('img', { src: '/img/sobrio/vuoto.svg', alt: '', width: '320', height: '320', loading: 'lazy', decoding: 'async', onerror: e => e.currentTarget.classList.add('mancante'), onload: e => e.currentTarget.classList.add('caricata') })),
  el('div', { class: 'vuoto-testo' }, el('h3', {}, t(titolo)), testo ? el('p', {}, t(testo)) : null, azione ? el('div', { class: 'azioni' }, azione) : null));

// il contatore meccanico: ogni cifra su una rotella (i centesimi nel colore, gli zeri davanti spenti), i separatori fuori;
// chi legge con lo screen reader sente il numero intero
export function rotelle(testo, zeri = 0) {
  const s0 = String(testo), s = zeri && /^\d+$/.test(s0) ? s0.padStart(zeri, '0') : s0;
  const sep = Math.max(s.lastIndexOf(','), s.lastIndexOf('.')), cent = sep >= 0 && /^\d{2}\D*$/.test(s.slice(sep + 1)) ? sep : -1;
  let davanti = true, k = 0;
  const pezzi = [...s].map((c, i) => {
    if (!/\d/.test(c)) return el('span', { class: /\s/.test(c) ? 'spazio' : 'sep' }, /\s/.test(c) ? '' : c);
    const zero = davanti && c === '0' && i < s.length - 1 && zeri > 0; if (c !== '0' || !zeri) davanti = false;
    const r = el('span', { class: `rotella${cent >= 0 && i > cent ? ' cent' : ''}${zero ? ' zero' : ''}` }, el('span', {}, c));
    r.style.setProperty('--i', String(k++)); return r;
  });
  return el('span', { class: 'rotelle' }, el('span', { class: 'sr' }, s0), el('span', { class: 'ruote', 'aria-hidden': 'true' }, ...pezzi));
}
// uno strumento del cruscotto: indice, etichetta, spia del colore, le rotelle e una nota
export function contatore({ n, etichetta, valore, nota, colore = 'inchiostro', href, zeri = 0 }) {
  return el(href ? 'a' : 'div', { class: `contatore-m colore-${colore}`, href },
    el('div', { class: 'testa-m' }, el('span', { class: 'indice' }, n), el('span', { class: 'etichetta' }, t(etichetta)), el('i', { class: 'spia', 'aria-hidden': 'true' })),
    rotelle(valore, zeri), nota ? el('div', { class: 'nota-m' }, nota) : null);
}
export const testa = (titolo, sotto, ...destra) => el('div', { class: 'testa-sezione' }, el('div', {}, el('h2', {}, t(titolo)), sotto ? el('p', { class: 'tenue' }, t(sotto)) : null),
  destra.length ? el('div', { class: 'azioni' }, ...destra) : null);
export const carta = (attr, ...figli) => el('div', { ...attr, class: `carta ${attr?.class || ''}`.trim() }, ...figli);
export const titoletto = (testo, ...destra) => el('div', { class: 'titoletto' }, el('h3', {}, t(testo)), destra.length ? el('div', { class: 'azioni' }, ...destra) : null);
export const bottone = (testo, classe, onclick, attr = {}) => el('button', { type: 'button', class: `bottone ${classe || ''}`.trim(), onclick, ...attr }, t(testo));
export const link = (testo, href, classe = 'bottone secondario', attr = {}) => el('a', { href, class: classe, ...attr }, t(testo));
export const messaggio = () => el('div', { class: 'messaggio', role: 'status', 'aria-live': 'polite' });
export const bene = (m, testo) => { m.className = 'messaggio bene'; m.textContent = t(testo); };
export const campo = (etichetta, input, aiuto) => el('label', {}, el('span', {}, t(etichetta)), input, aiuto ? el('span', { class: 'aiuto' }, t(aiuto)) : null);
export const corto = a => (a && a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a || '');
export const pubblico = s => el('span', { 'data-no-t': '' }, s ?? '');   // testi scritti dagli utenti: non si traducono

// gli stati, con le parole per le persone
const STATI = { bozza: 'bozza', revisione: 'in revisione', pubblicato: 'pubblicato', respinto: 'da rivedere', sospeso: 'sospeso', ritirato: 'ritirato',
  in_attesa: 'in attesa', in_escrow: 'in escrow', versata: 'versata', annullata: 'annullata', attivo: 'attivo', cessato: 'cessato', invitato: 'invitato', in_coda: 'in coda',
  consegnata: 'consegnata', fallita: 'fallita', spento: 'spento' };
export const stato = s => pillola(STATI[s] || s, s);
export const RUOLI = { builder: 'builder', installatore: 'installatore', collaboratore: 'collaboratore', piattaforma: 'piattaforma' };
export const ruolo = r => t(RUOLI[r] || r);
export const somma = (io, filtro) => io.totali.filter(filtro).reduce((s, x) => s + x.centesimi, 0);
export { euro, data };

// una tabella dentro .tabella; righe vuote → niente (chi chiama mostra lo stato vuoto)
export function tabella(intestazioni, righe) {
  return el('div', { class: 'tabella' }, el('table', {}, el('thead', {}, el('tr', {}, ...intestazioni.map(h => {
    const [testo, num] = Array.isArray(h) ? h : [h, false]; return el('th', num ? { class: 'num' } : {}, t(testo));
  }))), el('tbody', {}, ...righe)));
}

// la divisione di un prezzo, uguale a quella del server: prima il costo della carta, poi la piattaforma (arrotondata) su quello che
// resta, poi il resto fra installatore (per difetto) e builder
export function dividi(base, qi, qp, costo = 0) { const c = Math.max(0, Math.min(base, Math.round(costo))), p = c + Math.round((base - c) * qp), i = Math.floor((base - p) * qi); return { costo: c, builder: base - i - p, installatore: i, piattaforma: p }; }
// la barra delle quote: le parti in proporzione, con la legenda; con carta il costo di Stripe (stimato) è una parte a sé, a righe
export function barraQuote() {
  const parti = ['b', 'i', 'p', 'c'].map(c => el('span', { class: c }));
  const barra = el('div', { class: 'barra-quote', 'aria-hidden': 'true' }, ...parti), legenda = el('div', { class: 'legenda' });
  const nodo = el('div', { class: 'quote-anteprima' }, barra, legenda);
  nodo.aggiorna = (base, qi, qp, costo = 0) => {
    const d = dividi(base, qi, qp, costo), tot = base || 1, valori = [d.builder, d.installatore, d.piattaforma - d.costo, d.costo];
    valori.forEach((v, k) => parti[k].style.setProperty('--w', `${base ? v / tot * 100 : [(1 - qp) * (1 - qi) * 100, (1 - qp) * qi * 100, qp * 100, 0][k]}%`));
    legenda.replaceChildren(...[['b', 'a te (e a chi mantiene il progetto con te)', valori[0]], ['i', 'a chi lo vende', valori[1]], ['p', 'alla piattaforma', valori[2]], ['c', 'alla carta (Stripe, stima)', valori[3]]]
      .filter(([c, , v]) => c !== 'c' || v > 0).map(([c, x, v]) => el('span', {}, el('i', { class: c }), base ? `${euro(v)} ${t(x)}` : t(x))));
  };
  return nodo;
}

// scarica un testo come file (i codici di recupero, l'esportazione)
export function scarica(nome, contenuto, tipo = 'text/plain') {
  const u = URL.createObjectURL(new Blob([contenuto], { type: `${tipo};charset=utf-8` }));
  const a = el('a', { href: u, download: nome }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 2000);
}
