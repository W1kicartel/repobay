// I soldi. Il business paga la piattaforma (Stripe Checkout: l'installazione una volta, l'assistenza ogni mese). A ogni
// fattura pagata, per ogni riga: prima il costo vero di Stripe (letto dalla transazione, diviso fra le righe), poi la parte della
// piattaforma (5% con carta, 1% in crypto), poi il resto si divide:
//   installazione  il prezzo lo decide chi vende; chi sviluppa prende la percentuale che ha scelto (80% se non l'ha scelta) o
//                  quella concordata con chi vende, ridotta dal livello di chi vende (dopo 10 e 25 vendite confermate dello stesso
//                  prodotto); il resto a chi vende. La parte del builder si divide con gli altri owner del repository (in base ai
//                  commit) e con i collaboratori che ha invitato, se ne ha
//   assistenza     risponde chi ha installato, con la piattaforma dietro (ASSISTENZA_PIATTAFORMA, segnato nella vendita): tolto
//                  Stripe, 60% a chi ha installato (QUOTA_INSTALLATORE_ASSISTENZA) e il resto alla piattaforma; a chi sviluppa
//                  QUOTA_SVILUPPATORE_ASSISTENZA (0 per difetto). Le frazioni si fissano alla vendita (qi, qs nei metadati)
//   aggiornamenti  la riga facoltativa di chi sviluppa: tolta la piattaforma, a lui
// Le quote maturano dopo i giorni di trattenuta e si versano con un trasferimento sul conto Stripe di chi le riceve (separate
// charges and transfers: https://docs.stripe.com/connect/separate-charges-and-transfers). Le mance di chi sviluppa a chi vende
// sono pagamenti a parte (Checkout senza fattura), con la loro quota.
// Un rimborso annulla le quote non ancora versate, o le storna (transfer reversal) se erano già partite.
// Le fatture di Stripe hanno cambiato forma nel 2025 (abbonamento e tipo di riga sotto «parent»): si leggono tutte e due.
// I pagamenti che non arrivano (addebito rifiutato, SEPA respinto, tentativi finiti) cambiano cliente.pagamento: l'assistenza va
// avanti per i giorni di grazia, poi si sospende (vedi assistenza.js); chi installa e chi sviluppa lo sanno subito.
import { nuovoAvviso, togliAvvisi, interessati, squadra } from './assistenza.js';

const giorno = 864e5;
const id = v => (v && typeof v === 'object' ? v.id : v) || null;
// la parte per difetto di un importo: prima si toglie l'errore della virgola mobile (660 × 0.35 = 230.99999999999997, cioè 231)
const parteDi = (x, f) => Math.floor(Math.round(x * f * 1e6) / 1e6);

export function abbonamentoDi(f) {
  return id(f.subscription) || id(f.parent?.subscription_details?.subscription) || id(f.subscription_details?.subscription)
    || id(f.lines?.data?.find(l => l.subscription)?.subscription)
    || id(f.lines?.data?.find(l => l.parent?.subscription_item_details)?.parent.subscription_item_details.subscription) || null;
}
export const metadatiDi = f => ({ ...(f.subscription_details?.metadata || {}), ...(f.parent?.subscription_details?.metadata || {}), ...(f.metadata || {}) });
export const ricorrente = l => l.type === 'subscription' || l.parent?.type === 'subscription_item_details' || !!l.price?.recurring || !!l.pricing?.price_details?.price?.recurring;
export const pagamentoDi = f => id(f.payment_intent) || id(f.payments?.data?.[0]?.payment?.payment_intent) || null;
// il PaymentIntent di una fattura: dalla versione 2025-03-31.basil dell'API la fattura non lo porta più e nel webhook manca anche
// «payments» (si chiede a parte), quindi si legge da invoice_payments. Serve alle contestazioni, ai rimborsi dal pannello e al costo
// vero di Stripe. Se Stripe non risponde: null (le contestazioni lo cercano di nuovo con fatturaDi)
export async function pagamentoFattura(stripe, f) {
  const pi = pagamentoDi(f); if (pi || !stripe || !f?.id) return pi;
  try {
    const l = (await stripe.get(`/v1/invoice_payments?invoice=${encodeURIComponent(f.id)}&limit=5`)).data || [];
    return id((l.find(x => x.status === 'paid') || l[0])?.payment?.payment_intent) || null;
  } catch (e) { console.error('pagamento della fattura', f.id, e.message); return null; }
}
// la fattura di un pagamento (da una Charge o da una Dispute, che dal 2025 non la portano più): se le sue quote hanno già il
// PaymentIntent non serve, altrimenti si chiede a invoice_payments
async function fatturaDi(db, stripe, pi, fattura) {
  if (fattura || !pi || db.prepare('SELECT 1 FROM quota WHERE pagamento = ?').get(pi)) return fattura || null;
  return id((await stripe.get(`/v1/invoice_payments?payment[type]=payment_intent&payment[payment_intent]=${encodeURIComponent(pi)}&limit=1`)).data?.[0]?.invoice) || null;
}

