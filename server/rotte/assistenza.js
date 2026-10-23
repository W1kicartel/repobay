// Le rotte dell'assistenza. Il business che ha comprato apre richieste dalla bolla dentro il programma o dalla pagina di
// assistenza (/assistenza/<codice>, installabile sul telefono): basta il codice dell'installazione, niente conto. L'assistenza la dà
// la piattaforma (ASSISTENZA_PIATTAFORMA): risponde chi la gestisce, dall'area, e se serve coinvolge chi ha installato (è stato sul
// posto) o chi sviluppa (un bug). Con ASSISTENZA_PIATTAFORMA=0 risponde chi installa, e se nessuno risponde il cliente lo segnala.
// Se il cliente non paga, l'assistenza si sospende dopo i giorni di grazia (assistenza.js): le richieste vecchie restano leggibili,
// le nuove aspettano il pagamento. Il programma installato non si tocca mai.
import { errore, testo, emailValida, ipDi } from '../http.js';
import { troppiTentativi, nuovoGettone } from '../conti.js';
import { statoAssistenza, codiceAssistenza, linkAssistenza, bolla, interessati, mascherata, canone, nuovoAvviso, CODICE, squadra, attuale } from '../assistenza.js';
export { squadra };
import { qrSvg } from '../../web/qr.js';
import { comandoBolla } from '../bolla.js';
import { indirizzoProgramma, disponibilita, rapporto, mesePrima } from '../monitoraggio.js';
import { quotaSviluppatoreAssistenza } from '../soldi.js';

const ore = 3600e3;
const STATI = ['aperta', 'risposta', 'risolta'];

// chi deve sapere di un messaggio del cliente: chi ha installato (risponde per primo), la piattaforma dietro di lui, e chi è coinvolto
const destinatari = (db, cfg, r) => [...new Set([...(cfg.assistenzaPiattaforma ? squadra(db, cfg) : []), r.installatore, r.builder].filter(Boolean))];

