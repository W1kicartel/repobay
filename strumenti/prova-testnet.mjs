// La prova con le reti di PROVA vere (monete senza valore): il giro completo dei pagamenti in crypto con le blockchain vere.
//   ordine (rotta vera) → pagamento firmato qui e mandato davvero in rete → conferma (rotta vera, verifica sulla catena vera)
//   → quote registrate nel database.
// L'app si accende in processo, con un database in memoria, le reti di prova, prezzi finti fissi e l'RPC vero (clienteRpc()).
//
//   node strumenti/prova-testnet.mjs --rete solana-devnet|base-sepolia|tron-nile|bitcoin-testnet4|tutte [--cartella dir]
//        [--attesa minuti]   (Bitcoin: quanto aspettare il pagamento fatto a mano; predefinito 40)
//        [--limite minuti]   (il tempo massimo di tutta la prova; predefinito 60)
//
// Le chiavi di prova (pagatore, builder, installatore, piattaforma) stanno solo in <cartella>/chiavi.json e non si stampano mai
// per intero: rilanciando con la stessa --cartella si riusano (così le monete prese dai faucet restano utilizzabili).
// - solana-devnet: va da sola (SOL dall'airdrop della devnet; se l'airdrop è esaurito, SOL di devnet dal faucet web).
// - base-sepolia: serve ETH di prova e USDC di prova sull'indirizzo del pagatore (lo script lo stampa e si ferma se è vuoto).
// - tron-nile: serve TRX di prova dal faucet di Nile.
// - bitcoin-testnet4: con tBTC sul pagatore paga da solo (P2WPKH, BIP143); senza, stampa gli URI BIP21 e i QR per pagare da un
//   wallet testnet4; in tutti e due i casi la rotta cerca il pagamento senza txid, con un limite di tempo.
// Senza monete di prova ogni rete fa comunque la «prova a secco» sulla rete vera: la transazione costruita dalla rotta (o dallo
// script) e firmata qui arriva al nodo vero, che la decodifica, ne controlla la firma e la rifiuta solo per i fondi mancanti;
// la conferma via rotta, che interroga la rete vera, risponde «in attesa» come deve. Prima di firmare, ogni codifica è provata
// con vettori noti (RLP di ethereum.org, EIP-155, transazioni vere di Base Sepolia ricostruite, l'esempio P2WPKH di BIP143).
import { createServer } from 'node:http';
import { generateKeyPairSync, createPrivateKey, createPublicKey, createECDH, createHash, randomBytes, sign } from 'node:crypto';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { leggiConfig } from '../server/config.js';
import { apriDb } from '../server/db.js';
import { clienteStripe } from '../server/stripe.js';
import { clienteGithub } from '../server/github.js';
import { creaApp } from '../server/app.js';
import { clienteRpc } from '../server/web3.js';
import { keccak256, indirizzoDaChiave, firmaHash, recupera, checksum } from '../server/cripto.js';
import { base58 } from '../web/base58.js';
import { base58check, segwitCodifica, segwitDecodifica } from '../web/codifiche.js';
import { RETI_SOLANA, PROGRAMMI } from '../server/solana.js';
import { RETI_TRON, hexInTron } from '../server/tron.js';
import { RETI_BITCOIN } from '../server/bitcoin.js';
import { RETI } from '../server/web3.js';

// ---------------- argomenti, tempo, stampa ----------------
const arg = (n, def) => { const i = process.argv.indexOf(`--${n}`); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def; };
const TUTTE_LE_RETI = ['solana-devnet', 'base-sepolia', 'tron-nile', 'bitcoin-testnet4'];
const scelta = arg('rete', '');
if (!['tutte', ...TUTTE_LE_RETI].includes(scelta)) {
  console.error('Uso: node strumenti/prova-testnet.mjs --rete solana-devnet|base-sepolia|tron-nile|bitcoin-testnet4|tutte [--cartella dir] [--attesa minuti] [--limite minuti]');
  process.exit(1);
}
const INIZIO = Date.now(), LIMITE = Number(arg('limite', 60)) * 60e3, ATTESA_BTC = Number(arg('attesa', 40)) * 60e3;
const ora = () => new Date().toTimeString().slice(0, 8);
const passo = (rete, testo) => console.log(`${ora()} [${rete}] ${testo}`);
const dormi = ms => new Promise(r => setTimeout(r, ms));
// ogni attesa ha un limite: una promessa che non risponde entro ms diventa un errore
const conLimite = (p, ms, cosa) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`${cosa}: nessuna risposta entro ${Math.round(ms / 1000)} s`)), ms).unref())]);
// riprova fn finché dà un valore (non undefined), al massimo per ms, ogni «ogni» ms
async function finche(fn, { ms, ogni = 3000, cosa }) {
  const fine = Date.now() + ms; let ultimo;
  for (;;) {
    try { const v = await fn(); if (v !== undefined) return v; } catch (e) { if (e.definitivo) throw e; ultimo = e; }
    if (Date.now() + ogni > fine) throw new Error(`${cosa}: tempo scaduto (${Math.round(ms / 1000)} s)${ultimo ? ' — ultimo errore: ' + ultimo.message : ''}`);
    await dormi(ogni);
  }
}
// il guardiano: a tempo finito si esce comunque (niente processi lasciati accesi)
setTimeout(() => { console.error(`\n${ora()} Tempo massimo (${LIMITE / 60e3} min) finito: esco.`); stampaRapporto(); process.exit(3); }, LIMITE).unref();
const scaduto = () => Date.now() - INIZIO > LIMITE - 30e3;
const breve = s => (s.length > 16 ? `${s.slice(0, 8)}…${s.slice(-6)}` : s);

// ---------------- la cartella e le chiavi di prova ----------------
const cartella = resolve(arg('cartella', '') || mkdtempSync(join(tmpdir(), 'prova-testnet-')));
mkdirSync(cartella, { recursive: true, mode: 0o700 });
const FILE_CHIAVI = join(cartella, 'chiavi.json');
const RUOLI = ['pagatore', 'builder', 'installatore', 'piattaforma'];
const N_SECP = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
function nuovaSecp() { for (;;) { const k = randomBytes(32), v = BigInt('0x' + k.toString('hex')); if (v > 0n && v < N_SECP) return k.toString('hex'); } }
function nuovaEd() { return generateKeyPairSync('ed25519').privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32).toString('hex'); }
function caricaChiavi() {
  const c = existsSync(FILE_CHIAVI) ? JSON.parse(readFileSync(FILE_CHIAVI, 'utf8')) : { nota: 'Chiavi di PROVA (reti di prova, monete senza valore). Non usarle mai con soldi veri.' };
  let nuove = false;
  for (const r of RUOLI) { c[r] ||= {}; if (!c[r].secp256k1) { c[r].secp256k1 = nuovaSecp(); nuove = true; } if (!c[r].ed25519) { c[r].ed25519 = nuovaEd(); nuove = true; } }
  if (nuove) writeFileSync(FILE_CHIAVI, JSON.stringify(c, null, 2), { mode: 0o600 });
  return c;
}
const ED_PKCS8 = Buffer.from('302e020100300506032b657004220420', 'hex');
const hash160 = b => createHash('ripemd160').update(createHash('sha256').update(b).digest()).digest();
// da una chiave: gli indirizzi su tutte le reti
function identita(k) {
  const secp = Buffer.from(k.secp256k1, 'hex'), seme = Buffer.from(k.ed25519, 'hex');
  const ed = createPrivateKey({ key: Buffer.concat([ED_PKCS8, seme]), format: 'der', type: 'pkcs8' });
  const pubEd = createPublicKey(ed).export({ format: 'der', type: 'spki' }).subarray(-32);   // la chiave pubblica: gli ultimi 32 byte di SPKI
  const ecdh = createECDH('secp256k1'); ecdh.setPrivateKey(secp);
  const evm = indirizzoDaChiave(secp);
  // controllo incrociato: l'indirizzo EVM di cripto.js deve coincidere con keccak(chiave pubblica di OpenSSL)
  const daOpenssl = checksum('0x' + keccak256(ecdh.getPublicKey().subarray(1)).subarray(12).toString('hex'));
  if (daOpenssl !== evm) throw new Error('indirizzoDaChiave non coincide con OpenSSL');
  return {
    secp, ed, evm, sol: base58.codifica(pubEd),
    tron: hexInTron('41' + evm.slice(2).toLowerCase()),
    btc: segwitCodifica('tb', 0, hash160(ecdh.getPublicKey(null, 'compressed'))),
  };
}

