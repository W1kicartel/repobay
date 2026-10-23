// Le rotte dei conti: iscrizione, accesso (password, link via email, GitHub, passkey), verifica in due passaggi, email,
// password, sessioni, preferenze, esportazione e cancellazione dei dati. I link delle email aprono una pagina con un bottone:
// gli antivirus che «cliccano» i link per controllarli non consumano il gettone.
import { randomBytes } from 'node:crypto';
import { cifraParola, controllaParola, parolaACaso, parolaDebole, parolaRubata, cifra, decifra, chiudiSessione, nuovoGettone, usaGettone, troppiTentativi, dimenticaTentativi, hashGettone } from '../conti.js';
import { nuovoSegretoTotp, uriTotp, verificaTotp, codiciRecupero, usaCodiceRecupero } from '../totp.js';
import { opzioniRegistrazione, verificaRegistrazione, opzioniAccesso, verificaAccesso } from '../passkey.js';
import { qrSvg } from '../../web/qr.js';
import { errore, emailValida, testo, urlValido, ipDi } from '../http.js';
import { GRUPPI, preferenze } from '../notifiche.js';

export function rotteConti(c) {
  const { cfg, db, chiave, h, notifiche } = c;
  const rpId = new URL(cfg.url).hostname, origine = new URL(cfg.url).origin;
  const ora = () => new Date().toISOString();
  const minuti = m => new Date(Date.now() + m * 60e3).toISOString();
  const utente = id => db.prepare('SELECT * FROM utente WHERE id = ?').get(id);
  const limite = (req, chiaveExtra, max = 10) => { if (troppiTentativi(`${chiaveExtra}:${ipDi(req)}`, Date.now(), max)) throw errore(429, 'Troppi tentativi: riprova tra qualche minuto'); };

  async function controllaNuova(parola, u) {
    const no = parolaDebole(parola, u); if (no) throw errore(400, no);
    if (cfg.pwned && await parolaRubata(parola, c.chiedi)) throw errore(400, 'Questa password compare in furti di dati pubblici: scegline un\'altra');
  }
  function mandaVerifica(u, email = u.email, tipo = 'verifica') {
    const t = nuovoGettone(db, tipo, { utente: u.id, dato: email, minuti: 48 * 60 });
    return notifiche.email(email, 'verifica', { nome: u.nome, link: `${cfg.url}/verifica?t=${t}` }, { lingua: u.lingua });
  }
  // il secondo passo: chi ha la 2FA riceve un biscotto «passaggio» di 5 minuti e manda il codice
  function passaggio(res, u, metodo, { github = null, vai = null, pulisci = [] } = {}) {
    const t = randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO passaggio (token, utente, scade, metodo, github) VALUES (?, ?, ?, ?, ?)').run(hashGettone(t), u.id, minuti(5), metodo, github);
    const biscotti = [h.biscotto('passaggio', t, 5 / 1440), ...pulisci.map(n => h.biscotto(n, '', 0))];
    if (vai) return h.vai(res, vai, { 'set-cookie': biscotti });
    h.rispondi(res, 200, { dueFattori: true }, { 'set-cookie': biscotti });
  }
  c.passaggio = passaggio;
  const completa = (req, res, u, metodo, extra = {}) => u.totp ? passaggio(res, u, metodo) : c.entra(req, res, u, { metodo, json: { ok: true, ...extra } });
  function verificaSecondo(u, codice) {   // → aggiornamenti da salvare, o null
    const segreto = decifra(u.totp, chiave); const n = segreto && verificaTotp(segreto, String(codice || ''), { ultimo: u.totp_ultimo });
    if (n !== null && n !== undefined && n !== false) return { totp_ultimo: n };
    const resto = usaCodiceRecupero(JSON.parse(u.recupero || '[]'), String(codice || ''), chiave);
    return resto ? { recupero: JSON.stringify(resto), rimasti: resto.length } : null;
  }
  const salvaSecondo = (u, x) => db.prepare('UPDATE utente SET totp_ultimo = COALESCE(?, totp_ultimo), recupero = COALESCE(?, recupero) WHERE id = ?').run(x.totp_ultimo ?? null, x.recupero ?? null, u.id);
  function sfidaPasskey(res, sfida, tipo, utente = null) {
    const id = randomBytes(18).toString('base64url');
    db.prepare('INSERT INTO sfida_passkey (id, sfida, utente, tipo, scade) VALUES (?, ?, ?, ?, ?)').run(id, sfida, utente, tipo, minuti(5));
    return h.biscotto('pk', id, 5 / 1440);
  }
  function prendiSfida(b, tipo) {   // una volta sola, anche se poi la verifica fallisce
    const s = b.pk && db.prepare('DELETE FROM sfida_passkey WHERE id = ? RETURNING *').get(b.pk);
    if (!s || s.tipo !== tipo || s.scade <= ora()) throw errore(400, 'La richiesta è scaduta: riprova');
    return s;
  }

  return {
    'POST /api/iscrizione': async (req, res) => {
      const { nome, email, parola, contratto, zona, lingua, sito_web } = await h.json(req);
      limite(req, 'i');
      if (sito_web) return h.rispondi(res, 201, { ok: true });   // il campo trappola: lo compilano solo i bot
      if (testo(nome, 200).length < 2 || String(nome).length > 80) throw errore(400, 'Scrivi il tuo nome');
      if (!emailValida(String(email || '').trim())) throw errore(400, 'Email non valida');
      if (contratto !== true) throw errore(400, 'Per iscriverti devi accettare le condizioni');
      const em = email.trim().toLowerCase();
      await controllaNuova(parola, { email: em, nome });
      if (db.prepare('SELECT 1 FROM utente WHERE email = ?').get(em)) throw errore(409, 'Questa email è già iscritta: accedi');
      const id = c.nuovoUtente({ nome: testo(nome, 80), email: em, parola: cifraParola(parola), zona: testo(zona, 60), lingua: lingua === 'en' ? 'en' : lingua === 'it' ? 'it' : c.linguaDi(req) });
      mandaVerifica(utente(id));
      c.entra(req, res, utente(id), { metodo: 'parola', stato: 201, json: { ok: true }, nuovo: true });
    },
    'POST /api/accesso': async (req, res) => {
      const { email, parola } = await h.json(req); const em = String(email || '').trim().toLowerCase();
      if (troppiTentativi(`a:${ipDi(req)}`) || troppiTentativi(`e:${em}`)) throw errore(429, 'Troppi tentativi: riprova tra qualche minuto');
      const u = db.prepare('SELECT * FROM utente WHERE email = ? AND cancellato IS NULL').get(em);
      if (!u || !u.parola) { parolaACaso(parola); throw errore(401, 'Email o password sbagliate'); }
      if (!controllaParola(String(parola || ''), u.parola)) throw errore(401, 'Email o password sbagliate');
      dimenticaTentativi(`a:${ipDi(req)}`, `e:${em}`);
      completa(req, res, u, 'parola');
    },
    'POST /api/uscita': async (req, res, { b }) => { c.chiudi(b.sessione); h.rispondi(res, 200, { ok: true }, { 'set-cookie': h.biscotto('sessione', '', 0) }); },
    'POST /api/accesso/codice': async (req, res, { b }) => {   // il secondo passo della 2FA
      const { codice } = await h.json(req);
      const p = b.passaggio && db.prepare('SELECT * FROM passaggio WHERE token = ?').get(hashGettone(b.passaggio));
      if (!p || p.scade <= ora()) throw errore(401, 'Il tempo per il codice è scaduto: rientra');
      if (p.tentativi >= 5) { db.prepare('DELETE FROM passaggio WHERE token = ?').run(p.token); throw errore(429, 'Troppi codici sbagliati: rientra'); }
      const u = utente(p.utente), x = u && verificaSecondo(u, codice);
      if (!x) { db.prepare('UPDATE passaggio SET tentativi = tentativi + 1 WHERE token = ?').run(p.token); throw errore(401, 'Codice sbagliato'); }
      salvaSecondo(u, x); db.prepare('DELETE FROM passaggio WHERE token = ?').run(p.token);
      c.entra(req, res, u, { metodo: `${p.metodo}+2fa`, github: p.github || null, json: { ok: true, ...(x.rimasti !== undefined ? { codiciRimasti: x.rimasti } : {}) }, pulisci: ['passaggio'] });
    },
    'POST /api/accesso/link': async (req, res) => {   // l'accesso senza password: un link valido 15 minuti
      const { email, dopo } = await h.json(req); const em = String(email || '').trim().toLowerCase();
      const torna = typeof dopo === 'string' && /^\/[A-Za-z0-9/_.#?=&%-]{0,200}$/.test(dopo) && !dopo.startsWith('//') ? dopo : null;
      limite(req, 'l', 5); if (troppiTentativi(`le:${em}`, Date.now(), 3)) throw errore(429, 'Ti abbiamo già mandato un link: controlla la posta');
      if (!emailValida(em)) throw errore(400, 'Email non valida');
      const u = db.prepare('SELECT * FROM utente WHERE email = ? AND cancellato IS NULL').get(em);
      if (u) { const t = nuovoGettone(db, 'accesso', { utente: u.id, minuti: 15 }); notifiche.email(em, 'accesso', { nome: u.nome, link: `${cfg.url}/accedi?link=${t}${torna ? `&dopo=${encodeURIComponent(torna)}` : ''}` }, { lingua: u.lingua }); }
      h.rispondi(res, 200, { ok: true });   // la stessa risposta se l'email non è iscritta: nessuno scopre chi c'è
    },
    'POST /api/accesso/link/usa': async (req, res) => {
      const g = usaGettone(db, 'accesso', (await h.json(req)).t); const u = g && utente(g.utente);
      if (!u || u.cancellato) throw errore(400, 'Il link è scaduto o è già stato usato: chiedine un altro');
      if (!u.email_verificata) db.prepare("UPDATE utente SET email_verificata = datetime('now') WHERE id = ?").run(u.id);   // chi apre il link ha la casella
      completa(req, res, u, 'link');
    },
    'POST /api/parola/dimenticata': async (req, res) => {
      const { email } = await h.json(req); const em = String(email || '').trim().toLowerCase();
      limite(req, 'd', 5); if (troppiTentativi(`de:${em}`, Date.now(), 3)) throw errore(429, 'Ti abbiamo già scritto: controlla la posta');
      const u = emailValida(em) && db.prepare('SELECT * FROM utente WHERE email = ? AND cancellato IS NULL').get(em);
      if (u) { const t = nuovoGettone(db, 'reimposta', { utente: u.id, minuti: 60 }); notifiche.email(em, 'reimposta', { nome: u.nome, link: `${cfg.url}/accedi?reimposta=${t}` }, { lingua: u.lingua }); }
      h.rispondi(res, 200, { ok: true });
    },
    'POST /api/parola/reimposta': async (req, res) => {
      const { t, parola } = await h.json(req); limite(req, 'r');
      const g = db.prepare("SELECT * FROM gettone WHERE token = ? AND tipo = 'reimposta' AND scade > ?").get(hashGettone(String(t || '')), ora());
      const u = g && utente(g.utente); if (!u || u.cancellato) throw errore(400, 'Il link è scaduto o è già stato usato: chiedine un altro');
      await controllaNuova(parola, u);   // prima il controllo: se la password non va, il link vale ancora
      usaGettone(db, 'reimposta', t);
      db.prepare("UPDATE utente SET parola = ?, email_verificata = COALESCE(email_verificata, datetime('now')) WHERE id = ?").run(cifraParola(parola), u.id);
      db.prepare('DELETE FROM sessione WHERE utente = ?').run(u.id); db.prepare("DELETE FROM gettone WHERE utente = ? AND tipo = 'reimposta'").run(u.id);
      h.rispondi(res, 200, { ok: true });
    },
    'GET /verifica': async (req, res, { url, io }) => {   // la conferma dell'email (o della nuova email)
      const pagina = esito => `${io ? '/area' : '/accedi'}?email=${esito}`;
      const t = String(url.searchParams.get('t') || ''), g = t && db.prepare('SELECT * FROM gettone WHERE token = ?').get(hashGettone(t));
      const u = g && ['verifica', 'email'].includes(g.tipo) && g.scade > new Date().toISOString() && utente(g.utente);
      if (!u) return h.vai(res, pagina('scaduto'));
      if (g.tipo === 'email') {
        if (db.prepare('SELECT 1 FROM utente WHERE email = ? AND id != ?').get(g.dato, u.id)) return h.vai(res, pagina('occupata'));
        db.prepare("UPDATE utente SET email = ?, email_verificata = datetime('now') WHERE id = ?").run(g.dato, u.id);
        if (u.email && u.email !== g.dato) notifiche.email(u.email, 'email_cambiata', { nome: u.nome, nuova: g.dato }, { lingua: u.lingua });
      } else if (u.email === g.dato) db.prepare("UPDATE utente SET email_verificata = COALESCE(email_verificata, datetime('now')) WHERE id = ?").run(u.id);
      h.vai(res, pagina('verificata'));   // il gettone resta valido fino alla scadenza (la pulizia lo toglie): riaprire il link dice di nuovo «confermata»
    },
    'POST /api/email/rinvia': async (req, res, { io }) => {
      c.serve(io); if (!io.email || io.email_verificata) throw errore(400, 'L\'email è già confermata');
      if (troppiTentativi(`v:${io.id}`, Date.now(), 3, 60 * 60e3)) throw errore(429, 'Ti abbiamo già scritto: controlla anche lo spam');
      await mandaVerifica(io); h.rispondi(res, 200, { ok: true });
    },
    'POST /api/email': async (req, res, { io }) => {   // cambiare (o aggiungere) l'email: si conferma dalla nuova casella
      c.serve(io); const { email, parola } = await h.json(req); const em = String(email || '').trim().toLowerCase();
      if (!emailValida(em)) throw errore(400, 'Email non valida');
      if (io.parola && !controllaParola(String(parola || ''), io.parola)) throw errore(401, 'Password sbagliata');
      if (db.prepare('SELECT 1 FROM utente WHERE email = ?').get(em)) throw errore(409, 'Questa email è già usata da un altro conto');
      if (troppiTentativi(`ce:${io.id}`, Date.now(), 5, 60 * 60e3)) throw errore(429, 'Troppi tentativi: riprova più tardi');
      if (!io.email) { db.prepare('UPDATE utente SET email = ? WHERE id = ?').run(em, io.id); await mandaVerifica({ ...io, email: em }); return h.rispondi(res, 200, { ok: true, conferma: em }); }
      await mandaVerifica(io, em, 'email'); h.rispondi(res, 200, { ok: true, conferma: em });
    },
    'POST /api/parola': async (req, res, { io, b }) => {   // cambiare (o creare, per chi è entrato con GitHub) la password
      c.serve(io); const { attuale, nuova } = await h.json(req);
      if (io.parola && !controllaParola(String(attuale || ''), io.parola)) { limite(req, `p${io.id}`, 5); throw errore(401, 'La password attuale è sbagliata'); }
      if (!io.email) throw errore(400, 'Aggiungi prima un\'email: serve per entrare con la password');
      await controllaNuova(nuova, io);
      db.prepare('UPDATE utente SET parola = ? WHERE id = ?').run(cifraParola(nuova), io.id);
      db.prepare('DELETE FROM sessione WHERE utente = ? AND token != ?').run(io.id, io.sessione_token);   // le altre sessioni si chiudono
      h.rispondi(res, 200, { ok: true });
    },

    // ---------------- verifica in due passaggi (app di autenticazione) ----------------
    'POST /api/2fa/inizia': async (req, res, { io }) => {
      c.serve(io); if (io.totp) throw errore(400, 'La verifica in due passaggi è già attiva');
      const segreto = nuovoSegretoTotp(), uri = uriTotp({ segreto, conto: io.email || io.github_login || io.codice, emittente: cfg.nome });
      db.prepare('UPDATE utente SET totp_nuovo = ? WHERE id = ?').run(cifra(segreto, chiave), io.id);
      h.rispondi(res, 200, { segreto: segreto.match(/.{1,4}/g).join(' '), uri, qr: qrSvg(uri, { etichetta: 'Codice QR per l\'app di autenticazione' }) });
    },
    'POST /api/2fa/conferma': async (req, res, { io }) => {
      c.serve(io); const { codice } = await h.json(req); limite(req, `t${io.id}`, 8);
      const segreto = io.totp_nuovo && decifra(io.totp_nuovo, chiave); if (!segreto) throw errore(400, 'Ricomincia l\'attivazione');
      const n = verificaTotp(segreto, String(codice || '')); if (n === null || n === undefined || n === false) throw errore(400, 'Codice sbagliato: controlla l\'ora del telefono e riprova');
      const r = codiciRecupero(10, chiave);
      db.prepare('UPDATE utente SET totp = totp_nuovo, totp_nuovo = NULL, totp_ultimo = ?, recupero = ? WHERE id = ?').run(n, JSON.stringify(r.hash), io.id);
      db.prepare('DELETE FROM sessione WHERE utente = ? AND token != ?').run(io.id, io.sessione_token);
      if (io.email) notifiche.email(io.email, 'due_fattori', { nome: io.nome, attivo: true }, { lingua: io.lingua });
      h.rispondi(res, 200, { ok: true, codici: r.chiari });
    },
    'POST /api/2fa/spegni': async (req, res, { io }) => {
      c.serve(io); if (!io.totp) throw errore(400, 'La verifica in due passaggi non è attiva'); limite(req, `t${io.id}`, 8);
      if (!verificaSecondo(io, (await h.json(req)).codice)) throw errore(400, 'Codice sbagliato');
      db.prepare('UPDATE utente SET totp = NULL, totp_ultimo = -1, recupero = NULL WHERE id = ?').run(io.id);
      if (io.email) notifiche.email(io.email, 'due_fattori', { nome: io.nome, attivo: false }, { lingua: io.lingua });
      h.rispondi(res, 200, { ok: true });
    },
    'POST /api/2fa/codici': async (req, res, { io }) => {   // nuovi codici di recupero (i vecchi non valgono più)
      c.serve(io); if (!io.totp) throw errore(400, 'La verifica in due passaggi non è attiva'); limite(req, `t${io.id}`, 8);
      const x = verificaSecondo(io, (await h.json(req)).codice); if (!x) throw errore(400, 'Codice sbagliato');
      const r = codiciRecupero(10, chiave);
      db.prepare('UPDATE utente SET totp_ultimo = COALESCE(?, totp_ultimo), recupero = ? WHERE id = ?').run(x.totp_ultimo ?? null, JSON.stringify(r.hash), io.id);
      h.rispondi(res, 200, { codici: r.chiari });
    },

    // ---------------- passkey ----------------
    'POST /api/passkey/opzioni': async (req, res, { io }) => {
      c.serve(io);
      let handle = io.handle; if (!handle) { handle = randomBytes(32).toString('base64url'); db.prepare('UPDATE utente SET handle = ? WHERE id = ?').run(handle, io.id); }
      const escludi = db.prepare('SELECT id, trasporti FROM passkey WHERE utente = ?').all(io.id).map(p => ({ id: p.id, trasporti: JSON.parse(p.trasporti || '[]') }));
      const { opzioni, sfida } = opzioniRegistrazione({ rp: { id: rpId, nome: cfg.nome }, utente: { id: handle, nome: io.email || io.github_login || io.codice, visualizzato: io.nome }, escludi });
      h.rispondi(res, 200, opzioni, { 'set-cookie': sfidaPasskey(res, sfida, 'registrazione', io.id) });
    },
    'POST /api/passkey/registra': async (req, res, { io, b }) => {
      c.serve(io); const { risposta, nome } = await h.json(req, 128 * 1024); const s = prendiSfida(b, 'registrazione');
      if (s.utente !== io.id) throw errore(400, 'La richiesta è scaduta: riprova');
      let p; try { p = verificaRegistrazione({ risposta, sfida: s.sfida, origine, rpId }); } catch (e) { throw errore(400, e.message); }
      if (db.prepare('SELECT 1 FROM passkey WHERE id = ?').get(p.id)) throw errore(409, 'Questa passkey è già registrata');
      db.prepare('INSERT INTO passkey (id, utente, chiave, algoritmo, contatore, trasporti, nome, uv, backup_idonea, backup_attiva, aaguid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(p.id, io.id, p.chiave, p.algoritmo, p.contatore, JSON.stringify(p.trasporti || []), testo(nome, 40) || 'Passkey', p.uv ? 1 : 0, p.backup?.idonea ? 1 : 0, p.backup?.attiva ? 1 : 0, p.aaguid || null);
      h.rispondi(res, 201, { ok: true }, { 'set-cookie': h.biscotto('pk', '', 0) });
    },
    'POST /api/passkey/accesso/opzioni': async (req, res) => {
      limite(req, 'pk', 200);
      const { opzioni, sfida } = opzioniAccesso({ rpId, consentite: [] });
      h.rispondi(res, 200, opzioni, { 'set-cookie': sfidaPasskey(res, sfida, 'accesso') });
    },
    'POST /api/passkey/accesso': async (req, res, { b }) => {
      const { risposta } = await h.json(req, 128 * 1024); limite(req, 'pka', 20); const s = prendiSfida(b, 'accesso');
      const p = typeof risposta?.id === 'string' && db.prepare('SELECT * FROM passkey WHERE id = ?').get(risposta.id);
      const u = p && utente(p.utente); if (!u || u.cancellato) throw errore(401, 'Questa passkey non è registrata: entra in un altro modo');
      let r; try { r = verificaAccesso({ risposta, sfida: s.sfida, origine, rpId, chiave: p.chiave, contatore: p.contatore, algoritmo: p.algoritmo, utente: u.handle, uvObbligatoria: !!u.totp }); } catch (e) { throw errore(401, e.message); }
      db.prepare("UPDATE passkey SET contatore = ?, usata = datetime('now'), backup_attiva = ? WHERE id = ?").run(r.contatore, r.backup?.attiva ? 1 : p.backup_attiva, p.id);
      c.entra(req, res, u, { metodo: 'passkey', json: { ok: true }, pulisci: ['pk'] });   // una passkey vale già come due fattori
    },
    'POST /api/passkey/rinomina': async (req, res, { io }) => {
      c.serve(io); const { id, nome } = await h.json(req);
      db.prepare('UPDATE passkey SET nome = ? WHERE id = ? AND utente = ?').run(testo(nome, 40) || 'Passkey', String(id || ''), io.id); h.rispondi(res, 200, { ok: true });
    },
    'POST /api/passkey/elimina': async (req, res, { io }) => {
      c.serve(io); db.prepare('DELETE FROM passkey WHERE id = ? AND utente = ?').run(String((await h.json(req)).id || ''), io.id); h.rispondi(res, 200, { ok: true });
    },

    // ---------------- sessioni, profilo, preferenze, notifiche ----------------
    'POST /api/sessioni/chiudi': async (req, res, { io }) => {
      c.serve(io); const { id, altre } = await h.json(req);
      const n = altre ? db.prepare('DELETE FROM sessione WHERE utente = ? AND token != ?').run(io.id, io.sessione_token).changes
        : db.prepare('DELETE FROM sessione WHERE utente = ? AND substr(token, 1, 12) = ? AND token != ?').run(io.id, String(id || ''), io.sessione_token).changes;
      h.rispondi(res, 200, { chiuse: n });
    },
    'POST /api/io': async (req, res, { io }) => {
      c.serve(io); const x = await h.json(req);
      if (x.nome !== undefined && testo(x.nome, 80).length < 2) throw errore(400, 'Scrivi il tuo nome');
      for (const k of ['sito', 'calendario']) if (x[k] && !urlValido(x[k], { https: true })) throw errore(400, `${k === 'sito' ? 'Il sito' : 'Il link del calendario'} deve iniziare con https://`);
      const v = (k, max) => x[k] === undefined ? null : testo(x[k], max);
      db.prepare(`UPDATE utente SET nome = COALESCE(?, nome), zona = COALESCE(?, zona), bio = COALESCE(?, bio), sito = COALESCE(?, sito), calendario = COALESCE(?, calendario),
        lingua = COALESCE(?, lingua) WHERE id = ?`).run(v('nome', 80), v('zona', 60), v('bio', 600), v('sito', 200), v('calendario', 200), ['it', 'en'].includes(x.lingua) ? x.lingua : null, io.id);
      h.rispondi(res, 200, { ok: true }, ['it', 'en'].includes(x.lingua) ? { 'set-cookie': h.biscotto('lingua', x.lingua, 365, { http: false }) } : {});
    },
    'POST /api/lingua': async (req, res, { io }) => {   // anche senza conto: la lingua delle pagine
      const { lingua } = await h.json(req); if (!['it', 'en'].includes(lingua)) throw errore(400, 'Lingua non disponibile');
      if (io) db.prepare('UPDATE utente SET lingua = ? WHERE id = ?').run(lingua, io.id);
      h.rispondi(res, 200, { ok: true }, { 'set-cookie': h.biscotto('lingua', lingua, 365, { http: false }) });
    },
    'POST /api/io/preferenze': async (req, res, { io }) => {
      c.serve(io); const x = await h.json(req), p = preferenze(io);
      for (const canale of ['email', 'chat']) for (const g of GRUPPI) if (typeof x?.[canale]?.[g] === 'boolean') p[canale][g] = x[canale][g];
      db.prepare('UPDATE utente SET preferenze = ? WHERE id = ?').run(JSON.stringify(p), io.id); h.rispondi(res, 200, p);
    },
    'GET /api/notifiche': async (req, res, { io }) => {
      c.serve(io);
      h.rispondi(res, 200, { nonLette: db.prepare('SELECT COUNT(*) n FROM notifica WHERE utente = ? AND letta = 0').get(io.id).n,
        notifiche: db.prepare('SELECT id, tipo, testo, link, letta, creata FROM notifica WHERE utente = ? ORDER BY id DESC LIMIT 50').all(io.id) });
    },
    'POST /api/notifiche/lette': async (req, res, { io }) => {
      c.serve(io); db.prepare('UPDATE notifica SET letta = 1 WHERE utente = ? AND letta = 0').run(io.id); h.rispondi(res, 200, { ok: true });
    },

    // ---------------- i dati: esportazione e cancellazione (GDPR, art. 15, 17 e 20) ----------------
    'GET /api/io/esporta': async (req, res, { io }) => {
      c.serve(io); const t = (sql, ...p) => db.prepare(sql).all(...p);
      const dati = {
        esportato: ora(), piattaforma: cfg.nome,
        profilo: { nome: io.nome, email: io.email, email_verificata: io.email_verificata, github: io.github_login, codice: io.codice, zona: io.zona, bio: io.bio, sito: io.sito,
          calendario: io.calendario, lingua: io.lingua, wallet: io.wallet, iscritto: io.creato, condizioni_accettate: io.contratto, due_fattori: !!io.totp },
        dati_fiscali: io.fiscale ? JSON.parse(decifra(io.fiscale, chiave) || 'null') : null,
        sessioni: t('SELECT creata, vista, agente, ip, metodo FROM sessione WHERE utente = ?', io.id),
        passkey: t('SELECT nome, creata, usata FROM passkey WHERE utente = ?', io.id),
        prodotti: t('SELECT slug, repo, nome, descrizione, prezzo_avvio, prezzo_mese, stato, creato FROM prodotto WHERE builder = ?', io.id),
        adozioni: t('SELECT p.slug, a.zona, a.quota AS quota_concordata, a.accordo, a.creato FROM adozione a JOIN prodotto p ON p.id = a.prodotto WHERE a.installatore = ?', io.id),
        quote: t('SELECT ruolo, tipo, base, frazione, importo, stornato, stato, disponibile, trasferimento, creato FROM quota WHERE beneficiario = ?', io.id),
        richieste_ricevute: t('SELECT nome, email, telefono, messaggio, creato FROM contatto WHERE installatore = ?', io.id),
        notifiche: t('SELECT tipo, testo, creata FROM notifica WHERE utente = ?', io.id),
        webhook: t('SELECT url, eventi, attivo, creato FROM aggancio WHERE utente = ?', io.id),
        chiavi_api: t('SELECT nome, inizio, creata, usata, revocata FROM chiave_api WHERE utente = ?', io.id),
        wallet: { evm: io.wallet, solana: io.wallet_sol, bitcoin: io.wallet_btc, tron: io.wallet_tron },
        preferenze: (() => { try { return JSON.parse(io.preferenze || 'null'); } catch { return null; } })(),
        chat_collegate: { telegram: !!io.telegram, discord: !!io.discord, slack: !!io.slack },
        mance: t('SELECT da, a, prodotto, importo, nota, stato, creata, pagata FROM mancia WHERE da = ? OR a = ?', io.id, io.id),
        corso: { superato: io.corso, punti: io.corso_punti, prove: t('SELECT iniziata, consegnata, giuste, superata FROM prova WHERE utente = ?', io.id) },
        owner: t('SELECT p.slug, t.permesso, t.stato, t.entrato FROM cotitolare t JOIN prodotto p ON p.id = t.prodotto WHERE t.utente = ?', io.id),
      };
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-disposition': `attachment; filename="${cfg.nome.toLowerCase()}-dati-${io.codice}.json"` });
      res.end(JSON.stringify(dati, null, 2));
    },
    'POST /api/io/cancella': async (req, res, { io }) => {
      c.serve(io); const { parola, conferma } = await h.json(req);
      if (io.parola ? !controllaParola(String(parola || ''), io.parola) : conferma !== io.codice) throw errore(401, io.parola ? 'Password sbagliata' : 'Scrivi il tuo codice per confermare');
      const attesa = db.prepare("SELECT COALESCE(SUM(importo - stornato), 0) c FROM quota WHERE beneficiario = ? AND stato = 'in_attesa'").get(io.id).c;
      if (attesa > 0) throw errore(409, 'Hai ancora quote da ricevere: collega il conto Stripe e aspetta il versamento, oppure scrivici');
      const attivi = db.prepare("SELECT COUNT(*) n FROM cliente c LEFT JOIN prodotto p ON p.id = c.prodotto WHERE c.stato = 'attivo' AND (c.installatore = ? OR p.builder = ?)").get(io.id, io.id).n;
      if (attivi > 0) throw errore(409, `Hai ${attivi} clienti con un abbonamento attivo: prima vanno passati a un altro installatore o chiusi`);
      // i dati fiscali restano (cifrati) solo se ci sono stati pagamenti: la legge chiede di conservarli; tutto il resto si cancella
      const pagato = !!db.prepare("SELECT 1 FROM quota WHERE beneficiario = ? AND stato = 'versata'").get(io.id);
      db.exec('BEGIN');
      try {
        for (const sql of ['DELETE FROM sessione WHERE utente = ?', 'DELETE FROM passkey WHERE utente = ?', 'DELETE FROM adozione WHERE installatore = ?', 'DELETE FROM aggancio WHERE utente = ?',
          'DELETE FROM chiave_api WHERE utente = ?', 'DELETE FROM notifica WHERE utente = ?', 'DELETE FROM gettone WHERE utente = ?', 'DELETE FROM contatto WHERE installatore = ?',
          'DELETE FROM sfida WHERE utente = ?', "UPDATE prodotto SET stato = 'ritirato' WHERE builder = ?", 'UPDATE collaboratore SET stato = \'uscito\' WHERE utente = ?',
          'DELETE FROM prova WHERE utente = ?', 'DELETE FROM cotitolare WHERE utente = ?']) db.prepare(sql).run(io.id);
        db.prepare(`UPDATE utente SET nome = 'Conto cancellato', email = NULL, parola = NULL, github_id = NULL, github_login = NULL, zona = NULL, bio = NULL, sito = NULL, calendario = NULL,
          avatar = NULL, handle = NULL, totp = NULL, totp_nuovo = NULL, recupero = NULL, preferenze = NULL, telegram = NULL, telegram_h = NULL, discord = NULL, slack = NULL, wallet = NULL,
          wallet_sol = NULL, wallet_btc = NULL, wallet_tron = NULL,
          fiscale = CASE WHEN ? THEN fiscale ELSE NULL END, stato = 'cancellato', cancellato = datetime('now') WHERE id = ?`).run(pagato ? 1 : 0, io.id);
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      h.rispondi(res, 200, { ok: true }, { 'set-cookie': h.biscotto('sessione', '', 0) });
    },
  };
}
