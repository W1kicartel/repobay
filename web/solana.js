// Il wallet Solana del browser: trovarlo (prima il Wallet Standard, che usano Phantom, Solflare, Backpack e gli altri;
// poi le vecchie API iniettate), collegarlo, fargli firmare e mandare la transazione preparata dal server.
// Il browser non parla mai con l'RPC: la transazione arriva dal nostro server, il wallet la manda alla rete.
// Wallet Standard: github.com/wallet-standard/wallet-standard (eventi «app-ready» e «register-wallet», feature
// standard:connect e solana:signAndSendTransaction). Phantom legacy: docs.phantom.com/solana/sending-a-transaction.
import { base58 } from './base58.js';

// ---------------- Wallet Standard ----------------
const STANDARD = new Map();   // nome → wallet
const ascoltatori = new Set();
const adatto = w => !!(w?.name && w.features?.['standard:connect'] && w.features['solana:signAndSendTransaction'] && (w.chains || []).some(c => String(c).startsWith('solana:')));
function registra(...wallet) {
  const nuovi = wallet.filter(adatto);
  for (const w of nuovi) STANDARD.set(w.name, w);
  if (nuovi.length) for (const f of ascoltatori) try { f(...nuovi); } catch { /* un ascoltatore rotto non ferma gli altri */ }
  return () => { for (const w of nuovi) if (STANDARD.get(w.name) === w) STANDARD.delete(w.name); };
}
const api = Object.freeze({
  register: registra,
  get: () => [...STANDARD.values()],
  on: (evento, f) => { if (evento !== 'register') return () => {}; ascoltatori.add(f); return () => ascoltatori.delete(f); },
});
let pronto = null;
function avvia() {   // una volta per pagina: i wallet già caricati si registrano subito, quelli lenti con «register-wallet»
  if (pronto) return pronto;
  window.addEventListener('wallet-standard:register-wallet', e => { try { e.detail(api); } catch { /* wallet difettoso */ } });
  window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: api }));
  pronto = new Promise(ok => setTimeout(ok, 200));   // un attimo per le estensioni che si iniettano tardi
  return pronto;
}

// ---------------- API legacy (wallet vecchi o senza Wallet Standard) ----------------
const LEGACY = [
  { id: 'phantom', nome: 'Phantom', trova: () => window.phantom?.solana },
  { id: 'solflare', nome: 'Solflare', trova: () => window.solflare },
  { id: 'backpack', nome: 'Backpack', trova: () => (window.backpack?.solana?.connect ? window.backpack.solana : window.backpack) },
];

// → [{ id, nome, icona }]. L'icona del Wallet Standard è un data: URI (svg/png/webp); per le API legacy è null.
export async function walletSolana() {
  await avvia();
  const lista = [...STANDARD.values()].map(w => ({ id: 'standard:' + w.name, nome: w.name, icona: w.icon || null }));
  for (const l of LEGACY) if (!STANDARD.has(l.nome) && l.trova()?.connect) lista.push({ id: l.id, nome: l.nome, icona: null });
  return lista;
}

let attivo = null;   // { wallet, account } col Wallet Standard, { provider } con le API legacy
export async function collegaSolana(id) {
  await avvia();
  if (String(id).startsWith('standard:')) {
    const wallet = STANDARD.get(id.slice('standard:'.length));
    if (!wallet) throw new Error('Wallet non trovato: ricarica la pagina');
    const r = await wallet.features['standard:connect'].connect();
    const account = [...(r?.accounts?.length ? r.accounts : wallet.accounts || [])].find(a => !a.chains || a.chains.some(c => String(c).startsWith('solana:')));
    if (!account) throw new Error('Il wallet non ha dato nessun conto Solana');
    attivo = { wallet, account };
    return { indirizzo: account.address };
  }
  const l = LEGACY.find(x => x.id === id), provider = l?.trova();
  if (!provider) throw new Error('Nessun wallet Solana nel browser: installa Phantom, Solflare o Backpack, oppure apri questa pagina dal browser del tuo wallet sul telefono.');
  const r = await provider.connect();
  const chiave = r?.publicKey || provider.publicKey;
  if (!chiave) throw new Error('Il wallet non ha dato nessun conto');
  attivo = { provider };
  return { indirizzo: chiave.toString() };
}

// i byte della transazione senza la parte delle firme: compact-u16 col numero di firme, poi 64 byte per firma
function messaggio(tx) {
  let n = 0, i = 0, s = 0;
  for (;;) { const b = tx[i++]; n |= (b & 0x7f) << s; if (!(b & 0x80)) break; s += 7; }
  return tx.subarray(i + 64 * n);
}

// firma e manda la transazione (base64, dal server) → la firma della transazione in base58
export async function inviaSolana(txBase64, cluster) {
  if (!attivo) throw new Error('Collega prima il wallet');
  const tx = Uint8Array.from(atob(txBase64), c => c.charCodeAt(0));
  if (attivo.wallet) {
    const { wallet, account } = attivo, f = wallet.features['solana:signAndSendTransaction'];
    if (cluster && wallet.chains && !wallet.chains.includes(cluster)) throw new Error(`${wallet.name} non supporta la rete ${cluster}`);
    if (f.supportedTransactionVersions && !f.supportedTransactionVersions.includes('legacy')) throw new Error(`${wallet.name} non accetta questa transazione`);
    const [esito] = await f.signAndSendTransaction({ account, transaction: tx, chain: cluster || account.chains?.[0] });
    return typeof esito.signature === 'string' ? esito.signature : base58.codifica(esito.signature);
  }
  const p = attivo.provider;   // Phantom legacy: il messaggio in base58 con request (la rete è quella scelta nel wallet)
  if (typeof p.request !== 'function') throw new Error('Questo wallet è troppo vecchio: aggiornalo e riprova');
  const r = await p.request({ method: 'signAndSendTransaction', params: { message: base58.codifica(messaggio(tx)) } });
  return typeof r === 'string' ? r : r.signature;
}

// ---------------- Solana Pay sul telefono ----------------
// il link «transaction request» da mettere nel QR: solana:<url https>, codificato solo se l'URL ha parametri
// (docs.solanapay.com/spec: «If the URL contains query parameters, it must be URL-encoded»)
export function linkSolanaPay(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error('Il link di Solana Pay deve essere https');
  u.hash = '';
  const s = u.pathname === '/' && !u.search ? u.origin : String(u);
  return 'solana:' + (u.search ? encodeURIComponent(s) : s);
}

// ---------------- la prova di possesso ----------------
// firma un messaggio di testo col wallet collegato (non costa nulla e non sposta fondi) → la firma in base58
export async function firmaSolana(testo) {
  if (!attivo) throw new Error('Collega prima il wallet');
  const m = new TextEncoder().encode(testo);
  if (attivo.wallet) {
    const f = attivo.wallet.features['solana:signMessage'];
    if (!f) throw new Error(`${attivo.wallet.name} non sa firmare messaggi: prova con Phantom, Solflare o Backpack`);
    const [esito] = await f.signMessage({ account: attivo.account, message: m });
    return base58.codifica(esito.signature);
  }
  const p = attivo.provider;
  if (typeof p.signMessage !== 'function') throw new Error('Questo wallet non sa firmare messaggi: aggiornalo e riprova');
  const r = await p.signMessage(m, 'utf8');
  return base58.codifica(r.signature || r);
}

