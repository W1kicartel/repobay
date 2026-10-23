// La pagina d'installazione (/installa/<codice>): il codice nel link è la chiave, la riceve per email chi ha pagato.
//   01 installa: il comando che fa tutto da solo (con i passi in diretta), oppure l'appuntamento con chi installa
//   02 personalizza: le voci che chi installa sistema con te (dominio, marchio, utenti, dati, backup, prova)
//   03 supporto a distanza: l'agente sul server non fa niente senza il sì del titolare; qui le richieste, gli accessi aperti, i rapporti
//   04 conferma: tutto funziona (resta sul profilo di chi ha installato; con carta le quote partono comunque dopo la trattenuta)
import { el, t, chiama, occupato, avviso, copia, avatar, conferma, data, dataOra, pronta } from './comune.js';

await pronta;
const codice = location.pathname.split('/')[2], q = new URLSearchParams(location.search);
const piano = matchMedia('(prefers-reduced-motion: reduce)').matches;
const pagina = document.getElementById('pagina'), carico = document.getElementById('carico');
const PASSI = { avvio: 'Controllo il server', docker: 'Preparo Docker', agente: 'Installo l\'agente di supporto', scarico: 'Scarico il programma',
  configuro: 'Scrivo le impostazioni di partenza', accendo: 'Accendo il programma', online: 'Online' };
const STATI_ACQUISTO = { aperto: 'In attesa di pagamento', prenotato: 'Prenotato', in_arrivo: 'Pagamento in arrivo', pagato: 'Pagato', respinto: 'Pagamento respinto' };
const STATI_PERIZIA = { chiesta: 'Da decidere', accettata: 'Accettata', in_corso: 'Accesso aperto', fatta: 'Fatta', rifiutata: 'Rifiutata', revocata: 'Chiusa da te', scaduta: 'Scaduta' };
const VOCE = { da_fare: 'Da fare', in_corso: 'In corso', fatto: 'Fatto' };
let v = null, appena = q.has('s'), tentativi = 0;
// quello che stai scrivendo nell'appuntamento sopravvive agli aggiornamenti della pagina
const bozza = { quando: new Set(), nota: '', motivo: 'installa' };

async function leggi() {
  v = await chiama('GET', `/api/installa?k=${encodeURIComponent(codice)}`);
  return v;
}

// ogni quanto rileggere: spesso mentre lo script lavora o un accesso si apre, piano il resto del tempo; mai a pagina nascosta
function giro() {
  const vivo = v.installazione === 'in_corso' || v.perizie.some(p => p.stato === 'accettata') || (appena && ['aperto', 'in_arrivo'].includes(v.stato) && tentativi < 30);
  setTimeout(async () => {
    if (document.visibilityState === 'visible') {
      tentativi++;
      const prima = JSON.stringify(v);
      try { await leggi(); if (JSON.stringify(v) !== prima) disegna(); } catch { }
    }
    giro();
  }, vivo ? 3000 : 20000);
}
addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') leggi().then(disegna).catch(() => {}); });

const pagato = () => ['pagato', 'in_arrivo'].includes(v.stato);
const prossimo = () => {
  if (!pagato()) return 0;
  if (v.installazione !== 'online') return 1;
  if (v.personalizza.some(x => x.stato !== 'fatto') && !v.confermato) return 2;
  return v.confermato ? 4 : 3;
};

