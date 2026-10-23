// I pagamenti in crypto, senza che la piattaforma tenga mai i soldi: il business paga dal suo wallet direttamente il builder,
// l'installatore e la piattaforma (per i token anche in una sola conferma, con i wallet che supportano EIP-5792); il server
// controlla sulla blockchain che i trasferimenti ci siano, con gli importi giusti, e registra la vendita.
// In crypto si paga l'installazione più un anno di assistenza in anticipo (i pagamenti crypto non si rinnovano da soli).
// Gli indirizzi dei token vengono dalle pagine ufficiali di Circle (USDC, EURC) e Tether (USDT); i prezzi da CoinGecko.
import { createHash } from 'node:crypto';
import { eIndirizzo, checksum } from './cripto.js';

// l'etichetta di un ordine: 8 byte scritti in coda ai dati di ogni trasferimento (i contratti ERC-20 e i wallet li ignorano).
// Lega la transazione al suo ordine: chi vede passare il pagamento di un altro non può usarlo per confermare il proprio.
export const etichettaOrdine = codice => createHash('sha256').update(`ordine:${codice}`).digest('hex').slice(0, 16);

export const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';   // keccak256("Transfer(address,address,uint256)")
const nativo = (simbolo, prezzo) => ({ simbolo, indirizzo: null, decimali: 18, prezzo });
const token = (simbolo, indirizzo, prezzo) => ({ simbolo, indirizzo, decimali: 6, prezzo });
export const RETI = {
  ethereum: { nome: 'Ethereum', chainId: 1, rpc: 'https://ethereum-rpc.publicnode.com', esploratore: 'https://etherscan.io', conferme: 3,
    monete: [nativo('ETH', 'ethereum'), token('USDC', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 'usd-coin'), token('USDT', '0xdAC17F958D2ee523a2206206994597C13D831ec7', 'tether'), token('EURC', '0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c', 'euro-coin')] },
  base: { nome: 'Base', chainId: 8453, rpc: 'https://mainnet.base.org', esploratore: 'https://basescan.org', conferme: 3,
    monete: [nativo('ETH', 'ethereum'), token('USDC', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 'usd-coin'), token('EURC', '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42', 'euro-coin')] },
  arbitrum: { nome: 'Arbitrum', chainId: 42161, rpc: 'https://arb1.arbitrum.io/rpc', esploratore: 'https://arbiscan.io', conferme: 3,
    monete: [nativo('ETH', 'ethereum'), token('USDC', '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', 'usd-coin')] },
  polygon: { nome: 'Polygon', chainId: 137, rpc: 'https://polygon-rpc.com', esploratore: 'https://polygonscan.com', conferme: 5,
    monete: [nativo('POL', 'polygon-ecosystem-token'), token('USDC', '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', 'usd-coin')] },
  // per le prove con soldi finti (faucet di Circle e di Base)
  'base-sepolia': { nome: 'Base Sepolia (prova)', chainId: 84532, rpc: 'https://sepolia.base.org', esploratore: 'https://sepolia.basescan.org', conferme: 1, prova: true,
    monete: [nativo('ETH', 'ethereum'), token('USDC', '0x036CbD53842c5426634e7929541eC2318f3dCF7e', 'usd-coin'), token('EURC', '0x808456652fdb597867f38412077A9182bf77359F', 'euro-coin')] },
};

export function reti(cfg) {   // le reti accese (OFFICINA_RETI), con gli RPC sostituibili (RPC_BASE, RPC_ETHEREUM…)
  return cfg.crypto.reti.filter(n => RETI[n]).map(n => ({ id: n, ...RETI[n], rpc: cfg.crypto.rpc[n] || RETI[n].rpc }));
}
export const moneta = (rete, simbolo) => rete?.monete.find(m => m.simbolo === simbolo) || null;

export function clienteRpc() {
  let id = 0;
  return async function rpc(url, metodo, params = []) {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: metodo, params }), signal: AbortSignal.timeout(15e3) })
      .catch(e => { throw Object.assign(new Error(`Rete: ${e.name === 'TimeoutError' ? 'nessuna risposta' : e.message}`), { stato: 502 }); });
    const j = await r.json().catch(() => ({}));
    if (j.error || !r.ok) throw Object.assign(new Error(`Rete: ${j.error?.message || r.status}`), { stato: 502 });
    return j.result;
  };
}

