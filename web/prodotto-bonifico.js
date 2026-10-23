// I pagamenti diretti della pagina prodotto, sul conto della piattaforma e senza nessuna piattaforma in mezzo: con carta (la pagina
// di cassa del POS virtuale della banca) o con bonifico. Il modulo (attività, email, informativa), poi l'ordine: con la carta si va
// alla cassa della banca e si torna qui con l'esito; col bonifico una ricevuta con intestatario, IBAN, importo e causale da copiare
// e il QR che molte app delle banche leggono. Infine l'attesa: la pagina chiede ogni tanto se il pagamento è registrato.
import { el, t, euro, chiama, copia, svg, data } from './comune.js';

const ATTESA = 20e3, ATTESA_BANCA = 3e3;   // ogni quanto la pagina chiede se è pagato (solo mentre si vede); dopo la cassa più spesso

// il modulo firmato verso la pagina di cassa della banca: lo manda il browser, con un POST
function vaiAllaCassa(pos) {
  const f = el('form', { method: 'POST', action: pos.url, class: 'nascosto' }, ...Object.entries(pos.campi).map(([k, v]) => el('input', { type: 'hidden', name: k, value: v })));
  document.body.append(f); f.submit();
}

export function pannelloBonifico(p, slug, installatore, { rinnovo = null, aggiornamenti = () => false, codice = '', oppure = false, acquisto = null } = {}) {
  const b = p.bonifico, m = b.metodi || { bonifico: true, carta: false };
  const esitoBanca = codice ? new URLSearchParams(location.search).get('esito') : null;
  const nome = el('input', { type: 'text', name: 'nome', maxlength: '80', autocomplete: 'organization' });
  const email = el('input', { type: 'email', name: 'email', required: true, autocomplete: 'email', inputmode: 'email', placeholder: t('nome@attività.it') });
  const privacy = el('input', { type: 'checkbox', name: 'privacy', required: true });
  const trappola = el('input', { type: 'text', name: 'sito_web', tabindex: '-1', autocomplete: 'off' });
  const viaCarta = m.carta ? el('button', { class: 'bottone pieno', type: 'submit', value: 'carta' }) : null;
  const viaBonifico = m.bonifico ? el('button', { class: m.carta ? 'bottone secondario pieno' : 'bottone pieno', type: 'submit', value: 'bonifico' }) : null;
  const bottoni = [viaCarta, viaBonifico].filter(Boolean);
  const msg = el('div', { class: 'messaggio', role: 'alert' });
  const scelta = el('form', { class: 'modulo pp-cr-scelta', novalidate: true },
    el('div', { class: 'trappola', 'aria-hidden': 'true' }, el('label', {}, 'Sito web', trappola)),
    rinnovo ? null : el('label', {}, t('Il nome della tua attività (facoltativo)'), nome),
    el('label', {}, t('Email'), email, el('span', { class: 'aiuto' }, t('Ti mandiamo qui la conferma e, col bonifico, i dati per farlo.'))),
    el('label', { class: 'spunta' }, privacy, el('span', {}, t('Ho letto l\'informativa privacy'), ' · ', el('a', { href: '/privacy', target: '_blank' }, t('leggila')))),
    ...bottoni, msg);
  const ordine = el('div', { class: 'pp-ordine nascosto', 'aria-live': 'polite' });
  // il riassunto: l'installazione al prezzo di chi è scelto e l'assistenza per i mesi in anticipo (con gli aggiornamenti, se scelti)
  const sommario = el('p', { class: 'piccolo tenue' });
  const scriviSommario = () => {
    const ag = !rinnovo && aggiornamenti() ? b.aggiornamenti || 0 : 0, avvio = installatore()?.prezzo_avvio ?? p.prezzi?.da ?? 0;
    const totale = euro(rinnovo ? rinnovo.euro : avvio + b.canone + ag);
    sommario.textContent = rinnovo ? t('{mesi} mesi di assistenza in anticipo: {totale}.', { mesi: rinnovo.mesi, totale })
      : b.canone > 0 ? t('Installazione e {mesi} mesi di assistenza in anticipo: {totale}.', { mesi: b.mesi, totale })
        : t('Installazione: {totale}.', { totale });
    if (ag) sommario.append(' ', t('Compresi {mesi} mesi di aggiornamenti garantiti: {euro}.', { mesi: b.mesi, euro: euro(ag) }));
  };
  const titolo = m.carta && m.bonifico ? (oppure ? t('Oppure con carta o bonifico') : t('Con carta o bonifico')) : m.carta ? (oppure ? t('Oppure con carta') : t('Con carta')) : (oppure ? t('Oppure con bonifico') : t('Con bonifico'));
  const nodo = el('div', { class: 'pp-crypto pp-bonifico' },
    el('div', {}, el('p', { class: 'pp-cr-titolo' }, titolo),
      el('p', { class: 'piccolo tenue pp-cr-avviso' }, [m.carta ? t('Con la carta paghi sulla pagina sicura della banca, con la verifica della tua app.') : null,
        m.bonifico ? t('Il bonifico istantaneo arriva in pochi secondi e costa come uno normale.') : null].filter(Boolean).join(' '))),
    sommario, scelta, ordine);

  let attivo = null, orologio = null;   // attivo: { codice, installatore } dell'ordine aperto
  function aggiorna(i) {
    scriviSommario();
    if (attivo && attivo.installatore && i && attivo.installatore !== i.codice) { chiudi(); msg.textContent = t('Hai cambiato installatore: crea un nuovo ordine.'); }
    const ok = !!i?.bonifico;
    nodo.classList.toggle('nascosto', !!i && !ok && !attivo);   // chi non incassa sul conto della piattaforma: il pannello sparisce
    for (const x of bottoni) { x.disabled = !ok; x.textContent = !i ? t('Scegli chi lo installa') : x.value === 'carta' ? t('Paga con carta') : t('Paga con bonifico'); }
  }
  aggiorna(installatore());

  scelta.addEventListener('submit', async e => {
    e.preventDefault(); msg.textContent = '';
    const i = installatore(); if (!i?.bonifico) return;
    const metodo = e.submitter?.value === 'carta' || !m.bonifico ? 'carta' : 'bonifico', bottone = metodo === 'carta' ? viaCarta : viaBonifico;
    for (const c of [email, privacy]) c.removeAttribute('aria-invalid');
    if (!email.value.trim() || !email.checkValidity()) { email.setAttribute('aria-invalid', 'true'); msg.textContent = t('Email non valida: serve per mandarti la conferma'); email.focus(); return; }
    if (!privacy.checked) { privacy.setAttribute('aria-invalid', 'true'); msg.textContent = t('Per ordinare conferma di aver letto l\'informativa privacy'); return; }
    bottone.classList.add('carica'); for (const x of bottoni) x.disabled = true;
    try {
      const o = await chiama('POST', '/api/bonifico/ordine', { prodotto: slug, installatore: i.codice, metodo, email: email.value.trim(), nome: nome.value.trim() || undefined, privacy: true,
        sito_web: trappola.value, ...(rinnovo ? { rinnovo: rinnovo.k } : aggiornamenti() ? { aggiornamenti: true } : {}), ...(acquisto ? { acquisto } : {}) });
      // ricaricando (o tornando dalla banca), l'ordine resta
      history.replaceState(null, '', acquisto ? `${location.pathname}?a=${encodeURIComponent(acquisto)}&bonifico=${encodeURIComponent(o.codice)}` : `${location.pathname}?bonifico=${encodeURIComponent(o.codice)}#acquisto`);
      if (o.pos) { vaiAllaCassa(o.pos); await new Promise(() => {}); }   // il bottone resta in attesa finché la cassa della banca non si apre
      apri(o);
    } catch (err) { msg.textContent = err.message; }
    finally { bottone.classList.remove('carica'); aggiorna(installatore()); }
  });

  function chiudi() {
    clearInterval(orologio); orologio = null; attivo = null;
    ordine.replaceChildren(); ordine.classList.add('nascosto'); scelta.classList.remove('nascosto'); sommario.classList.remove('nascosto');
  }
  function apri(o, esito = null) {
    attivo = { codice: o.codice, installatore: o.installatoreCodice };
    nodo.classList.remove('nascosto'); scelta.classList.add('nascosto'); sommario.classList.add('nascosto'); ordine.classList.remove('nascosto');
    disegna(o, esito);
    if (o.stato === 'aperto' || o.stato === 'scaduto') controlla(o.codice, esito === 'ok' ? ATTESA_BANCA : ATTESA);
  }
  // un dato da copiare nella app della banca: l'IBAN senza spazi, gli altri come sono
  const riga = (etichetta, valore, copiato = valore) => el('div', { class: 'pp-parte' },
    el('div', { class: 'pp-parte-testa' }, el('span', { class: 'etichetta' }, t(etichetta)),
      el('button', { class: 'bottone fantasma piccolo', type: 'button', 'aria-label': t('Copia: {cosa}', { cosa: t(etichetta) }), onclick: e => copia(copiato, e.currentTarget) }, t('Copia'))),
    el('strong', { class: 'pp-bn-valore', 'data-no-t': '' }, valore));
  const dettaglio = o => el('ul', { class: 'pp-bn-righe' }, ...[
    o.avvio ? [t('Installazione'), o.avvio] : null,
    o.canone ? [t('{mesi} mesi di assistenza', { mesi: o.mesi }), o.canone] : null,
    o.aggiornamenti ? [t('Aggiornamenti garantiti'), o.aggiornamenti] : null,
    o.extra ? [t('Riattivazione dell\'assistenza'), o.extra] : null].filter(Boolean).map(([x, v]) => el('li', {}, el('span', {}, x), el('span', { 'data-no-t': '' }, euro(v)))));
  const daCapo = () => el('button', { class: 'bottone fantasma piccolo pp-annulla', type: 'button', onclick: () => { history.replaceState(null, '', `${location.pathname}#acquisto`); chiudi(); aggiorna(installatore()); } },
    t('Hai sbagliato qualcosa? Ricomincia'));
  // con la carta: cosa dice la banca al ritorno dalla cassa
  const ESITI = {
    ok: ['ok', 'La banca ha confermato il pagamento: un attimo che lo registriamo…'],
    ko: ['errore', 'La banca ha rifiutato il pagamento. Riprova, anche con un\'altra carta.'],
    annullo: ['attesa', 'Hai lasciato la pagina di pagamento: quando vuoi, riprova.'],
    diverso: ['attesa', 'La banca ha registrato un importo diverso da quello dell\'ordine: controlliamo e ti scriviamo noi.'],
    errore: ['errore', 'Qualcosa non è andato con la banca: riprova fra poco.'],
  };

  function disegna(o, esito = null) {
    if (o.stato === 'pagato') {
      if (acquisto && !o.rinnovo) { location.href = `/installa/${acquisto}`; return; }   // dalla cassa: si va a installarlo
      ordine.replaceChildren(el('div', { class: 'avviso ok', role: 'status' }, el('strong', {}, o.metodo === 'carta' ? t('Pagamento ricevuto, grazie!') : t('Bonifico ricevuto, grazie!')), ' ',
        o.rinnovo ? t('L\'assistenza è rinnovata.') : t('{nome} ti contatta per l\'appuntamento.', { nome: o.installatore })),
        o.assistenza ? el('a', { class: 'bottone pieno', href: o.assistenza }, t('La tua pagina di assistenza')) : null,
        el('p', { class: 'piccolo tenue' }, t('Salva quella pagina: da lì ci scrivi quando ti serve aiuto.')));
      return;
    }
    if (o.stato === 'annullato') {
      ordine.replaceChildren(el('div', { class: 'avviso attesa', role: 'status' }, t('Questo ordine è stato annullato. Se hai già pagato scrivici: lo ritroviamo dal codice {causale}.', { causale: o.causale })), daCapo());
      return;
    }
    if (o.metodo === 'carta') {   // ancora da pagare: il riepilogo e il bottone verso la cassa della banca
      const [tipo, testo] = ESITI[esito] || [];
      const paga = el('button', { class: 'bottone pieno', type: 'button' }, t('Paga con carta: {euro}', { euro: euro(o.euro) }));
      const errore = el('div', { class: 'messaggio', role: 'alert' });
      paga.addEventListener('click', async () => {
        paga.classList.add('carica'); paga.disabled = true; errore.textContent = '';
        try { const r = await chiama('POST', '/api/carta/avvio', { codice: o.codice }); vaiAllaCassa(r.pos); await new Promise(() => {}); }
        catch (err) { errore.textContent = err.message; paga.classList.remove('carica'); paga.disabled = false; }
      });
      ordine.replaceChildren(...[testo ? el('div', { class: `avviso ${tipo}`, role: 'status' }, t(testo)) : null,
        el('div', { class: 'pp-ricevuta' },
          el('div', { class: 'pp-ordine-testa' }, el('div', {}, el('span', { class: 'etichetta' }, t('Il tuo ordine')), el('strong', { class: 'pp-ordine-codice', 'data-no-t': '' }, o.causale))),
          dettaglio(o),
          el('div', { class: 'pp-totale' }, el('span', {}, t('Totale')), el('span', { class: 'pp-importo' }, el('strong', { 'data-no-t': '' }, euro(o.euro)))),
          el('div', { class: 'pp-barre', 'aria-hidden': 'true' })),
        esito === 'ok' ? null : paga, errore,
        el('p', { class: 'piccolo tenue' }, t('Paghi sulla pagina sicura della banca: i dati della carta non passano da noi.')),
        esito === 'ok' ? null : daCapo()].filter(Boolean));
      return;
    }
    const cifre = (o.euro / 100).toFixed(2), importo = document.documentElement.lang === 'en' ? cifre : cifre.replace('.', ',');
    ordine.replaceChildren(el('div', { class: 'pp-ricevuta' },
      el('div', { class: 'pp-ordine-testa' },
        el('div', {}, el('span', { class: 'etichetta' }, t('Causale del bonifico')), el('strong', { class: 'pp-ordine-codice', 'data-no-t': '' }, o.causale)),
        el('span', { class: 'pillola in_attesa' }, o.stato === 'scaduto' ? t('scaduto') : t('in attesa'))),
      el('p', {}, t('Scrivi la causale esattamente così: è quella che ci fa riconoscere il tuo pagamento.')),
      o.conto ? riga('Intestatario', o.conto.intestatario) : null,
      o.conto ? riga('IBAN', o.conto.iban, o.conto.iban.replace(/\s+/g, '')) : null,
      o.conto?.bic ? riga('BIC', o.conto.bic) : null,
      riga('Causale', o.causale),
      dettaglio(o),
      el('div', { class: 'pp-totale' }, el('span', {}, t('Importo')), el('span', { class: 'pp-importo' }, el('strong', { 'data-no-t': '' }, euro(o.euro)),
        el('button', { class: 'bottone fantasma piccolo', type: 'button', 'aria-label': t('Copia l\'importo'), onclick: e => copia(importo, e.currentTarget) }, t('Copia')))),
      o.qr ? el('div', { class: 'pp-qr-parte' }, el('div', { class: 'qr' }, svg(o.qr)),
        el('p', { class: 'piccolo' }, t('Dal telefono: inquadra il codice con l\'app della tua banca. Se lo legge, compila il bonifico da sola; se no, copia i dati qui sopra.'))) : null,
      el('div', { class: 'pp-barre', 'aria-hidden': 'true' })),
      el('div', { class: 'avviso attesa', role: 'status' }, o.stato === 'scaduto'
        ? t('L\'ordine è scaduto il {data}: se hai già fatto il bonifico va bene lo stesso, lo segniamo appena arriva.', { data: data(o.scade) })
        : t('Appena il bonifico arriva questa pagina si aggiorna da sola e ti scriviamo. L\'istantaneo arriva in pochi secondi, quello normale in un giorno lavorativo. L\'ordine vale fino al {data}.', { data: data(o.scade) })),
      el('p', { class: 'piccolo tenue' }, t('Hai solo una carta con IBAN (Postepay Evolution, Hype, Revolut, N26…)? Il bonifico lo fai dalla sua app. Questi dati ti arrivano anche per email.')),
      daCapo());
  }
  function controlla(k, ogni = ATTESA) {
    clearInterval(orologio);
    let giri = 0;
    orologio = setInterval(async () => {
      if (document.hidden || attivo?.codice !== k) return;
      // dopo la cassa della banca: un controllo ogni 3 secondi per un minuto, poi si torna al passo normale
      if (ogni === ATTESA_BANCA && ++giri > 20) { controlla(k, ATTESA); return; }
      try {
        const o = await chiama('GET', `/api/bonifico/ordine?codice=${encodeURIComponent(k)}`);
        if (o.stato !== 'aperto' && o.stato !== 'scaduto') { clearInterval(orologio); disegna(o); }
      } catch { }   // la rete che salta: si riprova al giro dopo
    }, ogni);
  }
  // tornando sulla pagina con ?bonifico=… (dall'email, ricaricando, o dalla cassa della banca con ?esito=…): l'ordine di prima
  if (codice) chiama('GET', `/api/bonifico/ordine?codice=${encodeURIComponent(codice)}`).then(o => apri(o, esitoBanca)).catch(e => { msg.textContent = e.message; });
  return { nodo, aggiorna };
}
