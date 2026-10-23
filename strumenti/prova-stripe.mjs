// La prova da capo a fondo con lo Stripe VERO in modalità test: niente soldi veri, niente URL pubblico, niente browser.
//
//   STRIPE_CHIAVE=$(security find-generic-password -s repobay-stripe-test -w) node strumenti/prova-stripe.mjs
//   node strumenti/prova-stripe.mjs --finto     la prova a secco contro il finto Stripe in locale (strumenti/finto-stripe.mjs)
//
// Cosa fa, in ordine:
//   1. accende l'app in questo processo (creaApp, come nei test) con un database temporaneo e una posta finta;
//   2. crea nel database un builder e un installatore (email confermate, dati fiscali di prova), due prodotti pubblicati
//      (uno con l'abbonamento, uno a pagamento unico) e l'adozione;
//   3. crea su Stripe due conti connessi «custom» italiani con i dati di prova ufficiali (nascita 1901-01-01,
//      address_full_match, documento file_identity_document_success, IBAN IT40S0542811101000000123456, tos_acceptance),
//      aspetta che siano pronti (payouts_enabled) e scrive gli id nel database;
//   4. POST /api/checkout per i due prodotti, normale e con STRIPE_PER_CONTO=1: Stripe deve accettare la sessione;
//   5. simula i pagamenti con le API (carta pm_card_bypassPending: i fondi sono subito disponibili, servono per i
//      trasferimenti): una fattura con una voce e i metadata del checkout per il pagamento unico; un abbonamento con le
//      stesse righe (price_data) e i metadata per l'altro;
//   6. legge gli eventi VERI (GET /v1/events) e li inoltra al webhook locale, firmati con un segreto di prova locale;
//   7. controlla le quote, poi versa le quote come se la trattenuta fosse passata: partono trasferimenti veri;
//   8. rimborsa il pagamento unico e controlla gli storni; annulla l'abbonamento;
//   9. stampa il rapporto e si chiude (codice di uscita 0 solo se è andato tutto bene).
// Se Stripe rifiuta un parametro, il rapporto riporta il suo messaggio, il parametro e il link alla documentazione.
// Restano nel conto di prova (per guardarli nella Dashboard): i due conti connessi, il cliente, le fatture, i trasferimenti.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { leggiConfig } from '../server/config.js';
import { apriDb } from '../server/db.js';
import { clienteStripe, firma, modulo } from '../server/stripe.js';
import { clienteGithub } from '../server/github.js';
import { creaApp } from '../server/app.js';
import { versaQuote, dividi, quotaDi, stimaStripe } from '../server/soldi.js';
import { chiaveSegreta, cifra } from '../server/conti.js';
import { controllaFiscale } from '../server/fiscale.js';

const FINTO = process.argv.includes('--finto');
const LIMITE_MINUTI = 8;   // oltre, la prova si ferma da sola
const giorno = 864e5, pausa = ms => new Promise(r => setTimeout(r, ms));
const grassetto = s => process.stdout.isTTY ? `\x1b[1m${s}\x1b[0m` : s;

// ---------------------------------------------------------------- la chiave: solo di prova
let finto = null;
if (FINTO) {
  const { avviaFintoStripe } = await import('./finto-stripe.mjs');
  finto = await avviaFintoStripe();
  process.env.STRIPE_CHIAVE ||= 'sk_test_' + 'finto'.repeat(5);
  process.env.STRIPE_BASE = finto.url;
}
const CHIAVE = process.env.STRIPE_CHIAVE || '';
if (!/^(sk|rk)_test_[A-Za-z0-9]+$/.test(CHIAVE)) {
  console.error(CHIAVE ? 'Rifiutata: la chiave non è di prova. Servono sk_test_… o rk_test_… (mai una chiave live).'
    : 'Manca STRIPE_CHIAVE. Uso:\n  STRIPE_CHIAVE=$(security find-generic-password -s repobay-stripe-test -w) node strumenti/prova-stripe.mjs\n  node strumenti/prova-stripe.mjs --finto   (a secco, senza rete)');
  process.exit(2);
}
const BASE = (process.env.STRIPE_BASE || 'https://api.stripe.com').replace(/\/+$/, '');
const scadenza = setTimeout(() => { console.error(`\nLa prova ha superato ${LIMITE_MINUTI} minuti: mi fermo.`); process.exit(3); }, LIMITE_MINUTI * 60e3);
scadenza.unref();

