// Integrazioni (webhook firmati con le ultime consegne; Telegram, Discord e Slack per le notifiche) e Sviluppatori (le chiavi
// dell'API, mostrate una volta sola).
import { el, t, chiama, occupato, conferma, avviso, copia, dataOra } from './comune.js';
import { blocco, aggiorna, carta, testa, titoletto, vuoto, bottone, link, messaggio, campo, stato } from './area-base.js';

const EVENTI = { 'vendita.nuova': 'Nuova vendita', 'crypto.pagato': 'Pagamento in crypto', 'abbonamento.cessato': 'Abbonamento chiuso', rimborso: 'Rimborso',
  'quota.versata': 'Quota versata', 'prodotto.pubblicato': 'Prodotto pubblicato', 'prodotto.respinto': 'Prodotto respinto', 'prodotto.sospeso': 'Prodotto sospeso',
  'installatore.nuovo': 'Nuovo installatore', 'collaborazione.invito': 'Invito a collaborare', 'release.nuova': 'Nuova versione', 'contatto.nuovo': 'Nuova richiesta',
  'recensione.nuova': 'Nuova recensione', 'progetto.rivendicato': 'Progetto rivendicato', 'percentuale.cambiata': 'Percentuale cambiata', 'livello.nuovo': 'Top seller',
  'mancia.ricevuta': 'Mancia ricevuta', '*': 'Tutti gli eventi' };
const nomeEvento = e => t(EVENTI[e] || e);
let dati = null;   // GET /api/integrazioni, condiviso dai blocchi della sezione
const leggi = async () => (dati = await chiama('GET', '/api/integrazioni'));

// una cosa da mostrare una volta sola (il segreto del webhook, la chiave dell'API)
function unaVolta(titolo, valore, testo) {
  const b = el('button', { type: 'button', class: 'bottone piccolo', onclick: () => copia(valore, b) }, t('Copia'));
  return el('div', { class: 'bolla una-volta', role: 'status' }, el('span', { class: 'bollino' }, t('una volta sola')), el('div', { class: 'cresce' }, el('strong', {}, t(titolo)), el('p', { class: 'piccolo' }, t(testo)),
    el('div', { class: 'copia' }, el('code', { 'data-no-t': '' }, valore), b)));
}

// ======================= Integrazioni =======================
export async function integrazioni(radice) {
  await leggi();
  radice.append(testa('Integrazioni', 'Ricevi le notifiche dove lavori già, o collega i tuoi sistemi con i webhook.'),
    blocco('chat', chat), blocco('webhook', webhook));
}

