// Chi gestisce la piattaforma (APP_ADMIN) e vende anche: le sue parti restano sul conto Stripe della piattaforma, che è il suo. Le
// quote maturate si segnano versate senza trasferimento, un rimborso non prova a stornare un trasferimento che non c'è, l'area lo
// dice e non apre un conto collegato. Contro il finto Stripe: niente rete, niente chiavi.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { avviaFintoStripe } from '../strumenti/finto-stripe.mjs';
import { clienteStripe } from '../server/stripe.js';
import { versaQuote, gestisciEvento } from '../server/soldi.js';
import { accendi, biscottoDa } from './aiuto.mjs';

let f, s, admin, ivo, idAdmin, idIvo;
before(async () => {
  f = await avviaFintoStripe();
  s = await accendi({ STRIPE_CHIAVE: 'sk_test_finto', STRIPE_PUBBLICA: `pk_test_${'a'.repeat(24)}`, STRIPE_BASE: f.url }, { stripe: true });
  const iscrivi = async (nome, email) => {
    const r = await s.chiedi('/api/iscrizione', { corpo: { nome, email, parola: 'Prova-lunga-di-test-2026', contratto: true } });
    assert.equal(r.status, 201);
    return biscottoDa(r, 'sessione');
  };
  admin = await iscrivi('Ada Titolare', 'admin@prova.test');   // APP_ADMIN delle prove (test/aiuto.mjs), conta con l'email confermata
  const t = s.posta.find(m => m.a === 'admin@prova.test').testo.match(/\/verifica\?t=([\w-]+)/)[1];
  assert.equal((await s.chiedi(`/verifica?t=${t}`)).status, 302);
  ivo = await iscrivi('Ivo Installa', 'ivo@prova.test');
  const id = email => s.db.prepare('SELECT id FROM utente WHERE email = ?').get(email).id;
  idAdmin = id('admin@prova.test'); idIvo = id('ivo@prova.test');
});
after(async () => { await s.chiudi(); await f.chiudi(); });

const ieri = new Date(Date.now() - 864e5).toISOString(), domani = new Date(Date.now() + 864e5).toISOString();
const quota = (beneficiario, fattura, disponibile, pagamento = null) => s.db.prepare(`INSERT INTO quota (beneficiario, ruolo, fattura, riga, tipo, base, frazione, importo, pagamento, disponibile)
  VALUES (?, 'installatore', ?, 'r1', 'avvio', 10000, 0.2, 2000, ?, ?) RETURNING id`).get(beneficiario, fattura, pagamento, disponibile).id;
const di = id => s.db.prepare('SELECT stato, trasferimento, stornato FROM quota WHERE id = ?').get(id);
const chiamate = p => f.stato.chiamate.filter(c => c.percorso.startsWith(p)).length;

test('le quote maturate di chi gestisce la piattaforma restano sul suo conto: versate, senza trasferimento', async () => {
  const matura = quota(idAdmin, 'in_prova_1', ieri), presto = quota(idAdmin, 'in_prova_2', domani), altrui = quota(idIvo, 'in_prova_1', ieri);
  const trasferimenti = chiamate('/v1/transfers');
  await versaQuote({ db: s.db, stripe: clienteStripe(s.cfg.stripe), cfg: s.cfg });
  assert.deepEqual({ ...di(matura) }, { stato: 'versata', trasferimento: 'piattaforma', stornato: 0 });
  assert.equal(di(presto).stato, 'in_attesa', 'prima della trattenuta resta in attesa, come per tutti');
  assert.equal(di(altrui).stato, 'in_attesa', 'chi installa senza conto pronto aspetta il suo conto');
  assert.equal(chiamate('/v1/transfers'), trasferimenti, 'nessun trasferimento verso la piattaforma stessa');
});

test('un rimborso su una quota rimasta alla piattaforma la storna senza cercare un trasferimento', async () => {
  const q = quota(idAdmin, 'in_prova_3', ieri, 'pi_prova_rimborso');
  await versaQuote({ db: s.db, stripe: clienteStripe(s.cfg.stripe), cfg: s.cfg });
  assert.equal(di(q).trasferimento, 'piattaforma');
  const storni = chiamate('/v1/transfers/');
  const esito = await gestisciEvento({ id: 'evt_prova_rimborso', type: 'charge.refunded', data: { object: { payment_intent: 'pi_prova_rimborso', amount: 10000, amount_refunded: 10000 } } },
    { db: s.db, cfg: s.cfg, stripe: clienteStripe(s.cfg.stripe) });
  assert.equal(esito, '1 quote stornate');
  assert.deepEqual({ ...di(q) }, { stato: 'versata', trasferimento: 'piattaforma', stornato: 2000 });
  assert.equal(chiamate('/v1/transfers/'), storni);
});

test('l\'area lo dice e il conto collegato non si apre; per gli altri nulla cambia', async () => {
  const io = async b => (await s.chiedi('/api/io', { biscotto: b })).json();
  assert.equal((await io(admin)).incassaPiattaforma, true);
  assert.equal((await io(ivo)).incassaPiattaforma, false);
  const conti = chiamate('/v1/accounts');
  const r = await s.chiedi('/api/stripe/collega', { corpo: { paese: 'IT', incorporato: true }, biscotto: admin });
  assert.equal(r.status, 400);
  assert.match((await r.json()).errore, /conto Stripe della piattaforma/);
  assert.equal(chiamate('/v1/accounts'), conti, 'nessun conto collegato per chi gestisce la piattaforma');
  assert.equal(s.db.prepare('SELECT stripe FROM utente WHERE id = ?').get(idAdmin).stripe, null);
  assert.equal((await s.chiedi('/api/stripe/collega', { corpo: { paese: 'IT', incorporato: true }, biscotto: ivo })).status, 200);
});
