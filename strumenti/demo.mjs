// La piattaforma in prova, con dati finti realistici: node strumenti/demo.mjs [porta] [cartella]
// Accende anche un finto Stripe e un finto GitHub (porta+1), così ogni bottone risponde. Scrive in <cartella>/accessi.json i
// biscotti di sessione per ogni ruolo (builder, installatore, collaboratore, admin, cliente) da usare nel browser o con curl.
// Niente rete, niente chiavi vere, niente soldi: solo per guardare e provare le pagine.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { leggiConfig } from '../server/config.js';
import { apriDb } from '../server/db.js';
import { clienteStripe } from '../server/stripe.js';
import { clienteGithub } from '../server/github.js';
import { creaApp } from '../server/app.js';
import { apriSessione, cifraParola, nuovoCodice, cifra, chiaveSegreta, hashGettone } from '../server/conti.js';
import { markdownSicuro } from '../server/markdown.js';
import { dividi, gestisciEvento, quotaDi, prezzoAvvioDi, stimaStripe, quotaSviluppatoreAssistenza } from '../server/soldi.js';
import { attivitaDi } from '../server/attivita.js';
import { canone } from '../server/assistenza.js';
import { EVENTI } from '../server/notifiche.js';
import { segwitCodifica, base58check } from '../web/codifiche.js';
import { demoInInglese } from './demo-en.mjs';
const EN = process.env.DEMO_LINGUA === 'en';   // i contenuti finti in inglese (strumenti/demo-en.mjs), per le presentazioni

const porta = Number(process.argv[2] || 4610), cartella = process.argv[3] || `/tmp/demo-${porta}`;
rmSync(cartella, { recursive: true, force: true }); mkdirSync(cartella, { recursive: true });
const finta = porta + 1, F = `http://localhost:${finta}`;
// gli id del finto GitHub: sempre gli stessi per lo stesso repository e lo stesso owner (quelli della demo li prende dai prodotti)
const numero = (s, da) => da + [...String(s).toLowerCase()].reduce((n, x) => (n * 31 + x.charCodeAt(0)) % 1e6, 7);
const OWNER = { 'marta-dev': 1001, 'sami-codes': 1002, 'fattura-libera': 7777 };
const idOwner = login => OWNER[login] ?? numero(login, 2_000_000), idRepo = nome => numero(nome, 10_000_000);
createServer(async (req, res) => {   // finto Stripe e finto GitHub
  let c = ''; for await (const x of req) c += x; const p = req.url.split('?')[0];
  const r = j => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
  if (p === '/v1/checkout/sessions') {
    // ogni sessione ha il suo id e la demo la paga subito, come se Stripe avesse mandato il webhook: l'acquisto dalla cassa (poi si
    // torna sulla pagina d'installazione), la mancia, l'intervento a chiamata, la riattivazione dell'assistenza
    const f = new URLSearchParams(c), k = f.get('metadata[acquisto]') || randomBytes(6).toString('hex');
    const id = `cs_demo_${k}`, md = Object.fromEntries([...f].filter(([x]) => /^metadata\[\w+\]$/.test(x)).map(([x, v]) => [x.slice(9, -1), v]));
    const totale = [...f].filter(([x]) => /^line_items\[\d+\]\[price_data\]\[unit_amount\]$/.test(x)).reduce((t, [x, v]) => t + Number(v) * Number(f.get(x.replace('[price_data][unit_amount]', '[quantity]')) || 1), 0);
    setTimeout(() => gestisciEvento({ id: `evt_${id}_${Date.now()}`, type: 'checkout.session.completed', data: { object: { id, mode: f.get('mode'), payment_status: 'paid', amount_total: totale,
      payment_intent: f.get('mode') === 'payment' ? `pi_demo_${k}` : null, subscription: f.get('mode') === 'subscription' ? `sub_demo_${k}` : null, customer: 'cus_demo',
      customer_details: { email: f.get('customer_email') }, metadata: md } } }, { db, cfg, stripe: null }).catch(e => console.error('demo:', e.message)), 1500);
    return r({ id, url: (f.get('success_url') || f.get('return_url') || `http://localhost:${porta}/grazie?s={CHECKOUT_SESSION_ID}`).replace('{CHECKOUT_SESSION_ID}', id) });
  }
  if (p === '/v1/billing_portal/sessions') return r({ url: `http://localhost:${porta}/cliente?portale=demo` });
  if (p === '/v1/accounts') return r({ id: 'acct_demo' });
  // il pannello Stripe del conto (login_links) prima delle letture del conto: anche lui comincia con /v1/accounts/
  if (p === '/v1/account_links' || p.endsWith('/login_links')) return r({ object: 'login_link', url: `http://localhost:${porta}/area?stripe=fatto#soldi` });
  if (p.startsWith('/v1/accounts/')) return r({ id: 'acct_demo', payouts_enabled: true, details_submitted: true });
  // un repository qualsiasi: pubblico, di cui si è amministratori; quelli dei prodotti della demo con i loro dati (id, owner,
  // licenza, stelle), così «Sincronizza con GitHub» e «Rileggi da GitHub» li trovano uguali e non li sospendono
  const rr = p.match(/^\/repos\/([\w.-]+)\/([\w.-]+)$/);
  if (rr) {
    const nome = `${rr[1]}/${rr[2]}`, x = db.prepare('SELECT p.repo_id, p.licenza, p.stelle, p.descrizione, u.github_id FROM prodotto p JOIN utente u ON u.id = p.builder WHERE lower(p.repo) = lower(?)').get(nome);
    return r({ id: x?.repo_id ?? idRepo(nome), name: rr[2], full_name: nome, description: x?.descrizione ?? (EN ? 'Test project' : 'Progetto di prova'), html_url: `https://github.com/${nome}`, private: false, fork: false,
      archived: false, stargazers_count: x?.stelle ?? 42, default_branch: 'main', license: { spdx_id: x?.licenza || 'MIT' }, permissions: { admin: true }, owner: { id: x?.github_id ?? idOwner(rr[1]), login: rr[1], type: 'User' } });
  }
  if (p === '/user/repos') return r([{ id: idRepo('marta-dev/agenda-parrucchieri'), name: 'agenda-parrucchieri', full_name: 'marta-dev/agenda-parrucchieri', description: EN ? 'Bookings for hairdressers and barbers' : 'Prenotazioni per parrucchieri e barbieri', html_url: 'https://github.com/marta-dev/agenda-parrucchieri',
    private: false, fork: false, archived: false, stargazers_count: 88, license: { spdx_id: 'MIT' }, permissions: { admin: true }, owner: { type: 'User' } },
    { id: idRepo('marta-dev/appunti'), name: 'appunti', full_name: 'marta-dev/appunti', description: EN ? 'Personal notes' : 'Note personali', html_url: 'https://github.com/marta-dev/appunti', private: false, fork: false, archived: false, stargazers_count: 3, license: null, permissions: { admin: true }, owner: { type: 'User' } }]);
  res.writeHead(404); res.end('{}');
}).listen(finta);

