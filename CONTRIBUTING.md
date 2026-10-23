# Contribuire a Repobay

> **In English, in short.** Thanks for helping! Repobay is plain Node.js (22.13 or newer) with **no dependencies**: clone it and run
> `npm test` — there is nothing to install. The tests use fake Stripe, GitHub, email and blockchains, so they need no network and
> no keys. `npm run demo` starts the site with realistic fake data. Code, comments and UI text are written in Italian, with the
> English translation of every page string in `web/lingue/en/`; issues and pull requests in English are welcome. Open an issue
> before large changes, keep pull requests small, and never add a dependency, an external script or a real key. Security problems
> go through [SECURITY.md](SECURITY.md), never through a public issue. Contributions are licensed under the project's MIT license.
> New features need an issue labelled «accettata» first; at most three open pull requests per person; CI on pull requests from
> forks starts after a maintainer approves it; inactive pull requests close automatically; during traffic spikes we may limit
> for a few days who can open issues and pull requests.

Grazie di voler migliorare Repobay. Qui trovi come accenderlo, come girano le prove, le regole del codice e delle frasi, e come
proporre una modifica. Puoi scrivere in italiano o in inglese.

## Accenderlo in locale

Serve solo **Node.js 22.13 o più recente** (per `node:sqlite`). Non c'è niente da installare: niente `npm install`.

```bash
git clone <questo repository> repobay
cd repobay
npm test        # le prove: una decina di secondi
npm start       # il sito su http://localhost:4600, i dati in ./dati
```

Senza chiavi il sito parte lo stesso: le iscrizioni con l'email funzionano, le email finiscono nel terminale, i pagamenti con carta,
l'entrata con GitHub e le crypto restano spenti. All'avvio il server scrive cosa manca.

**Le pagine con dati finti.** `npm run demo` accende il sito su http://localhost:4610 con builder, installatori, prodotti, vendite e
clienti finti, più un finto Stripe e un finto GitHub: ogni bottone risponde. I biscotti di sessione per ogni ruolo (builder,
installatore, collaboratore, admin, cliente) sono in `/tmp/demo-4610/accessi.json`. `DEMO_LINGUA=en` fa i contenuti in inglese.

