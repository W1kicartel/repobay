// Il controllo dei pagamenti in crypto sulle reti EVM, contro una blockchain finta: le ricevute, i blocchi e le transazioni che
// risponderebbe un nodo vero (JSON-RPC), senza rete. Un pagamento vale solo se è riuscito, confermato, fatto dopo l'ordine, da un
// solo wallet, e porta a ogni destinatario almeno la sua parte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifica, chiamate, moneta, RETI, TRANSFER } from '../server/web3.js';
import { checksum } from '../server/cripto.js';

const rete = { ...RETI.base, rpc: 'finto://base' };
const USDC = moneta(rete, 'USDC'), ETH = moneta(rete, 'ETH');
const PAGATORE = '0x' + 'aa'.repeat(20), ALTRO = '0x' + 'bb'.repeat(20);
const BUILDER = '0x' + '11'.repeat(20), INSTALLATORE = '0x' + '22'.repeat(20), PIATTAFORMA = '0x' + '33'.repeat(20);
const parti = [{ indirizzo: BUILDER, unita: '8000000' }, { indirizzo: INSTALLATORE, unita: '1900000' }, { indirizzo: PIATTAFORMA, unita: '100000' }];
const ORDINE = Date.UTC(2026, 9, 23, 10, 0);   // l'ora dell'ordine
const h = n => '0x' + String(n).repeat(64).slice(0, 64);
const parola = x => '0x' + x.slice(2).toLowerCase().padStart(64, '0');
const trasferimento = (da, a, unita, token = USDC.indirizzo) => ({ address: token, topics: [TRANSFER, parola(da), parola(a)], data: '0x' + BigInt(unita).toString(16) });

// la catena finta: blocco attuale 100, ogni transazione in un blocco con la sua ora
function catena({ ricevute = {}, transazioni = {}, ore = {}, ultimo = 100 }) {
  return async (url, metodo, [x] = []) => {
    assert.equal(url, rete.rpc);
    if (metodo === 'eth_blockNumber') return '0x' + ultimo.toString(16);
    if (metodo === 'eth_getTransactionReceipt') return ricevute[x] ?? null;
    if (metodo === 'eth_getBlockByNumber') return { number: x, timestamp: '0x' + Math.floor((ore[x] ?? ORDINE + 60e3) / 1000).toString(16) };
    if (metodo === 'eth_getTransactionByHash') return transazioni[x] ?? null;
    throw new Error(`metodo inatteso: ${metodo}`);
  };
}
const ricevuta = (logs, { stato = '0x1', blocco = '0x5a' } = {}) => ({ status: stato, blockNumber: blocco, logs });
const tuttiPagati = (da = PAGATORE) => parti.map(p => trasferimento(da, p.indirizzo, p.unita));

test('USDC: tre trasferimenti giusti in una transazione → pagato, con il pagatore', async () => {
  const rpc = catena({ ricevute: { [h(1)]: ricevuta(tuttiPagati()) } });
  assert.deepEqual(await verifica({ rpc, rete, m: USDC, parti, hash: [h(1)], dopo: ORDINE }), { pagatore: checksum(PAGATORE), tx: [h(1)] });
});

test('USDC: una parte che manca anche di un\'unità → importi sbagliati', async () => {
  const logs = tuttiPagati(); logs[1] = trasferimento(PAGATORE, INSTALLATORE, 1899999);
  const e = await verifica({ rpc: catena({ ricevute: { [h(1)]: ricevuta(logs) } }), rete, m: USDC, parti, hash: [h(1)], dopo: ORDINE });
  assert.match(e.errore, /importi/);
  assert.equal(e.mancante, INSTALLATORE);
});

test('USDC: un token diverso (stesso evento Transfer da un altro contratto) non conta', async () => {
  const falso = parti.map(p => trasferimento(PAGATORE, p.indirizzo, p.unita, '0x' + 'ee'.repeat(20)));
  const e = await verifica({ rpc: catena({ ricevute: { [h(1)]: ricevuta(falso) } }), rete, m: USDC, parti, hash: [h(1)], dopo: ORDINE });
  assert.match(e.errore, /importi/);
});

