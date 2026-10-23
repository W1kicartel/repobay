// La cassa di un prodotto (/compra/<slug>): quattro passi su una pagina sola, e accanto la ricevuta che si scrive mentre scegli.
//   01 chi lo installa (le schede degli installatori: chi ti ha mandato qui, chi ha più installazioni confermate, il prezzo)
//   02 la tua attività (nome, email, dove gira il programma, il dominio)
//   03 l'assistenza (mese o anno, gli aggiornamenti garantiti)
//   04 il pagamento: Stripe incorporato nella pagina (carta, Apple Pay, Google Pay, SEPA), oppure bonifico o crypto con i pannelli
//      della pagina prodotto. Nel prelancio il passo diventa la prenotazione.
// Pagato, si va su /installa/<codice>: il comando che installa da solo, o l'appuntamento con chi installa.
// Quello che scrivi resta nel browser (se ricarichi non lo perdi); niente di tutto questo esce prima del pagamento o della prenotazione.
import { $, el, t, euro, chiama, occupato, avatar, lingua, pronta } from './comune.js';
import { pannelloCrypto } from './prodotto-crypto.js';
import { pannelloBonifico } from './prodotto-bonifico.js';

await pronta;
const slug = location.pathname.split('/')[2], q = new URLSearchParams(location.search);
const piano = matchMedia('(prefers-reduced-motion: reduce)').matches;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, DOMINIO = /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
const BOZZA = `cassa:${slug}`;
const leggiBozza = () => { try { return JSON.parse(localStorage.getItem(BOZZA) || 'null'); } catch { return null; } };
const salvaBozza = () => { try { localStorage.setItem(BOZZA, JSON.stringify({ i: S.inst?.codice, dati: S.dati, periodo: S.periodo, agg: S.agg })); } catch { } };
const togliBozza = () => { try { localStorage.removeItem(BOZZA); } catch { } };

const S = {
  p: null, inst: null, periodo: q.get('periodo') === 'anno' ? 'anno' : 'mese', agg: q.get('agg') === '1',
  dati: { nome: '', attivita: '', email: '', telefono: '', dove: 'mio', dominio: '' },
  privacy: false, passo: 0, fatti: new Set(), metodo: 'carta',
  acquisto: null, impronta: null, checkout: null, totale: 0,
};
let p;

// ---------------- i conti ----------------
const avvio = () => S.inst?.prezzo_avvio ?? p.prezzi?.da ?? p.prezzo_avvio ?? 0;
const conCanone = () => p.prezzo_mese > 0 || !!p.aggiornamenti;
const metodi = () => {
  const i = S.inst || {};
  return { carta: !!p.carta && i.carta !== false, bonifico: !!p.bonifico && !!i.bonifico, crypto: !!p.crypto && !!i.reti?.length };
};
// le righe della ricevuta secondo il metodo: con la carta il primo periodo (poi si rinnova), con bonifico e crypto i mesi in anticipo
function conto() {
  const ag = S.agg && p.aggiornamenti, righe = [[t('Installazione'), t('una volta'), avvio()]], metodo = p.prelancio ? 'carta' : S.metodo;
  if (metodo === 'bonifico' && p.bonifico) {
    if (p.bonifico.canone > 0) righe.push([t('Assistenza'), t('{n} mesi in anticipo', { n: p.bonifico.mesi }), p.bonifico.canone]);
    if (ag && p.bonifico.aggiornamenti) righe.push([t('Aggiornamenti garantiti'), t('{n} mesi in anticipo', { n: p.bonifico.mesi }), p.bonifico.aggiornamenti]);
    return { righe, oggi: righe.reduce((s, r) => s + r[2], 0), poi: p.bonifico.canone > 0 ? t('Fra {n} mesi rinnovi, se vuoi: niente addebiti automatici.', { n: p.bonifico.mesi }) : null };
  }
  if (metodo === 'crypto' && p.crypto) {
    if (p.crypto.canone > 0) righe.push([t('Assistenza'), t('{n} mesi in anticipo', { n: p.crypto.mesi }), p.crypto.canone]);
    if (ag && p.crypto.aggiornamenti) righe.push([t('Aggiornamenti garantiti'), t('{n} mesi in anticipo', { n: p.crypto.mesi }), p.crypto.aggiornamenti]);
    return { righe, oggi: righe.reduce((s, r) => s + r[2], 0), poi: p.crypto.canone > 0 ? t('Fra {n} mesi rinnovi dal tuo wallet, se vuoi.', { n: p.crypto.mesi }) : null };
  }
  const anno = S.periodo === 'anno', canone = anno ? p.prezzo_anno : p.prezzo_mese, agg = ag ? (anno ? p.aggiornamenti.anno : p.aggiornamenti.mese) : 0;
  if (p.prezzo_mese > 0) righe.push([t('Assistenza'), anno ? t('il primo anno') : t('il primo mese'), canone]);
  if (agg) righe.push([t('Aggiornamenti garantiti'), anno ? t('il primo anno') : t('il primo mese'), agg]);
  const dopo = canone + agg;
  return { righe, oggi: righe.reduce((s, r) => s + r[2], 0), poi: dopo > 0 ? t(anno ? 'Poi {euro} all\'anno. Disdici quando vuoi.' : 'Poi {euro} al mese. Disdici quando vuoi.', { euro: euro(dopo) }) : null };
}