// ---------------------------------------------------------------- le chiamate a Stripe dello script, con errori chiari
class ErroreStripe extends Error {}
async function api(metodo, percorso, corpo, { idem, conto } = {}) {
  const h = { authorization: `Bearer ${CHIAVE}` };
  if (corpo) h['content-type'] = 'application/x-www-form-urlencoded';
  if (idem) h['idempotency-key'] = idem;
  if (conto) h['stripe-account'] = conto;
  let r;
  try { r = await fetch(BASE + percorso, { method: metodo, headers: h, body: corpo ? modulo(corpo).toString() : undefined, signal: AbortSignal.timeout(40_000) }); }
  catch (e) { throw new ErroreStripe(`${metodo} ${percorso}: Stripe non risponde (${e.cause?.code || e.message})`); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = j.error || {};
    throw new ErroreStripe([`Stripe ha rifiutato ${metodo} ${percorso} (${r.status}${e.type ? ` ${e.type}` : ''}${e.code ? `/${e.code}` : ''})`,
      `messaggio: ${e.message || '(nessuno)'}`, e.param && `parametro: ${e.param}`, e.doc_url && `documentazione: ${e.doc_url}`,
      e.request_log_url && `registro: ${e.request_log_url}`].filter(Boolean).join('\n       '));
  }
  return j;
}
// una lista intera (eventi): al più 10 pagine da 100
async function tutti(percorso, opz) {
  const out = []; let dopo = null;
  for (let i = 0; i < 10; i++) {
    const l = await api('GET', `${percorso}${percorso.includes('?') ? '&' : '?'}limit=100${dopo ? `&starting_after=${dopo}` : ''}`, null, opz);
    out.push(...l.data); if (!l.has_more || !l.data.length) break; dopo = l.data.at(-1).id;
  }
  return out;
}

// ---------------------------------------------------------------- i passi e il rapporto
const esiti = [], creati = [];
class Fermati extends Error {}
async function passo(nome, fn, { critico = false } = {}) {
  const t0 = Date.now();
  console.log(`\n${grassetto('▸ ' + nome)}`);
  try {
    const nota = await fn();
    esiti.push({ nome, ok: true, nota, ms: Date.now() - t0 });
    console.log(`  ok${nota ? `: ${nota}` : ''}`);
    return true;
  } catch (e) {
    const msg = e instanceof ErroreStripe || e instanceof Controllo ? e.message : (e.stack || String(e));
    esiti.push({ nome, ok: false, nota: msg, ms: Date.now() - t0 });
    console.log(`  NO: ${msg}`);
    if (critico) throw new Fermati(nome);
    return false;
  }
}
class Controllo extends Error {}
const atteso = (cond, msg) => { if (!cond) throw new Controllo(msg); };

// ---------------------------------------------------------------- l'app in processo
const SEGRETO = 'whsec_' + randomBytes(24).toString('hex');   // la firma dei webhook: solo locale, Stripe non la conosce
const cartella = mkdtempSync(join(tmpdir(), 'repobay-prova-stripe-'));
const cfg = leggiConfig({ APP_URL: 'http://localhost:4600', APP_DATI: cartella, APP_SEGRETO: randomBytes(32).toString('hex'), APP_LINGUA: 'it',
  STRIPE_CHIAVE: CHIAVE, STRIPE_FIRMA: SEGRETO, STRIPE_BASE: BASE, STRIPE_PAESE: 'IT', STRIPE_PER_CONTO: '0', POSTA_DRIVER: 'console' });
const db = apriDb(cartella);
const posta = { inviate: [], invia: async m => { posta.inviate.push(m); return { id: `finta-${posta.inviate.length}` }; } };
const stripe = clienteStripe(cfg.stripe);
const app = createServer(creaApp(cfg, { db, stripe, github: clienteGithub(cfg.github), posta }));
await new Promise(ok => app.listen(0, '127.0.0.1', ok));
const LOCALE = `http://127.0.0.1:${app.address().port}`;
async function locale(metodo, percorso, corpo, intestazioni = {}) {
  const r = await fetch(LOCALE + percorso, { method: metodo, headers: { ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}), ...intestazioni },
    body: corpo === undefined ? undefined : typeof corpo === 'string' ? corpo : JSON.stringify(corpo), signal: AbortSignal.timeout(60_000) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { stato: r.status, j };
}

