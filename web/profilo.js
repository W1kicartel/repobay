// Il profilo pubblico /u/<codice>: chi è, dove lavora, cosa installa e cosa costruisce, le recensioni dei clienti, il calendario
// per prenotare una chiamata e il modulo per scrivergli (la sua email resta privata: risponde lui per email).
import { $, el, t, chiama, data, stelle, avatar, occupato, pronta } from './comune.js';
import { svgIcona, formatoVoto, numero } from './vetrina.js';
await pronta;

const box = $('#profilo');
const codice = decodeURIComponent(location.pathname.split('/')[2] || '');
const sicuro = u => (/^https?:\/\//i.test(String(u || '')) ? String(u) : null);
const pulito = u => String(u).replace(/^https?:\/\//i, '').replace(/\/$/, '');

async function carica() {
  box.setAttribute('aria-busy', 'true');
  let u, nome = '';
  try {
    [u, { nome }] = await Promise.all([chiama('GET', `/api/profilo?codice=${encodeURIComponent(codice)}`), chiama('GET', '/api/sessione').catch(() => ({ nome: '' }))]);
  } catch (e) {
    box.setAttribute('aria-busy', 'false');
    if (e.stato === 404) {
      document.title = document.title.replace(/^[^·]*/, `${t('Profilo non trovato')} `);
      return box.replaceChildren(el('div', { class: 'vuoto medio', role: 'alert' }, el('h3', {}, t('Profilo non trovato')), el('p', {}, t('Il link potrebbe essere sbagliato, oppure il profilo non è più attivo.')),
        el('div', { class: 'azioni' }, el('a', { class: 'bottone', href: '/esplora' }, t('Vai al catalogo')))));
    }
    return box.replaceChildren(el('div', { class: 'avviso errore', role: 'alert' }, el('span', {}, e.message), el('button', { class: 'bottone piccolo secondario', type: 'button', onclick: carica }, t('Riprova'))));
  }
  box.setAttribute('aria-busy', 'false');
  document.title = document.title.replace(/^[^·]*/, `${u.nome} `);
  const nomeBreve = String(u.nome).split(/\s+/)[0];

  // ---------------- la testata del profilo ----------------
  const meta = [
    u.zona ? el('span', {}, svgIcona('luogo'), u.zona) : null,
    nome ? el('span', {}, t('Su {nome} dal {data}', { nome, data: data(u.dal) })) : el('span', {}, t('Iscritto dal {data}', { data: data(u.dal) })),
    u.voto ? el('span', {}, stelle(u.voto), el('b', {}, formatoVoto(u.voto)), el('span', {}, t(u.recensioni_n === 1 ? '({n} recensione)' : '({n} recensioni)', { n: u.recensioni_n }))) : null,
  ];
  const link = [
    sicuro(u.sito) ? el('a', { class: 'bottone fantasma piccolo', href: sicuro(u.sito), rel: 'noopener nofollow ugc', target: '_blank' }, svgIcona('link'), el('span', { 'data-no-t': '' }, pulito(u.sito))) : null,
    u.github ? el('a', { class: 'bottone fantasma piccolo', href: `https://github.com/${encodeURIComponent(u.github)}`, rel: 'noopener', target: '_blank' }, svgIcona('github'), el('span', { 'data-no-t': '' }, u.github)) : null,
  ];
  // il cartellino da officina: il foro, il numero, i ruoli come adesivi
  const ruoli = [u.costruisce.length ? el('span', { class: 'adesivo ruolo-builder', 'data-no-t': '' }, 'Builder') : null,
    u.installa.length ? el('span', { class: 'adesivo ruolo-installatore' }, t('Installatore')) : null];
  const testa = el('div', { class: 'profilo-testa cartellino' },
    el('div', { class: 'cartellino-testa' }, el('span', { class: 'foro', 'aria-hidden': 'true' }), el('span', {}, t('Cartellino')), el('span', { 'data-no-t': '' }, `N° ${u.codice}`), el('span', { class: 'ruoli' }, ...ruoli)),
    avatar(u, 'grande'),
    el('div', {}, el('h1', { class: 'piccolo' }, u.nome), el('div', { class: 'meta' }, ...meta),
      u.bio ? el('p', { class: 'bio' }, u.bio) : null,
      el('div', { class: 'azioni' },
        sicuro(u.calendario) ? el('a', { class: 'bottone magnetico', href: sicuro(u.calendario), rel: 'noopener nofollow', target: '_blank' }, svgIcona('calendario'), t('Prenota una chiamata')) : null,
        el('a', { class: `bottone ${sicuro(u.calendario) ? 'secondario' : 'magnetico'}`, href: '#scrivi' }, t('Scrivi a {nome}', { nome: nomeBreve })), ...link)));

  // ---------------- cosa installa, cosa costruisce, le recensioni ----------------
  // le liste lunghe: i primi 6, poi «Mostra tutti»
  const aTappe = (carte, primi = 6) => {
    const griglia = el('div', { class: 'mini' }, ...carte.slice(0, primi));
    if (carte.length <= primi) return [griglia];
    const altri = el('button', { class: 'bottone secondario piccolo altri', type: 'button', onclick: () => { griglia.append(...carte.slice(primi)); altri.remove(); } }, t('Mostra tutti ({n})', { n: carte.length }));
    return [griglia, altri];
  };
  const sezione = (titolo, n, ...figli) => el('section', { class: 'appare' }, el('h2', {}, t(titolo), n ? el('small', {}, String(n)) : null), ...figli);
  const installa = u.installa.length ? sezione('Prodotti che installa', u.installa.length, ...aTappe(u.installa.map(p =>
    el('a', { class: 'carta cliccabile', href: `/p/${encodeURIComponent(p.slug)}?ref=${encodeURIComponent(u.codice)}` }, el('h3', {}, p.nome), el('p', {}, p.descrizione || ''),
      p.zona ? el('span', { class: 'zona' }, svgIcona('luogo'), ' ', p.zona) : null)))) : null;
  const costruisce = u.costruisce.length ? sezione('Prodotti che costruisce', u.costruisce.length, ...aTappe(u.costruisce.map(p =>
    el('a', { class: 'carta cliccabile', href: `/p/${encodeURIComponent(p.slug)}` }, el('h3', {}, p.nome), el('p', {}, p.descrizione || ''),
      el('span', { class: 'zona' }, svgIcona('stella'), ' ', t('{n} stelle su GitHub', { n: numero(p.stelle) })))))) : null;
  // le recensioni sono di chi installa: a chi costruisce soltanto non si mostra la sezione vuota
  const recensioni = !u.installa.length && !u.recensioni_n ? null : sezione('Recensioni', u.recensioni_n, u.recensioni.length ? el('div', { class: 'recensioni' }, ...u.recensioni.map(r =>
    el('article', { class: 'recensione' },
      el('div', { class: 'sopra' }, el('span', {}, el('span', { class: 'chi' }, r.autore || t('Un cliente')), ' ', el('span', { class: 'tenue piccolo' }, t('per {prodotto}', { prodotto: r.prodotto }))), stelle(r.voto)),
      r.testo ? el('p', {}, r.testo) : null,
      r.risposta ? el('div', { class: 'risposta' }, el('b', {}, t('Risposta di {nome}', { nome: nomeBreve })), el('br'), r.risposta) : null,
      el('span', { class: 'quando' }, data(r.creata)))))
    : el('div', { class: 'vuoto' }, el('p', {}, t('Ancora nessuna recensione. Le scrivono solo i clienti che hanno comprato davvero.'))));
  const nulla = !installa && !costruisce ? el('div', { class: 'vuoto appare' }, el('h3', {}, t('Ancora nessun prodotto')), el('p', {}, t('Questo profilo non installa né costruisce ancora prodotti del catalogo.'))) : null;

  box.replaceChildren(testa, el('div', { class: 'due profilo-corpo' }, el('div', {}, installa, costruisce, nulla, recensioni), modulo(u, nomeBreve)));
  if (location.hash === '#scrivi') $('#scrivi')?.scrollIntoView();
}

// ---------------- il modulo per scrivergli ----------------
function modulo(u, nomeBreve) {
  const errore = nome => el('span', { class: 'errore-campo', id: `err-${nome}` });
  const campo = (etichetta, input, nome, aiuto) => el('label', {}, t(etichetta), input, aiuto ? el('span', { class: 'aiuto' }, t(aiuto)) : null, errore(nome));
  const inp = (name, attr = {}) => el('input', { name, id: `c-${name}`, 'aria-describedby': `err-${name}`, ...attr });
  const scelto = new URLSearchParams(location.search).get('prodotto');
  const prodotto = u.installa.length ? el('select', { name: 'prodotto', id: 'c-prodotto' }, el('option', { value: '' }, t('Non so ancora, consigliami tu')),
    ...u.installa.map(p => el('option', { value: p.slug, selected: p.slug === scelto }, p.nome))) : null;
  const privacy = el('input', { type: 'checkbox', name: 'privacy', id: 'c-privacy', 'aria-describedby': 'err-privacy' });
  const messaggio = el('p', { class: 'messaggio', role: 'alert' });
  const invia = el('button', { class: 'bottone pieno', type: 'submit' }, t('Invia il messaggio'));
  const f = el('form', { class: 'modulo', novalidate: true },
    campo('Il tuo nome o quello della tua attività', inp('nome', { type: 'text', autocomplete: 'organization', maxlength: '80', required: true }), 'nome'),
    campo('Email', inp('email', { type: 'email', autocomplete: 'email', maxlength: '120', required: true }), 'email', 'Ti risponde qui. Non la mostriamo a nessun altro.'),
    campo('Telefono (facoltativo)', inp('telefono', { type: 'tel', autocomplete: 'tel', maxlength: '30' }), 'telefono'),
    prodotto ? campo('Per quale prodotto?', prodotto, 'prodotto') : null,
    campo('Cosa ti serve', el('textarea', { name: 'messaggio', id: 'c-messaggio', maxlength: '3000', required: true, 'aria-describedby': 'err-messaggio', placeholder: t('Che attività hai, dove sei, cosa vorresti installare…') }), 'messaggio'),
    el('div', { class: 'trappola', 'aria-hidden': 'true' }, el('label', {}, 'Sito web', el('input', { type: 'text', name: 'sito_web', tabindex: '-1', autocomplete: 'off' }))),
    el('div', { class: 'campo' }, el('label', { class: 'spunta' }, privacy, el('span', {}, t('Ho letto l\'informativa privacy e accetto che i miei dati arrivino a {nome}.', { nome: nomeBreve }), ' ', el('a', { href: '/privacy', target: '_blank' }, t('Leggi l\'informativa')))), errore('privacy')),
    messaggio, invia);

  const regole = {
    nome: v => v.trim().length >= 2 || 'Scrivi il tuo nome o quello della tua attività',
    email: v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) || 'Email non valida: serve per risponderti',
    messaggio: v => v.trim().length >= 10 || 'Scrivi due righe: cosa ti serve, dove sei',
  };
  const controlla = nome => {
    const i = f.elements[nome], esito = nome === 'privacy' ? (i.checked || 'Per mandare la richiesta conferma di aver letto l\'informativa privacy') : regole[nome](i.value);
    const err = f.querySelector(`#err-${nome}`); err.textContent = esito === true ? '' : t(esito); i.setAttribute('aria-invalid', String(esito !== true));
    return esito === true;
  };
  for (const n of Object.keys(regole)) f.elements[n].addEventListener('blur', () => { if (f.elements[n].value) controlla(n); });
  for (const n of [...Object.keys(regole), 'privacy']) f.elements[n].addEventListener(n === 'privacy' ? 'change' : 'input', () => { if (f.elements[n].getAttribute('aria-invalid') === 'true') controlla(n); });

  f.addEventListener('submit', async e => {
    e.preventDefault();
    const ok = ['nome', 'email', 'messaggio', 'privacy'].map(controlla);
    if (ok.includes(false)) { f.querySelector('[aria-invalid=true]')?.focus(); return; }
    const x = f.elements;
    const fatto = await occupato(invia, () => chiama('POST', '/api/contatto', { installatore: u.codice, prodotto: x.prodotto?.value || null, nome: x.nome.value.trim(), email: x.email.value.trim(),
      telefono: x.telefono.value.trim(), messaggio: x.messaggio.value.trim(), privacy: true, sito_web: x.sito_web.value }), messaggio);
    if (!fatto) return;
    const grazie = el('div', { class: 'avviso ok', role: 'status', tabindex: '-1' }, el('span', {}, t('Messaggio inviato. {nome} ti risponde per email.', { nome: nomeBreve })));
    f.replaceWith(grazie, el('button', { class: 'bottone fantasma piccolo', type: 'button', onclick: e2 => { e2.target.remove(); grazie.replaceWith(f); f.reset(); } }, t('Scrivi un altro messaggio')));
    grazie.focus();
  });
  return el('aside', { class: 'carta lato-fisso', id: 'scrivi' }, el('h2', { class: 'titolo-modulo' }, t('Scrivi a {nome}', { nome: nomeBreve })),
    el('p', { class: 'tenue piccolo' }, t('Racconta cosa ti serve: ti risponde direttamente, senza impegno.')), f);
}
carica();