// ---------------- i passi ----------------
const PASSI = [
  { k: 'chi', titolo: 'Chi lo installa', corpo: passoChi, riassunto: () => S.inst ? [avatar(S.inst, 'mini'), el('strong', { 'data-no-t': '' }, S.inst.nome), S.inst.zona ? el('span', { 'data-no-t': '' }, ` · ${S.inst.zona}`) : null] : null },
  { k: 'tu', titolo: 'La tua attività', corpo: passoTu, riassunto: () => [el('strong', { 'data-no-t': '' }, S.dati.attivita || S.dati.nome), el('span', {}, ` · ${t(DOVE[S.dati.dove].corto)}`), S.dati.dominio ? el('span', { 'data-no-t': '' }, ` · ${S.dati.dominio}`) : null] },
  { k: 'cura', titolo: 'Assistenza', corpo: passoCura, riassunto: () => !conCanone() ? [t('Nessun canone: paghi solo l\'installazione')] : [el('strong', {}, t(S.periodo === 'anno' ? 'Annuale' : 'Mensile')), S.agg ? el('span', {}, ` · ${t('con aggiornamenti garantiti')}`) : null] },
  { k: 'paga', titolo: null, corpo: passoPaga, riassunto: () => null },
];
const titoloPaga = () => (p.prelancio ? 'Prenota' : 'Paga');
const sezioni = [];

function disegnaPassi() {
  const box = $('#passi'); box.replaceChildren();
  PASSI.forEach((x, i) => {
    const n = String(i + 1).padStart(2, '0');
    const riassunto = el('p', { class: 'cs-riassunto' }), cambia = el('button', { type: 'button', class: 'bottone fantasma piccolo cs-cambia', onclick: () => apri(i) }, t('Cambia'));
    const testa = el('div', { class: 'cs-passo-testa' }, el('span', { class: 'cs-num', 'aria-hidden': 'true' }, el('span', { class: 'cs-num-n' }, n), el('span', { class: 'cs-num-ok' }, '✓')),
      el('div', { class: 'cs-passo-titoli' }, el('h2', { tabindex: '-1' }, t(x.titolo || titoloPaga())), riassunto), cambia);
    const corpo = el('div', { class: 'cs-passo-corpo' });
    const s = el('section', { class: 'cs-passo', dati: { k: x.k, stato: 'chiuso' }, 'aria-label': t(x.titolo || titoloPaga()) }, testa, corpo);
    sezioni.push({ s, corpo, riassunto, h: testa.querySelector('h2') }); box.append(s);
  });
  // la mappa dei passi in alto: si può tornare a un passo fatto
  $('#mappa').replaceChildren(...PASSI.map((x, i) => el('li', { dati: { i } }, el('button', { type: 'button', onclick: () => puoiAprire(i) && apri(i) },
    el('span', { class: 'cs-mappa-n' }, String(i + 1).padStart(2, '0')), el('span', {}, t(x.titolo || titoloPaga()))))));
}
const puoiAprire = i => PASSI.slice(0, i).every(x => S.fatti.has(x.k));

function apri(i, { primo = false } = {}) {
  if (!puoiAprire(i)) i = PASSI.findIndex(x => !S.fatti.has(x.k));
  if (i !== 3) chiudiStripe();
  S.passo = i;
  sezioni.forEach((x, j) => {
    const k = PASSI[j].k, stato = j === i ? 'aperto' : S.fatti.has(k) ? 'fatto' : 'chiuso';
    x.s.dataset.stato = stato;
    x.riassunto.replaceChildren(...(stato === 'fatto' ? [PASSI[j].riassunto()].flat().filter(Boolean) : []));
    if (j === i) x.corpo.replaceChildren(PASSI[j].corpo()); else x.corpo.replaceChildren();
  });
  $('#mappa').querySelectorAll('li').forEach((li, j) => { li.dataset.stato = j === i ? 'aperto' : S.fatti.has(PASSI[j].k) ? 'fatto' : 'chiuso'; li.querySelector('button').disabled = !puoiAprire(j); });
  if (!primo) {
    const h = sezioni[i].h; h.focus({ preventScroll: true });
    const y = sezioni[i].s.getBoundingClientRect().top + scrollY - 96;
    if (Math.abs(y - scrollY) > 40) scrollTo({ top: y, behavior: piano ? 'auto' : 'smooth' });
  }
  disegnaLato();
}
function avanti(k) { S.fatti.add(k); salvaBozza(); apri(PASSI.findIndex(x => !S.fatti.has(x.k))); }
// qualcosa è cambiato: l'acquisto già creato non vale più (al pagamento se ne crea uno nuovo)
const impronta = () => JSON.stringify([S.inst?.codice, S.dati, S.periodo, S.agg]);
function cambiato() { salvaBozza(); disegnaLato(); }

