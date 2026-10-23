# Repobay

> **In English.** [Repobay](https://repobay.net) is a marketplace for open-source software installed in real local businesses.
> Developers list the public GitHub repositories they maintain and choose their share. Installers — anyone who passes a short
> course, even without coding — pick products from the catalog, set their own installation price, install them for shops, cafés
> and salons nearby, and provide monthly support with the platform behind them. Every payment splits itself between developer,
> installer and platform: by card through Stripe Connect, or in crypto without anyone holding other people's money (an escrow
> contract on EVM networks, direct wallet payments elsewhere). Installed software never stops because of a missed payment: only
> the support does.
>
> The code is Node.js 22 with **no dependencies**, SQLite and plain HTML, under the MIT license. Code, comments and UI are written
> in Italian, and the whole interface has an English translation. Start with `npm test` (fake Stripe, GitHub, email and blockchains:
> no network, no keys) and `npm run demo`. Contributions are welcome: read [CONTRIBUTING.md](CONTRIBUTING.md), and report
> vulnerabilities privately as explained in [SECURITY.md](SECURITY.md). Each release served by the site states its commit at
> `/versione`, and `node strumenti/controlla-versione.mjs <site>` compares what the site sends to browsers with this repository
> (see «Che codice gira sul sito» below).

**Il software open source, installato nelle attività vere.** Repobay mette insieme tre ruoli:
- **builder**: chi scrive software open source e lo mette in vendita dal suo repository GitHub; sceglie solo la sua percentuale;
- **chi vende** (gli installatori): chiunque superi il corso, anche senza saper programmare. Sceglie i programmi dal catalogo, decide il prezzo dell'installazione e li installa nelle attività della sua zona;
- **business**: negozi, bar, saloni, che pagano l'installazione e l'assistenza mensile, che dà la piattaforma.

Ogni pagamento si divide da solo:
- con carta, prima il costo vero di Stripe di quel pagamento (letto dalla transazione, senza ricarichi; `CARTA_COSTO_STRIPE=0` lo lascia alla piattaforma), poi alla piattaforma il 5% di quello che resta (`QUOTA_PIATTAFORMA`); in crypto l'1% (`QUOTA_PIATTAFORMA_CRYPTO`), su tutto. Prima di pagare le pagine mostrano la stima di Stripe, 1,5% + 0,25 € (`STRIPE_STIMA_PERCENTUALE`, `STRIPE_STIMA_FISSO`). Al cliente non si aggiunge niente: con le carte dei consumatori il sovrapprezzo è vietato (PSD2, art. 62), il costo è dentro la divisione;
- il prezzo dell'installazione lo decide chi vende, prodotto per prodotto (da 5 € a 50.000 €): lo stesso programma ha prezzi diversi da una persona all'altra, e il cliente confronta prezzo, recensioni e installazioni confermate;
- di quello che resta dell'installazione, chi sviluppa prende la percentuale che ha scelto, da 0 all'80% (`PERCENTUALE_MASSIMA` 0.80), o l'80% se non la sceglie (`QUOTA_INSTALLATORE` 0.20), divisa con gli eventuali collaboratori; il resto a chi vende, di regola il 20%. Una percentuale più bassa attira più persone che vendono. Una percentuale cambiata vale per le vendite nuove, e chi vende riceve un avviso;
- i livelli di chi vende, prodotto per prodotto (`LIVELLI_VENDITORE` 10:13/16,25:5/8): chi vende si guadagna una parte più alta vendendo lo stesso prodotto. Dopo 10 vendite la parte di chi sviluppa scende ai 13/16 (80% → 65%, a chi vende il 35%), dopo 25 ai 5/8 (80% → 50%, a chi vende il 50%), sui pagamenti da quel momento; chi vende riceve l'avviso e il badge «Top seller», dopo 25 vendite «Top seller oro»;
- il canone mensile dell'assistenza (`ASSISTENZA_MESE`, 37,50 € al mese, uno solo per tutti i prodotti, si cambia dal Pannello): risponde per primo chi ha installato, la piattaforma vede ogni richiesta, controlla il programma da fuori, manda il rapporto del mese e interviene se lui non risponde. Tolto Stripe, il 60% va a chi ha installato (`QUOTA_INSTALLATORE_ASSISTENZA`) e il resto alla piattaforma; a chi sviluppa `QUOTA_SVILUPPATORE_ASSISTENZA` (0: il suo ricorrente sono gli aggiornamenti garantiti);
- gli aggiornamenti garantiti, la riga facoltativa a prezzo di chi sviluppa: tolti Stripe e la piattaforma, tutto a chi sviluppa;
- le mance: chi sviluppa ringrazia chi vende i suoi prodotti, con carta, da 5 a 500 € (`MANCIA_MASSIMA`): tolti Stripe e il 5% della piattaforma, il resto a chi vende;
- installatore e builder possono concordare un'altra divisione, fra loro due e prodotto per prodotto: prende il posto della percentuale e vale per le vendite successive, mentre ogni vendita tiene la divisione del giorno in cui è fatta.

