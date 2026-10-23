// La pagina di un prodotto (/p/<slug>): la testata (chi l'ha costruito, licenza, stelle, versioni, voto), la colonna d'acquisto
// (prezzo, divisione, scelta dell'installatore, carta, crypto, preventivo nel prelancio, domanda all'installatore) e il contenuto
// (README, idee di applicazione, come funziona l'installazione, la guida d'installazione interattiva, versioni, recensioni, «offri
// questo prodotto», badge per il README).
import { $, $$, chiama, el, t, pronta, euro, percento, data, conta, avviso, occupato, copia, dati, stelle, avatar, conferma } from './comune.js';
import { pannelloCrypto } from './prodotto-crypto.js';
import { pannelloBonifico } from './prodotto-bonifico.js';
await pronta;

const slug = location.pathname.split('/').filter(Boolean).pop() || '';
const ref = new URLSearchParams(location.search).get('ref') || '';
let p = null, sessione = { dentro: false, nome: '' }, scelto = null, crypto = null, bonifico = null, periodo = 'mese', conAgg = false;
// il rinnovo dell'assistenza (dalla pagina di assistenza o dall'area del cliente): ?rinnovo=<codice dell'installazione>
const codiceRinnovo = new URLSearchParams(location.search).get('rinnovo') || '';
// un ordine con bonifico già fatto (dall'email, o ricaricando la pagina): ?bonifico=<codice dell'ordine>
const codiceBonifico = new URLSearchParams(location.search).get('bonifico') || '';
let rinnovo = null;
const cambi = new Set();   // chi vuole sapere quando cambia l'installatore scelto
const installatore = () => p?.installatori.find(i => i.codice === scelto) || null;
const vedi = (sel, si) => $(sel).classList.toggle('nascosto', !si);
const metti = (nodo, ...figli) => nodo.replaceChildren(...figli.flat().filter(x => x !== null && x !== undefined && x !== false));

async function carica() {
  vedi('#carico', true); vedi('#guasto', false);
  try {
    [p, sessione] = await Promise.all([
      chiama('GET', `/api/prodotto?slug=${encodeURIComponent(slug)}${ref ? `&ref=${encodeURIComponent(ref)}` : ''}`),
      chiama('GET', '/api/sessione').catch(() => ({ dentro: false, nome: '' })),
    ]);
    if (codiceRinnovo) rinnovo = await chiama('GET', `/api/assistenza?k=${encodeURIComponent(codiceRinnovo)}`).catch(() => null);
  } catch (e) {
    vedi('#carico', false);
    if (e.stato === 404) { vedi('#manca', true); document.title = `${t('Prodotto non trovato')} · ${sessione.nome || document.title.split('·').pop().trim()}`; return; }
    $('#guasto-testo').textContent = e.message; vedi('#guasto', true); return;
  }
  disegna();
  vedi('#carico', false); vedi('#pagina', true);
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}
$('#riprova').addEventListener('click', carica);
// tornando indietro da Stripe o dal wallet la pagina può riaprirsi dalla cache con un bottone ancora in attesa: si ricarica
addEventListener('pageshow', e => { if (e.persisted) location.reload(); });

function disegna() {
  document.title = `${p.nome} · ${sessione.nome || document.title.split('·').pop().trim()}`;
  $('meta[name=description]')?.setAttribute('content', p.descrizione || t('{nome}: installato nella tua attività da un professionista della tua zona.', { nome: p.nome }));
  const prima = scelto && p.installatori.some(i => i.codice === scelto) ? scelto : null;   // dopo un ricaricamento resta la scelta di prima
  scelto = prima || p.scelto || (p.installatori.length === 1 ? p.installatori[0].codice : null);
  testa(); avvisiTesta(); acquisto(); contenuto(); idee(); installa(); numeriSezioni(); tua(); badge();
  guardaImmagini($('#pagina'));
}

// ---------------- la testata ----------------
const GITHUB = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';
const icona = s => document.importNode(new DOMParser().parseFromString(s, 'image/svg+xml').documentElement, true);
const fuori = (href, ...figli) => el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, ...figli);
const nomeCategoria = c => t({ crm: 'CRM', ecommerce: 'E-commerce' }[c] || c.charAt(0).toUpperCase() + c.slice(1));
const nomeAttivita = a => t(a.charAt(0).toUpperCase() + a.slice(1));

const codiceProdotto = () => `RB-PRD-${String(p.id).padStart(4, '0')}`;
const numero = n => Number(n || 0).toLocaleString(document.documentElement.lang === 'en' ? 'en-IE' : 'it-IT');
const ruolo = (testo, classe) => el('span', { class: `pp-ruolo ${classe}` }, t(testo));
// le immagini 3D che non ci sono (ancora): resta il segnaposto della cornice
function guardaImmagini(radice = document) {
  for (const i of $$('.pp-figura img', radice)) {
    const guarda = () => i.closest('.pp-figura')?.classList.toggle('manca', !i.naturalWidth);   // si ascolta sempre: «complete» può valere true prima che la richiesta parta
    i.addEventListener('load', guarda); i.addEventListener('error', guarda); if (i.complete) guarda();
  }
}
guardaImmagini();