// 01 — chi lo installa
function passoChi() {
  const scheda = i => {
    const tag = [];
    if (i.codice === p.scelto) tag.push(el('span', { class: 'cs-tag segnale' }, t('Ti ha mandato qui')));
    else if (i === tutti[0] && (i.confermate || 0) > 0) tag.push(el('span', { class: 'cs-tag sole' }, t('Il più scelto')));
    if (minimo !== null && i.prezzo_avvio === minimo) tag.push(el('span', { class: 'cs-tag menta' }, t('Prezzo più basso')));
    if (!(i.confermate > 0)) tag.push(el('span', { class: 'cs-tag' }, t('Nuovo qui')));
    const radio = el('input', { type: 'radio', name: 'installatore', value: i.codice, class: 'sr', checked: S.inst?.codice === i.codice,
      onchange: () => { S.inst = i; if (!metodi()[S.metodo]) S.metodo = Object.entries(metodi()).find(([, v]) => v)?.[0] || 'carta'; cambiato(); continua.textContent = t('Continua con {nome}', { nome: i.nome }); } });
    return el('label', { class: 'cs-inst' }, radio,
      el('span', { class: 'cs-inst-testa' }, avatar(i, 'grande'), el('span', { class: 'cs-inst-nome' }, el('strong', { 'data-no-t': '' }, i.nome),
        el('span', { class: 'tenue' }, [i.zona, i.voto ? `★ ${Number(i.voto).toLocaleString(lingua === 'en' ? 'en-IE' : 'it-IT', { maximumFractionDigits: 1 })} (${i.recensioni})` : null].filter(Boolean).join(' · ') || t('Online'))),
        el('span', { class: 'cs-inst-prezzo' }, el('strong', {}, euro(i.prezzo_avvio)), el('span', {}, t('installazione')))),
      el('span', { class: 'cs-inst-fatti' },
        el('span', {}, (i.confermate || 0) > 0 ? t(i.confermate === 1 ? '{n} installazione confermata' : '{n} installazioni confermate', { n: i.confermate }) : t('Ha superato il test del corso per installatori')),
        i.contestazioni > 0 ? el('span', { class: 'cs-inst-nota' }, t(i.contestazioni === 1 ? '{n} segnalazione' : '{n} segnalazioni', { n: i.contestazioni })) : null),
      el('span', { class: 'cs-inst-piede' }, ...tag,
        el('span', { class: 'cs-inst-metodi' }, [i.carta !== false && p.carta ? t('carta') : null, i.bonifico && p.bonifico ? t('bonifico') : null, i.reti?.length && p.crypto ? 'crypto' : null].filter(Boolean).join(' · '))));
  };
  const continua = el('button', { type: 'button', class: 'bottone grande', onclick: () => avanti('chi') }, S.inst ? t('Continua con {nome}', { nome: S.inst.nome }) : t('Continua'));
  return el('div', { class: 'cs-corpo' },
    el('p', { class: 'cs-guida' }, t('Sono professionisti che hanno superato il test del corso per installatori; per i programmi impegnativi servono anche 3 installazioni confermate. Il prezzo dell\'installazione lo decide ognuno; l\'assistenza costa uguale con tutti.')),
    el('div', { class: 'cs-insts', role: 'radiogroup', 'aria-label': t('Chi lo installa') }, ...tutti.map(scheda)),
    el('div', { class: 'cs-avanti' }, continua));
}

// 02 — la tua attività
const DOVE = {
  mio: { titolo: 'Ho un server o un computer', corto: 'sul tuo server', testo: 'Lo installi tu con un comando, in pochi minuti: serve un computer Linux sempre acceso o un server da pochi euro al mese.', icona: 'server' },
  installatore: { titolo: 'Pensaci tu', corto: 'ci pensa chi installa', testo: '{nome} prepara il server e lo installa per te. Il costo dell\'hosting te lo dice prima.', icona: 'chiave' },
  insieme: { titolo: 'Decidiamo insieme', corto: 'decidete insieme', testo: 'Quindici minuti di chiamata con {nome} e scegliete la soluzione giusta per te.', icona: 'fumetti' },
};
const ICONE = {
  server: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><rect x="8" y="8" width="32" height="12" rx="2"/><rect x="8" y="26" width="32" height="12" rx="2"/><circle cx="15" cy="14" r="1.6" fill="currentColor"/><circle cx="15" cy="32" r="1.6" fill="currentColor"/><path d="M24 14h10M24 32h10"/></svg>',
  chiave: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M30 8a10 10 0 0 0-9.4 13.4L8 34v6h6v-4h4v-4h4l3.6-3.6A10 10 0 1 0 30 8z"/><circle cx="32" cy="16" r="2.5" fill="currentColor"/></svg>',
  fumetti: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><path d="M6 10h24v14H16l-6 5v-5H6z"/><path d="M34 18h8v14h-4v5l-6-5H20v-4"/></svg>',
};
function passoTu() {
  const errori = {};
  const campo = (k, etichetta, attr, aiuto) => {
    // scrivere non cambia i conti: si salva la bozza, la ricevuta resta ferma
    const input = el('input', { name: k, value: S.dati[k] || '', ...attr, oninput: e => { S.dati[k] = e.target.value; e.target.removeAttribute('aria-invalid'); errori[k].textContent = ''; if (k === 'dominio') anteprima(); salvaBozza(); } });
    errori[k] = el('span', { class: 'errore-campo', id: `e-${k}` }); input.setAttribute('aria-describedby', `e-${k}`);
    return el('label', {}, t(etichetta), input, aiuto ? el('span', { class: 'aiuto' }, t(aiuto)) : null, errori[k]);
  };
  const vista = el('span', { class: 'cs-dom-vista', 'data-no-t': '' });
  const anteprima = () => {
    const d = S.dati.dominio.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    vista.parentElement?.classList.toggle('nascosto', !d);
    vista.textContent = d ? `https://${d}` : '';
  };
  const dove = el('div', { class: 'cs-dove', role: 'radiogroup', 'aria-label': t('Dove gira il programma') }, ...Object.entries(DOVE).map(([k, x]) => {
    const ic = el('span', { class: 'cs-dove-icona', 'aria-hidden': 'true' }); ic.innerHTML = ICONE[x.icona];
    return el('label', { class: 'cs-dove-voce' }, el('input', { type: 'radio', name: 'dove', value: k, class: 'sr', checked: S.dati.dove === k, onchange: () => { S.dati.dove = k; salvaBozza(); notaTerminale(); } }),
      ic, el('strong', {}, t(x.titolo)), el('span', {}, t(x.testo, { nome: S.inst?.nome || t('chi installa') })));
  }));
  const trappola = el('input', { type: 'text', name: 'sito_web', tabindex: '-1', autocomplete: 'off', id: 'trappola' });
  const f = el('form', { class: 'cs-corpo modulo', novalidate: true, onsubmit: e => {
    e.preventDefault();
    const d = S.dati; let primo = null;
    const sbaglia = (k, m) => { errori[k].textContent = t(m); f.elements[k].setAttribute('aria-invalid', 'true'); primo ??= f.elements[k]; };
    d.email = d.email.trim(); d.nome = d.nome.trim(); d.dominio = d.dominio.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (d.nome.length < 2) sbaglia('nome', 'Scrivi il tuo nome');
    if (!EMAIL.test(d.email)) sbaglia('email', 'Controlla l\'email: ti mandiamo lì la ricevuta e il link per installare');
    if (d.dominio && !DOMINIO.test(d.dominio)) sbaglia('dominio', 'Scrivilo come pizzeriadamario.it, oppure lascialo vuoto');
    if (primo) { primo.focus(); return; }
    avanti('tu');
  } },
    el('div', { class: 'trappola', 'aria-hidden': 'true' }, el('label', {}, 'Sito web', trappola)),
    el('div', { class: 'campi' },
      campo('nome', 'Il tuo nome', { type: 'text', autocomplete: 'name', maxlength: '80', required: true }),
      campo('attivita', 'La tua attività', { type: 'text', autocomplete: 'organization', maxlength: '100', placeholder: t('Pizzeria da Mario') }, 'Facoltativo')),
    el('div', { class: 'campi' },
      campo('email', 'Email', { type: 'email', autocomplete: 'email', inputmode: 'email', required: true, placeholder: t('nome@attività.it') }, 'Qui arrivano la ricevuta e il link per installarlo.'),
      campo('telefono', 'Telefono', { type: 'tel', autocomplete: 'tel', maxlength: '30' }, 'Facoltativo: se preferisci che chi installa ti chiami.')),
    el('fieldset', { class: 'cs-gruppo' }, el('legend', {}, t('Dove gira il programma?')), dove),
    el('div', { class: 'cs-dominio' }, campo('dominio', 'Il tuo dominio', { type: 'text', inputmode: 'url', autocomplete: 'url', maxlength: '253', placeholder: 'gestionale.pizzeriadamario.it', spellcheck: 'false' },
      'Facoltativo. Non ce l\'hai? Lascia vuoto: chi installa ti consiglia il più adatto.'),
      el('p', { class: 'cs-dom-anteprima nascosto' }, el('span', { class: 'cs-dom-et' }, t('Il programma risponderà su')), vista)),
    el('div', { class: 'cs-avanti' }, el('button', { type: 'submit', class: 'bottone grande' }, t('Continua'))));
  queueMicrotask(anteprima);
  return f;
}