Il software installato non si blocca mai per un pagamento mancato (art. 392 c.p.): si ferma solo l'assistenza.

Si paga con carta, tramite Stripe Connect, oppure in crypto senza che nessuna persona tenga i soldi degli altri: sulle reti EVM il wallet del business deposita in un contratto escrow che paga builder, installatore e piattaforma quando il cliente conferma l'installazione (o da solo dopo 14 giorni), con la piattaforma come arbitro; sulle altre reti paga direttamente i wallet, e il server controlla sulla blockchain.

## Cosa c'è

- **Conti:**
  - email con conferma, GitHub, link d'accesso, passkey, verifica in due passaggi con app e codici di recupero;
  - elenco delle sessioni attive con il dispositivo, e avviso per gli accessi da un dispositivo nuovo;
  - esportazione e cancellazione dei dati.
- **Builder:**
  - solo repository pubblici con licenza OSI di cui è amministratore, comprese le organizzazioni;
  - revisione prima della pubblicazione;
  - la propria percentuale sull'installazione (da 0 all'80%, di regola l'80%), e le mance a chi vende;
  - collaboratori con una parte della quota del builder;
  - sincronizzazione automatica di README, stelle, licenza e release; una release nuova avvisa gli installatori;
  - badge per il README.
- **Installatori:**
  - il corso con il test, prodotti per zona con il proprio prezzo (con un prezzo di partenza proposto), link personale, richieste dei business, recensioni;
  - i livelli «Top seller» prodotto per prodotto e le mance di chi sviluppa;
  - una divisione diversa, proposta e accettata con il builder di un prodotto.
- **Business:**
  - catalogo con ricerca full-text, pagina prodotto con README, installatori e recensioni;
  - pagamento con carta (una tantum o abbonamento) o in crypto;
  - area clienti con il portale Stripe (carta, fatture, disdetta) e le recensioni;
  - assistenza dalla piattaforma: la bolla nel programma, la pagina di assistenza e l'area clienti.
- **Crypto:**
  - USDC, EURC, USDT ed ETH su Base, Ethereum, Arbitrum e Polygon (conferma unica con EIP-5792), con il contratto escrow `contratti/src/RepobayEscrow.sol` dove è pubblicato;
  - SOL, USDC e USDT su Solana (una transazione, e Solana Pay dal telefono);
  - BTC (QR per ogni parte, la piattaforma trova il pagamento da sola);
  - TRX e USDT su Tron;
  - i wallet si provano con una firma.
- **Integrazioni:**
  - webhook firmati con tentativi ripetuti;
  - Telegram, Discord e Slack;
  - REST API v1 con chiavi, documentata in OpenAPI;
  - email via SMTP, Resend, Postmark, Brevo, SendGrid o Mailgun.
- **Per chi gestisce:**
  - pannello con numeri, revisione, utenti, recensioni e versamenti;
  - esportazione DAC7;
  - modalità prelancio (solo richieste di preventivo);
  - progetti non rivendicati (dietro un interruttore, prima serve il parere legale);
  - copie giornaliere del database.
- **Lingue:** italiano e inglese, per pagine, email e messaggi del server.

## Com'è fatto

- **Codice:** Node ≥ 22.13, **nessuna dipendenza**.
- **Dati:** SQLite (`node:sqlite`) con migrazioni numerate.
- **Pagine:** HTML semplice con moduli ES e una CSP severa.
- **Crittografia e protocolli** scritti in JS puro: secp256k1, Keccak, ed25519, base58, bech32, CBOR/WebAuthn, TOTP, QR, SMTP, Markdown.

