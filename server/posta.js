// L'invio delle email, con driver intercambiabili scelti dalle impostazioni:
//   console   in sviluppo: un riassunto su stdout, con i link accorciati (i gettoni non finiscono mai nei log)
//   file      un .eml per messaggio in una cartella: per le prove e per guardare le email in locale
//   smtp      un client SMTP scritto qui (STARTTLS o TLS implicito, AUTH PLAIN o LOGIN): va con qualunque fornitore
//   resend, postmark, brevo, sendgrid, mailgun: le loro API HTTP (le chiavi arrivano solo dalle variabili d'ambiente)
// Il destinatario è sempre uno solo e nessun campo può contenere un a capo: niente iniezione di intestazioni.
import net from 'node:net';
import tls from 'node:tls';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const DRIVER = ['console', 'file', 'smtp', 'resend', 'postmark', 'brevo', 'sendgrid', 'mailgun'];
const errore = (msg, extra) => Object.assign(new Error(msg), extra);

// ── indirizzi: «email» oppure «Nome <email>»; validazione semplice, ASCII, uno solo ──
const LOCALE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}$/, ETICHETTA = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
export function indirizzo(s, campo = 'indirizzo') {
  if (typeof s !== 'string' || !s.trim()) throw errore(`Posta: manca ${campo}`);
  if (/[\r\n]/.test(s)) throw errore(`Posta: ${campo} non può contenere a capo`);
  if (/[\x00-\x1f\x7f]/.test(s)) throw errore(`Posta: ${campo} contiene caratteri di controllo`);
  if (/[,;]/.test(s)) throw errore(`Posta: ${campo} deve essere un solo indirizzo, senza virgole`);
  if (s.length > 400) throw errore(`Posta: ${campo} troppo lungo`);
  let nome = '', email = s.trim();
  const i = email.lastIndexOf('<');
  if (i >= 0 && email.endsWith('>')) {   // «Nome <email>»: il nome senza virgolette, < > o barre
    nome = email.slice(0, i).trim(); email = email.slice(i + 1, -1).trim();
    if (nome.length > 1 && nome[0] === '"' && nome.at(-1) === '"') nome = nome.slice(1, -1).trim();
    if (/["<>\\@]/.test(nome)) throw errore(`Posta: il nome in ${campo} contiene caratteri non ammessi`);
  }
  const k = email.lastIndexOf('@'), locale = email.slice(0, k), dominio = email.slice(k + 1);
  const etichette = dominio.split('.');
  if (k < 1 || !LOCALE.test(locale) || locale.startsWith('.') || locale.endsWith('.') || locale.includes('..') || dominio.length > 253
    || etichette.length < 2 || !etichette.every(e => ETICHETTA.test(e))) throw errore(`Posta: ${campo} non è un indirizzo email valido`);
  return { nome, email: `${locale}@${dominio.toLowerCase()}`, dominio: dominio.toLowerCase() };
}
const controlla = (s, campo) => {
  if (typeof s !== 'string') throw errore(`Posta: manca ${campo}`);
  if (/[\r\n]/.test(s)) throw errore(`Posta: ${campo} non può contenere a capo`);
  if (/[\x00-\x08\x0b-\x1f\x7f]/.test(s)) throw errore(`Posta: ${campo} contiene caratteri di controllo`);
  return s;
};

// ── formato del messaggio (RFC 5322, MIME, RFC 2047) ──
const ascii = s => /^[\x20-\x7e]*$/.test(s);
function paroleCodificate(s, max = 39) {   // al massimo 39 byte UTF-8 per parola: 52 caratteri base64, righe sotto 78
  const parole = []; let pezzo = '', byte = 0;
  for (const ch of s) {
    const b = Buffer.byteLength(ch);
    if (byte + b > max && pezzo) { parole.push(pezzo); pezzo = ''; byte = 0; }
    pezzo += ch; byte += b;
  }
  if (pezzo || !parole.length) parole.push(pezzo);
  return parole.map(p => `=?UTF-8?B?${Buffer.from(p, 'utf8').toString('base64')}?=`).join('\r\n ');
}
export const intestazione = s => ascii(s) && s.length <= 66 && !s.includes('=?') ? s : paroleCodificate(s);
const frase = n => !n ? '' : !ascii(n) || n.includes('=?') ? paroleCodificate(n) : /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~ -]+$/.test(n) ? n : `"${n}"`;
export const formatta = ({ nome, email }) => nome ? `${frase(nome)} <${email}>` : email;
export const dataRfc = (d = new Date()) => d.toUTCString().replace('GMT', '+0000');   // «Sun, 11 Oct 2026 11:11:12 +0000»

// quoted-printable sui byte UTF-8, righe al massimo di 76 caratteri compreso il «=» dell'a capo morbido
export function qp(testo) {
  return String(testo).split(/\r\n|\r|\n/).map(r => {
    const b = Buffer.from(r, 'utf8'); let out = '', riga = '';
    for (let i = 0; i < b.length; i++) {
      const c = b[i];
      const t = (c >= 33 && c <= 126 && c !== 61) || ((c === 32 || c === 9) && i < b.length - 1) ? String.fromCharCode(c) : '=' + c.toString(16).toUpperCase().padStart(2, '0');
      if (riga.length + t.length > 75) { out += riga + '=\r\n'; riga = ''; }
      riga += t;
    }
    return out + riga;
  }).join('\r\n');
}

export function componiMessaggio({ da, a, oggetto, testo, html, rispondiA, id, data = new Date() }) {
  const h = [`From: ${formatta(da)}`, `To: ${formatta(a)}`, ...(rispondiA ? [`Reply-To: ${formatta(rispondiA)}`] : []),
    `Subject: ${intestazione(oggetto)}`, `Date: ${dataRfc(data)}`, `Message-ID: ${id}`, 'MIME-Version: 1.0'];
  const parte = (tipo, corpo) => [`Content-Type: ${tipo}; charset=UTF-8`, 'Content-Transfer-Encoding: quoted-printable', '', qp(corpo)];
  if (testo == null || html == null) return [...h, ...parte(html == null ? 'text/plain' : 'text/html', html ?? testo), ''].join('\r\n');
  const confine = '=_posta_' + randomBytes(12).toString('hex');   // «=_» non compare mai nel quoted-printable
  return [...h, `Content-Type: multipart/alternative;\r\n boundary="${confine}"`, '',
    `--${confine}`, ...parte('text/plain', testo), `--${confine}`, ...parte('text/html', html), `--${confine}--`, ''].join('\r\n');
}

// ── SMTP ──
const locale = h => ['localhost', '127.0.0.1', '::1'].includes(h) || String(h).endsWith('.localhost');
const b64 = s => Buffer.from(s, 'utf8').toString('base64');
export const puntini = s => s.replace(/(^|\r\n)\./g, '$1..');   // dot-stuffing (RFC 5321 §4.5.2)
const opzioniTls = s => ({ host: s.host, ...(net.isIP(s.host) ? {} : { servername: s.host }), ...(s.ca ? { ca: s.ca } : {}), rejectUnauthorized: s.verifica !== false });

function connetti(s, ms) {
  return new Promise((ok, no) => {
    const sock = s.sicuro ? tls.connect({ ...opzioniTls(s), port: s.porta }) : net.connect({ host: s.host, port: s.porta });
    const fallita = err => { clearTimeout(t); sock.destroy(); no(errore(`SMTP: connessione a ${s.host}:${s.porta} fallita (${err.code || err.message})`)); };
    const t = setTimeout(() => fallita({ message: `nessuna risposta entro ${ms} ms` }), ms);
    sock.once('error', fallita);
    sock.once(s.sicuro ? 'secureConnect' : 'connect', () => { clearTimeout(t); sock.removeListener('error', fallita); ok(sock); });
  });
}
function aggiorna(grezzo, s, ms) {   // STARTTLS: lo stesso socket, ora cifrato
  return new Promise((ok, no) => {
    const sock = tls.connect({ ...opzioniTls(s), socket: grezzo });
    const fallita = err => { clearTimeout(t); sock.destroy(); no(errore(`SMTP: STARTTLS fallito (${err.code || err.message})`)); };
    const t = setTimeout(() => fallita({ message: `nessuna risposta entro ${ms} ms` }), ms);
    sock.once('error', fallita);
    sock.once('secureConnect', () => { clearTimeout(t); sock.removeListener('error', fallita); ok(sock); });
  });
}
// legge le risposte del server (anche su più righe «250-…»), una alla volta, ognuna con il suo tempo massimo
function lettore(sock) {
  let buf = '', righe = [], fine = null, attesa = null; const coda = [];
  const consegna = () => {
    if (!attesa || (!coda.length && !fine)) return;
    const a = attesa; attesa = null; clearTimeout(a.t);
    coda.length ? a.ok(coda.shift()) : a.no(fine);
  };
  const dati = d => {
    buf += d.toString('latin1');
    if (buf.length > 65536) { fine = errore('SMTP: risposta del server troppo lunga'); sock.destroy(); return consegna(); }
    for (let k; (k = buf.indexOf('\n')) >= 0;) {
      const r = buf.slice(0, k).replace(/\r$/, ''); buf = buf.slice(k + 1); righe.push(r);
      if (r[3] !== '-') { coda.push({ codice: Number(r.slice(0, 3)) || 0, testo: righe.map(x => x.slice(4)).join(' | '), righe }); righe = []; }
    }
    consegna();
  };
  const chiuso = err => { fine ||= errore(err?.code || err?.message ? `SMTP: connessione interrotta (${err.code || err.message})` : 'SMTP: il server ha chiuso la connessione'); consegna(); };
  const chiusura = () => chiuso();
  sock.on('data', dati); sock.on('error', chiuso); sock.on('close', chiusura);
  return {
    risposta: (ms, passo) => new Promise((ok, no) => {
      attesa = { ok, no, t: setTimeout(() => { attesa = null; no(errore(`SMTP: tempo scaduto (${ms} ms) in attesa della risposta a ${passo}`, { passo })); }, ms) };
      consegna();
    }),
    stacca: () => { sock.removeListener('data', dati); sock.removeListener('error', chiuso); sock.removeListener('close', chiusura); sock.on('error', () => {}); },
  };
}

async function inviaSmtp(s, { da, a, dati }) {
  const ms = s.tempo || 20e3;
  let sock = await connetti(s, ms), l = lettore(sock), cifrata = !!s.sicuro;
  // un passo: manda il comando (se c'è) e vuole uno dei codici attesi; il nome del passo non contiene mai le credenziali
  const passo = async (cmd, attesi, nome, tempo = ms) => {
    if (cmd != null) sock.write(cmd + '\r\n');
    const r = await l.risposta(tempo, nome);
    if (!attesi.includes(r.codice)) throw errore(`SMTP ${r.codice} a ${nome}: ${r.testo.slice(0, 300)}`, { codice: r.codice, passo: nome });
    return r;
  };
  const ehlo = async () => (await passo(`EHLO ${s.nome}`, [250], 'EHLO')).righe.slice(1).map(r => r.slice(4).trim().toUpperCase());
  try {
    await passo(null, [220], 'saluto');
    let est = await ehlo();
    if (!cifrata && est.includes('STARTTLS') && s.starttls !== false) {
      await passo('STARTTLS', [220], 'STARTTLS');
      l.stacca(); sock = await aggiorna(sock, s, ms); l = lettore(sock); cifrata = true;
      est = await ehlo();   // dopo STARTTLS il server dimentica tutto: di nuovo EHLO (RFC 3207)
    }
    if (s.utente) {
      if (!cifrata && !locale(s.host)) throw errore('SMTP: il server non offre STARTTLS, non mando la password in chiaro');
      const metodi = (est.find(e => /^AUTH[ =]/.test(e)) || '').slice(5).split(/\s+/);
      const scelto = s.metodo ? String(s.metodo).toUpperCase() : metodi.includes('PLAIN') ? 'PLAIN' : metodi.includes('LOGIN') ? 'LOGIN' : null;
      if (scelto === 'PLAIN') await passo('AUTH PLAIN ' + b64(`\0${s.utente}\0${s.parola || ''}`), [235], 'AUTH PLAIN');
      else if (scelto === 'LOGIN') {
        await passo('AUTH LOGIN', [334], 'AUTH LOGIN');
        await passo(b64(s.utente), [334], 'AUTH LOGIN (utente)');
        await passo(b64(s.parola || ''), [235], 'AUTH LOGIN (password)');
      } else throw errore('SMTP: il server non offre AUTH PLAIN né LOGIN');
    }
    await passo(`MAIL FROM:<${da}>`, [250], 'MAIL FROM');
    await passo(`RCPT TO:<${a}>`, [250, 251], 'RCPT TO');
    await passo('DATA', [354], 'DATA');
    sock.write(puntini(dati.endsWith('\r\n') ? dati : dati + '\r\n') + '.\r\n');
    const r = await passo(null, [250], 'fine del messaggio', s.tempoDati || ms * 3);
    await passo('QUIT', [221], 'QUIT').catch(() => {});   // il messaggio è già accettato: un QUIT storto non è un errore
    return r;
  } finally { sock.destroy(); }
}

// ── API HTTP ──
async function chiamaApi(f, nome, url, opz, ms) {
  let r;
  try { r = await f(url, { ...opz, signal: AbortSignal.timeout(ms) }); }
  catch (e) { throw errore(`${nome}: richiesta fallita (${e.name === 'TimeoutError' ? `tempo scaduto, ${ms} ms` : e.message})`); }
  const testo = await r.text().catch(() => ''); let j = {}; try { j = JSON.parse(testo); } catch {}
  if (!r.ok) throw errore(`${nome}: errore ${r.status}: ${String(j.message || j.Message || j.errors?.[0]?.message || j.error || testo).slice(0, 300)}`, { stato: r.status });
  return { r, j };
}
const json = (intestazioni, corpo) => ({ method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', ...intestazioni }, body: JSON.stringify(corpo) });
const persona = ({ nome, email }) => nome ? { email, name: nome } : { email };
const escHtml = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const API = {
  // https://resend.com/docs/api-reference/emails/send-email
  resend: async (c, m) => (await chiamaApi(c.f, 'Resend', 'https://api.resend.com/emails', json({ authorization: `Bearer ${c.chiave}` }, {
    from: formatta(c.da), to: [formatta(m.a)], subject: m.oggetto, ...(m.testo != null ? { text: m.testo } : {}), ...(m.html != null ? { html: m.html } : {}),
    ...(m.rispondiA ? { reply_to: formatta(m.rispondiA) } : {}) }), c.ms)).j.id,
  // https://postmarkapp.com/developer/api/email-api
  postmark: async (c, m) => {
    const { j } = await chiamaApi(c.f, 'Postmark', 'https://api.postmarkapp.com/email', json({ 'x-postmark-server-token': c.chiave }, {
      From: formatta(c.da), To: formatta(m.a), Subject: m.oggetto, ...(m.testo != null ? { TextBody: m.testo } : {}), ...(m.html != null ? { HtmlBody: m.html } : {}),
      ...(m.rispondiA ? { ReplyTo: formatta(m.rispondiA) } : {}), MessageStream: c.flusso || 'outbound' }), c.ms);
    if (j.ErrorCode) throw errore(`Postmark: errore ${j.ErrorCode}: ${j.Message}`);
    return j.MessageID;
  },
  // https://developers.brevo.com/reference/sendtransacemail (htmlContent è obbligatorio senza modello: se manca, il testo in <pre>)
  brevo: async (c, m) => (await chiamaApi(c.f, 'Brevo', 'https://api.brevo.com/v3/smtp/email', json({ 'api-key': c.chiave }, {
    sender: persona(c.da), to: [persona(m.a)], subject: m.oggetto, htmlContent: m.html ?? `<pre>${escHtml(m.testo)}</pre>`,
    ...(m.testo != null ? { textContent: m.testo } : {}), ...(m.rispondiA ? { replyTo: persona(m.rispondiA) } : {}) }), c.ms)).j.messageId,
  // https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send (202 senza corpo; l'id è nell'intestazione X-Message-Id)
  sendgrid: async (c, m) => {
    const base = c.regione === 'eu' ? 'https://api.eu.sendgrid.com' : 'https://api.sendgrid.com';
    const { r } = await chiamaApi(c.f, 'SendGrid', `${base}/v3/mail/send`, json({ authorization: `Bearer ${c.chiave}` }, {
      personalizations: [{ to: [persona(m.a)] }], from: persona(c.da), ...(m.rispondiA ? { reply_to: persona(m.rispondiA) } : {}), subject: m.oggetto,
      content: [...(m.testo != null ? [{ type: 'text/plain', value: m.testo }] : []), ...(m.html != null ? [{ type: 'text/html', value: m.html }] : [])] }), c.ms);
    return r.headers.get('x-message-id') || null;
  },
  // https://documentation.mailgun.com/docs/mailgun/api-reference/send/mailgun/messages/post-v3--domain-name--messages
  // (Basic con utente «api»: https://documentation.mailgun.com/docs/mailgun/api-reference/authentication)
  mailgun: async (c, m) => {
    const base = c.regione === 'eu' ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net';
    const corpo = new FormData();
    corpo.append('from', formatta(c.da)); corpo.append('to', formatta(m.a)); corpo.append('subject', m.oggetto);
    if (m.testo != null) corpo.append('text', m.testo);
    if (m.html != null) corpo.append('html', m.html);
    if (m.rispondiA) corpo.append('h:Reply-To', formatta(m.rispondiA));
    return (await chiamaApi(c.f, 'Mailgun', `${base}/v3/${encodeURIComponent(c.dominio)}/messages`,
      { method: 'POST', headers: { authorization: 'Basic ' + b64(`api:${c.chiave}`) }, body: corpo }, c.ms)).j.id;
  },
};

// nei log i link restano riconoscibili ma senza gettoni: ogni pezzo lungo dopo l'host diventa «abcd…»
export const accorciaLink = t => String(t).replace(/https?:\/\/[^\s<>"']+/g, u => {
  const k = u.indexOf('/', u.indexOf('//') + 2);
  return k < 0 ? u : u.slice(0, k) + u.slice(k).replace(/[A-Za-z0-9_.~%+-]{16,}/g, x => x.slice(0, 4) + '…');
});

// c = { driver, da: 'Repobay <noreply@dominio>', chiave, dominio, regione: 'eu'|'us', smtp: { host, porta, sicuro, utente, parola }, cartella }
// in più, facoltativi: fetch (per le prove), uscita (dove scrive il driver console), tempo (ms per le API), flusso (Postmark)
export function clientePosta(c = {}) {
  const driver = c.driver || 'console';
  if (!DRIVER.includes(driver)) throw errore(`Posta: driver sconosciuto «${driver}» (ammessi: ${DRIVER.join(', ')})`);
  if (!c.da && !['console', 'file'].includes(driver)) throw errore('Posta: manca il mittente (da)');
  const da = indirizzo(c.da || 'Repobay <noreply@repobay.localhost>', 'il mittente');
  if (API[driver] && !c.chiave) throw errore(`Posta: manca la chiave per ${driver}`);
  if (['sendgrid', 'mailgun'].includes(driver) && c.regione && !['eu', 'us'].includes(c.regione)) throw errore('Posta: la regione è «eu» o «us»');
  if (driver === 'file' && !c.cartella) throw errore('Posta: manca la cartella per il driver file');
  const s = driver === 'smtp' ? { ...c.smtp } : null;
  if (s) {
    if (!s.host) throw errore('Posta: manca smtp.host');
    s.porta = Number(s.porta) || (s.sicuro ? 465 : 587);
    s.sicuro = s.sicuro ?? s.porta === 465;   // la 465 è TLS implicito; le altre partono in chiaro e passano a STARTTLS
    s.nome ||= da.dominio;
  }
  const api = API[driver] && { f: c.fetch || globalThis.fetch, chiave: c.chiave, da, regione: c.regione || 'us', dominio: c.dominio || da.dominio, flusso: c.flusso, ms: c.tempo || 20e3 };
  const uscita = c.uscita || (t => process.stdout.write(t + '\n'));

  async function invia({ a, oggetto, testo, html, rispondiA } = {}) {
    const m = { a: indirizzo(a, 'il destinatario'), oggetto: controlla(oggetto, "l'oggetto"), rispondiA: rispondiA ? indirizzo(rispondiA, 'rispondiA') : null,
      testo: testo == null ? null : String(testo), html: html == null ? null : String(html) };
    if (m.testo == null && m.html == null) throw errore('Posta: manca il corpo (testo o html)');
    if (API[driver]) return { id: await API[driver](api, m) };
    const id = `<${Date.now().toString(36)}.${randomBytes(9).toString('base64url')}@${da.dominio}>`;
    if (driver === 'console') {
      const righe = accorciaLink(m.testo ?? m.html.replace(/<[^>]*>/g, ' ')).split('\n').slice(0, 30).map(r => '  ' + r);
      uscita([`[posta] a ${m.a.email} · «${m.oggetto}» · ${id}`, ...righe].join('\n'));
      return { id };
    }
    const dati = componiMessaggio({ da, ...m, id });
    if (driver === 'file') {
      mkdirSync(c.cartella, { recursive: true });
      writeFileSync(join(c.cartella, `${Date.now()}-${randomBytes(4).toString('hex')}.eml`), dati, { mode: 0o600 });
      return { id };
    }
    await inviaSmtp(s, { da: da.email, a: m.a.email, dati });
    return { id };
  }
  return { driver, invia };
}
