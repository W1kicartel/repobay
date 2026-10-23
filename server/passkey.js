// Le passkey (WebAuthn Level 2/3) lato server, senza librerie: le opzioni per il browser, un decodificatore CBOR minimo ma
// rigoroso, le chiavi COSE (ES256, EdDSA, RS256) portate in KeyObject via JWK, la verifica di registrazione e di accesso.
// Si salva per ogni passkey: id, chiave (SPKI), algoritmo, contatore, trasporti. Provata con un finto autenticatore in
// test/passkey.test.mjs. Le sfide si generano qui, ma tenerle (in sessione, 5 minuti, una volta sola) tocca a chi chiama.
import { createHash, createPublicKey, verify, randomBytes, timingSafeEqual, constants } from 'node:crypto';

const ALGORITMI = [-7, -8, -257];   // ES256, EdDSA, RS256: in quest'ordine di preferenza
const TIMEOUT = 5 * 60e3;
const TRASPORTI = new Set(['usb', 'nfc', 'ble', 'smart-card', 'hybrid', 'internal', 'cable']);
const MAX_JSON = 64 * 1024, MAX_ATTESTAZIONE = 256 * 1024;

const sha256 = b => createHash('sha256').update(b).digest();
const b64u = b => Buffer.from(b).toString('base64url');
// base64url rigoroso: solo l'alfabeto giusto (il padding finale si tollera), e il testo deve tornare identico ricodificandolo
function daB64u(s, cosa) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*={0,2}$/.test(s)) throw new Error(`${cosa}: base64url non valido`);
  s = s.replace(/=+$/, ''); const b = Buffer.from(s, 'base64url');
  if (b.toString('base64url') !== s) throw new Error(`${cosa}: base64url non valido`);
  return b;
}
// confronto a tempo costante anche fra lunghezze diverse: si confrontano gli hash
const uguali = (a, b) => timingSafeEqual(sha256(Buffer.from(a)), sha256(Buffer.from(b)));

