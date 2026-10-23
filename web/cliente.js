// L'area dei business che hanno comprato: si entra con un link via email (niente password). Dentro: gli acquisti, il portale
// di Stripe per abbonamento e fatture, la recensione (modificabile) e un messaggio a chi ha fatto l'installazione.
import { $, $$, chiama, el, t, pronta, occupato, avviso, pillola, stelle, data, euro } from './comune.js';
import { azioneEscrow, infoEscrow } from './escrow.js';
import { ceWallet } from './wallet.js';
await pronta;
for (const i of $$('.figura img')) { const guarda = () => i.closest('.figura').classList.toggle('manca', !i.naturalWidth); i.addEventListener('load', guarda); i.addEventListener('error', guarda); if (i.complete) guarda(); }   // l'immagine 3D che manca: resta la cornice

const q = new URLSearchParams(location.search);
let io = { email: '', acquisti: [] };

function mostra(nome) { for (const v of $$('.vista')) v.classList.toggle('nascosto', v.id !== `v-${nome}`); }
function avvisoPagina(testo, tipo = 'errore') {
  const a = $('#avviso-pagina'); a.className = `avviso medio ${tipo}${testo ? '' : ' nascosto'}`; a.textContent = testo ? t(testo) : '';
}

// ---------------- i campi: errori in linea ----------------
let n = 0;
function campo(etichetta, input, aiuto) {
  const box = el('span', { class: 'errore-campo', id: `errore-c${++n}`, 'aria-live': 'polite' });
  input.setAttribute('aria-describedby', box.id);
  return el('label', {}, t(etichetta), input, aiuto ? el('span', { class: 'aiuto' }, t(aiuto)) : null, box);
}
function erroreCampo(input, testo) {
  const box = $(`#${input.getAttribute('aria-describedby')?.split(' ').pop()}`) || input.closest('label, fieldset, .campo')?.querySelector('.errore-campo');
  if (testo) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
  if (box) box.textContent = testo ? t(testo) : '';
  return !testo;
}
const emailOk = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
// le regole: [campo, controllo → messaggio o null]; il primo sbagliato prende il focus
function valida(regole) {
  let primo = null;
  for (const [i, regola] of regole) { const e = regola(i); if (!erroreCampo(i, e) && !primo) primo = i; }
  primo?.focus(); return !primo;
}
function ricontrolla(form, regole) {   // l'errore sparisce appena il campo è a posto
  const r = new Map(regole);
  const su = e => { const i = e.target; if (r.has(i) && i.getAttribute('aria-invalid') === 'true') erroreCampo(i, r.get(i)(i)); const m = form.querySelector('.messaggio'); if (m) m.textContent = ''; };
  form.addEventListener('input', su); form.addEventListener('change', su);
}
function erroreServer(err, mappa, msg) {   // il messaggio del server sotto il campo giusto (in italiano o già tradotto), altrimenti in fondo
  for (const [k, i] of mappa) if (err.message === k || err.message === t(k)) { erroreCampo(i, err.message); i.focus(); return; }
  msg.textContent = err.message;
}

// ---------------- fuori: il link via email ----------------
const fLink = $('#f-link'), esito = $('#v-fuori .esito');
const regoleLink = [[fLink.elements.email, i => !i.value.trim() ? 'Scrivi la tua email' : !emailOk(i.value) ? 'Email non valida' : null]];
ricontrolla(fLink, regoleLink);
fLink.addEventListener('submit', e => {
  e.preventDefault(); if (!valida(regoleLink)) return;
  occupato(fLink.querySelector('button'), async () => {
    await chiama('POST', '/api/cliente/link', { email: fLink.elements.email.value.trim() });
    fLink.classList.add('nascosto'); esito.classList.remove('nascosto');
  }, fLink.querySelector('.messaggio'));
});
$('#b-rifai').addEventListener('click', () => { esito.classList.add('nascosto'); fLink.classList.remove('nascosto'); fLink.elements.email.select(); fLink.elements.email.focus(); });
function fuori(testo, tipo) { mostra('fuori'); avvisoPagina(testo || '', tipo); fLink.elements.email.focus({ preventScroll: true }); }