const cfg = leggiConfig({ APP_PORTA: String(porta), APP_URL: `http://localhost:${porta}`, APP_DATI: cartella, APP_ADMIN: 'admin@demo.test', APP_NON_RIVENDICATI: '1',
  STRIPE_CHIAVE: process.env.DEMO_SENZA_CARTA ? '' : 'sk_test_' + 'd'.repeat(24), STRIPE_FIRMA: 'whsec_' + 'd'.repeat(24), STRIPE_BASE: F, GITHUB_CLIENT_ID: 'demo', GITHUB_CLIENT_SECRET: 'demo', GITHUB_API: F, GITHUB_WEB: F,
  APP_WALLET: '0x' + 'ab'.repeat(20), WALLET_BITCOIN: segwitCodifica('bc', 0, randomBytes(20)), WALLET_TRON: base58check(Buffer.concat([Buffer.from([0x41]), randomBytes(20)])),
  WALLET_SOLANA: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', APP_RETI: 'base,ethereum,polygon,solana,bitcoin,tron',
  ESCROW_BASE: '0x' + 'ec'.repeat(20), ESCROW_ETHEREUM: '0x' + 'ec'.repeat(20),   // nella demo il contratto escrow c'è su Base ed Ethereum (indirizzi finti: la catena finta non risponde, i tempi sono quelli attesi)
  ...process.env });
