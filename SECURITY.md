# Sicurezza

> **In English.** Please report vulnerabilities **privately**, never in a public issue: open the **Security** tab of this repository
> and choose **Report a vulnerability**. Only the maintainers see the report. Do not test against repobay.net — it handles real
> payments; run your own copy locally (see CONTRIBUTING.md). Italian or English are both fine.

Repobay muove soldi veri (carte con Stripe, crypto) e tiene dati personali: una vulnerabilità si segnala **in privato**, mai in una
issue, in una discussione o in una pull request pubblica.

## Come segnalarla

1. Apri la scheda **Security** di questo repository e scegli **Report a vulnerability** (la segnalazione privata di GitHub).
2. La leggono solo i maintainer del progetto. Da lì ci scriviamo, prepariamo la correzione insieme in un ramo privato e, quando è
   in produzione, pubblichiamo l'avviso con il tuo nome, se lo vuoi.

Scrivi, in italiano o in inglese:
- cosa si può fare e con quali conseguenze (per esempio: leggere i dati di un altro conto, cambiare una divisione dei soldi, firmare
  al posto di qualcun altro);
- i passi per rifarlo su una copia **in locale**, con il commit (`git rev-parse HEAD`) o quello che dice `/versione`;
- se l'hai già detto ad altri.

Non mettere nella segnalazione chiavi, password o dati di persone vere: se ne hai visti, dillo e basta.

## Cosa conta

- Il codice di questo repository: server, pagine, script di installazione (`server/installa.js`, `server/bolla.js`), contratto escrow
  (`contratti/`), file di `deploy/`.
- Quello che gira su repobay.net, se viene da questo codice.
- In particolare: la divisione dei pagamenti, i webhook di Stripe, la verifica dei pagamenti in crypto, l'accesso (password, link,
  passkey, 2FA, GitHub), le sessioni, i permessi del pannello, la cifratura dei dati nel database, la CSP delle pagine.

Non contano: gli attacchi che chiedono di avere già il controllo del server o del computer di chi usa il sito, lo spam, i limiti di
traffico, i servizi esterni (Stripe, GitHub, le blockchain) quando il problema è loro.

## Le regole per chi cerca

- **Niente prove su repobay.net.** Accendi la tua copia (`npm start` o `npm run demo`, vedi [CONTRIBUTING.md](CONTRIBUTING.md)):
  il codice è lo stesso, e sul sito vero ci sono persone che incassano.
- Niente accessi ai dati di altri, niente pagamenti veri, niente attacchi che rallentano il servizio, niente ingegneria sociale.
- Dacci il tempo di correggere prima di parlarne in pubblico. Rispondiamo appena possibile; se dopo 14 giorni non hai notizie,
  scrivi di nuovo nella stessa segnalazione.

Chi segnala in buona fede e rispetta queste regole non ha niente da temere da noi. Al momento non c'è un programma di ricompense.

## Le versioni

Si corregge solo l'ultima versione su `main`, che è quella che va in produzione. Quale commit gira su repobay.net lo dice
`https://repobay.net/versione`: vedi «Che codice gira sul sito» nel [README](README.md).
