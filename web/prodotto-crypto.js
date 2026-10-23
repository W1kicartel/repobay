// Il pagamento in crypto della pagina prodotto: scelta di rete e moneta, l'ordine (prezzo bloccato per qualche minuto), il
// riepilogo di chi riceve cosa e il pagamento secondo la rete: EVM (wallet del browser, una conferma sola se si può), Solana
// (Wallet Standard o Solana Pay col telefono), Bitcoin (Leather, Xverse, UniSat o i QR) e Tron (TronLink o a mano).
// Alla fine la conferma sul server, con i tentativi, e il passaggio a /grazie?crypto=1.
import { el, t, euro, chiama, copia, svg } from './comune.js';
import { account, rete as cambiaRete, paga, ceWallet } from './wallet.js';
import { walletSolana, collegaSolana, inviaSolana } from './solana.js';
import { walletBitcoin, pagaBitcoin } from './bitcoin.js';
import { ceTron, collegaTron, pagaTron } from './tron.js';
import { durata } from './escrow.js';

const aspetta = ms => new Promise(r => setTimeout(r, ms));
const RUOLI = { builder: 'A chi l\'ha costruito', collaboratore: 'A chi lo mantiene', installatore: 'A chi lo installa', piattaforma: 'Alla piattaforma' };
const corto = a => (a.length > 16 ? `${a.slice(0, a.startsWith('bc1') || a.startsWith('tb1') ? 8 : 6)}…${a.slice(-5)}` : a);
// unità → numero col punto, per incollarlo nei wallet (0.00643152)
function decimale(unita, dec) {
  const u = BigInt(unita), d = 10n ** BigInt(dec), resto = (u % d).toString().padStart(dec, '0').replace(/0+$/, '');
  return `${u / d}${resto ? '.' + resto : ''}`;
}
// unità → testo leggibile nella lingua della pagina (it: 1.234,5678; en: 1,234.5678)
function leggibile(unita, dec, cifre = 8) {
  const u = BigInt(unita), d = 10n ** BigInt(dec), en = document.documentElement.lang === 'en';
  const resto = (u % d).toString().padStart(dec, '0').slice(0, cifre).replace(/0+$/, '');
  return `${(u / d).toLocaleString(en ? 'en-IE' : 'it-IT')}${resto ? (en ? '.' : ',') + resto : ''}`;
}
const messaggioWallet = e => (e?.code === 4001 || /reject|denied|annullat|cancel/i.test(e?.message || '') ? t('Hai annullato il pagamento nel wallet') : e?.message || t('Il wallet ha rifiutato il pagamento'));

