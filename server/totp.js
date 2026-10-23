// La verifica in due passaggi con un'app (Google Authenticator, Aegis, 1Password…): TOTP (RFC 6238) sopra HOTP (RFC 4226),
// più i codici di recupero da usare una volta sola. Il segreto va salvato cifrato (cifra() di conti.js), i codici solo come hash.
// Provata con i vettori dell'RFC 6238 (appendice B) e dell'RFC 4226 (appendice D) in test/totp.test.mjs.
import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

// ---------------- base32 (RFC 4648, l'alfabeto delle app: A-Z 2-7, senza «=») ----------------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(dati) {
  let bit = 0, valore = 0, out = '';
  for (const b of Buffer.from(dati)) {
    valore = (valore << 8) | b; bit += 8;
    while (bit >= 5) { out += B32[(valore >>> (bit - 5)) & 31]; bit -= 5; }
    valore &= 0xff;   // tiene solo i bit non ancora usati: niente overflow sui segreti lunghi
  }
  if (bit > 0) out += B32[(valore << (5 - bit)) & 31];
  return out;
}
// tollerante come le app: spazi, trattini, minuscole e «=» finali vanno bene; un carattere fuori alfabeto no
export function daBase32(testo) {
  const s = String(testo).toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  if (!/^[A-Z2-7]*$/.test(s)) throw new Error('segreto base32 non valido');
  let bit = 0, valore = 0; const out = [];
  for (const c of s) {
    valore = (valore << 5) | B32.indexOf(c); bit += 5;
    if (bit >= 8) { out.push((valore >>> (bit - 8)) & 0xff); bit -= 8; }
    valore &= 0xff;
  }
  return Buffer.from(out);
}
const chiaveDi = segreto => (Buffer.isBuffer(segreto) || segreto instanceof Uint8Array ? Buffer.from(segreto) : daBase32(segreto));

export const nuovoSegretoTotp = () => base32(randomBytes(20));   // 160 bit, quanto l'uscita di SHA-1 (RFC 4226 §4)

// l'indirizzo del QR: etichetta «Emittente:conto» con le due parti codificate (i «:» dentro i nomi diventano %3A), spazi come %20
export function uriTotp({ segreto, conto, emittente }) {
  const e = encodeURIComponent(String(emittente)), c = encodeURIComponent(String(conto));
  return `otpauth://totp/${e}:${c}?secret=${String(segreto).replace(/=+$/, '')}&issuer=${e}&algorithm=SHA1&digits=6&period=30`;
}

// HOTP: HMAC sul contatore a 8 byte big-endian, troncamento dinamico, ultime «cifre» cifre decimali
function hotp(chiave, contatore, cifre, algoritmo) {
  const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(contatore));
  const h = createHmac(algoritmo, chiave).update(c).digest();
  const o = h[h.length - 1] & 0x0f;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** cifre).padStart(cifre, '0');
}
const contatoreDi = (quando, passo) => Math.floor(quando / 1000 / passo);

export function codiceTotp(segreto, { quando = Date.now(), cifre = 6, passo = 30, algoritmo = 'sha1' } = {}) {
  return hotp(chiaveDi(segreto), contatoreDi(quando, passo), cifre, algoritmo);
}

// il contatore del codice accettato (da salvare come «ultimo»), oppure null. I contatori ≤ ultimo sono rifiutati: lo stesso
// codice non vale due volte, neanche dentro i suoi 30 secondi. Prova tutta la finestra senza fermarsi al primo: tempo costante.
export function verificaTotp(segreto, codice, { finestra = 1, ultimo = -1, quando = Date.now(), cifre = 6, passo = 30, algoritmo = 'sha1' } = {}) {
  const dato = String(codice ?? '').replace(/\s/g, '');
  if (!new RegExp(`^\\d{${cifre}}$`).test(dato)) return null;
  const chiave = chiaveDi(segreto), adesso = contatoreDi(quando, passo), d = Buffer.from(dato);
  let trovato = null;
  for (let i = -finestra; i <= finestra; i++) {
    const t = adesso + i; if (t < 0) continue;
    const giusto = timingSafeEqual(Buffer.from(hotp(chiave, t, cifre, algoritmo)), d);
    if (giusto && t > ultimo && trovato === null) trovato = t;
  }
  return trovato;
}

// ---------------- codici di recupero ----------------
// 8 caratteri dall'alfabeto di Crockford (32 simboli, niente i l o u): 40 bit l'uno. Nel confronto valgono maiuscole,
// spazi, trattini e le sviste classiche (o→0, i/l→1). Con «pepe» (es. chiaveSegreta() di conti.js) l'hash è un HMAC:
// chi ruba solo il database non può provarli tutti a forza bruta.
const CROCKFORD = '0123456789abcdefghjkmnpqrstvwxyz';
const normalizza = c => String(c ?? '').toLowerCase().replace(/[\s-]/g, '').replace(/o/g, '0').replace(/[il]/g, '1');
const hashCodice = (c, pepe) => (pepe ? createHmac('sha256', pepe) : createHash('sha256')).update(normalizza(c)).digest('hex');

export function codiciRecupero(n = 10, pepe) {
  const chiari = Array.from({ length: n }, () => {
    const s = [...randomBytes(8)].map(b => CROCKFORD[b & 31]).join('');   // 256 è multiplo di 32: nessuno sbilanciamento
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
  return { chiari, hash: chiari.map(c => hashCodice(c, pepe)) };
}

// il nuovo elenco senza il codice usato (da salvare al posto del vecchio), oppure null se il codice non c'è
export function usaCodiceRecupero(hash, codice, pepe) {
  const n = normalizza(codice);
  if (!Array.isArray(hash) || !/^[0-9a-z]{8}$/.test(n)) return null;
  const h = Buffer.from(hashCodice(n, pepe), 'hex');
  let indice = -1;
  hash.forEach((x, i) => {   // li confronta tutti, a tempo costante
    const b = Buffer.from(String(x), 'hex');
    if (b.length === h.length && timingSafeEqual(b, h) && indice < 0) indice = i;
  });
  return indice < 0 ? null : hash.filter((_, i) => i !== indice);
}