// ---------------- l'app in processo ----------------
const PREZZI = { solana: 1000, ethereum: 2500, 'usd-coin': 0.92, 'euro-coin': 1, tron: 0.25, bitcoin: 50000, tether: 0.92 };   // euro, finti e fissi
// i prezzi dei prodotti (centesimi) scelti per i prezzi finti: ogni parte sopra i minimi delle reti
//  - Solana: 10 € + 1 €/mese × 12 = 22 € = 0,022 SOL; la parte più piccola (piattaforma) 2.200.000 lamport ≥ 890.880 (affitto)
//  - Base Sepolia: 1 € + 0,10 €/mese × 12 = 2,2 € = 0,00088 ETH o 2,391305 USDC
//  - Tron Nile: 5 € + 0,10 €/mese × 12 = 6,2 € = 24,8 TRX
//  - Bitcoin testnet4: 10 € = 20.000 sat; la piattaforma 2.000 sat (+ 1-999 casuali) sopra la soglia di polvere (294 sat)
const PRODOTTI = {
  'solana-devnet': { prezzo_avvio: 1000, prezzo_mese: 100 },
  'base-sepolia': { prezzo_avvio: 100, prezzo_mese: 10 },
  'tron-nile': { prezzo_avvio: 500, prezzo_mese: 10 },
  'bitcoin-testnet4': { prezzo_avvio: 1000, prezzo_mese: 0 },
};
const vero = clienteRpc();
const rpc = (url, metodo, params) => conLimite(vero(url, metodo, params), 30e3, `RPC ${metodo}`);   // il client vero, con un limite di tempo

