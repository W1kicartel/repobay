// Il pannello di chi gestisce la piattaforma: i numeri, il prelancio, la coda di revisione dei prodotti, gli utenti, le
// recensioni, gli ordini in crypto, gli errori dei versamenti, la DAC7 e i progetti non rivendicati. Una sezione alla volta,
// scelta dal menu laterale (l'indirizzo ricorda quale: #revisione, #utenti…).
import { $, $$, el, chiama, euro, data, dataOra, pillola, stelle, avviso, conferma, occupato, t, pronta, conta } from './comune.js';
import { azioneEscrow, CUSTODIE, classeCustodia } from './escrow.js';
await pronta;

const SEZIONI = ['panoramica', 'revisione', 'vetrina', 'utenti', 'recensioni', 'contestazioni', 'assistenza', 'versamenti', 'bonifici', 'crypto', 'dac7'];
let A = null, B = null, q = '', filtro = 'revisione', mio = null;   // mio: chi gestisce (/api/io), per non sospendere sé stesso

// ---------------- sezioni ----------------
function mostra(nome) {
  if (!SEZIONI.includes(nome)) nome = 'panoramica';
  for (const s of $$('.sezioni > section')) s.classList.toggle('nascosto', s.dataset.sezione !== nome);
  for (const a of $$('#menu-pannello a')) { if (a.dataset.sezione === nome) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
}
addEventListener('hashchange', () => { mostra(location.hash.slice(1)); scrollTo({ top: 0 }); });

// ---------------- piccoli attrezzi ----------------
const vuoto = (titolo, testo) => el('div', { class: 'vuoto vuoto-sala' },
  el('div', { class: 'vuoto-img', 'aria-hidden': 'true' }, el('img', { src: '/img/sobrio/vuoto.svg', alt: '', width: '320', height: '320', loading: 'lazy', decoding: 'async', onerror: e => e.currentTarget.classList.add('mancante'), onload: e => e.currentTarget.classList.add('caricata') })),
  el('div', {}, el('h3', {}, t(titolo)), testo ? el('p', {}, t(testo)) : null));
const corto = s => { s = String(s || ''); return s.length > 16 ? `${s.slice(0, 8)}…${s.slice(-6)}` : s; };
const fuori = (href, testo) => el('a', { href, target: '_blank', rel: 'noopener', class: 'bottone fantasma piccolo' }, t(testo), el('span', { 'aria-hidden': 'true' }, '↗'));
const bottone = (testo, classe, azione) => { const b = el('button', { type: 'button', class: `bottone piccolo ${classe}` }, t(testo)); b.addEventListener('click', () => azione(b)); return b; };
const tabella = (intestazioni, righe) => el('div', { class: 'tabella' }, el('table', {},
  el('thead', {}, el('tr', {}, ...intestazioni.map(h => el('th', h.startsWith('#') ? { class: 'num' } : {}, h.startsWith('#') ? t(h.slice(1)) : t(h))))),
  el('tbody', {}, ...righe)));
const td = (contenuto, classe) => el('td', classe ? { class: classe } : {}, contenuto);
const percento = x => `${Math.round(Number(x || 0) * 100)}%`;

// ---------------- caricamento ----------------
async function carica() {
  try { [A, B] = await Promise.all([chiama('GET', '/api/admin' + (q ? `?q=${encodeURIComponent(q)}` : '')), chiama('GET', '/api/admin/bonifici').catch(() => null)]); }
  catch (e) {
    $('#stato-pannello').classList.add('nascosto'); $('#pannello').classList.add('nascosto');
    if (e.stato === 401 || e.stato === 403) $('#vietato').classList.remove('nascosto');
    else { $('#guasto-testo').textContent = e.message; $('#guasto').classList.remove('nascosto'); }
    return false;
  }
  $('#stato-pannello').classList.add('nascosto'); $('#guasto').classList.add('nascosto'); $('#vietato').classList.add('nascosto');
  $('#pannello').classList.remove('nascosto');
  disegna(); return true;
}
function disegna() {
  numeri(); prelancio(); canone(); prodotti(); vetrina(); utenti(); recensioni(); contestazioni(); versamenti(); bonifici(); ordini(); assistenzaFerma();
  const conto = (id, n) => { const x = $(id); x.textContent = n ? String(n) : ''; x.classList.toggle('nascosto', !n); };
  conto('#conto-revisione', A.numeri.inRevisione); conto('#conto-errori', A.errori.length); conto('#conto-contestazioni', A.numeri.contestazioniAperte);
  conto('#conto-bonifici', B ? B.ordini.filter(o => o.stato === 'aperto').length + B.manuali.length : 0);
}

// ---------------- panoramica ----------------
function numeri() {
  const n = A.numeri;
  // il quadro della sala controllo: ogni strumento con la sua spia (gialla se c'è da fare, rossa se c'è un guaio)
  const carta = (etichetta, valore, { link, stato, soldi } = {}) => el(link ? 'a' : 'div', { class: `strumento${stato ? ' ' + stato : ''}${soldi ? ' soldi' : ''}`, href: link },
    el('span', { class: 'etichetta' }, t(etichetta)), el('span', { class: 'numero' }, String(valore)), el('i', { class: 'spia', 'aria-hidden': 'true' }));
  $('#numeri').replaceChildren(
    carta('Utenti', n.utenti, { link: '#utenti' }),
    carta('Prodotti pubblicati', n.prodotti),
    carta('In revisione', n.inRevisione, { link: '#revisione', stato: n.inRevisione ? 'da-fare' : '' }),
    carta('Builder con prodotti', n.builder),
    carta('Installatori', n.installatori),
    carta('Clienti attivi', n.clienti),
    carta('Vendite del mese', n.venditeMese),
    carta('Richieste del mese', n.richiesteMese),
    carta('Versato nel mese', euro(n.versatoMese), { link: '#versamenti', soldi: true }),
    carta('Quote in attesa', euro(n.inAttesa), { link: '#versamenti', soldi: true }),
    carta('Webhook falliti (7 giorni)', n.webhookFalliti, { stato: n.webhookFalliti ? 'guaio' : '' }));
}
function prelancio() {
  const x = $('#prelancio'); x.checked = !!A.prelancio;
  const s = $('#prelancio-stato');
  s.textContent = t(A.prelancio ? 'Acceso: i pagamenti sono chiusi, i business chiedono un preventivo.' : 'Spento: i pagamenti con carta e crypto sono aperti.');
  s.className = `piccolo ${A.prelancio ? 'stato-attesa' : 'stato-ok'}`;
}
$('#prelancio').addEventListener('change', async e => {
  const voglio = e.target.checked; e.target.checked = !voglio;   // finché non conferma resta com'era
  const ok = voglio
    ? await conferma('Tornare in prelancio?', 'I pagamenti si chiudono subito: i business potranno solo chiedere un preventivo. Gli abbonamenti già attivi continuano.', { si: 'Torna in prelancio' })
    : await conferma('Aprire i pagamenti?', 'I business potranno pagare con carta e crypto. Fallo solo quando Stripe è attivo e i testi legali sono stati rivisti.', { si: 'Apri i pagamenti' });
  if (!ok) return;
  const msg = $('#msg-prelancio'); e.target.disabled = true;
  try {
    const r = await chiama('POST', '/api/admin/prelancio', { attivo: voglio }); A.prelancio = r.prelancio; prelancio();
    avviso(r.prelancio ? 'Prelancio acceso: i pagamenti sono chiusi' : 'Prelancio spento: i pagamenti sono aperti');
    msg.textContent = '';
  } catch (err) { msg.className = 'messaggio'; msg.textContent = err.message; }
  finally { e.target.disabled = false; }
});
$('#sincronizza').addEventListener('click', e => {
  const msg = $('#msg-sincronizza');
  occupato(e.currentTarget, async () => {
    const r = await chiama('POST', '/api/admin/sincronizza', {});
    msg.className = 'messaggio bene';
    msg.textContent = r.letti ? t('Riletti {n} progetti da GitHub.', { n: r.letti }) : t('Tutti i progetti erano già aggiornati.');
    await carica();
  }, msg);
});

// ---------------- revisione dei prodotti ----------------
const FILTRI = [['revisione', 'In revisione'], ['pubblicato', 'Pubblicati'], ['altri', 'Bozze, respinti e sospesi'], ['tutti', 'Tutti']];
const passa = (p, f) => f === 'tutti' || (f === 'altri' ? !['revisione', 'pubblicato'].includes(p.stato) : p.stato === f);
function prodotti() {
  $('#filtri-prodotti').replaceChildren(...FILTRI.map(([f, nome]) => el('button', { type: 'button', class: `chip${filtro === f ? ' attivo' : ''}`, 'aria-pressed': String(filtro === f),
    onclick: () => { filtro = f; prodotti(); } }, t(nome), el('span', { class: 'tenue-chip' }, String(A.prodotti.filter(p => passa(p, f)).length)))));
  const l = A.prodotti.filter(p => passa(p, filtro));
  $('#prodotti').replaceChildren(...(l.length ? l.map(schedaProdotto)
    : [filtro === 'revisione' ? vuoto('Niente da rivedere', 'Quando un builder manda un prodotto in revisione, compare qui.') : vuoto('Nessun prodotto qui', 'Prova un altro filtro.')]));
}
// il canone dell'assistenza: uno per tutti i prodotti (vale per le vendite nuove)
function canone() {
  const f = $('#f-canone'), v = $('#canone-mese'), m = $('#msg-canone'), anno = $('#canone-anno');
  if (!f) return;
  const lAnno = c => { anno.textContent = c > 0 ? t('= {x} l\'anno', { x: euro(c * 12) }) : ''; };
  v.value = String((A.assistenzaMese || 0) / 100); lAnno(A.assistenzaMese || 0);
  v.addEventListener('input', () => lAnno(Math.round(Number(String(v.value).replace(',', '.')) * 100)));
  f.addEventListener('submit', e => { e.preventDefault(); occupato(f.querySelector('button'), async () => {
    const r = await chiama('POST', '/api/admin/assistenza', { prezzo_mese: v.value });
    A.assistenzaMese = r.prezzo_mese; v.value = String(r.prezzo_mese / 100); lAnno(r.prezzo_mese);
    for (const p of A.prodotti || []) p.prezzo_mese = r.prezzo_mese;
    m.className = 'messaggio bene'; m.textContent = r.prezzo_mese ? t('Canone: {x} al mese su tutti i prodotti ({n} aggiornati), per le vendite nuove', { x: euro(r.prezzo_mese), n: r.prodotti }) : t('Assistenza spenta su tutti i prodotti');
  }, m); });
}

function schedaProdotto(p) {
  const cambia = (stato, nota, b, fatto) => occupato(b, async () => {
    await chiama('POST', '/api/admin/prodotto', { id: p.id, stato, nota }); avviso(fatto); await carica();
  });
  const azioni = el('div', { class: 'azioni' });
  if (p.stato !== 'pubblicato') azioni.append(bottone('Pubblica', '', b => cambia('pubblicato', null, b, t('«{nome}» è pubblicato: il builder riceve una notifica', { nome: p.nome }))));
  if (p.stato === 'revisione') azioni.append(bottone('Respingi con nota', 'secondario', async b => {
    const nota = await conferma(t('Respingere «{nome}»?', { nome: p.nome }), 'Scrivi cosa va sistemato: il builder riceve la nota nella sua area e per email.',
      { si: 'Respingi', pericolo: true, campo: { etichetta: 'Nota per il builder', segnaposto: 'Per esempio: la guida non spiega come fare il backup' } });
    if (nota === false) return;
    if (!String(nota).trim()) return avviso('Scrivi la nota: serve al builder per sistemare il prodotto', { errore: true });
    cambia('respinto', nota.trim(), b, t('«{nome}» è respinto: il builder riceve la nota', { nome: p.nome }));
  }));
  if (p.stato === 'pubblicato') azioni.append(bottone('Sospendi', 'pericolo', async b => {
    const nota = await conferma(t('Sospendere «{nome}»?', { nome: p.nome }), 'Sparisce dal catalogo. Gli abbonamenti già venduti continuano e il builder riceve una notifica.',
      { si: 'Sospendi', pericolo: true, campo: { etichetta: 'Nota per il builder (facoltativa)', segnaposto: 'Il motivo, in breve' } });
    if (nota === false) return;
    cambia('sospeso', String(nota).trim() || null, b, t('«{nome}» è sospeso', { nome: p.nome }));
  }));
  azioni.append(fuori(`/p/${encodeURIComponent(p.slug)}`, 'Apri la pagina'), p.url ? fuori(p.url, 'Repository') : null);

  const quote = el('dl', { class: 'dati' },
    el('dt', {}, t('Categoria')), el('dd', {}, t(p.categoria || '—')),
    // l'installazione la prezza chi vende (qui il prezzo di riferimento da cui parte chi lo offre); il canone dell'assistenza lo fissa la piattaforma
    el('dt', {}, t('Prezzo di riferimento')), el('dd', {}, p.prezzo_avvio ? euro(p.prezzo_avvio) : t('nessuno: lo decide chi lo vende')),
    el('dt', {}, t('Assistenza al mese')), el('dd', {}, p.prezzo_mese ? t('{x}, uguale per tutti i prodotti', { x: euro(p.prezzo_mese) }) : t('senza assistenza')),
    el('dt', {}, t('Divisione')), el('dd', {}, p.licenza_tipo === 'interna' && !p.rivendicato ? t('tutto a chi installa: licenza d\'uso interno, l\'azienda non ha aderito')
      : [t('{b} a chi sviluppa, il resto a chi vende', { b: percento(p.percentuale ?? 1 - (A?.quotaInstallatore ?? .2)) }), p.percentuale_scelta ? '' : ` (${t('standard')})`,
        p.accordi ? ` · ${conta(p.accordi, 'accordo diverso', 'accordi diversi')}` : '']),
    p.sito ? [el('dt', {}, t('Sito')), el('dd', {}, el('a', { href: p.sito, target: '_blank', rel: 'noopener' }, p.sito))] : null,
    p.demo ? [el('dt', {}, t('Demo')), el('dd', {}, el('a', { href: p.demo, target: '_blank', rel: 'noopener' }, p.demo))] : null,
    el('dt', {}, t('Sicurezza')), el('dd', {}, p.sicurezza ? [pillola(p.sicurezza.esito === 'non_disponibile' ? 'non disponibile' : p.sicurezza.esito, { ok: 'ok', attenzione: 'in_attesa', grave: 'sospeso' }[p.sicurezza.esito] || ''),
      p.sicurezza.punteggio != null ? ` OpenSSF ${Number(p.sicurezza.punteggio).toFixed(1)}/10` : '', ` · ${data(p.sicurezza.quando)}`] : t('non ancora controllato')));
  // una release ferma per un problema grave: si guarda il motivo e, se è un falso allarme, si sblocca
  if (p.ferma) azioni.prepend(bottone(t('Sblocca la release {v}', { v: p.ferma }), 'pericolo', async b => {
    const nota = await conferma(t('Sbloccare {v}?', { v: p.ferma }), 'Chi installa riceve l\'avviso di aggiornare, con la nota che i controlli hanno segnalato qualcosa. Fallo solo se hai verificato che è un falso allarme.',
      { si: 'Sblocca', pericolo: true, campo: { etichetta: 'Cosa hai verificato', segnaposto: 'Per esempio: il file segnalato è un esempio di prova' } });
    if (nota === false) return;
    occupato(b, async () => { await chiama('POST', '/api/admin/sicurezza/sblocca', { id: p.id, tag: p.ferma, nota }); avviso('Release sbloccata: chi installa è avvisato'); await carica(); });
  }));
  return el('article', { class: `carta prodotto-admin${p.stato === 'revisione' ? ' da-fare' : ''}` },
    el('div', { class: 'riga-titolo' },
      el('div', {}, el('h3', { 'data-no-t': '' }, p.nome),
        el('p', { class: 'repo mono' }, el('span', { 'data-no-t': '' }, p.repo), ` · ${p.licenza || '—'} · ★ ${p.stelle || 0}`, p.versione ? ` · ${p.versione}` : '')),
      el('div', { class: 'pillole' }, pillola(p.stato), p.rivendicato ? null : pillola('non rivendicato', 'in_attesa'))),
    el('p', { class: 'tenue piccolo' }, t('di'), ' ', el('span', { 'data-no-t': '' }, p.builder || '—'), p.github ? el('span', { class: 'mono', 'data-no-t': '' }, ` @${p.github}`) : null),
    p.nota ? el('div', { class: 'avviso attesa' }, el('span', {}, t('Nota al builder:'), ' ', el('span', { 'data-no-t': '' }, p.nota))) : null,
    el('div', { class: 'anteprima' },
      el('div', {}, el('span', { class: 'etichetta' }, t('Descrizione')), el('p', { class: 'testo-utente', 'data-no-t': '' }, p.descrizione || t('Nessuna descrizione'))),
      quote),
    el('details', { class: 'guida-admin' }, el('summary', {}, t('Guida per chi installa')), el('p', { class: 'testo-utente', 'data-no-t': '' }, p.guida || t('Nessuna guida'))),
    licenza(p),
    programmaRef(p),
    azioni);
}

// il programma partner dell'azienda (chi offre il prodotto ne rispetta le condizioni) e il link referral di Repobay verso i suoi piani
function programmaRef(p) {
  const pr = p.programma || {}, rf = p.ref || {};
  const nome = el('input', { value: pr.nome || '', placeholder: 'OpenProject Reseller Program' }), url = el('input', { type: 'url', value: pr.url || '', placeholder: 'https://…' });
  const termini = el('textarea', { rows: 3, maxlength: 600, placeholder: t('Le condizioni in breve: costi, requisiti, quote') }, pr.termini || '');
  const obbligatorio = el('input', { type: 'checkbox', checked: p.programma ? pr.obbligatorio : true });
  const refUrl = el('input', { type: 'url', value: rf.url || '', placeholder: 'https://…?ref=repobay' }), refTesto = el('input', { value: rf.testo || '', placeholder: t('Preferisci il cloud ufficiale?') });
  const msg = el('div', { class: 'messaggio', role: 'alert' });
  // il corpo si legge al clic (i campi cambiano dopo che il modulo è disegnato)
  const manda = (corpo, fatto) => b => occupato(b, async () => { await chiama('POST', '/api/admin/prodotto/programma', { id: p.id, ...corpo() }); avviso(fatto); await carica(); }, msg);
  return el('details', { class: 'guida-admin' },
    el('summary', {}, p.programma ? t('Programma partner: {nome}', { nome: pr.nome }) : t('Programma partner e link referral')),
    el('div', { class: 'modulo pila' },
      el('label', {}, t('Programma partner dell\'azienda'), nome), el('label', {}, t('Link per aderire'), url), el('label', {}, t('Condizioni in breve'), termini),
      el('label', { class: 'spunta' }, obbligatorio, el('span', {}, t('Chi lo offre deve confermare di rispettarle'))),
      el('div', { class: 'azioni' }, bottone('Salva il programma', '', manda(() => ({ programma: { nome: nome.value, url: url.value, termini: termini.value, obbligatorio: obbligatorio.checked } }), 'Programma salvato')),
        p.programma ? bottone('Togli', 'secondario', manda(() => ({ programma: null }), 'Programma tolto')) : null),
      el('label', {}, t('Link referral (cloud o piani a pagamento)'), refUrl), el('label', {}, t('La frase sul link'), refTesto),
      el('div', { class: 'azioni' }, bottone('Salva il link', '', manda(() => ({ ref: { url: refUrl.value, testo: refTesto.value } }), 'Link salvato')),
        p.ref ? bottone('Togli', 'secondario', manda(() => ({ ref: null }), 'Link tolto')) : null),
      msg));
}

// la licenza letta a mano: quando GitHub non la riconosce o non è open source. «interna» (n8n, Elastic…): si vendono solo installazione
// e assistenza sul server del cliente; finché l'azienda non aderisce, quello che resta dopo la piattaforma va tutto a chi installa
function licenza(p) {
  const tipo = el('select', { 'aria-label': t('Tipo di licenza') }, el('option', { value: 'aperta' }, t('aperta: uso libero, anche commerciale')),
    el('option', { value: 'interna' }, t('interna: solo per l\'attività, sul suo server')));
  tipo.value = p.licenza_tipo || 'aperta';
  const nome = el('input', { value: p.licenza_nome || '', placeholder: 'Sustainable Use License' }), spdx = el('input', { value: p.licenza_verificata ? p.licenza : '', placeholder: 'LicenseRef-Sustainable-Use-License' });
  const fonte = el('input', { type: 'url', value: p.licenza_fonte || '', placeholder: 'https://github.com/…/LICENSE.md' });
  const nota = el('textarea', { rows: 3, maxlength: 700, placeholder: t('Cosa può fare chi compra, in parole semplici. Finisci con «Repobay non è affiliata a …».') }, p.licenza_nota || '');
  const msg = el('div', { class: 'messaggio', role: 'alert' });
  const salva = bottone('Salva la licenza', '', b => occupato(b, async () => {
    await chiama('POST', '/api/admin/prodotto/licenza', { id: p.id, licenza: { tipo: tipo.value, nome: nome.value, spdx: spdx.value, nota: nota.value, fonte: fonte.value } });
    avviso('Licenza salvata: GitHub non la cambia più'); await carica();
  }, msg));
  const via = p.licenza_verificata ? bottone('Torna a quella di GitHub', 'secondario', b => occupato(b, async () => {
    await chiama('POST', '/api/admin/prodotto/licenza', { id: p.id, licenza: null }); avviso('Vale di nuovo la licenza letta da GitHub'); await carica();
  }, msg)) : null;
  return el('details', { class: 'guida-admin' },
    el('summary', {}, p.licenza_verificata ? t('Licenza letta a mano: {nome}, {tipo}', { nome: p.licenza_nome || p.licenza, tipo: p.licenza_tipo }) : t('Licenza: leggila a mano')),
    el('div', { class: 'modulo pila' }, el('label', {}, t('Tipo'), tipo), el('label', {}, t('Nome'), nome), el('label', {}, t('Identificativo SPDX'), spdx),
      el('label', {}, t('Fonte (il file della licenza)'), fonte), el('label', {}, t('Per chi compra'), nota), msg, el('div', { class: 'azioni' }, salva, via)));
}

// ---------------- progetti non rivendicati ----------------
function vetrina() {
  $('#avviso-legale').classList.toggle('nascosto', !!A.nonRivendicati);
  $('#avviso-acceso').classList.toggle('nascosto', !A.nonRivendicati);
  for (const x of $$('#modulo-vetrina input, #modulo-vetrina button, #vetrina-importa')) x.disabled = !A.nonRivendicati;
  $('#vetrina-curata').classList.toggle('nascosto', !A.vetrinaCurata);
  $('#vetrina-importa').textContent = t('Carica la vetrina curata ({n} progetti)', { n: A.vetrinaCurata });
  const l = A.prodotti.filter(p => !p.rivendicato);
  $('#lista-vetrina').replaceChildren(l.length ? el('div', { class: 'lista-righe' }, ...l.map(p => el('div', {},
    el('div', {}, el('strong', { 'data-no-t': '' }, p.nome), el('div', { class: 'mono tenue piccolo', 'data-no-t': '' }, p.repo)),
    el('div', { class: 'azioni' }, pillola(p.stato), fuori(`/p/${encodeURIComponent(p.slug)}`, 'Apri la pagina')))))
    : vuoto('Nessun progetto in vetrina', 'I progetti che metti in vetrina prima del loro maintainer compaiono qui.'));
}
$('#modulo-vetrina').addEventListener('submit', e => {
  e.preventDefault();
  const campo = $('#repo-vetrina'), msg = $('#msg-vetrina');
  const repo = campo.value.trim().replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/\.git$/, '').replace(/\/+$/, '');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { msg.className = 'messaggio'; msg.textContent = t('Scrivi owner/nome, come nell\'indirizzo del repository'); campo.setAttribute('aria-invalid', 'true'); campo.focus(); return; }
  campo.removeAttribute('aria-invalid');
  occupato($('#vetrina-invia'), async () => {
    const p = await chiama('POST', '/api/admin/non-rivendicato', { repo });
    // da qui il progetto entra come bozza e non c'è un modulo per completarlo: lo completa il maintainer quando lo rivendica
    campo.value = ''; msg.className = 'messaggio bene';
    msg.replaceChildren(t('«{nome}» è entrato come bozza e non si vede ancora nel catalogo. Categoria, guida e prezzi li completa il maintainer quando lo rivendica; i progetti della vetrina curata entrano invece già completi.', { nome: p.nome }),
      ...(p.slug ? [' ', el('a', { href: `/p/${encodeURIComponent(p.slug)}`, target: '_blank', rel: 'noopener' }, t('Apri la pagina'))] : []));
    await carica();
  }, msg);
});

