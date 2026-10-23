// Perché il canone valga sempre la pena (e senza mai bloccare il programma a chi non paga, art. 392 c.p.): il programma del cliente
// controllato da fuori ogni MONITOR_MINUTI (risponde? il certificato HTTPS sta per scadere?), gli avvisi quando cade e quando torna,
// e il rapporto del mese che mostra al cliente il lavoro fatto: disponibilità, versioni controllate, richieste risolte. Repobay non
// entra mai nei server dei clienti: legge l'indirizzo pubblico del programma, come farebbe un visitatore.
import { request as richiestaHttps } from 'node:https';
import { request as richiestaHttp } from 'node:http';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { PRIVATI, soloPubblici } from './notifiche.js';
import { statoAssistenza, codiceAssistenza, linkAssistenza, nuovoAvviso, togliAvvisi, squadra } from './assistenza.js';

const MINUTO = 60e3, GIORNO = 864e5;
const iso = t => new Date(t).toISOString();

// l'indirizzo del programma scritto da chi installa (o dal cliente): http o https, senza credenziali, raggiungibile da internet.
// → l'indirizzo pulito, o un errore da mostrare
export async function indirizzoProgramma(testo, { locali = false } = {}) {
  let u; try { u = new URL(String(testo || '').trim()); } catch { return { errore: 'Scrivi l\'indirizzo completo, per esempio https://gestionale.tuonegozio.it' }; }
  if (!['http:', 'https:'].includes(u.protocol)) return { errore: 'Serve un indirizzo che inizi con https:// (o http://)' };
  if (u.username || u.password) return { errore: 'Niente nome utente o password nell\'indirizzo' };
  if (!locali) {
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (/^(localhost|.*\.local|.*\.internal|.*\.lan)$/i.test(host)) return { errore: 'Il programma deve essere raggiungibile da internet per controllarlo' };
    const ip = isIP(host) ? [host] : await lookup(host, { all: true }).then(l => l.map(a => a.address)).catch(() => []);
    if (!ip.length) return { errore: 'Il dominio non esiste (o non ancora)' };
    if (ip.some(a => PRIVATI.some(r => r.test(a)))) return { errore: 'Il programma deve essere raggiungibile da internet per controllarlo' };
  }
  u.hash = '';
  return { sito: u.href.slice(0, 300) };
}

// un controllo: una richiesta GET come un visitatore (basta l'intestazione). Online se risponde con un codice sotto il 500 (anche una
// pagina di accesso o un 404 vogliono dire che il server c'è); il certificato HTTPS si legge dalla connessione. L'indirizzo si
// controlla di nuovo quando ci si collega (soloPubblici): un dominio non può cambiare IP e puntare dentro la rete della piattaforma
export function controlla(url, { ms = 10_000, locali = false } = {}) {
  return new Promise(fatto => {
    let finito = false; const ok = r => { if (!finito) { finito = true; fatto(r); } };
    let u; try { u = new URL(url); } catch { return ok({ ok: false, errore: 'indirizzo non valido' }); }
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (!locali && isIP(host) && PRIVATI.some(r => r.test(host))) return ok({ ok: false, errore: 'indirizzo non raggiungibile da internet' });
    const t0 = Date.now();
    const r = (u.protocol === 'https:' ? richiestaHttps : richiestaHttp)(u, { method: 'GET', timeout: ms, ...(locali ? {} : { lookup: soloPubblici }),
      headers: { 'user-agent': 'Repobay-controllo/1', accept: '*/*' } }, res => {
      let cert = null;
      try { const c = res.socket.getPeerCertificate?.(); if (c?.valid_to) cert = iso(Date.parse(c.valid_to)); } catch { }
      ok({ ok: res.statusCode < 500, codice: res.statusCode, ms: Date.now() - t0, cert });
      res.destroy();
    });
    r.on('timeout', () => r.destroy(Object.assign(new Error('nessuna risposta in tempo'), { code: 'TEMPO' })));
    r.on('error', e => ok({ ok: false, errore: String(e.code || e.message).slice(0, 120), ms: Date.now() - t0 }));
    r.end();
  });
}

// la disponibilità in un periodo: la percentuale dei controlli andati bene e quante volte è caduto (un controllo fallito dopo uno buono)
export function disponibilita(db, chiave, da, a) {
  const r = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(ok), 0) ok FROM controllo_sito WHERE cliente = ? AND quando >= ? AND quando < ?').get(chiave, da, a);
  if (!r.n) return null;
  const cadute = db.prepare(`SELECT COUNT(*) n FROM (SELECT ok, LAG(ok) OVER (ORDER BY quando) prima FROM controllo_sito WHERE cliente = ? AND quando >= ? AND quando < ?)
    WHERE ok = 0 AND prima = 1`).get(chiave, da, a).n;
  return { percentuale: Math.floor(r.ok / r.n * 10000) / 100, controlli: r.n, cadute };
}

