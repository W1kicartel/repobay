// Gli attrezzi condivisi dalle pagine: chiamate al server, formati (euro, date) nella lingua scelta, elementi creati senza HTML
// dai dati, avvisi a comparsa, finestre di conferma, bottoni che girano mentre aspettano, copia negli appunti.
import { t, lingua, pronta } from './lingua.js';
export { t, lingua, pronta };
export const $ = (s, d = document) => d.querySelector(s);
export const $$ = (s, d = document) => [...d.querySelectorAll(s)];
const loc = () => (lingua === 'en' ? 'en-IE' : 'it-IT');
export const euro = cent => (Number(cent || 0) / 100).toLocaleString(loc(), { style: 'currency', currency: 'EUR', useGrouping: 'always' });   // «1.490 €», anche sotto i diecimila
export const percento = q => `${Math.round(Number(q) * 100)}%`;
export const data = s => s ? new Date(String(s).includes('T') ? s : String(s).replace(' ', 'T') + 'Z').toLocaleDateString(loc(), { day: 'numeric', month: 'short', year: 'numeric' }) : '';
export const dataOra = s => s ? new Date(String(s).includes('T') ? s : String(s).replace(' ', 'T') + 'Z').toLocaleString(loc(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
export const conta = (n, uno, tanti) => `${n} ${t(n === 1 ? uno : tanti)}`;

export async function chiama(metodo, percorso, corpo) {
  const r = await fetch(percorso, { method: metodo, headers: corpo !== undefined ? { 'content-type': 'application/json' } : {}, body: corpo !== undefined ? JSON.stringify(corpo) : undefined, credentials: 'same-origin' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.errore || t('Qualcosa non ha funzionato: riprova')), { stato: r.status, dati: j });
  return Object.assign(j, { _stato: r.status });
}

// el('a', { href, class: 'bottone' }, 'testo', figlio…): niente innerHTML con i dati
export function el(tag, attr = {}, ...figli) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attr || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v; else if (k === 'testo') e.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'dati') for (const [d, x] of Object.entries(v)) e.dataset[d] = x;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const f of figli.flat()) if (f !== null && f !== undefined && f !== false) e.append(f instanceof Node ? f : String(f));
  return e;
}
export function riga(celle) { return el('tr', {}, ...celle.map(c => el('td', c && c.classe ? { class: c.classe } : {}, c && c.valore !== undefined ? c.valore : c))); }
export const pillola = (testo, classe) => el('span', { class: `pillola ${classe || testo}` }, t(String(testo).replace(/_/g, ' ')));
export const stelle = (v, max = 5) => el('span', { class: 'stelle', 'aria-label': t('{v} stelle su {max}', { v, max }) }, ...Array.from({ length: max }, (_, i) => el('span', { class: i < Math.round(v) ? '' : 'vuota' }, '★')));
// l'SVG che arriva dal server (i QR): letto come SVG, non come HTML
export function svg(testo) { const d = new DOMParser().parseFromString(testo, 'image/svg+xml').documentElement; return d.nodeName === 'svg' ? document.importNode(d, true) : el('span'); }
export const iniziali = nome => String(nome || '?').split(/\s+/).map(x => x[0]).join('').slice(0, 2).toUpperCase();
export function avatar(u, classe = '') { return u?.avatar ? el('img', { class: `avatar ${classe}`, src: u.avatar, alt: '' }) : el('span', { class: `avatar ${classe}`, 'aria-hidden': 'true' }, iniziali(u?.nome)); }

// ---------------- avvisi, conferme, attese ----------------
let avvisi;
export function avviso(testo, { errore = false, durata = 4200 } = {}) {
  if (!avvisi) { avvisi = el('div', { class: 'avvisi', role: 'status', 'aria-live': 'polite' }); document.body.append(avvisi); }
  const x = el('div', { class: `toast${errore ? ' errore' : ''}` }, t(testo)); avvisi.append(x);
  setTimeout(() => x.remove(), durata);
}
export function conferma(titolo, testo, { si = 'Conferma', no = 'Annulla', pericolo = false, campo = null } = {}) {
  return new Promise(ok => {
    const input = campo ? el('input', { type: campo.tipo || 'text', placeholder: campo.segnaposto || '', autocomplete: campo.autocomplete || 'off' }) : null;
    const d = el('dialog', { class: 'finestra' }, el('h3', {}, t(titolo)), testo ? el('p', {}, t(testo)) : null, input ? el('label', {}, t(campo.etichetta || ''), input) : null,
      el('div', { class: 'azioni', style: null }, el('button', { class: `bottone ${pericolo ? 'pericolo' : ''}`, value: 'si' }, t(si)), el('button', { class: 'bottone secondario', value: 'no' }, t(no))));
    d.querySelector('.azioni').classList.add('fine');
    d.addEventListener('click', e => { const v = e.target.closest('button')?.value; if (v) { d.close(v); } else if (e.target === d) d.close('no'); });
    d.addEventListener('close', () => { ok(d.returnValue === 'si' ? (input ? input.value : true) : false); d.remove(); });
    document.body.append(d); d.showModal(); (input || d.querySelector('button')).focus();
  });
}
// il bottone gira finché la promessa non finisce; l'errore va nel messaggio (o in un avviso)
export async function occupato(bottone, lavoro, messaggio) {
  if (bottone) { bottone.classList.add('carica'); bottone.disabled = true; }
  if (messaggio) { messaggio.textContent = ''; messaggio.className = 'messaggio'; }
  try { return await lavoro(); }
  catch (e) { if (messaggio) messaggio.textContent = e.message; else avviso(e.message, { errore: true }); return undefined; }
  finally { if (bottone) { bottone.classList.remove('carica'); bottone.disabled = false; } }
}
export async function copia(testo, bottone) {
  try { await navigator.clipboard.writeText(testo); } catch { const a = el('textarea', {}, testo); document.body.append(a); a.select(); document.execCommand('copy'); a.remove(); }
  if (bottone) { const prima = bottone.textContent; bottone.textContent = t('Copiato'); setTimeout(() => { bottone.textContent = prima; }, 1400); } else avviso('Copiato');
}
export const dati = form => Object.fromEntries(new FormData(form));
// mostra/nasconde la password (il bottone .occhio dentro .parola)
export function occhi(radice = document) {
  for (const b of radice.querySelectorAll('.parola .occhio')) b.addEventListener('click', () => {
    const i = b.parentElement.querySelector('input'); const vedo = i.type === 'password'; i.type = vedo ? 'text' : 'password';
    b.setAttribute('aria-label', t(vedo ? 'Nascondi la password' : 'Mostra la password')); b.setAttribute('aria-pressed', String(vedo));
  });
}
export const OCCHIO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