async function accendiApp(id) {
  const env = { APP_URL: 'http://localhost:4600', APP_DATI: ':memory:', APP_NOME: 'Repobay', APP_RETI: TUTTE_LE_RETI.join(','),
    APP_WALLET: id.piattaforma.evm, WALLET_SOLANA: id.piattaforma.sol, WALLET_BITCOIN: id.piattaforma.btc, WALLET_TRON: id.piattaforma.tron };
  const cfg = leggiConfig(env), db = apriDb(':memory:');
  const gestore = creaApp(cfg, { db, stripe: clienteStripe(cfg.stripe), github: clienteGithub(cfg.github), rpc, prezzo: async x => PREZZI[x] });
  const server = await new Promise(ok => { const s = createServer(gestore).listen(0, '127.0.0.1', () => ok(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  // un builder e un installatore con i wallet di tutte le reti, un prodotto pubblicato per rete, adottato dall'installatore
  const utente = (nome, codice, u) => db.prepare(`INSERT INTO utente (nome, codice, contratto, stato, wallet, wallet_sol, wallet_btc, wallet_tron) VALUES (?, ?, ?, 'attivo', ?, ?, ?, ?)`)
    .run(nome, codice, new Date().toISOString(), u.evm, u.sol, u.btc, u.tron).lastInsertRowid;
  const builder = utente('Builder di prova', 'builder-prova', id.builder), inst = utente('Installatore di prova', 'installatore-prova', id.installatore);
  let repo = 900;
  for (const [rete, p] of Object.entries(PRODOTTI)) {
    const pid = db.prepare(`INSERT INTO prodotto (builder, slug, repo, repo_id, url, licenza, nome, prezzo_avvio, prezzo_mese, quota_avvio, quota_mese, stato)
      VALUES (?, ?, ?, ?, ?, 'MIT', ?, ?, ?, 0.30, 0.20, 'pubblicato')`).run(builder, `prova-${rete}`, `prova/${rete}`, ++repo, `https://github.com/prova/${rete}`, `Prova ${rete}`, p.prezzo_avvio, p.prezzo_mese).lastInsertRowid;
    db.prepare('INSERT INTO adozione (installatore, prodotto) VALUES (?, ?)').run(inst, pid);
  }
  const chiama = async (percorso, corpo) => {
    const r = await conLimite(fetch(base + percorso, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) }), 90e3, percorso);
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    return { stato: r.status, j };
  };
  const ordine = async (rete, simbolo) => {
    const o = await chiama('/api/crypto/ordine', { prodotto: `prova-${rete}`, installatore: 'installatore-prova', rete, simbolo, email: 'business@prova.test' });
    if (o.stato !== 201) throw new Error(`ordine ${rete} ${simbolo}: ${o.stato} ${JSON.stringify(o.j)}`);
    return o.j;
  };
  // la conferma via rotta, riprovando mentre risponde 202 (attesa) o la rete non risponde, con un limite
  const conferma = async (rete, codice, tx, ms, ogni = 5000) => {
    let ultima = null;
    return finche(async () => {
      const c = await chiama('/api/crypto/conferma', { codice, tx });
      if (c.stato === 200) return c.j;
      if (c.stato === 202 || c.stato === 502 || c.stato === 503) { if (c.j?.attesa !== ultima) passo(rete, `  conferma: ${c.stato} ${c.j?.attesa || c.j?.errore || ''}`); ultima = c.j?.attesa; return undefined; }
      throw Object.assign(new Error(`conferma: ${c.stato} ${JSON.stringify(c.j)}`), { definitivo: true, risposta: c });
    }, { ms, ogni, cosa: 'conferma' });
  };
  // le quote registrate per un ordine pagato
  const quote = codice => db.prepare('SELECT q.ruolo, q.riga, q.importo, q.stato, q.pagamento, u.nome FROM quota q JOIN utente u ON u.id = q.beneficiario WHERE q.fattura = ? ORDER BY q.ruolo, q.riga').all(`cr_${codice}`);
  const statoOrdine = codice => db.prepare('SELECT stato, pagatore, tx FROM ordine WHERE codice = ?').get(codice);
  const chiudi = () => new Promise(ok => { server.closeAllConnections?.(); server.close(() => { try { db.close(); } catch { } ok(); }); });
  return { base, db, chiama, ordine, conferma, quote, statoOrdine, chiudi };
}

// le quote attese: builder e installatore, avvio (e mese se il prodotto ha il canone), tutte «versata», col pagamento giusto
function controllaQuote(rete, app, codice, prodotto, tx0) {
  const q = app.quote(codice), o = app.statoOrdine(codice);
  const righe = prodotto.prezzo_mese > 0 ? ['avvio', 'mese'] : ['avvio'];
  const attese = ['builder', 'installatore'].flatMap(r => righe.map(g => `${r}:${g}`)).sort();
  const viste = q.map(x => `${x.ruolo}:${x.riga}`).sort();
  const problemi = [];
  if (o.stato !== 'pagato') problemi.push(`ordine in stato ${o.stato}`);
  if (JSON.stringify(attese) !== JSON.stringify(viste)) problemi.push(`quote ${viste.join(',')} invece di ${attese.join(',')}`);
  if (!q.every(x => x.stato === 'versata' && x.importo > 0)) problemi.push('quote non versate o a zero');
  if (tx0 && !q.every(x => String(x.pagamento).toLowerCase() === String(tx0).toLowerCase())) problemi.push('il pagamento delle quote non è la transazione');
  for (const x of q) passo(rete, `  quota ${x.ruolo}/${x.riga}: ${(x.importo / 100).toFixed(2)} € ${x.stato}`);
  if (problemi.length) throw new Error('Quote: ' + problemi.join('; '));
  return q;
}

// ---------------- il rapporto ----------------
const RAPPORTO = [];   // { rete, esito: 'provata' | 'aspetta' | 'errore', righe: [] }
function stampaRapporto() {
  console.log('\n================ RAPPORTO ================');
  console.log(`cartella delle chiavi: ${cartella}   (durata ${Math.round((Date.now() - INIZIO) / 1000)} s)`);
  for (const r of RAPPORTO) {
    console.log(`\n${r.rete}: ${{ provata: 'PROVATA IN RETE', aspetta: 'PRONTA, ASPETTA LE MONETE DI PROVA', errore: 'ERRORE' }[r.esito] || r.esito}`);
    for (const x of r.righe) console.log('  - ' + x);
  }
  console.log('==========================================');
}

// ======================================================================================================================
// SOLANA DEVNET: tutto da solo (airdrop, transazione dalla rotta, firma ed25519, invio, conferma con e senza firma)
// ======================================================================================================================
const cu16 = (b, o) => { let v = 0, s = 0; for (;;) { const x = b[o.i++]; v |= (x & 0x7f) << s; if (!(x & 0x80)) return v; s += 7; } };
// legge la transazione legacy della rotta: firme, messaggio (tutto dopo le firme), chiavi e istruzioni
function leggiTxSolana(b64) {
  const b = Buffer.from(b64, 'base64'), o = { i: 0 };
  const nf = cu16(b, o), slot = o.i; o.i += 64 * nf;
  const messaggio = b.subarray(o.i), header = [...b.subarray(o.i, o.i + 3)]; o.i += 3;
  const chiavi = []; for (let n = cu16(b, o); n--; o.i += 32) chiavi.push(base58.codifica(b.subarray(o.i, o.i + 32)));
  o.i += 32;   // blockhash
  const istruzioni = [];
  for (let n = cu16(b, o); n--;) {
    const programma = chiavi[b[o.i++]], nc = cu16(b, o), conti = [...b.subarray(o.i, o.i + nc)].map(k => chiavi[k]); o.i += nc;
    const nd = cu16(b, o), dati = b.subarray(o.i, o.i + nd); o.i += nd;
    istruzioni.push({ programma, conti, dati });
  }
  if (o.i !== b.length) throw new Error('transazione Solana: byte in più');
  return { b, nf, slot, messaggio, header, chiavi, istruzioni };
}

async function provaSolana(id, app) {
  const R = 'solana-devnet', rete = RETI_SOLANA[R], url = rete.rpc, righe = [];
  const giro = { rete: R, esito: 'errore', righe }; RAPPORTO.push(giro);
  const pag = id.pagatore, link = s => `https://explorer.solana.com/tx/${s}?cluster=devnet`;
  passo(R, `pagatore ${pag.sol}; builder ${breve(id.builder.sol)}, installatore ${breve(id.installatore.sol)}, piattaforma ${breve(id.piattaforma.sol)}`);
  // Senza SOL: tutto quello che si può provare sulla devnet vera senza spendere. La transazione della rotta (blockhash vero),
  // firmata qui, passa a simulateTransaction con sigVerify: la rete la legge, controlla blockhash e firma e si ferma solo
  // perché il pagatore non ha un conto (AccountNotFound). Controprova: con la firma rovinata la rete rifiuta la firma.
  // Poi la conferma via rotta sulla devnet vera: senza pagamento deve rispondere 202 (attesa), con e senza la firma.
  async function provaASecco() {
    passo(R, 'prova a secco sulla devnet vera (senza SOL non si può mandare il pagamento)');
    const { o, tx, firmaB58 } = await preparaEFirma('a secco');
    const simula = b => rpc(url, 'simulateTransaction', [b.toString('base64'), { encoding: 'base64', sigVerify: true, commitment: 'confirmed' }]);
    const sim = await simula(tx.b);
    const err = JSON.stringify(sim?.value?.err);
    if (err !== '"AccountNotFound"') throw new Error(`simulateTransaction: atteso AccountNotFound (pagatore senza SOL), arrivato ${err}`);
    passo(R, '  simulateTransaction (sigVerify): messaggio, blockhash e firma accettati; si ferma solo per il pagatore vuoto (AccountNotFound)');
    const rovinata = Buffer.from(tx.b); rovinata[tx.slot] ^= 1;
    const no = await simula(rovinata).then(r => JSON.stringify(r?.value?.err), e => e.message);
    if (!/signature|Signature/.test(no)) throw new Error(`controprova: con la firma rovinata la rete risponde ${no}`);
    passo(R, `  controprova con la firma rovinata: ${no.slice(0, 80)}`);
    const c1 = await app.chiama('/api/crypto/conferma', { codice: o.codice, tx: [firmaB58] });
    const c2 = await app.chiama('/api/crypto/conferma', { codice: o.codice, tx: [] });
    if (c1.stato !== 202 || c2.stato !== 202) throw new Error(`conferma senza pagamento: ${c1.stato} ${JSON.stringify(c1.j)} / ${c2.stato} ${JSON.stringify(c2.j)}`);
    passo(R, `  conferma via rotta senza pagamento: 202 «${c1.j.attesa}» (con la firma), 202 «${c2.j.attesa}» (col riferimento)`);
    righe.push('prova a secco sulla devnet vera: transazione della rotta firmata qui e accettata da simulateTransaction con sigVerify',
      '(si ferma solo su AccountNotFound del pagatore vuoto; la firma rovinata è rifiutata); la conferma via rotta risponde 202 come deve');
    // USDC: la transazione SPL della rotta (conti token associati + TransferChecked + riferimento + memo), stessa prova
    const ou = await app.ordine(R, 'USDC'), tu = await app.chiama('/api/solana/tx', { codice: ou.codice, account: pag.sol });
    if (tu.stato !== 200) throw new Error(`/api/solana/tx USDC: ${tu.stato} ${JSON.stringify(tu.j)}`);
    const txu = leggiTxSolana(tu.j.transazione); sign(null, txu.messaggio, pag.ed).copy(txu.b, txu.slot);
    const simu = JSON.stringify((await simula(txu.b))?.value?.err);
    if (simu !== '"AccountNotFound"') throw new Error(`simulateTransaction USDC: atteso AccountNotFound, arrivato ${simu}`);
    passo(R, `  USDC: ordine ${ou.codice} (${ou.parti.map(p => `${p.ruolo} ${Number(p.unita) / 1e6}`).join(', ')}), ${txu.istruzioni.length} istruzioni: simulazione fino al pagatore vuoto`);
    righe.push('USDC (SPL): anche la transazione con conti token associati e TransferChecked passa la simulazione fino al pagatore vuoto');
  }

  // 1. SOL al pagatore: l'airdrop della devnet (limitato: pochi tentativi distanziati, con un limite di tempo)
  const BISOGNO = 60_000_000n;   // due ordini da 0,022 SOL più le commissioni
  let saldo = BigInt((await rpc(url, 'getBalance', [pag.sol, { commitment: 'confirmed' }])).value);
  passo(R, `saldo del pagatore: ${Number(saldo) / 1e9} SOL`);
  if (saldo < BISOGNO) {
    const fine = Date.now() + 4 * 60e3; let firmaAirdrop = null, tentativo = 0, limiteOggi = 0;
    for (const quanto of [1e9, 1e9, 5e8, 5e8, 2e8, 1e8]) {
      if (Date.now() > fine) break;
      tentativo++;
      try { firmaAirdrop = await rpc(url, 'requestAirdrop', [pag.sol, quanto, { commitment: 'confirmed' }]); passo(R, `airdrop di ${quanto / 1e9} SOL chiesto: ${breve(firmaAirdrop)}`); break; }
      catch (e) {
        passo(R, `airdrop rifiutato (tentativo ${tentativo}): ${e.message.slice(0, 110)}`);
        if (/limit today/.test(e.message) && ++limiteOggi >= 2) break;   // il limite è giornaliero: insistere non serve
        await dormi(Math.min(15e3 * tentativo, Math.max(0, fine - Date.now())));
      }
    }
    if (!firmaAirdrop) {
      giro.esito = 'aspetta';
      righe.push(`L'airdrop della devnet ha rifiutato tutte le richieste (limite giornaliero per IP). Manda almeno 0,06 SOL di devnet a`,
        `   ${pag.sol}`, 'da https://faucet.solana.com (devnet, con l\'accesso GitHub) e rilancia con la stessa --cartella:',
        `   node strumenti/prova-testnet.mjs --rete solana-devnet --cartella ${cartella}`);
      await provaASecco();
      return;
    }
    saldo = await finche(async () => { const s = BigInt((await rpc(url, 'getBalance', [pag.sol, { commitment: 'confirmed' }])).value); return s >= BISOGNO ? s : undefined; },
      { ms: 90e3, ogni: 3000, cosa: 'arrivo dell\'airdrop' });
    passo(R, `saldo del pagatore: ${Number(saldo) / 1e9} SOL`);
  }

  // ordine → transazione dalla rotta → controllo → firma (non ancora mandata)
  async function preparaEFirma(etichetta) {
    const o = await app.ordine(R, 'SOL');
    passo(R, `${etichetta}: ordine ${o.codice}, ${o.euro / 100} € → ${o.parti.map(p => `${p.ruolo} ${p.unita}`).join(', ')} lamport`);
    for (const p of o.parti) if (BigInt(p.unita) < 890_880n) throw new Error(`la parte ${p.ruolo} (${p.unita} lamport) è sotto il minimo per l'affitto`);
    const t = await app.chiama('/api/solana/tx', { codice: o.codice, account: pag.sol });
    if (t.stato !== 200) throw new Error(`/api/solana/tx: ${t.stato} ${JSON.stringify(t.j)}`);
    const tx = leggiTxSolana(t.j.transazione);
    // prima di firmare: il pagatore è il primo conto, una firma sola, e i trasferimenti sono esattamente le parti dell'ordine
    if (tx.nf !== 1 || tx.chiavi[0] !== pag.sol || tx.header[0] !== 1) throw new Error('transazione Solana: firmatari inattesi');
    const trasferimenti = tx.istruzioni.filter(x => x.programma === PROGRAMMI.sistema).map(x => {
      if (x.dati.readUInt32LE(0) !== 2) throw new Error('istruzione di sistema inattesa');
      return { a: x.conti[1], da: x.conti[0], lamport: x.dati.readBigUInt64LE(4).toString() };
    });
    const atteso = o.parti.map(p => `${p.indirizzo}:${p.unita}`).sort().join(), visto = trasferimenti.map(x => `${x.a}:${x.lamport}`).sort().join();
    if (atteso !== visto || trasferimenti.some(x => x.da !== pag.sol)) throw new Error(`la transazione non paga le parti dell'ordine:\n ${visto}\n ${atteso}`);
    if (!tx.istruzioni.some(x => x.programma === PROGRAMMI.memo && x.dati.toString().includes(o.codice))) throw new Error('manca il memo dell\'ordine');
    // la firma ed25519 del messaggio (tutto dopo le firme) va nello slot
    const firma = sign(null, tx.messaggio, pag.ed);
    firma.copy(tx.b, tx.slot);
    return { o, tx, firmaB58: base58.codifica(firma) };
  }
  // un pagamento vero: preparato e firmato, mandato in rete e confermato
  async function paga(etichetta) {
    const { o, tx, firmaB58 } = await preparaEFirma(etichetta);
    const inviata = await rpc(url, 'sendTransaction', [tx.b.toString('base64'), { encoding: 'base64', preflightCommitment: 'confirmed' }]);
    if (inviata !== firmaB58) throw new Error(`la rete risponde con un'altra firma: ${inviata}`);
    passo(R, `${etichetta}: transazione mandata ${firmaB58}`);
    await finche(async () => {
      const st = (await rpc(url, 'getSignatureStatuses', [[firmaB58]]))?.value?.[0];
      if (st?.err) throw Object.assign(new Error('transazione fallita in rete: ' + JSON.stringify(st.err)), { definitivo: true });
      return st && ['confirmed', 'finalized'].includes(st.confirmationStatus) ? st : undefined;
    }, { ms: 90e3, ogni: 2000, cosa: 'conferma in rete' });
    passo(R, `${etichetta}: confermata in rete → ${link(firmaB58)}`);
    return { o, firma: firmaB58 };
  }

  // 2. primo ordine: conferma CON la firma
  const a = await paga('ordine 1');
  const c1 = await app.conferma(R, a.o.codice, [a.firma], 120e3);
  if (c1.pagatore !== pag.sol) throw new Error(`pagatore registrato ${c1.pagatore}, atteso ${pag.sol}`);
  passo(R, `ordine 1: conferma via rotta OK (pagatore ${breve(c1.pagatore)})`);
  controllaQuote(R, app, a.o.codice, PRODOTTI[R], a.firma);
  righe.push(`ordine 1 (conferma con la firma): ${link(a.firma)}`);

  // 3. secondo ordine: conferma SENZA firma (la rotta cerca la transazione col riferimento di Solana Pay)
  const b = await paga('ordine 2');
  const c2 = await app.conferma(R, b.o.codice, [], 120e3);
  const tx2 = JSON.parse(app.statoOrdine(b.o.codice).tx || '[]');
  if (c2.pagatore !== pag.sol || tx2[0] !== b.firma) throw new Error(`ricerca per riferimento: trovata ${tx2[0]}, attesa ${b.firma}`);
  passo(R, 'ordine 2: conferma via rotta SENZA firma OK (trovata col riferimento)');
  controllaQuote(R, app, b.o.codice, PRODOTTI[R], b.firma);
  righe.push(`ordine 2 (conferma senza firma, ricerca per riferimento): ${link(b.firma)}`);

  // 4. la stessa transazione non paga un altro ordine
  const o3 = await app.ordine(R, 'SOL');
  const c3 = await app.chiama('/api/crypto/conferma', { codice: o3.codice, tx: [a.firma] });
  if (c3.stato !== 409) throw new Error(`riuso della transazione: ${c3.stato} invece di 409`);
  passo(R, 'ordine 3 con la transazione dell\'ordine 1: 409, rifiutata come deve');
  righe.push('riuso di una transazione già usata su un altro ordine: rifiutato (409)');
  // i saldi veri dei destinatari
  for (const r of ['builder', 'installatore', 'piattaforma']) {
    const s = (await rpc(url, 'getBalance', [id[r].sol, { commitment: 'confirmed' }])).value;
    righe.push(`saldo ${r} ${id[r].sol}: ${s / 1e9} SOL`);
  }
  giro.esito = 'provata';
}

// ======================================================================================================================
// EVM (Base Sepolia): RLP, transazioni EIP-1559 (tipo 2), firma con firmaHash di cripto.js
// ======================================================================================================================
const intB = v => { let h = BigInt(v).toString(16); if (h === '0') return Buffer.alloc(0); if (h.length % 2) h = '0' + h; return Buffer.from(h, 'hex'); };
const hexB = h => Buffer.from(String(h || '').replace(/^0x/, ''), 'hex');
const lunghezza = (n, base) => { if (n < 56) return Buffer.from([base + n]); const l = intB(n); return Buffer.concat([Buffer.from([base + 55 + l.length]), l]); };
function rlp(x) {
  if (Array.isArray(x)) { const corpo = Buffer.concat(x.map(rlp)); return Buffer.concat([lunghezza(corpo.length, 0xc0), corpo]); }
  const b = Buffer.from(x);
  return b.length === 1 && b[0] < 0x80 ? b : Buffer.concat([lunghezza(b.length, 0x80), b]);
}
const campi1559 = t => [intB(t.chainId), intB(t.nonce), intB(t.maxPriorityFeePerGas), intB(t.maxFeePerGas), intB(t.gas), hexB(t.to), intB(t.value), hexB(t.input ?? t.data),
  (t.accessList || []).map(a => [hexB(a.address), (a.storageKeys || []).map(hexB)])];
const daFirmare1559 = t => keccak256(Buffer.concat([Buffer.from([2]), rlp(campi1559(t))]));
const firmata1559 = (t, yParity, r, s) => Buffer.concat([Buffer.from([2]), rlp([...campi1559(t), intB(yParity), intB(r), intB(s)])]);
function firma1559(t, chiave) {
  const f = hexB(firmaHash(daFirmare1559(t), chiave));
  const r = BigInt('0x' + f.subarray(0, 32).toString('hex')), s = BigInt('0x' + f.subarray(32, 64).toString('hex')), y = f[64] - 27;
  const grezza = firmata1559(t, y, r, s);
  return { grezza: '0x' + grezza.toString('hex'), hash: '0x' + keccak256(grezza).toString('hex') };
}

// le prove della codifica e della firma, prima di fidarsi: vettori noti e una transazione vera di Base Sepolia
async function provaCodificaEvm(R, url) {
  // RLP: gli esempi della documentazione (ethereum.org, «Recursive-length prefix»)
  const casi = [[Buffer.from('dog'), '83646f67'], [[Buffer.from('cat'), Buffer.from('dog')], 'c88363617483646f67'], [Buffer.alloc(0), '80'], [[], 'c0'],
    [intB(0), '80'], [Buffer.from([0]), '00'], [intB(15), '0f'], [intB(1024), '820400'], [[[], [[]], [[], [[]]]], 'c7c0c1c0c3c0c1c0'],
    [Buffer.from('Lorem ipsum dolor sit amet, consectetur adipisicing elit'), 'b8384c6f72656d20697073756d20646f6c6f722073697420616d65742c20636f6e7365637465747572206164697069736963696e6720656c6974']];
  for (const [x, h] of casi) if (rlp(x).toString('hex') !== h) throw new Error(`RLP sbagliato per ${JSON.stringify(x)}: ${rlp(x).toString('hex')} invece di ${h}`);
  // EIP-155 (l'esempio della specifica): l'hash da firmare e la firma nota recuperano l'indirizzo della chiave 0x4646…
  const k46 = Buffer.alloc(32, 0x46), da46 = indirizzoDaChiave(k46);
  const legacy = [intB(9), intB(20e9), intB(21000), hexB('0x' + '35'.repeat(20)), intB(10n ** 18n), Buffer.alloc(0)];
  const h155 = keccak256(rlp([...legacy, intB(1), Buffer.alloc(0), Buffer.alloc(0)]));
  if (h155.toString('hex') !== 'daf5a779ae972f972197303d7b574746c7ef83eadac0f2791ad23db92e4c8e53') throw new Error('EIP-155: hash da firmare sbagliato');
  const r155 = '28ef61340bd939bc2195fe537567866003e1a15d3c71ff63e1590620aa636276', s155 = '67cbe9d8997f761aecb703304b3800ccf555c9f3dc64214b297fb1966a3b6d83';
  const firmata155 = rlp([...legacy, intB(37), hexB(r155), hexB(s155)]).toString('hex');
  if (firmata155 !== 'f86c098504a817c800825208943535353535353535353535353535353535353535880de0b6b3a76400008025a028ef61340bd939bc2195fe537567866003e1a15d3c71ff63e1590620aa636276a067cbe9d8997f761aecb703304b3800ccf555c9f3dc64214b297fb1966a3b6d83')
    throw new Error('EIP-155: transazione firmata sbagliata');
  if (recupera(h155, '0x' + r155 + s155 + '1b') !== da46) throw new Error('EIP-155: la firma nota non recupera l\'indirizzo della chiave');
  // firmaHash: la nostra firma di quell'hash recupera la stessa chiave
  if (recupera(h155, firmaHash(h155, k46)) !== da46) throw new Error('firmaHash: la firma non recupera la chiave');
  passo(R, `codifica: RLP (${casi.length} vettori di ethereum.org) e EIP-155 (hash, firmata, firma nota → ${da46}) OK`);
  // una transazione vera di tipo 2 di Base Sepolia, ricostruita: l'hash deve coincidere e la firma deve dare il mittente
  let provate = 0;
  for (let indietro = 0; indietro < 10 && provate < 3; indietro++) {
    const cima = BigInt(await rpc(url, 'eth_blockNumber'));
    const blocco = await rpc(url, 'eth_getBlockByNumber', ['0x' + (cima - BigInt(indietro)).toString(16), true]);
    for (const t of blocco.transactions.filter(t => t.type === '0x2' && t.to).slice(0, 3 - provate)) {
      const y = BigInt(t.yParity ?? t.v), grezza = firmata1559(t, y, BigInt(t.r), BigInt(t.s));
      if ('0x' + keccak256(grezza).toString('hex') !== t.hash) throw new Error(`tipo 2: ricostruita ${t.hash} ma l'hash non coincide`);
      const da = recupera(daFirmare1559(t), '0x' + intB(BigInt(t.r)).toString('hex').padStart(64, '0') + intB(BigInt(t.s)).toString('hex').padStart(64, '0') + (27 + Number(y)).toString(16));
      if (da?.toLowerCase() !== t.from.toLowerCase()) throw new Error(`tipo 2: la firma di ${t.hash} non dà il mittente ${t.from}`);
      passo(R, `  tx vera di Base Sepolia ricostruita: hash e mittente coincidono (${breve(t.hash)}, accessList ${t.accessList?.length || 0})`);
      provate++;
    }
  }
  if (!provate) throw new Error('nessuna transazione di tipo 2 trovata negli ultimi blocchi per la prova');
}

async function provaBase(id, app) {
  const R = 'base-sepolia', rete = RETI[R], url = rete.rpc, righe = [];
  const giro = { rete: R, esito: 'errore', righe }; RAPPORTO.push(giro);
  const pag = id.pagatore, link = h => `${rete.esploratore}/tx/${h}`;
  await provaCodificaEvm(R, url);
  righe.push('codifica RLP e firma EIP-1559 provate (vettori di ethereum.org, EIP-155, transazioni vere di Base Sepolia ricostruite)');
  const usdc = rete.monete.find(m => m.simbolo === 'USDC').indirizzo;
  const saldoEth = BigInt(await rpc(url, 'eth_getBalance', [pag.evm, 'latest']));
  const saldoUsdc = BigInt(await rpc(url, 'eth_call', [{ to: usdc, data: '0x70a08231' + pag.evm.slice(2).toLowerCase().padStart(64, '0') }, 'latest']) || '0x0');
  passo(R, `pagatore ${pag.evm}: ${Number(saldoEth) / 1e18} ETH, ${Number(saldoUsdc) / 1e6} USDC`);
  const servonoEth = 2_000_000_000_000_000n, servonoUsdc = 5_000_000n;   // 0,002 ETH (0,00088 + gas), 5 USDC (2,39 per ordine)
  if (saldoEth < servonoEth) {
    giro.esito = 'aspetta';
    righe.push(`Serve ETH di prova su Base Sepolia (almeno 0,002; ne ha ${Number(saldoEth) / 1e18}) e USDC di prova (almeno 5; ne ha ${Number(saldoUsdc) / 1e6}) su:`,
      `   ${pag.evm}`,
      'ETH: https://www.alchemy.com/faucets/base-sepolia o https://docs.base.org/base-chain/tools/network-faucets (Coinbase, Alchemy, QuickNode…)',
      'USDC: https://faucet.circle.com (rete «Base Sepolia»)',
      `poi rilancia: node strumenti/prova-testnet.mjs --rete base-sepolia --cartella ${cartella}`);
    passo(R, 'senza ETH di prova il pagamento non parte: faccio la prova a secco sulla rete vera');
    await provaASeccoEvm();
    return;
  }

  // Senza ETH: la transazione firmata qui va a eth_sendRawTransaction; il nodo la decodifica, ricava il mittente dalla firma e
  // la rifiuta per i fondi, scrivendo l'indirizzo che ha ricavato: deve essere quello del pagatore. Poi la conferma via rotta
  // con quell'hash (mai entrato in un blocco) deve rispondere 202.
  async function provaASeccoEvm() {
    const o = await app.ordine(R, 'ETH');
    passo(R, `a secco: ordine ETH ${o.codice}: ${o.parti.map(p => `${p.ruolo} ${p.unita} wei`).join(', ')}`);
    const prio = BigInt(await rpc(url, 'eth_maxPriorityFeePerGas'));
    const baseFee = BigInt((await rpc(url, 'eth_getBlockByNumber', ['latest', false])).baseFeePerGas);
    const c = o.chiamate[0];
    const t = { chainId: rete.chainId, nonce: 0n, maxPriorityFeePerGas: prio, maxFeePerGas: baseFee * 2n + prio, gas: 21000n, to: c.to, value: BigInt(c.value), data: c.data, accessList: [] };
    const f = firma1559(t, pag.secp);
    const no = await rpc(url, 'eth_sendRawTransaction', [f.grezza]).then(h => `accettata?! ${h}`, e => e.message);
    if (!/insufficient funds/i.test(no)) throw new Error(`eth_sendRawTransaction: atteso «insufficient funds», arrivato: ${no}`);
    const conIndirizzo = no.toLowerCase().includes(pag.evm.toLowerCase());
    if (/address 0x[0-9a-f]{40}/i.test(no) && !conIndirizzo) throw new Error(`il nodo ha ricavato un altro mittente dalla firma: ${no}`);
    passo(R, `  eth_sendRawTransaction: «${no.slice(0, 120)}»${conIndirizzo ? ' — il mittente ricavato dal nodo è il pagatore' : ''}`);
    const cf = await app.chiama('/api/crypto/conferma', { codice: o.codice, tx: [f.hash] });
    if (cf.stato !== 202) throw new Error(`conferma senza pagamento: ${cf.stato} ${JSON.stringify(cf.j)}`);
    passo(R, `  conferma via rotta con quell'hash: 202 «${cf.j.attesa}»`);
    righe.push(`prova a secco su Base Sepolia: la tx tipo 2 firmata qui è decodificata dal nodo vero e rifiutata solo per i fondi${conIndirizzo ? ' (il mittente ricavato dalla firma è il pagatore)' : ''}; la conferma via rotta risponde 202`);
  }

  async function mandaChiamate(etichetta, chiamate) {
    let nonce = BigInt(await rpc(url, 'eth_getTransactionCount', [pag.evm, 'pending']));
    const prio = [BigInt(await rpc(url, 'eth_maxPriorityFeePerGas')), 1_000_000n].reduce((a, b) => (a > b ? a : b));   // almeno 0,001 gwei di mancia
    const baseFee = BigInt((await rpc(url, 'eth_getBlockByNumber', ['latest', false])).baseFeePerGas);
    const hash = [];
    for (const c of chiamate) {
      const gas = BigInt(await rpc(url, 'eth_estimateGas', [{ from: pag.evm, to: c.to, value: c.value, data: c.data }]));
      const t = { chainId: rete.chainId, nonce, maxPriorityFeePerGas: prio, maxFeePerGas: baseFee * 2n + prio, gas: gas * 12n / 10n, to: c.to, value: BigInt(c.value), data: c.data, accessList: [] };
      const f = firma1559(t, pag.secp);
      const h = await rpc(url, 'eth_sendRawTransaction', [f.grezza]);
      if (h.toLowerCase() !== f.hash) throw new Error(`la rete dà un altro hash: ${h} invece di ${f.hash}`);
      passo(R, `${etichetta}: mandata ${h} (nonce ${nonce}, gas ${t.gas})`);
      hash.push(h); nonce++;
    }
    for (const h of hash) {
      const ric = await finche(async () => (await rpc(url, 'eth_getTransactionReceipt', [h])) || undefined, { ms: 120e3, ogni: 2000, cosa: `ricevuta di ${breve(h)}` });
      if (ric.status !== '0x1') throw new Error(`transazione fallita in rete: ${link(h)}`);
    }
    passo(R, `${etichetta}: ${hash.length} transazioni nei blocchi`);
    return hash;
  }

  // 1. ETH: tre invii di valore, le «chiamate» dell'ordine
  const oe = await app.ordine(R, 'ETH');
  passo(R, `ordine ETH ${oe.codice}: ${oe.parti.map(p => `${p.ruolo} ${p.unita} wei`).join(', ')}`);
  const he = await mandaChiamate('ETH', oe.chiamate);
  const ce = await app.conferma(R, oe.codice, he, 180e3);
  if (ce.pagatore?.toLowerCase() !== pag.evm.toLowerCase()) throw new Error(`pagatore ${ce.pagatore}`);
  controllaQuote(R, app, oe.codice, PRODOTTI[R], he[0]);
  righe.push(`ordine in ETH: ${he.map(link).join(' , ')}`);

  // 2. USDC: tre transfer sul contratto
  if (saldoUsdc < servonoUsdc) {
    giro.esito = 'aspetta';
    righe.push(`ETH provato. Per USDC servono almeno 5 USDC di prova su ${pag.evm}: https://faucet.circle.com (Base Sepolia); poi rilancia con --cartella ${cartella}`);
    return;
  }
  const ou = await app.ordine(R, 'USDC');
  passo(R, `ordine USDC ${ou.codice}: ${ou.parti.map(p => `${p.ruolo} ${p.unita}`).join(', ')} (6 decimali)`);
  const hu = await mandaChiamate('USDC', ou.chiamate);
  const cu = await app.conferma(R, ou.codice, hu, 180e3);
  if (cu.pagatore?.toLowerCase() !== pag.evm.toLowerCase()) throw new Error(`pagatore ${cu.pagatore}`);
  controllaQuote(R, app, ou.codice, PRODOTTI[R], hu[0]);
  righe.push(`ordine in USDC: ${hu.map(link).join(' , ')}`);
  giro.esito = 'provata';
}

// ======================================================================================================================
// TRON NILE: le transazioni dall'API (createtransaction, visible:true), firma di sha256(raw_data_hex), broadcast
// ======================================================================================================================
async function provaTron(id, app) {
  const R = 'tron-nile', rete = RETI_TRON[R], righe = [];
  const giro = { rete: R, esito: 'errore', righe }; RAPPORTO.push(giro);
  const pag = id.pagatore, link = h => `${rete.esploratore}/#/transaction/${h}`;
  const tron = async (percorso, corpo) => {
    const r = await conLimite(fetch(rete.api + percorso, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) }), 30e3, percorso);
    if (!r.ok) throw new Error(`Tron ${percorso}: ${r.status}`);
    return r.json();
  };
  // l'indirizzo: base58check(0x41 + ultimi 20 byte del keccak della chiave pubblica), cioè lo stesso hash dell'indirizzo EVM
  if (base58check(Buffer.concat([Buffer.from([0x41]), hexB(pag.evm)])) !== pag.tron) throw new Error('indirizzo Tron incoerente');
  const conto = await tron('/wallet/getaccount', { address: pag.tron, visible: true });
  const saldo = BigInt(conto.balance || 0);
  passo(R, `pagatore ${pag.tron}: ${Number(saldo) / 1e6} TRX`);
  const servono = 40_000_000n;   // 24,8 TRX dell'ordine + l'attivazione dei conti nuovi (1,1 TRX ciascuno) + banda
  if (saldo < servono) {
    giro.esito = 'aspetta';
    righe.push(`Serve TRX di prova su Nile (almeno 40; ne ha ${Number(saldo) / 1e6}) su:`, `   ${pag.tron}`,
      'faucet: https://nileex.io/join/getJoinPage', `poi rilancia: node strumenti/prova-testnet.mjs --rete tron-nile --cartella ${cartella}`);
    // a secco: l'ordine vero e la conferma via rotta su Nile vera con una transazione che non esiste: deve rispondere 202
    const o = await app.ordine(R, 'TRX'), finta = randomBytes(32).toString('hex');
    const c = await app.chiama('/api/crypto/conferma', { codice: o.codice, tx: [finta] });
    if (c.stato !== 202) throw new Error(`conferma con una transazione inesistente: ${c.stato} ${JSON.stringify(c.j)}`);
    passo(R, `a secco: ordine ${o.codice} (${o.parti.map(p => `${p.ruolo} ${Number(p.unita) / 1e6} TRX`).join(', ')}); conferma via rotta su Nile con una tx inesistente: 202 «${c.j.attesa}»`);
    righe.push('prova a secco: ordine via rotta e conferma su Nile vera (tx inesistente → 202)');
    // la firma sul nodo vero: una transazione costruita dal nodo per un conto che ha TRX (preso dagli ultimi blocchi), firmata con
    // la NOSTRA chiave come la firmerebbe il pagatore. Il nodo deve rifiutarla per la firma (SIGERROR), scrivendo l'indirizzo che
    // ricava dalla firma: deve essere quello del pagatore. Così formato della firma e hash sono provati senza spendere niente.
    const cima = await tron('/wallet/getnowblock', {});
    let altro = null;
    for (let k = 0; k < 8 && !altro; k++) {
      const bl = k ? await tron('/wallet/getblockbynum', { num: cima.block_header.raw_data.number - k }) : cima;
      const t = (bl.transactions || []).find(x => x.raw_data?.contract?.[0]?.type === 'TransferContract');
      if (t) altro = hexInTron(t.raw_data.contract[0].parameter.value.owner_address);
    }
    if (altro && altro !== pag.tron) {
      const t = await tron('/wallet/createtransaction', { owner_address: altro, to_address: id.builder.tron, amount: 1, visible: true });
      if (!t.txID) throw new Error('createtransaction: ' + JSON.stringify(t).slice(0, 300));
      const h = createHash('sha256').update(Buffer.from(t.raw_data_hex, 'hex')).digest();
      if (h.toString('hex') !== t.txID) throw new Error('il txID non è sha256(raw_data_hex)');
      t.signature = [firmaHash(h, pag.secp).slice(2)];
      const b = await tron('/wallet/broadcasttransaction', t), testo = /^[0-9a-f]+$/i.test(b.message || '') ? Buffer.from(b.message, 'hex').toString() : String(b.message || '');   // il messaggio è in esadecimale o in chiaro
      if (b.result || b.code !== 'SIGERROR') throw new Error(`broadcast con la firma di un altro: atteso SIGERROR, arrivato ${JSON.stringify(b).slice(0, 200)} ${testo}`);
      if (!testo.includes(pag.tron)) throw new Error(`il nodo ricava dalla firma un altro indirizzo: ${testo || JSON.stringify(b)}`);
      passo(R, `a secco: tx del conto ${breve(altro)} firmata con la nostra chiave → SIGERROR, e il nodo ricava dalla firma proprio il pagatore ${breve(pag.tron)}`);
      righe.push('prova a secco della firma su Nile vera: il nodo ricava dalla nostra firma (sha256 di raw_data_hex, secp256k1, v 27/28) l\'indirizzo del pagatore');
    }
    passo(R, 'senza TRX di prova il pagamento non parte: mi fermo qui (vedi il rapporto)');
    return;
  }
  const o = await app.ordine(R, 'TRX');
  passo(R, `ordine ${o.codice}: ${o.parti.map(p => `${p.ruolo} ${Number(p.unita) / 1e6} TRX`).join(', ')}`);
  const ids = [];
  for (const p of o.parti) {
    const t = await tron('/wallet/createtransaction', { owner_address: pag.tron, to_address: p.indirizzo, amount: Number(p.unita), visible: true });
    if (!t.txID || !t.raw_data_hex) throw new Error('createtransaction: ' + JSON.stringify(t).slice(0, 300));
    const h = createHash('sha256').update(Buffer.from(t.raw_data_hex, 'hex')).digest();
    if (h.toString('hex') !== t.txID) throw new Error('il txID non è sha256(raw_data_hex)');
    const v = t.raw_data.contract?.[0]?.parameter?.value;   // prima di firmare: paga quello che deve, a chi deve
    if (t.raw_data.contract.length !== 1 || v.to_address !== p.indirizzo || v.owner_address !== pag.tron || String(v.amount) !== p.unita) throw new Error('la transazione di Tron non è quella chiesta');
    t.signature = [firmaHash(h, pag.secp).slice(2)];
    const b = await tron('/wallet/broadcasttransaction', t);
    if (!b.result) throw new Error('broadcast: ' + JSON.stringify(b) + ' ' + Buffer.from(b.message || '', 'hex').toString());
    passo(R, `  ${p.ruolo}: mandata ${t.txID}`);
    ids.push(t.txID);
  }
  passo(R, 'aspetto che le transazioni siano solidificate (irreversibili, circa un minuto)');
  const c = await app.conferma(R, o.codice, ids, 240e3, 10e3);
  if (c.pagatore !== pag.tron) throw new Error(`pagatore ${c.pagatore}`);
  controllaQuote(R, app, o.codice, PRODOTTI[R], ids[0]);
  righe.push(...ids.map(h => `TRX: ${link(h)}`));
  giro.esito = 'provata';
}

