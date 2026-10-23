// L'assistenza nell'area: per chi gestisce la piattaforma (che l'assistenza la dà) tutte le richieste dei clienti, per chi vende o
// sviluppa quelle in cui è stato coinvolto (dalla bolla nel programma o dalla pagina del cliente); il filo con le risposte, chi
// coinvolgere (chi ha installato, chi sviluppa); per ogni cliente il link, la bolla e il QR. E lo stato dei pagamenti, detto
// chiaro: se un cliente non paga si ferma l'assistenza, mai il programma.
import { el, t, lingua, chiama, occupato, avviso, conferma, copia, svg, data, dataOra, euro } from './comune.js';
import { testa, carta, vuoto, messaggio, pubblico, titoletto, scheletro } from './area-base.js';

const STATI = { aperta: ['Da rispondere', 'in_attesa'], risposta: ['Risposto', 'ok'], risolta: ['Risolta', 'spento'] };
const CHI = { cliente: 'Cliente', installatore: 'Chi installa', builder: 'Chi sviluppa', piattaforma: 'Piattaforma' };
const ore = s => Math.max(1, Math.round((Date.now() - Date.parse(s)) / 3600e3));

// il programma del cliente controllato da fuori: in una riga, con il colore
function rigaControllo(m) {
  if (!m) return null;
  const [s, c] = m.stato === 'giu' ? [t('Non risponde dalle {ora}', { ora: dataOra(m.dal) }), 'sospeso'] : m.stato === 'su' ? [t('Online'), 'ok'] : [t('In attesa del primo controllo'), 'in_attesa'];
  return el('p', { class: 'piccolo controllo-as' }, el('span', { class: `pillola ${c}` }, s), ' ', el('span', { class: 'tenue', 'data-no-t': '' }, m.sito),
    m.ultimi30 ? el('span', { class: 'tenue' }, ' · ', t('{pc}% negli ultimi 30 giorni', { pc: m.ultimi30.percentuale.toLocaleString(lingua === 'en' ? 'en-IE' : 'it-IT') })) : null,
    m.cert_scade ? el('span', { class: 'tenue' }, ' · ', t('certificato fino al {data}', { data: data(m.cert_scade) })) : null);
}
// l'indirizzo del programma per il controllo da fuori (chi installa o la piattaforma)
function campoControllo(chiave, m, dopo) {
  const input = el('input', { type: 'url', inputmode: 'url', autocapitalize: 'none', spellcheck: 'false', maxlength: 300, value: m?.sito || '',
    placeholder: 'https://gestionale.attivita.it', 'aria-label': t('Indirizzo del programma del cliente') });
  const msg = messaggio(), b = el('button', { type: 'submit', class: 'bottone secondario piccolo' }, m ? t('Aggiorna') : t('Controllalo'));
  const f = el('form', { class: 'pila', novalidate: true }, el('div', { class: 'riga-copia' }, input, b), msg);
  f.addEventListener('submit', e => {
    e.preventDefault();
    occupato(b, async () => { await chiama('POST', '/api/area/assistenza/sito', { chiave, sito: input.value.trim() || null }); avviso(input.value.trim() ? 'Fatto: il primo controllo arriva fra pochi minuti' : 'Controllo tolto'); dopo?.(); }, msg);
  });
  return f;
}

