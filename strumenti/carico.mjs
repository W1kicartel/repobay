// La prova di carico: tanti utenti insieme per qualche secondo, poi i tempi di risposta (mediana, 95° e 99° percentile) e gli
// errori per ogni tipo di richiesta. Uso: node strumenti/carico.mjs <url> <accessi.json> [utenti=200] [secondi=20]
// Va lanciata contro la demo (strumenti/demo.mjs), mai contro la piattaforma vera.
import { readFileSync } from 'node:fs';
import { Agent, request } from 'node:http';

const [url = 'http://localhost:4670', file, utenti = '200', secondi = '20'] = process.argv.slice(2);
if (!/localhost|127\.0\.0\.1/.test(url)) { console.error('Solo contro una demo in locale.'); process.exit(1); }
const acc = file ? JSON.parse(readFileSync(file, 'utf8')) : {};
const agente = new Agent({ keepAlive: true, maxSockets: Number(utenti) });
const u = new URL(url);
function chiama(metodo, percorso, corpo, biscotto) {
  return new Promise(ok => {
    const t0 = performance.now(), b = corpo ? JSON.stringify(corpo) : null;
    const r = request({ agent: agente, host: u.hostname, port: u.port, method: metodo, path: percorso,
      headers: { ...(b ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(b), origin: url } : {}), ...(biscotto ? { cookie: biscotto } : {}) } }, res => {
      res.resume(); res.on('end', () => ok({ stato: res.statusCode, ms: performance.now() - t0 }));
    });
    r.on('error', e => ok({ stato: 0, ms: performance.now() - t0, e: e.code })); r.setTimeout(15000, () => r.destroy()); if (b) r.write(b); r.end();
  });
}
// il miscuglio di quello che fa la gente: soprattutto guardare, un po' di area personale, qualche scrittura
const prodotti = ['pannello-di-controllo', 'tavoli', 'agenda-saloni', 'fattura-libera'];
const azioni = [
  [30, 'catalogo', () => chiama('GET', `/api/catalogo?q=${['', 'gestionale', 'cassa', 'negozi'][Math.floor(Math.random() * 4)]}`)],
  [25, 'prodotto', () => chiama('GET', `/api/prodotto?slug=${prodotti[Math.floor(Math.random() * 4)]}`)],
  [10, 'pagina', () => chiama('GET', '/p/pannello-di-controllo')],
  [10, 'area', () => chiama('GET', '/api/io', null, acc.installatore)],
  [8, 'notifiche', () => chiama('GET', '/api/notifiche', null, acc.builder)],
  [5, 'sessione', () => chiama('GET', '/api/sessione', null, acc.builder)],
  [4, 'contatto', () => chiama('POST', '/api/contatto', { installatore: 'x', nome: 'Prova', email: 'p@p.test', messaggio: 'Prova di carico', privacy: true })],
  [4, 'accesso-sbagliato', () => chiama('POST', '/api/accesso', { email: 'nessuno@demo.test', parola: 'sbagliata-davvero' })],
  [4, 'profilo', () => chiama('POST', '/api/io', { bio: `Prova ${Math.random()}` }, acc.nuovo)],
];
const totale = azioni.reduce((s, a) => s + a[0], 0);
const scegli = () => { let x = Math.random() * totale; for (const a of azioni) { if ((x -= a[0]) < 0) return a; } return azioni[0]; };
const misure = new Map();
const fine = Date.now() + Number(secondi) * 1000;
await Promise.all(Array.from({ length: Number(utenti) }, async () => {
  while (Date.now() < fine) {
    const [, nome, fn] = scegli(); const r = await fn();
    const m = misure.get(nome) || { tempi: [], stati: {} }; m.tempi.push(r.ms); m.stati[r.stato] = (m.stati[r.stato] || 0) + 1; misure.set(nome, m);
  }
}));
const p = (l, q) => l[Math.min(l.length - 1, Math.floor(l.length * q))].toFixed(1);
let n = 0, errori = 0;
console.log(`${utenti} utenti per ${secondi} s contro ${url}\n`);
console.log('richiesta'.padEnd(20), 'n'.padStart(7), 'al s'.padStart(7), 'p50 ms'.padStart(8), 'p95 ms'.padStart(8), 'p99 ms'.padStart(8), '  stati');
for (const [nome, m] of misure) {
  const t = m.tempi.sort((a, b) => a - b); n += t.length; errori += (m.stati[0] || 0) + (m.stati[500] || 0) + (m.stati[502] || 0) + (m.stati[503] || 0);
  console.log(nome.padEnd(20), String(t.length).padStart(7), (t.length / secondi).toFixed(0).padStart(7), p(t, .5).padStart(8), p(t, .95).padStart(8), p(t, .99).padStart(8), ' ', JSON.stringify(m.stati));
}
console.log(`\ntotale ${n} richieste, ${(n / secondi).toFixed(0)} al secondo, errori del server ${errori}`);
agente.destroy();