// la vetrina curata: tutti insieme, con il resoconto di cosa è entrato e cosa no (e perché)
$('#vetrina-importa').addEventListener('click', e => {
  const msg = $('#msg-importa');
  occupato(e.currentTarget, async () => {
    msg.className = 'messaggio'; msg.textContent = t('Leggo i repository da GitHub: ci vuole qualche decina di secondi…');
    const r = await chiama('POST', '/api/admin/vetrina/importa', {});
    msg.className = 'messaggio bene';
    msg.textContent = t('Pubblicati {p}, aggiornati {a}, già in catalogo {g}, scartati {s}.', { p: r.pubblicati, a: r.aggiornati, g: r.presenti, s: r.scartati });
    const no = r.esito.filter(x => x.esito === 'scartato');
    $('#esito-importa').replaceChildren(...(no.length ? [el('ul', { class: 'lista-scartati' }, ...no.map(x => el('li', {}, el('span', { class: 'mono', 'data-no-t': '' }, x.repo), ': ', x.motivo)))] : []));
    await carica();
  }, msg);
});

// ---------------- utenti ----------------
function utenti() {
  const l = A.utenti;
  $('#conto-utenti').textContent = q ? t('Risultati per «{q}»: {n}', { q, n: l.length }) : t('Gli iscritti più recenti: {n}', { n: l.length });
  if (!l.length) { $('#lista-utenti').replaceChildren(vuoto(q ? 'Nessun utente trovato' : 'Ancora nessun iscritto', q ? 'Prova con un altro nome, un\'email o un login GitHub.' : null)); return; }
  $('#lista-utenti').replaceChildren(tabella(['Nome', 'Email', 'GitHub', 'Zona', '#Prodotti', '#Installa', 'Corso', 'Stripe', '2FA', '#In attesa', '#Versate', 'Stato', ''], l.map(rigaUtente)));
}
// il corso per installatori: superato o no, e i programmi impegnativi (si sbloccano con l'esperienza, o da qui a chi fa già questo lavoro)
function corsoUtente(u) {
  const imp = bottone(u.esperto ? 'Togli impegnativi' : 'Sblocca impegnativi', 'secondario', async b => {
    const ok = u.esperto
      ? await conferma(t('Togliere i programmi impegnativi a {nome}?', { nome: u.nome }), 'Li potrà offrire di nuovo dopo le installazioni confermate richieste, come tutti.', { si: 'Togli' })
      : await conferma(t('Sbloccare i programmi impegnativi a {nome}?', { nome: u.nome }), 'Fallo solo se fa già questo lavoro e lo hai verificato: potrà offrire subito Odoo, ERPNext e gli altri programmi impegnativi.', { si: 'Sblocca' });
    if (!ok) return;
    occupato(b, async () => { await chiama('POST', '/api/admin/installatore/esperto', { id: u.id, esperto: !u.esperto }); avviso(u.esperto ? t('Programmi impegnativi tolti') : t('Programmi impegnativi sbloccati')); await carica(); });
  });
  return el('div', { class: 'nome-utente' },
    u.corso ? pillola(t('superato, {n} giuste', { n: u.corso_punti }), 'ok') : el('span', { class: 'tenue' }, t('non ancora')),
    u.esperto ? pillola('impegnativi sbloccati', 'ok') : el('span', { class: 'tenue piccolo' }, t('{n} installazioni confermate', { n: u.confermate })),
    u.stato === 'attivo' ? imp : null);
}
const sonoIo = u => !!mio && ((mio.id != null && u.id === mio.id) || (!!mio.codice && u.codice === mio.codice) || (!!mio.email && u.email === mio.email));
function rigaUtente(u) {
  let azione = null;
  if ((u.stato === 'attivo' || u.stato === 'sospeso') && !sonoIo(u)) {
    const sospendi = u.stato === 'attivo';
    azione = bottone(sospendi ? 'Sospendi' : 'Riattiva', sospendi ? 'pericolo' : 'secondario', async b => {
      const ok = sospendi
        ? await conferma(t('Sospendere {nome}?', { nome: u.nome }), 'Esce subito da tutti i dispositivi e non può più entrare finché non lo riattivi.', { si: 'Sospendi', pericolo: true })
        : await conferma(t('Riattivare {nome}?', { nome: u.nome }), 'Potrà entrare di nuovo e usare la sua area.', { si: 'Riattiva' });
      if (!ok) return;
      occupato(b, async () => {
        const r = await chiama('POST', '/api/admin/utente', { id: u.id, stato: sospendi ? 'sospeso' : 'attivo' });
        if (!r.ok) throw new Error(t('Non è stato possibile cambiare lo stato di questo conto'));
        avviso(sospendi ? t('{nome} è sospeso', { nome: u.nome }) : t('{nome} è di nuovo attivo', { nome: u.nome })); await carica();
      });
    });
  }
  return el('tr', {},
    td(el('div', { class: 'nome-utente' }, el('strong', { 'data-no-t': '' }, u.nome), el('span', { class: 'tenue piccolo' }, t('dal {data}', { data: data(u.creato) })))),
    td(u.email ? el('div', { class: 'nome-utente' }, el('span', { 'data-no-t': '' }, u.email), u.verificata ? pillola('verificata', 'ok') : pillola('da verificare', 'in_attesa')) : el('span', { class: 'tenue' }, '—')),
    td(u.github_login ? el('a', { href: `https://github.com/${encodeURIComponent(u.github_login)}`, target: '_blank', rel: 'noopener', class: 'mono', 'data-no-t': '' }, `@${u.github_login}`) : el('span', { class: 'tenue' }, '—')),
    td(u.zona ? el('span', { 'data-no-t': '' }, u.zona) : el('span', { class: 'tenue' }, '—')),
    td(String(u.prodotti), 'num'), td(String(u.adozioni), 'num'), td(corsoUtente(u)),
    td(u.pronto ? pillola('pronto') : el('span', { class: 'tenue' }, '—')),
    td(u.dueFattori ? pillola('attiva', 'ok') : el('span', { class: 'tenue' }, '—')),
    td(euro(u.attesa), 'num'), td(euro(u.versate), 'num'),
    td(pillola(u.stato)), td(azione));
}
$('#cerca-utenti').addEventListener('submit', e => {
  e.preventDefault(); q = $('#q').value.trim();
  occupato($('#cerca'), carica);
});
$('#q').addEventListener('search', () => { if (!$('#q').value && q) { q = ''; carica(); } });   // la crocetta del campo svuota la ricerca

