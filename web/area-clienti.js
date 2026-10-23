// Vendite (i clienti, come builder o come installatore) e Richieste e recensioni (i business che ti scrivono, le recensioni
// ricevute con la tua risposta).
import { el, t, chiama, occupato, avviso, data, dataOra, stelle, conta, riga } from './comune.js';
import { blocco, aggiorna, carta, testa, titoletto, vuoto, link, messaggio, stato, ruolo, tabella, pubblico } from './area-base.js';
import { statoPagamento, avvisoPagamenti, finestraAssistenza } from './area-assistenza.js';
// un indirizzo email dentro un mailto: le parti codificate, così nessuno aggiunge destinatari o testo (?bcc=…)
const mailto = e => 'mailto:' + String(e).split('@').map(encodeURIComponent).join('@');

export function vendite(radice, io) {
  radice.append(testa('Vendite', 'I business che hanno comprato un tuo prodotto o che hai installato tu.'), blocco('vendite', tutte));
}
function tutte(io) {
  if (!io.clienti.length) return vuoto('Nessuna vendita, per ora',
    io.adozioni.length ? 'Dai il tuo link personale ai business della tua zona: chi compra da lì compare qui.' : 'Quando un business compra un tuo prodotto, o lo installi tu, compare qui.',
    io.adozioni.length ? link('I tuoi link', '#installo', 'bottone') : link('Apri il catalogo', '/esplora', 'bottone'));
  const attivi = io.clienti.filter(c => c.stato === 'attivo').length;
  // il pagamento e l'assistenza di ogni cliente; chi installa apre da qui il link, la bolla e il QR di assistenza
  return el('div', { class: 'pila' },
    el('div', { class: 'chips' }, el('span', { class: 'chip' }, conta(attivi, 'attivo', 'attivi')), el('span', { class: 'chip' }, conta(io.clienti.length, 'cliente in tutto', 'clienti in tutto'))),
    avvisoPagamenti(io.clienti),
    tabella(['Dal', 'Cliente', 'Prodotto', 'Tu sei', 'Pagamento e assistenza', ''], io.clienti.map(c => riga([data(c.creato),
      el('span', {}, pubblico(c.nome || '—'), c.email ? el('a', { class: 'piccolo blocco-riga', href: mailto(c.email) }, c.email) : null),
      pubblico(c.prodotto), ruolo(c.ruolo),
      el('span', {}, statoPagamento(c), c.aperte ? el('a', { class: 'piccolo blocco-riga', href: '#assistenza' }, t(c.aperte === 1 ? '{n} richiesta aperta' : '{n} richieste aperte', { n: c.aperte })) : null),
      c.chiave ? el('button', { type: 'button', class: 'bottone secondario piccolo', onclick: () => finestraAssistenza(c) }, t('Assistenza')) : '']))));
}

export function richieste(radice) {
  radice.append(testa('Richieste e recensioni', 'I business che ti hanno scritto dalla pagina di un prodotto, e quello che dicono di te.'),
    blocco('richieste', contatti), blocco('recensioni', recensioni));
}
function contatti(io) {
  return el('div', { class: 'pila' }, titoletto('Richieste dei business'),
    io.richieste.length ? el('div', { class: 'elenco' }, ...io.richieste.map(k => {
      const oggetto = t('Re: la tua richiesta su {prodotto}', { prodotto: k.prodotto || '' });
      return carta({ class: 'richiesta' },
        el('div', { class: 'titoletto' }, el('div', {}, el('h3', {}, pubblico(k.nome)), el('span', { class: 'tenue piccolo' }, k.prodotto ? t('per {prodotto}', { prodotto: k.prodotto }) : '', k.prodotto ? ' · ' : '', dataOra(k.creato)))),
        el('blockquote', { class: 'citazione', 'data-no-t': '' }, k.messaggio),
        el('div', { class: 'azioni' }, el('a', { class: 'bottone piccolo', href: `${mailto(k.email)}?subject=${encodeURIComponent(oggetto)}` }, t('Rispondi per email')),
          k.telefono ? el('a', { class: 'bottone secondario piccolo', href: `tel:${k.telefono.replace(/[^\d+]/g, '')}` }, t('Chiama {tel}', { tel: k.telefono })) : null,
          el('span', { class: 'tenue piccolo mono' }, k.email)));
    })) : vuoto('Nessuna richiesta', io.adozioni.length ? 'Quando un business ti scrive dalla pagina di un prodotto che installi, la richiesta arriva qui e per email.' : 'Le richieste arrivano a chi installa: scegli un prodotto dal catalogo per riceverne.',
      io.adozioni.length ? null : link('Apri il catalogo', '/esplora', 'bottone secondario')));
}
function recensioni(io) {
  return el('div', { class: 'pila' }, titoletto('Recensioni ricevute'),
    io.recensioni.length ? el('div', { class: 'elenco' }, ...io.recensioni.map(r => {
      const m = messaggio();
      let risposta;
      if (r.risposta) risposta = el('div', { class: 'risposta' }, el('div', { class: 'etichetta' }, t('La tua risposta')), el('p', { 'data-no-t': '' }, r.risposta));
      else {
        const f = el('form', { class: 'modulo', novalidate: true }, el('label', {}, el('span', {}, t('Rispondi (una volta sola, la vedono tutti)')),
          el('textarea', { name: 'testo', maxlength: '1000', rows: '3', placeholder: 'Grazie per la fiducia…', required: true })),
          el('div', { class: 'azioni' }, el('button', { type: 'submit', class: 'bottone secondario piccolo' }, t('Pubblica la risposta'))), m);
        f.addEventListener('submit', e => {
          e.preventDefault();
          if (f.elements.testo.value.trim().length < 2) { m.textContent = t('Scrivi la risposta'); return; }
          occupato(f.querySelector('button'), async () => { await chiama('POST', '/api/recensioni/rispondi', { cliente: r.cliente, testo: f.elements.testo.value }); avviso('Risposta pubblicata.'); await aggiorna('recensioni'); }, m);
        });
        risposta = el('details', { class: 'piega' }, el('summary', {}, t('Rispondi')), f);
      }
      return carta({ class: 'recensione' },
        el('div', { class: 'titoletto' }, el('div', {}, stelle(r.voto), ' ', el('strong', {}, pubblico(r.autore || t('Un cliente')))), el('span', { class: 'tenue piccolo' }, pubblico(r.prodotto), ' · ', data(r.creata))),
        r.testo ? el('p', { 'data-no-t': '' }, r.testo) : null, risposta);
    })) : vuoto('Nessuna recensione', 'I clienti possono lasciarne una dalla loro area, dopo l\'installazione.'));
}
