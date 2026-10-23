// L'applicazione: tiene insieme le rotte (server/rotte/*), il contesto condiviso (database, Stripe, GitHub, posta, notifiche,
// reti crypto), le pagine (web/) e il controllo delle richieste. Le rotte sono «METODO /percorso» → funzione.
import { nuovoCodice, apriSessione, chiudiSessione, utenteDaSessione, chiaveSegreta, decifra } from './conti.js';
import { strumenti, biscotti, linguaDi, ipDi, ipCorto, dispositivo, errore, proxyCloudflare } from './http.js';
import { dizionario } from './lingue.js';
import { creaNotifiche, preferenze } from './notifiche.js';
import { creaSincronizzazione } from './sincronizza.js';
import { creaControlli } from './sicurezza.js';
import { creaSeo } from './seo.js';
import { riepilogoDac7, controllaFiscale } from './fiscale.js';
import { cifra } from './conti.js';
import { retiAccese, TIPI } from './reti.js';
import { rotteConti } from './rotte/conti.js';
import { rotteGithub, CATEGORIE } from './rotte/github.js';
import { rotteMercato } from './rotte/mercato.js';
import { rotteCrypto } from './rotte/crypto.js';
import { rotteIntegrazioni } from './rotte/integrazioni.js';
import { rotteAdmin } from './rotte/admin.js';
import { rotteStripe } from './rotte/stripe.js';
import { rotteAssistenza } from './rotte/assistenza.js';
import { rotteCorso } from './rotte/corso.js';
import { rotteBonifico } from './rotte/bonifico.js';
import { rotteAcquisto } from './rotte/acquisto.js';
import { CODICE_ACQUISTO } from './installa.js';
import { livello, manca } from './corso.js';
import { statoAssistenza, CODICE, attuale, eAdminDi, fissaAdmin, canoneMese, allineaCanone } from './assistenza.js';
import { percentualeDi, quotaDi, livelloDi, conLivello, titolariDi } from './soldi.js';
import { scriptBolla } from './bolla.js';
import { creaMappa, DURATA_MAPPA } from './mappa.js';
import { leggiVersione } from './versione.js';

export const PAGINE = { '/': 'index.html', '/esplora': 'esplora.html', '/accedi': 'accedi.html', '/area': 'area.html', '/admin': 'admin.html', '/grazie': 'grazie.html',
  '/contratto': 'contratto.html', '/privacy': 'privacy.html', '/garanzia': 'garanzia.html', '/cliente': 'cliente.html', '/sviluppatori': 'sviluppatori.html', '/installatori': 'installatori.html', '/builder': 'builder.html', '/corso': 'corso.html',
  '/mappa': 'mappa.html' };
// le POST che arrivano da fuori (non dalle nostre pagine): si fidano della loro firma, non del biscotto
const DA_FUORI = new Set(['/api/stripe/webhook', '/api/telegram', '/api/solana/pay', '/api/carta/esito', '/api/agente/rapporto', '/api/agente/stato']);
// la cassa incorpora il pagamento di Stripe (Embedded Checkout): solo questa pagina carica il suo script e il suo riquadro
const CSP_CASSA = "default-src 'self'; script-src 'self' https://js.stripe.com; frame-src https://js.stripe.com https://checkout.stripe.com https://hooks.stripe.com; "
  + "img-src 'self' data: https:; connect-src 'self' https://api.stripe.com https://checkout.stripe.com https://*.stripe.com; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; "
  + "form-action 'self' https://checkout.stripe.com";

