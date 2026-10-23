// I pagamenti su Solana (SOL, USDC, USDT) senza librerie: il server prepara UNA transazione non firmata che paga in un colpo
// builder, installatore e piattaforma; il wallet del business la firma e la manda; il server poi controlla sulla blockchain
// che i soldi siano arrivati, con gli importi giusti. Stessa forma di web3.js (reti, monete, verifica → {pagatore} | attesa | errore).
// Gli indirizzi dei token vengono dalle pagine ufficiali: USDC da Circle (developers.circle.com/stablecoins/usdc-contract-addresses,
// anche quello di devnet), USDT da Tether (tether.to/en/supported-protocols); i programmi dai documenti SPL (spl.solana.com/token,
// /associated-token-account, /memo). Il token program di USDC e USDT è quello classico (Tokenkeg…), non Token-2022: verificato
// con getAccountInfo sui mint (owner = Tokenkeg…, 6 decimali) l'11/10/2026.
// Formati: transazione «legacy» (docs.solana.com, «Transactions»), Solana Pay (docs.solanapay.com/spec).
import { createHash, randomBytes } from 'node:crypto';
import { base58 } from '../web/base58.js';

export const PROGRAMMI = {
  sistema: '11111111111111111111111111111111',               // System Program
  token: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',       // SPL Token (classico)
  ata: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',         // Associated Token Account
  memo: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',         // Memo v2
};

const sol = { simbolo: 'SOL', indirizzo: null, decimali: 9, prezzo: 'solana' };
const spl = (simbolo, indirizzo, prezzo) => ({ simbolo, indirizzo, decimali: 6, prezzo, programma: PROGRAMMI.token });
export const RETI_SOLANA = {
  solana: { nome: 'Solana', tipo: 'solana', rpc: 'https://api.mainnet-beta.solana.com', esploratore: 'https://solscan.io', esploratoreQuery: '',
    cluster: 'solana:mainnet', impegno: 'finalized',
    monete: [sol, spl('USDC', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'usd-coin'), spl('USDT', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', 'tether')] },
  // per le prove con soldi finti (SOL dal faucet di Solana, USDC dal faucet di Circle)
  'solana-devnet': { nome: 'Solana Devnet (prova)', tipo: 'solana', rpc: 'https://api.devnet.solana.com', esploratore: 'https://solscan.io', esploratoreQuery: '?cluster=devnet',
    cluster: 'solana:devnet', impegno: 'confirmed', prova: true,
    monete: [sol, spl('USDC', '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', 'usd-coin')] },
};

export { base58 };
export { linkSolanaPay } from '../web/solana.js';

// ---------------- indirizzi ----------------
export function eIndirizzoSolana(s) {
  if (typeof s !== 'string' || s.length < 32 || s.length > 44) return false;
  try { return base58.decodifica(s).length === 32; } catch { return false; }
}
const eFirma = s => { if (typeof s !== 'string' || s.length < 64 || s.length > 88) return false; try { return base58.decodifica(s).length === 64; } catch { return false; } };
const byte = a => (typeof a === 'string' ? base58.decodifica(a) : Uint8Array.from(a));

// ---------------- ed25519: il punto sta sulla curva? ----------------
// Come CompressedEdwardsY::decompress di curve25519-dalek (quello che usa Solana): y sono i 255 bit bassi (ridotti mod p),
// il bit alto è il segno di x e non conta per la validità; c'è un punto se x² = (y² − 1)/(d·y² + 1) ha soluzione.
const P = 2n ** 255n - 19n;
const mod = a => ((a % P) + P) % P;
function potenza(b, e) { let r = 1n; b = mod(b); while (e > 0n) { if (e & 1n) r = r * b % P; b = b * b % P; e >>= 1n; } return r; }
const inverso = a => potenza(a, P - 2n);
const D = mod(-121665n * inverso(121666n));
export function sullaCurva(b) {
  const x = byte(b); if (x.length !== 32) return false;
  let y = 0n; for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(i === 31 ? x[i] & 0x7f : x[i]);
  const y2 = mod(y * y), u = mod(y2 - 1n), v = mod(D * y2 + 1n);   // v non è mai zero: −1/d non è un quadrato
  const w = u * inverso(v) % P;
  return w === 0n || potenza(w, (P - 1n) / 2n) === 1n;              // criterio di Eulero: w è un quadrato
}

// ---------------- indirizzi derivati dai programmi (PDA) ----------------
const sha256 = (...parti) => { const h = createHash('sha256'); for (const p of parti) h.update(p); return new Uint8Array(h.digest()); };
// createProgramAddress: sha256(semi ‖ programma ‖ "ProgramDerivedAddress"), valido solo se NON sta sulla curva → base58 o null
export function indirizzoProgramma(semi, programma) {
  if (semi.length > 16 || semi.some(s => s.length > 32)) throw new Error('Semi non validi: al massimo 16, di 32 byte');
  const h = sha256(...semi.map(s => Uint8Array.from(s)), byte(programma), new TextEncoder().encode('ProgramDerivedAddress'));
  return sullaCurva(h) ? null : base58.codifica(h);
}
// findProgramAddress: il primo bump da 255 in giù che dà un indirizzo fuori dalla curva
export function trovaPda(semi, programma) {
  for (let bump = 255; bump >= 0; bump--) {
    const indirizzo = indirizzoProgramma([...semi, Uint8Array.of(bump)], programma);
    if (indirizzo) return { indirizzo, bump };
  }
  throw new Error('Nessun indirizzo derivato valido');
}
// il conto token associato (ATA) di un wallet per un mint: semi [proprietario, programma del token, mint]
export const contoToken = (proprietario, mint, programmaToken = PROGRAMMI.token) =>
  trovaPda([byte(proprietario), byte(programmaToken), byte(mint)], PROGRAMMI.ata).indirizzo;

// il «reference» di Solana Pay: 32 byte casuali, una chiave che non firma e che permette di trovare la transazione
export const nuovoRiferimento = () => base58.codifica(randomBytes(32));

// ---------------- la transazione ----------------
const cu16 = n => { const o = []; for (;;) { const b = n & 0x7f; n >>= 7; if (!n) { o.push(b); return o; } o.push(b | 0x80); } };   // compact-u16
const u64 = v => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(v), true); return b; };
const u32 = v => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); return b; };
const MAX_U64 = 2n ** 64n - 1n, MAX_BYTE = 1232;   // 1232: il pacchetto più grande che la rete accetta