function testa() {
  $('#nome').textContent = p.nome;
  $('#descrizione').textContent = p.descrizione || '';
  $('#codice').textContent = codiceProdotto();
  $('#foglio-codice').textContent = `${codiceProdotto()} · ${p.repo}`;
  const cat = $('#cat-link'); cat.textContent = nomeCategoria(p.categoria || 'altro'); cat.href = `/esplora?categoria=${encodeURIComponent(p.categoria || '')}`;
  $('#targa-cat').textContent = nomeCategoria(p.categoria || 'altro');
  // consigliato per quali attività: i chip, con il link al catalogo filtrato per quell'attività
  const att = p.attivita || []; vedi('#consigliato', att.length > 0);
  if (att.length) $('#attivita-chip').replaceChildren(...att.map(a => el('a', { class: 'chip-attivita', href: `/esplora?attivita=${encodeURIComponent(a)}` }, nomeAttivita(a))));
  $('#targa-rev').textContent = p.versione ? `REV ${p.versione}` : '';
  const v = p.versioni[0], versioneUrl = v?.url || `${p.url}/releases`;
  // gli adesivi attaccati alla targhetta: licenza, stelle su GitHub, versione
  metti($('#adesivi'),
    // il nome della licenza letta a mano (l'identificativo SPDX «LicenseRef-…» è per le macchine); i nomi lunghi in piccolo
    p.licenza ? el('span', { class: `pp-adesivo licenza${(p.licenza_nome || p.licenza).length > 14 ? ' lunga' : ''}`, title: t('Licenza') }, el('small', {}, t('Licenza')), el('b', { 'data-no-t': '' }, p.licenza_nome || p.licenza)) : null,
    fuori(p.url, el('span', { class: 'pp-stella', 'aria-hidden': 'true' }, '★'), el('b', {}, numero(p.stelle)), el('small', {}, t('stelle su GitHub'))),
    p.versione ? fuori(versioneUrl, el('small', {}, t('versione')), el('b', { 'data-no-t': '' }, p.versione)) : null);
  const [ad1, ad2] = $$('#adesivi a'); ad1?.classList.add('pp-adesivo', 'stelle-gh'); ad2?.classList.add('pp-adesivo', 'versione'); if ((p.versione || '').length > 12) ad2?.classList.add('lunga');   // tag come stable/jitsi-meet_11248
  metti($('#meta'),
    fuori(p.url, icona(GITHUB), el('span', { class: 'mono', 'data-no-t': '' }, p.repo)),
    p.sito ? fuori(p.sito, t('Sito')) : null,
    p.demo ? fuori(p.demo, t('Prova la demo')) : null);
  for (const a of $$('#meta a[target]')) a.classList.add('chip');

  const builder = el('div', { class: 'pp-chi ruolo-builder' }, el('span', { class: 'etichetta' }, t('Costruito da')),
    el('div', { class: 'pp-chi-riga' }, avatar({ nome: p.builder, avatar: p.avatar }),
      el('div', { class: 'pp-chi-nome' }, el('strong', { 'data-no-t': '' }, p.builder),
        p.github ? fuori(`https://github.com/${p.github}`, el('span', { class: 'mono', 'data-no-t': '' }, `@${p.github}`)) : null)),
    ruolo('Builder', 'builder'));
  const coll = p.collaboratori.length ? el('div', { class: 'pp-chi ruolo-builder' }, el('span', { class: 'etichetta' }, t('Lo mantengono anche')),
    el('div', { class: 'pp-chi-riga' },
      el('div', { class: 'pp-pila' }, ...p.collaboratori.slice(0, 5).map(l => el('img', { class: 'avatar', src: `https://avatars.githubusercontent.com/${encodeURIComponent(l)}?s=64`, alt: '', loading: 'lazy', onerror: e => e.currentTarget.replaceWith(avatar({ nome: l })) }))),
      el('div', { class: 'pp-chi-nome' }, ...p.collaboratori.map((l, i) => [i ? ' ' : '', fuori(`https://github.com/${l}`, el('span', { class: 'mono', 'data-no-t': '' }, `@${l}`))]))),
    ruolo('Collaboratore', 'builder')) : null;
  // gli owner del repository: con più di uno, la parte di ognuno (dai commit); chi ha admin o maintain su GitHub entra da qui
  // gli owner: con più di uno una colonna con le parti; con uno solo (chi l'ha rivendicato) basta una riga sotto il builder per entrare
  const unoSolo = !p.rivendicabile && p.owner?.length === 1;
  const owner = !p.rivendicabile && p.owner?.length ? (() => {
    const msg = el('div', { class: 'messaggio', role: 'alert' });
    // chi è già fra gli owner (e non l'ha rivendicato lui) può uscirne: dai pagamenti dopo non riceve più la sua parte
    const esci = () => el('button', { class: 'bottone piccolo fantasma', type: 'button', onclick: async e => {
      const b = e.currentTarget;
      if (!await conferma(t('Uscire dagli owner di {nome}?', { nome: p.nome }), 'Dai prossimi pagamenti non ricevi più la tua parte. Quelle già maturate restano tue.', { si: 'Esci', pericolo: true })) return;
      occupato(b, async () => { await chiama('POST', '/api/owner/esci', { prodotto: p.id }); avviso(t('Non sei più fra gli owner di questo progetto.')); setTimeout(carica, 1200); }, msg);
    } }, t('Esci dagli owner'));
    const entra = p.sonoOwner ? (p.mio ? null : esci()) : sessione.dentro
      ? el('button', { class: 'bottone piccolo secondario', type: 'button', onclick: e => occupato(e.currentTarget, async () => {
        // senza GitHub (o con la sessione GitHub scaduta) si passa da GitHub e si torna qui
        try { await chiama('POST', '/api/owner/entra', { prodotto: p.id }); }
        catch (err) { if (err.stato === 401) { location.assign(`/auth/github?dopo=${encodeURIComponent(location.pathname)}`); return; } throw err; }
        avviso(t('Sei fra gli owner: dai prossimi pagamenti ricevi la tua parte, in base ai commit.')); setTimeout(carica, 1200);
      }, msg) }, icona(GITHUB), t('Sono admin o maintainer'))
      : el('a', { class: 'bottone piccolo secondario', href: `/accedi?dopo=${encodeURIComponent(location.pathname)}` }, icona(GITHUB), t('Sono admin o maintainer'));
    if (unoSolo) { if (entra) entra.classList.replace('secondario', 'fantasma'); return entra ? el('div', { class: 'pp-owner-riga' }, entra, msg) : null; }
    return el('div', { class: 'pp-chi ruolo-builder pp-owner' }, el('span', { class: 'etichetta' }, p.owner.length > 1 ? t('Owner del repository') : t('Altri owner del repository?')),
      p.owner.length > 1 ? el('div', { class: 'pp-chi-nome' }, ...p.owner.map((o, i) => [i ? ' · ' : '',
        o.github ? fuori(`https://github.com/${o.github}`, el('span', { class: 'mono', 'data-no-t': '' }, `@${o.github}`)) : el('span', { 'data-no-t': '' }, o.nome),
        ' ', el('span', { class: 'tenue', title: o.commit != null ? t('{n} commit', { n: o.commit }) : '' }, percento(o.quota))]))
        : el('p', { class: 'piccolo tenue' }, t('Chi ha il permesso admin o maintain su GitHub entra fra gli owner e si divide la parte di chi sviluppa, in base ai commit.')),
      entra, msg);
  })() : null;
  const inst = el('a', { class: 'pp-chi ruolo-installatore', href: '#acquisto' }, el('span', { class: 'etichetta' }, t('Lo installano')),
    el('div', { class: 'pp-chi-riga' }, el('span', { class: 'pp-num' }, String(p.installatori.length)),
      el('span', { class: 'pp-chi-nome' }, p.installatori.length === 1 ? t('installatore') : t('installatori'))),
    ruolo('Installatore', 'installatore'));
  const voto = el('a', { class: 'pp-chi pp-voto', href: '#recensioni' }, el('span', { class: 'etichetta' }, t('Voto delle attività')),
    p.recensioni_n ? el('div', { class: 'pp-chi-riga' }, el('span', { class: 'pp-num' }, String(p.voto).replace('.', document.documentElement.lang === 'en' ? '.' : ',')),
      el('span', { class: 'pp-chi-nome' }, stelle(p.voto), el('span', { class: 'tenue' }, conta(p.recensioni_n, 'recensione', 'recensioni'))))
      : el('div', { class: 'pp-chi-riga' }, el('span', { class: 'tenue' }, t('Ancora nessuna recensione'))));
  if (unoSolo && owner) { builder.append(owner); metti($('#persone'), builder, coll, inst, voto); }
  else metti($('#persone'), builder, owner, coll, inst, voto);
}

function avvisiTesta() {
  const box = $('#avvisi-testa'); box.replaceChildren();
  if (p.stato !== 'pubblicato') box.append(el('div', { class: 'avviso attesa' }, t('Anteprima: questo prodotto è «{stato}» e non si vede ancora nel catalogo.', { stato: t(p.stato) })));
  if (p.rivendicabile) {
    const testo = p.rivendicabile.importo > 0
      ? t('Progetto non ancora rivendicato dal suo maintainer: sei tu? Entra con GitHub e rivendicalo ({importo} in attesa).', { importo: euro(p.rivendicabile.importo) })
      : t('Progetto non ancora rivendicato dal suo maintainer: sei tu? Entra con GitHub e rivendicalo.');
    const msg = el('div', { class: 'messaggio' });
    const azione = el('a', { class: 'bottone piccolo', href: `/accedi?rivendica=1&dopo=${encodeURIComponent(location.pathname)}` }, icona(GITHUB), t('Entra con GitHub'));
    const banner = el('div', { class: 'avviso pp-rivendica', role: 'note' }, el('div', { class: 'pp-rivendica-testo' }, el('strong', {}, t('Sei il maintainer?')), el('p', {}, testo), msg), azione);
    box.append(banner);
    if (sessione.dentro) chiama('GET', '/api/io').then(io => {   // con GitHub collegato si rivendica da qui
      if (!io.githubAttivo) return;
      const b = el('button', { class: 'bottone piccolo', type: 'button' }, icona(GITHUB), t('Rivendicalo'));
      b.addEventListener('click', () => occupato(b, async () => {
        const r = await chiama('POST', '/api/rivendica', { prodotto: p.id });
        banner.replaceWith(el('div', { class: 'avviso ok' }, r.importo > 0 ? t('Fatto: il progetto è tuo, e anche i {importo} in attesa.', { importo: euro(r.importo) }) : t('Fatto: il progetto è tuo. Lo trovi nella tua area.')));
        setTimeout(carica, 1600);
      }, msg));
      azione.replaceWith(b);
    }).catch(() => {});
  }
  // la licenza letta a mano: cosa vuol dire per chi compra (uso interno: si paga il servizio, non il software); la piattaforma di base
  if (p.licenza_nota) box.append(el('div', { class: `avviso ${p.licenza_tipo === 'interna' ? 'attesa' : ''} pp-licenza`, role: 'note' },
    el('div', {}, el('strong', {}, p.licenza_tipo === 'interna' ? t('Licenza d\'uso interno: {nome}', { nome: p.licenza_nome || p.licenza }) : t('Licenza: {nome}', { nome: p.licenza_nome || p.licenza })),
      el('p', { 'data-no-t': '' }, p.licenza_nota),
      p.licenza_tipo === 'interna' ? el('p', { class: 'piccolo' }, t('Qui paghi l\'installazione e l\'assistenza, non il software: resta installato sul server della tua attività.')) : null,
      p.licenza_fonte ? el('a', { class: 'piccolo', href: p.licenza_fonte, target: '_blank', rel: 'noopener' }, t('Leggi la licenza')) : null)));
  // i controlli di sicurezza sull'ultima release: l'esito, il punteggio OpenSSF Scorecard, cosa hanno visto antivirus e Trivy
  if (p.sicurezza) {
    const s = p.sicurezza, ESITI = { ok: ['ok', 'Controlli di sicurezza: nessun problema'], attenzione: ['attesa', 'Controlli di sicurezza: qualcosa da guardare'],
      grave: ['errore', 'Controlli di sicurezza: un problema grave, la release è ferma'], non_disponibile: ['', 'Controlli di sicurezza: dati non ancora disponibili'] };
    const [classe, titolo] = ESITI[s.esito] || ESITI.non_disponibile;
    box.append(el('details', { class: `avviso ${classe} pp-sicurezza` },
      el('summary', {}, el('strong', {}, t(titolo)), s.punteggio != null ? ` · ${t('OpenSSF {p}/10', { p: Number(s.punteggio).toFixed(1) })}` : '', s.versione ? ` · ${s.versione}` : '', ` · ${data(s.quando)}`),
      el('ul', {}, ...s.dettagli.map(d => el('li', { 'data-no-t': '' }, d.testo))),
      el('p', { class: 'piccolo' }, t('Ogni release nuova viene controllata prima di dire a chi installa di aggiornare: punteggio pubblico OpenSSF Scorecard, antivirus e componenti con vulnerabilità note.'))));
  }
  if (p.base_nome && p.base_url) box.append(el('div', { class: 'avviso pp-base', role: 'note' },
    el('p', {}, el('strong', {}, t('Funziona con')), ' ', el('a', { href: p.base_url, target: '_blank', rel: 'noopener', 'data-no-t': '' }, p.base_nome), '. ',
      t('Chi installa mette anche quello, se non c\'è già.'))));
}

