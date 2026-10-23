#!/usr/bin/env bash
# Prepara un server Ubuntu 24.04 per Repobay. Si lancia SUL SERVER, come root, dopo aver copiato il codice con
# deploy/pubblica.sh dal Mac:
#
#   DOMINIO=tuodominio.it EMAIL=tu@example.com bash /opt/repobay/deploy/installa.sh
#
# Si può rilanciare quante volte si vuole (idempotente): non tocca /etc/repobay/env se esiste già, né il database.
# Fa: Node 22 (repository ufficiale NodeSource, pacchetti firmati) e Caddy (repository ufficiale), l'utente «repobay»,
# le cartelle, il servizio systemd, il Caddyfile, il firewall (22, 80, 443) e gli aggiornamenti di sicurezza automatici.
set -euo pipefail

CODICE=/opt/repobay
DATI=/var/lib/repobay
CONF=/etc/repobay
QUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOMINIO="${DOMINIO:-${1:-}}"
EMAIL="${EMAIL:-${2:-}}"

passo() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
muori() { printf '\nERRORE: %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- controlli
[[ $EUID -eq 0 ]] || muori "serve root: sudo DOMINIO=… EMAIL=… bash $0"
. /etc/os-release
[[ ${ID:-} == ubuntu ]] || muori "questo script è per Ubuntu (trovato: ${PRETTY_NAME:-sconosciuto})"
[[ ${VERSION_ID:-} == 24.04 ]] || echo "attenzione: provato su Ubuntu 24.04, qui c'è ${VERSION_ID:-?}: continuo"
[[ -f $CODICE/server/avvia.js ]] || muori "manca il codice in $CODICE: dal Mac lancia prima  bash deploy/pubblica.sh root@<indirizzo-del-server>"
if [[ -z $DOMINIO && -f /etc/caddy/repobay.env ]]; then DOMINIO="$(sed -n 's/^DOMINIO=//p' /etc/caddy/repobay.env)"; fi
if [[ -z $EMAIL && -f /etc/caddy/repobay.env ]]; then EMAIL="$(sed -n 's/^ACME_EMAIL=//p' /etc/caddy/repobay.env)"; fi
[[ $DOMINIO =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$ ]] || muori "DOMINIO mancante o non valido (es. DOMINIO=tuodominio.it, minuscolo, senza https://)"
[[ $EMAIL =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || muori "EMAIL mancante o non valida (serve a Let's Encrypt per gli avvisi sui certificati)"

export DEBIAN_FRONTEND=noninteractive

# ---------------------------------------------------------------- pacchetti di base
passo "Pacchetti di base"
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg rsync ufw unattended-upgrades sqlite3 openssl \
  debian-keyring debian-archive-keyring apt-transport-https

# ---------------------------------------------------------------- Node 22 da NodeSource
# Il repository ufficiale NodeSource: apt controlla la firma di ogni pacchetto con la chiave in /etc/apt/keyrings.
passo "Node.js 22 (repository NodeSource)"
install -d -m 0755 /etc/apt/keyrings
if [[ ! -s /etc/apt/keyrings/nodesource.gpg ]]; then
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  chmod 0644 /etc/apt/keyrings/nodesource.gpg
fi
echo "chiave NodeSource:"; gpg --show-keys --with-fingerprint /etc/apt/keyrings/nodesource.gpg 2>/dev/null | sed 's/^/    /' || true
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
# il nodejs di NodeSource vince su quello (più vecchio) di Ubuntu
printf 'Package: nodejs\nPin: origin deb.nodesource.com\nPin-Priority: 600\n' > /etc/apt/preferences.d/nodesource

# ---------------------------------------------------------------- Caddy dal repository ufficiale
passo "Caddy (repository ufficiale)"
if [[ ! -s /usr/share/keyrings/caddy-stable-archive-keyring.gpg ]]; then
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  chmod 0644 /usr/share/keyrings/caddy-stable-archive-keyring.gpg
fi
echo "deb [signed-by=/usr/share/keyrings/caddy-stable-archive-keyring.gpg] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main" > /etc/apt/sources.list.d/caddy-stable.list

apt-get update -q
apt-get install -y -q nodejs caddy

# node:sqlite funziona senza opzioni da Node 22.13
VERSIONE="$(node -p 'process.versions.node')"
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)' \
  || muori "Node $VERSIONE è troppo vecchio: serve 22.13 o più (node:sqlite)"
[[ -x /usr/bin/node ]] || muori "node non è in /usr/bin/node (il servizio lo cerca lì)"
echo "Node $VERSIONE, $(caddy version | head -1)"

# ---------------------------------------------------------------- utente e cartelle
passo "Utente repobay e cartelle"
if ! id repobay &>/dev/null; then
  useradd --system --home-dir "$DATI" --no-create-home --shell /usr/sbin/nologin --user-group repobay
fi
install -d -o repobay -g repobay -m 0750 "$DATI"
install -d -o root -g root -m 0700 "$CONF"
# il codice è di root: il servizio lo legge ma non lo può cambiare
chown -R root:root "$CODICE"
chmod -R u=rwX,go=rX "$CODICE"

# ---------------------------------------------------------------- le impostazioni
passo "Impostazioni in $CONF/env"
imposta() {   # imposta NOME valore: sostituisce la riga NOME=… (anche se commentata) o la aggiunge in fondo
  local nome=$1 valore=$2 f=$CONF/env
  if grep -qE "^#?${nome}=" "$f"; then
    local tmp; tmp="$(mktemp)"
    awk -v n="$nome" -v v="$valore" 'BEGIN{fatto=0} { if (!fatto && ($0 ~ "^#?" n "=")) { print n "=" v; fatto=1 } else print }' "$f" > "$tmp"
    cat "$tmp" > "$f"; rm -f "$tmp"
  else
    printf '%s=%s\n' "$nome" "$valore" >> "$f"
  fi
}
if [[ ! -f $CONF/env ]]; then
  install -o root -g root -m 0600 "$QUI/env.esempio" "$CONF/env"
  imposta APP_URL "https://$DOMINIO"
  imposta APP_DATI "$DATI"
  imposta APP_ADMIN "$EMAIL"
  imposta APP_SEGRETO "$(openssl rand -base64 48 | tr -d '\n')"
  # i segnaposto di Stripe e GitHub si svuotano: il server parte e avvisa che mancano (si mettono dopo, a mano)
  imposta STRIPE_CHIAVE ""
  imposta STRIPE_FIRMA ""
  imposta GITHUB_CLIENT_ID ""
  imposta GITHUB_CLIENT_SECRET ""
  echo "creato $CONF/env (con una chiave APP_SEGRETO nuova: fanne una copia sicura!)"
else
  chmod 0600 "$CONF/env"; chown root:root "$CONF/env"
  echo "$CONF/env c'è già: non lo tocco"
fi

# ---------------------------------------------------------------- il servizio
passo "Servizio systemd"
install -o root -g root -m 0644 "$QUI/repobay.service" /etc/systemd/system/repobay.service
systemctl daemon-reload
if command -v systemd-analyze >/dev/null; then systemd-analyze verify /etc/systemd/system/repobay.service || muori "il file del servizio ha errori (vedi sopra)"; fi
systemctl enable repobay >/dev/null
systemctl restart repobay
ok=0
for _ in $(seq 1 20); do   # al più 20 secondi
  if curl -fsS -m 2 http://127.0.0.1:4600/salute >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
if [[ $ok == 1 ]]; then echo "Repobay risponde su 127.0.0.1:4600"; else journalctl -u repobay -n 40 --no-pager; muori "Repobay non risponde: guarda i messaggi qui sopra"; fi

# ---------------------------------------------------------------- Caddy
passo "Caddy per https://$DOMINIO"
printf 'DOMINIO=%s\nACME_EMAIL=%s\n' "$DOMINIO" "$EMAIL" > /etc/caddy/repobay.env
chmod 0644 /etc/caddy/repobay.env
install -d -m 0755 /etc/systemd/system/caddy.service.d
printf '[Service]\nEnvironmentFile=/etc/caddy/repobay.env\n' > /etc/systemd/system/caddy.service.d/repobay.conf
if [[ -f /etc/caddy/Caddyfile && ! -f /etc/caddy/Caddyfile.originale ]] && ! grep -q 'Repobay' /etc/caddy/Caddyfile; then
  cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.originale
fi
install -o root -g root -m 0644 "$QUI/Caddyfile" /etc/caddy/Caddyfile
install -d -o caddy -g caddy -m 0750 /var/log/caddy
# il controllo gira come utente caddy, così il file di log (se lo crea) resta suo
runuser -u caddy -- env HOME=/var/lib/caddy DOMINIO="$DOMINIO" ACME_EMAIL="$EMAIL" caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile \
  || muori "il Caddyfile ha errori (vedi sopra)"
systemctl daemon-reload
systemctl enable caddy >/dev/null
systemctl restart caddy

# ---------------------------------------------------------------- firewall
passo "Firewall (ufw): 22, 80, 443"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw limit 22/tcp comment 'SSH (con limite ai tentativi)' >/dev/null
ufw allow 80/tcp comment 'HTTP (Lets Encrypt e redirect)' >/dev/null
ufw allow 443/tcp comment 'HTTPS' >/dev/null
ufw allow 443/udp comment 'HTTP/3' >/dev/null
ufw --force enable >/dev/null
ufw status verbose | sed 's/^/    /'

# ---------------------------------------------------------------- aggiornamenti di sicurezza
passo "Aggiornamenti di sicurezza automatici"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
CONF
# se un aggiornamento del kernel lo chiede, il server si riavvia da solo alle 4:30 (Repobay e Caddy ripartono da soli)
cat > /etc/apt/apt.conf.d/52repobay-riavvio <<'CONF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
CONF
systemctl enable --now unattended-upgrades >/dev/null 2>&1 || true
unattended-upgrade --dry-run >/dev/null 2>&1 && echo "unattended-upgrades pronto" || echo "attenzione: unattended-upgrade --dry-run ha dato un errore (controlla a mano)"

# ---------------------------------------------------------------- fine
IP4="$(ip -4 -o addr show scope global | awk '{print $4}' | cut -d/ -f1 | head -1)"
IP6="$(ip -6 -o addr show scope global | awk '{print $4}' | cut -d/ -f1 | head -1)"
cat <<FINE

==================================================================================================
Fatto. Repobay gira come servizio, Caddy è davanti per https://$DOMINIO

Ancora da fare (vedi deploy/LEGGIMI.md):
  1. DNS: il record A di $DOMINIO deve puntare a ${IP4:-<IPv4 del server>}, AAAA a ${IP6:-<IPv6 del server>}. Quando il DNS
     è giusto, Caddy prende da solo il certificato: journalctl -u caddy -f per vederlo.
  2. Le chiavi: nano $CONF/env   (Stripe, webhook, GitHub, posta), poi:  systemctl restart repobay
  3. COPIA AL SICURO la riga APP_SEGRETO di $CONF/env (senza, i dati cifrati non si leggono più).
  4. Controlla: curl -sS https://$DOMINIO/salute   e   journalctl -u repobay -f

Comandi utili:
  systemctl status repobay          lo stato del servizio
  journalctl -u repobay -n 100      gli ultimi messaggi
  ls -l $DATI/copie/                 le copie giornaliere del database
  tail -f /var/log/caddy/repobay.log  le richieste che arrivano
==================================================================================================
FINE
