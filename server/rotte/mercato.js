// Le rotte del mercato: il catalogo (ricerca full-text, filtri, pagine), la pagina di un prodotto (README, release,
// recensioni, chi lo installa e dove), i profili pubblici, le adozioni degli installatori, il checkout con Stripe, i
// contatti dei business con gli installatori, il badge per i README e l'area dei business che hanno comprato.
import { randomBytes } from 'node:crypto';
import { nuovoGettone, usaGettone, hashGettone, troppiTentativi } from '../conti.js';
import { avvisaLivello, dividi, dividiCanone, quotaDi, collaboratoriDi, sviluppatoreAssente, conAggiornamenti, percentualeDi, livelloDi, conLivello, prezzoAvvioDi, stimaStripe, quotaSviluppatoreAssistenza, quotaInstallatoreAssistenza } from '../soldi.js';
import { leggiJson } from '../contenuti.js';
import { canone, statoAssistenza, codiceAssistenza, linkAssistenza, attuale, squadra } from '../assistenza.js';
import { retiAccese, walletDi } from '../reti.js';
import { CATEGORIE } from './github.js';
import { ATTIVITA } from '../attivita.js';
import { manca, filtroAbilitati, abilitatiSql, livello, difficoltaDi } from '../corso.js';
import { errore, emailValida, testo, ipDi, linguaDi } from '../http.js';

const PER_PAGINA = 24;
const fts = q => q.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).slice(0, 8).map(t => `"${t}"*`).join(' ');