export function pannelloCrypto(p, slug, installatore, { rinnovo = null, aggiornamenti = () => false, oppure = false, acquisto = null } = {}) {
  const c = p.crypto, protette = c.reti.filter(r => r.escrow), tutteProtette = protette.length > 0 && protette.length === c.reti.length;
  const rete = el('select', { name: 'rete' }, ...c.reti.map(r => el('option', { value: r.id }, r.prova ? t('{rete} (rete di prova)', { rete: r.nome }) : r.nome)));
  const moneta = el('select', { name: 'moneta' });
  const email = el('input', { type: 'email', name: 'email', autocomplete: 'email', inputmode: 'email', placeholder: t('nome@attività.it') });
  const via = el('button', { class: 'bottone secondario pieno', type: 'submit' });
  const msg = el('div', { class: 'messaggio', role: 'alert' });
  const scelta = el('form', { class: 'modulo pp-cr-scelta', novalidate: true },
    el('div', { class: 'campi pp-cr-campi' }, el('label', {}, t('Rete'), rete), el('label', {}, t('Moneta'), moneta)),
    el('label', {}, t('Email per la ricevuta (facoltativa)'), email),
    via, msg);
  const ordine = el('div', { class: 'pp-ordine nascosto', 'aria-live': 'polite' });
  // il riassunto: cosa si paga in anticipo e quanto (l'installazione al prezzo di chi è scelto, il canone dell'assistenza),
  // con gli aggiornamenti garantiti se scelti (per i mesi dell'ordine)
  const sommario = el('p', { class: 'piccolo tenue' });
  const scriviSommario = () => {
    const ag = !rinnovo && aggiornamenti() ? c.aggiornamenti || 0 : 0, totale = euro((rinnovo ? rinnovo.euro : installatore()?.totale_crypto ?? c.totale) + ag);
    sommario.textContent = rinnovo ? t('{mesi} mesi di assistenza in anticipo: {totale}. Paghi dal tuo wallet direttamente a chi lo installa e alla piattaforma (e a chi lo sviluppa, se hai gli aggiornamenti garantiti).', { mesi: rinnovo.mesi, totale })
      : tutteProtette
        ? t('Installazione e {mesi} mesi di assistenza in anticipo: {totale}. Il tuo wallet deposita tutto nel contratto escrow, con già scritto chi riceve cosa: nessuna persona tiene i soldi in mezzo.', { mesi: c.mesi, totale })
        : t('Installazione e {mesi} mesi di assistenza in anticipo: {totale}. Paghi dal tuo wallet direttamente a chi l\'ha costruito, a chi lo installa e alla piattaforma: nessuno tiene i soldi in mezzo.', { mesi: c.mesi, totale });
    if (ag) sommario.append(' ', t('Compresi {mesi} mesi di aggiornamenti garantiti: {euro}.', { mesi: c.mesi, euro: euro(ag) }));
  };
  scriviSommario();
  const nodo = el('div', { class: 'pp-crypto' },
    el('div', { class: 'pp-cr-testa' },
      el('figure', { class: 'pp-figura pp-cr-figura', 'aria-hidden': 'true' }, el('img', { src: '/img/crypto.webp', alt: '', width: '600', height: '600', loading: 'lazy', onerror: e => e.currentTarget.parentElement.classList.add('manca') })),
      el('div', {}, el('p', { class: 'pp-cr-titolo' }, t(p.carta === false && !oppure ? 'in crypto' : 'oppure in crypto')),
      el('p', { class: 'piccolo tenue pp-cr-avviso' }, tutteProtette
        ? t('In crypto il pagamento resta in un contratto escrow sulla blockchain finché non confermi l\'installazione, o per {n} giorni: se qualcosa va storto lo congeli e decide la piattaforma.', { n: p.trattenuta || 14 })
        : protette.length ? t('Sulle reti segnate «protetta» il pagamento resta in un contratto escrow finché non confermi l\'installazione; sulle altre va dritto nei wallet e la piattaforma non può rimborsarlo.')
          : t('In crypto il pagamento va dritto nei wallet di chi riceve e la piattaforma non può rimborsarlo: scegli chi ha già installazioni confermate.'), ' ', el('a', { href: '/garanzia' }, t('Come funziona'))),
        el('ul', { class: 'pp-cr-reti', 'aria-label': t('Reti') }, ...c.reti.map(r => el('li', { 'data-no-t': '' }, r.nome, r.escrow ? el('span', { class: 'pp-protetta' }, t('protetta')) : null))))),
    sommario, scelta, ordine);

  const monete = () => { const r = c.reti.find(x => x.id === rete.value); moneta.replaceChildren(...(r?.monete || []).map(m => el('option', { value: m }, m))); };
  rete.addEventListener('change', () => { monete(); aggiorna(installatore()); });

  function aggiorna(i) {
    scriviSommario();
    if (!ordine.classList.contains('nascosto') && attivo && attivo.installatore !== i?.codice) { chiudi(); msg.textContent = t('Hai cambiato installatore: crea un nuovo ordine.'); }
    else if (!ordine.classList.contains('nascosto') && attivo && !rinnovo && !!attivo.aggiornamenti !== aggiornamenti()) { chiudi(); msg.textContent = t('Hai cambiato gli aggiornamenti: crea un nuovo ordine.'); }
    const ok = new Set(i?.reti || []);
    for (const o of rete.options) o.disabled = !!i && !ok.has(o.value);
    if (i && !ok.has(rete.value)) { const primo = [...rete.options].find(o => !o.disabled); if (primo) { rete.value = primo.value; monete(); } }
    const niente = i && !ok.size;
    rete.disabled = moneta.disabled = !!niente;
    via.disabled = !i || niente;
    via.textContent = !i ? t('Scegli chi lo installa') : niente ? t('{nome} accetta solo la carta', { nome: i.nome }) : t('Continua in crypto');
  }
  monete(); aggiorna(installatore());

  scelta.addEventListener('submit', async e => {
    e.preventDefault(); msg.textContent = '';
    const i = installatore(); if (!i) return;
    if (email.value.trim() && !email.checkValidity()) { email.setAttribute('aria-invalid', 'true'); msg.textContent = t('Email non valida'); email.focus(); return; }
    email.removeAttribute('aria-invalid');
    via.classList.add('carica'); via.disabled = true;
    try {
      const o = await chiama('POST', '/api/crypto/ordine', { prodotto: slug, installatore: i.codice, rete: rete.value, simbolo: moneta.value, email: email.value.trim() || undefined,
        ...(rinnovo ? { rinnovo: rinnovo.k } : aggiornamenti() ? { aggiornamenti: true } : {}), ...(acquisto ? { acquisto } : {}) });
      apri(o, i);
    } catch (err) { msg.textContent = err.message; }
    finally { via.classList.remove('carica'); via.disabled = false; aggiorna(installatore()); }
  });

  // ---------------- l'ordine aperto ----------------
  let attivo = null;   // { o, installatore, giro } — «giro» cambia quando l'ordine si chiude: i controlli vecchi si fermano
  let giro = 0, orologio = null;
  function chiudi() {
    giro++; clearInterval(orologio); attivo = null;
    ordine.replaceChildren(); ordine.classList.add('nascosto'); scelta.classList.remove('nascosto');
  }

  function apri(o, i) {
    const mio = ++giro; attivo = { o, installatore: i.codice, aggiornamenti: !rinnovo && aggiornamenti() };
    const dec = o.moneta.decimali, sim = o.moneta.simbolo;
    const importo = u => `${leggibile(u, dec)} ${sim}`;
    const tempo = el('span', { class: 'pp-timer', 'data-no-t': '' });
    const stato = el('div', { class: 'avviso attesa nascosto', role: 'status' });
    const errore = el('div', { class: 'messaggio', role: 'alert' });
    const azioni = el('div', { class: 'pp-cr-azioni' });
    const dire = (testo, tipo = 'attesa') => { stato.className = `avviso ${tipo}`; stato.textContent = t(testo); errore.textContent = ''; };
    const sbaglio = testo => { stato.classList.add('nascosto'); errore.textContent = testo; };

    const totale = o.parti.reduce((s, x) => s + BigInt(x.unita), 0n);
    const parte = (x, { qr = false } = {}) => el('div', { class: 'pp-parte' },
      el('div', { class: 'pp-parte-testa' }, el('span', { class: `pp-a ${x.ruolo}` }, t(RUOLI[x.ruolo] || x.ruolo)), el('span', { class: 'pp-importo' }, el('strong', { 'data-no-t': '' }, importo(x.unita)), el('small', {}, euro(x.euro)))),
      el('div', { class: 'pp-indirizzo' }, el('code', { title: x.indirizzo, 'data-no-t': '' }, corto(x.indirizzo)),
        el('button', { class: 'bottone fantasma piccolo', type: 'button', 'aria-label': t('Copia l\'indirizzo'), onclick: e => copia(x.indirizzo, e.currentTarget) }, t('Copia'))),
      qr && x.qr ? el('div', { class: 'pp-qr-parte' }, el('div', { class: 'qr' }, svg(x.qr)),
        el('div', { class: 'pp-qr-dati' },
          el('button', { class: 'bottone secondario piccolo', type: 'button', onclick: e => copia(decimale(x.unita, dec), e.currentTarget) }, t('Copia l\'importo')),
          el('button', { class: 'bottone secondario piccolo', type: 'button', onclick: e => copia(x.indirizzo, e.currentTarget) }, t('Copia l\'indirizzo')),
          x.uri ? el('a', { class: 'bottone secondario piccolo', href: x.uri }, t('Apri nel wallet')) : null)) : null);

    ordine.replaceChildren(el('div', { class: 'pp-ricevuta' },
      el('div', { class: 'pp-ordine-testa' },
        el('div', {}, el('span', { class: 'etichetta' }, t('Il tuo ordine')), el('strong', { class: 'pp-ordine-codice', 'data-no-t': '' }, o.codice), o.rete.prova ? el('span', { class: 'pillola in_attesa' }, t('rete di prova')) : null),
        tempo),
      o.escrow ? el('div', { class: 'avviso ok pp-escrow' }, el('span', {}, el('strong', {}, t('Pagamento protetto.')), ' ',
        t('Il totale resta nel contratto escrow per {tempo}: lo sblocchi tu quando è installato, o si sblocca da solo. Se qualcosa va storto lo congeli dalla tua area e decide la piattaforma.', { tempo: durata(o.escrow.trattenuta) }),
        ' ', t('Il contratto:'), ' ', el('a', { href: `${o.rete.esploratore}/address/${o.escrow.indirizzo}`, target: '_blank', rel: 'noopener', class: 'mono', 'data-no-t': '' }, corto(o.escrow.indirizzo)))) : null,
      el('p', { class: 'pp-cambio' }, t('Su {rete} in {moneta}, al cambio di adesso: 1 {moneta} = {prezzo}.', { rete: o.rete.nome, moneta: sim, prezzo: euro(Math.round(o.prezzo * 100)) })),
      el('p', { class: 'etichetta pp-chi-riceve' }, t(o.escrow ? 'Chi riceve cosa, allo sblocco' : 'Chi riceve cosa')),
      el('div', { class: 'pp-parti' }, ...o.parti.map(x => parte(x, { qr: o.rete.tipo === 'bitcoin' }))),
      el('div', { class: 'pp-totale' }, el('span', {}, t('Totale')), el('span', { class: 'pp-importo' }, el('strong', { 'data-no-t': '' }, importo(totale)), el('small', {}, euro(o.euro)))),
      el('div', { class: 'pp-barre', 'aria-hidden': 'true' })),
      azioni, stato, errore,
      el('button', { class: 'bottone fantasma piccolo pp-annulla', type: 'button', onclick: () => { chiudi(); } }, t('Annulla e cambia rete')));
    scelta.classList.add('nascosto'); ordine.classList.remove('nascosto');

    // il prezzo vale fino a «scade»
    const scade = new Date(o.scade).getTime();
    const batti = () => {
      if (mio !== giro) return clearInterval(orologio);
      const s = Math.max(0, Math.round((scade - Date.now()) / 1000));
      if (s > 0) { tempo.textContent = t('Prezzo valido ancora {tempo}', { tempo: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }); tempo.classList.toggle('poco', s < 120); return; }
      clearInterval(orologio); tempo.textContent = t('Prezzo scaduto'); tempo.classList.add('poco');
      if (!attivo?.pagato) {
        for (const b of azioni.querySelectorAll('button')) b.disabled = true;
        ordine.insertBefore(el('div', { class: 'avviso errore' }, el('span', {}, o.rete.tipo === 'bitcoin' ? t('Il prezzo è scaduto. Se hai già pagato, resta qui: controlliamo ancora per qualche ora.') : t('Il prezzo è scaduto: crea un nuovo ordine al cambio di adesso.')),
          el('button', { class: 'bottone piccolo', type: 'button', onclick: () => { chiudi(); scelta.requestSubmit(); } }, t('Nuovo ordine'))), azioni);
      }
    };
    clearInterval(orologio); orologio = setInterval(batti, 1000); batti();

    // la conferma sul server: 200 pagato, 202 in attesa (ritenta), errore. Con «auto» si cerca il pagamento senza le transazioni.
    let controllo = 0;
    async function conferma(tx, { ogni = 10000, volte = 90, tollera = 4, auto = false } = {}) {
      const questo = ++controllo; let guasti = 0;
      if (!auto && attivo) attivo.pagato = true;
      dire(auto ? 'Cerchiamo il pagamento sulla rete…' : 'Pagamento inviato: controllo sulla blockchain…');
      for (let k = 0; k < volte; k++) {
        if (mio !== giro || questo !== controllo) return;
        try {
          const r = await chiama('POST', '/api/crypto/conferma', { codice: o.codice, tx });
          if (mio !== giro || questo !== controllo) return;
          if (r._stato === 200) { clearInterval(orologio); dire(o.escrow ? 'Deposito confermato. Un attimo…' : 'Pagamento confermato. Un attimo…', 'ok'); location.href = acquisto ? `/installa/${acquisto}` : o.escrow ? '/grazie?crypto=1&escrow=1' : '/grazie?crypto=1'; return; }
          dire(t('In attesa di conferme: {stato}', { stato: t(r.attesa || '…') })); guasti = 0;
        } catch (e) {
          if (mio !== giro || questo !== controllo) return;
          const rete_ = !e.stato || e.stato >= 500;
          if (rete_) { if (++guasti >= 6) { sbaglio(t('Non riusciamo a controllare il pagamento: {errore}', { errore: e.message })); break; } }
          else if (auto || k >= tollera) { sbaglio(e.message); break; }
        }
        await aspetta(ogni);
      }
      if (mio !== giro || questo !== controllo) return;
      if (stato.classList.contains('nascosto') === false) dire('Le conferme stanno tardando. Se hai pagato, il pagamento è sulla blockchain: resta qui o ricarica la pagina più tardi.');
      azioni.append(el('button', { class: 'bottone secondario piccolo', type: 'button', onclick: e => { e.currentTarget.remove(); conferma(tx, { ogni, volte, tollera: 0, auto }); } }, t('Controlla di nuovo')));
    }

    // un bottone che lancia il pagamento col wallet; dopo, la conferma
    const bottone = (testo, lavoro, { primo = true, icona = null } = {}) => {
      const b = el('button', { class: `bottone pieno ${primo ? '' : 'secondario'}`, type: 'button' }, icona ? el('img', { src: icona, alt: '', class: 'pp-icona-wallet' }) : null, testo);
      b.addEventListener('click', async () => {
        if (mio !== giro) return;
        errore.textContent = ''; b.classList.add('carica'); for (const x of azioni.querySelectorAll('button')) x.disabled = true;
        try { const r = await lavoro(); if (r) { for (const x of azioni.querySelectorAll('.pp-cr-paga')) x.remove(); await conferma(r.tx, r.opzioni); } }
        catch (e) { stato.classList.add('nascosto'); errore.textContent = messaggioWallet(e); }
        finally { b.classList.remove('carica'); if (Date.now() < scade || attivo?.pagato) for (const x of azioni.querySelectorAll('button')) x.disabled = false; }
      });
      return b;
    };
    const gruppo = (...figli) => el('div', { class: 'pp-cr-paga' }, ...figli);

    if (o.rete.tipo === 'evm') {
      const n = o.chiamate?.length || o.parti.length, esc = !!o.escrow;
      azioni.append(gruppo(
        bottone(t(esc ? 'Deposita con il wallet' : 'Paga con il wallet'), async () => {
          dire('Collega il wallet…'); const da = await account();
          dire('Controlla la rete nel wallet…'); await cambiaRete(o.rete);
          dire(esc ? 'Conferma il deposito nel wallet…' : o.moneta.nativo ? t('Conferma {n} pagamenti nel wallet, uno per destinatario…', { n }) : 'Conferma il pagamento nel wallet…');
          const tx = await paga(da, o.rete.chainId, o.chiamate, o.moneta.nativo, x => dire(x));
          return { tx, opzioni: { ogni: 10000, volte: 90 } };
        }),
        el('p', { class: 'aiuto' }, !ceWallet() ? t('Serve un wallet nel browser (MetaMask, Rabby, Coinbase Wallet) o il browser del tuo wallet sul telefono.')
          : esc ? (o.moneta.nativo ? t('Si apre il tuo wallet: una conferma, il deposito nel contratto.') : t('Si apre il tuo wallet: una conferma sola se lo permette, altrimenti due (l\'autorizzazione e il deposito).'))
            : o.moneta.nativo ? t('Si apre il tuo wallet: {n} conferme, una per destinatario.', { n }) : t('Si apre il tuo wallet: una conferma sola se lo permette, altrimenti {n}.', { n }))));
    }

    if (o.rete.tipo === 'solana') {
      const lista = el('div', { class: 'pp-cr-paga' }, el('div', { class: 'scheletro pp-sch-bottone' }));
      azioni.append(lista);
      walletSolana().then(w => {
        if (mio !== giro) return;
        lista.replaceChildren(...(w.length ? w.map((x, k) => bottone(t('Paga con {wallet}', { wallet: x.nome }), async () => {
          dire('Collega il wallet…'); const { indirizzo } = await collegaSolana(x.id);
          dire('Preparo la transazione…'); const r = await chiama('POST', '/api/solana/tx', { codice: o.codice, account: indirizzo });
          dire('Conferma il pagamento nel wallet…'); const firma = await inviaSolana(r.transazione, r.cluster);
          return { tx: [firma], opzioni: { ogni: 5000, volte: 120 } };
        }, { primo: k === 0, icona: x.icona && /^data:image\//.test(x.icona) ? x.icona : null }))
          : [el('div', { class: 'avviso' }, t('Nessun wallet Solana in questo browser: installa Phantom, Solflare o Backpack, oppure apri questa pagina dal browser del tuo wallet sul telefono.'))]));
      }).catch(e => { lista.replaceChildren(el('div', { class: 'avviso errore' }, e.message)); });
      if (o.solanaPay) {
        azioni.append(el('div', { class: 'pp-solanapay' }, el('p', { class: 'etichetta' }, t('Oppure col telefono')),
          el('div', { class: 'qr' }, svg(o.solanaPay.qr)),
          el('p', { class: 'aiuto' }, t('Inquadra il codice con Phantom o Solflare sul telefono. Controlliamo da soli ogni 5 secondi.')),
          el('a', { class: 'bottone secondario piccolo', href: o.solanaPay.link }, t('Apri nel wallet del telefono'))));
        conferma([], { ogni: 5000, volte: Math.ceil((scade - Date.now()) / 5000) + 120, auto: true });
      }
    }

    if (o.rete.tipo === 'bitcoin') {
      const w = walletBitcoin();
      azioni.append(el('div', { class: 'avviso attesa pp-btc-nota' }, t('Servono 2 conferme della rete Bitcoin: circa 20 minuti. Paga da qualsiasi wallet, anche un importo alla volta: controlliamo da soli ogni 15 secondi.')),
        w.length ? gruppo(...w.map((x, k) => bottone(t('Paga con {wallet}', { wallet: x.nome }), async () => {
          const tx = await pagaBitcoin(x.id, o.parti, { rete: o.rete.id, avviso: y => dire(y) });
          return { tx, opzioni: { ogni: 15000, volte: 480, tollera: 8 } };
        }, { primo: k === 0 })), el('p', { class: 'aiuto' }, t('Oppure inquadra i codici qui sopra, uno per destinatario.'))) : el('p', { class: 'aiuto' }, t('Inquadra i codici qui sopra col wallet del telefono, uno per destinatario, o copia indirizzo e importo.')));
      conferma([], { ogni: 15000, volte: 480, auto: true });
    }

    if (o.rete.tipo === 'tron') {
      const usdt = !!o.moneta.indirizzo;
      if (ceTron()) azioni.append(gruppo(bottone(t('Paga con TronLink'), async () => {
        dire('Collega TronLink…'); await collegaTron();
        const tx = await pagaTron({ m: o.moneta, parti: o.parti, rete: o.rete, memo: o.memo, avviso: y => dire(y) });
        return { tx, opzioni: { ogni: 10000, volte: 90 } };
      }), el('p', { class: 'aiuto' }, t('{n} conferme in TronLink, una per destinatario.', { n: o.parti.length }))));
      const incolla = el('textarea', { name: 'tx', rows: '3', placeholder: t('Un ID per riga (64 caratteri)'), spellcheck: 'false', class: 'mono' });
      const controlla = el('button', { class: 'bottone secondario pieno', type: 'button' }, t('Controlla il pagamento'));
      controlla.addEventListener('click', () => {
        const ids = [...new Set((incolla.value.match(/[0-9a-fA-F]{64}/g) || []).map(x => x.toLowerCase()))];
        if (!ids.length) { incolla.setAttribute('aria-invalid', 'true'); errore.textContent = t('Incolla gli ID delle transazioni: li trovi nel wallet, 64 caratteri ciascuno.'); return; }
        incolla.removeAttribute('aria-invalid'); conferma(ids, { ogni: 10000, volte: 60, tollera: 3 });
      });
      azioni.append(el('details', { class: 'pp-amano', open: !ceTron() },
        el('summary', {}, ceTron() ? t('Oppure paga a mano') : t('Paga a mano dal tuo wallet')),
        el('p', { class: 'aiuto' }, usdt ? t('Manda {moneta} sulla rete Tron (TRC-20) a ogni indirizzo, con l\'importo esatto.', { moneta: o.moneta.simbolo }) : t('Manda TRX a ogni indirizzo, con l\'importo esatto.')),
        el('div', { class: 'pp-memo' }, el('p', {}, t('In ogni pagamento scrivi questo codice nel campo nota (memo): senza, il pagamento non si collega al tuo ordine.')),
          el('div', { class: 'copia' }, el('code', { 'data-no-t': '' }, o.memo || ''), el('button', { class: 'bottone secondario piccolo', type: 'button', onclick: e => copia(o.memo || '', e.currentTarget) }, t('Copia')))),
        ...o.parti.map(x => el('div', { class: 'pp-parte pp-parte-qr' }, el('div', { class: 'pp-parte-testa' }, el('span', { class: `pp-a ${x.ruolo}` }, t(RUOLI[x.ruolo] || x.ruolo)), el('strong', { 'data-no-t': '' }, importo(x.unita))),
          el('div', { class: 'pp-qr-parte' }, el('div', { class: 'qr' }, svg(x.qr)), el('div', { class: 'pp-qr-dati' },
            el('code', { title: x.indirizzo, 'data-no-t': '' }, corto(x.indirizzo)),
            el('button', { class: 'bottone secondario piccolo', type: 'button', onclick: e => copia(decimale(x.unita, dec), e.currentTarget) }, t('Copia l\'importo')),
            el('button', { class: 'bottone secondario piccolo', type: 'button', onclick: e => copia(x.indirizzo, e.currentTarget) }, t('Copia l\'indirizzo')))))),
        el('label', {}, t('Poi incolla qui gli ID delle transazioni'), incolla), controlla));
    }
    ordine.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  return { nodo, aggiorna };
}