function chat() {
  const d = dati;
  const voce = (nome, testo, collegato, corpo, tipo) => {
    const m = messaggio();
    const scollega = collegato ? el('button', { type: 'button', class: 'bottone fantasma piccolo', onclick: async e => {
      const b = e.currentTarget;
      if (await conferma(t('Scollegare {nome}?', { nome }), 'Non riceverai più le notifiche lì. Puoi ricollegarlo quando vuoi.', { si: 'Scollega', pericolo: true }))
        occupato(b, async () => { await chiama('POST', '/api/integrazioni/scollega', { tipo }); avviso('Scollegato.'); await leggi(); await aggiorna('chat', { rileggi: false }); }, m);
    } }, t('Scollega')) : null;
    return el('div', { class: 'riga-wallet' }, el('div', { class: 'cresce' }, el('strong', {}, nome), ' ', collegato ? el('span', { class: 'pillola ok' }, t('collegato')) : el('span', { class: 'pillola' }, t('non collegato')),
      el('div', { class: 'tenue piccolo' }, t(testo)), collegato ? null : corpo(m), m), el('div', { class: 'azioni' }, scollega));
  };
  const incolla = (tipo, segnaposto, aiuto) => m => {
    const f = el('form', { class: 'riga-modulo', novalidate: true }, el('label', {}, el('span', { class: 'sr' }, t('URL del webhook')),
      el('input', { type: 'url', name: 'url', placeholder: segnaposto, autocomplete: 'off', spellcheck: 'false' })), el('button', { type: 'submit', class: 'bottone secondario piccolo' }, t('Collega')));
    f.addEventListener('submit', e => {
      e.preventDefault();
      occupato(f.querySelector('button'), async () => { await chiama('POST', `/api/integrazioni/${tipo}`, { url: f.elements.url.value }); avviso('Collegato: ti abbiamo mandato un messaggio di prova.'); await leggi(); await aggiorna('chat', { rileggi: false }); }, m);
    });
    return el('div', {}, f, el('p', { class: 'aiuto' }, t(aiuto)));
  };
  const telegram = m => {
    if (!d.telegram.disponibile) return el('p', { class: 'aiuto' }, t('Telegram non è attivo su questa piattaforma.'));
    const box = el('div', { class: 'azioni' });
    const b = el('button', { type: 'button', class: 'bottone secondario piccolo', onclick: () => occupato(b, async () => {
      const r = await chiama('POST', '/api/integrazioni/telegram', {});
      box.replaceChildren(el('a', { class: 'bottone piccolo', href: r.link, target: '_blank', rel: 'noopener' }, t('Apri il bot su Telegram')),
        el('span', { class: 'tenue piccolo' }, t('Premi «Avvia» nel bot. Il link vale 15 minuti.')),
        el('button', { type: 'button', class: 'bottone fantasma piccolo', onclick: async () => { await leggi(); await aggiorna('chat', { rileggi: false }); } }, t('Fatto, controlla')));
    }, m) }, t('Collega Telegram'));
    box.append(b); return box;
  };
  return carta({}, titoletto('Notifiche in chat'),
    el('p', { class: 'tenue' }, t('Le stesse notifiche dell\'area, nella chat che usi. Scegli quali in Notifiche.')),
    el('div', { class: 'lista-righe' },
      voce('Telegram', 'Un messaggio dal nostro bot, in privato.', d.telegram.collegato, telegram, 'telegram'),
      voce('Discord', 'In un canale del tuo server.', d.discord, incolla('discord', 'https://discord.com/api/webhooks/…', 'Impostazioni del canale → Integrazioni → Webhook → Copia URL.'), 'discord'),
      voce('Slack', 'In un canale del tuo workspace.', d.slack, incolla('slack', 'https://hooks.slack.com/services/…', 'Crea un «Incoming Webhook» nella tua app Slack e incollane l\'URL.'), 'slack')));
}

