// La divisione dei soldi: la somma delle parti è sempre il pagamento, nessuna parte è negativa, e gli esempi scritti nelle pagine
// e nei documenti tornano al centesimo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leggiConfig } from '../server/config.js';
import { dividi, dividiCanone, spartisci, stimaStripe, conLivello } from '../server/soldi.js';
import { unita, dividiUnita } from '../server/web3.js';

const cfg = leggiConfig({});
const casuale = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

test('dividi: le parti sommano sempre il pagamento e non sono mai negative', () => {
  for (let i = 0; i < 5000; i++) {
    const base = casuale(500, 5_000_000), qi = Math.random(), qp = Math.random() * 0.2, costo = casuale(0, base * 2);
    const d = dividi(base, qi, qp, Math.random() < 0.9, costo);
    assert.equal(d.installatore + d.builder + d.piattaforma, base);
    for (const k of ['installatore', 'builder', 'piattaforma']) assert.ok(d[k] >= 0, `${k} negativo con ${JSON.stringify({ base, qi, qp, costo })}`);
    assert.ok((d.costo || 0) <= base);
  }
});

test('dividi: il costo di Stripe esce per primo, poi il 5% della piattaforma, poi chi vende e chi sviluppa', () => {
  // l'esempio del piano di lancio: 390 € d'installazione con carta → 72,94 € a chi installa, 291,76 € a chi sviluppa
  const costo = stimaStripe(cfg, 39000);
  assert.equal(costo, 610);   // 1,5% + 0,25 €
  const d = dividi(39000, cfg.quotaInstallatore, cfg.piattaforma, true, costo);
  assert.deepEqual(d, { installatore: 7294, piattaforma: 2530, builder: 29176, costo: 610 });
  // senza installatore la sua parte resta a chi sviluppa
  assert.equal(dividi(10000, 0.2, 0.05, false).installatore, 0);
  assert.equal(dividi(10000, 0.2, 0.05, false).builder, 9500);
});

test('dividiCanone: del canone, tolto Stripe, il 60% a chi ha installato e il resto alla piattaforma', () => {
  // l'esempio del piano di lancio: dei 29 € dell'assistenza 16,99 € vanno a chi ha installato
  const costo = stimaStripe(cfg, 2900);
  const d = dividiCanone(2900, cfg.quotaInstallatoreAssistenza, cfg.quotaSviluppatoreAssistenza, true, costo);
  assert.equal(d.installatore, 1699);
  assert.equal(d.builder, 0);
  assert.equal(d.installatore + d.builder + d.piattaforma, 2900);
  // chi ha installato non c'è più: la sua parte resta alla piattaforma
  const senza = dividiCanone(2900, 0.6, 0, false, costo);
  assert.equal(senza.installatore, 0);
  assert.equal(senza.piattaforma, 2900);
});

test('stimaStripe: zero senza importo o con CARTA_COSTO_STRIPE=0', () => {
  assert.equal(stimaStripe(cfg, 0), 0);
  assert.equal(stimaStripe(leggiConfig({ CARTA_COSTO_STRIPE: '0' }), 39000), 0);
});

test('conLivello: i livelli di chi vende abbassano la parte di chi sviluppa (80% → 65% → 50%)', () => {
  const sviluppatore = q => Math.round((1 - q) * 1000) / 1000;
  assert.equal(sviluppatore(conLivello(0.2, 1)), 0.8);
  assert.equal(sviluppatore(conLivello(0.2, 13 / 16)), 0.65);
  assert.equal(sviluppatore(conLivello(0.2, 5 / 8)), 0.5);
});

test('spartisci: i collaboratori prendono la loro frazione per difetto, a chi sviluppa il resto (anche in BigInt)', () => {
  const s = spartisci(10001, [{ utente: 2, quota: 0.333333 }, { utente: 3, quota: 0.333333 }, { utente: 4, quota: 0.333334 }]);
  assert.equal(s.builder + s.collaboratori.reduce((t, c) => t + c.importo, 0), 10001);
  assert.ok(s.builder >= 0);
  const g = spartisci(10n ** 18n + 7n, [{ utente: 2, quota: 0.5 }]);
  assert.equal(g.builder + g.collaboratori[0].importo, 10n ** 18n + 7n);
});

test('unita e dividiUnita: dagli euro alle unità dei token, arrotondando in su, e la divisione esatta', () => {
  assert.equal(unita(1000, 1, 6), 10_000_000n);        // 10 € in USDC a 1 € → 10 USDC
  assert.equal(unita(1, 3, 6), 3334n);                 // 0,01 € a 3 € l'uno → per eccesso
  for (let i = 0; i < 1000; i++) {
    const tot = BigInt(casuale(1, 1e9)) * 10n ** 9n, d = dividiUnita(tot, Math.random(), 0.01);
    assert.equal(d.installatore + d.piattaforma + d.builder, tot);
    assert.ok(d.builder >= 0n && d.installatore >= 0n);
  }
});