// ---------------- recensioni ----------------
function recensioni() {
  const l = A.recensioni;
  if (!l.length) { $('#lista-recensioni').replaceChildren(vuoto('Ancora nessuna recensione', 'Le recensioni dei business compaiono qui appena le scrivono.')); return; }
  $('#lista-recensioni').replaceChildren(el('div', { class: 'lista-righe recensioni-admin' }, ...l.map(r => el('div', { class: r.nascosta ? 'nascosta-r' : '' },
    el('div', { class: 'recensione-testo' },
      el('div', { class: 'riga-meta' }, stelle(r.voto), el('strong', { 'data-no-t': '' }, r.autore || t('Anonimo')), el('span', { class: 'tenue piccolo' }, t('su'), ' ', el('span', { 'data-no-t': '' }, r.prodotto), ` · ${data(r.creata)}`),
        r.nascosta ? pillola('nascosta', 'sospeso') : null),
      r.testo ? el('p', { class: 'testo-utente', 'data-no-t': '' }, r.testo) : el('p', { class: 'tenue piccolo' }, t('Solo le stelle, senza testo'))),
    bottone(r.nascosta ? 'Mostra' : 'Nascondi', r.nascosta ? 'secondario' : 'pericolo', b => occupato(b, async () => {
      const x = await chiama('POST', '/api/admin/recensione', { cliente: r.cliente, nascosta: !r.nascosta });
      if (!x.ok) throw new Error(t('Recensione non trovata'));
      avviso(r.nascosta ? 'La recensione è di nuovo visibile' : 'La recensione è nascosta'); await carica();
    }))))));
}