// come si divide una riga: prima il costo di Stripe (con carta), poi la parte della piattaforma su quello che resta, poi il resto
// fra installatore (la sua frazione, per difetto) e builder. → {installatore, builder, piattaforma, costo?} in centesimi: piattaforma
// comprende il costo, se c'è (lo paga lei a Stripe), e la somma è sempre la base
export function dividi(base, frazioneInstallatore, frazionePiattaforma, conInstallatore = true, costo = 0) {
  const c = Math.max(0, Math.min(base, Math.round(costo))), piattaforma = c + Math.round((base - c) * frazionePiattaforma);
  const installatore = conInstallatore ? parteDi(base - piattaforma, frazioneInstallatore) : 0;
  return { installatore, piattaforma, builder: base - installatore - piattaforma, ...(c ? { costo: c } : {}) };
}
// la stima del costo di Stripe di un pagamento con carta (per le pagine, prima di pagare): carte europee standard
export const stimaStripe = (cfg, importo) => cfg.costoStripe && importo > 0 ? Math.round(importo * cfg.stimaStripe.percentuale) + cfg.stimaStripe.fisso : 0;
// il costo vero di Stripe di un pagamento, dalla sua transazione (in centesimi); senza (prove, transazione non ancora pronta) la stima.
// Con CARTA_COSTO_STRIPE=0 il costo resta alla piattaforma: 0
export async function costoStripe(stripe, cfg, pagamento, totale) {
  if (!cfg.costoStripe || !(totale > 0)) return 0;
  if (stripe && pagamento) {
    try {
      const pi = await stripe.get(`/v1/payment_intents/${encodeURIComponent(pagamento)}?expand[]=latest_charge.balance_transaction`);
      const fee = pi?.latest_charge?.balance_transaction?.fee;
      if (Number.isInteger(fee) && fee >= 0) return fee;
    } catch (e) { console.error('costo di Stripe di', pagamento, e.message); }   // non si legge: vale la stima, le quote si registrano comunque
  }
  return stimaStripe(cfg, totale);
}
// la parte di chi sviluppa sul canone dell'assistenza (0 se l'azienda di un progetto a uso interno non ha aderito)
export const quotaSviluppatoreAssistenza = (db, cfg, prodotto) => sviluppatoreAssente(db, prodotto) ? 0 : cfg.quotaSviluppatoreAssistenza;
// la parte di chi ha installato sul canone dell'assistenza: risponde lui per primo, la piattaforma tiene il resto
export const quotaInstallatoreAssistenza = (db, cfg, prodotto) => cfg.quotaInstallatoreAssistenza;
// il canone dell'assistenza con la piattaforma dietro: tolto Stripe, qi a chi ha installato, qs a chi sviluppa, il resto alla
// piattaforma (che tiene anche il costo di Stripe). Senza installatore la sua parte resta alla piattaforma
export function dividiCanone(base, qi, qs, conInstallatore = true, costo = 0) {
  if (!conInstallatore) return dividi(base, 0, sei(1 - qs), false, costo);
  const resto = sei(qi + qs);
  return dividi(base, resto > 0 ? sei(qi / resto) : 0, sei(1 - resto), true, costo);
}
// gli aggiornamenti garantiti da chi sviluppa: ci sono se lui ha messo un prezzo, e solo su un progetto rivendicato (p con segnaposto)
export const conAggiornamenti = p => (p?.prezzo_aggiornamenti || 0) > 0 && !p.segnaposto;
// le frazioni arrotondate al milionesimo: 1 - 0.8 fa 0.19999999999999996, e un centesimo si perderebbe nel conto
const sei = x => Math.round(x * 1e6) / 1e6;
// la percentuale di chi sviluppa su quello che resta dopo la piattaforma: quella che ha scelto, o il resto della parte di chi vende
export const percentualeDi = (cfg, p) => (p?.percentuale ?? null) === null ? sei(1 - cfg.quotaInstallatore) : p.percentuale;
// la parte di chi vende un prodotto, prima del livello: tutto se lo sviluppatore non ha aderito (licenza interna), quella concordata
// con chi sviluppa (1:1), altrimenti il resto della percentuale che chi sviluppa ha scelto
export function quotaDi(db, cfg, prodotto, installatore) {
  if (sviluppatoreAssente(db, prodotto)) return 1;
  const a = installatore && db.prepare('SELECT quota FROM adozione WHERE prodotto = ? AND installatore = ?').get(prodotto, installatore);
  if (a?.quota != null) return a.quota;
  const p = db.prepare('SELECT percentuale FROM prodotto WHERE id = ?').get(prodotto);
  return p?.percentuale == null ? cfg.quotaInstallatore : sei(1 - p.percentuale);
}
// le vendite di chi vende per un prodotto: gli acquisti confermati dal cliente, uno per cliente (la sua email), senza quelli rimborsati
// dopo una segnalazione, i primi addebiti mai arrivati e quelli con l'email di chi vende o di chi sviluppa (comprare da sé non fa salire
// di livello). esclusa: l'acquisto che si sta pagando (il livello conta le vendite di prima)
export function venditeDi(db, prodotto, installatore, esclusa = null) {
  if (!prodotto || !installatore) return 0;
  return db.prepare(`SELECT COUNT(DISTINCT lower(c.email)) n FROM cliente c WHERE c.prodotto = ? AND c.installatore = ? AND c.chiave != ? AND c.pagamento != 'in_arrivo'
    AND c.confermato IS NOT NULL AND c.email IS NOT NULL
    AND lower(c.email) NOT IN (SELECT lower(u.email) FROM utente u WHERE u.email IS NOT NULL AND (u.id = c.installatore OR u.id = (SELECT builder FROM prodotto WHERE id = c.prodotto)))
    AND NOT (c.pagamento = 'insoluto' AND c.chiave NOT LIKE 'cr_%' AND NOT EXISTS (SELECT 1 FROM quota q WHERE q.cliente = c.chiave))
    AND NOT EXISTS (SELECT 1 FROM contestazione k WHERE k.cliente = c.chiave AND k.esito = 'rimborso')
    AND NOT EXISTS (SELECT 1 FROM cliente v WHERE v.riattivato = c.chiave)`).get(prodotto, installatore, esclusa || '').n;
}
// il livello di chi vende un prodotto: 0 (base), 1 dopo la prima soglia (10 vendite), 2 dopo la seconda (25). fattore: quanto resta
// della parte di chi sviluppa; prossimo: la soglia dopo e quante vendite mancano
export function livelloDi(db, cfg, prodotto, installatore, esclusa = null) {
  const n = venditeDi(db, prodotto, installatore, esclusa);
  let livello = 0, fattore = 1;
  cfg.livelli.forEach((l, i) => { if (n >= l.da) { livello = i + 1; fattore = l.fattore; } });
  const dopo = cfg.livelli[livello];
  return { vendite: n, livello, fattore, prossimo: dopo ? { livello: livello + 1, da: dopo.da, mancano: dopo.da - n, fattore: dopo.fattore } : null };
}
// il livello riduce la parte di chi sviluppa: con il 15% e il fattore 2/3, chi sviluppa prende il 10% e chi vende il 90%
export const conLivello = (q, fattore = 1) => fattore === 1 ? q : sei(1 - (1 - q) * fattore);
// chi vende ha appena raggiunto un livello con questa vendita: glielo si dice (una volta, alla vendita che fa scattare la soglia)
export function avvisaLivello(db, cfg, notifica, prodotto, installatore) {
  const p = prodotto && installatore && db.prepare('SELECT id, nome, slug, builder, percentuale FROM prodotto WHERE id = ?').get(prodotto);
  if (!p || p.builder === installatore || sviluppatoreAssente(db, p.id)) return;
  const n = venditeDi(db, p.id, installatore), i = cfg.livelli.findIndex(l => l.da === n);
  if (i < 0) return;
  const base = 1 - quotaDi(db, cfg, p.id, installatore), pc = x => Math.round(x * 1000) / 10;
  notifica(installatore, 'livello.nuovo', { prodotto: p.nome, slug: p.slug, vendite: n, livello: i + 1, prima: pc(base * (i ? cfg.livelli[i - 1].fattore : 1)), percentuale: pc(base * cfg.livelli[i].fattore) });
}
// la parte di chi vende per la prossima vendita: accordo o percentuale, con il livello di adesso
export const quotaVendita = (db, cfg, prodotto, installatore) => conLivello(quotaDi(db, cfg, prodotto, installatore), livelloDi(db, cfg, prodotto, installatore).fattore);
// il prezzo dell'installazione di chi vende (chi offriva il prodotto prima che i prezzi fossero suoi parte dal prezzo di riferimento)
export const prezzoAvvioDi = (db, prodotto, installatore) => db.prepare(`SELECT COALESCE(a.prezzo_avvio, p.prezzo_avvio) v FROM adozione a JOIN prodotto p ON p.id = a.prodotto
  WHERE a.prodotto = ? AND a.installatore = ?`).get(prodotto, installatore)?.v ?? db.prepare('SELECT prezzo_avvio v FROM prodotto WHERE id = ?').get(prodotto)?.v ?? 0;
