// Le integrazioni: webhook in uscita (firmati, con i tentativi ripetuti), Telegram, Discord e Slack per le notifiche, le chiavi
// della REST API e l'API v1 (pubblica per il catalogo, con la chiave per i dati del proprio conto; documentata in OpenAPI).
import { randomBytes, createHash, createHmac } from 'node:crypto';
import { cifra, decifra, nuovoGettone, usaGettone, troppiTentativi } from '../conti.js';
import { EVENTI, urlSicuro, firmaAggancio } from '../notifiche.js';
import { errore, testo } from '../http.js';
import { percentualeDi, quotaDi, livelloDi } from '../soldi.js';

const DISCORD = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/\d{5,30}\/[\w-]{20,100}$/;
const SLACK = /^https:\/\/hooks\.slack\.com\/services\/[A-Z0-9]{5,20}\/[A-Z0-9]{5,20}\/[A-Za-z0-9]{10,40}$/;
const PUBBLICI = Object.keys(EVENTI).filter(e => e !== 'prova');
const hash = t => createHash('sha256').update(t).digest('hex');

export function rotteIntegrazioni(c) {
  const { cfg, db, h, chiave, notifiche } = c;
  const impronta = chat => createHmac('sha256', chiave).update(`telegram:${chat}`).digest('hex');
  const segretoTelegram = () => createHash('sha256').update(`${cfg.telegram.bot}:${chiave.toString('hex')}`).digest('hex').slice(0, 48);
  async function telegram(metodo, corpo) {
    const r = await (c.chiedi || fetch)(`https://api.telegram.org/bot${cfg.telegram.bot}/${metodo}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo), signal: AbortSignal.timeout(8000) });
    return r.json().catch(() => ({}));
  }
  const mioAggancio = (io, id) => { const a = db.prepare('SELECT * FROM aggancio WHERE id = ? AND utente = ?').get(Number(id), io.id); if (!a) throw errore(404, 'Webhook non trovato'); return a; };

  // la chiave dell'API v1: «Authorization: Bearer ak_…»; 120 richieste al minuto per chiave
  function daChiave(req) {
    const t = String(req.headers.authorization || '').match(/^Bearer\s+(ak_[\w-]{20,80})$/)?.[1]; if (!t) throw errore(401, 'Manca la chiave: Authorization: Bearer ak_…');
    const k = db.prepare('SELECT k.*, u.stato FROM chiave_api k JOIN utente u ON u.id = k.utente WHERE k.hash = ? AND k.revocata IS NULL AND u.cancellato IS NULL').get(hash(t));
    if (!k) throw errore(401, 'Chiave non valida o revocata'); if (k.stato !== 'attivo') throw errore(403, 'Il conto è sospeso');
    if (troppiTentativi(`api:${k.id}`, Date.now(), 120, 60e3)) throw errore(429, 'Troppe richieste: al massimo 120 al minuto');
    if (!k.usata || Date.parse(k.usata + 'Z') < Date.now() - 60e3) db.prepare("UPDATE chiave_api SET usata = datetime('now') WHERE id = ?").run(k.id);
    return db.prepare('SELECT * FROM utente WHERE id = ?').get(k.utente);
  }
  const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, OPTIONS' };
  const api = (res, dati) => h.rispondi(res, 200, dati, CORS);

  return {
    'GET /api/integrazioni': async (req, res, { io }) => {
      c.serve(io);
      h.rispondi(res, 200, {
        eventi: PUBBLICI,
        agganci: db.prepare('SELECT id, url, eventi, attivo, falliti, creato FROM aggancio WHERE utente = ? ORDER BY id').all(io.id).map(a => ({ ...a, eventi: JSON.parse(a.eventi),
          consegne: db.prepare('SELECT id, evento, stato, tentativi, risposta, creata FROM consegna WHERE aggancio = ? ORDER BY id DESC LIMIT 10').all(a.id) })),
        telegram: { disponibile: !!(cfg.telegram.bot && cfg.telegram.nome), collegato: !!io.telegram }, discord: !!io.discord, slack: !!io.slack,
        chiavi: db.prepare('SELECT id, nome, inizio, creata, usata FROM chiave_api WHERE utente = ? AND revocata IS NULL ORDER BY id').all(io.id),
      });
    },
    // ---------------- webhook in uscita ----------------
    'POST /api/agganci': async (req, res, { io }) => {
      c.serve(io); const { url, eventi } = await h.json(req);
      if (db.prepare('SELECT COUNT(*) n FROM aggancio WHERE utente = ?').get(io.id).n >= 10) throw errore(400, 'Al massimo 10 webhook');
      const no = await urlSicuro(String(url || ''), { locali: !!cfg.agganciLocali }); if (no) throw errore(400, no);
      const ev = Array.isArray(eventi) && eventi.length ? [...new Set(eventi.map(String))] : ['*'];
      if (!ev.every(e => e === '*' || PUBBLICI.includes(e))) throw errore(400, 'Evento sconosciuto');
      const segreto = `whsec_${randomBytes(24).toString('base64url')}`;
      const id = db.prepare('INSERT INTO aggancio (utente, url, segreto, eventi) VALUES (?, ?, ?, ?)').run(io.id, String(url), cifra(segreto, chiave), JSON.stringify(ev)).lastInsertRowid;
      h.rispondi(res, 201, { id, segreto });   // il segreto si vede solo adesso: serve a verificare la firma X-Firma
    },
    'POST /api/agganci/elimina': async (req, res, { io }) => { c.serve(io); const a = mioAggancio(io, (await h.json(req)).id); db.prepare('DELETE FROM aggancio WHERE id = ?').run(a.id); h.rispondi(res, 200, { ok: true }); },
    'POST /api/agganci/riattiva': async (req, res, { io }) => {
      c.serve(io); const a = mioAggancio(io, (await h.json(req)).id); db.prepare('UPDATE aggancio SET attivo = 1, falliti = 0 WHERE id = ?').run(a.id); h.rispondi(res, 200, { ok: true });
    },
    'POST /api/agganci/prova': async (req, res, { io }) => {   // un evento «prova» solo a questo webhook, consegnato subito
      c.serve(io); const a = mioAggancio(io, (await h.json(req)).id);
      const corpo = JSON.stringify({ id: `evt_${randomBytes(12).toString('base64url')}`, tipo: 'prova', creato: new Date().toISOString(), dati: { messaggio: 'Funziona!' } });
      const id = db.prepare("INSERT INTO consegna (aggancio, evento, corpo, prossimo) VALUES (?, 'prova', ?, datetime('now'))").run(a.id, corpo).lastInsertRowid;
      await notifiche.consegne();
      if (db.prepare("SELECT stato FROM consegna WHERE id = ?").get(id)?.stato === 'in_coda') await notifiche.consegne();   // il giro di prima non la conteneva
      h.rispondi(res, 200, db.prepare('SELECT stato, tentativi, risposta FROM consegna WHERE id = ?').get(id));
    },
    // ---------------- chat: Telegram, Discord, Slack ----------------
    'POST /api/integrazioni/telegram': async (req, res, { io }) => {
      c.serve(io); if (!cfg.telegram.bot || !cfg.telegram.nome) throw errore(503, 'Telegram non è configurato su questa piattaforma');
      const t = nuovoGettone(db, 'telegram', { utente: io.id, minuti: 15 });
      h.rispondi(res, 200, { link: `https://t.me/${cfg.telegram.nome}?start=${t}` });
    },
    'POST /api/telegram': async (req, res) => {   // il webhook del bot (setWebhook con secret_token): /start <codice> collega la chat
      if (!cfg.telegram.bot || req.headers['x-telegram-bot-api-secret-token'] !== segretoTelegram()) throw errore(403, 'no');
      const m = (await h.json(req, 256 * 1024)).message; const t = String(m?.text || ''), chat = m?.chat?.id;
      if (chat && m.chat.type === 'private') {
        const start = t.match(/^\/start\s+([\w-]{20,64})$/)?.[1];
        if (start) {
          const g = usaGettone(db, 'telegram', start);
          if (g) { db.prepare('UPDATE utente SET telegram = ?, telegram_h = ? WHERE id = ?').run(cifra(String(chat), chiave), impronta(chat), g.utente); await telegram('sendMessage', { chat_id: chat, text: `Collegato a ${cfg.nome}: qui arriveranno le tue notifiche. Scrivi /stop per scollegare.` }); }
          else await telegram('sendMessage', { chat_id: chat, text: 'Il link è scaduto: generane uno nuovo dalla tua area.' });
        } else if (t === '/stop') {
          db.prepare('UPDATE utente SET telegram = NULL, telegram_h = NULL WHERE telegram_h = ?').run(impronta(chat));
          await telegram('sendMessage', { chat_id: chat, text: 'Scollegato. Non riceverai più notifiche qui.' });
        }
      }
      h.rispondi(res, 200, { ok: true });
    },
    'POST /api/integrazioni/discord': async (req, res, { io }) => {
      c.serve(io); const url = String((await h.json(req)).url || '').trim(); if (!DISCORD.test(url)) throw errore(400, 'Incolla l\'URL del webhook di Discord (Impostazioni canale → Integrazioni → Webhook)');
      db.prepare('UPDATE utente SET discord = ? WHERE id = ?').run(cifra(url, chiave), io.id);
      await notifiche.chat({ ...io, discord: cifra(url, chiave), telegram: null, slack: null }, `Collegato a ${cfg.nome}: qui arriveranno le notifiche.`);
      h.rispondi(res, 200, { ok: true });
    },
    'POST /api/integrazioni/slack': async (req, res, { io }) => {
      c.serve(io); const url = String((await h.json(req)).url || '').trim(); if (!SLACK.test(url)) throw errore(400, 'Incolla l\'URL di un Incoming Webhook di Slack (https://hooks.slack.com/services/…)');
      db.prepare('UPDATE utente SET slack = ? WHERE id = ?').run(cifra(url, chiave), io.id);
      await notifiche.chat({ ...io, slack: cifra(url, chiave), telegram: null, discord: null }, `Collegato a ${cfg.nome}: qui arriveranno le notifiche.`);
      h.rispondi(res, 200, { ok: true });
    },
    'POST /api/integrazioni/scollega': async (req, res, { io }) => {
      c.serve(io); const { tipo } = await h.json(req); if (!['telegram', 'discord', 'slack'].includes(tipo)) throw errore(400, 'Integrazione sconosciuta');
      db.prepare(`UPDATE utente SET ${tipo} = NULL${tipo === 'telegram' ? ', telegram_h = NULL' : ''} WHERE id = ?`).run(io.id); h.rispondi(res, 200, { ok: true });
    },
    // ---------------- chiavi dell'API ----------------
    'POST /api/chiavi': async (req, res, { io }) => {
      c.serve(io); const nome = testo((await h.json(req)).nome, 60) || 'La mia chiave';
      if (db.prepare('SELECT COUNT(*) n FROM chiave_api WHERE utente = ? AND revocata IS NULL').get(io.id).n >= 10) throw errore(400, 'Al massimo 10 chiavi attive');
      const t = `ak_${randomBytes(30).toString('base64url')}`;
      const id = db.prepare('INSERT INTO chiave_api (utente, nome, hash, inizio) VALUES (?, ?, ?, ?)').run(io.id, nome, hash(t), t.slice(0, 10)).lastInsertRowid;
      h.rispondi(res, 201, { id, chiave: t });   // si vede solo adesso
    },
    'POST /api/chiavi/revoca': async (req, res, { io }) => {
      c.serve(io); db.prepare("UPDATE chiave_api SET revocata = datetime('now') WHERE id = ? AND utente = ?").run(Number((await h.json(req)).id), io.id); h.rispondi(res, 200, { ok: true });
    },

    // ---------------- API v1 ----------------
    'OPTIONS /api/v1': async (req, res) => { res.writeHead(204, CORS); res.end(); },
    'GET /api/v1': async (req, res, ctx) => {
      const p = ctx.url.pathname.replace(/\/+$/, '');
      const pubblico = { '/api/v1': () => api(res, { nome: cfg.nome, versione: 1, documentazione: `${cfg.url}/sviluppatori`, openapi: `${cfg.url}/api/v1/openapi.json` }),
        '/api/v1/openapi.json': () => api(res, openapi(cfg)) };
      if (pubblico[p]) return pubblico[p]();
      if (p === '/api/v1/catalogo') return c.inoltra('GET /api/catalogo', req, res, ctx, CORS);
      const slug = p.match(/^\/api\/v1\/catalogo\/([a-z0-9-]{1,60})$/)?.[1];
      if (slug) { ctx.url.searchParams.set('slug', slug); return c.inoltra('GET /api/prodotto', req, res, { ...ctx, io: null }, CORS); }
      const u = daChiave(req), t = (sql, ...x) => db.prepare(sql).all(...x);
      const pagina = Math.max(1, Number(ctx.url.searchParams.get('pagina')) || 1), lim = 100, off = (pagina - 1) * lim;
      const privati = {
        '/api/v1/io': () => ({ nome: u.nome, codice: u.codice, github: u.github_login, zona: u.zona, email: u.email }),
        // i prezzi li decide chi vende: qui la percentuale di chi sviluppa (sull'installazione, tolta la piattaforma) e il canone dell'assistenza
        '/api/v1/prodotti': () => t(`SELECT slug, repo, nome, stato, percentuale, prezzo_mese, versione, stelle,
          (SELECT COUNT(*) FROM adozione a WHERE a.prodotto = p.id) installatori, (SELECT COUNT(*) FROM cliente c WHERE c.prodotto = p.id AND c.stato = 'attivo') clienti
          FROM prodotto p WHERE builder = ? ORDER BY id`, u.id).map(x => ({ ...x, percentuale: percentualeDi(cfg, x) })),
        '/api/v1/adozioni': () => t('SELECT p.id, p.slug, p.nome, a.zona, a.quota, COALESCE(a.prezzo_avvio, p.prezzo_avvio) prezzo_avvio, a.creato FROM adozione a JOIN prodotto p ON p.id = a.prodotto WHERE a.installatore = ?', u.id)
          .map(({ id, ...x }) => ({ ...x, quota: x.quota ?? quotaDi(db, cfg, id, null), livello: livelloDi(db, cfg, id, u.id).livello, link: `${cfg.url}/p/${x.slug}?ref=${u.codice}` })),
        '/api/v1/vendite': () => t(`SELECT CASE WHEN c.installatore = ? THEN c.chiave ELSE 'v_' || substr(hex(c.rowid), 1, 16) END id, p.slug prodotto, c.nome cliente, c.stato, c.creato,
          CASE WHEN c.installatore = ? THEN 'installatore' ELSE 'builder' END ruolo
          FROM cliente c JOIN prodotto p ON p.id = c.prodotto WHERE c.installatore = ? OR p.builder = ? ORDER BY c.creato DESC LIMIT ? OFFSET ?`, u.id, u.id, u.id, u.id, lim, off),
        '/api/v1/quote': () => t(`SELECT q.id, p.slug prodotto, q.ruolo, q.tipo, q.importo, q.stornato, q.stato, q.disponibile, q.creato FROM quota q LEFT JOIN prodotto p ON p.id = q.prodotto
          WHERE q.beneficiario = ? ORDER BY q.id DESC LIMIT ? OFFSET ?`, u.id, lim, off),
        '/api/v1/notifiche': () => t('SELECT id, tipo, testo, link, letta, creata FROM notifica WHERE utente = ? ORDER BY id DESC LIMIT ? OFFSET ?', u.id, lim, off),
      };
      if (!privati[p]) throw errore(404, 'Risorsa non trovata: vedi /api/v1/openapi.json');
      api(res, { dati: privati[p](), pagina });
    },
  };
}

