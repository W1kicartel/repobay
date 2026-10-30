// Un finto Stripe in locale per la prova a secco di strumenti/prova-stripe.mjs: risponde a tutte le chiamate dello script
// (conti custom, checkout, clienti, fatture, abbonamenti, eventi, trasferimenti, storni, rimborsi) con le forme dei
// documenti di Stripe. Niente rete, niente chiavi vere, niente soldi.
//   import { avviaFintoStripe } from './finto-stripe.mjs'   →  const f = await avviaFintoStripe(); f.url; f.chiudi()
//   node strumenti/finto-stripe.mjs [porta]                  →  acceso finché non premi Ctrl+C
// Le forme degli oggetti seguono la versione dell'API (FINTO_VERSIONE o { versione }):
//   2025-03-31.basil e successive (predefinita): la fattura non ha payment_intent né charge (i pagamenti sono in
//     «payments», che negli eventi non è espanso), la Charge non ha invoice, le righe hanno «parent»
//   2024-06-20 (o prima): la fattura ha payment_intent e subscription, la Charge ha invoice, le righe hanno «type»
// Controlla anche i parametri che Stripe rifiuterebbe davvero (es. price_data senza product negli abbonamenti), così
// la prova a secco scopre gli stessi errori della prova vera.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const casuale = (prefisso, n = 14) => `${prefisso}_${randomBytes(n).toString('base64url').replace(/[-_]/g, 'x').slice(0, n)}`;
const adesso = () => Math.floor(Date.now() / 1000);

// a[b][0][c]=1 → { a: { b: [ { c: '1' } ] } }
export function daModulo(testo) {
  const out = {};
  for (const [k, v] of new URLSearchParams(testo)) {
    const parti = k.replace(/\]/g, '').split('[');
    let o = out;
    parti.forEach((p, i) => { if (i === parti.length - 1) o[p] = v; else { if (typeof o[p] !== 'object' || o[p] === null) o[p] = {}; o = o[p]; } });
  }
  const liste = o => {
    if (!o || typeof o !== 'object') return o;
    for (const k of Object.keys(o)) o[k] = liste(o[k]);
    const ks = Object.keys(o);
    return ks.length && ks.every((k, i) => k === String(i)) ? ks.map(k => o[k]) : o;
  };
  return liste(out);
}

class Rifiuto extends Error { constructor(messaggio, param, stato = 400, codice) { super(messaggio); Object.assign(this, { param, stato, codice }); } }
const serve = (v, param, cosa = 'Missing required param') => { if (v === undefined || v === null || v === '') throw new Rifiuto(`${cosa}: ${param}.`, param); return v; };
const intero = (v, param) => { const n = Number(serve(v, param)); if (!Number.isInteger(n) || n < 0) throw new Rifiuto(`Invalid integer: ${v}`, param); return n; };

