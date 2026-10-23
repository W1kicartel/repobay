// Scrive su stdout il contenuto di versione.json: il commit da cui si pubblica, il suo tag (se il commit ne ha uno) e la data.
// Si lancia dalla cartella del repository, prima di copiare il codice sul server (deploy/pubblica.sh lo fa da solo):
//
//   node strumenti/versione.mjs > versione.json
//
// Se ci sono modifiche non salvate in un commit, il file lo dice («modificato»: true) e /versione lo mostra: il commit da solo non
// descrive il codice che gira. Esce con 1 se qui non c'è un repository git.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const radice = fileURLToPath(new URL('..', import.meta.url));
const git = (...a) => execFileSync('git', a, { cwd: radice, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

let commit;
try { commit = git('rev-parse', 'HEAD'); } catch { console.error('qui non c\'è un repository git: versione.json non si può scrivere'); process.exit(1); }
let tag = null;
try { tag = git('describe', '--tags', '--exact-match', 'HEAD'); } catch { }
// versione.json stesso è ignorato da git, quindi non conta come modifica
const modificato = git('status', '--porcelain', '--untracked-files=no') !== '';
if (modificato) console.error('attenzione: ci sono modifiche non salvate in un commit; /versione lo dirà («modificato»: true)');
if (!tag) console.error('attenzione: il commit non ha un tag di rilascio (git tag rilascio-AAAA-MM-GG-HHMM)');
console.log(JSON.stringify({ commit, tag, data: new Date().toISOString(), modificato }, null, 2));
