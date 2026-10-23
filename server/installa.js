// L'installazione con un comando: dopo il pagamento il cliente (o chi installa) incolla sul server
//   curl -fsSL <url>/i/<codice>.sh | sudo bash
// e lo script fa tutto da solo, raccontando ogni passo alla pagina /installa/<codice> (POST /api/installa/<codice>/stato):
// installa Docker se manca, prende il docker-compose del progetto (quello del repository, o la ricetta che chi sviluppa ha scritto),
// prepara le impostazioni predefinite (.env dall'esempio del progetto, con password e chiavi casuali dove mancano), accende i servizi
// e aspetta che il programma risponda. Le password restano sul server (CREDENZIALI.txt, solo root): alla piattaforma arriva solo
// l'avanzamento e la porta. Le impostazioni vere (dominio, logo, utenti, dati) le sistema poi chi installa, con il cliente.

// L'agente di supporto: lo script lo installa insieme al programma (/usr/local/bin/repobay-agente, un timer systemd ogni minuto).
// Senza il sì del titolare non fa niente: chiede alla piattaforma se c'è una perizia accettata dalla pagina /installa e solo allora
//   diagnosi <id>                 raccoglie un rapporto in sola lettura (sistema, disco, memoria, servizi, log; password nascoste)
//   accesso <id> <scade> <chiave> apre l'accesso SSH all'utente repobay-supporto con quella chiave, fino alla scadenza (expiry-time)
//   revoca <id>                   toglie la chiave subito
// La piattaforma risponde a righe di testo (niente JSON da leggere in bash); il gettone dell'agente sta in /etc/repobay-agente.conf
export function scriptAgente() {
  return `#!/usr/bin/env bash
# Repobay: l'agente di supporto. Agisce solo sulle richieste che il titolare ha accettato dalla sua pagina.
set -uo pipefail
. /etc/repobay-agente.conf
UTENTE=repobay-supporto
CHIAVI=/home/$UTENTE/.ssh/authorized_keys
chiedi() { curl -fsS -m 20 -H "authorization: Bearer $GETTONE" "$@"; }
porta_ssh() { (sshd -T 2>/dev/null | awk '/^port /{print $2; exit}') || echo 22; }
# le chiavi scadute se ne vanno anche se la piattaforma non risponde
if [ -f "$CHIAVI" ]; then
  adesso=$(date +%s); tmp=$(mktemp)
  while IFS= read -r r; do s=$(printf '%s' "$r" | grep -oE 'repobay-scade-[0-9]+' | grep -oE '[0-9]+$' || true); [ -n "$s" ] && [ "$s" -le "$adesso" ] && continue; printf '%s\\n' "$r" >> "$tmp"; done < "$CHIAVI"
  cat "$tmp" > "$CHIAVI"; rm -f "$tmp"
fi
RISPOSTA=$(chiedi "$API/agente") || exit 0
printf '%s\\n' "$RISPOSTA" | while read -r azione id scade chiave; do
  case "$azione" in
    diagnosi)
      f=$(mktemp)
      {
        echo "== sistema"; (. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME"); uname -srm; uptime
        echo; echo "== disco"; df -h -x tmpfs -x devtmpfs 2>/dev/null
        echo; echo "== memoria"; free -m
        echo; echo "== docker"; docker --version 2>&1
        if [ -d "$CARTELLA" ]; then cd "$CARTELLA"
          docker compose ps 2>&1
          echo; echo "== risorse"; docker stats --no-stream --format 'table {{.Name}}\\t{{.CPUPerc}}\\t{{.MemUsage}}' 2>&1
          echo; echo "== impostazioni (.env, valori nascosti)"; sed -E 's/=.*/=•••/' .env 2>/dev/null
          echo; echo "== log (ultime 150 righe per servizio)"; docker compose logs --tail 150 --no-color 2>&1 | sed -E 's/((pass(word)?|secret|token|key|bearer)[^=: ]*[=: ]+)[^ ]+/\\1•••/Ig'
        fi
      } 2>&1 | head -c 300000 > "$f"
      chiedi -X POST -H 'content-type: text/plain; charset=utf-8' --data-binary "@$f" "$API/agente/rapporto?id=$id" >/dev/null || true
      rm -f "$f" ;;
    accesso)
      id -u "$UTENTE" >/dev/null 2>&1 || useradd -m -s /bin/bash "$UTENTE"
      getent group docker >/dev/null && usermod -aG docker "$UTENTE"
      install -d -m 700 -o "$UTENTE" -g "$UTENTE" "/home/$UTENTE/.ssh"; touch "$CHIAVI"
      grep -q "repobay-perizia-$id " "$CHIAVI" || printf 'expiry-time="%s",no-agent-forwarding,no-X11-forwarding %s repobay-perizia-%s repobay-scade-%s\\n' "$(date -d "@$scade" +%Y%m%d%H%M)" "$(printf '%s' "$chiave" | base64 -d)" "$id" "$scade" >> "$CHIAVI"
      chown "$UTENTE:$UTENTE" "$CHIAVI"; chmod 600 "$CHIAVI"
      chiedi -X POST "$API/agente/stato?id=$id&stato=in_corso&porta=$(porta_ssh)" >/dev/null || true ;;
    revoca)
      [ -f "$CHIAVI" ] && sed -i "/repobay-perizia-$id /d" "$CHIAVI"
      chiedi -X POST "$API/agente/stato?id=$id&stato=fatta" >/dev/null || true ;;
  esac
done
`;
}

