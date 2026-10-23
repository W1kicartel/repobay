// Le notifiche: ogni fatto che riguarda un iscritto (una vendita, una quota versata, una release nuova, un business che gli
// scrive…) finisce nell'area, per email (se l'ha chiesto), ai suoi webhook (firmati come quelli di Stripe, con i tentativi
// ripetuti) e su Telegram, Discord o Slack se li ha collegati. Un errore di consegna non ferma mai chi ha generato l'evento.
import { createHmac, randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { lookup as cercaDns } from 'node:dns';
import { isIP } from 'node:net';
import { request as richiestaHttps } from 'node:https';
import { request as richiestaHttp } from 'node:http';
import { modelloEmail } from './modelli.js';
import { decifra } from './conti.js';
import { traduci } from './lingue.js';

const euro = c => (c / 100).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
// le percentuali in italiano: la virgola, e l'articolo davanti ai numeri che si leggono con la vocale (l'80%, dell'11%, dell'1,5%)
const pcIt = x => String(x).replace('.', ','), vocale = x => /^(8|11(?![\d])|1(?![\d]))/.test(String(x));
const il = x => (vocale(x) ? 'l\'' : 'il '), del = x => (vocale(x) ? 'dell\'' : 'del ');
const giornoIt = t => new Date(t).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', timeZone: 'Europe/Rome' });
// gruppo: per le preferenze; testo: la riga nell'area; email: il modello (server/modelli.js) e i suoi dati
export const EVENTI = {
  // metodo: carta (versata sul conto Stripe dopo la trattenuta) o bonifico (la versa a mano chi gestisce); rinnovo: un abbonamento che
  // continua, non una vendita nuova
  'vendita.nuova': { gruppo: 'vendite', testo: d => d.rinnovo ? `${d.cliente || 'Un cliente'} ha rinnovato ${d.prodotto}: ${euro(d.importo)} per te` : `Nuova vendita di ${d.prodotto}: ${euro(d.importo)} per te`, link: '/area#vendite',
    email: (d, u) => ['vendita', { nome: u.nome, prodotto: d.prodotto, importo: d.importo, ruolo: d.ruolo, cliente: d.cliente, metodo: d.metodo || 'carta', rinnovo: !!d.rinnovo, giorni: d.giorni }] },
  'crypto.pagato': { gruppo: 'vendite', testo: d => `Pagamento in ${d.simbolo} per ${d.prodotto}: ${euro(d.importo)} sul tuo wallet`, link: '/area#vendite',
    email: (d, u) => ['vendita', { nome: u.nome, prodotto: d.prodotto, importo: d.importo, ruolo: d.ruolo, cliente: d.cliente }] },
  // l'escrow: il deposito nel contratto, poi lo sblocco (dal cliente o per tempo scaduto), o l'avviso che si può incassare
  'escrow.depositato': { gruppo: 'vendite', testo: d => `Pagamento in ${d.simbolo} per ${d.prodotto}: ${euro(d.importo)} nel contratto escrow, si sbloccano il ${d.sblocco} o prima se il cliente conferma`, link: '/area#soldi',
    email: (d, u) => ['vendita', { nome: u.nome, prodotto: d.prodotto, importo: d.importo, ruolo: d.ruolo, cliente: d.cliente }] },
  'escrow.sbloccato': { gruppo: 'vendite', testo: d => `${euro(d.importo)} per ${d.prodotto} ${d.conferma ? 'sbloccati dal cliente' : 'sbloccati'} dal contratto escrow: sono sul tuo wallet`, link: '/area#soldi' },
  'escrow.sbloccabile': { gruppo: 'soldi', testo: d => `Da oggi puoi incassare ${euro(d.importo)} per ${d.prodotto} dal contratto escrow: il cliente non ha segnalato nulla`, link: '/area#soldi' },
  'abbonamento.cessato': { gruppo: 'vendite', testo: d => `${d.cliente || 'Un cliente'} ha chiuso l'abbonamento a ${d.prodotto}`, link: '/area#vendite' },
  'rimborso': { gruppo: 'vendite', testo: d => `Rimborso su ${d.prodotto}: ${euro(d.importo)} stornati`, link: '/area#soldi' },
  // a chi gestisce la piattaforma: un business ha ordinato con bonifico, da guardare sul conto (la causale è quella dell'estratto)
  'bonifico.nuovo': { gruppo: 'vendite', testo: d => `Ordine con bonifico per ${d.prodotto}: ${euro(d.importo)} da ${d.cliente}, causale ${d.causale}`, link: '/admin#bonifici' },
  'quota.versata': { gruppo: 'soldi', testo: d => `Versati ${euro(d.importo)} sul tuo conto`, link: '/area#soldi', email: (d, u) => ['quota_versata', { nome: u.nome, importo: d.importo }] },
  'prodotto.pubblicato': { gruppo: 'prodotti', testo: d => `${d.prodotto} è pubblicato`, link: d => `/p/${d.slug}`,
    email: (d, u) => ['prodotto_esito', { nome: u.nome, prodotto: d.prodotto, esito: 'pubblicato', nota: d.nota }] },
  'prodotto.respinto': { gruppo: 'prodotti', testo: d => `${d.prodotto} non è stato approvato${d.nota ? `: ${d.nota}` : ''}`, link: '/area#prodotti',
    email: (d, u) => ['prodotto_esito', { nome: u.nome, prodotto: d.prodotto, esito: 'respinto', nota: d.nota }] },
  'prodotto.sospeso': { gruppo: 'prodotti', testo: d => `${d.prodotto} è sospeso${d.nota ? `: ${d.nota}` : ''}`, link: '/area#prodotti' },
  'installatore.nuovo': { gruppo: 'prodotti', testo: d => `${d.installatore} installa ${d.prodotto} (${d.zona})`, link: '/area#prodotti',
    email: (d, u) => ['nuovo_installatore', { nome: u.nome, prodotto: d.prodotto, installatore: d.installatore, zona: d.zona }] },
  // la divisione con chi vende: una proposta diversa dalla percentuale di chi sviluppa e la risposta (quota = la parte di chi vende, in percentuale)
  'accordo.proposto': { gruppo: 'prodotti', testo: d => `${d.da} propone per ${d.prodotto}: ${d.quota}% a chi vende e ${d.resto}% a chi sviluppa`, link: d => d.link },
  'accordo.accettato': { gruppo: 'prodotti', testo: d => `${d.da} ha accettato per ${d.prodotto}: ${d.quota}% a chi vende e ${d.resto}% a chi sviluppa, sulle vendite da adesso`, link: d => d.link },
  'accordo.rifiutato': { gruppo: 'prodotti', testo: d => `${d.da} non ha accettato la divisione proposta per ${d.prodotto}`, link: d => d.link },
  // chi sviluppa cambia la sua percentuale (vale per le vendite nuove); chi vende sale di livello; una mancia di chi sviluppa a chi vende
  'percentuale.cambiata': { gruppo: 'prodotti', testo: d => `${d.da} ha cambiato la sua percentuale su ${d.prodotto}: ${vocale(d.prima) ? 'dall\'' : 'dal '}${pcIt(d.prima)}% ${vocale(d.dopo) ? 'all\'' : 'al '}${pcIt(d.dopo)}%, sulle vendite da adesso`, link: d => `/p/${d.slug}` },
  'livello.nuovo': { gruppo: 'vendite', testo: d => `${d.livello >= 2 ? 'Top seller oro' : 'Top seller'} di ${d.prodotto}: ${d.vendite} vendite confermate. Da adesso a chi sviluppa va ${il(d.percentuale)}${pcIt(d.percentuale)}% invece ${del(d.prima)}${pcIt(d.prima)}%, il resto è tuo`, link: '/area#installo' },
  'mancia.ricevuta': { gruppo: 'soldi', testo: d => `${d.da} ti ha mandato una mancia di ${euro(d.importo)}${d.prodotto ? ` per ${d.prodotto}` : ''}${d.nota ? `: «${d.nota}»` : ''}`, link: '/area#soldi' },
  'collaborazione.invito': { gruppo: 'prodotti', testo: d => `${d.da} ti invita a mantenere ${d.prodotto} (${Math.round(d.quota * 100)}% della parte del builder)`, link: '/area#prodotti' },
  // un altro owner del repository (admin o maintain su GitHub) entra: la parte di chi sviluppa si divide con lui, in base ai commit
  'owner.nuovo': { gruppo: 'prodotti', testo: d => `${d.chi}${d.github ? ` (@${d.github})` : ''}, ${d.permesso} del repository, è entrato fra gli owner di ${d.prodotto}: dai prossimi pagamenti riceve ${Math.round(d.quota * 1000) / 10}% della parte di chi sviluppa, in base ai commit`, link: d => `/p/${d.slug}` },
  'owner.uscito': { gruppo: 'prodotti', testo: d => `Su GitHub non hai più il permesso admin o maintain su ${d.prodotto}: non sei più fra i suoi owner`, link: '/area#prodotti' },
  'release.nuova': { gruppo: 'release', testo: d => `${d.prodotto} ${d.versione}: aggiorna i tuoi clienti${d.attenzione ? ' (i controlli di sicurezza segnalano qualcosa da guardare: leggili sulla pagina del prodotto)' : ''}`, link: d => d.link,
    email: (d, u) => ['release', { nome: u.nome, prodotto: d.prodotto, versione: d.versione, link: d.link }] },
  // le novità di un'installazione (prenotazione, appuntamento, installato o fermo, risposta a una perizia, rapporto pronto): come una
  // richiesta di contatto, ma il link porta alla sezione Installazioni dell'area
  'installazione.messaggio': { gruppo: 'clienti', testo: d => `${d.da}${d.prodotto ? ` · ${d.prodotto}` : ''}: novità sull'installazione`, link: '/area#installazioni',
    email: (d, u) => ['contatto', { nome: u.nome, da: d.da, email: d.email, messaggio: d.messaggio, prodotto: d.prodotto }], rispondiA: d => d.email },
  'contatto.nuovo': { gruppo: 'clienti', testo: d => `${d.da} ti ha scritto${d.prodotto ? ` per ${d.prodotto}` : ''}`, link: '/area#clienti',
    email: (d, u) => ['contatto', { nome: u.nome, da: d.da, email: d.email, messaggio: d.messaggio, prodotto: d.prodotto }], rispondiA: d => d.email },
  'recensione.nuova': { gruppo: 'clienti', testo: d => `Nuova recensione su ${d.prodotto}: ${'★'.repeat(d.voto)}`, link: d => `/p/${d.slug}#recensioni` },
  'progetto.rivendicato': { gruppo: 'prodotti', testo: d => `Hai rivendicato ${d.prodotto}: ${euro(d.importo)} in attesa passano a te`, link: '/area#soldi' },
  'installazione.confermata': { gruppo: 'clienti', testo: d => `${d.cliente || 'Il cliente'} conferma: ${d.prodotto} è installato e funziona`, link: '/area#vendite' },
  'contestazione.aperta': { gruppo: 'clienti', testo: d => `${d.cliente || 'Un cliente'} segnala un problema su ${d.prodotto}: le quote di quell'acquisto sono ferme`, link: '/area#vendite',
    email: (d, u) => ['contestazione', { nome: u.nome, prodotto: d.prodotto, cliente: d.cliente, testo: d.testo }] },
  'contestazione.chiusa': { gruppo: 'clienti', testo: d => `Segnalazione su ${d.prodotto} chiusa: ${({ regolare: 'tutto regolare, le quote ripartono', rimborso: `rimborsati ${euro(d.importo)} al cliente`, annullata: 'ritirata dal cliente' })[d.esito] || d.esito}`, link: '/area#vendite' },
  // l'assistenza: le richieste dei clienti (dalla bolla o dalla pagina), le risposte, chi sviluppa coinvolto, i solleciti
  'assistenza.nuova': { gruppo: 'clienti', testo: d => `${d.urgente ? 'Urgente: ' : ''}${d.cliente || 'Un cliente'} chiede assistenza su ${d.prodotto}: ${d.titolo}`, link: '/area#assistenza',
    email: (d, u) => ['assistenza', { nome: u.nome, tipo: 'nuova', cliente: d.cliente, prodotto: d.prodotto, titolo: d.titolo, testo: d.testo, urgente: d.urgente }] },
  'assistenza.messaggio': { gruppo: 'clienti', testo: d => `${d.cliente || 'Un cliente'} ha scritto di nuovo su ${d.prodotto}: ${d.titolo}`, link: '/area#assistenza',
    email: (d, u) => ['assistenza', { nome: u.nome, tipo: 'messaggio', cliente: d.cliente, prodotto: d.prodotto, titolo: d.titolo, testo: d.testo }] },
  'assistenza.risposta': { gruppo: 'clienti', testo: d => `${d.da} ha risposto a ${d.cliente || 'un cliente'} su ${d.prodotto}: ${d.titolo}`, link: '/area#assistenza' },
  'assistenza.coinvolto': { gruppo: 'clienti', testo: d => `${d.da} ti chiede aiuto su ${d.prodotto}: ${d.titolo}`, link: '/area#assistenza',
    email: (d, u) => ['assistenza', { nome: u.nome, tipo: 'coinvolto', da: d.da, cliente: d.cliente, prodotto: d.prodotto, titolo: d.titolo, nota: d.nota, ruolo: d.ruolo || null }] },
  'assistenza.sollecito': { gruppo: null, testo: d => `${d.cliente || 'Un cliente'} aspetta da più di ${d.ore} ore una risposta su ${d.prodotto}: ${d.titolo}`, link: '/area#assistenza',
    email: (d, u) => ['assistenza', { nome: u.nome, tipo: 'sollecito', ore: d.ore, cliente: d.cliente, prodotto: d.prodotto, titolo: d.titolo }] },
  'assistenza.segnalata': { gruppo: null, testo: d => `${d.cliente || 'Un cliente'} ha segnalato alla piattaforma che aspetta una risposta su ${d.prodotto}: ${d.titolo}`, link: '/area#assistenza',
    email: (d, u) => ['assistenza', { nome: u.nome, tipo: 'segnalata', cliente: d.cliente, prodotto: d.prodotto, titolo: d.titolo }] },
  // i pagamenti dei clienti: il programma non si blocca mai, si ferma il servizio (vedi server/assistenza.js)
  'pagamento.fallito': { gruppo: 'vendite', testo: d => `Il pagamento di ${d.cliente || 'un cliente'} per ${d.prodotto} non è andato: Stripe riprova, l'assistenza resta attiva fino al ${giornoIt(d.sospesa)}`, link: '/area#vendite',
    email: (d, u) => ['pagamento_cliente', { nome: u.nome, tipo: 'fallito', cliente: d.cliente, prodotto: d.prodotto, sospesa: d.sospesa }] },
  'pagamento.respinto': { gruppo: 'vendite', testo: d => `Il primo addebito di ${d.cliente || 'un cliente'} per ${d.prodotto} è stato respinto: non installare finché non paga`, link: '/area#vendite',
    email: (d, u) => ['pagamento_cliente', { nome: u.nome, tipo: 'respinto', cliente: d.cliente, prodotto: d.prodotto }] },
  'pagamento.insoluto': { gruppo: 'vendite', testo: d => `${d.cliente || 'Un cliente'} non ha pagato ${d.prodotto} dopo tutti i tentativi: l'assistenza è sospesa`, link: '/area#vendite' },
  'pagamento.ripreso': { gruppo: 'vendite', testo: d => `${d.cliente || 'Un cliente'} ha pagato ${d.prodotto}: l'assistenza riparte`, link: '/area#vendite' },
  'assistenza.sospesa': { gruppo: 'vendite', testo: d => `Assistenza sospesa per ${d.cliente || 'un cliente'} su ${d.prodotto}: il pagamento non è arrivato, non sei tenuto a intervenire finché non paga`, link: '/area#vendite',
    email: (d, u) => ['pagamento_cliente', { nome: u.nome, tipo: 'sospesa', cliente: d.cliente, prodotto: d.prodotto }] },
  'assistenza.scaduta': { gruppo: 'vendite', testo: d => `L'assistenza pagata in anticipo da ${d.cliente || 'un cliente'} per ${d.prodotto} è scaduta senza rinnovo`, link: '/area#vendite' },
  'abbonamento.disdetto': { gruppo: 'vendite', testo: d => `${d.cliente || 'Un cliente'} ha disdetto ${d.prodotto}: l'abbonamento finisce il ${giornoIt(d.fine)}`, link: '/area#vendite' },
  // i controlli di sicurezza: una release con un problema grave non si annuncia a chi installa
  'sicurezza.ferma': { gruppo: null, testo: d => `La release ${d.versione} di ${d.prodotto} non è stata annunciata a chi installa: ${d.motivo}`, link: '/area#prodotti',
    email: (d, u) => ['sicurezza', { nome: u.nome, prodotto: d.prodotto, versione: d.versione, motivo: d.motivo }] },
  // il programma del cliente controllato da fuori: quando non risponde, quando torna, il certificato HTTPS che sta per scadere
  'sito.giu': { gruppo: 'clienti', testo: d => `${d.prodotto} di ${d.cliente || 'un cliente'} non risponde (${d.sito}): ${d.errore}`, link: '/area#assistenza',
    email: (d, u) => ['assistenza', { nome: u.nome, tipo: 'sito', cliente: d.cliente, prodotto: d.prodotto, titolo: `${d.sito} non risponde`, testo: d.errore }] },
  'sito.su': { gruppo: 'clienti', testo: d => `${d.prodotto} di ${d.cliente || 'un cliente'} risponde di nuovo, dopo ${d.minuti} minuti`, link: '/area#assistenza' },
  'certificato.scade': { gruppo: 'clienti', testo: d => `Il certificato HTTPS di ${d.sito} (${d.prodotto}, ${d.cliente || 'un cliente'}) scade fra ${d.giorni} giorni`, link: '/area#assistenza' },
  'intervento.pagato': { gruppo: 'clienti', testo: d => `${d.cliente || 'Un cliente'} ha pagato l'intervento su ${d.prodotto}: ${d.titolo}`, link: '/area#assistenza' },
  'prova': { gruppo: null, testo: () => 'Notifica di prova', link: '/area#integrazioni' },
};
export const GRUPPI = ['vendite', 'soldi', 'prodotti', 'release', 'clienti'];
export function preferenze(u) {
  let p = {}; try { p = JSON.parse(u.preferenze || '{}'); } catch { }
  const tutti = v => Object.fromEntries(GRUPPI.map(g => [g, v]));
  return { email: { ...tutti(true), ...(p.email || {}) }, chat: { ...tutti(true), ...(p.chat || {}) } };
}

// un indirizzo dove un iscritto vuole ricevere i webhook non deve puntare dentro la nostra rete (SSRF)
export const PRIVATI = [/^0\./, /^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^198\.1[89]\./, /^2(2[4-9]|[3-5]\d)\./,
  /^::1$/, /^::$/, /^f[cd]/i, /^fe[89a-f]/i, /^::ffff:/i, /^::[0-9a-f]{1,4}:/i, /^::\d+\.\d+/, /^64:ff9b:/i, /^2002:/i, /^100::/i];
export async function urlSicuro(u, { locali = false } = {}) {
  let x; try { x = new URL(u); } catch { return 'Indirizzo non valido'; }
  if (x.username || x.password) return 'Niente credenziali nell\'indirizzo';
  if (x.protocol !== 'https:' && !(locali && x.protocol === 'http:')) return 'Serve un indirizzo https://';
  if (locali) return null;
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(x.hostname)) return 'Indirizzo non raggiungibile da internet';
  const host = x.hostname.replace(/^\[|\]$/g, '');
  const ip = isIP(host) ? [host] : await lookup(host, { all: true }).then(l => l.map(a => a.address)).catch(() => []);
  if (!ip.length) return 'Il dominio non esiste';
  if (ip.some(a => PRIVATI.some(r => r.test(a)))) return 'Indirizzo non raggiungibile da internet';
  return null;
}
// la consegna di un webhook: l'indirizzo si controlla nel momento in cui ci si collega (non prima), così un dominio non può
// cambiare IP fra il controllo e l'invio e puntare dentro la nostra rete (DNS rebinding); niente redirect
export const soloPubblici = (host, opz, cb) => cercaDns(host, { ...opz, all: true }, (e, l) => {
  if (e) return cb(e);
  const ok = l.filter(a => !PRIVATI.some(r => r.test(a.address)));
  if (!ok.length) return cb(Object.assign(new Error('Indirizzo non raggiungibile da internet'), { code: 'EPRIVATO' }));
  return opz.all ? cb(null, ok) : cb(null, ok[0].address, ok[0].family);
});
export function postaSicura(url, corpo, intestazioni, ms = 10_000) {
  return new Promise((ok, no) => {
    const u = new URL(url), host = u.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host) && PRIVATI.some(x => x.test(host))) return no(new Error('Indirizzo non raggiungibile da internet'));   // gli IP scritti a mano non passano dal DNS
    const r = (u.protocol === 'https:' ? richiestaHttps : richiestaHttp)(u, { method: 'POST', lookup: soloPubblici, timeout: ms,
      headers: { ...intestazioni, 'content-length': Buffer.byteLength(corpo) } }, res => { res.resume(); res.on('end', () => ok({ status: res.statusCode })); });
    r.on('timeout', () => r.destroy(new Error('Tempo scaduto'))); r.on('error', no); r.end(corpo);
  });
}
export const firmaAggancio = (corpo, segreto, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac('sha256', segreto).update(`${t}.${corpo}`).digest('hex')}`;
const ATTESE = [60, 300, 1800, 7200, 21600, 43200, 86400];   // secondi fra un tentativo e l'altro: poi la consegna è fallita

export function creaNotifiche({ db, cfg, posta, chiave, chiedi = fetch }) {
  const locali = !!cfg.agganciLocali;
  const dentro = (u, l) => traduci(l, u.lingua);
  async function email(a, tipo, dati, { lingua = 'it', rispondiA } = {}) {
    if (!posta || !a) return false;
    try { const m = modelloEmail(tipo, dati, { nome: cfg.nome, url: cfg.url, lingua }); await posta.invia({ a, ...m, rispondiA }); return true; }
    catch (e) { console.error(`email ${tipo}:`, e.message); return false; }
  }
  async function chat(u, testo, link) {
    const riga = `${testo}${link ? `\n${link.startsWith('http') ? link : cfg.url + link}` : ''}`, attese = [];
    const invia = (url, corpo) => attese.push(chiedi(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo), signal: AbortSignal.timeout(8000) })
      .then(r => { if (!r.ok) throw new Error(`risposta ${r.status}`); }).catch(e => console.error('chat:', e.message)));
    const tg = u.telegram && cfg.telegram.bot && decifra(u.telegram, chiave);
    if (tg) invia(`https://api.telegram.org/bot${cfg.telegram.bot}/sendMessage`, { chat_id: tg, text: riga, disable_web_page_preview: true });
    const d = u.discord && decifra(u.discord, chiave); if (d) invia(d, { content: riga, allowed_mentions: { parse: [] } });
    const s = u.slack && decifra(u.slack, chiave); if (s) invia(s, { text: riga });
    await Promise.all(attese);
  }
  function accoda(u, evento, dati) {
    const corpo = JSON.stringify({ id: `evt_${randomBytes(12).toString('base64url')}`, tipo: evento, creato: new Date().toISOString(), dati });
    for (const a of db.prepare('SELECT id, eventi FROM aggancio WHERE utente = ? AND attivo = 1').all(u.id)) {
      const ev = JSON.parse(a.eventi || '[]');
      if (evento === 'prova' || ev.includes('*') || ev.includes(evento))
        db.prepare("INSERT INTO consegna (aggancio, evento, corpo, prossimo) VALUES (?, ?, ?, datetime('now'))").run(a.id, evento, corpo);
    }
  }
  // → la notifica nell'area è scritta subito; email, chat e webhook partono senza far aspettare chi chiama
  function notifica(utente, evento, dati = {}) {
    const u = db.prepare('SELECT * FROM utente WHERE id = ?').get(utente), e = EVENTI[evento];
    if (!u || u.cancellato || !e) return;
    const testo = dentro(u, e.testo(dati)), grezzo = typeof e.link === 'function' ? e.link(dati) : e.link;
    const link = /^(\/(?![/\\])|https:\/\/)/.test(String(grezzo || '')) ? grezzo : null;   // solo percorsi nostri o https
    db.prepare('INSERT INTO notifica (utente, tipo, testo, link) VALUES (?, ?, ?, ?)').run(u.id, evento, testo, link || null);
    accoda(u, evento, dati);
    const p = preferenze(u), lavori = [];
    if (e.email && u.email && u.email_verificata && (!e.gruppo || p.email[e.gruppo])) {
      const [tipo, d] = e.email(dati, u); lavori.push(email(u.email, tipo, d, { lingua: u.lingua, rispondiA: e.rispondiA?.(dati) }));
    }
    if (!e.gruppo || p.chat[e.gruppo]) lavori.push(chat(u, testo, link));
    return Promise.all(lavori).then(() => consegne()).catch(x => console.error('notifica:', x.message));
  }
  // i webhook in coda: una consegna riuscita è una risposta 2xx entro 10 secondi; dopo 20 fallimenti di fila l'aggancio si spegne
  let inCorso = null, ancora = false;   // se arriva un evento mentre un giro è in corso, subito dopo se ne fa un altro
  function consegne(adesso = Date.now()) {
    if (inCorso) { ancora = true; return inCorso; }
    inCorso = (async () => {
      let n = 0;
      // una consegna rimasta «in invio» (il server si è spento a metà) torna in coda dopo 5 minuti
      db.prepare("UPDATE consegna SET stato = 'in_coda' WHERE stato = 'in_invio' AND prossimo <= ?").run(new Date(adesso - 5 * 60e3).toISOString().replace('T', ' ').slice(0, 19));
      const l = db.prepare(`SELECT c.*, a.url, a.segreto, a.utente FROM consegna c JOIN aggancio a ON a.id = c.aggancio
        WHERE c.stato = 'in_coda' AND c.prossimo <= ? AND (a.attivo = 1 OR c.evento = 'prova') ORDER BY c.id LIMIT 50`).all(new Date(adesso).toISOString().replace('T', ' ').slice(0, 19));
      for (const c of l) {
        if (!db.prepare("UPDATE consegna SET stato = 'in_invio' WHERE id = ? AND stato = 'in_coda'").run(c.id).changes) continue;
        let ok = false, risposta = '';
        try {
          const no = await urlSicuro(c.url, { locali }); if (no) throw new Error(no);
          const segreto = decifra(c.segreto, chiave);
          const intest = { 'content-type': 'application/json', 'user-agent': `${cfg.nome}-Webhook/1`, 'x-evento': c.evento, 'x-firma': firmaAggancio(c.corpo, segreto) };
          const r = locali ? await chiedi(c.url, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10_000), headers: intest, body: c.corpo })
            : await postaSicura(c.url, c.corpo, intest);
          ok = r.status >= 200 && r.status < 300; risposta = `${r.status}`;
        } catch (e) { risposta = String(e.message).slice(0, 200); }
        const tent = c.tentativi + 1;
        if (ok) {
          db.prepare("UPDATE consegna SET stato = 'consegnata', tentativi = ?, risposta = ? WHERE id = ?").run(tent, risposta, c.id);
          db.prepare('UPDATE aggancio SET falliti = 0 WHERE id = ?').run(c.aggancio); n++;
        } else {
          const fine = tent > ATTESE.length, prossimo = new Date(adesso + (ATTESE[tent - 1] || 0) * 1000).toISOString().replace('T', ' ').slice(0, 19);
          db.prepare('UPDATE consegna SET stato = ?, tentativi = ?, risposta = ?, prossimo = ? WHERE id = ?').run(fine ? 'fallita' : 'in_coda', tent, risposta, prossimo, c.id);
          const f = db.prepare('UPDATE aggancio SET falliti = falliti + 1 WHERE id = ? RETURNING falliti').get(c.aggancio)?.falliti;
          if (f >= 20) {
            db.prepare('UPDATE aggancio SET attivo = 0 WHERE id = ?').run(c.aggancio);
            db.prepare('INSERT INTO notifica (utente, tipo, testo, link) VALUES (?, ?, ?, ?)').run(c.utente, 'aggancio.spento', `Il webhook ${new URL(c.url).host} non risponde: l'ho spento`, '/area#integrazioni');
          }
        }
      }
      return n;
    })().finally(() => { inCorso = null; if (ancora) { ancora = false; consegne(); } });
    return inCorso;
  }
  return { notifica, email, consegne, chat };
}