// 03 — assistenza e aggiornamenti
function passoCura() {
  if (!conCanone()) return el('div', { class: 'cs-corpo' }, el('p', {}, t('Questo prodotto non ha un canone: paghi solo l\'installazione.')), el('div', { class: 'cs-avanti' }, el('button', { type: 'button', class: 'bottone grande', onclick: () => avanti('cura') }, t('Continua'))));
  const risparmio = p.prezzo_mese * 12 - p.prezzo_anno, perc = Math.round((p.sconto_anno || 0) * 100);
  const voce = (k, titolo, prezzo, nota, badge) => el('label', { class: 'cs-periodo-voce' },
    el('input', { type: 'radio', name: 'periodo', value: k, class: 'sr', checked: S.periodo === k, onchange: () => { S.periodo = k; cambiato(); disegnaAgg(); } }),
    el('span', { class: 'cs-periodo-titolo' }, t(titolo), badge ? el('span', { class: 'cs-tag sole' }, badge) : null),
    el('strong', { class: 'cs-periodo-prezzo' }, prezzo), el('span', { class: 'tenue' }, nota));
  const periodo = p.prezzo_mese > 0 ? el('div', { class: 'cs-periodo', role: 'radiogroup', 'aria-label': t('Ogni quanto paghi l\'assistenza') },
    voce('mese', 'Mensile', t('{euro} al mese', { euro: euro(p.prezzo_mese) }), t('Disdici quando vuoi')),
    voce('anno', 'Annuale', t('{euro} all\'anno', { euro: euro(p.prezzo_anno) }), risparmio > 0 ? t('Risparmi {euro}', { euro: euro(risparmio) }) : t('Un pagamento all\'anno'), perc > 0 ? `−${perc}%` : null)) : null;
  const c = p.canone || {};
  const compreso = p.prezzo_mese > 0 ? el('ul', { class: 'cs-compreso' },
    el('li', {}, t('Risposta entro {ore} ore lavorative da chi l\'ha installato', { ore: c.rispostaOre || 24 })),
    el('li', {}, t('Il programma controllato ogni {min} minuti: se si ferma, lo sappiamo prima di te', { min: c.monitorMinuti || 5 })),
    el('li', {}, t('Aggiornamenti di sicurezza installati per te')),
    el('li', {}, t('Un rapporto ogni mese: cosa è stato fatto, cosa va bene'))) : null;
  const aggBox = el('div');
  function disegnaAgg() {
    if (!p.aggiornamenti) return;
    const a = p.aggiornamenti, prezzo = S.periodo === 'anno' ? t('{euro} all\'anno', { euro: euro(a.anno) }) : t('{euro} al mese', { euro: euro(a.mese) });
    aggBox.replaceChildren(el('label', { class: 'cs-agg' },
      el('input', { type: 'checkbox', class: 'interruttore', checked: S.agg, onchange: e => { S.agg = e.target.checked; cambiato(); } }),
      el('span', {}, el('strong', {}, t('Aggiornamenti garantiti da chi lo sviluppa'), ' ', el('span', { class: 'cs-agg-prezzo' }, `+ ${prezzo}`)),
        el('span', { class: 'aiuto' }, a.testo ? el('span', { 'data-no-t': '' }, a.testo) : t('Le versioni nuove, provate da chi lo sviluppa prima di arrivare a te.')))));
  }
  disegnaAgg();
  return el('div', { class: 'cs-corpo' }, periodo, compreso, aggBox,
    el('div', { class: 'cs-avanti' }, el('button', { type: 'button', class: 'bottone grande', onclick: () => avanti('cura') }, t('Continua'))));
}

