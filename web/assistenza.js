// La pagina di assistenza di un'installazione (/assistenza/<codice>): ci arriva il business dalla bolla dentro il programma,
// dal link salvato sul telefono o dal QR. Basta il codice nell'indirizzo: le richieste, le risposte di chi installa (e di chi
// sviluppa, se coinvolto), lo stato dell'assistenza e, se un pagamento non va, come rimetterlo a posto. Si installa come app.
import { $, chiama, el, t, lingua, pronta, occupato, avviso, avatar, data, dataOra, euro } from './comune.js';
await pronta;
const loc = () => (lingua === 'en' ? 'en-IE' : 'it-IT');
const numero = (n, cifre = 1) => Number(n).toLocaleString(loc(), { maximumFractionDigits: cifre });

const k = location.pathname.split('/')[2] || '';
const cerca = new URLSearchParams(location.search);
const daBolla = cerca.get('da') === 'bolla';   // aperta dalla bolla dentro il programma
// di ritorno da Stripe: il pagamento è fatto, la conferma arriva al server fra pochi secondi
const tornato = cerca.get('riattivata') ? 'riattivata' : cerca.get('pagato') ? 'pagato' : null;
if (tornato) { cerca.delete('riattivata'); cerca.delete('pagato'); history.replaceState(null, '', location.pathname + (cerca.size ? `?${cerca}` : '') + location.hash); }
let info = null, aperta = null, giro = null;

// chi scrive e dove avvisarlo: ricordati su questo dispositivo (comodità; se il browser non lo permette, si riscrivono)
const ricorda = { leggi() { try { return JSON.parse(localStorage.getItem(`assistenza:${k}`) || '{}'); } catch { return {}; } },
  scrivi(x) { try { localStorage.setItem(`assistenza:${k}`, JSON.stringify({ ...this.leggi(), ...x })); } catch { } } };

const STATI = { aperta: ['In attesa di risposta', 'attesa'], risposta: ['Ti hanno risposto', 'ok'], risolta: ['Risolta', 'spenta'] };
const CHI = { cliente: 'Tu', installatore: 'Chi ti segue', builder: 'Chi sviluppa il programma', piattaforma: 'La piattaforma' };

function errorePagina(testo) {
  $('#as-caricamento').classList.add('nascosto');
  const e = $('#as-errore'); e.classList.remove('nascosto');
  e.replaceChildren(el('h3', {}, t('Link di assistenza non valido')), el('p', {}, testo), el('p', { class: 'piccolo' }, t('Chiedi un link nuovo a chi ti ha installato il programma.')));
}

