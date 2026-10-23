// Installazioni: gli acquisti dalla cassa che segui tu. Per ognuno a che punto è lo script, l'appuntamento chiesto dal cliente,
// le voci da personalizzare (le spunti tu, il cliente le vede sulla sua pagina) e il supporto a distanza: chiedi al titolare una
// diagnosi o un accesso a tempo; decide lui, l'agente sul server esegue.
import { el, t, chiama, occupato, avviso, copia, data, dataOra } from './comune.js';
import { blocco, aggiorna, carta, testa, vuoto, link, messaggio, pubblico } from './area-base.js';

const STATI = { prenotato: 'Prenotato', aperto: 'Da pagare', in_arrivo: 'Pagamento in arrivo', pagato: 'Pagato', respinto: 'Respinto' };
const INSTALLAZIONE = { da_fare: 'Da installare', in_corso: 'Script in corso', online: 'Online', errore: 'Script fermo' };
const DOVE = { mio: 'Lo installa il cliente', installatore: 'Lo installi tu', insieme: 'Decidete insieme' };
const PERIZIA = { chiesta: 'In attesa del titolare', accettata: 'Accettata', in_corso: 'Accesso aperto', fatta: 'Fatta', rifiutata: 'Rifiutata', revocata: 'Chiusa dal titolare', scaduta: 'Scaduta' };
const mailto = e => 'mailto:' + String(e).split('@').map(encodeURIComponent).join('@');

export function installazioni(radice) {
  radice.append(testa('Installazioni', 'I clienti che hanno comprato dalla cassa con te: a che punto sono, cosa resta da sistemare, il supporto a distanza.'), blocco('installazioni', elenco));
}
async function elenco() {
  const { installazioni: l } = await chiama('GET', '/api/area/installazioni');
  if (!l.length) return vuoto('Nessuna installazione, per ora', 'Quando un business compra con te dalla cassa, lo segui da qui: il comando, l\'appuntamento, la personalizzazione.', link('I tuoi link', '#installo', 'bottone'));
  return el('div', { class: 'pila' }, ...l.map(scheda));
}

function scheda(a) {
  const fatte = a.personalizza.filter(x => x.stato === 'fatto').length;
  return carta({ class: 'ai-scheda', 'data-chiave': `acq-${a.id}` },
    el('div', { class: 'titoletto' }, el('div', {},
      el('h3', {}, pubblico(a.attivita || a.nome || a.email), ' ', el('span', { class: 'tenue' }, '· ', pubblico(a.prodotto.nome))),
      el('span', { class: 'tenue piccolo' }, t('dal {data}', { data: data(a.creato) }), ' · ', t(DOVE[a.dove] || a.dove), a.dominio ? el('span', {}, ' · ', pubblico(a.dominio)) : null)),
      el('div', { class: 'chips' }, el('span', { class: `pillola ${a.stato}` }, t(STATI[a.stato] || a.stato)), el('span', { class: `pillola ${a.installazione === 'online' ? 'ok' : a.installazione === 'errore' ? 'fallita' : 'in_attesa'}` }, t(INSTALLAZIONE[a.installazione] || a.installazione)))),
    el('p', { class: 'piccolo' }, el('a', { href: mailto(a.email) }, pubblico(a.email)), a.telefono ? el('span', {}, ' · ', el('a', { href: `tel:${a.telefono.replace(/[^\d+]/g, '')}` }, pubblico(a.telefono))) : null,
      a.indirizzo ? el('span', {}, ' · ', el('a', { href: a.indirizzo, target: '_blank', rel: 'noopener' }, pubblico(a.indirizzo))) : null),
    a.appuntamento ? el('div', { class: 'avviso attesa' }, el('span', {}, el('strong', {}, t('Chiede un appuntamento')), ' (', dataOra(a.appuntamento.il), '): ', pubblico(a.appuntamento.quando.join(', ')),
      a.appuntamento.nota ? el('span', {}, ' — «', pubblico(a.appuntamento.nota), '»') : null)) : null,
    a.installazione === 'errore' ? el('div', { class: 'avviso errore' }, el('span', {}, el('strong', {}, t('Lo script si è fermato:')), ' ', pubblico(a.passi.at(-1)?.testo || t('errore sconosciuto')))) : null,
    el('details', { open: a.installazione !== 'online' || fatte < a.personalizza.length },
      el('summary', {}, t('Personalizzazione: {n} di {tot}', { n: fatte, tot: a.personalizza.length })),
      el('div', { class: 'ai-voci' }, ...a.personalizza.map(x => el('label', { class: 'ai-voce' }, el('span', {}, x.testo),
        el('select', { 'aria-label': x.testo, onchange: async e => {
          try { await chiama('POST', '/api/area/installazioni/voce', { id: a.id, voce: x.k, stato: e.target.value }); avviso('Salvato: il cliente lo vede sulla sua pagina'); aggiorna('installazioni', { rileggi: false }); }
          catch (err) { avviso(err.message, { errore: true }); }
        } }, ...['da_fare', 'in_corso', 'fatto'].map(s => el('option', { value: s, selected: x.stato === s }, t({ da_fare: 'Da fare', in_corso: 'In corso', fatto: 'Fatto' }[s])))))))),
    supporto(a));
}