// ---------------- CBOR (RFC 8949), solo quello che serve a WebAuthn ----------------
// interi, negativi, byte, testo, array, mappe (sempre Map: le chiavi COSE sono numeri), semplici e decimali; lunghezze
// da 1/2/4/8 byte. Niente lunghezze indefinite né tag (CTAP2 usa la forma canonica): sono errori, come le chiavi doppie,
// i dati troncati e gli annidamenti oltre 16 livelli.
const ERR = m => new Error(`CBOR: ${m}`);
const utf8 = new TextDecoder('utf-8', { fatal: true });
export function leggiCbor(dati, pos = 0) {
  const b = Buffer.from(dati);
  const servono = n => { if (pos + n > b.length) throw ERR('dati troncati'); };
  function argomento(info) {
    if (info < 24) return info;
    if (info === 24) { servono(1); return b[pos++]; }
    if (info === 25) { servono(2); const v = b.readUInt16BE(pos); pos += 2; return v; }
    if (info === 26) { servono(4); const v = b.readUInt32BE(pos); pos += 4; return v; }
    if (info === 27) {
      servono(8); const v = b.readBigUInt64BE(pos); pos += 8;
      if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw ERR('numero troppo grande');
      return Number(v);
    }
    throw ERR(info === 31 ? 'lunghezza indefinita non ammessa' : 'informazione aggiuntiva riservata');
  }
  function elemento(profondita) {
    if (profondita > 16) throw ERR('annidamento troppo profondo');
    servono(1); const iniziale = b[pos++], tipo = iniziale >> 5, info = iniziale & 31;
    if (tipo === 7) {
      if (info === 20) return false; if (info === 21) return true; if (info === 22) return null; if (info === 23) return undefined;
      if (info === 24) { servono(1); const v = b[pos++]; if (v < 32) throw ERR('semplice non canonico'); return { semplice: v }; }
      if (info === 25) { servono(2); const v = mezzo(b.readUInt16BE(pos)); pos += 2; return v; }
      if (info === 26) { servono(4); const v = b.readFloatBE(pos); pos += 4; return v; }
      if (info === 27) { servono(8); const v = b.readDoubleBE(pos); pos += 8; return v; }
      if (info < 20) return { semplice: info };
      throw ERR(info === 31 ? 'interruzione fuori posto' : 'semplice riservato');
    }
    const n = argomento(info);
    switch (tipo) {
      case 0: return n;
      case 1: return -1 - n;
      case 2: { servono(n); const v = Buffer.from(b.subarray(pos, pos + n)); pos += n; return v; }
      case 3: { servono(n); let v; try { v = utf8.decode(b.subarray(pos, pos + n)); } catch { throw ERR('testo non UTF-8'); } pos += n; return v; }
      case 4: { if (n > b.length - pos) throw ERR('dati troncati'); const a = []; for (let i = 0; i < n; i++) a.push(elemento(profondita + 1)); return a; }
      case 5: {
        if (n * 2 > b.length - pos) throw ERR('dati troncati');
        const m = new Map();
        for (let i = 0; i < n; i++) {
          const k = elemento(profondita + 1);
          if (typeof k !== 'number' && typeof k !== 'string') throw ERR('chiave di mappa non ammessa');
          if (m.has(k)) throw ERR('chiave doppia');
          m.set(k, elemento(profondita + 1));
        }
        return m;
      }
      default: throw ERR('tag non ammessi');   // tipo 6
    }
  }
  const valore = elemento(0);
  return { valore, fine: pos };
}
// un solo elemento che occupa tutti i byte
export function decodificaCbor(dati) {
  const { valore, fine } = leggiCbor(dati);
  if (fine !== Buffer.from(dati).length) throw ERR('byte in più dopo la fine');
  return valore;
}
function mezzo(h) {   // decimale a 16 bit (IEEE 754 half)
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, f = h & 1023;
  if (e === 0) return s * 2 ** -14 * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}

// ---------------- chiavi COSE (RFC 9053) → KeyObject ----------------
// EC2 P-256 con ES256, OKP Ed25519 con EdDSA, RSA (almeno 2048 bit) con RS256. Il JWK lo controlla anche OpenSSL
// (un punto fuori dalla curva viene rifiutato).
export function chiaveDaCose(cose) {
  if (!(cose instanceof Map)) throw new Error('chiave COSE non valida');
  const kty = cose.get(1), alg = cose.get(3), byte = (k, n) => {
    const v = cose.get(k);
    if (!Buffer.isBuffer(v) || (n && v.length !== n)) throw new Error('chiave COSE non valida');
    return v;
  };
  let jwk;
  if (kty === 2 && alg === -7) {
    if (cose.get(-1) !== 1) throw new Error('curva non supportata (serve P-256)');
    jwk = { kty: 'EC', crv: 'P-256', x: b64u(byte(-2, 32)), y: b64u(byte(-3, 32)) };
  } else if (kty === 1 && alg === -8) {
    if (cose.get(-1) !== 6) throw new Error('curva non supportata (serve Ed25519)');
    jwk = { kty: 'OKP', crv: 'Ed25519', x: b64u(byte(-2, 32)) };
  } else if (kty === 3 && alg === -257) {
    let n = byte(-1); const e = byte(-2);
    while (n.length && n[0] === 0) n = n.subarray(1);   // qualche autenticatore lascia uno zero in testa
    if (n.length < 256 || n.length > 1024 || e.length > 8) throw new Error('chiave RSA non valida (servono 2048-8192 bit)');
    jwk = { kty: 'RSA', n: b64u(n), e: b64u(e) };
  } else throw new Error(`algoritmo non supportato (${alg})`);
  try { return { chiave: createPublicKey({ key: jwk, format: 'jwk' }), algoritmo: alg }; }
  catch { throw new Error('chiave COSE non valida'); }
}