function disegna() {
  const i = v.installatore || {}, fatte = v.personalizza.filter(x => x.stato === 'fatto').length;
  document.title = `${v.prodotto.nome} · ${t('La tua installazione')} · ${document.title.split('·').pop().trim()}`;
  const tappe = [['Pagato', pagato()], ['Installato', v.installazione === 'online'], ['Personalizzato', fatte === v.personalizza.length], ['Confermato', !!v.confermato]];
  const ora = prossimo();
  pagina.replaceChildren(
    el('div', { class: 'cs-testa ins-testa' },
      el('div', {},
        el('p', { class: 'numero-sezione', dati: { n: 'RB' } }, t('La tua installazione')),
        el('h1', {}, el('span', { 'data-no-t': '' }, v.prodotto.nome), ' ', el('span', { class: `ins-stato s-${v.stato}` }, t(STATI_ACQUISTO[v.stato] || v.stato))),
        el('p', { class: 'cs-sotto' }, v.attivita ? el('span', { 'data-no-t': '' }, `${v.attivita} · `) : null, t('installato da'), ' ', el('strong', { 'data-no-t': '' }, i.nome || ''))),
      el('ol', { class: 'ins-tappe', 'aria-label': t('A che punto sei') }, ...tappe.map(([x, ok], j) => el('li', { dati: { stato: ok ? 'fatto' : j === ora ? 'ora' : 'poi' } },
        el('span', { class: 'ins-tappa-n', 'aria-hidden': 'true' }, ok ? '✓' : String(j + 1).padStart(2, '0')), el('span', {}, t(x)))))),
    avvisoPagamento() || '',
    el('div', { class: 'cs-griglia ins-griglia' },
      el('div', { class: 'ins-sezioni' }, sezioneInstalla(), sezionePersonalizza(), sezioneSupporto(), sezioneConferma()),
      el('aside', { class: 'cs-lato ins-lato' }, chiTiSegue(), riepilogo())));
  if (location.hash && !disegna.fatto) { disegna.fatto = true; document.querySelector(location.hash)?.scrollIntoView({ block: 'start' }); }
}

function avvisoPagamento() {
  if (v.stato === 'pagato') return null;
  if (v.stato === 'in_arrivo') return el('div', { class: 'avviso attesa ins-avviso' }, el('span', {}, el('strong', {}, t('Il pagamento è partito.')), ' ', t('Con l\'addebito SEPA arriva in pochi giorni lavorativi: il comando per installarlo si accende da solo, non devi fare niente.')));
  if (v.stato === 'prenotato') return el('div', { class: 'avviso ins-avviso' }, el('span', {}, el('strong', {}, t('Prenotazione registrata.')), ' ', t('{nome} ti scrive per conoscerti. Quando i pagamenti aprono ti mandiamo il link per pagare: da lì in poi, tutto si fa da questa pagina.', { nome: v.installatore?.nome || '' })));
  // un ordine con bonifico o in crypto già aperto: niente carta di nuovo, si aspetta quello (il bonifico si rivede dalla cassa)
  const o = v.ordine;
  if (o && ['aperto', 'respinto'].includes(v.stato)) return el('div', { class: 'avviso attesa ins-avviso', role: 'status' }, el('span', {},
    el('strong', {}, t(o.metodo === 'bonifico' ? 'Aspettiamo il tuo bonifico.' : 'Aspettiamo la conferma del pagamento in crypto.')), ' ',
    t(o.metodo === 'bonifico' ? 'Appena arriva, il comando per installarlo si accende da solo: non devi pagare di nuovo.' : 'Appena la rete conferma la transazione, il comando per installarlo si accende da solo: non devi pagare di nuovo.'),
    o.metodo === 'bonifico' && o.codice ? [' ', el('a', { href: `/compra/${v.prodotto.slug}?a=${encodeURIComponent(codice)}&bonifico=${encodeURIComponent(o.codice)}` }, t('Rivedi i dati del bonifico'))] : null));
  if (appena && v.stato === 'aperto' && tentativi < 30) return el('div', { class: 'avviso attesa ins-avviso', role: 'status' }, el('span', { class: 'ins-gira', 'aria-hidden': 'true' }), el('span', {}, el('strong', {}, t('Stiamo ricevendo la conferma del pagamento…')), ' ', t('Di solito bastano pochi secondi.')));
  return el('div', { class: `avviso ${v.stato === 'respinto' ? 'errore' : 'attesa'} ins-avviso` }, el('span', {},
    el('strong', {}, t(v.stato === 'respinto' ? 'Il pagamento è stato respinto dalla banca.' : 'Il pagamento non è ancora arrivato.')), ' ',
    t('Puoi pagare di nuovo dalla cassa: quello che avevi scelto è ancora lì.'), ' ', el('a', { href: `/compra/${v.prodotto.slug}?a=${encodeURIComponent(codice)}` }, t('Torna alla cassa'))));
}

const sezione = (id, n, titolo, sotto, ...corpo) => el('section', { class: 'ins-sezione carta', id, 'aria-labelledby': `t-${id}` },
  el('div', { class: 'ins-sez-testa' }, el('span', { class: 'cs-num', 'aria-hidden': 'true' }, el('span', { class: 'cs-num-n' }, n)),
    el('div', {}, el('h2', { id: `t-${id}` }, titolo), sotto ? el('p', { class: 'cs-guida' }, sotto) : null)), ...corpo);

