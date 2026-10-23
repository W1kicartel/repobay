// I lavori che girano da soli: versare le quote maturate, consegnare i webhook, rileggere i progetti su GitHub, seguire l'assistenza
// (solleciti, sospensioni, scadenze), invitare i business a lasciare una recensione, pulire quello che è scaduto, fare una copia del database ogni giorno.
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { versaQuote } from './soldi.js';
import { controllaCustodie } from './custodia.js';
import { giroAssistenza } from './rotte/assistenza.js';
import { giroMonitoraggio, giroRapporti } from './monitoraggio.js';

export function avviaLavori({ db, cfg, stripe, notifiche, sincronizzazione, rpc = null, cercaDepositi = null, controlli = null }) {
  const ogni = (minuti, nome, fn) => {
    let occupato = false;
    const giro = async () => { if (occupato) return; occupato = true; try { const n = await fn(); if (n) console.log(`${nome}: ${n}`); } catch (e) { console.error(`${nome}:`, e.message); } finally { occupato = false; } };
    setTimeout(giro, 5000).unref?.(); setInterval(giro, minuti * 60e3).unref?.();
  };
  ogni(cfg.ogni, 'quote versate', () => versaQuote({ db, stripe, cfg, notifica: notifiche.notifica }));
  // gli ordini in escrow: si legge il contratto e si aggiornano quote, conferme e segnalazioni (il server non firma nulla)
  if (rpc && Object.keys(cfg.crypto.escrow).length) ogni(cfg.ogni, 'escrow aggiornati', () => controllaCustodie({ db, cfg, rpc, notifiche }));
  // i depositi che il browser non ha segnalato (pagina chiusa subito dopo aver firmato): li trova il server negli eventi del contratto
  if (cercaDepositi && Object.keys(cfg.crypto.escrow).length) ogni(1, 'depositi trovati', () => cercaDepositi());
  ogni(0.5, 'webhook consegnati', () => notifiche.consegne());
  // l'assistenza: solleciti a chi non risponde, segnalazioni alla piattaforma, sospensioni per i pagamenti mancati, scadenze in crypto
  ogni(15, 'assistenza', () => giroAssistenza({ db, cfg, notifiche }));
  // i programmi dei clienti con l'assistenza attiva, controllati da fuori; il rapporto del mese a ogni cliente (dal primo del mese)
  ogni(cfg.monitorMinuti, 'programmi controllati', () => giroMonitoraggio({ db, cfg, notifiche }));
  ogni(60, 'rapporti del mese', () => giroRapporti({ db, cfg, notifiche }));
  ogni(30, 'progetti riletti da GitHub', () => sincronizzazione.tutti(100));
  // i controlli di sicurezza: le release in attesa (antivirus e Trivy, uno alla volta) e il punteggio di ogni prodotto una volta a settimana
  if (controlli) ogni(20, 'controlli di sicurezza', () => controlli.giro(controlli.scansioni() ? 1 : 5));
  ogni(60, 'pulizia', () => {
    const adesso = new Date().toISOString();
    return ['DELETE FROM sessione WHERE scade < ?', 'DELETE FROM gettone WHERE scade < ?', 'DELETE FROM passaggio WHERE scade < ?', 'DELETE FROM sfida WHERE scade < ?',
      'DELETE FROM sfida_passkey WHERE scade < ?', 'DELETE FROM sessione_cliente WHERE scade < ?'].reduce((n, sql) => n + db.prepare(sql).run(adesso).changes, 0)
      + db.prepare("UPDATE ordine SET stato = 'scaduto' WHERE stato = 'aperto' AND scade < datetime('now', '-1 day')").run().changes
      + db.prepare("UPDATE bonifico SET stato = 'scaduto' WHERE stato = 'aperto' AND scade < ?").run(adesso).changes   // si può segnare ricevuto anche dopo
      + db.prepare("DELETE FROM consegna WHERE creata < datetime('now', '-30 days')").run().changes
      + db.prepare("DELETE FROM notifica WHERE letta = 1 AND creata < datetime('now', '-180 days')").run().changes
      + db.prepare("DELETE FROM contatto WHERE creato < datetime('now', '-24 months')").run().changes
      // le richieste di assistenza risolte da più di 24 mesi, con i loro messaggi (l'informativa privacy, punto 4)
      + db.prepare("DELETE FROM messaggio WHERE richiesta IN (SELECT id FROM richiesta WHERE stato = 'risolta' AND julianday(COALESCE(chiusa, aggiornata)) < julianday('now', '-24 months'))").run().changes
      + db.prepare("DELETE FROM richiesta WHERE stato = 'risolta' AND julianday(COALESCE(chiusa, aggiornata)) < julianday('now', '-24 months')").run().changes;
  });
  // due settimane dopo l'acquisto, l'invito a dire com'è andata (una volta sola, solo a chi ha lasciato l'email)
  ogni(360, 'inviti a recensire', async () => {
    const l = db.prepare(`SELECT c.chiave, c.email, c.nome, p.nome prodotto FROM cliente c JOIN prodotto p ON p.id = c.prodotto
      WHERE c.email IS NOT NULL AND c.invito IS NULL AND c.creato < datetime('now', '-14 days') AND c.creato > datetime('now', '-60 days')
      AND NOT EXISTS (SELECT 1 FROM recensione r WHERE r.cliente = c.chiave) LIMIT 50`).all();
    for (const x of l) {
      db.prepare("UPDATE cliente SET invito = datetime('now') WHERE chiave = ?").run(x.chiave);
      await notifiche.email(x.email, 'recensione', { nome: x.nome || x.email.split('@')[0], prodotto: x.prodotto, link: `${cfg.url}/cliente` });
    }
    return l.length;
  });
  // una copia al giorno (VACUUM INTO: coerente anche mentre si scrive), tenute COPIE_GIORNI
  if (cfg.copie > 0 && cfg.dati !== ':memory:') ogni(60, 'copia del database', () => {
    const cartella = join(cfg.dati, 'copie'); mkdirSync(cartella, { recursive: true });
    const oggi = new Date().toISOString().slice(0, 10), f = join(cartella, `${oggi}.db`);
    const ci = readdirSync(cartella).filter(x => /^\d{4}-\d\d-\d\d\.db$/.test(x)).sort();
    // le copie fatte a mano prima di una manutenzione (a-mano-<data>.db, con i loro -shm e -wal) durano quanto le giornaliere:
    // COPIE_GIORNI giorni dalla data nel nome (l'informativa privacy lo promette)
    const limite = new Date(Date.now() - cfg.copie * 864e5).toISOString().slice(0, 10);
    for (const x of readdirSync(cartella)) { const m = /^a-mano-(\d{4}-\d\d-\d\d)[-\d]*\.db(-shm|-wal)?$/.exec(x); if (m && m[1] < limite) rmSync(join(cartella, x)); }
    if (ci.includes(`${oggi}.db`)) return 0;
    db.exec(`VACUUM INTO '${f.replace(/'/g, "''")}'`);
    for (const x of ci.slice(0, Math.max(0, ci.length + 1 - cfg.copie))) rmSync(join(cartella, x));
    return 1;
  });
}