// ---------------- la colonna d'acquisto ----------------
function acquisto() {
  const a = $('#acquisto'); cambi.clear(); crypto = null; bonifico = null;
  if (rinnovo) return acquistoRinnovo(a);
  // il prezzo dell'installazione lo decide chi vende: quello di chi è scelto, altrimenti il più basso («da … €»)
  const prezzoDi = () => installatore()?.prezzo_avvio ?? p.prezzi?.da ?? 0, avvio = () => prezzoDi() > 0, piattaforma = sessione.nome || 'Repobay';
  // come si divide il pagamento: dipende da chi vende (la percentuale di chi sviluppa, il livello di chi vende, o il loro accordo);
  // il canone dell'assistenza, tolto Stripe, va per il 60% a chi ha installato (che risponde per primo) e per il 40% alla piattaforma
  const disegnoDivisione = () => {
    if (!p.installatori.length) return el('div', { class: 'pp-divisione-box nascosto' });
    const dv = installatore()?.divisione || p.divisione, d = avvio() ? dv.avvio : dv.mese, dm = dv.mese, tot = d.builder + d.installatore + d.piattaforma || 1;
    // con carta il costo di Stripe (stimato) si toglie prima: è a parte, a righe
    const parti = [['b', d.builder, 'A chi l\'ha costruito'], ['i', d.installatore, 'A chi lo installa'], ['p', d.piattaforma - (d.costo || 0), 'Alla piattaforma'],
      ['c', d.costo || 0, 'Costo della carta (Stripe, stima)']];
    const larga = (nodo, v) => { nodo.style.setProperty('width', `${(v / tot) * 100}%`); return nodo; };
    // le quote di disegno sopra la barra: |←— 80% —→|←— 20% —→|
    const quote = el('div', { class: 'pp-quote', 'aria-hidden': 'true' }, ...parti.filter(([, v]) => v > 0).map(([c, v]) => larga(el('span', { class: `pp-quota ${c}` }, el('i', {}, percento(v / tot))), v)));
    const barra = el('div', { class: 'barra-quote', role: 'img', 'aria-label': t('Come si divide il pagamento') }, ...parti.map(([c, v]) => larga(el('span', { class: c }), v)));
    const legenda = el('ul', { class: 'pp-legenda' }, ...parti.filter(([, v]) => v > 0).map(([c, v, x]) => el('li', {}, el('i', { class: c }), el('span', {}, t(x)), el('b', {}, euro(v)))));
    return el('div', { class: 'pp-divisione-box' }, el('div', { class: 'pp-divisione' }, quote, barra, legenda),
      avvio() && p.prezzo_mese ? el('p', { class: 'aiuto pp-mese' }, dm.builder + dm.installatore === 0 ? t('Ogni mese: l\'assistenza la dà {nome}, e il canone va alla piattaforma.', { nome: piattaforma })
        : dm.installatore === 0 ? t('Ogni mese: {b} a chi l\'ha costruito e {p} a {nome}, che dà l\'assistenza.', { b: euro(dm.builder), p: euro(dm.piattaforma), nome: piattaforma })
        : dm.builder > 0 ? t('Ogni mese: {b} a chi l\'ha costruito, {i} a chi lo installa, {p} alla piattaforma.', { b: euro(dm.builder), i: euro(dm.installatore), p: euro(dm.piattaforma) })
        : t('Ogni mese: {i} a chi lo installa, {p} alla piattaforma.', { i: euro(dm.installatore), p: euro(dm.piattaforma) })) : null);
  };
  let divisione = disegnoDivisione();
  cambi.add(() => { const n = disegnoDivisione(); divisione.replaceWith(n); divisione = n; });
  // il prezzo: di chi è scelto, o la fascia fra chi lo vende; poi il canone dell'assistenza
  const disegnoPrezzo = () => {
    const i = installatore(), fascia = !i && p.prezzi?.da != null && p.prezzi.a > p.prezzi.da;
    if (!p.installatori.length) return el('div', { class: 'pp-prezzo-box' }, el('div', { class: 'prezzo pp-prezzo pp-prezzo-attesa' }, t('Il prezzo lo fa chi lo vende')),
      p.prezzo_mese ? el('p', { class: 'pp-poi' }, t('poi {euro} al mese di assistenza', { euro: euro(p.prezzo_mese) })) : null);
    return el('div', { class: 'pp-prezzo-box' },
      el('div', { class: 'prezzo pp-prezzo' }, fascia ? el('small', { class: 'pp-da' }, t('da')) : null, euro(avvio() ? prezzoDi() : p.prezzo_mese), el('small', {}, avvio() ? t(' una tantum') : t(' al mese'))),
      el('p', { class: 'pp-poi pp-di-chi' }, i ? t('Il prezzo di {nome}: ognuno decide il suo.', { nome: i.nome }) : fascia ? t('Ognuno di chi lo vende decide il suo prezzo: scegli qui sotto.') : t('Il prezzo lo decide chi lo vende.')),
      avvio() && p.prezzo_mese ? el('p', { class: 'pp-poi' }, p.assistenzaPiattaforma ? t('poi {euro} al mese di assistenza: risponde chi installa, con {nome} dietro', { euro: euro(p.prezzo_mese), nome: piattaforma }) : t('poi {euro} al mese di assistenza', { euro: euro(p.prezzo_mese) }))
        : avvio() ? el('p', { class: 'pp-poi' }, t('nessun canone mensile')) : null,
      p.prezzo_mese && p.assistenzaPiattaforma && p.canone ? cosaComprende() : null);
  };
  // cosa vale il canone: le risposte, il programma controllato da fuori, il rapporto del mese; e quanto costa un intervento senza
  const cosaComprende = () => el('details', { class: 'pp-canone' }, el('summary', {}, t('Cosa comprende l\'assistenza')),
    el('ul', {},
      el('li', {}, t('Una prima risposta entro {ore} ore, dalla bolla dentro il programma o dal telefono', { ore: p.canone.rispostaOre })),
      el('li', {}, t('Il programma controllato da fuori ogni {n} minuti: se non risponde, lo sappiamo prima di te', { n: p.canone.monitorMinuti })),
      el('li', {}, t('Gli aggiornamenti di sicurezza controllati prima che arrivino')),
      el('li', {}, t('Ogni mese il rapporto: quanto è stato online, cosa è stato aggiornato, cosa è stato risolto'))),
    p.canone.tariffaOra > 0 ? el('p', { class: 'aiuto' }, t('Senza assistenza un intervento costa {tariffa} l\'ora, con il preventivo prima. Il programma resta tuo e funziona comunque.', { tariffa: euro(p.canone.tariffaOra) })) : null);
  let prezzoBox = disegnoPrezzo();
  cambi.add(() => { const n = disegnoPrezzo(); prezzoBox.replaceWith(n); prezzoBox = n; });
  const prezzo = el('div', { class: 'carta pp-carta-acquisto' },
    el('div', { class: 'pp-acq-testa' }, el('span', {}, avvio() || !p.installatori.length ? t('Installazione') : t('Abbonamento')), el('span', { class: 'pp-acq-codice', 'data-no-t': '' }, codiceProdotto())),
    prezzoBox,
    divisione,
    el('div', { class: 'pp-acq-sezione' }, el('h3', { id: 'titolo-scelta' }, t('Chi viene a installarlo')), p.installatori.length > 1 ? el('span', { class: 'etichetta' }, conta(p.installatori.length, 'installatore', 'installatori')) : null),
    scelte(),
    // le province dove qualcuno lo installa di persona: ognuna ha la sua pagina locale
    p.zone?.length ? el('p', { class: 'piccolo tenue pp-zone' }, t('Lo installano di persona a: '),
      ...p.zone.flatMap((z, i) => [i ? ', ' : '', el('a', { href: `/p/${slug}/${z.slug}`, 'data-no-t': '' }, z.nome)])) : null,
    el('div', { id: 'paga' }));
  // il link referral verso il cloud o i piani a pagamento dell'azienda (Repobay prende la commissione, chi compra va da loro)
  const refer = p.ref ? el('p', { class: 'piccolo pp-ref' }, el('a', { href: p.ref.url, target: '_blank', rel: 'noopener sponsored', 'data-no-t': '' }, p.ref.testo)) : null;
  metti(a, prezzo, domanda(), refer);
  paga();
  // fissa su desktop: se la colonna è più alta dello schermo si ferma quando se ne vede il fondo
  if (!a.dataset.osservata) { a.dataset.osservata = '1'; new ResizeObserver(() => a.style.setProperty('--alto', `${a.offsetHeight}px`)).observe(a); }
}