// lo stato dell'assistenza di un cliente, in parole e colore (anche nella tabella delle vendite)
export function statoPagamento(c) {
  const a = c.assistenza || {}, per = c.periodo === 'anno' ? t('ogni anno') : c.periodo === 'mese' ? t('ogni mese') : '';
  const x = {
    regolare: [a.disdetta ? t('Disdetto: finisce il {data}', { data: data(a.disdetta) }) : [t('In regola'), per].filter(Boolean).join(' · '), a.disdetta ? 'in_attesa' : 'ok'],
    in_arrivo: [t('Addebito in arrivo: non installare prima'), 'in_attesa'],
    ritardo: [t('Non riuscito: si sospende il {data}', { data: data(a.sospesaIl) }), 'in_attesa'],
    sospesa: [t('Non pagato: assistenza sospesa'), 'sospeso'],
    pagata: [t('Pagato fino al {data}', { data: data(a.fino) }), 'ok'],
    scaduta: [t('Scaduto il {data}', { data: data(a.fino) }), 'sospeso'],
    cessata: [t('Chiuso'), 'cessato'],
    non_inclusa: [t('Senza canone'), 'spento'],
  }[a.motivo] || [a.motivo || '—', ''];
  return el('span', { class: `pillola ${x[1]}` }, x[0]);
}
// l'avviso in cima alle vendite quando qualcuno non paga
export function avvisoPagamenti(clienti) {
  const n = clienti.filter(c => ['sospesa', 'scaduta'].includes(c.assistenza?.motivo)).length, r = clienti.filter(c => c.assistenza?.motivo === 'ritardo').length;
  if (!n && !r) return null;
  return el('div', { class: `avviso ${n ? 'errore' : 'attesa'}` }, el('div', {},
    el('strong', {}, n ? t(n === 1 ? 'Un cliente senza assistenza pagata.' : '{n} clienti senza assistenza pagata.', { n }) : t(r === 1 ? 'Un pagamento non riuscito: Stripe sta riprovando.' : '{n} pagamenti non riusciti: Stripe sta riprovando.', { n: r })), ' ',
    t('Finché non pagano non sei tenuto a intervenire. Non bloccare e non toccare mai il programma installato: è del cliente, e bloccarlo per farsi pagare è reato (art. 392 c.p.). L\'assistenza riparte da sola appena pagano.')));
}

// ---------------- la sezione ----------------
export async function assistenza(radice, io, sotto) {
  const id = Number(sotto) || 0;
  radice.append(testa('Assistenza', io.assistenzaPiattaforma && io.admin ? 'Le richieste di tutti i clienti: risponde per primo chi ha installato, la piattaforma vede tutto e interviene se lui non risponde. Coinvolgi chi sviluppa quando serve.'
    : io.assistenzaPiattaforma ? 'Le richieste dei tuoi clienti, dalla bolla dentro il programma o dalla loro pagina: rispondi tu per primo, il 60% del canone è tuo; la piattaforma le vede e interviene se non rispondi in tempo. Chi sviluppa trova qui quelle in cui è coinvolto.'
      : 'Le richieste dei clienti che segui, dalla bolla dentro il programma o dalla loro pagina di assistenza.'));
  const corpo = el('div', { class: 'pila' }, scheletro(3)); radice.append(corpo);
  if (id) return filo(corpo, id);
  const r = await chiama('GET', '/api/area/assistenza');
  const gruppi = { aperta: [], risposta: [], risolta: [] };
  for (const x of r.richieste) (gruppi[x.stato] || gruppi.aperta).push(x);
  if (!r.richieste.length) {
    corpo.replaceChildren(vuoto('Nessuna richiesta di assistenza', io.assistenzaPiattaforma && !r.piattaforma
      ? 'Quando installi, metti al cliente la bolla dentro il programma o dagli il suo link di assistenza: le sue richieste arrivano qui e per email, rispondi tu per primo e la piattaforma ti sta dietro.'
      : 'Dai a ogni cliente il suo link di assistenza, o mettigli la bolla dentro il programma: le richieste arrivano qui e per email.',
      el('a', { class: 'bottone', href: '#vendite' }, t('I tuoi clienti'))));
    return;
  }
  corpo.replaceChildren(
    el('p', { class: 'tenue piccolo' }, r.piattaforma ? t('I clienti si aspettano una prima risposta entro {ore} ore: dopo arriva un sollecito a tutta la squadra.', { ore: r.rispostaOre })
      : t('I clienti si aspettano una prima risposta entro {ore} ore: dopo arriva un sollecito, e dopo il triplo lo sa la piattaforma.', { ore: r.rispostaOre })),
    ...['aperta', 'risposta', 'risolta'].filter(s => gruppi[s].length).map(s => el('div', { class: 'pila', role: 'group' },
      titoletto(`${t(STATI[s][0])} (${gruppi[s].length})`),
      el('div', { class: 'elenco' }, ...gruppi[s].map(voce)))));
}
function voce(r) {
  const fermo = r.assistenza && !r.assistenza.attiva;
  return el('a', { class: `carta richiesta-as${r.urgente && r.stato === 'aperta' ? ' urgente' : ''}`, href: `#assistenza/${r.id}` },
    el('div', { class: 'titoletto' }, el('h3', {}, pubblico(r.titolo)), el('span', { class: `pillola ${STATI[r.stato]?.[1] || ''}` }, t(STATI[r.stato]?.[0] || r.stato))),
    el('div', { class: 'tenue piccolo' }, pubblico(r.cliente || ''), ' · ', pubblico(r.prodotto || ''), ' · ', conta(r.messaggi),
      r.stato === 'aperta' && r.attesa_dal ? [' · ', el('strong', {}, t('aspetta da {n} ore', { n: ore(r.attesa_dal) }))] : null,
      r.urgente ? [' · ', el('span', { class: 'pillola sospeso' }, t('Bloccante'))] : null,
      r.a_chiamata ? [' · ', el('span', { class: `pillola ${r.a_chiamata.pagata ? 'ok' : 'in_attesa'}` }, r.a_chiamata.pagata ? t('Intervento pagato') : t('A chiamata'))] : null,
      r.ruolo === 'builder' ? [' · ', t('ti hanno coinvolto perché il programma è tuo')] : null, r.ruolo !== 'piattaforma' && r.segnalata && r.stato === 'aperta' ? [' · ', t('segnalata alla piattaforma')] : null),
    fermo && !r.a_chiamata ? el('p', { class: 'piccolo as-fermo' }, statoPagamento({ assistenza: r.assistenza }), ' ', t('Non sei tenuto a rispondere finché il cliente non paga.')) : null);
}
const conta = n => t(n === 1 ? '{n} messaggio' : '{n} messaggi', { n });