// ---------------- ?t=…: il bottone che consuma il link ----------------
$('#b-entra').addEventListener('click', e => occupato(e.currentTarget, async () => {
  try { await chiama('POST', '/api/cliente/entra', { t: q.get('t') }); }
  catch (err) { $('#b-entra').classList.add('nascosto'); $('#b-nuovo').classList.remove('nascosto'); history.replaceState(null, '', '/cliente'); throw err; }
  history.replaceState(null, '', '/cliente');
  await carica();
}, $('#m-entra')));
$('#b-nuovo').addEventListener('click', () => { history.replaceState(null, '', '/cliente'); fuori(); });

// ---------------- dentro ----------------
$('#b-esci').addEventListener('click', e => occupato(e.currentTarget, async () => {
  await chiama('POST', '/api/cliente/esci', {});
  fLink.classList.remove('nascosto'); esito.classList.add('nascosto'); fLink.elements.email.value = '';
  fuori('Sei uscito dall\'area clienti.', 'ok');
}));

async function carica() {
  const box = $('#acquisti');
  try { io = await chiama('GET', '/api/cliente'); }
  catch (e) {
    if (e.stato === 401) return fuori();
    mostra('dentro'); box.removeAttribute('aria-busy');
    box.replaceChildren(el('div', { class: 'vuoto' }, el('h3', {}, t('Non riusciamo a caricare la tua area')), el('p', {}, e.message),
      el('button', { type: 'button', class: 'bottone secondario', onclick: e2 => occupato(e2.currentTarget, carica) }, t('Riprova'))));
    return;
  }
  mostra('dentro'); avvisoPagina('');
  $('#chi').textContent = t('Sei entrato come {email}', { email: io.email });
  disegna();
}
function disegna() {
  const box = $('#acquisti'); box.removeAttribute('aria-busy');
  if (!io.acquisti.length) {
    box.replaceChildren(el('div', { class: 'vuoto' }, el('h3', {}, t('Nessun acquisto con questa email')),
      el('p', {}, t('Se hai pagato con un\'altra email, esci e rientra con quella.')), el('a', { class: 'bottone secondario', href: '/esplora' }, t('Guarda il catalogo'))));
    return;
  }
  box.replaceChildren(...io.acquisti.map(scheda));
}