// ---------------- authenticatorData ----------------
// rpIdHash (32) · flag (1) · contatore (4) · [aaguid (16) · lunghezza id (2) · id · chiave COSE] · [estensioni CBOR]
const FLAG = { UP: 0x01, UV: 0x04, BE: 0x08, BS: 0x10, AT: 0x40, ED: 0x80 };
export function leggiDatiAutenticatore(dati) {
  const b = Buffer.from(dati);
  if (b.length < 37) throw new Error('authenticatorData troppo corto');
  const flag = b[32], d = {
    rpIdHash: b.subarray(0, 32), contatore: b.readUInt32BE(33),
    up: !!(flag & FLAG.UP), uv: !!(flag & FLAG.UV), idonea: !!(flag & FLAG.BE), attiva: !!(flag & FLAG.BS), at: !!(flag & FLAG.AT), ed: !!(flag & FLAG.ED),
  };
  if (d.attiva && !d.idonea) throw new Error('authenticatorData: copia di backup attiva senza esserne idonea');
  let pos = 37;
  if (d.at) {
    if (b.length < pos + 18) throw new Error('authenticatorData troncato');
    d.aaguid = b.subarray(pos, pos + 16); const n = b.readUInt16BE(pos + 16); pos += 18;
    if (n < 1 || n > 1023 || b.length < pos + n) throw new Error('authenticatorData: id della credenziale non valido');
    d.idCredenziale = b.subarray(pos, pos + n); pos += n;
    const { valore, fine } = leggiCbor(b, pos); d.cose = valore; pos = fine;
  }
  if (d.ed) { const { valore, fine } = leggiCbor(b, pos); if (!(valore instanceof Map)) throw new Error('authenticatorData: estensioni non valide'); d.estensioni = valore; pos = fine; }
  if (pos !== b.length) throw new Error('authenticatorData: byte in più');
  return d;
}

// ---------------- controlli comuni ----------------
function credenzialeJson(risposta) {
  if (!risposta || typeof risposta !== 'object' || risposta.type !== 'public-key' || !risposta.response || typeof risposta.response !== 'object')
    throw new Error('risposta della passkey non valida');
  const raw = daB64u(risposta.rawId, 'rawId');
  if (risposta.id !== risposta.rawId) throw new Error('id e rawId della credenziale non coincidono');
  if (raw.length < 1 || raw.length > 1023) throw new Error('id della credenziale non valido');
  return raw;
}
function datiClient(testo, tipo, sfida, origine) {
  const grezzi = daB64u(testo, 'clientDataJSON');
  if (grezzi.length > MAX_JSON) throw new Error('clientDataJSON troppo grande');
  let c; try { c = JSON.parse(grezzi.toString('utf8')); } catch { throw new Error('clientDataJSON non è JSON'); }
  if (!c || c.type !== tipo) throw new Error(`tipo sbagliato: atteso ${tipo}`);
  if (typeof c.challenge !== 'string' || typeof sfida !== 'string' || !sfida || !uguali(c.challenge, sfida)) throw new Error('sfida sbagliata o scaduta');
  const ammesse = [].concat(origine);   // confronto esatto: https://officina.example.evil.com non è https://officina.example
  if (typeof c.origin !== 'string' || !ammesse.includes(c.origin)) throw new Error(`origine non ammessa: ${String(c.origin).slice(0, 100)}`);
  if (c.crossOrigin === true) throw new Error('passkey usata dentro un iframe di un altro sito');
  if (c.tokenBinding?.status === 'present') throw new Error('token binding non supportato');
  return grezzi;
}
function controllaRp(d, rpId, uvObbligatoria) {
  if (!rpId || !timingSafeEqual(d.rpIdHash, sha256(String(rpId)))) throw new Error('la passkey è di un altro sito (rpId)');
  if (!d.up) throw new Error('presenza dell\'utente non confermata');
  if (uvObbligatoria && !d.uv) throw new Error('verifica dell\'utente (PIN o biometria) mancante');
}
// la firma: ES256 in DER, EdDSA grezza, RS256 PKCS#1 v1.5
function firmaValida(chiave, dati, firma) {
  try {
    const t = chiave.asymmetricKeyType;
    if (t === 'ec') return chiave.asymmetricKeyDetails?.namedCurve === 'prime256v1' && verify('sha256', dati, { key: chiave, dsaEncoding: 'der' }, firma);
    if (t === 'ed25519') return verify(null, dati, chiave, firma);
    if (t === 'rsa') return verify('sha256', dati, { key: chiave, padding: constants.RSA_PKCS1_PADDING }, firma);
    return false;
  } catch { return false; }
}
const ALG_DI_TIPO = { ec: -7, ed25519: -8, rsa: -257 };
const idDi = c => (typeof c === 'string' ? c : c?.id);
const descrittore = c => {
  const d = { type: 'public-key', id: b64u(daB64u(idDi(c), 'id della credenziale')) };
  const t = (typeof c === 'object' && (c.trasporti || c.transports)) || null;
  if (Array.isArray(t) && t.length) d.transports = t.filter(x => TRASPORTI.has(x));
  return d;
};

