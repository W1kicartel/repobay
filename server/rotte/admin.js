// Le rotte di chi gestisce la piattaforma: numeri, revisione dei prodotti, utenti, recensioni, consegne dei webhook fallite,
// ordini in crypto, versamenti, l'esportazione DAC7 per il commercialista, l'interruttore del prelancio.
import { decifra } from '../conti.js';
import { riepilogoDac7 } from '../fiscale.js';
import { versaQuote } from '../soldi.js';
import { readFileSync } from 'node:fs';
import { errore, testo } from '../http.js';
import { pulisciLicenza, pulisciProgramma, pulisciRef } from '../github.js';
import { chiaveOrdine, datiAzione, pagamentiDecisi, totaleDi } from '../escrow.js';

export function rotteAdmin(c) {
  const { cfg, db, h, stripe, chiave, notifiche } = c;
  const capo = io => { if (!c.eAdmin(io)) throw errore(403, 'Solo per chi gestisce la piattaforma'); };
  const n = (sql, ...p) => db.prepare(sql).get(...p).n;

  return {
    'GET /api/admin': async (req, res, { io, url }) => {
      capo(io); const q = testo(url.searchParams.get('q'), 80).toLowerCase();
      const mese = new Date(); mese.setUTCDate(1); const da = mese.toISOString().slice(0, 10);
      h.rispondi(res, 200, {
        numeri: {
          utenti: n("SELECT COUNT(*) n FROM utente WHERE cancellato IS NULL AND segnaposto = 0"), builder: n("SELECT COUNT(DISTINCT builder) n FROM prodotto WHERE stato = 'pubblicato'"),
          installatori: n('SELECT COUNT(DISTINCT installatore) n FROM adozione'), prodotti: n("SELECT COUNT(*) n FROM prodotto WHERE stato = 'pubblicato'"),
          inRevisione: n("SELECT COUNT(*) n FROM prodotto WHERE stato = 'revisione'"), clienti: n("SELECT COUNT(*) n FROM cliente WHERE stato = 'attivo'"),
          venditeMese: n('SELECT COUNT(*) n FROM cliente WHERE creato >= ?', da), richiesteMese: n('SELECT COUNT(*) n FROM contatto WHERE creato >= ?', da),
          versatoMese: n("SELECT COALESCE(SUM(importo - stornato), 0) n FROM quota WHERE stato = 'versata' AND creato >= ?", da),
          inAttesa: n("SELECT COALESCE(SUM(importo - stornato), 0) n FROM quota WHERE stato = 'in_attesa'"),
          inEscrow: n("SELECT COALESCE(SUM(importo - stornato), 0) n FROM quota WHERE stato = 'in_escrow'"),
          webhookFalliti: n("SELECT COUNT(*) n FROM consegna WHERE stato = 'fallita' AND creata >= datetime('now', '-7 days')"),
          contestazioniAperte: n("SELECT COUNT(*) n FROM contestazione WHERE stato = 'aperta'"),
        },
        prelancio: c.prelancio(), assistenzaMese: c.canoneMese(), nonRivendicati: !!cfg.nonRivendicati, nonRivendicatiPagamenti: !!cfg.nonRivendicatiPagamenti,
        vetrinaCurata: (() => { try { return JSON.parse(readFileSync(new URL('../vetrina.json', import.meta.url), 'utf8')).progetti.length; } catch { return 0; } })(),
        prodotti: db.prepare(`SELECT p.*, u.nome builder_nome, u.github_login, u.segnaposto, (SELECT COUNT(*) FROM adozione a WHERE a.prodotto = p.id AND a.quota IS NOT NULL) accordi
          FROM prodotto p JOIN utente u ON u.id = p.builder
          ORDER BY CASE p.stato WHEN 'revisione' THEN 0 ELSE 1 END, p.aggiornato DESC LIMIT 300`).all().map(p => ({ ...c.vista(p), builder: p.builder_nome, github: p.github_login, rivendicato: !p.segnaposto, accordi: p.accordi, sicurezza: c.controlli?.ultimo(p.id) || null,
            ferma: db.prepare("SELECT tag FROM versione WHERE prodotto = ? AND controllo = 'grave' ORDER BY vista DESC LIMIT 1").get(p.id)?.tag || null })),
        quotaInstallatore: cfg.quotaInstallatore, assistenzaPiattaforma: cfg.assistenzaPiattaforma,

        utenti: db.prepare(`SELECT u.id, u.nome, u.email, u.email_verificata IS NOT NULL verificata, u.github_login, u.zona, u.stato, u.stripe_pronto pronto, u.totp IS NOT NULL dueFattori, u.creato, u.corso, u.corso_punti, u.esperto IS NOT NULL esperto,
          (SELECT COUNT(*) FROM cliente c WHERE c.installatore = u.id AND c.confermato IS NOT NULL) confermate,
          (SELECT COUNT(*) FROM prodotto p WHERE p.builder = u.id) prodotti, (SELECT COUNT(*) FROM adozione a WHERE a.installatore = u.id) adozioni,
          (SELECT COALESCE(SUM(importo - stornato), 0) FROM quota q WHERE q.beneficiario = u.id AND q.stato = 'in_attesa') attesa,
          (SELECT COALESCE(SUM(importo - stornato), 0) FROM quota q WHERE q.beneficiario = u.id AND q.stato = 'versata') versate
          FROM utente u WHERE u.cancellato IS NULL AND (? = '' OR lower(u.nome) LIKE ? OR lower(u.email) LIKE ? OR lower(u.github_login) LIKE ?) ORDER BY u.creato DESC LIMIT 300`)
          .all(q, `%${q}%`, `%${q}%`, `%${q}%`).map(u => ({ ...u, verificata: !!u.verificata, dueFattori: !!u.dueFattori, esperto: !!u.esperto })),
        errori: db.prepare("SELECT id, beneficiario, importo, errore FROM quota WHERE errore IS NOT NULL AND stato = 'in_attesa' LIMIT 100").all(),
        ordini: db.prepare(`SELECT o.codice, o.rete, o.simbolo, o.euro, o.stato, o.pagatore, o.tx, o.creato, o.escrow IS NOT NULL AS escrow, o.custodia, o.sblocco, p.nome prodotto, u.nome installatore
          FROM ordine o JOIN prodotto p ON p.id = o.prodotto JOIN utente u ON u.id = o.installatore ORDER BY o.id DESC LIMIT 100`).all().map(o => ({ ...o, escrow: !!o.escrow })),
        recensioni: db.prepare('SELECT r.cliente, r.voto, r.testo, r.autore, r.nascosta, r.creata, p.nome prodotto FROM recensione r JOIN prodotto p ON p.id = r.prodotto ORDER BY r.creata DESC LIMIT 100').all(),
        contestazioni: db.prepare(`SELECT k.id, k.cliente, k.email, k.testo, k.stato, k.esito, k.importo, k.nota, k.creata, k.chiusa, c.nome attivita, c.creato acquistato, c.confermato,
            c.chiave LIKE 'cr_%' AS crypto, CASE WHEN c.chiave LIKE 'cr_%' THEN 'crypto' WHEN c.chiave LIKE 'bn_%' THEN 'bonifico' ELSE 'carta' END metodo, p.nome prodotto, p.slug, i.nome installatore, i.codice installatore_codice, i.stato installatore_stato,
            (SELECT COALESCE(SUM(importo - stornato), 0) FROM quota q WHERE q.cliente = k.cliente AND q.stato = 'contestata') ferme,
            (SELECT COALESCE(SUM(importo - stornato), 0) FROM quota q WHERE q.cliente = k.cliente AND q.stato = 'versata') versate,
            (SELECT COALESCE(SUM(base), 0) FROM (SELECT DISTINCT q.fattura, q.riga, q.base FROM quota q WHERE q.cliente = k.cliente
              AND q.fattura = (SELECT q2.fattura FROM quota q2 WHERE q2.cliente = k.cliente ORDER BY q2.creato DESC, q2.id DESC LIMIT 1))) pagato,
            (SELECT q.pagamento FROM quota q WHERE q.cliente = k.cliente AND q.pagamento IS NOT NULL ORDER BY q.creato DESC LIMIT 1) pagamento,
            (SELECT COALESCE(SUM(importo - stornato), 0) FROM quota q WHERE q.cliente = k.cliente AND q.stato = 'in_escrow') in_escrow,
            o.codice ordine, o.escrow IS NOT NULL AS escrow, o.custodia, o.sblocco, o.congelato, o.rete, o.euro euro_ordine
          FROM contestazione k JOIN cliente c ON c.chiave = k.cliente LEFT JOIN prodotto p ON p.id = c.prodotto LEFT JOIN utente i ON i.id = c.installatore
          LEFT JOIN ordine o ON k.cliente LIKE 'cr_%' AND o.codice = substr(k.cliente, 4) AND o.escrow IS NOT NULL
          ORDER BY CASE k.stato WHEN 'aperta' THEN 0 ELSE 1 END, k.creata DESC LIMIT 200`).all().map(k => ({ ...k, crypto: !!k.crypto, escrow: !!k.escrow })),
      });
    },
    'POST /api/admin/prodotto': async (req, res, { io }) => {
      capo(io); const { id, stato, nota } = await h.json(req);
      if (!['pubblicato', 'respinto', 'sospeso'].includes(stato)) throw errore(400, 'stato non valido');
      const p = db.prepare('SELECT * FROM prodotto WHERE id = ?').get(Number(id)); if (!p) throw errore(404, 'Prodotto non trovato');
      db.prepare("UPDATE prodotto SET stato = ?, nota = ?, aggiornato = datetime('now') WHERE id = ?").run(stato, testo(nota, 400) || null, p.id);
      if (stato !== p.stato) notifiche.notifica(p.builder, `prodotto.${stato}`, { prodotto: p.nome, slug: p.slug, nota: testo(nota, 400) || null });
      h.rispondi(res, 200, { ok: true });
    },
    // il canone dell'assistenza: uno solo per tutti i prodotti, lo decide chi gestisce la piattaforma (che l'assistenza la dà;
    // 0 = senza assistenza). Vale per le vendite nuove: gli abbonamenti già fatti restano al loro prezzo
    'POST /api/admin/assistenza': async (req, res, { io }) => {
      capo(io); const x = await h.json(req);
      const v = Math.round(Number(String(x.prezzo_mese ?? '').replace(',', '.')) * 100);
      if (!Number.isInteger(v) || v < 0 || v > 500_000 || (v > 0 && v < cfg.prezzoMin)) throw errore(400, `Canone non valido (0, oppure almeno ${cfg.prezzoMin / 100} € al mese)`);
      db.prepare("INSERT INTO impostazione (chiave, valore) VALUES ('assistenza_mese', ?) ON CONFLICT(chiave) DO UPDATE SET valore = excluded.valore").run(String(v));
      const prodotti = db.prepare("UPDATE prodotto SET prezzo_mese = ?, aggiornato = datetime('now') WHERE prezzo_mese != ?").run(v, v).changes;
      h.rispondi(res, 200, { ok: true, prezzo_mese: v, prodotti });
    },
    // la licenza letta a mano: quando GitHub non la riconosce (NOASSERTION) o non è open source (n8n, Elastic…). «interna»: si
    // vendono solo installazione e assistenza sul server del cliente. Senza licenza (null) torna a valere quella di GitHub.
    'POST /api/admin/prodotto/licenza': async (req, res, { io }) => {
      capo(io); const x = await h.json(req);
      const p = db.prepare('SELECT * FROM prodotto WHERE id = ?').get(Number(x.id)); if (!p) throw errore(404, 'Prodotto non trovato');
      if (x.licenza === null) {
        db.prepare("UPDATE prodotto SET licenza_tipo = 'aperta', licenza_nome = NULL, licenza_nota = NULL, licenza_fonte = NULL, licenza_verificata = NULL WHERE id = ?").run(p.id);
        db.prepare("DELETE FROM cache_github WHERE url = ?").run(`/repos/${p.repo}`);   // la prossima lettura prende la licenza da GitHub
        await c.sincronizzazione.prodotto(db.prepare('SELECT * FROM prodotto WHERE id = ?').get(p.id)).catch(() => null);
        return h.rispondi(res, 200, { ok: true });
      }
      const l = pulisciLicenza(x.licenza); if (!l) throw errore(400, 'Servono tipo (aperta o interna), nome, una spiegazione di almeno due righe e il link al file della licenza');
      c.segnaLicenza(p.id, l);
      h.rispondi(res, 200, { ok: true });
    },
    // una release fermata dai controlli di sicurezza e verificata a mano (falso allarme): si annuncia a chi installa, con l'avviso
    'POST /api/admin/sicurezza/sblocca': async (req, res, { io }) => {
      capo(io); const x = await h.json(req);
      const p = db.prepare('SELECT * FROM prodotto WHERE id = ?').get(Number(x.id)); if (!p) throw errore(404, 'Prodotto non trovato');
      const v = db.prepare("SELECT * FROM versione WHERE prodotto = ? AND tag = ? AND controllo = 'grave'").get(p.id, String(x.tag || '')); if (!v) throw errore(404, 'Nessuna release ferma con questo nome');
      const nota = testo(x.nota, 300) || 'verificata a mano da chi gestisce la piattaforma';
      const dettagli = [{ fonte: 'piattaforma', esito: 'attenzione', testo: `Sbloccata a mano: ${nota}` }];
      db.prepare("INSERT INTO controllo (prodotto, versione, esito, dettagli) VALUES (?, ?, 'attenzione', ?)").run(p.id, v.tag, JSON.stringify(dettagli));
      db.prepare("UPDATE versione SET controllo = 'attenzione' WHERE prodotto = ? AND tag = ?").run(p.id, v.tag);
      c.controlli.avvisa(p, v, { esito: 'attenzione', dettagli });
      h.rispondi(res, 200, { ok: true });
    },
    // il programma partner dell'azienda (chi offre il prodotto ne rispetta le condizioni) e il link referral di Repobay; null li toglie
    'POST /api/admin/prodotto/programma': async (req, res, { io }) => {
      capo(io); const x = await h.json(req);
      const p = db.prepare('SELECT * FROM prodotto WHERE id = ?').get(Number(x.id)); if (!p) throw errore(404, 'Prodotto non trovato');
      if (x.programma !== undefined) {
        const pr = x.programma === null ? null : pulisciProgramma(x.programma);
        if (x.programma !== null && !pr) throw errore(400, 'Programma partner non valido: servono nome, link https per aderire e le condizioni in breve');
        c.segnaProgramma(p.id, pr);
      }
      if (x.ref !== undefined) {
        const r = x.ref === null ? null : pulisciRef(x.ref);
        if (x.ref !== null && !r) throw errore(400, 'Link referral non valido: servono un link https e la frase che lo presenta');
        c.segnaRef(p.id, r);
      }
      h.rispondi(res, 200, { ok: true });
    },
    'POST /api/admin/utente': async (req, res, { io }) => {
      capo(io); const { id, stato } = await h.json(req);
      if (!['attivo', 'sospeso'].includes(stato)) throw errore(400, 'stato non valido');
      if (Number(id) === io.id && stato === 'sospeso') throw errore(400, 'Non puoi sospendere il tuo conto: resteresti fuori');
      const ok = db.prepare('UPDATE utente SET stato = ? WHERE id = ? AND cancellato IS NULL AND segnaposto = 0').run(stato, Number(id)).changes === 1;
      if (ok && stato === 'sospeso') db.prepare('DELETE FROM sessione WHERE utente = ?').run(Number(id));
      h.rispondi(res, 200, { ok });
    },
    'POST /api/admin/recensione': async (req, res, { io }) => {   // nascondere una recensione (offensiva, falsa, con dati personali)
      capo(io); const { cliente, nascosta } = await h.json(req);
      h.rispondi(res, 200, { ok: db.prepare('UPDATE recensione SET nascosta = ? WHERE cliente = ?').run(nascosta ? 1 : 0, String(cliente || '')).changes === 1 });
    },
    'POST /api/admin/contestazione': async (req, res, { io }) => {   // la decisione: tutto regolare, rimborso (con carta), oppure ritirata
      capo(io); const { id, esito, importo, nota } = await h.json(req);
      if (!['regolare', 'rimborso', 'annullata'].includes(esito)) throw errore(400, 'esito non valido');
      const k = db.prepare("SELECT * FROM contestazione WHERE id = ? AND stato = 'aperta'").get(Number(id)); if (!k) throw errore(404, 'Segnalazione non trovata o già chiusa');
      const cl = db.prepare('SELECT c.*, p.nome prodotto, p.slug, p.builder FROM cliente c LEFT JOIN prodotto p ON p.id = c.prodotto WHERE c.chiave = ?').get(k.cliente);
      let rimborsati = 0;
      // in escrow decide il contratto: il rimborso si fa lì («Decidi sul contratto»), e finché il pagamento è congelato la segnalazione si chiude solo da lì
      const ord = k.cliente.startsWith('cr_') ? db.prepare('SELECT escrow, custodia FROM ordine WHERE codice = ? AND escrow IS NOT NULL').get(k.cliente.slice(3)) : null;
      if (ord && esito === 'rimborso') throw errore(400, 'Il pagamento è nel contratto escrow: il rimborso si decide lì, con «Decidi sul contratto»');
      if (ord && ord.custodia === 'contestato') throw errore(400, 'Il pagamento è congelato sul contratto: decidi lì, la segnalazione si chiude da sola');
      if (esito === 'rimborso' && k.cliente.startsWith('bn_')) {
        // il bonifico (o la carta del POS) è arrivato sul conto della piattaforma: il rimborso lo fa chi gestisce, dalla banca. Qui si
        // registra quanto, e le quote di quell'acquisto non ancora versate si annullano in proporzione
        const q = db.prepare(`SELECT COALESCE(SUM(base), 0) pagato FROM (SELECT DISTINCT fattura, riga, base FROM quota WHERE cliente = ?
          AND fattura = (SELECT fattura FROM quota WHERE cliente = ? ORDER BY creato DESC, id DESC LIMIT 1))`).get(k.cliente, k.cliente);
        rimborsati = importo === undefined || importo === null || importo === '' ? q.pagato : Number(importo);
        if (!Number.isInteger(rimborsati) || rimborsati <= 0 || rimborsati > q.pagato) throw errore(400, `L'importo va da 1 a ${q.pagato} centesimi`);
        const f = q.pagato ? rimborsati / q.pagato : 1;
        for (const x of db.prepare("SELECT * FROM quota WHERE cliente = ? AND stato IN ('manuale', 'contestata', 'in_attesa')").all(k.cliente)) {
          const stornato = Math.min(x.importo, x.stornato + Math.round(x.importo * f));
          db.prepare('UPDATE quota SET stornato = ?, stato = CASE WHEN ? >= importo THEN \'annullata\' ELSE stato END WHERE id = ?').run(stornato, stornato, x.id);
        }
      } else if (esito === 'rimborso') {
        if (k.cliente.startsWith('cr_')) throw errore(400, 'Un pagamento in crypto non passa dalla piattaforma: il rimborso lo fa l\'installatore dal suo wallet');
        const q = db.prepare(`SELECT pagamento, SUM(base) pagato FROM (SELECT DISTINCT pagamento, fattura, riga, base, creato FROM quota WHERE cliente = ? AND pagamento IS NOT NULL)
          GROUP BY pagamento ORDER BY MAX(creato) DESC LIMIT 1`).get(k.cliente);
        if (!q?.pagamento) throw errore(400, 'Nessun pagamento con carta registrato per questo acquisto');
        rimborsati = importo === undefined || importo === null || importo === '' ? q.pagato : Number(importo);
        if (!Number.isInteger(rimborsati) || rimborsati <= 0 || rimborsati > q.pagato) throw errore(400, `L'importo va da 1 a ${q.pagato} centesimi`);
        await stripe.post('/v1/refunds', { payment_intent: q.pagamento, amount: rimborsati, metadata: { contestazione: k.id } }, { idempotenza: `contestazione-${k.id}` });
      }
      db.prepare("UPDATE contestazione SET stato = 'chiusa', esito = ?, importo = ?, nota = ?, chiusa = datetime('now') WHERE id = ?").run(esito, rimborsati, testo(nota, 1000) || null, k.id);
      // le quote ripartono, se non le ferma anche una contestazione su Stripe; dopo un rimborso il webhook charge.refunded le storna (o le annulla) da solo
      db.prepare(`UPDATE quota SET ferma_segnalazione = 0, stato = CASE WHEN stato = 'contestata' AND ferma_stripe = 0 THEN (CASE WHEN fattura LIKE 'bn_%' THEN 'manuale' ELSE 'in_attesa' END) ELSE stato END
        WHERE cliente = ? AND ferma_segnalazione = 1`).run(k.cliente);
      for (const u of new Set([cl?.installatore, cl?.builder].filter(Boolean))) notifiche.notifica(u, 'contestazione.chiusa', { prodotto: cl.prodotto, slug: cl.slug, esito, importo: rimborsati });
      if (k.email) notifiche.email(k.email, 'contestazione_esito', { prodotto: cl?.prodotto || '', esito, importo: rimborsati, nota: testo(nota, 1000) || null, link: `${cfg.url}/cliente` }).catch(() => {});
      h.rispondi(res, 200, { ok: true, esito, importo: rimborsati });
    },
    // la decisione sul contratto escrow: quanto torna al cliente e a carico di chi; il server prepara i dati, l'arbitro li firma col suo wallet
    'POST /api/admin/escrow/risolvi': async (req, res, { io }) => {
      capo(io); const { codice, rimborso, carico = 'tutti', nota } = await h.json(req);
      const o = db.prepare('SELECT * FROM ordine WHERE codice = ?').get(String(codice || '')); if (!o?.escrow) throw errore(404, 'Ordine non trovato');
      if (o.custodia !== 'contestato') throw errore(400, 'Il pagamento non è congelato sul contratto: non c\'è niente da decidere');
      if (!['tutti', 'installatore', 'builder'].includes(carico)) throw errore(400, 'carico non valido');
      const cent = Number(rimborso ?? 0); if (!Number.isInteger(cent) || cent < 0 || cent > o.euro) throw errore(400, `Il rimborso va da 0 a ${o.euro} centesimi`);
      if (!o.pagatore) throw errore(400, 'Il deposito non è ancora registrato');
      const pt = JSON.parse(o.parti), totale = totaleDi(pt), id = chiaveOrdine(o);
      const unitaRimborso = cent === o.euro ? totale : (totale * BigInt(cent) + BigInt(o.euro) - 1n) / BigInt(o.euro);   // arrotondato in su, a favore del cliente
      const pagamenti = pagamentiDecisi(pt, unitaRimborso, carico);
      if (testo(nota, 1000)) db.prepare("UPDATE contestazione SET nota = ? WHERE cliente = ? AND stato = 'aperta'").run(testo(nota, 1000), `cr_${o.codice}`);
      h.rispondi(res, 200, { to: o.escrow, data: datiAzione('risolvi', id, pt, pagamenti), pagamenti: pagamenti.map(String), rimborso: String(totale - pagamenti.reduce((s, x) => s + x, 0n)),
        parti: pt.map((x, i) => ({ ruolo: x.ruolo, unita: x.unita, paga: String(pagamenti[i]), euro: Math.round(x.euro * Number(pagamenti[i] * 1_000_000n / BigInt(x.unita)) / 1e6) })) });
    },
    'POST /api/admin/prelancio': async (req, res, { io }) => {
      capo(io); const { attivo } = await h.json(req);
      const prima = c.prelancio();
      db.prepare("INSERT INTO impostazione (chiave, valore) VALUES ('prelancio', ?) ON CONFLICT(chiave) DO UPDATE SET valore = excluded.valore").run(attivo ? '1' : '0');
      const avvisati = prima && !c.prelancio() ? c.avvisaPrenotati?.() || 0 : 0;
      h.rispondi(res, 200, { prelancio: c.prelancio(), avvisati });
    },
    'POST /api/admin/sincronizza': async (req, res, { io }) => { capo(io); h.rispondi(res, 200, { letti: await c.sincronizzazione.tutti(50, { forza: true }) }); },
    'GET /api/admin/dac7': async (req, res, { io, url }) => {   // l'esportazione per la comunicazione annuale (al commercialista)
      capo(io);
      const anno = Number(url.searchParams.get('anno')) || new Date().getUTCFullYear() - 1;
      const cella = v => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; }, eur = x => (x / 100).toFixed(2);
      const T = ['T1', 'T2', 'T3', 'T4'];
      const righe = [['id', 'tipo', 'nome', 'codice_fiscale', 'partita_iva', 'via', 'cap', 'citta', 'provincia', 'paese', ...T.flatMap(x => [`${x}_ricevuto`, `${x}_commissioni`, `${x}_operazioni`]), 'totale_ricevuto', 'dati_mancanti']];
      for (const u of db.prepare("SELECT DISTINCT u.id, u.fiscale FROM utente u JOIN quota q ON q.beneficiario = u.id WHERE q.stato = 'versata' AND strftime('%Y', q.creato) = ?").all(String(anno))) {
        const f = u.fiscale ? JSON.parse(decifra(u.fiscale, chiave) || 'null') : null, r = riepilogoDac7(db, u.id, anno, cfg.piattaforma);
        const per = Object.fromEntries(r.trimestri.map(x => [x.trimestre.slice(-2), x]));
        righe.push([u.id, f?.tipo, f?.nome, f?.codice, f?.partita_iva, f?.via, f?.cap, f?.citta, f?.provincia, f?.paese,
          ...T.flatMap(x => [eur(per[x]?.ricevuto || 0), eur(per[x]?.commissioni || 0), per[x]?.operazioni || 0]), eur(r.totale), f ? '' : 'sì']);
      }
      res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="dac7-${anno}.csv"`, 'cache-control': 'no-store' });
      res.end('﻿' + righe.map(r => r.map(cella).join(';')).join('\r\n'));
    },
    'POST /api/admin/versa': async (req, res, { io }) => {
      capo(io); h.rispondi(res, 200, { versate: await versaQuote({ db, stripe, cfg, notifica: notifiche.notifica }) });
    },
  };
}
