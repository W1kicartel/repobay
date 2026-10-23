# Repobay su un server vero

Questi sono i passi per mettere Repobay online su un server Linux, anche se non hai mai gestito un server. Ci vuole circa un'ora, quasi tutta di attesa.

Alla fine avrai:

- il server con Ubuntu 24.04;
- Repobay acceso come servizio, che riparte da solo se si blocca o se il server si riavvia;
- Caddy davanti, con il lucchetto HTTPS rinnovato da solo (Let's Encrypt);
- il firewall aperto solo su SSH, HTTP e HTTPS;
- gli aggiornamenti di sicurezza automatici;
- una copia del database ogni giorno.

I file di questa cartella:

| File | Cosa fa | Dove finisce sul server |
|---|---|---|
| `pubblica.sh` | copia il codice dal Mac al server, con `versione.json` (lo lanci sul **Mac**) | `/opt/repobay` |
| `installa.sh` | prepara il server: Node, Caddy, utente, servizio, firewall (lo lanci sul **server**) | — |
| `repobay.service` | il servizio systemd, con le protezioni | `/etc/systemd/system/repobay.service` |
| `Caddyfile` | HTTPS, compressione, limiti e log | `/etc/caddy/Caddyfile` |
| `env.esempio` | tutte le impostazioni, commentate | `/etc/repobay/env` (con le tue chiavi) |

---

## 1. Compra il server

1. Iscriviti su [Hetzner Cloud](https://console.hetzner.cloud) e crea un progetto.
2. Prima di creare il server, prepara la tua chiave SSH, che serve per entrare senza password. Nel Terminale del Mac:
   ```bash
   ls ~/.ssh/id_ed25519.pub || ssh-keygen -t ed25519 -C "repobay"   # premi Invio alle domande, metti una passphrase
   pbcopy < ~/.ssh/id_ed25519.pub                                   # la chiave pubblica è ora negli appunti
   ```
3. **Add Server**:
   - **Location**: Germania o Finlandia, va bene qualsiasi.
   - **Image**: Ubuntu 24.04.
   - **Type**: CX22 o simile, con 2 vCPU, 4 GB di RAM e 40 GB di disco. Costa pochi euro al mese ed è più che sufficiente per partire.
   - **Networking**: lascia sia IPv4 sia IPv6.
   - **SSH keys**: incolla la chiave (Cmd+V).
   - **Backups**: consigliati. Costano circa il 20% del prezzo del server e fanno una copia dell'intero disco ogni giorno, fuori dal server.
   - Dai un nome al server e crealo.
4. Annota i due indirizzi del server, l'**IPv4** (es. `203.0.113.10`) e l'**IPv6** (es. `2a01:4f8:…::1`).
5. Prova a entrare: `ssh root@203.0.113.10`. Alla prima volta rispondi `yes`, poi esci con `exit`.

## 2. Fai puntare il dominio al server (DNS)

Dal pannello di chi ti ha venduto il dominio (Aruba, Register, Cloudflare, OVH…), nella sezione «DNS» o «zona DNS», crea questi record:

| Tipo | Nome | Valore | TTL |
|---|---|---|---|
| `A` | `@` (il dominio nudo) | l'IPv4 del server | 300 |
| `AAAA` | `@` | l'IPv6 del server | 300 |
| `CNAME` | `www` | il tuo dominio, es. `tuodominio.it.` | 300 |

- Se ci sono già record `A` o `AAAA` su `@` che puntano altrove (la pagina di parcheggio del registrar), cancellali.
- Su **Cloudflare** metti la nuvola **grigia** («DNS only»), almeno all'inizio. Con la nuvola arancione, Caddy vedrebbe gli indirizzi di Cloudflare al posto di quelli dei visitatori.

**Se hai più domini**, scegline **uno** come principale: è quello che metti in `DOMINIO`, nell'app OAuth di GitHub, in Resend e nelle condivisioni. Gli altri devono solo rimandare lì, così i motori di ricerca vedono un sito solo: crea per ciascuno gli stessi record `A`, `AAAA` e `CNAME www` verso il server, poi nel `Caddyfile` togli il `#` al blocco «Gli altri domini» mettendo i tuoi, e `systemctl reload caddy`. Caddy fa il certificato anche per loro.

Per controllare, dal Mac (può volerci da qualche minuto a qualche ora):

```bash
dig +short tuodominio.it A       # deve rispondere con l'IPv4 del server
dig +short tuodominio.it AAAA    # deve rispondere con l'IPv6 del server
```

## 3. Primo avvio

Sul **Mac**, dalla cartella del progetto:

```bash
cd ~/repobay                               # la cartella del repository
bash deploy/pubblica.sh root@203.0.113.10
```

Poi entra nel **server** e lancia l'installazione, con il tuo dominio e la tua email:

```bash
ssh root@203.0.113.10
DOMINIO=tuodominio.it EMAIL=tu@example.com bash /opt/repobay/deploy/installa.sh
```

Ci mette qualche minuto. Alla fine stampa cosa resta da fare. Se si interrompe, legge l'errore e lo spiega: correggi e rilancialo, perché si può ripetere senza danni.

### Le chiavi

Le chiavi si mettono in un file solo, sul server:

```bash
nano /etc/repobay/env        # Ctrl+O, Invio per salvare; Ctrl+X per uscire
systemctl restart repobay
```

- **Stripe**:
  - `STRIPE_CHIAVE`: la trovi in Dashboard → Sviluppatori → Chiavi API. Usa `sk_test_…` finché provi e `sk_live_…` quando incassi davvero.
  - Webhook: in Dashboard → Sviluppatori → Webhook, aggiungi l'endpoint `https://tuodominio.it/api/stripe/webhook` con gli eventi `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`, `customer.subscription.updated` e `customer.subscription.deleted`.
  - **Pagamenti che non arrivano** (Dashboard → Impostazioni → Billing):
    - *Recupero dei ricavi → Tentativi*: attiva gli Smart Retries per 2 settimane. Alla fine dei tentativi scegli «segna l'abbonamento come non pagato» (non «annulla»): così riparte da solo quando il cliente paga. L'assistenza la sospende Repobay dopo `GRAZIA_GIORNI` (7).
    - *Email ai clienti*: attiva gli avvisi per i pagamenti non riusciti e per le carte in scadenza.
    - *Portale clienti*: le disdette valgono **alla fine del periodo di fatturazione**; lascia cambiare carta e scaricare le fatture.
    - *Metodi di pagamento*: attiva l'addebito diretto SEPA, adatto alle attività (il conto non scade come una carta). Il primo addebito arriva in qualche giorno: Repobay lo segna «in arrivo» e dice all'installatore di aspettare.
  - Aggiungi un secondo endpoint, con lo stesso indirizzo, per gli **eventi dei conti connessi**, con l'evento `account.updated`.
  - I due segreti `whsec_…` vanno in `STRIPE_FIRMA`, separati da una virgola.
- **GitHub**: su github.com → Settings → Developer settings → OAuth Apps → New:
  - Homepage `https://tuodominio.it`
  - Callback `https://tuodominio.it/auth/github/ritorno`

  Copia l'ID in `GITHUB_CLIENT_ID` e il segreto in `GITHUB_CLIENT_SECRET`.
- **Posta**: `POSTA_DRIVER` e la chiave del servizio scelto. Tutte le opzioni sono in `env.esempio`.
- **`APP_SEGRETO`**: la genera l'installazione. **Copiala subito in un posto sicuro**, per esempio il Portachiavi del Mac o un gestore di password. Cifra i dati fiscali e i gettoni nel database: se la perdi, quei dati non si leggono più, nemmeno da una copia.

### Il controllo

```bash
curl -sS https://tuodominio.it/salute     # {"ok":true,"nome":"Repobay"}
systemctl status repobay               # «active (running)»
journalctl -u repobay -f               # i messaggi del server (Ctrl+C per uscire)
journalctl -u caddy -f                 # qui vedi quando arriva il certificato HTTPS
```

Se il lucchetto non arriva, quasi sempre è il DNS: controlla con `dig` che `A` e `AAAA` siano giusti. Se l'IPv6 è sbagliato, Let's Encrypt fallisce: o correggi il record o cancelli il record `AAAA`.

### I controlli di sicurezza sulle release

Prima di dire a chi installa «aggiorna i tuoi clienti», Repobay controlla ogni release nuova. Il punteggio pubblico di OpenSSF Scorecard c'è sempre; l'antivirus e il controllo dei componenti partono se sul server ci sono ClamAV e Trivy. ClamAV usa circa 1 GB di memoria mentre controlla: con un server da 2 GB va bene, perché si controlla una release alla volta.

```bash
sudo apt-get install -y clamav
sudo systemctl stop clamav-freshclam && sudo freshclam && sudo systemctl start clamav-freshclam
sudo apt-get install -y wget gnupg
wget -qO - https://aquasecurity.github.io/trivy-repo/deb/public.key | gpg --dearmor | sudo tee /usr/share/keyrings/trivy.gpg > /dev/null
echo "deb [signed-by=/usr/share/keyrings/trivy.gpg] https://aquasecurity.github.io/trivy-repo/deb generic main" | sudo tee /etc/apt/sources.list.d/trivy.list
sudo apt-get update && sudo apt-get install -y trivy
```

Poi nel file delle impostazioni: `SICUREZZA_CLAMSCAN=/usr/bin/clamscan` e `SICUREZZA_TRIVY=/usr/bin/trivy`, e riavvia Repobay. Una release con un virus non viene annunciata: lo sanno chi la sviluppa e chi gestisce la piattaforma, che dal pannello la sblocca se è un falso allarme.

## 4. Aggiornare

Quando hai cambiato il codice sul Mac:

```bash
cd ~/repobay                               # la cartella del repository
npm test                                   # prima le prove
bash deploy/pubblica.sh root@203.0.113.10  # copia e riavvia
```

`pubblica.sh` controlla la sintassi, scrive `versione.json` (sotto, «Che codice gira sul sito») e copia solo il codice. Non tocca il database né `/etc/repobay/env`. Poi riavvia il servizio e controlla che risponda.

Le migrazioni del database partono da sole all'avvio. Prima di un aggiornamento grosso, però, fai una copia a mano (vedi sotto).

Se cambi `repobay.service` o il `Caddyfile`, rilancia anche `installa.sh` sul server: rimette i file al loro posto e riavvia.

### Che codice gira sul sito

Chi usa il sito deve poter controllare che giri il codice del repository pubblico. Per questo `pubblica.sh` scrive, prima di
copiare, il file `versione.json` con il commit da cui pubblichi, il suo tag e la data (`node strumenti/versione.mjs`). Il server lo
legge all'avvio e lo mostra su `https://tuodominio.it/versione` e nell'intestazione `x-versione` di ogni risposta. Con
`APP_REPOSITORY=https://github.com/<organizzazione>/repobay` nel file delle impostazioni, `/versione` porta anche al commit nel repository.

Le regole, perché il commit dica il vero:

1. si pubblica solo da una copia del **repository pubblico**, dopo `git pull`, mai da una cartella con modifiche non salvate in un
   commit (`/versione` direbbe `"modificato": true`);
2. prima le prove, poi il tag del rilascio, poi la copia:
   ```bash
   npm test
   git tag rilascio-$(date +%F-%H%M) && git push origin main --tags
   bash deploy/pubblica.sh root@203.0.113.10
   curl -sS https://tuodominio.it/versione
   ```
3. se copi il codice a mano invece che con `pubblica.sh`, dalla cartella del repository scrivi anche la versione, poi riavvia:
   ```bash
   node strumenti/versione.mjs > /opt/repobay/versione.json
   ```

Chiunque può poi controllare dal suo computer:

```bash
git clone https://github.com/<organizzazione>/repobay && cd repobay
git checkout <il commit di /versione>
node strumenti/controlla-versione.mjs https://tuodominio.it
```

Lo script scarica dal sito pagine, script, stili e immagini e li confronta byte per byte con i file di quel commit: esce con 0 solo
se tutto coincide. **Cosa dimostra:** il codice che arriva nel browser è quello del repository, compreso quello che prepara i
pagamenti da firmare col wallet. **Cosa non dimostra:** il codice del server. `/versione` è una dichiarazione di chi gestisce il
server, che potrebbe farne girare un altro; la garanzia sta nelle regole qui sopra e nelle prove e nella scansione dei segreti che
girano su ogni commit nella GitHub Action. Per andare oltre servono build riproducibili e un'attestazione firmata dell'ambiente
che esegue il server: è fra i lavori aperti nel README.

## 5. Le copie del database

**Automatiche.** Il server fa da solo una copia al giorno in `/var/lib/repobay/copie/AAAA-MM-GG.db` e ne tiene 14, valore che si cambia con `COPIE_GIORNI`. Le copie sono coerenti anche mentre il server lavora (`VACUUM INTO`, vedi `server/lavori.js`).

**Fuori dal server.** Le copie automatiche stanno sullo stesso disco. Tienine anche fuori:
- attiva i Backups di Hetzner;
- e ogni tanto scaricale sul Mac:

```bash
rsync -az root@203.0.113.10:/var/lib/repobay/copie/ ~/Documents/repobay-copie/
```

**Una copia a mano, adesso:**

```bash
sqlite3 /var/lib/repobay/officina.db ".backup '/var/lib/repobay/copie/a-mano-$(date +%F-%H%M).db'"
```

**Recuperare una copia** (es. quella del 10 ottobre):

```bash
systemctl stop repobay
cd /var/lib/repobay
mkdir -p rotto && mv officina.db officina.db-wal officina.db-shm rotto/ 2>/dev/null || true   # il database attuale, da parte
cp copie/2026-10-10.db officina.db
chown repobay:repobay officina.db && chmod 640 officina.db
sqlite3 officina.db 'PRAGMA integrity_check;'    # deve rispondere «ok»
systemctl start repobay
```

Tutto quello che è successo dopo la copia (iscrizioni, vendite) va perso. I pagamenti però restano su Stripe e si possono ricostruire dagli eventi, dalla Dashboard di Stripe → Webhook → rimanda.

Per una copia scaricata sul Mac, prima la rimandi al server con `scp ~/Documents/repobay-copie/2026-10-10.db root@203.0.113.10:/var/lib/repobay/copie/` e poi segui gli stessi passi.

## 6. Cosa c'è di sicuro, e perché

- **Il servizio** gira come utente `repobay`, senza privilegi:
  - il codice in `/opt/repobay` è di root e il servizio non lo può modificare;
  - l'unica cartella scrivibile è `/var/lib/repobay`;
  - niente accesso a `/home`, ai dispositivi o al kernel;
  - limiti di memoria (1 GB), di processi e di CPU.

  I dettagli sono commentati in `repobay.service`.
- **Caddy** è l'unico esposto su Internet:
  - Node ascolta sulla porta 4600, che il firewall chiude da fuori;
  - Caddy riscrive `X-Forwarded-For` con l'indirizzo vero del visitatore, così nessuno può aggirare i limiti di tentativi fingendo un altro indirizzo.
- **Il firewall** (`ufw`) lascia aperte solo le porte 22 (SSH, con un limite ai tentativi), 80 e 443.
- **Gli aggiornamenti di sicurezza** di Ubuntu si installano da soli ogni notte. Se serve un riavvio, il server si riavvia alle 4:30 e Repobay riparte da solo.
- **Node e Caddy** si aggiornano con `apt-get update && apt-get upgrade`, quando lo decidi tu, e poi `systemctl restart repobay caddy`.

## 7. Problemi comuni

| Cosa vedi | Cosa fare |
|---|---|
| `installa.sh`: «manca il codice in /opt/repobay» | lancia prima `pubblica.sh` dal Mac |
| il sito non si apre, `curl` va in timeout | `ufw status` deve mostrare 80 e 443; nel pannello Hetzner non devono esserci «Firewalls» che li chiudono |
| errore di certificato | DNS sbagliato o non ancora propagato: `dig`, poi `systemctl restart caddy` |
| `systemctl status repobay` dice «failed» | `journalctl -u repobay -n 50`: di solito un valore sbagliato in `/etc/repobay/env` (il messaggio dice quale) |
| «manca STRIPE_FIRMA» nei messaggi | il webhook rifiuta tutto finché non metti i `whsec_…` |
| il disco si riempie | `du -sh /var/lib/repobay/* /var/log/caddy`; abbassa `COPIE_GIORNI` |

## Come sono stati controllati questi file

- `bash -n` su `installa.sh` e `pubblica.sh` (sintassi).
- Il servizio e il Caddyfile si controllano sul server, perché sul Mac non ci sono né systemd né Caddy. `installa.sh` lo fa da solo, e a mano sono questi comandi:

  ```bash
  systemd-analyze verify /etc/systemd/system/repobay.service
  systemd-analyze security repobay          # il punteggio delle protezioni (più basso è meglio)
  runuser -u caddy -- env HOME=/var/lib/caddy $(cat /etc/caddy/repobay.env | xargs) caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile
  caddy fmt --diff /etc/caddy/Caddyfile     # solo la formattazione
  ```