// le parti con lo stesso indirizzo si sommano (come chiamate() in web3.js); gli indirizzi Solana distinguono maiuscole e minuscole
function somme(parti) {
  const per = new Map();
  for (const p of parti) {
    if (!eIndirizzoSolana(p.indirizzo)) throw new Error('Indirizzo Solana non valido: ' + p.indirizzo);
    const u = BigInt(p.unita); if (u < 0n) throw new Error('Importo non valido');
    per.set(p.indirizzo, (per.get(p.indirizzo) || 0n) + u);
  }
  for (const [, u] of per) if (u > MAX_U64) throw new Error('Importo troppo grande');
  return [...per].filter(([, u]) => u > 0n);
}

// → base64 della transazione legacy non firmata: uno slot di firma (64 zeri) e il messaggio. Il pagatore paga anche le
// commissioni e, per i token, la creazione dei conti token che mancano (CreateIdempotent: se c'è già non fa niente).
// Chi coincide col pagatore non riceve niente: pagherebbe sé stesso.
export function transazioneSolana({ pagatore, blocco, m, parti, riferimento, memo }) {
  if (!eIndirizzoSolana(pagatore)) throw new Error('Indirizzo del pagatore non valido');
  if (!eIndirizzoSolana(blocco)) throw new Error('Blockhash non valido');
  if (riferimento != null && !eIndirizzoSolana(riferimento)) throw new Error('Riferimento non valido');
  const destinatari = somme(parti).filter(([a]) => a !== pagatore);
  if (!destinatari.length) throw new Error('Niente da pagare');
  const conto = (a, firma, scrive) => ({ a, firma, scrive });
  const istruzioni = [];   // { programma, conti: [{a, firma, scrive}], dati }
  if (m.indirizzo) {
    const tp = m.programma || PROGRAMMI.token, da = contoToken(pagatore, m.indirizzo, tp);
    for (const [i, [a, u]] of destinatari.entries()) {
      const ata = contoToken(a, m.indirizzo, tp);
      istruzioni.push({ programma: PROGRAMMI.ata, dati: Uint8Array.of(1),   // CreateIdempotent
        conti: [conto(pagatore, true, true), conto(ata, false, true), conto(a, false, false), conto(m.indirizzo, false, false), conto(PROGRAMMI.sistema, false, false), conto(tp, false, false)] });
      istruzioni.push({ programma: tp, dati: Uint8Array.from([12, ...u64(u), m.decimali]),   // TransferChecked
        conti: [conto(da, false, true), conto(m.indirizzo, false, false), conto(ata, false, true), conto(pagatore, true, false), ...(i === 0 && riferimento ? [conto(riferimento, false, false)] : [])] });
    }
  } else {
    for (const [i, [a, u]] of destinatari.entries())
      istruzioni.push({ programma: PROGRAMMI.sistema, dati: Uint8Array.from([...u32(2), ...u64(u)]),   // SystemProgram transfer
        conti: [conto(pagatore, true, true), conto(a, false, true), ...(i === 0 && riferimento ? [conto(riferimento, false, false)] : [])] });
  }
  if (memo) istruzioni.push({ programma: PROGRAMMI.memo, conti: [], dati: new TextEncoder().encode(String(memo)) });

  // le chiavi: una volta sola ciascuna (firma e scrittura si sommano), il pagatore per primo, poi l'ordine della rete:
  // firmatari scrivibili, firmatari in sola lettura, non firmatari scrivibili, non firmatari in sola lettura (i programmi)
  const chiavi = new Map([[pagatore, { firma: true, scrive: true }]]);
  const aggiungi = (a, firma, scrive) => { const c = chiavi.get(a); if (c) { c.firma ||= firma; c.scrive ||= scrive; } else chiavi.set(a, { firma, scrive }); };
  for (const ix of istruzioni) { for (const c of ix.conti) aggiungi(c.a, c.firma, c.scrive); aggiungi(ix.programma, false, false); }
  const gruppo = c => (c.firma ? 0 : 2) + (c.scrive ? 0 : 1);
  const ordinate = [...chiavi].map(([a, c], n) => ({ a, ...c, n })).sort((x, y) => (x.a === pagatore ? -1 : y.a === pagatore ? 1 : gruppo(x) - gruppo(y) || x.n - y.n));
  const indice = new Map(ordinate.map((c, i) => [c.a, i]));
  const firme = ordinate.filter(c => c.firma).length;
  if (firme !== 1) throw new Error('Deve firmare solo il pagatore');
  const header = [firme, ordinate.filter(c => c.firma && !c.scrive).length, ordinate.filter(c => !c.firma && !c.scrive).length];

  const msg = [...header, ...cu16(ordinate.length)];
  for (const c of ordinate) msg.push(...base58.decodifica(c.a));
  msg.push(...base58.decodifica(blocco), ...cu16(istruzioni.length));
  for (const ix of istruzioni) msg.push(indice.get(ix.programma), ...cu16(ix.conti.length), ...ix.conti.map(c => indice.get(c.a)), ...cu16(ix.dati.length), ...ix.dati);
  const tx = Uint8Array.from([...cu16(firme), ...new Uint8Array(64 * firme), ...msg]);
  if (tx.length > MAX_BYTE) throw new Error('La transazione è troppo grande: accorcia il memo');
  return Buffer.from(tx).toString('base64');
}