## Prove

```bash
npm test
```

Girano con finti Stripe, GitHub, posta e blockchain: niente rete, niente chiavi. Cosa controlla ogni file è in
[CONTRIBUTING.md](CONTRIBUTING.md#le-prove); la GitHub Action le fa girare su ogni pull request, con la scansione dei segreti.

Per provare con i servizi veri in modalità test:
- `strumenti/prova-stripe.mjs` usa lo Stripe vero in modalità test;
- `strumenti/prova-testnet.mjs` usa le reti di prova vere.

Per guardare le pagine con dati realistici:

```bash
npm run demo        # http://localhost:4610, con finti Stripe e GitHub
```

## Accenderla

- **Sul Mac, con le chiavi di prova:** [docs/AVVIO.md](docs/AVVIO.md).
- **Su un server:** [deploy/LEGGIMI.md](deploy/LEGGIMI.md).

## Contribuire

Chi vuole migliorare Repobay è benvenuto, in italiano o in inglese. Si parte così:

```bash
git clone <questo repository> repobay && cd repobay
npm test
npm run demo
```

Non c'è niente da installare. Le regole in breve: nessuna dipendenza, codice e testi in italiano con la traduzione inglese delle
pagine, le prove insieme al codice, mai una chiave vera. Tutto il resto, dallo stile delle frasi a come proporre una modifica, è in
[CONTRIBUTING.md](CONTRIBUTING.md). Le vulnerabilità si segnalano in privato: [SECURITY.md](SECURITY.md). Vale il
[codice di comportamento](CODE_OF_CONDUCT.md).

## Cosa manca

I lavori aperti sul codice, dove un aiuto serve davvero (meglio aprire prima una issue):

- **Stripe Accounts v2** per i conti di sviluppatori e installatori, al posto di Accounts v1 che Stripe sconsiglia alle piattaforme nuove.
- **Un promemoria al cliente prima della fine dei 14 giorni** di trattenuta, così chi ha un problema lo segnala prima che i soldi partano.
- **Un bottone per ritirare dal contratto escrow i pagamenti rimasti in sospeso** quando un trasferimento a un wallet fallisce: oggi si fa a mano.
- **I pagamenti crypto diretti arrivati tardi o con la pagina chiusa** (Solana, Bitcoin, Tron, reti EVM senza escrow): il server deve
  trovarli da solo, come fa già con l'escrow.
- **Le prove del contratto escrow nella GitHub Action** (Foundry, `contratti/`), e una revisione esterna del contratto prima che ci
  passino soldi veri.
- **Più prove automatiche**: le rotte dei pagamenti in crypto, l'assistenza, il pannello, il corso.
- **Una prova più forte di quello che gira sul server**: build riproducibili e un'attestazione firmata, oltre a `/versione`.
- **Altre lingue** oltre all'italiano e all'inglese.

## Che codice gira sul sito

Il codice è pubblico, ma questo da solo non dice che il server esegua proprio questo codice. Per questo ogni rilascio dichiara da
quale commit viene, e una parte si controlla da fuori:

- `https://repobay.net/versione` dice il commit di questo repository da cui viene il codice in produzione, il tag del rilascio
  (`rilascio-AAAA-MM-GG-HHMM`) e se c'erano modifiche fuori dal commit; lo stesso commit è nell'intestazione `x-versione` di ogni risposta;
- `node strumenti/controlla-versione.mjs https://repobay.net`, lanciato dopo `git checkout <quel commit>`, scarica dal sito pagine,
  script, stili e immagini e li confronta byte per byte con i file del repository.

Così si controlla davvero tutto quello che arriva nel browser, compreso il codice che prepara i pagamenti da firmare con il wallet.
Il codice del server invece resta una dichiarazione: la garanzia è il metodo (si pubblica solo da un commit con tag di questo
repository, dopo le prove e la scansione dei segreti), non una prova crittografica. I dettagli, e come si pubblica, sono in
[deploy/LEGGIMI.md](deploy/LEGGIMI.md#che-codice-gira-sul-sito).

Licenza MIT.
