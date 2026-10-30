// Il conto Stripe dentro l'area (Connect embedded components) contro il finto Stripe: il conto si apre senza lasciare il sito, la
// sessione dei componenti vale solo per il proprio conto, la strada di riserva (la pagina di Stripe) resta, e /area permette
// Connect.js senza aprire la porta agli script in linea. Niente rete, niente chiavi.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { avviaFintoStripe } from '../strumenti/finto-stripe.mjs';
import { accendi, biscottoDa } from './aiuto.mjs';

const PUBBLICA = `pk_test_${'a'.repeat(24)}`;
let f, s;
before(async () => {
  f = await avviaFintoStripe();
  s = await accendi({ STRIPE_CHIAVE: 'sk_test_finto', STRIPE_PUBBLICA: PUBBLICA, STRIPE_BASE: f.url }, { stripe: true });
});
after(async () => { await s.chiudi(); await f.chiudi(); });

const iscrivi = async (nome, email) => {
  const r = await s.chiedi('/api/iscrizione', { corpo: { nome, email, parola: 'Prova-lunga-di-test-2026', contratto: true } });
  assert.equal(r.status, 201);
  return biscottoDa(r, 'sessione');
};
const chiamate = percorso => f.stato.chiamate.filter(c => c.percorso === percorso).length;

test('il conto si apre dentro l\'area: niente link verso Stripe, poi la sessione dei componenti', async () => {
  const biscotto = await iscrivi('Ivo Installa', 'ivo@prova.test');
  assert.equal((await s.chiedi('/api/stripe/sessione', { corpo: {}, biscotto })).status, 400);   // prima il conto

  const link = chiamate('/v1/account_links');
  const r = await s.chiedi('/api/stripe/collega', { corpo: { paese: 'IT', incorporato: true }, biscotto });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual({ ...j, client_secret: undefined }, { incorporato: true, pubblica: PUBBLICA, client_secret: undefined });
  assert.match(j.client_secret, /^accs_\w+_secret_\w+$/, 'la prima sessione arriva subito, senza un\'altra richiesta');
  assert.equal(chiamate('/v1/account_links'), link, 'dentro l\'area non serve il link di Stripe');
  const conto = s.db.prepare('SELECT stripe, stripe_pronto FROM utente WHERE email = ?').get('ivo@prova.test');
  assert.match(conto.stripe, /^acct_/);
  assert.equal(conto.stripe_pronto, 0);

  const sess = await s.chiedi('/api/stripe/sessione', { corpo: {}, biscotto });
  assert.equal(sess.status, 200);
  assert.match((await sess.json()).client_secret, /^accs_\w+_secret_\w+$/);
  // una seconda volta (Connect.js la richiede quando scade): stesso conto, nessun conto nuovo
  assert.equal((await s.chiedi('/api/stripe/collega', { corpo: { incorporato: true }, biscotto })).status, 200);
  assert.equal(s.db.prepare('SELECT stripe FROM utente WHERE email = ?').get('ivo@prova.test').stripe, conto.stripe);
  assert.equal(f.stato.conti.size, 1);
});

test('la strada di riserva resta: senza «incorporato» si va sulla pagina di Stripe', async () => {
  const biscotto = await iscrivi('Lia Riserva', 'lia@prova.test');
  const r = await s.chiedi('/api/stripe/collega', { corpo: { paese: 'IT' }, biscotto });
  assert.equal(r.status, 200);
  assert.match((await r.json()).url, /^https:\/\/connect\.stripe\.com\//);
});

test('se Stripe rifiuta la sessione (la chiave senza il permesso) si va sulla sua pagina, non su un riquadro vuoto', async () => {
  const biscotto = await iscrivi('Ugo Riserva', 'ugo@prova.test');
  f.stato.sessioniNegate = true;
  try {
    const r = await s.chiedi('/api/stripe/collega', { corpo: { paese: 'IT', incorporato: true }, biscotto });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.match(j.url, /^http/, 'il link della pagina di Stripe');
    assert.equal(j.incorporato, undefined);
  } finally { f.stato.sessioniNegate = false; }
});

test('la sessione è solo per chi è dentro e solo dalle nostre pagine', async () => {
  assert.equal((await s.chiedi('/api/stripe/sessione', { corpo: {} })).status, 401);
  const biscotto = await iscrivi('Eva Altrove', 'eva@prova.test');
  await s.chiedi('/api/stripe/collega', { corpo: { incorporato: true }, biscotto });
  const r = await s.chiedi('/api/stripe/sessione', { corpo: {}, biscotto, headers: { origin: 'https://altro.example' } });
  assert.equal(r.status, 403);
});

test('/area permette Connect.js (script, riquadri, l\'impronta del suo stile) e la sua finestrella; le altre pagine no', async () => {
  const area = await s.chiedi('/area');
  assert.equal(area.status, 200);
  const csp = area.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self' https:\/\/connect-js\.stripe\.com https:\/\/js\.stripe\.com/);
  assert.match(csp, /frame-src https:\/\/connect-js\.stripe\.com https:\/\/js\.stripe\.com/);
  assert.match(csp, /'sha256-0hAheEzaMe6uXIKV4EehS9pu1am1lj\/KnnzrOYqckXk='/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  assert.equal(area.headers.get('cross-origin-opener-policy'), 'unsafe-none');
  const casa = await s.chiedi('/');
  assert.doesNotMatch(casa.headers.get('content-security-policy'), /connect-js/);
  assert.equal(casa.headers.get('cross-origin-opener-policy'), 'same-origin');
});
