// L'assistenza dopo la vendita e i pagamenti che non arrivano.
// Il programma installato è del cliente: licenza open source, server e dati suoi. Non si blocca mai: farlo per farsi pagare in
// Italia è esercizio arbitrario delle proprie ragioni (art. 392 c.p., che nomina proprio il sistema informatico reso inservibile).
// Quello che si vende ogni mese è il servizio (assistenza, aggiornamenti, controlli), pagato in anticipo: se un addebito non va,
// Stripe riprova, l'assistenza resta attiva per i giorni di grazia, poi si sospende e riparte appena il cliente paga.
// Qui: lo stato dell'assistenza di un cliente, il codice segreto dell'installazione (bolla e pagina), il canone pagato in anticipo.
import { randomBytes } from 'node:crypto';

const giorno = 864e5;
const iso = t => new Date(t).toISOString();

// il canone di più mesi pagati in anticipo: da un anno in su, con lo sconto (SCONTO_ANNO)
export const canone = (prezzoMese, mesi, sconto) => Math.round(prezzoMese * mesi * (mesi >= 12 ? 1 - sconto : 1));

// → { attiva, motivo, … }. motivo:
//   regolare    paga con carta o addebito, tutto in ordine (disdetta: l'abbonamento finisce a quella data)
//   in_arrivo   addebito SEPA partito, i soldi arrivano in qualche giorno: chi installa aspetta prima di andare
//   ritardo     un addebito non è andato: Stripe riprova, l'assistenza resta attiva fino a «sospesaIl»
//   pagata      pagata in anticipo (crypto) fino a «fino»
//   sospesa     non paga da più dei giorni di grazia (o Stripe ha finito i tentativi)
//   scaduta     il periodo pagato in anticipo è finito e non è stato rinnovato
//   cessata     abbonamento chiuso
//   non_inclusa il prodotto non ha canone: chi installa dice se e quanto costa un intervento
export function statoAssistenza(cl, cfg, adesso = Date.now()) {
  if (!cl || cl.stato === 'cessato') return { attiva: false, motivo: 'cessata' };
  if (cl.assistenza_fino) {
    const fino = Date.parse(cl.assistenza_fino);
    return fino > adesso ? { attiva: true, motivo: 'pagata', fino: cl.assistenza_fino, giorni: Math.ceil((fino - adesso) / giorno) }
      : { attiva: false, motivo: 'scaduta', fino: cl.assistenza_fino };
  }
  if (/^(cs|cr|bn)_/.test(String(cl.chiave || ''))) return { attiva: true, motivo: 'non_inclusa' };
  if (cl.pagamento === 'in_ritardo' || cl.pagamento === 'insoluto') {
    const sospesaIl = Date.parse(cl.insoluto_dal || iso(adesso)) + cfg.grazia * giorno;
    if (cl.pagamento === 'insoluto' || adesso >= sospesaIl) return { attiva: false, motivo: 'sospesa', dal: iso(Math.min(sospesaIl, adesso)) };
    return { attiva: true, motivo: 'ritardo', sospesaIl: iso(sospesaIl), giorni: Math.max(1, Math.ceil((sospesaIl - adesso) / giorno)) };
  }
  if (cl.pagamento === 'in_arrivo') return { attiva: true, motivo: 'in_arrivo' };
  return { attiva: true, motivo: 'regolare', ...(cl.disdetta ? { disdetta: cl.disdetta } : {}) };
}

// il codice dell'installazione: chi lo ha può aprire richieste di assistenza e leggerle, nient'altro (né pagamenti né dati del
// cliente). Sta nella bolla dentro il programma, nel link salvato sul telefono, nel QR. Si può rifare (il vecchio smette di valere).
// Il canone dell'assistenza: uno solo, uguale per tutti i prodotti (lo decide la piattaforma, che l'assistenza la dà). Sta
// nell'impostazione assistenza_mese; finché chi gestisce non lo cambia dal pannello vale ASSISTENZA_MESE. prodotto.prezzo_mese è
// una copia, tenuta allineata all'avvio e a ogni cambio, perché vendite, rinnovi, riattivazioni e SEO leggono il prodotto
export function canoneMese(db, cfg) {
  const v = Number(db.prepare("SELECT valore FROM impostazione WHERE chiave = 'assistenza_mese'").get()?.valore);
  return Number.isInteger(v) && v >= 0 ? v : cfg.assistenzaMese;
}
export function allineaCanone(db, cfg) {
  const v = canoneMese(db, cfg);
  return db.prepare('UPDATE prodotto SET prezzo_mese = ? WHERE prezzo_mese != ?').run(v, v).changes;
}
export const CODICE = /^[A-Za-z0-9_-]{24}$/;
// un'installazione riattivata continua con l'abbonamento nuovo (cliente.riattivato, soldi.js): codice, richieste e stato sono lì
export function attuale(db, cl) {
  for (let i = 0; cl?.riattivato && i < 20; i++) { const x = db.prepare('SELECT * FROM cliente WHERE chiave = ?').get(cl.riattivato); if (!x) break; cl = x; }
  return cl;
}
export function codiceAssistenza(db, chiave, { nuovo = false } = {}) {
  const cl = attuale(db, db.prepare('SELECT chiave, assistenza, riattivato FROM cliente WHERE chiave = ?').get(chiave)); if (!cl) return null;
  chiave = cl.chiave;
  if (cl.assistenza && !nuovo) return cl.assistenza;
  const k = randomBytes(18).toString('base64url');
  db.prepare('UPDATE cliente SET assistenza = ? WHERE chiave = ?').run(k, chiave);
  return k;
}
export const linkAssistenza = (cfg, k) => `${cfg.url}/assistenza/${k}`;

