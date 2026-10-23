// La cassa e l'installazione. La cassa (/compra/<slug>) crea l'acquisto: chi installa, la tua attività, dove gira il programma,
// l'assistenza; poi il pagamento (Stripe incorporato nella pagina, o bonifico e crypto con i loro pannelli). La pagina
// /installa/<codice> segue il cliente dopo: il comando che installa da solo (server/installa.js) con l'avanzamento in diretta,
// oppure l'appuntamento con chi installa; la personalizzazione che chi installa spunta voce per voce; le perizie a distanza, che il
// titolare accetta o rifiuta; la conferma che tutto funziona (conta per i livelli di chi vende: i soldi con carta partono comunque dopo la
// trattenuta). Il codice dell'acquisto è il segreto della pagina (come il link
// dell'assistenza): lo riceve per email chi ha pagato.
import { randomBytes, createHash } from 'node:crypto';
import { errore, emailValida, testo, ipDi } from '../http.js';
import { troppiTentativi } from '../conti.js';
import { filtroAbilitati } from '../corso.js';
import { conAggiornamenti, prezzoAvvioDi, avvisaLivello, sviluppatoreAssente } from '../soldi.js';
import { VOCI, STATI_VOCE, PASSI, CODICE_ACQUISTO, comandoInstalla, scriptInstalla } from '../installa.js';

const DOVE = ['mio', 'installatore', 'insieme'];
const TIPI_PERIZIA = ['diagnosi', 'accesso'];
const hash = t => createHash('sha256').update(String(t)).digest('hex');
const leggi = (s, d) => { try { return JSON.parse(s || ''); } catch { return d; } };
// una chiave SSH pubblica, su una riga: tipo, base64, commento facoltativo
const CHIAVE_SSH = /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com) [A-Za-z0-9+/=]{40,1000}( [^\r\n]{0,100})?$/;