// ======================================================================================================================
// BITCOIN TESTNET4: con tBTC sul pagatore lo script paga da solo (segwit v0, P2WPKH, firma BIP143 in JS puro) e la rotta cerca
// il pagamento senza txid; senza tBTC stampa gli URI BIP21 e i QR per pagare a mano e cerca il pagamento con un limite.
// ======================================================================================================================
const dsha = b => createHash('sha256').update(createHash('sha256').update(b).digest()).digest();
const le32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const le64 = n => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const varint = n => (n < 0xfd ? Buffer.from([n]) : Buffer.concat([Buffer.from([0xfd]), Buffer.from([n & 0xff, n >> 8])]));
const conLunghezza = b => Buffer.concat([varint(b.length), Buffer.from(b)]);
const scriptSegwit = (indirizzo, hrp) => { const w = segwitDecodifica(hrp, indirizzo); if (!w) throw new Error('indirizzo non segwit: ' + indirizzo); return Buffer.from([w.versione ? 0x50 + w.versione : 0, w.programma.length, ...w.programma]); };
const scriptCodeP2wpkh = h160 => Buffer.concat([Buffer.from('76a914', 'hex'), h160, Buffer.from('88ac', 'hex')]);
// BIP143: l'hash da firmare di un ingresso segwit v0 (SIGHASH_ALL)
function sighashBip143(tx, i, scriptCode, valore) {
  const x = tx.ingressi[i], punto = y => Buffer.concat([Buffer.from(y.txid, 'hex').reverse(), le32(y.vout)]);
  return dsha(Buffer.concat([le32(tx.versione), dsha(Buffer.concat(tx.ingressi.map(punto))), dsha(Buffer.concat(tx.ingressi.map(y => le32(y.sequenza)))),
    punto(x), conLunghezza(scriptCode), le64(valore), le32(x.sequenza), dsha(Buffer.concat(tx.uscite.map(u => Buffer.concat([le64(u.valore), conLunghezza(u.script)])))),
    le32(tx.locktime), le32(1)]));
}
function serializzaBtc(tx, testimoni = true) {
  const p = [le32(tx.versione)]; if (testimoni) p.push(Buffer.from([0, 1]));
  p.push(varint(tx.ingressi.length));
  for (const x of tx.ingressi) p.push(Buffer.from(x.txid, 'hex').reverse(), le32(x.vout), Buffer.from([0]), le32(x.sequenza));
  p.push(varint(tx.uscite.length));
  for (const u of tx.uscite) p.push(le64(u.valore), conLunghezza(u.script));
  if (testimoni) for (const x of tx.ingressi) { p.push(varint(x.testimone.length)); for (const w of x.testimone) p.push(conLunghezza(w)); }
  p.push(le32(tx.locktime));
  return Buffer.concat(p);
}
const derIntero = v => { let b = intB(v); if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]); return Buffer.concat([Buffer.from([2, b.length]), b]); };
// firma un ingresso P2WPKH: firmaHash di cripto.js (s basso), in DER + SIGHASH_ALL; controllata con recupera prima di usarla
function firmaIngresso(tx, i, chiave, valore) {
  const ecdh = createECDH('secp256k1'); ecdh.setPrivateKey(chiave); const pub = ecdh.getPublicKey(null, 'compressed');
  const h = sighashBip143(tx, i, scriptCodeP2wpkh(hash160(pub)), valore), f = hexB(firmaHash(h, chiave));
  if (recupera(h, '0x' + f.toString('hex')) !== indirizzoDaChiave(chiave)) throw new Error('firma Bitcoin non valida');
  const corpo = Buffer.concat([derIntero(BigInt('0x' + f.subarray(0, 32).toString('hex'))), derIntero(BigInt('0x' + f.subarray(32, 64).toString('hex')))]);
  tx.ingressi[i].testimone = [Buffer.concat([Buffer.from([0x30, corpo.length]), corpo, Buffer.from([1])]), pub];
}
// prima di fidarsi: l'esempio P2WPKH ufficiale di BIP143 (l'hash del secondo ingresso, la chiave e il suo hash160)
function provaBip143(R) {
  const rev = h => Buffer.from(h, 'hex').reverse().toString('hex');
  const tx = { versione: 1, locktime: 0x11,
    ingressi: [{ txid: rev('fff7f7881a8099afa6940d42d1e7f6362bec38171ea3edf433541db4e4ad969f'), vout: 0, sequenza: 0xffffffee },
      { txid: rev('ef51e1b804cc89d182d279655c3aa89e815b1b309fe287d9b2b55d57b90ec68a'), vout: 1, sequenza: 0xffffffff }],
    uscite: [{ valore: 112340000n, script: Buffer.from('76a9148280b37df378db99f66f85c95a783a76ac7a6d5988ac', 'hex') },
      { valore: 223450000n, script: Buffer.from('76a9143bde42dbee7e4dbe6a21b2d50ce2f0167faa815988ac', 'hex') }] };
  const senza = serializzaBtc(tx, false).toString('hex');
  if (senza !== '0100000002fff7f7881a8099afa6940d42d1e7f6362bec38171ea3edf433541db4e4ad969f0000000000eeffffffef51e1b804cc89d182d279655c3aa89e815b1b309fe287d9b2b55d57b90ec68a0100000000ffffffff02202cb206000000001976a9148280b37df378db99f66f85c95a783a76ac7a6d5988ac9093510d000000001976a9143bde42dbee7e4dbe6a21b2d50ce2f0167faa815988ac11000000')
    throw new Error('BIP143: la transazione non firmata non coincide');
  const k = Buffer.from('619c335025c7f4012e556c2a58b2506e30b8511b53ade95ea316fd8c3286feb9', 'hex'), e = createECDH('secp256k1'); e.setPrivateKey(k);
  const pub = e.getPublicKey(null, 'compressed');
  if (pub.toString('hex') !== '025476c2e83188368da1ff3e292e7acafcdb3566bb0ad253f62fc70f07aeee6357' || hash160(pub).toString('hex') !== '1d0f172a0ecb48aee1be1f2687d2963ae33f71a1') throw new Error('BIP143: chiave o hash160 sbagliati');
  if (sighashBip143(tx, 1, scriptCodeP2wpkh(hash160(pub)), 600000000n).toString('hex') !== 'c37af31116d1b27caf68aae9e3ac82f1477929014d5b917657d0eb49478cb670') throw new Error('BIP143: hash da firmare sbagliato');
  firmaIngresso(tx, 1, k, 600000000n);   // la nostra firma, controllata con recupera
  passo(R, 'firma BIP143 provata con l\'esempio P2WPKH ufficiale (transazione, chiave, hash160, hash da firmare)');
}

