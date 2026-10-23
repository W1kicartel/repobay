// I pagamenti su Tron (TRX e USDT TRC-20), senza che la piattaforma tenga mai i soldi: il business paga da TronLink direttamente
// il builder, l'installatore e la piattaforma; il server controlla su TronGrid, solo fra le transazioni già solidificate
// (irreversibili), che ogni destinatario abbia ricevuto il suo, dallo stesso wallet e dopo l'ordine.
// Gli indirizzi Tron sono base58check di 21 byte che cominciano con 0x41 (in base58 cominciano con «T»).
// L'indirizzo di USDT viene dalla pagina ufficiale di Tether (https://tether.to/en/supported-protocols, «TRC20 Token via Tron
// Blockchain»). Per Nile Tether non pubblica un USDT di prova e le pagine di TRON non ne citano il contratto: lì c'è solo TRX.
import { base58check, daBase58check, daHex, inHex } from '../web/codifiche.js';

const TRANSFER = 'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';   // keccak256("Transfer(address,address,uint256)"), come in web3.js
const trx = { simbolo: 'TRX', indirizzo: null, decimali: 6, prezzo: 'tron' };
export const RETI_TRON = {
  tron: { nome: 'Tron', tipo: 'tron', api: 'https://api.trongrid.io', esploratore: 'https://tronscan.org',
    monete: [trx, { simbolo: 'USDT', indirizzo: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', decimali: 6, prezzo: 'tether' }] },
  // per le prove con monete senza valore (faucet di TRON: nileex.io); API ed esploratore da https://developers.tron.network/docs/networks
  'tron-nile': { nome: 'Tron Nile (prova)', tipo: 'tron', prova: true, api: 'https://nile.trongrid.io', esploratore: 'https://nile.tronscan.org', monete: [trx] },
};

// ---------------- indirizzi ----------------
export function tronInHex(s) {   // 'T…' → '41…' (42 cifre esadecimali minuscole), o null
  const b = typeof s === 'string' ? daBase58check(s) : null;
  return b && b.length === 21 && b[0] === 0x41 ? inHex(b) : null;
}
export const eIndirizzoTron = s => tronInHex(s) !== null;
export function hexInTron(h) {   // '41…' (o '0x…' / 40 cifre, come negli eventi) → 'T…', o null
  let x = typeof h === 'string' ? h.replace(/^0x/i, '').toLowerCase() : '';
  if (x.length === 40) x = '41' + x;
  const b = x.length === 42 && x.startsWith('41') ? daHex(x) : null;
  return b ? base58check(b) : null;
}
const inHex41 = a => (typeof a !== 'string' ? null : /^T/.test(a) ? tronInHex(a) : /^(0x|41)?[0-9a-fA-F]{40}$/.test(a) ? '41' + a.toLowerCase().slice(-40) : null);

// il client di TronGrid: POST JSON; con la chiave (TRON-PRO-API-KEY) i limiti di richieste sono più larghi
export function clienteTron(api, chiave) {
  return async function chiedi(percorso, corpo) {
    const r = await fetch(api + percorso, { method: 'POST', headers: { 'content-type': 'application/json', ...(chiave ? { 'TRON-PRO-API-KEY': chiave } : {}) }, body: JSON.stringify(corpo || {}), signal: AbortSignal.timeout(15e3) })
      .catch(e => { throw Object.assign(new Error(`Rete Tron: ${e.name === 'TimeoutError' ? 'nessuna risposta' : e.message}`), { stato: 502 }); });
    if (!r.ok) throw Object.assign(new Error(`Rete Tron: ${r.status}`), { stato: 502 });
    return r.json();
  };
}

// Il controllo sulla blockchain: le transazioni indicate devono essere solidificate e riuscite, fatte dopo l'ordine, dallo stesso
// pagatore, e devono portare a ogni destinatario almeno il suo importo. → { pagatore, tx } | { attesa } | { errore, mancante? }
export async function verificaTron({ rete, m, parti, tx = [], dopo, chiedi, memo = null, entro = null }) {
  const r = typeof rete === 'string' ? RETI_TRON[rete] : rete;
  if (!r?.api) return { errore: 'Rete non disponibile' };
  chiedi ||= clienteTron(r.api);
  const contratto = m.indirizzo ? tronInHex(m.indirizzo) : null;
  if (m.indirizzo && !contratto) return { errore: 'Moneta non valida' };
  const dovuto = new Map();
  for (const p of parti) {
    const a = tronInHex(p.indirizzo); if (!a) return { errore: 'Indirizzo del destinatario non valido', mancante: p.indirizzo };
    dovuto.set(a, (dovuto.get(a) || 0n) + BigInt(p.unita));
  }
  const ids = [...new Set((tx || []).map(x => String(x).toLowerCase()))];
  if (!ids.length) return { errore: 'Mancano le transazioni' };
  const ricevuto = new Map(), usate = []; let pagatore = null;
  const conta = (da, a, u, id) => {
    if (pagatore && pagatore !== da) return false;
    pagatore = da; ricevuto.set(a, (ricevuto.get(a) || 0n) + u); if (!usate.includes(id)) usate.push(id); return true;
  };
  for (const id of ids) {
    if (!/^[0-9a-f]{64}$/.test(id)) return { errore: 'Transazione non valida' };
    const t = await chiedi('/walletsolidity/gettransactionbyid', { value: id });
    if (!t?.txID) return { attesa: 'La transazione non è ancora definitiva: riprova fra un minuto' };
    if (t.txID.toLowerCase() !== id) return { errore: 'Transazione non valida' };
    const info = await chiedi('/walletsolidity/gettransactioninfobyid', { value: id });
    if (!info?.id || !info.blockTimeStamp) return { attesa: 'La transazione non è ancora definitiva: riprova fra un minuto' };
    if (Number(info.blockTimeStamp) < dopo - 120e3) return { errore: 'La transazione è precedente all\'ordine' };
    if (entro && Number(info.blockTimeStamp) > entro) return { errore: 'Pagato dopo la scadenza del prezzo: crea un nuovo ordine' };
    // il memo con l'etichetta dell'ordine lega la transazione all'ordine (TronLink lo aggiunge da solo)
    if (memo && !Buffer.from(String(t.raw_data?.data || ''), 'hex').toString('utf8').includes(memo)) continue;
    if (!contratto) {   // TRX: TransferContract
      if (t.ret?.[0]?.contractRet !== 'SUCCESS') return { errore: 'La transazione è fallita' };
      for (const c of t.raw_data?.contract || []) {
        if (c.type !== 'TransferContract') continue;
        const v = c.parameter?.value || {}, a = inHex41(v.to_address), da = inHex41(v.owner_address);
        if (!a || !da || !dovuto.has(a)) continue;
        if (!conta(da, a, BigInt(v.amount || 0), id)) return { errore: 'I trasferimenti vengono da wallet diversi' };
      }
    } else {            // USDT: l'evento Transfer del contratto (nei log l'indirizzo del contratto è senza il 41 iniziale)
      if (info.receipt?.result !== 'SUCCESS') return { errore: 'La transazione è fallita' };
      for (const l of info.log || []) {
        if (inHex41(l.address) !== contratto || String(l.topics?.[0]).toLowerCase() !== TRANSFER || l.topics.length < 3) continue;
        const da = '41' + l.topics[1].slice(-40).toLowerCase(), a = '41' + l.topics[2].slice(-40).toLowerCase();
        if (!dovuto.has(a)) continue;
        if (!conta(da, a, BigInt('0x' + (l.data || '0')), id)) return { errore: 'I trasferimenti vengono da wallet diversi' };
      }
    }
  }
  for (const [a, u] of dovuto) if ((ricevuto.get(a) || 0n) < u) return { errore: 'Gli importi non corrispondono all\'ordine', mancante: hexInTron(a) };
  return { pagatore: hexInTron(pagatore), tx: usate };
}