export function rotteAcquisto(c) {
  const { cfg, db, h, notifiche } = c;
  const nuovoCodice = () => randomBytes(18).toString('base64url');
  const acquistoDi = k => CODICE_ACQUISTO.test(String(k || '')) ? db.prepare('SELECT * FROM acquisto WHERE codice = ?').get(String(k)) : null;
  const serveAcquisto = k => { const a = acquistoDi(k); if (!a) throw errore(404, 'Acquisto non trovato: apri il link che ti abbiamo mandato per email'); return a; };
  const tocca = id => db.prepare("UPDATE acquisto SET aggiornato = datetime('now') WHERE id = ?").run(id);
  const prodottoDi = id => db.prepare('SELECT * FROM prodotto WHERE id = ?').get(id);
  const pagato = a => ['pagato', 'in_arrivo'].includes(a.stato);
  const linkPagina = a => `${cfg.url}/installa/${a.codice}`;

  // chi può vendere questo prodotto: le stesse regole della pagina prodotto (corso, esperienza, programma partner)
  function installatoreDi(p, codice) {
    const ab = filtroAbilitati(cfg, p);
    return db.prepare(`SELECT u.* FROM adozione a JOIN utente u ON u.id = a.installatore WHERE a.prodotto = ? AND u.codice = ? AND u.stato = 'attivo'
      AND (? = 0 OR a.programma_accettato IS NOT NULL)${ab.sql}`).get(p.id, String(codice || ''), p.programma_obbligatorio ? 1 : 0, ...ab.par);
  }

  // la vista dell'acquisto per la pagina d'installazione (al titolare) e per l'area di chi installa
  // l'ordine aperto con bonifico o crypto, per la pagina d'installazione (niente carta di nuovo mentre si aspetta il bonifico)
  function ordineAperto(a) {
    if (a.metodo === 'crypto' && String(a.sessione || '').startsWith('cr:')) {
      const o = db.prepare("SELECT codice FROM ordine WHERE codice = ? AND stato = 'aperto'").get(a.sessione.slice(3));
      return o ? { metodo: 'crypto', codice: o.codice } : null;
    }
    const b = db.prepare("SELECT codice FROM bonifico WHERE acquisto = ? AND stato = 'aperto' ORDER BY id DESC LIMIT 1").get(a.codice);
    return b ? { metodo: 'bonifico', codice: b.codice } : null;
  }
  function vista(a, { perInstallatore = false } = {}) {
    const p = prodottoDi(a.prodotto), i = db.prepare('SELECT nome, codice, avatar, zona, calendario FROM utente WHERE id = ?').get(a.installatore);
    const cl = a.cliente ? db.prepare('SELECT chiave, confermato, pagamento, stato FROM cliente WHERE chiave = ?').get(a.cliente) : null;
    const pers = leggi(a.personalizza, {}), l = a.lingua === 'en' ? 'en' : 'it';
    // il rapporto di una diagnosi lo vedono tutti e due: chi installa per capire, il titolare per sapere cosa è uscito dal suo server
    const perizie = db.prepare(`SELECT p.id, p.tipo, p.motivo, p.ore, p.stato, p.chiesta, p.decisa, p.scade, p.finita, p.ip, p.rapporto, u.nome chi
      FROM perizia p LEFT JOIN utente u ON u.id = p.chi WHERE p.acquisto = ? ORDER BY p.id DESC LIMIT 20`).all(a.id)
      .map(({ ip, ...x }) => ({ ...x, ...(x.tipo === 'accesso' && x.stato === 'in_corso' && perInstallatore && ip ? { ssh: `ssh repobay-supporto@${ip}` } : {}) }));
    return {
      codice: perInstallatore ? undefined : a.codice, id: a.id, stato: a.stato, metodo: a.metodo, dove: a.dove, dominio: a.dominio, periodo: a.periodo,
      attivita: a.attivita, nome: a.nome, email: a.email, telefono: a.telefono, aggiornamenti: !!a.aggiornamenti, lingua: l, creato: a.creato, aggiornato: a.aggiornato,
      prodotto: { nome: p.nome, slug: p.slug, repo: p.repo, descrizione: p.descrizione, url: p.url },
      installatore: i,
      installazione: a.installazione, passi: leggi(a.passi, []), indirizzo: a.indirizzo, ordinePassi: PASSI, cartella: `/opt/repobay/${p.slug}`,
      comando: pagato(a) ? comandoInstalla(cfg, a.codice) : null,
      agente: { installato: !!a.agente, visto: a.agente_visto || null },
      personalizza: VOCI.map(v => ({ k: v.k, testo: v[l], stato: STATI_VOCE.includes(pers[v.k]) ? pers[v.k] : 'da_fare' })),
      appuntamento: leggi(a.appuntamento, null), perizie,
      confermato: a.confermato || cl?.confermato || null, pagamento: cl?.pagamento || null, trattenuta: cfg.trattenuta,
      ordine: pagato(a) || perInstallatore ? null : ordineAperto(a),
    };
  }

  // la perizia accettata più vicina alla scadenza è ancora valida? (le scadute le chiude chi passa di qui)
  function chiudiScadute(acquisto) {
    db.prepare(`UPDATE perizia SET stato = 'scaduta', finita = COALESCE(finita, datetime('now')) WHERE acquisto = ? AND stato IN ('accettata', 'in_corso') AND tipo = 'accesso' AND scade <= ?`)
      .run(acquisto, new Date().toISOString());
    // una diagnosi accettata che l'agente non ha mai raccolto, dopo un giorno, non resta aperta per sempre
    db.prepare(`UPDATE perizia SET stato = 'scaduta', finita = datetime('now') WHERE acquisto = ? AND tipo = 'diagnosi' AND stato = 'accettata' AND decisa <= datetime('now', '-1 day')`).run(acquisto);
  }

  function agenteDi(req) {
    const t = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!/^[A-Za-z0-9_-]{32,64}$/.test(t)) throw errore(401, 'gettone mancante');
    const a = db.prepare('SELECT * FROM acquisto WHERE agente = ? OR agente_prec = ?').get(hash(t), hash(t)); if (!a) throw errore(401, 'gettone non valido');
    return a;
  }

  // si può pagare questo prodotto adesso? (prelancio spento, e un progetto non rivendicato solo se a uso interno o con i pagamenti accesi)
  const pagabile = p => !c.prelancio() && !(p.segnaposto && !cfg.nonRivendicatiPagamenti && !sviluppatoreAssente(db, p.id));
  // le prenotazioni: quando i pagamenti si aprono (prelancio spento, progetto rivendicato) chi aveva prenotato riceve il link per pagare
  c.avvisaPrenotati = (prodotto = null) => {
    let n = 0;
    for (const a of db.prepare(`SELECT a.*, p.slug, p.nome prodotto_nome, u.segnaposto, i.nome installatore_nome FROM acquisto a JOIN prodotto p ON p.id = a.prodotto
        JOIN utente u ON u.id = p.builder JOIN utente i ON i.id = a.installatore WHERE a.stato = 'prenotato' AND (? IS NULL OR a.prodotto = ?) LIMIT 500`).all(prodotto, prodotto)) {
      if (!pagabile({ id: a.prodotto, segnaposto: a.segnaposto })) continue;
      if (!db.prepare("UPDATE acquisto SET stato = 'aperto', aggiornato = datetime('now') WHERE id = ? AND stato = 'prenotato'").run(a.id).changes) continue;
      notifiche.email(a.email, 'pagamenti_aperti', { nome: a.nome || '', prodotto: a.prodotto_nome, installatore: a.installatore_nome, link: `${cfg.url}/compra/${a.slug}?a=${a.codice}` }, { lingua: a.lingua || 'it' }).catch(() => {});
      n++;
    }
    return n;
  };

  return {
    // ---------------- la cassa ----------------
    // l'acquisto, prima del pagamento: chi installa, chi compra, dove gira. Nel prelancio (o sui progetti che prendono solo
    // preventivi) diventa una prenotazione: chi installa riceve la richiesta e il cliente un'email quando si può pagare
    'POST /api/acquisto': async (req, res, { lingua }) => {
      if (troppiTentativi(`aq:${ipDi(req)}`, Date.now(), 20, 10 * 60e3)) throw errore(429, 'Troppe richieste: riprova fra qualche minuto');
      const x = await h.json(req);
      if (x.sito_web) return h.rispondi(res, 200, { ok: true });   // il campo trappola
      const p = db.prepare(`SELECT p.*, u.segnaposto FROM prodotto p JOIN utente u ON u.id = p.builder WHERE p.slug = ? AND p.stato = 'pubblicato' AND u.stato IN ('attivo', 'non_rivendicato')`).get(String(x.prodotto || ''));
      if (!p) throw errore(404, 'Prodotto non trovato');
      const i = installatoreDi(p, x.installatore); if (!i) throw errore(400, 'Scegli chi viene a installarlo');
      const email = String(x.email || '').trim().toLowerCase(), nome = testo(x.nome, 80), attivita = testo(x.attivita, 100) || null, tel = testo(x.telefono, 30) || null;
      if (nome.length < 2) throw errore(400, 'Scrivi il tuo nome');
      if (!emailValida(email)) throw errore(400, 'Email non valida: ti mandiamo lì la ricevuta e il link per installare');
      if (i.email && i.email.toLowerCase() === email) throw errore(400, 'Questa è l\'email di chi installa: un\'installazione non si compra da se stessi');
      if (x.privacy !== true) throw errore(400, 'Per continuare conferma di aver letto le condizioni e l\'informativa privacy');
      const dove = DOVE.includes(x.dove) ? x.dove : 'mio';
      const dominio = String(x.dominio || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      if (dominio && !/^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(dominio)) throw errore(400, 'Il dominio non sembra giusto: scrivilo come pizzeriadamario.it, oppure lascialo vuoto');
      const periodo = x.periodo === 'anno' ? 'anno' : 'mese', agg = x.aggiornamenti === true && conAggiornamenti(p);
      const solo = !pagabile(p);   // nel prelancio, o su un progetto non rivendicato con i pagamenti spenti (non quelli a uso interno)
      const codice = nuovoCodice();
      db.prepare(`INSERT INTO acquisto (codice, prodotto, installatore, attivita, nome, email, telefono, dominio, dove, periodo, aggiornamenti, lingua, stato)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(codice, p.id, i.id, attivita, nome, email, tel, dominio || null, dove, periodo, agg ? 1 : 0, lingua, solo ? 'prenotato' : 'aperto');
      if (solo) {
        const m = [`Vuole ${p.nome}${attivita ? ` per ${attivita}` : ''}.`, dominio ? `Dominio: ${dominio}.` : '', dove === 'mio' ? 'Ha già un server o un computer dove installarlo.' : dove === 'installatore' ? 'Non ha un server: chiede a te di preparare tutto.' : 'Vuole decidere con te dove installarlo.'].filter(Boolean).join(' ');
        notifiche.notifica(i.id, 'installazione.messaggio', { da: nome, email, messaggio: tel ? `${m}\n\nTelefono: ${tel}` : m, prodotto: p.nome });
        // anche a chi ha prenotato: la pagina della prenotazione, e quando si potrà pagare arriva un'altra email con il link
        notifiche.email(email, 'prenotazione', { nome, prodotto: p.nome, installatore: i.nome, link: linkPagina({ codice }) }, { lingua }).catch(() => {});
      }
      h.rispondi(res, 200, { codice, prenotato: solo, prezzo: prezzoAvvioDi(db, p.id, i.id) });
    },
    // il pagamento con carta, Apple Pay, Google Pay o SEPA: la sessione di Checkout dell'acquisto. Con la chiave pubblicabile la
    // pagina la incorpora (client_secret), senza si va sulla pagina di Stripe e si torna su /installa
    'POST /api/acquisto/paga': async (req, res) => {
      if (c.prelancio()) throw errore(503, 'I pagamenti non sono ancora aperti: la tua prenotazione è registrata');
      if (!cfg.stripe.chiave) throw errore(503, 'I pagamenti con carta non sono attivi: paga con bonifico o in crypto');
      if (troppiTentativi(`co:${ipDi(req)}`, Date.now(), 20, 10 * 60e3)) throw errore(429, 'Troppe richieste: riprova fra qualche minuto');
      const x = await h.json(req), a = serveAcquisto(x.codice);
      if (pagato(a)) return h.rispondi(res, 200, { fatto: true, pagina: `/installa/${a.codice}` });
      const p = prodottoDi(a.prodotto), i = db.prepare('SELECT codice FROM utente WHERE id = ?').get(a.installatore);
      const s = await c.sessioneCheckout(req, { prodotto: p.slug, installatore: i.codice, periodo: a.periodo, aggiornamenti: !!a.aggiornamenti, acquisto: a.codice, email: a.email });
      db.prepare("UPDATE acquisto SET sessione = ?, metodo = 'carta', aggiornato = datetime('now') WHERE id = ?").run(s.id, a.id);
      h.rispondi(res, 200, s.client_secret ? { client_secret: s.client_secret, pubblica: cfg.stripe.pubblica } : { url: s.url });
    },

    // ---------------- la pagina d'installazione ----------------
    'GET /api/installa': async (req, res, { url }) => {
      const a = serveAcquisto(url.searchParams.get('k')); chiudiScadute(a.id);
      h.rispondi(res, 200, vista(acquistoDi(a.codice)), { 'cache-control': 'no-store' });
    },
    // dove gira: si può cambiare idea finché non è installato
    'POST /api/installa/dove': async (req, res) => {
      const x = await h.json(req), a = serveAcquisto(x.k);
      if (!DOVE.includes(x.dove)) throw errore(400, 'Scegli dove installarlo');
      if (a.installazione === 'online') throw errore(400, 'È già installato');
      db.prepare("UPDATE acquisto SET dove = ?, aggiornato = datetime('now') WHERE id = ?").run(x.dove, a.id);
      h.rispondi(res, 200, { ok: true });
    },
    // l'appuntamento con chi installa: i momenti che vanno bene al cliente e due righe; chi installa lo riceve come messaggio
    'POST /api/installa/appuntamento': async (req, res) => {
      const x = await h.json(req), a = serveAcquisto(x.k);
      if (troppiTentativi(`ap:${a.id}`, Date.now(), 5, 60 * 60e3)) throw errore(429, 'Hai già mandato la richiesta: chi installa ti risponde a breve');
      const quando = (Array.isArray(x.quando) ? x.quando : []).map(q => testo(q, 40)).filter(Boolean).slice(0, 6), nota = testo(x.nota ?? '', 600) || null, motivo = ['installa', 'personalizza', 'aiuto'].includes(x.motivo) ? x.motivo : 'installa';
      if (!quando.length) throw errore(400, 'Scegli almeno un momento che ti va bene');
      db.prepare("UPDATE acquisto SET appuntamento = ?, aggiornato = datetime('now') WHERE id = ?").run(JSON.stringify({ quando, nota, motivo, il: new Date().toISOString() }), a.id);
      const p = prodottoDi(a.prodotto), cosa = { installa: 'installarlo', personalizza: 'personalizzarlo', aiuto: 'finire l\'installazione' }[motivo];
      notifiche.notifica(a.installatore, 'installazione.messaggio', { da: a.nome || a.email, email: a.email, prodotto: p.nome,
        messaggio: `Ti chiede un appuntamento per ${cosa}. Va bene: ${quando.join(', ')}.${nota ? `\n\n${nota}` : ''}${a.telefono ? `\n\nTelefono: ${a.telefono}` : ''}\n\nLa sua installazione: ${cfg.url}/area#installazioni` });
      h.rispondi(res, 200, { ok: true });
    },
    // tutto funziona: come la conferma dall'area clienti, sblocca i soldi di chi ha installato e di chi sviluppa
    'POST /api/installa/conferma': async (req, res) => {
      const a = serveAcquisto((await h.json(req)).k);
      if (!pagato(a) || !a.cliente) throw errore(400, 'L\'installazione si conferma dopo il pagamento');
      if (!a.confermato) {
        db.prepare("UPDATE acquisto SET confermato = datetime('now'), aggiornato = datetime('now') WHERE id = ?").run(a.id);
        const n = db.prepare("UPDATE cliente SET confermato = datetime('now') WHERE chiave = ? AND confermato IS NULL").run(a.cliente).changes;
        const p = prodottoDi(a.prodotto);
        if (n) for (const u of new Set([a.installatore, p.builder].filter(Boolean))) notifiche.notifica(u, 'installazione.confermata', { prodotto: p.nome, slug: p.slug, cliente: a.nome });
        if (n) avvisaLivello(db, cfg, notifiche.notifica, a.prodotto, a.installatore);
      }
      h.rispondi(res, 200, { ok: true });
    },
    // il titolare risponde a una perizia: sì o no. Un accesso accettato dura le ore chieste, da adesso
    'POST /api/installa/perizia': async (req, res) => {
      const x = await h.json(req), a = serveAcquisto(x.k);
      const pz = db.prepare("SELECT * FROM perizia WHERE id = ? AND acquisto = ? AND stato = 'chiesta'").get(Number(x.id), a.id);
      if (!pz) throw errore(404, 'Richiesta non trovata, o già decisa');
      const si = x.si === true, scade = pz.tipo === 'accesso' ? new Date(Date.now() + pz.ore * 3600e3).toISOString() : null;
      db.prepare("UPDATE perizia SET stato = ?, decisa = datetime('now'), scade = ? WHERE id = ?").run(si ? 'accettata' : 'rifiutata', si ? scade : null, pz.id); tocca(a.id);
      const p = prodottoDi(a.prodotto);
      if (pz.chi) notifiche.notifica(pz.chi, 'installazione.messaggio', { da: a.nome || a.email, email: a.email, prodotto: p.nome,
        messaggio: si ? (pz.tipo === 'accesso' ? `Ha accettato l'accesso al server per ${pz.ore} ore: l'agente lo apre entro un minuto. Trovi il comando SSH nell'area, alla voce Installazioni.` : 'Ha accettato la diagnosi: il rapporto arriva nell\'area entro un minuto.')
          : `Ha rifiutato la ${pz.tipo === 'accesso' ? 'richiesta di accesso' : 'diagnosi'}.` });
      h.rispondi(res, 200, { ok: true });
    },
    // il titolare chiude un accesso prima della scadenza: l'agente toglie la chiave al giro dopo (entro un minuto)
    'POST /api/installa/perizia/revoca': async (req, res) => {
      const x = await h.json(req), a = serveAcquisto(x.k);
      const n = db.prepare("UPDATE perizia SET stato = 'revocata', finita = datetime('now') WHERE id = ? AND acquisto = ? AND stato IN ('accettata', 'in_corso')").run(Number(x.id), a.id).changes;
      if (!n) throw errore(404, 'Non c\'è un accesso aperto con questo numero');
      tocca(a.id); h.rispondi(res, 200, { ok: true });
    },

    // ---------------- lo script e l'agente (dal server del cliente) ----------------
    // lo script dell'installazione: ogni volta un gettone nuovo per l'agente (vale l'ultimo script lanciato)
    'GET /api/installa/script': async (req, res, { url }) => {
      const a = acquistoDi(url.searchParams.get('k'));
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'x-content-type-options': 'nosniff' });
      if (!a) return res.end('#!/bin/sh\necho "Link di installazione non valido: aprilo dalla pagina del tuo acquisto."\nexit 1\n');
      if (!pagato(a)) return res.end(`#!/bin/sh\necho "Il pagamento non è ancora arrivato: riprova dalla pagina ${linkPagina(a)}"\nexit 1\n`);
      if (req.method === 'HEAD') return res.end();   // un'occhiata (anteprime, controlli dei link): niente gettone nuovo
      const gettone = randomBytes(32).toString('base64url');
      db.prepare("UPDATE acquisto SET agente_prec = COALESCE(agente, agente_prec), agente = ?, aggiornato = datetime('now') WHERE id = ?").run(hash(gettone), a.id);
      res.end(scriptInstalla(cfg, a, prodottoDi(a.prodotto), gettone));
    },
    // lo script racconta un passo: avvio, docker, agente, scarico, configuro, accendo, online o errore
    'POST /api/installa/stato': async (req, res, { url }) => {
      const a = acquistoDi(url.pathname.split('/')[3]); if (!a || !pagato(a)) throw errore(404, 'Acquisto non trovato');
      if (troppiTentativi(`is:${a.id}`, Date.now(), 120, 60 * 60e3)) throw errore(429, 'troppi passi');
      const x = await h.json(req), passo = [...PASSI, 'errore'].includes(x.passo) ? x.passo : null; if (!passo) throw errore(400, 'passo sconosciuto');
      const passi = leggi(a.passi, []).slice(-40); passi.push({ passo, testo: testo(x.testo ?? '', 300) || null, il: new Date().toISOString() });
      const porta = Number(x.porta) > 0 && Number(x.porta) < 65536 ? Number(x.porta) : null, ip = ipDi(req);
      const stato = passo === 'online' ? 'online' : passo === 'errore' ? 'errore' : 'in_corso';
      const indirizzo = passo === 'online' ? (porta ? `http://${ip.includes(':') ? `[${ip}]` : ip}:${porta}` : a.dominio ? `https://${a.dominio}` : null) : a.indirizzo;
      db.prepare("UPDATE acquisto SET passi = ?, installazione = ?, indirizzo = ?, ip = ?, aggiornato = datetime('now') WHERE id = ?").run(JSON.stringify(passi), stato, indirizzo, ip, a.id);
      if (passo === 'agente') db.prepare('UPDATE acquisto SET agente_prec = NULL WHERE id = ?').run(a.id);   // l'agente nuovo è su: il gettone di prima non serve più
      // il programma che ora risponde è anche quello che il monitoraggio controlla (se chi installa non ha messo un indirizzo suo)
      if (passo === 'online' && a.cliente && indirizzo) db.prepare('UPDATE cliente SET sito = COALESCE(sito, ?) WHERE chiave = ?').run(indirizzo, a.cliente);
      if (passo === 'online' || passo === 'errore') {
        const p = prodottoDi(a.prodotto);
        notifiche.notifica(a.installatore, 'installazione.messaggio', { da: a.nome || a.email, email: a.email, prodotto: p.nome,
          messaggio: passo === 'online' ? `${p.nome} è installato e risponde${indirizzo ? ` su ${indirizzo}` : ''}, con le impostazioni predefinite. Ora tocca a te personalizzarlo con il cliente: ${cfg.url}/area#installazioni`
            : `L'installazione automatica di ${p.nome} si è fermata: ${testo(x.testo ?? '', 300) || 'errore sconosciuto'}. Il cliente aspetta il tuo aiuto: ${cfg.url}/area#installazioni` });
      }
      h.rispondi(res, 200, { ok: true });
    },
    // l'agente chiede cosa fare: righe di testo (diagnosi <id> / accesso <id> <scade> <chiave in base64> / revoca <id>)
    'GET /api/agente': async (req, res) => {
      const a = agenteDi(req); chiudiScadute(a.id);
      db.prepare("UPDATE acquisto SET agente_visto = datetime('now') WHERE id = ?").run(a.id);
      const righe = [];
      for (const pz of db.prepare("SELECT * FROM perizia WHERE acquisto = ? AND (stato IN ('accettata', 'in_corso') OR (stato IN ('revocata', 'scaduta') AND tipo = 'accesso' AND ip IS NOT NULL AND rapporto IS NULL))").all(a.id)) {
        if (pz.tipo === 'diagnosi' && pz.stato === 'accettata') righe.push(`diagnosi ${pz.id}`);
        else if (pz.tipo === 'accesso' && pz.stato === 'accettata') righe.push(`accesso ${pz.id} ${Math.floor(new Date(pz.scade).getTime() / 1000)} ${Buffer.from(pz.chiave || '').toString('base64')}`);
        else if (pz.tipo === 'accesso' && ['revocata', 'scaduta'].includes(pz.stato)) righe.push(`revoca ${pz.id}`);
      }
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }); res.end(righe.join('\n') + (righe.length ? '\n' : ''));
    },
    'POST /api/agente/rapporto': async (req, res, { url }) => {
      const a = agenteDi(req), id = Number(url.searchParams.get('id'));
      const pz = db.prepare("SELECT * FROM perizia WHERE id = ? AND acquisto = ? AND tipo = 'diagnosi' AND stato = 'accettata'").get(id, a.id); if (!pz) throw errore(404, 'perizia non trovata');
      const t = (await h.corpoGrezzo(req, 320 * 1024)).toString('utf8').slice(0, 300000);
      db.prepare("UPDATE perizia SET rapporto = ?, stato = 'fatta', finita = datetime('now'), ip = ? WHERE id = ?").run(t, ipDi(req), pz.id); tocca(a.id);
      if (pz.chi) notifiche.notifica(pz.chi, 'installazione.messaggio', { da: a.nome || a.email, email: a.email, prodotto: prodottoDi(a.prodotto).nome, messaggio: `Il rapporto della diagnosi è pronto: ${cfg.url}/area#installazioni` });
      h.rispondi(res, 200, { ok: true });
    },
    // l'agente racconta: accesso aperto (in_corso, con la porta SSH) o chiuso (fatta)
    'POST /api/agente/stato': async (req, res, { url }) => {
      const a = agenteDi(req), id = Number(url.searchParams.get('id')), s = url.searchParams.get('stato');
      const porta = Number(url.searchParams.get('porta')) || 22, ip = ipDi(req);
      if (s === 'in_corso') db.prepare("UPDATE perizia SET stato = 'in_corso', ip = ? WHERE id = ? AND acquisto = ? AND stato = 'accettata'").run(porta === 22 ? ip : `${ip} -p ${porta}`, id, a.id);
      else if (s === 'fatta') db.prepare("UPDATE perizia SET rapporto = COALESCE(rapporto, 'chiave tolta dal server'), finita = COALESCE(finita, datetime('now')) WHERE id = ? AND acquisto = ? AND stato IN ('revocata', 'scaduta')").run(id, a.id);
      tocca(a.id); h.rispondi(res, 200, { ok: true });
    },

    // ---------------- l'area di chi installa ----------------
    'GET /api/area/installazioni': async (req, res, { io }) => {
      c.serve(io);
      const tutti = c.eAdmin(io) && cfg.assistenzaPiattaforma;
      const l = db.prepare(`SELECT * FROM acquisto WHERE (installatore = ? OR ?) AND stato != 'aperto' ORDER BY aggiornato DESC LIMIT 100`).all(io.id, tutti ? 1 : 0);
      for (const a of l) chiudiScadute(a.id);
      h.rispondi(res, 200, { installazioni: l.map(a => vista(acquistoDi(a.codice), { perInstallatore: true })) });
    },
    // chi installa segna una voce della personalizzazione: da fare, in corso, fatto
    'POST /api/area/installazioni/voce': async (req, res, { io }) => {
      c.serve(io); const x = await h.json(req);
      const a = db.prepare('SELECT * FROM acquisto WHERE id = ? AND (installatore = ? OR ?)').get(Number(x.id), io.id, c.eAdmin(io) && cfg.assistenzaPiattaforma ? 1 : 0); if (!a) throw errore(404, 'Installazione non trovata');
      if (!VOCI.some(v => v.k === x.voce) || !STATI_VOCE.includes(x.stato)) throw errore(400, 'Voce o stato sconosciuti');
      const pers = leggi(a.personalizza, {}); pers[x.voce] = x.stato;
      db.prepare("UPDATE acquisto SET personalizza = ?, aggiornato = datetime('now') WHERE id = ?").run(JSON.stringify(pers), a.id);
      h.rispondi(res, 200, { ok: true });
    },
    // chi installa chiede una perizia: il titolare la vede sulla sua pagina (e per email) e decide lui
    'POST /api/area/perizia': async (req, res, { io }) => {
      c.serve(io); const x = await h.json(req);
      const a = db.prepare('SELECT * FROM acquisto WHERE id = ? AND (installatore = ? OR ?)').get(Number(x.id), io.id, c.eAdmin(io) ? 1 : 0); if (!a) throw errore(404, 'Installazione non trovata');
      if (!pagato(a)) throw errore(400, 'Si può chiedere solo dopo il pagamento');
      if (!a.agente) throw errore(400, 'Su quel server l\'agente di supporto non c\'è: si installa con il comando della pagina d\'installazione');
      const tipo = TIPI_PERIZIA.includes(x.tipo) ? x.tipo : null; if (!tipo) throw errore(400, 'Scegli diagnosi o accesso');
      const motivo = testo(x.motivo, 400); if (motivo.length < 10) throw errore(400, 'Spiega al titolare perché ti serve: due righe');
      const chiave = tipo === 'accesso' ? String(x.chiave || '').trim() : null;
      if (tipo === 'accesso' && !CHIAVE_SSH.test(chiave)) throw errore(400, 'Incolla la tua chiave SSH pubblica (una riga che inizia con ssh-ed25519 o ssh-rsa)');
      const ore = Math.min(24, Math.max(1, Math.round(Number(x.ore) || 2)));
      if (db.prepare("SELECT 1 FROM perizia WHERE acquisto = ? AND stato = 'chiesta'").get(a.id)) throw errore(400, 'C\'è già una richiesta in attesa del titolare');
      db.prepare('INSERT INTO perizia (acquisto, chi, tipo, motivo, chiave, ore) VALUES (?, ?, ?, ?, ?, ?)').run(a.id, io.id, tipo, motivo, chiave, ore); tocca(a.id);
      const p = prodottoDi(a.prodotto);
      notifiche.email(a.email, 'perizia_richiesta', { nome: a.nome, chi: io.nome, prodotto: p.nome, tipo, ore, motivo, link: `${linkPagina(a)}#supporto` }, { lingua: a.lingua || 'it' });
      h.rispondi(res, 200, { ok: true });
    },
  };
}
