// La mappa delle installazioni (/mappa): in quante aziende gira un programma comprato su Repobay, provincia per provincia.
// Solo conteggi: niente nomi, email, indirizzi, né quale programma; i numeri sono quelli veri, anche quando sono zero.
//   un'installazione conta se la vendita vale (gli stessi criteri di venditeDi in soldi.js: pagata, non rimborsata, non il rinnovo
//   di un abbonamento già contato; se cambiano lì, vanno cambiati anche qui) ed è chiusa: il cliente ha confermato l'installazione,
//   lo script d'installazione ha detto «online», oppure sono passati i giorni di trattenuta senza contestazioni aperte (come per i
//   soldi di chi installa, che da lì maturano anche senza conferma)
//   l'azienda è l'email di chi ha comprato: due programmi nella stessa azienda fanno un'azienda sola
//   il luogo è la provincia dove lavora chi ha installato (la zona dell'adozione, o quella del suo profilo): con più province la
//   prima scritta, con una regione intera o «da remoto» nessuna. Senza provincia l'azienda conta nel totale, ma non sulla mappa
import { PROVINCE, zoneDi, normale } from './province.js';

const PER_SIGLA = new Map(PROVINCE.map(p => [p.sigla, p]));
const esc = s => normale(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// dove compare per la prima volta nel testo una provincia (il nome, un altro nome o la sigla fra parentesi): -1 se non c'è
function posizione(testo, p) {
  const t = normale(testo), pos = [p.nome, ...p.alias].map(n => t.search(new RegExp(`(^|[^a-z0-9])${esc(n)}($|[^a-z0-9])`)))
    .concat(String(testo || '').search(new RegExp(`\\(${p.sigla}\\)|^\\s*${p.sigla}\\s*$`))).filter(i => i >= 0);
  return pos.length ? Math.min(...pos) : -1;
}
export function provinciaDi(zona) {
  const z = zoneDi(zona);
  if (z.province.length === 1) return z.province[0];
  let meglio = null, dove = Infinity;
  for (const s of z.province) { const i = posizione(zona, PER_SIGLA.get(s)); if (i >= 0 && i < dove) { meglio = s; dove = i; } }
  return meglio;
}

export function contaInstallazioni(db, { trattenuta = 14 } = {}) {
  const righe = db.prepare(`SELECT c.chiave, lower(trim(c.email)) email, COALESCE(NULLIF(a.zona, ''), u.zona) zona
    FROM cliente c LEFT JOIN adozione a ON a.installatore = c.installatore AND a.prodotto = c.prodotto LEFT JOIN utente u ON u.id = c.installatore
    WHERE c.pagamento != 'in_arrivo'
      AND NOT (c.pagamento = 'insoluto' AND c.chiave NOT LIKE 'cr_%' AND NOT EXISTS (SELECT 1 FROM quota q WHERE q.cliente = c.chiave))
      AND NOT EXISTS (SELECT 1 FROM contestazione k WHERE k.cliente = c.chiave AND k.esito = 'rimborso')
      AND NOT EXISTS (SELECT 1 FROM cliente v WHERE v.riattivato = c.chiave)
      AND (c.confermato IS NOT NULL OR EXISTS (SELECT 1 FROM acquisto x WHERE x.cliente = c.chiave AND x.installazione = 'online')
        OR (julianday(c.creato) <= julianday('now', ?) AND NOT EXISTS (SELECT 1 FROM contestazione k WHERE k.cliente = c.chiave AND k.stato = 'aperta')))
    ORDER BY c.creato, c.chiave`).all(`-${trattenuta} days`);
  // un'azienda, un posto: quello della sua prima installazione che ne ha uno
  const aziende = new Map();
  for (const r of righe) {
    const k = r.email || r.chiave, s = provinciaDi(r.zona || '');
    if (!aziende.has(k)) aziende.set(k, s); else if (!aziende.get(k) && s) aziende.set(k, s);
  }
  const per = new Map();
  for (const s of aziende.values()) if (s) per.set(s, (per.get(s) || 0) + 1);
  const zone = [...per].map(([s, n]) => ({ sigla: s, nome: PER_SIGLA.get(s).nome, regione: PER_SIGLA.get(s).regione, aziende: n }))
    .sort((a, b) => b.aziende - a.aziende || a.nome.localeCompare(b.nome, 'it'));
  return { aziende: aziende.size, installazioni: righe.length, zone, senzaZona: aziende.size - zone.reduce((t, z) => t + z.aziende, 0), giorni: trattenuta, aggiornato: new Date().toISOString() };
}

// per l'endpoint pubblico: lo stesso conteggio per pochi secondi (la pagina aperta lo richiede da sola), così una vendita chiusa
// compare entro un minuto e chi chiama l'endpoint di continuo non rifà la query a ogni richiesta
export const DURATA_MAPPA = 20;   // secondi
export function creaMappa(db, { trattenuta, durata = DURATA_MAPPA * 1e3 } = {}) {
  let memo = null;
  return () => { if (!memo || Date.now() - memo.t > durata) memo = { t: Date.now(), dati: contaInstallazioni(db, { trattenuta }) }; return memo.dati; };
}