// quello che lo script dell'installazione aggiunge per l'agente: il programma, la configurazione (col gettone) e il timer
function installaAgente(base, gettone, cartella) {
  return `cat > /usr/local/bin/repobay-agente <<'REPOBAY_AGENTE'
${scriptAgente().trimEnd()}
REPOBAY_AGENTE
chmod 755 /usr/local/bin/repobay-agente
umask 077; printf "API='%s'\\nGETTONE='%s'\\nCARTELLA='%s'\\n" '${base}/api' '${gettone}' '${cartella}' > /etc/repobay-agente.conf; umask 022
if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
  printf '[Unit]\\nDescription=Repobay: agente di supporto (agisce solo con il consenso del titolare)\\nAfter=network-online.target\\n[Service]\\nType=oneshot\\nExecStart=/usr/local/bin/repobay-agente\\n' > /etc/systemd/system/repobay-agente.service
  printf '[Unit]\\nDescription=Repobay: le richieste di supporto, ogni minuto\\n[Timer]\\nOnBootSec=1min\\nOnUnitActiveSec=1min\\n[Install]\\nWantedBy=timers.target\\n' > /etc/systemd/system/repobay-agente.timer
  systemctl daemon-reload && systemctl enable --now repobay-agente.timer >/dev/null 2>&1 || true
else
  echo '* * * * * root /usr/local/bin/repobay-agente >/dev/null 2>&1' > /etc/cron.d/repobay-agente
fi`;
}

// i passi che lo script racconta, in ordine (la pagina li mostra come una lista che si spunta)
export const PASSI = ['avvio', 'docker', 'agente', 'scarico', 'configuro', 'accendo', 'online'];
// quello che chi installa sistema con il cliente dopo l'installazione, una voce per riga
export const VOCI = [
  { k: 'dominio', it: 'Dominio e lucchetto HTTPS', en: 'Domain and HTTPS' },
  { k: 'marchio', it: 'Nome, logo e colori della tua attività', en: 'Your business name, logo and colours' },
  { k: 'utenti', it: 'Utenti e permessi per chi lavora con te', en: 'Users and permissions for your team' },
  { k: 'dati', it: 'I tuoi dati: clienti, prodotti, listini', en: 'Your data: customers, products, price lists' },
  { k: 'backup', it: 'Backup automatici ogni notte', en: 'Automatic nightly backups' },
  { k: 'prova', it: 'La prova finale insieme', en: 'A final check together' },
];
export const STATI_VOCE = ['da_fare', 'in_corso', 'fatto'];
export const CODICE_ACQUISTO = /^[A-Za-z0-9_-]{24}$/;

export const comandoInstalla = (cfg, codice) => `curl -fsSL ${cfg.url}/i/${codice}.sh | sudo bash`;

