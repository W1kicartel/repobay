// La crittografia di Ethereum senza librerie: Keccak-256, la curva secp256k1 (chi ha firmato un messaggio), gli indirizzi
// con il controllo maiuscole/minuscole (EIP-55) e il messaggio firmato dei wallet (EIP-191, «personal_sign»).
// Provata con i vettori ufficiali in test/cripto.test.mjs.
import { randomBytes } from 'node:crypto';

// ---------------- Keccak-256 (quello di Ethereum: il riempimento è 0x01, non quello di SHA3) ----------------
const M64 = (1n << 64n) - 1n;
const RC = ['0x0000000000000001', '0x0000000000008082', '0x800000000000808A', '0x8000000080008000', '0x000000000000808B', '0x0000000080000001',
  '0x8000000080008081', '0x8000000000008009', '0x000000000000008A', '0x0000000000000088', '0x0000000080008009', '0x000000008000000A',
  '0x000000008000808B', '0x800000000000008B', '0x8000000000008089', '0x8000000000008003', '0x8000000000008002', '0x8000000000000080',
  '0x000000000000800A', '0x800000008000000A', '0x8000000080008081', '0x8000000000008080', '0x0000000080000001', '0x8000000080008008'].map(BigInt);
const ROT = [[0, 36, 3, 41, 18], [1, 44, 10, 45, 2], [62, 6, 43, 15, 61], [28, 55, 25, 21, 56], [27, 20, 39, 8, 14]].map(r => r.map(BigInt));   // ROT[x][y]
const rotl = (v, n) => (n === 0n ? v : ((v << n) | (v >> (64n - n))) & M64);
function keccakF(s) {
  const C = new Array(5), B = new Array(25);
  for (let r = 0; r < 24; r++) {
    for (let x = 0; x < 5; x++) C[x] = s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20];
    for (let x = 0; x < 5; x++) { const D = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1n); for (let y = 0; y < 25; y += 5) s[x + y] ^= D; }
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(s[x + 5 * y], ROT[x][y]);
    for (let y = 0; y < 25; y += 5) for (let x = 0; x < 5; x++) s[x + y] = B[x + y] ^ (~B[(x + 1) % 5 + y] & M64 & B[(x + 2) % 5 + y]);
    s[0] ^= RC[r];
  }
}
export function keccak256(dati) {
  const b = typeof dati === 'string' ? Buffer.from(dati, 'utf8') : Buffer.from(dati);
  const rate = 136, n = Math.floor(b.length / rate) + 1, p = Buffer.alloc(n * rate);
  b.copy(p); p[b.length] ^= 0x01; p[p.length - 1] ^= 0x80;
  const s = new Array(25).fill(0n);
  for (let o = 0; o < p.length; o += rate) {
    for (let i = 0; i < rate / 8; i++) s[i] ^= p.readBigUInt64LE(o + i * 8);
    keccakF(s);
  }
  const out = Buffer.alloc(32); for (let i = 0; i < 4; i++) out.writeBigUInt64LE(s[i], i * 8);
  return out;
}

// ---------------- secp256k1 ----------------
const P = 2n ** 256n - 2n ** 32n - 977n, N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
const G = [0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798n, 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8n];
const mod = (a, m = P) => ((a % m) + m) % m;
function inv(a, m = P) {   // l'inverso con Euclide esteso
  let [r0, r1, s0, s1] = [mod(a, m), m, 1n, 0n];
  while (r1) { const q = r0 / r1; [r0, r1] = [r1, r0 - q * r1]; [s0, s1] = [s1, s0 - q * s1]; }
  if (r0 !== 1n) throw new Error('non invertibile'); return mod(s0, m);
}
function potenza(b, e, m) { let r = 1n; b = mod(b, m); while (e > 0n) { if (e & 1n) r = r * b % m; b = b * b % m; e >>= 1n; } return r; }
function somma(A, B) {
  if (!A) return B; if (!B) return A;
  if (A[0] === B[0]) { if (mod(A[1] + B[1]) === 0n) return null; const l = mod(3n * A[0] * A[0] * inv(2n * A[1])); const x = mod(l * l - 2n * A[0]); return [x, mod(l * (A[0] - x) - A[1])]; }
  const l = mod((B[1] - A[1]) * inv(B[0] - A[0])); const x = mod(l * l - A[0] - B[0]); return [x, mod(l * (A[0] - x) - A[1])];
}
function per(k, Pt) { let R = null, Q = Pt; k = mod(k, N); while (k > 0n) { if (k & 1n) R = somma(R, Q); Q = somma(Q, Q); k >>= 1n; } return R; }
const big = b => BigInt('0x' + Buffer.from(b).toString('hex'));
const b32 = v => Buffer.from(v.toString(16).padStart(64, '0'), 'hex');
const daChiave = Q => '0x' + keccak256(Buffer.concat([b32(Q[0]), b32(Q[1])])).subarray(12).toString('hex');

// ---------------- indirizzi ----------------
export const eIndirizzo = a => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);
export function checksum(a) {   // EIP-55
  const h = a.toLowerCase().replace(/^0x/, ''), k = keccak256(h).toString('hex');
  return '0x' + [...h].map((c, i) => (/[a-f]/.test(c) && parseInt(k[i], 16) >= 8 ? c.toUpperCase() : c)).join('');
}
export const indirizzoDaChiave = privata => checksum(daChiave(per(big(privata), G)));

// ---------------- firme ----------------
export function hashMessaggio(testo) {   // EIP-191: «\x19Ethereum Signed Message:\n» + lunghezza in byte + messaggio
  const m = Buffer.from(testo, 'utf8');
  return keccak256(Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${m.length}`, 'utf8'), m]));
}
// chi ha firmato: dall'hash e dalla firma (65 byte: r, s, v) all'indirizzo, o null se la firma non è valida
export function recupera(hash, firma) {
  try {
    const f = Buffer.from(String(firma).replace(/^0x/, ''), 'hex'); if (f.length !== 65) return null;
    const r = big(f.subarray(0, 32)), s = big(f.subarray(32, 64)); let v = f[64]; if (v >= 27) v -= 27;
    if (v > 1 || r <= 0n || r >= N || s <= 0n || s >= N) return null;
    const y2 = mod(r ** 3n + 7n); let y = potenza(y2, (P + 1n) / 4n, P); if (mod(y * y) !== y2) return null;
    if ((y & 1n) !== BigInt(v)) y = P - y;
    const e = mod(big(hash), N), ri = inv(r, N);
    const Q = somma(per(mod(s * ri, N), [r, y]), per(mod(-e * ri, N), G));
    return Q ? checksum(daChiave(Q)) : null;
  } catch { return null; }
}
export const verificaMessaggio = (testo, firma, indirizzo) => { const a = recupera(hashMessaggio(testo), firma); return !!a && a.toLowerCase() === String(indirizzo).toLowerCase(); };

// firma (serve alle prove: nelle pagine firma il wallet di chi usa il sito)
export function firmaHash(hash, privata) {
  const d = big(privata), e = mod(big(hash), N);
  for (;;) {
    const k = mod(big(randomBytes(32)), N); if (!k) continue;
    const R = per(k, G), r = mod(R[0], N); if (!r) continue;
    let s = mod(inv(k, N) * (e + r * d), N); if (!s) continue;
    let v = Number(R[1] & 1n); if (s > N / 2n) { s = N - s; v ^= 1; }
    return '0x' + Buffer.concat([b32(r), b32(s), Buffer.from([27 + v])]).toString('hex');
  }
}
export const firmaMessaggio = (testo, privata) => firmaHash(hashMessaggio(testo), privata);