// ---------------- 01 installa ----------------
function sezioneInstalla() {
  const i = v.installatore || {}, online = v.installazione === 'online';
  const scelta = online ? null : el('div', { class: 'ins-dove', role: 'radiogroup', 'aria-label': t('Chi lo installa') }, ...[
    ['mio', 'Lo installo io', 'un comando, pochi minuti'], ['installatore', 'Lo installa {nome}', 'fissi un appuntamento'], ['insieme', 'Insieme', 'in videochiamata']].map(([k, x, sotto]) =>
    el('label', { class: 'ins-dove-voce' }, el('input', { type: 'radio', name: 'dove', value: k, class: 'sr', checked: v.dove === k,
      onchange: async () => { try { await chiama('POST', '/api/installa/dove', { k: codice, dove: k }); v.dove = k; disegna(); } catch (e) { avviso(e.message, { errore: true }); } } }),
      el('strong', {}, t(x, { nome: i.nome || '' })), el('span', {}, t(sotto)))));
  // l'appuntamento compare anche a programma online (per personalizzarlo) e dopo un errore (per farsi aiutare): quando lo chiedi
  // da qui, o se la richiesta mandata era per quello
  const chiesto = m => bozza.motivo === m || v.appuntamento?.motivo === m;
  let corpo;
  if (online) corpo = chiesto('personalizza') ? el('div', { class: 'pila' }, fatto(), appuntamento('personalizza')) : fatto();
  else if (v.installazione === 'errore') corpo = el('div', { class: 'pila' }, inErrore(), chiesto('aiuto') ? appuntamento('aiuto') : null, comando(), avanzamento());
  else if (v.dove === 'mio' || v.installazione === 'in_corso') corpo = el('div', { class: 'pila' }, requisiti(), comando(), avanzamento());
  else corpo = appuntamento('installa');
  return sezione('installa', '01', online ? t('Installato') : t('Installalo'), online ? null
    : t('Il programma arriva già configurato con impostazioni di partenza che funzionano. Le scelte su misura (dominio, marchio, utenti) le fate dopo, insieme.'), scelta, corpo);
}
function requisiti() {
  return el('details', { class: 'ins-requisiti' }, el('summary', {}, t('Cosa serve')),
    el('ul', {}, el('li', {}, t('Un server o un computer Linux sempre acceso (Ubuntu o Debian), con almeno 2 GB di memoria')),
      el('li', {}, t('Accesso da amministratore (sudo) e una connessione a internet')),
      el('li', {}, t('Non ce l\'hai? Va bene un server da pochi euro al mese: chiedi a chi installa quale prendere'))));
}
function comando() {
  if (!v.comando) return el('div', { class: 'ins-term spento' }, el('pre', { 'data-no-t': '', 'aria-hidden': 'true' }, '$ curl -fsSL ••••••••••••••••.sh | sudo bash'),
    el('p', {}, t(v.stato === 'prenotato' ? 'Il comando compare qui dopo il pagamento.' : 'Il comando si accende appena arriva il pagamento.')));
  const b = el('button', { type: 'button', class: 'bottone piccolo ins-copia', onclick: e => copia(v.comando, e.currentTarget) }, t('Copia'));
  return el('div', { class: 'ins-term' },
    el('p', { class: 'cs-r-et' }, t('Incolla nel terminale del server')),
    el('div', { class: 'ins-term-riga' }, el('pre', { 'data-no-t': '' }, el('span', { class: 'cs-term-pr' }, '$ '), v.comando), b),
    el('details', { class: 'ins-cosafa' }, el('summary', {}, t('Cosa fa questo comando')),
      el('ol', {}, ...Object.entries(PASSI).filter(([k]) => k !== 'online').map(([k, x]) => el('li', {}, t(x), k === 'agente' ? el('span', { class: 'tenue' }, ' — ', t('non fa niente senza il tuo sì: vedi «Supporto a distanza»')) : null))),
      el('p', { class: 'tenue piccolo' }, t('Le password nuove restano sul tuo server, in un file che può leggere solo l\'amministratore. A noi arriva solo a che punto è.'))));
}
function avanzamento() {
  const visti = new Map(v.passi.map(x => [x.passo, x])), ultimo = v.passi.at(-1);
  if (!v.passi.length) return el('p', { class: 'ins-attesa' }, el('span', { class: 'ins-punto', 'aria-hidden': 'true' }), t('Quando lanci il comando, qui vedi ogni passo in diretta.'));
  const ordine = v.ordinePassi || Object.keys(PASSI), ora = ordine.findIndex(k => !visti.has(k));
  return el('ol', { class: 'ins-passi', 'aria-live': 'polite' }, ...ordine.map((k, j) => {
    const x = visti.get(k), stato = x ? 'fatto' : v.installazione === 'errore' && j === ora ? 'errore' : j === ora ? 'ora' : 'poi';
    return el('li', { dati: { stato } }, el('span', { class: 'ins-passo-ico', 'aria-hidden': 'true' }, stato === 'fatto' ? '✓' : stato === 'errore' ? '!' : ''),
      el('span', {}, t(PASSI[k] || k)), x?.il ? el('time', { class: 'tenue' }, dataOra(x.il)) : null);
  }), ultimo?.testo && v.installazione !== 'online' ? el('li', { class: 'ins-passo-nota', 'data-no-t': '' }, ultimo.testo) : null);
}
function inErrore() {
  const u = v.passi.at(-1);
  return el('div', { class: 'avviso errore' }, el('span', {}, el('strong', {}, t('L\'installazione si è fermata.')), ' ', u?.testo ? el('span', { 'data-no-t': '' }, u.testo) : null, ' ',
    t('Puoi rilanciare il comando: riparte da dove serve. Oppure chiedi a {nome}, che è già stato avvisato.', { nome: v.installatore?.nome || '' }),
    ' ', el('a', { href: '#appuntamento', onclick: () => { bozza.motivo = 'aiuto'; appuntamento.cambia = true; disegna(); } }, t('Chiedi aiuto'))));
}
function fatto() {
  const cred = `sudo cat ${v.cartella}/CREDENZIALI.txt`;
  return el('div', { class: 'ins-online' },
    el('div', { class: 'ins-online-testa' }, el('span', { class: 'ins-online-luce', 'aria-hidden': 'true' }), el('strong', {}, t('È online')),
      v.indirizzo ? el('a', { class: 'bottone', href: v.indirizzo, target: '_blank', rel: 'noopener' }, t('Apri il programma'), ' ↗') : null),
    v.indirizzo ? el('p', { class: 'ins-indirizzo', 'data-no-t': '' }, v.indirizzo) : null,
    el('p', {}, t('Le password per il primo accesso sono sul tuo server. Per leggerle:')),
    el('div', { class: 'ins-term-riga ins-term-chiaro' }, el('pre', { 'data-no-t': '' }, cred), el('button', { type: 'button', class: 'bottone piccolo secondario', onclick: e => copia(cred, e.currentTarget) }, t('Copia'))),
    el('p', { class: 'tenue piccolo' }, t('L\'indirizzo con il tuo dominio e il certificato li collega {nome} nella personalizzazione.', { nome: v.installatore?.nome || '' })));
}