// ---------------- segnalazioni dei clienti: le quote ferme, la decisione ----------------
// le richieste di assistenza ferme: senza risposta da più del doppio del tempo promesso, o segnalate dal cliente
async function assistenzaFerma() {
  const box = $('#lista-assistenza'), conto = $('#conto-assistenza');
  let l = [];
  try { l = (await chiama('GET', '/api/admin/assistenza')).richieste; } catch (e) { box.replaceChildren(el('div', { class: 'avviso errore' }, e.message)); return; }
  conto.textContent = l.length ? String(l.length) : ''; conto.classList.toggle('nascosto', !l.length);
  if (!l.length) { box.replaceChildren(vuoto('Nessuna richiesta ferma', 'Quando un cliente aspetta troppo una risposta, o lo segnala, compare qui.')); return; }
  box.replaceChildren(tabella(['Da', 'Cliente', 'Prodotto', 'Chi installa', 'Richiesta', ''], l.map(r => el('tr', {},
    td(dataOra(r.attesa_dal)), td(el('span', { 'data-no-t': '' }, r.cliente || '—')), td(el('span', { 'data-no-t': '' }, r.prodotto || '—')), td(el('span', { 'data-no-t': '' }, r.installatore || '—')),
    td([el('span', { 'data-no-t': '' }, r.titolo), r.urgente ? [' ', pillola('Bloccante', 'sospeso')] : null, r.segnalata ? [' ', pillola('segnalata', 'in_attesa')] : null]),
    td(el('a', { class: 'bottone piccolo', href: `/area#assistenza/${r.id}` }, t('Apri il filo')))))));
}