const db = apriDb(cartella), chiave = chiaveSegreta(cfg);
const posta = { invia: async m => { writeFileSync(join(cartella, `posta-${Date.now()}-${randomBytes(2).toString('hex')}.txt`), `A: ${m.a}\nOggetto: ${m.oggetto}\n\n${m.testo}`); return { id: 'demo' }; } };
const prezzi = { 'euro-coin': 1, 'usd-coin': .92, tether: .92, ethereum: 2480, 'polygon-ecosystem-token': .21, solana: 142, bitcoin: 58400, tron: .23 };
createServer(creaApp(cfg, { db, stripe: clienteStripe(cfg.stripe), github: clienteGithub(cfg.github), posta, rpc: async () => ({ value: { blockhash: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG' } }),
  prezzo: async id => prezzi[id] })).listen(porta);

// ---------------- i dati ----------------
const PAROLA = cifraParola('Demo-Password-2026');
const giorni = n => new Date(Date.now() - n * 864e5).toISOString().replace('T', ' ').slice(0, 19);
function utente(nome, x = {}) {
  const codice = nuovoCodice(nome, k => !!db.prepare('SELECT 1 FROM utente WHERE codice = ?').get(k));
  return db.prepare(`INSERT INTO utente (nome, email, parola, github_id, github_login, codice, zona, contratto, email_verificata, bio, avatar, wallet, wallet_btc, stripe, stripe_pronto, creato)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?, ?, ?, ?, ?, ?, ?)`)
    .run(nome, x.email || null, x.email ? PAROLA : null, x.gh_id || null, x.gh || null, codice, x.zona || null, x.bio || null, x.avatar || null, x.wallet || null, x.btc || null,
      x.stripe ? 'acct_demo' : null, x.stripe ? 1 : 0, giorni(x.da || 90)).lastInsertRowid;
}
const marta = utente('Marta Bianchi', { email: 'marta@demo.test', gh: 'marta-dev', gh_id: 1001, zona: 'Milano', bio: 'Sviluppo software per piccoli negozi. Open source da dieci anni.', avatar: 'https://avatars.githubusercontent.com/u/9919?v=4', wallet: '0x' + '12'.repeat(20), stripe: true, da: 220 });
const sami = utente('Sami Haddad', { email: 'sami@demo.test', gh: 'sami-codes', gh_id: 1002, zona: 'Torino', avatar: 'https://avatars.githubusercontent.com/u/583231?v=4', wallet: '0x' + '34'.repeat(20), stripe: true, da: 150 });
const leo = utente('Leo Ferri', { email: 'leo@demo.test', zona: 'Bergamo e provincia', bio: 'Installo gestionali e casse nei negozi di Bergamo: sopralluogo, installazione e formazione al personale, in giornata.', wallet: '0x' + '56'.repeat(20), btc: segwitCodifica('bc', 0, randomBytes(20)), stripe: true, da: 200 });
const giulia = utente('Giulia Conti', { email: 'giulia@demo.test', zona: 'Tutta Italia, da remoto', bio: 'Sistemista freelance: server, backup, configurazioni.', da: 30 });
const admin = utente('Admin', { email: 'admin@demo.test', da: 230 });   // chi gestisce la piattaforma: risponde ai clienti (l'assistenza è sua)
// il corso per installatori: Leo e Sami l'hanno superato; Giulia (la «nuova») non ancora, così si prova il corso e il test con il suo conto
db.prepare('UPDATE utente SET corso = ?, corso_punti = ? WHERE id = ?').run(giorni(190), 18, leo);
db.prepare('UPDATE utente SET corso = ?, corso_punti = ? WHERE id = ?').run(giorni(70), 19, sami);
// i wallet sulle altre reti, così si possono provare tutti i pagamenti in crypto
const sol = () => { const b = randomBytes(32); let n = 0n; for (const x of b) n = n * 256n + BigInt(x); let s = ''; const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'; while (n > 0n) { s = A[Number(n % 58n)] + s; n /= 58n; } return s; };
for (const id of [marta, sami, leo]) db.prepare('UPDATE utente SET wallet_sol = ?, wallet_btc = COALESCE(wallet_btc, ?), wallet_tron = ? WHERE id = ?')
  .run(sol(), segwitCodifica('bc', 0, randomBytes(20)), base58check(Buffer.concat([Buffer.from([0x41]), randomBytes(20)])), id);
db.prepare("UPDATE utente SET fiscale = ? WHERE id IN (?, ?, ?)").run(cifra(JSON.stringify({ tipo: 'persona', nome: 'Demo', codice: 'BNCMRT80A41F205Z', via: 'Via Roma 1', cap: '20100', citta: 'Milano', provincia: 'MI', paese: 'IT' }), chiave), marta, sami, leo);
const README = `# {{PRODOTTO}}\n\nIl gestionale per i **negozi di quartiere**: cassa, magazzino, clienti e fatture elettroniche in un posto solo.\n\n## Cosa fa\n\n- Cassa veloce con lettore di codici a barre\n- Magazzino con le scorte minime e gli ordini ai fornitori\n- Clienti, tessere fedeltà e promozioni\n- Fatture elettroniche verso lo SDI\n\n## Installazione\n\n\`\`\`bash\ndocker compose up -d\n\`\`\`\n\nPoi apri \`http://localhost:3000\` e segui la procedura guidata.\n\n| Requisito | Minimo |\n|---|---|\n| RAM | 2 GB |\n| Disco | 10 GB |\n\n> Funziona anche offline: i dati si sincronizzano quando torna la rete.\n`;
function prodotto(builder, slug, nome, repo, descr, cat, pa, pm, stelle, x = {}) {
  pm = cfg.assistenzaMese;   // il canone dell'assistenza è uno per tutti i prodotti
  const id = db.prepare(`INSERT INTO prodotto (builder, slug, repo, repo_id, url, licenza, stelle, nome, descrizione, categoria, guida, prezzo_avvio, prezzo_mese, quota_avvio, quota_mese, stato, versione, versione_url, readme, readme_html, attivita, ramo, creato)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, .30, .20, ?, ?, ?, ?, ?, ?, 'main', ?)`).run(builder, slug, repo, 5000 + Math.floor(Math.random() * 1e6), `https://github.com/${repo}`, x.licenza || 'MIT', stelle, nome, descr, cat,
    'Si installa con Docker in dieci minuti: docker compose up -d, poi si apre il browser e si segue la procedura guidata. Backup automatico ogni notte.', pa, pm, x.stato || 'pubblicato', x.versione || 'v2.3.0',
    `https://github.com/${repo}/releases`, README, markdownSicuro(README.replaceAll('{{PRODOTTO}}', nome), { repo, ramo: 'main' }), JSON.stringify(x.attivita || attivitaDi(cat)), giorni(x.da || 50)).lastInsertRowid;
  if (x.versione !== null) db.prepare("INSERT INTO versione (prodotto, tag, nome, url, pubblicata) VALUES (?, ?, ?, ?, datetime('now', '-3 days'))").run(id, x.versione || 'v2.3.0', x.versione || 'v2.3.0', `https://github.com/${repo}/releases`);
  return id;
}
const pannello = prodotto(marta, 'pannello-di-controllo', 'Pannello di Controllo', 'marta-dev/pannello-di-controllo', 'Il gestionale per i negozi di quartiere: cassa, magazzino, clienti e fatture elettroniche in un posto solo.', 'gestionale', 39000, 2900, 1240, { da: 200 });
const agenda = prodotto(marta, 'agenda-saloni', 'Agenda Saloni', 'marta-dev/agenda-saloni', 'Prenotazioni online per parrucchieri, barbieri ed estetiste, con promemoria su WhatsApp.', 'prenotazioni', 19000, 1500, 310, { da: 120 });
const tavoli = prodotto(sami, 'tavoli', 'Tavoli', 'sami-codes/tavoli', 'Comande e conto per bar e ristoranti, dal telefono del cameriere alla stampante in cucina.', 'ristorazione', 29000, 2400, 860, { da: 100 });
prodotto(sami, 'scaffale', 'Scaffale', 'sami-codes/scaffale', 'Inventario e ordini per piccoli magazzini, con le etichette da stampare.', 'magazzino', 15000, 900, 95, { stato: 'revisione' });
const seg = db.prepare("INSERT INTO utente (nome, github_id, github_login, codice, contratto, segnaposto, stato, avatar) VALUES ('fattura-libera', 7777, 'fattura-libera', 'fattura-libera-0000', '', 1, 'non_rivendicato', NULL)").run().lastInsertRowid;
const libera = prodotto(seg, 'fattura-libera', 'Fattura Libera', 'fattura-libera/fattura-libera', 'Fatture elettroniche per forfettari e piccole imprese, invio diretto allo SDI.', 'contabilità', 12000, 800, 2100, { licenza: 'AGPL-3.0' });
db.prepare("INSERT INTO collaboratore (prodotto, github_login, utente, quota, stato) VALUES (?, 'sami-codes', ?, .2, 'attivo')").run(pannello, sami);
// le percentuali di chi sviluppa: sul Pannello di Controllo Marta lascia quella di regola (80%: chi vende parte dal 20%, Leo da Top seller
// è al 35%), su Agenda Saloni sceglie il 40% per attirare più persone che vendono; Sami non l'ha scelta su Tavoli (80%)
db.prepare('UPDATE prodotto SET percentuale = ? WHERE id = ?').run(.40, agenda);
// chi vende e a che prezzo: il Pannello di Controllo lo vendono Leo a 390 €, Sami a 340 € e Giulia a 450 € (lei senza il corso non compare ancora)
for (const [i, p, z, prezzo, da] of [[leo, pannello, 'Bergamo e provincia', 39000, 185], [sami, pannello, 'Torino', 34000, 45], [giulia, pannello, 'Tutta Italia, da remoto', 45000, 20],
  [leo, tavoli, 'Bergamo e provincia', 29000, 60], [giulia, agenda, 'Tutta Italia, da remoto', 19000, 25], [leo, libera, 'Bergamo', 12000, 20]])
  db.prepare('INSERT INTO adozione (installatore, prodotto, zona, prezzo_avvio, creato) VALUES (?, ?, ?, ?, ?)').run(i, p, z, prezzo, giorni(da));
// nel beta installa anche chi gestisce la piattaforma: con BONIFICO_IBAN o POS_ALIAS i suoi clienti pagano direttamente sul suo conto
if (cfg.bonifico.iban || cfg.pos.alias) {
  db.prepare("UPDATE utente SET nome = 'Repobay Team', corso = ?, corso_punti = ? WHERE id = ?").run(giorni(200), 20, admin);
  db.prepare('INSERT INTO adozione (installatore, prodotto, zona, prezzo_avvio, creato) VALUES (?, ?, ?, ?, ?)').run(admin, pannello, 'Tutta Italia, da remoto', 37000, giorni(10));
}
// la guida a passi e le idee di applicazione del Pannello di Controllo: le sezioni interattive della pagina prodotto
db.prepare('UPDATE prodotto SET installazione = ?, idee = ? WHERE id = ?').run("{\"tempo\": \"30 minuti\", \"difficolta\": \"facile\", \"requisiti\": [\"Un mini PC o un server Linux con Docker\", \"Almeno 2 GB di RAM\", \"La stampante degli scontrini in rete, se serve la cassa\"], \"passi\": [{\"titolo\": \"Scarica il progetto\", \"testo\": \"Sul server, in una cartella dedicata, scarica la versione stabile del Pannello di Controllo.\", \"comando\": \"git clone https://github.com/marta-dev/pannello-di-controllo.git\\ncd pannello-di-controllo\", \"verifica\": \"Nella cartella c'è il file docker-compose.yml.\"}, {\"titolo\": \"Scegli l'indirizzo\", \"testo\": \"Nel file .env metti il dominio da cui il negozio aprirà il gestionale e l'email dell'amministratore.\", \"comando\": \"cp .env.esempio .env\\necho \\\"DOMINIO={{DOMINIO}}\\\" >> .env\\necho \\\"ADMIN_EMAIL={{EMAIL}}\\\" >> .env\"}, {\"titolo\": \"Genera la chiave segreta\", \"testo\": \"Il Pannello di Controllo cifra i dati dei clienti: genera una chiave e conservala nel gestore di password del negozio.\", \"comando\": \"echo \\\"SEGRETO=$(openssl rand -hex 24)\\\" >> .env\"}, {\"titolo\": \"Avvia\", \"testo\": \"Il gestionale parte con il database e si riavvia da solo se il server si riaccende.\", \"comando\": \"docker compose up -d\", \"verifica\": \"Apri http://{{IP}}:3000: compare la procedura guidata.\"}, {\"titolo\": \"Configura il negozio\", \"testo\": \"Nella procedura guidata inserisci i dati dell'attività, le aliquote IVA e i primi articoli, poi collega la stampante.\"}, {\"titolo\": \"Spiega le basi al personale\", \"testo\": \"Mezz'ora col titolare e chi sta alla cassa: vendita, reso, chiusura di giornata. Lo scontrino fiscale resta al registratore telematico.\"}], \"fonte\": \"https://github.com/marta-dev/pannello-di-controllo\"}", "[{\"attivita\": \"Cartoleria con un solo banco\", \"problema\": \"Le scorte si controllano a occhio e i quaderni finiscono a settembre.\", \"come\": \"Ogni vendita scala il magazzino e il Pannello di Controllo avvisa quando un articolo scende sotto la soglia.\", \"risultato\": \"Il riordino si fa prima che lo scaffale resti vuoto.\", \"anteprima\": {\"tipo\": \"notifica\", \"titolo\": \"Pannello di Controllo\", \"righe\": [\"Quaderni a righe A4: ne restano 6\", \"Soglia di riordino: 20\"], \"nota\": \"08:42\"}}, {\"attivita\": \"Ferramenta con due dipendenti\", \"problema\": \"I clienti abituali chiedono lo storico degli acquisti e nessuno se lo ricorda.\", \"come\": \"La scheda cliente mostra cosa ha comprato e quando, anche dal telefono.\", \"risultato\": \"Chi sta al banco ritrova in un attimo la vite comprata l'anno scorso.\", \"anteprima\": {\"tipo\": \"schermo\", \"titolo\": \"Cliente · Impresa Galli\", \"righe\": [\"12 mar · Tasselli 8 mm × 100\", \"3 giu · Silicone trasparente × 6\"]}}, {\"attivita\": \"Erboristeria in centro\", \"problema\": \"La sera la chiusura di cassa porta via mezz'ora con la calcolatrice.\", \"come\": \"A fine giornata il Pannello di Controllo mette insieme vendite, pagamenti con carta e contanti in una pagina.\", \"risultato\": \"La chiusura si fa in pochi minuti e torna con il registratore.\", \"anteprima\": {\"tipo\": \"numero\", \"titolo\": \"Chiusura di oggi\", \"righe\": [\"1.284,50 €\", \"38 vendite · 21 con carta\"], \"nota\": \"19:30\"}}]", pannello);
// gli aggiornamenti garantiti del Pannello di Controllo: Marta li offre a 9 € al mese (tolta la piattaforma, a lei e al collaboratore), la cartoleria li ha presi
db.prepare('UPDATE prodotto SET prezzo_aggiornamenti = 900, aggiornamenti_testo = ? WHERE id = ?').run('Una versione ogni mese, le correzioni di sicurezza entro 7 giorni e una risposta all\'assistenza sui problemi del codice entro 3 giorni lavorativi.', pannello);
// gli accordi 1:1: Giulia propone a Marta il 90% sul Pannello di Controllo; per Tavoli Sami propone l'80% a Leo (tutti e due in attesa di risposta)
const proposta = db.prepare('UPDATE adozione SET proposta = ?, proposta_da = ?, proposta_nota = ?, proposta_il = ? WHERE installatore = ? AND prodotto = ?');
proposta.run(.45, 'installatore', 'Faccio anche la formazione al personale, due ore in negozio.', giorni(1), giulia, pannello);
proposta.run(.40, 'builder', 'Ti preparo io la configurazione delle stampanti in cucina.', giorni(2), leo, tavoli);

// ---------------- le vendite ----------------
// In ordine di data, ognuna passa da invoice.paid come un pagamento vero (server/soldi.js): con carta prima il costo di Stripe (il
// finto Stripe non ha la transazione, quindi la stima: 1,5% + 0,25 € sul totale della fattura, diviso fra le righe), poi il 5% della
// piattaforma, poi le quote, che tengono conto del prezzo di chi vende, della percentuale di chi sviluppa, del collaboratore e del
// livello di chi vende. Il canone dell'assistenza la dà la piattaforma (ap): tolto Stripe, il 40% a chi sviluppa (qs, fissata alla
// vendita come nel checkout vero, divisa con il collaboratore) e il resto alla piattaforma; niente a chi vende.
async function vendi(chiave, nome, email, p, inst, fa, x = {}) {
  const pr = db.prepare('SELECT * FROM prodotto WHERE id = ?').get(p), q = quotaDi(db, cfg, p, inst), anno = x.periodo === 'anno', mesi = anno ? 12 : 1;
  db.prepare("INSERT INTO cliente (chiave, prodotto, installatore, quota_avvio, quota_mese, email, nome, cliente_stripe, periodo, aggiornamenti, creato) VALUES (?, ?, ?, ?, ?, ?, ?, 'cus_demo', ?, ?, ?)")
    .run(chiave, p, inst, q, q, email, nome, anno ? 'anno' : 'mese', x.aggiornamenti || null, giorni(fa));
  const ag = x.aggiornamenti ? canone(x.aggiornamenti, mesi, cfg.scontoAnno) : 0;
  const righe = [{ id: `il_${chiave}_a`, amount: prezzoAvvioDi(db, p, inst), type: 'invoiceitem' }, { id: `il_${chiave}_m`, amount: canone(pr.prezzo_mese, mesi, cfg.scontoAnno), type: 'subscription' },
    ...(ag ? [{ id: `il_${chiave}_g`, amount: ag, type: 'subscription' }] : [])];
  await gestisciEvento({ id: `evt_${chiave}`, type: 'invoice.paid', data: { object: { id: `in_${chiave}`, currency: 'eur', subscription: chiave, customer_name: nome,
    metadata: { prodotto: String(p), installatore: String(inst), ap: '1', qs: String(quotaSviluppatoreAssistenza(db, cfg, p)), ...(ag ? { ag: String(ag) } : {}) }, lines: { data: righe } } } }, { db, cfg, stripe: null }, Date.now() - fa * 864e5);
  db.prepare('UPDATE quota SET creato = ? WHERE fattura = ?').run(giorni(fa), `in_${chiave}`);
}
// Leo vende il Pannello di Controllo da quasi sei mesi: dieci negozi prima della Cartoleria, così dalla 11ª vendita è Top seller (a Marta il 10%)
const primi = ['Ferramenta Pesenti', 'Cartolibreria Rota', 'Erboristeria Locatelli', 'Ottica Belotti', 'Libreria Arnoldi', 'Merceria Gotti', 'Enoteca Carrara', 'Calzature Bonomi', 'Profumeria Mazzoleni', 'Fioreria Testa'];
for (const [j, nome] of primi.entries()) await vendi(`sub_demo_r${j}`, nome, `${nome.split(' ')[1].toLowerCase()}@demo.test`, pannello, leo, 170 - j * 13);
// i clienti delle schermate (sub_demo_0…3: assistenza, recensioni, area clienti) e le due vendite di Sami a Torino
await vendi('sub_demo_0', 'Cartoleria Russo', 'russo@demo.test', pannello, leo, 40, { periodo: 'anno', aggiornamenti: 900 });   // l'anno pagato in anticipo, con gli aggiornamenti
await vendi('sub_demo_1', 'Bar Centrale', 'bar@demo.test', tavoli, leo, 31);
await vendi('sub_demo_s0', 'Caffè Mole', 'mole@demo.test', pannello, sami, 30);
await vendi('sub_demo_2', 'Panificio Gatti', 'gatti@demo.test', pannello, leo, 22);
await vendi('sub_demo_3', 'Barberia 1987', 'barberia@demo.test', agenda, giulia, 13);
await vendi('sub_demo_s1', 'Panetteria Lingotto', 'lingotto@demo.test', pannello, sami, 9);
// le quote maturate (14 giorni) sono già versate, come farebbe il giro dei versamenti
db.prepare("UPDATE quota SET stato = 'versata', trasferimento = 'tr_demo' WHERE stato = 'in_attesa' AND disponibile <= ?").run(new Date().toISOString());
// la mancia di Marta a Leo per il Pannello di Controllo: 25 € con la carta; tolti Stripe (0,63 €, la stima) e il 5% della piattaforma, a Leo 23,15 €,
// che maturano dopo 14 giorni
const nota = 'Grazie: le tue recensioni sul Pannello di Controllo sono le migliori del catalogo.', dm = dividi(2500, 1, cfg.piattaforma, true, stimaStripe(cfg, 2500));
db.prepare("INSERT INTO mancia (da, a, prodotto, importo, nota, sessione, stato, creata, pagata) VALUES (?, ?, ?, 2500, ?, 'cs_demo_mancia', 'pagata', ?, ?)").run(marta, leo, pannello, nota, giorni(3), giorni(3));
db.prepare(`INSERT INTO quota (beneficiario, ruolo, prodotto, fattura, riga, tipo, base, frazione, importo, disponibile, creato) VALUES (?, 'installatore', ?, 'cs_demo_mancia', 'mancia', 'mancia', 2500, ?, ?, ?, ?)`)
  .run(leo, pannello, dm.installatore / 2500, dm.installatore, new Date(Date.now() + 11 * 864e5).toISOString(), giorni(3));

for (const [k, voto, testo, autore] of [[0, 5, 'Leo ci ha installato tutto in un pomeriggio e ci ha spiegato la cassa con pazienza. Consigliatissimo.', 'Cartoleria Russo'], [1, 4, 'Le comande arrivano subito in cucina. Bene!', 'Bar Centrale'], [3, 5, 'Le clienti prenotano da sole, il telefono finalmente tace.', 'Barberia 1987'],
  ['r3', 5, 'Prezzo onesto e lavoro pulito: in due ore la cassa era pronta.', 'Ottica Belotti'], ['r5', 4, 'Tutto a posto, la formazione poteva durare un po\' di più.', 'Merceria Gotti'], ['s0', 5, 'Sami è stato velocissimo, il magazzino ora torna.', 'Caffè Mole']])
  db.prepare("INSERT INTO recensione (cliente, prodotto, installatore, voto, testo, autore, creata) SELECT chiave, prodotto, installatore, ?, ?, ?, datetime('now', '-5 days') FROM cliente WHERE chiave = ?").run(voto, testo, autore, `sub_demo_${k}`);
db.prepare("UPDATE recensione SET risposta = 'Grazie a voi, a presto!' WHERE autore = 'Cartoleria Russo'").run();
// le installazioni confermate dai clienti: le dieci di Leo prima della Cartoleria, la Cartoleria, il Bar e il Caffè di Sami
db.prepare("UPDATE cliente SET confermato = datetime(creato, '+2 days') WHERE chiave LIKE 'sub_demo_r%' OR chiave IN ('sub_demo_0', 'sub_demo_1', 'sub_demo_s0')").run();
// l'assistenza la dà la piattaforma: il Bar non ha pagato il rinnovo (Stripe riprova, l'assistenza si sospende fra 4 giorni);
// ogni cliente ha il suo codice; tre richieste dalla bolla: una aperta, una con la risposta della piattaforma, una in cui la
// piattaforma ha coinvolto Leo, che ha installato la bilancia
db.prepare("UPDATE cliente SET pagamento = 'in_ritardo', insoluto_dal = ? WHERE chiave = 'sub_demo_1'").run(new Date(Date.now() - 3 * 864e5).toISOString());
for (const [k, codice] of [[0, 'demoRussoAssistenza00001'], [1, 'demoBarAssistenza0000001'], [2, 'demoGattiAssistenza00001'], [3, 'demoBarberiaAssistenza01']])
  db.prepare('UPDATE cliente SET assistenza = ? WHERE chiave = ?').run(codice, `sub_demo_${k}`);
const richiesta = (k, titolo, urgente, ore, msgs, stato = 'aperta', coinvolto = false) => {
  const c = db.prepare('SELECT * FROM cliente WHERE chiave = ?').get(`sub_demo_${k}`), t0 = Date.now() - ore * 3600e3;
  const id = db.prepare(`INSERT INTO richiesta (cliente, prodotto, installatore, titolo, urgente, stato, canale, creata, aggiornata, attesa_dal, prima_risposta) VALUES (?, ?, ?, ?, ?, ?, 'bolla', ?, ?, ?, ?)`)
    .run(c.chiave, c.prodotto, coinvolto ? c.installatore : null, titolo, urgente ? 1 : 0, stato, new Date(t0).toISOString(), new Date(Date.now() - 3600e3).toISOString(), stato === 'aperta' ? new Date(t0).toISOString() : null,
      stato === 'aperta' ? null : new Date(t0 + 2 * 3600e3).toISOString()).lastInsertRowid;
  msgs.forEach(([chi, nome, testo], i) => db.prepare('INSERT INTO messaggio (richiesta, chi, utente, nome, testo, creato) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, chi, chi === 'installatore' ? c.installatore : chi === 'piattaforma' ? admin : null, nome, testo, new Date(t0 + i * 2 * 3600e3).toISOString()));
};
richiesta(0, 'Lo scontrino di cortesia non si stampa', true, 5, [['cliente', 'Anna Russo', 'Da stamattina la stampante termica non stampa lo scontrino di cortesia. La cassa invece funziona.']]);
richiesta(0, 'Aggiungere un utente per la commessa', false, 30, [['cliente', 'Anna Russo', 'Buongiorno, ci serve un accesso per Giulia, la nuova commessa, solo per la cassa.'],
  ['piattaforma', cfg.nome, 'Fatto: Giulia entra con la sua email e vede solo la cassa. Le abbiamo mandato l\'invito.']], 'risposta');
richiesta(2, 'La bilancia non passa il peso alla cassa', false, 20, [['cliente', 'Marco Gatti', 'Da quando abbiamo spostato il banco, la bilancia non manda più il peso al Pannello di Controllo.'],
  ['piattaforma', cfg.nome, 'Il Pannello di Controllo è in ascolto, ma la bilancia non risponde in rete. Chiediamo a Leo, che l\'ha collegata, di passare a controllare il cavo.'],
  ['installatore', 'Leo Ferri', 'Passo domattina alle 9 con un cavo nuovo.']], 'risposta', true);
// il canone vale sempre: il programma della Cartoleria controllato da fuori (nei dati finti un controllo all'ora negli ultimi 45 giorni,
// davvero ogni 5 minuti), un'ora giù tre settimane fa, il certificato HTTPS che vale altri due mesi; il mese scorso una versione
// nuova e due richieste risolte, per il rapporto del mese
db.prepare("UPDATE cliente SET sito = 'https://cassa.cartoleriarusso.it', sito_stato = 'su', sito_dal = ?, sito_controllato = ?, cert_scade = ? WHERE chiave = 'sub_demo_0'")
  .run(new Date(Date.now() - 21 * 864e5 + 3600e3).toISOString(), new Date(Date.now() - 2 * 60e3).toISOString(), new Date(Date.now() + 62 * 864e5).toISOString());
const controllo = db.prepare('INSERT INTO controllo_sito (cliente, quando, ok, codice, ms, errore) VALUES (?, ?, ?, ?, ?, ?)');
for (let h = 45 * 24; h >= 0; h--) { const giu = h === 21 * 24; controllo.run('sub_demo_0', new Date(Date.now() - h * 3600e3).toISOString(), giu ? 0 : 1, giu ? null : 200, giu ? null : 180 + (h * 37) % 140, giu ? 'ETIMEDOUT' : null); }
db.prepare("INSERT INTO versione (prodotto, tag, nome, url, pubblicata, controllo) VALUES (?, 'v2.2.1', 'v2.2.1', 'https://github.com/marta-dev/pannello-di-controllo/releases', ?, 'ok')").run(pannello, giorni(26));
richiesta(0, 'Il totale di fine giornata non torna', false, 31 * 24, [['cliente', 'Anna Russo', 'Il riepilogo di ieri sera segna 12 € in meno della cassa.'],
  ['piattaforma', cfg.nome, 'Era uno scontrino annullato contato due volte: corretto, e la 2.2.1 lo sistema per sempre.']], 'risolta');
richiesta(0, 'Cambiare l\'aliquota di un prodotto', false, 28 * 24, [['cliente', 'Anna Russo', 'Le agende vanno al 22%, non al 10%.'], ['piattaforma', cfg.nome, 'Fatto: da oggi le agende escono al 22%.']], 'risolta');
db.prepare("UPDATE richiesta SET chiusa = datetime(creata, '+1 day'), aggiornata = datetime(creata, '+1 day') WHERE stato = 'risolta' AND cliente = 'sub_demo_0'").run();
// la Gelateria Valli ha chiuso l'abbonamento a fine estate: il programma funziona, l'assistenza si riattiva dalla sua pagina
// (con i tre mesi di riattivazione) e intanto ha chiesto un intervento a chiamata, con il preventivo della piattaforma da pagare
db.prepare("INSERT INTO cliente (chiave, prodotto, installatore, quota_avvio, quota_mese, email, nome, cliente_stripe, periodo, stato, creato, assistenza) VALUES ('sub_demo_v', ?, ?, 0.35, 0, 'valli@demo.test', 'Gelateria Valli', 'cus_demo', 'mese', 'cessato', ?, 'demoValliAssistenza00001')")
  .run(pannello, leo, giorni(200));
{
  const t0 = Date.now() - 26 * 3600e3;
  const id = db.prepare(`INSERT INTO richiesta (cliente, prodotto, titolo, stato, canale, creata, aggiornata, prima_risposta, a_chiamata, preventivo_ore) VALUES ('sub_demo_v', ?, ?, 'risposta', 'pagina', ?, ?, ?, 1, 1.5)`)
    .run(pannello, 'Dopo l\'aggiornamento di macOS la stampante non stampa', new Date(t0).toISOString(), new Date(t0 + 3 * 3600e3).toISOString(), new Date(t0 + 3 * 3600e3).toISOString()).lastInsertRowid;
  for (const [chi, nome, testo, ore] of [['cliente', 'Paolo Valli', 'Da quando il Mac si è aggiornato la stampante delle etichette non stampa più i gusti.', 0],
    ['piattaforma', cfg.nome, `Preventivo: 1,5 ore a ${(cfg.tariffaOra / 100).toFixed(2).replace('.', ',')} € l'ora, ${(1.5 * cfg.tariffaOra / 100).toFixed(2).replace('.', ',')} €. Lo paghi da questa pagina, con il bottone qui sopra: poi ci mettiamo al lavoro.`, 3]])
    db.prepare('INSERT INTO messaggio (richiesta, chi, utente, nome, testo, creato) VALUES (?, ?, ?, ?, ?, ?)').run(id, chi, chi === 'piattaforma' ? admin : null, nome, testo, new Date(t0 + ore * 3600e3).toISOString());
}
db.prepare("INSERT INTO contatto (installatore, prodotto, nome, email, telefono, messaggio, creato) VALUES (?, ?, 'Ferramenta Colombo', 'colombo@demo.test', '035 123456', 'Ci servirebbe la cassa con il magazzino, abbiamo due postazioni. Quando potete passare?', datetime('now', '-1 day'))").run(leo, pannello);
// le notifiche, con i testi veri del server (server/notifiche.js)
const ultima = db.prepare("SELECT importo FROM quota WHERE cliente = 'sub_demo_2' AND beneficiario = ? AND tipo = 'avvio'").get(leo).importo;   // 328,23 €: Leo è Top seller
const avvisa = (u, tipo, d, fa = 0) => { const e = EVENTI[tipo]; db.prepare('INSERT INTO notifica (utente, tipo, testo, link, creata) VALUES (?, ?, ?, ?, ?)').run(u, tipo, e.testo(d), typeof e.link === 'function' ? e.link(d) : e.link || null, giorni(fa)); };
avvisa(leo, 'livello.nuovo', { prodotto: 'Pannello di Controllo', slug: 'pannello-di-controllo', vendite: 10, livello: 1, prima: 15, percentuale: 10 }, 50);
avvisa(leo, 'vendita.nuova', { prodotto: 'Pannello di Controllo', importo: ultima, ruolo: 'installatore', cliente: 'Panificio Gatti' }, 22);
avvisa(giulia, 'percentuale.cambiata', { prodotto: 'Agenda Saloni', slug: 'agenda-saloni', da: 'Marta Bianchi', prima: 15, dopo: 10 }, 15);
avvisa(leo, 'mancia.ricevuta', { da: 'Marta Bianchi', prodotto: 'Pannello di Controllo', importo: dm.installatore, nota }, 3);
avvisa(marta, 'accordo.proposto', { prodotto: 'Pannello di Controllo', da: 'Giulia Conti', quota: 45, resto: 55, link: '/area#prodotti' }, 1);
avvisa(leo, 'accordo.proposto', { prodotto: 'Tavoli', da: 'Sami Haddad', quota: 40, resto: 60, link: '/area#installo' }, 2);
avvisa(leo, 'release.nuova', { prodotto: 'Pannello di Controllo', versione: 'v2.3.0', link: 'https://github.com/marta-dev/pannello-di-controllo/releases', slug: 'pannello-di-controllo' }, 3);
avvisa(leo, 'assistenza.coinvolto', { prodotto: 'Pannello di Controllo', cliente: 'Panificio Gatti', titolo: 'La bilancia non passa il peso alla cassa', da: cfg.nome, id: 3 }, 0);
avvisa(admin, 'assistenza.nuova', { urgente: true, cliente: 'Cartoleria Russo', prodotto: 'Pannello di Controllo', titolo: 'Lo scontrino di cortesia non si stampa', id: 1 }, 0);
db.prepare("INSERT INTO notifica (utente, tipo, testo, link) VALUES (?, 'contatto.nuovo', 'Ferramenta Colombo ti ha scritto per il Pannello di Controllo', '/area#clienti')").run(leo);
db.prepare("INSERT INTO notifica (utente, tipo, testo, link) VALUES (?, 'installatore.nuovo', 'Sami Haddad installa il Pannello di Controllo (Torino)', '/area#prodotti')").run(marta);
db.prepare("INSERT INTO notifica (utente, tipo, testo, link) VALUES (?, 'recensione.nuova', 'Nuova recensione sul Pannello di Controllo: ★★★★★', '/p/pannello-di-controllo#recensioni')").run(marta);
db.prepare("INSERT INTO aggancio (utente, url, segreto, eventi) VALUES (?, 'https://hooks.example.com/repobay', ?, '[\"vendita.nuova\",\"quota.versata\"]')").run(marta, cifra('whsec_demo', chiave));
db.prepare("INSERT INTO consegna (aggancio, evento, corpo, tentativi, prossimo, stato, risposta) VALUES (1, 'vendita.nuova', '{}', 1, datetime('now'), 'consegnata', '200')").run();
db.prepare("INSERT INTO chiave_api (utente, nome, hash, inizio) VALUES (?, 'Script contabilità', ?, 'ak_7Hd2kQp')").run(marta, randomBytes(16).toString('hex'));

// un acquisto dalla cassa, installato con il comando: la Pizzeria da Mario ha il Pannello di Controllo online, Leo ha spuntato due voci
// della personalizzazione e chiede una diagnosi (da decidere); una diagnosi di ieri è fatta, con il suo rapporto
{
  const k = 'demoAcquistoPizzeria0001', ora = Date.now(), m = x => new Date(ora - x * 60e3).toISOString();
  const passi = [['avvio', 52], ['docker', 51], ['agente', 49], ['scarico', 48], ['configuro', 46], ['accendo', 45], ['online', 44]].map(([passo, x]) => ({ passo, testo: null, il: m(x * 60) }));
  db.prepare("INSERT INTO cliente (chiave, prodotto, installatore, quota_avvio, quota_mese, email, nome, cliente_stripe, periodo, creato) VALUES ('sub_demo_pizzeria', ?, ?, 0.35, 0.35, 'mario@demo.test', 'Pizzeria da Mario', 'cus_demo', 'mese', ?)")
    .run(pannello, leo, giorni(3));
  const a = db.prepare(`INSERT INTO acquisto (codice, prodotto, installatore, attivita, nome, email, telefono, dominio, dove, periodo, lingua, metodo, stato, cliente, installazione, passi, indirizzo, ip, personalizza, agente, agente_visto, creato, aggiornato)
    VALUES (?, ?, ?, 'Pizzeria da Mario', 'Mario Esposito', 'mario@demo.test', '035 765432', 'gestionale.pizzeriadamario.it', 'mio', 'mese', 'it', 'carta', 'pagato', 'sub_demo_pizzeria', 'online', ?, 'http://93.44.12.7:8080', '93.44.12.7', ?, ?, datetime('now'), ?, datetime('now'))`)
    .run(k, pannello, leo, JSON.stringify(passi), JSON.stringify({ dominio: 'fatto', marchio: 'fatto', utenti: 'in_corso' }), randomBytes(32).toString('hex'), giorni(3)).lastInsertRowid;
  db.prepare("INSERT INTO perizia (acquisto, chi, tipo, motivo, ore, stato, chiesta, decisa, finita, rapporto, ip) VALUES (?, ?, 'diagnosi', ?, 2, 'fatta', ?, ?, ?, ?, '93.44.12.7')")
    .run(a, leo, 'Dopo l\'installazione voglio controllare che i backup notturni partano.', m(26 * 60), m(25 * 60), m(25 * 60 - 1),
      '== Server ==\nUbuntu 24.04.1 LTS · 2 CPU · uptime 1 giorno\n\n== Spazio ==\n/dev/sda1   40G   9,1G   29G  24% /\n\n== Memoria ==\nMem:  3,8Gi  1,2Gi usati  2,1Gi liberi\n\n== Contenitori ==\npannello-app   Up 24 hours   0.0.0.0:8080->3000/tcp\npannello-db    Up 24 hours (healthy)\n\n== Ultimi errori ==\nnessuno nelle ultime 24 ore\n\n== Impostazioni (.env) ==\nDATABASE_URL=********\nSESSION_SECRET=********\nBACKUP_ORA=03:00');
  db.prepare("INSERT INTO perizia (acquisto, chi, tipo, motivo, ore, stato, chiesta) VALUES (?, ?, 'diagnosi', ?, 2, 'chiesta', ?)")
    .run(a, leo, 'Mario mi dice che da stamattina la cassa è lenta: voglio guardare memoria e log prima di passare in pizzeria.', m(12));
}

// le sessioni di prova, una per ruolo
const accesso = id => `sessione=${apriSessione(db, id, null, { agente: 'Chrome su macOS', ip: '93.44.12.0', metodo: 'parola' }).gettone}`;
const tc = randomBytes(32).toString('base64url'); db.prepare('INSERT INTO sessione_cliente (token, email, scade) VALUES (?, ?, ?)').run(hashGettone(tc), 'russo@demo.test', new Date(Date.now() + 7 * 864e5).toISOString());
const accessi = { url: `http://localhost:${porta}`, builder: accesso(marta), collaboratore: accesso(sami), installatore: accesso(leo), nuovo: accesso(giulia),
  admin: accesso(admin), cliente: `cliente=${tc}`, assistenza: `http://localhost:${porta}/assistenza/demoRussoAssistenza00001`, assistenzaChiusa: `http://localhost:${porta}/assistenza/demoValliAssistenza00001`, installazione: `http://localhost:${porta}/installa/demoAcquistoPizzeria0001`, cassa: `http://localhost:${porta}/compra/pannello-di-controllo`, password: 'Demo-Password-2026',
  email: { builder: 'marta@demo.test', installatore: 'leo@demo.test', admin: 'admin@demo.test' } };
if (EN) demoInInglese(db, cfg);
writeFileSync(join(cartella, 'accessi.json'), JSON.stringify(accessi, null, 2));
console.log(`DEMO PRONTA ${accessi.url} (accessi in ${join(cartella, 'accessi.json')})`);
