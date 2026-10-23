// Il corso per installatori: le lezioni (dal server, nella lingua scelta), l'indice con le lezioni già lette (solo in questo
// browser) e il test in fondo. Il test si fa con il proprio conto: domande estratte a caso, un'ora di tempo, la correzione sul
// server. Chi sbaglia vede quali lezioni rileggere, non le risposte giuste.
import { $, el, t, chiama, occupato, data, avviso, pronta } from './comune.js';
await pronta;

const ricorda = { leggi: () => { try { return new Set(JSON.parse(localStorage.getItem('corso:lette') || '[]')); } catch { return new Set(); } },
  scrivi: s => { try { localStorage.setItem('corso:lette', JSON.stringify([...s])); } catch { } } };
const lette = ricorda.leggi();
// da dove arriva (la pagina di un prodotto): dopo il test si torna lì
const dopo = (() => { const d = new URLSearchParams(location.search).get('dopo') || ''; return /^\/[a-z0-9/_-]*$/i.test(d) && !d.startsWith('//') ? d : ''; })();
const due = n => String(n + 1).padStart(2, '0');
let C;

function blocco(b) {
  if (b.p) return el('p', { 'data-no-t': '' }, b.p);
  if (b.titolo) return el('h3', { 'data-no-t': '' }, b.titolo);
  if (b.lista) return el(b.numerata ? 'ol' : 'ul', { 'data-no-t': '' }, ...b.lista.map(x => el('li', {}, x)));
  if (b.codice) return el('pre', { class: 'corso-codice', 'data-no-t': '' }, el('code', {}, b.codice));
  if (b.attenzione) return el('p', { class: 'corso-attenzione', 'data-no-t': '' }, el('strong', {}, t('Attenzione')), ' ', b.attenzione);
  return null;
}

function indice() {
  $('#corso-indice').replaceChildren(...C.lezioni.map((l, i) => el('li', { class: lette.has(l.id) ? 'letta' : '' },
    el('a', { href: `#lezione-${l.id}` }, el('span', { class: 'art-n', 'data-no-t': '' }, due(i)), el('span', { 'data-no-t': '' }, l.titolo),
      el('span', { class: 'corso-spunta', 'aria-label': lette.has(l.id) ? t('letta') : '' }, lette.has(l.id) ? '✓' : '')))),
    el('li', {}, el('a', { href: '#test' }, el('span', { class: 'art-n', 'data-no-t': '' }, '09'), el('span', {}, t('Il test')))));
}

function lezioni() {
  $('#corso-lezioni').replaceChildren(...C.lezioni.map((l, i) => {
    const spunta = el('input', { type: 'checkbox' }); spunta.checked = lette.has(l.id);
    spunta.addEventListener('change', () => { spunta.checked ? lette.add(l.id) : lette.delete(l.id); ricorda.scrivi(lette); indice(); });
    return el('section', { class: 'corso-lezione', id: `lezione-${l.id}`, 'aria-labelledby': `t-${l.id}` },
      el('h2', { id: `t-${l.id}` }, el('span', { class: 'art-n', 'data-no-t': '' }, due(i)), el('span', { 'data-no-t': '' }, l.titolo),
        el('span', { class: 'corso-minuti' }, t('{n} min', { n: l.minuti }))),
      ...l.blocchi.map(blocco).filter(Boolean),
      el('label', { class: 'spunta corso-letta' }, spunta, el('span', {}, t('L\'ho letta'))));
  }));
}