**Con le chiavi di prova** (Stripe in modalità test, un'app OAuth di GitHub, la posta): segui [docs/AVVIO.md](docs/AVVIO.md).
- Sul Mac `strumenti/avvia-locale.sh` prende le chiavi dal Portachiavi, così non finiscono mai in un file o nella cronologia, e si
  ferma se la chiave Stripe non è di prova (`sk_test_`).
- Su Linux o Windows metti le variabili in un file **fuori** dalla cartella del repository e avvia con
  `node --env-file=../repobay-env server/avvia.js`. Il modello commentato di tutte le variabili è [deploy/env.esempio](deploy/env.esempio).
- **Solo chiavi di prova, sempre.** Mai una chiave `sk_live_`, mai un segreto vero in un file del repository, in una issue o in una
  schermata. `.gitignore` tiene fuori `dati/`, `repobay-dati/`, `.env*` e i database.

**Le crypto in locale usano solo le reti di prova:** Base Sepolia, Solana Devnet, Bitcoin Testnet4 e Tron Nile
(`APP_RETI=base-sepolia,solana-devnet,bitcoin-testnet4,tron-nile`, che `avvia-locale.sh` mette da sé). Le monete si prendono dai
faucet. Al server bastano gli **indirizzi pubblici** dei wallet: una frase segreta o una chiave privata non servono mai e non vanno
mai scritte da nessuna parte.

## Le prove

```bash
npm test
```

Girano con `node:test`, una cartella temporanea per il database e **finti Stripe, GitHub, posta e blockchain**: niente rete, niente
chiavi. Le stesse prove girano nella GitHub Action su ogni pull request, con Node 22 e 24, insieme alla scansione dei segreti.

| File | Cosa controlla |
|---|---|
| `test/soldi.test.mjs` | la divisione dei pagamenti: le parti sommano sempre il totale, nessuna è negativa, gli esempi dei documenti tornano al centesimo |
| `test/stripe.test.mjs` | il giro completo con carta contro il finto Stripe, con due versioni dell'API: checkout, fatture, abbonamenti, webhook firmati, quote, versamenti, rimborsi |
| `test/blockchain.test.mjs` | il controllo dei pagamenti EVM contro una catena finta: importi, conferme, ora dell'ordine, pagatore unico, etichetta |
| `test/cripto.test.mjs` | Keccak, secp256k1, EIP-55, EIP-191, base58, bech32, Tron, Solana, TOTP, firme di Stripe, IBAN, partita IVA, codice fiscale, sui vettori pubblici delle specifiche |
| `test/markdown.test.mjs` | il README dei progetti trasformato in HTML sicuro |
| `test/app.test.mjs` | l'app via HTTP: intestazioni di sicurezza, iscrizione e conferma dell'email, accesso, entrata con GitHub, richieste da altre origini, webhook |
| `test/versione.test.mjs` | `/versione` e il confronto fra i file del sito e quelli del repository |

Una prova nuova va in `test/<argomento>.test.mjs`. Per accendere l'app con posta e GitHub finti c'è `accendi()` in
[test/aiuto.mjs](test/aiuto.mjs); il finto Stripe è [strumenti/finto-stripe.mjs](strumenti/finto-stripe.mjs).

Le prove con i servizi veri, quando servono:
- `node strumenti/prova-stripe.mjs` con una chiave `sk_test_` usa lo Stripe vero in modalità test (`--finto`: la stessa prova a secco);
- `node strumenti/prova-testnet.mjs --rete solana-devnet` (o `base-sepolia`, `tron-nile`, `bitcoin-testnet4`, `tutte`) paga davvero
  sulle reti di prova;
- il contratto escrow si prova con Foundry: [contratti/LEGGIMI.md](contratti/LEGGIMI.md).

## Le regole del codice

**Nessuna dipendenza.** `package.json` non ha `dependencies` e non ne avrà: solo i moduli di Node (`node:http`, `node:sqlite`,
`node:crypto`…). Niente pacchetti npm, niente script da CDN nelle pagine, niente bundler né passi di compilazione. Ogni riga che gira
si legge in questo repository: è il motivo per cui chiunque può controllare che non ci sia niente di nascosto. Quando serve qualcosa
di nuovo (un protocollo, una codifica) lo si scrive piccolo e con le sue prove, sui vettori ufficiali, come quelli in
`test/cripto.test.mjs`. Se pensi che una dipendenza serva davvero, apri prima una issue.

**Come è scritto.**
- Moduli ES (`import`), importazioni `node:…`, niente TypeScript.
- Nomi, commenti e messaggi **in italiano**, come il codice intorno. I commenti spiegano il perché, non il cosa.
- Il server: [server/app.js](server/app.js) tiene insieme le rotte di `server/rotte/*.js`, scritte come «METODO /percorso» →
  funzione; le impostazioni arrivano solo dalle variabili d'ambiente ([server/config.js](server/config.js)), mai dal codice.
- I soldi sono **interi in centesimi**, le quote frazioni (`0.05` = 5%), le unità dei token `BigInt`. Ogni divisione dà il resto a
  qualcuno: la somma delle parti è sempre il pagamento (lo controlla `test/soldi.test.mjs`).
- Il database: SQLite con migrazioni numerate in [server/db.js](server/db.js). Una migrazione nuova si aggiunge in fondo; quelle
  vecchie non si toccano mai, perché girano già sui server.
- Le pagine: HTML semplice e moduli ES in `web/`, sotto una CSP severa. Niente script o stili in linea, niente `onclick=`, niente
  risorse da altri domini; il testo che arriva da fuori si inserisce come testo, mai come HTML.
- Ogni dato segreto nel database è cifrato con `APP_SEGRETO` (`cifra`/`decifra` in `server/conti.js`).

**Le modifiche delicate** chiedono più attenzione e più prove: la divisione dei soldi (`server/soldi.js`, `server/web3.js`),
i webhook di Stripe, l'accesso e le sessioni, la crittografia, il contratto escrow (`contratti/`). Dillo nella pull request.

## Le regole delle frasi

Repobay parla a persone che non programmano: negozi, bar, saloni, tecnici. Le frasi devono capirle loro.
- Italiano piano: frasi corte, parole di tutti i giorni, il verbo nei pulsanti («Metti in vendita il tuo repo», non «Invia»).
- Le parole fisse: **installatore** (chi installa e vende l'installazione), **sviluppatore** (chi scrive il software), **attività**
  (chi compra), **Repobay**. Nel codice il nome della piattaforma non si scrive: viene da `APP_NOME`.
- Mai numeri finti, recensioni finte o promesse di guadagno. Gli esempi si scrivono come esempi.
- Ogni testo nuovo ha la sua traduzione inglese nel file della sua area in `web/lingue/en/` (`pubblico.json`, `area.json`,
  `prodotto.json`, `server.json` per i messaggi del server…), con la frase italiana come chiave e `{nome}` per le parti variabili.
  Le pagine si scrivono in italiano: la traduzione la applicano `web/lingua.js` nel browser e `server/lingue.js` sul server.
- I testi legali (`web/contratto.html`, `web/privacy.html`, `web/garanzia.html`) li cambia solo chi gestisce la piattaforma, con il suo
  avvocato: una correzione lì si propone in una issue.

## Proporre una modifica

1. **Prima una issue** per le modifiche grandi o per quelle che toccano i pagamenti: si decide insieme prima di scrivere il codice.
   Per le correzioni piccole (un errore, una frase, una prova in più) va bene direttamente la pull request.
2. Fai un fork e un ramo con un nome che dice cosa fa (`correggi-arrotondamento-mance`).
3. Una pull request fa una cosa sola. Aggiungi o aggiorna le prove; `npm test` deve passare.
4. Per le pagine metti una schermata, chiara e scura, anche dal telefono.
5. Nella descrizione: cosa cambia, perché, come l'hai provato. Il modello si compila da solo.
6. La GitHub Action deve essere verde: prove con Node 22 e 24, nessuna dipendenza, nessun segreto (gitleaks).

### Come gestiamo le pull request

Repobay lo mantengono poche persone. Perché ogni proposta riceva una revisione vera valgono queste regole:

- **Prima la issue, poi il codice**, per tutto quello che non è una correzione piccola: una funzione nuova arriva come pull request
  solo dopo che la sua issue ha l'etichetta «accettata». Senza, la pull request può essere chiusa senza una revisione completa.
- **Al massimo tre pull request aperte per persona.** Le altre aspettano che una si chiuda.
- **Le prove delle pull request che arrivano dai fork partono dopo un sì di chi mantiene il progetto.** Vedere «in attesa di
  approvazione» è normale: serve a non far girare codice sconosciuto senza uno sguardo.
- **Quello che è fermo si chiude da solo:** una pull request senza attività per 21 giorni prende l'etichetta «inattiva» e si chiude
  14 giorni dopo; una issue dopo 60 giorni, più 14. Un commento o un commit la tengono aperta, e si può sempre riaprire.
- **Niente modifiche in massa** senza un problema da risolvere (riformattare tutto, rinominare, cambiare lingua al codice, toccare
  molti file per una virgola): si chiudono.
- **Nei momenti di traffico molto alto** possiamo limitare per qualche giorno chi apre issue e pull request agli account che hanno
  già una storia su GitHub o che hanno già contribuito.

Contribuendo accetti che il tuo codice sia distribuito con la [licenza MIT](LICENSE) del progetto, e il
[codice di comportamento](CODE_OF_CONDUCT.md).

## Sicurezza

Una vulnerabilità non si scrive in una issue pubblica: segui [SECURITY.md](SECURITY.md). Le prove sul sito vero (repobay.net)
non si fanno: c'è chi incassa davvero. Accendi la tua copia in locale.
