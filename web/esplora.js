// Il catalogo: ricerca (con un attimo di attesa mentre si scrive), categoria, zona, ordine e pagine. Tutto sta nell'indirizzo,
// così una ricerca si può condividere e il tasto «indietro» torna davvero alla ricerca di prima.
import { $, el, t, chiama, conta, pronta } from './comune.js';
import { scheda, schedeFinte, nomeCategoria, svgIcona } from './vetrina.js';
await pronta;

const form = $('#filtri'), q = $('#q'), zona = $('#zona'), ordine = $('#ordine'), lista = $('#lista'), chips = $('#categorie'), conteggio = $('#conteggio'), pagine = $('#pagine'), azzera = $('#azzera');
q.before(svgIcona('cerca')); zona.before(svgIcona('luogo'));
const CAMPI = ['q', 'categoria', 'attivita', 'zona', 'ordine', 'pagina'];
let stato = leggi(), categorie = [], giro = 0, attesa;

function leggi() {
  const p = new URLSearchParams(location.search);
  const s = Object.fromEntries(CAMPI.map(k => [k, (p.get(k) || '').trim()]));
  s.pagina = Math.max(1, Number(s.pagina) || 1);
  if (!['', 'stelle', 'voto', 'nuovi'].includes(s.ordine)) s.ordine = '';
  return s;
}
const query = s => { const p = new URLSearchParams(); for (const k of CAMPI) if (s[k] && !(k === 'pagina' && s[k] === 1)) p.set(k, s[k]); return p; };
const filtrato = s => !!(s.q || s.categoria || s.attivita || s.zona);

function mostraControlli() {
  if (document.activeElement !== q) q.value = stato.q;
  if (document.activeElement !== zona) zona.value = stato.zona;
  ordine.value = stato.ordine;
  for (const b of chips.children) b.setAttribute('aria-pressed', String(b.dataset.c === stato.categoria));
  for (const b of chips.children) b.classList.toggle('attivo', b.dataset.c === stato.categoria);
  azzera.classList.toggle('nascosto', !filtrato(stato) && !stato.ordine);
  // il filtro per attività attivo (dal chip «Consigliato per»): un riquadro in testa con il nome e la ✕ per toglierlo
  let banner = $('#banner-attivita');
  if (stato.attivita) {
    if (!banner) { banner = el('div', { id: 'banner-attivita', class: 'banner-attivita' }); conteggio.parentNode.insertBefore(banner, conteggio); }
    banner.replaceChildren(el('span', {}, t('Prodotti per')), el('b', {}, nomeAttivita(stato.attivita)),
      el('button', { type: 'button', class: 'via', 'aria-label': t('Togli il filtro'), onclick: () => cambia({ attivita: '', pagina: 1 }) }, '✕'));
  } else if (banner) banner.remove();
}
const nomeAttivita = a => t(a.charAt(0).toUpperCase() + a.slice(1));
// lo stato vuoto: la scatola aperta (3D), che resta una cornice tratteggiata finché l'immagine non c'è
const figuraVuota = () => el('img', { class: 'figura-vuota', src: '/img/sobrio/vuoto.svg', alt: '', width: '220', height: '220', loading: 'lazy' });
function disegnaChips() {
  if (chips.children.length || !categorie.length) return;
  const chip = (c, testo) => el('button', { type: 'button', class: 'chip', dati: { c }, onclick: () => cambia({ categoria: c, pagina: 1 }) }, testo);
  chips.replaceChildren(chip('', t('Tutte')), ...categorie.map(c => chip(c, nomeCategoria(c))));
  mostraControlli();
}

// un cambio di filtro: nuova voce nella cronologia (o la stessa, mentre si scrive), poi si ricarica
function cambia(diff, { sostituisci = false } = {}) {
  stato = { ...stato, ...diff };
  const u = `${location.pathname}${query(stato).toString() ? `?${query(stato)}` : ''}`;
  if (u !== location.pathname + location.search) history[sostituisci ? 'replaceState' : 'pushState'](null, '', u);
  carica();
}

async function carica() {
  const mio = ++giro;
  mostraControlli();
  lista.setAttribute('aria-busy', 'true');
  if (!lista.querySelector('.scheda:not(.finta)')) lista.replaceChildren(...schedeFinte(6)); else lista.classList.add('in-carica');
  try {
    const r = await chiama('GET', `/api/catalogo?${query(stato)}`);
    if (mio !== giro) return;   // è già partita una ricerca più nuova
    categorie = r.categorie || []; disegnaChips();
    if (stato.pagina > r.pagine && r.totale) { cambia({ pagina: r.pagine }, { sostituisci: true }); return; }
    conteggio.textContent = r.totale ? conta(r.totale, 'prodotto', 'prodotti') + (r.pagine > 1 ? ` · ${t('pagina {n} di {tot}', { n: r.pagina, tot: r.pagine })}` : '') : '';
    if (!r.prodotti.length) lista.replaceChildren(vuoto());
    else lista.replaceChildren(...r.prodotti.map(p => scheda(p)));
    disegnaPagine(r.pagina, r.pagine);
  } catch (e) {
    if (mio !== giro) return;
    conteggio.textContent = '';
    pagine.classList.add('nascosto');
    lista.replaceChildren(el('div', { class: 'avviso errore', role: 'alert' }, el('span', {}, e.message || t('Non riesco a caricare il catalogo.')),
      el('button', { class: 'bottone piccolo secondario', type: 'button', onclick: carica }, t('Riprova'))));
  } finally { if (mio === giro) { lista.setAttribute('aria-busy', 'false'); lista.classList.remove('in-carica'); } }
}