test('in attesa: transazione non ancora in un blocco, o con meno conferme di quelle della rete', async () => {
  assert.ok((await verifica({ rpc: catena({}), rete, m: USDC, parti, hash: [h(1)], dopo: ORDINE })).attesa);
  const giovane = catena({ ricevute: { [h(1)]: ricevuta(tuttiPagati(), { blocco: '0x63' }) } });   // blocco 99, attuale 100: 2 conferme su 3
  assert.ok((await verifica({ rpc: giovane, rete, m: USDC, parti, hash: [h(1)], dopo: ORDINE })).attesa);
});

test('rifiutati: transazione fallita, precedente all\'ordine, pagata dopo la scadenza del prezzo, hash non valido', async () => {
  const fallita = catena({ ricevute: { [h(1)]: ricevuta(tuttiPagati(), { stato: '0x0' }) } });
  assert.match((await verifica({ rpc: fallita, rete, m: USDC, parti, hash: [h(1)], dopo: ORDINE })).errore, /fallita/);
  const vecchia = catena({ ricevute: { [h(1)]: ricevuta(tuttiPagati()) }, ore: { '0x5a': ORDINE - 3600e3 } });
  assert.match((await verifica({ rpc: vecchia, rete, m: USDC, parti, hash: [h(1)], dopo: ORDINE })).errore, /precedente/);
  const tardi = catena({ ricevute: { [h(1)]: ricevuta(tuttiPagati()) }, ore: { '0x5a': ORDINE + 3600e3 } });
  assert.match((await verifica({ rpc: tardi, rete, m: USDC, parti, hash: [h(1)], dopo: ORDINE, entro: ORDINE + 1800e3 })).errore, /scadenza/);
  assert.match((await verifica({ rpc: catena({}), rete, m: USDC, parti, hash: ['0x1234'], dopo: ORDINE })).errore, /non valida/);
});

test('rifiutato: le parti pagate da due wallet diversi', async () => {
  const logs = tuttiPagati(); logs[2] = trasferimento(ALTRO, PIATTAFORMA, 100000);
  assert.match((await verifica({ rpc: catena({ ricevute: { [h(1)]: ricevuta(logs) } }), rete, m: USDC, parti, hash: [h(1)], dopo: ORDINE })).errore, /wallet diversi/);
});

test('ETH: un invio per destinatario, in più transazioni; con l\'etichetta conta solo chi la porta nei dati', async () => {
  const etichetta = 'cafe0001';
  const transazioni = Object.fromEntries(parti.map((p, i) => [h(i + 1), { from: PAGATORE, to: p.indirizzo, value: '0x' + BigInt(p.unita).toString(16), input: '0x' + etichetta }]));
  const ricevute = Object.fromEntries(parti.map((p, i) => [h(i + 1), ricevuta([])]));
  const hash = parti.map((p, i) => h(i + 1));
  assert.equal((await verifica({ rpc: catena({ ricevute, transazioni }), rete, m: ETH, parti, hash, dopo: ORDINE, etichetta })).pagatore, checksum(PAGATORE));
  transazioni[h(3)].input = '0x';   // l'ultima non porta l'etichetta: non è di questo ordine
  assert.match((await verifica({ rpc: catena({ ricevute, transazioni }), rete, m: ETH, parti, hash, dopo: ORDINE, etichetta })).errore, /importi/);
});

test('chiamate: transfer(destinatario, importo) per i token, una sola per chi ha più parti', () => {
  const c = chiamate(USDC, [...parti, { indirizzo: BUILDER, unita: '5' }]);
  assert.equal(c.length, 3);
  assert.equal(c[0].to, checksum(USDC.indirizzo));
  assert.equal(c[0].data, '0xa9059cbb' + BUILDER.slice(2).padStart(64, '0') + (8000005).toString(16).padStart(64, '0'));
  const e = chiamate(ETH, parti);
  assert.deepEqual(e.map(x => x.value), parti.map(p => '0x' + BigInt(p.unita).toString(16)));
});
