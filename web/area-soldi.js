// Soldi: i totali per stato, le quote una per una, il conto Stripe, i dati fiscali (cifrati, per la DAC7) con l'anteprima
// di cosa si comunica, i wallet crypto per rete (EVM, Solana e Tron provati con una firma; Bitcoin scritto a mano).
import { el, t, chiama, occupato, conferma, avviso, euro, data, conta, riga, dati } from './comune.js';
import { blocco, aggiorna, carta, testa, titoletto, vuoto, bottone, messaggio, bene, campo, stato, ruolo, tabella, somma, pubblico, contatore } from './area-base.js';
import { account, firma } from './wallet.js';
import { walletSolana, collegaSolana, firmaSolana } from './solana.js';
import { collegaTron, firmaTron } from './tron.js';
import { azioneEscrow } from './escrow.js';

export function soldi(radice, io) {
  radice.append(
    testa('Soldi', 'Le tue parti di ogni pagamento, il conto dove arrivano e i dati che servono per le tasse.'),
    blocco('totali', totali),
    blocco('stripe', stripe),
    blocco('quote', quote),
    io.cryptoAttivo ? blocco('wallet', wallet) : null,
    blocco('fiscale', fiscale),
    blocco('dac7', dac7),
  );
}

function totali(io) {
  const s = st => somma(io, x => x.stato === st), n = st => io.totali.filter(x => x.stato === st).reduce((a, x) => a + x.n, 0);
  const per = r => somma(io, x => x.ruolo === r && x.stato !== 'annullata');
  const voce = (n, etichetta, valore, nota, colore) => contatore({ n, etichetta, valore: euro(valore), nota, colore });
  const ruoli = ['builder', 'cotitolare', 'collaboratore', 'installatore'].filter(r => io.totali.some(x => x.ruolo === r));
  return el('div', { class: 'pila' },
    el('div', { class: 'cruscotto' },
      voce('01', 'Versati', s('versata'), conta(n('versata'), 'quota', 'quote'), 'menta'),
      voce('02', 'In attesa', s('in_attesa'), io.pronto ? t(io.fiscale ? 'arrivano {n} giorni dopo il pagamento' : 'arrivano {n} giorni dopo il pagamento, se hai inserito i dati fiscali', { n: io.trattenuta }) : t('arrivano quando colleghi il conto'), 'sole'),
      s('in_escrow') ? voce('03', 'In escrow', s('in_escrow'), t('nel contratto finché il cliente conferma o finisce la trattenuta'), 'sole') : null,
      s('annullata') ? voce(s('in_escrow') ? '04' : '03', 'Annullati', s('annullata'), t('rimborsi e storni'), 'errore') : null),
    ruoli.length ? el('div', { class: 'per-ruolo' }, ...ruoli.map(r => el('span', { class: `adesivo piatto ruolo-${r === 'collaboratore' || r === 'cotitolare' ? 'builder' : r}` }, t('come {ruolo}: {x}', { ruolo: ruolo(r), x: euro(per(r)) })))) : null);
}