// ---------------- registrazione ----------------
// utente.id è l'«user handle»: 16-64 byte casuali fissi per utente (mai email o id del database: finisce sul dispositivo)
export function opzioniRegistrazione({ rp: { id, nome }, utente: { id: idUtente, nome: nomeUtente, visualizzato }, escludi = [] }) {
  const handle = daB64u(idUtente, 'utente.id');
  if (handle.length < 1 || handle.length > 64) throw new Error('utente.id: da 1 a 64 byte');
  const sfida = b64u(randomBytes(32));
  const opzioni = {
    rp: { id, name: nome },
    user: { id: b64u(handle), name: String(nomeUtente), displayName: String(visualizzato ?? nomeUtente) },
    challenge: sfida,
    pubKeyCredParams: ALGORITMI.map(alg => ({ type: 'public-key', alg })),
    timeout: TIMEOUT,
    excludeCredentials: escludi.map(descrittore),
    authenticatorSelection: { residentKey: 'preferred', requireResidentKey: false, userVerification: 'preferred' },
    attestation: 'none',
    extensions: { credProps: true },
  };
  return { opzioni, sfida };
}

// → { id, chiave, algoritmo, contatore, trasporti, uv, backup: { idonea, attiva }, aaguid }, oppure lancia un Error
export function verificaRegistrazione({ risposta, sfida, origine, rpId, algoritmi = ALGORITMI, uvObbligatoria = false }) {
  const raw = credenzialeJson(risposta);
  const cd = datiClient(risposta.response.clientDataJSON, 'webauthn.create', sfida, origine);
  const grezzo = daB64u(risposta.response.attestationObject, 'attestationObject');
  if (grezzo.length > MAX_ATTESTAZIONE) throw new Error('attestationObject troppo grande');
  const att = decodificaCbor(grezzo);
  if (!(att instanceof Map) || typeof att.get('fmt') !== 'string' || !(att.get('attStmt') instanceof Map) || !Buffer.isBuffer(att.get('authData')))
    throw new Error('attestationObject non valido');
  const authData = att.get('authData'), d = leggiDatiAutenticatore(authData);
  controllaRp(d, rpId, uvObbligatoria);
  if (!d.at) throw new Error('manca la chiave della credenziale (flag AT)');
  if (!d.idCredenziale.equals(raw)) throw new Error('l\'id della credenziale non coincide con rawId');
  const { chiave, algoritmo } = chiaveDaCose(d.cose);
  if (!algoritmi.includes(algoritmo)) throw new Error(`algoritmo non richiesto (${algoritmo})`);

  // attestazione: abbiamo chiesto «none». «packed» senza certificati (self) la verifichiamo; gli altri formati e «packed»
  // con certificati non dimostrano niente che ci serva: si ignora l'attStmt e si tiene la chiave.
  const fmt = att.get('fmt'), st = att.get('attStmt');
  if (fmt === 'none' && st.size !== 0) throw new Error('attestazione «none» con dati');
  if (fmt === 'packed' && !st.has('x5c')) {
    if (st.get('alg') !== algoritmo || !Buffer.isBuffer(st.get('sig'))) throw new Error('attestazione packed non valida');
    if (!firmaValida(chiave, Buffer.concat([authData, sha256(cd)]), st.get('sig'))) throw new Error('firma dell\'attestazione non valida');
  }

  const t = risposta.response.transports;
  return {
    id: b64u(raw),
    chiave: chiave.export({ type: 'spki', format: 'der' }).toString('base64url'),
    algoritmo,
    contatore: d.contatore,
    trasporti: Array.isArray(t) ? [...new Set(t.filter(x => TRASPORTI.has(x)))] : [],
    uv: d.uv,
    backup: { idonea: d.idonea, attiva: d.attiva },
    aaguid: d.aaguid.toString('hex').replace(/^(.{8})(.{4})(.{4})(.{4})/, '$1-$2-$3-$4-'),
  };
}