// ---------------------------------------------------------------- i dati della prova
const giro = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;   // distingue questa prova dalle altre nel conto Stripe
const T0 = Math.floor(Date.now() / 1000) - 5;
const P = {
  // la divisione con chi installa: 80/20 dopo la piattaforma; per il pagamento unico installatore e builder si sono accordati sul 25%
  abbonamento: { slug: `prova-abb-${giro}`, nome: 'Prova abbonamento', avvio: 5000, mese: 1500, qa: 0.2, qm: 0.2 },
  unico: { slug: `prova-unico-${giro}`, nome: 'Prova pagamento unico', avvio: 4000, mese: 0, qa: 0.25, qm: 0.25, accordo: 0.25 },
};
const U = {};
const inoltrati = new Set(), esitiEventi = [];
const versioni = new Set();

async function inoltra(ev) {
  if (inoltrati.has(ev.id)) return null;
  inoltrati.add(ev.id); versioni.add(ev.api_version);
  const corpo = JSON.stringify(ev);
  const r = await locale('POST', '/api/stripe/webhook', corpo, { 'stripe-signature': firma(corpo, SEGRETO) });
  const esito = r.stato === 200 ? r.j.esito : `ERRORE ${r.stato}: ${r.j?.errore || r.j}`;
  esitiEventi.push({ tipo: ev.type, id: ev.id, esito });
  console.log(`    ${ev.type.padEnd(30)} ${ev.id}  →  ${esito}`);
  return esito;
}
// aspetta (al più `secondi`) che fra gli eventi della prova ci siano quelli voluti; li inoltra in ordine di creazione
async function eventiDa(filtro, voluti, secondi = 60) {
  const fine = Date.now() + secondi * 1000; let trovati = [];
  while (Date.now() < fine) {
    trovati = (await tutti(`/v1/events?created[gte]=${T0}`)).filter(filtro).reverse();
    if (voluti(trovati)) break;
    await pausa(FINTO ? 50 : 3000);
  }
  atteso(voluti(trovati), `dopo ${secondi} s mancano ancora eventi (trovati: ${trovati.map(e => e.type).join(', ') || 'nessuno'})`);
  for (const ev of trovati) await inoltra(ev);
  return trovati;
}
const dellaProva = ev => { const o = ev.data?.object || {}; return o.customer === U.cliente || o.id === U.abbonamento; };
const TIPI = new Set(['checkout.session.completed', 'invoice.paid', 'charge.refunded', 'customer.subscription.deleted', 'account.updated']);