function scelte() {
  if (!p.installatori.length) return el('div', { class: 'vuoto pp-vuoto-piccolo' }, el('h3', {}, t('Nessuno lo installa ancora')),
    el('p', {}, t('Se sai installarlo, offrilo tu nella tua zona: trovi come qui sotto.')));
  const nomeRete = id => p.crypto?.reti.find(r => r.id === id)?.nome;
  const box = el('div', { class: 'pp-scelte', role: 'radiogroup', 'aria-labelledby': 'titolo-scelta' }, ...p.installatori.map(i => {
    const r = el('input', { type: 'radio', name: 'installatore', value: i.codice, checked: i.codice === scelto });
    r.addEventListener('change', () => { scelto = i.codice; for (const f of cambi) f(installatore()); });
    const reti = (i.reti || []).map(nomeRete).filter(Boolean);
    return el('label', { class: 'scelta pp-inst' }, el('span', { class: 'pp-occhiello' }, r), avatar(i),
      el('span', { class: 'pp-inst-dati' },
        el('span', { class: 'pp-inst-riga' }, el('strong', { 'data-no-t': '' }, i.nome),
          i.livello ? el('span', { class: `pp-top livello-${i.livello}`, title: t('{n} vendite confermate di questo prodotto', { n: i.vendite }) }, t(i.livello > 1 ? 'Top seller oro' : 'Top seller')) : null,
          el('span', { class: 'pp-inst-prezzo' }, euro(i.prezzo_avvio))),
        el('span', { class: 'piccolo pp-zona', 'data-no-t': '' }, i.zona || ''),
        el('span', { class: 'piccolo pp-inst-voto' }, i.recensioni ? [stelle(i.voto), ' ', el('span', {}, conta(i.recensioni, 'recensione', 'recensioni'))] : el('span', {}, t('Nuovo, ancora senza recensioni'))),
        el('span', { class: 'piccolo pp-fiducia' }, i.confermate === 1 ? t('1 installazione confermata dal cliente') : i.confermate ? t('{n} installazioni confermate dai clienti', { n: i.confermate }) : t('Nessuna installazione confermata, ancora'),
          i.contestazioni ? [' · ', el('span', { class: 'pp-contestazioni' }, conta(i.contestazioni, 'segnalazione', 'segnalazioni'))] : null),
        p.crypto && !p.prelancio ? el('span', { class: 'pp-reti' }, reti.length ? t('Crypto: {reti}', { reti: reti.join(', ') }) : t('Solo carta')) : null,
        i.bonifico && p.bonifico ? el('span', { class: 'pp-reti' }, p.bonifico.metodi?.carta && p.bonifico.metodi?.bonifico ? t('Carta o bonifico') : p.bonifico.metodi?.carta ? t('Carta') : t('Bonifico')) : null),
      el('a', { class: 'piccolo pp-profilo', href: `/u/${i.codice}`, onclick: e => e.stopPropagation() }, t('Profilo')));
  }));
  return box;
}

function paga() {
  const box = $('#paga'); box.replaceChildren();
  if (!p.installatori.length) return;
  // il bonifico all'IBAN della piattaforma, con chi installa per lei: aperto anche nel prelancio (carta e crypto no)
  const conBonifico = oppure => { if (!p.bonifico) return; bonifico = pannelloBonifico(p, slug, installatore, { aggiornamenti: () => conAgg, codice: codiceBonifico, oppure }); box.append(bonifico.nodo); cambi.add(bonifico.aggiorna); };
  const altrimenti = el('p', { class: 'aiuto pp-nota' }, t('Preferisci parlarne prima? Chiedi un preventivo: ti risponde per email, senza impegno.'));
  if (p.prelancio) {
    const aggiornamenti = p.bonifico ? sceltaAggiornamenti(() => {}) : null;
    if (aggiornamenti) box.append(aggiornamenti.nodo);
    conBonifico(false);
    const prima = el('div', { class: 'avviso attesa pp-prelancio' });
    const testo = i => { prima.textContent = bonifico && i?.bonifico ? t('Preferisci parlarne prima? Chiedi un preventivo: ti risponde per email, senza impegno.') : t('I pagamenti aprono presto. Intanto chiedi un preventivo a chi lo installa: ti risponde per email, senza impegno.'); };
    testo(installatore()); cambi.add(testo);
    box.append(prima, modulo({ preventivo: true }));
    if (bonifico) box.append(condizioni());
    return;
  }
  if (p.carta === false) {   // la piattaforma non ha Stripe: si paga con bonifico o in crypto; senza nessuno dei due, si chiede un preventivo
    conBonifico(false);
    if (p.crypto) {
      if (!bonifico) box.append(el('p', { class: 'aiuto pp-nota' }, t('Qui si paga in crypto: dal tuo wallet dritto a chi riceve, in un attimo.')));
      crypto = pannelloCrypto(p, slug, installatore, { oppure: !!bonifico }); box.append(crypto.nodo); cambi.add(crypto.aggiorna);
    } else if (bonifico) box.append(altrimenti, modulo({ preventivo: true }));
    else box.append(el('div', { class: 'avviso attesa pp-prelancio' }, t('I pagamenti con carta non sono attivi: chiedi un preventivo a chi lo installa, ti risponde per email.')), modulo({ preventivo: true }));
    if (p.crypto || bonifico) box.append(condizioni());
    return;
  }
  const nota = el('p', { class: 'aiuto pp-nota' });
  const carta = el('button', { class: 'bottone pieno grande magnetico', type: 'button', id: 'compra' });
  // l'assistenza si paga in anticipo: ogni mese, o un anno intero con lo sconto
  const sconto = Math.round((p.sconto_anno || 0) * 100);
  const periodi = p.prezzo_mese > 0 && p.prezzo_anno > 0 ? el('fieldset', { class: 'pp-periodo' }, el('legend', {}, t('L\'assistenza, in anticipo')),
    ...[['mese', t('Ogni mese'), `${euro(p.prezzo_mese)} ${t('al mese')}`], ['anno', sconto ? t('Un anno, {n}% in meno', { n: sconto }) : t('Un anno'), `${euro(p.prezzo_anno)} ${t('all\'anno')}`]]
      .map(([v, x, prezzo]) => el('label', { class: 'pp-periodo-voce' }, el('input', { type: 'radio', name: 'periodo', value: v, checked: periodo === v, onchange: () => { periodo = v; aggiorna(installatore()); } }),
        el('span', {}, el('strong', {}, x), el('span', { class: 'piccolo tenue' }, prezzo))))) : null;
  const msg = el('div', { class: 'messaggio', role: 'alert' });
  const aggiornamenti = sceltaAggiornamenti(() => aggiorna(installatore()));
  const aggiorna = i => {
    aggiornamenti?.prezzo();
    const no = i && p.perConto && !i.carta;
    carta.disabled = !i || no;
    carta.textContent = !i ? t('Scegli chi lo installa') : t('Vai alla cassa');
    nota.textContent = !i ? t('Scegli qui sopra il professionista che viene da te.')
      : no ? t('{nome} deve ancora attivare gli incassi con carta: scegli un altro installatore, paga in crypto o scrivigli qui sotto.', { nome: i.nome })
        : p.prezzo_mese > 0 && i.prezzo_avvio > 0 ? (periodo === 'anno'
          ? t('Carta o addebito SEPA con Stripe: oggi l\'installazione e il primo anno di assistenza, poi si rinnova ogni anno. {nome} ti contatta per l\'appuntamento.', { nome: i.nome })
          : t('Carta o addebito SEPA con Stripe: oggi l\'installazione e il primo mese, poi l\'assistenza si rinnova ogni mese. {nome} ti contatta per l\'appuntamento.', { nome: i.nome }))
          : t('Carta o addebito SEPA con Stripe. {nome} ti contatta per l\'appuntamento.', { nome: i.nome });
    nota.classList.toggle('pp-nota-errore', !!no);
  };
  // la cassa (/compra): le scelte di qui la precompilano; lì il pagamento si apre nella pagina e dopo si installa con un comando
  carta.addEventListener('click', () => {
    const u = new URLSearchParams({ i: scelto, ...(periodo === 'anno' ? { periodo: 'anno' } : {}), ...(conAgg ? { agg: '1' } : {}) });
    location.href = `/compra/${encodeURIComponent(slug)}?${u}`;
  });
  box.append(periodi || '', aggiornamenti?.nodo || '', carta, msg, nota, el('p', { class: 'piccolo tenue pp-garanzia' }, t('Protezione per chi compra: con carta le quote restano alla piattaforma per {n} giorni, e dalla tua area confermi l\'installazione o segnali un problema. ', { n: p.trattenuta || 14 }), el('a', { href: '/garanzia' }, t('Come funziona'))));
  aggiorna(installatore()); cambi.add(aggiorna);
  conBonifico(true);
  if (p.crypto) { crypto = pannelloCrypto(p, slug, installatore, { aggiornamenti: () => conAgg }); box.append(crypto.nodo); cambi.add(crypto.aggiorna); }
  box.append(condizioni());
}
// prima di pagare: le Condizioni e la Garanzia, e cosa succede all'assistenza se si chiude e si riattiva
function condizioni() {
  const r = p.canone?.riattivazioneMesi > 0 && p.prezzo_mese > 0;
  return el('p', { class: 'piccolo tenue pp-condizioni' }, t('Pagando accetti le'), ' ', el('a', { href: '/contratto', target: '_blank' }, t('Condizioni')), ' ', t('e la'), ' ',
    el('a', { href: '/garanzia', target: '_blank' }, t('Garanzia')), '. ', p.prezzo_mese > 0 ? t('L\'assistenza si disdice quando vuoi e il programma resta tuo.') : '',
    r ? [' ', t('Se la chiudi e poi la riattivi, paghi una volta anche {n} mesi di canone.', { n: p.canone.riattivazioneMesi })] : '');
}