function contestazioni() {
  const l = A.contestazioni || [];
  if (!l.length) { $('#lista-contestazioni').replaceChildren(vuoto('Nessuna segnalazione', 'Quando un cliente segnala un problema, compare qui con le quote ferme.')); return; }
  $('#lista-contestazioni').replaceChildren(el('div', { class: 'lista-carte' }, ...l.map(k => {
    const aperta = k.stato === 'aperta', metodo = k.metodo || (k.crypto ? 'crypto' : 'carta'), bonifico = metodo === 'bonifico';
    const nota = el('input', { type: 'text', class: 'campo-nota', placeholder: t('Nota per il cliente (facoltativa)'), maxlength: '1000' });
    const importo = el('input', { type: 'number', class: 'campo-importo', min: k.escrow ? '0' : '0.01', step: '0.01', value: ((k.escrow ? k.euro_ordine : k.pagato) / 100).toFixed(2),
      max: !k.escrow && k.pagato > 0 ? (k.pagato / 100).toFixed(2) : null, 'aria-label': t('Importo da rimborsare in euro') });
    // in escrow: congelare sul contratto (finché è trattenuto), poi decidere lì quanto torna al cliente e a carico di chi
    const escrowRiga = k.escrow ? el('p', { class: 'tenue piccolo' }, t('Escrow sul contratto:'), ' ', pillola(CUSTODIE[k.custodia] || k.custodia || '—', classeCustodia(k.custodia)),
      k.custodia === 'trattenuto' && k.sblocco ? [' · ', t('si sblocca da solo il {data}', { data: dataOra(k.sblocco) })] : null,
      k.congelato ? [' · ', t('congelato il {data}', { data: dataOra(k.congelato) })] : null, k.in_escrow ? [' · ', t('nel contratto {importo}', { importo: euro(k.in_escrow) })] : null) : null;
    const carico = el('select', { class: 'campo-carico', 'aria-label': t('A carico di chi') }, el('option', { value: 'tutti' }, t('a carico di tutti, in proporzione')),
      el('option', { value: 'installatore' }, t('a carico di chi installa')), el('option', { value: 'builder' }, t('a carico di chi ha costruito')));
    const congela = b => occupato(b, async () => {
      const r = await azioneEscrow(k.ordine, 'contesta', { soloDa: 'arbitro', dire: x => avviso(x) });
      avviso(r.lenta ? 'Transazione inviata: aggiorniamo appena la rete conferma.' : 'Pagamento congelato sul contratto'); await carica();
    });
    const decidiEscrow = b => occupato(b, async () => {
      const cent = Math.round(Number(importo.value) * 100);
      const piano = await chiama('POST', '/api/admin/escrow/risolvi', { codice: k.ordine, rimborso: cent, carico: carico.value, nota: nota.value });
      const righe = piano.parti.map(x => `${t(x.ruolo)} ${euro(x.euro)}`).join(' · ');
      if (!(await conferma(t('Decidere sul contratto: {rimborso} tornano al cliente; a chi ha lavorato: {righe}. La transazione la firmi col wallet dell\'arbitro.', { rimborso: euro(cent), righe })))) return;
      const r = await azioneEscrow(k.ordine, 'risolvi', { dati: piano.data, soloDa: 'arbitro', dire: x => avviso(x) });
      avviso(r.lenta ? 'Transazione inviata: la segnalazione si chiude appena la rete conferma.' : 'Deciso sul contratto: segnalazione chiusa.'); await carica();
    });
    const decidi = (esito, b) => occupato(b, async () => {
      const cent = Math.round(Number(importo.value) * 100);
      if (esito === 'rimborso' && !(await conferma(bonifico
        ? t('Registrare il rimborso di {importo} al cliente? Il bonifico lo fa la piattaforma dal suo conto: qui resta scritto, Stripe non c\'entra.', { importo: euro(cent) })
        : t('Rimborsare {importo} al cliente? Le quote di builder e installatore vengono stornate.', { importo: euro(cent) })))) return;
      await chiama('POST', '/api/admin/contestazione', { id: k.id, esito, nota: nota.value, ...(esito === 'rimborso' ? { importo: cent } : {}) });
      avviso('Segnalazione chiusa'); await carica();
    });
    return el('article', { class: `carta contestazione${aperta ? ' da-fare' : ''}` },
      el('div', { class: 'riga-meta' }, pillola(aperta ? 'aperta' : (k.esito || 'chiusa'), aperta ? 'in_attesa' : k.esito === 'rimborso' ? 'annullata' : 'ok'),
        el('strong', { 'data-no-t': '' }, k.prodotto || '—'), el('span', { class: 'tenue piccolo' }, t('installato da'), ' ', k.installatore_codice ? el('a', { href: `/u/${k.installatore_codice}`, 'data-no-t': '' }, k.installatore) : (k.installatore || '—')),
        el('span', { class: 'tenue piccolo', 'data-no-t': '' }, dataOra(k.creata))),
      el('p', { class: 'tenue piccolo' }, el('span', { 'data-no-t': '' }, `${k.attivita || '—'} · ${k.email || ''}`), ' · ', t(metodo === 'crypto' ? 'pagato in crypto' : bonifico ? 'pagato con bonifico' : 'pagato con carta'), ' · ',
        t('pagato {importo}', { importo: euro(k.pagato) }), ' · ', t('ferme {importo}', { importo: euro(k.ferme) }), k.versate ? [' · ', t('già versate {importo}', { importo: euro(k.versate) })] : null,
        k.confermato ? [' · ', t('installazione confermata dal cliente')] : null),
      el('p', { class: 'testo-utente', 'data-no-t': '' }, k.testo), escrowRiga,
      aperta ? el('div', { class: 'azioni azioni-contestazione' }, nota,
        k.escrow && k.custodia === 'contestato' ? [importo, carico, bottone('Decidi sul contratto', 'pericolo', decidiEscrow), el('span', { class: 'tenue piccolo' }, t('0 € = tutto regolare: il pagamento va a chi ha lavorato'))]
          : [bottone('Tutto regolare: le quote ripartono', 'secondario', b => decidi('regolare', b)),
            k.escrow && k.custodia === 'trattenuto' ? bottone('Congela sul contratto', 'pericolo', congela)
              : metodo === 'crypto' ? el('span', { class: 'tenue piccolo' }, t('In crypto il rimborso lo fa l\'installatore dal suo wallet'))
                : [importo, bottone(bonifico ? 'Rimborso con bonifico, lo fa la piattaforma' : 'Rimborsa il cliente', 'pericolo', b => decidi('rimborso', b))],
            bottone('Ritirata dal cliente', 'fantasma', b => decidi('annullata', b))])
        : el('p', { class: 'tenue piccolo' }, t('Chiusa il {data}', { data: dataOra(k.chiusa) }), k.importo ? [' · ', t('rimborsati {importo}', { importo: euro(k.importo) })] : null, k.nota ? [' · ', el('span', { 'data-no-t': '' }, k.nota)] : null));
  })));
}