async function filo(corpo, id) {
  let r;
  try { r = await chiama('GET', `/api/area/assistenza/richiesta?id=${id}`); }
  catch (e) { corpo.replaceChildren(el('div', { class: 'avviso errore' }, e.message), el('a', { class: 'bottone secondario', href: '#assistenza' }, t('← Tutte le richieste'))); return; }
  const m = messaggio(), testo = el('textarea', { name: 'testo', rows: 4, maxlength: 5000, placeholder: t('La tua risposta: il cliente la riceve per email'), 'aria-label': t('La tua risposta') });
  const risolta = el('input', { type: 'checkbox' }), invia = el('button', { class: 'bottone', type: 'submit' }, t('Rispondi'));
  const f = el('form', { class: 'modulo pila', novalidate: true }, testo,
    el('label', { class: 'spunta' }, risolta, el('span', {}, t('Con questa risposta è risolta'))), m, el('div', { class: 'azioni' }, invia));
  f.addEventListener('submit', e => {
    e.preventDefault(); if (testo.value.trim().length < 2) { m.textContent = t('Scrivi la risposta'); testo.focus(); return; }
    occupato(invia, async () => { await chiama('POST', '/api/area/assistenza/rispondi', { id, testo: testo.value.trim(), risolta: risolta.checked }); avviso('Risposta mandata al cliente'); filo(corpo, id); }, m);
  });
  const azioni = el('div', { class: 'azioni' },
    r.puoCoinvolgere ? el('button', { class: 'bottone secondario piccolo', type: 'button', onclick: async e => {
      const nota = await conferma('Coinvolgi chi sviluppa', 'Chi ha costruito il programma vede la richiesta e può rispondere al cliente. Aggiungi due righe per spiegargli cosa hai già verificato.', { si: 'Coinvolgi', campo: { etichetta: 'Nota per chi sviluppa', segnaposto: 'Es. succede dopo l\'aggiornamento alla 2.1' } });
      if (nota === false) return;
      occupato(e.target, async () => { await chiama('POST', '/api/area/assistenza/coinvolgi', { id, nota }); avviso('Chi sviluppa è stato avvisato'); filo(corpo, id); });
    } }, t('Coinvolgi chi sviluppa')) : null,
    // la piattaforma chiama nel filo chi ha installato: è stato sul posto e conosce il server del cliente
    r.puoCoinvolgereInstallatore ? el('button', { class: 'bottone secondario piccolo', type: 'button', onclick: async e => {
      const nota = await conferma('Coinvolgi chi ha installato', 'Chi ha installato il programma dal cliente vede la richiesta e può rispondere. Serve quando c\'è da passare sul posto o da guardare il server.', { si: 'Coinvolgi', campo: { etichetta: 'Nota per chi ha installato', segnaposto: 'Es. la stampante non risponde: puoi passare a controllare il cavo?' } });
      if (nota === false) return;
      occupato(e.target, async () => { await chiama('POST', '/api/area/assistenza/coinvolgi', { id, nota, chi: 'installatore' }); avviso('Chi ha installato è stato avvisato'); filo(corpo, id); });
    } }, t('Coinvolgi chi ha installato')) : null,
    r.stato !== 'risolta' ? el('button', { class: 'bottone fantasma piccolo', type: 'button', onclick: e => occupato(e.target, async () => { await chiama('POST', '/api/area/assistenza/stato', { id, stato: 'risolta' }); filo(corpo, id); }) }, t('Segna come risolta'))
      : el('button', { class: 'bottone fantasma piccolo', type: 'button', onclick: e => occupato(e.target, async () => { await chiama('POST', '/api/area/assistenza/stato', { id, stato: 'aperta' }); filo(corpo, id); }) }, t('Riapri')));
  const fermo = r.assistenza && !r.assistenza.attiva, ac = r.a_chiamata;
  // l'intervento a chiamata (chi non ha l'assistenza): il preventivo in ore, che il cliente paga dalla sua pagina prima del lavoro
  let preventivo = null;
  if (ac) {
    const n = el('input', { type: 'number', min: 0.5, max: 40, step: 0.5, value: ac.ore || 1, 'aria-label': t('Ore di lavoro'), class: 'ore-as' });
    const tot = el('strong', {}), aggiorna = () => { tot.textContent = euro(Math.round((Number(n.value) || 0) * r.tariffaOra)); };
    n.addEventListener('input', aggiorna); aggiorna();
    const pm = messaggio(), manda = el('button', { type: 'button', class: 'bottone piccolo', onclick: e => occupato(e.currentTarget, async () => {
      await chiama('POST', '/api/area/assistenza/preventivo', { id, ore: Number(n.value) }); avviso('Preventivo mandato al cliente'); filo(corpo, id); }, pm) }, ac.ore ? t('Rimanda il preventivo') : t('Manda il preventivo'));
    preventivo = el('div', { class: `avviso ${ac.pagata ? 'ok' : 'attesa'} pila` },
      el('p', {}, el('strong', {}, t('Intervento a chiamata.')), ' ', ac.pagata ? t('Pagato il {data}: si può lavorare.', { data: data(ac.pagata) })
        : ac.ore ? t('Preventivo mandato: {ore} ore, {totale}. Si lavora dopo il pagamento.', { ore: ac.ore.toLocaleString(lingua === 'en' ? 'en-IE' : 'it-IT'), totale: euro(ac.totale) })
        : t('Il cliente non ha l\'assistenza attiva: manda il preventivo ({tariffa} l\'ora). Si lavora dopo il pagamento.', { tariffa: euro(r.tariffaOra) })),
      r.puoPreventivo ? el('div', { class: 'azioni' }, n, el('span', {}, t('ore'), ' = ', tot), manda) : null, pm);
  }
  corpo.replaceChildren(
    el('a', { class: 'bottone fantasma piccolo indietro-as', href: '#assistenza' }, t('← Tutte le richieste')),
    carta({ class: 'pila filo-as' },
      el('div', { class: 'titoletto' }, el('div', {}, el('h3', {}, pubblico(r.titolo)),
        el('div', { class: 'tenue piccolo' }, pubblico(r.cliente), ' · ', pubblico(r.prodotto || ''), ' · ', t(STATI[r.stato]?.[0] || r.stato), r.urgente ? [' · ', el('span', { class: 'pillola sospeso' }, t('Bloccante'))] : null)),
        statoPagamento({ assistenza: r.assistenza })),
      fermo && !ac ? el('div', { class: 'avviso attesa' }, t('L\'assistenza di questo cliente non è pagata: non sei tenuto a rispondere. Se scrivi, il cliente riceve comunque la tua risposta.')) : null,
      preventivo, rigaControllo(r.monitoraggio),
      el('ol', { class: 'fili-as' }, ...r.messaggi.map(x => el('li', { class: `msg-as ${x.chi}` },
        el('div', { class: 'piccolo' }, el('strong', {}, pubblico(x.nome || t(CHI[x.chi]))), el('span', { class: 'tenue' }, ' · ', t(CHI[x.chi] || x.chi), ' · ', dataOra(x.creato))),
        el('p', { 'data-no-t': '' }, x.testo)))),
      f, azioni));
}

