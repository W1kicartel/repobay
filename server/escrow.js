// L'escrow sulle reti EVM: il contratto RepobayEscrow (contratti/src/RepobayEscrow.sol). Il business deposita l'intero pagamento
// nel contratto con la divisione già scritta; i soldi escono solo quando conferma l'installazione, oppure da soli dopo il
// periodo di trattenuta, oppure come decide l'arbitro (la piattaforma) se il pagamento viene congelato. Il server non ha
// chiavi: qui c'è solo quello che serve per parlare col contratto senza librerie, la codifica ABI delle chiamate, la lettura
// dello stato con eth_call e gli eventi nelle ricevute.
import { createHash } from 'node:crypto';
import { keccak256, checksum } from './cripto.js';

// gli stati del contratto (Order.state) con le parole del database
export const STATI = { 1: 'trattenuto', 2: 'contestato', 3: 'confermato', 4: 'rilasciato', 5: 'risolto', 6: 'rimborsato' };
export const CHIUSI = ['confermato', 'rilasciato', 'risolto', 'rimborsato'];
// l'id dell'ordine sul contratto: 32 byte, di cui i primi 8 sono l'etichetta scritta nei pagamenti diretti (etichettaOrdine)
export const idEscrow = codice => '0x' + createHash('sha256').update(`ordine:${codice}`).digest('hex');
export const ZERO = '0x' + '0'.repeat(40);
// il contratto archivia l'ordine sotto keyOf(pagatore, id) = keccak256(abi.encode(pagatore, id)): chi copia l'id da una transazione
// in attesa e deposita prima non blocca il cliente, perché ogni pagatore ha i suoi id. Dopo il deposito tutte le azioni usano la chiave.
export const chiaveEscrow = (pagatore, id) => '0x' + keccak256(Buffer.from(codifica(['address', 'bytes32'], [pagatore, id]), 'hex')).toString('hex');
export const chiaveOrdine = o => chiaveEscrow(o.pagatore, idEscrow(o.codice));
// fino a quando il contratto accetta il deposito (secondi): la scadenza del prezzo più due minuti, come la verifica qui sotto.
// Un deposito tardivo il contratto lo rifiuta, invece di tenerlo fermo in un ordine che il sito non riconosce più.
export const scadenzaDeposito = scade => Math.floor((new Date(scade).getTime() + 120e3) / 1000);

const hashDi = testo => '0x' + keccak256(Buffer.from(testo, 'utf8')).toString('hex');
export const FIRME = {
  approve: 'approve(address,uint256)', deposit: 'deposit(bytes32,address,uint256,uint64,address[],uint256[])',
  confirm: 'confirm(bytes32,address[],uint256[])', release: 'release(bytes32,address[],uint256[])', dispute: 'dispute(bytes32)', refund: 'refund(bytes32)',
  resolve: 'resolve(bytes32,address[],uint256[],uint256[])', orders: 'orders(bytes32)', arbiter: 'arbiter()', hold: 'hold()', window: 'window()',
};
export const SELETTORI = Object.fromEntries(Object.entries(FIRME).map(([k, f]) => [k, hashDi(f).slice(0, 10)]));
export const EVENTI = { Deposited: hashDi('Deposited(bytes32,bytes32,address,address,uint256,bytes32,uint64)'), Resolved: hashDi('Resolved(bytes32,uint256,uint256[])') };

// ---------------- la codifica ABI: parole di 32 byte, gli array dinamici in coda con l'offset in testa ----------------
const parola = x => (typeof x === 'bigint' ? x.toString(16) : String(x).replace(/^0x/, '')).toLowerCase().padStart(64, '0');
export function codifica(tipi, valori) {
  const testa = [], coda = []; let offset = tipi.length * 32;
  tipi.forEach((t, i) => {
    const v = valori[i];
    if (t.endsWith('[]')) {
      testa.push(parola(BigInt(offset))); coda.push(parola(BigInt(v.length)) + v.map(x => parola(t === 'address[]' ? x : BigInt(x))).join('')); offset += 32 * (1 + v.length);
    } else testa.push(parola(t === 'address' || t === 'bytes32' ? v : BigInt(v)));
  });
  return testa.join('') + coda.join('');
}
// keccak256(abi.encode(payees, amounts)): la divisione fissata al deposito, che il contratto ricontrolla a ogni uscita
export const hashSplit = (indirizzi, unita) => '0x' + keccak256(Buffer.from(codifica(['address[]', 'uint256[]'], [indirizzi, unita]), 'hex')).toString('hex');
const indirizzi = parti => parti.map(p => p.indirizzo), unitaDi = parti => parti.map(p => BigInt(p.unita));
export const totaleDi = parti => unitaDi(parti).reduce((s, u) => s + u, 0n);

