// I wallet Bitcoin del browser: Leather (window.LeatherProvider), Xverse (window.XverseProviders.BitcoinProvider) e UniSat
// (window.unisat). Leather e Xverse pagano tutti i destinatari in una transazione sola (sendTransfer con recipients); UniSat uno
// alla volta (sendBitcoin). Chi non ha nessuno di questi paga leggendo i QR (BIP21).
// API dai documenti ufficiali: Leather https://leather.gitbook.io/developers/bitcoin-methods/sendtransfer (importi in sats come
// testo, rete «mainnet»/«testnet»), Xverse https://docs.xverse.app/sats-connect/bitcoin-methods/sendtransfer (importi in sats come
// numero, risposta JSON-RPC), UniSat https://docs.unisat.io/dev/open-api-documentation/unisat-wallet (sendBitcoin → txid).
const WALLET = [
  { id: 'leather', nome: 'Leather', insieme: true, c: () => window.LeatherProvider?.request },
  { id: 'xverse', nome: 'Xverse', insieme: true, c: () => window.XverseProviders?.BitcoinProvider?.request },
  { id: 'unisat', nome: 'UniSat', insieme: false, c: () => window.unisat?.sendBitcoin },
];
// → [{ id, nome, insieme }] dei wallet presenti; «insieme» = tutti i destinatari in una conferma
export const walletBitcoin = () => WALLET.filter(w => typeof w.c() === 'function').map(({ id, nome, insieme }) => ({ id, nome, insieme }));

// le risposte JSON-RPC ({ result } o { error }) e gli errori lanciati diventano un risultato o un Error leggibile
function risultato(r) {
  const e = r?.error; if (!e) return r?.result ?? r;
  throw Object.assign(new Error(e.code === 4001 || e.code === -32000 ? 'Hai annullato il pagamento nel wallet' : e.message || 'Il wallet ha rifiutato il pagamento'), { code: e.code });
}
const chiama = async (f) => { try { return risultato(await f()); } catch (e) { if (e?.error) risultato(e); throw e; } };

// → i txid. parti: [{ indirizzo, unita (sats) }]; opzioni: rete 'bitcoin' | 'bitcoin-testnet4', avviso(testo)
export async function pagaBitcoin(id, parti, { rete = 'bitcoin', avviso = () => {} } = {}) {
  const prova = rete !== 'bitcoin', per = new Map();
  for (const p of parti) { const a = /^(bc|tb)1/i.test(p.indirizzo) ? p.indirizzo.toLowerCase() : p.indirizzo; per.set(a, (per.get(a) || 0n) + BigInt(p.unita)); }
  const lista = [...per].filter(([, u]) => u > 0n);
  if (!lista.length) return [];

  if (id === 'leather') {
    const p = window.LeatherProvider; if (!p) throw new Error('Leather non è nel browser');
    avviso('Conferma il pagamento in Leather…');
    const r = await chiama(() => p.request('sendTransfer', { recipients: lista.map(([address, u]) => ({ address, amount: u.toString() })), network: prova ? 'testnet' : 'mainnet' }));
    if (!r?.txid) throw new Error('Leather non ha restituito la transazione');
    return [r.txid];
  }
  if (id === 'xverse') {
    const p = window.XverseProviders?.BitcoinProvider; if (!p) throw new Error('Xverse non è nel browser');
    let rete_;
    try { rete_ = await chiama(() => p.request('wallet_getNetwork', null)); }
    catch { rete_ = (await chiama(() => p.request('wallet_connect', { addresses: ['payment'], message: 'Collega il wallet per pagare' })))?.network; }   // senza permesso: si collega
    const nome = rete_?.bitcoin?.name;
    if (nome && nome !== (prova ? 'Testnet4' : 'Mainnet')) throw new Error(`In Xverse scegli la rete ${prova ? 'Testnet4' : 'Mainnet'} e riprova`);
    avviso('Conferma il pagamento in Xverse…');
    const r = await chiama(() => p.request('sendTransfer', { recipients: lista.map(([address, u]) => ({ address, amount: Number(u) })) }));
    if (!r?.txid) throw new Error('Xverse non ha restituito la transazione');
    return [r.txid];
  }
  if (id === 'unisat') {
    const u = window.unisat; if (!u) throw new Error('UniSat non è nel browser');
    await u.requestAccounts();
    if (typeof u.getChain === 'function') {   // UniSat serve anche Fractal, che usa gli stessi indirizzi: la catena va controllata
      const c = (await u.getChain())?.enum;
      if (!prova && c !== 'BITCOIN_MAINNET') {
        if (typeof u.switchChain !== 'function') throw new Error('In UniSat scegli Bitcoin Mainnet e riprova');
        await u.switchChain('BITCOIN_MAINNET');
      }
      if (prova && !/TESTNET4/.test(String(c))) throw new Error('In UniSat scegli Bitcoin Testnet4 e riprova');
    }
    const txid = [];
    for (const [i, [a, s]] of lista.entries()) {
      avviso(`Conferma ${i + 1} di ${lista.length} in UniSat…`);
      txid.push(await u.sendBitcoin(a, Number(s)));
    }
    return txid;
  }
  throw new Error('Wallet Bitcoin non supportato');
}
