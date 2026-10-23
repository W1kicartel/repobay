# Repobay sul computer di casa, per il prelancio

Questa guida mette Repobay online dal tuo computer fisso, col tuo dominio e il lucchetto HTTPS, senza aprire porte sul router e senza un IP fisso. Davanti c'è **Cloudflare Tunnel**: il computer apre lui una connessione verso Cloudflare, e i visitatori arrivano da lì.

È pensata per il **prelancio**: builder e installatori si iscrivono, il catalogo si riempie, le attività chiedono un preventivo. I pagamenti con carta e in crypto restano spenti. Prima di accenderli conviene spostarsi su un server in affitto ([LEGGIMI.md](LEGGIMI.md)): spostarsi vuol dire copiare la cartella dei dati e il file delle impostazioni.

Ci vogliono un paio d'ore, quasi tutte di attesa del DNS.

## Cosa serve

- Il computer fisso, acceso sempre, meglio col cavo di rete. Va bene macOS, Windows o Linux.
- Un dominio, comprato dove vuoi.
- Un account Cloudflare gratuito: il dominio passa sotto Cloudflare, che fa il tunnel e l'HTTPS.
- Una seconda app OAuth di GitHub, per il dominio vero.
- Un account Resend gratuito, per le email (link di accesso, notifiche).

Le chiavi e i token non vanno mai in chat né dentro la cartella del codice: stanno solo nel file delle impostazioni sul computer di casa.

---

## 1. Prepara il computer

**Che non si spenga mai.**

- macOS: Impostazioni di Sistema → Energia (o Risparmio energia): attiva «Impedisci lo stop automatico quando lo schermo è spento», «Riattiva per l'accesso alla rete» e «Avvia automaticamente dopo un'interruzione di corrente».
- Windows: Impostazioni → Sistema → Alimentazione → Sospensione: «Mai». In Windows Update imposta gli orari di attività, così non si riavvia nel momento sbagliato.
- Con **FileVault** acceso (macOS), dopo un blackout il Mac aspetta la password all'avvio e Repobay riparte solo dopo. Tienilo presente: lo vedi tu, non i visitatori.

**Node.js 22.13 o più recente** (consigliato il 24, LTS).

