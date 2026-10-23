// La crittografia e le codifiche scritte in JS puro, contro i vettori pubblici delle specifiche: Keccak, EIP-55, secp256k1 ed
// EIP-191, SHA-256, base58check, bech32 (BIP173), Tron, Solana, TOTP (RFC 6238), firme dei webhook di Stripe, IBAN, partita IVA e
// codice fiscale.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keccak256, checksum, indirizzoDaChiave, firmaMessaggio, verificaMessaggio } from '../server/cripto.js';
import { TRANSFER } from '../server/web3.js';
import { inHex, sha256, daBase58check, base58check, segwitDecodifica, segwitCodifica } from '../web/codifiche.js';
import { tipoIndirizzoBitcoin } from '../server/bitcoin.js';
import { tronInHex, hexInTron } from '../server/tron.js';
import { eIndirizzoSolana } from '../server/solana.js';
import { base32, daBase32, codiceTotp, verificaTotp } from '../server/totp.js';
import { firma, verificaFirma } from '../server/stripe.js';
import { ibanValido } from '../server/bonifico.js';
import { partitaIvaValida, codiceFiscaleValido } from '../server/fiscale.js';

test('keccak256: la stringa vuota e la firma dell\'evento Transfer', () => {
  assert.equal(inHex(keccak256('')), 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
  assert.equal('0x' + inHex(keccak256('Transfer(address,address,uint256)')), TRANSFER);
});

test('EIP-55: le maiuscole di controllo degli indirizzi', () => {
  for (const a of ['0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
    '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB', '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb']) assert.equal(checksum(a.toLowerCase()), a);
});

test('secp256k1: l\'indirizzo della chiave 1, e firma e verifica EIP-191', () => {
  const uno = Buffer.from('0'.repeat(63) + '1', 'hex'), indirizzo = indirizzoDaChiave(uno);
  assert.equal(indirizzo, '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf');
  const f = firmaMessaggio('Repobay: questo wallet è mio', uno);
  assert.ok(verificaMessaggio('Repobay: questo wallet è mio', f, indirizzo));
  assert.ok(!verificaMessaggio('Repobay: questo wallet è tuo', f, indirizzo));
  assert.ok(!verificaMessaggio('Repobay: questo wallet è mio', f, '0x' + '11'.repeat(20)));
});

test('SHA-256 e base58check: il primo indirizzo Bitcoin', () => {
  assert.equal(inHex(sha256(Buffer.from('abc'))), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const contenuto = Buffer.from('0062e907b15cbf27d5425399ebf6f0fb50ebb88f18', 'hex');
  assert.equal(base58check(contenuto), '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
  assert.equal(inHex(daBase58check('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')), inHex(contenuto));
  assert.equal(daBase58check('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb'), null);   // controllo sbagliato
});

test('bech32 (BIP173): decodifica, codifica e controllo', () => {
  const d = segwitDecodifica('bc', 'BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4');
  assert.equal(d.versione, 0);
  assert.equal(inHex(d.programma), '751e76e8199196d454941c45d1b3a323f1433bd6');
  assert.equal(segwitCodifica('bc', 0, d.programma), 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
  assert.equal(tipoIndirizzoBitcoin('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'), 'p2wpkh');
  assert.equal(tipoIndirizzoBitcoin('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'), 'p2pkh');
  assert.equal(tipoIndirizzoBitcoin('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5'), null);   // un carattere cambiato
});

test('Tron e Solana: indirizzi', () => {
  assert.equal(tronInHex('TJCnKsPa7y5okkXvQAidZBzqx3QyQ6sxMW'), '415a523b449890854c8fc460ab602df9f31fe4293f');
  assert.equal(hexInTron('415a523b449890854c8fc460ab602df9f31fe4293f'), 'TJCnKsPa7y5okkXvQAidZBzqx3QyQ6sxMW');
  assert.equal(tronInHex('TJCnKsPa7y5okkXvQAidZBzqx3QyQ6sxMX'), null);
  assert.ok(eIndirizzoSolana('11111111111111111111111111111111'));   // il System Program
  assert.ok(!eIndirizzoSolana('0OIl'));
});

test('TOTP: i vettori della RFC 6238 (SHA-1, 8 cifre) e la finestra di un passo', () => {
  const segreto = base32(Buffer.from('12345678901234567890'));
  assert.equal(segreto, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.equal(Buffer.from(daBase32(segreto)).toString(), '12345678901234567890');
  for (const [secondi, codice] of [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037']])
    assert.equal(codiceTotp(segreto, { quando: secondi * 1000, cifre: 8 }), codice);
  const ora = 1_700_000_000_000, codice = codiceTotp(segreto, { quando: ora });
  assert.ok(verificaTotp(segreto, codice, { quando: ora + 30_000 }));    // il passo dopo vale ancora
  assert.ok(!verificaTotp(segreto, codice, { quando: ora + 120_000 }));  // quattro passi dopo no
});

test('Stripe: la firma dei webhook (segreto, corpo e tempo)', () => {
  const corpo = JSON.stringify({ id: 'evt_prova', type: 'checkout.session.completed' }), adesso = Date.now();
  const f = firma(corpo, 'whsec_prova', Math.floor(adesso / 1000));
  assert.ok(verificaFirma(corpo, f, 'whsec_prova', adesso));
  assert.ok(!verificaFirma(corpo, f, 'whsec_altro', adesso));
  assert.ok(!verificaFirma(corpo + ' ', f, 'whsec_prova', adesso));
  assert.ok(!verificaFirma(corpo, f, 'whsec_prova', adesso + 10 * 60e3));   // oltre i 5 minuti di tolleranza
  assert.ok(!verificaFirma(corpo, undefined, 'whsec_prova', adesso));
});

test('IBAN, partita IVA e codice fiscale', () => {
  assert.ok(ibanValido('IT60 X054 2811 1010 0000 0123 456'));
  assert.ok(!ibanValido('IT61 X054 2811 1010 0000 0123 456'));
  assert.ok(partitaIvaValida('00743110157'));
  assert.ok(!partitaIvaValida('00743110158'));
  assert.ok(codiceFiscaleValido('RSSMRA85T10A562S'));
  assert.ok(!codiceFiscaleValido('RSSMRA85T10A562T'));
});