// l'appuntamento: i momenti che ti vanno bene (i prossimi giorni feriali) e due righe
function appuntamento(motivo) {
  const i = v.installatore || {}, a = v.appuntamento;
  if (a && !appuntamento.cambia) return el('div', { class: 'ins-appunt fatto', id: 'appuntamento' },
    el('p', {}, el('strong', {}, t('Richiesta mandata a {nome}', { nome: i.nome || '' })), ' · ', el('span', { class: 'tenue' }, dataOra(a.il))),
    el('p', { class: 'tenue' }, t('Ti va bene:'), ' ', el('span', { 'data-no-t': '' }, a.quando.join(', '))),
    el('p', {}, t('Ti risponde per email{tel}. Se preferisci, scegli un orario dal suo calendario.', { tel: v.telefono ? t(' o al telefono') : '' })),
    el('div', { class: 'azioni' }, i.calendario ? el('a', { class: 'bottone secondario', href: i.calendario, target: '_blank', rel: 'noopener' }, t('Apri il suo calendario')) : null,
      el('button', { type: 'button', class: 'bottone fantasma', onclick: () => { appuntamento.cambia = true; disegna(); } }, t('Cambia orari'))));
  if (motivo !== 'installa' || !bozza.motivo) bozza.motivo = motivo;
  const giorni = [], d = new Date();
  while (giorni.length < 6) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) giorni.push(new Date(d)); }
  const fmt = new Intl.DateTimeFormat(document.documentElement.lang === 'en' ? 'en-IE' : 'it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
  const msg = el('div', { class: 'messaggio', role: 'alert' });
  const griglia = el('div', { class: 'ins-slot', role: 'group', 'aria-label': t('Quando ti va bene') }, ...giorni.map(g => el('div', { class: 'ins-slot-giorno' },
    el('span', { class: 'ins-slot-data' }, fmt.format(g)), ...['mattina', 'pomeriggio', 'sera'].map(f => {
      const k = `${fmt.format(g)} ${t(f)}`;
      return el('label', { class: 'ins-slot-voce' }, el('input', { type: 'checkbox', class: 'sr', checked: bozza.quando.has(k), onchange: e => { e.target.checked ? bozza.quando.add(k) : bozza.quando.delete(k); } }), el('span', {}, t(f)));
    }))));
  const nota = el('textarea', { name: 'nota', maxlength: '600', rows: '3', placeholder: t('Es. il server ce l\'ho già, è un Synology in negozio'), oninput: e => { bozza.nota = e.target.value; } }, bozza.nota);
  const via = el('button', { type: 'submit', class: 'bottone' }, t('Manda la richiesta a {nome}', { nome: i.nome || '' }));
  return el('form', { class: 'ins-appunt modulo', id: 'appuntamento', onsubmit: e => {
    e.preventDefault();
    if (!bozza.quando.size) { msg.textContent = t('Scegli almeno un momento che ti va bene'); return; }
    occupato(via, async () => { await chiama('POST', '/api/installa/appuntamento', { k: codice, quando: [...bozza.quando], nota: bozza.nota, motivo: bozza.motivo }); appuntamento.cambia = false; bozza.quando.clear(); bozza.nota = ''; await leggi(); disegna(); avviso('Richiesta mandata'); }, msg);
  } },
    el('p', { class: 'cs-guida' }, t(bozza.motivo === 'aiuto' ? 'Quando può aiutarti {nome}? Scegli tutti i momenti che ti vanno bene.' : bozza.motivo === 'personalizza' ? 'Quando personalizzate il programma? Scegli tutti i momenti che ti vanno bene.' : 'Quando può installarlo {nome}? Scegli tutti i momenti che ti vanno bene.', { nome: i.nome || '' })),
    griglia, el('label', {}, t('Due righe per chi installa (facoltativo)'), nota),
    el('div', { class: 'azioni' }, via, i.calendario ? el('a', { class: 'bottone fantasma', href: i.calendario, target: '_blank', rel: 'noopener' }, t('Oppure apri il suo calendario')) : null), msg);
}