const STATI = { attivo: 'Attivo', cessato: 'Chiuso', sospeso: 'Sospeso', in_attesa: 'In attesa' };
function scheda(a) {
  const pannello = el('div', { class: 'pannello-azione nascosto' });
  let aperto = null;
  const apri = (tipo, crea, bottone) => {
    if (aperto === tipo) { chiudi(); return; }
    aperto = tipo; pannello.replaceChildren(crea(chiudi)); pannello.classList.remove('nascosto');
    for (const b of $$('[aria-expanded]', card)) b.setAttribute('aria-expanded', String(b === bottone));
    (pannello.querySelector('input[type=radio]:checked') || pannello.querySelector('input[type=radio][value="1"]') || pannello.querySelector('input:not([tabindex="-1"]), textarea'))?.focus({ preventScroll: true });
    pannello.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  const chiudi = () => { aperto = null; pannello.classList.add('nascosto'); pannello.replaceChildren(); for (const b of $$('[aria-expanded]', card)) b.setAttribute('aria-expanded', 'false'); };

  const nomeProdotto = a.slug ? el('a', { href: `/p/${a.slug}` }, a.prodotto) : (a.prodotto || t('Prodotto non più in catalogo'));
  const bRec = el('button', { type: 'button', class: 'bottone secondario', 'aria-expanded': 'false', onclick: e => apri('recensione', ch => moduloRecensione(a, ch), e.currentTarget) },
    t(a.voto ? 'Modifica la recensione' : 'Lascia una recensione'));
  const bScrivi = a.codice ? el('button', { type: 'button', class: 'bottone secondario', 'aria-expanded': 'false', onclick: e => apri('scrivi', ch => moduloContatto(a, ch), e.currentTarget) }, t('Scrivi all\'installatore')) : null;
  const bPortale = a.gestibile ? el('button', { type: 'button', class: 'bottone', onclick: e => occupato(e.currentTarget, async () => {
    const r = await chiama('POST', '/api/cliente/portale', { chiave: a.chiave }); location.assign(r.url);
  }) }, t('Gestisci abbonamento e fatture')) : null;

  // la garanzia: conferma che è installato, oppure segnala; con una segnalazione aperta le quote di questo acquisto sono ferme.
  // In escrow la conferma che vale è quella sul contratto (dal wallet che ha pagato): sblocca il pagamento
  const aperta = a.segnalazione === 'aperta', E = a.escrow ? { codice: a.ordine, custodia: a.custodia, sblocco: a.sblocco, congelato: a.congelato } : null;
  const inCustodia = E?.custodia === 'trattenuto', conWallet = inCustodia && ceWallet(), dire = x => avvisoPagina(x, 'attesa');
  const bConferma = !a.confermato && !aperta && a.slug && !(E && ['contestato', 'risolto', 'rimborsato'].includes(E.custodia)) ? el('button', { type: 'button', class: 'bottone', onclick: e => occupato(e.currentTarget, async () => {
    if (conWallet) {
      const r = await azioneEscrow(E.codice, 'conferma', { soloDa: 'pagatore', dire }); avvisoPagina('');
      avviso(r.lenta ? 'Transazione inviata: aggiorniamo appena la rete la conferma.' : 'Pagamento sbloccato: grazie, abbiamo avvisato chi ha lavorato.');
    } else { await chiama('POST', '/api/cliente/conferma', { chiave: a.chiave }); avviso('Grazie: abbiamo avvisato chi l\'ha installato e chi l\'ha costruito.'); }
    await carica();
  }) }, t(conWallet ? 'Confermo: è installato, sblocca il pagamento' : 'Confermo: è installato e funziona')) : null;
  const bSegnala = !aperta && a.slug ? el('button', { type: 'button', class: 'bottone secondario', 'aria-expanded': 'false', onclick: e => apri('segnala', ch => moduloSegnalazione(a, ch), e.currentTarget) }, t('Qualcosa non va')) : null;
  const statoEscrow = E && ({
    trattenuto: ['attesa', t('Il pagamento è nel contratto escrow fino al {data}: si sblocca quando confermi, o da solo a quella data. Se qualcosa non va, segnalalo: lo congeliamo.', { data: data(E.sblocco) })],
    contestato: ['attesa', t('Pagamento congelato nel contratto: la piattaforma sente te e l\'installatore e decide quanto torna a te. Se non decide entro il tempo previsto, puoi riprenderti tutto dal tuo wallet.')],
    confermato: ['ok', t('Hai confermato l\'installazione: il pagamento è uscito dal contratto verso chi ha lavorato.')],
    rilasciato: ['ok', t('Il pagamento è uscito dal contratto alla scadenza, senza segnalazioni.')],
    risolto: ['ok', a.rimborsati ? t('Deciso: {importo} sono tornati sul tuo wallet dal contratto.', { importo: euro(a.rimborsati) }) : t('Deciso dalla piattaforma: il pagamento è andato a chi ha lavorato.')],
    rimborsato: ['ok', t('Rimborso completo: il contratto ha restituito tutto al tuo wallet.')],
  })[E.custodia];
  const stato = statoEscrow ? el('div', { class: `avviso ${statoEscrow[0]}` }, statoEscrow[1], aperta && inCustodia ? [' ', t('Segnalazione aperta: ti scriviamo per email.')] : null)
    : aperta ? el('div', { class: 'avviso attesa' }, t('Segnalazione aperta: le quote di questo acquisto sono ferme finché non chiariamo. Ti scriviamo per email.'))
      : a.esito === 'rimborso' ? el('div', { class: 'avviso ok' }, t('Segnalazione chiusa con un rimborso.'))
        : a.confermato ? el('div', { class: 'avviso ok' }, t('Hai confermato l\'installazione il {data}.', { data: data(a.confermato) })) : null;
  const garanzia = el('p', { class: 'tenue piccolo garanzia-nota' }, E
    ? t('Pagato in crypto con escrow: i soldi restano in un contratto sulla blockchain finché non confermi, o per {n} giorni; la piattaforma può solo decidere a chi vanno, mai tenerli.', { n: io.trattenuta || 14 })
    : a.crypto ? t('Pagato in crypto: il pagamento è andato direttamente nei wallet e la piattaforma non può rimborsarlo. Una segnalazione resta comunque sul profilo dell\'installatore.')
      : a.bonifico ? t('Pagato con bonifico alla piattaforma, che ha fatto anche l\'installazione: se qualcosa non va, segnalalo da qui. Un eventuale rimborso lo decide la piattaforma e te lo fa con un bonifico.')
      : t('Pagato con carta: le quote restano alla piattaforma per {n} giorni dal pagamento, poi vengono versate. In questo tempo, se segnali un problema, si fermano finché non decidiamo; un rimborso torna sulla carta in 5-10 giorni.', { n: io.trattenuta || 14 }), ' ', el('a', { href: '/garanzia' }, t('Come funziona la garanzia')));
  // l'assistenza: lo stato (pagamento, scadenza), la pagina con le richieste, il rinnovo di chi ha pagato in crypto o con bonifico
  // (pagata in anticipo: si rinnova dalla pagina del prodotto, con un altro ordine dello stesso tipo)
  const as = a.assistenza || {}, codiceAs = a.link_assistenza ? a.link_assistenza.split('/').pop() : null;
  const bAssistenza = a.link_assistenza ? el('a', { class: 'bottone secondario', href: a.link_assistenza }, a.aperte ? t('Assistenza ({n} aperte)', { n: a.aperte }) : t('Chiedi assistenza')) : null;
  const rinnova = codiceAs && a.slug && (a.crypto || a.bonifico) && (as.motivo === 'scaduta' || (as.motivo === 'pagata' && as.giorni <= 30))
    ? el('a', { class: 'bottone', href: `/p/${a.slug}?rinnovo=${encodeURIComponent(codiceAs)}#acquisto` }, t('Rinnova l\'assistenza')) : null;
  const statoAs = {
    ritardo: ['attesa', t('Il pagamento dell\'assistenza non è andato: aggiorna la carta o il conto entro il {data}, o l\'assistenza si sospende. Il programma continua a funzionare.', { data: data(as.sospesaIl) })],
    sospesa: ['errore', t('Assistenza sospesa: il pagamento non è arrivato. Il programma continua a funzionare e i dati restano tuoi; paga e l\'assistenza riparte subito.')],
    in_arrivo: ['attesa', t('Il pagamento è in arrivo dalla banca: chi installa ti contatta appena arriva.')],
    pagata: as.giorni <= 30 ? ['attesa', t('L\'assistenza pagata scade il {data}: rinnovala per continuare.', { data: data(as.fino) })] : null,
    scaduta: ['errore', t('L\'assistenza pagata è scaduta il {data}: rinnovala per scrivere a chi ti segue.', { data: data(as.fino) })],
    cessata: a.link_assistenza ? ['attesa', t('L\'abbonamento di assistenza è chiuso: il programma continua a funzionare. Puoi riattivarla dalla pagina di assistenza; oltre al canone si paga una volta la riattivazione.')] : null,
  }[as.motivo] || (as.disdetta ? ['attesa', t('Hai disdetto l\'assistenza: finisce il {data}. Fino ad allora puoi ripensarci dal portale, senza costi; dopo, per riattivarla si paga una volta la riattivazione.', { data: data(as.disdetta) })] : null);
  const avvisoAs = statoAs ? el('div', { class: `avviso ${statoAs[0]}` }, statoAs[1]) : null;
  const azioni = el('div', { class: 'azioni' }, rinnova, bConferma, bSegnala, bAssistenza, bPortale, bRec, bScrivi);
  // congelato e la piattaforma non ha deciso in tempo: il cliente si riprende tutto dal contratto (il server dice quando si può)
  if (E?.custodia === 'contestato' && ceWallet()) infoEscrow(E.codice).then(i => { if (i.azioni?.rimborsa) azioni.prepend(el('button', { type: 'button', class: 'bottone', onclick: e => occupato(e.currentTarget, async () => {
    const r = await azioneEscrow(E.codice, 'rimborsa', { soloDa: 'pagatore', dire, info: i }); avvisoPagina(''); avviso(r.lenta ? 'Transazione inviata: aggiorniamo appena la rete la conferma.' : 'Rimborso completo: i soldi sono sul tuo wallet.'); await carica();
  }) }, t('Riprenditi i soldi dal contratto'))); }).catch(() => {});
  const card = el('article', { class: 'carta acquisto' },
    el('div', { class: 'testa' }, el('h2', {}, nomeProdotto), pillola(STATI[a.stato] || a.stato, a.stato)),
    el('dl', { class: 'dati' },
      el('dt', {}, t('Installatore')), el('dd', {}, a.codice ? el('a', { href: `/u/${a.codice}` }, a.installatore) : (a.installatore || '—')),
      a.nome ? [el('dt', {}, t('Nome dell\'attività')), el('dd', {}, a.nome)] : null,
      el('dt', {}, t('Acquistato il')), el('dd', {}, data(a.creato)),
      as.motivo === 'pagata' ? [el('dt', {}, t('Assistenza pagata fino al')), el('dd', {}, data(as.fino))] : null,
      a.periodo ? [el('dt', {}, t('Assistenza')), el('dd', {}, t(a.periodo === 'anno' ? 'pagata ogni anno, in anticipo' : 'pagata ogni mese, in anticipo'))] : null),
    avvisoAs, stato,
    a.voto ? el('div', { class: 'recensione-mia' }, el('span', { class: 'etichetta' }, t('La tua recensione')), stelle(a.voto), a.testo ? el('p', {}, a.testo) : null) : null,
    azioni,
    garanzia, pannello);
  return card;
}

// ---------------- la segnalazione: cosa non va; ferma le quote dell'acquisto ----------------
function moduloSegnalazione(a, chiudi) {
  const msg = el('div', { class: 'messaggio', role: 'alert' });
  const testo = el('textarea', { name: 'testo', rows: '4', required: true, minlength: '10', maxlength: '2000', placeholder: t('Cosa è successo? Da quando? Hai già scritto all\'installatore?') });
  const form = el('form', { class: 'modulo', novalidate: true },
    el('p', { class: 'tenue piccolo' }, a.escrow
      ? t('Appena mandi la segnalazione, il pagamento viene congelato nel contratto escrow (dal tuo wallet, se è in questo browser, altrimenti dalla piattaforma). Sentiamo te e l\'installatore e decidiamo entro pochi giorni quanto torna a te.')
      : t('Appena mandi la segnalazione, le quote di questo acquisto restano ferme alla piattaforma. Sentiamo te e l\'installatore e decidiamo entro pochi giorni: tutto regolare, rimborso, oppure chiusura.')),
    campo(t('Cosa non va'), testo), msg,
    el('div', { class: 'azioni' }, el('button', { class: 'bottone', type: 'submit' }, t('Manda la segnalazione')), el('button', { class: 'bottone fantasma', type: 'button', onclick: chiudi }, t('Annulla'))));
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (testo.value.trim().length < 10) { erroreCampo(testo, t('Racconta cosa non va: bastano due righe')); return; }
    occupato(form.querySelector('button[type=submit]'), async () => {
      const r = await chiama('POST', '/api/cliente/segnala', { chiave: a.chiave, testo: testo.value.trim() });
      if (r.escrow?.custodia === 'trattenuto' && ceWallet()) {   // e il pagamento si congela nel contratto, dal wallet che ha pagato
        try { await azioneEscrow(r.escrow.codice, 'contesta', { soloDa: 'pagatore', dire: x => avvisoPagina(x, 'attesa') }); avvisoPagina(''); avviso('Ricevuto: il pagamento è congelato nel contratto. Ti scriviamo per email.'); }
        catch (e) { avvisoPagina(t('Segnalazione ricevuta. Non siamo riusciti a congelare il pagamento dal tuo wallet ({errore}): lo congeliamo noi dal pannello.', { errore: e.message }), 'attesa'); }
      } else avviso(r.escrow ? 'Ricevuto: congeliamo il pagamento nel contratto e ti scriviamo per email.' : 'Ricevuto. Le quote sono ferme finché non chiariamo; ti scriviamo per email.');
      chiudi(); await carica();
    }, msg);
  });
  return form;
}

