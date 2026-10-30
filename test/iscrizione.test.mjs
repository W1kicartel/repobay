// L'iscrizione in un passo della home: nome, email e le condizioni, senza password. Il conto nasce e si entra subito, arriva l'email
// di conferma, la password si crea dopo dall'area; con la password valgono le regole di sempre. Niente rete, niente chiavi.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { accendi, biscottoDa } from './aiuto.mjs';

let s;
before(async () => { s = await accendi(); });
after(() => s.chiudi());

test('la home ha il modulo in un passo, nell\'eroe e nella chiusura: nome, email, condizioni, il campo trappola', async () => {
  const html = await (await s.chiedi('/', { headers: { 'accept-language': 'it' } })).text();
  const moduli = html.match(/<form class="k-iscrizione[^"]*" data-iscrizione[\s\S]*?<\/form>/g) || [];
  assert.equal(moduli.length, 2);
  for (const m of moduli) {
    for (const campo of ['name="nome"', 'name="email"', 'name="contratto"', 'name="sito_web"']) assert.ok(m.includes(campo), campo);
    assert.ok(!m.includes('name="parola"'), 'niente password nel modulo della home');
    assert.match(m, /href="\/contratto"/); assert.match(m, /href="\/privacy"/);
  }
});

test('senza password: il conto nasce, si entra subito, arriva l\'email di conferma, e la password si crea dopo', async () => {
  const r = await s.chiedi('/api/iscrizione', { corpo: { nome: 'Nadia Veloce', email: 'Nadia@Prova.test', contratto: true } });
  assert.equal(r.status, 201);
  const biscotto = biscottoDa(r, 'sessione');
  assert.ok(biscotto, 'si entra subito');
  const u = s.db.prepare('SELECT parola, email_verificata FROM utente WHERE email = ?').get('nadia@prova.test');
  assert.equal(u.parola, null);
  assert.equal(u.email_verificata, null);
  assert.match(s.posta.find(m => m.a === 'nadia@prova.test')?.testo || '', /\/verifica\?t=/);
  const io = await (await s.chiedi('/api/io', { biscotto })).json();
  assert.equal(io.haParola, false);
  assert.equal(io.sicurezza.sessioni[0].metodo, 'iscrizione');
  // la password dall'area, senza quella attuale (non c'è)
  assert.equal((await s.chiedi('/api/parola', { corpo: { nuova: 'Una-frase-lunga-da-ricordare-2026' }, biscotto })).status, 200);
  assert.equal((await s.chiedi('/api/accesso', { corpo: { email: 'nadia@prova.test', parola: 'Una-frase-lunga-da-ricordare-2026' } })).status, 200);
});

test('una password vuota vale come nessuna; una scritta deve rispettare le regole; nome, email e condizioni restano obbligatori', async () => {
  assert.equal((await s.chiedi('/api/iscrizione', { corpo: { nome: 'Olga Vuota', email: 'olga@prova.test', parola: '', contratto: true } })).status, 201);
  assert.equal(s.db.prepare('SELECT parola FROM utente WHERE email = ?').get('olga@prova.test').parola, null);
  assert.equal((await s.chiedi('/api/iscrizione', { corpo: { nome: 'Pia Debole', email: 'pia@prova.test', parola: 'corta', contratto: true } })).status, 400);
  assert.equal((await s.chiedi('/api/iscrizione', { corpo: { nome: 'Pia', email: 'pia@prova.test' } })).status, 400);
  assert.equal((await s.chiedi('/api/iscrizione', { corpo: { nome: '', email: 'pia@prova.test', contratto: true } })).status, 400);
  assert.equal((await s.chiedi('/api/iscrizione', { corpo: { nome: 'Pia', email: 'non-email', contratto: true } })).status, 400);
  assert.equal((await s.chiedi('/api/iscrizione', { corpo: { nome: 'Olga Doppia', email: 'olga@prova.test', contratto: true } })).status, 409);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM utente WHERE email = ?').get('pia@prova.test').n, 0);
});
