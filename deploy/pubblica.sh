#!/usr/bin/env bash
# Copia il codice di Repobay dal Mac al server (in /opt/repobay) e, se il servizio c'è già, lo riavvia.
# Si lancia SUL MAC, dalla cartella del progetto:
#
#   bash deploy/pubblica.sh root@<indirizzo-del-server>
#
# Non copia mai: dati/ (il database di prova del Mac), test/, .git, node_modules, .env, i file .db e segreto.key; e non cancella
# sul server una cartella repobay-dati/ dentro il codice (può avere il file delle impostazioni con le chiavi).
# Sul server il database sta in /var/lib/repobay e non viene toccato.
set -euo pipefail

DEST="${1:-${REPOBAY_SERVER:-}}"
[[ -n $DEST ]] || { echo "uso: bash deploy/pubblica.sh root@<indirizzo-del-server>   (o REPOBAY_SERVER=root@…)"; exit 1; }
RADICE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ -f $RADICE/server/avvia.js ]] || { echo "non trovo server/avvia.js in $RADICE"; exit 1; }
SSH_OPZ=(-o ConnectTimeout=15 -o ServerAliveInterval=15)

echo "==> controllo il codice prima di mandarlo (sintassi dei file del server)"
for f in "$RADICE"/server/*.js "$RADICE"/server/rotte/*.js; do node --check "$f"; done

echo "==> versione.json: il commit da cui pubblichi (il sito lo mostra su /versione)"
# senza git il file non c'è e /versione dice che il commit non si conosce (meglio di un commit vecchio rimasto sul server)
node "$RADICE/strumenti/versione.mjs" > "$RADICE/versione.json" || rm -f "$RADICE/versione.json"

echo "==> $DEST: preparo /opt/repobay"
ssh "${SSH_OPZ[@]}" "$DEST" 'command -v rsync >/dev/null || (apt-get update -q && apt-get install -y -q rsync) >/dev/null; install -d -m 0755 /opt/repobay'

echo "==> copio il codice"
rsync -az --delete -e "ssh ${SSH_OPZ[*]}" \
  --exclude '/dati/' --exclude 'repobay-dati/' --exclude '/test/' --exclude '.git/' --exclude 'node_modules/' \
  --exclude '.env' --exclude '.env.local' --exclude '*.db' --exclude '*.db-wal' --exclude '*.db-shm' --exclude 'segreto.key' \
  --exclude '.DS_Store' --exclude '/graphify-out/' \
  "$RADICE/" "$DEST:/opt/repobay/"

echo "==> sul server: permessi e riavvio"
ssh "${SSH_OPZ[@]}" "$DEST" 'chown -R root:root /opt/repobay && chmod -R u=rwX,go=rX /opt/repobay
  if systemctl list-unit-files repobay.service >/dev/null 2>&1 && [ -f /etc/systemd/system/repobay.service ]; then
    systemctl restart repobay
    for i in $(seq 1 20); do curl -fsS -m 2 http://127.0.0.1:4600/salute >/dev/null 2>&1 && { echo "Repobay riacceso e risponde"; exit 0; }; sleep 1; done
    journalctl -u repobay -n 30 --no-pager; echo "ATTENZIONE: Repobay non risponde dopo il riavvio"; exit 1
  else
    echo "primo invio: ora sul server lancia  DOMINIO=<dominio> EMAIL=<tua email> bash /opt/repobay/deploy/installa.sh"
  fi'