// il giro dei controlli (lavori.js): i programmi con un indirizzo e l'assistenza attiva, non controllati da MONITOR_MINUTI
export async function giroMonitoraggio({ db, cfg, notifiche }, adesso = Date.now()) {
  const l = db.prepare(`SELECT c.*, p.nome prodotto_nome FROM cliente c JOIN prodotto p ON p.id = c.prodotto WHERE c.sito IS NOT NULL AND c.stato != 'cessato'
      AND (c.sito_controllato IS NULL OR c.sito_controllato < ?) ORDER BY c.sito_controllato LIMIT 200`).all(iso(adesso - cfg.monitorMinuti * MINUTO + 30e3))
    .filter(cl => statoAssistenza(cl, cfg, adesso).attiva);
  const staff = squadra(db, cfg);
  const avvisa = (cl, tipo, dati) => {
    for (const u of new Set([...staff, cl.installatore].filter(Boolean))) notifiche.notifica(u, tipo, { prodotto: cl.prodotto_nome, cliente: cl.nome || '', sito: cl.sito, ...dati });
  };
  for (let i = 0; i < l.length; i += 10) {
    const esiti = await Promise.all(l.slice(i, i + 10).map(cl => controlla(cl.sito, { locali: cfg.monitorLocali }).then(r => [cl, r])));
    for (const [cl, r] of esiti) {
      const ora = iso(adesso);
      db.prepare('INSERT INTO controllo_sito (cliente, quando, ok, codice, ms, errore) VALUES (?, ?, ?, ?, ?, ?)').run(cl.chiave, ora, r.ok ? 1 : 0, r.codice ?? null, r.ms ?? null, r.errore ?? null);
      // giù dopo due controlli falliti di fila (uno solo può essere la rete), su al primo che va bene
      const errori = r.ok ? 0 : cl.sito_errori + 1, stato = r.ok ? 'su' : errori >= 2 ? 'giu' : cl.sito_stato;
      db.prepare('UPDATE cliente SET sito_controllato = ?, sito_errori = ?, sito_stato = ?, sito_dal = CASE WHEN ? THEN ? ELSE sito_dal END, cert_scade = COALESCE(?, cert_scade) WHERE chiave = ?')
        .run(ora, errori, stato, stato !== cl.sito_stato ? 1 : 0, ora, r.cert ?? null, cl.chiave);
      if (stato === 'giu' && cl.sito_stato !== 'giu') {
        avvisa(cl, 'sito.giu', { errore: r.errore || `risponde ${r.codice}` });
        if (cl.email) notifiche.email(cl.email, 'sito_giu', { nome: cl.nome || '', prodotto: cl.prodotto_nome, sito: cl.sito, dal: ora,
          link: linkAssistenza(cfg, codiceAssistenza(db, cl.chiave)) }).catch(() => {});
      }
      if (stato === 'su' && cl.sito_stato === 'giu') avvisa(cl, 'sito.su', { minuti: Math.max(1, Math.round((adesso - Date.parse(cl.sito_dal || ora)) / MINUTO)) });
      // il certificato HTTPS: un avviso a 14 giorni dalla scadenza (una volta); rinnovato, si riparte
      if (r.cert) {
        const giorni = Math.floor((Date.parse(r.cert) - adesso) / GIORNO);
        if (giorni <= 14 && nuovoAvviso(db, cl.chiave, 'cert14')) avvisa(cl, 'certificato.scade', { giorni: Math.max(0, giorni), scade: r.cert });
        if (giorni > 30) togliAvvisi(db, cl.chiave, ['cert14']);
      }
    }
  }
  db.prepare('DELETE FROM controllo_sito WHERE quando < ?').run(iso(adesso - 40 * GIORNO));
  return l.length;
}

// il mese prima di `adesso` (UTC): 'AAAA-MM', con l'inizio e la fine
export function mesePrima(adesso = Date.now()) {
  const d = new Date(adesso), a = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1), da = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1);
  return { mese: iso(da).slice(0, 7), da: iso(da), a: iso(a) };
}

// il rapporto di un mese per un cliente: disponibilità, versioni del programma uscite e controllate, richieste e tempi di risposta
export function rapporto(db, cl, { mese, da, a }) {
  const versioni = db.prepare('SELECT tag, controllo FROM versione WHERE prodotto = ? AND pubblicata >= ? AND pubblicata < ? ORDER BY pubblicata').all(cl.prodotto, da, a);
  const r = db.prepare(`SELECT COUNT(*) aperte, SUM(CASE WHEN chiusa IS NOT NULL THEN 1 ELSE 0 END) risolte,
      AVG(CASE WHEN prima_risposta IS NOT NULL THEN (julianday(prima_risposta) - julianday(creata)) * 24 END) ore
    FROM richiesta WHERE cliente = ? AND creata >= ? AND creata < ?`).get(cl.chiave, da, a);
  return { mese, disponibilita: disponibilita(db, cl.chiave, da, a), sito: cl.sito || null, cert_scade: cl.cert_scade || null,
    versioni: versioni.map(v => ({ tag: v.tag, controllo: v.controllo || null })),
    richieste: { aperte: r.aperte || 0, risolte: r.risolte || 0, ore: r.ore == null ? null : Math.round(r.ore * 10) / 10 } };
}

// il giro dei rapporti (lavori.js): dal primo del mese, a ogni cliente con l'email e l'assistenza attiva che era già cliente il mese
// prima, il rapporto di quel mese (una volta sola)
export async function giroRapporti({ db, cfg, notifiche }, adesso = Date.now()) {
  const m = mesePrima(adesso);
  const l = db.prepare(`SELECT c.*, p.nome prodotto_nome FROM cliente c JOIN prodotto p ON p.id = c.prodotto WHERE c.email IS NOT NULL AND c.stato != 'cessato'
      AND c.creato < ? AND (c.rapporto IS NULL OR c.rapporto < ?) LIMIT 100`).all(m.a.replace('T', ' ').slice(0, 19), m.mese)
    .filter(cl => statoAssistenza(cl, cfg, adesso).attiva);
  for (const cl of l) {
    db.prepare('UPDATE cliente SET rapporto = ? WHERE chiave = ?').run(m.mese, cl.chiave);
    await notifiche.email(cl.email, 'rapporto_mese', { nome: cl.nome || '', prodotto: cl.prodotto_nome, ...rapporto(db, cl, m),
      link: linkAssistenza(cfg, codiceAssistenza(db, cl.chiave)) }).catch(() => {});
  }
  return l.length;
}