function webhook() {
  const d = dati, nuovo = el('div', {});
  const lista = d.agganci.length ? el('div', { class: 'elenco' }, ...d.agganci.map(a => {
    const m = messaggio();
    const ricarica = async () => { await leggi(); await aggiorna('webhook', { rileggi: false }); };
    return el('div', { class: 'aggancio' },
      el('div', { class: 'titoletto' }, el('code', { class: 'url', 'data-no-t': '' }, a.url), a.attivo ? stato('attivo') : el('span', { class: 'pillola sospeso' }, t('spento'))),
      el('div', { class: 'chips' }, ...a.eventi.map(e => el('span', { class: 'chip' }, nomeEvento(e)))),
      !a.attivo ? el('p', { class: 'aiuto' }, t('Spento dopo {n} consegne fallite di fila. Controlla l\'indirizzo e riattivalo.', { n: a.falliti })) : null,
      el('div', { class: 'azioni' },
        bottone('Manda una prova', 'secondario piccolo', e => occupato(e.currentTarget, async () => {
          const r = await chiama('POST', '/api/agganci/prova', { id: a.id });
          avviso(r.stato === 'consegnata' ? t('Prova consegnata (risposta {r}).', { r: r.risposta || '200' }) : t('La prova non è arrivata: {r}', { r: r.risposta || t('nessuna risposta') }), { errore: r.stato !== 'consegnata' });
          await ricarica();
        }, m)),
        !a.attivo ? bottone('Riattiva', 'piccolo', e => occupato(e.currentTarget, async () => { await chiama('POST', '/api/agganci/riattiva', { id: a.id }); avviso('Webhook riattivato.'); await ricarica(); }, m)) : null,
        bottone('Elimina', 'pericolo piccolo', async e => {
          const b = e.currentTarget;
          if (await conferma('Eliminare questo webhook?', a.url, { si: 'Elimina', pericolo: true }))
            occupato(b, async () => { await chiama('POST', '/api/agganci/elimina', { id: a.id }); avviso('Webhook eliminato.'); await ricarica(); }, m);
        })), m,
      el('details', { class: 'piega' }, el('summary', {}, t('Ultime consegne ({n})', { n: a.consegne.length })),
        a.consegne.length ? el('div', { class: 'lista-righe consegne' }, ...a.consegne.map(c => el('div', {},
          el('span', {}, nomeEvento(c.evento), el('span', { class: 'tenue piccolo' }, ` · ${dataOra(c.creata)}`)),
          el('span', { class: 'azioni' }, c.risposta ? el('code', { class: 'piccolo', 'data-no-t': '' }, String(c.risposta).slice(0, 40)) : null,
            c.tentativi > 1 ? el('span', { class: 'tenue piccolo' }, t('{n} tentativi', { n: c.tentativi })) : null, stato(c.stato)))))
          : el('p', { class: 'tenue piccolo' }, t('Nessuna consegna, per ora.'))));
  })) : vuoto('Nessun webhook', 'Un webhook manda ogni evento (una vendita, un versamento…) al tuo indirizzo, firmato con un segreto.');
  return carta({}, titoletto('Webhook', d.agganci.length < 10 ? bottone('Aggiungi un webhook', 'secondario piccolo', () => { nuovo.replaceChildren(moduloWebhook(nuovo)); nuovo.querySelector('input')?.focus(); }) : null),
    el('p', { class: 'tenue' }, t('Ogni richiesta ha l\'intestazione X-Firma (HMAC-SHA256 del corpo con il tuo segreto). Se l\'indirizzo non risponde riproviamo, poi lo spegniamo.'), ' ',
      el('a', { href: '/sviluppatori#webhook' }, t('Come verificarla'))),
    nuovo, lista);
}
function moduloWebhook(box) {
  const m = messaggio();
  const tutti = el('input', { type: 'checkbox', name: 'tutti', checked: true });
  const scelte = dati.eventi.map(e => el('label', { class: 'spunta' }, el('input', { type: 'checkbox', name: 'evento', value: e, disabled: true }), el('span', {}, nomeEvento(e), ' ', el('code', { class: 'piccolo', 'data-no-t': '' }, e))));
  tutti.addEventListener('change', () => scelte.forEach(s => { s.querySelector('input').disabled = tutti.checked; }));
  const f = el('form', { class: 'modulo nuovo-aggancio', novalidate: true },
    campo('Indirizzo (https)', el('input', { type: 'url', name: 'url', placeholder: 'https://example.com/webhook', required: true, autocomplete: 'off', spellcheck: 'false' })),
    el('fieldset', { class: 'eventi' }, el('legend', {}, t('Quali eventi')), el('label', { class: 'spunta' }, tutti, el('span', {}, t('Tutti gli eventi, anche quelli futuri'))), el('div', { class: 'griglia-eventi' }, ...scelte)),
    el('div', { class: 'azioni' }, el('button', { type: 'submit', class: 'bottone' }, t('Aggiungi')), el('button', { type: 'button', class: 'bottone fantasma', onclick: () => box.replaceChildren() }, t('Annulla'))), m);
  f.addEventListener('submit', e => {
    e.preventDefault();
    const eventi = tutti.checked ? ['*'] : [...f.querySelectorAll('input[name=evento]:checked')].map(x => x.value);
    if (!eventi.length) { m.textContent = t('Scegli almeno un evento'); return; }
    occupato(f.querySelector('button[type=submit]'), async () => {
      const r = await chiama('POST', '/api/agganci', { url: f.elements.url.value.trim(), eventi });
      await leggi(); await aggiorna('webhook', { rileggi: false });
      document.querySelector('[data-blocco="webhook"] .titoletto')?.after(unaVolta('Webhook aggiunto. Ecco il segreto per verificare la firma', r.segreto, 'Copialo adesso e salvalo nel tuo sistema: non lo mostreremo più.'));
    }, m);
  });
  return f;
}

