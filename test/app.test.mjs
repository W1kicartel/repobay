// L'app intera via HTTP, accesa in questo processo con la posta finta e un finto GitHub (test/aiuto.mjs): pagine e intestazioni di
// sicurezza, iscrizione con conferma dell'email, accesso, entrata con GitHub, richieste da altre origini, webhook senza firma,
// /versione. Niente rete, niente chiavi.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { firma as firmaStripe } from '../server/stripe.js';
import { accendi, biscottoDa, UTENTE_GITHUB } from './aiuto.mjs';

let s;
before(async () => { s = await accendi({ STRIPE_FIRMA: 'whsec_prova' }); });
after(() => s.chiudi());

const PAROLA = 'Prova-lunga-di-test-2026';

test('/salute risponde, con il nome della piattaforma', async () => {
  const r = await s.chiedi('/salute');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, nome: 'Repobay' });
});

test('le pagine hanno le intestazioni di sicurezza e la CSP senza script esterni', async () => {
  const r = await s.chiedi('/', { headers: { 'accept-language': 'it' } });
  assert.equal(r.status, 200);
  const csp = r.headers.get('content-security-policy');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  const html = await r.text();
  assert.match(html, /<html lang="it"/);
  assert.doesNotMatch(html, /\{\{(NOME|LINGUA|URL)\}\}/);   // i segnaposto sono riempiti
});

test('in inglese per chi non parla italiano', async () => {
  const r = await s.chiedi('/', { headers: { 'accept-language': 'de-DE,de;q=0.9' } });
  assert.match(await r.text(), /<html lang="en"/);
});

test('404 per le pagine e per le API che non esistono, e nessun file fuori da web/', async () => {
  assert.equal((await s.chiedi('/pagina-che-non-esiste')).status, 404);
  const api = await s.chiedi('/api/non-esiste');
  assert.equal(api.status, 404);
  assert.ok((await api.json()).errore);
  // il percorso esatto, senza la normalizzazione di fetch
  const r = await new Promise((ok, no) => request(`${s.url}/../server/config.js`, { path: '/../server/config.js' }, x => {
    let c = ''; x.on('data', d => c += d); x.on('end', () => ok({ stato: x.statusCode, corpo: c }));
  }).on('error', no).end());
  assert.equal(r.stato, 404);
  assert.doesNotMatch(r.corpo, /leggiConfig/);
});

test('le POST da un\'altra origine sono rifiutate', async () => {
  const r = await s.chiedi('/api/iscrizione', { corpo: { nome: 'Eva', email: 'eva@prova.test', parola: PAROLA, contratto: true }, headers: { origin: 'https://altro.example' } });
  assert.equal(r.status, 403);
});

test('iscrizione: password debole rifiutata; poi conto, email di conferma, conferma e accesso', async () => {
  const debole = await s.chiedi('/api/iscrizione', { corpo: { nome: 'Lea', email: 'lea@prova.test', parola: 'corta', contratto: true } });
  assert.equal(debole.status, 400);
  const senzaContratto = await s.chiedi('/api/iscrizione', { corpo: { nome: 'Lea', email: 'lea@prova.test', parola: PAROLA } });
  assert.equal(senzaContratto.status, 400);

  const r = await s.chiedi('/api/iscrizione', { corpo: { nome: 'Lea Rossi', email: 'Lea@Prova.test', parola: PAROLA, contratto: true, zona: 'Bergamo' } });
  assert.equal(r.status, 201);
  assert.ok(biscottoDa(r, 'sessione'));
  const email = s.posta.find(m => m.a === 'lea@prova.test');
  assert.ok(email, 'manca l\'email di conferma');
  const link = email.testo.match(/\/verifica\?t=([\w-]+)/);
  assert.ok(link, 'manca il link di conferma');

  const doppia = await s.chiedi('/api/iscrizione', { corpo: { nome: 'Lea', email: 'lea@prova.test', parola: PAROLA, contratto: true } });
  assert.equal(doppia.status, 409);

  const conferma = await s.chiedi(`/verifica?t=${link[1]}`);
  assert.equal(conferma.status, 302);
  assert.match(conferma.headers.get('location'), /email=verificata/);
  assert.ok(s.db.prepare('SELECT email_verificata FROM utente WHERE email = ?').get('lea@prova.test').email_verificata);

  assert.equal((await s.chiedi('/api/accesso', { corpo: { email: 'lea@prova.test', parola: PAROLA + 'x' } })).status, 401);
  const dentro = await s.chiedi('/api/accesso', { corpo: { email: 'lea@prova.test', parola: PAROLA } });
  assert.equal(dentro.status, 200);
  const io = await s.chiedi('/api/io', { biscotto: biscottoDa(dentro, 'sessione') });
  assert.equal(io.status, 200);
  const j = await io.json();
  assert.equal(j.email, 'lea@prova.test');
  assert.equal(j.emailVerificata, true);
  assert.equal((await s.chiedi('/api/io')).status, 401);   // senza biscotto no
});

test('entrata con GitHub (finto): lo stato deve tornare uguale, poi nasce il conto', async () => {
  const via = await s.chiedi('/auth/github?contratto=1');
  assert.equal(via.status, 302);
  const dove = new URL(via.headers.get('location'));
  assert.equal(dove.pathname, '/login/oauth/authorize');
  assert.equal(dove.searchParams.get('client_id'), 'finto');
  const stato = dove.searchParams.get('state'), biscotto = biscottoDa(via, 'gh_stato');

  const sbagliato = await s.chiedi(`/auth/github/ritorno?code=abc&state=${stato}x`, { biscotto });
  assert.match(sbagliato.headers.get('location'), /errore=github/);

  const r = await s.chiedi(`/auth/github/ritorno?code=abc&state=${stato}`, { biscotto });
  assert.equal(r.status, 302);
  assert.ok(biscottoDa(r, 'sessione'));
  const u = s.db.prepare('SELECT nome, github_login FROM utente WHERE github_id = ?').get(UTENTE_GITHUB.id);
  assert.deepEqual({ ...u }, { nome: UTENTE_GITHUB.name, github_login: UTENTE_GITHUB.login });
});

test('il webhook di Stripe accetta solo gli eventi firmati con il suo segreto', async () => {
  const corpo = JSON.stringify({ id: 'evt_prova', type: 'prova.sconosciuto', data: { object: {} } });
  const manda = firma => s.chiedi('/api/stripe/webhook', { method: 'POST', body: corpo, headers: { origin: 'https://stripe.com', 'stripe-signature': firma } });
  assert.equal((await manda('t=1,v1=00')).status, 400);
  assert.equal((await manda(firmaStripe(corpo, 'whsec_altro'))).status, 400);
  assert.equal((await manda(firmaStripe(corpo, 'whsec_prova'))).status, 200);   // arriva da fuori: l'origine non conta, la firma sì
});

test('/versione senza versione.json: nessun commit, nessuna intestazione', async () => {
  const r = await s.chiedi('/versione');
  assert.equal(r.status, 200);
  const v = await r.json();
  assert.equal(v.commit, null);
  assert.equal(v.url, s.url);
  assert.equal(r.headers.get('x-versione'), null);
});