// ---------------- la recensione: 1–5 stelle, testo, nome visibile ----------------
function moduloRecensione(a, chiudi) {
  const id = `voto-${a.chiave}`.replace(/[^\w-]/g, '');
  const errVoto = el('span', { class: 'errore-campo', id: `${id}-errore`, 'aria-live': 'polite' });
  const radio = [5, 4, 3, 2, 1].map(v => el('input', { type: 'radio', name: 'voto', value: v, id: `${id}-${v}`, checked: a.voto === v, 'aria-describedby': errVoto.id }));
  const scegli = el('div', { class: 'scegli-stelle' }, ...radio.flatMap(r => [r, el('label', { for: r.id, title: t(r.value === '1' ? '1 stella' : '{v} stelle', { v: r.value }) },
    el('span', { 'aria-hidden': 'true' }, '★'), el('span', { class: 'sr' }, t(r.value === '1' ? '1 stella' : '{v} stelle', { v: r.value })))]));
  const testo = el('textarea', { name: 'testo', maxlength: '2000', placeholder: 'Cosa ti è piaciuto, cosa si può migliorare' }); testo.value = a.testo || '';
  const autore = el('input', { type: 'text', name: 'autore', maxlength: '80', autocomplete: 'organization' }); autore.value = a.autore || a.nome || '';
  const msg = el('div', { class: 'messaggio', role: 'alert' });
  const form = el('form', { class: 'modulo', novalidate: true },
    el('h3', {}, t(a.voto ? 'Modifica la tua recensione' : 'Com\'è andata?')),
    el('fieldset', { class: 'stelle-campo' }, el('legend', {}, t('Il tuo voto')), scegli, errVoto),
    campo('Racconta com\'è andata', testo, 'Facoltativo. La leggono le altre attività prima di scegliere.'),
    campo('Nome visibile', autore, 'Compare accanto alla recensione: il nome della tua attività va benissimo.'),
    msg,
    el('div', { class: 'azioni' }, el('button', { class: 'bottone' }, t(a.voto ? 'Salva le modifiche' : 'Pubblica la recensione')),
      el('button', { type: 'button', class: 'bottone fantasma', onclick: chiudi }, t('Annulla'))));
  const sceltaVoto = () => radio.find(r => r.checked);
  scegli.addEventListener('change', () => { errVoto.textContent = ''; msg.textContent = ''; });
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (!sceltaVoto()) { errVoto.textContent = t('Scegli da 1 a 5 stelle'); radio[4].focus(); return; }
    occupato(form.querySelector('button:not([type=button])'), async () => {
      const voto = Number(sceltaVoto().value);
      await chiama('POST', '/api/cliente/recensione', { chiave: a.chiave, voto, testo: testo.value.trim(), autore: autore.value.trim() });
      const nuova = !a.voto;
      Object.assign(a, { voto, testo: testo.value.trim(), autore: autore.value.trim() });
      disegna(); avviso(nuova ? 'Grazie: la recensione è pubblicata.' : 'Recensione aggiornata.');
    }, msg);
  });
  return form;
}

