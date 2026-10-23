// La prova di quello che gira: versione.json letto con prudenza, /versione e l'intestazione x-versione, e il confronto di
// strumenti/controlla-versione.mjs fra i file che il sito manda e quelli del repository.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { leggiVersione } from '../server/versione.js';
import { controllaVersione } from '../strumenti/controlla-versione.mjs';
import { accendi } from './aiuto.mjs';

const COMMIT = 'a'.repeat(40);

test('leggiVersione: un commit vero, il tag e la data; niente se il file manca o è strano', () => {
  const d = mkdtempSync(join(tmpdir(), 'repobay-versione-'));
  try {
    assert.equal(leggiVersione(d).commit, null);
    writeFileSync(join(d, 'versione.json'), JSON.stringify({ commit: COMMIT, tag: 'rilascio-2026-10-23-0853', data: '2026-10-23T08:53:00Z', modificato: false }));
    assert.deepEqual(leggiVersione(d), { commit: COMMIT, tag: 'rilascio-2026-10-23-0853', data: '2026-10-23T08:53:00Z', modificato: false });
    writeFileSync(join(d, 'versione.json'), JSON.stringify({ commit: COMMIT, tag: '<script>', modificato: true }));
    assert.deepEqual(leggiVersione(d), { commit: COMMIT, tag: null, data: null, modificato: true });
    writeFileSync(join(d, 'versione.json'), JSON.stringify({ commit: 'non-un-commit' }));
    assert.equal(leggiVersione(d).commit, null);
    writeFileSync(join(d, 'versione.json'), '{ rotto');
    assert.equal(leggiVersione(d).commit, null);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('/versione e x-versione: il commit, il tag e il link al repository; il sito manda gli stessi file del repository', async () => {
  const s = await accendi({ APP_REPOSITORY: 'https://github.com/esempio/repobay/' }, { versione: { commit: COMMIT, tag: 'rilascio-prova', data: '2026-10-23T08:53:00.000Z', modificato: false } });
  try {
    const r = await s.chiedi('/versione');
    assert.equal(r.headers.get('x-versione'), COMMIT);
    assert.deepEqual(await r.json(), { nome: 'Repobay', url: s.url, commit: COMMIT, tag: 'rilascio-prova', data: '2026-10-23T08:53:00.000Z', modificato: false,
      repository: 'https://github.com/esempio/repobay', link: `https://github.com/esempio/repobay/tree/${COMMIT}` });
    assert.equal((await s.chiedi('/non-esiste')).headers.get('x-versione'), COMMIT);   // anche sugli errori

    const e = await controllaVersione({ url: s.url });
    assert.equal(e.versione.commit, COMMIT);
    assert.deepEqual(e.diversi, []);
    assert.deepEqual(e.mancanti, []);
    assert.ok(e.uguali > 50, `confrontati solo ${e.uguali} file`);
  } finally { await s.chiudi(); }
});

test('controllaVersione trova un file cambiato sul sito', async () => {
  const s = await accendi();
  try {
    // un sito che manda uno script diverso da quello del repository
    const chiedi = async (u, o) => u.endsWith('/comune.js') ? new Response('alert("non è il codice del repository")') : fetch(u, o);
    const e = await controllaVersione({ url: s.url, chiedi });
    assert.deepEqual(e.diversi, ['comune.js']);
  } finally { await s.chiudi(); }
});