// i prezzi in euro (CoinGecko), tenuti un minuto; `ids` sono tutte le monete di tutte le reti (reti.js → idPrezzi)
export function clientePrezzi(base, idsTutti = null) {
  let memo = { quando: 0, prezzi: {} };
  return async function prezzo(id) {
    if (Date.now() - memo.quando > 60e3) {
      const ids = (idsTutti || [...new Set(Object.values(RETI).flatMap(r => r.monete.map(m => m.prezzo)))]).join(',');
      const r = await fetch(`${base}/simple/price?ids=${ids}&vs_currencies=eur`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw Object.assign(new Error('Prezzi non disponibili: riprova fra poco'), { stato: 503 });
      memo = { quando: Date.now(), prezzi: await r.json() };
    }
    const p = memo.prezzi[id]?.eur; if (!p || !(p > 0)) throw Object.assign(new Error('Prezzo non disponibile'), { stato: 503 }); return p;
  };
}

// dagli euro alle unità del token, arrotondando in su: centesimi × 10^decimali / (prezzo in euro × 100)
export function unita(centesimi, prezzoEur, decimali) {
  const micro = BigInt(Math.round(prezzoEur * 1e6)); if (micro <= 0n) throw new Error('prezzo non valido');
  const num = BigInt(centesimi) * 10n ** BigInt(decimali) * 10000n;
  return (num + micro - 1n) / micro;
}
// come dividi() in soldi.js, ma su unità grandi (BigInt): installatore per difetto, piattaforma arrotondata, il resto al builder
export function dividiUnita(totale, frazioneInstallatore, frazionePiattaforma) {
  const ppm = q => BigInt(Math.round(q * 1e6));
  const piattaforma = (totale * ppm(frazionePiattaforma) + 500_000n) / 1_000_000n, installatore = (totale - piattaforma) * ppm(frazioneInstallatore) / 1_000_000n;
  return { installatore, piattaforma, builder: totale - installatore - piattaforma };
}

// le chiamate che il wallet del business deve fare: per un token, transfer(destinatario, importo) sul contratto; per la moneta
// della rete, un invio di valore. Un destinatario con più parti (il builder che installa da sé) riceve una volta sola, la somma.
export function chiamate(m, parti, etichetta = '') {
  const per = new Map();
  for (const p of parti) per.set(p.indirizzo.toLowerCase(), (per.get(p.indirizzo.toLowerCase()) || 0n) + BigInt(p.unita));
  return [...per].filter(([, u]) => u > 0n).map(([a, u]) => m.indirizzo
    ? { to: checksum(m.indirizzo), value: '0x0', data: '0xa9059cbb' + a.slice(2).padStart(64, '0') + u.toString(16).padStart(64, '0') + etichetta }
    : { to: checksum(a), value: '0x' + u.toString(16), data: '0x' + etichetta });
}

// il controllo sulla blockchain: le transazioni indicate devono essere riuscite, abbastanza confermate, fatte dopo l'ordine,
// dallo stesso pagatore, e devono portare a ogni destinatario almeno il suo importo. → {pagatore} o un errore; «attesa» se mancano conferme
// `etichetta`: conta solo le transazioni che la portano nei dati; `entro`: il pagamento deve arrivare prima che il prezzo scada
export async function verifica({ rpc, rete, m, parti, hash, dopo, etichetta = null, entro = null }) {
  const dovuto = new Map();
  for (const p of parti) dovuto.set(p.indirizzo.toLowerCase(), (dovuto.get(p.indirizzo.toLowerCase()) || 0n) + BigInt(p.unita));
  const ricevuto = new Map(), contate = new Set(); let pagatore = null;
  const ultimo = BigInt(await rpc(rete.rpc, 'eth_blockNumber'));
  for (const h of hash) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(h)) return { errore: 'Transazione non valida' };
    const ric = await rpc(rete.rpc, 'eth_getTransactionReceipt', [h]);
    if (!ric) return { attesa: 'La transazione non è ancora in un blocco' };
    if (ric.status !== '0x1') return { errore: 'La transazione è fallita' };
    if (ultimo - BigInt(ric.blockNumber) + 1n < BigInt(rete.conferme)) return { attesa: 'In attesa di conferme' };
    const blocco = await rpc(rete.rpc, 'eth_getBlockByNumber', [ric.blockNumber, false]);
    if (Number(BigInt(blocco.timestamp)) * 1000 < dopo - 120e3) return { errore: 'La transazione è precedente all\'ordine' };
    if (entro && Number(BigInt(blocco.timestamp)) * 1000 > entro) return { errore: 'Pagato dopo la scadenza del prezzo: crea un nuovo ordine' };
    let txd = null;
    if (etichetta) {   // i dati della transazione (anche quella di un wallet smart che esegue un pacchetto) devono contenere l'etichetta
      txd = await rpc(rete.rpc, 'eth_getTransactionByHash', [h]);
      if (!String(txd?.input || txd?.data || '').toLowerCase().includes(etichetta)) continue;
    }
    if (m.indirizzo) {
      for (const l of ric.logs || []) {
        if (l.address?.toLowerCase() !== m.indirizzo.toLowerCase() || l.topics?.[0] !== TRANSFER || l.topics.length < 3) continue;
        const da = '0x' + l.topics[1].slice(-40), a = '0x' + l.topics[2].slice(-40);
        if (!dovuto.has(a)) continue;
        if (pagatore && pagatore !== da) return { errore: 'I trasferimenti vengono da wallet diversi' };
        pagatore = da; ricevuto.set(a, (ricevuto.get(a) || 0n) + BigInt(l.data)); contate.add(h);
      }
    } else {
      const tx = txd || await rpc(rete.rpc, 'eth_getTransactionByHash', [h]);
      const a = tx?.to?.toLowerCase(), da = tx?.from?.toLowerCase();
      if (!a || !dovuto.has(a)) continue;
      if (pagatore && pagatore !== da) return { errore: 'I trasferimenti vengono da wallet diversi' };
      pagatore = da; ricevuto.set(a, (ricevuto.get(a) || 0n) + BigInt(tx.value)); contate.add(h);
    }
  }
  for (const [a, u] of dovuto) if ((ricevuto.get(a) || 0n) < u) return { errore: 'Gli importi non corrispondono all\'ordine', mancante: a };
  return { pagatore: checksum(pagatore), tx: [...contate] };
}

export { eIndirizzo, checksum };