// gli aggiornamenti garantiti da chi sviluppa: facoltativi, a prezzo suo, con la sua promessa; tolti Stripe e la piattaforma, vanno a lui. Valgono per la carta
// (una riga in più nell'abbonamento, stesso periodo dell'assistenza) e per la crypto (per i mesi pagati in anticipo)
function sceltaAggiornamenti(cambia) {
  const a = p.aggiornamenti; if (!a) return null;
  const spunta = el('input', { type: 'checkbox', name: 'aggiornamenti', checked: conAgg });
  const costo = el('strong', {});
  spunta.addEventListener('change', () => { conAgg = spunta.checked; cambia(); crypto?.aggiorna(installatore()); bonifico?.aggiorna(installatore()); });
  const prezzo = () => { costo.textContent = periodo === 'anno' && p.prezzo_mese > 0 ? t('+{euro} all\'anno', { euro: euro(a.anno) }) : t('+{euro} al mese', { euro: euro(a.mese) }); };
  prezzo();
  return { prezzo, nodo: el('fieldset', { class: 'pp-aggiornamenti' }, el('legend', {}, t('Aggiornamenti garantiti da chi sviluppa')),
    el('label', { class: 'spunta' }, spunta, el('span', {}, costo, ' ', el('span', {}, t('Li voglio, facoltativi')))),
    el('p', { class: 'piccolo', 'data-no-t': '' }, a.testo),
    el('p', { class: 'piccolo tenue' }, a.quota ? t('L\'{n}% va a chi sviluppa il programma. Il programma funziona anche senza: così è sicuro che chi lo scrive continui a seguirlo.', { n: Math.round((1 - a.quota) * 100) })
      : t('Tolti il costo di Stripe (con carta) e la parte della piattaforma, va tutto a chi sviluppa il programma. Il programma funziona anche senza: così è sicuro che chi lo scrive continui a seguirlo.'))) };
}

// ---------------- il rinnovo dell'assistenza pagata in crypto: niente installazione, stesso installatore ----------------
function acquistoRinnovo(a) {
  const r = rinnovo, chi = r.installatore?.codice;
  if (chi && p.installatori.some(i => i.codice === chi)) scelto = chi;
  const titolo = el('div', { class: 'pp-acq-testa' }, el('span', {}, t('Rinnovo dell\'assistenza')), el('span', { class: 'pp-acq-codice', 'data-no-t': '' }, codiceProdotto()));
  const corpo = [];
  if (!r.rinnovo) corpo.push(el('div', { class: 'avviso ok' }, r.stato?.motivo === 'pagata' ? t('L\'assistenza è pagata fino al {data}: il rinnovo si apre un mese prima della scadenza.', { data: new Date(r.stato.fino).toLocaleDateString() })
    : t('Questa installazione non ha un rinnovo in crypto da pagare: l\'assistenza con carta si rinnova da sola.')));
  else if (r.pagamento === 'bonifico') {   // pagata con bonifico: si rinnova con un altro bonifico, stesso installatore
    if (!p.bonifico || !installatore()?.bonifico) corpo.push(el('div', { class: 'avviso attesa' }, t('Il rinnovo con bonifico non è disponibile adesso: scrivi a chi ti segue dalla tua pagina di assistenza.')));
    else {
      corpo.push(el('div', { class: 'prezzo pp-prezzo' }, euro(r.rinnovo.euro), el('small', {}, t(' per {mesi} mesi', { mesi: r.rinnovo.mesi }))),
        el('p', { class: 'pp-poi' }, t('Assistenza, aggiornamenti e controlli con {nome}, senza pagare di nuovo l\'installazione.', { nome: r.installatore?.nome || '' })));
      bonifico = pannelloBonifico(p, slug, installatore, { rinnovo: { k: codiceRinnovo, euro: r.rinnovo.euro, mesi: r.rinnovo.mesi }, codice: codiceBonifico });
      corpo.push(bonifico.nodo); cambi.add(bonifico.aggiorna);
    }
  }
  else if (!p.crypto || !installatore()) corpo.push(el('div', { class: 'avviso attesa' }, t('Il rinnovo in crypto non è disponibile adesso: scrivi a chi ti segue dalla tua pagina di assistenza.')));
  else {
    corpo.push(el('div', { class: 'prezzo pp-prezzo' }, euro(r.rinnovo.euro), el('small', {}, t(' per {mesi} mesi', { mesi: r.rinnovo.mesi }))),
      el('p', { class: 'pp-poi' }, t('Assistenza, aggiornamenti e controlli con {nome}, senza pagare di nuovo l\'installazione.', { nome: r.installatore?.nome || '' })));
    crypto = pannelloCrypto(p, slug, installatore, { rinnovo: { k: codiceRinnovo, euro: r.rinnovo.euro, mesi: r.rinnovo.mesi } });
    corpo.push(crypto.nodo); cambi.add(crypto.aggiorna);
  }
  metti(a, el('div', { class: 'carta pp-carta-acquisto' }, titolo, ...corpo,
    el('a', { class: 'piccolo', href: `/assistenza/${encodeURIComponent(codiceRinnovo)}` }, t('← Torna alla tua pagina di assistenza'))));
}

// il modulo per scrivere all'installatore scelto: domanda o, nel prelancio, preventivo
function modulo({ preventivo = false } = {}) {
  const msg = el('div', { class: 'messaggio', role: 'alert' });
  const invia = el('button', { class: `bottone pieno${preventivo ? '' : ' secondario'}`, type: 'submit' });
  const f = el('form', { class: 'modulo pp-modulo', novalidate: true },
    el('div', { class: 'trappola', 'aria-hidden': 'true' }, el('label', {}, 'Sito web', el('input', { type: 'text', name: 'sito_web', tabindex: '-1', autocomplete: 'off' }))),
    el('label', {}, t('Il tuo nome o quello dell\'attività'), el('input', { type: 'text', name: 'nome', required: true, minlength: '2', maxlength: '80', autocomplete: 'organization' })),
    el('label', {}, t('Email'), el('input', { type: 'email', name: 'email', required: true, autocomplete: 'email', inputmode: 'email' }), el('span', { class: 'aiuto' }, t('Ti risponde qui. Non la vede nessun altro.'))),
    el('label', {}, t('Telefono (facoltativo)'), el('input', { type: 'tel', name: 'telefono', maxlength: '30', autocomplete: 'tel' })),
    el('label', {}, preventivo ? t('Cosa ti serve') : t('La tua domanda'),
      el('textarea', { name: 'messaggio', required: true, minlength: '10', maxlength: '3000', placeholder: preventivo ? t('Che attività hai, dove sei, quante postazioni ti servono…') : t('Per esempio: funziona con la mia stampante fiscale? Quando potresti venire?') })),
    el('label', { class: 'spunta' }, el('input', { type: 'checkbox', name: 'privacy', required: true }), el('span', {}, t('Ho letto l\'informativa privacy'), ' · ', el('a', { href: '/privacy', target: '_blank' }, t('leggila')))),
    invia, msg);
  const aggiorna = i => {
    invia.disabled = !i;
    invia.textContent = !i ? t('Scegli prima chi lo installa') : preventivo ? t('Chiedi il preventivo a {nome}', { nome: i.nome }) : t('Manda la domanda a {nome}', { nome: i.nome });
  };
  aggiorna(installatore()); cambi.add(aggiorna);
  f.addEventListener('submit', e => {
    e.preventDefault();
    const x = dati(f);
    for (const c of $$('input, textarea', f)) c.removeAttribute('aria-invalid');
    const sbagliato = $$('input[required], textarea[required]', f).find(c => !c.checkValidity());
    if (sbagliato) {
      sbagliato.setAttribute('aria-invalid', 'true'); sbagliato.focus();
      msg.textContent = sbagliato.name === 'privacy' ? t('Per mandare la richiesta conferma di aver letto l\'informativa privacy') : sbagliato.name === 'email' ? t('Email non valida: serve per risponderti')
        : sbagliato.name === 'nome' ? t('Scrivi il tuo nome o quello della tua attività') : t('Scrivi due righe: cosa ti serve, dove sei');
      return;
    }
    const i = installatore();
    occupato(invia, async () => {
      await chiama('POST', '/api/contatto', { installatore: scelto, prodotto: slug, nome: x.nome, email: x.email, telefono: x.telefono, messaggio: x.messaggio, privacy: true, sito_web: x.sito_web });
      cambi.delete(aggiorna);
      f.replaceWith(el('div', { class: 'avviso ok', role: 'status' }, t('Messaggio mandato a {nome}: ti risponde all\'indirizzo {email}.', { nome: i.nome, email: x.email })));
    }, msg);
  });
  return f;
}