// la descrizione OpenAPI 3.1 dell'API v1 (per Postman, generatori di client, agenti AI)
function openapi(cfg) {
  const lista = (descr, item) => ({ get: { summary: descr, security: [{ chiave: [] }], parameters: [{ name: 'pagina', in: 'query', schema: { type: 'integer', minimum: 1 } }],
    responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { dati: { type: 'array', items: item }, pagina: { type: 'integer' } } } } } }, 401: { description: 'Chiave mancante o non valida' } } } });
  const ogg = p => ({ type: 'object', properties: Object.fromEntries(Object.entries(p).map(([k, t]) => [k, { type: t }])) });
  return {
    openapi: '3.1.0', info: { title: `${cfg.nome} API`, version: '1.0.0', description: 'Catalogo pubblico e dati del proprio conto (prodotti, vendite, quote). Gli importi sono in centesimi di euro; le quote in frazioni (0.3 = 30%).' },
    servers: [{ url: `${cfg.url}/api/v1` }],
    components: { securitySchemes: { chiave: { type: 'http', scheme: 'bearer', description: 'Una chiave creata nell\'area, sezione Sviluppatori (ak_…)' } } },
    paths: {
      '/catalogo': { get: { summary: 'Il catalogo dei prodotti pubblicati', parameters: ['q', 'categoria', 'zona', 'ordine', 'pagina'].map(n => ({ name: n, in: 'query', schema: { type: n === 'pagina' ? 'integer' : 'string' } })), responses: { 200: { description: 'OK' } } } },
      '/catalogo/{slug}': { get: { summary: 'Un prodotto, con installatori, recensioni e versioni', parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'OK' }, 404: { description: 'Non trovato' } } } },
      '/io': { get: { summary: 'Il tuo profilo', security: [{ chiave: [] }], responses: { 200: { description: 'OK' } } } },
      '/prodotti': lista('I tuoi prodotti (come builder): la tua percentuale sull\'installazione e il canone dell\'assistenza', ogg({ slug: 'string', repo: 'string', nome: 'string', stato: 'string', percentuale: 'number', prezzo_mese: 'integer', installatori: 'integer', clienti: 'integer' })),
      '/adozioni': lista('I prodotti che installi: il tuo prezzo, la tua parte, il tuo livello e il tuo link', ogg({ slug: 'string', nome: 'string', zona: 'string', prezzo_avvio: 'integer', quota: 'number', livello: 'integer', link: 'string' })),
      '/vendite': lista('Le vendite che ti riguardano', ogg({ id: 'string', prodotto: 'string', cliente: 'string', stato: 'string', ruolo: 'string', creato: 'string' })),
      '/quote': lista('Le tue quote', ogg({ id: 'integer', prodotto: 'string', ruolo: 'string', tipo: 'string', importo: 'integer', stato: 'string', disponibile: 'string' })),
      '/notifiche': lista('Le tue notifiche', ogg({ id: 'integer', tipo: 'string', testo: 'string', link: 'string', letta: 'integer', creata: 'string' })),
    },
    'x-webhook': { firma: 'X-Firma: t=<secondi>,v1=<HMAC-SHA256 esadecimale di "<t>.<corpo>" col segreto whsec_…>', eventi: PUBBLICI, esempio: firmaAggancio('{"tipo":"prova"}', 'whsec_esempio', 1700000000) },
  };
}
