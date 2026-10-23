# Repobay: come si accende

## Sul Mac, in prova (chiavi di test)

Le chiavi non vanno mai nel codice, in un file o in chat: stanno nel Portachiavi del Mac. Il comando qui sotto chiede il valore senza mostrarlo; si fa una volta sola per ogni chiave.

1. **Stripe, in modalità test** (non serve la partita IVA):
   - iscriviti su dashboard.stripe.com e attiva «Modalità test»;
   - in Connect scegli «Piattaforma o marketplace»;
   - copia la chiave segreta `sk_test_…` da Sviluppatori → Chiavi API e salvala:
   ```bash
   security add-generic-password -a "$USER" -s repobay-stripe-test -w
   ```
   - in Impostazioni → Fatturazione → Abbonamenti e email, alla voce «Gestisci i pagamenti non riusciti», scegli che dopo l'ultimo tentativo l'abbonamento resti **non pagato** (non «annulla»): così chi ha avuto un problema con la carta paga e riparte senza la riattivazione, come scrivono le Condizioni (art. 14);
   - nel portale clienti (Impostazioni → Fatturazione → Portale clienti) lascia attivi la disdetta a fine periodo e il ripristino: fino alla fine del periodo pagato il cliente ci ripensa da lì, senza costi.
2. **GitHub.** Crea un'app OAuth su github.com/settings/applications/new:
   - Homepage URL: `http://localhost:4600`
   - Authorization callback URL: `http://localhost:4600/auth/github/ritorno`

   Poi salva il Client ID e il Client secret:
   ```bash
   security add-generic-password -a "$USER" -s repobay-github-id -w
   security add-generic-password -a "$USER" -s repobay-github-secret -w
   ```
   La piattaforma non chiede permessi su GitHub: legge solo i dati pubblici e verifica che il builder sia amministratore del repository.
3. **Email** (facoltativa in locale: senza, finiscono nel terminale). Prendi una chiave API di Resend e salvala:
   ```bash
   security add-generic-password -a "$USER" -s repobay-posta -w
   ```
4. **Avvio.** Il tuo indirizzo email ti apre il pannello di chi gestisce, dopo la conferma:
   ```bash
   APP_ADMIN=la-tua@email.it bash strumenti/avvia-locale.sh
   ```
   In locale le crypto usano solo le reti di prova: Base Sepolia, Solana Devnet, Bitcoin Testnet4 e Tron Nile.
5. **Prova il giro completo** su http://localhost:4600:
   1. il builder entra con GitHub, mette in vendita un repository, sceglie la sua percentuale, completa descrizione e guida, e lo manda in revisione;
   2. tu lo pubblichi dal Pannello;
   3. chi vende si iscrive, conferma l'email, supera il test del corso, offre il prodotto con il suo prezzo e copia il suo link;
   4. dal link si paga con la carta di prova `4242 4242 4242 4242` (scadenza futura, CVC qualsiasi);
   5. nell'area compaiono la vendita e le quote «in attesa».

Le prove automatiche con lo Stripe vero:

```bash
STRIPE_CHIAVE=$(security find-generic-password -a "$USER" -s repobay-stripe-test -w) node strumenti/prova-stripe.mjs
```

## Le impostazioni

Sono tutte variabili d'ambiente. Il modello completo e commentato è [deploy/env.esempio](../deploy/env.esempio). Le principali:

| Variabile | Cosa | Predefinito |
|---|---|---|
| `APP_NOME` | il nome della piattaforma (compare ovunque) | `Repobay` |
| `APP_URL` | l'indirizzo pubblico, in https quando è online | `http://localhost:4600` |
| `APP_PORTA`, `APP_DATI` | la porta e la cartella del database (le copie giornaliere in `dati/copie`) | `4600`, `dati` |
| `APP_ADMIN` | email (confermate) o login GitHub che vedono il Pannello, separati da virgola | — |
| `APP_SEGRETO` | la chiave che cifra gettoni, dati fiscali e 2FA; se manca se ne crea una in `dati/segreto.key` (copiala al sicuro) | — |
| `APP_LINGUA` | la lingua predefinita, `it` o `en` | `it` |
| `APP_PRELANCIO` | niente pagamenti, solo richieste di preventivo (si cambia anche dal Pannello) | spento |
| `APP_HOST` | l'indirizzo su cui ascolta: `127.0.0.1` quando davanti c'è Caddy o Cloudflare Tunnel | tutta la rete |
| `APP_CLOUDFLARE` | il sito arriva da Cloudflare Tunnel: l'indirizzo di chi visita si legge da `CF-Connecting-IP` (solo con `APP_HOST=127.0.0.1`; vedi `deploy/CASA.md`) | spento |
| `APP_REPOSITORY` | il repository pubblico del codice (`https://github.com/…`): `/versione` mostra il commit che gira e ci porta | — |
| `APP_PWNED` | controlla le password nuove su Have I Been Pwned (k-anonimato) | spento |
| `APP_NON_RIVENDICATI` | i progetti in vetrina prima che il maintainer si iscriva; dal Pannello si carica anche la vetrina curata (`server/vetrina.json`) | spento |
| `APP_NON_RIVENDICATI_PAGAMENTI` | i pagamenti sui progetti non ancora rivendicati: spenti, prendono solo richieste di preventivo (prima l'avvocato decide dove vanno i soldi di chi non rivendica) | spento |
| `STRIPE_CHIAVE` | se manca: iscrizioni e pagamenti in crypto sì, carta no (la pagina prodotto mostra solo il pannello crypto o il modulo preventivo) | — |
| `QUOTA_PIATTAFORMA` | la parte della piattaforma sui pagamenti con carta (installazioni, aggiornamenti, mance), su quello che resta dopo il costo di Stripe | `0.05` |
| `QUOTA_PIATTAFORMA_CRYPTO` | la parte della piattaforma sui pagamenti in crypto (nessun intermediario da pagare) | `0.01` |
| `CARTA_COSTO_STRIPE` | `1`: con carta, prima della divisione si toglie il costo vero di Stripe di quel pagamento (la `fee` della balance transaction, senza ricarichi; se manca, la stima), diviso fra le righe della fattura. `0`: il costo resta alla piattaforma, che lo paga dalla sua parte. Il sovrapprezzo al cliente non si fa (PSD2, art. 62) | `1` |
| `STRIPE_STIMA_PERCENTUALE`, `STRIPE_STIMA_FISSO` | la stima del costo di Stripe che le pagine mostrano prima di pagare (carte europee standard; le carte aziendali o extra UE costano di più): la percentuale e la parte fissa in centesimi | `0.015`, `25` |
| `QUOTA_INSTALLATORE` | la parte di chi vende sull'installazione, tolti Stripe e la piattaforma, quando chi sviluppa non ha scelto la sua percentuale (`0.20` = 80% a chi sviluppa); installatore e builder possono concordarne un'altra, fra loro due e prodotto per prodotto | `0.20` |
| `PERCENTUALE_MASSIMA` | la percentuale più alta che chi sviluppa può scegliere su quello che resta dell'installazione dopo Stripe e la piattaforma (chi vende tiene sempre almeno il resto: con `0.80`, il 20%) | `0.80` |
| `LIVELLI_VENDITORE` | i livelli di chi vende, prodotto per prodotto: «vendite:fattore» sulla parte di chi sviluppa. Con il predefinito, dopo 10 vendite dello stesso prodotto chi sviluppa prende i 13/16 della sua percentuale (80% → 65%, a chi vende il 35%), dopo 25 i 5/8 (80% → 50%, a chi vende il 50%) | `10:13/16,25:5/8` |
| `ASSISTENZA_PIATTAFORMA` | `1`: risponde per primo chi ha installato; chi gestisce (`APP_ADMIN`) vede ogni richiesta, può coinvolgere chi sviluppa e interviene se nessuno risponde; il canone mensile, tolto Stripe, va a chi ha installato (`QUOTA_INSTALLATORE_ASSISTENZA`) e alla piattaforma. `0`: il modello vecchio, il canone si divide come l'installazione e la piattaforma non vede le richieste | `1` |
| `QUOTA_INSTALLATORE_ASSISTENZA` | la parte di chi ha installato sul canone dell'assistenza, tolto Stripe, fissata alla vendita; il resto, tolta la parte di chi sviluppa, alla piattaforma. Se chi ha installato non è più iscritto, la sua parte resta alla piattaforma | `0.60` |
| `QUOTA_SVILUPPATORE_ASSISTENZA` | la parte di chi sviluppa sul canone dell'assistenza, tolto Stripe, divisa con i collaboratori e fissata alla vendita; 0 per difetto: chi sviluppa non può dare assistenza da un altro paese, il suo ricorrente sono gli aggiornamenti garantiti | `0` |
| `ASSISTENZA_MESE` | il canone mensile dell'assistenza, in centesimi: uno solo per tutti i prodotti; si cambia anche dal Pannello | `3750` |
| `MONITOR_MINUTI` | ogni quanti minuti si controlla da fuori l'indirizzo pubblico del programma di chi ha l'assistenza attiva (giù dopo due controlli falliti: avvisi alla squadra, a chi ha installato e al cliente; rapporto del mese per email). Repobay non entra mai nei server dei clienti | `5` |
| `MONITOR_LOCALI` | `1` solo nelle prove: permette di controllare indirizzi locali (localhost, reti private), che in produzione sono rifiutati | `0` |
| `TARIFFA_ORA` | la tariffa oraria degli interventi a chiamata per chi non ha l'assistenza attiva, in centesimi: la squadra manda il preventivo a mezz'ore, il cliente paga prima del lavoro, l'incasso è della piattaforma | `9000` |
| `RIATTIVAZIONE_MESI`, `RIATTIVAZIONE_GIORNI` | chi chiude l'abbonamento e poi lo riattiva paga una volta questi mesi di canone (diviso come il canone); in crypto, se rinnova più di questi giorni dopo la scadenza. Le Condizioni (art. 14) e la Garanzia (art. 6) scrivono i valori: se li cambi, cambia anche quei testi | `3`, `30` |
| `MANCIA_MASSIMA` | la mancia più alta che chi sviluppa può mandare a chi vende, in centesimi (la più bassa è `PREZZO_MINIMO`); si tolgono il costo di Stripe e la parte della piattaforma, solo con carta | `50000` |
| `QUOTA_INSTALLATORE_AGGIORNAMENTI` | la parte di chi vende sugli aggiornamenti garantiti; il resto, tolti Stripe e la piattaforma, va a chi sviluppa | `0` |
| `PREZZO_MINIMO`, `TRATTENUTA_GIORNI` | il prezzo minimo in centesimi (anche dell'installazione decisa da chi vende, che arriva al massimo a 50.000 €), i giorni prima di versare | `500`, `14` |
| `GRAZIA_GIORNI`, `SCONTO_ANNO`, `RISPOSTA_ORE` | dopo quanti giorni senza pagamento l'assistenza si sospende (il programma mai), lo sconto pagando un anno in anticipo, entro quante ore chi risponde ai clienti (la piattaforma, o chi installa con `ASSISTENZA_PIATTAFORMA=0`) risponde prima del sollecito | `7`, `0.10`, `24` |
| `SICUREZZA_CLAMSCAN`, `SICUREZZA_TRIVY`, `SICUREZZA_MAX_MB` | i programmi dell'antivirus e del controllo dei componenti sul server (vuoti = solo OpenSSF Scorecard), la dimensione massima dell'archivio di una release | vuoti, vuoti, `300` |
| `STRIPE_CHIAVE`, `STRIPE_FIRMA` | la chiave e i segreti dei webhook (separati da virgola) | — |
| `STRIPE_PER_CONTO` | il venditore davanti al cliente è l'installatore (on_behalf_of): vedi il commercialista | spento |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_ORE` | l'app OAuth; ogni quante ore si rileggono i progetti | —, `6` |
| `POSTA_DRIVER`, `POSTA_DA`, `POSTA_CHIAVE` | `console`, `file`, `smtp`, `resend`, `postmark`, `brevo`, `sendgrid`, `mailgun` | `console` |
| `SMTP_HOST`, `SMTP_PORTA`, `SMTP_SICURO`, `SMTP_UTENTE`, `SMTP_PAROLA` | per il driver smtp | 587 |
| `TELEGRAM_BOT`, `TELEGRAM_NOME` | il bot delle notifiche (da @BotFather) | — |
| `APP_RETI` | le reti crypto accese | `base,ethereum,arbitrum,polygon` |
| `APP_WALLET`, `WALLET_SOLANA`, `WALLET_BITCOIN`, `WALLET_TRON` | gli indirizzi che ricevono la parte della piattaforma (una rete senza indirizzo resta spenta) | — |
| `RPC_<RETE>`, `TRONGRID_CHIAVE` | RPC dedicati (es. `RPC_SOLANA`), la chiave di TronGrid | pubblici |
| `ESCROW_<RETE>` | l'indirizzo del contratto escrow su quella rete EVM (es. `ESCROW_BASE`): dove c'è, il pagamento resta nel contratto finché il cliente non conferma; dove manca, va dritto nei wallet | — |
| `CRYPTO_MESI`, `CRYPTO_MINUTI` | i mesi di assistenza pagati in anticipo in crypto, la validità di un prezzo | `12`, `30` |
| `BONIFICO_IBAN`, `BONIFICO_INTESTATARIO`, `BONIFICO_BIC` | il pagamento con bonifico sul tuo conto, con una causale per ordine (RB-XXXXXX) e il QR per l'app della banca; lo segni ricevuto dal pannello, a mano o incollando l'estratto conto. Solo quando a installare sei tu (APP_ADMIN), anche nel prelancio | vuoti (spento) |
| `BONIFICO_MESI`, `BONIFICO_GIORNI` | i mesi di assistenza pagati in anticipo (3–24), per quanti giorni vale un ordine | `12`, `10` |
| `POS_ALIAS`, `POS_CHIAVE`, `POS_PROVA` | la carta dal POS virtuale della tua banca (Nexi XPay): il cliente paga sulla pagina della banca, l'esito firmato arriva a `/api/carta/esito` e la vendita si registra da sola. Stesse regole del bonifico | vuoti (spento) |
| `QUOTA_PIATTAFORMA_BONIFICO` | la parte della piattaforma su cui si calcola quella di chi sviluppa, nei pagamenti diretti | `0.05` |

## Prima di andare online

- **Commercialista:**
  - partita IVA e inquadramento: quale codice ATECO e quale cassa INPS;
  - come si fatturano i business;
  - incasso «in nome e per conto» (`STRIPE_PER_CONTO`);
  - la comunicazione DAC7.
- **Avvocato:**
  - condizioni e privacy (`web/contratto.html`, `web/privacy.html`);
  - i punti segnati «da decidere», soprattutto i progetti non rivendicati.
- **Stripe live:** il profilo Connect completo e la verifica del conto con la partita IVA.
- **Dominio e email:** i record SPF, DKIM e DMARC del dominio, perché le email non finiscano nello spam.

## La garanzia per chi compra

- Con carta le quote restano alla piattaforma `TRATTENUTA_GIORNI` (14) giorni. Dalla sua area il cliente **conferma** l'installazione (`POST /api/cliente/conferma`) o **segnala** un problema (`POST /api/cliente/segnala`): le quote in attesa di quell'acquisto passano a `contestata` e il job dei versamenti le salta.
- Chi gestisce decide in `/admin#contestazioni` (`POST /api/admin/contestazione`): `regolare` (le quote ripartono), `rimborso` (solo carta: `POST /v1/refunds` su Stripe, poi il webhook `charge.refunded` storna le quote), `annullata`. Il cliente riceve l'esito per email, installatore e builder una notifica.
- Ogni installatore porta con sé le installazioni confermate e le segnalazioni degli ultimi 12 mesi (pagina prodotto). Tre segnalazioni serie in 90 giorni lo sospendono da sole.
- In crypto, sulle reti EVM con `ESCROW_<RETE>`, il pagamento entra nel contratto escrow (`contratti/LEGGIMI.md`): le quote nascono `in_escrow` e diventano `versata` quando il contratto paga (conferma del cliente, o trattenuta finita e chiunque chiama `release`), `annullata` se i soldi tornano al cliente, un po' e un po' se l'arbitro divide. Il cliente congela dal wallet o segnalando sul sito (allora chi gestisce riceve un'email e congela dal pannello, come arbitro); la decisione si prende in `/admin#contestazioni` con «Decidi sul contratto», firmata dal wallet dell'arbitro; la segnalazione sul sito si chiude da sola con l'esito del contratto. Se la piattaforma non decide entro la finestra (60 giorni), il cliente si riprende tutto da solo.
- Sulle reti senza contratto (Solana, Bitcoin, Tron, o EVM senza `ESCROW_<RETE>`) il pagamento è diretto fra wallet: la piattaforma non può rimborsarlo; la segnalazione resta sul profilo. La pagina `/garanzia` spiega tutto ai clienti.
