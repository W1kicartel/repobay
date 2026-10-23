// La home: chi sei (cambia testo, pulsanti e la riga accesa dello scontrino), lo scontrino della divisione con i numeri che
// scorrono, i tre passi con le loro schermate, quanto guadagna chi vende in un anno (il grafico), il catalogo con i filtri.
import { $, $$, el, t, chiama, euro, pronta, copia, lingua } from './comune.js';
import { scheda, schedeFinte, tondo, nomeCategoria } from './vetrina.js';
import './scena.js';
import './muro.js';
await pronta;

for (const x of document.querySelectorAll('[data-cent]')) x.textContent = tondo(Number(x.dataset.cent));   // gli importi fissi nel formato della lingua
const fermo = matchMedia('(prefers-reduced-motion: reduce)').matches;
const intero = c => tondo(Math.round(c / 100) * 100);   // gli euro senza centesimi, per i totali dell'anno

// ---------------- i conti, come il server (server/soldi.js) ----------------
// Con carta prima il costo di Stripe (qui la stima per le carte europee standard, 1,5% + 0,25 €: dopo il pagamento conta quello
// vero), poi la piattaforma su quello che resta (5% con carta, 1% in crypto), poi la percentuale di chi sviluppa (80% se non la
// sceglie), ridotta dal livello di chi vende (LIVELLI_VENDITORE: dopo 10 vendite confermate dello stesso prodotto 13/16, dopo 25 5/8:
// chi vende passa dal 20% al 35% e al 50%). Il canone dell'assistenza: tolto Stripe, il 60% a chi ha installato
// (QUOTA_INSTALLATORE_ASSISTENZA) e il resto alla piattaforma; in crypto si paga un anno in anticipo con lo sconto dell'anno.
const PIATTAFORMA = { carta: 0.05, crypto: 0.01 };
const STRIPE = { percentuale: 0.015, fisso: 25 };
const ASSISTENZA = { mese: 3750, installatore: 0.6, scontoAnno: 0.10 };
// il canone vero lo dice il server (è uno per tutti i prodotti; 37,50 € finché non cambia dal pannello)
try { const s = await chiama('GET', '/api/sessione'); if (Number.isInteger(s.assistenzaMese)) ASSISTENZA.mese = s.assistenzaMese; } catch { /* resta il valore di regola */ }
const LIVELLI = [1, 13 / 16, 5 / 8];
const sei = x => Math.round(x * 1e6) / 1e6;   // come il server: le frazioni al milionesimo, così non si perde un centesimo
function dividi(cent, { modo = 'carta', perc = 80, livello = 0 } = {}) {
  const c = modo === 'carta' && cent > 0 ? Math.min(cent, Math.round(cent * STRIPE.percentuale) + STRIPE.fisso) : 0;
  const piat = c + Math.round((cent - c) * PIATTAFORMA[modo]);
  const base = sei(1 - perc / 100), f = LIVELLI[livello], q = f === 1 ? base : sei(1 - (1 - base) * f);   // la quota di chi vende
  const inst = Math.floor((cent - piat) * q);
  return { stripe: c, piattaforma: piat - c, vende: inst, sviluppa: cent - inst - piat };
}
function canone(cent, modo) {
  const c = modo === 'carta' ? Math.round(cent * STRIPE.percentuale) + STRIPE.fisso : 0;
  const piat = c + Math.round((cent - c) * (1 - ASSISTENZA.installatore));
  return cent - piat;   // la parte di chi ha installato
}