// ---------------- 02 personalizza ----------------
function sezionePersonalizza() {
  const tot = v.personalizza.length, ok = v.personalizza.filter(x => x.stato === 'fatto').length, i = v.installatore || {};
  const barra = el('div', { class: 'ins-barra', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(tot), 'aria-valuenow': String(ok), 'aria-label': t('{n} di {tot} fatte', { n: ok, tot }) }, el('span'));
  barra.firstChild.style.width = `${tot ? ok / tot * 100 : 0}%`;
  return sezione('personalizza', '02', t('Personalizzalo con {nome}', { nome: i.nome || '' }),
    t('Le impostazioni di partenza funzionano, ma il programma è tuo: queste voci le sistemate insieme. Chi installa le spunta man mano.'),
    el('div', { class: 'ins-barra-testa' }, el('strong', {}, t('{n} di {tot} fatte', { n: ok, tot })), barra),
    el('ul', { class: 'ins-voci' }, ...v.personalizza.map(x => el('li', { dati: { stato: x.stato } }, el('span', { class: 'ins-voce-ico', 'aria-hidden': 'true' }, x.stato === 'fatto' ? '✓' : ''),
      el('span', {}, x.testo), el('span', { class: `ins-voce-stato` }, t(VOCE[x.stato]))))),
    v.dove !== 'mio' || v.installazione === 'online'
      ? (v.appuntamento && !appuntamento.cambia && (v.installazione !== 'online' || v.appuntamento.motivo === 'personalizza') ? null : el('button', { type: 'button', class: 'bottone secondario', onclick: () => { bozza.motivo = 'personalizza'; appuntamento.cambia = true; v.dove = v.dove === 'mio' ? 'insieme' : v.dove; disegna(); document.getElementById('appuntamento')?.scrollIntoView({ behavior: piano ? 'auto' : 'smooth' }); } }, t('Fissa un appuntamento per personalizzarlo')))
      : null);
}