export function creaApp(cfg, { db, stripe, github, rpc, prezzo, posta = null, chiedi = fetch, chiediBitcoin = null, chiediTron = null, versione = leggiVersione() }) {
  proxyCloudflare(cfg.cloudflare);
  const h = strumenti(cfg), chiave = chiaveSegreta(cfg);
  const notifiche = creaNotifiche({ db, cfg, posta, chiave, chiedi });
  fissaAdmin(db, cfg);
  allineaCanone(db, cfg);   // il canone unico dell'assistenza su tutti i prodotti
  const eAdmin = u => eAdminDi(db, cfg, u);
  const c = {
    cfg, db, stripe, github, rpc, prezzo, posta, chiave, h, notifiche, chiedi, chiediBitcoin, chiediTron, eAdmin,
    lingua: req => linguaDi(req, biscotti(req), cfg.lingua), linguaDi: req => linguaDi(req, biscotti(req), cfg.lingua),
    prelancio: () => { const v = db.prepare("SELECT valore FROM impostazione WHERE chiave = 'prelancio'").get()?.valore; return v === undefined ? cfg.prelancio : v === '1'; },
    canoneMese: () => canoneMese(db, cfg),
    serve: io => { if (!io) throw errore(401, 'Accedi'); if (io.stato !== 'attivo') throw errore(403, 'Il tuo conto è sospeso'); return io; },
    gettoneGithub: io => { const t = io?.sessione_github && decifra(io.sessione_github, chiave); if (!t) throw errore(401, 'Entra con GitHub per collegare i tuoi progetti'); return t; },
    chiudi: g => chiudiSessione(db, g),
    vista: p => ({ id: p.id, slug: p.slug, nome: p.nome, descrizione: p.descrizione, categoria: p.categoria, attivita: (() => { try { return JSON.parse(p.attivita || '[]'); } catch { return []; } })(), guida: p.guida, repo: p.repo, url: p.url, licenza: p.licenza, stelle: p.stelle,
      // prezzo_avvio: il prezzo di riferimento del catalogo (l'installazione la prezza chi vende); prezzo_mese: l'assistenza della
      // piattaforma; percentuale: quella di chi sviluppa sull'installazione, tolta la piattaforma
      prezzo_avvio: p.prezzo_avvio, prezzo_mese: p.prezzo_mese, percentuale: percentualeDi(cfg, p), percentuale_scelta: p.percentuale != null,
      prezzo_aggiornamenti: p.prezzo_aggiornamenti || 0, aggiornamenti_testo: p.aggiornamenti_testo || null, stato: p.stato, nota: p.nota, versione: p.versione || null,
      sito: p.sito || null, demo: p.demo || null,
      // la licenza controllata a mano (tipo aperta o interna, con la spiegazione) e la piattaforma su cui il progetto si appoggia
      licenza_tipo: p.licenza_tipo || 'aperta', licenza_nome: p.licenza_nome || null, licenza_nota: p.licenza_nota || null, licenza_fonte: p.licenza_fonte || null,
      licenza_verificata: p.licenza_verificata || null, base_nome: p.base_nome || null, base_url: p.base_url || null,
      // il programma partner dell'azienda (chi lo offre ne rispetta le condizioni) e il link referral verso i suoi piani a pagamento
      programma: p.programma_url ? { nome: p.programma_nome, url: p.programma_url, termini: p.programma_termini, obbligatorio: !!p.programma_obbligatorio } : null,
      ref: p.ref_url ? { url: p.ref_url, testo: p.ref_testo } : null }),
    nuovoUtente({ nome, email = null, parola = null, github_id = null, github_login = null, zona = '', lingua = cfg.lingua, avatar = null, segnaposto = false }) {
      const codice = nuovoCodice(nome, x => !!db.prepare('SELECT 1 FROM utente WHERE codice = ?').get(x));
      return db.prepare(`INSERT INTO utente (nome, email, parola, github_id, github_login, codice, zona, contratto, lingua, avatar, segnaposto, stato) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(nome, email, parola, github_id, github_login, codice, zona, segnaposto ? '' : new Date().toISOString(), lingua, avatar, segnaposto ? 1 : 0, segnaposto ? 'non_rivendicato' : 'attivo').lastInsertRowid;
    },
    // apre la sessione e risponde (JSON o redirect); se l'accesso arriva da un dispositivo mai visto, un'email di avviso
    entra(req, res, u, { metodo = 'parola', github = null, json = null, stato = 200, dopo = '/area', pulisci = [], nuovo = false } = {}) {
      if (u.stato !== 'attivo') throw errore(403, 'Il tuo conto è sospeso: scrivici se pensi sia un errore');
      const agente = dispositivo(String(req.headers['user-agent'] || '')), ip = ipCorto(ipDi(req));
      const prima = db.prepare('SELECT agente FROM sessione WHERE utente = ?').all(u.id);
      const s = apriSessione(db, u.id, github, { agente, ip, metodo });
      if (!nuovo && prima.length && !prima.some(x => x.agente === agente) && u.email && u.email_verificata)
        notifiche.email(u.email, 'accesso_nuovo', { nome: u.nome, quando: new Date().toLocaleString(u.lingua === 'en' ? 'en-GB' : 'it-IT', { timeZone: 'Europe/Rome' }), dispositivo: agente }, { lingua: u.lingua });
      const biscotti = [h.biscotto('sessione', s.gettone, 30), ...(['it', 'en'].includes(u.lingua) ? [h.biscotto('lingua', u.lingua, 365)] : []), ...pulisci.map(n => h.biscotto(n, '', 0))];
      if (json) return h.rispondi(res, stato, json, { 'set-cookie': biscotti });
      res.writeHead(302, { location: dopo, 'cache-control': 'no-store', 'set-cookie': biscotti }); res.end();
    },
  };
  // i controlli di sicurezza sulle release, prima di annunciarle a chi installa
  c.controlli = creaControlli({ db, cfg, chiedi, notifiche });
  c.seo = creaSeo(c);   // le pagine locali, le alternative, la sitemap
  c.mappa = creaMappa(db, { trattenuta: cfg.trattenuta });   // in quante aziende, e in quali province, gira un programma comprato qui (server/mappa.js)
  c.sincronizzazione = creaSincronizzazione({ db, github, notifiche, cfg, controlli: c.controlli });
  c.sincronizza = id => { const p = db.prepare('SELECT * FROM prodotto WHERE id = ?').get(id); if (p && github?.grezzo) c.sincronizzazione.prodotto(p).catch(e => console.error('sincronizzazione:', e.message)); };

  const rotte = {
    ...rotteConti(c), ...rotteGithub(c), ...rotteMercato(c), ...rotteCrypto(c), ...rotteBonifico(c), ...rotteAcquisto(c), ...rotteIntegrazioni(c), ...rotteAdmin(c), ...rotteStripe(c), ...rotteAssistenza(c), ...rotteCorso(c),
    'GET /api/sessione': async (req, res, { io }) => h.rispondi(res, 200, { dentro: !!io, admin: eAdmin(io), nome: cfg.nome, lingua: c.lingua(req), prelancio: c.prelancio(), carta: !!cfg.stripe.chiave, assistenzaMese: c.canoneMese(),
      ...(io ? { githubAttivo: !!(io.sessione_github && decifra(io.sessione_github, chiave)), utente: { nome: io.nome, avatar: io.avatar, codice: io.codice }, nonLette: db.prepare('SELECT COUNT(*) n FROM notifica WHERE utente = ? AND letta = 0').get(io.id).n } : {}) }),
    'GET /lingue/en.json': async (req, res) => h.rispondi(res, 200, dizionario('en'), { 'cache-control': process.env.NODE_ENV === 'production' ? 'public, max-age=600' : 'no-cache' }),
    'GET /salute': async (req, res) => { db.prepare('SELECT 1').get(); h.rispondi(res, 200, { ok: true, nome: cfg.nome }); },
    // il commit del repository pubblico da cui viene il codice che gira (server/versione.js): lo confronta strumenti/controlla-versione.mjs
    'GET /versione': async (req, res) => h.rispondi(res, 200, { nome: cfg.nome, url: cfg.url, ...versione, repository: cfg.repository || null,
      link: versione.commit && cfg.repository ? `${cfg.repository}/tree/${versione.commit}` : null }),
    // la mappa pubblica: solo conteggi per provincia, gli stessi per tutti, rifatti al massimo ogni venti secondi
    'GET /api/mappa': async (req, res) => h.rispondi(res, 200, c.mappa(), { 'cache-control': `public, max-age=${DURATA_MAPPA}` }),
    'POST /api/fiscale': async (req, res, { io }) => {   // i dati per la comunicazione DAC7: cifrati, li vede solo l'iscritto (e chi prepara la comunicazione)
      c.serve(io); const f = controllaFiscale(await h.json(req));
      db.prepare("UPDATE utente SET fiscale = ?, fiscale_aggiornato = datetime('now') WHERE id = ?").run(cifra(JSON.stringify(f), chiave), io.id);
      h.rispondi(res, 200, { ok: true });
    },
    'GET /api/io': async (req, res, { io }) => {
      c.serve(io);
      if (io.stripe && !io.stripe_pronto && cfg.stripe.chiave) {   // senza il webhook di Connect lo stato del conto si legge qui
        try { const a = await stripe.get(`/v1/accounts/${io.stripe}`); if (a.payouts_enabled && a.details_submitted) { db.prepare('UPDATE utente SET stripe_pronto = 1 WHERE id = ?').run(io.id); io.stripe_pronto = 1; } } catch { }
      }
      const tot = db.prepare('SELECT ruolo, stato, COUNT(*) n, COALESCE(SUM(importo - stornato), 0) c FROM quota WHERE beneficiario = ? GROUP BY ruolo, stato').all(io.id);
      const fiscale = io.fiscale ? JSON.parse(decifra(io.fiscale, chiave) || 'null') : null, anno = new Date().getUTCFullYear();
      const linkDi = p => `${cfg.url}/p/${p.slug}?ref=${io.codice}`;
      // la divisione con chi vende, per le pagine: la parte di chi vende (il resto della percentuale di chi sviluppa, se non c'è accordo),
      // se è concordata, la proposta in sospeso, il livello di chi vende (vendite di quel prodotto) e la parte con il livello
      const accordo = (a, p, inst) => {
        const base = a?.quota ?? quotaDi(db, cfg, p.id, null), l = livelloDi(db, cfg, p.id, inst);
        return { quota: base, concordata: a?.quota != null, accordo: a?.accordo || null, livello: l, quotaLivello: conLivello(base, l.fattore),
          proposta: a?.proposta != null ? { quota: a.proposta, da: a.proposta_da, nota: a.proposta_nota, il: a.proposta_il } : null,
          ...(a?.codice ? { nome: a.nome, codice: a.codice, zona: a.zona, prezzo_avvio: a.prezzo_avvio,
            mance: db.prepare("SELECT COALESCE(SUM(importo), 0) n FROM mancia WHERE da = ? AND a = ? AND stato = 'pagata'").get(io.id, inst).n } : {}) };
      };
      h.rispondi(res, 200, {
        nome: io.nome, email: io.email, emailVerificata: !!io.email_verificata, github: io.github_login, avatar: io.avatar, zona: io.zona, bio: io.bio, sito: io.sito, calendario: io.calendario,
        lingua: io.lingua, codice: io.codice, stato: io.stato, haParola: !!io.parola,
        githubAttivo: !!(io.sessione_github && decifra(io.sessione_github, chiave)), collegato: !!io.stripe, pronto: !!io.stripe_pronto, admin: eAdmin(io),
        owner: db.prepare("SELECT p.id, p.nome, p.slug FROM cotitolare t JOIN prodotto p ON p.id = t.prodotto WHERE t.utente = ? AND t.stato = 'attivo' AND p.builder != ?").all(io.id, io.id)
          .map(p => ({ ...p, quota: titolariDi(db, p.id).altri.find(x => x.utente === io.id)?.quota ?? 0 })),
        sicurezza: {
          dueFattori: !!io.totp, codiciRimasti: io.recupero ? JSON.parse(io.recupero).length : 0,
          passkey: db.prepare('SELECT id, nome, creata, usata, backup_attiva FROM passkey WHERE utente = ? ORDER BY creata').all(io.id),
          sessioni: db.prepare('SELECT substr(token, 1, 12) id, agente, ip, metodo, creata, vista, token = ? attuale FROM sessione WHERE utente = ? AND scade > ? ORDER BY vista DESC')
            .all(io.sessione_token, io.id, new Date().toISOString()).map(s => ({ ...s, attuale: !!s.attuale })),
        },
        preferenze: preferenze(io), telegram: !!io.telegram, discord: !!io.discord, slack: !!io.slack,
        fiscale, dac7: riepilogoDac7(db, io.id, anno, cfg.piattaforma),
        wallet: Object.fromEntries(Object.entries(TIPI).map(([t, x]) => [t, io[x.colonna] || null])), wallet_evm: io.wallet,
        reti: retiAccese(cfg).map(r => ({ id: r.id, nome: r.nome, tipo: r.tipo })), cryptoAttivo: retiAccese(cfg).length > 0,
        corso: { ...livello(db, cfg, io), obbligatorio: cfg.corso.obbligatorio },
        piattaforma: cfg.piattaforma, quotaInstallatore: cfg.quotaInstallatore, quotaInstallatoreAggiornamenti: cfg.quotaInstallatoreAggiornamenti, prezzoMin: cfg.prezzoMin, trattenuta: cfg.trattenuta, categorie: CATEGORIE, prelancio: c.prelancio(), perConto: cfg.stripe.perConto, stripePaese: cfg.stripe.paese,
        percentualeMax: cfg.percentualeMax, livelli: cfg.livelli, assistenzaPiattaforma: cfg.assistenzaPiattaforma, manciaMax: cfg.manciaMax, carta: !!cfg.stripe.chiave,
        piattaformaCrypto: cfg.piattaformaCrypto, stimaStripe: cfg.costoStripe ? cfg.stimaStripe : null, quotaSviluppatoreAssistenza: cfg.quotaSviluppatoreAssistenza,
        prodotti: db.prepare('SELECT * FROM prodotto WHERE builder = ? ORDER BY id DESC').all(io.id).map(p => ({ ...c.vista(p),
          installatori: db.prepare('SELECT COUNT(*) n FROM adozione WHERE prodotto = ?').get(p.id).n, clienti: db.prepare("SELECT COUNT(*) n FROM cliente WHERE prodotto = ? AND stato = 'attivo'").get(p.id).n,
          collaboratori: db.prepare("SELECT github_login login, quota, stato, utente IS NOT NULL iscritto FROM collaboratore WHERE prodotto = ? AND stato != 'uscito'").all(p.id).map(x => ({ ...x, iscritto: !!x.iscritto })),
          // chi lo installa e con quale divisione: 85/15 o l'accordo fra voi due, con le proposte in sospeso
          accordi: db.prepare(`SELECT u.id, u.nome, u.codice, a.zona, a.quota, COALESCE(a.prezzo_avvio, ?) prezzo_avvio, a.accordo, a.proposta, a.proposta_da, a.proposta_nota, a.proposta_il FROM adozione a JOIN utente u ON u.id = a.installatore
            WHERE a.prodotto = ? AND a.installatore != ? ORDER BY a.proposta IS NULL, a.creato`).all(p.prezzo_avvio, p.id, io.id).map(a => accordo(a, p, a.id)),
          badge: `[![${cfg.nome}](${cfg.url}/badge/${p.slug}.svg)](${cfg.url}/p/${p.slug})` })),
        // quello che offre chi vende: il suo prezzo (prezzo_avvio qui è il suo), la sua parte, il suo livello
        adozioni: db.prepare(`SELECT p.*, a.zona AS zona_adozione, a.programma_accettato, COALESCE(a.prezzo_avvio, p.prezzo_avvio) AS mio_prezzo, b.nome AS builder_nome FROM adozione a JOIN prodotto p ON p.id = a.prodotto JOIN utente b ON b.id = p.builder WHERE a.installatore = ? ORDER BY a.creato DESC`).all(io.id)
          .map(p => ({ ...c.vista(p), prezzo_avvio: p.mio_prezzo, zona: p.zona_adozione, link: linkDi(p), clienti: db.prepare("SELECT COUNT(*) n FROM cliente WHERE prodotto = ? AND installatore = ? AND stato = 'attivo'").get(p.id, io.id).n,
            mio: p.builder === io.id, builder: p.builder_nome, programma_accettato: p.programma_accettato || null, manca: manca(db, cfg, io, p),
            ...accordo(db.prepare('SELECT quota, accordo, proposta, proposta_da, proposta_nota, proposta_il FROM adozione WHERE installatore = ? AND prodotto = ?').get(io.id, p.id), p, io.id) })),
        // le mance: quelle ricevute da chi sviluppa i prodotti che vendi
        mance: db.prepare(`SELECT m.importo, m.nota, m.pagata, d.nome da, p.nome prodotto FROM mancia m JOIN utente d ON d.id = m.da LEFT JOIN prodotto p ON p.id = m.prodotto
          WHERE m.a = ? AND m.stato = 'pagata' ORDER BY m.pagata DESC LIMIT 50`).all(io.id),
        collaborazioni: db.prepare(`SELECT c.prodotto, c.quota, c.stato, p.nome, p.slug, b.nome builder FROM collaboratore c JOIN prodotto p ON p.id = c.prodotto JOIN utente b ON b.id = p.builder
          WHERE c.utente = ? AND c.stato IN ('invitato', 'attivo')`).all(io.id),
        totali: tot.map(t => ({ ruolo: t.ruolo, stato: t.stato, n: t.n, centesimi: t.c })),
        quote: db.prepare(`SELECT q.ruolo, q.tipo, q.base, q.frazione, q.importo, q.stornato, q.stato, q.disponibile, q.creato, p.nome prodotto, o.codice ordine, o.custodia, o.sblocco, o.escrow IS NOT NULL AS escrow
          FROM quota q LEFT JOIN prodotto p ON p.id = q.prodotto LEFT JOIN ordine o ON q.fattura LIKE 'cr_%' AND o.codice = substr(q.fattura, 4) AND o.escrow IS NOT NULL
          WHERE q.beneficiario = ? ORDER BY q.id DESC LIMIT 200`).all(io.id).map(q => ({ ...q, escrow: !!q.escrow })),
        // i clienti con lo stato dei pagamenti e dell'assistenza; il codice dell'installazione (chiave) lo vede solo chi installa
        clienti: db.prepare(`SELECT c.*, p.nome prodotto, CASE WHEN c.installatore = ? THEN 'installatore' ELSE 'builder' END ruolo,
            (SELECT COUNT(*) FROM richiesta r WHERE r.cliente = c.chiave AND r.stato != 'risolta') aperte
          FROM cliente c JOIN prodotto p ON p.id = c.prodotto WHERE (c.installatore = ? OR p.builder = ?) AND NOT EXISTS (SELECT 1 FROM cliente v WHERE v.riattivato = c.chiave)
          ORDER BY c.creato DESC LIMIT 200`).all(io.id, io.id, io.id)
          .map(x => {   // un cliente che ha riattivato l'assistenza: la vendita è questa, lo stato è dell'abbonamento nuovo
            const a = x.riattivato ? attuale(db, x) : x, aperte = a === x ? x.aperte : db.prepare("SELECT COUNT(*) n FROM richiesta WHERE cliente = ? AND stato != 'risolta'").get(a.chiave).n;
            return { nome: x.nome, email: x.email, stato: a.stato, creato: x.creato, prodotto: x.prodotto, ruolo: x.ruolo, ...(x.ruolo === 'installatore' ? { chiave: x.chiave } : {}),
              pagamento: a.pagamento, periodo: a.periodo, disdetta: a.disdetta, assistenza: statoAssistenza(a, cfg), aperte, crypto: x.chiave.startsWith('cr_') };
          }),
        assistenzaAperte: db.prepare("SELECT COUNT(*) n FROM richiesta WHERE (? OR installatore = ? OR builder = ?) AND stato = 'aperta'").get(cfg.assistenzaPiattaforma && eAdmin(io) ? 1 : 0, io.id, io.id).n,
        richieste: db.prepare('SELECT k.nome, k.email, k.telefono, k.messaggio, k.creato, p.nome prodotto FROM contatto k LEFT JOIN prodotto p ON p.id = k.prodotto WHERE k.installatore = ? ORDER BY k.id DESC LIMIT 100').all(io.id),
        recensioni: db.prepare(`SELECT r.cliente, r.voto, r.testo, r.autore, r.risposta, r.creata, p.nome prodotto FROM recensione r JOIN prodotto p ON p.id = r.prodotto
          WHERE (r.installatore = ? OR p.builder = ?) AND r.nascosta = 0 ORDER BY r.creata DESC LIMIT 50`).all(io.id, io.id),
        nonLette: db.prepare('SELECT COUNT(*) n FROM notifica WHERE utente = ? AND letta = 0').get(io.id).n,
      });
    },
  };
  // da una rotta all'altra (l'API v1 riusa il catalogo e la pagina prodotto), con intestazioni in più (CORS)
  c.inoltra = (k, req, res, ctx, extra = {}) => { for (const [a, b] of Object.entries(extra)) res.setHeader(a, b); return rotte[k](req, res, ctx); };

  // il giro periodico (lavori.js) cerca da qui i depositi in escrow che il browser non ha segnalato
  gestore.cercaDepositi = quanti => c.cercaDepositi(quanti);
  gestore.controlli = c.controlli;
  gestore.notifiche = notifiche;   // i lavori usano le stesse notifiche: un giro di consegne dei webhook alla volta, non due
  return gestore;
  async function gestore(req, res) {
    const url = new URL(req.url, 'http://x'); const b = biscotti(req); const lingua = linguaDi(req, b, cfg.lingua);
    if (versione.commit) res.setHeader('x-versione', versione.commit);   // su ogni risposta, anche di errore
    // HEAD vale come GET (curl -I, monitor, controlli dei link): stesse intestazioni, e Node non scrive il corpo
    const metodo = req.method === 'HEAD' ? 'GET' : req.method;
    try {
      if (metodo === 'GET' && PAGINE[url.pathname]) return h.pagina(res, PAGINE[url.pathname], { lingua });
      // le pagine per i motori di ricerca (server/seo.js): composte qui; una pagina locale senza installatori è un 404
      const seo = metodo === 'GET' && c.seo.pagina(url.pathname);
      if (seo) return seo.html ? h.html(res, seo.html, { tipo: seo.tipo || '.html' }) : h.pagina(res, '404.html', { lingua, stato: 404, extra: { 'x-robots-tag': 'noindex' } });
      if (metodo === 'GET' && /^\/p\/[a-z0-9-]{1,60}$/.test(url.pathname)) {   // la pagina di un prodotto; il link di un installatore vale 30 giorni
        // uno slug che non esiste è un 404 vero, non la pagina vuota con stato 200 (i motori di ricerca la conterebbero come pagina);
        // chi può vederlo (pubblicato, o il suo builder, o chi gestisce) lo decide l'API, come prima
        if (!db.prepare('SELECT 1 FROM prodotto WHERE slug = ?').get(url.pathname.slice(3))) return h.pagina(res, '404.html', { lingua, stato: 404 });
        // il link di chi installa vale solo quando la pagina si apre davvero (non da un <img> nascosto in un README)
        const ref = url.searchParams.get('ref'), dest = req.headers['sec-fetch-dest'], apertura = !dest || dest === 'document';
        return h.pagina(res, 'prodotto.html', { lingua, extra: apertura && ref && /^[a-z0-9-]{3,40}$/.test(ref) ? { 'set-cookie': h.biscotto('ref', ref, 30) } : {} });
      }
      if (metodo === 'GET' && /^\/u\/[a-z0-9-]{3,40}$/.test(url.pathname)) {   // il profilo pubblico: solo di chi esiste ed è attivo, altrimenti 404
        if (!db.prepare("SELECT 1 FROM utente WHERE codice = ? AND stato = 'attivo'").get(url.pathname.slice(3))) return h.pagina(res, '404.html', { lingua, stato: 404 });
        return h.pagina(res, 'profilo.html', { lingua });
      }
      // la pagina di assistenza di un'installazione (dalla bolla, dal link salvato, dal QR) e il suo manifest: si installa come app
      const as = metodo === 'GET' && url.pathname.match(/^\/assistenza\/([A-Za-z0-9_-]{24})(\/manifest\.webmanifest|\/bolla\.sh)?$/);
      if (as && CODICE.test(as[1])) {
        if (!as[2]) return h.pagina(res, 'assistenza.html', { lingua, extra: { 'x-robots-tag': 'noindex, nofollow', 'cache-control': 'no-store' } });
        const p = db.prepare('SELECT p.nome, p.repo, p.categoria FROM cliente c JOIN prodotto p ON p.id = c.prodotto WHERE c.assistenza = ?').get(as[1]);
        if (!p) return h.rispondi(res, 404, { errore: 'Link di assistenza non valido' });
        // lo script del tasto «Inietta»: la bolla di questa installazione dentro Nginx, sul server del cliente (lo lancia chi installa)
        if (as[2] === '/bolla.sh') {
          res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'x-content-type-options': 'nosniff' });
          return res.end(scriptBolla(cfg, as[1], p, { lingua }));
        }
        return h.rispondi(res, 200, { name: `${lingua === 'en' ? 'Support' : 'Assistenza'} ${p.nome}`, short_name: lingua === 'en' ? 'Support' : 'Assistenza', lang: lingua,
          start_url: `/assistenza/${as[1]}`, scope: `/assistenza/${as[1]}`, display: 'standalone', background_color: '#F4F0FF', theme_color: '#7B3DFF',
          icons: [{ src: '/img/assistenza-192.png', sizes: '192x192', type: 'image/png' }, { src: '/img/assistenza-512.png', sizes: '512x512', type: 'image/png' }, { src: '/icona.svg', sizes: 'any', type: 'image/svg+xml' }] },
          { 'content-type': 'application/manifest+json; charset=utf-8' });
      }
      // la cassa di un prodotto e la pagina d'installazione di un acquisto (il codice nel link è il segreto: niente motori di ricerca)
      if (metodo === 'GET' && /^\/compra\/[a-z0-9-]{1,60}$/.test(url.pathname)) {
        if (!db.prepare("SELECT 1 FROM prodotto WHERE slug = ? AND stato = 'pubblicato'").get(url.pathname.slice(8))) return h.pagina(res, '404.html', { lingua, stato: 404 });
        return h.pagina(res, 'compra.html', { lingua, extra: { 'content-security-policy': CSP_CASSA, 'cache-control': 'no-store',
          'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(self "https://js.stripe.com" "https://checkout.stripe.com")' } });
      }
      const ins = metodo === 'GET' && url.pathname.match(/^\/installa\/([A-Za-z0-9_-]{24})$/);
      if (ins) return h.pagina(res, 'installa.html', { lingua, extra: { 'x-robots-tag': 'noindex, nofollow', 'cache-control': 'no-store' } });
      const io = utenteDaSessione(db, b.sessione);
      let k = `${metodo} ${url.pathname}`;
      // lo script d'installazione (curl … /i/<codice>.sh | sudo bash) e i passi che racconta dal server del cliente
      const sh = url.pathname.match(/^\/i\/([A-Za-z0-9_-]{24})\.sh$/);
      if (sh && metodo === 'GET') { url.searchParams.set('k', sh[1]); k = 'GET /api/installa/script'; }
      else if (metodo === 'POST' && /^\/api\/installa\/[A-Za-z0-9_-]{24}\/stato$/.test(url.pathname) && CODICE_ACQUISTO.test(url.pathname.split('/')[3])) k = 'POST /api/installa/stato';
      if (url.pathname.startsWith('/api/v1')) k = metodo === 'OPTIONS' ? 'OPTIONS /api/v1' : `${metodo} /api/v1`;
      else if (url.pathname.startsWith('/badge/')) k = 'GET /badge';
      else if (url.pathname.startsWith('/api/carta/ritorno/')) k = `${metodo} /api/carta/ritorno`;   // il ritorno dalla cassa della banca: arriva da lei
      const fn = rotte[k];
      if (fn) {
        if (req.method === 'POST' && !DA_FUORI.has(url.pathname) && k !== 'POST /api/carta/ritorno' && k !== 'POST /api/installa/stato' && !h.stessaOrigine(req)) return h.rispondi(res, 403, { errore: 'origine non permessa' });
        return await fn(req, res, { io, url, b, lingua });
      }
      if (metodo === 'GET' && /^\/[a-z0-9/_.-]+\.(css|js|json|woff2|svg|png|webp|jpg|ico|txt|webmanifest)$/i.test(url.pathname) && !url.pathname.includes('..')) return h.pagina(res, url.pathname.slice(1), { lingua });
      if (metodo === 'GET' && !url.pathname.startsWith('/api/')) return h.pagina(res, '404.html', { lingua, stato: 404 });
      h.rispondi(res, 404, { errore: h.traduci('Non trovato', lingua) });
    } catch (e) {
      if (!res.headersSent) {
        if (url.pathname.startsWith('/auth/')) return h.vai(res, '/accedi?errore=github');
        const cors = url.pathname.startsWith('/api/v1') ? { 'access-control-allow-origin': '*' } : {};
        h.rispondi(res, e.stato || 500, { errore: e.stato ? h.traduci(e.message, lingua) : h.traduci('Errore interno: riprova fra poco', lingua) }, cors);
      }
      if (!e.stato) console.error(e);
    }
  };
}