// la domanda all'installatore (i link «#contatto» della cassa arrivano qui, già aperta); senza installatori, chi può offrirlo
function domanda() {
  if (!p.installatori.length) return el('div', { class: 'avviso pp-contatto', id: 'contatto' },
    el('span', {}, t('Nessuno lo offre ancora nella tua zona.'), ' ', el('a', { href: '/installatori' }, t('Lo installi tu? Diventa installatore'))));
  const d = el('details', { class: 'carta pp-domanda', id: 'contatto' }, el('summary', {}, el('span', {}, t('Fai una domanda all\'installatore')), el('span', { class: 'aiuto' }, t('Prima di comprare: risponde per email'))));
  let pronto = false;
  d.addEventListener('toggle', () => { if (d.open && !pronto) { pronto = true; d.append(modulo()); } });
  if (location.hash === '#contatto') d.open = true;
  return d;
}

// ---------------- il contenuto ----------------
function contenuto() {
  const r = $('#readme');
  $('#readme-github').href = `${p.url}#readme`;
  if (p.readme) {
    r.innerHTML = p.readme;   // HTML già ripulito dal server (markdownSicuro)
    for (const a of $$('a[href]', r)) {
      let u; try { u = new URL(a.getAttribute('href'), location.href); } catch { continue; }
      if (u.host !== location.host) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    }
  } else r.replaceChildren(vuoto('Il README non è ancora arrivato', 'Lo leggiamo da GitHub a ogni nuova versione. Intanto lo trovi sul repository.', fuori(p.url, t('Apri su GitHub'))));

  // con la guida a passi, le note di chi l'ha messo in catalogo stanno dentro la guida; senza, restano qui
  vedi('#guida-carta', !!p.guida && !p.installazione?.passi?.length); $('#guida').textContent = p.guida || '';

  vedi('#sezione-versioni', p.versioni.length > 0);
  $('#versioni').replaceChildren(...p.versioni.map((v, k) => el('div', { class: `pp-versione${k === 0 ? ' ultima' : ''}` },
    fuori(v.url || `${p.url}/releases`, el('span', { class: 'pp-tag', 'data-no-t': '' }, v.tag)),
    el('span', { class: 'pp-versione-nome' }, v.nome && v.nome !== v.tag ? el('span', { 'data-no-t': '' }, v.nome) : null, k === 0 ? el('span', { class: 'pillola ok' }, t('ultima')) : null),
    el('span', { class: 'pp-data' }, data(v.pubblicata)))));

  const voto = String(p.voto).replace('.', document.documentElement.lang === 'en' ? '.' : ',');
  $('#recensioni-media').replaceChildren(...(p.recensioni_n ? [el('span', { class: 'pp-bollino', 'aria-hidden': 'true' }, el('b', {}, voto), el('small', {}, t('su 5'))),
    el('span', { class: 'sr' }, t('{v} su 5 · {n}', { v: voto, n: conta(p.recensioni_n, 'recensione', 'recensioni') })),
    el('span', { class: 'pp-media-testo', 'aria-hidden': 'true' }, stelle(p.voto), el('span', {}, conta(p.recensioni_n, 'recensione', 'recensioni')))] : []));
  $('#recensioni-lista').replaceChildren(...(p.recensioni.length ? p.recensioni.map(x => el('article', { class: 'pp-recensione' },
    el('div', { class: 'pp-recensione-testa' }, el('span', { class: 'pp-adesivo-stelle' }, stelle(x.voto)), el('strong', { 'data-no-t': '' }, x.autore || t('Cliente')), el('span', { class: 'pp-data' }, data(x.creata))),
    x.testo ? el('p', { class: 'pp-recensione-testo', 'data-no-t': '' }, x.testo) : null,
    x.installatore ? el('p', { class: 'pp-installato' }, t('Installato da {nome}', { nome: x.installatore })) : null,
    x.risposta ? el('div', { class: 'pp-risposta' }, el('span', { class: 'etichetta' }, t('Risposta')), el('p', { 'data-no-t': '' }, x.risposta)) : null))
    : [vuoto('Ancora nessuna recensione', 'Le scrivono solo le attività che l\'hanno comprato e installato: qui non ci sono recensioni finte.')]));
}

// lo stato vuoto con la scatola vuota in 3D
function vuoto(titolo, testo, ...figli) {
  return el('div', { class: 'pp-vuoto' }, el('figure', { class: 'pp-figura' }, el('img', { src: '/img/sobrio/vuoto.svg', alt: '', width: '1200', height: '900', loading: 'lazy' })),
    el('div', {}, el('h3', {}, t(titolo)), el('p', {}, t(testo)), ...figli));
}

// ---------------- le idee di applicazione: tre attività, con l'anteprima di quello che vede il titolare ----------------
function idee() {
  const l = p.idee || [];
  vedi('#sezione-idee', l.length > 0);
  $('#idee').replaceChildren(...l.map(x => el('article', { class: 'pp-idea' },
    el('div', { class: 'pp-idea-testo' },
      el('p', { class: 'etichetta pp-idea-attivita', 'data-no-t': '' }, x.attivita),
      x.problema ? el('p', { class: 'pp-idea-problema', 'data-no-t': '' }, x.problema) : null,
      el('p', { 'data-no-t': '' }, x.come),
      x.risultato ? el('p', { class: 'pp-idea-risultato', 'data-no-t': '' }, x.risultato) : null),
    anteprima(x.anteprima))));
}
// la piccola anteprima: una notifica, una riga di schermo, un messaggio o un numero, come li vedrebbe il titolare
function anteprima(a) {
  if (!a?.righe?.length) return null;
  const testa = el('div', { class: 'pp-ant-testa' }, el('span', { 'data-no-t': '' }, a.titolo || ''), a.nota ? el('span', { class: 'pp-ant-nota', 'data-no-t': '' }, a.nota) : null);
  const corpo = a.tipo === 'numero'
    ? [el('b', { class: 'pp-ant-cifra', 'data-no-t': '' }, a.righe[0]), ...a.righe.slice(1).map(r => el('span', { 'data-no-t': '' }, r))]
    : a.righe.map(r => el('p', { 'data-no-t': '' }, r));
  return el('figure', { class: `pp-ant pp-ant-${a.tipo}` }, el('figcaption', { class: 'pp-ant-tag' }, t('Anteprima')), el('div', { class: 'pp-ant-corpo' }, testa, ...corpo));
}