// le chiamate del wallet del business: per un token, approve + deposit (una conferma sola con EIP-5792); per la moneta della rete, deposit col valore.
// `scadenza` in secondi (scadenzaDeposito): dopo, il contratto rifiuta il deposito
export function chiamateEscrow(escrow, id, m, parti, scadenza) {
  const totale = totaleDi(parti);
  const dati = SELETTORI.deposit + codifica(['bytes32', 'address', 'uint256', 'uint64', 'address[]', 'uint256[]'], [id, m.indirizzo || ZERO, totale, scadenza, indirizzi(parti), unitaDi(parti)]);
  return m.indirizzo
    ? [{ to: checksum(m.indirizzo), value: '0x0', data: SELETTORI.approve + codifica(['address', 'uint256'], [escrow, totale]) }, { to: checksum(escrow), value: '0x0', data: dati }]
    : [{ to: checksum(escrow), value: '0x' + totale.toString(16), data: dati }];
}
// i dati di un'azione sul contratto, per la chiave dell'ordine (chiaveEscrow): conferma e rilascia (le parti di nuovo, il contratto le
// confronta con l'hash), contesta e rimborsa (solo la chiave), risolvi (i pagamenti decisi)
export function datiAzione(azione, chiave, parti, pagamenti = null) {
  if (azione === 'contesta' || azione === 'rimborsa') return SELETTORI[azione === 'contesta' ? 'dispute' : 'refund'] + codifica(['bytes32'], [chiave]);
  if (azione === 'risolvi') return SELETTORI.resolve + codifica(['bytes32', 'address[]', 'uint256[]', 'uint256[]'], [chiave, indirizzi(parti), unitaDi(parti), pagamenti.map(BigInt)]);
  return SELETTORI[azione === 'conferma' ? 'confirm' : 'release'] + codifica(['bytes32', 'address[]', 'uint256[]'], [chiave, indirizzi(parti), unitaDi(parti)]);
}

// ---------------- leggere il contratto ----------------
const parole = (r, n) => { const d = String(r || '').replace(/^0x/, ''); if (d.length < 64 * n) throw Object.assign(new Error('Rete: risposta del contratto non valida'), { stato: 502 }); return i => d.slice(64 * i, 64 * (i + 1)); };
export async function statoEscrow(rpc, rete, escrow, chiave) {
  const w = parole(await rpc(rete.rpc, 'eth_call', [{ to: escrow, data: SELETTORI.orders + chiave.slice(2) }, 'latest']), 8), n = i => BigInt('0x' + w(i));
  const stato = Number(n(5));
  return { stato, custodia: STATI[stato] || null, pagatore: stato ? checksum('0x' + w(0).slice(24)) : null, token: '0x' + w(1).slice(24), totale: n(2),
    sblocco: Number(n(3)), contestatoIl: Number(n(4)), split: '0x' + w(6), rimborsato: n(7) };
}
export async function arbitroDi(rpc, rete, escrow) { return checksum('0x' + parole(await rpc(rete.rpc, 'eth_call', [{ to: escrow, data: SELETTORI.arbiter }, 'latest']), 1)(0).slice(24)); }
// trattenuta e finestra dell'arbitro, in secondi, come le ha scritte chi ha pubblicato il contratto
export async function tempiDi(rpc, rete, escrow) {
  const leggi = async s => Number(BigInt('0x' + parole(await rpc(rete.rpc, 'eth_call', [{ to: escrow, data: SELETTORI[s] }, 'latest']), 1)(0)));
  return { trattenuta: await leggi('hold'), finestra: await leggi('window') };
}

// il deposito nelle ricevute indicate: l'evento Deposited del contratto, con il nostro id, il token, il totale e la divisione giusti.
// Gli argomenti indicizzati sono [firma, chiave, id, pagatore]. → {pagatore, chiave, tx, sblocco, blocco} o un errore; «attesa» se mancano conferme
export async function verificaDeposito({ rpc, rete, escrow, id, m, parti, hash, dopo, entro = null }) {
  const atteso = { token: (m.indirizzo || ZERO).toLowerCase(), totale: totaleDi(parti), split: hashSplit(indirizzi(parti), unitaDi(parti)) };
  const ultimo = BigInt(await rpc(rete.rpc, 'eth_blockNumber'));
  let attesa = null;
  for (const h of hash) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(h)) return { errore: 'Transazione non valida' };
    const ric = await rpc(rete.rpc, 'eth_getTransactionReceipt', [h]);
    if (!ric) { attesa = 'La transazione non è ancora in un blocco'; continue; }
    if (ric.status !== '0x1') { if (ric.to?.toLowerCase() === escrow.toLowerCase()) return { errore: 'La transazione è fallita' }; continue; }
    const log = (ric.logs || []).find(l => l.address?.toLowerCase() === escrow.toLowerCase() && l.topics?.[0] === EVENTI.Deposited && l.topics[2]?.toLowerCase() === id.toLowerCase());
    if (!log) continue;   // l'approve, o una transazione d'altro
    const w = parole(log.data, 4), pagatore = checksum('0x' + log.topics[3].slice(-40));
    if ('0x' + w(0).slice(24) !== atteso.token || BigInt('0x' + w(1)) !== atteso.totale || '0x' + w(2) !== atteso.split) return { errore: 'Il deposito non corrisponde all\'ordine' };
    if (log.topics[1].toLowerCase() !== chiaveEscrow(pagatore, id)) return { errore: 'Il deposito non corrisponde all\'ordine' };
    if (ultimo - BigInt(ric.blockNumber) + 1n < BigInt(rete.conferme)) return { attesa: 'In attesa di conferme' };
    const blocco = await rpc(rete.rpc, 'eth_getBlockByNumber', [ric.blockNumber, false]), quando = Number(BigInt(blocco.timestamp)) * 1000;
    if (quando < dopo - 120e3) return { errore: 'La transazione è precedente all\'ordine' };
    if (entro && quando > entro) return { errore: 'Pagato dopo la scadenza del prezzo: crea un nuovo ordine' };
    return { pagatore, chiave: chiaveEscrow(pagatore, id), tx: [h], sblocco: Number(BigInt('0x' + w(3))), blocco: Number(BigInt(ric.blockNumber)) };
  }
  return attesa ? { attesa } : { errore: 'Nessun deposito nel contratto per questo ordine' };
}