// i numeri che cambiano scorrono per un attimo invece di saltare
const correnti = new WeakMap();
function scorri(nodo, cent, formato = euro) {
  if (!nodo) return;
  const da = correnti.get(nodo) ?? cent; correnti.set(nodo, cent);
  if (fermo || da === cent) { nodo.textContent = formato(cent); return; }
  const inizio = performance.now(), durata = 420;
  const passo = ora => {
    if (correnti.get(nodo) !== cent) return;   // è già arrivato un valore nuovo
    const k = Math.min(1, (ora - inizio) / durata), e = 1 - (1 - k) ** 3;
    nodo.textContent = formato(Math.round(da + (cent - da) * e));
    if (k < 1) requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
}
// i cursori: la parte già percorsa si colora (--pct)
function riempi(r) { r.style.setProperty('--pct', `${((r.value - r.min) / (r.max - r.min)) * 100}%`); }
for (const r of $$('.k input[type=range]')) { riempi(r); r.addEventListener('input', () => riempi(r)); }

// ---------------- chi sei ----------------
const eroe = $('.k-eroe'), scontrino = $('.k-scontrino');
function scegliChi(chi) {
  for (const b of $$('.k-chi [data-chi]')) b.setAttribute('aria-selected', String(b.dataset.chi === chi));
  for (const p of $$('.k-per')) p.hidden = p.dataset.per !== chi;
  eroe.dataset.chi = chi; scontrino.dataset.chi = chi;
}
for (const b of $$('.k-chi [data-chi]')) b.addEventListener('click', () => scegliChi(b.dataset.chi));
scegliChi('vende');

// ---------------- lo scontrino ----------------
const sc = { prezzo: $('#sc-prezzo'), modo: 'carta', livello: 0 };
function aggiornaScontrino() {
  const cent = Number(sc.prezzo.value) * 100, p = dividi(cent, { modo: sc.modo, livello: sc.livello });
  $('#sc-prezzo-val').textContent = tondo(cent);
  scorri($('#sc-totale'), cent); scorri($('#sc-sv'), p.sviluppa); scorri($('#sc-ve'), p.vende); scorri($('#sc-pi'), p.piattaforma); scorri($('#sc-st'), p.stripe);
  for (const [k, v] of [['sv', p.sviluppa], ['ve', p.vende], ['pi', p.piattaforma], ['st', p.stripe]]) $(`#sc-b-${k}`).style.flexGrow = String(v);
  $('#sc-riga-st').hidden = sc.modo !== 'carta';
  $('#sc-pi-eti').textContent = t('A Repobay, {p}', { p: sc.modo === 'carta' ? '5%' : '1%' });
  // l'assistenza: con carta ogni mese; in crypto dodici mesi in anticipo, con lo sconto dell'anno
  const mese = $('[data-riga=mese] > span');
  if (sc.modo === 'carta') { mese.textContent = t('Ogni mese, dall\'assistenza di {x}: all\'installatore', { x: euro(ASSISTENZA.mese) }); scorri($('#sc-mese'), canone(ASSISTENZA.mese, 'carta')); }
  else { mese.textContent = t('In crypto, dodici mesi di assistenza pagati in anticipo: all\'installatore'); scorri($('#sc-mese'), canone(Math.round(ASSISTENZA.mese * 12 * (1 - ASSISTENZA.scontoAnno)), 'crypto')); }
}
sc.prezzo.addEventListener('input', aggiornaScontrino);
for (const b of $$('[data-modo]')) b.addEventListener('click', () => { sc.modo = b.dataset.modo; for (const x of $$('[data-modo]')) x.setAttribute('aria-pressed', String(x === b)); aggiornaScontrino(); });
for (const b of $$('[data-livello]')) b.addEventListener('click', () => { sc.livello = Number(b.dataset.livello); for (const x of $$('[data-livello]')) x.setAttribute('aria-pressed', String(x === b)); aggiornaScontrino(); });
aggiornaScontrino();

// ---------------- i tre passi, che avanzano da soli finché non li tocchi ----------------
const COLORI = ['k-viola', 'k-verde-porta', 'k-ambra'];
const passi = $('.k-passi'), schermi = $('.k-schermi');
let passo = 0, giro = null;
function mostraPasso(n) {
  passo = n;
  for (const b of $$('[data-passo]')) b.setAttribute('aria-selected', String(Number(b.dataset.passo) === n));
  for (const s of $$('[data-schermo]')) s.hidden = Number(s.dataset.schermo) !== n;
  schermi.classList.remove(...COLORI); schermi.classList.add(COLORI[n]);
}
function ferma() { clearInterval(giro); giro = null; passi.classList.remove('gira'); }
for (const b of $$('[data-passo]')) b.addEventListener('click', () => { ferma(); mostraPasso(Number(b.dataset.passo)); });
mostraPasso(0);
if (!fermo) {
  // parte quando la sezione si vede, così il primo passo non scorre via prima che uno ci arrivi
  const avvia = () => { if (giro) return; passi.classList.add('gira'); giro = setInterval(() => { passi.classList.remove('gira'); void passi.offsetWidth; passi.classList.add('gira'); mostraPasso((passo + 1) % 3); }, 6000); };
  new IntersectionObserver((v, o) => { if (v.some(x => x.isIntersecting)) { avvia(); o.disconnect(); } }, { threshold: 0.35 }).observe(passi);
}
// la schermata di chi sviluppa: la percentuale e quanto riceve su 1.490 €
const perc = $('#sc-perc');
function aggiornaPerc() { const p = dividi(149000, { perc: Number(perc.value) }); $('#sc-perc-val').textContent = `${perc.value}%`; scorri($('#sc-perc-euro'), p.sviluppa); }
perc.addEventListener('input', aggiornaPerc); aggiornaPerc();
$('#sc-link-parte').textContent = euro(dividi(149000).vende);
$('#sc-mese-primo').textContent = euro(ASSISTENZA.mese); $('#sc-oggi').textContent = euro(149000 + ASSISTENZA.mese);
$('#sc-copia').addEventListener('click', e => copia(`https://${$('#sc-link').textContent}`, e.currentTarget));

// ---------------- quanto guadagna chi vende in un anno ----------------
const gu = { n: $('#gu-n'), prezzo: $('#gu-prezzo') };
$('#gu-mese-val').textContent = euro(ASSISTENZA.mese);
const svg = $('#gu-svg'), NS = 'http://www.w3.org/2000/svg';
const s = (tag, attr = {}, testo) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attr)) e.setAttribute(k, v); if (testo != null) e.textContent = testo; return e; };
const W = 640, H = 280, L = 62, B = 30, T = 18, larg = (W - L - 8) / 12;
let righe = [], scelto = null;
const dettaglio = $('#gu-dettaglio'), testoBase = dettaglio.textContent;
function mostraMese(n) {
  scelto = n;
  for (const g of $$('.k-mese', svg)) g.classList.toggle('scelto', Number(g.dataset.n) === n);
  if (n == null) { dettaglio.textContent = testoBase; return; }
  const r = righe[n];
  dettaglio.textContent = t('Mese {m}: {inst} dalle installazioni e {ass} dall\'assistenza di {n} clienti.', { m: r.m, inst: intero(r.inst), ass: intero(r.ass), n: r.clienti });
}
function guadagni() {
  const alMese = Number(gu.n.value), prezzo = Number(gu.prezzo.value) * 100, quotaMese = canone(ASSISTENZA.mese, 'carta');
  $('#gu-n-val').textContent = String(alMese); $('#gu-prezzo-val').textContent = tondo(prezzo);
  righe = []; let venduti = 0, top = 0;
  for (let m = 1; m <= 12; m++) {
    let inst = 0;
    for (let k = 0; k < alMese; k++) { venduti++; const livello = venduti > 25 ? 2 : venduti > 10 ? 1 : 0; if (livello && !top) top = m; inst += dividi(prezzo, { livello }).vende; }
    righe.push({ m, inst, ass: venduti * quotaMese, clienti: venduti });
  }
  const totInst = righe.reduce((x, r) => x + r.inst, 0), totAss = righe.reduce((x, r) => x + r.ass, 0);
  scorri($('#gu-inst'), totInst, intero); scorri($('#gu-ass'), totAss, intero); scorri($('#gu-tot'), totInst + totAss, intero); scorri($('#gu-dopo'), 12 * alMese * quotaMese, intero);
  $('#gu-top').hidden = !top; $('#gu-top-mese').textContent = String(top || '');
  disegna(top);
  mostraMese(scelto);
}
function disegna(top) {
  const max = Math.max(...righe.map(r => r.inst + r.ass));
  const passoY = [10000, 20000, 25000, 50000, 100000, 200000, 250000, 500000, 1000000].find(x => max / x <= 5) ?? 2000000;
  const cima = Math.ceil(max / passoY) * passoY, y = v => T + (H - T - B) * (1 - v / cima);
  // la prima volta si disegna tutto; dopo si muovono solo le colonne (così scorrono)
  if (!svg.firstChild || svg.dataset.cima !== String(cima)) {
    svg.replaceChildren(); svg.dataset.cima = String(cima);
    for (let v = 0; v <= cima; v += passoY) {
      svg.append(s('line', { x1: L, x2: W - 4, y1: y(v), y2: y(v), stroke: 'currentColor', 'stroke-opacity': v ? 0.12 : 0.35 }),
        s('text', { x: L - 8, y: y(v) + 4, 'text-anchor': 'end', 'font-size': 11, fill: 'currentColor', 'fill-opacity': 0.6 }, tondo(v)));
    }
    righe.forEach((r, n) => {
      const g = s('g', { class: 'k-mese', tabindex: 0, role: 'button', 'data-n': n });
      const x = L + n * larg;
      g.append(s('rect', { class: 'k-fondo', x, y: T, width: larg, height: H - T - B }),
        s('rect', { class: 'k-col k-col-a', x: x + larg * 0.18, width: larg * 0.64, rx: 2, fill: 'var(--accento-luce-2)', y: y(0), height: 0 }),
        s('rect', { class: 'k-col k-col-i', x: x + larg * 0.18, width: larg * 0.64, rx: 2, fill: 'var(--verde-luce)', y: y(0), height: 0 }),
        s('text', { class: 'k-stella', x: x + larg / 2, 'text-anchor': 'middle', 'font-size': 12, fill: 'currentColor' }, ''),
        s('text', { x: x + larg / 2, y: H - 10, 'text-anchor': 'middle', 'font-size': 11, fill: 'currentColor', 'fill-opacity': 0.6 }, String(r.m)));
      g.addEventListener('mouseenter', () => mostraMese(n)); g.addEventListener('focus', () => mostraMese(n)); g.addEventListener('click', () => mostraMese(n));
      svg.append(g);
    });
    svg.addEventListener('mouseleave', () => mostraMese(null));
  }
  requestAnimationFrame(() => righe.forEach((r, n) => {
    const g = svg.querySelector(`.k-mese[data-n="${n}"]`), ya = y(r.ass), yi = y(r.inst + r.ass);
    const a = g.querySelector('.k-col-a'), i = g.querySelector('.k-col-i'), stella = g.querySelector('.k-stella');
    a.setAttribute('y', ya); a.setAttribute('height', Math.max(0, y(0) - ya));
    i.setAttribute('y', yi); i.setAttribute('height', Math.max(0, ya - yi - 1.5));
    stella.textContent = top === r.m ? '★' : ''; stella.setAttribute('y', yi - 6);
    g.setAttribute('aria-label', t('Mese {m}: {tot}', { m: r.m, tot: intero(r.inst + r.ass) }));
  }));
}
for (const r of Object.values(gu)) r.addEventListener('input', guadagni);
guadagni();

