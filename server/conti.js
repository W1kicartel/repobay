// I conti: parola d'ordine con scrypt (sale per utente), sessioni con un gettone casuale (nel database solo il suo hash; il
// gettone di GitHub, se c'è, cifrato con AES-256-GCM), i gettoni a uso singolo dei link mandati per email, il codice
// personale per i link «?ref=…», i tentativi d'accesso, il controllo delle password deboli.
import { scryptSync, randomBytes, timingSafeEqual, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const DURATA_GIORNI = 30;
export const hashGettone = t => createHash('sha256').update(String(t)).digest('hex');
const ora = (ms = Date.now()) => new Date(ms).toISOString();

export function cifraParola(parola) {
  const sale = randomBytes(16); const h = scryptSync(parola, sale, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${sale.toString('base64')}$${h.toString('base64')}`;
}
export function controllaParola(parola, salvata) {
  const [tipo, sale, h] = String(salvata || '').split('$');
  if (tipo !== 'scrypt' || !sale || !h) return false;
  const atteso = Buffer.from(h, 'base64'); const calc = scryptSync(parola, Buffer.from(sale, 'base64'), atteso.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(atteso, calc);
}
// per non far capire dai tempi di risposta se un'email è iscritta: lo stesso lavoro anche quando l'utente non c'è
const FINTA = cifraParola(randomBytes(12).toString('hex'));
export const parolaACaso = parola => { controllaParola(String(parola || ''), FINTA); return false; };

// le password più usate (le prime delle liste pubbliche) e le regole minime; → il motivo, o null se va bene
const COMUNI = new Set(['password', 'password1', 'password12', 'password123', 'password1234', 'passw0rd', 'qwerty', 'qwertyuiop', 'qwerty123', 'qwerty1234',
  '123456', '1234567', '12345678', '123456789', '1234567890', '0123456789', '111111', '11111111', '000000', '00000000', 'abc123', 'abcdef', 'iloveyou', 'admin',
  'admin123', 'welcome', 'welcome1', 'letmein', 'monkey', 'dragon', 'football', 'baseball', 'sunshine', 'princess', 'trustno1', 'superman', 'batman',
  'asdfghjkl', 'zxcvbnm', '1q2w3e4r', '1q2w3e4r5t', 'qazwsxedc', 'juventus', 'napoli', 'milan', 'inter', 'roma', 'ciao', 'ciaociao', 'amore', 'tiamo',
  'cambiami', 'segreto', 'password!', 'changeme', 'whatever', 'starwars', 'pokemon', 'minecraft', 'internet', 'computer', 'abcdefghij', 'aaaaaaaaaa']);
export function parolaDebole(p, { email = '', nome = '' } = {}) {
  if (typeof p !== 'string' || p.length < 10) return 'La password deve avere almeno 10 caratteri';
  if (p.length > 200) return 'La password è troppo lunga (al massimo 200 caratteri)';
  const m = p.toLowerCase();
  if (new Set(m).size < 5) return 'La password è troppo ripetitiva: usa caratteri diversi';
  if (COMUNI.has(m) || COMUNI.has(m.replace(/[\d!.?_-]+$/, ''))) return 'Questa password è fra le più usate: scegline una tua';
  const locale = String(email).toLowerCase().split('@')[0];
  if (locale.length >= 4 && m.includes(locale)) return 'La password non deve contenere la tua email';
  for (const n of String(nome).toLowerCase().split(/\s+/)) if (n.length >= 4 && m.includes(n)) return 'La password non deve contenere il tuo nome';
  if (/^(0123456789|1234567890|abcdefghij|qwertyuiop)/.test(m)) return 'La password è una sequenza: scegline una meno prevedibile';
  return null;
}
// Have I Been Pwned (https://haveibeenpwned.com/API/v3#PwnedPasswords): esce solo l'inizio dell'hash SHA-1 (5 caratteri)
export async function parolaRubata(p, chiedi = fetch) {
  const h = createHash('sha1').update(p).digest('hex').toUpperCase();
  try {
    const r = await chiedi(`https://api.pwnedpasswords.com/range/${h.slice(0, 5)}`, { headers: { 'add-padding': 'true' }, signal: AbortSignal.timeout(4000) });
    if (!r.ok) return false;
    return (await r.text()).split('\n').some(l => { const [s, n] = l.trim().split(':'); return s === h.slice(5) && Number(n) > 0; });
  } catch { return false; }   // se il servizio non risponde non si blocca l'iscrizione
}

// la chiave per cifrare (gettoni di GitHub, dati fiscali, 2FA): da APP_SEGRETO, o da un file casuale nella cartella dei dati
export function chiaveSegreta(cfg) {
  if (cfg.segreto) return createHash('sha256').update(cfg.segreto).digest();
  if (cfg.dati === ':memory:') return createHash('sha256').update('prove').digest();
  mkdirSync(cfg.dati, { recursive: true }); const f = join(cfg.dati, 'segreto.key');
  if (!existsSync(f)) writeFileSync(f, randomBytes(32).toString('base64'), { mode: 0o600 });
  return createHash('sha256').update(readFileSync(f, 'utf8').trim()).digest();
}
export function cifra(testo, chiave) {
  const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', chiave, iv);
  const dati = Buffer.concat([c.update(testo, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), dati].map(b => b.toString('base64')).join('.');
}
export function decifra(scatola, chiave) {
  try {
    const [iv, tag, dati] = String(scatola).split('.').map(s => Buffer.from(s, 'base64'));
    const d = createDecipheriv('aes-256-gcm', chiave, iv); d.setAuthTag(tag);
    return Buffer.concat([d.update(dati), d.final()]).toString('utf8');
  } catch { return null; }
}

// il codice dei link: dal nome, minuscolo senza accenti, più quattro caratteri casuali (marco-7f3k)
export function nuovoCodice(nome, esiste) {
  const base = String(nome).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'utente';
  for (let i = 0; i < 20; i++) {
    const c = `${base}-${randomBytes(3).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 4).padEnd(4, '0')}`;
    if (!esiste(c)) return c;
  }
  throw new Error('impossibile trovare un codice libero');
}

export function apriSessione(db, utente, githubCifrato = null, { agente = null, ip = null, metodo = 'parola' } = {}) {
  const t = randomBytes(32).toString('base64url');
  const scade = ora(Date.now() + DURATA_GIORNI * 864e5);
  db.prepare('INSERT INTO sessione (token, utente, scade, github, creata, vista, agente, ip, metodo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(hashGettone(t), utente, scade, githubCifrato, ora(), ora(), agente, ip, metodo);
  return { gettone: t, scade };
}
export function chiudiSessione(db, gettone) {
  if (gettone) db.prepare('DELETE FROM sessione WHERE token = ?').run(hashGettone(gettone));
}
export function utenteDaSessione(db, gettone) {
  if (!gettone) return null;
  const h = hashGettone(gettone), adesso = ora();
  const u = db.prepare(`SELECT u.*, s.github AS sessione_github, s.token AS sessione_token, s.vista AS sessione_vista FROM sessione s JOIN utente u ON u.id = s.utente
    WHERE s.token = ? AND s.scade > ? AND u.cancellato IS NULL`).get(h, adesso);
  if (u && (!u.sessione_vista || Date.parse(u.sessione_vista) < Date.now() - 10 * 60e3)) db.prepare('UPDATE sessione SET vista = ? WHERE token = ?').run(adesso, h);   // ogni 10 minuti al più
  return u || null;
}

// i gettoni dei link mandati per email: casuali, nel database solo l'hash, scadono e valgono una volta
export function nuovoGettone(db, tipo, { utente = null, dato = null, minuti = 60 } = {}) {
  const t = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO gettone (token, tipo, utente, dato, scade) VALUES (?, ?, ?, ?, ?)').run(hashGettone(t), tipo, utente, dato, ora(Date.now() + minuti * 60e3));
  return t;
}
export function usaGettone(db, tipi, t) {
  if (typeof t !== 'string' || t.length < 20 || t.length > 100) return null;
  const g = db.prepare('DELETE FROM gettone WHERE token = ? RETURNING *').get(hashGettone(t));
  if (!g || ![].concat(tipi).includes(g.tipo) || g.scade <= ora()) return null;
  return g;
}

// tentativi: al massimo `max` in 15 minuti per chiave (indirizzo, email, utente), in memoria
const tentativi = new Map();
export function troppiTentativi(chiave, adesso = Date.now(), max = 10, finestra = 15 * 60e3) {
  const l = (tentativi.get(chiave) || []).filter(t => adesso - t < finestra);
  l.push(adesso); tentativi.set(chiave, l);
  if (tentativi.size > 50_000) for (const [k, v] of tentativi) if (!v.some(t => adesso - t < finestra)) tentativi.delete(k);   // niente memoria che cresce per sempre
  return l.length > max;
}
export const azzeraTentativi = () => tentativi.clear();
export const dimenticaTentativi = (...chiavi) => { for (const k of chiavi) tentativi.delete(k); };