// ---------------- il tasto «Inietta»: un comando che chi installa lancia sul server del cliente ----------------
// Repobay non entra nei server dei clienti: il comando scarica lo script di questa installazione e lo lancia con sudo. Lo script mette
// la bolla in Nginx, prova la configurazione e, se qualcosa non va, rimette tutto com'era; con --togli la toglie.
function iniezione(c, r) {
  const i = r.iniezione; if (!i) return null;
  const chiave = `bolla-dominio:${c.chiave}`;
  let ricordato = ''; try { ricordato = localStorage.getItem(chiave) || ''; } catch { }
  const dominio = el('input', { type: 'text', value: ricordato, placeholder: 'gestionale.attivita.it', autocapitalize: 'none', spellcheck: 'false', 'aria-label': t('Dominio del programma del cliente') });
  const percorso = el('input', { type: 'text', value: i.modo === 'percorso' ? i.percorso : '/admin/', 'aria-label': t('Percorso di amministrazione') });
  const comando = el('pre', { class: 'codice' }), togli = el('pre', { class: 'codice' });
  const valido = () => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(dominio.value.trim());
  const scrivi = () => {
    const d = valido() ? dominio.value.trim().toLowerCase() : 'dominio-del-cliente.it';
    const p = percorso.value.trim();
    comando.textContent = i.comando.replace('{{DOMINIO}}', d).replace(' --percorso=/admin/', i.modo === 'scelta' ? (p === 'tutto' ? ' --tutto' : ` --percorso=${p}`) : '');
    togli.textContent = i.togli.replace('{{DOMINIO}}', d);
    try { if (valido()) localStorage.setItem(chiave, dominio.value.trim()); } catch { }
  };
  dominio.addEventListener('input', scrivi); percorso.addEventListener('input', scrivi); scrivi();
  const nota = { tutto: t('Mette la bolla in tutte le pagine del programma: qui nessuna pagina è aperta al pubblico.'),
    percorso: t('Solo nelle pagine di amministrazione ({p}): le pagine pubbliche restano senza bolla.', { p: i.percorso }),
    scelta: t('Questo programma ha pagine aperte al pubblico: scrivi il percorso delle pagine di amministrazione (oppure «tutto», solo se nessuna pagina è pubblica).') }[i.modo];
  const inietta = el('button', { type: 'button', class: 'bottone', onclick: e => {
    if (!valido()) { dominio.focus(); avviso('Scrivi il dominio del programma del cliente', { errore: true }); return; }
    copia(comando.textContent, e.currentTarget);
  } }, t('Inietta la bolla: copia il comando'));
  return el('div', { class: 'pila inietta-as' },
    titoletto('3. Inietta la bolla con un comando'),
    el('p', { class: 'piccolo' }, t('Lancialo sul server del cliente (serve Nginx): prova la configurazione e, se qualcosa non va, rimette tutto com\'era. Il programma non viene toccato. Repobay non entra nei server dei clienti: il comando lo lanci tu, che ci hai già accesso.')),
    el('label', {}, el('span', {}, t('Dominio del programma')), dominio),
    i.modo === 'scelta' ? el('label', {}, el('span', {}, t('Percorso di amministrazione')), percorso) : null,
    el('p', { class: 'piccolo tenue' }, nota),
    comando, el('div', { class: 'azioni' }, inietta, el('a', { class: 'bottone fantasma piccolo', href: i.script, target: '_blank', rel: 'noopener' }, t('Leggi lo script'))),
    el('details', { class: 'piega' }, el('summary', {}, t('Per toglierla')), togli));
}