async function provaBitcoin(id, app) {
  const R = 'bitcoin-testnet4', rete = RETI_BITCOIN[R], righe = [];
  const giro = { rete: R, esito: 'errore', righe }; RAPPORTO.push(giro);
  const esplora = async (percorso, corpo) => {
    const r = await conLimite(fetch(rete.api + percorso, corpo ? { method: 'POST', body: corpo } : {}), 30e3, percorso);
    const t = await r.text(); if (!r.ok) throw Object.assign(new Error(`${percorso}: ${r.status} ${t.slice(0, 200)}`), { testo: t });
    return /^[[{]/.test(t) ? JSON.parse(t) : t;
  };
  provaBip143(R);
  righe.push('firma BIP143 (P2WPKH) provata con l\'esempio ufficiale');
  const pag = id.pagatore, utxo = await esplora(`/address/${pag.btc}/utxo`);
  const disponibile = utxo.reduce((t, u) => t + BigInt(u.value), 0n);
  passo(R, `pagatore ${pag.btc}: ${disponibile} sat in ${utxo.length} uscite non spese`);
  const o = await app.ordine(R, 'BTC');
  const totale = o.parti.reduce((t, p) => t + BigInt(p.unita), 0n);
  const costruisci = (ingressi, tariffa) => {
    const uscite = o.parti.map(p => ({ valore: BigInt(p.unita), script: scriptSegwit(p.indirizzo, 'tb') }));
    const vbyte = 11 + 68 * ingressi.length + 31 * (uscite.length + 1), commissione = BigInt(Math.ceil(tariffa * vbyte)) + 20n;
    const entrate = ingressi.reduce((t, u) => t + BigInt(u.value), 0n), resto = entrate - totale - commissione;
    if (resto >= 546n) uscite.push({ valore: resto, script: scriptSegwit(pag.btc, 'tb') });
    const tx = { versione: 2, locktime: 0, ingressi: ingressi.map(u => ({ txid: u.txid, vout: u.vout, sequenza: 0xfffffffd })), uscite };
    ingressi.forEach((u, i) => firmaIngresso(tx, i, pag.secp, u.value));
    return { tx, grezza: serializzaBtc(tx).toString('hex'), txid: Buffer.from(dsha(serializzaBtc(tx, false))).reverse().toString('hex'), commissione, resto };
  };
  if (disponibile >= totale + 3000n) {
    // il pagamento automatico: una transazione sola con un'uscita per parte (più il resto), tariffa di mempool.space
    const tariffa = Math.max(1, Number((await esplora('/v1/fees/recommended').catch(() => ({}))).halfHourFee) || 1);
    const t = costruisci(utxo, tariffa);
    passo(R, `ordine ${o.codice}: ${o.parti.map(p => `${p.ruolo} ${p.unita} sat`).join(', ')}; commissione ${t.commissione} sat (${tariffa} sat/vB)`);
    const inviata = String(await esplora('/tx', t.grezza)).trim();
    if (inviata !== t.txid) throw new Error(`la rete dà un altro txid: ${inviata} invece di ${t.txid}`);
    passo(R, `transazione mandata: ${rete.esploratore}/tx/${t.txid}`);
    righe.push(`pagamento mandato: ${rete.esploratore}/tx/${t.txid}`);
  } else {
    // a secco: la stessa transazione firmata su un'uscita inventata; il nodo la deve decodificare e rifiutare solo per l'ingresso
    const t = costruisci([{ txid: randomBytes(32).toString('hex'), vout: 0, value: Number(totale + 5000n) }], 1);
    const no = await esplora('/tx', t.grezza).then(x => `accettata?! ${x}`, e => e.testo || e.message);
    if (!/missingorspent|missing-inputs|missing inputs/i.test(no)) throw new Error(`a secco: atteso «missing inputs», arrivato: ${no.slice(0, 200)}`);
    passo(R, `a secco: la tx firmata qui (uscita inventata) è decodificata dal nodo e rifiutata solo per l'ingresso: «${no.slice(0, 90)}»`);
    righe.push('prova a secco su testnet4: la tx segwit firmata qui è decodificata dal nodo vero e rifiutata solo per l\'ingresso inesistente');
    const dirQr = join(cartella, `qr-${o.codice}`); mkdirSync(dirQr, { recursive: true });
    passo(R, `ordine ${o.codice} (valido ${Math.round((new Date(o.scade) - Date.now()) / 60e3)} min): paga da un wallet testnet4 queste ${o.parti.length} parti`);
    for (const p of o.parti) { writeFileSync(join(dirQr, `${p.ruolo}.svg`), p.qr); passo(R, `  ${p.ruolo.padEnd(12)} ${p.unita.padStart(6)} sat  ${p.uri}`); }
    passo(R, `  i QR: ${dirQr}/*.svg (in una transazione sola con più uscite, o una per QR)`);
    righe.push(`ordine ${o.codice}: URI BIP21 e QR in ${dirQr}`, ...o.parti.map(p => `${p.ruolo}: ${p.uri}`));
  }
  const ms = Math.min(ATTESA_BTC, Math.max(0, LIMITE - (Date.now() - INIZIO) - 60e3));
  passo(R, `cerco il pagamento da solo (conferma senza txid, ${rete.conferme} conferma) ogni 30 s per al massimo ${Math.round(ms / 60e3)} min`);
  try {
    const c = await app.conferma(R, o.codice, [], ms, 30e3);
    const tx = JSON.parse(app.statoOrdine(o.codice).tx || '[]');
    controllaQuote(R, app, o.codice, PRODOTTI[R], tx[0]);
    righe.push(...tx.map(t => `pagamento trovato dalla rotta: ${rete.esploratore}/tx/${t}`), `pagatore: ${c.pagatore || '(sconosciuto)'}`);
    giro.esito = 'provata';
  } catch (e) {
    if (!/tempo scaduto/.test(e.message)) throw e;
    giro.esito = 'aspetta';
    righe.push(`nessun pagamento confermato entro ${Math.round(ms / 60e3)} min.`,
      `Per il pagamento automatico manda almeno 30.000 sat di testnet4 a ${pag.btc}`,
      '(faucet: https://mempool.space/testnet4/faucet o https://faucet.testnet4.dev), oppure paga i QR da un wallet testnet4;',
      `poi rilancia: node strumenti/prova-testnet.mjs --rete bitcoin-testnet4 --cartella ${cartella} --attesa 40`);
  }
}

// ======================================================================================================================
const PROVE = { 'solana-devnet': provaSolana, 'base-sepolia': provaBase, 'tron-nile': provaTron, 'bitcoin-testnet4': provaBitcoin };
async function principale() {
  const chiavi = caricaChiavi(), id = Object.fromEntries(RUOLI.map(r => [r, identita(chiavi[r])]));
  passo('prova', `cartella delle chiavi di prova: ${cartella} (chiavi.json, mai stampate)`);
  const app = await accendiApp(id);
  passo('prova', `app accesa in processo su ${app.base} (database in memoria, reti: ${TUTTE_LE_RETI.join(', ')})`);
  try {
    for (const r of scelta === 'tutte' ? TUTTE_LE_RETI : [scelta]) {
      if (scaduto()) { RAPPORTO.push({ rete: r, esito: 'errore', righe: ['non provata: tempo finito'] }); continue; }
      passo(r, '---------------- inizio ----------------');
      try { await PROVE[r](id, app); }
      catch (e) {
        const g = RAPPORTO.find(x => x.rete === r) || (RAPPORTO.push({ rete: r, righe: [] }), RAPPORTO.at(-1));
        g.esito = 'errore'; g.righe.push(e.message); passo(r, 'ERRORE: ' + e.message);
      }
    }
  } finally { await app.chiudi(); }
  stampaRapporto();
  return RAPPORTO.some(x => x.esito === 'errore') ? 1 : 0;
}
principale().then(codice => process.exit(codice), e => { console.error(e); stampaRapporto(); process.exit(1); });