function quote(io) {
  return el('div', { class: 'pila' }, titoletto('Le tue quote', el('span', { class: 'tenue piccolo' }, t('le ultime {n}', { n: Math.min(io.quote.length, 200) }))),
    io.quote.length ? tabella(['Data', 'Prodotto', 'Ruolo', 'Tipo', ['Pagamento', true], ['Tua parte', true], 'Stato', 'Disponibile dal'],
      io.quote.map(q => riga([data(q.creato), pubblico(q.prodotto || '—'), ruolo(q.ruolo), t(q.tipo === 'mese' ? 'mese' : q.tipo === 'aggiornamenti' ? 'aggiornamenti' : q.tipo === 'mancia' ? 'mancia' : q.tipo === 'riattivazione' ? 'riattivazione' : 'installazione'),
        { classe: 'num', valore: euro(q.base) }, { classe: 'num', valore: euro(q.importo - q.stornato) }, statoQuota(q), data(q.disponibile)])))
      : vuoto('Nessuna quota, per ora', 'Ogni volta che un business paga, qui compare la tua parte: quanto, da quale prodotto e quando arriva.'));
}
// lo stato di una quota; per quelle in escrow anche cosa succede sul contratto e, a trattenuta finita, il bottone per incassare
// (la transazione la manda il tuo wallet: chiunque può chiedere al contratto di pagare, i soldi vanno comunque a chi era scritto)
function statoQuota(q) {
  if (!q.escrow || q.stato !== 'in_escrow') return stato(q.stato);
  if (q.custodia === 'contestato') return el('span', { class: 'pila-stretta' }, stato(q.stato), el('span', { class: 'tenue piccolo' }, t('congelato: decide la piattaforma')));
  if (!q.sblocco || Date.now() < new Date(q.sblocco).getTime()) return el('span', { class: 'pila-stretta' }, stato(q.stato), el('span', { class: 'tenue piccolo' }, t('si sblocca quando il cliente conferma, o da solo')));
  const b = bottone('Incassa dal contratto', 'piccolo', () => occupato(b, async () => {
    const r = await azioneEscrow(q.ordine, 'rilascia', { dire: x => avviso(x) });
    avviso(r.lenta ? 'Transazione inviata: le quote si aggiornano appena la rete conferma.' : 'Sbloccato: le parti sono sui wallet.'); await aggiorna(['totali', 'quote']);
  }));
  return el('span', { class: 'pila-stretta' }, stato(q.stato), b);
}

function stripe(io) {
  const m = messaggio();
  const [titolo, testo, etichetta] = io.pronto ? ['Pronto', t(io.fiscale ? 'Le tue parti dei pagamenti con carta arrivano qui da sole, {n} giorni dopo ogni pagamento.' : 'Le tue parti dei pagamenti con carta arrivano qui da sole, {n} giorni dopo ogni pagamento, se hai inserito i dati fiscali.', { n: io.trattenuta }), 'Apri il pannello Stripe']
    : io.collegato ? ['Da completare', t('Stripe chiede ancora qualche dato (identità o IBAN). Finché manca, le tue parti restano in attesa.'), 'Completa su Stripe']
      : ['Non collegato', t('Stripe verifica identità e IBAN e ti versa le tue parti. Senza il conto restano in attesa, al sicuro.'), 'Collega il conto'];
  // il paese del conto: dove vivi o ha sede la tua attività (Stripe lo verifica e dopo non si cambia). Stripe versa nello Spazio
  // economico europeo, nel Regno Unito, in Svizzera, negli Stati Uniti e in Canada
  const PAESI = ['IT', 'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IS', 'LV', 'LI', 'LT', 'LU', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'GB', 'CH', 'US', 'CA'];
  const nomi = (() => { try { return new Intl.DisplayNames([document.documentElement.lang || 'it'], { type: 'region' }); } catch { return null; } })();
  // «per conto» (chi installa incassa a suo nome) Stripe non fa trasferimenti fra paesi: il conto si apre solo nel paese della piattaforma
  const soloQui = io.perConto ? (io.stripePaese || 'IT') : null, elenco = soloQui ? [soloQui] : PAESI;
  const iniziale = soloQui || (PAESI.includes(io.fiscale?.paese) ? io.fiscale.paese : 'IT');
  const paese = io.pronto ? null : el('select', { name: 'paese', 'aria-label': t('Paese del conto') },
    ...elenco.map(x => el('option', { value: x, ...(x === iniziale ? { selected: '' } : {}) }, nomi?.of(x) || x)).sort((a, b) => a.value === 'IT' ? -1 : b.value === 'IT' ? 1 : a.textContent.localeCompare(b.textContent)));
  const b = bottone(etichetta, io.pronto ? 'secondario' : '', () => occupato(b, async () => {
    const r = await chiama('POST', io.pronto ? '/api/stripe/pannello' : '/api/stripe/collega', io.pronto ? {} : { paese: paese.value }); location.href = r.url;
  }, m));
  return carta({ class: 'stripe' }, el('div', { class: 'etichetta' }, t('Conto per ricevere i pagamenti con carta')),
    el('h3', { class: `stato-conto ${io.pronto ? 'ok' : io.collegato ? 'attesa' : ''}` }, t(titolo)), el('p', {}, testo),
    paese ? el('label', { class: 'piccolo' }, t('Il paese dove vivi o ha sede la tua attività'), ' ', paese) : null,
    paese ? el('p', { class: 'piccolo tenue' }, soloQui ? t('Qui il conto per la carta si apre solo in {paese}. Altrove ricevi la tua parte con un wallet.', { paese: nomi?.of(soloQui) || soloQui })
      : t('Stripe versa nello Spazio economico europeo, nel Regno Unito, in Svizzera, negli Stati Uniti e in Canada. Altrove ricevi la tua parte con un wallet.')) : null,
    el('div', { class: 'azioni' }, b), m);
}

