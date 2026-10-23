// Le rotte dei pagamenti diretti sul conto della piattaforma: con bonifico (IBAN, causale unica, QR per l'app della banca) o con
// carta dal POS virtuale della banca (server/pos.js), nessuna piattaforma in mezzo. L'ordine, la pagina d'attesa del cliente, l'esito
// della banca e, per chi gestisce la piattaforma, gli ordini, «ricevuto», l'estratto conto incollato che abbina le causali da solo e
// le quote da versare a mano. I soldi arrivano sul conto di chi gestisce la piattaforma, quindi si offre solo quando a installare è
// lui: incassa il suo lavoro e non tiene soldi di altri, salvo la parte di chi sviluppa (se c'è), che versa a mano e il pannello ricorda.
import { randomBytes } from 'node:crypto';
import { ibanLeggibile, payloadEpc, causaleNuova, abbina } from '../bonifico.js';
import { avvioPos, esitoPos, codTransDi, causaleDa } from '../pos.js';
import { dividi, dividiCanone, spartisci, collaboratoriDi, quotaDi, conAggiornamenti, livelloDi, conLivello, prezzoAvvioDi, avvisaLivello,
  quotaSviluppatoreAssistenza, quotaInstallatoreAssistenza, collegaAcquisto, sviluppatoreAssente } from '../soldi.js';
import { canone, togliAvvisi, CODICE, squadra, codiceAssistenza, linkAssistenza } from '../assistenza.js';
import { filtroAbilitati } from '../corso.js';
import { qrSvg } from '../../web/qr.js';
import { errore, emailValida, testo, ipDi } from '../http.js';
import { troppiTentativi } from '../conti.js';

const piuMesi = (t, mesi) => { const d = new Date(t); d.setUTCMonth(d.getUTCMonth() + mesi); return d.toISOString(); };

