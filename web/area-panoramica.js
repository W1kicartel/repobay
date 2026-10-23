// La panoramica, il banco di lavoro: la targa con il saluto e il ruolo, il cruscotto dei numeri,
// cosa fare adesso (la lista d'officina, con la linea di avanzamento) e il registro delle ultime notifiche.
import { el, t, chiama, euro, dataOra, occupato, conta } from './comune.js';
import { blocco, carta, titoletto, vuoto, link, messaggio, contatore } from './area-base.js';

export function panoramica(radice, io) {
  const nome = (io.nome || '').split(' ')[0];
  const ruoli = [io.prodotti.length || io.github ? 'builder' : null, io.adozioni.length ? 'installatore' : null,
    io.collaborazioni.some(c => c.stato === 'attivo') ? 'collaboratore' : null].filter(Boolean);
  // la figura del ruolo prevalente: chi ha GitHub o prodotti (e non installa di più) è builder, gli altri installano
  const prevale = (io.github || io.prodotti.length) && io.prodotti.length >= io.adozioni.length ? 'builder' : 'installatore';
  radice.append(
    el('div', { class: `targa ruolo-${prevale}` },
      el('div', { class: 'targa-testo' },
        el('h1', { class: 'piccolo' }, t('Ciao, {nome}.', { nome })),
        ruoli.length ? el('p', { class: 'ruoli-qui' }, el('span', {}, t('Sei qui come')), ...ruoli.map(r => el('span', { class: `adesivo ruolo-${r === 'collaboratore' ? 'builder collab' : r}` }, t(r))))
          : el('p', { class: 'tenue' }, t('Ti diamo il benvenuto. Da qui gestisci tutto il tuo lavoro sulla piattaforma.')),
        // la targhetta dati, come sulle macchine: chi sei per la piattaforma
        el('dl', { class: 'targhetta' },
          el('div', {}, el('dt', {}, t('Zona')), el('dd', { 'data-no-t': '' }, io.zona || '—')),
          io.github ? el('div', {}, el('dt', {}, 'GitHub'), el('dd', { 'data-no-t': '' }, `@${io.github}`)) : null,
          el('div', {}, el('dt', {}, t('Profilo')), el('dd', {}, el('a', { href: `/u/${io.codice}`, 'data-no-t': '' }, `/u/${io.codice}`)))))),
    blocco('numeri', numeri),
    el('div', { class: 'banco' }, blocco('passi', passi), blocco('ultime', ultime)),
  );
}

const pubblicati = n => t(n === 1 ? '{n} pubblicato' : '{n} pubblicati', { n });
function numeri(io) {
  const versato = io.totali.filter(x => x.stato === 'versata').reduce((s, x) => s + x.centesimi, 0);
  const attesa = io.totali.filter(x => x.stato === 'in_attesa').reduce((s, x) => s + x.centesimi, 0);
  const attivi = io.clienti.filter(c => c.stato === 'attivo').length;
  const prodotti = io.prodotti.length, installo = io.adozioni.length;
  return el('div', { class: 'cruscotto' },
    contatore({ n: '01', etichetta: 'Guadagnato', valore: euro(versato), nota: t('già versato sul tuo conto'), colore: 'menta', href: '#soldi' }),
    contatore({ n: '02', etichetta: 'In arrivo', valore: euro(attesa), nota: io.pronto ? t(io.fiscale ? 'arriva {n} giorni dopo ogni pagamento' : 'arriva {n} giorni dopo ogni pagamento, se hai inserito i dati fiscali', { n: io.trattenuta }) : t('collega il conto per riceverlo'), colore: 'sole', href: '#soldi' }),
    contatore({ n: '03', etichetta: 'Clienti attivi', valore: String(attivi), zeri: 3, nota: conta(io.clienti.length, 'cliente in tutto', 'clienti in tutto'), colore: 'segnale', href: '#vendite' }),
    prodotti || !installo
      ? contatore({ n: '04', etichetta: 'Prodotti', valore: String(prodotti), zeri: 3, colore: 'cobalto', href: '#prodotti',
        nota: installo ? conta(installo, 'prodotto che installi', 'prodotti che installi') : pubblicati(io.prodotti.filter(p => p.stato === 'pubblicato').length) })
      : contatore({ n: '04', etichetta: 'Installazioni', valore: String(installo), zeri: 3, nota: t('prodotti che offri'), colore: 'sole', href: '#installo' }));
}