function fiscale(io) {
  const f = io.fiscale || { tipo: 'persona', paese: 'IT' }, m = messaggio();
  const i = (name, attr = {}) => el('input', { type: 'text', name, value: f[name] || '', ...attr });
  const tipo = el('select', { name: 'tipo' }, el('option', { value: 'persona' }, t('una persona')), el('option', { value: 'impresa' }, t('un\'impresa')));
  tipo.value = f.tipo || 'persona';
  const nomeL = el('span', {}, t(tipo.value === 'impresa' ? 'Ragione sociale' : 'Nome e cognome, come sui documenti'));
  tipo.addEventListener('change', () => { nomeL.textContent = t(tipo.value === 'impresa' ? 'Ragione sociale' : 'Nome e cognome, come sui documenti'); });
  const form = el('form', { class: 'modulo', novalidate: true },
    el('div', { class: 'campi' }, campo('Sei', tipo), campo('Paese', i('paese', { maxlength: '2', autocomplete: 'country', class: 'maiuscolo' }), 'Due lettere, es. IT')),
    el('label', {}, nomeL, i('nome', { autocomplete: 'name', maxlength: '120' })),
    el('div', { class: 'campi' }, campo('Codice fiscale', i('codice', { autocomplete: 'off', maxlength: '20', class: 'maiuscolo', spellcheck: 'false' })),
      campo('Partita IVA (se ce l\'hai)', i('partita_iva', { autocomplete: 'off', maxlength: '20', spellcheck: 'false' }))),
    campo('Indirizzo', i('via', { autocomplete: 'street-address', maxlength: '120' })),
    el('div', { class: 'campi' }, campo('CAP', i('cap', { maxlength: '10', inputmode: 'numeric', autocomplete: 'postal-code' })), campo('Città', i('citta', { maxlength: '60', autocomplete: 'address-level2' })),
      campo('Provincia', i('provincia', { maxlength: '2', class: 'maiuscolo', autocomplete: 'address-level1' }))),
    el('div', { class: 'azioni' }, el('button', { type: 'submit', class: 'bottone' }, t('Salva'))), m);
  form.addEventListener('submit', e => {
    e.preventDefault();
    occupato(form.querySelector('button'), async () => { await chiama('POST', '/api/fiscale', dati(form)); bene(m, 'Salvati e cifrati.'); await aggiorna('dac7'); }, m);
  });
  return carta({ class: 'fiscale' }, titoletto('I tuoi dati fiscali', io.fiscale ? el('span', { class: 'pillola ok' }, t('salvati')) : el('span', { class: 'pillola in_attesa' }, t('mancano'))),
    el('p', {}, t('Servono solo se ricevi pagamenti: senza, le tue quote restano in attesa. Sono cifrati e li vedi solo tu; la piattaforma li usa unicamente per la comunicazione annuale che la legge le impone (DAC7). Le tue dichiarazioni e le tue fatture restano tue.')),
    form);
}