async function carica() {
  try { info = await chiama('GET', `/api/assistenza?k=${encodeURIComponent(k)}`); }
  catch (e) { return errorePagina(e.message); }
  $('#as-caricamento').classList.add('nascosto'); $('#as-dentro').classList.remove('nascosto');
  document.title = `${t('Assistenza')} · ${info.prodotto?.nome || ''}`;
  $('#as-prodotto').textContent = info.prodotto?.nome || t('Il tuo programma');
  $('#as-avatar').replaceChildren(avatar(info.installatore, 'piccolo'));
  // chi risponde: l'assistenza della piattaforma (con chi ha installato, se serve), o chi ha installato
  const piattaforma = info.risponde?.piattaforma;
  $('#as-segue').replaceChildren(info.risponde?.dietro ? t('Ti segue {nome}, con {dietro} dietro', { nome: info.risponde.nome, dietro: info.risponde.dietro }) : piattaforma ? t('Ti segue l\'assistenza di {nome}', { nome: info.risponde.nome }) : info.installatore ? t('Ti segue {nome}', { nome: info.installatore.nome }) : '',
    piattaforma && info.installatore ? el('span', { class: 'tenue' }, ' · ', t('installato da {nome}', { nome: info.installatore.nome })) : '',
    info.cliente ? el('span', { class: 'tenue', 'data-no-t': '' }, ` · ${info.cliente}`) : '');
  stato(); salute(); lista();
  if (tornato) avviso(tornato === 'riattivata' ? t('Pagamento fatto: l\'assistenza si riattiva fra pochi secondi.') : t('Pagamento fatto: ci mettiamo al lavoro.'), { durata: 8000 });
  if (tornato && !info.stato.attiva) setTimeout(() => ricarica().catch(() => {}), 6000);
  // il manifest per installarla: si aggiunge ora che il codice è verificato
  if (!document.querySelector('link[rel=manifest]')) document.head.append(el('link', { rel: 'manifest', href: `/assistenza/${k}/manifest.webmanifest` }));
  const r = location.hash.match(/^#r(\d+)$/);
  if (r) apri(Number(r[1])); else if (aperta) apri(aperta); else vuoto();
}

// ---------------- lo stato dell'assistenza, con cosa fare ----------------
function stato() {
  const s = info.stato, box = $('#as-stato'), azioni = [];
  const testo = {
    regolare: s.disdetta ? t('Assistenza attiva fino al {data}: l\'abbonamento è stato disdetto.', { data: data(s.disdetta) }) : t('Assistenza attiva. Di solito ti rispondono entro {ore} ore.', { ore: info.rispostaOre }),
    in_arrivo: t('Assistenza attiva. Il pagamento è in arrivo dalla banca: ci vuole qualche giorno.'),
    ritardo: t('Un pagamento non è andato a buon fine. Aggiornalo entro il {data}, o l\'assistenza si sospende. Il programma continua a funzionare.', { data: data(s.sospesaIl) }),
    pagata: t('Assistenza pagata fino al {data}.', { data: data(s.fino) }),
    sospesa: t('Assistenza sospesa: il pagamento non è arrivato. Il programma continua a funzionare e i dati restano tuoi; le richieste nuove aspettano il pagamento.'),
    scaduta: t('L\'anno di assistenza pagato è finito il {data}. Il programma continua a funzionare; per scrivere di nuovo, rinnova.', { data: data(s.fino) }),
    cessata: info.riattivazione ? t('L\'abbonamento di assistenza è chiuso. Il programma continua a funzionare. Per riattivarlo: {mese} al mese, più {euro} di riattivazione, una volta sola.',
      { mese: euro(info.riattivazione.mese), euro: euro(info.riattivazione.euro) })
      : info.risponde?.piattaforma ? t('L\'abbonamento di assistenza è chiuso. Per riattivarlo scrivici dalla pagina del programma.')
      : t('L\'abbonamento di assistenza è chiuso. Per riattivarlo scrivi a chi ti ha installato il programma.'),
    non_inclusa: t('L\'assistenza non è compresa nell\'acquisto: puoi scrivere, e chi installa ti dirà se e quanto costa un intervento.'),
  }[s.motivo] || '';
  const tipo = { ritardo: 'attesa', sospesa: 'errore', scaduta: 'errore', cessata: 'errore', in_arrivo: 'attesa' }[s.motivo] || 'ok';
  if (['ritardo', 'sospesa'].includes(s.motivo) && info.pagamento === 'stripe') azioni.push(el('button', { class: 'bottone piccolo', type: 'button', onclick: e => pagamento(e.currentTarget) }, t('Aggiorna il pagamento')));
  if (info.rinnovo) azioni.push(el('a', { class: 'bottone piccolo', href: `/p/${info.rinnovo.slug}?rinnovo=${encodeURIComponent(k)}#acquisto` },
    t('Rinnova {mesi} mesi: {euro}', { mesi: info.rinnovo.mesi, euro: euro(info.rinnovo.euro) })));
  if (info.riattivazione) azioni.push(
    el('button', { class: 'bottone piccolo', type: 'button', onclick: e => riattiva(e.currentTarget, 'mese') }, t('Riattiva: {euro} al mese', { euro: euro(info.riattivazione.mese) })),
    el('button', { class: 'bottone secondario piccolo', type: 'button', onclick: e => riattiva(e.currentTarget, 'anno') }, t('Un anno: {euro}', { euro: euro(info.riattivazione.anno) })));
  else if (s.motivo === 'cessata' && info.prodotto) azioni.push(el('a', { class: 'bottone secondario piccolo', href: `/p/${info.prodotto.slug}` }, t('Vai al prodotto')));
  // senza assistenza si può comunque chiedere un intervento, a ore e con il preventivo prima: costa più del canone
  const chiamata = !s.attiva && info.pagaCarta && info.tariffaOra > 0;
  if (chiamata) azioni.push(el('button', { class: 'bottone fantasma piccolo', type: 'button', onclick: () => modulo(true) }, t('Chiedi un intervento a chiamata')));
  box.className = `as-stato avviso ${tipo}`;
  box.replaceChildren(el('div', {}, el('p', {}, testo),
    info.rinnovo?.riattivazione ? el('p', { class: 'piccolo' }, t('Il rinnovo comprende {euro} di riattivazione: l\'assistenza è ferma da più di {giorni} giorni.', { euro: euro(info.rinnovo.riattivazione), giorni: info.rinnovo.giorni })) : null,
    chiamata ? el('p', { class: 'piccolo' }, info.canoneMese > 0 ? t('Senza assistenza un intervento costa {tariffa} l\'ora, con il preventivo prima. Con l\'assistenza ({canone} al mese) gli interventi sono compresi.', { tariffa: euro(info.tariffaOra), canone: euro(info.canoneMese) })
      : t('Senza assistenza un intervento costa {tariffa} l\'ora, con il preventivo prima.', { tariffa: euro(info.tariffaOra) })) : null,
    azioni.length ? el('div', { class: 'as-azioni' }, ...azioni) : null));
  $('#as-nuova').disabled = !s.attiva;
}
async function riattiva(b, periodo) {
  await occupato(b, async () => { const r = await chiama('POST', '/api/assistenza/riattiva', { k, periodo }); location.href = r.url; });
}

// ---------------- il programma controllato da fuori e il rapporto del mese scorso ----------------
function salute() {
  const box = $('#as-salute'), m = info.monitoraggio, rp = info.rapporto, attiva = info.stato.attiva, carte = [];
  if (m || attiva) {
    const voci = [];
    if (m) {
      const [stato, c] = !attiva ? [t('Controllo fermo: riparte con l\'assistenza'), 'spenta'] : m.stato === 'giu' ? [t('Non risponde dalle {ora}: ci stiamo lavorando', { ora: dataOra(m.dal) }), 'errore']
        : m.stato === 'su' ? [t('Online'), 'ok'] : [t('Primo controllo fra pochi minuti'), 'attesa'];
      const d = m.ultimi30;
      voci.push(el('p', { class: 'as-sano-stato' }, el('span', { class: `as-pallino ${c}` }), el('strong', {}, stato)),
        el('p', { class: 'as-sano-sito', 'data-no-t': '' }, m.sito),
        el('ul', { class: 'as-sano-dati' },
          attiva ? el('li', {}, t('Controllato ogni {n} minuti, come farebbe un visitatore', { n: info.monitorMinuti })) : null,
          d ? el('li', {}, t('Ultimi 30 giorni: online il {pc}% del tempo', { pc: numero(d.percentuale, 2) }), d.cadute ? ` · ${d.cadute === 1 ? t('1 interruzione') : t('{n} interruzioni', { n: d.cadute })}` : '') : null,
          m.cert_scade ? el('li', {}, t('Certificato HTTPS valido fino al {data}', { data: data(m.cert_scade) })) : null),
        attiva ? el('details', { class: 'as-sano-cambia' }, el('summary', {}, t('Cambia indirizzo')), formSito(m.sito)) : null);
    } else voci.push(el('p', {}, t('Scrivi l\'indirizzo del programma: lo controlliamo ogni {n} minuti e, se non risponde, ti avvisiamo e ci mettiamo al lavoro.', { n: info.monitorMinuti })), formSito(''));
    carte.push(el('article', { class: 'as-sano carta' }, el('span', { class: 'etichetta' }, t('Il programma')), ...voci));
  } else if (info.canoneMese > 0) carte.push(el('article', { class: 'as-sano carta as-sano-spento' }, el('span', { class: 'etichetta' }, t('Il programma')),
    el('p', { class: 'as-sano-stato' }, el('span', { class: 'as-pallino spenta' }), el('strong', {}, t('Nessuno lo controlla'))),
    el('p', { class: 'tenue' }, t('Con l\'assistenza lo controlliamo da fuori ogni {n} minuti, ti avvisiamo se non risponde e ogni mese ti mandiamo il rapporto. Riparte appena la riattivi.', { n: info.monitorMinuti }))));
  if (rp) {
    const mese = new Date(`${rp.mese}-15T12:00:00Z`).toLocaleDateString(loc(), { month: 'long', year: 'numeric' });
    const n = (v, testo) => el('li', {}, el('strong', { class: 'as-numero' }, v), el('span', {}, testo));
    carte.push(el('article', { class: 'as-sano carta' }, el('span', { class: 'etichetta' }, t('Il mese di {mese}', { mese })),
      el('ul', { class: 'as-numeri' },
        rp.disponibilita ? n(`${numero(rp.disponibilita.percentuale, 2)}%`, t('online')) : null,
        n(String(rp.versioni.length), rp.versioni.length === 1 ? t('versione controllata') : t('versioni controllate')),
        n(String(rp.richieste.risolte), rp.richieste.risolte === 1 ? t('richiesta risolta') : t('richieste risolte')),
        rp.richieste.ore != null ? n(`${numero(rp.richieste.ore)} h`, t('per la prima risposta')) : null),
      rp.versioni.length ? el('p', { class: 'tenue piccolo', 'data-no-t': '' }, rp.versioni.map(v => v.tag).join(' · ')) : null));
  }
  box.classList.toggle('nascosto', !carte.length);
  box.replaceChildren(...carte);
}
function formSito(attuale) {
  const input = el('input', { type: 'url', inputmode: 'url', autocapitalize: 'none', spellcheck: 'false', maxlength: 300, value: attuale || '',
    placeholder: t('https://gestionale.tuonegozio.it'), 'aria-label': t('Indirizzo del programma') });
  const msg = el('div', { class: 'messaggio', role: 'alert' }), b = el('button', { class: 'bottone piccolo', type: 'submit' }, t('Controllalo'));
  const f = el('form', { class: 'as-sito', novalidate: true }, el('div', { class: 'as-sito-riga' }, input, b),
    attuale ? el('button', { class: 'bottone fantasma piccolo', type: 'button', onclick: e => occupato(e.currentTarget, async () => {
      await chiama('POST', '/api/assistenza/sito', { k, sito: null }); avviso(t('Controllo tolto')); await ricarica(); }, msg) }, t('Togli il controllo')) : null, msg);
  f.addEventListener('submit', e => {
    e.preventDefault(); if (!input.value.trim()) { msg.textContent = t('Scrivi l\'indirizzo'); input.focus(); return; }
    occupato(b, async () => { await chiama('POST', '/api/assistenza/sito', { k, sito: input.value.trim() }); avviso(t('Fatto: il primo controllo arriva fra pochi minuti')); await ricarica(); }, msg);
  });
  return f;
}
async function pagamento(b) {
  await occupato(b, async () => {
    const r = await chiama('POST', '/api/assistenza/pagamento', { k });
    avviso(t('Ti abbiamo mandato il link a {email}: da lì aggiorni carta o conto.', { email: r.email }), { durata: 9000 });
  });
}

// ---------------- le richieste ----------------
function lista() {
  const ul = $('#as-lista');
  if (!info.richieste.length) { ul.replaceChildren(el('li', { class: 'as-nessuna' }, t('Nessuna richiesta, per ora.'))); return; }
  ul.replaceChildren(...info.richieste.map(r => {
    const [s, c] = STATI[r.stato] || [r.stato, ''];
    return el('li', {}, el('button', { type: 'button', class: `as-voce${aperta === r.id ? ' scelta' : ''}`, 'aria-current': aperta === r.id ? 'true' : null, onclick: () => apri(r.id) },
      el('span', { class: 'as-voce-titolo', 'data-no-t': '' }, r.titolo),
      el('span', { class: 'as-voce-dati' }, el('span', { class: `as-pallino ${c}` }), t(s), r.urgente ? el('span', { class: 'as-urgente' }, t('Bloccante')) : null, el('span', { class: 'tenue' }, data(r.aggiornata)))));
  }));
}
function vuoto() {
  aperta = null; ferma();
  const d = $('#as-dettaglio'); d.classList.remove('aperto');
  d.replaceChildren(el('div', { class: 'as-benvenuto carta' },
    el('h2', { class: 'as-h2' }, t('Di cosa hai bisogno?')),
    !info.stato.attiva && info.pagaCarta && info.tariffaOra > 0 ? el('p', {}, t('Senza l\'assistenza attiva puoi chiedere un intervento a chiamata: ti mandiamo il preventivo e si lavora dopo il pagamento.'))
      : el('p', {}, info.risponde?.piattaforma ? t('Scrivi qui un problema, una domanda o una modifica che vorresti. Risponde l\'assistenza di {nome}; se serve, coinvolge chi ti ha installato il programma o chi lo sviluppa.', { nome: info.risponde.nome })
      : t('Scrivi qui un problema, una domanda o una modifica che vorresti. Risponde chi ti ha installato il programma; se serve, coinvolge chi lo sviluppa.')),
    el('ol', { class: 'as-passi' }, el('li', {}, t('Racconta cosa succede e da quando')), el('li', {}, t('Ricevi la risposta qui e per email')), el('li', {}, t('Quando è a posto, segnala la richiesta come risolta'))),
    info.stato.attiva ? el('button', { class: 'bottone', type: 'button', onclick: () => modulo() }, t('Scrivi una richiesta'))
      : info.pagaCarta && info.tariffaOra > 0 ? el('button', { class: 'bottone secondario', type: 'button', onclick: () => modulo(true) }, t('Chiedi un intervento a chiamata')) : null));
}

// aChiamata: senza assistenza attiva, un intervento a ore (TARIFFA_ORA) con il preventivo prima
function modulo(aChiamata = false) {
  aperta = null; ferma(); lista();
  const r = ricorda.leggi(), msg = el('div', { class: 'messaggio', role: 'alert' });
  const titolo = el('input', { name: 'titolo', maxlength: 120, required: true, placeholder: t('Es. Lo scontrino non si stampa') });
  const testo = el('textarea', { name: 'testo', maxlength: 5000, required: true, rows: 6, placeholder: t('Cosa succede, da quando, cosa hai già provato') });
  const nome = el('input', { name: 'nome', maxlength: 80, autocomplete: 'name', value: r.nome || '' });
  const email = el('input', { name: 'email', type: 'email', inputmode: 'email', autocomplete: 'email', autocapitalize: 'none', value: r.email || '' });
  const urgente = el('input', { type: 'checkbox', name: 'urgente' });
  const invia = el('button', { class: 'bottone', type: 'submit' }, t('Manda la richiesta'));
  const f = el('form', { class: 'modulo as-modulo carta', novalidate: true },
    el('div', { class: 'as-modulo-testa' }, el('h2', { class: 'as-h2' }, aChiamata ? t('Intervento a chiamata') : t('Nuova richiesta')), el('button', { type: 'button', class: 'bottone fantasma piccolo', onclick: vuoto }, t('Annulla'))),
    aChiamata ? el('p', { class: 'avviso attesa piccolo' }, t('Racconta cosa serve: ti mandiamo il preventivo ({tariffa} l\'ora) e si lavora dopo il pagamento. Nessun impegno finché non paghi.', { tariffa: euro(info.tariffaOra) })) : null,
    el('label', {}, t('In poche parole'), titolo),
    el('label', {}, t('Racconta'), testo),
    el('div', { class: 'as-due' }, el('label', {}, t('Chi scrive'), nome, el('span', { class: 'aiuto' }, t('Facoltativo'))),
      el('label', {}, t('Email per la risposta'), email, el('span', { class: 'aiuto' }, t('Facoltativa: altrimenti scriviamo a chi ha comprato')))),
    el('label', { class: 'as-spunta' }, urgente, el('span', {}, el('strong', {}, t('È bloccante')), ' ', el('span', { class: 'aiuto' }, t('Il programma non funziona e il lavoro è fermo')))),
    msg, invia);
  f.addEventListener('submit', e => {
    e.preventDefault();
    if (titolo.value.trim().length < 3) { msg.textContent = t('Scrivi in poche parole di cosa hai bisogno'); titolo.focus(); return; }
    if (testo.value.trim().length < 10) { msg.textContent = t('Racconta cosa succede: bastano due righe'); testo.focus(); return; }
    occupato(invia, async () => {
      ricorda.scrivi({ nome: nome.value.trim(), email: email.value.trim() });
      const x = await chiama('POST', '/api/assistenza/richiesta', { k, titolo: titolo.value.trim(), testo: testo.value.trim(), nome: nome.value.trim(), email: email.value.trim() || undefined,
        urgente: urgente.checked, canale: daBolla ? 'bolla' : 'pagina', ...(aChiamata ? { a_chiamata: true } : {}) });
      avviso(aChiamata ? t('Richiesta mandata: ti mandiamo il preventivo qui e per email') : t('Richiesta mandata: ti avvisiamo quando arriva la risposta'));
      await ricarica(); apri(x.id);
    }, msg);
  });
  const d = $('#as-dettaglio'); d.classList.add('aperto'); d.replaceChildren(f); titolo.focus();
}

async function apri(id) {
  let r;
  try { r = await chiama('GET', `/api/assistenza/richiesta?k=${encodeURIComponent(k)}&id=${id}`); }
  catch (e) { avviso(e.message, { errore: true }); return vuoto(); }
  aperta = id; history.replaceState(null, '', `#r${id}`); lista();
  const [s, c] = STATI[r.stato] || [r.stato, ''];
  const fili = el('ol', { class: 'as-fili' }, ...r.messaggi.map(m => el('li', { class: `as-msg ${m.chi}` },
    el('div', { class: 'as-msg-testa' }, el('strong', { 'data-no-t': '' }, m.chi === 'cliente' ? (m.nome || t('Tu')) : m.nome), el('span', { class: 'tenue' }, ' · ', t(CHI[m.chi] || ''), ' · ', dataOra(m.creato))),
    el('p', { class: 'as-msg-testo', 'data-no-t': '' }, m.testo))));
  const msg = el('div', { class: 'messaggio', role: 'alert' });
  const testo = el('textarea', { rows: 3, maxlength: 5000, placeholder: t('Scrivi un messaggio'), 'aria-label': t('Scrivi un messaggio') });
  const invia = el('button', { class: 'bottone', type: 'submit' }, t('Manda'));
  // un intervento a chiamata: si scrive anche senza assistenza; il preventivo e il suo pagamento in cima al filo
  const ac = r.a_chiamata, puo = info.stato.attiva || !!ac;
  const preventivo = !ac ? null : el('div', { class: `avviso ${ac.pagata ? 'ok' : 'attesa'} as-preventivo` },
    el('p', {}, ac.pagata ? t('Intervento pagato: ci stiamo lavorando.')
      : ac.ore ? t('Preventivo: {ore} ore a {tariffa} l\'ora, {totale} in tutto.', { ore: numero(ac.ore), tariffa: euro(info.tariffaOra), totale: euro(ac.totale) })
      : t('Intervento a chiamata: il preventivo arriva qui e per email.')),
    ac.ore && !ac.pagata ? el('button', { class: 'bottone piccolo', type: 'button', onclick: e => occupato(e.currentTarget, async () => {
      const x = await chiama('POST', '/api/assistenza/intervento', { k, id }); location.href = x.url; }) }, t('Paga {totale} e conferma', { totale: euro(ac.totale) })) : null);
  const risposta = puo ? el('form', { class: 'as-risposta', novalidate: true }, testo, msg, el('div', { class: 'as-azioni' }, invia,
    r.stato !== 'risolta' ? el('button', { class: 'bottone secondario', type: 'button', onclick: e => occupato(e.currentTarget, async () => { await chiama('POST', '/api/assistenza/risolta', { k, id }); avviso(t('Segnata come risolta')); await ricarica(); apri(id); }) }, t('È risolta')) : null,
    r.segnalabile && !info.risponde?.piattaforma ? el('button', { class: 'bottone fantasma', type: 'button', onclick: e => occupato(e.currentTarget, async () => { await chiama('POST', '/api/assistenza/segnala', { k, id }); avviso(t('Lo abbiamo detto alla piattaforma: ti ricontattano')); apri(id); }) }, t('Nessuno risponde? Dillo alla piattaforma')) : null))
    : el('p', { class: 'avviso attesa' }, t('Per scrivere ancora, rimetti in regola l\'assistenza: trovi come in cima alla pagina.'));
  risposta.addEventListener?.('submit', e => {
    e.preventDefault(); if (testo.value.trim().length < 2) { msg.textContent = t('Scrivi il messaggio'); testo.focus(); return; }
    occupato(invia, async () => { await chiama('POST', '/api/assistenza/messaggio', { k, id, testo: testo.value.trim(), nome: ricorda.leggi().nome || undefined }); await ricarica(); apri(id); }, msg);
  });
  const d = $('#as-dettaglio'); d.classList.add('aperto');
  d.replaceChildren(el('article', { class: 'as-richiesta carta' },
    el('button', { type: 'button', class: 'bottone fantasma piccolo as-indietro', onclick: () => { history.replaceState(null, '', location.pathname); vuoto(); } }, t('← Tutte le richieste')),
    el('div', { class: 'as-richiesta-testa' }, el('h2', { class: 'as-h2', 'data-no-t': '' }, r.titolo),
      el('span', { class: 'as-voce-dati' }, el('span', { class: `as-pallino ${c}` }), t(s), r.urgente ? el('span', { class: 'as-urgente' }, t('Bloccante')) : null,
        r.coinvolto ? el('span', { class: 'tenue' }, t('con chi sviluppa')) : null)),
    r.stato === 'aperta' && r.segnalata ? el('p', { class: 'avviso attesa piccolo' }, t('Segnalata alla piattaforma: stiamo sollecitando chi ti segue.')) : null,
    preventivo, fili, risposta));
  fili.lastElementChild?.scrollIntoView({ block: 'nearest' });
  ferma(); giro = setInterval(() => { if (!document.hidden && aperta === id && !testo.value) aggiorna(id, r.messaggi.length); }, 30_000);
}
function ferma() { if (giro) clearInterval(giro); giro = null; }
async function aggiorna(id, n) {   // ogni 30 secondi, a pagina visibile: se c'è una risposta nuova, la mostra
  const r = await chiama('GET', `/api/assistenza/richiesta?k=${encodeURIComponent(k)}&id=${id}`).catch(() => null);
  if (r && r.messaggi.length !== n) { await ricarica(); apri(id); }
}
async function ricarica() { info = await chiama('GET', `/api/assistenza?k=${encodeURIComponent(k)}`); stato(); salute(); lista(); }

$('#as-nuova').addEventListener('click', () => modulo());

// ---------------- aggiungerla alla schermata Home ----------------
let invito = null;
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
if (!standalone) {
  const box = $('#as-installa'), b = $('#as-installa-bottone');
  if (/iPhone|iPad|iPod/.test(navigator.userAgent)) { box.classList.remove('nascosto'); $('#as-installa-testo').textContent = t('Su iPhone: tocca Condividi, poi «Aggiungi alla schermata Home».'); }
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); invito = e; box.classList.remove('nascosto'); b.classList.remove('nascosto'); });
  b.addEventListener('click', async () => { if (!invito) return; invito.prompt(); await invito.userChoice.catch(() => null); invito = null; box.classList.add('nascosto'); });
}

await carica();