// ---------------- 03 supporto a distanza ----------------
function sezioneSupporto() {
  const ag = v.agente, vivo = ag.visto && Date.now() - Date.parse(ag.visto.replace(' ', 'T') + (ag.visto.includes('T') ? '' : 'Z')) < 3 * 60e3;
  const chieste = v.perizie.filter(p => p.stato === 'chiesta'), aperte = v.perizie.filter(p => ['accettata', 'in_corso'].includes(p.stato)), storia = v.perizie.filter(p => !['chiesta', 'accettata', 'in_corso'].includes(p.stato));
  return sezione('supporto', '03', t('Supporto a distanza'),
    t('Con il programma si installa un piccolo agente di supporto. Da solo non fa niente: quando chi installa deve guardare il server o entrarci per sistemarlo, la richiesta arriva qui e per email, e decidi tu. Ogni passo resta scritto qui sotto.'),
    el('div', { class: `ins-agente ${ag.installato ? (vivo ? 'vivo' : 'fermo') : 'manca'}` }, el('span', { class: 'ins-agente-luce', 'aria-hidden': 'true' }),
      el('span', {}, el('strong', {}, t(!ag.installato ? 'Agente non ancora installato' : vivo ? 'Agente collegato' : 'Agente installato')), ' ',
        el('span', { class: 'tenue' }, !ag.installato ? t('arriva con il comando d\'installazione') : ag.visto ? t('ultimo contatto {quando}', { quando: dataOra(ag.visto) }) : t('in attesa del primo contatto')))),
    ...chieste.map(richiesta), ...aperte.map(aperta),
    !chieste.length && !aperte.length ? el('p', { class: 'ins-niente' }, t('Nessuna richiesta. Se ne arriva una, ti scriviamo.')) : null,
    storia.length ? el('details', { class: 'ins-storia' }, el('summary', {}, t('Lo storico ({n})', { n: storia.length })), el('ul', {}, ...storia.map(passata))) : null,
    el('details', { class: 'ins-come' }, el('summary', {}, t('Come funziona, nel dettaglio')),
      el('ul', {},
        el('li', {}, el('strong', {}, t('Diagnosi:')), ' ', t('l\'agente legge spazio, memoria, contenitori e gli ultimi errori del programma, nasconde password e chiavi e manda il rapporto. Nessuno entra. Il rapporto lo vedi anche tu.')),
        el('li', {}, el('strong', {}, t('Accesso:')), ' ', t('l\'agente mette la chiave di chi installa su un utente apposta (repobay-supporto) per le ore che hai accettato. Alla scadenza, o quando la chiudi tu, la chiave viene tolta: anche se il server non riesce a parlarci.')),
        el('li', {}, el('strong', {}, t('Vuoi toglierlo?')), ' ', t('Sul server:'), ' ', el('code', { 'data-no-t': '' }, 'sudo systemctl disable --now repobay-agente.timer'), '. ', t('Il programma continua a funzionare.')))));
}
function richiesta(p) {
  const acc = p.tipo === 'accesso';
  const si = el('button', { type: 'button', class: 'bottone', onclick: async () => {
    if (acc && !await conferma(t('Aprire l\'accesso per {ore} ore?', { ore: p.ore }), t('{chi} potrà entrare nel server come utente repobay-supporto fino alla scadenza. Puoi chiudere prima in qualsiasi momento.', { chi: p.chi || t('Chi installa') }), { si: 'Apri l\'accesso' })) return;
    occupato(si, async () => { await chiama('POST', '/api/installa/perizia', { k: codice, id: p.id, si: true }); await leggi(); disegna(); avviso(acc ? 'Accesso accettato: si apre entro un minuto' : 'Diagnosi accettata: parte entro un minuto'); });
  } }, t(acc ? 'Accetta l\'accesso' : 'Accetta la diagnosi'));
  const no = el('button', { type: 'button', class: 'bottone secondario', onclick: () => occupato(no, async () => { await chiama('POST', '/api/installa/perizia', { k: codice, id: p.id, si: false }); await leggi(); disegna(); avviso('Richiesta rifiutata'); }) }, t('Rifiuta'));
  return el('div', { class: `ins-richiesta ${acc ? 'accesso' : ''}`, role: 'group', 'aria-label': t('Richiesta da decidere') },
    el('div', { class: 'ins-richiesta-testa' }, el('span', { class: 'cs-tag sole' }, t('Da decidere')), el('strong', {}, acc ? t('{chi} chiede di entrare nel server per {ore} ore', { chi: p.chi || t('Chi installa'), ore: p.ore }) : t('{chi} chiede una diagnosi', { chi: p.chi || t('Chi installa') })),
      el('span', { class: 'tenue' }, dataOra(p.chiesta))),
    el('blockquote', { class: 'citazione', 'data-no-t': '' }, p.motivo),
    el('p', { class: 'tenue piccolo' }, acc ? t('Entra come utente repobay-supporto, con una chiave che scade da sola.') : t('Legge lo stato del server: password e chiavi restano nascoste, nessuno entra.')),
    el('div', { class: 'azioni' }, si, no));
}
function aperta(p) {
  const acc = p.tipo === 'accesso', resta = p.scade ? Math.max(0, Date.parse(p.scade) - Date.now()) : 0;
  const ore = Math.floor(resta / 3600e3), min = Math.ceil((resta % 3600e3) / 60e3);
  const chiudi = acc ? el('button', { type: 'button', class: 'bottone pericolo piccolo', onclick: async () => {
    if (!await conferma(t('Chiudere l\'accesso adesso?'), t('La chiave viene tolta dal server entro un minuto.'), { si: 'Chiudi l\'accesso', pericolo: true })) return;
    occupato(chiudi, async () => { await chiama('POST', '/api/installa/perizia/revoca', { k: codice, id: p.id }); await leggi(); disegna(); avviso('Accesso chiuso'); });
  } }, t('Chiudi l\'accesso adesso')) : null;
  return el('div', { class: `ins-richiesta aperta ${acc ? 'accesso' : ''}` },
    el('div', { class: 'ins-richiesta-testa' }, el('span', { class: 'cs-tag segnale' }, t(STATI_PERIZIA[p.stato])),
      el('strong', {}, acc ? (p.stato === 'in_corso' ? t('{chi} può entrare nel server', { chi: p.chi || t('Chi installa') }) : t('L\'accesso si apre al prossimo contatto dell\'agente (entro un minuto)'))
        : t('La diagnosi parte al prossimo contatto dell\'agente (entro un minuto)'))),
    acc && p.scade ? el('p', { class: 'ins-scade' }, t('Si chiude da solo fra {ore} h {min} min', { ore, min }), ' · ', el('span', { class: 'tenue' }, dataOra(p.scade))) : null,
    chiudi ? el('div', { class: 'azioni' }, chiudi) : null);
}
function passata(p) {
  return el('li', {}, el('span', { class: `ins-pz s-${p.stato}` }, t(STATI_PERIZIA[p.stato] || p.stato)), ' ',
    el('strong', {}, t(p.tipo === 'accesso' ? 'Accesso di {ore} ore' : 'Diagnosi', { ore: p.ore })), ' ', el('span', { class: 'tenue' }, `${p.chi || ''} · ${dataOra(p.finita || p.decisa || p.chiesta)}`),
    p.rapporto && p.tipo === 'diagnosi' ? el('details', { class: 'ins-rapporto' }, el('summary', {}, t('Il rapporto')), el('pre', { 'data-no-t': '' }, p.rapporto)) : null);
}