// ---------------- il link, la bolla e il QR di un cliente ----------------
export async function finestraAssistenza(c) {
  let r;
  try { r = await chiama('POST', '/api/area/assistenza/codice', { chiave: c.chiave }); } catch (e) { avviso(e.message, { errore: true }); return; }
  const campoLink = el('input', { readonly: true, value: r.link, 'aria-label': t('Link di assistenza'), onfocus: e => e.target.select() });
  const bolla = el('textarea', { readonly: true, rows: 4, 'aria-label': t('La bolla da incollare'), onfocus: e => e.target.select() }, r.bolla);
  const nginx = `location /admin/ {\n    proxy_pass http://127.0.0.1:8080;\n    proxy_set_header Accept-Encoding "";\n    sub_filter '</body>' '${r.bolla.replace(/'/g, '"')}</body>';\n    sub_filter_once on;\n}`;
  const d = el('dialog', { class: 'finestra larga' },
    el('h3', {}, t('Assistenza per {cliente}', { cliente: c.nome || t('il cliente') })),
    el('p', { class: 'tenue' }, t('Chi ha questo link può solo aprire richieste di assistenza e leggerle: non vede pagamenti né dati.')),
    el('div', { class: 'assistenza-griglia' },
      el('div', { class: 'pila' },
        titoletto('1. Il link per il cliente'),
        el('p', { class: 'piccolo' }, t('Mandalo al cliente, o aprilo sul suo telefono e aggiungilo alla schermata Home: diventa un\'app.')),
        el('div', { class: 'riga-copia' }, campoLink, el('button', { type: 'button', class: 'bottone secondario piccolo', onclick: e => copia(r.link, e.currentTarget) }, t('Copia'))),
        titoletto('2. La bolla dentro il programma'),
        el('p', { class: 'piccolo' }, t('Incollala dove il programma accetta codice HTML personalizzato (per esempio in Ghost: Code injection). Solo nelle pagine di amministrazione: nelle pagine pubbliche la vedrebbero i visitatori. È solo un link, nessuno script.')),
        bolla, el('div', { class: 'azioni' }, el('button', { type: 'button', class: 'bottone secondario piccolo', onclick: e => copia(r.bolla, e.currentTarget) }, t('Copia la bolla'))),
        iniezione(c, r),
        titoletto(r.iniezione ? '4. Il controllo da fuori' : '3. Il controllo da fuori'),
        el('p', { class: 'piccolo' }, t('Scrivi l\'indirizzo del programma: Repobay lo apre ogni pochi minuti come un visitatore e, se non risponde, avvisa te, la piattaforma e il cliente. Ogni mese il cliente riceve il rapporto con i numeri. Il programma non viene toccato.')),
        rigaControllo(r.monitoraggio), campoControllo(c.chiave, r.monitoraggio),
        el('details', { class: 'piega' }, el('summary', {}, t('Preferisci farlo a mano? La configurazione per Nginx')),
          el('p', { class: 'piccolo' }, t('Con Nginx, nel blocco delle pagine di amministrazione (cambia percorso e porta):')), el('pre', { class: 'codice' }, nginx))),
      el('figure', { class: 'qr-as' }, svg(r.qr), el('figcaption', { class: 'piccolo tenue' }, t('Stampalo e attaccalo vicino alla cassa o al computer.')))),
    el('div', { class: 'azioni fine' },
      el('button', { type: 'button', class: 'bottone pericolo piccolo', onclick: async () => {
        if (!await conferma('Rifare il codice?', 'Il link, la bolla e il QR vecchi smettono di funzionare: dovrai rimettere quelli nuovi.', { si: 'Rifai', pericolo: true })) return;
        d.close(); await chiama('POST', '/api/area/assistenza/codice', { chiave: c.chiave, nuovo: true }); avviso('Codice rifatto'); finestraAssistenza(c);
      } }, t('Rifai il codice')),
      el('button', { type: 'button', class: 'bottone', autofocus: true, onclick: () => d.close() }, t('Fatto'))));
  d.addEventListener('close', () => d.remove());
  document.body.append(d); d.showModal();
}