// la ricetta di un prodotto: il compose scritto da chi sviluppa (facoltativo) e i valori predefiniti da mettere nel .env
export function leggiRicetta(testo) {
  let r = null; try { r = JSON.parse(testo || 'null'); } catch { r = null; }
  if (!r || typeof r !== 'object') return { compose: null, env: {} };
  const compose = typeof r.compose === 'string' && r.compose.length <= 20000 && !/^REPOBAY_COMPOSE$/m.test(r.compose) ? r.compose : null;
  const env = {};
  for (const [k, v] of Object.entries(r.env && typeof r.env === 'object' ? r.env : {}).slice(0, 60))
    if (/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(k) && ['string', 'number', 'boolean'].includes(typeof v)) env[k] = String(v).replace(/[\r\n'"`$\\]/g, '').slice(0, 300);
  return { compose, env };
}

// solo i caratteri che non possono rompere lo script (sono dentro apici singoli)
const sicuro = (s, re = /[^\p{L}\p{N} ._:/@-]/gu) => String(s ?? '').replace(re, '').slice(0, 120);

const TESTI = {
  it: { sudo: 'Serve sudo: curl -fsSL {url} | sudo bash', via: 'Installo {nome} con {piattaforma}', docker: 'installo Docker',
    nocompose: 'Docker Compose non c\'è e non riesco a installarlo', manca: 'Questo programma non ha un docker-compose pronto: lo completa a mano chi installa',
    su: 'docker compose up non è partito', riga: 'Si è fermato alla riga', aiuto: 'Chi installa ha ricevuto l\'avviso: ti aiuta a finire da qui.',
    acceso: '{nome} è acceso', password: 'Password e chiavi generate: {file} (le legge solo root)', torna: 'Torna sulla pagina: {pagina}',
    passwords: '{n} password generate', agente: 'agente di supporto pronto: aspetta il tuo sì', immagini: 'scarico le immagini', attesa: 'aspetto che risponda', nonrisponde: 'I servizi sono accesi ma il programma non risponde ancora' },
  en: { sudo: 'sudo is required: curl -fsSL {url} | sudo bash', via: 'Installing {nome} with {piattaforma}', docker: 'installing Docker',
    nocompose: 'Docker Compose is missing and I could not install it', manca: 'This program has no ready docker-compose file: your installer will finish it by hand',
    su: 'docker compose up did not start', riga: 'Stopped at line', aiuto: 'Your installer has been notified and will help you finish from here.',
    acceso: '{nome} is running', password: 'Generated passwords and keys: {file} (readable by root only)', torna: 'Back to the page: {pagina}',
    passwords: '{n} passwords generated', agente: 'support agent ready: it waits for your OK', immagini: 'pulling the images', attesa: 'waiting for it to answer', nonrisponde: 'The services are up but the program is not answering yet' },
};

// lo script per un acquisto: a, il suo prodotto p (con repo, ramo, ricetta). Le stringhe variabili sono ripulite e tra apici singoli
export function scriptInstalla(cfg, a, p, gettone) {
  // i testi vanno tra apici singoli: l'apostrofo diventa quello tipografico
  const l = a.lingua === 'en' ? 'en' : 'it', T = (k, v = {}) => TESTI[l][k].replace(/\{(\w+)\}/g, (_, n) => v[n] ?? '').replace(/'/g, '’');
  const nome = sicuro(p.nome), slug = sicuro(p.slug, /[^a-z0-9-]/g) || 'programma', repo = sicuro(p.repo, /[^A-Za-z0-9._/-]/g);
  const ramo = sicuro(p.ramo || 'HEAD', /[^A-Za-z0-9._/-]/g) || 'HEAD', base = sicuro(cfg.url, /[^A-Za-z0-9.:/_-]/g), piattaforma = sicuro(cfg.nome);
  const r = leggiRicetta(p.ricetta), cartella = `/opt/repobay/${slug}`, pagina = `${base}/installa/${a.codice}`;
  const env = Object.entries(r.env).map(([k, v]) => `metti '${k}' '${v}'`).join('\n');
  return `#!/usr/bin/env bash
# ${nome}: ${T('via', { nome, piattaforma })}. ${pagina}
set -Eeuo pipefail
API='${base}/api/installa/${a.codice}/stato'
CARTELLA='${cartella}'
RAW='https://raw.githubusercontent.com/${repo}/${ramo}'
pulito() { printf '%s' "\${1:-}" | tr -d '"\\\\' | tr '\\n\\r\\t' '   ' | cut -c1-300; }
racconta() { curl -fsS -m 10 -X POST -H 'content-type: application/json' --data "{\\"passo\\":\\"$1\\",\\"testo\\":\\"$(pulito "\${2:-}")\\",\\"porta\\":\${3:-0}}" "$API" >/dev/null 2>&1 || true; }
fallito() { trap - ERR; racconta errore "$1"; echo; echo "✗ $1"; echo "  ${T('aiuto')}"; exit 1; }
trap 'fallito "${T('riga')} $LINENO"' ERR
[ "$(id -u)" -eq 0 ] || { echo '${T('sudo', { url: `${base}/i/${a.codice}.sh` })}'; exit 1; }
echo '▸ ${T('via', { nome, piattaforma })}'
racconta avvio "$( (. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME") || uname -sr), $(nproc 2>/dev/null || echo ?) CPU, $(free -m 2>/dev/null | awk '/Mem:/{print $2}') MB"

# 1. Docker e Docker Compose
if ! command -v docker >/dev/null 2>&1; then racconta docker '${T('docker')}'; curl -fsSL https://get.docker.com | sh >/dev/null 2>&1; fi
if ! docker compose version >/dev/null 2>&1; then (apt-get update -q && apt-get install -y -q docker-compose-plugin) >/dev/null 2>&1 || fallito '${T('nocompose')}'; fi
systemctl enable --now docker >/dev/null 2>&1 || true
racconta docker "$(docker --version)"

# 1b. l'agente di supporto: senza il sì del titolare non fa niente
${installaAgente(base, gettone, cartella)}
racconta agente '${T('agente')}'

# 2. il compose del programma
mkdir -p "$CARTELLA"; cd "$CARTELLA"
${r.compose ? `cat > docker-compose.yml <<'REPOBAY_COMPOSE'\n${r.compose.replace(/\r/g, '')}\nREPOBAY_COMPOSE` : `if [ ! -s docker-compose.yml ]; then
  for f in compose.yaml compose.yml docker-compose.yml docker-compose.yaml; do
    if curl -fsSL "$RAW/$f" -o docker-compose.yml 2>/dev/null; then break; fi; rm -f docker-compose.yml
  done
fi`}
[ -s docker-compose.yml ] || fallito '${T('manca')}'
racconta scarico "docker-compose.yml"

# 3. le impostazioni predefinite: il .env d'esempio del progetto, con password e chiavi casuali dove sono vuote o da cambiare
if [ ! -f .env ]; then
  for f in .env.example .env.sample env.example example.env .env.dist .env.template; do
    if curl -fsSL "$RAW/$f" -o .env 2>/dev/null; then break; fi; rm -f .env
  done
  touch .env
fi
metti() { grep -q "^$1=" .env || printf '%s=%s\\n' "$1" "$2" >> .env; }
${env}
casuale() { openssl rand -hex 24 2>/dev/null || head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \\n'; }
umask 077; : > CREDENZIALI.txt; nuovo=$(mktemp)
while IFS= read -r riga || [ -n "$riga" ]; do
  if printf '%s' "$riga" | grep -Eq '^[A-Za-z_][A-Za-z0-9_]*(SECRET|PASSWORD|PASSWD|PASS|KEY|TOKEN|SALT)[A-Za-z0-9_]*='; then
    k=\${riga%%=*}; v=\${riga#*=}; v=\${v%\\"}; v=\${v#\\"}
    if [ -z "$v" ] || printf '%s' "$v" | grep -Eqi '^(changeme|change_me|change-me|changethis|secret|password|pass|xxx+|your[_-].*|<.*>|example.*|replace.*|todo)$'; then
      v=$(casuale); riga="$k=$v"; echo "$riga" >> CREDENZIALI.txt
    fi
  fi
  printf '%s\\n' "$riga" >> "$nuovo"
done < .env
mv "$nuovo" .env; chmod 600 .env CREDENZIALI.txt
racconta configuro "$(grep -c . CREDENZIALI.txt || true) password"

# 4. accendo
racconta accendo '${T('immagini')}'
docker compose pull -q >/dev/null 2>&1 || true
docker compose up -d >/dev/null 2>&1 || docker compose up -d --build >/dev/null 2>&1 || fallito '${T('su')}'

# 5. aspetto che il programma risponda, sulla prima porta pubblicata che dà una risposta HTTP
racconta accendo '${T('attesa')}'
PORTE=$(docker compose ps --format json 2>/dev/null | grep -oE '"PublishedPort": ?[0-9]+' | grep -oE '[0-9]+$' | grep -v '^0$' | sort -un || true)
PORTA=0
for i in $(seq 1 90); do
  for p in $PORTE; do
    if [ "$(curl -s -o /dev/null -w '%{http_code}' -m 3 "http://127.0.0.1:$p" || true)" != "000" ]; then PORTA=$p; break 2; fi
  done
  [ -z "$PORTE" ] && break
  sleep 2
done
[ -z "$PORTE" ] || [ "$PORTA" != 0 ] || fallito '${T('nonrisponde')}'
racconta online '' "$PORTA"
IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo
if [ "$PORTA" != 0 ]; then echo "✓ ${T('acceso', { nome })}: http://$IP:$PORTA"; else echo "✓ ${T('acceso', { nome })}"; fi
echo "  ${T('password', { file: `${cartella}/CREDENZIALI.txt` })}"
echo "  ${T('torna', { pagina })}"
`;
}