// un prodotto a licenza d'uso interno (n8n, Elastic…) di un'azienda che non ha aderito: si vendono solo installazione e assistenza,
// quindi tutto quello che resta dopo la piattaforma va a chi installa. Se l'azienda aderisce, da lì vale la divisione normale.
export function sviluppatoreAssente(db, prodotto) {
  const r = db.prepare('SELECT p.licenza_tipo, u.segnaposto FROM prodotto p JOIN utente u ON u.id = p.builder WHERE p.id = ?').get(prodotto);
  return !!r && r.licenza_tipo === 'interna' && !!r.segnaposto;
}

// la parte del builder divisa con gli altri (ognuno la sua frazione, per difetto; il resto al builder): gli owner del repository e i
// collaboratori (vedi collaboratoriDi). Vale per i centesimi (Number) e per le unità dei token (BigInt).
export function spartisci(totale, collaboratori = []) {
  const grande = typeof totale === 'bigint';
  const parti = collaboratori.map(c => ({ utente: c.utente, ruolo: c.ruolo || 'collaboratore', importo: grande ? totale * BigInt(Math.round(c.quota * 1e6)) / 1_000_000n : parteDi(totale, c.quota) }));
  return { builder: parti.reduce((r, x) => r - x.importo, totale), collaboratori: parti };
}
// le frazioni per difetto al milionesimo: sommate non superano mai l'intero, così al builder non resta mai meno di zero
const giu = x => Math.floor(x * 1e6 + 1e-9) / 1e6;
const contributiDi = p => { try { return JSON.parse(p?.contributi || 'null') || {}; } catch { return {}; } };
// gli owner di un prodotto (rotte/github.js, «Entra fra gli owner»): chi l'ha rivendicato più chi ha admin o maintain sul repository e
// si è unito. La parte di chi sviluppa si divide fra loro in proporzione ai commit (prodotto.contributi, da GitHub); se nessuno ha
// commit (o non sono ancora stati letti), in parti uguali. → { builder: la frazione di chi l'ha rivendicato, altri: [{utente, quota,
// commit}] }; senza altri owner { builder: 1, altri: [] }
export function titolariDi(db, prodotto) {
  const p = db.prepare('SELECT p.builder, p.contributi, u.github_id FROM prodotto p JOIN utente u ON u.id = p.builder WHERE p.id = ?').get(prodotto);
  const co = p ? db.prepare(`SELECT t.utente, t.github_id FROM cotitolare t JOIN utente u ON u.id = t.utente
    WHERE t.prodotto = ? AND t.stato = 'attivo' AND t.utente != ? AND u.cancellato IS NULL AND u.stato = 'attivo' ORDER BY t.entrato, t.utente`).all(prodotto, p.builder) : [];
  if (!co.length) return { builder: 1, altri: [] };
  const k = contributiDi(p), commit = id => Math.max(0, Number(k[id]) || 0);
  const pesi = [commit(p.github_id), ...co.map(x => commit(x.github_id))], tot = pesi.reduce((s, x) => s + x, 0);
  const fr = pesi.map(w => giu(tot > 0 ? w / tot : 1 / pesi.length));
  return { builder: fr[0], altri: co.map((x, i) => ({ utente: x.utente, quota: fr[i + 1], commit: pesi[i + 1] })), commitBuilder: pesi[0] };
}
// con chi si divide la parte di chi sviluppa, oltre al builder: gli altri owner (ruolo «cotitolare», la loro frazione) e i collaboratori
// che il builder ha invitato (ruolo «collaboratore»: la loro frazione vale sulla parte del builder). → [{utente, quota, ruolo}], quote
// sulla parte di chi sviluppa intera; il resto (spartisci) al builder. Senza altri owner sono i collaboratori di sempre
export function collaboratoriDi(db, prodotto) {
  const t = titolariDi(db, prodotto), owner = new Set(t.altri.map(x => x.utente));
  const coll = db.prepare(`SELECT c.utente, c.quota FROM collaboratore c JOIN utente u ON u.id = c.utente
    WHERE c.prodotto = ? AND c.stato = 'attivo' AND u.cancellato IS NULL ORDER BY c.creato`).all(prodotto).filter(c => !owner.has(c.utente));
  return [...t.altri.map(x => ({ utente: x.utente, quota: x.quota, ruolo: 'cotitolare' })),
    ...coll.map(c => ({ utente: c.utente, quota: t.builder === 1 ? c.quota : giu(c.quota * t.builder), ruolo: 'collaboratore' }))];
}