// ---------------- accesso ----------------
// consentite vuota: passkey individuabili, il browser propone quelle del sito (accesso senza scrivere l'email)
export function opzioniAccesso({ rpId, consentite = [] }) {
  const sfida = b64u(randomBytes(32));
  return { opzioni: { challenge: sfida, rpId, timeout: TIMEOUT, userVerification: 'preferred', allowCredentials: consentite.map(descrittore) }, sfida };
}

// → { contatore, uv, utente, backup }, oppure lancia un Error. «chiave» e «contatore» sono quelli salvati per la credenziale
// che ha l'id della risposta (cercarla con risposta.id); «utente», se passato, è l'user handle atteso.
export function verificaAccesso({ risposta, sfida, origine, rpId, chiave, contatore = 0, utente, algoritmo, uvObbligatoria = false }) {
  credenzialeJson(risposta);
  const r = risposta.response;
  const cd = datiClient(r.clientDataJSON, 'webauthn.get', sfida, origine);
  const authData = daB64u(r.authenticatorData, 'authenticatorData'), d = leggiDatiAutenticatore(authData);
  controllaRp(d, rpId, uvObbligatoria);
  let k; try { k = createPublicKey({ key: Buffer.from(String(chiave), 'base64url'), format: 'der', type: 'spki' }); } catch { throw new Error('chiave salvata non valida'); }
  if (algoritmo !== undefined && ALG_DI_TIPO[k.asymmetricKeyType] !== algoritmo) throw new Error('algoritmo della chiave salvata non coerente');
  if (!firmaValida(k, Buffer.concat([authData, sha256(cd)]), daB64u(r.signature, 'signature'))) throw new Error('firma della passkey non valida');
  // il contatore: se uno dei due non è zero, quello nuovo deve crescere (WebAuthn §7.2 passo 22). Le passkey sincronizzate
  // (Apple, Google) mandano sempre 0 e passano.
  const vecchio = Number(contatore) || 0;
  if ((d.contatore > 0 || vecchio > 0) && d.contatore <= vecchio) throw new Error('contatore tornato indietro: la passkey potrebbe essere stata clonata');
  let handle = null;
  if (r.userHandle != null && r.userHandle !== '') {
    handle = b64u(daB64u(r.userHandle, 'userHandle'));
    if (utente != null && !uguali(handle, String(utente))) throw new Error('la passkey appartiene a un altro utente');
  }
  return { contatore: d.contatore, uv: d.uv, utente: handle, backup: { idonea: d.idonea, attiva: d.attiva } };
}