// ---------------- versamenti ----------------
function versamenti() {
  const n = A.numeri, nomi = new Map(A.utenti.map(u => [u.id, u.nome]));
  const spia = () => el('i', { class: 'spia', 'aria-hidden': 'true' });
  $('#numeri-soldi').replaceChildren(
    el('div', { class: 'strumento soldi' }, el('span', { class: 'etichetta' }, t('Quote in attesa')), el('span', { class: 'numero' }, euro(n.inAttesa)), spia()),
    n.inEscrow ? el('div', { class: 'strumento soldi' }, el('span', { class: 'etichetta' }, t('In escrow')), el('span', { class: 'numero' }, euro(n.inEscrow)), spia()) : null,
    el('div', { class: 'strumento soldi' }, el('span', { class: 'etichetta' }, t('Versato nel mese')), el('span', { class: 'numero' }, euro(n.versatoMese)), spia()),
    el('div', { class: `strumento${A.errori.length ? ' guaio' : ''}` }, el('span', { class: 'etichetta' }, t('Versamenti con errori')), el('span', { class: 'numero' }, String(A.errori.length)), spia()));
  if (!A.errori.length) { $('#errori').replaceChildren(vuoto('Nessun errore', 'Tutti i versamenti tentati sono andati a buon fine.')); return; }
  $('#errori').replaceChildren(tabella(['Quota', 'Chi la riceve', '#Importo', 'Errore'], A.errori.map(e => el('tr', {},
    td(`#${e.id}`, 'mono'), td(el('span', { 'data-no-t': '' }, nomi.get(e.beneficiario) || `#${e.beneficiario}`)), td(euro(e.importo), 'num'),
    td(el('span', { class: 'errore-versamento mono', 'data-no-t': '' }, e.errore))))));
}
$('#versa').addEventListener('click', e => {
  const msg = $('#msg-versa');
  occupato(e.currentTarget, async () => {
    const r = await chiama('POST', '/api/admin/versa', {});
    msg.className = 'messaggio bene';
    msg.textContent = r.versate === 1 ? t('Versata 1 quota.') : r.versate ? t('Versate {n} quote.', { n: r.versate }) : t('Nessuna quota pronta da versare adesso.');
    await carica();
  }, msg);
});