// ---------------- 04 conferma ----------------
function sezioneConferma() {
  if (!pagato()) return null;
  if (v.confermato) return sezione('conferma', '04', t('Confermato'), null,
    el('div', { class: 'avviso ok' }, el('span', {}, el('strong', {}, t('Hai confermato il {data}.', { data: data(v.confermato) })), ' ', t('Grazie: la tua conferma compare sul profilo di chi ti ha installato il programma. L\'assistenza continua da qui e dall\'area clienti.'))),
    el('div', { class: 'azioni' }, el('a', { class: 'bottone secondario', href: '/cliente' }, t('Vai all\'area clienti'))));
  const via = el('button', { type: 'button', class: 'bottone grande', onclick: async () => {
    if (!await conferma(t('Funziona tutto?'), t('Confermando dici che {prodotto} è installato e funziona: la conferma resta sul profilo di chi l\'ha installato. I pagamenti non cambiano: con carta le quote partono comunque {n} giorni dopo il pagamento, se non hai aperto una segnalazione.', { prodotto: v.prodotto.nome, n: v.trattenuta || 14 }), { si: 'Sì, funziona' })) return;
    occupato(via, async () => { await chiama('POST', '/api/installa/conferma', { k: codice }); await leggi(); disegna(); avviso('Grazie! Confermato'); });
  } }, t('Funziona tutto: confermo'));
  return sezione('conferma', '04', t('Conferma'), t('Quando il programma funziona come vuoi, confermalo. Se qualcosa non va, segnalalo dall\'area clienti entro {n} giorni dal pagamento: le quote si fermano finché non decidiamo.', { n: v.trattenuta || 14 }),
    el('div', { class: 'azioni' }, via, el('span', { class: 'tenue piccolo' }, t('Con carta le quote partono {n} giorni dopo il pagamento, che tu confermi o no, se non ci sono segnalazioni.', { n: v.trattenuta || 14 }))));
}

