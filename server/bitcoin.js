// I pagamenti in Bitcoin, senza che la piattaforma tenga mai i soldi: il business paga dal suo wallet direttamente il builder,
// l'installatore e la piattaforma (in una transazione sola con i wallet che lo permettono, oppure leggendo un QR per parte);
// il server controlla sulla blockchain, con le API Esplora di mempool.space, che ogni destinatario abbia ricevuto il suo.
// Gli indirizzi si riconoscono senza librerie: base58check (P2PKH, P2SH), bech32 (BIP173) per segwit v0, bech32m (BIP350) per v1+.
// Niente API di Node qui dentro: solo fetch e BigInt.
import { daBase58check, segwitDecodifica } from '../web/codifiche.js';

const btc = { simbolo: 'BTC', indirizzo: null, decimali: 8, prezzo: 'bitcoin' };
export const RETI_BITCOIN = {
  bitcoin: { nome: 'Bitcoin', tipo: 'bitcoin', api: 'https://mempool.space/api', esploratore: 'https://mempool.space', conferme: 2, monete: [btc] },
  // per le prove con monete senza valore (testnet4, BIP94)
  'bitcoin-testnet4': { nome: 'Bitcoin Testnet4 (prova)', tipo: 'bitcoin', prova: true, api: 'https://mempool.space/testnet4/api', esploratore: 'https://mempool.space/testnet4', conferme: 1, monete: [btc] },
};
// prefissi: hrp di bech32 e byte di versione di base58check (P2PKH, P2SH)
const FORMATI = { bitcoin: { hrp: 'bc', p2pkh: 0x00, p2sh: 0x05 }, 'bitcoin-testnet4': { hrp: 'tb', p2pkh: 0x6f, p2sh: 0xc4 } };
const idRete = r => (typeof r === 'string' ? r : r?.id || (r?.prova ? 'bitcoin-testnet4' : 'bitcoin'));

// → 'p2pkh' | 'p2sh' | 'p2wpkh' | 'p2wsh' | 'p2tr' | null. Le versioni segwit future (v2-v16, o v1 non di 32 byte) sono valide
// per BIP350 ma nessuno ci può ricevere: qui valgono null, così nessuno ci manda soldi per sbaglio.
export function tipoIndirizzoBitcoin(s, rete = 'bitcoin') {
  const f = FORMATI[idRete(rete)]; if (!f || typeof s !== 'string') return null;
  if (s.toLowerCase().startsWith(f.hrp + '1')) {
    const w = segwitDecodifica(f.hrp, s); if (!w) return null;
    if (w.versione === 0) return w.programma.length === 20 ? 'p2wpkh' : 'p2wsh';
    return w.versione === 1 && w.programma.length === 32 ? 'p2tr' : null;
  }
  const b = daBase58check(s); if (!b || b.length !== 21) return null;
  return b[0] === f.p2pkh ? 'p2pkh' : b[0] === f.p2sh ? 'p2sh' : null;
}
// la forma con cui le API scrivono l'indirizzo (bech32 in minuscolo), o null se non vale su questa rete
export function normaleBitcoin(s, rete = 'bitcoin') {
  const t = tipoIndirizzoBitcoin(s, rete); if (!t) return null;
  return t.startsWith('p2w') || t === 'p2tr' ? s.toLowerCase() : s;
}

// satoshi → BTC come testo decimale esatto, senza zeri inutili (1 → «0.00000001», 2100000000000000 → «21000000»)
export function satInBtc(sats) {
  const s = BigInt(sats); if (s < 0n) throw new Error('importo negativo');
  const intero = s / 100_000_000n, resto = (s % 100_000_000n).toString().padStart(8, '0').replace(/0+$/, '');
  return resto ? `${intero}.${resto}` : `${intero}`;
}
// l'URI BIP21 per il QR: bitcoin:<indirizzo>?amount=<BTC>&label=…&message=…
export function uriBitcoin(indirizzo, sats, { etichetta, messaggio } = {}) {
  if (!tipoIndirizzoBitcoin(indirizzo, 'bitcoin') && !tipoIndirizzoBitcoin(indirizzo, 'bitcoin-testnet4')) throw new Error('Indirizzo Bitcoin non valido');
  const q = [];
  if (sats != null) {
    const s = BigInt(sats); if (s <= 0n || s > 2_100_000_000_000_000n) throw new Error('Importo non valido');
    q.push(`amount=${satInBtc(s)}`);
  }
  if (etichetta) q.push(`label=${encodeURIComponent(etichetta)}`);
  if (messaggio) q.push(`message=${encodeURIComponent(messaggio)}`);
  return `bitcoin:${indirizzo}${q.length ? '?' + q.join('&') : ''}`;
}

// il client Esplora: JSON, null se non c'è (404), un errore 502 se la rete non risponde
export async function chiediEsplora(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(15e3) }).catch(e => { throw Object.assign(new Error(`Rete Bitcoin: ${e.name === 'TimeoutError' ? 'nessuna risposta' : e.message}`), { stato: 502 }); });
  if (r.status === 404) return null;
  if (!r.ok) throw Object.assign(new Error(`Rete Bitcoin: ${r.status}`), { stato: 502 });
  return r.json();
}

