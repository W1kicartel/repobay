// Base58 (l'alfabeto di Bitcoin, quello degli indirizzi e delle firme di Solana), in JS puro: serve sia al browser
// (web/solana.js) sia al server (server/solana.js, che lo importa da qui). Niente API di Node, niente librerie.
// Provato con i vettori di Bitcoin Core (base58_encode_decode.json) in test/solana.test.mjs.
const ALFABETO = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const VALORE = new Map([...ALFABETO].map((c, i) => [c, BigInt(i)]));

// gli zeri iniziali diventano «1», il resto è un numero grande in base 58
function codifica(byte) {
  const b = Uint8Array.from(byte); let zeri = 0;
  while (zeri < b.length && b[zeri] === 0) zeri++;
  let n = 0n; for (let i = zeri; i < b.length; i++) n = (n << 8n) | BigInt(b[i]);
  let s = ''; while (n > 0n) { s = ALFABETO[Number(n % 58n)] + s; n /= 58n; }
  return '1'.repeat(zeri) + s;
}

// → Uint8Array; un carattere fuori dall'alfabeto (0, O, I, l, spazi…) è un errore
function decodifica(testo) {
  if (typeof testo !== 'string') throw new Error('base58 non valido');
  let zeri = 0; while (zeri < testo.length && testo[zeri] === '1') zeri++;
  let n = 0n;
  for (let i = zeri; i < testo.length; i++) { const v = VALORE.get(testo[i]); if (v === undefined) throw new Error('base58 non valido'); n = n * 58n + v; }
  const corpo = []; while (n > 0n) { corpo.unshift(Number(n & 0xffn)); n >>= 8n; }
  return Uint8Array.from([...new Array(zeri).fill(0), ...corpo]);
}

export const base58 = { codifica, decodifica };