let codiceUscita = 1;
try {
  // ---------------------------------------------------------------- 1. persone e prodotti nel database
  await passo('Builder, installatore e prodotti nel database', async () => {
    const chiave = chiaveSegreta(cfg);
    const nuovo = (nome, email, codice, fiscale) => Number(db.prepare(`INSERT INTO utente (nome, email, codice, contratto, email_verificata, stato, fiscale, fiscale_aggiornato, lingua)
      VALUES (?, ?, ?, datetime('now'), datetime('now'), 'attivo', ?, datetime('now'), 'it')`).run(nome, email, codice, cifra(JSON.stringify(controllaFiscale(fiscale)), chiave)).lastInsertRowid);
    U.builder = nuovo('Prova Builder Srl', `builder+${giro}@example.com`, `prova-b-${giro}`,
      { tipo: 'impresa', nome: 'Prova Builder Srl', codice: '00743110157', partita_iva: '00743110157', via: 'Via Po 2', cap: '20121', citta: 'Milano', provincia: 'MI' });
    U.inst = nuovo('Nico Prova', `installatore+${giro}@example.com`, `prova-i-${giro}`,
      { tipo: 'persona', nome: 'Nico Prova', codice: 'BNCNCI90A01A794X', via: 'Via Roma 1', cap: '24121', citta: 'Bergamo', provincia: 'BG' });
    U.codiceInst = `prova-i-${giro}`;
    db.prepare("UPDATE utente SET corso = datetime('now'), corso_punti = 20 WHERE id = ?").run(U.inst);   // il test del corso superato
    for (const p of Object.values(P)) {
      p.id = Number(db.prepare(`INSERT INTO prodotto (builder, slug, repo, repo_id, url, licenza, nome, descrizione, categoria, guida, prezzo_avvio, prezzo_mese, quota_avvio, quota_mese, stato)
        VALUES (?, ?, ?, ?, ?, 'MIT', ?, 'Prodotto della prova con Stripe', 'altro', 'Guida di prova', ?, ?, ?, ?, 'pubblicato')`)
        .run(U.builder, p.slug, `prova/${p.slug}`, Math.floor(Math.random() * 1e9), `https://github.com/prova/${p.slug}`, p.nome, p.avvio, p.mese, p.qa, p.qm).lastInsertRowid);
      db.prepare("INSERT INTO adozione (installatore, prodotto, zona, quota, accordo) VALUES (?, ?, ?, ?, CASE WHEN ? IS NULL THEN NULL ELSE datetime('now') END)").run(U.inst, p.id, 'Bergamo', p.accordo ?? null, p.accordo ?? null);
    }
    return `builder #${U.builder}, installatore #${U.inst}, prodotti #${P.abbonamento.id} (abbonamento) e #${P.unico.id} (unico)`;
  }, { critico: true });

  // ---------------------------------------------------------------- 2. i conti connessi custom
  const contoDiProva = (ruolo, utente, nome, cognome, citta, cap, provincia) => api('POST', '/v1/accounts', {
    // come un conto Custom, con le proprietà «controller» (il campo «type» è superato): niente pannello, dati raccolti dalla piattaforma,
    // commissioni e perdite a carico della piattaforma (va accettato nel profilo della piattaforma su Stripe)
    controller: { stripe_dashboard: { type: 'none' }, fees: { payer: 'application' }, losses: { payments: 'application' }, requirement_collection: 'application' },
    country: 'IT', email: `${ruolo}+${giro}@example.com`, business_type: 'individual',
    capabilities: { transfers: { requested: true }, card_payments: { requested: true } },   // card_payments serve per on_behalf_of (STRIPE_PER_CONTO)
    business_profile: { mcc: '5734', url: 'https://accessible.stripe.com', product_description: 'Installazione e assistenza di software open source (prova)' },
    individual: {
      first_name: nome, last_name: cognome, email: `${ruolo}+${giro}@example.com`, phone: '0000000000',
      dob: { day: 1, month: 1, year: 1901 },
      address: { line1: 'address_full_match', city: citta, postal_code: cap, state: provincia, country: 'IT' },
      verification: { document: { front: 'file_identity_document_success' } },
    },
    external_account: { object: 'bank_account', country: 'IT', currency: 'eur', account_number: 'IT40S0542811101000000123456', account_holder_name: `${nome} ${cognome}` },
    tos_acceptance: { date: Math.floor(Date.now() / 1000), ip: '8.8.8.8' },
    metadata: { prova: 'repobay', giro, utente },
  }, { idem: `prova-conto-${giro}-${ruolo}` });
  async function pronto(id) {   // al più 90 secondi: in prova la verifica dei dati è asincrona ma veloce
    let a; const fine = Date.now() + 90_000;
    do { a = await api('GET', `/v1/accounts/${id}`); if (a.payouts_enabled && a.capabilities?.transfers === 'active') return a; await pausa(FINTO ? 20 : 3000); } while (Date.now() < fine);
    return a;
  }
  await passo('Conti connessi custom (IT, dati di prova ufficiali)', async () => {
    const b = await contoDiProva('builder', U.builder, 'Bruno', 'Prova', 'Milano', '20121', 'MI'); creati.push(`conto builder ${b.id}`);
    const i = await contoDiProva('installatore', U.inst, 'Nico', 'Prova', 'Bergamo', '24121', 'BG'); creati.push(`conto installatore ${i.id}`);
    U.contoB = b.id; U.contoI = i.id;
    db.prepare('UPDATE utente SET stripe = ? WHERE id = ?').run(b.id, U.builder);
    db.prepare('UPDATE utente SET stripe = ? WHERE id = ?').run(i.id, U.inst);
    const stato = [];
    for (const [u, id] of [[U.builder, b.id], [U.inst, i.id]]) {
      const a = await pronto(id);
      const ok = a.payouts_enabled && a.capabilities?.transfers === 'active';
      stato.push(`${id}: payouts ${a.payouts_enabled ? 'sì' : 'no'}, transfers ${a.capabilities?.transfers}, card_payments ${a.capabilities?.card_payments}`);
      atteso(ok, `il conto ${id} non è pronto dopo 90 s.\n       da dare: ${JSON.stringify(a.requirements?.currently_due || [])}; in verifica: ${JSON.stringify(a.requirements?.pending_verification || [])}; motivo: ${a.requirements?.disabled_reason || '—'}`);
      if (id === i.id) U.carteInst = a.capabilities?.card_payments === 'active';
    }
    return stato.join('\n      ');
  }, { critico: true });

  // l'evento account.updated vero (dagli eventi del conto connesso) deve accendere stripe_pronto nel database
  await passo('account.updated dei conti connessi → stripe_pronto', async () => {
    const note = [], errori = [];
    for (const [u, id] of [[U.builder, U.contoB], [U.inst, U.contoI]]) {
      const ev = (await tutti(`/v1/events?type=account.updated&created[gte]=${T0}`, { conto: id }))[0];   // il più recente
      if (ev) await inoltra({ ...ev, account: ev.account || id });
      const acceso = !!db.prepare('SELECT stripe_pronto FROM utente WHERE id = ?').get(u).stripe_pronto;
      const o = ev?.data?.object || {};
      if (acceso) note.push(`${id}: acceso dall'evento ${ev.id}`);
      else if (!ev) note.push(`${id}: nessun account.updated negli eventi del conto (in produzione arriva dall'endpoint Connect)`);
      else if (o.payouts_enabled && o.details_submitted) errori.push(`${id}: l'evento dice payouts_enabled e details_submitted, ma stripe_pronto è rimasto 0`);
      else note.push(`${id}: evento con payouts_enabled=${o.payouts_enabled}, details_submitted=${o.details_submitted} (i conti custom fatti via API possono non avere details_submitted; i conti Express del server sì)`);
      if (!acceso) db.prepare('UPDATE utente SET stripe_pronto = 1 WHERE id = ?').run(u);   // il conto è pronto (controllato sopra): si va avanti
    }
    atteso(!errori.length, errori.join('\n       '));
    return note.join('\n      ');
  });

  // ---------------------------------------------------------------- 3. il checkout: Stripe deve accettare le sessioni
  for (const perConto of [false, true]) {
    for (const p of [P.abbonamento, P.unico]) {
      await passo(`POST /api/checkout ${p.mese ? 'abbonamento' : 'pagamento unico'}${perConto ? ' con STRIPE_PER_CONTO=1' : ''}`, async () => {
        cfg.stripe.perConto = perConto;   // l'app legge cfg a ogni richiesta
        const r = await locale('POST', '/api/checkout', { prodotto: p.slug, installatore: U.codiceInst });
        atteso(r.stato === 200, `l'app ha risposto ${r.stato}: ${r.j?.errore || JSON.stringify(r.j)}`);
        atteso(/^https:\/\/checkout\.stripe\.com\//.test(r.j.url), `l'indirizzo del checkout è strano: ${r.j.url}`);
        const cs = r.j.url.match(/cs_test_[A-Za-z0-9]+/)?.[0];
        if (cs) await api('POST', `/v1/checkout/sessions/${cs}/expire`, {}).catch(() => {});   // pulizia: la sessione non serve più
        return `sessione accettata${cs ? ` (${cs.slice(0, 24)}…, poi chiusa)` : ''}`;
      });
    }
  }
  cfg.stripe.perConto = false;

  // ---------------------------------------------------------------- 4. i pagamenti, senza browser
  await passo('Cliente con la carta pm_card_bypassPending (fondi subito disponibili)', async () => {
    const c = await api('POST', '/v1/customers', { name: 'Cartoleria Prova', email: `cliente+${giro}@example.com`, metadata: { prova: 'repobay', giro } }, { idem: `prova-cliente-${giro}` });
    U.cliente = c.id; creati.push(`cliente ${c.id}`);
    const pm = await api('POST', '/v1/payment_methods/pm_card_bypassPending/attach', { customer: c.id });
    U.pm = pm.id;
    await api('POST', `/v1/customers/${c.id}`, { invoice_settings: { default_payment_method: pm.id } });
    // una riserva di 50 € sul saldo disponibile: dopo i trasferimenti serve ancora il denaro per il rimborso
    const ris = await api('POST', '/v1/payment_intents', { amount: 5000, currency: 'eur', customer: c.id, payment_method: pm.id, automatic_payment_methods: { enabled: true, allow_redirects: 'never' },   // payment_method_types non esiste più nelle versioni nuove dell'API
      confirm: true, off_session: true, description: `Riserva per il rimborso (prova ${giro})`, metadata: { prova: 'repobay', giro } }, { idem: `prova-riserva-${giro}` });
    atteso(ris.status === 'succeeded', `la riserva è ${ris.status}`);
    return `${c.id}, carta ${pm.id}, riserva ${ris.id}`;
  }, { critico: true });

  const md = p => { const q = quotaDi(db, cfg, p.id, U.inst); return { prodotto: p.id, installatore: U.inst, qa: q, qm: q }; };   // gli stessi metadata del checkout (server/rotte/mercato.js)
  await passo('Pagamento unico: fattura con una voce e i metadata, pagata', async () => {
    const p = P.unico;
    const f = await api('POST', '/v1/invoices', { customer: U.cliente, currency: 'eur', collection_method: 'charge_automatically', auto_advance: false,
      pending_invoice_items_behavior: 'exclude', description: `${p.nome} (prova ${giro})`, metadata: md(p) }, { idem: `prova-fattura-${giro}` });
    U.fatturaUnico = f.id; creati.push(`fattura ${f.id}`);
    await api('POST', '/v1/invoiceitems', { customer: U.cliente, invoice: f.id, amount: p.avvio, currency: 'eur', description: `${p.nome}: installazione` }, { idem: `prova-voce-${giro}` });
    await api('POST', `/v1/invoices/${f.id}/finalize`, { auto_advance: false });
    const pagata = await api('POST', `/v1/invoices/${f.id}/pay`, { payment_method: U.pm });
    atteso(pagata.status === 'paid', `la fattura è ${pagata.status}, non paid`);
    // il PaymentIntent: sulla fattura fino al 2025, poi in invoice_payments (versioni dal 2025-03-31.basil)
    U.piUnico = pagata.payment_intent?.id || pagata.payment_intent
      || (await api('GET', `/v1/invoice_payments?invoice=${f.id}`)).data?.[0]?.payment?.payment_intent || null;
    atteso(U.piUnico, 'non trovo il PaymentIntent della fattura (né su invoice.payment_intent né in /v1/invoice_payments)');
    return `${f.id} pagata ${(pagata.amount_paid / 100).toFixed(2)} €, ${U.piUnico}`;
  });

  await passo('Abbonamento: le stesse righe del checkout (installazione + mese) e i metadata, pagato', async () => {
    const p = P.abbonamento;
    // negli abbonamenti price_data vuole l'id di un Product (product_data c'è solo nel checkout)
    const pa = await api('POST', '/v1/products', { name: `${p.nome}: installazione`, metadata: { prova: 'repobay', giro } }, { idem: `prova-prod-a-${giro}` });
    const pm = await api('POST', '/v1/products', { name: `${p.nome}: assistenza`, metadata: { prova: 'repobay', giro } }, { idem: `prova-prod-m-${giro}` });
    const s = await api('POST', '/v1/subscriptions', {
      customer: U.cliente, default_payment_method: U.pm, payment_behavior: 'error_if_incomplete', metadata: md(p),
      items: [{ quantity: 1, price_data: { currency: 'eur', product: pm.id, unit_amount: p.mese, recurring: { interval: 'month' } } }],
      add_invoice_items: [{ quantity: 1, price_data: { currency: 'eur', product: pa.id, unit_amount: p.avvio } }],
      expand: ['latest_invoice'],
    }, { idem: `prova-abb-${giro}` });
    U.abbonamento = s.id; U.fatturaAbb = typeof s.latest_invoice === 'object' ? s.latest_invoice?.id : s.latest_invoice; creati.push(`abbonamento ${s.id}`, `fattura ${U.fatturaAbb}`);
    atteso(s.status === 'active', `l'abbonamento è ${s.status}, non active`);
    return `${s.id} attivo, prima fattura ${U.fatturaAbb}`;
  });

  // ---------------------------------------------------------------- 5. gli eventi veri → webhook locale
  await passo('Eventi veri da /v1/events inoltrati al webhook locale (invoice.paid)', async () => {
    const fatture = [U.fatturaUnico, U.fatturaAbb].filter(Boolean);
    const l = await eventiDa(ev => TIPI.has(ev.type) && dellaProva(ev),
      tr => fatture.every(f => tr.some(e => e.type === 'invoice.paid' && e.data.object.id === f)));
    const pagate = esitiEventi.filter(e => e.tipo === 'invoice.paid');
    atteso(pagate.every(e => /^\d+ quote$/.test(e.esito)), `invoice.paid non ha dato quote: ${pagate.map(e => e.esito).join(', ')}`);
    return `${l.length} eventi, versione API: ${[...versioni].join(', ')}`;
  });

  // ---------------------------------------------------------------- 6. le quote
  await passo('Le quote giuste (installatore e builder, per ogni riga)', async () => {
    const q = db.prepare('SELECT * FROM quota ORDER BY id').all();
    const attese = [];
    for (const [p, fattura] of [[P.unico, U.fatturaUnico], [P.abbonamento, U.fatturaAbb]]) {
      // il costo di Stripe della fattura (quello del finto Stripe: 1,5% + 0,25 €), diviso fra le righe in proporzione, l'ultima prende il resto
      const righe = [['avvio', p.avvio, p.qa], ['mese', p.mese, p.qm]].filter(([, base]) => base), totale = righe.reduce((s, [, b]) => s + b, 0);
      let resto = stimaStripe(cfg, totale);
      for (const [i, [tipo, base, fi]] of righe.entries()) {
        const costo = i === righe.length - 1 ? resto : Math.round(stimaStripe(cfg, totale) * base / totale); resto -= costo;
        const d = dividi(base, fi, cfg.piattaforma, true, costo);
        attese.push({ fattura, tipo, ruolo: 'installatore', importo: d.installatore, chi: U.inst }, { fattura, tipo, ruolo: 'builder', importo: d.builder, chi: U.builder });
      }
    }
    const errori = [];
    for (const a of attese) {
      const x = q.find(y => y.fattura === a.fattura && y.tipo === a.tipo && y.ruolo === a.ruolo);
      if (!x) errori.push(`manca la quota ${a.ruolo} ${a.tipo} della fattura ${a.fattura}`);
      else if (x.importo !== a.importo || x.beneficiario !== a.chi) errori.push(`quota ${a.ruolo} ${a.tipo}: ${x.importo} centesimi a #${x.beneficiario}, attesi ${a.importo} a #${a.chi}`);
    }
    if (q.length !== attese.length) errori.push(`${q.length} quote nel database, attese ${attese.length}`);
    atteso(!errori.length, errori.join('\n       '));
    const senzaPagamento = q.filter(x => !x.pagamento).length;
    return `${q.length} quote giuste: ${q.map(x => `${x.ruolo} ${x.tipo} ${(x.importo / 100).toFixed(2)} €`).join(', ')}`
      + (senzaPagamento ? `\n      attenzione: ${senzaPagamento} quote senza «pagamento» (il PaymentIntent non è nell'evento invoice.paid: vedi il passo del rimborso)` : '');
  });

  // ---------------------------------------------------------------- 7. versare: trasferimenti veri
  await passo('versaQuote a trattenuta superata → trasferimenti veri sui conti custom', async () => {
    const saldo = await api('GET', '/v1/balance');
    const eur = saldo.available?.find(x => x.currency === 'eur')?.amount ?? 0;
    const dovuto = db.prepare("SELECT COALESCE(SUM(importo - stornato), 0) n FROM quota WHERE stato = 'in_attesa'").get().n;
    console.log(`    saldo disponibile ${(eur / 100).toFixed(2)} €, da versare ${(dovuto / 100).toFixed(2)} €`);
    const n = await versaQuote({ db, stripe, cfg }, Date.now() + (cfg.trattenuta + 1) * giorno);
    const q = db.prepare('SELECT q.*, u.stripe conto FROM quota q JOIN utente u ON u.id = q.beneficiario ORDER BY q.id').all();
    const errori = q.filter(x => x.stato !== 'versata').map(x => `quota #${x.id} (${x.ruolo}) ${x.stato}${x.errore ? `: ${x.errore}` : ''}`);
    for (const x of q.filter(y => y.trasferimento)) {
      const t = await api('GET', `/v1/transfers/${x.trasferimento}`); creati.push(`trasferimento ${t.id}`);
      if (t.amount !== x.importo || (t.destination?.id || t.destination) !== x.conto) errori.push(`${t.id}: ${t.amount} verso ${t.destination}, attesi ${x.importo} verso ${x.conto}`);
    }
    atteso(n === q.length && !errori.length, `${n} versate su ${q.length}\n       ${errori.join('\n       ')}`);
    return `${n} trasferimenti: ${q.map(x => `${x.trasferimento} ${(x.importo / 100).toFixed(2)} €`).join(', ')}`;
  });

  // ---------------------------------------------------------------- 8. rimborso e storni
  await passo('Rimborso vero del pagamento unico → storni dei trasferimenti', async () => {
    atteso(U.piUnico, 'manca il PaymentIntent del pagamento unico');
    const r = await api('POST', '/v1/refunds', { payment_intent: U.piUnico, reason: 'requested_by_customer', metadata: { prova: 'repobay', giro } }, { idem: `prova-rimborso-${giro}` });
    console.log(`    rimborso ${r.id} (${r.status})`);
    await eventiDa(ev => ev.type === 'charge.refunded' && dellaProva(ev), tr => tr.length > 0);
    const q = db.prepare('SELECT * FROM quota WHERE fattura = ?').all(U.fatturaUnico);
    const errori = q.filter(x => x.stornato !== x.importo).map(x => `quota #${x.id} (${x.ruolo}): stornati ${x.stornato} su ${x.importo}`);
    for (const x of q.filter(y => y.trasferimento)) {
      const t = await api('GET', `/v1/transfers/${x.trasferimento}`);
      if (t.amount_reversed !== x.importo) errori.push(`${t.id}: amount_reversed ${t.amount_reversed}, atteso ${x.importo}`);
    }
    if (errori.length && q.every(x => !x.pagamento)) errori.push('PROBABILE CAUSA: con le versioni API dal 2025-03-31.basil la Charge non ha più «invoice» e l\'evento invoice.paid non porta il'
      + ' PaymentIntent («payments» va espanso), quindi quota.pagamento è vuoto e charge.refunded non trova le quote (server/soldi.js, case charge.refunded)');
    atteso(!errori.length, errori.join('\n       '));
    return `${q.length} quote stornate e trasferimenti rovesciati`;
  });

  // ---------------------------------------------------------------- 9. fine dell'abbonamento
  await passo('Annullo l\'abbonamento → customer.subscription.deleted', async () => {
    await api('DELETE', `/v1/subscriptions/${U.abbonamento}`);
    await eventiDa(ev => ev.type === 'customer.subscription.deleted' && dellaProva(ev), tr => tr.length > 0);
    const e = esitiEventi.find(x => x.tipo === 'customer.subscription.deleted');
    atteso(e?.esito === 'abbonamento cessato', `esito: ${e?.esito}`);
    return 'abbonamento annullato, evento gestito';
  });
  codiceUscita = esiti.every(e => e.ok) ? 0 : 1;
} catch (e) {
  if (!(e instanceof Fermati)) { console.error(e); esiti.push({ nome: 'errore imprevisto', ok: false, nota: e.message }); }
} finally {
  // ---------------------------------------------------------------- il rapporto
  const riga = '─'.repeat(78);
  console.log(`\n${riga}\n${grassetto(`Rapporto della prova con Stripe ${FINTO ? 'FINTO (a secco)' : 'vero in modalità test'}`)}  ·  giro ${giro}`);
  if (versioni.size) console.log(`versione API degli eventi: ${[...versioni].join(', ')}`);
  console.log(riga);
  for (const e of esiti) console.log(`${e.ok ? ' ok ' : ' NO '} ${e.nome}${e.ok ? '' : `\n      ${String(e.nota).split('\n').map(s => s.trim()).join('\n      ')}`}`);
  const fatti = esiti.filter(e => e.ok).length;
  console.log(`${riga}\n${fatti} passi su ${esiti.length} riusciti${esiti.length < 15 ? ' (la prova si è fermata prima della fine)' : ''}`);
  if (esitiEventi.length) console.log(`eventi inoltrati al webhook: ${esitiEventi.length} (${[...new Set(esitiEventi.map(e => `${e.tipo} → ${e.esito}`))].join('; ')})`);
  if (creati.length && !FINTO) console.log(`nel conto di prova Stripe (Dashboard, modalità test): ${[...new Set(creati)].join(', ')}`);
  console.log(riga);
  // chiusura pulita: niente processi né file lasciati indietro
  await new Promise(ok => { app.closeAllConnections?.(); app.close(() => ok()); });
  try { db.close(); } catch { }
  rmSync(cartella, { recursive: true, force: true });
  if (finto) await finto.chiudi();
  clearTimeout(scadenza);
  process.exitCode = codiceUscita;
}