// l'acquisto fatto dalla cassa (/compra) diventa pagato: il cliente riceve il link della pagina d'installazione (una volta sola).
// Lo stesso per il bonifico e la crypto (rotte/bonifico.js), con il loro cliente
export async function collegaAcquisto(db, cfg, email, codice, chiave, o = {}) {
  const inArrivo = o.payment_status === 'unpaid';
  const a = db.prepare(`UPDATE acquisto SET cliente = ?, sessione = COALESCE(?, sessione), metodo = COALESCE(metodo, 'carta'),
      stato = CASE WHEN ? THEN 'in_arrivo' ELSE 'pagato' END, aggiornato = datetime('now')
    WHERE codice = ? AND stato IN ('aperto', 'prenotato', 'in_arrivo', 'respinto') RETURNING *`).get(chiave, o.id || null, inArrivo ? 1 : 0, codice);
  if (!a) return null;
  db.prepare('UPDATE cliente SET nome = COALESCE(nome, ?), email = COALESCE(email, ?) WHERE chiave = ?').run(a.nome, a.email, chiave);
  const p = db.prepare('SELECT nome FROM prodotto WHERE id = ?').get(a.prodotto), i = db.prepare('SELECT nome FROM utente WHERE id = ?').get(a.installatore);
  if (p) await email(a.email, 'acquisto_pronto', { nome: a.nome || '', prodotto: p.nome, installatore: i?.nome || '', inArrivo, link: `${cfg.url}/installa/${a.codice}` }, { lingua: a.lingua || 'it' }).catch(() => false);
  return a;
}