// i depositi per un id fra due blocchi (gli eventi Deposited con quell'id, da qualunque pagatore): per trovare un deposito che il
// browser non ha fatto in tempo a segnalare (pagina chiusa, connessione persa)
export async function depositiDi(rpc, rete, escrow, id, da, a) {
  const hex = n => '0x' + n.toString(16);
  return rpc(rete.rpc, 'eth_getLogs', [{ address: escrow, fromBlock: hex(da), toBlock: hex(a), topics: [EVENTI.Deposited, null, id] }]);
}

// la decisione dell'arbitro, dall'evento Resolved: quanto torna al pagatore e quanto va a ciascuna parte
export function esitoDaLog(logs, escrow, chiave) {
  const log = (logs || []).find(l => l.address?.toLowerCase() === escrow.toLowerCase() && l.topics?.[0] === EVENTI.Resolved && l.topics[1]?.toLowerCase() === chiave.toLowerCase());
  if (!log) return null;
  const w = parole(log.data, 3), n = i => BigInt('0x' + w(i)), quanti = Number(n(2));   // parola 0: il rimborso; 1: l'offset dell'array; 2: la lunghezza; poi gli elementi
  return { rimborso: n(0), pagamenti: Array.from({ length: quanti }, (_, i) => n(3 + i)) };
}
export async function esitoDaRete(rpc, rete, escrow, chiave, daBlocco = 0) {
  return esitoDaLog(await rpc(rete.rpc, 'eth_getLogs', [{ address: escrow, fromBlock: '0x' + Math.max(0, daBlocco).toString(16), toBlock: 'latest', topics: [EVENTI.Resolved, chiave] }]), escrow, chiave);
}
// una transazione è davvero un'azione su questo ordine? riuscita, e con un evento del contratto per la sua chiave
export const azioneDellOrdine = (ricevuta, escrow, chiave) => ricevuta?.status === '0x1'
  && (ricevuta.logs || []).some(l => l.address?.toLowerCase() === escrow.toLowerCase() && l.topics?.[1]?.toLowerCase() === chiave.toLowerCase());

// i pagamenti decisi: quanto rimborsare (in unità) e a carico di chi. «tutti» in proporzione; «installatore» o «builder» prima dalla loro
// parte (il builder insieme a chi lo mantiene), poi dagli altri, la piattaforma per ultima. → le unità per ogni parte, nello stesso ordine
export function pagamentiDecisi(parti, rimborso, carico = 'tutti') {
  const u = unitaDi(parti), totale = u.reduce((s, x) => s + x, 0n);
  let resto = rimborso < 0n ? 0n : rimborso > totale ? totale : rimborso;
  const gruppi = carico === 'installatore' ? [['installatore'], ['builder', 'cotitolare', 'collaboratore'], ['piattaforma']]
    : carico === 'builder' ? [['builder', 'cotitolare', 'collaboratore'], ['installatore'], ['piattaforma']] : [['builder', 'cotitolare', 'collaboratore', 'installatore', 'piattaforma']];
  const tolto = u.map(() => 0n);
  for (const g of gruppi) {
    if (resto <= 0n) break;
    const idx = parti.map((p, i) => (g.includes(p.ruolo) ? i : -1)).filter(i => i >= 0), somma = idx.reduce((s, i) => s + u[i], 0n);
    if (!somma) continue;
    const quota = resto > somma ? somma : resto;
    const base = idx.map(i => u[i] * quota / somma); let dato = base.reduce((s, x) => s + x, 0n);
    for (let k = 0; dato < quota; k = (k + 1) % idx.length) if (base[k] < u[idx[k]]) { base[k] += 1n; dato += 1n; }   // il resto dell'arrotondamento, a chi ha ancora margine
    idx.forEach((i, k) => { tolto[i] = base[k]; });
    resto -= quota;
  }
  return u.map((x, i) => x - tolto[i]);
}
