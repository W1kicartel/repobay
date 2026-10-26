// Gli attrezzi delle prove: l'app accesa in questo processo (creaApp, come in avvia.js) con un database in una cartella temporanea,
// la posta finta (le email restano in un elenco) e un finto GitHub su localhost. Niente rete e niente chiavi vere: ogni chiamata
// verso fuori che non passa dai finti fallisce subito.
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { leggiConfig } from '../server/config.js';
import { apriDb } from '../server/db.js';
import { clienteGithub } from '../server/github.js';
import { clienteStripe } from '../server/stripe.js';
import { creaApp } from '../server/app.js';

const ascolta = server => new Promise(ok => server.listen(0, '127.0.0.1', () => ok(`http://127.0.0.1:${server.address().port}`)));
const spegni = server => new Promise(ok => { server.close(() => ok()); server.closeAllConnections(); });
const reteSpenta = async url => { throw new Error(`rete spenta nelle prove: ${url}`); };

// un finto GitHub: l'accesso OAuth (authorize → access_token → /user) per un solo utente, «marta-dev»
export const UTENTE_GITHUB = { id: 1001, login: 'marta-dev', name: 'Marta Dev', avatar_url: 'https://avatars.example/1001' };
async function fintoGithub() {
  const server = createServer(async (req, res) => {
    for await (const _ of req);
    const p = req.url.split('?')[0], r = (stato, j) => { res.writeHead(stato, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (p === '/login/oauth/access_token' && req.method === 'POST') return r(200, { access_token: 'gho_finto', token_type: 'bearer' });
    if (p === '/user' && req.headers.authorization === 'Bearer gho_finto') return r(200, UTENTE_GITHUB);
    if (p === '/user/repos') return r(200, []);
    r(404, { message: 'Not Found' });
  });
  return { url: await ascolta(server), chiudi: () => spegni(server) };
}

// → { url, cfg, db, posta: [{a, oggetto, testo}], chiedi(percorso, opzioni), chiudi() }; con stripe: true il client di Stripe vero,
// da puntare con STRIPE_BASE sul finto (strumenti/finto-stripe.mjs)
export async function accendi(env = {}, { versione, stripe = false } = {}) {
  const cartella = mkdtempSync(join(tmpdir(), 'repobay-prova-'));
  const gh = await fintoGithub();
  let app;
  const server = createServer((req, res) => app(req, res));
  const url = await ascolta(server);
  const cfg = leggiConfig({ APP_URL: url, APP_DATI: cartella, APP_SEGRETO: 'solo-per-le-prove-'.repeat(3), APP_ADMIN: 'admin@prova.test', POSTA_DRIVER: 'console',
    GITHUB_CLIENT_ID: 'finto', GITHUB_CLIENT_SECRET: 'finto', GITHUB_WEB: gh.url, GITHUB_API: gh.url, ...env });
  const db = apriDb(cartella), posta = [];
  app = creaApp(cfg, { db, stripe: stripe ? clienteStripe(cfg.stripe) : null, github: clienteGithub(cfg.github), rpc: reteSpenta, prezzo: reteSpenta, chiedi: reteSpenta,
    posta: { invia: async m => { posta.push(m); return { id: `prova-${posta.length}` }; } }, ...(versione ? { versione } : {}) });
  // le richieste come da una pagina del sito: stessa origine (le POST da altre origini sono rifiutate), niente redirect seguiti
  const chiedi = (percorso, { corpo, biscotto, ...o } = {}) => fetch(url + percorso, { redirect: 'manual', ...o,
    headers: { origin: url, ...(corpo ? { 'content-type': 'application/json' } : {}), ...(biscotto ? { cookie: biscotto } : {}), ...o.headers },
    ...(corpo ? { method: 'POST', body: JSON.stringify(corpo) } : {}) });
  return {
    url, cfg, db, posta, chiedi,
    async chiudi() { await spegni(server); await gh.chiudi(); db.close(); rmSync(cartella, { recursive: true, force: true }); },
  };
}

// il biscotto «nome=valore» da una risposta (Set-Cookie), da rimandare con la richiesta dopo
export function biscottoDa(risposta, nome) {
  const c = risposta.headers.getSetCookie().find(x => x.startsWith(`${nome}=`));
  return c ? c.split(';')[0] : null;
}