// il riquadro in alto: a che punto sei
function stato() {
  const s = C.io, box = $('#corso-stato');
  if (!s) { box.replaceChildren(el('p', {}, t('Le lezioni sono per tutti. Per il test serve un conto.'))); return; }
  if (s.corso) {
    box.replaceChildren(el('p', { class: 'corso-fatto' }, el('strong', {}, t('Test superato')), ' ', t('il {data}, con {n} risposte giuste.', { data: data(s.corso), n: s.punti })),
      el('p', {}, s.impegnativi ? t('Puoi offrire tutti i programmi del catalogo.')
        : t('Programmi impegnativi: {n} installazioni confermate su {servono}.', { n: s.confermate, servono: s.servono })));
    return;
  }
  box.replaceChildren(el('p', {}, t('Leggi le lezioni, poi fai il test in fondo alla pagina.')), el('a', { class: 'bottone piccolo', href: '#test' }, t('Vai al test')));
}

const ora = s => new Date(s).toLocaleTimeString(document.documentElement.lang === 'en' ? 'en-GB' : 'it-IT', { hour: '2-digit', minute: '2-digit' });

function test() {
  const box = $('#corso-test'), s = C.io, msg = el('div', { class: 'messaggio', role: 'alert' });
  const regole = el('p', {}, t('{d} domande estratte a caso fra tutte le lezioni. Si supera con {s} risposte giuste. Hai un\'ora per finirlo; se non lo superi, riprovi dopo {a} minuti con altre domande.',
    { d: C.domande, s: C.soglia, a: C.attesa }));
  if (!s) {
    box.replaceChildren(regole, el('a', { class: 'bottone', href: `/accedi?dopo=${encodeURIComponent(`/corso${dopo ? `?dopo=${dopo}` : ''}#test`)}` }, t('Entra per fare il test')));
    return;
  }
  if (s.corso) { box.replaceChildren(fatto(s)); return; }
  const via = el('button', { class: 'bottone', type: 'button' }, s.inCorso ? t('Riprendi il test') : t('Comincia il test'));
  via.addEventListener('click', () => occupato(via, async () => domande(await chiama('POST', '/api/corso/prova')), msg));
  if (s.riprova) { via.disabled = true; regole.after(el('p', { class: 'avviso attesa' }, t('Puoi rifare il test alle {ora}.', { ora: ora(s.riprova) }))); }
  box.replaceChildren(regole, via, msg);
}

// dopo il test superato: cosa si sblocca e dove andare
function fatto(s) {
  // tutto il catalogo tranne gli impegnativi (anche i programmi senza guida: la difficoltà la dice la guida)
  const n = C.catalogo, base = n.totale - n.impegnativa;
  return el('div', { class: 'corso-esito superato' },
    el('p', { class: 'corso-voto' }, el('strong', {}, t('Superato.')), ' ', t('{n} risposte giuste.', { n: s.punti })),
    el('p', {}, s.impegnativi || !n.impegnativa ? t('Ora puoi offrire tutti i programmi del catalogo.')
      : t('Ora puoi offrire {n} programmi del catalogo su {tot}: tutti tranne quelli impegnativi.', { n: base, tot: n.totale })),
    s.impegnativi || !n.impegnativa ? null
      : el('p', {}, t('Quelli impegnativi si sbloccano dopo {servono} installazioni confermate dai clienti: ne hai {fatte}.', { servono: s.servono, fatte: s.confermate })),
    el('div', { class: 'azioni' }, dopo ? el('a', { class: 'bottone', href: dopo }, t('Torna al prodotto')) : null,
      el('a', { class: `bottone ${dopo ? 'secondario' : ''}`, href: '/esplora' }, t('Guarda il catalogo')), el('a', { class: 'bottone secondario', href: '/area' }, t('La tua area'))));
}

function domande(p) {
  const box = $('#corso-test'), msg = el('div', { class: 'messaggio', role: 'alert' });
  const gruppi = p.domande.map(d => el('fieldset', { class: 'corso-domanda' },
    el('legend', {}, el('span', { class: 'corso-n', 'data-no-t': '' }, `${d.n + 1}.`), ' ', el('span', { 'data-no-t': '' }, d.domanda)),
    ...d.opzioni.map((o, i) => el('label', { class: 'corso-opzione' }, el('input', { type: 'radio', name: `d${d.n}`, value: String(i), required: true }), el('span', { 'data-no-t': '' }, o)))));
  const consegna = el('button', { class: 'bottone grande', type: 'submit' }, t('Consegna'));
  const f = el('form', { class: 'corso-modulo', novalidate: true },
    el('p', { class: 'corso-tempo' }, t('Hai tempo fino alle {ora}. Se ricarichi la pagina, ritrovi le stesse domande.', { ora: ora(p.scade) })),
    ...gruppi, el('div', { class: 'corso-consegna' }, consegna, el('span', { class: 'tenue', id: 'corso-mancano' }), msg));
  const risposte = () => p.domande.map(d => { const x = f.querySelector(`input[name="d${d.n}"]:checked`); return x ? Number(x.value) : null; });
  const conta = () => {
    const n = risposte().filter(x => x === null).length;
    $('#corso-mancano').textContent = n > 1 ? t('Mancano {n} risposte', { n }) : n ? t('Manca una risposta') : t('Tutte le risposte date');
    if (!n) msg.textContent = '';
  };
  f.addEventListener('change', e => { e.target.closest('fieldset')?.removeAttribute('aria-invalid'); conta(); });
  f.addEventListener('submit', e => {
    e.preventDefault();
    const r = risposte(), primo = r.indexOf(null);
    if (primo >= 0) {
      for (const [i, g] of gruppi.entries()) if (r[i] === null) g.setAttribute('aria-invalid', 'true');
      msg.textContent = t('Rispondi a tutte le domande prima di consegnare'); gruppi[primo].querySelector('input').focus(); return;
    }
    occupato(consegna, async () => { esito(await chiama('POST', '/api/corso/consegna', { prova: p.prova, risposte: r })); }, msg);
  });
  box.replaceChildren(f); conta();
  $('#test').scrollIntoView({ block: 'start' });
}

function esito(r) {
  C.io = r.stato; stato();
  const box = $('#corso-test');
  if (r.superato) { avviso(t('Test superato')); box.replaceChildren(fatto(r.stato)); $('#test').scrollIntoView({ block: 'start' }); return; }
  // le lezioni da rileggere, una volta sola, e le domande sbagliate (senza la risposta giusta)
  const daRileggere = [...new Map(r.errori.map(e => [e.lezione, e.titolo])).entries()];
  box.replaceChildren(el('div', { class: 'corso-esito' },
    el('p', { class: 'corso-voto' }, el('strong', {}, t('Non ancora.')), ' ', t('{g} risposte giuste su {tot}: ne servono {s}.', { g: r.giuste, tot: r.totale, s: r.soglia })),
    el('p', {}, t('Rileggi queste lezioni:')),
    el('ul', { class: 'corso-rileggi' }, ...daRileggere.map(([id, titolo]) => el('li', {}, el('a', { href: `#lezione-${id}` }, el('span', { 'data-no-t': '' }, titolo))))),
    el('details', { class: 'piega' }, el('summary', {}, t('Le domande sbagliate')),
      el('ul', {}, ...r.errori.map(e => el('li', { 'data-no-t': '' }, e.domanda)))),
    r.stato?.riprova ? el('p', { class: 'avviso attesa' }, t('Puoi rifare il test alle {ora}, con altre domande.', { ora: ora(r.stato.riprova) })) : null));
  $('#test').scrollIntoView({ block: 'start' });
}

async function carica() {
  try { C = await chiama('GET', '/api/corso'); }
  catch (e) { $('#corso-lezioni').replaceChildren(el('p', { class: 'messaggio' }, e.message)); return; }
  const minuti = C.lezioni.reduce((s, l) => s + l.minuti, 0);
  $('#corso-misure').textContent = t('{l} lezioni · {m} minuti · un test di {d} domande', { l: C.lezioni.length, m: minuti, d: C.domande });
  indice(); lezioni(); stato(); test();
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}
carica();
