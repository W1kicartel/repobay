// I QR code senza librerie, per il browser e per il server: i link di pagamento crypto (bitcoin:, solana:, ethereum:) e
// l'URI otpauth:// della verifica in due passaggi. Segue la specifica ISO/IEC 18004: modalità byte (UTF-8) e alfanumerica,
// versioni 1–40, livelli L/M/Q/H, Reed-Solomon su GF(256), maschera scelta con le 4 regole di penalità.
// Niente API del browser né di Node (solo TextEncoder, che c'è in tutti e due). Provato con Vision di Apple in test/qr.test.mjs.

// ---------------- le tabelle della specifica (indice = versione − 1) ----------------
const FORMATO = { L: 1, M: 0, Q: 3, H: 2 };   // i 2 bit del livello nell'informazione di formato
const EC = {   // codewords di correzione per blocco
  L: [7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};
const BLOCCHI = {   // quanti blocchi Reed-Solomon
  L: [1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};
// i moduli liberi per dati e correzione: tutto il quadrato meno finder, timing, alignment, formato e versione
function moduliDati(v) {
  let n = (16 * v + 128) * v + 64;
  if (v >= 2) { const a = Math.floor(v / 7) + 2; n -= (25 * a - 10) * a - 55; if (v >= 7) n -= 36; }
  return n;
}
const codewords = v => Math.floor(moduliDati(v) / 8);
const capienza = (v, liv) => codewords(v) - EC[liv][v - 1] * BLOCCHI[liv][v - 1];   // codewords di dati
// i centri degli alignment pattern: 6, poi passi uguali (pari) fino a lato − 7
function allineamenti(v) {
  if (v === 1) return [];
  const a = Math.floor(v / 7) + 2, passo = Math.floor((v * 8 + a * 3 + 5) / (a * 4 - 4)) * 2, pos = [6];
  for (let p = 17 + 4 * v - 7; pos.length < a; p -= passo) pos.splice(1, 0, p);
  return pos;
}

// ---------------- Reed-Solomon su GF(256), polinomio 0x11D ----------------
const ESP = new Uint8Array(512), LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) { ESP[i] = ESP[i + 255] = x; LOG[x] = i; x = (x << 1) ^ (x & 0x80 ? 0x11d : 0); }
const per = (a, b) => (a && b ? ESP[LOG[a] + LOG[b]] : 0);
const generatori = new Map();
function generatore(n) {   // ∏ (x − α^i), i < n; coefficienti dal grado più alto, il primo (1) sottinteso
  if (!generatori.has(n)) {
    let g = [1];
    for (let i = 0; i < n; i++) { const q = new Array(g.length + 1).fill(0); for (let k = 0; k < g.length; k++) { q[k] ^= g[k]; q[k + 1] ^= per(g[k], ESP[i]); } g = q; }
    generatori.set(n, Uint8Array.from(g.slice(1)));
  }
  return generatori.get(n);
}
function resto(dati, g) {   // il resto di dati·x^n diviso per il generatore: i codewords di correzione
  const r = new Uint8Array(g.length);
  for (const b of dati) { const f = b ^ r[0]; r.copyWithin(0, 1); r[r.length - 1] = 0; if (f) for (let i = 0; i < r.length; i++) r[i] ^= per(g[i], f); }
  return r;
}

// ---------------- i dati: segmenti, bit, blocchi ----------------
const ALFA = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
const CONTEGGIO = { alfa: [9, 11, 13], byte: [8, 16, 16] };   // bit della lunghezza: versioni 1–9, 10–26, 27–40
const fascia = v => (v < 10 ? 0 : v < 27 ? 1 : 2);
const utf8 = s => new TextEncoder().encode(s);
const alfa = s => ({ modo: 'alfa', testo: s, n: s.length, bit: 11 * (s.length >> 1) + 6 * (s.length & 1) });
const byte = s => { const b = utf8(s); return { modo: 'byte', byte: b, n: b.length, bit: 8 * b.length }; };
// le codifiche possibili: tutto alfanumerico se si può; se no tutto byte, oppure un prefisso alfanumerico lungo
// (BITCOIN:INDIRIZZO?AMOUNT=…) seguito dal resto in byte. Per ogni versione si tiene la più corta.
function candidati(testo) {
  let k = 0; while (k < testo.length && ALFA.includes(testo[k])) k++;
  if (k === testo.length) return [[alfa(testo)]];
  return k ? [[byte(testo)], [alfa(testo.slice(0, k)), byte(testo.slice(k))]] : [[byte(testo)]];
}
const lunghezza = (segs, v) => segs.reduce((t, s) => (s.n >= 2 ** CONTEGGIO[s.modo][fascia(v)] ? Infinity : t + 4 + CONTEGGIO[s.modo][fascia(v)] + s.bit), 0);
function bitDati(segs, v, liv) {   // → i codewords di dati, con terminatore e riempimento 0xEC 0x11
  const cap = capienza(v, liv), out = new Uint8Array(cap); let pos = 0;
  const metti = (val, n) => { for (let i = n - 1; i >= 0; i--, pos++) if ((val >>> i) & 1) out[pos >> 3] |= 0x80 >> (pos & 7); };
  for (const s of segs) {
    metti(s.modo === 'alfa' ? 2 : 4, 4); metti(s.n, CONTEGGIO[s.modo][fascia(v)]);
    if (s.modo === 'byte') for (const b of s.byte) metti(b, 8);
    else for (let i = 0; i < s.n; i += 2) i + 1 < s.n ? metti(ALFA.indexOf(s.testo[i]) * 45 + ALFA.indexOf(s.testo[i + 1]), 11) : metti(ALFA.indexOf(s.testo[i]), 6);
  }
  pos = Math.ceil(Math.min(pos + 4, cap * 8) / 8) * 8;   // terminatore (fino a 4 zeri) e arrotondamento al byte: sono già zeri
  for (let i = pos >> 3, p = 0xec; i < cap; i++, p ^= 0xec ^ 0x11) out[i] = p;
  return out;
}
function conCorrezione(dati, v, liv) {   // divide in blocchi, aggiunge Reed-Solomon e intreccia: prima i dati, poi la correzione
  const nb = BLOCCHI[liv][v - 1], ne = EC[liv][v - 1], tot = codewords(v), corti = nb - (tot % nb), lCorto = Math.floor(tot / nb) - ne;
  const g = generatore(ne), blocchi = [], corr = [];
  for (let i = 0, k = 0; i < nb; i++) { const l = lCorto + (i < corti ? 0 : 1); blocchi.push(dati.subarray(k, k + l)); corr.push(resto(dati.subarray(k, k + l), g)); k += l; }
  const out = new Uint8Array(tot); let o = 0;
  for (let j = 0; j <= lCorto; j++) for (let i = 0; i < nb; i++) if (j < blocchi[i].length) out[o++] = blocchi[i][j];
  for (let j = 0; j < ne; j++) for (let i = 0; i < nb; i++) out[o++] = corr[i][j];
  return out;
}

// ---------------- maschere e penalità ----------------
const MASCHERE = [   // x = colonna, y = riga
  (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, x => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];
const chiaro = (l, da, a) => { for (let i = Math.max(da, 0); i < Math.min(a, l.length); i++) if (l[i]) return false; return true; };
function penalita(M, lato) {
  let p = 0, scuri = 0; const l = new Uint8Array(lato);
  for (let dir = 0; dir < 2; dir++) for (let a = 0; a < lato; a++) {
    for (let b = 0; b < lato; b++) l[b] = dir ? M[b * lato + a] : M[a * lato + b];
    for (let b = 1, corsa = 1; b <= lato; b++) {   // regola 1: 5 o più moduli uguali di fila → 3 + (n − 5)
      if (b < lato && l[b] === l[b - 1]) corsa++; else { if (corsa >= 5) p += corsa - 2; corsa = 1; }
    }
    for (let b = 0; b + 7 <= lato; b++)   // regola 3: 1:1:3:1:1 come un finder, con 4 chiari da una parte (fuori dal simbolo è chiaro)
      if (l[b] && !l[b + 1] && l[b + 2] && l[b + 3] && l[b + 4] && !l[b + 5] && l[b + 6] && (chiaro(l, b - 4, b) || chiaro(l, b + 7, b + 11))) p += 40;
  }
  for (let y = 0; y + 1 < lato; y++) for (let x = 0, i = y * lato; x + 1 < lato; x++, i++)   // regola 2: blocchi 2×2 dello stesso colore
    if (M[i] === M[i + 1] && M[i] === M[i + lato] && M[i] === M[i + lato + 1]) p += 3;
  for (let i = 0; i < M.length; i++) scuri += M[i];
  return p + 10 * Math.floor(Math.abs(scuri * 20 - M.length * 10) / M.length);   // regola 4: ogni 5% lontano dal 50% di scuri
}

// ---------------- il simbolo ----------------
export function codificaQr(testo, { correzione = 'M', versioneMin = 1 } = {}) {
  if (!Object.hasOwn(FORMATO, correzione)) throw new Error(`Livello di correzione sconosciuto: ${correzione} (L, M, Q o H)`);
  if (!Number.isInteger(versioneMin) || versioneMin < 1 || versioneMin > 40) throw new Error('versioneMin va da 1 a 40');
  const cand = candidati(String(testo)); let v = versioneMin, segs = null;
  for (; v <= 40 && !segs; v++) {
    let meglio = Infinity;
    for (const c of cand) { const n = lunghezza(c, v); if (n <= capienza(v, correzione) * 8 && n < meglio) { meglio = n; segs = c; } }
  }
  if (!segs) throw new Error('Testo troppo lungo per un QR');
  const versione = v - 1, lato = 17 + 4 * versione, dati = conCorrezione(bitDati(segs, versione, correzione), versione, correzione);
  const M = new Uint8Array(lato * lato), F = new Uint8Array(lato * lato);   // F: moduli di funzione, che la maschera non tocca
  const metti = (x, y, s) => { M[y * lato + x] = s; F[y * lato + x] = 1; };
  for (let i = 0; i < lato; i++) { metti(6, i, (i & 1) ^ 1); metti(i, 6, (i & 1) ^ 1); }   // timing
  for (const [cx, cy] of [[3, 3], [lato - 4, 3], [3, lato - 4]])   // finder con il separatore chiaro intorno
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && x < lato && y >= 0 && y < lato) metti(x, y, d !== 2 && d !== 4 ? 1 : 0);
    }
  const al = allineamenti(versione), u = al.length - 1;
  for (let i = 0; i <= u; i++) for (let j = 0; j <= u; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === u) || (i === u && j === 0)) continue;   // dove ci sono i finder
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) metti(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1 ? 1 : 0);
  }
  const formato = m => {   // BCH(15,5) con XOR 0x5412, in due copie; più il modulo scuro
    const d = (FORMATO[correzione] << 3) | m; let r = d;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const b = ((d << 10) | r) ^ 0x5412, bit = i => (b >>> i) & 1;
    for (let i = 0; i <= 5; i++) metti(8, i, bit(i));
    metti(8, 7, bit(6)); metti(8, 8, bit(7)); metti(7, 8, bit(8));
    for (let i = 9; i < 15; i++) metti(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) metti(lato - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) metti(8, lato - 15 + i, bit(i));
    metti(8, lato - 8, 1);
  };
  formato(0);   // per ora riserva soltanto le aree
  if (versione >= 7) {   // BCH(18,6), in due copie 6×3 e 3×6
    let r = versione; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const b = (versione << 12) | r;
    for (let i = 0; i < 18; i++) { const s = (b >>> i) & 1, a = lato - 11 + (i % 3), c = Math.floor(i / 3); metti(a, c, s); metti(c, a, s); }
  }
  // i dati a zig-zag, a coppie di colonne da destra, saltando la colonna del timing; i bit di resto restano chiari
  for (let dx = lato - 1, i = 0; dx >= 1; dx -= 2) {
    if (dx === 6) dx = 5;
    const su = ((dx + 1) & 2) === 0;
    for (let k = 0; k < lato; k++) for (let j = 0; j < 2; j++) {
      const x = dx - j, y = su ? lato - 1 - k : k;
      if (!F[y * lato + x] && i < dati.length * 8) { M[y * lato + x] = (dati[i >> 3] >>> (7 - (i & 7))) & 1; i++; }
    }
  }
  const applica = m => { const f = MASCHERE[m]; for (let y = 0, i = 0; y < lato; y++) for (let x = 0; x < lato; x++, i++) if (!F[i] && f(x, y)) M[i] ^= 1; };
  let migliore = 0, minima = Infinity;
  for (let m = 0; m < 8; m++) { applica(m); formato(m); const p = penalita(M, lato); if (p < minima) { minima = p; migliore = m; } applica(m); }
  applica(migliore); formato(migliore);
  return { versione, lato, moduli: M };
}

// ---------------- SVG ----------------
const escapa = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function qrSvg(testo, { correzione = 'M', margine = 4, etichetta = 'Codice QR' } = {}) {
  if (!Number.isInteger(margine) || margine < 0) throw new Error('Il margine va in moduli interi, da 0 in su');
  const { lato, moduli } = codificaQr(testo, { correzione }), n = lato + 2 * margine; let d = '';
  for (let y = 0; y < lato; y++) for (let x = 0; x < lato; ) {   // un rettangolo per ogni corsa di moduli scuri della riga
    if (!moduli[y * lato + x]) { x++; continue; }
    let l = 1; while (x + l < lato && moduli[y * lato + x + l]) l++;
    d += `M${x + margine} ${y + margine}h${l}v1h-${l}z`; x += l;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img" aria-label="${escapa(etichetta)}">`
    + `<rect width="${n}" height="${n}" fill="#fff"/><path fill="#000" d="${d}"/></svg>`;
}