// L'orario dei blocchi Bitcoin è approssimato (un miner può scriverlo anche un'ora indietro): il margine è largo. Contro il riuso
// di una transazione vera di un altro ordine servono «usata» e la tabella delle transazioni usate nella rotta.
const MARGINE = 3600e3;
const PAGINE = 4;   // nella ricerca: al massimo 4 pagine di transazioni per indirizzo (50 + 3 × 25)
const ricevutoDa = (t, a) => (t.vout || []).reduce((s, o) => (o.scriptpubkey_address === a ? s + BigInt(o.value) : s), 0n);
const pagatoreDi = t => t?.vin?.[0]?.prevout?.scriptpubkey_address || null;

// Il controllo sulla blockchain: ogni destinatario deve ricevere almeno il suo importo, in transazioni confermate abbastanza e
// arrivate dopo l'ordine. Con i txid si guardano quelle; senza, si cercano fra le ultime transazioni di ogni destinatario (così il
// business può pagare da un wallet qualsiasi leggendo i QR). → { pagatore, tx } | { attesa } | { errore, mancante? }
// «pagatore» è l'indirizzo del primo input della prima transazione: solo informativo (può essere null).
// `esatto`: ogni destinatario deve ricevere proprio il suo importo (unico fra gli ordini aperti: lega il pagamento all'ordine);
// `entro`: le transazioni minate dopo la scadenza del prezzo non valgono
export async function verificaBitcoin({ rete, parti, tx = [], dopo, chiedi = chiediEsplora, usata = () => false, esatto = false, entro = null }) {
  const r = typeof rete === 'string' ? { id: rete, ...RETI_BITCOIN[rete] } : rete;
  if (!r?.api) return { errore: 'Rete non disponibile' };
  const dovuto = new Map();
  for (const p of parti) {
    const a = normaleBitcoin(p.indirizzo, idRete(r)); if (!a) return { errore: 'Indirizzo del destinatario non valido', mancante: p.indirizzo };
    dovuto.set(a, (dovuto.get(a) || 0n) + BigInt(p.unita));
  }
  for (const [a, u] of dovuto) if (u <= 0n) dovuto.delete(a);
  const cima = Number(await chiedi(`${r.api}/blocks/tip/height`));
  if (!Number.isInteger(cima) || cima <= 0) throw Object.assign(new Error('Rete Bitcoin: altezza non valida'), { stato: 502 });
  const conferme = t => (t.status?.confirmed ? cima - t.status.block_height + 1 : 0);
  const prima = t => t.status?.confirmed && t.status.block_time * 1000 < dopo - MARGINE;
  const tardi = t => !!entro && t.status?.confirmed && t.status.block_time * 1000 > entro;
  const giusto = (v, u) => (esatto ? v === u : v >= u);
  const attendi = t => (!t.status?.confirmed ? { attesa: 'La transazione non è ancora confermata' }
    : conferme(t) < r.conferme ? { attesa: `In attesa di conferme (${conferme(t)} di ${r.conferme})` } : null);

  const ids = [...new Set((tx || []).map(x => String(x).toLowerCase()))];
  if (ids.length) {
    const lette = [];
    for (const id of ids) {
      if (!/^[0-9a-f]{64}$/.test(id)) return { errore: 'Transazione non valida' };
      if (usata(id)) return { errore: 'Questa transazione è già stata usata' };
      const t = await chiedi(`${r.api}/tx/${id}`);
      if (!t || t.txid !== id) return { attesa: 'La transazione non è ancora visibile in rete' };
      if (prima(t)) return { errore: 'La transazione è precedente all\'ordine' };
      if (tardi(t)) return { errore: 'Pagato dopo la scadenza del prezzo: crea un nuovo ordine' };
      lette.push(t);
    }
    const usate = lette.filter(t => [...dovuto.keys()].some(a => ricevutoDa(t, a) > 0n));
    for (const [a, u] of dovuto) if (!giusto(usate.reduce((s, t) => s + ricevutoDa(t, a), 0n), u)) return { errore: 'Gli importi non corrispondono all\'ordine', mancante: a };
    for (const t of usate) { const w = attendi(t); if (w) return w; }
    return { pagatore: pagatoreDi(usate[0]), tx: usate.map(t => t.txid) };
  }

  // senza txid: per ogni destinatario, la transazione dopo l'ordine che gli porta almeno il dovuto (la più vicina al dovuto)
  const scelte = [];
  for (const [a, u] of dovuto) {
    const candidate = []; let ultima = null;
    for (let pagina = 0; pagina < PAGINE; pagina++) {
      const lista = await chiedi(`${r.api}/address/${a}/txs${ultima ? '/chain/' + ultima : ''}`);
      if (!Array.isArray(lista) || !lista.length) break;
      for (const t of lista) {
        if (!t?.txid || prima(t) || tardi(t) || usata(t.txid)) continue;
        const v = ricevutoDa(t, a); if (giusto(v, u)) candidate.push({ t, v });
      }
      const confermate = lista.filter(t => t.status?.confirmed);
      if (!confermate.length || confermate.length < 25 || prima(confermate.at(-1))) break;   // finite, o già prima dell'ordine
      ultima = confermate.at(-1).txid;
    }
    if (!candidate.length) return { attesa: 'Non trovo ancora il pagamento per tutti i destinatari', mancante: a };
    candidate.sort((x, y) => (x.v < y.v ? -1 : x.v > y.v ? 1 : (x.t.status?.block_height || Infinity) - (y.t.status?.block_height || Infinity)));
    scelte.push(candidate[0].t);
  }
  for (const t of scelte) { const w = attendi(t); if (w) return w; }
  return { pagatore: pagatoreDi(scelte[0]), tx: [...new Set(scelte.map(t => t.txid))] };
}
