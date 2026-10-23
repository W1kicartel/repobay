// Tutte le reti dei pagamenti in crypto in un posto solo: le EVM (web3.js), Solana, Bitcoin e Tron. Per ogni tipo di rete:
// come si riconosce un indirizzo, dove l'iscritto tiene il suo (colonna di utente), qual è quello della piattaforma, e come
// si prova che un indirizzo è davvero suo (una firma che non costa nulla e non sposta fondi).
import { createPublicKey, verify } from 'node:crypto';
import { RETI, eIndirizzo, checksum } from './web3.js';
import { keccak256, recupera, verificaMessaggio } from './cripto.js';
import { RETI_SOLANA, eIndirizzoSolana, base58 } from './solana.js';
import { RETI_BITCOIN, tipoIndirizzoBitcoin, normaleBitcoin } from './bitcoin.js';
import { RETI_TRON, eIndirizzoTron, hexInTron } from './tron.js';

export const TUTTE = {
  ...Object.fromEntries(Object.entries(RETI).map(([k, r]) => [k, { tipo: 'evm', ...r }])),
  ...RETI_SOLANA, ...RETI_BITCOIN, ...RETI_TRON,
};
export const TIPI = {
  evm: { colonna: 'wallet', nome: 'Ethereum e reti EVM (Base, Arbitrum, Polygon)', valido: eIndirizzo, normale: a => checksum(a), firma: true },
  solana: { colonna: 'wallet_sol', nome: 'Solana', valido: eIndirizzoSolana, normale: a => a, firma: true },
  bitcoin: { colonna: 'wallet_btc', nome: 'Bitcoin', valido: a => !!tipoIndirizzoBitcoin(a, 'bitcoin') || !!tipoIndirizzoBitcoin(a, 'bitcoin-testnet4'),
    normale: a => normaleBitcoin(a, 'bitcoin') || normaleBitcoin(a, 'bitcoin-testnet4'), firma: false },
  tron: { colonna: 'wallet_tron', nome: 'Tron', valido: eIndirizzoTron, normale: a => a, firma: true },
};
export const tipoDi = rete => TUTTE[rete]?.tipo || null;

// le reti accese (APP_RETI), con gli RPC sostituibili (RPC_BASE, RPC_SOLANA…) e l'indirizzo della piattaforma su ciascuna;
// una rete senza l'indirizzo della piattaforma resta spenta
export function retiAccese(cfg) {
  return cfg.crypto.reti.filter(n => TUTTE[n]).map(n => {
    const r = TUTTE[n], piattaforma = r.tipo === 'evm' ? cfg.crypto.wallet : cfg.crypto.altri[r.tipo];
    return { id: n, ...r, ...(r.rpc ? { rpc: cfg.crypto.rpc[n] || r.rpc } : {}), ...(r.api ? { api: cfg.crypto.rpc[n] || r.api } : {}), piattaforma,
      escrow: r.tipo === 'evm' ? cfg.crypto.escrow[n] || null : null };
  }).filter(r => r.piattaforma && TIPI[r.tipo].valido(r.piattaforma));
}
export const idPrezzi = () => [...new Set(Object.values(TUTTE).flatMap(r => r.monete.map(m => m.prezzo)))];
export const walletDi = (u, tipo) => u?.[TIPI[tipo].colonna] || null;

// la prova di possesso: il messaggio firmato col wallet. Bitcoin non ha un modo comune nei wallet del browser (BIP322 è poco
// supportato): lì l'indirizzo si scrive a mano e lo protegge la sua somma di controllo.
export function verificaPossesso(tipo, messaggio, firma, indirizzo) {
  try {
    if (tipo === 'evm') return verificaMessaggio(messaggio, firma, indirizzo);
    if (tipo === 'solana') {   // ed25519 sui byte del messaggio; la firma in base58 (Wallet Standard e Phantom)
      const chiave = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(base58.decodifica(indirizzo))]), format: 'der', type: 'spki' });
      const f = /^[0-9a-f]{128}$/i.test(firma) ? Buffer.from(firma, 'hex') : Buffer.from(base58.decodifica(firma));
      return f.length === 64 && verify(null, Buffer.from(messaggio, 'utf8'), chiave, f);
    }
    if (tipo === 'tron') {   // TronLink signMessageV2: come EIP-191 ma con «\x19TRON Signed Message:\n»
      const m = Buffer.from(messaggio, 'utf8');
      const a = recupera(keccak256(Buffer.concat([Buffer.from(`\x19TRON Signed Message:\n${m.length}`, 'utf8'), m])), firma);
      return !!a && hexInTron('41' + a.slice(2).toLowerCase()) === indirizzo;
    }
  } catch { }
  return false;
}