// ---------------- un messaggio a chi ha fatto l'installazione ----------------
function moduloContatto(a, chiudi) {
  const nome = el('input', { type: 'text', name: 'nome', maxlength: '80', autocomplete: 'organization', required: true }); nome.value = a.nome || '';
  const email = el('input', { type: 'email', name: 'email', autocomplete: 'email', inputmode: 'email', autocapitalize: 'none', spellcheck: 'false', required: true }); email.value = io.email || '';
  const tel = el('input', { type: 'tel', name: 'telefono', autocomplete: 'tel', maxlength: '30' });
  const messaggio = el('textarea', { name: 'messaggio', maxlength: '3000', required: true, placeholder: 'Cosa ti serve? Un problema, una modifica, una domanda…' });
  const privacy = el('input', { type: 'checkbox', name: 'privacy', required: true });
  const errPrivacy = el('span', { class: 'errore-campo', id: `errore-c${++n}`, 'aria-live': 'polite' }); privacy.setAttribute('aria-describedby', errPrivacy.id);
  const trappola = el('label', { class: 'trappola', 'aria-hidden': 'true' }, 'Sito web', el('input', { type: 'text', name: 'sito_web', tabindex: '-1', autocomplete: 'off' }));
  const msg = el('div', { class: 'messaggio', role: 'alert' });
  const form = el('form', { class: 'modulo', novalidate: true },
    el('h3', {}, t('Scrivi a {nome}', { nome: a.installatore })),
    el('div', { class: 'campi' }, campo('Il tuo nome o della tua attività', nome), campo('Email', email, 'Ti risponde qui.')),
    campo('Telefono', tel, 'Facoltativo, se preferisci una chiamata.'),
    campo('Messaggio', messaggio),
    trappola,
    el('div', { class: 'campo' }, el('label', { class: 'spunta' }, privacy, el('span', {}, t('Accetto che i miei dati arrivino a chi ha fatto l\'installazione, per rispondermi'))),
      el('span', { class: 'legali' }, el('a', { href: '/privacy', target: '_blank', rel: 'noopener' }, t('Leggi l\'informativa privacy'))), errPrivacy),
    msg,
    el('div', { class: 'azioni' }, el('button', { class: 'bottone' }, t('Manda il messaggio')), el('button', { type: 'button', class: 'bottone fantasma', onclick: chiudi }, t('Annulla'))));
  const regole = [
    [nome, i => i.value.trim().length < 2 ? 'Scrivi il tuo nome o quello della tua attività' : null],
    [email, i => !i.value.trim() ? 'Scrivi la tua email' : !emailOk(i.value) ? 'Email non valida' : null],
    [messaggio, i => i.value.trim().length < 10 ? 'Scrivi due righe: cosa ti serve, dove sei' : null],
    [privacy, i => !i.checked ? 'Per mandare il messaggio conferma di aver letto l\'informativa privacy' : null],
  ];
  ricontrolla(form, regole);
  form.addEventListener('submit', e => {
    e.preventDefault(); if (!valida(regole)) return;
    occupato(form.querySelector('button:not([type=button])'), async () => {
      try {
        await chiama('POST', '/api/contatto', { installatore: a.codice, prodotto: a.slug || undefined, nome: nome.value.trim(), email: email.value.trim(), telefono: tel.value.trim(),
          messaggio: messaggio.value.trim(), privacy: true, sito_web: form.elements.sito_web.value });
      } catch (err) {
        return erroreServer(err, [['Scrivi il tuo nome o quello della tua attività', nome], ['Email non valida: serve per risponderti', email], ['Scrivi due righe: cosa ti serve, dove sei', messaggio], ['Per mandare la richiesta conferma di aver letto l\'informativa privacy', privacy]], msg);
      }
      form.replaceChildren(el('div', { class: 'avviso ok', role: 'status' }, t('Messaggio mandato. {nome} ti risponde all\'email che hai scritto.', { nome: a.installatore })),
        el('div', { class: 'azioni' }, el('button', { type: 'button', class: 'bottone secondario piccolo', onclick: chiudi }, t('Chiudi'))));
    }, msg);
  });
  return form;
}

// ---------------- da dove si parte ----------------
if (q.get('t')) mostra('token');
else { if (q.has('portale')) history.replaceState(null, '', '/cliente'); await carica(); }