// ---------------- pagamenti diretti: bonifici e carta dal POS della banca ----------------
// gli ordini (da segnare ricevuti a mano o dall'estratto conto; quelli con carta li registra la banca), le quote di chi sviluppa da
// versare a mano dopo un pagamento arrivato sul conto della piattaforma
function bonifici() {
  if (!B) { $('#bonifici').replaceChildren(vuoto('Non riesco a leggere i pagamenti diretti', 'Ricarica la pagina.')); $('#manuali').replaceChildren(); return; }
  $('#bonifici-conto').textContent = !B.attivo
    ? t('I pagamenti diretti sono spenti: scrivi BONIFICO_IBAN e BONIFICO_INTESTATARIO nel file .env (e, per la carta, POS_ALIAS e POS_CHIAVE che ti dà la banca), poi riavvia.')
    : [B.metodi.bonifico ? t('Bonifici su {iban}, intestato a {nome}.', { iban: B.iban, nome: B.intestatario }) : null,
      B.metodi.carta ? (B.pos?.prova ? t('Carta dal POS virtuale della banca, in modalità di prova.') : t('Carta dal POS virtuale della banca.')) : null,
      t('L\'assistenza si paga in anticipo per {mesi} mesi; un ordine vale {giorni} giorni.', { mesi: B.mesi, giorni: B.giorni })].filter(Boolean).join(' ');
  const azioni = o => ['aperto', 'scaduto'].includes(o.stato) ? el('span', { class: 'pila-stretta' },
    bottone(o.metodo === 'carta' ? 'Segna pagato' : 'Ricevuto', 'secondario', async b => {
      if (!await conferma(t('Segnare pagato {causale}?', { causale: o.causale }), t('{euro} da {chi}: controlla prima che sia arrivato sul conto. Il cliente riceve la conferma e il link alla sua assistenza.', { euro: euro(o.euro), chi: o.nome || o.email }), { si: 'Sì, è arrivato' })) return;
      await occupato(b, async () => { await chiama('POST', '/api/admin/bonifico/conferma', { codice: o.codice }); avviso('Registrato'); await carica(); });
    }),
    bottone('Annulla', 'fantasma', async b => {
      if (!await conferma(t('Annullare {causale}?', { causale: o.causale }), 'L\'ordine non si potrà più pagare. Se il cliente ha già pagato, dovrai rimborsarlo tu.', { si: 'Annulla l\'ordine', no: 'Lascia', pericolo: true })) return;
      await occupato(b, async () => { await chiama('POST', '/api/admin/bonifico/annulla', { codice: o.codice }); await carica(); });
    })) : el('span', { class: 'tenue' }, o.pagato ? dataOra(o.pagato) : '—');
  $('#bonifici').replaceChildren(B.ordini.length ? tabella(['Data', 'Causale', 'Metodo', 'Prodotto', 'Cliente', '#Importo', 'Stato', ''], B.ordini.map(o => el('tr', {},
    td(dataOra(o.creato)), td(el('span', { class: 'mono', 'data-no-t': '' }, o.causale)), td(t(o.metodo === 'carta' ? 'carta' : 'bonifico')),
    td([el('span', { 'data-no-t': '' }, o.prodotto), o.rinnovo ? [' ', pillola('rinnovo', 'in_attesa')] : null]),
    td(el('span', { class: 'pila-stretta' }, o.nome ? el('span', { 'data-no-t': '' }, o.nome) : null, el('span', { class: 'tenue piccolo', 'data-no-t': '' }, o.email))),
    td(euro(o.euro), 'num'),
    td(el('span', { class: 'pila-stretta' }, pillola(o.stato, { aperto: 'in_attesa', scaduto: 'in_attesa', pagato: 'ok', annullato: 'annullata' }[o.stato]), o.nota ? el('span', { class: 'tenue piccolo', 'data-no-t': '' }, o.nota) : null)),
    td(azioni(o)))))
    : vuoto('Ancora nessun ordine', 'Quando un business sceglie di pagare con carta o bonifico, l\'ordine compare qui.'));
  $('#manuali').replaceChildren(B.manuali.length ? tabella(['Quota', 'A chi', 'Prodotto', '#Importo', ''], B.manuali.map(q => el('tr', {},
    td(`#${q.id}`, 'mono'), td(el('span', { class: 'pila-stretta' }, el('span', { 'data-no-t': '' }, q.nome), el('span', { class: 'tenue piccolo', 'data-no-t': '' }, q.email || ''))),
    td(el('span', { 'data-no-t': '' }, q.prodotto || '')), td(euro(q.importo), 'num'),
    td(bottone('Segna versata', 'secondario', async b => {
      if (!await conferma(t('Hai versato {euro} a {nome}?', { euro: euro(q.importo), nome: q.nome }), 'Segnala solo dopo il bonifico dalla tua banca: riceve l\'avviso che è arrivata.', { si: 'Sì, versata' })) return;
      await occupato(b, async () => { await chiama('POST', '/api/admin/quota/versata', { id: q.id }); avviso('Segnata versata'); await carica(); });
    })))))
    : vuoto('Niente da versare a mano', 'Le parti di chi sviluppa sugli acquisti pagati sul tuo conto compaiono qui.'));
}
// l'estratto conto: incollato o dal CSV della banca; prima l'anteprima di cosa torna, poi la conferma
$('#estratto-file').addEventListener('change', async e => { const f = e.currentTarget.files?.[0]; if (f) $('#estratto').value = await f.text(); });
$('#estratto-cerca').addEventListener('click', e => {
  const msg = $('#msg-estratto'), testo = $('#estratto').value;
  if (!testo.trim()) { msg.className = 'messaggio'; msg.textContent = t('Incolla prima i movimenti, o carica il CSV'); return; }
  occupato(e.currentTarget, async () => {
    const r = await chiama('POST', '/api/admin/bonifico/estratto', { testo });
    const riga = (x, ok) => el('tr', {}, td(el('span', { class: 'mono', 'data-no-t': '' }, x.causale)), td(euro(x.euro), 'num'),
      td(ok ? pillola('torna', 'ok') : pillola(x.importi.length ? t('arrivati {euro}', { euro: x.importi.map(euro).join(', ') }) : 'importo non trovato', 'in_attesa')),
      td(el('span', { class: 'tenue piccolo', 'data-no-t': '' }, x.riga)));
    const applica = r.abbinati.length ? el('button', { class: 'bottone', type: 'button' }, t(r.abbinati.length === 1 ? 'Segna pagato 1 ordine' : 'Segna pagati {n} ordini', { n: r.abbinati.length })) : null;
    applica?.addEventListener('click', () => occupato(applica, async () => {
      const x = await chiama('POST', '/api/admin/bonifico/estratto', { testo, applica: true });
      msg.className = 'messaggio bene'; msg.textContent = x.registrati === 1 ? t('Registrato 1 pagamento.') : t('Registrati {n} pagamenti.', { n: x.registrati });
      $('#estratto-esito').replaceChildren(); $('#estratto').value = ''; await carica();
    }, msg));
    msg.className = 'messaggio'; msg.textContent = r.abbinati.length || r.diversi.length ? '' : t('Nessuna causale di un ordine aperto in questi movimenti.');
    $('#estratto-esito').replaceChildren(...(r.abbinati.length || r.diversi.length ? [tabella(['Causale', '#Ordine', 'Esito', 'Riga'], [...r.abbinati.map(x => riga(x, true)), ...r.diversi.map(x => riga(x, false))]),
      r.diversi.length ? el('p', { class: 'piccolo tenue' }, t('Quelli con l\'importo diverso non li segno da solo: controlla e, se va bene, usa «Ricevuto» nella tabella degli ordini.')) : null, applica].filter(Boolean) : []));
  }, msg);
});