// ---------------- a lato ----------------
function chiTiSegue() {
  const i = v.installatore || {};
  return el('div', { class: 'carta ins-chi' }, el('p', { class: 'cs-r-et' }, t('Chi ti segue')),
    el('div', { class: 'ins-chi-testa' }, avatar(i, 'grande'), el('div', {}, el('strong', { 'data-no-t': '' }, i.nome || ''), i.zona ? el('span', { class: 'tenue', 'data-no-t': '' }, i.zona) : null)),
    el('p', { class: 'tenue piccolo' }, t('Ti ha mandato anche un\'email: rispondi lì per scrivergli. Per le urgenze, dopo l\'installazione, c\'è la tua pagina di assistenza.')),
    el('div', { class: 'azioni' }, i.codice ? el('a', { class: 'bottone secondario piccolo', href: `/u/${i.codice}` }, t('Il suo profilo')) : null,
      i.calendario ? el('a', { class: 'bottone fantasma piccolo', href: i.calendario, target: '_blank', rel: 'noopener' }, t('Il suo calendario')) : null));
}
function riepilogo() {
  return el('div', { class: 'carta ins-riep' }, el('p', { class: 'cs-r-et' }, t('Il tuo acquisto')),
    el('dl', {},
      el('dt', {}, t('Prodotto')), el('dd', { 'data-no-t': '' }, v.prodotto.nome),
      el('dt', {}, t('Assistenza')), el('dd', {}, t(v.periodo === 'anno' ? 'Annuale' : 'Mensile'), v.aggiornamenti ? ` · ${t('con aggiornamenti garantiti')}` : ''),
      v.dominio ? el('dt', {}, t('Dominio')) : null, v.dominio ? el('dd', { 'data-no-t': '' }, v.dominio) : null,
      el('dt', {}, t('Email')), el('dd', { 'data-no-t': '' }, v.email || ''),
      el('dt', {}, t('Dal')), el('dd', {}, data(v.creato))),
    el('p', { class: 'tenue piccolo' }, t('Questa pagina è la chiave della tua installazione: salvala, e non inoltrare il link.')));
}

// l'avvio, in fondo: prima devono esistere tutte le funzioni e le costanti qui sopra
try { await leggi(); }
catch (e) {
  carico.remove(); pagina.classList.remove('nascosto');
  pagina.append(el('div', { class: 'cs-stop carta angoli' }, el('p', { class: 'numero-sezione', dati: { n: 'RB' } }, t('La tua installazione')), el('h1', {}, t('Link non valido')),
    el('p', {}, t(e.message)), el('div', { class: 'azioni' }, el('a', { class: 'bottone', href: '/cliente' }, t('Vai all\'area clienti')))));
  throw e;
}
carico.remove(); pagina.classList.remove('nascosto');
disegna(); giro();