export function rotteAssistenza(c) {
  const { cfg, db, h, notifiche, stripe } = c;
  // la riattivazione: chi ha chiuso l'abbonamento (o lascia scadere l'anno in crypto da più di RIATTIVAZIONE_GIORNI) e torna paga
  // RIATTIVAZIONE_MESI mesi di canone in più, una volta: così nessuno paga solo quando qualcosa si rompe
  const costoRiattivazione = p => Math.round(cfg.riattivazioneMesi * (p?.prezzo_mese || 0));
  const fermaDaTroppo = cl => !!cl.assistenza_fino && Date.parse(cl.assistenza_fino) < Date.now() - cfg.riattivazioneGiorni * 864e5;
  // l'indirizzo del programma, scritto da chi installa, dalla piattaforma o dal cliente: si controlla da fuori ogni MONITOR_MINUTI
  async function salvaSito(cl, testoSito) {
    if (testoSito === null || testoSito === '') {
      db.prepare('UPDATE cliente SET sito = NULL, sito_stato = NULL, sito_dal = NULL, sito_controllato = NULL, sito_errori = 0, cert_scade = NULL WHERE chiave = ?').run(cl.chiave);
      return null;
    }
    const r = await indirizzoProgramma(testoSito, { locali: cfg.monitorLocali }); if (r.errore) throw errore(400, r.errore);
    if (r.sito !== cl.sito) db.prepare('UPDATE cliente SET sito = ?, sito_stato = NULL, sito_dal = NULL, sito_controllato = NULL, sito_errori = 0, cert_scade = NULL WHERE chiave = ?').run(r.sito, cl.chiave);
    return r.sito;
  }
  const vistaSito = cl => cl.sito ? { sito: cl.sito, stato: cl.sito_stato || null, dal: cl.sito_dal || null, controllato: cl.sito_controllato || null,
    cert_scade: cl.cert_scade || null, ultimi30: disponibilita(db, cl.chiave, new Date(Date.now() - 30 * 864e5).toISOString(), new Date(Date.now() + 60e3).toISOString()) } : null;

  // il cliente dal codice dell'installazione (nella bolla, nel link, nel QR)
  function daCodice(k) {
    const cl = CODICE.test(String(k || '')) && db.prepare('SELECT * FROM cliente WHERE assistenza = ?').get(String(k));
    if (!cl?.prodotto) throw errore(404, 'Link di assistenza non valido: chiedine uno nuovo a chi ti ha installato il programma');
    return cl;
  }
  const PERCHE = {
    sospesa: 'L\'assistenza è sospesa perché un pagamento non è andato a buon fine: aggiorna il pagamento e riparte subito',
    scaduta: 'L\'assistenza pagata in anticipo è scaduta: rinnovala e puoi scrivere di nuovo',
    cessata: 'L\'abbonamento di assistenza è chiuso: riattivalo da questa pagina, o chiedi un intervento a chiamata',
  };
  // senza l'assistenza attiva si scrive solo per chiedere un intervento a chiamata (a TARIFFA_ORA, con il preventivo)
  const puoScrivere = (cl, aChiamata = false) => { const st = statoAssistenza(cl, cfg); if (!st.attiva && !aChiamata) throw errore(402, PERCHE[st.motivo] || PERCHE.cessata); return st; };
  const freno = (req, k) => {
    if (troppiTentativi(`as:${k}`, Date.now(), 20, ore) || troppiTentativi(`asi:${ipDi(req)}`, Date.now(), 30, ore))
      throw errore(429, 'Hai mandato molti messaggi in poco tempo: riprova fra un po\'');
  };
  const vistaRichiesta = r => ({ id: r.id, titolo: r.titolo, stato: r.stato, urgente: !!r.urgente, creata: r.creata, aggiornata: r.aggiornata,
    attesa_dal: r.attesa_dal, coinvolto: !!r.builder, segnalata: r.segnalata, chiusa: r.chiusa,
    ...(r.a_chiamata ? { a_chiamata: { ore: r.preventivo_ore, totale: r.preventivo_ore ? Math.round(r.preventivo_ore * cfg.tariffaOra) : null, pagata: r.pagata } } : {}) });
  const messaggi = id => db.prepare('SELECT id, chi, nome, testo, creato FROM messaggio WHERE richiesta = ? ORDER BY id').all(id);
  // la richiesta del cliente: si può segnalare alla piattaforma se aspetta una risposta da più del doppio del tempo promesso
  const segnalabile = r => r.stato === 'aperta' && !r.segnalata && r.attesa_dal && Date.now() - Date.parse(r.attesa_dal) > 2 * cfg.rispostaOre * ore;
  const avvisaAdmin = (r, cl, p, perche) => {
    for (const a of cfg.admin.filter(a => a.includes('@')))
      notifiche.email(a, 'assistenza_ferma', { nome: a.split('@')[0], prodotto: p?.nome || '', cliente: cl.nome || '', titolo: r.titolo, perche, link: `${cfg.url}/admin#assistenza` }).catch(() => {});
  };
  // a chi risponde (la piattaforma, o chi installa) e a chi è coinvolto arriva ogni messaggio del cliente; se la piattaforma non ha
  // ancora nessuno iscritto fra chi la gestisce, un'email agli indirizzi di APP_ADMIN
  const aiProfessionisti = (r, cl, evento, dati) => {
    const p = db.prepare('SELECT nome FROM prodotto WHERE id = ?').get(r.prodotto), chi = destinatari(db, cfg, r);
    for (const u of chi) notifiche.notifica(u, evento, { prodotto: p?.nome || '', cliente: cl.nome || '', titolo: r.titolo, urgente: !!r.urgente, id: r.id, ...dati });
    if (cfg.assistenzaPiattaforma && !squadra(db, cfg).length && evento !== 'assistenza.segnalata') avvisaAdmin(r, cl, p, evento === 'assistenza.nuova' ? 'nuova richiesta' : 'nuovo messaggio del cliente');
  };

  // chi può leggere e rispondere a una richiesta dall'area: chi gestisce la piattaforma, chi installa, chi sviluppa se coinvolto
  function richiestaPer(io, id) {
    const r = db.prepare('SELECT * FROM richiesta WHERE id = ?').get(Number(id) || 0);
    const chi = !r ? null : cfg.assistenzaPiattaforma && c.eAdmin(io) ? 'piattaforma' : r.installatore === io.id ? 'installatore' : r.builder === io.id ? 'builder' : c.eAdmin(io) ? 'piattaforma' : null;
    if (!chi) throw errore(404, 'Richiesta non trovata');
    return { r, chi, cl: db.prepare('SELECT * FROM cliente WHERE chiave = ?').get(r.cliente) };
  }

  return {
    // ---------------- la pagina di assistenza del business (con il codice dell'installazione) ----------------
    'GET /api/assistenza': async (req, res, { url }) => {
      const cl = daCodice(url.searchParams.get('k')), st = statoAssistenza(cl, cfg);
      const p = db.prepare('SELECT id, nome, slug, prezzo_mese, prezzo_aggiornamenti FROM prodotto WHERE id = ?').get(cl.prodotto);
      const i = db.prepare('SELECT nome, codice, avatar FROM utente WHERE id = ?').get(cl.installatore);
      const crypto = /^cr_/.test(cl.chiave), bonifico = /^bn_/.test(cl.chiave), mesi = bonifico ? cfg.bonifico.mesi : cfg.crypto.mesi;
      // il rinnovo in crypto o con bonifico (l'assistenza pagata in anticipo): da un mese prima della scadenza (e dopo); con carta si
      // aggiorna il pagamento dall'area del cliente
      // con gli aggiornamenti garantiti, se il cliente li aveva e chi sviluppa li offre ancora
      const agg = cl.aggiornamenti > 0 && p?.prezzo_aggiornamenti > 0 ? canone(p.prezzo_aggiornamenti, mesi, cfg.scontoAnno) : 0;
      const rinnova = (crypto || bonifico) && (p?.prezzo_mese > 0 || agg > 0) && (st.motivo === 'scaduta' || (st.motivo === 'pagata' && st.giorni <= 30));
      const extra = rinnova && fermaDaTroppo(cl) ? costoRiattivazione(p) : 0;
      // con carta, dopo che l'abbonamento è chiuso, si riattiva dalla pagina (con la riattivazione)
      const riattiva = !crypto && !bonifico && st.motivo === 'cessata' && !cl.riattivato && p?.prezzo_mese > 0 && !!cfg.stripe.chiave && !c.prelancio();
      h.rispondi(res, 200, {
        prodotto: p ? { nome: p.nome, slug: p.slug } : null, installatore: i ? { nome: i.nome, codice: i.codice, avatar: i.avatar } : null, cliente: cl.nome || '',
        risponde: { piattaforma: cfg.assistenzaPiattaforma, nome: i?.nome || cfg.nome, dietro: cfg.assistenzaPiattaforma ? cfg.nome : null },
        stato: st, rispostaOre: cfg.rispostaOre, email: mascherata(cl.email), pagamento: crypto ? 'crypto' : bonifico ? 'bonifico' : cl.cliente_stripe ? 'stripe' : null,
        rinnovo: rinnova ? { mesi, euro: canone(p.prezzo_mese, mesi, cfg.scontoAnno) + agg + extra, ...(agg ? { aggiornamenti: agg } : {}), ...(extra ? { riattivazione: extra, giorni: cfg.riattivazioneGiorni } : {}), slug: p.slug } : null,
        riattivazione: riattiva ? { euro: costoRiattivazione(p), mesi: cfg.riattivazioneMesi, mese: p.prezzo_mese, anno: canone(p.prezzo_mese, 12, cfg.scontoAnno) } : null,
        // il programma controllato da fuori, il rapporto del mese scorso, la tariffa degli interventi senza assistenza
        monitoraggio: vistaSito(cl), rapporto: st.attiva && Date.parse(cl.creato.replace(' ', 'T') + 'Z') < Date.parse(mesePrima().a) ? rapporto(db, cl, mesePrima()) : null,
        tariffaOra: cfg.tariffaOra, canoneMese: p?.prezzo_mese || 0, monitorMinuti: cfg.monitorMinuti, pagaCarta: !!cfg.stripe.chiave && !c.prelancio(),
        richieste: db.prepare('SELECT * FROM richiesta WHERE cliente = ? ORDER BY stato = \'risolta\', aggiornata DESC LIMIT 100').all(cl.chiave)
          .map(r => ({ ...vistaRichiesta(r), segnalabile: segnalabile(r) })),
      });
    },
    'GET /api/assistenza/richiesta': async (req, res, { url }) => {
      const cl = daCodice(url.searchParams.get('k'));
      const r = db.prepare('SELECT * FROM richiesta WHERE id = ? AND cliente = ?').get(Number(url.searchParams.get('id')) || 0, cl.chiave);
      if (!r) throw errore(404, 'Richiesta non trovata');
      h.rispondi(res, 200, { ...vistaRichiesta(r), segnalabile: segnalabile(r), messaggi: messaggi(r.id) });
    },
    'POST /api/assistenza/richiesta': async (req, res) => {
      const x = await h.json(req), cl = daCodice(x.k); freno(req, cl.chiave);
      const aChiamata = !statoAssistenza(cl, cfg).attiva && x.a_chiamata === true; puoScrivere(cl, aChiamata);
      const titolo = testo(x.titolo, 120), corpo = testo(x.testo, 5000), nome = testo(x.nome, 80), em = String(x.email || '').trim().toLowerCase();
      if (titolo.length < 3) throw errore(400, 'Scrivi in poche parole di cosa hai bisogno');
      if (corpo.length < 10) throw errore(400, 'Racconta cosa succede: bastano due righe');
      if (em && !emailValida(em)) throw errore(400, 'Email non valida: serve per avvisarti della risposta');
      if (db.prepare("SELECT COUNT(*) n FROM richiesta WHERE cliente = ? AND stato != 'risolta'").get(cl.chiave).n >= 20) throw errore(429, 'Hai già molte richieste aperte: chiudi quelle risolte o scrivi in una di quelle');
      const ora = new Date().toISOString();
      // risponde per primo chi ha installato; la piattaforma vede la richiesta dall'inizio e interviene se lui non risponde
      const id = Number(db.prepare(`INSERT INTO richiesta (cliente, prodotto, installatore, titolo, urgente, canale, email, attesa_dal, a_chiamata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(cl.chiave, cl.prodotto, cl.installatore, titolo, x.urgente === true ? 1 : 0, x.canale === 'bolla' ? 'bolla' : 'pagina', em || null, ora, aChiamata ? 1 : 0).lastInsertRowid);
      db.prepare("INSERT INTO messaggio (richiesta, chi, nome, testo) VALUES (?, 'cliente', ?, ?)").run(id, nome || cl.nome || '', corpo);
      const r = db.prepare('SELECT * FROM richiesta WHERE id = ?').get(id);
      aiProfessionisti(r, cl, 'assistenza.nuova', { testo: corpo });
      h.rispondi(res, 201, { id });
    },
    'POST /api/assistenza/messaggio': async (req, res) => {
      const x = await h.json(req), cl = daCodice(x.k); freno(req, cl.chiave);
      const r = db.prepare('SELECT * FROM richiesta WHERE id = ? AND cliente = ?').get(Number(x.id) || 0, cl.chiave); if (!r) throw errore(404, 'Richiesta non trovata');
      puoScrivere(cl, !!r.a_chiamata);
      const corpo = testo(x.testo, 5000); if (corpo.length < 2) throw errore(400, 'Scrivi il messaggio');
      db.prepare("INSERT INTO messaggio (richiesta, chi, nome, testo) VALUES (?, 'cliente', ?, ?)").run(r.id, testo(x.nome, 80) || cl.nome || '', corpo);
      // di nuovo in attesa di chi installa (se aspettava già, l'attesa conta dal primo messaggio senza risposta)
      db.prepare(`UPDATE richiesta SET stato = 'aperta', aggiornata = datetime('now'), chiusa = NULL, attesa_dal = COALESCE(attesa_dal, ?),
        sollecito = CASE WHEN stato = 'aperta' THEN sollecito ELSE NULL END WHERE id = ?`).run(new Date().toISOString(), r.id);
      aiProfessionisti(r, cl, 'assistenza.messaggio', { testo: corpo });
      h.rispondi(res, 200, { ok: true });
    },
    'POST /api/assistenza/risolta': async (req, res) => {
      const x = await h.json(req), cl = daCodice(x.k);
      const r = db.prepare('SELECT * FROM richiesta WHERE id = ? AND cliente = ?').get(Number(x.id) || 0, cl.chiave); if (!r) throw errore(404, 'Richiesta non trovata');
      db.prepare("UPDATE richiesta SET stato = 'risolta', chiusa = datetime('now'), aggiornata = datetime('now'), attesa_dal = NULL WHERE id = ?").run(r.id);
      h.rispondi(res, 200, { ok: true });
    },
    'POST /api/assistenza/segnala': async (req, res) => {   // nessuno risponde: lo sa chi gestisce la piattaforma
      const x = await h.json(req), cl = daCodice(x.k); freno(req, cl.chiave);
      const r = db.prepare('SELECT * FROM richiesta WHERE id = ? AND cliente = ?').get(Number(x.id) || 0, cl.chiave); if (!r) throw errore(404, 'Richiesta non trovata');
      if (!segnalabile(r)) throw errore(400, `Si può segnalare quando aspetti una risposta da più di ${2 * cfg.rispostaOre} ore`);
      db.prepare("UPDATE richiesta SET segnalata = datetime('now') WHERE id = ?").run(r.id);
      avvisaAdmin(r, cl, db.prepare('SELECT nome FROM prodotto WHERE id = ?').get(r.prodotto), 'il cliente segnala che non ha risposta');
      aiProfessionisti(r, cl, 'assistenza.segnalata', {});
      h.rispondi(res, 200, { ok: true });
    },
    // aggiornare il pagamento: il link per entrare nell'area del cliente arriva all'email di chi ha comprato (con il solo codice
    // dell'installazione non si vedono pagamenti né si disdice niente)
    // il cliente scrive l'indirizzo del suo programma (o lo toglie), per il controllo da fuori
    'POST /api/assistenza/sito': async (req, res) => {
      const x = await h.json(req), cl = daCodice(x.k); freno(req, cl.chiave);
      h.rispondi(res, 200, { ok: true, sito: await salvaSito(cl, x.sito ?? null) });
    },
    // il pagamento del preventivo di un intervento a chiamata: una sessione di Stripe nuova a ogni clic (quelle vecchie scadono in 24 ore)
    'POST /api/assistenza/intervento': async (req, res) => {
      const x = await h.json(req), cl = daCodice(x.k);
      if (troppiTentativi(`int:${cl.chiave}`, Date.now(), 20, ore)) throw errore(429, 'Troppi tentativi: riprova fra un po\'');
      const r = db.prepare('SELECT * FROM richiesta WHERE id = ? AND cliente = ?').get(Number(x.id) || 0, cl.chiave); if (!r) throw errore(404, 'Richiesta non trovata');
      if (!r.a_chiamata || !r.preventivo_ore) throw errore(400, 'Non c\'è un preventivo da pagare');
      if (r.pagata) throw errore(400, 'L\'intervento è già pagato');
      if (c.prelancio() || !cfg.stripe.chiave) throw errore(503, 'I pagamenti con carta non sono attivi');
      const p = db.prepare('SELECT nome FROM prodotto WHERE id = ?').get(r.prodotto), totale = Math.round(r.preventivo_ore * cfg.tariffaOra);
      const link = `${linkAssistenza(cfg, codiceAssistenza(db, cl.chiave))}#r${r.id}`, a = r.email || cl.email;
      const s = await stripe.post('/v1/checkout/sessions', { mode: 'payment', locale: c.lingua(req) === 'en' ? 'en' : 'it', ...(a ? { customer_email: a } : {}),
        line_items: [{ quantity: 1, price_data: { currency: cfg.valuta, unit_amount: totale, product_data: { name: `${p?.nome || 'Programma'}: intervento`,
          description: `${String(r.preventivo_ore).replace('.', ',')} ore: ${r.titolo}`.slice(0, 300) } } }],
        metadata: { intervento: String(r.id) }, payment_intent_data: { metadata: { intervento: String(r.id) } }, success_url: `${link.replace('#', '?pagato=1#')}`, cancel_url: link },
        { idempotenza: `intervento-${r.id}-${r.preventivo_ore}-${new Date().toISOString().slice(0, 15)}` });
      db.prepare('UPDATE richiesta SET preventivo_sessione = ? WHERE id = ?').run(s.id, r.id);
      h.rispondi(res, 200, { url: s.url });
    },
    // riattivare l'assistenza con carta dopo che l'abbonamento è chiuso: un abbonamento nuovo (mese o anno) più la riattivazione,
    // una volta. Alla vendita (soldi.js) il codice dell'installazione, l'indirizzo e le richieste passano al cliente nuovo
    'POST /api/assistenza/riattiva': async (req, res) => {
      const x = await h.json(req), cl = daCodice(x.k);
      if (troppiTentativi(`ria:${cl.chiave}`, Date.now(), 10, ore)) throw errore(429, 'Troppi tentativi: riprova fra un po\'');
      const st = statoAssistenza(cl, cfg), p = db.prepare('SELECT * FROM prodotto WHERE id = ?').get(cl.prodotto);
      if (c.prelancio() || !cfg.stripe.chiave) throw errore(503, 'I pagamenti con carta non sono attivi');
      if (/^cr_/.test(cl.chiave)) throw errore(400, 'L\'assistenza pagata in crypto si rinnova dalla pagina del prodotto');
      if (/^bn_/.test(cl.chiave)) throw errore(400, 'L\'assistenza pagata con bonifico si rinnova dalla pagina del prodotto');
      if (st.motivo !== 'cessata' || cl.riattivato) throw errore(400, 'L\'assistenza non è chiusa: non c\'è niente da riattivare');
      if (!(p?.prezzo_mese > 0)) throw errore(400, 'Questo programma non ha un canone di assistenza');
      const anno = x.periodo === 'anno', fee = costoRiattivazione(p), qs = quotaSviluppatoreAssistenza(db, cfg, p.id);
      const md = { prodotto: p.id, installatore: cl.installatore || '', ap: '1', qs, qi: cfg.quotaInstallatoreAssistenza, riattiva: cl.chiave, ra: fee, qa: 0, qm: 0, ...(anno ? { periodo: 'anno' } : {}) };
      const s = await stripe.post('/v1/checkout/sessions', { mode: 'subscription', locale: c.lingua(req) === 'en' ? 'en' : 'it', billing_address_collection: 'required',
        ...(cl.cliente_stripe ? { customer: cl.cliente_stripe } : cl.email ? { customer_email: cl.email } : {}),
        line_items: [
          { quantity: 1, price_data: { currency: cfg.valuta, unit_amount: fee, product_data: { name: `${p.nome}: riattivazione dell'assistenza`, description: `${cfg.riattivazioneMesi} mesi di canone, una volta` } } },
          { quantity: 1, price_data: { currency: cfg.valuta, unit_amount: anno ? canone(p.prezzo_mese, 12, cfg.scontoAnno) : p.prezzo_mese, recurring: { interval: anno ? 'year' : 'month' },
            product_data: { name: anno ? `${p.nome}: assistenza annuale` : `${p.nome}: assistenza`, description: `Assistenza di ${db.prepare('SELECT nome FROM utente WHERE id = ?').get(cl.installatore)?.nome || cfg.nome}${cl.installatore ? `, con ${cfg.nome} dietro` : ''}, pagata in anticipo` } } }],
        metadata: md, subscription_data: { metadata: md },
        success_url: `${linkAssistenza(cfg, codiceAssistenza(db, cl.chiave))}?riattivata=1`, cancel_url: linkAssistenza(cfg, codiceAssistenza(db, cl.chiave)) }, { idempotenza: `riattiva-${cl.chiave}-${anno ? 'a' : 'm'}-${new Date().toISOString().slice(0, 13)}` });
      h.rispondi(res, 200, { url: s.url });
    },
    'POST /api/assistenza/pagamento': async (req, res) => {
      const x = await h.json(req), cl = daCodice(x.k);
      if (troppiTentativi(`asp:${cl.chiave}`, Date.now(), 3, ore)) throw errore(429, 'Ti abbiamo già scritto: controlla la posta');
      if (!cl.email) throw errore(400, 'Per questo acquisto non abbiamo un\'email: scrivi a chi ti ha installato il programma');
      const t = nuovoGettone(db, 'cliente', { dato: cl.email, minuti: 30 });
      await notifiche.email(cl.email, 'accesso', { nome: cl.nome || cl.email.split('@')[0], link: `${cfg.url}/cliente?t=${t}`, minuti: 30 }, { lingua: c.lingua(req) });
      h.rispondi(res, 200, { ok: true, email: mascherata(cl.email) });
    },

    // ---------------- dall'area: chi gestisce la piattaforma (tutte), chi installa e chi sviluppa (dove sono coinvolti) ----------------
    'GET /api/area/assistenza': async (req, res, { io }) => {
      c.serve(io); const tutte = cfg.assistenzaPiattaforma && c.eAdmin(io) ? 1 : 0;
      const l = db.prepare(`SELECT r.*, p.nome prodotto_nome, c.nome cliente_nome, c.pagamento, c.insoluto_dal, c.assistenza_fino, c.stato cliente_stato, c.chiave,
          (SELECT m.chi FROM messaggio m WHERE m.richiesta = r.id ORDER BY m.id DESC LIMIT 1) ultimo, (SELECT COUNT(*) FROM messaggio m WHERE m.richiesta = r.id) n
        FROM richiesta r JOIN cliente c ON c.chiave = r.cliente LEFT JOIN prodotto p ON p.id = r.prodotto
        WHERE ? OR r.installatore = ? OR r.builder = ? ORDER BY r.stato = 'risolta', r.urgente DESC, r.aggiornata DESC LIMIT 300`).all(tutte, io.id, io.id);
      h.rispondi(res, 200, { rispostaOre: cfg.rispostaOre, piattaforma: !!tutte, richieste: l.map(r => ({ ...vistaRichiesta(r), prodotto: r.prodotto_nome, cliente: r.cliente_nome, ultimo: r.ultimo, messaggi: r.n,
        ruolo: tutte ? 'piattaforma' : r.installatore === io.id ? 'installatore' : 'builder',
        assistenza: statoAssistenza({ chiave: r.chiave, stato: r.cliente_stato, pagamento: r.pagamento, insoluto_dal: r.insoluto_dal, assistenza_fino: r.assistenza_fino }, cfg) })) });
    },
    'GET /api/area/assistenza/richiesta': async (req, res, { io, url }) => {
      c.serve(io); const { r, chi, cl } = richiestaPer(io, url.searchParams.get('id'));
      const p = db.prepare('SELECT nome, slug, builder FROM prodotto WHERE id = ?').get(r.prodotto);
      h.rispondi(res, 200, { ...vistaRichiesta(r), ruolo: chi, prodotto: p?.nome, slug: p?.slug, cliente: cl?.nome || '', assistenza: statoAssistenza(cl, cfg),
        puoCoinvolgere: (chi === 'installatore' || chi === 'piattaforma') && !r.builder && p && p.builder !== io.id,
        // la piattaforma può chiamare nel filo chi ha installato: è stato sul posto e conosce il server del cliente
        puoCoinvolgereInstallatore: chi === 'piattaforma' && !r.installatore && !!cl?.installatore, messaggi: messaggi(r.id),
        monitoraggio: cl ? vistaSito(cl) : null, tariffaOra: cfg.tariffaOra, puoPreventivo: chi === 'piattaforma' && !!r.a_chiamata && !r.pagata && !!cfg.stripe.chiave });
    },
    // l'indirizzo del programma di un cliente, da chi l'ha installato o da chi gestisce la piattaforma
    'POST /api/area/assistenza/sito': async (req, res, { io }) => {
      c.serve(io); const x = await h.json(req);
      const cl = attuale(db, db.prepare('SELECT * FROM cliente WHERE chiave = ?').get(String(x.chiave || '')));
      if (!cl?.prodotto || !(cl.installatore === io.id || c.eAdmin(io))) throw errore(404, 'Cliente non trovato');
      h.rispondi(res, 200, { ok: true, sito: await salvaSito(cl, x.sito ?? null) });
    },
    // l'intervento a chiamata: chi gestisce la piattaforma manda il preventivo (ore × TARIFFA_ORA) con il link per pagarlo
    'POST /api/area/assistenza/preventivo': async (req, res, { io }) => {
      c.serve(io); const x = await h.json(req), { r, chi, cl } = richiestaPer(io, x.id);
      if (chi !== 'piattaforma') throw errore(403, 'Il preventivo lo manda chi gestisce la piattaforma');
      if (!r.a_chiamata) throw errore(400, 'Questa richiesta è coperta dall\'assistenza: niente preventivo');
      if (r.pagata) throw errore(400, 'L\'intervento è già pagato');
      if (!cfg.stripe.chiave) throw errore(503, 'I pagamenti con carta non sono attivi');
      const n = Number(x.ore); if (!(n >= 0.5 && n <= 40) || Math.round(n * 2) !== n * 2) throw errore(400, 'Le ore vanno da 0,5 a 40, a mezz\'ore');
      const p = db.prepare('SELECT nome, prezzo_mese FROM prodotto WHERE id = ?').get(r.prodotto), totale = Math.round(n * cfg.tariffaOra);
      const link = `${linkAssistenza(cfg, codiceAssistenza(db, cl.chiave))}#r${r.id}`;
      db.prepare("UPDATE richiesta SET preventivo_ore = ?, preventivo_sessione = NULL, stato = 'risposta', aggiornata = datetime('now'), attesa_dal = NULL WHERE id = ?").run(n, r.id);
      const testoMsg = `Preventivo: ${String(n).replace('.', ',')} ore a ${(cfg.tariffaOra / 100).toFixed(2).replace('.', ',')} € l'ora, ${(totale / 100).toFixed(2).replace('.', ',')} €. Lo paghi da questa pagina, con il bottone qui sopra: poi ci mettiamo al lavoro.`;
      db.prepare("INSERT INTO messaggio (richiesta, chi, utente, nome, testo) VALUES (?, 'piattaforma', ?, ?, ?)").run(r.id, io.id, cfg.nome, testoMsg);
      const a = r.email || cl.email;
      if (a) notifiche.email(a, 'intervento', { nome: cl.nome || '', prodotto: p?.nome || '', titolo: r.titolo, ore: n, tariffa: cfg.tariffaOra, totale, canone: p?.prezzo_mese || 0, link }).catch(() => {});
      h.rispondi(res, 200, { ok: true, totale });
    },
    'POST /api/area/assistenza/rispondi': async (req, res, { io }) => {
      c.serve(io); const x = await h.json(req), { r, chi, cl } = richiestaPer(io, x.id);
      const corpo = testo(x.testo, 5000); if (corpo.length < 2) throw errore(400, 'Scrivi la risposta');
      if (troppiTentativi(`asr:${io.id}`, Date.now(), 60, ore)) throw errore(429, 'Troppi messaggi in poco tempo: riprova fra un po\'');
      db.prepare('INSERT INTO messaggio (richiesta, chi, utente, nome, testo) VALUES (?, ?, ?, ?, ?)').run(r.id, chi, io.id, chi === 'piattaforma' ? cfg.nome : io.nome, corpo);
      const chiudi = x.risolta === true;
      db.prepare(`UPDATE richiesta SET stato = ?, aggiornata = datetime('now'), attesa_dal = NULL, sollecito = NULL, prima_risposta = COALESCE(prima_risposta, datetime('now')),
        chiusa = CASE WHEN ? THEN datetime('now') ELSE chiusa END WHERE id = ?`).run(chiudi ? 'risolta' : 'risposta', chiudi ? 1 : 0, r.id);
      // al cliente: all'email lasciata nella richiesta, o a quella di chi ha comprato; il link porta dritto alla richiesta
      const a = r.email || cl?.email, p = db.prepare('SELECT nome FROM prodotto WHERE id = ?').get(r.prodotto);
      if (a && cl) notifiche.email(a, 'assistenza_risposta', { nome: cl.nome || '', da: chi === 'piattaforma' ? cfg.nome : io.nome, prodotto: p?.nome || '', titolo: r.titolo,
        testo: corpo, risolta: chiudi, link: `${linkAssistenza(cfg, codiceAssistenza(db, cl.chiave))}#r${r.id}` }).catch(() => {});
      // gli altri nel filo lo sanno (chi gestisce la piattaforma, chi installa o chi sviluppa se coinvolti)
      for (const u of destinatari(db, cfg, r).filter(u => u !== io.id)) notifiche.notifica(u, 'assistenza.risposta', { prodotto: p?.nome || '', cliente: cl?.nome || '', titolo: r.titolo, da: chi === 'piattaforma' ? cfg.nome : io.nome, id: r.id });
      h.rispondi(res, 200, { ok: true });
    },
    'POST /api/area/assistenza/stato': async (req, res, { io }) => {
      c.serve(io); const x = await h.json(req), { r } = richiestaPer(io, x.id);
      if (!STATI.includes(x.stato)) throw errore(400, 'Stato non valido');
      db.prepare(`UPDATE richiesta SET stato = ?, aggiornata = datetime('now'), chiusa = CASE WHEN ? = 'risolta' THEN datetime('now') ELSE NULL END,
        attesa_dal = CASE WHEN ? = 'aperta' THEN COALESCE(attesa_dal, datetime('now')) ELSE NULL END WHERE id = ?`).run(x.stato, x.stato, x.stato, r.id);
      h.rispondi(res, 200, { ok: true });
    },
    // la piattaforma (o chi installa, quando risponde lui) porta dentro chi sviluppa (un bug, una domanda sul codice); la piattaforma può
    // portare dentro anche chi ha installato (chi: 'installatore')
    'POST /api/area/assistenza/coinvolgi': async (req, res, { io }) => {
      c.serve(io); const x = await h.json(req), { r, chi, cl } = richiestaPer(io, x.id);
      if (x.chi === 'installatore') {
        if (chi !== 'piattaforma') throw errore(403, 'Solo chi gestisce la piattaforma può coinvolgere chi ha installato');
        if (!cl?.installatore) throw errore(400, 'Questa installazione non ha un installatore');
        if (!r.installatore) {
          db.prepare("UPDATE richiesta SET installatore = ?, aggiornata = datetime('now') WHERE id = ?").run(cl.installatore, r.id);
          const p = db.prepare('SELECT nome FROM prodotto WHERE id = ?').get(r.prodotto);
          notifiche.notifica(cl.installatore, 'assistenza.coinvolto', { prodotto: p?.nome || '', cliente: cl.nome || '', titolo: r.titolo, da: cfg.nome, nota: testo(x.nota, 1000), id: r.id, ruolo: 'installatore' });
        }
        return h.rispondi(res, 200, { ok: true });
      }
      if (chi !== 'installatore' && chi !== 'piattaforma') throw errore(403, 'Solo chi risponde al cliente può coinvolgere chi sviluppa');
      const p = db.prepare('SELECT p.nome, p.builder, u.segnaposto FROM prodotto p JOIN utente u ON u.id = p.builder WHERE p.id = ?').get(r.prodotto);
      if (!p || p.builder === io.id) throw errore(400, 'Il progetto è tuo: rispondi tu');
      if (p.segnaposto) throw errore(400, 'Chi sviluppa questo progetto non è ancora iscritto: apri una issue sul suo repository GitHub');
      if (!r.builder) {
        db.prepare("UPDATE richiesta SET builder = ?, aggiornata = datetime('now') WHERE id = ?").run(p.builder, r.id);
        notifiche.notifica(p.builder, 'assistenza.coinvolto', { prodotto: p.nome, cliente: cl?.nome || '', titolo: r.titolo, da: chi === 'piattaforma' ? cfg.nome : io.nome, nota: testo(x.nota, 1000), id: r.id });
      }
      h.rispondi(res, 200, { ok: true });
    },
    // il codice dell'installazione per chi installa: il link (da salvare sul telefono del cliente), la bolla da mettere nel
    // programma e il QR; «nuovo» lo rifà se il vecchio è finito in mani sbagliate
    'POST /api/area/assistenza/codice': async (req, res, { io }) => {
      c.serve(io); const x = await h.json(req);
      const cl = attuale(db, db.prepare('SELECT * FROM cliente WHERE chiave = ? AND installatore = ?').get(String(x.chiave || ''), io.id));
      if (!cl?.prodotto) throw errore(404, 'Cliente non trovato');
      const k = codiceAssistenza(db, cl.chiave, { nuovo: x.nuovo === true }), link = linkAssistenza(cfg, k);
      const p = db.prepare('SELECT nome, repo, categoria FROM prodotto WHERE id = ?').get(cl.prodotto);
      h.rispondi(res, 200, { link, bolla: bolla(cfg, k, { lingua: c.lingua(req) }), qr: qrSvg(link, { etichetta: 'Assistenza' }), iniezione: comandoBolla(cfg, k, p), monitoraggio: vistaSito(cl) });
    },
    'GET /api/admin/assistenza': async (req, res, { io }) => {   // per chi gestisce: le richieste segnalate o ferme da troppo
      c.serve(io); if (!c.eAdmin(io)) throw errore(403, 'Solo per chi gestisce la piattaforma');
      const limite = new Date(Date.now() - 2 * cfg.rispostaOre * ore).toISOString();
      h.rispondi(res, 200, { richieste: db.prepare(`SELECT r.*, p.nome prodotto, c.nome cliente, i.nome installatore_nome FROM richiesta r JOIN cliente c ON c.chiave = r.cliente
          LEFT JOIN prodotto p ON p.id = r.prodotto LEFT JOIN utente i ON i.id = r.installatore
          WHERE r.stato = 'aperta' AND (r.segnalata IS NOT NULL OR r.attesa_dal < ?) ORDER BY r.attesa_dal LIMIT 100`).all(limite)
        .map(r => ({ ...vistaRichiesta(r), prodotto: r.prodotto, cliente: r.cliente, installatore: r.installatore_nome })) });
    },
  };
}

// i giri periodici dell'assistenza (lavori.js): solleciti a chi non risponde, segnalazioni alla piattaforma, avvisi di pagamento e
// di scadenza ai clienti. Ogni avviso parte una volta sola.
export function giroAssistenza({ db, cfg, notifiche }, adesso = Date.now()) {
  let n = 0;
  const iso = t => new Date(t).toISOString();
  // 1. chi installa non ha risposto entro RISPOSTA_ORE: un sollecito; entro il triplo: lo sa chi gestisce la piattaforma
  // (solo dove l'assistenza è attiva: chi installa non va sollecitato per un cliente che non paga o ha chiuso)
  const attese = (colonna, dal) => db.prepare(`SELECT r.*, p.nome prodotto_nome, c.nome cliente_nome, c.chiave, c.stato cliente_stato, c.pagamento, c.insoluto_dal, c.assistenza_fino
      FROM richiesta r JOIN cliente c ON c.chiave = r.cliente LEFT JOIN prodotto p ON p.id = r.prodotto WHERE r.stato = 'aperta' AND r.${colonna} IS NULL AND r.attesa_dal < ?`).all(dal)
    .filter(r => statoAssistenza({ chiave: r.chiave, stato: r.cliente_stato, pagamento: r.pagamento, insoluto_dal: r.insoluto_dal, assistenza_fino: r.assistenza_fino }, cfg, adesso).attiva);
  for (const r of attese('sollecito', iso(adesso - cfg.rispostaOre * ore))) {
    db.prepare("UPDATE richiesta SET sollecito = ? WHERE id = ?").run(iso(adesso), r.id); n++;
    for (const u of destinatari(db, cfg, r)) notifiche.notifica(u, 'assistenza.sollecito', { prodotto: r.prodotto_nome || '', cliente: r.cliente_nome || '', titolo: r.titolo, ore: cfg.rispostaOre, id: r.id });
  }
  for (const r of attese('segnalata', iso(adesso - 3 * cfg.rispostaOre * ore))) {
    db.prepare("UPDATE richiesta SET segnalata = ? WHERE id = ?").run(iso(adesso), r.id); n++;
    for (const a of cfg.admin.filter(a => a.includes('@')))
      notifiche.email(a, 'assistenza_ferma', { nome: a.split('@')[0], prodotto: r.prodotto_nome || '', cliente: r.cliente_nome || '', titolo: r.titolo, perche: `nessuna risposta da ${3 * cfg.rispostaOre} ore`, link: `${cfg.url}/admin#assistenza` }).catch(() => {});
  }
  // 2. i giorni di grazia finiti: l'assistenza si sospende (lo sanno chi installa, chi sviluppa e il cliente, una volta)
  const segna = (chiave, tipo) => nuovoAvviso(db, chiave, tipo);
  for (const cl of db.prepare("SELECT * FROM cliente WHERE pagamento IN ('in_ritardo', 'insoluto') AND stato != 'cessato'").all()) {
    const st = statoAssistenza(cl, cfg, adesso);
    if (st.motivo !== 'sospesa' || !segna(cl.chiave, 'sospesa')) continue;
    n++; const { p, utenti } = interessati(db, cl);
    if (p) for (const u of utenti) notifiche.notifica(u, 'assistenza.sospesa', { prodotto: p.nome, cliente: cl.nome || '' });
    if (cl.email && p) notifiche.email(cl.email, 'assistenza_sospesa', { nome: cl.nome || '', prodotto: p.nome, link: `${cfg.url}/cliente` }).catch(() => {});
  }
  // 3. l'assistenza pagata in anticipo: avvisi a 30 e a 7 giorni dalla scadenza, poi la scadenza
  for (const cl of db.prepare("SELECT * FROM cliente WHERE assistenza_fino IS NOT NULL AND stato != 'cessato' AND assistenza_fino < ?").all(iso(adesso + 30 * 864e5))) {
    const fino = Date.parse(cl.assistenza_fino), giorni = Math.ceil((fino - adesso) / 864e5), { p, utenti } = interessati(db, cl);
    if (!p) continue;
    const tipo = fino <= adesso ? 'scaduta' : giorni <= 7 ? 'scade7' : 'scade30';
    if (!segna(cl.chiave, tipo)) continue;
    n++;
    const link = linkAssistenza(cfg, codiceAssistenza(db, cl.chiave));
    if (cl.email) notifiche.email(cl.email, 'assistenza_scade', { nome: cl.nome || '', prodotto: p.nome, fino: cl.assistenza_fino, scaduta: tipo === 'scaduta', link,
      ...(p.prezzo_mese > 0 ? { giorni: cfg.riattivazioneGiorni, riattivazione: Math.round(cfg.riattivazioneMesi * p.prezzo_mese) } : {}) }).catch(() => {});
    if (tipo === 'scaduta') for (const u of utenti) notifiche.notifica(u, 'assistenza.scaduta', { prodotto: p.nome, cliente: cl.nome || '' });
  }
  return n;
}
