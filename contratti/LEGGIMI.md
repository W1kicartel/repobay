# Il contratto escrow

`src/RepobayEscrow.sol` è il contratto che tiene i pagamenti in crypto sulle reti EVM finché il cliente non conferma l'installazione. Uno per rete (Base, Ethereum, Arbitrum, Polygon; Base Sepolia per le prove). Il server non ha chiavi: legge il contratto, prepara le chiamate, e le firma il wallet di chi agisce (il cliente, chi riceve, l'arbitro).

I commenti del contratto e delle prove sono in inglese: è il codice che finisce verificato sull'esploratore della rete e che un revisore esterno legge.

## Cosa fa

Per ogni ordine il sito sceglie un `id` (SHA-256 di `ordine:<codice>`, lo stesso prefisso dell'etichetta dei pagamenti diretti). Il contratto lo archivia sotto `key = keyOf(pagatore, id)` = `keccak256(abi.encode(pagatore, id))`: chi copia l'id da una transazione in attesa e deposita prima finisce sotto un'altra chiave e non blocca il cliente. Dopo il deposito tutte le funzioni prendono la chiave.

| Chi | Funzione | Quando | Effetto |
|---|---|---|---|
| il cliente | `deposit(id, token, total, deadline, payees, amounts)` | all'ordine, entro `deadline` | l'intero importo entra nel contratto con la divisione già scritta (`keccak256(abi.encode(payees, amounts))`); dopo la scadenza del prezzo il contratto rifiuta (`TooLate`), così un pagamento tardivo non resta fermo |
| il cliente | `confirm(key, payees, amounts)` | finché è `HELD` | «installato e funziona»: paga tutti |
| chiunque | `release(key, payees, amounts)` | `HELD`, dopo `hold` secondi | stessa uscita: il silenzio vale come conferma |
| il cliente o l'arbitro | `dispute(key)` | finché è `HELD` | congela |
| l'arbitro | `resolve(key, payees, amounts, payouts)` | `DISPUTED` | a ciascuno al massimo la sua parte, il resto torna al cliente |
| il cliente | `refund(key)` | `DISPUTED`, dopo `window` secondi senza decisione | tutto al cliente: una piattaforma morta non blocca i soldi |
| chiunque | `withdraw(token)` | sempre | ritira quello che un pagamento fallito ha lasciato in `owed` |

Niente proprietario, niente aggiornamenti, niente funzione per spostare i fondi altrove. Un destinatario che non può ricevere (un contratto che rifiuta, un indirizzo in lista nera del token) non blocca gli altri: la sua parte resta in `owed`. I pagamenti in moneta della rete non copiano la risposta del destinatario (niente «return bomb»). I token con commissione sul trasferimento sono rifiutati (`BadAmount`), un indirizzo senza codice non vale come token. `hold` e `window` hanno un massimo di 365 giorni, così un errore alla pubblicazione (millisecondi al posto dei secondi) non chiude i soldi per decenni. L'arbitro si cambia in due passi (`proposeArbiter` / `acceptArbiter`).

Quello che il contratto non può impedire, e va detto: l'arbitro decide le contestazioni (può dare tutto al cliente, mai a sé stesso o a terzi), quindi il suo wallet va tenuto su un dispositivo hardware o una multisig. Monete o token mandati all'indirizzo del contratto senza `deposit` restano lì per sempre: non c'è nessuno che possa spostarli.

## Revisione di sicurezza (12 ottobre 2026)

Rilettura riga per riga, contratto e integrazione. Corretto:

- **Id occupato da chi copia la transazione** (front-running sulle reti con mempool pubblica, Ethereum e Polygon): l'ordine ora sta sotto `keyOf(pagatore, id)`.
- **Deposito tardivo bloccato**: senza scadenza, un deposito arrivato a prezzo scaduto restava nel contratto e il sito chiedeva un nuovo ordine (il cliente pagava due volte). Ora `deposit` ha `deadline`.
- **Deposito non segnalato** (pagina chiusa subito dopo la firma): il server lo cerca da solo negli eventi `Deposited`, dal blocco in cui è nato l'ordine fino alla scadenza.
- **Return bomb** sui pagamenti in moneta della rete, **token senza codice** che sembrava pagare, **periodi assurdi** al costruttore.
- Lato sito: l'hash che il browser manda dopo un'azione si registra solo se la sua ricevuta ha un evento del contratto per quell'ordine; USDT su Ethereum (autorizzazione da azzerare prima) e il deposito mandato prima che l'autorizzazione fosse registrata, nei wallet senza conferma unica.

Le prove Foundry coprono ognuno di questi casi (`test_copiedIdCannotBlockTheBuyer`, `test_depositAfterDeadlineIsRefused`, `test_depositRefusesAddressWithoutCode`, `test_constructorRefusesAbsurdPeriods`, `test_resolveCannotRedirectToNewPayees`) più il fuzz sulle invarianti. Prima della mainnet resta una revisione esterna.

## Provare e pubblicare

Serve [Foundry](https://getfoundry.sh) (`forge`). Le prove non dipendono da forge-std: usano i cheatcode direttamente.

```bash
cd contratti && forge build && forge test -vv
```

```bash
cd contratti && forge test --fuzz-runs 5000 --match-test testFuzz
```

Pubblicare su Base Sepolia (l'arbitro è il wallet che deciderà le contestazioni; 14 giorni di trattenuta, 60 di finestra):

```bash
cd contratti && forge create src/RepobayEscrow.sol:RepobayEscrow --rpc-url https://sepolia.base.org --interactive --broadcast --constructor-args 0xARBITRO 1209600 5184000
```

`--interactive` chiede la chiave privata nel terminale: non va mai in un file né in chat. Poi la verifica del sorgente sull'esploratore (`forge verify-contract <indirizzo> src/RepobayEscrow.sol:RepobayEscrow --chain base-sepolia --constructor-args $(cast abi-encode "constructor(address,uint64,uint64)" 0xARBITRO 1209600 5184000)`), così chiunque legge il codice dietro all'indirizzo.

Infine l'indirizzo nelle impostazioni del server: `ESCROW_BASE_SEPOLIA=0x…` (per le altre reti `ESCROW_BASE`, `ESCROW_ETHEREUM`, `ESCROW_ARBITRUM`, `ESCROW_POLYGON`). Una rete senza `ESCROW_<RETE>` continua con i pagamenti diretti.

Prima della mainnet: una revisione esterna del contratto (è piccolo, un audit costa poco) e una prova completa su Base Sepolia con USDC di faucet (deposito, conferma, congelamento, decisione, rimborso per silenzio).

## Dal lato del server

- `server/escrow.js`: la codifica ABI, le chiamate (`approve` + `deposit` per i token, `deposit` col valore per la moneta nativa), la lettura di `orders(id)` con `eth_call`, l'evento `Deposited` nella ricevuta, l'evento `Resolved` per sapere quanto a chi, la divisione delle decisioni (`pagamentiDecisi`).
- `server/custodia.js`: porta lo stato del contratto nel database: quote `in_escrow` → `versata` / `annullata` (in proporzione se l'arbitro divide), la conferma dell'installazione, le segnalazioni che si aprono e chiudono da sole, gli avvisi («puoi incassare»).
- Rotte: `GET /api/crypto/escrow?codice=` (stato e dati delle azioni), `POST /api/crypto/escrow/stato` (rilegge il contratto adesso), `POST /api/admin/escrow/risolvi` (i dati della decisione, da firmare col wallet dell'arbitro).
- Il giro periodico (`lavori.js`, ogni `CONTROLLO_MINUTI`) rilegge gli ordini ancora aperti sul contratto; un altro giro, ogni minuto, cerca i depositi che il browser non ha segnalato (`cercaDepositi` in `server/rotte/crypto.js`).
- Prove: `test/escrow.test.mjs` con una catena finta in memoria.