// ---------------- la guida d'installazione interattiva ----------------
// i passi si spuntano (restano su questo browser), i comandi si copiano con i segnaposto riempiti dai campi qui sopra
// gli esempi nella lingua della pagina (t): in inglese app.yourshop.com
const SEGNAPOSTO = { DOMINIO: ['Il tuo dominio', 'gestionale.tuonegozio.it'], IP: ['Indirizzo del server', '192.168.1.20'], EMAIL: ['Email dell\'amministratore', 'admin@tuonegozio.it'] };
const ricorda = { leggi: k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }, scrivi: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } } };
const DIFFICOLTA = { facile: 'Facile', media: 'Media', impegnativa: 'Impegnativa' };
function installa() {
  const g = p.installazione, box = $('#installa');
  vedi('#sezione-installa', !!g?.passi?.length); if (!g?.passi?.length) { box.replaceChildren(); return; }
  const fonte = $('#installa-fonte'); vedi('#installa-fonte', !!g.fonte); if (g.fonte) fonte.href = g.fonte;
  const chiave = `guida:${p.slug}`, fatti = new Set(ricorda.leggi(chiave) || []), valori = { ...(ricorda.leggi('guida:segnaposto') || {}) };
  const tutto = g.passi.map(s => [s.testo, s.comando, s.verifica].join(' ')).join(' ');
  const usati = Object.keys(SEGNAPOSTO).filter(n => tutto.includes(`{{${n}}}`));
  // un testo con i segnaposto: i valori scritti nei campi, altrimenti l'esempio in evidenza
  const pezzi = testo => String(testo || '').split(/(\{\{(?:DOMINIO|IP|EMAIL)\}\})/).filter(Boolean).map(x => {
    const n = x.match(/^\{\{(\w+)\}\}$/)?.[1];
    return n ? el('span', { class: `pp-segnaposto${valori[n] ? ' pieno' : ''}`, 'data-segnaposto': n }, valori[n] || t(SEGNAPOSTO[n][1])) : x;
  });
  const pieno = testo => String(testo || '').replace(/\{\{(DOMINIO|IP|EMAIL)\}\}/g, (m, n) => valori[n] || t(SEGNAPOSTO[n][1]));
  const barra = el('div', { class: 'pp-avanza', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(g.passi.length) }, el('span'));
  const conto = el('span', { class: 'pp-avanza-testo' });
  const aggiornaAvanzamento = () => {
    const n = g.passi.filter((s, i) => fatti.has(i)).length;
    barra.setAttribute('aria-valuenow', String(n)); barra.firstChild.style.width = `${(n / g.passi.length) * 100}%`;
    conto.textContent = n === g.passi.length ? t('Installazione completata') : t('{n} passi su {tot}', { n, tot: g.passi.length });
  };
  const passi = g.passi.map((s, i) => {
    const casella = el('input', { type: 'checkbox', id: `passo-${i}`, checked: fatti.has(i) });
    const li = el('li', { class: `pp-passo${fatti.has(i) ? ' fatto' : ''}` },
      el('label', { class: 'pp-passo-testa', for: `passo-${i}` }, casella, el('span', { class: 'pp-passo-n', 'aria-hidden': 'true' }, String(i + 1)), el('strong', { 'data-no-t': '' }, s.titolo)),
      el('div', { class: 'pp-passo-corpo' },
        el('p', { 'data-no-t': '' }, ...pezzi(s.testo)),
        s.comando ? el('div', { class: 'pp-comando' }, el('pre', { 'data-no-t': '' }, el('code', {}, ...pezzi(s.comando))),
          el('button', { type: 'button', class: 'bottone secondario piccolo', onclick: e => copia(pieno(s.comando), e.currentTarget) }, t('Copia'))) : null,
        s.verifica ? el('p', { class: 'pp-verifica' }, el('span', { class: 'etichetta' }, t('Come controllare')), ' ', el('span', { 'data-no-t': '' }, ...pezzi(s.verifica))) : null));
    casella.addEventListener('change', () => {
      if (casella.checked) fatti.add(i); else fatti.delete(i);
      li.classList.toggle('fatto', casella.checked); ricorda.scrivi(chiave, [...fatti]); aggiornaAvanzamento();
    });
    return li;
  });
  const campi = usati.length ? el('div', { class: 'pp-segnaposti carta' },
    el('p', { class: 'etichetta' }, t('Scrivi i dati del cliente: i comandi si riempiono da soli')),
    el('div', { class: 'campi' }, ...usati.map(n => {
      const inp = el('input', { type: n === 'EMAIL' ? 'email' : 'text', value: valori[n] || '', placeholder: t(SEGNAPOSTO[n][1]), autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off' });
      inp.addEventListener('input', () => {
        valori[n] = inp.value.trim(); ricorda.scrivi('guida:segnaposto', valori);
        for (const x of $$(`[data-segnaposto="${n}"]`, box)) { x.textContent = valori[n] || t(SEGNAPOSTO[n][1]); x.classList.toggle('pieno', !!valori[n]); }
      });
      return el('label', {}, el('span', {}, t(SEGNAPOSTO[n][0])), inp);
    }))) : null;
  const ricomincia = el('button', { type: 'button', class: 'bottone fantasma piccolo', onclick: () => {
    fatti.clear(); ricorda.scrivi(chiave, []);
    for (const li of $$('.pp-passo', box)) { li.classList.remove('fatto'); li.querySelector('input').checked = false; }
    aggiornaAvanzamento();
  } }, t('Ricomincia'));
  box.replaceChildren(
    el('div', { class: 'pp-guida-testa' },
      el('div', { class: 'pp-guida-dati' },
        g.tempo ? el('span', { class: 'pillola' }, el('span', { 'data-no-t': '' }, g.tempo)) : null,
        g.difficolta ? el('span', { class: `pillola pp-difficolta ${g.difficolta}` }, t(DIFFICOLTA[g.difficolta])) : null),
      g.requisiti?.length ? el('div', { class: 'pp-requisiti' }, el('p', { class: 'etichetta' }, t('Serve')), el('ul', {}, ...g.requisiti.map(r => el('li', { 'data-no-t': '' }, r)))) : null),
    campi,
    el('div', { class: 'pp-avanza-riga' }, barra, conto, ricomincia),
    el('ol', { class: 'pp-guida-passi' }, ...passi),
    p.guida ? el('details', { class: 'piega' }, el('summary', {}, t('Le note di chi l\'ha messo in catalogo')), el('p', { 'data-no-t': '' }, p.guida)) : null);
  aggiornaAvanzamento();
}

// i numeri delle sezioni seguono quelle che si vedono: niente buchi quando un prodotto non ha idee o guida a passi
function numeriSezioni() {
  let n = 0;
  for (const s of $$('.pp-corpo > .pp-sezione')) {
    const c = s.querySelector('.pp-n'); if (!c) continue;
    if (!s.classList.contains('nascosto')) c.textContent = String(++n).padStart(2, '0');
  }
}

// ---------------- per chi installa e per chi l'ha costruito ----------------
function tua() {
  const box = $('#sezione-tua'); box.replaceChildren();
  const q = percento(p.quotaInstallatore ?? .2);   // la parte di chi vende, prima del livello
  const figura = (img, alt) => el('figure', { class: 'pp-figura pp-tua-figura', 'aria-hidden': 'true' }, el('img', { src: img, alt, width: '800', height: '800', loading: 'lazy' }));
  if (p.mio) box.append(el('div', { class: 'carta pp-tua ruolo-builder' }, figura('/img/sobrio/ruolo-builder.svg', ''), el('div', {}, el('span', { class: 'pp-ruolo builder' }, t('Builder')), el('h3', {}, t('È un tuo prodotto')), el('p', {}, t('La tua percentuale, i collaboratori, gli accordi e le mance a chi lo vende, la descrizione: tutto dalla tua area.'))),
    el('a', { class: 'bottone secondario', href: '/area#prodotti' }, t('Modifica nella tua area'))));
  // chi guarda senza essere entrato è quasi sempre un'attività che cerca un programma: niente riquadro per gli installatori, solo una
  // riga per chi fa questo lavoro (il corso e il test sono su /installatori e nell'area)
  if (!sessione.dentro) {
    box.append(el('p', { class: 'piccolo tenue pp-tua-riga' }, t('Installi programmi per le attività?'), ' ', el('a', { href: '/installatori' }, t('Scopri come offrirlo'))));
    return;
  }
  if (p.stato !== 'pubblicato') return;
  // il corso per installatori: senza il test non si offre; i programmi impegnativi chiedono anche l'esperienza
  if (p.manca) {
    const corso = p.manca === 'corso', c = p.corso || {};
    box.append(el('div', { class: 'carta pp-tua pp-tua-offri ruolo-installatore' }, figura('/img/sobrio/ruolo-installatore.svg', ''),
      el('div', {}, el('span', { class: 'pp-ruolo installatore' }, t('Installatore')),
        el('h3', {}, corso ? t('Prima, il corso') : t('Programma impegnativo')),
        el('p', {}, corso
          ? (p.adottato ? t('Lo offri, ma non compari fra chi lo installa finché non superi il test del corso per installatori.')
            : t('Per offrire i programmi del catalogo serve il corso per installatori: otto lezioni brevi e un test.'))
          : t('Si sblocca dopo {servono} installazioni confermate dai clienti: ne hai {fatte}. Intanto puoi offrire i programmi facili e medi.', { servono: c.servono, fatte: c.confermate })),
        corso ? el('a', { class: 'bottone', href: `/corso?dopo=${encodeURIComponent(location.pathname)}` }, t('Fai il corso'))
          : el('a', { class: 'bottone secondario', href: '/esplora' }, t('Guarda il catalogo')))));
    return;
  }
  const io = p.installatori.find(i => i.codice === sessione.utente?.codice);
  const msg = el('div', { class: 'messaggio', role: 'alert' });
  const zona = el('input', { type: 'text', name: 'zona', required: true, minlength: '2', maxlength: '60', value: io?.zona || p.miaZona || '', placeholder: t('La tua zona: Bergamo, o «tutta Italia, da remoto»'), autocomplete: 'address-level2' });
  const vai = el('button', { class: `bottone ${p.adottato ? 'secondario' : ''}`, type: 'submit' }, p.adottato ? t('Salva prezzo e zona') : t('Lo offro io'));
  // il prezzo dell'installazione è tuo: si parte dal tuo, o da quello degli altri, o dal riferimento del catalogo
  const min = (p.prezzoMin || 500) / 100, base = p.mioPrezzo ?? p.suggerito?.avvio ?? 0;
  const prezzoIn = el('input', { type: 'number', name: 'prezzo_avvio', required: true, min: String(min), max: '50000', step: '1', inputmode: 'decimal', value: base ? String(Math.round(base / 100)) : '', placeholder: '390' });
  const sg = p.suggerito, consiglio = p.adottato && p.prezzi?.a > p.prezzi?.da ? t('Chi lo vende chiede da {a} a {b}.', { a: euro(p.prezzi.da), b: euro(p.prezzi.a) })
    : !sg ? t('Nessuno lo vende ancora: scegli tu, pensando al tempo che ti serve.')
    : sg.fonte === 'altri' ? t('Chi lo offre già chiede intorno a {euro}.', { euro: euro(sg.avvio) })
      : sg.fonte === 'catalogo' ? t('Il prezzo di riferimento del catalogo è {euro}.', { euro: euro(sg.avvio) }) : t('Nella sua categoria si parte da circa {euro}.', { euro: euro(sg.avvio) });
  // quanto ti resta: tolti Stripe (con carta) e la piattaforma, la percentuale di chi sviluppa (meno, se sei Top seller) o il vostro accordo
  const miaQuota = io?.quota ?? (1 - (1 - (p.miaQuotaBase ?? p.quotaInstallatore ?? .2)) * (p.mioLivello?.fattore ?? 1));
  const resta = el('p', { class: 'aiuto pp-resta', 'aria-live': 'polite' });
  const quantoResta = () => {
    const c = Math.round(Number(String(prezzoIn.value).replace(',', '.')) * 100);
    if (!(c >= min * 100)) { resta.textContent = t('Almeno {euro}.', { euro: euro(min * 100) }); return; }
    // con carta: prima il costo di Stripe (stimato), poi la parte della piattaforma, poi la divisione con chi sviluppa
    const st = p.commissioni?.stripe, costo = st ? Math.round(c * st.percentuale) + st.fisso : 0;
    const pf = costo + Math.round((c - costo) * (p.commissioni?.carta ?? .05)), tuoi = Math.floor((c - pf) * miaQuota);
    resta.textContent = costo ? t('Con carta ti restano {tuoi}: {st} di costo della carta, {pf} alla piattaforma, {dev} a chi lo sviluppa.', { tuoi: euro(tuoi), st: euro(costo), pf: euro(pf - costo), dev: euro(c - pf - tuoi) })
      : t('Con carta ti restano {tuoi}: {pf} alla piattaforma, {dev} a chi lo sviluppa.', { tuoi: euro(tuoi), pf: euro(pf), dev: euro(c - pf - tuoi) });
  };
  prezzoIn.addEventListener('input', quantoResta); quantoResta();
  // la base di chi vende prima del livello: la sua, con l'accordo se c'è; altrimenti quella standard
  const l = p.mioLivello, pc = x => `${String(Math.round(x * 1000) / 10).replace('.', ',')}%`, miaBase = p.miaQuotaBase ?? p.quotaInstallatore;
  const livello = !p.adottato || !l ? null : l.livello
    ? el('p', { class: 'pp-livello' }, el('span', { class: `pp-top livello-${l.livello}` }, t(l.livello > 1 ? 'Top seller oro' : 'Top seller')), ' ',
      t('{n} vendite confermate: a chi lo sviluppa va il {d} invece del {b}.', { n: l.vendite, d: pc((1 - miaBase) * l.fattore), b: pc(1 - miaBase) }),
      l.prossimo ? [' ', t('Fra {m} vendite confermate sali ancora.', { m: l.prossimo.mancano })] : null)
    : l.prossimo ? el('p', { class: 'aiuto pp-livello' }, t('Hai {n} vendite confermate di questo prodotto. Alla {soglia}ª sei Top seller: a chi lo sviluppa va meno, a te di più.', { n: l.vendite, soglia: l.prossimo.da })) : null;
  const link = l => el('div', { class: 'pp-link' }, el('p', { class: 'etichetta' }, t('Il tuo link per questo prodotto')),
    el('div', { class: 'copia' }, el('code', { 'data-no-t': '' }, l), el('button', { class: 'bottone secondario piccolo', type: 'button', onclick: e => copia(l, e.currentTarget) }, t('Copia'))),
    el('p', { class: 'aiuto' }, t('Chi compra da questo link sceglie te. Vale 30 giorni dal primo clic.')));
  const linkBox = el('div', { class: 'pp-link-box' }, p.adottato && sessione.utente?.codice ? link(`${location.origin}/p/${slug}?ref=${sessione.utente.codice}`) : null);
  // il programma partner dell'azienda: chi offre il prodotto ne rispetta le condizioni (se è obbligatorio, conferma prima di offrirlo)
  const pr = p.programma, daConfermare = pr?.obbligatorio && !(p.adottato && p.programmaAccettato);
  const spunta = pr?.obbligatorio && !p.adottato ? el('input', { type: 'checkbox', name: 'programma' }) : null;
  const programma = pr ? el('div', { class: 'pp-programma' },
    el('p', { class: 'etichetta' }, t('Il programma partner dell\'azienda')),
    el('p', {}, el('strong', { 'data-no-t': '' }, pr.nome), ' ', el('a', { href: pr.url, target: '_blank', rel: 'noopener' }, t('Aderisci dal loro modulo'))),
    el('p', { class: 'piccolo', 'data-no-t': '' }, pr.termini),
    spunta ? el('label', { class: 'spunta' }, spunta, el('span', {}, t('Rispetto le condizioni del programma partner dell\'azienda per questo prodotto'))) : null,
    p.adottato && daConfermare ? el('div', { class: 'avviso attesa' }, el('div', {}, el('p', {}, t('Non compari fra chi lo installa finché non confermi di rispettare le condizioni del programma partner.')),
      el('button', { class: 'bottone piccolo', type: 'button', onclick: e => occupato(e.currentTarget, async () => {
        await chiama('POST', '/api/adozioni/programma', { prodotto: p.id }); avviso('Confermato: ora compari fra chi lo installa');
        p = await chiama('GET', `/api/prodotto?slug=${encodeURIComponent(slug)}`); disegna();
      }, msg) }, t('Confermo')))) : null) : null;
  const f = el('form', { class: 'pp-offri', novalidate: true }, el('label', {}, t('Dove installi'), zona),
    el('label', { class: 'pp-prezzo-tuo' }, t('Il tuo prezzo (€)'), prezzoIn), vai,
    el('p', { class: 'aiuto pp-consiglio' }, consiglio, ' ', p.prezzo_mese ? t('L\'assistenza di ogni mese ({euro}) la dai tu, con la piattaforma dietro: tolto il costo di Stripe, il 60% del canone è tuo.', { euro: euro(p.prezzo_mese) }) : ''), resta);
  f.addEventListener('submit', e => {
    e.preventDefault();
    if (zona.value.trim().length < 2) { zona.setAttribute('aria-invalid', 'true'); msg.textContent = t('Scrivi la zona in cui installi (la città, o «tutta Italia, da remoto»)'); zona.focus(); return; }
    zona.removeAttribute('aria-invalid');
    if (!(Number(String(prezzoIn.value).replace(',', '.')) >= min)) { prezzoIn.setAttribute('aria-invalid', 'true'); msg.textContent = t('Scrivi il tuo prezzo per l\'installazione: almeno {euro}', { euro: euro(min * 100) }); prezzoIn.focus(); return; }
    prezzoIn.removeAttribute('aria-invalid');
    if (spunta && !spunta.checked) { msg.textContent = t('Conferma di rispettare le condizioni del programma partner dell\'azienda'); spunta.focus(); return; }
    occupato(vai, async () => {
      const r = await chiama('POST', '/api/adozioni', { prodotto: p.id, zona: zona.value.trim(), prezzo_avvio: String(prezzoIn.value).replace(',', '.'), ...(spunta ? { programma: spunta.checked } : {}) }).catch(err => {
        if (err.stato === 401) { location.href = `/accedi?dopo=${encodeURIComponent(location.pathname)}`; return new Promise(() => {}); }
        throw err;
      });
      avviso(p.adottato ? 'Salvato: il prezzo nuovo vale per le vendite da adesso' : 'Fatto: ora sei fra chi lo installa');
      p = await chiama('GET', `/api/prodotto?slug=${encodeURIComponent(slug)}${ref ? `&ref=${encodeURIComponent(ref)}` : ''}`);
      disegna();
      $('#sezione-tua .pp-link code') || $('#sezione-tua').append(link(r.link));
      $('#sezione-tua').scrollIntoView({ block: 'nearest' });
    }, msg);
  });
  box.append(el('div', { class: 'carta pp-tua pp-tua-offri ruolo-installatore' }, figura('/img/sobrio/ruolo-installatore.svg', ''),
    el('div', {}, el('span', { class: 'pp-ruolo installatore' }, t('Installatore')), el('h3', {}, p.adottato ? (daConfermare ? t('Manca la tua conferma') : t('Lo offri già')) : t('Offri questo prodotto')),
      el('p', {}, p.adottato && daConfermare ? t('Lo offri, ma per comparire fra chi lo installa devi confermare le condizioni del programma partner qui sotto.')
        : p.adottato ? t('Sei fra chi lo installa{zona}. Condividi il tuo link con le attività della tua zona.', { zona: io?.zona ? t(', a {zona}', { zona: io.zona }) : '' })
        : t('Sai installarlo? Offrilo nella tua zona al prezzo che decidi tu: avrai il tuo link per questo prodotto e il {q} di ogni installazione, tolti il costo di Stripe (con carta) e la parte della piattaforma.', { q })),
      livello),
    programma, f, msg, linkBox));
}

function badge() {
  $('#badge-img').src = p.badge.svg;
  $('#badge-md').textContent = p.badge.markdown;
  $('#badge-copia').onclick = e => copia(p.badge.markdown, e.currentTarget);
}

carica();