// ---------------- i numeri veri sotto l'eroe ----------------
const compatto = n => n >= 1e6 ? t('{n} milioni', { n: (n / 1e6).toLocaleString(lingua === 'en' ? 'en-IE' : 'it-IT', { maximumFractionDigits: 1 }) }) : n >= 1e4 ? t('{n} mila', { n: Math.round(n / 1e3) }) : String(n);
chiama('GET', '/api/catalogo/numeri').then(n => {
  scorri($('#n-programmi'), n.programmi, String); scorri($('#n-categorie'), n.categorie, String);
  scorri($('#n-stelle'), n.stelle, compatto);
}).catch(() => { $('#k-numeri').hidden = true; });

// ---------------- il catalogo, con i filtri per tipo ----------------
const box = $('#evidenza'), filtri = $('#k-filtri');
let tutti = [], tipo = '';
function mostraCatalogo() {
  const elenco = tutti.filter(p => !tipo || p.categoria === tipo).slice(0, 6);
  box.replaceChildren(...elenco.map((p, n) => { const c = scheda(p); c.style.setProperty('--n', String(n)); return c; }));
  for (const b of $$('button', filtri)) b.setAttribute('aria-pressed', String(b.dataset.tipo === tipo));
}
async function evidenza() {
  box.setAttribute('aria-busy', 'true');
  box.replaceChildren(...schedeFinte(3));
  try {
    const risposta = await chiama('GET', '/api/catalogo'); tutti = risposta.prodotti;
    if (risposta.totale > tutti.length) $('#k-tutti').textContent = t('Vedi tutti i {n} programmi', { n: risposta.totale });
    if (!tutti.length) {
      box.replaceChildren(el('div', { class: 'vuoto' }, el('h3', {}, t('Il catalogo si sta riempiendo')), el('p', {}, t('I primi progetti sono in revisione. Hai un repository pronto per un\'attività?')),
        el('div', { class: 'azioni' }, el('a', { class: 'bottone', href: '/builder' }, t('Metti in vendita il tuo repo')))));
      return;
    }
    const conti = {}; for (const p of tutti) conti[p.categoria] = (conti[p.categoria] || 0) + 1;
    const tipi = Object.keys(conti).sort((a, b) => conti[b] - conti[a]);
    filtri.replaceChildren(el('button', { type: 'button', 'data-tipo': '', onclick: () => { tipo = ''; mostraCatalogo(); } }, t('Tutti')),
      ...tipi.map(c => el('button', { type: 'button', 'data-tipo': c, onclick: () => { tipo = c; mostraCatalogo(); } }, nomeCategoria(c), el('span', { 'data-no-t': '' }, String(conti[c])))));
    mostraCatalogo();
  } catch {
    box.replaceChildren(el('div', { class: 'avviso errore', role: 'alert' }, el('span', {}, t('Non riesco a caricare i prodotti.')),
      el('button', { class: 'bottone piccolo secondario', type: 'button', onclick: evidenza }, t('Riprova'))));
  } finally { box.setAttribute('aria-busy', 'false'); }
}
if (box) evidenza();
