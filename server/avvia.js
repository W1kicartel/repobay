// Avvio: node server/avvia.js (le impostazioni nelle variabili d'ambiente, vedi docs/AVVIO.md)
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { leggiConfig } from './config.js';
import { apriDb } from './db.js';
import { clienteStripe } from './stripe.js';
import { clienteGithub } from './github.js';
import { clientePosta } from './posta.js';
import { creaApp } from './app.js';
import { clienteRpc, clientePrezzi } from './web3.js';
import { idPrezzi, retiAccese } from './reti.js';
import { chiaveSegreta } from './conti.js';
import { avviaLavori } from './lavori.js';
import { creaSincronizzazione } from './sincronizza.js';

const cfg = leggiConfig();
const db = apriDb(cfg.dati);
const stripe = clienteStripe(cfg.stripe);
const github = clienteGithub(cfg.github);
const posta = clientePosta(cfg.posta);
const rpc = clienteRpc();
const app = creaApp(cfg, { db, stripe, github, rpc, prezzo: clientePrezzi(cfg.crypto.prezzi, idPrezzi()), posta });
const server = createServer(app);
server.headersTimeout = 20_000; server.requestTimeout = 30_000;
server.listen(cfg.porta, cfg.host, () => {
  console.log(`${cfg.nome} è acceso: ${cfg.url}`);
  const avviso = m => console.log(`  attenzione: ${m}`);
  if (!cfg.stripe.chiave) avviso('manca STRIPE_CHIAVE (iscrizioni sì, pagamenti con carta no)');
  if (!cfg.stripe.firme.length) avviso('manca STRIPE_FIRMA (il webhook rifiuta tutto)');
  if (!cfg.github.id || !cfg.github.segreto) avviso('manca l\'app GitHub (GITHUB_CLIENT_ID e GITHUB_CLIENT_SECRET): i builder non possono entrare');
  if (cfg.posta.driver === 'console') avviso('le email finiscono nel terminale (POSTA_DRIVER=console): per mandarle davvero vedi docs/AVVIO.md');
  if (!retiAccese(cfg).length) console.log('  i pagamenti in crypto sono spenti: manca APP_WALLET (o WALLET_SOLANA, WALLET_BITCOIN, WALLET_TRON)');
  if (/^sk_live_|^rk_live_/.test(cfg.stripe.chiave)) console.log('  chiave LIVE: i pagamenti sono veri');
  if (cfg.stripe.perConto) console.log('  Stripe «per conto»: il venditore davanti ai clienti è l\'installatore');
  if (!cfg.segreto) avviso('manca APP_SEGRETO: la chiave di cifratura è nel file dati/segreto.key (fanne una copia sicura)');
});
// il bot di Telegram: le notifiche arrivano al webhook /api/telegram, con un segreto nell'intestazione
if (cfg.telegram.bot && cfg.url.startsWith('https://')) {
  const segreto = createHash('sha256').update(`${cfg.telegram.bot}:${chiaveSegreta(cfg).toString('hex')}`).digest('hex').slice(0, 48);
  fetch(`https://api.telegram.org/bot${cfg.telegram.bot}/setWebhook`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: `${cfg.url}/api/telegram`, secret_token: segreto, allowed_updates: ['message'] }) })
    .then(r => r.json()).then(j => console.log(j.ok ? '  Telegram collegato' : `  Telegram: ${j.description}`)).catch(e => console.error('Telegram:', e.message));
}
const notifiche = app.notifiche;   // le stesse dell'app: due istanze consegnerebbero due volte lo stesso webhook
avviaLavori({ db, cfg, stripe, notifiche, rpc, cercaDepositi: app.cercaDepositi, controlli: app.controlli,
  sincronizzazione: creaSincronizzazione({ db, github, notifiche, cfg, controlli: app.controlli }) });
// spegnimento pulito: si finiscono le richieste in corso, poi si chiude il database
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => { console.log('spengo…'); server.close(() => { db.close(); process.exit(0); }); setTimeout(() => process.exit(0), 8000).unref(); });
