// Le rotte di GitHub: l'accesso (OAuth, nessun permesso chiesto), i repository vendibili, i prodotti dei builder, i
// collaboratori che mantengono un progetto con il builder (e si dividono la sua parte), i progetti «non rivendicati».
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cifra } from '../conti.js';
import { motivoRifiuto, pulisciLicenza, pulisciProgramma, pulisciRef } from '../github.js';
import { pulisciInstallazione, pulisciIdee } from '../contenuti.js';
import { errore, testo, centesimi, urlValido } from '../http.js';
import { percentualeDi, titolariDi } from '../soldi.js';
import { attivitaPulite, attivitaDi } from '../attivita.js';

export const CATEGORIE = ['gestionale', 'cassa', 'prenotazioni', 'sito', 'ecommerce', 'magazzino', 'contabilità', 'crm', 'comunicazione', 'sanità', 'ristorazione', 'scuola', 'altro'];

// una pagina del sito dove tornare dopo l'accesso (mai un altro sito: niente «//», niente schemi)
const paginaInterna = x => typeof x === 'string' && /^\/[A-Za-z0-9/_.#?=&%-]{0,200}$/.test(x) && !x.startsWith('//');

export function rotteGithub(c) {
  const { cfg, db, h, github, chiave, notifiche } = c;
  const ritorno = `${cfg.url}/auth/github/ritorno`;
  const mio = (io, idp) => {   // il prodotto di questo builder (o, per chi gestisce, un progetto non rivendicato)
    const p = db.prepare('SELECT p.*, u.segnaposto FROM prodotto p JOIN utente u ON u.id = p.builder WHERE p.id = ?').get(Number(idp));
    if (!p || (p.builder !== io.id && !(p.segnaposto && c.eAdmin(io)))) throw errore(404, 'Prodotto non trovato');
    return p;
  };
  function slugLibero(nome) {
    const base = String(nome).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'progetto';
    for (let i = 0; i < 50; i++) { const s = i ? `${base}-${i + 1}` : base; if (!db.prepare('SELECT 1 FROM prodotto WHERE slug = ?').get(s)) return s; }
    return `${base}-${randomBytes(3).toString('hex')}`;
  }
  const inAttesa = (utente, prodotto) => db.prepare("SELECT COALESCE(SUM(importo - stornato), 0) c FROM quota WHERE beneficiario = ? AND stato = 'in_attesa'" + (prodotto ? ' AND prodotto = ?' : ''))
    .get(...[utente, prodotto].filter(Boolean)).c;
  // il permesso su GitHub di chi è entrato con GitHub: admin o maintain, sullo stesso repository (stesso id) messo in vendita.
  // All'indirizzo di prima può esserci un altro repository (nome lasciato libero e ripreso da altri): allora no
  async function permessoSu(p, gt) {
    const r = await github.repo(p.repo, gt);
    if (r.id !== p.repo_id) throw errore(409, `All'indirizzo ${p.repo} ora c'è un altro repository: scrivici dalla pagina contatti`);
    const permesso = r.permissions?.admin ? 'admin' : r.permissions?.maintain ? 'maintain' : null;
    if (!permesso) throw errore(403, 'Serve il permesso admin o maintain sul repository, su GitHub');
    return permesso;
  }
  // gli owner come li vede chi guarda il prodotto: chi l'ha rivendicato e chi è entrato dopo, con la loro parte (dai commit)
  function ownerDi(id) {
    const p = db.prepare('SELECT builder FROM prodotto WHERE id = ?').get(id); if (!p) return [];
    const t = titolariDi(db, id), chi = u => db.prepare('SELECT nome, github_login github, avatar, codice FROM utente WHERE id = ?').get(u);
    return [{ ...chi(p.builder), quota: t.builder, commit: t.commitBuilder ?? null, rivendicato: true }, ...t.altri.map(x => ({ ...chi(x.utente), quota: x.quota, commit: x.commit }))];
  }
  c.ownerDi = ownerDi;
  // chi è fra gli owner lo resta finché GitHub gli dà admin o maintain: si ricontrolla a ogni accesso con GitHub, senza farlo aspettare.
  // Se GitHub non risponde si riprova all'accesso dopo
  async function verificaOwner(u, gt) {
    for (const t of db.prepare(`SELECT t.prodotto, p.repo, p.repo_id, p.nome FROM cotitolare t JOIN prodotto p ON p.id = t.prodotto
        WHERE t.utente = ? AND t.stato = 'attivo' AND p.builder != ? LIMIT 50`).all(u.id, u.id)) {
      let permesso = null;
      try { permesso = await permessoSu(t, gt); } catch (e) { if (![403, 404, 409].includes(e.stato)) continue; }
      if (permesso) db.prepare("UPDATE cotitolare SET permesso = ?, verificato = datetime('now') WHERE prodotto = ? AND utente = ?").run(permesso, t.prodotto, u.id);
      else if (db.prepare("UPDATE cotitolare SET stato = 'uscito' WHERE prodotto = ? AND utente = ? AND stato = 'attivo'").run(t.prodotto, u.id).changes)
        notifiche.notifica(u.id, 'owner.uscito', { prodotto: t.nome });
    }
  }
  const vetrinaAccesa = io => {
    if (!c.eAdmin(io)) throw errore(403, 'Solo per chi gestisce la piattaforma');
    if (!cfg.nonRivendicati) throw errore(400, 'I progetti non rivendicati sono spenti (APP_NON_RIVENDICATI): prima il parere dell\'avvocato');
  };
  // un progetto in vetrina prima del suo maintainer: gli stessi controlli di chi vende (pubblico, non un fork, non archiviato, con una
  // licenza open source riconosciuta), il proprietario come segnaposto finché non entra con GitHub, il prodotto in bozza. → l'id
  // licenza: quella controllata a mano (vetrina curata), quando GitHub non la riconosce o non è open source
  async function inVetrina(repo, licenza = null) {
    if (typeof repo !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw errore(400, 'Scrivi owner/nome');
    const x = await github.grezzo(`/repos/${repo}`); if (x.stato !== 200) throw errore(404, 'Repository non trovato');
    const r = JSON.parse(x.testo); const no = motivoRifiuto({ ...r, permissions: { admin: true } }, { licenzaVerificata: !!licenza }); if (no) throw errore(400, no);
    if (db.prepare('SELECT 1 FROM prodotto WHERE repo_id = ?').get(r.id)) throw errore(409, `Questo progetto è già su ${cfg.nome}`);
    let s = db.prepare('SELECT id FROM utente WHERE github_id = ?').get(r.owner.id);
    if (s && !db.prepare('SELECT segnaposto FROM utente WHERE id = ?').get(s.id).segnaposto) throw errore(409, 'Il maintainer è già iscritto: può mettere in vendita il progetto da sé');
    if (!s) s = { id: c.nuovoUtente({ nome: r.owner.login, github_id: r.owner.id, github_login: r.owner.login, avatar: r.owner.avatar_url, segnaposto: true }) };
    const id = nuovoProdotto(s.id, r, licenza); c.sincronizza?.(id);
    return id;
  }
  function nuovoProdotto(builder, r, licenza = null) {
    // il canone dell'assistenza è uno per tutti i prodotti: lo decide la piattaforma (che l'assistenza la dà)
    const id = db.prepare(`INSERT INTO prodotto (builder, slug, repo, repo_id, url, licenza, stelle, nome, descrizione, ramo, prezzo_mese) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(builder, slugLibero(r.name), r.full_name, r.id, r.html_url, licenza?.spdx || r.license.spdx_id, r.stargazers_count || 0, testo(r.name, 80), testo(r.description, 600), r.default_branch || 'HEAD', c.canoneMese()).lastInsertRowid;
    if (licenza) segnaLicenza(id, licenza);
    return id;
  }
  // la licenza letta a mano: il tipo, il nome, la spiegazione per chi compra e la fonte; la sincronizzazione non la tocca più
  function segnaLicenza(id, l) {
    db.prepare("UPDATE prodotto SET licenza = ?, licenza_tipo = ?, licenza_nome = ?, licenza_nota = ?, licenza_fonte = ?, licenza_verificata = datetime('now') WHERE id = ?")
      .run(l.spdx, l.tipo, l.nome, l.nota, l.fonte, id);
  }
  c.segnaLicenza = segnaLicenza;
  // il programma partner dell'azienda e il link referral (null li toglie)
  function segnaProgramma(id, x) {
    db.prepare('UPDATE prodotto SET programma_nome = ?, programma_url = ?, programma_termini = ?, programma_obbligatorio = ? WHERE id = ?')
      .run(x?.nome || null, x?.url || null, x?.termini || null, x?.obbligatorio ? 1 : 0, id);
  }
  function segnaRef(id, x) { db.prepare('UPDATE prodotto SET ref_url = ?, ref_testo = ? WHERE id = ?').run(x?.url || null, x?.testo || null, id); }
  c.segnaProgramma = segnaProgramma; c.segnaRef = segnaRef;

  return {
    'GET /auth/github': async (req, res, { url }) => {
      const stato = randomBytes(18).toString('base64url'), contratto = url.searchParams.get('contratto') === '1' ? '1' : '0';
      const dopo = String(url.searchParams.get('dopo') || ''), torna = paginaInterna(dopo) ? Buffer.from(dopo).toString('base64url') : '';
      h.vai(res, github.indirizzoAccesso(ritorno, stato), { 'set-cookie': h.biscotto('gh_stato', `${stato}.${contratto}.${torna}`, 1 / 96) });
    },
    'GET /auth/github/ritorno': async (req, res, { url, b, io }) => {
      const [stato, contratto, torna] = String(b.gh_stato || '').split('.');
      const dopo = (x => (paginaInterna(x) ? x : null))(torna ? Buffer.from(torna, 'base64url').toString() : '');
      const pulisci = h.biscotto('gh_stato', '', 0);
      if (!stato || stato !== url.searchParams.get('state') || !url.searchParams.get('code')) return h.vai(res, '/accedi?errore=github', { 'set-cookie': pulisci });
      const gettone = await github.scambia(url.searchParams.get('code'), ritorno);
      const g = await github.io(gettone);
      let u = db.prepare('SELECT * FROM utente WHERE github_id = ?').get(g.id), rivendicato = 0, reclamati = false;
      if (u?.segnaposto && io && !io.github_id && !io.segnaposto) {
        rivendicato = inAttesa(u.id); reclamati = true;
        db.exec('BEGIN');
        try {
          db.prepare('UPDATE prodotto SET builder = ? WHERE builder = ?').run(io.id, u.id);
          db.prepare("UPDATE quota SET beneficiario = ? WHERE beneficiario = ? AND stato IN ('in_attesa', 'contestata', 'manuale')").run(io.id, u.id);
          db.prepare("UPDATE utente SET github_id = NULL, github_login = NULL, stato = 'cancellato', cancellato = datetime('now') WHERE id = ?").run(u.id);
          db.prepare('UPDATE utente SET github_id = ?, github_login = ?, avatar = COALESCE(avatar, ?) WHERE id = ?').run(g.id, g.login, g.avatar_url || null, io.id);
          db.exec('COMMIT');
        } catch (e) { db.exec('ROLLBACK'); throw e; }
        u = db.prepare('SELECT * FROM utente WHERE id = ?').get(io.id);
      }
      if (u?.segnaposto) {   // il maintainer di un progetto non rivendicato entra per la prima volta: il conto diventa suo
        if (contratto !== '1') return h.vai(res, `/accedi?errore=contratto&rivendica=1${dopo ? `&dopo=${encodeURIComponent(dopo)}` : ''}`, { 'set-cookie': pulisci });
        rivendicato = inAttesa(u.id); reclamati = true;
        db.prepare("UPDATE utente SET segnaposto = 0, stato = 'attivo', contratto = ?, nome = ?, github_login = ?, avatar = ?, lingua = ? WHERE id = ?")
          .run(new Date().toISOString(), testo(g.name || g.login, 80), g.login, g.avatar_url || null, c.linguaDi(req), u.id);
        u = db.prepare('SELECT * FROM utente WHERE id = ?').get(u.id);
      }
      if (!u && io && !io.github_id) {   // già dentro con l'email: si collega GitHub allo stesso conto
        db.prepare('UPDATE utente SET github_id = ?, github_login = ?, avatar = COALESCE(avatar, ?) WHERE id = ?').run(g.id, g.login, g.avatar_url || null, io.id);
        u = db.prepare('SELECT * FROM utente WHERE id = ?').get(io.id);
      }
      if (!u) {
        if (contratto !== '1') return h.vai(res, `/accedi?errore=contratto${dopo ? `&dopo=${encodeURIComponent(dopo)}` : ''}`, { 'set-cookie': pulisci });
        const id = c.nuovoUtente({ nome: testo(g.name || g.login, 80), github_id: g.id, github_login: g.login, avatar: g.avatar_url || null, lingua: c.linguaDi(req) });
        u = db.prepare('SELECT * FROM utente WHERE id = ?').get(id);
      } else if (u.github_login !== g.login || (g.avatar_url && u.avatar !== g.avatar_url)) db.prepare('UPDATE utente SET github_login = ?, avatar = ? WHERE id = ?').run(g.login, g.avatar_url || u.avatar, u.id);
      if (u.cancellato) return h.vai(res, '/accedi?errore=github', { 'set-cookie': pulisci });
      for (const x of db.prepare("SELECT c.prodotto, c.quota, p.nome, b.nome AS da FROM collaboratore c JOIN prodotto p ON p.id = c.prodotto JOIN utente b ON b.id = p.builder WHERE c.github_login = ? AND c.utente IS NULL AND c.stato = 'invitato'").all(g.login)) {
        db.prepare('UPDATE collaboratore SET utente = ? WHERE prodotto = ? AND github_login = ?').run(u.id, x.prodotto, g.login);   // gli inviti arrivati prima dell'iscrizione
        notifiche.notifica(u.id, 'collaborazione.invito', { prodotto: x.nome, da: x.da, quota: x.quota });
      }
      if (rivendicato) notifiche.notifica(u.id, 'progetto.rivendicato', { prodotto: 'i tuoi progetti', importo: rivendicato });
      // chi aveva prenotato un suo progetto mentre era in vetrina ora può pagare: riceve il link
      if (reclamati) for (const x of db.prepare('SELECT id FROM prodotto WHERE builder = ?').all(u.id)) c.avvisaPrenotati?.(x.id);
      verificaOwner(u, gettone).catch(e => console.error('owner:', e.message));
      if (b.sessione) c.chiudi(b.sessione);
      // il secondo fattore vale anche con GitHub (chi l'ha attivato lo vuole sempre): il gettone di GitHub aspetta nel passaggio
      if (u.totp) return c.passaggio(res, u, 'github', { github: cifra(gettone, chiave), vai: `/accedi?passo=codice${dopo ? `&dopo=${encodeURIComponent(dopo)}` : ''}`, pulisci: ['gh_stato'] });
      c.entra(req, res, u, { metodo: 'github', github: cifra(gettone, chiave), dopo: rivendicato ? '/area?rivendicato=1#soldi' : dopo || '/area', pulisci: ['gh_stato'] });
    },
    'POST /api/github/scollega': async (req, res, { io }) => {
      c.serve(io); if (!io.github_id) throw errore(400, 'GitHub non è collegato');
      if (!io.email || !io.parola) throw errore(400, 'Prima aggiungi un\'email e una password: altrimenti non potresti più entrare');
      if (db.prepare("SELECT 1 FROM prodotto WHERE builder = ? AND stato NOT IN ('ritirato')").get(io.id)) throw errore(400, 'Hai prodotti in vendita: servono a GitHub per restare tuoi');
      db.prepare('UPDATE utente SET github_id = NULL, github_login = NULL WHERE id = ?').run(io.id);
      db.prepare('UPDATE sessione SET github = NULL WHERE utente = ?').run(io.id); h.rispondi(res, 200, { ok: true });
    },
    'GET /api/github/repository': async (req, res, { io }) => {
      c.serve(io); const gt = c.gettoneGithub(io);
      const presi = new Set(db.prepare('SELECT repo_id FROM prodotto').all().map(r => r.repo_id));
      const l = await github.repository(gt);
      h.rispondi(res, 200, l.map(r => ({ id: r.id, nome: r.full_name, descrizione: r.description || '', stelle: r.stargazers_count || 0, licenza: r.license?.spdx_id || null, url: r.html_url,
        organizzazione: r.owner?.type === 'Organization', motivo: presi.has(r.id) ? 'Già su ' + cfg.nome : motivoRifiuto(r) })));
    },
    'POST /api/prodotti': async (req, res, { io }) => {
      c.serve(io); const gt = c.gettoneGithub(io); const { repo } = await h.json(req);
      if (typeof repo !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw errore(400, 'Scegli un repository');
      const r = await github.repo(repo, gt);
      const no = motivoRifiuto(r); if (no) throw errore(400, no);
      const gia = db.prepare('SELECT p.id, u.segnaposto FROM prodotto p JOIN utente u ON u.id = p.builder WHERE p.repo_id = ?').get(r.id);
      if (gia?.segnaposto) throw errore(409, `Questo progetto è già su ${cfg.nome} in attesa del suo maintainer: rivendicalo dalla sua pagina`);
      if (gia) throw errore(409, `Questo progetto è già su ${cfg.nome}`);
      const id = nuovoProdotto(io.id, r); c.sincronizza?.(id);
      h.rispondi(res, 201, c.vista(db.prepare('SELECT * FROM prodotto WHERE id = ?').get(id)));
    },
    'POST /api/prodotti/modifica': async (req, res, { io }) => {
      c.serve(io); const x = await h.json(req); const p = mio(io, x.id);
      const nome = x.nome === undefined ? p.nome : testo(x.nome, 80), descrizione = x.descrizione === undefined ? p.descrizione : testo(x.descrizione, 1200);
      const guida = x.guida === undefined ? p.guida : testo(x.guida, 4000), categoria = x.categoria === undefined ? p.categoria : x.categoria;
      // i prezzi non si scelgono qui: l'installazione la prezza chi vende, l'assistenza la piattaforma. Chi sviluppa sceglie la sua
      // percentuale sull'installazione (tolta la parte della piattaforma), da 0 a PERCENTUALE_MASSIMA; null torna a quella standard
      const max = Math.round(cfg.percentualeMax * 100);
      let percentuale = p.percentuale;
      if (x.percentuale !== undefined) {
        if (x.percentuale === null || x.percentuale === '') percentuale = null;
        else { const v = Number(x.percentuale); if (!Number.isInteger(v) || v < 0 || v > max) throw errore(400, `La tua percentuale va da 0 a ${max}%`); percentuale = v / 100; }
      }
      const sito = x.sito === undefined ? p.sito : testo(x.sito, 200) || null, demo = x.demo === undefined ? p.demo : testo(x.demo, 200) || null;
      // le attività per cui è consigliato (tag dal vocabolario): se non le tocca restano quelle di prima
      const attivita = x.attivita === undefined ? p.attivita : JSON.stringify(attivitaPulite(x.attivita) || []);
      // «costruito su»: la piattaforma che il progetto richiede (workflow per n8n, plugin per un CMS…), con il suo link
      const baseNome = x.base_nome === undefined ? p.base_nome : testo(x.base_nome, 60) || null, baseUrl = x.base_url === undefined ? p.base_url : testo(x.base_url, 200) || null;
      if (baseNome && !baseUrl || baseUrl && !baseNome) throw errore(400, 'Per la piattaforma di base servono il nome e il link');
      if (baseUrl && !urlValido(baseUrl, { https: true })) throw errore(400, 'I link devono iniziare con https://');
      if (nome.length < 2) throw errore(400, 'Scrivi il nome del prodotto');
      if (!CATEGORIE.includes(categoria)) throw errore(400, 'Categoria non valida');
      for (const u of [sito, demo]) if (u && !urlValido(u, { https: true })) throw errore(400, 'I link devono iniziare con https://');
      // gli aggiornamenti garantiti: una riga facoltativa per il cliente, a prezzo di chi sviluppa (l'80% a lui). Solo chi sviluppa
      // davvero il progetto li può promettere: su un progetto non rivendicato non si attivano
      const pg = x.prezzo_aggiornamenti === undefined ? p.prezzo_aggiornamenti || 0 : centesimi(x.prezzo_aggiornamenti);
      const tg = x.aggiornamenti_testo === undefined ? p.aggiornamenti_testo || null : testo(x.aggiornamenti_testo, 300) || null;
      if (!Number.isInteger(pg) || pg < 0 || pg > 500_000 || (pg > 0 && pg < cfg.prezzoMin)) throw errore(400, `Prezzo degli aggiornamenti non valido (0, oppure almeno ${cfg.prezzoMin / 100} € al mese)`);
      if (pg > 0 && db.prepare('SELECT segnaposto FROM utente WHERE id = ?').get(p.builder)?.segnaposto)
        throw errore(400, 'Gli aggiornamenti garantiti li offre solo chi sviluppa il progetto: si attivano quando rivendica la pagina');
      if (pg > 0 && (!tg || tg.length < 20)) throw errore(400, 'Scrivi cosa includono gli aggiornamenti (almeno una riga): per esempio ogni quanto esce una versione e in quanto tempo correggi i problemi di sicurezza');
      // un prodotto pubblicato a cui cambiano nome, descrizione o aggiornamenti torna in revisione; guida, link e percentuale no. Con
      // ciascun installatore si può concordare un'altra divisione (POST /api/accordi/…)
      const sostanza = nome !== p.nome || descrizione !== p.descrizione || pg !== (p.prezzo_aggiornamenti || 0) || tg !== (p.aggiornamenti_testo || null);
      const stato = p.stato === 'pubblicato' && sostanza && !c.eAdmin(io) ? 'revisione' : p.stato;
      db.prepare(`UPDATE prodotto SET nome = ?, descrizione = ?, guida = ?, categoria = ?, percentuale = ?, prezzo_aggiornamenti = ?, aggiornamenti_testo = ?,
        sito = ?, demo = ?, base_nome = ?, base_url = ?, attivita = ?, stato = ?, aggiornato = datetime('now') WHERE id = ?`).run(nome, descrizione, guida, categoria, percentuale, pg, tg, sito, demo, baseNome, baseUrl, attivita, stato, p.id);
      // la percentuale cambiata vale per le vendite nuove: chi lo vende lo sa subito (chi ha un accordo con te resta all'accordo)
      const pc = q => Math.round(percentualeDi(cfg, { percentuale: q }) * 1000) / 10;
      if (pc(percentuale) !== pc(p.percentuale)) for (const a of db.prepare('SELECT installatore FROM adozione WHERE prodotto = ? AND installatore != ? AND quota IS NULL').all(p.id, io.id))
        notifiche.notifica(a.installatore, 'percentuale.cambiata', { prodotto: nome, slug: p.slug, da: io.nome, prima: pc(p.percentuale), dopo: pc(percentuale) });
      h.rispondi(res, 200, c.vista(db.prepare('SELECT * FROM prodotto WHERE id = ?').get(p.id)));
    },
    'POST /api/prodotti/revisione': async (req, res, { io }) => {
      c.serve(io); const p = mio(io, (await h.json(req)).id);
      if (!['bozza', 'respinto', 'ritirato'].includes(p.stato)) throw errore(400, 'Il prodotto è già in revisione o pubblicato');
      if (p.descrizione.length < 40) throw errore(400, 'Scrivi una descrizione di almeno 40 caratteri: cosa fa, per quali attività');
      if (p.guida.length < 80) throw errore(400, 'Scrivi la guida per chi installa (almeno qualche riga, o il link alla documentazione)');
      db.prepare("UPDATE prodotto SET stato = 'revisione', nota = NULL, aggiornato = datetime('now') WHERE id = ?").run(p.id);
      h.rispondi(res, 200, { ok: true });
    },
    'POST /api/prodotti/ritira': async (req, res, { io }) => {   // fuori dal catalogo; i clienti che ci sono restano serviti
      c.serve(io); const p = mio(io, (await h.json(req)).id);
      db.prepare("UPDATE prodotto SET stato = 'ritirato', aggiornato = datetime('now') WHERE id = ?").run(p.id); h.rispondi(res, 200, { ok: true });
    },
    'POST /api/prodotti/sincronizza': async (req, res, { io }) => {
      c.serve(io); const p = mio(io, (await h.json(req)).id);
      h.rispondi(res, 200, { esito: await c.sincronizzazione.prodotto(p) });
    },

    // ---------------- collaboratori: chi mantiene il progetto con il builder ----------------
    'POST /api/prodotti/collaboratori': async (req, res, { io }) => {
      c.serve(io); const { id, login, quota } = await h.json(req); const p = mio(io, id);
      const l = String(login || '').trim().replace(/^@/, ''); if (!/^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i.test(l)) throw errore(400, 'Login GitHub non valido');
      if (l.toLowerCase() === String(io.github_login || '').toLowerCase()) throw errore(400, 'Sei già il builder di questo progetto');
      const q = Number(quota) / 100; if (!Number.isFinite(q) || q <= 0 || q > 0.9) throw errore(400, 'La parte va da 1% a 90% della tua');
      const altre = db.prepare("SELECT COALESCE(SUM(quota), 0) s FROM collaboratore WHERE prodotto = ? AND github_login != ? AND stato IN ('invitato', 'attivo')").get(p.id, l).s;
      if (altre + q > 0.9 + 1e-9) throw errore(400, 'Le parti dei collaboratori insieme non possono superare il 90% della tua');
      const u = db.prepare('SELECT id FROM utente WHERE github_login = ? COLLATE NOCASE AND cancellato IS NULL AND segnaposto = 0').get(l);
      db.prepare(`INSERT INTO collaboratore (prodotto, github_login, utente, quota, stato) VALUES (?, ?, ?, ?, 'invitato')
        ON CONFLICT(prodotto, github_login) DO UPDATE SET quota = excluded.quota, stato = CASE WHEN collaboratore.stato = 'attivo' THEN 'attivo' ELSE 'invitato' END`).run(p.id, l, u?.id || null, q);
      if (u) notifiche.notifica(u.id, 'collaborazione.invito', { prodotto: p.nome, da: io.nome, quota: q });
      h.rispondi(res, 200, { ok: true, iscritto: !!u });
    },
    'POST /api/prodotti/collaboratori/rimuovi': async (req, res, { io }) => {
      c.serve(io); const { id, login } = await h.json(req); const p = mio(io, id);
      db.prepare("UPDATE collaboratore SET stato = 'uscito' WHERE prodotto = ? AND github_login = ?").run(p.id, String(login || '')); h.rispondi(res, 200, { ok: true });
    },
    'POST /api/collaborazioni/rispondi': async (req, res, { io }) => {   // accetta o rifiuta un invito (o esci da un progetto)
      c.serve(io); const { prodotto, accetta } = await h.json(req);
      const n = db.prepare('UPDATE collaboratore SET stato = ? WHERE prodotto = ? AND utente = ? AND stato IN (?, ?)')
        .run(accetta ? 'attivo' : 'uscito', Number(prodotto), io.id, 'invitato', accetta ? 'invitato' : 'attivo').changes;
      if (!n) throw errore(404, 'Invito non trovato'); h.rispondi(res, 200, { ok: true });
    },

    // ---------------- progetti non rivendicati ----------------
    'POST /api/rivendica': async (req, res, { io }) => {   // un progetto di un'organizzazione: lo rivendica chi ne è admin o maintainer
      c.serve(io); const gt = c.gettoneGithub(io); const { prodotto } = await h.json(req);
      const p = db.prepare('SELECT p.*, u.segnaposto FROM prodotto p JOIN utente u ON u.id = p.builder WHERE p.id = ?').get(Number(prodotto));
      if (!p) throw errore(404, 'Non c\'è niente da rivendicare qui');
      if (!p.segnaposto) throw errore(409, 'È già stato rivendicato: se hai admin o maintain sul repository entra fra gli owner dalla pagina del progetto');
      const permesso = await permessoSu(p, gt);
      const importo = inAttesa(p.builder, p.id);
      db.exec('BEGIN');
      try {
        // solo se è ancora in vetrina: con due richieste insieme vince la prima, la seconda può entrare fra gli owner
        if (!db.prepare("UPDATE prodotto SET builder = ?, aggiornato = datetime('now') WHERE id = ? AND builder = ?").run(io.id, p.id, p.builder).changes) {
          db.exec('ROLLBACK'); throw errore(409, 'Qualcun altro l\'ha appena rivendicato: puoi entrare fra gli owner dalla pagina del progetto');
        }
        // le quote non ancora versate (anche quelle ferme per una segnalazione) passano a chi rivendica
        db.prepare("UPDATE quota SET beneficiario = ? WHERE beneficiario = ? AND prodotto = ? AND stato IN ('in_attesa', 'contestata', 'manuale')").run(io.id, p.builder, p.id);
        db.prepare(`INSERT INTO cotitolare (prodotto, utente, github_id, permesso) VALUES (?, ?, ?, ?)
          ON CONFLICT(prodotto, utente) DO UPDATE SET stato = 'attivo', permesso = excluded.permesso, verificato = datetime('now')`).run(p.id, io.id, io.github_id, permesso);
        db.exec('COMMIT');
      } catch (e) { if (e.stato !== 409) db.exec('ROLLBACK'); throw e; }
      notifiche.notifica(io.id, 'progetto.rivendicato', { prodotto: p.nome, importo });
      c.avvisaPrenotati?.(p.id);
      h.rispondi(res, 200, { ok: true, importo });
    },
    // gli altri owner di un repository già rivendicato: chi ha admin o maintain su GitHub entra da sé e da lì riceve una parte di quello
    // che spetta a chi sviluppa, in proporzione ai commit (soldi.js, titolariDi). Vale dai pagamenti dopo il suo ingresso
    'POST /api/owner/entra': async (req, res, { io }) => {
      c.serve(io); const gt = c.gettoneGithub(io); const { prodotto } = await h.json(req);
      const p = db.prepare("SELECT p.*, u.segnaposto FROM prodotto p JOIN utente u ON u.id = p.builder WHERE p.id = ? AND p.stato NOT IN ('ritirato')").get(Number(prodotto));
      if (!p) throw errore(404, 'Prodotto non trovato');
      if (p.segnaposto) throw errore(400, 'Il progetto non è ancora rivendicato: rivendicalo, poi gli altri owner entrano da qui');
      if (p.builder === io.id) throw errore(400, 'Sei tu ad averlo rivendicato: sei già fra gli owner');
      if (!io.github_id) throw errore(400, 'Entra con GitHub');
      const permesso = await permessoSu(p, gt);
      const prima = db.prepare('SELECT stato FROM cotitolare WHERE prodotto = ? AND utente = ?').get(p.id, io.id);
      // chi era collaboratore invitato dal builder diventa owner: la sua parte da lì la decidono i commit
      db.prepare("UPDATE collaboratore SET stato = 'uscito' WHERE prodotto = ? AND utente = ? AND stato IN ('invitato', 'attivo')").run(p.id, io.id);
      db.prepare(`INSERT INTO cotitolare (prodotto, utente, github_id, permesso) VALUES (?, ?, ?, ?)
        ON CONFLICT(prodotto, utente) DO UPDATE SET stato = 'attivo', permesso = excluded.permesso, github_id = excluded.github_id, verificato = datetime('now'),
          entrato = CASE WHEN cotitolare.stato = 'attivo' THEN cotitolare.entrato ELSE datetime('now') END`).run(p.id, io.id, io.github_id, permesso);
      await c.sincronizzazione.contributi(p).catch(() => null);
      if (prima?.stato !== 'attivo') {
        const t = titolariDi(db, p.id), mia = t.altri.find(x => x.utente === io.id)?.quota ?? 0;
        for (const u of new Set([p.builder, ...t.altri.map(x => x.utente)].filter(u => u !== io.id)))
          notifiche.notifica(u, 'owner.nuovo', { prodotto: p.nome, slug: p.slug, chi: io.nome, github: io.github_login, permesso, quota: mia });
      }
      h.rispondi(res, 200, { ok: true, owner: ownerDi(p.id) });
    },
    'POST /api/owner/esci': async (req, res, { io }) => {
      c.serve(io); const { prodotto } = await h.json(req);
      const n = db.prepare("UPDATE cotitolare SET stato = 'uscito' WHERE prodotto = ? AND utente = ? AND stato = 'attivo'").run(Number(prodotto), io.id).changes;
      if (!n) throw errore(404, 'Non sei fra gli owner di questo progetto');
      h.rispondi(res, 200, { ok: true });
    },
    'POST /api/admin/non-rivendicato': async (req, res, { io }) => {   // chi gestisce mette in vetrina un progetto prima del suo maintainer
      vetrinaAccesa(io);
      const id = await inVetrina((await h.json(req)).repo);
      h.rispondi(res, 201, c.vista(db.prepare('SELECT * FROM prodotto WHERE id = ?').get(id)));
    },
    // la vetrina curata (server/vetrina.json, o una lista passata da chi gestisce): ogni progetto entra pubblicato, con descrizione,
    // guida, categoria e prezzi; quelli già presenti si saltano, quelli che non passano i controlli si riportano col motivo
    'POST /api/admin/vetrina/importa': async (req, res, { io }) => {
      vetrinaAccesa(io);
      const { lista } = await h.json(req, 512 * 1024);
      const voci = Array.isArray(lista) ? lista : JSON.parse(readFileSync(new URL('../vetrina.json', import.meta.url), 'utf8')).progetti;
      if (voci.length > 200) throw errore(400, 'Al massimo 200 progetti per volta');
      const esito = [];
      for (const v of voci) {
        const repo = String(v?.repo || '');
        try {
          const installazione = pulisciInstallazione(v.installazione), idee = pulisciIdee(v.idee), licenza = v.licenza ? pulisciLicenza(v.licenza) : null;
          if (v.licenza && !licenza) throw errore(400, 'Licenza controllata a mano non valida: servono tipo, nome, spiegazione e fonte https');
          const base = v.base ? { nome: testo(v.base.nome, 60), url: testo(v.base.url, 200) } : null;
          const programma = v.programma ? pulisciProgramma(v.programma) : null, refer = v.ref ? pulisciRef(v.ref) : null;
          if (v.programma && !programma) throw errore(400, 'Programma partner non valido: servono nome, link https per aderire e le condizioni in breve');
          if (v.ref && !refer) throw errore(400, 'Link referral non valido: servono un link https e la frase che lo presenta');
          if (base && (base.nome.length < 2 || !urlValido(base.url, { https: true }))) throw errore(400, 'La piattaforma di base vuole un nome e un link https://');
          const gia = db.prepare('SELECT p.id, p.installazione, p.idee, u.segnaposto FROM prodotto p JOIN utente u ON u.id = p.builder WHERE lower(p.repo) = lower(?)').get(repo);
          if (gia) {
            // già in catalogo: se è ancora in vetrina (non rivendicato) e gli mancano guida a passi o idee, si aggiungono; il resto non si tocca
            const manca = gia.segnaposto && ((installazione && !gia.installazione) || (idee && !gia.idee));
            if (manca) db.prepare('UPDATE prodotto SET installazione = COALESCE(installazione, ?), idee = COALESCE(idee, ?) WHERE id = ?')
              .run(installazione ? JSON.stringify(installazione) : null, idee ? JSON.stringify(idee) : null, gia.id);
            if (gia.segnaposto && licenza) segnaLicenza(gia.id, licenza);   // la licenza riletta a mano vale anche per chi è già in vetrina
            if (gia.segnaposto && programma) segnaProgramma(gia.id, programma);
            if (gia.segnaposto && refer) segnaRef(gia.id, refer);
            esito.push({ repo, esito: manca ? 'aggiornato' : 'presente' }); continue;
          }
          const descrizione = testo(v.descrizione, 1200), guida = testo(v.guida, 4000), sito = v.sito ? testo(v.sito, 200) : null;
          const prezzo = x => Number.isInteger(x) && x >= 0 && x <= 5_000_000 && (x === 0 || x >= cfg.prezzoMin);
          if (!CATEGORIE.includes(v.categoria)) throw errore(400, 'Categoria non valida');
          if (!prezzo(v.prezzo_avvio)) throw errore(400, 'Prezzo non valido');   // il canone dell'assistenza non si legge dalla vetrina: è unico
          if (descrizione.length < 40 || guida.length < 80) throw errore(400, 'Descrizione o guida troppo corte');
          if (sito && !urlValido(sito, { https: true })) throw errore(400, 'Il sito deve iniziare con https://');
          const id = await inVetrina(repo, licenza);
          // le attività consigliate: quelle scritte nella vetrina, altrimenti il valore predefinito della categoria
          const attivita = JSON.stringify(attivitaPulite(v.attivita) || attivitaDi(v.categoria));
          db.prepare(`UPDATE prodotto SET descrizione = ?, guida = ?, categoria = ?, prezzo_avvio = ?, prezzo_mese = ?, sito = ?, installazione = ?, idee = ?, base_nome = ?, base_url = ?,
            attivita = ?, stato = 'pubblicato', aggiornato = datetime('now') WHERE id = ?`)
            .run(descrizione, guida, v.categoria, v.prezzo_avvio, c.canoneMese(), sito, installazione ? JSON.stringify(installazione) : null, idee ? JSON.stringify(idee) : null,
              base?.nome || null, base?.url || null, attivita, id);
          if (programma) segnaProgramma(id, programma);
          if (refer) segnaRef(id, refer);
          esito.push({ repo, esito: 'pubblicato', slug: db.prepare('SELECT slug FROM prodotto WHERE id = ?').get(id).slug });
        } catch (e) { esito.push({ repo, esito: 'scartato', motivo: e.message }); }
      }
      const conta = x => esito.filter(y => y.esito === x).length;
      h.rispondi(res, 200, { pubblicati: conta('pubblicato'), aggiornati: conta('aggiornato'), presenti: conta('presente'), scartati: conta('scartato'), esito });
    },
  };
}