// 04 — paga (o prenota)
const NOMI_METODO = { carta: 'Carta, Apple Pay, Google Pay', bonifico: 'Bonifico', crypto: 'Crypto' };
function passoPaga() {
  const msg = el('div', { class: 'messaggio', role: 'alert' });
  const privacy = el('input', { type: 'checkbox', checked: S.privacy, onchange: e => { S.privacy = e.target.checked; e.target.removeAttribute('aria-invalid'); msg.textContent = ''; } });
  const consenso = el('label', { class: 'spunta cs-consenso' }, privacy, el('span', {}, t('Ho letto le'), ' ', el('a', { href: '/contratto', target: '_blank' }, t('condizioni')), ' ', t('e l\'informativa'), ' ', el('a', { href: '/privacy', target: '_blank' }, t('privacy')), '.'));
  const serveConsenso = () => { if (S.privacy) return true; privacy.setAttribute('aria-invalid', 'true'); privacy.focus(); msg.textContent = t('Per continuare conferma di aver letto le condizioni e l\'informativa privacy'); return false; };

  if (p.prelancio) {
    const via = el('button', { type: 'button', class: 'bottone grande pieno', onclick: () => serveConsenso() && occupato(via, async () => { const r = await creaAcquisto(); if (r.prenotato) prenotato(); }, msg) }, t('Prenota l\'installazione'));
    return el('div', { class: 'cs-corpo' },
      el('div', { class: 'avviso attesa' }, el('span', {}, el('strong', {}, t('I pagamenti aprono al lancio.')), ' ', t('Prenota adesso: {nome} ti scrive per conoscerti, e quando si può pagare ti mandiamo il link. Non paghi niente oggi.', { nome: S.inst.nome }))),
      consenso, via, msg);
  }
  const m = metodi(), disponibili = Object.keys(m).filter(k => m[k]);
  if (!disponibili.length) return el('div', { class: 'cs-corpo' }, el('div', { class: 'avviso attesa' }, t('Con {nome} non si paga ancora online: scrivigli dalla pagina del prodotto.', { nome: S.inst.nome })),
    el('a', { class: 'bottone', href: `/p/${p.slug}#contatto` }, t('Scrivi a {nome}', { nome: S.inst.nome })));
  const area = el('div', { class: 'cs-metodo' });
  const schede = disponibili.length > 1 ? el('div', { class: 'cs-schede', role: 'tablist', 'aria-label': t('Come paghi') }, ...disponibili.map(k => el('button', {
    type: 'button', role: 'tab', class: 'cs-scheda', 'aria-selected': String(S.metodo === k), dati: { m: k },
    onclick: e => { S.metodo = k; e.currentTarget.parentElement.querySelectorAll('[role=tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.m === k))); disegnaLato(); mostraMetodo(); } }, t(NOMI_METODO[k])))) : null;
  function mostraMetodo() {
    chiudiStripe(); msg.textContent = ''; protezione();
    if (S.metodo === 'carta') {
      const box = el('div', { class: 'cs-stripe', id: 'stripe' });
      const via = el('button', { type: 'button', class: 'bottone grande pieno cs-paga', onclick: () => serveConsenso() && occupato(via, () => pagaCarta(box, via), msg) },
        el('span', { class: 'cs-lucchetto', 'aria-hidden': 'true' }, '🔒'), t('Paga {euro}', { euro: euro(conto().oggi) }));
      area.replaceChildren(el('p', { class: 'cs-guida' }, t('Il pagamento si apre qui sotto, protetto da Stripe: carta, Apple Pay, Google Pay o addebito SEPA. I dati della carta non passano da noi.')), via, box);
    } else {
      // bonifico e crypto: i pannelli della pagina prodotto, legati a questo acquisto (pagato, si va alla pagina d'installazione)
      if (!S.privacy) { attesa = true; area.replaceChildren(el('p', { class: 'cs-guida' }, t('Conferma qui sopra di aver letto le condizioni e il pagamento compare qui.'))); return; }
      attesa = false; area.replaceChildren(el('p', { class: 'cs-guida' }, t('Un attimo: preparo il pagamento…')));
      creaAcquisto().then(() => {
        const opz = { aggiornamenti: () => S.agg, acquisto: S.acquisto, oppure: true };
        const x = S.metodo === 'bonifico' ? pannelloBonifico(p, p.slug, () => S.inst, { ...opz, codice: q.get('bonifico') || (S.ordine?.metodo === 'bonifico' ? S.ordine.codice || '' : '') }) : pannelloCrypto(p, p.slug, () => S.inst, opz);
        area.replaceChildren(x.nodo);
        // quello che hai già scritto nel passo 02 non si riscrive
        const em = x.nodo.querySelector('input[name=email]'), no = x.nodo.querySelector('input[name=nome]'), pr = x.nodo.querySelector('input[name=privacy]');
        if (em) em.value = S.dati.email; if (no) no.value = S.dati.attivita || S.dati.nome; if (pr) pr.checked = true;
      }).catch(e => { area.replaceChildren(); msg.textContent = e.message; });
    }
  }
  // la protezione di chi compra, secondo il metodo: con carta le quote restano alla piattaforma per i giorni di trattenuta (la
  // conferma non le sblocca prima), in crypto senza escrow il pagamento va dritto nei wallet
  const garanzia = el('li', {});
  function protezione() {
    const n = p.trattenuta || 14, escrow = p.crypto?.reti?.some(r => r.escrow);
    const [titolo, testo] = S.metodo === 'crypto' ? (escrow ? ['Pagamento protetto', t('In crypto con escrow il pagamento resta nel contratto finché non confermi, o per {n} giorni: se qualcosa non va, segnalalo dalla tua area e si congela.', { n })]
      : ['Dritto nei wallet', t('In crypto il pagamento va dritto nei wallet: la piattaforma non può trattenerlo né rimborsarlo.')])
      : S.metodo === 'bonifico' ? ['Pagamento protetto', t('Con bonifico paghi la piattaforma, che fa anche l\'installazione: se qualcosa non va, segnalalo dalla tua area.')]
        : ['Pagamento protetto', t('Con carta le quote di chi installa e di chi sviluppa restano alla piattaforma per {n} giorni dal pagamento: se qualcosa non va, segnalalo dalla tua area e si fermano finché non decidiamo.', { n })];
    garanzia.replaceChildren(el('strong', {}, t(titolo)), el('span', {}, testo));
  }
  let attesa = false;
  queueMicrotask(mostraMetodo);
  privacy.addEventListener('change', () => { if (S.privacy && attesa) mostraMetodo(); });
  return el('div', { class: 'cs-corpo' }, consenso, schede, area, msg,
    el('ul', { class: 'cs-fiducia' },
      garanzia,
      el('li', {}, el('strong', {}, t('Un comando e gira')), el('span', {}, t('Appena paghi ricevi il comando che lo installa già configurato. Oppure lo fa {nome} con te.', { nome: S.inst.nome }))),
      el('li', {}, el('strong', {}, t('Niente vincoli')), el('span', {}, t('L\'assistenza la disdici quando vuoi. Il programma resta tuo, sul tuo server.')))));
}

async function creaAcquisto() {
  if (S.acquisto && S.impronta === impronta()) return { codice: S.acquisto, prenotato: false };
  const r = await chiama('POST', '/api/acquisto', { prodotto: p.slug, installatore: S.inst.codice, ...S.dati, periodo: S.periodo, aggiornamenti: S.agg, privacy: true,
    sito_web: $('#trappola')?.value || '' });
  S.acquisto = r.codice; S.impronta = impronta();
  if (!r.prenotato) history.replaceState(null, '', `${location.pathname}?a=${encodeURIComponent(r.codice)}`);
  return r;
}

// Stripe incorporato: lo script di Stripe solo qui, solo quando serve
let stripeJs;
const caricaStripe = () => stripeJs ??= new Promise((ok, no) => {
  if (window.Stripe) return ok(window.Stripe);
  const s = document.createElement('script'); s.src = 'https://js.stripe.com/v3/'; s.async = true;
  s.onload = () => ok(window.Stripe); s.onerror = () => { stripeJs = null; no(new Error(t('Non riesco a caricare il pagamento di Stripe: controlla la connessione o disattiva il blocco degli annunci per questa pagina'))); };
  document.head.append(s);
});
function chiudiStripe() { if (S.checkout) { try { S.checkout.destroy(); } catch { } S.checkout = null; } }
async function pagaCarta(box, via) {
  await creaAcquisto();
  const r = await chiama('POST', '/api/acquisto/paga', { codice: S.acquisto });
  if (r.fatto) { location.href = r.pagina; return; }
  if (r.url) { togliBozza(); location.href = r.url; await new Promise(() => {}); }
  const Stripe = await caricaStripe();
  chiudiStripe();
  S.checkout = await Stripe(r.pubblica, { locale: lingua }).initEmbeddedCheckout({ fetchClientSecret: async () => r.client_secret });
  via.classList.add('nascosto'); box.classList.add('aperto');
  S.checkout.mount(box); togliBozza();
  box.scrollIntoView({ behavior: piano ? 'auto' : 'smooth', block: 'start' });
}

// la prenotazione (prelancio): la pagina diventa la conferma
function prenotato() {
  togliBozza();
  const i = S.inst;
  $('#passi').replaceChildren(el('div', { class: 'cs-fatto carta angoli', role: 'status' },
    el('p', { class: 'cs-timbro', 'aria-hidden': 'true' }, t('Prenotato')),
    el('h2', {}, t('Fatto, {nome}.', { nome: S.dati.nome.split(' ')[0] })),
    el('p', {}, t('{inst} riceve adesso la tua richiesta e ti scrive a {email} per conoscerti e capire cosa ti serve.', { inst: i.nome, email: S.dati.email })),
    el('ol', { class: 'cs-dopo' },
      el('li', {}, el('strong', {}, t('Ti scrive chi installa')), el('span', {}, t('Di solito entro un giorno lavorativo.'))),
      el('li', {}, el('strong', {}, t('Al lancio ricevi il link')), el('span', {}, t('Paghi in sicurezza, con la carta o come preferisci.'))),
      el('li', {}, el('strong', {}, t('Un comando e gira')), el('span', {}, t('Poi lo personalizzate insieme.')))),
    el('div', { class: 'azioni' }, el('a', { class: 'bottone', href: `/p/${p.slug}` }, t('Torna al prodotto')), el('a', { class: 'bottone secondario', href: '/esplora' }, t('Guarda altri prodotti')))));
  $('#mappa').querySelectorAll('li').forEach(li => { li.dataset.stato = 'fatto'; });
  scrollTo({ top: 0, behavior: piano ? 'auto' : 'smooth' });
}

// ---------------- la ricevuta ----------------
let numeroOggi = null;
function disegnaLato() {
  if (!p) return;
  const i = S.inst, c = conto(), lato = $('#lato');
  // la divisione dell'installazione secondo il metodo scelto: con carta c'è il costo di Stripe (già dentro la parte della
  // piattaforma: si mostra a parte), con bonifico e crypto la loro divisione, senza Stripe
  const metodo = p.prelancio ? 'carta' : S.metodo, conCarta = metodo === 'carta';
  const div = conCarta ? i?.divisione?.avvio : i?.divisione?.[metodo], base = avvio(), costo = conCarta ? div?.costo || 0 : 0;
  const quote = div && base > 0 ? [['installatore', t('a chi lo installa'), div.installatore], ['builder', t('a chi lo sviluppa'), div.builder], ['piattaforma', t('alla piattaforma'), div.piattaforma - costo],
    ...(conCarta ? [['costo', t('a Stripe'), costo]] : [])].filter(x => x[2] > 0) : [];
  numeroOggi = el('strong', { class: 'cs-r-totale-n', 'data-no-t': '' }, euro(S.totale));
  const r = el('div', { class: 'cs-r-contenuto' },
    el('div', { class: 'cs-r-testa' }, el('span', { class: 'cs-r-codice', 'data-no-t': '' }, `RB-${p.slug.slice(0, 10).toUpperCase()}`), el('span', { class: 'cs-r-codice' }, p.prelancio ? t('prenotazione') : t('ricevuta'))),
    el('h2', { class: 'cs-r-prodotto', 'data-no-t': '' }, p.nome),
    i ? el('p', { class: 'cs-r-chi' }, avatar(i, 'mini'), el('span', {}, t('installato da'), ' ', el('strong', { 'data-no-t': '' }, i.nome))) : null,
    el('ul', { class: 'cs-r-righe' }, ...c.righe.map(([x, nota, v]) => el('li', {}, el('span', {}, x, el('small', {}, nota)), el('span', { class: 'cs-r-euro', 'data-no-t': '' }, euro(v))))),
    el('div', { class: 'cs-r-totale' }, el('span', {}, t(p.prelancio ? 'Al lancio paghi' : 'Oggi paghi')), numeroOggi),
    c.poi ? el('p', { class: 'cs-r-poi' }, c.poi) : null,
    quote.length ? el('div', { class: 'cs-r-quote' }, el('p', { class: 'cs-r-et' }, t('Dove vanno i soldi dell\'installazione')),
      el('div', { class: 'cs-r-barra', role: 'img', 'aria-label': quote.map(x => `${x[1]} ${Math.round(x[2] / base * 100)}%`).join(', ') },
        ...quote.map(([k, , v]) => { const s = el('span', { class: `q-${k}` }); s.style.flexGrow = String(v); return s; })),
      el('ul', { class: 'cs-r-legenda' }, ...quote.map(([k, x, v]) => el('li', {}, el('i', { class: `q-${k}` }), el('span', {}, x), el('span', { 'data-no-t': '' }, `${Math.round(v / base * 100)}%`))))) : null);
  if (!lato.firstChild) lato.append(el('div', { class: 'cs-ricevuta' }, el('div', { class: 'cs-r-contenuto' }), terminale()));
  lato.querySelector('.cs-r-contenuto').replaceWith(r);
  notaTerminale();
  conta(c.oggi);
  // la barra in basso sul telefono: il totale sempre in vista
  $('#barra-mobile').replaceChildren(el('span', {}, t(p.prelancio ? 'Al lancio' : 'Oggi')), el('strong', { 'data-no-t': '' }, euro(c.oggi)),
    el('button', { type: 'button', class: 'bottone fantasma piccolo', onclick: () => $('#lato').scrollIntoView({ behavior: piano ? 'auto' : 'smooth' }) }, t('Dettagli')));
}
// il totale scorre fino al numero nuovo (come un contatore), senza animazione per chi la toglie
let corsa = 0;
function conta(fine) {
  const inizio = S.totale, mio = ++corsa;
  if (piano || inizio === fine || !numeroOggi) { S.totale = fine; if (numeroOggi) numeroOggi.textContent = euro(fine); return; }
  const t0 = performance.now(), dur = 520;
  numeroOggi.classList.add('cambia');
  const passo = ora => {
    if (mio !== corsa) return;
    const k = Math.min(1, (ora - t0) / dur), e = 1 - (1 - k) ** 3, v = Math.round(inizio + (fine - inizio) * e);
    S.totale = v; numeroOggi.textContent = euro(v);
    if (k < 1) requestAnimationFrame(passo); else numeroOggi.classList.remove('cambia');
  };
  requestAnimationFrame(passo);
}
// «dopo il pagamento»: il terminale che mostra cosa succede, una riga alla volta
function terminale() {
  const host = location.host, righe = [t('Docker pronto'), t('{nome} scaricato', { nome: p.nome }), t('Impostazioni di partenza scritte'), t('Online in {n} minuti', { n: 3 })];
  const box = el('div', { class: 'cs-term', 'aria-label': t('Dopo il pagamento: un comando sul tuo server e il programma gira') },
    el('p', { class: 'cs-r-et' }, t('Dopo il pagamento')),
    el('pre', { 'data-no-t': '', 'aria-hidden': 'true' }, el('span', { class: 'cs-term-pr' }, '$ '), `curl -fsSL ${host}/i/`, el('span', { class: 'cs-term-k' }, '••••••'), '.sh | sudo bash'),
    el('ul', { 'aria-hidden': 'true' }, ...righe.map((x, j) => { const li = el('li', {}, el('span', { class: 'cs-term-ok' }, '✓'), ' ', x); li.style.setProperty('--j', String(j)); return li; })),
    el('p', { class: 'cs-term-nota' }));
  return box;
}
function notaTerminale() {
  const n = document.querySelector('.cs-term-nota'); if (!n) return;
  n.textContent = S.dati.dove === 'mio' ? t('Lo lanci tu: è tutto scritto nella pagina che ricevi.') : t('Lo lancia {nome} per te, o insieme a te.', { nome: S.inst?.nome || t('chi installa') });
}

// ---------------- l'avvio ----------------
const carico = $('#carico'), cassa = $('#cassa'), fermo = $('#fermo');
try {
  p = S.p = await chiama('GET', `/api/prodotto?slug=${encodeURIComponent(slug)}${q.get('i') ? `&ref=${encodeURIComponent(q.get('i'))}` : ''}`);
} catch (e) {
  carico.remove(); fermo.classList.remove('nascosto');
  fermo.append(stop('Prodotto non trovato', e.message, el('a', { class: 'bottone', href: '/esplora' }, t('Apri il catalogo'))));
  throw e;
}
document.title = `${t('La cassa')} · ${p.nome} · ${document.title.split('·').pop().trim()}`;
$('#indietro').href = `/p/${p.slug}`; $('#indietro').textContent = `← ${t('Torna a {nome}', { nome: p.nome })}`;
const [prima, dopo] = t('Installa {nome} nella tua attività').split('{nome}');
$('#titolo').replaceChildren(prima, el('span', { class: 'evidenzia', 'data-no-t': '' }, p.nome), dopo);

// gli installatori: chi ti ha mandato qui in cima, poi chi ha più installazioni confermate, poi il voto e il prezzo
const tutti = [...(p.installatori || [])].sort((a, b) => (b.codice === p.scelto) - (a.codice === p.scelto) || (b.confermate || 0) - (a.confermate || 0)
  || (b.voto || 0) - (a.voto || 0) || a.prezzo_avvio - b.prezzo_avvio);
const minimo = tutti.length > 1 ? Math.min(...tutti.map(i => i.prezzo_avvio)) : null;

if (!tutti.length) {
  carico.remove(); fermo.classList.remove('nascosto');
  fermo.append(stop('Nessuno lo installa ancora', 'Per questo prodotto non c\'è ancora un installatore abilitato nella tua zona: chi installa programmi per le attività può offrirlo da subito.',
    el('a', { class: 'bottone', href: `/p/${p.slug}#contatto` }, t('Torna al prodotto')), el('a', { class: 'bottone secondario', href: '/installatori' }, t('Lo installi tu? Diventa installatore'))));
} else avvia();

function stop(titolo, testo, ...azioni) {
  return el('div', { class: 'cs-stop carta angoli' }, el('p', { class: 'numero-sezione', dati: { n: 'RB' } }, t('La cassa')), el('h1', {}, t(titolo)), el('p', {}, t(testo)), el('div', { class: 'azioni' }, ...azioni));
}

async function avvia() {
  const b = leggiBozza();
  if (b) { Object.assign(S.dati, b.dati || {}); if (!q.get('periodo') && b.periodo) S.periodo = b.periodo; if (!q.get('agg') && b.agg) S.agg = !!b.agg; }
  const voluto = tutti.find(i => i.codice === (q.get('i') || p.scelto));   // dal link di chi installa, o dalla scelta sulla pagina prodotto
  S.inst = voluto || tutti.find(i => i.codice === b?.i) || (tutti.length === 1 ? tutti[0] : null);
  if (!S.inst) S.inst = tutti[0];
  if (!p.aggiornamenti) S.agg = false;
  // di ritorno (dalla banca, o ricaricando a metà pagamento): l'acquisto è già nato
  const a = q.get('a');
  if (a && /^[A-Za-z0-9_-]{24}$/.test(a)) {
    const v = await chiama('GET', `/api/installa?k=${encodeURIComponent(a)}`).catch(() => null);
    if (v && ['pagato', 'in_arrivo'].includes(v.stato)) { location.replace(`/installa/${a}`); return; }
    if (v) {
      S.inst = tutti.find(i => i.codice === v.installatore?.codice) || S.inst;
      Object.assign(S.dati, { nome: v.nome || '', attivita: v.attivita || '', email: v.email || '', telefono: v.telefono || '', dove: v.dove, dominio: v.dominio || '' });
      S.periodo = v.periodo; S.agg = !!v.aggiornamenti; S.acquisto = a; S.impronta = impronta(); S.privacy = true;
      // un ordine con bonifico già aperto per questo acquisto: si riapre quello, non si paga di nuovo con la carta
      S.ordine = v.ordine || null;
      S.metodo = q.get('bonifico') || S.ordine?.metodo === 'bonifico' ? 'bonifico' : S.ordine?.metodo === 'crypto' ? 'crypto' : 'carta';
      ['chi', 'tu', 'cura'].forEach(k => S.fatti.add(k)); S.passo = 3;
    }
  } else if (tutti.length === 1 || voluto) { S.fatti.add('chi'); S.passo = 1; }
  if (!conCanone()) S.fatti.add('cura');
  if (!metodi()[S.metodo]) S.metodo = Object.entries(metodi()).find(([, v]) => v)?.[0] || 'carta';
  carico.remove(); cassa.classList.remove('nascosto');
  disegnaPassi(); disegnaLato(); apri(S.passo, { primo: true });
}