// ---------------- il controllo sulla blockchain ----------------
const LIVELLI = { processed: 0, confirmed: 1, finalized: 2 };
// la transazione (data, o trovata col riferimento) deve essere riuscita, abbastanza confermata (rete.impegno), fatta dopo
// l'ordine, contenere il riferimento, e portare a ogni destinatario almeno il suo importo, preso dal wallet che l'ha pagata
// (il fee payer). → {pagatore, firma} | {attesa} | {errore, mancante?}. rpc è clienteRpc() di web3.js.
export async function verificaSolana({ rpc, rete, m, parti, firma, riferimento, dopo }) {
  if (riferimento != null && !eIndirizzoSolana(riferimento)) return { errore: 'Riferimento non valido' };
  if (!firma) {
    if (!riferimento) return { errore: 'Manca la transazione' };
    const elenco = (await rpc(rete.rpc, 'getSignaturesForAddress', [riferimento, { commitment: 'confirmed' }])) || [];
    const riuscite = elenco.filter(s => s.err == null);   // dalla più nuova alla più vecchia
    if (!riuscite.length) return { attesa: elenco.length ? 'Il pagamento non è riuscito: riprova dal wallet' : 'Il pagamento non è ancora arrivato' };
    // si provano tutte, dalla più vecchia: chi conosce il riferimento (è nel link di Solana Pay) non può bloccare l'ordine con
    // un pagamento finto più piccolo messo prima di quello vero
    let ultimo = null;
    for (const s of [...riuscite].reverse().slice(0, 10)) {
      const r = await verificaSolana({ rpc, rete, m, parti, firma: s.signature, riferimento, dopo });
      if (r.pagatore) return r;
      ultimo = r;
    }
    return ultimo?.attesa ? ultimo : { attesa: 'Il pagamento trovato non corrisponde all\'ordine: controlla gli importi', ...(ultimo?.mancante ? { mancante: ultimo.mancante } : {}) };
  }
  if (!eFirma(firma)) return { errore: 'Transazione non valida' };

  const st = (await rpc(rete.rpc, 'getSignatureStatuses', [[firma], { searchTransactionHistory: true }]))?.value?.[0];
  if (!st) return { attesa: 'La transazione non è ancora in un blocco' };
  if (st.err) return { errore: 'La transazione è fallita' };
  const livello = st.confirmationStatus || (st.confirmations === null ? 'finalized' : 'processed');
  if ((LIVELLI[livello] ?? -1) < LIVELLI[rete.impegno]) return { attesa: 'In attesa di conferme' };

  const tx = await rpc(rete.rpc, 'getTransaction', [firma, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: rete.impegno }]);
  if (!tx?.meta || !tx.transaction) return { attesa: 'La transazione non è ancora disponibile' };
  if (tx.meta.err !== null && tx.meta.err !== undefined) return { errore: 'La transazione è fallita' };
  if (tx.blockTime == null) return { attesa: 'La data della transazione non è ancora disponibile' };
  if (tx.blockTime * 1000 < dopo - 120e3) return { errore: 'La transazione è precedente all\'ordine' };

  const chiavi = tx.transaction.message.accountKeys.map(k => (typeof k === 'string' ? k : k.pubkey));
  const pagatore = chiavi[0];
  if (riferimento && !chiavi.includes(riferimento)) return { errore: 'La transazione non è di questo ordine' };
  const dovuto = somme(parti).filter(([a]) => a !== pagatore);   // chi ha pagato non deve niente a sé stesso

  let delta;
  if (m.indirizzo) {   // token: i saldi per proprietario e mint, prima e dopo (un conto creato nella transazione non c'è «prima»)
    const saldi = lista => { const s = new Map(); for (const b of lista || []) if (b.mint === m.indirizzo && b.owner) s.set(b.owner, (s.get(b.owner) || 0n) + BigInt(b.uiTokenAmount.amount)); return s; };
    const prima = saldi(tx.meta.preTokenBalances), poi = saldi(tx.meta.postTokenBalances);
    delta = a => (poi.get(a) || 0n) - (prima.get(a) || 0n);
  } else {             // SOL: i lamport di ogni chiave, prima e dopo
    delta = a => { const i = chiavi.indexOf(a); return i < 0 ? 0n : BigInt(tx.meta.postBalances[i]) - BigInt(tx.meta.preBalances[i]); };
  }
  for (const [a, u] of dovuto) if (delta(a) < u) return { errore: 'Gli importi non corrispondono all\'ordine', mancante: a };
  const totale = dovuto.reduce((t, [, u]) => t + u, 0n);
  if (-delta(pagatore) < totale) return { errore: 'I soldi non vengono dal wallet che ha pagato la transazione' };
  return { pagatore, firma };
}
