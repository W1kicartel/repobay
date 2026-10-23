// Il giro completo dei pagamenti con carta contro il finto Stripe (strumenti/finto-stripe.mjs), con le forme degli oggetti delle
// due versioni dell'API: conti connessi, checkout, fatture e abbonamenti, webhook firmati, quote, versamenti, rimborsi e storni.
// È la stessa prova di strumenti/prova-stripe.mjs, a secco: niente rete, niente chiavi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const prova = fileURLToPath(new URL('../strumenti/prova-stripe.mjs', import.meta.url));
// l'ambiente della prova senza le chiavi di chi la lancia: la prova a secco non deve mai vedere una STRIPE_CHIAVE vera
const ambiente = versione => Object.fromEntries(Object.entries({ ...process.env, FINTO_VERSIONE: versione }).filter(([k]) => !/^(STRIPE_|GITHUB_|POSTA_|TELEGRAM_)/.test(k)));

for (const versione of ['2025-03-31.basil', '2024-06-20']) {
  test(`prova-stripe --finto, API ${versione}: tutti i passi riusciti`, async () => {
    const { codice, uscita } = await new Promise(ok => execFile(process.execPath, [prova, '--finto'], { env: ambiente(versione), timeout: 120_000, maxBuffer: 16 * 1024 * 1024 },
      (e, stdout, stderr) => ok({ codice: e ? e.code ?? 1 : 0, uscita: stdout + stderr })));
    const passi = uscita.match(/(\d+) passi su (\d+) riusciti/);
    assert.ok(passi, `nessun rapporto finale:\n${uscita.slice(-3000)}`);
    assert.equal(passi[1], passi[2], uscita.slice(-3000));
    assert.equal(codice, 0, uscita.slice(-3000));
  });
}
