// Le rotte del corso per installatori: le lezioni sono pubbliche (/corso), il test si fa con il proprio conto. Un test cominciato
// vale un'ora e, se si ricarica la pagina, torna con le stesse domande; chi non lo supera (o lo lascia scadere) riprova dopo
// CORSO_ATTESA_MINUTI. Chi gestisce la piattaforma sblocca i programmi impegnativi a chi fa già questo lavoro.
import { errore } from '../http.js';
import { corsoIn, livello, estrai, mostra, correggi, difficoltaDi, DURATA } from '../corso.js';

export function rotteCorso(c) {
  const { cfg, db, h } = c;
  const ultima = id => db.prepare('SELECT * FROM prova WHERE utente = ? ORDER BY id DESC LIMIT 1').get(id);
  const aperta = p => p && !p.consegnata && Date.parse(p.scade) > Date.now();
  // quando si può riprovare: dopo l'attesa dall'ultimo test non superato (consegnato, o lasciato scadere)
  const riprova = id => {
    const p = ultima(id);
    if (!p || p.superata || aperta(p)) return null;
    const t = Date.parse(p.consegnata || p.scade) + cfg.corso.attesa * 60e3;
    return t > Date.now() ? new Date(t).toISOString() : null;
  };
  const statoDi = io => io && { ...livello(db, cfg, io), riprova: riprova(io.id), inCorso: aperta(ultima(io.id)) };

  return {
    'GET /api/corso': async (req, res, { io }) => {
      const { titolo, lezioni } = corsoIn(c.lingua(req));
      // quanti programmi del catalogo si offrono con il test, e quanti chiedono esperienza
      const conti = { facile: 0, media: 0, impegnativa: 0, totale: 0 };
      for (const p of db.prepare("SELECT installazione FROM prodotto WHERE stato = 'pubblicato'").all()) { const d = difficoltaDi(p); conti.totale++; if (d in conti) conti[d]++; }
      h.rispondi(res, 200, { titolo, lezioni, domande: cfg.corso.domande, soglia: cfg.corso.soglia, attesa: cfg.corso.attesa, esperienza: cfg.corso.esperienza,
        obbligatorio: cfg.corso.obbligatorio, catalogo: conti, io: statoDi(io) });
    },
    'POST /api/corso/prova': async (req, res, { io }) => {
      c.serve(io);
      if (io.corso) throw errore(400, 'Hai già superato il test');
      let p = ultima(io.id);
      if (!aperta(p)) {
        const r = riprova(io.id);
        if (r) throw errore(429, `Puoi rifare il test fra ${Math.max(1, Math.ceil((Date.parse(r) - Date.now()) / 60e3))} minuti: intanto rileggi le lezioni indicate`);
        const ora = new Date();
        const id = db.prepare('INSERT INTO prova (utente, domande, iniziata, scade) VALUES (?, ?, ?, ?)')
          .run(io.id, JSON.stringify(estrai(cfg.corso.domande)), ora.toISOString(), new Date(ora.getTime() + DURATA).toISOString()).lastInsertRowid;
        p = db.prepare('SELECT * FROM prova WHERE id = ?').get(id);
      }
      h.rispondi(res, 200, { prova: p.id, scade: p.scade, soglia: cfg.corso.soglia, domande: mostra(JSON.parse(p.domande), c.lingua(req)) });
    },
    'POST /api/corso/consegna': async (req, res, { io }) => {
      c.serve(io);
      const { prova, risposte } = await h.json(req);
      const p = db.prepare('SELECT * FROM prova WHERE id = ? AND utente = ?').get(Number(prova), io.id);
      if (!p) throw errore(404, 'Test non trovato: comincialo di nuovo');
      if (p.consegnata) throw errore(400, 'Questo test è già stato consegnato');
      if (Date.parse(p.scade) + 2 * 60e3 < Date.now()) throw errore(400, 'Il tempo per questo test è finito: comincialo di nuovo');
      if (!Array.isArray(risposte)) throw errore(400, 'Mancano le risposte');
      const r = correggi(JSON.parse(p.domande), risposte, c.lingua(req)), superata = r.giuste >= cfg.corso.soglia, ora = new Date().toISOString();
      // la consegna conta una volta sola, anche con due invii insieme
      if (!db.prepare('UPDATE prova SET consegnata = ?, giuste = ?, superata = ? WHERE id = ? AND consegnata IS NULL').run(ora, r.giuste, superata ? 1 : 0, p.id).changes)
        throw errore(400, 'Questo test è già stato consegnato');
      if (superata) db.prepare('UPDATE utente SET corso = ?, corso_punti = ? WHERE id = ? AND corso IS NULL').run(ora, r.giuste, io.id);
      const u = db.prepare('SELECT * FROM utente WHERE id = ?').get(io.id);
      h.rispondi(res, 200, { ...r, soglia: cfg.corso.soglia, superato: superata, stato: statoDi(u) });
    },
    // chi gestisce la piattaforma: i programmi impegnativi per chi fa già questo lavoro (o il contrario)
    'POST /api/admin/installatore/esperto': async (req, res, { io }) => {
      if (!c.eAdmin(io)) throw errore(403, 'Solo per chi gestisce la piattaforma');
      const { id, esperto } = await h.json(req);
      const n = db.prepare('UPDATE utente SET esperto = ? WHERE id = ? AND cancellato IS NULL AND segnaposto = 0').run(esperto ? new Date().toISOString() : null, Number(id)).changes;
      if (!n) throw errore(404, 'Utente non trovato');
      h.rispondi(res, 200, { ok: true });
    },
  };
}