// la bolla da mettere nelle pagine di amministrazione del programma installato: solo HTML (un link con gli stili in linea),
// nessuno script caricato da fuori dentro il programma del cliente. Si apre in una scheda nuova.
export function bolla(cfg, k, { lingua = 'it' } = {}) {
  const t = lingua === 'en' ? { a: 'Support', t: 'Support: write to whoever installed this software' } : { a: 'Assistenza', t: 'Assistenza: scrivi a chi ha installato il programma' };
  return `<a href="${linkAssistenza(cfg, k)}?da=bolla" target="_blank" rel="noopener" aria-label="${t.a}" title="${t.t}" style="position:fixed;right:20px;bottom:20px;z-index:2147483000;display:flex;align-items:center;justify-content:center;width:52px;height:52px;border-radius:50%;background:#7B3DFF;color:#FFFFFF;border:2px solid #0D0B11;box-shadow:3px 3px 0 #0D0B11;text-decoration:none"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3 20.5l1.7-5.4A8.4 8.4 0 1 1 21 11.5z"/></svg></a>`;
}

// gli avvisi già mandati a un cliente (una volta sola ciascuno): → true se è nuovo, e lo segna
export function nuovoAvviso(db, chiave, tipo) {
  const r = db.prepare('SELECT avvisi FROM cliente WHERE chiave = ?').get(chiave); if (!r) return false;
  let a = []; try { a = JSON.parse(r.avvisi || '[]'); } catch { }
  if (a.includes(tipo)) return false;
  db.prepare('UPDATE cliente SET avvisi = ? WHERE chiave = ?').run(JSON.stringify([...a, tipo]), chiave);
  return true;
}
export function togliAvvisi(db, chiave, tipi) {
  const r = db.prepare('SELECT avvisi FROM cliente WHERE chiave = ?').get(chiave); if (!r?.avvisi) return;
  let a = []; try { a = JSON.parse(r.avvisi); } catch { }
  db.prepare('UPDATE cliente SET avvisi = ? WHERE chiave = ?').run(JSON.stringify(a.filter(x => !tipi.includes(x))), chiave);
}

// chi gestisce la piattaforma (APP_ADMIN): un'email confermata, un id GitHub (github:<id>) o un login GitHub. Un login GitHub si può
// cambiare e lasciar libero, e chi lo riprende non deve diventare admin: il primo conto che entra con quel login lo fissa al suo id
// GitHub (impostazione admin_github:<login>), e da lì vale solo quell'id. Fissarlo all'avvio (fissaAdmin) toglie anche quella prima volta
export function eAdminDi(db, cfg, u) {
  if (!u || u.segnaposto) return false;
  if (u.email_verificata && cfg.admin.includes(String(u.email || '').toLowerCase())) return true;
  if (!u.github_id) return false;
  if (cfg.admin.includes(`github:${u.github_id}`)) return true;
  const l = String(u.github_login || '').toLowerCase(); if (!l || !cfg.admin.includes(l)) return false;
  const k = `admin_github:${l}`, fissato = db.prepare('SELECT valore FROM impostazione WHERE chiave = ?').get(k)?.valore;
  if (fissato) return fissato === String(u.github_id);
  db.prepare('INSERT OR IGNORE INTO impostazione (chiave, valore) VALUES (?, ?)').run(k, String(u.github_id));
  return db.prepare('SELECT valore FROM impostazione WHERE chiave = ?').get(k)?.valore === String(u.github_id);
}
// all'avvio: i login GitHub di APP_ADMIN che hanno già un conto si fissano al suo id
export function fissaAdmin(db, cfg) {
  for (const l of cfg.admin.filter(a => !a.includes('@') && !a.startsWith('github:'))) {
    const u = db.prepare('SELECT github_id FROM utente WHERE lower(github_login) = ? AND github_id IS NOT NULL AND segnaposto = 0 AND cancellato IS NULL ORDER BY id LIMIT 1').get(l);
    if (u) db.prepare('INSERT OR IGNORE INTO impostazione (chiave, valore) VALUES (?, ?)').run(`admin_github:${l}`, String(u.github_id));
  }
}
// chi gestisce la piattaforma fra gli iscritti (come eAdmin in app.js): chi risponde
export function squadra(db, cfg) {
  if (!cfg.admin.length) return [];
  const segni = cfg.admin.map(() => '?').join(', ');
  return db.prepare(`SELECT * FROM utente WHERE stato = 'attivo' AND segnaposto = 0 AND ((lower(email) IN (${segni}) AND email_verificata IS NOT NULL)
    OR (github_id IS NOT NULL AND (lower(github_login) IN (${segni}) OR 'github:' || github_id IN (${segni}))))`).all(...cfg.admin, ...cfg.admin, ...cfg.admin)
    .filter(u => eAdminDi(db, cfg, u)).map(u => u.id);
}

// a chi va detto: chi installa e chi sviluppa (una volta sola se sono la stessa persona)
export function interessati(db, cl) {
  const p = cl?.prodotto && db.prepare('SELECT id, nome, slug, builder, prezzo_mese FROM prodotto WHERE id = ?').get(cl.prodotto);
  return { p, utenti: p ? [...new Set([cl.installatore, p.builder].filter(Boolean))] : [] };
}
// l'email del cliente con un indirizzo mascherato, da mostrare a chi ha solo il codice dell'installazione
export const mascherata = e => String(e || '').replace(/^(.)[^@]*(@.).*?(\.[^.]+)$/, (_, a, b, c) => `${a}•••${b}•••${c}`);