function dac7(io) {
  const d = io.dac7;
  return carta({ class: 'dac7' }, titoletto('Cosa comunichiamo all\'Agenzia delle Entrate'),
    el('p', {}, t('Anno {anno}, fin qui: {totale} ricevuti in {operazioni}.', { anno: d.anno, totale: euro(d.totale), operazioni: conta(d.operazioni, 'operazione', 'operazioni') }),
      ' ', t('La comunicazione si fa una volta l\'anno, entro il 31 gennaio, con i dati dell\'anno prima.')),
    d.trimestri.length ? tabella(['Trimestre', ['Operazioni', true], ['Ricevuto', true], ['Commissioni', true]],
      d.trimestri.map(x => riga([x.trimestre.replace('-T', ' T'), { classe: 'num', valore: String(x.operazioni) }, { classe: 'num', valore: euro(x.ricevuto) }, { classe: 'num', valore: euro(x.commissioni) }])))
      : el('p', { class: 'vuoto piccolo' }, t('Nessun versamento quest\'anno: non c\'è niente da comunicare.')),
    el('p', { class: 'piccolo' }, t('Oltre a questi importi: nome, indirizzo e codice fiscale o partita IVA qui accanto. Nient\'altro: niente clienti, niente dettagli delle vendite.'), ' ',
      el('a', { href: '/privacy' }, t('Privacy'))));
}