export async function gestisciEvento(ev, { db, cfg, stripe, notifica = () => {}, email = async () => false }, adesso = Date.now()) {
  if (!ev?.id || !ev.type) return 'evento non valido';
  const nuovo = db.prepare('INSERT OR IGNORE INTO evento (id, tipo) VALUES (?, ?)').run(ev.id, ev.type).changes;
  if (!nuovo) return 'già visto';
  const o = ev.data?.object || {};
  switch (ev.type) {
    case 'checkout.session.completed': {
      if (o.metadata?.mancia) return o.payment_status === 'paid' ? registraMancia(o, { db, cfg, stripe, notifica }, adesso) : 'mancia in arrivo';
      if (o.metadata?.intervento) return o.payment_status === 'paid' ? registraIntervento(o, { db, cfg, notifica }, adesso) : 'intervento in arrivo';
      const chiave = id(o.subscription) || o.id;
      const md = o.metadata || {}, prodotto = Number(md.prodotto) || null, installatore = Number(md.installatore) || null;
      const q = v => (v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
      db.prepare(`INSERT INTO cliente (chiave, prodotto, installatore, quota_avvio, quota_mese, email, nome, sessione, cliente_stripe, aggiornamenti) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT(chiave) DO NOTHING`)
        .run(chiave, prodotto && db.prepare('SELECT 1 FROM prodotto WHERE id = ?').get(prodotto) ? prodotto : null,
          installatore && db.prepare('SELECT 1 FROM utente WHERE id = ?').get(installatore) ? installatore : null,
          q(md.qa), q(md.qm), o.customer_details?.email?.toLowerCase() || null, o.customer_details?.name || null, o.id, id(o.customer), q(md.agm));
      // un addebito SEPA: la sessione è completa ma i soldi arrivano fra qualche giorno (async_payment_succeeded o invoice.paid)
      db.prepare(`UPDATE cliente SET periodo = COALESCE(periodo, ?), pagamento = CASE WHEN ? AND pagamento = 'regolare' THEN 'in_arrivo' ELSE pagamento END WHERE chiave = ?`)
        .run(md.periodo === 'anno' ? 'anno' : o.mode === 'subscription' ? 'mese' : null, o.payment_status === 'unpaid' ? 1 : 0, chiave);
      // una riattivazione (rotte/assistenza.js): stessa installazione, l'abbonamento nuovo prende il posto di quello chiuso
      // (l'avviso del livello nuovo parte quando il cliente conferma l'installazione: solo allora la vendita conta)
      if (md.riattiva) trasferisci(db, String(md.riattiva), chiave, prodotto);
      if (md.acquisto) await collegaAcquisto(db, cfg, email, String(md.acquisto), chiave, o);
      return o.payment_status === 'unpaid' ? 'cliente registrato, pagamento in arrivo' : 'cliente registrato';
    }
    case 'checkout.session.async_payment_succeeded': {
      if (o.metadata?.mancia) return registraMancia(o, { db, cfg, stripe, notifica }, adesso);
      if (o.metadata?.intervento) return registraIntervento(o, { db, cfg, notifica }, adesso);
      const n = db.prepare("UPDATE cliente SET pagamento = 'regolare' WHERE chiave = ? AND pagamento = 'in_arrivo'").run(id(o.subscription) || o.id).changes;
      db.prepare("UPDATE acquisto SET stato = 'pagato', aggiornato = datetime('now') WHERE cliente = ? AND stato = 'in_arrivo'").run(id(o.subscription) || o.id);
      return n ? 'pagamento arrivato' : 'niente da fare';
    }
    case 'checkout.session.async_payment_failed': {   // l'addebito SEPA del primo pagamento è stato respinto: niente installazione
      if (o.metadata?.mancia) { db.prepare("UPDATE mancia SET stato = 'respinta' WHERE id = ? AND stato = 'aperta'").run(Number(o.metadata.mancia)); return 'mancia respinta'; }
      if (o.metadata?.intervento) return 'intervento non pagato';   // la richiesta resta col preventivo: si può pagare di nuovo
      const chiave = id(o.subscription) || o.id;
      const c = db.prepare("UPDATE cliente SET pagamento = 'insoluto', insoluto_dal = COALESCE(insoluto_dal, ?) WHERE chiave = ? RETURNING *").get(new Date(adesso).toISOString(), chiave);
      db.prepare("UPDATE acquisto SET stato = 'respinto', aggiornato = datetime('now') WHERE cliente = ? AND stato = 'in_arrivo'").run(chiave);
      const { p, utenti } = interessati(db, c);
      if (p && nuovoAvviso(db, c.chiave, 'respinto')) for (const u of utenti) notifica(u, 'pagamento.respinto', { prodotto: p.nome, cliente: c.nome });
      return c ? 'primo addebito respinto' : 'cliente sconosciuto';
    }
    case 'invoice.payment_failed': {   // un rinnovo non è andato: Stripe riprova; la grazia parte dal primo fallimento
      if (o.currency && o.currency !== cfg.valuta) return `ignorato: valuta ${o.currency}`;
      const abb = abbonamentoDi(o); const c = abb && db.prepare('SELECT * FROM cliente WHERE chiave = ?').get(abb);
      if (!c) return 'cliente sconosciuto';
      const ora = new Date(adesso).toISOString();
      if (c.pagamento === 'in_arrivo') {   // il primo addebito (SEPA) respinto: l'installazione non è pagata, niente grazia
        db.prepare("UPDATE cliente SET pagamento = 'insoluto', insoluto_dal = COALESCE(insoluto_dal, ?) WHERE chiave = ?").run(ora, abb);
        db.prepare("UPDATE acquisto SET stato = 'respinto', aggiornato = datetime('now') WHERE cliente = ? AND stato = 'in_arrivo'").run(abb);
        const { p, utenti } = interessati(db, c);
        if (p && nuovoAvviso(db, c.chiave, 'respinto')) for (const u of utenti) notifica(u, 'pagamento.respinto', { prodotto: p.nome, cliente: c.nome });
        return 'primo addebito respinto';
      }
      db.prepare(`UPDATE cliente SET pagamento = CASE WHEN pagamento = 'insoluto' THEN 'insoluto' ELSE 'in_ritardo' END, insoluto_dal = COALESCE(insoluto_dal, ?) WHERE chiave = ?`).run(ora, abb);
      if (c.insoluto_dal) return 'pagamento ancora non riuscito';   // i tentativi dopo il primo: già detto a tutti
      const { p, utenti } = interessati(db, c), sospesa = new Date(adesso + cfg.grazia * giorno).toISOString();
      if (p) for (const u of utenti) notifica(u, 'pagamento.fallito', { prodotto: p.nome, cliente: c.nome, sospesa });
      if (c.email && p) await email(c.email, 'pagamento_fallito', { nome: c.nome || '', prodotto: p.nome, importo: o.amount_due || 0, giorni: cfg.grazia, sospesa, link: `${cfg.url}/cliente` });
      return 'pagamento non riuscito';
    }
    case 'customer.subscription.updated': {   // past_due / unpaid dai tentativi di Stripe; la disdetta a fine periodo
      const c = db.prepare('SELECT * FROM cliente WHERE chiave = ?').get(o.id); if (!c) return 'cliente sconosciuto';
      const ora = new Date(adesso).toISOString();
      const fine = o.cancel_at || (o.cancel_at_period_end ? (o.items?.data?.[0]?.current_period_end || o.current_period_end) : null);
      const disdetta = fine ? new Date(fine * 1000).toISOString() : null;
      const pagamento = o.status === 'unpaid' ? 'insoluto' : o.status === 'past_due' ? (c.pagamento === 'insoluto' ? 'insoluto' : 'in_ritardo') : c.pagamento;
      db.prepare('UPDATE cliente SET disdetta = ?, pagamento = ?, insoluto_dal = CASE WHEN ? THEN COALESCE(insoluto_dal, ?) ELSE insoluto_dal END WHERE chiave = ?')
        .run(disdetta, pagamento, pagamento !== c.pagamento && pagamento !== 'regolare' ? 1 : 0, ora, c.chiave);
      const { p, utenti } = interessati(db, c);
      if (p && disdetta && !c.disdetta) for (const u of utenti) notifica(u, 'abbonamento.disdetto', { prodotto: p.nome, cliente: c.nome, fine: disdetta });
      if (p && pagamento === 'insoluto' && c.pagamento !== 'insoluto') for (const u of utenti) notifica(u, 'pagamento.insoluto', { prodotto: p.nome, cliente: c.nome });
      return `abbonamento ${o.status}${disdetta ? ', disdetto' : ''}`;
    }
    case 'invoice.paid': {
      if (o.currency && o.currency !== cfg.valuta) return `ignorato: valuta ${o.currency}`;
      const abb = abbonamentoDi(o), md = metadatiDi(o);
      const cl = abb && db.prepare('SELECT prodotto, installatore, quota_avvio, quota_mese FROM cliente WHERE chiave = ?').get(abb);
      const pid = cl?.prodotto || Number(md.prodotto) || null;
      const p = pid && db.prepare('SELECT * FROM prodotto WHERE id = ?').get(pid);
      if (!p) return 'senza prodotto';
      const iid = cl?.installatore || Number(md.installatore) || null;
      const inst = iid && db.prepare('SELECT id FROM utente WHERE id = ?').get(iid);
      const disponibile = new Date(adesso + cfg.trattenuta * giorno).toISOString(); const pag = await pagamentoFattura(stripe, o);
      // l'acquisto a cui appartengono le quote: l'abbonamento, o per un pagamento unico il cliente registrato dal checkout (stessa email e prodotto)
      const emailCl = (o.customer_email || '').toLowerCase() || null;
      const chiaveCliente = abb || (emailCl && db.prepare('SELECT chiave FROM cliente WHERE prodotto = ? AND email = ? ORDER BY creato DESC LIMIT 1').get(p.id, emailCl)?.chiave) || null;
      const ins = db.prepare(`INSERT OR IGNORE INTO quota (beneficiario, ruolo, prodotto, fattura, riga, tipo, base, frazione, importo, pagamento, abbonamento, disponibile, cliente)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      let n = 0, i = 0; const coll = collaboratoriDi(db, p.id), per = new Map();
      const conta = (u, ruolo, x) => { const k = `${u}:${ruolo}`; per.set(k, { u, ruolo, importo: (per.get(k)?.importo || 0) + x }); };
      let agLibera = !!Number(md.ag), livello = null;   // la riga degli aggiornamenti: quella ricorrente con l'importo fissato alla vendita (una sola)
      // il costo vero di Stripe di questo pagamento, diviso fra le righe in proporzione (l'ultima prende il resto dell'arrotondamento)
      const righe = (o.lines?.data || []).filter(l => (Number(l.amount) || 0) > 0), totale = righe.reduce((s, l) => s + Number(l.amount), 0);
      // quello che il cliente ha pagato davvero: con un credito, il saldo del cliente o uno sconto è meno della somma delle righe, e le
      // quote si fanno sul pagato (ogni riga in proporzione, l'ultima prende il resto dell'arrotondamento). Le righe negative (gli
      // accrediti di un cambio di piano) non danno quote
      const pagato = Number.isInteger(o.amount_paid) && o.amount_paid >= 0 ? Math.min(o.amount_paid, totale) : totale, basi = new Map();
      { let resto = pagato; righe.forEach((l, k) => { const b = k === righe.length - 1 ? resto : Math.round(Number(l.amount) * pagato / totale); basi.set(l, b); resto -= b; }); }
      const costo = await costoStripe(stripe, cfg, pag, pagato); let costoRestante = costo;
      for (const l of o.lines?.data || []) {
        const lorda = Number(l.amount) || 0, riga = l.id || `${o.id}-${i++}`; if (lorda <= 0) continue;
        const base = basi.get(l) || 0; if (base <= 0) continue;
        const c = l === righe[righe.length - 1] ? costoRestante : Math.round(costo * base / pagato); costoRestante -= c;
        let tipo = ricorrente(l) ? 'mese' : 'avvio';
        if (tipo === 'mese' && agLibera && lorda === Number(md.ag) * (Number(l.quantity) || 1)) { tipo = 'aggiornamenti'; agLibera = false; }
        // la riattivazione dell'assistenza (una volta, senza installazione): si divide come il canone
        if (tipo === 'avvio' && md.riattiva && lorda === Number(md.ra)) tipo = 'riattivazione';
        // la parte di chi vende è quella fissata alla vendita (percentuale di chi sviluppa o accordo: un cambio vale per le vendite
        // nuove), con il livello che ha quando arriva il pagamento (le vendite di quel prodotto prima di questa). Sugli aggiornamenti
        // il lavoro è di chi sviluppa: a chi vende la parte degli aggiornamenti fissata alla vendita (0 per difetto). L'assistenza con la
        // piattaforma dietro (ap nella vendita): il canone va a chi ha installato (qi) e alla piattaforma; a chi sviluppa qs, se c'è
        if ((tipo === 'mese' || tipo === 'riattivazione') && md.ap === '1') {
          const qs = md.qs !== undefined && md.qs !== '' ? Number(md.qs) : quotaSviluppatoreAssistenza(db, cfg, p.id);
          const qi = md.qi !== undefined && md.qi !== '' ? Number(md.qi) : quotaInstallatoreAssistenza(db, cfg, p.id);
          const d = dividiCanone(base, qi, qs, !!inst, c), sb = spartisci(d.builder, coll);
          if (d.installatore > 0 && ins.run(inst.id, 'installatore', p.id, o.id, riga, tipo, base, d.installatore / base, d.installatore, pag, abb, disponibile, chiaveCliente).changes) { n++; conta(inst.id, 'installatore', d.installatore); }
          if (sb.builder > 0 && ins.run(p.builder, 'builder', p.id, o.id, riga, tipo, base, sb.builder / base, sb.builder, pag, abb, disponibile, chiaveCliente).changes) { n++; conta(p.builder, 'builder', sb.builder); }
          for (const x of sb.collaboratori) if (x.importo > 0 && ins.run(x.utente, x.ruolo, p.id, o.id, riga, tipo, base, x.importo / base, x.importo, pag, abb, disponibile, chiaveCliente).changes) { n++; conta(x.utente, x.ruolo, x.importo); }
          continue;
        }
        const fissata = tipo === 'aggiornamenti' ? (md.qg ?? cfg.quotaInstallatoreAggiornamenti) : tipo === 'mese' ? (cl?.quota_mese ?? md.qm) : (cl?.quota_avvio ?? md.qa);
        let fi = fissata !== undefined && fissata !== null && fissata !== '' ? Number(fissata) : quotaDi(db, cfg, p.id, inst?.id);
        if (tipo !== 'aggiornamenti' && inst && fi < 1) fi = conLivello(fi, (livello ??= livelloDi(db, cfg, p.id, inst.id, chiaveCliente)).fattore);
        const d = dividi(base, fi, cfg.piattaforma, !!inst, c), sb = spartisci(d.builder, coll);
        if (d.installatore > 0 && ins.run(inst.id, 'installatore', p.id, o.id, riga, tipo, base, d.installatore / base, d.installatore, pag, abb, disponibile, chiaveCliente).changes) { n++; conta(inst.id, 'installatore', d.installatore); }
        if (sb.builder > 0 && ins.run(p.builder, 'builder', p.id, o.id, riga, tipo, base, sb.builder / base, sb.builder, pag, abb, disponibile, chiaveCliente).changes) { n++; conta(p.builder, 'builder', sb.builder); }
        for (const x of sb.collaboratori) if (x.importo > 0 && ins.run(x.utente, x.ruolo, p.id, o.id, riga, tipo, base, x.importo / base, x.importo, pag, abb, disponibile, chiaveCliente).changes) { n++; conta(x.utente, x.ruolo, x.importo); }
      }
      const cliente = (abb && db.prepare('SELECT nome FROM cliente WHERE chiave = ?').get(abb)?.nome) || o.customer_name || null;
      for (const x of per.values()) notifica(x.u, 'vendita.nuova', { prodotto: p.nome, importo: x.importo, ruolo: x.ruolo, cliente, metodo: 'carta', rinnovo: o.billing_reason === 'subscription_cycle', giorni: cfg.trattenuta });
      // pagato: chi era in ritardo torna in regola (e l'assistenza riparte); un addebito SEPA è arrivato
      const prima = chiaveCliente && db.prepare('SELECT * FROM cliente WHERE chiave = ?').get(chiaveCliente);
      if (prima && prima.pagamento !== 'regolare') {
        db.prepare("UPDATE cliente SET pagamento = 'regolare', insoluto_dal = NULL WHERE chiave = ?").run(prima.chiave);
        togliAvvisi(db, prima.chiave, ['sospesa']);
        if (prima.pagamento !== 'in_arrivo') for (const u of interessati(db, prima).utenti) notifica(u, 'pagamento.ripreso', { prodotto: p.nome, cliente: prima.nome });
      }
      return `${n} quote`;
    }
    case 'charge.refunded': {
      const frazione = o.amount ? Math.min(1, (o.amount_refunded || 0) / o.amount) : 1;
      // dal 2025-03-31.basil la Charge non ha più «invoice» e invoice.paid non porta il PaymentIntent: la fattura si cerca in invoice_payments
      const pi = id(o.payment_intent), fattura = await fatturaDi(db, stripe, pi, id(o.invoice));
      const righe = db.prepare('SELECT * FROM quota WHERE (pagamento IS NOT NULL AND pagamento = ?) OR (fattura = ?)').all(pi || '', fattura || '');
      // un rimborso arrivato prima di invoice.paid o della mancia registrata (Stripe non garantisce l'ordine): si rifiuta, così Stripe lo
      // rimanda dopo. Un intervento a chiamata non ha quote (l'incasso è della piattaforma): niente da fare
      if (!righe.length && (fattura || pi)) {
        const md = o.metadata?.intervento || o.metadata?.mancia ? o.metadata : (pi && !fattura ? (await stripe.get(`/v1/payment_intents/${encodeURIComponent(pi)}`).catch(() => null))?.metadata || {} : {});
        if (md.intervento) return 'rimborso di un intervento: nessuna quota';
        if ((fattura || md.mancia) && (!ev.created || adesso / 1000 - ev.created < 3 * 86400)) throw Object.assign(new Error('quote non ancora registrate: Stripe riproverà'), { stato: 503 });
        return 'nessuna quota da stornare';
      }
      let fatto = 0;
      for (const q of righe) {
        const dovuto = Math.round(q.importo * frazione) - q.stornato; if (dovuto <= 0) continue;
        if (q.stato === 'versata' && q.trasferimento) {
          await stripe.post(`/v1/transfers/${q.trasferimento}/reversals`, { amount: dovuto, metadata: { quota: q.id, motivo: 'rimborso' } },
            { idempotenza: `storno-${q.id}-${q.stornato + dovuto}` });
        }
        const stornato = q.stornato + dovuto;
        db.prepare('UPDATE quota SET stornato = ?, stato = ? WHERE id = ?').run(stornato, stornato >= q.importo && q.stato !== 'versata' ? 'annullata' : q.stato, q.id);
        notifica(q.beneficiario, 'rimborso', { prodotto: db.prepare('SELECT nome FROM prodotto WHERE id = ?').get(q.prodotto)?.nome || '', importo: dovuto });
        fatto++;
      }
      return `${fatto} quote stornate`;
    }
    case 'charge.dispute.created': {   // una contestazione: le quote non ancora versate si fermano finché non si chiude
      const pi = id(o.payment_intent), fattura = await fatturaDi(db, stripe, pi, id(o.invoice));
      const n = db.prepare(`UPDATE quota SET ferma_stripe = 1, stato = CASE WHEN stato = 'in_attesa' THEN 'contestata' ELSE stato END
        WHERE (pagamento = ? OR fattura = ?) AND stato IN ('in_attesa', 'contestata')`).run(pi || '', fattura || '').changes;
      return `${n} quote sospese`;
    }
    case 'charge.dispute.closed': {
      const pi = id(o.payment_intent), fattura = await fatturaDi(db, stripe, pi, id(o.invoice));
      db.prepare(`UPDATE quota SET ferma_stripe = 0, stato = CASE WHEN stato = 'contestata' AND ferma_segnalazione = 0 THEN 'in_attesa' ELSE stato END
        WHERE (pagamento = ? OR fattura = ?) AND ferma_stripe = 1`).run(pi || '', fattura || '');
      if (o.status !== 'lost') return 'contestazione vinta';
      // persa: come un rimborso totale (le quote si annullano, quelle già versate si stornano)
      return gestisciEvento({ id: `${ev.id}:persa`, created: ev.created, type: 'charge.refunded', data: { object: { payment_intent: o.payment_intent, invoice: o.invoice, amount: 1, amount_refunded: 1 } } }, { db, cfg, stripe, notifica }, adesso);
    }
    case 'account.updated': {
      const pronto = o.payouts_enabled && o.details_submitted ? 1 : 0;
      db.prepare('UPDATE utente SET stripe_pronto = ? WHERE stripe = ?').run(pronto, o.id);
      return pronto ? 'conto pronto' : 'conto non ancora pronto';
    }
    case 'customer.subscription.deleted': {
      const c = db.prepare("UPDATE cliente SET stato = 'cessato' WHERE chiave = ? RETURNING *").get(o.id);
      const p = c?.prodotto && db.prepare('SELECT nome, builder FROM prodotto WHERE id = ?').get(c.prodotto);
      if (p) for (const u of new Set([c.installatore, p.builder].filter(Boolean))) notifica(u, 'abbonamento.cessato', { prodotto: p.nome, cliente: c.nome });
      return 'abbonamento cessato';
    }
    default: return 'ignorato';
  }
}

// la riattivazione: il codice dell'assistenza (la bolla e la pagina restano quelle), l'indirizzo del programma con i suoi controlli e
// le richieste passano dal cliente chiuso al nuovo; quello chiuso ricorda chi l'ha sostituito (e il nuovo non conta come vendita)
function trasferisci(db, vecchia, nuova, prodotto) {
  const v = db.prepare('SELECT * FROM cliente WHERE chiave = ?').get(vecchia);
  if (!v || v.riattivato || vecchia === nuova || (prodotto && v.prodotto !== prodotto)) return;
  db.prepare('UPDATE cliente SET assistenza = NULL, riattivato = ? WHERE chiave = ?').run(nuova, vecchia);
  db.prepare(`UPDATE cliente SET assistenza = COALESCE(assistenza, ?), sito = ?, sito_stato = ?, sito_dal = ?, sito_controllato = ?, sito_errori = ?, cert_scade = ?,
    rapporto = ?, nome = COALESCE(nome, ?), email = COALESCE(email, ?), installatore = COALESCE(installatore, ?) WHERE chiave = ?`)
    .run(v.assistenza, v.sito, v.sito_stato, v.sito_dal, v.sito_controllato, v.sito_errori || 0, v.cert_scade, v.rapporto, v.nome, v.email, v.installatore, nuova);
  db.prepare('UPDATE richiesta SET cliente = ? WHERE cliente = ?').run(nuova, vecchia);
  db.prepare('UPDATE controllo_sito SET cliente = ? WHERE cliente = ?').run(nuova, vecchia);
}

// un intervento a chiamata pagato (rotte/assistenza.js, senza assistenza attiva): la richiesta torna a chi gestisce la piattaforma,
// che fa il lavoro. Niente quote: il pagamento resta alla piattaforma
function registraIntervento(o, { db, cfg, notifica }, adesso) {
  const r = db.prepare('SELECT * FROM richiesta WHERE id = ?').get(Number(o.metadata.intervento));
  if (!r) return 'intervento sconosciuto';
  if (r.pagata) return 'intervento già registrato';
  const ora = new Date(adesso).toISOString(), importo = Number(o.amount_total) || 0;
  db.prepare("UPDATE richiesta SET pagata = ?, stato = 'aperta', attesa_dal = ?, aggiornata = datetime('now') WHERE id = ?").run(ora, ora, r.id);
  db.prepare("INSERT INTO messaggio (richiesta, chi, nome, testo) VALUES (?, 'piattaforma', ?, ?)")
    .run(r.id, cfg.nome, `Pagamento ricevuto (${(importo / 100).toFixed(2).replace('.', ',')} €): ci mettiamo al lavoro.`);
  const cl = db.prepare('SELECT c.nome, p.nome prodotto FROM cliente c LEFT JOIN prodotto p ON p.id = c.prodotto WHERE c.chiave = ?').get(r.cliente);
  for (const u of squadra(db, cfg)) notifica(u, 'intervento.pagato', { cliente: cl?.nome || '', prodotto: cl?.prodotto || '', titolo: r.titolo, importo });
  return 'intervento pagato';
}

// una mancia pagata: la quota di chi la riceve (tolta la parte della piattaforma), che matura dopo la trattenuta come le altre
async function registraMancia(o, { db, cfg, stripe, notifica }, adesso) {
  const m = db.prepare('SELECT * FROM mancia WHERE id = ?').get(Number(o.metadata.mancia));
  if (!m) return 'mancia sconosciuta';
  if (m.stato === 'pagata') return 'mancia già registrata';
  const base = Number(o.amount_total) || m.importo, d = dividi(base, 1, cfg.piattaforma, true, await costoStripe(stripe, cfg, id(o.payment_intent), base));
  db.prepare(`INSERT OR IGNORE INTO quota (beneficiario, ruolo, prodotto, fattura, riga, tipo, base, frazione, importo, pagamento, disponibile)
    VALUES (?, 'installatore', ?, ?, 'mancia', 'mancia', ?, ?, ?, ?, ?)`)
    .run(m.a, m.prodotto, o.id, base, d.installatore / base, d.installatore, id(o.payment_intent), new Date(adesso + cfg.trattenuta * giorno).toISOString());
  db.prepare("UPDATE mancia SET stato = 'pagata', pagata = ?, sessione = COALESCE(sessione, ?) WHERE id = ?").run(new Date(adesso).toISOString(), o.id, m.id);
  const da = db.prepare('SELECT nome FROM utente WHERE id = ?').get(m.da)?.nome || '', p = m.prodotto && db.prepare('SELECT nome FROM prodotto WHERE id = ?').get(m.prodotto);
  notifica(m.a, 'mancia.ricevuta', { da, prodotto: p?.nome || '', importo: d.installatore, nota: m.nota || null });
  return 'mancia registrata';
}

// versa le quote maturate a chi è attivo, ha il conto Stripe pronto e ha dato i dati fiscali (servono alla comunicazione DAC7
// della piattaforma); un errore resta scritto e si riprova al giro dopo
export async function versaQuote({ db, stripe, cfg, notifica = () => {} }, adesso = Date.now()) {
  db.prepare("UPDATE quota SET stato = 'annullata' WHERE stato = 'in_attesa' AND importo - stornato <= 0").run();
  const da = db.prepare(`SELECT q.*, u.stripe AS conto FROM quota q JOIN utente u ON u.id = q.beneficiario
                         WHERE q.stato = 'in_attesa' AND q.disponibile <= ? AND u.stato = 'attivo' AND u.stripe_pronto = 1 AND u.stripe IS NOT NULL AND u.fiscale IS NOT NULL LIMIT 500`).all(new Date(adesso).toISOString());
  let versate = 0;
  for (const q0 of da) {
    // l'importo si rilegge ora: un rimborso può essere arrivato mentre il giro versava le altre quote
    const q = { ...db.prepare("SELECT * FROM quota WHERE id = ? AND stato = 'in_attesa'").get(q0.id), conto: q0.conto };
    if (!q.id || q.importo - q.stornato <= 0) continue;
    try {
      const t = await stripe.post('/v1/transfers', { amount: q.importo - q.stornato, currency: cfg.valuta, destination: q.conto, transfer_group: q.fattura,
        description: `${cfg.nome}: quota ${q.ruolo} (${q.tipo})`, metadata: { quota: q.id, utente: q.beneficiario, ruolo: q.ruolo, fattura: q.fattura } }, { idempotenza: `quota-${q.id}-${q.stornato}` });
      db.prepare("UPDATE quota SET stato = 'versata', trasferimento = ?, errore = NULL WHERE id = ?").run(t.id, q.id); versate++;
      notifica(q.beneficiario, 'quota.versata', { importo: q.importo - q.stornato });
      const ora = db.prepare('SELECT stornato FROM quota WHERE id = ?').get(q.id).stornato;   // rimborso arrivato durante il trasferimento
      if (ora > q.stornato) await stripe.post(`/v1/transfers/${t.id}/reversals`, { amount: ora - q.stornato, metadata: { quota: q.id, motivo: 'rimborso' } }, { idempotenza: `storno-${q.id}-${ora}` });
    } catch (e) {
      db.prepare('UPDATE quota SET errore = ? WHERE id = ?').run(String(e.message).slice(0, 300), q.id);
    }
  }
  return versate;
}