// ---------------- ordini crypto ----------------
function ordini() {
  const l = A.ordini;
  if (!l.length) { $('#ordini').replaceChildren(vuoto('Ancora nessun ordine in crypto', 'Quando un business sceglie di pagare in crypto, l\'ordine compare qui.')); return; }
  $('#ordini').replaceChildren(tabella(['Data', 'Ordine', 'Prodotto', 'Installatore', 'Rete', '#Euro', 'Stato', 'Escrow', 'Pagatore', 'Transazione'], l.map(o => {
    let tx = o.tx; try { const x = JSON.parse(o.tx); if (Array.isArray(x)) tx = x[0]; } catch { }
    const sbloccabile = o.custodia === 'trattenuto' && o.sblocco && Date.now() >= new Date(o.sblocco).getTime();
    return el('tr', {},
      td(dataOra(o.creato)), td(el('span', { class: 'mono', 'data-no-t': '' }, o.codice)), td(el('span', { 'data-no-t': '' }, o.prodotto)), td(el('span', { 'data-no-t': '' }, o.installatore)),
      td(`${o.rete} · ${o.simbolo}`), td(euro(o.euro), 'num'), td(pillola(o.stato)),
      td(o.escrow ? el('span', { class: 'pila-stretta' }, pillola(CUSTODIE[o.custodia] || o.custodia || '—', classeCustodia(o.custodia)),
        sbloccabile ? bottone('Rilascia', 'secondario piccolo', b => occupato(b, async () => { await azioneEscrow(o.codice, 'rilascia', { dire: x => avviso(x) }); avviso('Sbloccato'); await carica(); })) : null) : el('span', { class: 'tenue' }, '—')),
      td(o.pagatore ? el('span', { class: 'mono', title: o.pagatore, 'data-no-t': '' }, corto(o.pagatore)) : el('span', { class: 'tenue' }, '—')),
      td(tx ? el('span', { class: 'mono', title: String(tx), 'data-no-t': '' }, corto(tx)) : el('span', { class: 'tenue' }, '—')));
  })));
}

// ---------------- DAC7 ----------------
{
  const ora = new Date().getFullYear(), scelta = $('#anno-dac7');
  for (let a = ora; a >= Math.min(2024, ora - 1); a--) scelta.append(el('option', { value: String(a) }, a === ora ? t('{anno} (in corso)', { anno: a }) : String(a)));
  scelta.value = String(ora - 1);
  const aggiorna = () => { const a = scelta.value; $('#scarica-dac7').href = `/api/admin/dac7?anno=${a}`; $('#scarica-dac7').textContent = t('Scarica il file {anno}', { anno: a }); };
  scelta.addEventListener('change', aggiorna); aggiorna();
}

$('#riprova').addEventListener('click', e => occupato(e.currentTarget, async () => { $('#guasto').classList.add('nascosto'); $('#stato-pannello').classList.remove('nascosto'); await carica(); }));
mostra(location.hash.slice(1));
// prima chi sei: chi non gestisce la piattaforma non chiede nemmeno i dati
const sessione = await chiama('GET', '/api/sessione').catch(() => null);
if (sessione && !sessione.admin) {
  $('#stato-pannello').classList.add('nascosto'); $('#vietato').classList.remove('nascosto');
  if (sessione.dentro) {
    $('#vietato p').textContent = t('Il tuo conto non ha accesso al pannello.');
    const b = $('#vietato a'); b.href = '/area'; b.textContent = t('Vai alla tua area');
  }
} else { mio = await chiama('GET', '/api/io').catch(() => null); carica(); }
