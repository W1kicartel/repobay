// Il corso per installatori: lezioni brevi (server/corso/<lingua>.json) e un test. Il test superato (utente.corso) serve per
// offrire i programmi del catalogo, facili e medi; quelli impegnativi (la difficoltà della guida d'installazione) si sbloccano con
// l'esperienza: CORSO_ESPERIENZA installazioni confermate dai clienti, oppure chi gestisce la piattaforma li sblocca a chi fa già
// questo lavoro (utente.esperto). Chi sviluppa un programma può sempre offrire il suo, se ha superato il test.
// Il test: CORSO_DOMANDE domande estratte a caso dalla banca, almeno due per lezione, con le opzioni mescolate; le risposte giuste
// restano sul server. Chi non lo supera riprova dopo CORSO_ATTESA_MINUTI, con altre domande.
import { readFileSync } from 'node:fs';
import { randomInt } from 'node:crypto';
import { leggiJson } from './contenuti.js';

const leggi = l => JSON.parse(readFileSync(new URL(`./corso/${l}.json`, import.meta.url), 'utf8'));
const CORSI = { it: leggi('it') };
try { CORSI.en = leggi('en'); } catch (e) { console.error('corso in inglese:', e.message); CORSI.en = CORSI.it; }   // le prove controllano che ci sia e che combaci
export const corsoIn = lingua => CORSI[lingua] || CORSI.it;
export const BANCA = CORSI.it.domande.length;
export const DURATA = 60 * 60e3;   // il tempo per finire un test cominciato

export const difficoltaDi = p => leggiJson(p?.installazione)?.difficolta || null;
// le installazioni confermate: una per cliente (la sua email), senza quelle comprate con l'email di chi installa
const DA_ALTRI = `c.confermato IS NOT NULL AND c.email IS NOT NULL AND lower(c.email) NOT IN (SELECT lower(x.email) FROM utente x WHERE x.id = c.installatore AND x.email IS NOT NULL)`;
export const confermate = (db, id) => db.prepare(`SELECT COUNT(DISTINCT lower(c.email)) n FROM cliente c WHERE c.installatore = ? AND ${DA_ALTRI}`).get(id).n;

// a che punto è un installatore
export function livello(db, cfg, u) {
  const n = confermate(db, u.id);
  return { corso: u.corso || null, punti: u.corso_punti ?? null, esperto: !!u.esperto, confermate: n, servono: cfg.corso.esperienza,
    impegnativi: !!u.esperto || n >= cfg.corso.esperienza };
}

// perché questo installatore non può offrire (né vendere) questo prodotto: 'corso', 'esperienza', o null se può
export function manca(db, cfg, u, p) {
  if (!cfg.corso.obbligatorio) return null;
  if (!u.corso) return 'corso';
  if (difficoltaDi(p) === 'impegnativa' && p.builder !== u.id && !livello(db, cfg, u).impegnativi) return 'esperienza';
  return null;
}

// la stessa regola in SQL, per le liste di chi installa un prodotto (u è l'installatore)
export function filtroAbilitati(cfg, p) {
  if (!cfg.corso.obbligatorio) return { sql: '', par: [] };
  if (difficoltaDi(p) !== 'impegnativa') return { sql: ' AND u.corso IS NOT NULL', par: [] };
  return { sql: ` AND u.corso IS NOT NULL AND (u.id = ? OR u.esperto IS NOT NULL
    OR (SELECT COUNT(DISTINCT lower(c.email)) FROM cliente c WHERE c.installatore = u.id AND ${DA_ALTRI}) >= ?)`, par: [p.builder, cfg.corso.esperienza] };
}

// la stessa regola per le liste su molti prodotti (catalogo, badge, profilo pubblico), con gli alias a (adozione), i (chi installa),
// p (prodotto): il corso, l'esperienza sui programmi impegnativi e il programma partner confermato quando è obbligatorio
export function abilitatiSql(cfg) {
  const programma = ' AND (p.programma_obbligatorio = 0 OR a.programma_accettato IS NOT NULL)';
  if (!cfg.corso.obbligatorio) return { sql: programma, par: [] };
  return { sql: `${programma} AND i.corso IS NOT NULL AND (COALESCE(json_extract(p.installazione, '$.difficolta'), '') != 'impegnativa' OR i.id = p.builder
    OR i.esperto IS NOT NULL OR (SELECT COUNT(DISTINCT lower(c.email)) FROM cliente c WHERE c.installatore = i.id AND ${DA_ALTRI}) >= ?)`, par: [cfg.corso.esperienza] };
}

const mescola = a => { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = randomInt(i + 1); [x[i], x[j]] = [x[j], x[i]]; } return x; };

// le domande di un test: almeno due per lezione, poi a caso fino a n; l'ordine delle opzioni mostrato (ordine[k] = l'opzione originale)
export function estrai(n) {
  const { lezioni, domande } = CORSI.it, scelte = [];
  for (const l of lezioni) scelte.push(...mescola(domande.filter(d => d.lezione === l.id)).slice(0, 2));
  const resto = mescola(domande.filter(d => !scelte.includes(d)));
  return mescola([...scelte.slice(0, n), ...resto].slice(0, n)).map(d => ({ id: d.id, ordine: mescola(d.opzioni.map((_, i) => i)) }));
}

// le domande di un test come le vede chi lo fa, nella sua lingua
export function mostra(estratte, lingua) {
  const c = corsoIn(lingua), per = new Map(c.domande.map(d => [d.id, d]));
  return estratte.map((e, n) => { const d = per.get(e.id); return { n, domanda: d.domanda, opzioni: e.ordine.map(i => d.opzioni[i]) }; });
}

// la correzione: risposte[n] è la posizione scelta fra le opzioni mostrate. Chi sbaglia rilegge la lezione, la risposta giusta non si dice
export function correggi(estratte, risposte, lingua) {
  const c = corsoIn(lingua), per = new Map(CORSI.it.domande.map(d => [d.id, d])), testi = new Map(c.domande.map(d => [d.id, d.domanda]));
  const titoli = new Map(c.lezioni.map(l => [l.id, l.titolo])), errori = [];
  let giuste = 0;
  estratte.forEach((e, n) => {
    const a = risposte?.[n], d = per.get(e.id);
    if (Number.isInteger(a) && a >= 0 && a < e.ordine.length && e.ordine[a] === d.giusta) giuste++;
    else errori.push({ n, domanda: testi.get(e.id), lezione: d.lezione, titolo: titoli.get(d.lezione) });
  });
  return { giuste, totale: estratte.length, errori };
}