function vuoto() {
  if (!filtrato(stato)) return el('div', { class: 'vuoto con-figura' }, figuraVuota(), el('h3', {}, t('Il catalogo si sta riempiendo')), el('p', {}, t('I primi progetti sono in revisione. Hai un repository pronto per un\'attività?')),
    el('div', { class: 'azioni' }, el('a', { class: 'bottone', href: '/builder' }, t('Metti in vendita il tuo repo'))));
  const consigli = [
    stato.q ? t('Prova con meno parole, o con parole più generiche (per esempio «cassa» invece di «registratore di cassa»).') : null,
    stato.zona ? t('Togli la zona: molti installatori lavorano anche da remoto.') : null,
    stato.categoria ? t('Cerca in tutte le categorie.') : null,
    stato.attivita ? t('Togli il filtro per attività: molti prodotti servono a più tipi di attività.') : null,
  ].filter(Boolean);
  return el('div', { class: 'vuoto con-figura' }, figuraVuota(), el('h3', {}, t('Nessun prodotto trovato')), el('p', {}, t('Nessun risultato con questi filtri.')),
    el('ul', {}, ...consigli.map(c => el('li', {}, c))),
    el('div', { class: 'azioni' }, el('button', { class: 'bottone secondario', type: 'button', onclick: tutto }, t('Azzera i filtri')), el('a', { class: 'bottone fantasma', href: '/builder' }, t('Hai un progetto adatto? Mettilo in vendita'))));
}

function disegnaPagine(n, tot) {
  pagine.classList.toggle('nascosto', tot <= 1);
  if (tot <= 1) return pagine.replaceChildren();
  const link = (p, testo, attr = {}) => el('a', { href: `?${query({ ...stato, pagina: p })}`, ...attr, onclick: e => { e.preventDefault(); cambia({ pagina: p }); scrollTo({ top: 0, behavior: 'smooth' }); } }, testo);
  const numeri = [];
  const vedi = new Set([1, tot, n - 1, n, n + 1].filter(x => x >= 1 && x <= tot));
  let prima = 0;
  for (const p of [...vedi].sort((a, b) => a - b)) {
    if (p - prima > 1) numeri.push(el('span', { 'aria-hidden': 'true' }, '…'));
    numeri.push(link(p, String(p), p === n ? { 'aria-current': 'page', 'aria-label': t('Pagina {n}', { n: p }) } : { 'aria-label': t('Pagina {n}', { n: p }) }));
    prima = p;
  }
  pagine.replaceChildren(
    n > 1 ? link(n - 1, t('← Precedente'), { class: 'bottone secondario piccolo', rel: 'prev' }) : el('span', { class: 'bottone secondario piccolo', 'aria-disabled': 'true' }, t('← Precedente')),
    el('div', { class: 'numeri' }, ...numeri),
    n < tot ? link(n + 1, t('Successiva →'), { class: 'bottone secondario piccolo', rel: 'next' }) : el('span', { class: 'bottone secondario piccolo', 'aria-disabled': 'true' }, t('Successiva →')));
}

function tutto() { q.value = ''; zona.value = ''; cambia({ q: '', categoria: '', zona: '', ordine: '', pagina: 1 }); }

// mentre si scrive: si aspetta un attimo; la prima lettera apre una voce nella cronologia, le altre la aggiornano
let scrivendo = false;
const scrivi = campo => () => {
  clearTimeout(attesa);
  attesa = setTimeout(() => { const v = campo.value.trim(); if (v === stato[campo.name]) return; cambia({ [campo.name]: v, pagina: 1 }, { sostituisci: scrivendo }); scrivendo = true; }, 280);
};
q.addEventListener('input', scrivi(q)); zona.addEventListener('input', scrivi(zona));
for (const c of [q, zona]) c.addEventListener('blur', () => { scrivendo = false; });
ordine.addEventListener('change', () => cambia({ ordine: ordine.value, pagina: 1 }));
form.addEventListener('submit', e => { e.preventDefault(); clearTimeout(attesa); scrivendo = false; cambia({ q: q.value.trim(), zona: zona.value.trim(), pagina: 1 }); });
azzera.addEventListener('click', tutto);
addEventListener('popstate', () => { clearTimeout(attesa); scrivendo = false; stato = leggi(); q.value = stato.q; zona.value = stato.zona; carica(); });
carica();