export function rotteMercato(c) {
  const { cfg, db, h, stripe, notifiche } = c;
  const voto = (campo, id) => db.prepare(`SELECT ROUND(AVG(voto), 1) media, COUNT(*) n FROM recensione WHERE ${campo} = ? AND nascosta = 0`).get(id);
  const linkDi = (p, u) => `${cfg.url}/p/${p.slug}?ref=${u.codice}`;
  // la divisione fra chi installa e chi sviluppa: 20/80 (o la percentuale di chi sviluppa), oppure quella che i due hanno concordato. Un accordo
  // riguarda due persone, l'installatore e il builder: chi chiede è l'installatore per sé, o il builder per uno dei suoi installatori
  // (col codice). → { p, inst, a, chi, altro, link } (link: dove l'altro vede la proposta)
  function coppia(io, prodotto, codice) {
    c.serve(io);
    const p = db.prepare('SELECT id, nome, slug, builder FROM prodotto WHERE id = ?').get(Number(prodotto)); if (!p) throw errore(404, 'Prodotto non trovato');
    const builder = p.builder === io.id && !!codice;
    const inst = builder ? db.prepare("SELECT id, nome, codice FROM utente WHERE codice = ? AND stato = 'attivo'").get(String(codice)) : io;
    const a = inst && db.prepare('SELECT * FROM adozione WHERE installatore = ? AND prodotto = ?').get(inst.id, p.id);
    if (!a) throw errore(404, builder ? 'Questa persona non installa il prodotto' : 'Non installi questo prodotto');
    if (inst.id === p.builder) throw errore(400, 'Installi un tuo prodotto: tieni anche la parte di chi vende, non serve un accordo');
    return { p, inst, a, chi: builder ? 'builder' : 'installatore', altro: builder ? inst.id : p.builder, link: builder ? '/area#installo' : '/area#prodotti' };
  }
  const pc = q => Math.round(q * 100);
  const senzaProposta = 'proposta = NULL, proposta_da = NULL, proposta_nota = NULL, proposta_il = NULL';
  // le reti su cui un prodotto si può pagare: quelle accese dove builder e collaboratori hanno un wallet
  function retiProdotto(p) {
    const b = db.prepare('SELECT * FROM utente WHERE id = ?').get(p.builder);
    const coll = collaboratoriDi(db, p.id).map(x => db.prepare('SELECT * FROM utente WHERE id = ?').get(x.utente));
    return retiAccese(cfg).filter(r => walletDi(b, r.tipo) && coll.every(u => walletDi(u, r.tipo)));
  }
  // la fiducia di un installatore: installazioni confermate dai clienti e contestazioni (aperte o finite in rimborso) negli ultimi 12 mesi
  const fiducia = id => ({
    confermate: db.prepare('SELECT COUNT(*) n FROM cliente WHERE installatore = ? AND confermato IS NOT NULL').get(id).n,
    contestazioni: db.prepare(`SELECT COUNT(*) n FROM contestazione k JOIN cliente c ON c.chiave = k.cliente WHERE c.installatore = ? AND k.creata > datetime('now', '-12 months')
      AND (k.stato = 'aperta' OR k.esito = 'rimborso')`).get(id).n });
  // tre segnalazioni serie in 90 giorni: l'installatore si ferma da solo finché chi gestisce la piattaforma non guarda
  const sospendiRecidivo = id => {
    if (!id) return;
    const n = db.prepare(`SELECT COUNT(*) n FROM contestazione k JOIN cliente c ON c.chiave = k.cliente WHERE c.installatore = ? AND k.creata > datetime('now', '-90 days')
      AND (k.stato = 'aperta' OR k.esito = 'rimborso')`).get(id).n;
    if (n >= 3 && db.prepare("UPDATE utente SET stato = 'sospeso' WHERE id = ? AND stato = 'attivo'").run(id).changes) db.prepare('DELETE FROM sessione WHERE utente = ?').run(id);
  };
  // un prezzo da cui partire per chi vuole offrire un prodotto: la mediana di chi lo offre già, altrimenti il prezzo di riferimento
  // del catalogo, altrimenti la mediana della sua categoria
  const mediana = l => { if (!l.length) return null; const x = [...l].sort((a, b) => a - b), m = x.length >> 1; return x.length % 2 ? x[m] : Math.round((x[m - 1] + x[m]) / 2); };
  function suggerito(p) {
    const qui = db.prepare('SELECT COALESCE(a.prezzo_avvio, ?) v FROM adozione a WHERE a.prodotto = ?').all(p.prezzo_avvio, p.id).map(x => x.v).filter(v => v > 0);
    if (qui.length) return { avvio: mediana(qui), fonte: 'altri', n: qui.length };
    if (p.prezzo_avvio > 0) return { avvio: p.prezzo_avvio, fonte: 'catalogo' };
    const cat = db.prepare('SELECT COALESCE(a.prezzo_avvio, p.prezzo_avvio) v FROM adozione a JOIN prodotto p ON p.id = a.prodotto WHERE p.categoria = ?').all(p.categoria).map(x => x.v).filter(v => v > 0);
    return cat.length ? { avvio: mediana(cat), fonte: 'categoria', n: cat.length } : null;
  }
  // il prezzo dell'installazione scritto da chi vende (in euro): almeno PREZZO_MINIMO, al massimo 50.000 €
  const prezzoVenditore = v => {
    const x = Math.round(Number(String(v ?? '').replace(',', '.')) * 100);
    if (v === null || v === '' || !Number.isInteger(x) || x < cfg.prezzoMin || x > 5_000_000) throw errore(400, `Scrivi il tuo prezzo per l'installazione: almeno ${cfg.prezzoMin / 100} €, al massimo 50.000 €`);
    return x;
  };
  const sessioneCliente = b => b.cliente && db.prepare('SELECT email FROM sessione_cliente WHERE token = ? AND scade > ?').get(hashGettone(b.cliente), new Date().toISOString())?.email;

  // la sessione di Stripe Checkout per un acquisto: installazione (il prezzo di chi vende), assistenza al mese o all'anno, gli
  // aggiornamenti garantiti se scelti. acquisto: il codice della cassa (/compra), che segue il cliente fino all'installazione;
  // con la chiave pubblicabile (STRIPE_PUBBLICA) la cassa incorpora il pagamento nella pagina, senza mandare il cliente altrove
  c.sessioneCheckout = async (req, { prodotto, installatore, periodo, aggiornamenti, acquisto = null, email = null }) => {
    const dentro = !!acquisto && !!cfg.stripe.pubblica, dopo = `${cfg.url}/installa/${acquisto}?s={CHECKOUT_SESSION_ID}`;
      const p = db.prepare(`SELECT p.*, u.segnaposto FROM prodotto p JOIN utente u ON u.id = p.builder WHERE p.slug = ? AND p.stato = 'pubblicato' AND u.stato IN ('attivo', 'non_rivendicato')`).get(String(prodotto || ''));
      if (!p) throw errore(404, 'Prodotto non trovato');
      if (p.segnaposto && !cfg.nonRivendicatiPagamenti && !sviluppatoreAssente(db, p.id)) throw errore(400, `Chi ha creato questo progetto non è ancora su ${cfg.nome}: per ora si chiede un preventivo all'installatore`);
      const ab = filtroAbilitati(cfg, p);
      const i = db.prepare(`SELECT u.* FROM adozione a JOIN utente u ON u.id = a.installatore WHERE a.prodotto = ? AND u.codice = ? AND u.stato = 'attivo'
        AND (? = 0 OR a.programma_accettato IS NOT NULL)${ab.sql}`).get(p.id, String(installatore || ''), p.programma_obbligatorio ? 1 : 0, ...ab.par);
      if (!i) throw errore(400, 'Scegli chi viene a installarlo');
      // «per conto»: il venditore davanti al cliente è l'installatore (on_behalf_of); serve il suo conto Stripe completo. Chi gestisce
      // la piattaforma vende col conto della piattaforma, che è il suo
      const casa = squadra(db, cfg).includes(i.id);
      if (cfg.stripe.perConto && !casa && !(i.stripe && i.stripe_pronto)) throw errore(400, `${i.nome} deve ancora completare il conto per incassare: scegli un altro installatore o scrivigli`);
      const conAgg = aggiornamenti === true && conAggiornamenti(p);
      if (aggiornamenti === true && !conAgg) throw errore(400, 'Questo prodotto non ha gli aggiornamenti garantiti da chi sviluppa');
      const righe = [], avvio = prezzoAvvioDi(db, p.id, i.id);   // il prezzo di chi vende
      if (avvio > 0) righe.push({ quantity: 1, price_data: { currency: cfg.valuta, unit_amount: avvio, product_data: { name: `${p.nome}: installazione`, description: `Installazione e configurazione nella tua attività, a cura di ${i.nome}` } } });
      // l'assistenza si paga in anticipo, ogni mese o un anno intero (con lo sconto): Stripe addebita da solo carta o conto (SEPA)
      const anno = periodo === 'anno' && (p.prezzo_mese > 0 || conAgg);
      if (p.prezzo_mese > 0) righe.push({ quantity: 1, price_data: { currency: cfg.valuta, unit_amount: anno ? canone(p.prezzo_mese, 12, cfg.scontoAnno) : p.prezzo_mese, recurring: { interval: anno ? 'year' : 'month' },
        product_data: { name: anno ? `${p.nome}: assistenza annuale` : `${p.nome}: assistenza`, description: (cfg.assistenzaPiattaforma ? `Assistenza di ${i.nome}, con ${cfg.nome} dietro` : 'Assistenza') + (anno ? ', aggiornamenti e controllo per un anno, pagati in anticipo' : ', aggiornamenti e controllo, ogni mese, pagati in anticipo') } } });
      // gli aggiornamenti garantiti, se il cliente li ha scelti: una riga ricorrente a parte, con lo stesso periodo dell'assistenza
      const ag = conAgg ? (anno ? canone(p.prezzo_aggiornamenti, 12, cfg.scontoAnno) : p.prezzo_aggiornamenti) : 0;
      if (conAgg) righe.push({ quantity: 1, price_data: { currency: cfg.valuta, unit_amount: ag, recurring: { interval: anno ? 'year' : 'month' },
        product_data: { name: anno ? `${p.nome}: aggiornamenti garantiti, un anno` : `${p.nome}: aggiornamenti garantiti`, description: 'Aggiornamenti e correzioni di sicurezza garantiti da chi sviluppa il programma' } } });
      // la divisione si fissa qui, al momento della vendita (il livello di chi vende si aggiunge quando arriva il pagamento); ag:
      // l'importo della riga degli aggiornamenti per riconoscerla nelle fatture; ap: l'assistenza con la piattaforma dietro; qi e qs: le
      // parti del canone a chi ha installato e a chi sviluppa
      const q = quotaDi(db, cfg, p.id, i.id), md = { prodotto: p.id, ...(acquisto ? { acquisto } : {}), installatore: i.id, qa: q, qm: q, pa: avvio, qs: quotaSviluppatoreAssistenza(db, cfg, p.id), ...(anno ? { periodo: 'anno' } : {}),
        ...(cfg.assistenzaPiattaforma ? { ap: '1', qi: quotaInstallatoreAssistenza(db, cfg, p.id) } : {}), ...(conAgg ? { ag, agm: p.prezzo_aggiornamenti, qg: cfg.quotaInstallatoreAggiornamenti } : {}) };
      const abbonamento = p.prezzo_mese > 0 || conAgg, obo = cfg.stripe.perConto && !casa ? { on_behalf_of: i.stripe } : {};
      const s = await stripe.post('/v1/checkout/sessions', {
        mode: abbonamento ? 'subscription' : 'payment', locale: c.lingua(req) === 'en' ? 'en' : 'it', billing_address_collection: 'required', tax_id_collection: { enabled: true },
        line_items: righe, metadata: md,
        ...(abbonamento ? { subscription_data: { metadata: md, ...obo } } : { invoice_creation: { enabled: true, invoice_data: { metadata: md } }, customer_creation: 'always', payment_intent_data: { metadata: md, ...obo } }),
        ...(email ? { customer_email: email } : {}),
        ...(dentro ? { ui_mode: 'embedded', return_url: dopo } : { success_url: acquisto ? dopo : `${cfg.url}/grazie?s={CHECKOUT_SESSION_ID}`, cancel_url: acquisto ? `${cfg.url}/compra/${p.slug}?a=${acquisto}` : `${cfg.url}/p/${p.slug}` }),
      }, acquisto ? { idempotenza: `acquisto-${acquisto}-${periodo === 'anno' ? 'a' : 'm'}-${conAgg ? 1 : 0}-${dentro ? 'e' : 'h'}` } : {});
      return s;
  };

  return {
    // i numeri del catalogo per la home: quanti programmi, quante stelle su GitHub in tutto, quante categorie, quanti installatori abilitati
    'GET /api/catalogo/numeri': async (req, res) => {
      const ab = abilitatiSql(cfg);
      const n = db.prepare(`SELECT COUNT(*) programmi, COALESCE(SUM(p.stelle), 0) stelle, COUNT(DISTINCT p.categoria) categorie FROM prodotto p JOIN utente u ON u.id = p.builder WHERE p.stato = 'pubblicato' AND u.stato IN ('attivo', 'non_rivendicato')`).get();
      const installatori = db.prepare(`SELECT COUNT(DISTINCT a.installatore) n FROM adozione a JOIN utente i ON i.id = a.installatore JOIN prodotto p ON p.id = a.prodotto WHERE i.stato = 'attivo' AND p.stato = 'pubblicato'${ab.sql}`).get(...ab.par).n;
      h.rispondi(res, 200, { ...n, installatori }, { 'cache-control': 'public, max-age=600' });
    },
    'GET /api/catalogo': async (req, res, { url }) => {
      const q = testo(url.searchParams.get('q'), 80), cat = url.searchParams.get('categoria'), att = url.searchParams.get('attivita'), zona = testo(url.searchParams.get('zona'), 60).toLowerCase();
      const ordine = { stelle: 'p.stelle DESC', nuovi: 'p.creato DESC', voto: 'media DESC NULLS LAST, n DESC' }[url.searchParams.get('ordine')] || 'installatori DESC, p.stelle DESC';
      const pagina = Math.max(1, Math.min(500, Number(url.searchParams.get('pagina')) || 1));
      const dove = ["p.stato = 'pubblicato'", "u.stato IN ('attivo', 'non_rivendicato')"], par = [];
      if (q && fts(q)) { dove.push('p.id IN (SELECT rowid FROM prodotto_fts WHERE prodotto_fts MATCH ?)'); par.push(fts(q)); }
      if (CATEGORIE.includes(cat)) { dove.push('p.categoria = ?'); par.push(cat); }
      // il filtro per attività (dal chip «Consigliato per» o dallo smistamento): i tag stanno in p.attivita come JSON, cerco il tag fra virgolette
      if (ATTIVITA.includes(att)) { dove.push('p.attivita LIKE ?'); par.push(`%"${att}"%`); }
      // fra chi installa contano solo quelli che possono vendere davvero: corso, esperienza sui programmi impegnativi, programma partner
      const ab = abilitatiSql(cfg), conCorso = ab.sql;
      if (zona) { dove.push(`EXISTS (SELECT 1 FROM adozione a JOIN utente i ON i.id = a.installatore WHERE a.prodotto = p.id AND i.stato = 'attivo'${conCorso} AND (lower(a.zona) LIKE ? OR lower(a.zona) LIKE '%italia%' OR lower(a.zona) LIKE '%remoto%'))`); par.push(...ab.par, `%${zona}%`); }
      const base = `FROM prodotto p JOIN utente u ON u.id = p.builder WHERE ${dove.join(' AND ')}`;
      const totale = db.prepare(`SELECT COUNT(*) n ${base}`).get(...par).n;
      const l = db.prepare(`SELECT p.*, u.nome AS builder_nome, u.github_login, u.avatar, u.segnaposto, u.codice AS builder_codice,
          (SELECT COUNT(*) FROM adozione a JOIN utente i ON i.id = a.installatore WHERE a.prodotto = p.id AND i.stato = 'attivo'${conCorso}) AS installatori,
          (SELECT MIN(COALESCE(a.prezzo_avvio, p.prezzo_avvio)) FROM adozione a JOIN utente i ON i.id = a.installatore WHERE a.prodotto = p.id AND i.stato = 'attivo'${conCorso}) AS da_avvio,
          (SELECT ROUND(AVG(voto), 1) FROM recensione r WHERE r.prodotto = p.id AND r.nascosta = 0) AS media,
          (SELECT COUNT(*) FROM recensione r WHERE r.prodotto = p.id AND r.nascosta = 0) AS n
        ${base} ORDER BY ${ordine} LIMIT ? OFFSET ?`).all(...ab.par, ...ab.par, ...par, PER_PAGINA, (pagina - 1) * PER_PAGINA);
      h.rispondi(res, 200, { categorie: CATEGORIE, attivita: ATTIVITA, totale, pagina, pagine: Math.max(1, Math.ceil(totale / PER_PAGINA)),
        prodotti: l.map(p => ({ ...c.vista(p), da_avvio: p.da_avvio ?? null, builder: p.builder_nome, builder_codice: p.segnaposto ? null : p.builder_codice, github: p.github_login, avatar: p.avatar, installatori: p.installatori, voto: p.media, recensioni: p.n, rivendicato: !p.segnaposto })) });
    },
    'GET /api/prodotto': async (req, res, { url, io, b }) => {
      const p = db.prepare('SELECT p.*, u.nome AS builder_nome, u.github_login, u.avatar, u.codice AS builder_codice, u.stato AS builder_stato, u.segnaposto FROM prodotto p JOIN utente u ON u.id = p.builder WHERE p.slug = ?')
        .get(String(url.searchParams.get('slug') || ''));
      const visibile = p && ((p.stato === 'pubblicato' && ['attivo', 'non_rivendicato'].includes(p.builder_stato)) || (io && (p.builder === io.id || c.eAdmin(io))));
      if (!visibile) throw errore(404, 'Prodotto non trovato');
      const reti = retiProdotto(p);
      // a licenza d'uso interno e senza l'azienda che lo sviluppa: si vendono solo installazione e assistenza, tutto a chi installa.
      // Altrimenti chi vende tiene quello che resta dopo la percentuale di chi sviluppa (o il loro accordo), ridotta dal suo livello
      const assente = sviluppatoreAssente(db, p.id), perc = assente ? 0 : percentualeDi(cfg, p), qBase = assente ? 1 : quotaDi(db, cfg, p.id, null);
      // con carta: prima il costo di Stripe (qui la stima), poi la piattaforma, poi il resto. Il canone dell'assistenza (chi ha
      // installato risponde, la piattaforma dietro): tolto Stripe, 60% a chi ha installato e il resto alla piattaforma; a chi sviluppa
      // la sua parte, se c'è. Si divide come l'installazione solo con ASSISTENZA_PIATTAFORMA=0
      const carta = (importo, q, fp = cfg.piattaforma) => dividi(importo, q, fp, true, stimaStripe(cfg, importo));
      const qs = quotaSviluppatoreAssistenza(db, cfg, p.id), qi = quotaInstallatoreAssistenza(db, cfg, p.id);
      const mese = q => cfg.assistenzaPiattaforma ? dividiCanone(p.prezzo_mese, qi, qs, true, stimaStripe(cfg, p.prezzo_mese)) : carta(p.prezzo_mese, q);
      // chi lo installa: con il corso superato (e l'esperienza, se è impegnativo) e, se il programma partner è obbligatorio, confermato
      const ab = filtroAbilitati(cfg, p), casa = squadra(db, cfg);
      const inst = db.prepare(`SELECT u.id, u.nome, u.codice, u.avatar, u.calendario, a.zona, a.quota, COALESCE(a.prezzo_avvio, ?) AS prezzo_avvio, u.wallet, u.wallet_sol, u.wallet_btc, u.wallet_tron, u.stripe_pronto
          FROM adozione a JOIN utente u ON u.id = a.installatore WHERE a.prodotto = ? AND u.stato = 'attivo' AND (? = 0 OR a.programma_accettato IS NOT NULL)${ab.sql} ORDER BY a.creato`).all(p.prezzo_avvio, p.id, p.programma_obbligatorio ? 1 : 0, ...ab.par)
        .map(i => { const v = voto('installatore', i.id), f = fiducia(i.id), l = livelloDi(db, cfg, p.id, i.id), q = assente ? 1 : conLivello(i.quota ?? qBase, l.fattore);
          return { nome: i.nome, codice: i.codice, avatar: i.avatar, zona: i.zona, calendario: i.calendario, voto: v.media, recensioni: v.n,
          prezzo_avvio: i.prezzo_avvio, vendite: l.vendite, livello: l.livello,
          quota: q, concordata: i.quota != null, divisione: { avvio: carta(i.prezzo_avvio, q), mese: mese(q), crypto: dividi(i.prezzo_avvio, q, cfg.piattaformaCrypto), bonifico: dividi(i.prezzo_avvio, q, cfg.piattaformaBonifico) },
          totale_crypto: i.prezzo_avvio + canone(p.prezzo_mese, cfg.crypto.mesi, cfg.scontoAnno),
          confermate: f.confermate, contestazioni: f.contestazioni, reti: reti.filter(r => walletDi(i, r.tipo)).map(r => r.id), carta: !cfg.stripe.perConto || !!i.stripe_pronto || casa.includes(i.id),
          bonifico: !!c.bonificoPer?.(i.id) }; });
      // i prezzi li decide chi vende: il più basso e il più alto fra chi lo offre (per «da … €»); la divisione d'esempio è sul più basso
      const prezzi = inst.map(i => i.prezzo_avvio), da = prezzi.length ? Math.min(...prezzi) : null;
      const ref = url.searchParams.get('ref') || b.ref, d = carta(da ?? 0, qBase), dm = mese(qBase);
      // solo preventivi: nel prelancio, e sui progetti non ancora rivendicati finché i loro pagamenti sono spenti
      // (i progetti a uso interno senza l'azienda si pagano: non c'è nessuna parte da tenere da parte per chi non ha aderito)
      const soloPreventivo = c.prelancio() || (!!p.segnaposto && !assente && !cfg.nonRivendicatiPagamenti);
      const v = voto('prodotto', p.id), attesa = p.segnaposto ? db.prepare("SELECT COALESCE(SUM(importo - stornato), 0) c FROM quota WHERE beneficiario = ? AND prodotto = ? AND stato = 'in_attesa'").get(p.builder, p.id).c : 0;
      const mia = io && db.prepare('SELECT zona, programma_accettato, prezzo_avvio FROM adozione WHERE installatore = ? AND prodotto = ?').get(io.id, p.id);
      h.rispondi(res, 200, { ...c.vista(p), builder: p.builder_nome, builder_codice: p.segnaposto ? null : p.builder_codice, github: p.github_login, avatar: p.avatar, installatori: inst,
        versione_url: p.versione_url || null, ...(mia ? { mioLink: linkDi(p, io), miaZona: mia.zona, miaQuotaBase: assente ? 1 : quotaDi(db, cfg, p.id, io.id) } : {}), scelto: inst.find(i => i.codice === ref)?.codice || null,
        divisione: { avvio: d, mese: dm }, quotaInstallatore: qBase, percentuale: perc, percentualeScelta: p.percentuale != null, livelli: cfg.livelli, assistenzaPiattaforma: cfg.assistenzaPiattaforma,
        quotaInstallatoreAssistenza: cfg.assistenzaPiattaforma ? qi : null,
        canone: { rispostaOre: cfg.rispostaOre, monitorMinuti: cfg.monitorMinuti, tariffaOra: cfg.tariffaOra, riattivazioneMesi: cfg.riattivazioneMesi },
        prezzi: { da, a: prezzi.length ? Math.max(...prezzi) : null }, sviluppatoreAssente: assente, mio: !!io && p.builder === io.id,
        installazione: leggiJson(p.installazione), idee: leggiJson(p.idee), readme: p.readme_html || '', sicurezza: c.controlli?.ultimo(p.id) || null, voto: v.media, recensioni_n: v.n,
        recensioni: db.prepare(`SELECT r.voto, r.testo, r.autore, r.risposta, r.creata, i.nome AS installatore FROM recensione r LEFT JOIN utente i ON i.id = r.installatore
          WHERE r.prodotto = ? AND r.nascosta = 0 ORDER BY r.creata DESC LIMIT 30`).all(p.id),
        versioni: db.prepare('SELECT tag, nome, url, pubblicata FROM versione WHERE prodotto = ? ORDER BY pubblicata DESC LIMIT 5').all(p.id),
        collaboratori: db.prepare("SELECT c.github_login AS login FROM collaboratore c WHERE c.prodotto = ? AND c.stato = 'attivo'").all(p.id).map(x => x.login),
        // gli owner del repository (chi l'ha rivendicato e chi ha admin o maintain ed è entrato dopo), con la parte di ognuno dai commit
        owner: p.segnaposto ? [] : (c.ownerDi?.(p.id) || []),
        sonoOwner: !!io && !p.segnaposto && (p.builder === io.id || !!db.prepare("SELECT 1 FROM cotitolare WHERE prodotto = ? AND utente = ? AND stato = 'attivo'").get(p.id, io.id)),
        rivendicabile: p.segnaposto ? { importo: attesa } : null, prelancio: soloPreventivo, prezzo_anno: p.prezzo_mese > 0 ? canone(p.prezzo_mese, 12, cfg.scontoAnno) : 0,
        // la riga facoltativa degli aggiornamenti garantiti da chi sviluppa: il suo prezzo, cosa promette e come si divide (tolta la piattaforma, a chi sviluppa)
        aggiornamenti: conAggiornamenti(p) ? { mese: p.prezzo_aggiornamenti, anno: canone(p.prezzo_aggiornamenti, 12, cfg.scontoAnno), testo: p.aggiornamenti_testo,
          quota: cfg.quotaInstallatoreAggiornamenti, divisione: carta(p.prezzo_aggiornamenti, cfg.quotaInstallatoreAggiornamenti) } : null, sconto_anno: cfg.scontoAnno, grazia: cfg.grazia, perConto: cfg.stripe.perConto, carta: !!cfg.stripe.chiave, trattenuta: cfg.trattenuta,
        badge: { svg: `${cfg.url}/badge/${p.slug}.svg`, markdown: `[![${cfg.nome}](${cfg.url}/badge/${p.slug}.svg)](${cfg.url}/p/${p.slug})` },
        crypto: reti.length && (da ?? 0) + p.prezzo_mese > 0 && !soloPreventivo ? { mesi: cfg.crypto.mesi, totale: (da ?? 0) + canone(p.prezzo_mese, cfg.crypto.mesi, cfg.scontoAnno), canone: canone(p.prezzo_mese, cfg.crypto.mesi, cfg.scontoAnno),
          aggiornamenti: conAggiornamenti(p) ? canone(p.prezzo_aggiornamenti, cfg.crypto.mesi, cfg.scontoAnno) : 0,
          reti: reti.map(r => ({ id: r.id, nome: r.nome, tipo: r.tipo, prova: !!r.prova, monete: r.monete.map(m => m.simbolo), escrow: !!r.escrow })) } : null,
        // i pagamenti diretti sul conto della piattaforma (bonifico, carta dal POS virtuale della banca): con chi installa per lei, anche
        // nel prelancio; l'assistenza in anticipo per BONIFICO_MESI
        bonifico: inst.some(i => i.bonifico) && (da ?? 0) + p.prezzo_mese > 0 ? { metodi: c.metodiDiretti(), mesi: cfg.bonifico.mesi, giorni: cfg.bonifico.giorni, canone: canone(p.prezzo_mese, cfg.bonifico.mesi, cfg.scontoAnno),
          aggiornamenti: conAggiornamenti(p) ? canone(p.prezzo_aggiornamenti, cfg.bonifico.mesi, cfg.scontoAnno) : 0 } : null,
        adottato: !!mia, programmaAccettato: !!mia?.programma_accettato, difficolta: difficoltaDi(p), prezzoMin: cfg.prezzoMin, commissioni: { carta: cfg.piattaforma, crypto: cfg.piattaformaCrypto, stripe: cfg.costoStripe ? cfg.stimaStripe : null, sviluppatoreAssistenza: qs },
        // per chi lo offre o lo vuole offrire: il suo prezzo, il suo livello e un prezzo da cui partire (quelli degli altri, o il riferimento)
        ...(io ? { mioPrezzo: mia ? prezzoAvvioDi(db, p.id, io.id) : null, mioLivello: mia ? livelloDi(db, cfg, p.id, io.id) : null, suggerito: suggerito(p) } : {}),
        zone: c.seo?.zoneProdotto(p.id) || [],   // le province con una pagina locale per questo prodotto
        // per chi è dentro: cosa gli manca per offrirlo (il corso, o l'esperienza per i programmi impegnativi)
        ...(io ? { manca: manca(db, cfg, io, p), corso: livello(db, cfg, io) } : {}) });
    },
    'GET /api/profilo': async (req, res, { url }) => {   // la pagina pubblica di un installatore o di un builder
      const u = db.prepare("SELECT * FROM utente WHERE codice = ? AND stato = 'attivo'").get(String(url.searchParams.get('codice') || ''));
      if (!u) throw errore(404, 'Profilo non trovato');
      const v = voto('installatore', u.id);
      h.rispondi(res, 200, { nome: u.nome, codice: u.codice, avatar: u.avatar, zona: u.zona, bio: u.bio, sito: u.sito, calendario: u.calendario, github: u.github_login, dal: u.creato,
        voto: v.media, recensioni_n: v.n,
        installa: (ab => db.prepare(`SELECT p.slug, p.nome, p.descrizione, a.zona FROM adozione a JOIN prodotto p ON p.id = a.prodotto JOIN utente i ON i.id = a.installatore
          WHERE a.installatore = ? AND p.stato = 'pubblicato'${ab.sql}`).all(u.id, ...ab.par))(abilitatiSql(cfg)),
        costruisce: db.prepare("SELECT slug, nome, descrizione, stelle FROM prodotto WHERE builder = ? AND stato = 'pubblicato'").all(u.id),
        recensioni: db.prepare('SELECT r.voto, r.testo, r.autore, r.risposta, r.creata, p.nome prodotto FROM recensione r JOIN prodotto p ON p.id = r.prodotto WHERE (r.installatore = ? OR p.builder = ?) AND r.nascosta = 0 ORDER BY r.creata DESC LIMIT 20').all(u.id, u.id) });
    },
    'GET /badge': async (req, res, { url }) => {   // /badge/<slug>.svg: «Installa con …» per i README
      const slug = url.pathname.match(/^\/badge\/([a-z0-9-]{1,60})\.svg$/)?.[1];
      const ab = abilitatiSql(cfg), p = slug && db.prepare(`SELECT p.id, (SELECT COUNT(*) FROM adozione a JOIN utente i ON i.id = a.installatore WHERE a.prodotto = p.id AND i.stato = 'attivo'${ab.sql}) n FROM prodotto p WHERE p.slug = ? AND p.stato = 'pubblicato'`).get(...ab.par, slug);
      // la lingua solo da Accept-Language, non dal biscotto: il badge vive nelle cache condivise (camo di GitHub, proxy) e deve variare solo su ciò che dichiara
      const en = linguaDi(req, {}, cfg.lingua) === 'en';
      const sx = en ? 'install with' : 'installa con', dx = p ? `${cfg.nome} · ${p.n} ${en ? (p.n === 1 ? 'installer' : 'installers') : (p.n === 1 ? 'installatore' : 'installatori')}` : cfg.nome;
      const w = t => Math.round(t.length * 6.6 + 14), a = w(sx), z = w(dx), esc = t => t.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${a + z}" height="20" role="img" aria-label="${esc(sx)}: ${esc(dx)}"><title>${esc(sx)}: ${esc(dx)}</title>`
        + `<rect width="${a}" height="20" fill="#555"/><rect x="${a}" width="${z}" height="20" fill="#7B3DFF"/>`
        + `<g fill="#fff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11"><text x="7" y="14">${esc(sx)}</text><text x="${a + 7}" y="14" font-weight="bold">${esc(dx)}</text></g></svg>`;
      res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'public, max-age=3600', vary: 'Accept-Language', 'x-content-type-options': 'nosniff',
        'referrer-policy': 'same-origin', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" });
      res.end(svg);
    },

    // ---------------- installatori ----------------
    'POST /api/adozioni': async (req, res, { io }) => {
      c.serve(io); if (!io.email_verificata && !io.github_id) throw errore(403, 'Conferma prima la tua email: ti abbiamo scritto quando ti sei iscritto');
      const { prodotto, zona, programma, prezzo_avvio } = await h.json(req);
      const gia = db.prepare('SELECT 1 FROM adozione WHERE installatore = ? AND prodotto = ?').get(io.id, Number(prodotto));
      const p = db.prepare(`SELECT * FROM prodotto WHERE id = ? AND (stato = 'pubblicato' OR (? AND stato IN ('revisione', 'sospeso')))`).get(Number(prodotto), gia ? 1 : 0); if (!p) throw errore(404, 'Prodotto non trovato');
      const z = testo(zona ?? io.zona, 60); if (z.length < 2) throw errore(400, 'Scrivi la zona in cui installi (la città, o «tutta Italia, da remoto»)');
      const nuova = !db.prepare('SELECT 1 FROM adozione WHERE installatore = ? AND prodotto = ?').get(io.id, p.id);
      // il programma partner dell'azienda: chi offre il prodotto conferma di rispettarne le condizioni (se è obbligatorio, prima di offrirlo)
      const m = nuova && manca(db, cfg, io, p);
      if (m === 'corso') throw errore(403, 'Per offrire i programmi del catalogo serve il corso per installatori: sono 8 lezioni brevi e un test');
      if (m === 'esperienza') throw errore(403, `${p.nome} è un programma impegnativo: si sblocca dopo ${cfg.corso.esperienza} installazioni confermate dai clienti`);
      if (nuova && p.programma_obbligatorio && programma !== true) throw errore(400, `Per offrire ${p.nome} conferma di rispettare le condizioni del programma partner (${p.programma_nome})`);
      // il prezzo dell'installazione lo decide chi vende: lo scrive quando inizia a offrirlo (senza, parte dal prezzo di riferimento del
      // catalogo, se c'è) e lo cambia quando vuole; vale per le vendite nuove, chi ha già comprato ha pagato il suo
      const pa = prezzo_avvio === undefined ? (nuova ? (p.prezzo_avvio >= cfg.prezzoMin ? p.prezzo_avvio : prezzoVenditore(null)) : null) : prezzoVenditore(prezzo_avvio);
      db.prepare(`INSERT INTO adozione (installatore, prodotto, zona, programma_accettato, prezzo_avvio) VALUES (?, ?, ?, ?, ?) ON CONFLICT(installatore, prodotto) DO UPDATE SET zona = excluded.zona,
        programma_accettato = COALESCE(adozione.programma_accettato, excluded.programma_accettato), prezzo_avvio = COALESCE(excluded.prezzo_avvio, adozione.prezzo_avvio)`)
        .run(io.id, p.id, z, programma === true ? new Date().toISOString() : null, pa);
      if (nuova && p.builder !== io.id) notifiche.notifica(p.builder, 'installatore.nuovo', { prodotto: p.nome, installatore: io.nome, zona: z, prezzo: pa });
      h.rispondi(res, 200, { link: linkDi(p, io), prezzo_avvio: prezzoAvvioDi(db, p.id, io.id) });
    },
    // chi offriva già il prodotto quando il programma è diventato obbligatorio: conferma da qui e torna fra chi lo installa
    'POST /api/adozioni/programma': async (req, res, { io }) => {
      c.serve(io); const { prodotto } = await h.json(req);
      const n = db.prepare("UPDATE adozione SET programma_accettato = COALESCE(programma_accettato, ?) WHERE installatore = ? AND prodotto = ?").run(new Date().toISOString(), io.id, Number(prodotto)).changes;
      if (!n) throw errore(404, 'Non offri questo prodotto');
      h.rispondi(res, 200, { ok: true });
    },
    'POST /api/adozioni/lascia': async (req, res, { io }) => {
      c.serve(io); db.prepare('DELETE FROM adozione WHERE installatore = ? AND prodotto = ?').run(io.id, Number((await h.json(req)).prodotto)); h.rispondi(res, 200, { ok: true });
    },

    // ---------------- la divisione: una proposta diversa dalla percentuale di chi sviluppa, fra chi vende e il builder; vale dalla vendita dopo il sì ----------------
    'POST /api/accordi/proponi': async (req, res, { io }) => {
      const { prodotto, installatore, quota, nota } = await h.json(req);
      const k = coppia(io, prodotto, installatore), q = Number(quota), n = testo(nota ?? '', 300) || null;
      if (!Number.isInteger(q) || q < 0 || q > 100) throw errore(400, 'La parte di chi installa va da 0 a 100%');
      if (pc(k.a.quota ?? quotaDi(db, cfg, k.p.id, null)) === q) throw errore(400, 'È già la divisione di adesso');
      db.prepare("UPDATE adozione SET proposta = ?, proposta_da = ?, proposta_nota = ?, proposta_il = datetime('now') WHERE installatore = ? AND prodotto = ?").run(q / 100, k.chi, n, k.inst.id, k.p.id);
      notifiche.notifica(k.altro, 'accordo.proposto', { prodotto: k.p.nome, slug: k.p.slug, da: io.nome, quota: q, resto: 100 - q, nota: n, link: k.link });
      h.rispondi(res, 200, { ok: true });
    },
    'POST /api/accordi/rispondi': async (req, res, { io }) => {
      const { prodotto, installatore, accetta } = await h.json(req);
      const k = coppia(io, prodotto, installatore), q = k.a.proposta;
      if (q == null) throw errore(400, 'Non c\'è nessuna proposta in sospeso');
      if (k.a.proposta_da === k.chi) throw errore(400, 'La proposta è tua: aspetta la risposta');
      // un accordo che torna alla percentuale di chi sviluppa si salva come «nessun accordo»: segue quella (anche se poi cambia)
      if (accetta) db.prepare(`UPDATE adozione SET quota = ?, accordo = datetime('now'), ${senzaProposta} WHERE installatore = ? AND prodotto = ?`).run(pc(q) === pc(quotaDi(db, cfg, k.p.id, null)) ? null : q, k.inst.id, k.p.id);
      else db.prepare(`UPDATE adozione SET ${senzaProposta} WHERE installatore = ? AND prodotto = ?`).run(k.inst.id, k.p.id);
      notifiche.notifica(k.altro, accetta ? 'accordo.accettato' : 'accordo.rifiutato', { prodotto: k.p.nome, slug: k.p.slug, da: io.nome, quota: pc(q), resto: 100 - pc(q), link: k.link });
      h.rispondi(res, 200, { ok: true, quota: accetta ? q : k.a.quota ?? quotaDi(db, cfg, k.p.id, null) });
    },
    'POST /api/accordi/ritira': async (req, res, { io }) => {
      const { prodotto, installatore } = await h.json(req);
      const k = coppia(io, prodotto, installatore);
      if (k.a.proposta == null || k.a.proposta_da !== k.chi) throw errore(400, 'Non hai proposte in sospeso');
      db.prepare(`UPDATE adozione SET ${senzaProposta} WHERE installatore = ? AND prodotto = ?`).run(k.inst.id, k.p.id);
      h.rispondi(res, 200, { ok: true });
    },

    // ---------------- le mance: chi sviluppa ringrazia chi vende i suoi prodotti (con la carta, una tantum) ----------------
    'POST /api/mance': async (req, res, { io }) => {
      c.serve(io);
      if (c.prelancio()) throw errore(503, 'I pagamenti non sono ancora aperti: le mance arrivano con il lancio');
      if (!cfg.stripe.chiave) throw errore(503, 'Le mance si mandano con la carta, e i pagamenti con carta non sono attivi');
      const { prodotto, installatore, importo, nota } = await h.json(req);
      const p = db.prepare('SELECT id, nome, slug, builder FROM prodotto WHERE id = ?').get(Number(prodotto));
      if (!p || p.builder !== io.id) throw errore(404, 'Prodotto non trovato');
      const i = db.prepare("SELECT u.id, u.nome FROM adozione a JOIN utente u ON u.id = a.installatore WHERE a.prodotto = ? AND u.codice = ? AND u.stato = 'attivo'").get(p.id, String(installatore || ''));
      if (!i) throw errore(404, 'Questa persona non vende il prodotto');
      if (i.id === io.id) throw errore(400, 'La mancia va a chi vende i tuoi prodotti, non a te');
      const x = Math.round(Number(String(importo ?? '').replace(',', '.')) * 100);
      if (!Number.isInteger(x) || x < cfg.prezzoMin || x > cfg.manciaMax) throw errore(400, `La mancia va da ${cfg.prezzoMin / 100} a ${cfg.manciaMax / 100} €`);
      if (troppiTentativi(`mc:${io.id}`, Date.now(), 10, 60 * 60e3)) throw errore(429, 'Troppe mance in poco tempo: riprova più tardi');
      const n = testo(nota ?? '', 200) || null;
      const id = Number(db.prepare('INSERT INTO mancia (da, a, prodotto, importo, nota) VALUES (?, ?, ?, ?, ?)').run(io.id, i.id, p.id, x, n).lastInsertRowid);
      const md = { mancia: String(id), da: io.id, a: i.id, prodotto: p.id };
      const s = await stripe.post('/v1/checkout/sessions', { mode: 'payment', locale: c.lingua(req) === 'en' ? 'en' : 'it', ...(io.email ? { customer_email: io.email } : {}),
        line_items: [{ quantity: 1, price_data: { currency: cfg.valuta, unit_amount: x, product_data: { name: `Mancia a ${i.nome}`, description: `Da ${io.nome}, per come vende ${p.nome} su ${cfg.nome}` } } }],
        metadata: md, payment_intent_data: { metadata: md },
        success_url: `${cfg.url}/area?mancia=ok#prodotti`, cancel_url: `${cfg.url}/area#prodotti` }, { idempotenza: `mancia-${id}` });
      db.prepare('UPDATE mancia SET sessione = ? WHERE id = ?').run(s.id, id);
      h.rispondi(res, 200, { url: s.url });
    },

    // ---------------- business: checkout, contatti, recensioni ----------------
    'POST /api/checkout': async (req, res, { b }) => {
      if (c.prelancio()) throw errore(503, 'I pagamenti non sono ancora aperti: chiedi un preventivo all\'installatore');
      if (!cfg.stripe.chiave) throw errore(503, 'I pagamenti con carta non sono attivi: paga in crypto o scrivi all\'installatore');
      if (troppiTentativi(`co:${ipDi(req)}`, Date.now(), 20, 10 * 60e3)) throw errore(429, 'Troppe richieste: riprova fra qualche minuto');
      const s = await c.sessioneCheckout(req, await h.json(req));
      h.rispondi(res, 200, { url: s.url });
    },
    'POST /api/contatto': async (req, res) => {   // un business scrive a un installatore (la sua email resta privata: si risponde per email)
      const x = await h.json(req);
      if (troppiTentativi(`ct:${ipDi(req)}`, Date.now(), 5, 60 * 60e3)) throw errore(429, 'Hai mandato troppe richieste: riprova più tardi');
      if (x.sito_web) return h.rispondi(res, 200, { ok: true });   // il campo trappola
      const i = db.prepare("SELECT * FROM utente WHERE codice = ? AND stato = 'attivo'").get(String(x.installatore || '')); if (!i) throw errore(404, 'Installatore non trovato');
      const p = x.prodotto ? db.prepare("SELECT id, nome FROM prodotto WHERE slug = ? AND stato = 'pubblicato'").get(String(x.prodotto)) : null;
      const nome = testo(x.nome, 80), email = String(x.email || '').trim().toLowerCase(), messaggio = testo(x.messaggio, 3000), tel = testo(x.telefono, 30);
      if (nome.length < 2) throw errore(400, 'Scrivi il tuo nome o quello della tua attività');
      if (!emailValida(email)) throw errore(400, 'Email non valida: serve per risponderti');
      if (messaggio.length < 10) throw errore(400, 'Scrivi due righe: cosa ti serve, dove sei');
      if (x.privacy !== true) throw errore(400, 'Per mandare la richiesta conferma di aver letto l\'informativa privacy');
      db.prepare('INSERT INTO contatto (installatore, prodotto, nome, email, telefono, messaggio) VALUES (?, ?, ?, ?, ?, ?)').run(i.id, p?.id || null, nome, email, tel || null, messaggio);
      notifiche.notifica(i.id, 'contatto.nuovo', { da: nome, email, messaggio: tel ? `${messaggio}\n\nTelefono: ${tel}` : messaggio, prodotto: p?.nome || null });
      h.rispondi(res, 200, { ok: true });
    },
    'POST /api/recensioni/rispondi': async (req, res, { io }) => {   // l'installatore o il builder rispondono (una volta) a una recensione
      c.serve(io); const { cliente, testo: t } = await h.json(req);
      const r = db.prepare('SELECT r.*, p.builder FROM recensione r JOIN prodotto p ON p.id = r.prodotto WHERE r.cliente = ?').get(String(cliente || ''));
      if (!r || (r.installatore !== io.id && r.builder !== io.id)) throw errore(404, 'Recensione non trovata');
      if (r.risposta) throw errore(400, 'Hai già risposto');
      db.prepare('UPDATE recensione SET risposta = ? WHERE cliente = ?').run(testo(t, 1000) || null, r.cliente); h.rispondi(res, 200, { ok: true });
    },

    // ---------------- l'area dei business che hanno comprato: si entra con un link via email ----------------
    'POST /api/cliente/link': async (req, res) => {
      const em = String((await h.json(req)).email || '').trim().toLowerCase();
      if (troppiTentativi(`cl:${ipDi(req)}`, Date.now(), 5) || troppiTentativi(`cle:${em}`, Date.now(), 3)) throw errore(429, 'Ti abbiamo già scritto: controlla la posta');
      if (emailValida(em) && db.prepare('SELECT 1 FROM cliente WHERE email = ?').get(em)) {
        const t = nuovoGettone(db, 'cliente', { dato: em, minuti: 30 });
        notifiche.email(em, 'accesso', { nome: em.split('@')[0], link: `${cfg.url}/cliente?t=${t}`, minuti: 30 }, { lingua: c.lingua(req) });
      }
      h.rispondi(res, 200, { ok: true });
    },
    'POST /api/cliente/entra': async (req, res) => {
      const g = usaGettone(db, 'cliente', (await h.json(req)).t); if (!g) throw errore(400, 'Il link è scaduto o è già stato usato: chiedine un altro');
      const t = randomBytes(32).toString('base64url');
      db.prepare('INSERT INTO sessione_cliente (token, email, scade) VALUES (?, ?, ?)').run(hashGettone(t), g.dato, new Date(Date.now() + 7 * 864e5).toISOString());
      h.rispondi(res, 200, { ok: true }, { 'set-cookie': h.biscotto('cliente', t, 7) });
    },
    'POST /api/cliente/esci': async (req, res, { b }) => {
      if (b.cliente) db.prepare('DELETE FROM sessione_cliente WHERE token = ?').run(hashGettone(b.cliente));
      h.rispondi(res, 200, { ok: true }, { 'set-cookie': h.biscotto('cliente', '', 0) });
    },
    'GET /api/cliente': async (req, res, { b }) => {
      const em = sessioneCliente(b); if (!em) throw errore(401, 'Entra con il link che ti mandiamo per email');
      h.rispondi(res, 200, { email: em, trattenuta: cfg.trattenuta, acquisti: db.prepare(`SELECT c.chiave, c.stato, c.creato, c.nome, c.confermato, c.cliente_stripe IS NOT NULL AS gestibile, c.chiave LIKE 'cr_%' AS crypto, c.chiave LIKE 'bn_%' AS bonifico,
          p.nome prodotto, p.slug, i.nome installatore, i.codice, r.voto, r.testo, r.autore,
          (SELECT k.stato FROM contestazione k WHERE k.cliente = c.chiave ORDER BY k.creata DESC LIMIT 1) segnalazione,
          (SELECT k.esito FROM contestazione k WHERE k.cliente = c.chiave ORDER BY k.creata DESC LIMIT 1) esito,
          (SELECT k.importo FROM contestazione k WHERE k.cliente = c.chiave ORDER BY k.creata DESC LIMIT 1) rimborsati,
          o.codice ordine, o.escrow IS NOT NULL AS escrow, o.custodia, o.sblocco, o.congelato, o.rete, o.pagatore
          FROM cliente c LEFT JOIN prodotto p ON p.id = c.prodotto LEFT JOIN utente i ON i.id = c.installatore
          LEFT JOIN recensione r ON r.cliente = c.chiave LEFT JOIN ordine o ON c.chiave LIKE 'cr_%' AND o.codice = substr(c.chiave, 4) AND o.escrow IS NOT NULL
          WHERE c.email = ? AND NOT EXISTS (SELECT 1 FROM cliente v WHERE v.riattivato = c.chiave) ORDER BY c.creato DESC`).all(em).map(x => {
            // riattivata: l'acquisto resta questo (installazione, recensione, garanzia), l'assistenza è quella dell'abbonamento nuovo
            const cl = attuale(db, db.prepare('SELECT * FROM cliente WHERE chiave = ?').get(x.chiave));
            return { ...x, stato: cl.stato, gestibile: !!x.gestibile || !!cl.cliente_stripe, crypto: !!x.crypto, bonifico: !!x.bonifico, escrow: !!x.escrow, pagamento: cl.pagamento, periodo: cl.periodo, disdetta: cl.disdetta,
              assistenza: statoAssistenza(cl, cfg), link_assistenza: cl.prodotto ? linkAssistenza(cfg, codiceAssistenza(db, cl.chiave)) : null,
              aperte: db.prepare("SELECT COUNT(*) n FROM richiesta WHERE cliente = ? AND stato != 'risolta'").get(cl.chiave).n };
          }) });
    },
    // ---- la garanzia: «è installato e funziona» oppure «qualcosa non va» (le quote si fermano finché la piattaforma non decide) ----
    'POST /api/cliente/conferma': async (req, res, { b }) => {
      const em = sessioneCliente(b); if (!em) throw errore(401, 'Entra con il link che ti mandiamo per email');
      const cl = db.prepare('SELECT * FROM cliente WHERE chiave = ? AND email = ?').get(String((await h.json(req)).chiave || ''), em);
      if (!cl?.prodotto) throw errore(404, 'Acquisto non trovato');
      if (!cl.confermato) {
        db.prepare("UPDATE cliente SET confermato = datetime('now') WHERE chiave = ?").run(cl.chiave);
        const p = db.prepare('SELECT nome, slug, builder FROM prodotto WHERE id = ?').get(cl.prodotto);
        for (const u of new Set([cl.installatore, p.builder].filter(Boolean))) notifiche.notifica(u, 'installazione.confermata', { prodotto: p.nome, slug: p.slug, cliente: cl.nome });
        avvisaLivello(db, cfg, notifiche.notifica, cl.prodotto, cl.installatore);
      }
      h.rispondi(res, 200, { ok: true });
    },
    'POST /api/cliente/segnala': async (req, res, { b }) => {
      const em = sessioneCliente(b); if (!em) throw errore(401, 'Entra con il link che ti mandiamo per email');
      const x = await h.json(req); const cl = db.prepare('SELECT * FROM cliente WHERE chiave = ? AND email = ?').get(String(x.chiave || ''), em);
      if (!cl?.prodotto) throw errore(404, 'Acquisto non trovato');
      const t = testo(x.testo, 2000); if (t.length < 10) throw errore(400, 'Racconta cosa non va: bastano due righe');
      if (db.prepare("SELECT 1 FROM contestazione WHERE cliente = ? AND stato = 'aperta'").get(cl.chiave)) throw errore(409, 'C\'è già una segnalazione aperta su questo acquisto: ti rispondiamo per email');
      if (troppiTentativi(`seg:${em}`, Date.now(), 3, 24 * 3600e3)) throw errore(429, 'Hai già mandato diverse segnalazioni oggi: ti rispondiamo per email');
      const id = Number(db.prepare('INSERT INTO contestazione (cliente, email, testo) VALUES (?, ?, ?)').run(cl.chiave, em, t).lastInsertRowid);
      // la segnalazione ferma le quote non ancora versate (anche quelle già ferme per una contestazione su Stripe: restano ferme finché non si chiudono tutte e due)
      const ferme = db.prepare(`UPDATE quota SET ferma_segnalazione = 1, stato = CASE WHEN stato = 'in_attesa' THEN 'contestata' ELSE stato END
        WHERE cliente = ? AND stato IN ('in_attesa', 'contestata')`).run(cl.chiave).changes;
      const p = db.prepare('SELECT nome, slug, builder FROM prodotto WHERE id = ?').get(cl.prodotto);
      for (const u of new Set([cl.installatore, p.builder].filter(Boolean))) notifiche.notifica(u, 'contestazione.aperta', { prodotto: p.nome, slug: p.slug, cliente: cl.nome, testo: t });
      sospendiRecidivo(cl.installatore);
      // in escrow la trattenuta corre sul contratto: chi gestisce la piattaforma deve congelare il pagamento in fretta, se il cliente non l'ha fatto dal wallet
      const ord = cl.chiave.startsWith('cr_') ? db.prepare('SELECT codice, escrow, custodia FROM ordine WHERE codice = ? AND escrow IS NOT NULL').get(cl.chiave.slice(3)) : null;
      if (ord) for (const a of cfg.admin.filter(a => a.includes('@'))) notifiche.email(a, 'contestazione', { nome: a.split('@')[0], prodotto: p.nome, cliente: cl.nome || em,
        testo: `${t}\n\nOrdine in escrow ${ord.codice} (${ord.custodia}): se il cliente non l'ha già congelato dal wallet, fallo dal pannello (${cfg.url}/admin#contestazioni).` }).catch(() => {});
      h.rispondi(res, 200, { ok: true, id, ferme, ...(ord ? { escrow: { codice: ord.codice, custodia: ord.custodia } } : {}) });
    },
    'POST /api/cliente/portale': async (req, res, { b }) => {   // il portale di Stripe: carta, fatture, disdetta dell'abbonamento
      const em = sessioneCliente(b); if (!em) throw errore(401, 'Entra con il link che ti mandiamo per email');
      const cl = db.prepare('SELECT * FROM cliente WHERE chiave = ? AND email = ?').get(String((await h.json(req)).chiave || ''), em);
      if (!cl?.cliente_stripe) throw errore(404, 'Acquisto non trovato');
      h.rispondi(res, 200, { url: (await stripe.post('/v1/billing_portal/sessions', { customer: cl.cliente_stripe, return_url: `${cfg.url}/cliente`, locale: c.lingua(req) === 'en' ? 'en' : 'it' })).url });
    },
    'POST /api/cliente/recensione': async (req, res, { b }) => {
      const em = sessioneCliente(b); if (!em) throw errore(401, 'Entra con il link che ti mandiamo per email');
      const x = await h.json(req); const cl = db.prepare('SELECT * FROM cliente WHERE chiave = ? AND email = ?').get(String(x.chiave || ''), em);
      if (!cl?.prodotto) throw errore(404, 'Acquisto non trovato');
      const v = Number(x.voto); if (!Number.isInteger(v) || v < 1 || v > 5) throw errore(400, 'Scegli da 1 a 5 stelle');
      const nuova = !db.prepare('SELECT 1 FROM recensione WHERE cliente = ?').get(cl.chiave);
      db.prepare(`INSERT INTO recensione (cliente, prodotto, installatore, voto, testo, autore) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(cliente) DO UPDATE SET voto = excluded.voto, testo = excluded.testo, autore = excluded.autore, aggiornata = datetime('now')`)
        .run(cl.chiave, cl.prodotto, cl.installatore, v, testo(x.testo, 2000), testo(x.autore, 80) || testo(cl.nome, 80));
      const p = db.prepare('SELECT nome, slug, builder FROM prodotto WHERE id = ?').get(cl.prodotto);
      if (nuova) for (const u of new Set([cl.installatore, p.builder].filter(Boolean))) notifiche.notifica(u, 'recensione.nuova', { prodotto: p.nome, slug: p.slug, voto: v });
      h.rispondi(res, 200, { ok: true });
    },
  };
}