- macOS, con [Homebrew](https://brew.sh): `brew install node`. Senza Homebrew, l'installatore da [nodejs.org](https://nodejs.org).
- Windows: `winget install OpenJS.NodeJS.LTS` dal Terminale, oppure l'installatore da nodejs.org.
- Controlla con `node --version`.

**Due cartelle, fuori da Scrivania e Documenti** (su macOS i servizi in background non possono leggerle):

| | Il codice | I dati e le impostazioni |
|---|---|---|
| macOS | `~/repobay` | `~/repobay-dati` |
| Windows | `C:\repobay` | `C:\repobay-dati` |

## 2. Copia Repobay

Copia il codice (questo repository: `git clone`, oppure lo ZIP scaricato da GitHub) nella cartella del codice: con una chiavetta, AirDrop, o una cartella condivisa. Non serve copiare `dati/` né `node_modules/`: Repobay non ha dipendenze da installare.

Più comodo: accendi l'accesso SSH sul computer di casa, così il codice e gli aggiornamenti arrivano da un altro computer.
- macOS: Impostazioni di Sistema → Generali → Condivisione → «Login remoto».
- Windows: Impostazioni → Sistema → Funzionalità facoltative → aggiungi «Server OpenSSH».

## 3. Le impostazioni

Crea il file `env` nella cartella dei dati (`~/repobay-dati/env` o `C:\repobay-dati\env`). Per il prelancio basta questo; le altre voci sono spiegate in [env.esempio](env.esempio):

```
APP_NOME=Repobay
APP_URL=https://tuodominio.it
APP_PORTA=4600
APP_HOST=127.0.0.1
APP_CLOUDFLARE=1
APP_DATI=/Users/TUONOME/repobay-dati
APP_ADMIN=il-tuo-login-github
APP_SEGRETO=incolla-qui-la-stringa-casuale
APP_LINGUA=it
APP_PWNED=1
APP_PRELANCIO=1
APP_NON_RIVENDICATI=1
APP_NON_RIVENDICATI_PAGAMENTI=0
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
POSTA_DRIVER=console
POSTA_DA=Repobay <noreply@tuodominio.it>
COPIE_GIORNI=14
NODE_ENV=production
```

- Su Windows `APP_DATI=C:\repobay-dati`.
- `APP_HOST=127.0.0.1` fa sì che Repobay risponda solo al tunnel, non agli altri dispositivi di casa. `APP_CLOUDFLARE=1` gli fa leggere l'indirizzo vero di chi visita (serve ai limiti sui tentativi di accesso): vanno sempre insieme.
- `APP_ADMIN` è chi vede il Pannello: il tuo login GitHub o la tua email confermata.
- `APP_NON_RIVENDICATI=1` accende la vetrina dei progetti non ancora rivendicati dai loro maintainer; `APP_NON_RIVENDICATI_PAGAMENTI=0` li tiene solo a richiesta di preventivo. Dopo il primo accesso, nel Pannello → Non rivendicati premi «Carica la vetrina curata»: entrano i 48 progetti scelti, in una ventina di secondi.
- `APP_SEGRETO` cifra i dati delicati nel database. Generala così e **salvala anche nel tuo gestore di password**: senza, i dati cifrati non si leggono più.
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
- GitHub ed email li completi al passo 7. Finché `POSTA_DRIVER=console`, le email finiscono nel registro invece di partire.
- Su macOS proteggi il file: `chmod 600 ~/repobay-dati/env`.

## 4. Prova a mano

Dalla cartella del codice:

```bash
node --env-file=$HOME/repobay-dati/env server/avvia.js
```

Su Windows: `node --env-file=C:\repobay-dati\env server\avvia.js`.

Deve scrivere «Repobay è acceso». Apri http://127.0.0.1:4600/salute: deve rispondere `{"ok":true,…}`. Poi fermalo con Ctrl+C.

## 5. Sempre acceso: il servizio

Repobay deve partire da solo all'accensione e ripartire se si ferma.

**macOS.** Crea il file `it.repobay.plist` con questo contenuto, sostituendo `TUONOME` col tuo nome utente e il percorso di `node` con quello che ti dà `which node` (`/opt/homebrew/bin/node` sui Mac con chip Apple e Homebrew, `/usr/local/bin/node` con l'installatore di nodejs.org):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>it.repobay</string>
  <key>UserName</key><string>TUONOME</string>
  <key>WorkingDirectory</key><string>/Users/TUONOME/repobay</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/node</string>
    <string>--env-file=/Users/TUONOME/repobay-dati/env</string>
    <string>server/avvia.js</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/TUONOME/repobay-dati/repobay.log</string>
  <key>StandardErrorPath</key><string>/Users/TUONOME/repobay-dati/repobay.log</string>
</dict>
</plist>
```

Poi installalo come servizio di sistema (parte all'accensione, anche senza entrare nel Mac):

```bash
sudo cp it.repobay.plist /Library/LaunchDaemons/ && sudo chown root:wheel /Library/LaunchDaemons/it.repobay.plist && sudo chmod 644 /Library/LaunchDaemons/it.repobay.plist
```

```bash
sudo launchctl bootstrap system /Library/LaunchDaemons/it.repobay.plist
```

Per riavviarlo dopo un aggiornamento: `sudo launchctl kickstart -k system/it.repobay`.

**Windows.** Crea `C:\repobay-dati\avvia.cmd`:

```
@echo off
cd /d C:\repobay
"C:\Program Files\nodejs\node.exe" --env-file=C:\repobay-dati\env server\avvia.js >> C:\repobay-dati\repobay.log 2>&1
```

Poi apri **Utilità di pianificazione** → Crea attività:
- Generale: nome «Repobay», «Esegui indipendentemente dalla connessione dell'utente».
- Attivazione: Nuovo → «All'avvio».
- Azioni: Nuovo → Avvio programma → `C:\repobay-dati\avvia.cmd`.
- Condizioni: togli «Avvia l'attività solo se il computer è alimentato dalla rete elettrica».
- Impostazioni: «Se l'attività non riesce, riavvia ogni 1 minuto», tentativi 999; togli «Arresta l'attività se viene eseguita per più di 3 giorni».

Riavvia il computer e controlla di nuovo http://127.0.0.1:4600/salute.

**Linux.** Usa [repobay.service](repobay.service) con `EnvironmentFile` che punta al file `env`, e salta Caddy: davanti c'è il tunnel.

## 6. Il dominio e Cloudflare Tunnel

1. Su [dash.cloudflare.com](https://dash.cloudflare.com) aggiungi il dominio, piano Free. Cloudflare ti dà due nameserver: mettili al posto di quelli attuali, dal pannello di chi ti ha venduto il dominio. Il passaggio può richiedere da qualche minuto a qualche ora; Cloudflare ti scrive quando è attivo.
2. Apri **Zero Trust** (gratuito fino a 50 utenti, qui non serve nessun utente) → Networks → Tunnels → **Create a tunnel** → Cloudflared. Chiamalo `repobay-casa`.
3. Cloudflare ti mostra il comando per installare il connettore sul tuo sistema, con dentro un **token**: è una chiave, non incollarla in chat. Prima installa `cloudflared`:
   - macOS: `brew install cloudflared`, poi il comando che ti mostra, che inizia con `sudo cloudflared service install`.
   - Windows: `winget install --id Cloudflare.cloudflared`, poi il comando in un Terminale aperto come amministratore.
4. Nella scheda **Public Hostname** del tunnel aggiungi: sottodominio vuoto, il tuo dominio, tipo `HTTP`, URL `localhost:4600`. Se vuoi anche `www`, aggiungi una seconda riga uguale col sottodominio `www`.
5. Apri `https://tuodominio.it/salute`: deve rispondere come al passo 4, ma dal mondo.

Nelle impostazioni del dominio su Cloudflare lascia spento **Rocket Loader** (cambia gli script delle pagine).

## 7. GitHub ed email

**GitHub.** Crea una seconda OAuth App su https://github.com/settings/applications/new, meglio sotto un'organizzazione «repobay»:
- Homepage URL: `https://tuodominio.it`
- Authorization callback URL: `https://tuodominio.it/auth/github/ritorno`

Metti Client ID e Client secret in `GITHUB_CLIENT_ID` e `GITHUB_CLIENT_SECRET` nel file `env`.

**Email.** Su [resend.com](https://resend.com) → Domains → aggiungi il tuo dominio e i record DNS che ti chiede: con Cloudflare può aggiungerli lui. Poi API Keys → una chiave con permesso di invio. Nel file `env`:

```
POSTA_DRIVER=resend
POSTA_CHIAVE=la-chiave-di-resend
POSTA_DA=Repobay <noreply@tuodominio.it>
```

Riavvia il servizio (macOS `sudo launchctl kickstart -k system/it.repobay`; Windows: riavvia l'attività dall'Utilità di pianificazione) ed entra su `https://tuodominio.it` con GitHub: col tuo login vedi anche il Pannello.

## 8. Copie di sicurezza

- Repobay fa da solo una copia del database ogni giorno in `repobay-dati/copie` (le ultime `COPIE_GIORNI`). Sono sullo stesso disco: servono contro gli errori, non contro un guasto.
- Per i guasti, porta fuori la cartella `repobay-dati`: Time Machine su macOS, Cronologia file su Windows, oppure un disco esterno.
- `APP_SEGRETO` e il file `env` tienili anche nel gestore di password.

## 9. Aggiornare, e poi spostarsi

**Aggiornare:** si sostituisce la cartella del codice (le impostazioni e i dati stanno fuori, non si toccano) e si riavvia il servizio. Con l'accesso SSH si fa anche da un altro computer.

**Spostarsi su un server in affitto**, prima di accendere i pagamenti: segui [LEGGIMI.md](LEGGIMI.md), copia `repobay-dati` in `/var/lib/repobay` e il file `env` in `/etc/repobay/env` (con `APP_DATI=/var/lib/repobay`, senza `APP_HOST`, `APP_CLOUDFLARE=0`), poi sposta il DNS dal tunnel al server.

## Se qualcosa non va

- **Il sito non risponde:** prima `http://127.0.0.1:4600/salute` sul computer di casa. Se lì risponde, il problema è il tunnel (in Zero Trust lo stato del connettore deve essere «Healthy»); se non risponde, guarda `repobay-dati/repobay.log`.
- **Entrare con GitHub dà errore:** l'indirizzo di ritorno dell'app GitHub deve essere esattamente `https://tuodominio.it/auth/github/ritorno`, e `APP_URL` esattamente `https://tuodominio.it`, senza barra finale.
- **Le email non arrivano:** su Resend il dominio deve risultare verificato; finché `POSTA_DRIVER=console` finiscono nel registro.
- **Dopo un aggiornamento vedi la versione vecchia di una pagina:** su Cloudflare → Caching → Purge Everything.
