// Le attività per cui un prodotto è consigliato: un vocabolario chiuso (non testo libero) così lo stesso dato serve a tre cose —
// la scheda prodotto («Consigliato per: …»), il confronto fra due prodotti e lo smistamento del «Richiedi l'installazione»
// (il business dice che attività ha, la piattaforma gli propone i prodotti giusti). I tag si salvano in prodotto.attivita (JSON).
export const ATTIVITA = [
  'bar', 'ristorante', 'pizzeria', 'parrucchiere', 'barbiere', 'estetista', 'negozio', 'negozio online', 'alimentari',
  'ferramenta', 'farmacia', 'officina', 'studio professionale', 'studio medico', 'palestra', 'hotel', 'b&b',
  'artigiano', 'agenzia', 'scuola', 'associazione',
];

// il valore predefinito per categoria: quando un prodotto non ha ancora i suoi tag (vetrina curata, prodotti vecchi) si parte da qui,
// e builder o chi gestisce li affinano dal modulo del prodotto
const PER_CATEGORIA = {
  gestionale: ['negozio', 'bar', 'ristorante', 'ferramenta', 'artigiano', 'studio professionale'],
  cassa: ['bar', 'ristorante', 'pizzeria', 'negozio', 'alimentari'],
  prenotazioni: ['parrucchiere', 'barbiere', 'estetista', 'studio medico', 'palestra', 'hotel'],
  sito: ['negozio', 'artigiano', 'studio professionale', 'associazione', 'hotel', 'b&b'],
  ecommerce: ['negozio', 'negozio online', 'artigiano', 'alimentari'],
  magazzino: ['ferramenta', 'negozio', 'alimentari', 'artigiano'],
  contabilità: ['artigiano', 'studio professionale', 'negozio', 'associazione'],
  crm: ['studio professionale', 'agenzia', 'artigiano'],
  comunicazione: ['negozio', 'studio professionale', 'associazione', 'agenzia', 'hotel'],
  sanità: ['studio medico', 'farmacia'],
  ristorazione: ['bar', 'ristorante', 'pizzeria'],
  scuola: ['scuola', 'associazione'],
  altro: [],
};

export const attivitaDi = categoria => PER_CATEGORIA[categoria] ? [...PER_CATEGORIA[categoria]] : [];

// pulisce una lista di tag ricevuta: tiene solo quelli del vocabolario, senza doppioni e al più 6 (una riga di chip leggibile)
export function attivitaPulite(v) {
  if (!Array.isArray(v)) return null;
  const out = [...new Set(v.filter(x => ATTIVITA.includes(x)))].slice(0, 6);
  return out;
}