export function rotteBonifico(c) {
  const { cfg, db, h, notifiche } = c;
  const metodi = () => ({ bonifico: !!cfg.bonifico.iban, carta: !!(cfg.pos.alias && cfg.pos.chiave) });
  const attivo = () => metodi().bonifico || metodi().carta;
  c.metodiDiretti = metodi;
  // chi può incassare così: chi gestisce la piattaforma (il conto è il suo)
  const puo = id => attivo() && squadra(db, cfg).includes(id);
  c.bonificoPer = puo;   // per /api/prodotto: quali installatori lo offrono
  const capo = io => { c.serve(io); if (!c.eAdmin(io)) throw errore(403, 'Solo per chi gestisce la piattaforma'); };
  const prodottoDi = id => db.prepare('SELECT p.*, u.segnaposto FROM prodotto p JOIN utente u ON u.id = p.builder WHERE p.id = ?').get(id);

  // l'ordine come lo vede il cliente: quanto, a chi, con che causale, il QR; dopo il pagamento il link alla sua assistenza
  function vista(o) {
    const p = prodottoDi(o.prodotto), i = db.prepare('SELECT nome, codice FROM utente WHERE id = ?').get(o.installatore);
    const aperto = o.stato === 'aperto' || o.stato === 'scaduto', cliente = o.rinnovo || `bn_${o.codice}`, bon = o.metodo === 'bonifico';
    return { codice: o.codice, metodo: o.metodo, causale: o.causale, stato: o.stato, euro: o.euro, avvio: o.avvio, aggiornamenti: o.aggiornamenti, extra: o.extra,
      canone: o.euro - o.avvio - o.aggiornamenti - o.extra, mesi: o.mesi, scade: o.scade, pagato: o.pagato, rinnovo: !!o.rinnovo,
      prodotto: { nome: p?.nome || '', slug: p?.slug || '' }, installatore: i?.nome || '', installatoreCodice: i?.codice || null,
      ...(bon && metodi().bonifico ? { conto: { intestatario: cfg.bonifico.intestatario, iban: ibanLeggibile(cfg.bonifico.iban), bic: cfg.bonifico.bic || null } } : {}),
      ...(aperto && bon && metodi().bonifico ? { qr: qrSvg(payloadEpc({ nome: cfg.bonifico.intestatario, iban: cfg.bonifico.iban, bic: cfg.bonifico.bic, importo: o.euro,
        testo: `${o.causale} ${cfg.nome} ${p?.nome || ''}` }), { etichetta: 'Bonifico' }) } : {}),
      ...(o.stato === 'pagato' ? { assistenza: linkAssistenza(cfg, codiceAssistenza(db, cliente)) } : {}) };
  }

  // la vendita registrata quando il bonifico è arrivato: il cliente (o il rinnovo), le quote, gli avvisi. Le quote di chi ha
  // incassato sono già sul suo conto («versata»); quelle di chi sviluppa e dei collaboratori restano «manuale» finché non le versa
  function registra(o, nota = null) {
    if (o.stato === 'pagato') return { ok: true, gia: true };
    if (o.stato === 'annullato') throw errore(400, 'L\'ordine è annullato: se il bonifico è arrivato lo stesso, rimborsalo o crea un ordine nuovo');
    const p = prodottoDi(o.prodotto); if (!p) throw errore(400, 'Il prodotto non c\'è più');
    const fattura = `bn_${o.codice}`, cliente = o.rinnovo || fattura, ora = new Date().toISOString();
    const baseAvvio = o.avvio, baseAgg = o.aggiornamenti, baseMese = o.euro - o.avvio - o.aggiornamenti;   // la riattivazione si divide come il canone
    const assente = sviluppatoreAssente(db, p.id), fp = cfg.piattaformaBonifico;
    const qi = cfg.assistenzaPiattaforma ? quotaInstallatoreAssistenza(db, cfg, p.id) : 0, qs = assente ? 0 : quotaSviluppatoreAssistenza(db, cfg, p.id);
    const righe = [['avvio', baseAvvio, dividi(baseAvvio, o.quota, fp)],
      ['mese', baseMese, cfg.assistenzaPiattaforma ? dividiCanone(baseMese, qi, qs, true, 0) : dividi(baseMese, o.quota, fp)],
      ['aggiornamenti', baseAgg, dividi(baseAgg, cfg.quotaInstallatoreAggiornamenti, fp)]];
    const coll = assente ? [] : collaboratoriDi(db, p.id), parti = new Map();
    const somma = (utente, ruolo, riga, base, importo) => {
      if (!(importo > 0)) return;
      const k = `${utente}:${riga}`, x = parti.get(k) || { utente, ruolo, riga, base, importo: 0 }; x.importo += importo; parti.set(k, x);
    };
    for (const [riga, base, d] of righe) {
      if (!(base > 0)) continue;
      somma(o.installatore, 'installatore', riga, base, d.installatore);
      // un progetto a uso interno di un'azienda che non ha aderito non ha nessuno da pagare: quello che sarebbe di chi sviluppa resta a chi
      // ha incassato. Un progetto non rivendicato (con i pagamenti accesi) tiene la parte di chi sviluppa in attesa, a nome suo
      if (assente) { somma(o.installatore, 'installatore', riga, base, d.builder); continue; }
      const s = spartisci(d.builder, coll);
      somma(p.builder, 'builder', riga, base, s.builder);
      for (const x of s.collaboratori) somma(x.utente, x.ruolo, riga, base, x.importo);
    }
    db.exec('BEGIN');
    try {
      const gia = db.prepare('SELECT stato FROM bonifico WHERE id = ?').get(o.id);
      if (gia.stato === 'pagato') { db.exec('ROLLBACK'); return { ok: true, gia: true }; }
      db.prepare("UPDATE bonifico SET stato = 'pagato', pagato = ?, nota = COALESCE(?, nota) WHERE id = ?").run(ora, nota, o.id);
      if (o.rinnovo) {   // l'assistenza pagata in anticipo continua dalla fine del periodo già pagato (o da oggi, se è scaduta)
        const cl = db.prepare('SELECT assistenza_fino FROM cliente WHERE chiave = ?').get(o.rinnovo);
        const da = Math.max(Date.now(), Date.parse(cl?.assistenza_fino || '') || 0);
        db.prepare("UPDATE cliente SET assistenza_fino = ?, stato = 'attivo' WHERE chiave = ?").run(piuMesi(da, o.mesi), o.rinnovo);
        togliAvvisi(db, o.rinnovo, ['scade30', 'scade7', 'scaduta']);
      } else db.prepare('INSERT OR IGNORE INTO cliente (chiave, prodotto, installatore, quota_avvio, quota_mese, nome, email, assistenza_fino, aggiornamenti) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(fattura, o.prodotto, o.installatore, o.quota, o.quota, o.nome || o.email, o.email, baseMese > 0 || baseAgg > 0 ? piuMesi(Date.now(), o.mesi) : null, baseAgg > 0 ? p.prezzo_aggiornamenti : null);
      const ins = db.prepare(`INSERT OR IGNORE INTO quota (beneficiario, ruolo, prodotto, fattura, riga, tipo, base, frazione, importo, pagamento, disponibile, stato, trasferimento, cliente)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const x of parti.values()) {
        const incassata = x.utente === o.installatore;
        ins.run(x.utente, x.ruolo, p.id, fattura, x.riga, x.riga, x.base, x.importo / x.base, x.importo, fattura, ora, incassata ? 'versata' : 'manuale', incassata ? `bonifico ${o.causale}` : null, cliente);
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    // (l'avviso del livello nuovo parte quando il cliente conferma l'installazione: solo allora la vendita conta)
    const perUtente = new Map(); for (const x of parti.values()) perUtente.set(x.utente, { ruolo: x.ruolo, importo: (perUtente.get(x.utente)?.importo || 0) + x.importo });
    for (const [u, x] of perUtente) notifiche.notifica(u, 'vendita.nuova', { prodotto: p.nome, slug: p.slug, importo: x.importo, ruolo: x.ruolo, cliente: o.nome || o.email, metodo: 'bonifico', rinnovo: !!o.rinnovo });
    // dalla cassa (/compra): il cliente riceve la pagina d'installazione al posto della sola pagina di assistenza
    if (o.acquisto && !o.rinnovo) { collegaAcquisto(db, cfg, notifiche.email, o.acquisto, fattura).catch(() => {}); return { ok: true }; }
    notifiche.email(o.email, 'bonifico_ricevuto', { nome: o.nome || '', prodotto: p.nome, importo: o.euro, causale: o.causale, rinnovo: !!o.rinnovo,
      installatore: db.prepare('SELECT nome FROM utente WHERE id = ?').get(o.installatore)?.nome || '', link: linkAssistenza(cfg, codiceAssistenza(db, cliente)) }, { lingua: o.lingua || 'it' }).catch(() => {});
    return { ok: true };
  }
  const daCodice = codice => {
    const o = db.prepare('SELECT * FROM bonifico WHERE codice = ?').get(String(codice || ''));
    if (!o) throw errore(404, 'Ordine non trovato');
    return o;
  };
  // la carta: il modulo firmato per la pagina di cassa della banca, con un codice di transazione nuovo a ogni tentativo
  function avvioCarta(o) {
    if (!metodi().carta) throw errore(503, 'Il pagamento con carta non è attivo');
    if (o.metodo !== 'carta' || !['aperto', 'scaduto'].includes(o.stato)) throw errore(400, o.stato === 'pagato' ? 'L\'ordine è già pagato' : 'Questo ordine non si paga con carta');
    const p = prodottoDi(o.prodotto), codTrans = codTransDi(o.causale), ritorno = `${cfg.url}/api/carta/ritorno/${o.codice}`;
    db.prepare('UPDATE bonifico SET transazione = ? WHERE id = ?').run(codTrans, o.id);
    return avvioPos(cfg.pos, { codTrans, importo: o.euro, url: ritorno, urlBack: ritorno, urlPost: cfg.url.startsWith('https://') ? `${cfg.url}/api/carta/esito` : null,
      email: o.email, lingua: o.lingua, descrizione: `${cfg.nome} ${p?.nome || ''} ${o.causale}` });
  }
  // l'esito della banca, firmato: con OK (e l'importo giusto) la vendita si registra; KO e ANNULLO lasciano l'ordine aperto per riprovare
  function esitoCarta(x) {
    const e = esitoPos(cfg.pos, x);
    if (!e.firmato) throw errore(400, 'Esito della banca con firma non valida');
    const causale = causaleDa(e.codTrans), o = causale && db.prepare('SELECT * FROM bonifico WHERE causale = ?').get(causale);
    if (!o || o.metodo !== 'carta') throw errore(404, 'Ordine non trovato');
    if (e.esito === 'OK') {
      if (e.importo !== o.euro || e.divisa !== 'EUR') {
        db.prepare('UPDATE bonifico SET nota = ? WHERE id = ?').run(`la banca dice pagato ${e.importo} ${e.divisa} invece di ${o.euro} EUR: da controllare`, o.id);
        return { o, esito: 'diverso' };
      }
      registra(o, `carta ${e.brand} ${e.codAut}`.trim());
    }
    return { o, esito: e.esito };
  }

  function ritorno(req, res, url, x) {
    const codice = url.pathname.split('/').pop();
    const o = /^[A-Za-z0-9_-]{16}$/.test(codice) && db.prepare('SELECT * FROM bonifico WHERE codice = ?').get(codice);
    if (!o) return h.vai(res, '/');
    let esito = String(x.esito || '').toUpperCase();
    if (esito === 'OK') { try { esito = esitoCarta(x).esito; } catch (e) { esito = 'ERRORE'; console.error('ritorno carta:', e.message); } }
    const p = prodottoDi(o.prodotto), e = { OK: 'ok', KO: 'ko', ANNULLO: 'annullo', diverso: 'diverso' }[esito] || 'errore';
    // dalla cassa di Repobay (/compra): pagato si va alla pagina d'installazione, altrimenti si torna alla cassa a riprovare
    if (o.acquisto) return h.vai(res, e === 'ok' ? `/installa/${o.acquisto}` : `/compra/${p?.slug || ''}?a=${o.acquisto}&bonifico=${o.codice}&esito=${e}`);
    return h.vai(res, `/p/${p?.slug || ''}?bonifico=${o.codice}&esito=${e}#acquisto`);
  }

  return {
    // ---------------- il cliente: l'ordine e la pagina d'attesa ----------------
    'POST /api/bonifico/ordine': async (req, res) => {
      if (troppiTentativi(`bn:${ipDi(req)}`, Date.now(), 10, 10 * 60e3)) throw errore(429, 'Troppe richieste: riprova fra qualche minuto');
      const x = await h.json(req), metodo = x.metodo === 'carta' ? 'carta' : 'bonifico';
      if (!metodi()[metodo]) throw errore(503, metodo === 'carta' ? 'Il pagamento con carta non è attivo' : 'Il pagamento con bonifico non è attivo');
      if (testo(x.sito_web, 200)) throw errore(400, 'Richiesta non valida');   // il campo trappola: lo riempiono solo i robot
      const email = testo(x.email, 254).toLowerCase(), nome = testo(x.nome, 80) || null;
      if (!emailValida(email)) throw errore(400, 'Scrivi la tua email: ti mandiamo lì i dati del bonifico e la conferma');
      if (x.privacy !== true) throw errore(400, 'Per ordinare conferma di aver letto l\'informativa privacy');
      let p, i, cl = null;
      if (x.rinnovo) {   // il rinnovo dell'assistenza pagata con bonifico: stesso installatore, niente installazione
        cl = CODICE.test(String(x.rinnovo)) && db.prepare('SELECT * FROM cliente WHERE assistenza = ?').get(String(x.rinnovo));
        if (!cl || !cl.chiave.startsWith('bn_')) throw errore(404, 'Installazione non trovata: apri il rinnovo dalla tua pagina di assistenza');
        p = db.prepare(`SELECT p.*, u.segnaposto FROM prodotto p JOIN utente u ON u.id = p.builder WHERE p.id = ? AND u.stato IN ('attivo', 'non_rivendicato')`).get(cl.prodotto);
        i = db.prepare("SELECT * FROM utente WHERE id = ? AND stato = 'attivo'").get(cl.installatore);
        if (!p || !(p.prezzo_mese > 0 || (cl.aggiornamenti > 0 && p.prezzo_aggiornamenti > 0))) throw errore(400, 'Questo prodotto non ha un canone di assistenza da rinnovare');
        if (!i) throw errore(400, 'Chi ti ha installato il programma non è più attivo: scrivici e ti aiutiamo a trovare un altro installatore');
      } else {
        p = db.prepare(`SELECT p.*, u.segnaposto FROM prodotto p JOIN utente u ON u.id = p.builder WHERE p.slug = ? AND p.stato = 'pubblicato' AND u.stato IN ('attivo', 'non_rivendicato')`).get(String(x.prodotto || ''));
        if (!p) throw errore(404, 'Prodotto non trovato');
        const ab = filtroAbilitati(cfg, p);
        i = db.prepare(`SELECT u.* FROM adozione a JOIN utente u ON u.id = a.installatore WHERE a.prodotto = ? AND u.codice = ? AND u.stato = 'attivo'
          AND (? = 0 OR a.programma_accettato IS NOT NULL)${ab.sql}`).get(p.id, String(x.installatore || ''), p.programma_obbligatorio ? 1 : 0, ...ab.par);
        if (!i) throw errore(400, 'Scegli chi viene a installarlo');
      }
      if (!puo(i.id)) throw errore(400, `Con ${i.nome} non si paga con bonifico: chiedigli un preventivo qui sotto`);
      // i progetti non rivendicati, finché i loro pagamenti sono spenti, prendono solo preventivi (come con carta e crypto); quelli a uso
      // interno di un'azienda che non ha aderito si pagano, e tutto quello che resta dopo la piattaforma va a chi installa
      if (!cl && p.segnaposto && !cfg.nonRivendicatiPagamenti && !sviluppatoreAssente(db, p.id)) throw errore(400, `Chi ha creato questo progetto non è ancora su ${cfg.nome}: per ora si chiede un preventivo`);
      // la parte di chi vende: percentuale di chi sviluppa, il loro accordo, il suo livello (1 se a uso interno, da quotaDi)
      const base = cl ? (cl.quota_mese ?? quotaDi(db, cfg, p.id, i.id)) : quotaDi(db, cfg, p.id, i.id);
      const quota = conLivello(base, livelloDi(db, cfg, p.id, i.id, cl?.chiave).fattore);
      const mesi = cfg.bonifico.mesi, avvio = cl ? 0 : prezzoAvvioDi(db, p.id, i.id);
      const conAgg = cl ? cl.aggiornamenti > 0 && p.prezzo_aggiornamenti > 0 : x.aggiornamenti === true && conAggiornamenti(p);
      if (!cl && x.aggiornamenti === true && !conAgg) throw errore(400, 'Questo prodotto non ha gli aggiornamenti garantiti da chi sviluppa');
      const ag = conAgg ? canone(p.prezzo_aggiornamenti, mesi, cfg.scontoAnno) : 0;
      const extra = cl?.assistenza_fino && p.prezzo_mese > 0 && Date.parse(cl.assistenza_fino) < Date.now() - cfg.riattivazioneGiorni * 864e5 ? Math.round(cfg.riattivazioneMesi * p.prezzo_mese) : 0;
      const euro = avvio + canone(p.prezzo_mese, mesi, cfg.scontoAnno) + ag + extra;
      if (!(euro > 0)) throw errore(400, 'Questo prodotto non ha niente da pagare');
      const codice = randomBytes(12).toString('base64url'), causale = causaleNuova(k => !!db.prepare('SELECT 1 FROM bonifico WHERE causale = ?').get(k));
      const scade = new Date(Date.now() + cfg.bonifico.giorni * 864e5).toISOString(), lingua = c.lingua(req);
      // l'acquisto della cassa (stesso prodotto e installatore, non ancora pagato): il bonifico lo paga, e la conferma porta a /installa
      const aq = !cl && /^[A-Za-z0-9_-]{24}$/.test(String(x.acquisto || '')) ? db.prepare("SELECT * FROM acquisto WHERE codice = ? AND prodotto = ? AND installatore = ? AND stato IN ('aperto', 'respinto')").get(String(x.acquisto), p.id, i.id) : null;
      db.prepare(`INSERT INTO bonifico (codice, causale, metodo, prodotto, installatore, euro, avvio, aggiornamenti, extra, mesi, quota, rinnovo, email, nome, lingua, scade, acquisto)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(codice, causale, metodo, p.id, i.id, euro, avvio, ag, extra, mesi, quota, cl ? cl.chiave : null, email, nome, lingua, scade, aq?.codice ?? null);
      if (aq) db.prepare("UPDATE acquisto SET metodo = ?, stato = 'aperto', aggiornato = datetime('now') WHERE id = ?").run(metodo === 'carta' ? 'pos' : 'bonifico', aq.id);
      const o = daCodice(codice);
      // con la carta il cliente va subito alla cassa della banca: l'esito arriva da lei. Col bonifico i dati anche per email (se chiude
      // la pagina li ha comunque) e a chi gestisce l'avviso, che deve guardare il conto
      if (metodo === 'carta') return h.rispondi(res, 201, { ...vista(o), pos: avvioCarta(o) });
      notifiche.email(email, 'bonifico_ordine', { nome: nome || '', prodotto: p.nome, importo: euro, causale, intestatario: cfg.bonifico.intestatario,
        iban: ibanLeggibile(cfg.bonifico.iban), bic: cfg.bonifico.bic, scade, link: aq ? `${cfg.url}/installa/${aq.codice}` : `${cfg.url}/p/${p.slug}?bonifico=${codice}#acquisto` }, { lingua }).catch(() => {});
      for (const u of squadra(db, cfg)) notifiche.notifica(u, 'bonifico.nuovo', { prodotto: p.nome, cliente: nome || email, importo: euro, causale });
      h.rispondi(res, 201, vista(o));
    },
    'GET /api/bonifico/ordine': async (req, res, { url }) => {
      if (troppiTentativi(`bv:${ipDi(req)}`, Date.now(), 120, 10 * 60e3)) throw errore(429, 'Troppe richieste: riprova fra qualche minuto');
      h.rispondi(res, 200, vista(daCodice(url.searchParams.get('codice'))));
    },
    // ---------------- la carta dal POS virtuale della banca ----------------
    'POST /api/carta/avvio': async (req, res) => {   // un altro tentativo sullo stesso ordine (dopo un rifiuto o una cassa abbandonata)
      if (troppiTentativi(`ca:${ipDi(req)}`, Date.now(), 20, 10 * 60e3)) throw errore(429, 'Troppe richieste: riprova fra qualche minuto');
      h.rispondi(res, 200, { pos: avvioCarta(daCodice((await h.json(req)).codice)) });
    },
    // la notifica della banca, server a server (application/x-www-form-urlencoded): basta un HTTP 200 per dirle che è arrivata
    'POST /api/carta/esito': async (req, res) => {
      const x = Object.fromEntries(new URLSearchParams(await h.corpoGrezzo(req, 32 * 1024)));
      const r = esitoCarta(x);
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }); res.end(r.esito === 'OK' ? 'OK' : 'RICEVUTO');
    },
    // il ritorno del cliente dalla cassa (/api/carta/ritorno/<codice>?esito=…): se l'esito è firmato e OK la vendita si registra anche da
    // qui (se la notifica è in ritardo), poi la pagina del prodotto con l'ordine
    'GET /api/carta/ritorno': async (req, res, { url }) => ritorno(req, res, url, Object.fromEntries(url.searchParams)),
    'POST /api/carta/ritorno': async (req, res, { url }) => ritorno(req, res, url, { ...Object.fromEntries(url.searchParams), ...Object.fromEntries(new URLSearchParams(await h.corpoGrezzo(req, 32 * 1024))) }),

    // ---------------- chi gestisce la piattaforma ----------------
    'GET /api/admin/bonifici': async (req, res, { io }) => {
      capo(io);
      const ordini = db.prepare(`SELECT b.codice, b.causale, b.metodo, b.transazione, b.euro, b.stato, b.email, b.nome, b.creato, b.scade, b.pagato, b.nota, b.rinnovo IS NOT NULL rinnovo, p.nome prodotto, u.nome installatore
        FROM bonifico b JOIN prodotto p ON p.id = b.prodotto JOIN utente u ON u.id = b.installatore
        ORDER BY CASE WHEN b.stato IN ('aperto', 'scaduto') THEN 0 ELSE 1 END, b.id DESC LIMIT 200`).all().map(o => ({ ...o, rinnovo: !!o.rinnovo }));
      const manuali = db.prepare(`SELECT q.id, q.importo - q.stornato importo, q.ruolo, q.creato, q.fattura, u.nome, u.email, p.nome prodotto
        FROM quota q JOIN utente u ON u.id = q.beneficiario LEFT JOIN prodotto p ON p.id = q.prodotto WHERE q.stato = 'manuale' ORDER BY q.creato LIMIT 500`).all();
      h.rispondi(res, 200, { attivo: attivo(), metodi: metodi(), pos: metodi().carta ? { prova: cfg.pos.prova, gateway: cfg.pos.gateway } : null, intestatario: cfg.bonifico.intestatario, iban: attivo() ? ibanLeggibile(cfg.bonifico.iban) : null, mesi: cfg.bonifico.mesi, giorni: cfg.bonifico.giorni,
        ordini, manuali });
    },
    'POST /api/admin/bonifico/conferma': async (req, res, { io }) => {
      capo(io); const x = await h.json(req);
      h.rispondi(res, 200, registra(daCodice(x.codice), testo(x.nota, 300) || `segnato ricevuto da ${io.nome}`));
    },
    'POST /api/admin/bonifico/annulla': async (req, res, { io }) => {
      capo(io); const o = daCodice((await h.json(req)).codice);
      if (!['aperto', 'scaduto'].includes(o.stato)) throw errore(400, 'Si annullano solo gli ordini non pagati');
      db.prepare("UPDATE bonifico SET stato = 'annullato', nota = ? WHERE id = ?").run(`annullato da ${io.nome}`, o.id);
      h.rispondi(res, 200, { ok: true });
    },
    // l'estratto conto (il CSV della banca, o le righe copiate dalla sua pagina): trova le causali degli ordini non pagati; con
    // «applica» segna ricevuti quelli con l'importo giusto. Quelli con l'importo diverso li guarda chi gestisce
    'POST /api/admin/bonifico/estratto': async (req, res, { io }) => {
      capo(io); const x = await h.json(req, 2 * 1024 * 1024);
      const aperti = db.prepare("SELECT codice, causale, euro FROM bonifico WHERE metodo = 'bonifico' AND stato IN ('aperto', 'scaduto')").all();
      const r = abbina(String(x.testo || ''), aperti);
      let registrati = 0;
      if (x.applica === true) for (const a of r.abbinati) { registra(daCodice(a.codice), 'trovato nell\'estratto conto'); registrati++; }
      h.rispondi(res, 200, { ...r, registrati });
    },
    'POST /api/admin/quota/versata': async (req, res, { io }) => {   // la parte di chi sviluppa, versata a mano dopo un bonifico
      capo(io); const id = Number((await h.json(req)).id);
      const q = db.prepare("UPDATE quota SET stato = 'versata', trasferimento = 'a mano', errore = NULL WHERE id = ? AND stato = 'manuale' RETURNING *").get(id);
      if (!q) throw errore(404, 'Quota non trovata, o già versata');
      notifiche.notifica(q.beneficiario, 'quota.versata', { importo: q.importo - q.stornato });
      h.rispondi(res, 200, { ok: true });
    },
  };
}
