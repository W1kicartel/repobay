// Le codifiche degli indirizzi di Bitcoin e Tron, in JS puro (vale nel browser e nel server, senza API di Node):
// SHA-256, base58 e base58check (Bitcoin, Tron), bech32 (BIP173) e bech32m (BIP350) per gli indirizzi segwit.
// Provate con i vettori ufficiali in test/bitcoin.test.mjs.

// ---------------- esadecimale ----------------
export const inHex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
export function daHex(h) {
  if (typeof h !== 'string' || h.length % 2 || !/^[0-9a-fA-F]*$/.test(h)) return null;
  const b = new Uint8Array(h.length / 2);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16);
  return b;
}

// ---------------- SHA-256 (FIPS 180-4) ----------------
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
const ror = (x, n) => (x >>> n) | (x << (32 - n));
export function sha256(dati) {
  const b = dati instanceof Uint8Array ? dati : new TextEncoder().encode(String(dati));
  const n = Math.ceil((b.length + 9) / 64) * 64, p = new Uint8Array(n);
  p.set(b); p[b.length] = 0x80;
  const bit = b.length * 8, v = new DataView(p.buffer);
  v.setUint32(n - 8, Math.floor(bit / 2 ** 32)); v.setUint32(n - 4, bit >>> 0);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]), W = new Uint32Array(64);
  for (let o = 0; o < n; o += 64) {
    for (let i = 0; i < 16; i++) W[i] = v.getUint32(o + 4 * i);
    for (let i = 16; i < 64; i++) {
      const s0 = ror(W[i - 15], 7) ^ ror(W[i - 15], 18) ^ (W[i - 15] >>> 3), s1 = ror(W[i - 2], 17) ^ ror(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = W[i - 16] + s0 + W[i - 7] + s1;
    }
    let [a, b2, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
      const t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b2) ^ (a & c) ^ (b2 & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b2; b2 = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b2; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  const out = new Uint8Array(32), vo = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) vo.setUint32(4 * i, H[i]);
  return out;
}

// ---------------- base58 e base58check (sha256 doppio, 4 byte di controllo) ----------------
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function base58(b) {
  let zeri = 0; while (zeri < b.length && b[zeri] === 0) zeri++;
  let n = 0n; for (const x of b) n = n * 256n + BigInt(x);
  let s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  return '1'.repeat(zeri) + s;
}
export function daBase58(s) {   // → i byte, o null se c'è un carattere fuori alfabeto
  if (typeof s !== 'string') return null;
  let zeri = 0; while (zeri < s.length && s[zeri] === '1') zeri++;
  let n = 0n;
  for (const c of s) { const i = B58.indexOf(c); if (i < 0) return null; n = n * 58n + BigInt(i); }
  const corpo = []; while (n > 0n) { corpo.unshift(Number(n & 255n)); n >>= 8n; }
  return new Uint8Array([...new Array(zeri).fill(0), ...corpo]);
}
const controllo = b => sha256(sha256(b)).subarray(0, 4);
export function base58check(dati) {
  const c = controllo(dati), b = new Uint8Array(dati.length + 4); b.set(dati); b.set(c, dati.length);
  return base58(b);
}
export function daBase58check(s) {   // → il contenuto senza i 4 byte di controllo, o null se il controllo non torna
  const b = daBase58(s); if (!b || b.length < 5) return null;
  const dati = b.subarray(0, b.length - 4), c = controllo(dati);
  for (let i = 0; i < 4; i++) if (c[i] !== b[b.length - 4 + i]) return null;
  return dati;
}

// ---------------- bech32 (BIP173) e bech32m (BIP350) ----------------
const CARATTERI = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const COSTANTE = { bech32: 1, bech32m: 0x2bc830a3 };
function polymod(valori) {
  const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of valori) {
    const b = chk >>> 25; chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((b >>> i) & 1) chk ^= G[i];
  }
  return chk >>> 0;
}
const espandi = hrp => [...hrp].map(c => c.charCodeAt(0) >> 5).concat([0], [...hrp].map(c => c.charCodeAt(0) & 31));

export function bech32Codifica(hrp, dati, variante = 'bech32') {
  const pm = polymod(espandi(hrp).concat(dati, [0, 0, 0, 0, 0, 0])) ^ COSTANTE[variante];
  const chk = [0, 1, 2, 3, 4, 5].map(i => (pm >>> (5 * (5 - i))) & 31);
  return hrp + '1' + dati.concat(chk).map(v => CARATTERI[v]).join('');
}
// → { hrp, dati (valori a 5 bit, senza il controllo), variante: 'bech32' | 'bech32m' } o null.
// Rifiuta: più di 90 caratteri, caratteri fuori da 33..126, maiuscole e minuscole insieme, hrp vuoto, controllo corto o sbagliato.
export function bech32Decodifica(s) {
  if (typeof s !== 'string' || s.length > 90) return null;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c < 33 || c > 126) return null; }
  const basso = s.toLowerCase(); if (s !== basso && s !== s.toUpperCase()) return null;
  const p = basso.lastIndexOf('1'); if (p < 1 || p + 7 > basso.length) return null;
  const hrp = basso.slice(0, p), dati = [];
  for (const c of basso.slice(p + 1)) { const v = CARATTERI.indexOf(c); if (v < 0) return null; dati.push(v); }
  const pm = polymod(espandi(hrp).concat(dati));
  const variante = pm === COSTANTE.bech32 ? 'bech32' : pm === COSTANTE.bech32m ? 'bech32m' : null;
  return variante ? { hrp, dati: dati.slice(0, -6), variante } : null;
}
// da gruppi di «da» bit a gruppi di «a» bit; senza riempimento rifiuta più di 4 bit avanzati o avanzi non nulli
export function converti(dati, da, a, riempi) {
  let acc = 0, bit = 0; const out = [], max = (1 << a) - 1;
  for (const v of dati) {
    if (v < 0 || v >> da) return null;
    acc = (acc << da) | v; bit += da;
    while (bit >= a) { bit -= a; out.push((acc >> bit) & max); }
    acc &= (1 << bit) - 1;
  }
  if (riempi) { if (bit) out.push((acc << (a - bit)) & max); }
  else if (bit >= da || ((acc << (a - bit)) & max)) return null;
  return out;
}
// indirizzo segwit → { versione, programma } o null (BIP173 per la versione 0, BIP350 per le versioni da 1 a 16)
export function segwitDecodifica(hrp, s) {
  const d = bech32Decodifica(s); if (!d || d.hrp !== hrp || d.dati.length < 1) return null;
  const versione = d.dati[0]; if (versione > 16) return null;
  const programma = converti(d.dati.slice(1), 5, 8, false);
  if (!programma || programma.length < 2 || programma.length > 40) return null;
  if (versione === 0 && programma.length !== 20 && programma.length !== 32) return null;
  if (d.variante !== (versione === 0 ? 'bech32' : 'bech32m')) return null;
  return { versione, programma: new Uint8Array(programma) };
}
export const segwitCodifica = (hrp, versione, programma) =>
  bech32Codifica(hrp, [versione, ...converti([...programma], 8, 5, true)], versione === 0 ? 'bech32' : 'bech32m');