export async function avviaFintoStripe({ porta = 0, versione = process.env.FINTO_VERSIONE || '2025-03-31.basil', registro = null } = {}) {
  const basil = versione >= '2025-03-31';
  const S = { conti: new Map(), clienti: new Map(), metodi: new Map(), prodotti: new Map(), fatture: new Map(), voci: new Map(), abbonamenti: new Map(),
    intenti: new Map(), addebiti: new Map(), trasferimenti: new Map(), sessioni: new Map(), eventi: [], eventiConto: new Map(), disponibile: 0, chiamate: [] };

  const evento = (tipo, oggetto, conto = null) => {
    const ev = { id: casuale('evt', 24), object: 'event', api_version: versione, created: adesso(), type: tipo, livemode: false,
      data: { object: JSON.parse(JSON.stringify(oggetto)) }, pending_webhooks: 0, request: { id: null, idempotency_key: null }, ...(conto ? { account: conto } : {}) };
    if (conto) { if (!S.eventiConto.has(conto)) S.eventiConto.set(conto, []); S.eventiConto.get(conto).push(ev); } else S.eventi.push(ev);
  };

  // ---------------- le forme degli oggetti, secondo la versione
  const vistaFattura = f => {
    const base = { id: f.id, object: 'invoice', currency: f.currency, customer: f.customer, status: f.status, metadata: f.metadata, amount_due: f.totale, amount_paid: f.status === 'paid' ? f.totale : 0,
      total: f.totale, subtotal: f.totale, customer_email: S.clienti.get(f.customer)?.email || null, customer_name: S.clienti.get(f.customer)?.name || null, on_behalf_of: f.on_behalf_of || null,
      collection_method: 'charge_automatically', created: f.created, livemode: false };
    const righe = f.righe.map(r => basil
      ? { id: r.id, object: 'line_item', amount: r.amount, currency: f.currency, description: r.description, metadata: {},
          parent: r.abbonamento ? { type: 'subscription_item_details', subscription_item_details: { subscription: r.abbonamento, subscription_item: r.voce, proration: false }, invoice_item_details: null }
            : { type: 'invoice_item_details', invoice_item_details: { invoice_item: r.voce, proration: false, subscription: f.abbonamento || null }, subscription_item_details: null },
          pricing: { type: 'price_details', price_details: { price: r.prezzo, product: r.prodotto || null }, unit_amount_decimal: String(r.amount) }, quantity: 1 }
      : { id: r.id, object: 'line_item', amount: r.amount, currency: f.currency, description: r.description, metadata: {}, type: r.abbonamento ? 'subscription' : 'invoiceitem',
          subscription: r.abbonamento || null, price: { id: r.prezzo, recurring: r.abbonamento ? { interval: 'month', interval_count: 1 } : null, unit_amount: r.amount }, quantity: 1 });
    const lines = { object: 'list', data: righe, has_more: false, total_count: righe.length, url: `/v1/invoices/${f.id}/lines` };
    if (basil) return { ...base, lines, parent: f.abbonamento ? { type: 'subscription_details', quote_details: null, subscription_details: { subscription: f.abbonamento, metadata: S.abbonamenti.get(f.abbonamento)?.metadata || {} } } : null };
    return { ...base, lines, subscription: f.abbonamento || null, subscription_details: f.abbonamento ? { metadata: S.abbonamenti.get(f.abbonamento)?.metadata || {} } : null,
      payment_intent: f.intento || null, charge: f.addebito || null, paid: f.status === 'paid' };
  };
  const vistaAddebito = c => ({ id: c.id, object: 'charge', amount: c.amount, amount_captured: c.amount, amount_refunded: c.rimborsato, refunded: c.rimborsato >= c.amount, currency: c.currency,
    customer: c.customer, payment_intent: c.intento, paid: true, status: 'succeeded', on_behalf_of: c.on_behalf_of || null, balance_transaction: casuale('txn'), metadata: c.metadata || {},
    ...(basil ? {} : { invoice: c.fattura || null }) });
  const vistaConto = a => ({ id: a.id, object: 'account', type: a.type, country: a.country, email: a.email, business_type: a.business_type, details_submitted: a.pronto, charges_enabled: a.pronto && a.carte,
    payouts_enabled: a.pronto, capabilities: Object.fromEntries(Object.keys(a.capacita).map(k => [k, a.pronto ? 'active' : 'pending'])),
    requirements: { currently_due: [], eventually_due: [], past_due: [], pending_verification: a.pronto ? [] : ['individual.verification.document'], disabled_reason: a.pronto ? null : 'requirements.pending_verification' },
    tos_acceptance: a.tos, metadata: a.metadata || {}, external_accounts: { object: 'list', data: [{ id: casuale('ba'), object: 'bank_account', country: 'IT', currency: 'eur', last4: '3456' }] } });
  const vistaAbbonamento = (s, espandi = []) => ({ id: s.id, object: 'subscription', customer: s.customer, status: s.status, metadata: s.metadata, on_behalf_of: s.on_behalf_of || null,
    default_payment_method: s.default_payment_method || null, currency: 'eur', created: s.created,
    items: { object: 'list', data: s.voci.map(v => ({ id: v.id, object: 'subscription_item', price: { id: v.prezzo, product: v.prodotto, unit_amount: v.amount, recurring: { interval: 'month' } }, quantity: 1 })) },
    latest_invoice: espandi.includes('latest_invoice') ? vistaFattura(S.fatture.get(s.ultima)) : s.ultima });

  // ---------------- pagare una fattura: PaymentIntent + Charge, fondi disponibili subito con pm_card_bypassPending
  function paga(f, metodo) {
    const pm = S.metodi.get(metodo);
    if (!pm || pm.customer !== f.customer) throw new Rifiuto(`The PaymentMethod ${metodo} does not belong to the Customer ${f.customer}.`, 'payment_method');
    if (f.totale <= 0) throw new Rifiuto('Invoice total must be positive', 'invoice');
    const pi = { id: casuale('pi', 24), object: 'payment_intent', amount: f.totale, currency: f.currency, customer: f.customer, status: 'succeeded', payment_method: pm.id, on_behalf_of: f.on_behalf_of || null };
    const ch = { id: casuale('ch', 24), amount: f.totale, rimborsato: 0, currency: f.currency, customer: f.customer, intento: pi.id, fattura: f.id, on_behalf_of: f.on_behalf_of || null };
    pi.latest_charge = ch.id; S.intenti.set(pi.id, pi); S.addebiti.set(ch.id, ch);
    if (pm.disponibile) S.disponibile += f.totale;
    Object.assign(f, { status: 'paid', intento: pi.id, addebito: ch.id });
    evento('charge.succeeded', vistaAddebito(ch)); evento('payment_intent.succeeded', { ...pi, ...(basil ? {} : { invoice: f.id }) });
    evento('invoice.paid', vistaFattura(f)); evento('invoice.payment_succeeded', vistaFattura(f));
  }

  // ---------------- le rotte
  const rotte = [
    ['POST', /^\/v1\/accounts$/, (b) => {
      if (!['custom', 'express', 'standard'].includes(b.type) && !b.controller) throw new Rifiuto('Invalid type: must be one of custom, express, or standard', 'type');
      serve(b.country, 'country');
      if (b.type === 'custom') {
        const ind = b.individual || {};
        if (!b.tos_acceptance?.date || !b.tos_acceptance?.ip) throw new Rifiuto('For custom accounts, tos_acceptance[date] and tos_acceptance[ip] are required to enable payouts.', 'tos_acceptance');
        if (!ind.dob?.year) throw new Rifiuto('Missing required param: individual[dob].', 'individual[dob]');
        if (!/^[A-Z]{2}\d\d[A-Z0-9]{11,30}$/.test(b.external_account?.account_number || '')) throw new Rifiuto('Invalid IBAN', 'external_account[account_number]');
      }
      const caps = b.capabilities || {};
      if (!Object.keys(caps).length) throw new Rifiuto('You must request at least one capability.', 'capabilities');
      const a = { id: casuale('acct', 16), type: b.type || 'custom', country: b.country, email: b.email, business_type: b.business_type, capacita: caps, carte: !!caps.card_payments,
        tos: b.tos_acceptance || null, metadata: b.metadata, pronto: false, letture: 0 };
      S.conti.set(a.id, a); evento('account.updated', vistaConto(a), a.id);
      return vistaConto(a);
    }],
    ['GET', /^\/v1\/accounts\/(acct_\w+)$/, (b, [id]) => {
      const a = S.conti.get(id); if (!a) throw new Rifiuto(`No such account: '${id}'`, 'account', 404, 'resource_missing');
      // come Stripe in prova: la verifica (1901-01-01, address_full_match, documento di prova) finisce dopo un attimo
      if (!a.pronto && ++a.letture >= 2 && a.type === 'custom') { a.pronto = true; evento('account.updated', vistaConto(a), a.id); }
      return vistaConto(a);
    }],
    ['POST', /^\/v1\/account_links$/, (b) => {
      if (!S.conti.get(serve(b.account, 'account'))) throw new Rifiuto(`No such account: '${b.account}'`, 'account');
      serve(b.refresh_url, 'refresh_url'); serve(b.return_url, 'return_url');
      return { object: 'account_link', created: adesso(), expires_at: adesso() + 300, url: `https://connect.stripe.com/setup/e/${b.account}/${casuale('x', 12)}` };
    }],
    // la sessione dei componenti incorporati: solo per un conto connesso e con almeno un componente acceso
    ['POST', /^\/v1\/account_sessions$/, (b) => {
      if (!S.conti.get(serve(b.account, 'account'))) throw new Rifiuto(`No such account: '${b.account}'`, 'account');
      // una chiave limitata senza il permesso «Account Sessions» (come quella live fino al 30/10/2026): le prove lo accendono a mano
      if (S.sessioniNegate) throw new Rifiuto('Permission denied. The provided key does not have the required permissions for this endpoint. Enabling Account Sessions Write (\'account_session_write\') permissions on this key would allow this request to continue.', null, 403, 'more_permissions_required');
      const accesi = Object.entries(b.components || {}).filter(([, v]) => v?.enabled === 'true' || v?.enabled === true);
      if (!accesi.length) throw new Rifiuto('You must enable at least one component.', 'components');
      const id = casuale('accs', 16);
      return { object: 'account_session', account: b.account, client_secret: `${id}_secret_${casuale('x', 24).slice(2)}`, expires_at: adesso() + 1800, livemode: false,
        components: Object.fromEntries(accesi.map(([k, v]) => [k, { enabled: true, features: v.features || {} }])) };
    }],
    ['POST', /^\/v1\/checkout\/sessions$/, (b) => {
      if (!['payment', 'subscription', 'setup'].includes(b.mode)) throw new Rifiuto('Invalid mode', 'mode');
      if (!Array.isArray(b.line_items) || !b.line_items.length) throw new Rifiuto('Missing required param: line_items.', 'line_items');
      serve(b.success_url, 'success_url');
      b.line_items.forEach((l, i) => { serve(l.price_data?.currency, `line_items[${i}][price_data][currency]`); intero(l.price_data?.unit_amount, `line_items[${i}][price_data][unit_amount]`);
        if (!l.price_data?.product && !l.price_data?.product_data?.name) throw new Rifiuto('Missing required param: line_items[][price_data][product_data][name].', `line_items[${i}][price_data][product_data][name]`); });
      const ricorrenti = b.line_items.some(l => l.price_data?.recurring);
      if (b.mode === 'payment' && ricorrenti) throw new Rifiuto('You must be in `subscription` mode to use recurring prices.', 'line_items');
      if (b.mode === 'subscription' && !ricorrenti) throw new Rifiuto('You must provide at least one recurring price in `subscription` mode when using prices.', 'line_items');
      if (b.mode === 'subscription' && (b.customer_creation || b.invoice_creation || b.payment_intent_data)) throw new Rifiuto('customer_creation, invoice_creation and payment_intent_data can only be used in `payment` mode.', 'mode');
      const obo = b.subscription_data?.on_behalf_of || b.payment_intent_data?.on_behalf_of;
      if (obo) { const a = S.conti.get(obo); if (!a) throw new Rifiuto(`No such destination: '${obo}'`, 'on_behalf_of');
        if (!(a.pronto && a.carte)) throw new Rifiuto(`The account ${obo} must have the card_payments capability active to be used with on_behalf_of.`, 'on_behalf_of'); }
      const s = { id: casuale('cs_test', 40), object: 'checkout.session', mode: b.mode, status: 'open', metadata: b.metadata || {} };
      s.url = `https://checkout.stripe.com/c/pay/${s.id}#finto`; S.sessioni.set(s.id, s); return s;
    }],
    ['POST', /^\/v1\/checkout\/sessions\/(cs_test_\w+)\/expire$/, (b, [id]) => { const s = S.sessioni.get(id); if (!s) throw new Rifiuto(`No such checkout.session: '${id}'`, 'session', 404); s.status = 'expired'; return s; }],
    ['POST', /^\/v1\/customers$/, (b) => { const c = { id: casuale('cus'), object: 'customer', email: b.email || null, name: b.name || null, metadata: b.metadata || {}, invoice_settings: {} }; S.clienti.set(c.id, c); return c; }],
    ['POST', /^\/v1\/customers\/(cus_\w+)$/, (b, [id]) => {
      const c = S.clienti.get(id); if (!c) throw new Rifiuto(`No such customer: '${id}'`, 'id', 404);
      const pm = b.invoice_settings?.default_payment_method; if (pm && S.metodi.get(pm)?.customer !== id) throw new Rifiuto(`No such PaymentMethod: '${pm}'`, 'invoice_settings[default_payment_method]');
      c.invoice_settings = { default_payment_method: pm || null }; return c;
    }],
    ['POST', /^\/v1\/payment_methods\/(pm_\w+)\/attach$/, (b, [id]) => {
      const c = S.clienti.get(serve(b.customer, 'customer')); if (!c) throw new Rifiuto(`No such customer: '${b.customer}'`, 'customer');
      if (!/^pm_card_/.test(id)) throw new Rifiuto(`No such PaymentMethod: '${id}'`, 'payment_method', 404);
      const pm = { id: casuale('pm', 24), object: 'payment_method', type: 'card', customer: c.id, disponibile: /bypassPending/.test(id), card: { brand: 'visa', last4: /bypassPending/.test(id) ? '0077' : '4242' } };
      S.metodi.set(pm.id, pm); return { ...pm, disponibile: undefined };
    }],
    ['POST', /^\/v1\/payment_intents$/, (b) => {
      const amount = intero(b.amount, 'amount'); serve(b.currency, 'currency');
      const pm = S.metodi.get(b.payment_method); if (b.payment_method && !pm) throw new Rifiuto(`No such PaymentMethod: '${b.payment_method}'`, 'payment_method');
      if (pm && b.customer && pm.customer !== b.customer) throw new Rifiuto(`The PaymentMethod ${pm.id} does not belong to the Customer ${b.customer}.`, 'payment_method');
      if (b.confirm === 'true' && !b.return_url && !b.payment_method_types && b.automatic_payment_methods?.allow_redirects !== 'never')
        throw new Rifiuto('This PaymentIntent is configured to accept payment methods enabled in your Dashboard. Because some of these payment methods might redirect your customer off of your page, you must provide a `return_url`.', 'return_url');
      const pi = { id: casuale('pi', 24), object: 'payment_intent', amount, currency: b.currency, customer: b.customer || null, status: b.confirm === 'true' && pm ? 'succeeded' : 'requires_confirmation', payment_method: pm?.id || null, metadata: b.metadata || {} };
      if (pi.status === 'succeeded') {
        const ch = { id: casuale('ch', 24), amount, rimborsato: 0, currency: b.currency, customer: pi.customer, intento: pi.id, fattura: null, metadata: b.metadata };
        pi.latest_charge = ch.id; S.addebiti.set(ch.id, ch); if (pm.disponibile) S.disponibile += amount;
        evento('charge.succeeded', vistaAddebito(ch)); evento('payment_intent.succeeded', pi);
      }
      S.intenti.set(pi.id, pi); return pi;
    }],
    ['POST', /^\/v1\/products$/, (b) => { const p = { id: casuale('prod'), object: 'product', name: serve(b.name, 'name') }; S.prodotti.set(p.id, p); return p; }],
    ['POST', /^\/v1\/invoices$/, (b) => {
      const c = S.clienti.get(serve(b.customer, 'customer')); if (!c) throw new Rifiuto(`No such customer: '${b.customer}'`, 'customer');
      if (b.on_behalf_of && !S.conti.get(b.on_behalf_of)) throw new Rifiuto(`No such account: '${b.on_behalf_of}'`, 'on_behalf_of');
      const f = { id: casuale('in', 24), customer: c.id, currency: b.currency || 'eur', status: 'draft', metadata: b.metadata || {}, righe: [], totale: 0, on_behalf_of: b.on_behalf_of, created: adesso() };
      S.fatture.set(f.id, f); return vistaFattura(f);
    }],
    ['POST', /^\/v1\/invoiceitems$/, (b) => {
      const f = b.invoice && S.fatture.get(b.invoice); if (b.invoice && !f) throw new Rifiuto(`No such invoice: '${b.invoice}'`, 'invoice');
      if (f && f.status !== 'draft') throw new Rifiuto('You can only add invoice items to draft invoices.', 'invoice');
      if (b.price || b.unit_amount) throw new Rifiuto('Received unknown parameter: ' + (b.price ? 'price' : 'unit_amount'), b.price ? 'price' : 'unit_amount');
      const amount = intero(b.amount, 'amount'); serve(b.currency, 'currency');
      const v = { id: casuale('ii', 24), object: 'invoiceitem', amount, currency: b.currency, customer: b.customer, invoice: f?.id || null, description: b.description || null, metadata: b.metadata || {} };
      S.voci.set(v.id, v);
      if (f) { f.righe.push({ id: casuale('il', 24), amount, description: v.description, voce: v.id, prezzo: casuale('price') }); f.totale += amount; }
      return v;
    }],
    ['POST', /^\/v1\/invoices\/(in_\w+)\/finalize$/, (b, [id]) => { const f = S.fatture.get(id); if (!f) throw new Rifiuto(`No such invoice: '${id}'`, 'invoice', 404);
      if (f.status !== 'draft') throw new Rifiuto('This invoice is already finalized.', 'invoice'); f.status = 'open'; evento('invoice.finalized', vistaFattura(f)); return vistaFattura(f); }],
    ['POST', /^\/v1\/invoices\/(in_\w+)\/pay$/, (b, [id]) => { const f = S.fatture.get(id); if (!f) throw new Rifiuto(`No such invoice: '${id}'`, 'invoice', 404);
      if (f.status !== 'open') throw new Rifiuto(`Invoice is ${f.status}: only open invoices can be paid.`, 'invoice'); paga(f, serve(b.payment_method, 'payment_method')); return vistaFattura(f); }],
    ['GET', /^\/v1\/invoices\/(in_\w+)$/, (b, [id]) => { const f = S.fatture.get(id); if (!f) throw new Rifiuto(`No such invoice: '${id}'`, 'invoice', 404); return vistaFattura(f); }],
    // il PaymentIntent con l'addebito e la sua transazione espansi: la commissione è quella delle carte europee standard
    // (1,5% + 0,25 €, la stessa stima di STRIPE_STIMA_*), così la prova controlla anche il costo vero diviso fra le righe
    ['GET', /^\/v1\/payment_intents\/(pi_\w+)$/, (b, [id]) => {
      const pi = S.intenti.get(id); if (!pi) throw new Rifiuto(`No such payment_intent: '${id}'`, 'id', 404);
      const ch = S.addebiti.get(pi.latest_charge);
      return { ...pi, latest_charge: ch ? { id: ch.id, object: 'charge', amount: ch.amount, balance_transaction: { id: `txn_${ch.id.slice(3)}`, object: 'balance_transaction', fee: Math.round(ch.amount * 0.015) + 25 } } : pi.latest_charge };
    }],
    ['GET', /^\/v1\/invoice_payments$/, (b) => {
      const f = S.fatture.get(b.invoice) || [...S.fatture.values()].find(x => x.intento === b.payment?.payment_intent);
      return { object: 'list', has_more: false, data: f?.intento ? [{ id: casuale('inpay'), object: 'invoice_payment', invoice: f.id, status: 'paid', amount_paid: f.totale, payment: { type: 'payment_intent', payment_intent: f.intento } }] : [] };
    }],
    ['POST', /^\/v1\/subscriptions$/, (b) => {
      const c = S.clienti.get(serve(b.customer, 'customer')); if (!c) throw new Rifiuto(`No such customer: '${b.customer}'`, 'customer');
      if (!Array.isArray(b.items) || !b.items.length) throw new Rifiuto('Missing required param: items.', 'items');
      const prezzo = (pd, param, ricorrente) => {
        if (!pd) throw new Rifiuto(`Missing required param: ${param}.`, param);
        if (pd.product_data) throw new Rifiuto(`Received unknown parameter: ${param}[product_data]. Did you mean product?`, `${param}[product_data]`);
        if (!S.prodotti.has(pd.product)) throw new Rifiuto(`No such product: '${pd.product}'`, `${param}[product]`);
        if (ricorrente && !pd.recurring?.interval) throw new Rifiuto(`Missing required param: ${param}[recurring].`, `${param}[recurring]`);
        serve(pd.currency, `${param}[currency]`); return intero(pd.unit_amount, `${param}[unit_amount]`);
      };
      const pm = b.default_payment_method || c.invoice_settings?.default_payment_method;
      if (!pm) throw new Rifiuto('This customer has no attached payment source or default payment method.', 'default_payment_method');
      if (b.on_behalf_of && !S.conti.get(b.on_behalf_of)) throw new Rifiuto(`No such account: '${b.on_behalf_of}'`, 'on_behalf_of');
      const s = { id: casuale('sub', 24), customer: c.id, status: 'incomplete', metadata: b.metadata || {}, on_behalf_of: b.on_behalf_of, default_payment_method: b.default_payment_method, voci: [], created: adesso() };
      S.abbonamenti.set(s.id, s);
      const f = { id: casuale('in', 24), customer: c.id, currency: 'eur', status: 'open', metadata: {}, righe: [], totale: 0, abbonamento: s.id, on_behalf_of: b.on_behalf_of, created: adesso() };
      b.items.forEach((it, i) => { const amount = prezzo(it.price_data, `items[${i}][price_data]`, true); const v = { id: casuale('si'), prezzo: casuale('price'), prodotto: it.price_data.product, amount };
        s.voci.push(v); f.righe.push({ id: casuale('il', 24), amount, description: `1 × ${S.prodotti.get(v.prodotto).name}`, abbonamento: s.id, voce: v.id, prezzo: v.prezzo, prodotto: v.prodotto }); f.totale += amount; });
      (b.add_invoice_items || []).forEach((it, i) => { const amount = prezzo(it.price_data, `add_invoice_items[${i}][price_data]`, false);
        if (it.price_data.recurring) throw new Rifiuto('add_invoice_items only accepts one-time prices.', `add_invoice_items[${i}][price_data][recurring]`);
        f.righe.push({ id: casuale('il', 24), amount, description: S.prodotti.get(it.price_data.product).name, voce: casuale('ii', 24), prezzo: casuale('price'), prodotto: it.price_data.product }); f.totale += amount; });
      S.fatture.set(f.id, f); s.ultima = f.id;
      evento('customer.subscription.created', vistaAbbonamento(s)); evento('invoice.finalized', vistaFattura(f));
      try { paga(f, pm); s.status = 'active'; } catch (e) { if (b.payment_behavior === 'error_if_incomplete') { S.abbonamenti.delete(s.id); throw new Rifiuto(e.message, e.param, 402, 'card_declined'); } }
      evento('customer.subscription.updated', vistaAbbonamento(s));
      return vistaAbbonamento(s, [].concat(b.expand || []));
    }],
    ['DELETE', /^\/v1\/subscriptions\/(sub_\w+)$/, (b, [id]) => { const s = S.abbonamenti.get(id); if (!s) throw new Rifiuto(`No such subscription: '${id}'`, 'id', 404);
      s.status = 'canceled'; evento('customer.subscription.deleted', vistaAbbonamento(s)); return vistaAbbonamento(s); }],
    ['GET', /^\/v1\/events$/, (b, m, req) => {
      const conto = req.headers['stripe-account'];
      let l = [...(conto ? S.eventiConto.get(conto) || [] : S.eventi)].reverse();   // dal più nuovo, come Stripe
      if (b.created?.gte) l = l.filter(e => e.created >= Number(b.created.gte));
      if (b.type) l = l.filter(e => e.type === b.type);
      if (b.starting_after) { const i = l.findIndex(e => e.id === b.starting_after); l = i >= 0 ? l.slice(i + 1) : []; }
      const n = Math.min(Number(b.limit) || 10, 100);
      return { object: 'list', data: l.slice(0, n), has_more: l.length > n, url: '/v1/events' };
    }],
    ['GET', /^\/v1\/balance$/, () => ({ object: 'balance', available: [{ amount: S.disponibile, currency: 'eur' }], pending: [{ amount: 0, currency: 'eur' }], livemode: false })],
    ['POST', /^\/v1\/transfers$/, (b) => {
      const amount = intero(b.amount, 'amount'); serve(b.currency, 'currency');
      const a = S.conti.get(serve(b.destination, 'destination')); if (!a) throw new Rifiuto(`No such destination: '${b.destination}'`, 'destination');
      if (!a.pronto) throw new Rifiuto('Your destination account needs to have at least one of the following capabilities enabled: transfers, crypto_transfers, legacy_payments', 'destination');
      if (amount > S.disponibile) throw new Rifiuto('You have insufficient available funds in your Stripe account. Try adding funds directly to your available balance by creating Charges using the 4000000000000077 test card.', 'amount', 400, 'balance_insufficient');
      S.disponibile -= amount;
      const t = { id: casuale('tr', 24), object: 'transfer', amount, amount_reversed: 0, currency: b.currency, destination: a.id, transfer_group: b.transfer_group || null, description: b.description || null, metadata: b.metadata || {}, reversed: false, created: adesso() };
      S.trasferimenti.set(t.id, t); evento('transfer.created', t); return t;
    }],
    ['GET', /^\/v1\/transfers\/(tr_\w+)$/, (b, [id]) => { const t = S.trasferimenti.get(id); if (!t) throw new Rifiuto(`No such transfer: '${id}'`, 'id', 404); return t; }],
    ['POST', /^\/v1\/transfers\/(tr_\w+)\/reversals$/, (b, [id]) => {
      const t = S.trasferimenti.get(id); if (!t) throw new Rifiuto(`No such transfer: '${id}'`, 'id', 404);
      const amount = b.amount === undefined ? t.amount - t.amount_reversed : intero(b.amount, 'amount');
      if (amount > t.amount - t.amount_reversed) throw new Rifiuto(`Reversal amount exceeds the remaining amount of the transfer (${t.amount - t.amount_reversed}).`, 'amount');
      t.amount_reversed += amount; t.reversed = t.amount_reversed >= t.amount; S.disponibile += amount;
      const r = { id: casuale('trr', 24), object: 'transfer_reversal', amount, currency: t.currency, transfer: t.id, metadata: b.metadata || {} };
      evento('transfer.reversed', t); return r;
    }],
    ['POST', /^\/v1\/refunds$/, (b) => {
      const pi = S.intenti.get(serve(b.payment_intent || b.charge, 'payment_intent')) ; const ch = pi ? S.addebiti.get(pi.latest_charge) : S.addebiti.get(b.charge);
      if (!ch) throw new Rifiuto(`No such payment_intent: '${b.payment_intent}'`, 'payment_intent', 404);
      const amount = b.amount === undefined ? ch.amount - ch.rimborsato : intero(b.amount, 'amount');
      if (amount > ch.amount - ch.rimborsato) throw new Rifiuto(`Refund amount (${amount}) is greater than unrefunded amount on charge (${ch.amount - ch.rimborsato})`, 'amount');
      if (amount > S.disponibile) throw new Rifiuto('Insufficient funds in Stripe account to refund.', 'amount', 400, 'balance_insufficient');
      ch.rimborsato += amount; S.disponibile -= amount;
      const r = { id: casuale('re', 24), object: 'refund', amount, charge: ch.id, payment_intent: ch.intento, status: 'succeeded', currency: ch.currency };
      evento('charge.refunded', vistaAddebito(ch)); evento('refund.created', r); return r;
    }],
  ];

  const server = createServer(async (req, res) => {
    let corpo = ''; for await (const c of req) corpo += c;
    const url = new URL(req.url, 'http://x');
    const r = (stato, j) => { res.writeHead(stato, { 'content-type': 'application/json', 'request-id': casuale('req') }); res.end(JSON.stringify(j)); };
    S.chiamate.push({ metodo: req.method, percorso: url.pathname, idem: req.headers['idempotency-key'] || null });
    registro?.(`${req.method} ${url.pathname}`);
    if (!/^Bearer (sk|rk)_test_\w+$/.test(req.headers.authorization || '')) return r(401, { error: { type: 'invalid_request_error', message: 'Invalid API Key provided (il finto accetta solo chiavi di prova)' } });
    const b = req.method === 'GET' ? daModulo(url.search.slice(1)) : daModulo(corpo);
    for (const [metodo, re, fn] of rotte) {
      const m = req.method === metodo && url.pathname.match(re);
      if (!m) continue;
      try { return r(200, fn(b, m.slice(1), req)); }
      catch (e) { return e instanceof Rifiuto ? r(e.stato, { error: { type: e.stato === 402 ? 'card_error' : 'invalid_request_error', code: e.codice, message: e.message, param: e.param, doc_url: 'https://docs.stripe.com/error-codes' } })
        : r(500, { error: { type: 'api_error', message: `finto: ${e.message}` } }); }
    }
    r(404, { error: { type: 'invalid_request_error', message: `Unrecognized request URL (${req.method}: ${url.pathname}).` } });
  });
  await new Promise(ok => server.listen(porta, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${server.address().port}`, stato: S, versione, chiudi: () => new Promise(ok => { server.closeAllConnections?.(); server.close(() => ok()); }) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const f = await avviaFintoStripe({ porta: Number(process.argv[2] || 12111), registro: m => console.log(m) });
  console.log(`finto Stripe (${f.versione}) su ${f.url}: STRIPE_BASE=${f.url}`);
  for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => f.chiudi().then(() => process.exit(0)));
}