// ======================= Sviluppatori =======================
export async function sviluppatori(radice) {
  await leggi();
  const base = location.origin;
  radice.append(testa('Sviluppatori', 'Le chiavi per leggere i tuoi dati con la REST API: prodotti, adozioni, vendite, quote.',
    link('Documentazione', '/sviluppatori', 'bottone secondario'), el('a', { class: 'bottone fantasma', href: '/api/v1/openapi.json', target: '_blank', rel: 'noopener' }, 'OpenAPI')),
    blocco('chiavi', chiavi),
    carta({}, titoletto('Prova subito'), el('p', { class: 'tenue' }, t('Ogni richiesta porta la chiave nell\'intestazione Authorization. Al massimo 120 richieste al minuto per chiave.')),
      el('pre', {}, el('code', { 'data-no-t': '' }, `curl -H "Authorization: Bearer ak_…" \\\n  ${base}/api/v1/io`))));
}
function chiavi() {
  const d = dati, nuova = el('div', {}), m = messaggio();
  const f = el('form', { class: 'riga-modulo', novalidate: true }, campo('Nome della chiave', el('input', { type: 'text', name: 'nome', maxlength: '60', placeholder: 'es. Script contabilità' })),
    el('button', { type: 'submit', class: 'bottone' }, t('Crea la chiave')));
  f.addEventListener('submit', e => {
    e.preventDefault();
    occupato(f.querySelector('button'), async () => {
      const r = await chiama('POST', '/api/chiavi', { nome: f.elements.nome.value });
      f.reset(); await leggi(); await aggiorna('chiavi', { rileggi: false });
      document.querySelector('[data-blocco="chiavi"] .nuova-chiave')?.replaceChildren(unaVolta('Ecco la tua chiave', r.chiave, 'Copiala adesso: per sicurezza non la mostreremo più. Se la perdi, revocala e creane un\'altra.'));
    }, m);
  });
  return carta({}, titoletto('Chiavi dell\'API'),
    d.chiavi.length < 10 ? f : el('p', { class: 'aiuto' }, t('Hai 10 chiavi attive: revocane una per crearne un\'altra.')), m,
    el('div', { class: 'nuova-chiave' }, nuova),
    d.chiavi.length ? el('div', { class: 'lista-righe' }, ...d.chiavi.map(k => {
      const mm = messaggio();
      return el('div', {}, el('div', { class: 'cresce' }, el('strong', { 'data-no-t': '' }, k.nome), ' ', el('code', { class: 'piccolo', 'data-no-t': '' }, `${k.inizio}…`),
        el('div', { class: 'tenue piccolo' }, t('creata il {d}', { d: dataOra(k.creata) }), ' · ', k.usata ? t('usata l\'ultima volta il {d}', { d: dataOra(k.usata) }) : t('mai usata')), mm),
        bottone('Revoca', 'pericolo piccolo', async e => {
          const b = e.currentTarget;
          if (await conferma(t('Revocare «{nome}»?', { nome: k.nome }), 'Chi la usa riceverà subito un errore. Non si può annullare.', { si: 'Revoca', pericolo: true }))
            occupato(b, async () => { await chiama('POST', '/api/chiavi/revoca', { id: k.id }); avviso('Chiave revocata.'); await leggi(); await aggiorna('chiavi', { rileggi: false }); }, mm);
        }));
    })) : vuoto('Nessuna chiave', 'Crea una chiave per collegare i tuoi script o la tua contabilità.'));
}
