// Le passkey nel browser: dalle opzioni JSON del server (server/passkey.js) a navigator.credentials, e ritorno in JSON.
// Usa parse…FromJSON e toJSON() dove ci sono (WebAuthn L3), altrimenti converte a mano in base64url. Gli errori del
// browser diventano messaggi italiani; il nome originale resta in err.codice (es. 'AbortError' da ignorare in silenzio).
const PKC = () => globalThis.PublicKeyCredential;

// ---------------- base64url ----------------
function daB64u(s) {
  const b = atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4));
  return Uint8Array.from(b, c => c.charCodeAt(0)).buffer;
}
function aB64u(v) {
  const u = ArrayBuffer.isView(v) ? new Uint8Array(v.buffer, v.byteOffset, v.byteLength) : new Uint8Array(v);
  let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const descrittori = l => (l || []).map(c => ({ ...c, id: daB64u(c.id) }));

// ---------------- dalle opzioni JSON a quelle del browser ----------------
function perCreare(o) {
  const c = PKC();
  if (typeof c?.parseCreationOptionsFromJSON === 'function') try { return c.parseCreationOptionsFromJSON(o); } catch { /* sotto, a mano */ }
  return { ...o, challenge: daB64u(o.challenge), user: { ...o.user, id: daB64u(o.user.id) }, excludeCredentials: descrittori(o.excludeCredentials) };
}
function perUsare(o) {
  const c = PKC();
  if (typeof c?.parseRequestOptionsFromJSON === 'function') try { return c.parseRequestOptionsFromJSON(o); } catch { /* sotto, a mano */ }
  return { ...o, challenge: daB64u(o.challenge), allowCredentials: descrittori(o.allowCredentials) };
}

// ---------------- dalla credenziale al JSON per il server ----------------
// toJSON() manca nei browser vecchi e in qualche gestore di password che sostituisce navigator.credentials
function inJson(cred) {
  if (typeof cred.toJSON === 'function') try { const j = cred.toJSON(); if (j?.response?.clientDataJSON) return j; } catch { /* sotto, a mano */ }
  const r = cred.response, j = {
    id: cred.id, rawId: aB64u(cred.rawId), type: cred.type, authenticatorAttachment: cred.authenticatorAttachment ?? null,
    clientExtensionResults: estensioni(cred), response: { clientDataJSON: aB64u(r.clientDataJSON) },
  };
  if (r.attestationObject) Object.assign(j.response, { attestationObject: aB64u(r.attestationObject), transports: trasporti(r) });
  else Object.assign(j.response, { authenticatorData: aB64u(r.authenticatorData), signature: aB64u(r.signature), userHandle: r.userHandle ? aB64u(r.userHandle) : null });
  return j;
}
function estensioni(cred) {   // solo i valori semplici (credProps); i binari delle altre estensioni non ci servono
  try { const e = cred.getClientExtensionResults?.() || {}; return e.credProps ? { credProps: { rk: !!e.credProps.rk } } : {}; } catch { return {}; }
}
function trasporti(r) { try { return r.getTransports?.() || []; } catch { return []; } }

// ---------------- gli errori, in italiano ----------------
function errore(e, fase) {
  const messaggi = {
    NotAllowedError: 'Operazione annullata o scaduta: riprova quando vuoi.',
    InvalidStateError: fase === 'crea' ? 'Su questo dispositivo c\'è già una passkey per il tuo conto.' : 'Questa passkey non si può usare qui.',
    SecurityError: 'Le passkey funzionano solo sul sito vero, in HTTPS.',
    AbortError: 'Richiesta interrotta.',
    NotSupportedError: 'Questo dispositivo non supporta le passkey.',
    ConstraintError: 'Il dispositivo non può verificare chi sei (PIN o impronta).',
  };
  const err = new Error(messaggi[e?.name] || 'La passkey non ha funzionato: riprova, oppure entra con email e parola d\'ordine.');
  err.codice = e?.name || 'Errore'; err.cause = e;
  return err;
}
function serve(metodo) {
  if (!PKC() || typeof globalThis.navigator?.credentials?.[metodo] !== 'function') throw errore({ name: 'NotSupportedError' });
}

// ---------------- API ----------------
// c'è un autenticatore del dispositivo (Touch ID, Windows Hello, sblocco di Android)?
export async function passkeySupportate() {
  try { const c = PKC(); return !!c && typeof c.isUserVerifyingPlatformAuthenticatorAvailable === 'function' && (await c.isUserVerifyingPlatformAuthenticatorAvailable()) === true; }
  catch { return false; }
}
// il browser sa proporre le passkey nei suggerimenti del campo email (autocomplete="username webauthn")?
export async function compilazioneAutomatica() {
  try { const c = PKC(); return !!c && typeof c.isConditionalMediationAvailable === 'function' && (await c.isConditionalMediationAvailable()) === true; }
  catch { return false; }
}

// opzioni: quelle di opzioniRegistrazione() del server → il JSON da rimandargli per verificaRegistrazione()
export async function creaPasskey(opzioni) {
  serve('create');
  let cred;
  try { cred = await navigator.credentials.create({ publicKey: perCreare(opzioni) }); } catch (e) { throw errore(e, 'crea'); }
  if (!cred) throw errore({ name: 'NotAllowedError' });
  return inJson(cred);
}

// opzioni: quelle di opzioniAccesso() → il JSON per verificaAccesso(). Con condizionale la richiesta resta in attesa
// finché l'utente non sceglie una passkey dai suggerimenti del campo email: va annullata (segnale) prima di farne un'altra.
export async function usaPasskey(opzioni, { condizionale = false, segnale } = {}) {
  serve('get');
  const richiesta = { publicKey: perUsare(opzioni) };
  if (condizionale) richiesta.mediation = 'conditional';
  if (segnale) richiesta.signal = segnale;
  let cred;
  try { cred = await navigator.credentials.get(richiesta); } catch (e) { throw errore(e, 'usa'); }
  if (!cred) throw errore({ name: 'NotAllowedError' });
  return inJson(cred);
}