function supporto(a) {
  const vivo = a.agente.visto && Date.now() - Date.parse(a.agente.visto.replace(' ', 'T') + 'Z') < 3 * 60e3;
  const attesa = a.perizie.some(p => p.stato === 'chiesta');
  return el('details', { class: 'ai-supporto', open: a.perizie.some(p => ['chiesta', 'accettata', 'in_corso'].includes(p.stato)) },
    el('summary', {}, t('Supporto a distanza'), ' ', el('span', { class: 'tenue piccolo' }, !a.agente.installato ? t('(agente non installato)') : vivo ? t('(agente collegato)') : t('(agente visto {q})', { q: a.agente.visto ? dataOra(a.agente.visto) : t('mai') }))),
    el('div', { class: 'pila' },
      ...a.perizie.map(p => el('div', { class: 'ai-perizia' },
        el('p', {}, el('span', { class: `pillola ${p.stato === 'fatta' ? 'ok' : ['rifiutata', 'revocata', 'scaduta'].includes(p.stato) ? 'fallita' : 'in_attesa'}` }, t(PERIZIA[p.stato] || p.stato)), ' ',
          el('strong', {}, t(p.tipo === 'accesso' ? 'Accesso di {ore} ore' : 'Diagnosi', { ore: p.ore })), ' ', el('span', { class: 'tenue piccolo' }, dataOra(p.chiesta))),
        el('blockquote', { class: 'citazione' }, pubblico(p.motivo)),
        p.ssh ? el('div', { class: 'ai-ssh' }, el('code', {}, p.ssh), el('button', { type: 'button', class: 'bottone piccolo secondario', onclick: e => copia(p.ssh, e.currentTarget) }, t('Copia')),
          p.scade ? el('span', { class: 'tenue piccolo' }, t('chiude da solo il {q}', { q: dataOra(p.scade) })) : null) : null,
        p.rapporto && p.tipo === 'diagnosi' ? el('details', {}, el('summary', {}, t('Il rapporto')), el('pre', { class: 'ai-rapporto', 'data-no-t': '' }, p.rapporto)) : null)),
      ['pagato', 'in_arrivo'].includes(a.stato) && a.agente.installato && !attesa ? chiedi(a)
        : !a.agente.installato ? el('p', { class: 'tenue piccolo' }, t('L\'agente arriva con il comando della pagina d\'installazione del cliente: senza, si lavora come sempre (o con il tasto Assistenza).'))
          : attesa ? el('p', { class: 'tenue piccolo' }, t('C\'è una richiesta in attesa: il titolare l\'ha ricevuta per email.')) : null));
}

function chiedi(a) {
  const msg = messaggio();
  const chiave = el('textarea', { name: 'chiave', rows: '2', spellcheck: 'false', placeholder: 'ssh-ed25519 AAAA… tu@pc' });
  const campoChiave = el('label', { class: 'nascosto' }, t('La tua chiave SSH pubblica'), chiave, el('span', { class: 'aiuto' }, t('Una riga, quella del file .pub. Viene tolta dal server alla scadenza.')));
  const ore = el('select', { name: 'ore' }, ...[1, 2, 4, 8, 24].map(h => el('option', { value: h, selected: h === 2 }, t(h === 1 ? '{n} ora' : '{n} ore', { n: h }))));
  const campoOre = el('label', { class: 'nascosto' }, t('Per quanto'), ore);
  const tipo = el('select', { name: 'tipo', onchange: e => { const acc = e.target.value === 'accesso'; campoChiave.classList.toggle('nascosto', !acc); campoOre.classList.toggle('nascosto', !acc); } },
    el('option', { value: 'diagnosi' }, t('Diagnosi: leggo lo stato del server')), el('option', { value: 'accesso' }, t('Accesso: entro nel server per sistemarlo')));
  const motivo = el('textarea', { name: 'motivo', rows: '2', maxlength: '400', placeholder: t('Es. il programma risponde lento da ieri: voglio guardare memoria e log') });
  const via = el('button', { type: 'submit', class: 'bottone piccolo' }, t('Chiedi al titolare'));
  return el('form', { class: 'modulo ai-chiedi', onsubmit: e => {
    e.preventDefault();
    occupato(via, async () => {
      await chiama('POST', '/api/area/perizia', { id: a.id, tipo: tipo.value, motivo: motivo.value.trim(), ...(tipo.value === 'accesso' ? { chiave: chiave.value.trim(), ore: Number(ore.value) } : {}) });
      avviso('Richiesta mandata: il titolare decide dalla sua pagina'); aggiorna('installazioni', { rileggi: false });
    }, msg);
  } }, el('div', { class: 'campi' }, el('label', {}, t('Cosa ti serve'), tipo), campoOre), el('label', {}, t('Perché (lo legge il titolare)'), motivo), campoChiave, el('div', { class: 'azioni' }, via), msg);
}