// i passi, nell'ordine in cui conviene farli: quelli fatti restano spuntati, il primo che manca è «adesso»
function passi(io) {
  const tutti = [];
  const passo = (fatto, titolo, testo, azione) => tutti.push({ fatto, titolo, testo, azione });
  if (io.email) {
    const m = messaggio();
    const b = el('button', { type: 'button', class: 'bottone secondario piccolo', onclick: () => occupato(b, async () => { await chiama('POST', '/api/email/rinvia', {}); m.className = 'messaggio bene'; m.textContent = t('Mandata: controlla anche lo spam.'); }, m) }, t('Rimanda l\'email'));
    passo(io.emailVerificata, 'Conferma la tua email', 'Serve per ricevere le richieste e per recuperare il conto.', el('div', { class: 'azioni' }, b, m));
  } else passo(false, 'Aggiungi un\'email', 'Ti scriviamo solo per vendite, versamenti e sicurezza.', link('Aggiungi', '#sicurezza/email', 'bottone secondario piccolo'));
  passo(io.pronto, io.collegato ? 'Completa il conto Stripe' : 'Collega il conto Stripe', 'È lì che arrivano le tue parti dei pagamenti con carta.', link(io.collegato ? 'Completa' : 'Collega', '#soldi/stripe', 'bottone secondario piccolo'));
  passo(!!io.fiscale, 'Inserisci i dati fiscali', 'Servono per la DAC7 e per ricevere i versamenti: senza, le tue quote restano in attesa. Sono cifrati.', link('Inserisci', '#soldi/fiscale', 'bottone secondario piccolo'));
  if (io.github || io.prodotti.length) passo(io.prodotti.length > 0, 'Metti in vendita il primo progetto', 'Scegli un tuo repository open source e scegli la tua percentuale.', link('Inizia', '#prodotti', 'bottone secondario piccolo'));
  if (!io.github || io.adozioni.length) passo(io.adozioni.length > 0, 'Scegli il primo prodotto da installare', 'Dal catalogo, quelli che sai installare nella tua zona.', link('Apri il catalogo', '/esplora', 'bottone secondario piccolo'));
  passo(io.sicurezza.dueFattori || io.sicurezza.passkey.length > 0, 'Proteggi il conto', 'Attiva la verifica in due passaggi o aggiungi una passkey.', link('Attiva', '#sicurezza/2fa', 'bottone secondario piccolo'));
  for (const c of io.collaborazioni.filter(x => x.stato === 'invitato'))
    passo(false, t('Rispondi all\'invito per {prodotto}', { prodotto: c.nome }), t('{da} ti invita a mantenere il progetto insieme.', { da: c.builder }), link('Rispondi', '#installo/inviti', 'bottone secondario piccolo'));
  const fatti = tutti.filter(x => x.fatto).length, adesso = tutti.findIndex(x => !x.fatto);
  const n = i => String(i + 1).padStart(2, '0');
  // la linea di avanzamento: un tratto per passo, pieno se è fatto, con le tacche come su un righello
  const righello = el('div', { class: 'righello', role: 'progressbar', 'aria-label': t('Passi fatti'), 'aria-valuemin': '0', 'aria-valuemax': String(tutti.length), 'aria-valuenow': String(fatti) },
    ...tutti.map((x, i) => el('span', { class: `${x.fatto ? 'pieno' : ''}${i === adesso ? ' qui' : ''}`.trim() || null }, el('i', {}, n(i)))));
  return carta({ class: 'lista-officina' },
    titoletto('Cosa fare adesso', el('span', { class: 'conteggio' }, el('b', { 'aria-hidden': 'true' }, `${fatti}/${tutti.length}`), el('span', { class: 'sr' }, t('{fatti} di {tutti} fatti', { fatti, tutti: tutti.length })))),
    righello,
    el('ol', { class: 'lista-passi' }, ...tutti.map((x, i) => x.fatto
      ? el('li', { class: 'fatto' }, el('span', { class: 'n' }, n(i)), el('span', { class: 'casella', 'aria-hidden': 'true' }),
        el('span', { class: 'cresce' }, el('strong', {}, t(x.titolo))), el('span', { class: 'timbro' }, t('fatto')))
      : el('li', { class: i === adesso ? 'adesso' : null }, i === adesso ? el('span', { class: 'bandierina', 'aria-hidden': 'true' }, t('adesso')) : null, el('span', { class: 'n' }, n(i)), el('span', { class: 'casella', 'aria-hidden': 'true' }),
        el('div', { class: 'cresce' }, el('strong', {}, t(x.titolo)), el('p', { class: 'tenue piccolo' }, t(x.testo))), x.azione))),
    adesso < 0 ? el('p', { class: 'tutto-fatto' }, t('Tutto a posto: il conto è pronto per vendere e ricevere i pagamenti.')) : null,
  );
}

// il registro: le ultime cinque notifiche, con l'ora a sinistra
async function ultime() {
  const n = await chiama('GET', '/api/notifiche');
  const lista = n.notifiche.slice(0, 5);
  return carta({ class: 'registro' },
    titoletto('Ultime notifiche', link('Tutte', '#notifiche', 'bottone fantasma piccolo')),
    lista.length ? el('div', { class: 'righe-registro' }, ...lista.map(x => el('a', { href: x.link || '#notifiche', class: `riga-notifica${x.letta ? '' : ' nuova'}` },
      el('small', {}, dataOra(x.creata)), el('span', {}, x.testo))))
      : vuoto('Nessuna notifica, per ora', 'Qui vedrai vendite, versamenti, richieste e nuove versioni dei prodotti.'));
}