// ======================= wallet crypto =======================
const RETI = {
  evm: { nome: 'Ethereum e reti EVM', testo: 'Base, Arbitrum, Polygon, Ethereum: ETH, USDC, USDT, EURC.', wallet: 'MetaMask, Rabby, Coinbase Wallet' },
  solana: { nome: 'Solana', testo: 'SOL, USDC, USDT.', wallet: 'Phantom, Solflare, Backpack' },
  tron: { nome: 'Tron', testo: 'TRX e USDT.', wallet: 'TronLink' },
  bitcoin: { nome: 'Bitcoin', testo: 'BTC, sulla rete principale.', wallet: 'qualsiasi wallet Bitcoin' },
};
function wallet(io) {
  const tipi = [...new Set(io.reti.map(r => r.tipo))].filter(x => RETI[x]);
  return carta({ class: 'wallet' }, titoletto('Wallet crypto'),
    el('p', { class: 'tenue' }, t('Chi paga in crypto ti manda la tua parte dritta nel tuo wallet, in un attimo: nessuno la tiene in mezzo. Colleghi solo l\'indirizzo: le chiavi restano tue.')),
    el('div', { class: 'lista-righe' }, ...tipi.map(tipo => rigaWallet(io, tipo))));
}
function rigaWallet(io, tipo) {
  const a = io.wallet[tipo], r = RETI[tipo], m = messaggio(), azioni = el('div', { class: 'azioni' });
  const scollega = a ? el('button', { type: 'button', class: 'bottone fantasma piccolo', onclick: async e => {
    const b = e.currentTarget;
    if (await conferma(t('Scollegare il wallet {rete}?', { rete: t(r.nome) }), 'Senza, non ricevi più pagamenti in crypto su questa rete. Puoi ricollegarlo quando vuoi.', { si: 'Scollega', pericolo: true }))
      occupato(b, async () => { await chiama('POST', '/api/wallet/scollega', { tipo }); avviso('Wallet scollegato.'); await aggiorna('wallet'); }, m);
  } }, t('Scollega')) : null;
  const riga = el('div', { class: 'riga-wallet' },
    el('div', { class: 'cresce' }, el('strong', {}, t(r.nome)), ' ', a ? el('span', { class: 'pillola ok' }, t('collegato')) : el('span', { class: 'pillola' }, t('non collegato')),
      el('div', { class: 'tenue piccolo' }, t(r.testo)), a ? el('code', { class: 'indirizzo', title: a, 'data-no-t': '' }, a) : null, m), azioni);
  if (tipo === 'bitcoin') {
    const f = el('form', { class: 'riga-modulo', novalidate: true }, el('label', {}, el('span', { class: 'sr' }, t('Indirizzo Bitcoin')),
      el('input', { type: 'text', name: 'indirizzo', placeholder: 'bc1q…', autocomplete: 'off', spellcheck: 'false', value: '' })), el('button', { type: 'submit', class: 'bottone secondario piccolo' }, t(a ? 'Cambia' : 'Salva')));
    f.addEventListener('submit', e => {
      e.preventDefault();
      occupato(f.querySelector('button'), async () => { await chiama('POST', '/api/wallet/bitcoin', { indirizzo: f.elements.indirizzo.value }); f.reset(); avviso('Indirizzo Bitcoin salvato.'); await aggiorna('wallet'); }, m);
    });
    riga.querySelector('.cresce').append(f, el('p', { class: 'aiuto' }, t('Copialo dal tuo wallet: la somma di controllo ci protegge dagli errori di battitura.')));
    if (scollega) azioni.append(scollega);
    return riga;
  }
  // EVM, Solana e Tron: si prova di avere il wallet firmando un messaggio (non costa nulla e non sposta fondi)
  const prova = async (indirizzo, firmaFn) => {
    const { messaggio: testo } = await chiama('POST', '/api/wallet/sfida', { indirizzo, tipo });
    m.className = 'messaggio bene'; m.textContent = t('Firma il messaggio nel wallet: non costa nulla e non sposta fondi.');
    await chiama('POST', '/api/wallet/verifica', { firma: await firmaFn(testo) });
    avviso('Wallet collegato.'); await aggiorna('wallet');
  };
  const collega = el('button', { type: 'button', class: `bottone ${a ? 'secondario' : ''} piccolo`, onclick: () => occupato(collega, async () => {
    try {
      if (tipo === 'evm') { const ind = await account(); await prova(ind, x => firma(x, ind)); }
      else if (tipo === 'tron') { const { indirizzo } = await collegaTron(); await prova(indirizzo, firmaTron); }
      else if (tipo === 'solana') {
        const l = await walletSolana();
        if (!l.length) throw new Error(t('Nessun wallet Solana nel browser: installa Phantom, Solflare o Backpack, oppure apri questa pagina dal browser del tuo wallet sul telefono.'));
        const scelto = l.length === 1 ? l[0] : await scegliSolana(l);
        if (!scelto) return;
        const { indirizzo } = await collegaSolana(scelto.id); await prova(indirizzo, firmaSolana);
      }
    } catch (e) {
      m.className = 'messaggio';
      throw new Error(e?.code === 4001 || /reject|denied|annull|rifiut/i.test(e?.message || '') ? t('Collegamento annullato nel wallet.') : (e?.message || t('Collegamento annullato nel wallet.')));
    }
  }, m) }, t(a ? 'Cambia wallet' : 'Collega il wallet'));
  azioni.append(collega); if (scollega) azioni.append(scollega);
  riga.querySelector('.cresce').append(el('p', { class: 'aiuto' }, t('Con {wallet}.', { wallet: r.wallet })));
  return riga;
}
// più wallet Solana nel browser: si sceglie quale usare
function scegliSolana(lista) {
  return new Promise(ok => {
    const d = el('dialog', { class: 'finestra' }, el('h3', {}, t('Quale wallet Solana?')),
      el('div', { class: 'modulo' }, ...lista.map(w => el('button', { type: 'button', class: 'scelta', onclick: () => { d.close(); ok(w); } },
        el('span', {}, w.icona ? el('img', { src: w.icona, alt: '', class: 'icona-wallet' }) : null, ' ', w.nome)))),
      el('div', { class: 'azioni fine' }, el('button', { type: 'button', class: 'bottone secondario', onclick: () => { d.close(); ok(null); } }, t('Annulla'))));
    d.addEventListener('close', () => { d.remove(); ok(null); });
    document.body.append(d); d.showModal();
  });
}
