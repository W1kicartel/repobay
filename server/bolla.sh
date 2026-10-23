#!/bin/sh
# Repobay: la bolla di assistenza di __PRODOTTO__ dentro le pagine servite da Nginx.
# La bolla è un link fisso in basso a destra (solo HTML, nessuno script) che apre la pagina di assistenza del cliente.
# Il programma installato non si tocca: cambia solo la configurazione di Nginx, e con --togli torna com'era.
#
# Cosa fa, nell'ordine:
#   1. trova i blocchi «server» di Nginx con il dominio indicato (dalla configurazione attiva, nginx -T);
#   2. salva una copia di ogni file che cambia in /var/backups/repobay-bolla (fuori da Nginx, che non la legge);
#   3. scrive la bolla in /etc/nginx/snippets/repobay-bolla-DOMINIO.conf;
#   4. con --tutto aggiunge una riga «include» in ogni blocco location di quel dominio; con --percorso=/admin/ crea un blocco
#      solo per quel percorso (le pagine pubbliche restano senza bolla);
#   5. prova la configurazione (nginx -t): se non va rimette le copie e si ferma; se va, ricarica Nginx.
#
# Uso:     sudo sh repobay-bolla.sh dominio.it [--tutto | --percorso=/admin/]
# Togli:   sudo sh repobay-bolla.sh dominio.it --togli
set -eu

DOMINIO=""; MODO="__MODO__"; PERCORSO="__PERCORSO__"; TOGLI=0
for a in "$@"; do
  case "$a" in
    --togli) TOGLI=1 ;;
    --tutto) MODO=tutto ;;
    --percorso=*) MODO=percorso; PERCORSO="${a#--percorso=}" ;;
    -h|--aiuto|--help) sed -n '2,19p' "$0"; exit 0 ;;
    -*) echo "Opzione sconosciuta: $a" >&2; exit 2 ;;
    *) DOMINIO="$a" ;;
  esac
done

ferma() { echo "Repobay: $*" >&2; exit 1; }
[ -n "$DOMINIO" ] || ferma "scrivi il dominio del programma: sudo sh $0 dominio.it [--tutto | --percorso=/admin/]"
case "$DOMINIO" in *[!A-Za-z0-9.-]*|.*|*..*) ferma "dominio non valido: $DOMINIO";; esac
[ "$(id -u)" = 0 ] || ferma "serve sudo: sudo sh $0 $*"
command -v nginx >/dev/null 2>&1 || ferma "Nginx non c'è su questo server. Se il programma è dietro un altro proxy (Caddy, Traefik) o dentro Docker, metti la bolla a mano: la trovi nell'area di Repobay, nella finestra Assistenza del cliente."
if [ "$TOGLI" = 0 ]; then
  case "$MODO" in
    tutto) ;;
    percorso) case "$PERCORSO" in /*) ;; *) ferma "il percorso deve iniziare con /, per esempio --percorso=/admin/";; esac
              case "$PERCORSO" in *[!A-Za-z0-9/._-]*) ferma "percorso non valido: $PERCORSO";; esac ;;
    *) ferma "questo programma ha pagine aperte al pubblico: scegli dove mettere la bolla. --percorso=/admin/ (solo le pagine di amministrazione, il percorso giusto lo sai tu) oppure --tutto (solo se nessuna pagina è pubblica)";;
  esac
fi

SNIPPET="/etc/nginx/snippets/repobay-bolla-$DOMINIO.conf"
RIGA="include snippets/repobay-bolla-$DOMINIO.conf; # repobay-bolla $DOMINIO"
ORA=$(date +%Y%m%d-%H%M%S)

# i file della configurazione attiva che contengono il dominio in server_name (i link di sites-enabled portano al file vero)
FILE=$(nginx -T 2>/dev/null | awk -v d="$DOMINIO" '
  /^# configuration file / { f = $4; sub(/:$/, "", f); next }
  { riga = $0; sub(/#.*/, "", riga); n = split(riga, w, /[ \t;]+/)
    for (i = 1; i <= n; i++) if (w[i] == "server_name") { for (j = i + 1; j <= n; j++) if (w[j] == d) { print f; break } } }' | sort -u)
[ -n "$FILE" ] || ferma "nessun blocco server con server_name $DOMINIO nella configurazione di Nginx (nginx -T)"

# proxy_set_header scritti per tutti i siti (livello http, in nginx.conf): una location con la bolla non li erediterebbe più
if [ "$TOGLI" = 0 ] && grep -Eq '^[[:space:]]*proxy_set_header[[:space:]]' /etc/nginx/nginx.conf 2>/dev/null; then
  ferma "in /etc/nginx/nginx.conf ci sono proxy_set_header generali: con la bolla le location del sito non li erediterebbero più. Metti la bolla a mano (la trovi nell'area di Repobay, nella finestra Assistenza del cliente)."
fi

# il cuore: un file di configurazione → lo stesso file senza la bolla di questo dominio (togli) o con la bolla (tutto, percorso)
trasforma() {
  awk -v dom="$DOMINIO" -v modo="$1" -v perc="$PERCORSO" -v riga="$RIGA" '
    function codice(s) { sub(/#.*/, "", s); return s }
    # la location che comincia alla riga i scrive proxy_set_header suoi (a livello suo, non in location dentro)?
    function suePsh(i,   j, p, c) { p = 0
      for (j = i; j <= m; j++) { c = codice(M[j]); if (j > i && D[j] == D[i] + 1 && c ~ /^[ \t]*proxy_set_header[ \t]/) return 1
        p += gsub(/\{/, "{", c) - gsub(/\}/, "}", c); if (p == 0 && j > i) return 0 }
      return 0 }
    { L[NR] = $0 }
    END {
      # 1. via la bolla di prima (righe con il marcatore, blocchi fra inizio e fine), così si può rilanciare
      m = 0; salta = 0
      for (i = 1; i <= NR; i++) {
        if (L[i] ~ ("# repobay-bolla-inizio " dom "$")) { salta = 1; continue }
        if (salta) { if (L[i] ~ ("# repobay-bolla-fine " dom "$")) salta = 0; continue }
        if (index(L[i], "# repobay-bolla " dom) && L[i] ~ ("# repobay-bolla " dom "$")) continue
        M[++m] = L[i]
      }
      if (modo == "togli") { for (i = 1; i <= m; i++) print M[i]; exit 0 }
      # 2. i blocchi server del dominio e, dentro, i blocchi location
      prof = 0; dentro = 0; trovati = 0; nserv = 0
      for (i = 1; i <= m; i++) {
        c = codice(M[i]); D[i] = prof
        if (!dentro && c ~ /(^|[ \t;{])server[ \t]*\{/) { dentro = 1; inizio = i; base = prof; suo = 0; BASE[++nserv] = base }
        if (dentro) SV[i] = nserv
        if (dentro && c ~ /^[ \t]*server_name[ \t]/) { n = split(c, w, /[ \t;]+/); for (j = 1; j <= n; j++) if (w[j] == dom) suo = 1 }
        # le intestazioni del server: una location che ne scrive una sua (la bolla ne scrive una) non eredita più queste
        if (dentro && prof == base + 1 && c ~ /^[ \t]*proxy_set_header[ \t]/) { x = c; sub(/^[ \t]+/, "", x); sub(/[ \t]+$/, "", x); PSH[nserv] = PSH[nserv] "\n" x }
        a = gsub(/\{/, "{", c); b = gsub(/\}/, "}", c); prof += a - b
        if (dentro && prof == base) { dentro = 0; if (suo) { S[++trovati] = inizio; E[trovati] = i } }
      }
      if (!trovati) { print "NESSUN_SERVER" > "/dev/stderr"; exit 3 }
      for (k = 1; k <= trovati; k++) for (i = S[k]; i <= E[k]; i++) mio[i] = 1
      # 3. tutto: la riga include dopo ogni «location … {» del dominio
      if (modo == "tutto") {
        messe = 0
        for (i = 1; i <= m; i++) {
          print M[i]
          if (mio[i] && codice(M[i]) ~ /^[ \t]*location[ \t].*\{[ \t]*$/) {
            match(M[i], /^[ \t]*/); ind = substr(M[i], 1, RLENGTH) "    "; print ind riga; messe++
            if (!suePsh(i) && PSH[SV[i]] != "") { n = split(substr(PSH[SV[i]], 2), w, "\n"); for (j = 1; j <= n; j++) print ind w[j] " # repobay-bolla " dom }
          }
        }
        if (!messe) { print "NESSUNA_LOCATION" > "/dev/stderr"; exit 4 }
        exit 0
      }
      # 4. percorso: un blocco «location ^~ PERCORSO» copiato da «location /» (che deve fare proxy_pass), con la bolla dentro
      ri = 0; rf = 0
      for (i = 1; i <= m; i++) if (mio[i] && !ri && codice(M[i]) ~ /^[ \t]*location[ \t]+\/[ \t]*\{[ \t]*$/) {
        ri = i; p = 0
        for (j = i; j <= m; j++) { c = codice(M[j]); p += gsub(/\{/, "{", c) - gsub(/\}/, "}", c); if (p == 0) { rf = j; break } }
      }
      if (!ri || !rf) { print "NESSUNA_RADICE" > "/dev/stderr"; exit 5 }
      corpo = ""; proxy = 0
      for (j = ri + 1; j < rf; j++) {
        x = M[j]
        if (codice(x) ~ /proxy_pass[ \t]/) {
          proxy = 1
          # «proxy_pass http://app/;» in «location /» manda il percorso intero: nel blocco nuovo va senza la barra finale
          if (codice(x) ~ /proxy_pass[ \t]+[a-z]+:\/\/[^\/; \t]+\/[^; \t]+/) { print "PROXY_CON_PERCORSO" > "/dev/stderr"; exit 6 }
          gsub(/\/;/, ";", x)
        }
        corpo = corpo "\n" x
      }
      if (!proxy) { print "SENZA_PROXY" > "/dev/stderr"; exit 7 }
      if (!suePsh(ri) && PSH[SV[ri]] != "") { n = split(substr(PSH[SV[ri]], 2), w, "\n"); match(M[ri], /^[ \t]*/); for (j = 1; j <= n; j++) corpo = corpo "\n" substr(M[ri], 1, RLENGTH) "    " w[j] }
      match(M[ri], /^[ \t]*/); rientro = substr(M[ri], 1, RLENGTH)
      for (i = 1; i <= m; i++) {
        if (i == ri) {
          print rientro "# repobay-bolla-inizio " dom
          print rientro "location ^~ " perc " {"
          print rientro "    " riga
          printf "%s\n", substr(corpo, 2)
          print rientro "}"
          print rientro "# repobay-bolla-fine " dom
        }
        print M[i]
      }
    }'
}

# le copie fuori dalle cartelle di Nginx (che con «include sites-enabled/*» leggerebbe anche quelle); i file di lavoro in /tmp
COPIE_DIR=/var/backups/repobay-bolla; mkdir -p "$COPIE_DIR"
copia() { echo "$COPIE_DIR/$(echo "$1" | tr / _).$ORA"; }
NUOVO=$(mktemp); ERRORE=$(mktemp); trap 'rm -f "$NUOVO" "$ERRORE"' EXIT
COPIE=""
rimetti() { for f in $COPIE; do cat "$(copia "$f")" > "$f"; done; }
for f0 in $FILE; do
  f=$(readlink -f "$f0" 2>/dev/null || echo "$f0")
  cp -p "$f" "$(copia "$f")"; COPIE="$COPIE $f"
  if [ "$TOGLI" = 1 ]; then trasforma togli < "$(copia "$f")" > "$NUOVO"
  else
    if ! trasforma "$MODO" < "$(copia "$f")" > "$NUOVO" 2> "$ERRORE"; then
      e=$(cat "$ERRORE"); rimetti
      case "$e" in
        *NESSUNA_LOCATION*) ferma "in $f il blocco server di $DOMINIO non ha blocchi location: metti la bolla a mano.";;
        *NESSUNA_RADICE*) ferma "in $f non trovo «location / {» per $DOMINIO: usa --tutto, oppure metti la bolla a mano.";;
        *PROXY_CON_PERCORSO*) ferma "in $f «location /» passa a un percorso diverso da /: con --percorso non lo copio, usa --tutto o metti la bolla a mano.";;
        *SENZA_PROXY*) ferma "in $f «location /» non fa proxy_pass (PHP o file statici): con --percorso potrei cambiare come vengono serviti i file. Usa l'impostazione del programma per il codice HTML, oppure --tutto.";;
        *) ferma "non riesco a leggere $f: $e";;
      esac
    fi
  fi
  cat "$NUOVO" > "$f"
done

if [ "$TOGLI" = 1 ]; then rm -f "$SNIPPET"; else
  mkdir -p /etc/nginx/snippets
  cat > "$SNIPPET" <<'BOLLA_REPOBAY'
# Repobay: la bolla di assistenza (solo HTML, nessuno script). Per toglierla: sudo sh repobay-bolla.sh DOMINIO --togli
proxy_set_header Accept-Encoding "";
sub_filter_once on;
sub_filter '</body>' '__BOLLA__</body>';
BOLLA_REPOBAY
fi

if ! nginx -t >/dev/null 2>&1; then
  nginx -t 2>&1 | tail -n 5 >&2
  rimetti; [ "$TOGLI" = 1 ] || rm -f "$SNIPPET"
  ferma "la prova della configurazione non è passata: ho rimesso tutto com'era. Niente è cambiato."
fi
nginx -s reload
sleep 2   # il tempo che i processi nuovi di Nginx prendano la configurazione
if [ "$TOGLI" = 1 ]; then echo "Repobay: bolla tolta da $DOMINIO. Le copie di prima sono in $COPIE_DIR."
else
  echo "Repobay: bolla messa su $DOMINIO ($([ "$MODO" = percorso ] && echo "solo in $PERCORSO" || echo "in tutte le pagine"))."
  # una prova dal server stesso (se il sito risponde in chiaro sulla porta 80; con HTTPS o un login davanti, guarda dal browser)
  P="/"; [ "$MODO" = percorso ] && P="$PERCORSO"
  if command -v curl >/dev/null 2>&1; then PAGINA=$(curl -s -m 5 -H "Host: $DOMINIO" "http://127.0.0.1$P" || true)
  elif command -v wget >/dev/null 2>&1; then PAGINA=$(wget -qO- -T 5 --header "Host: $DOMINIO" "http://127.0.0.1$P" 2>/dev/null || true)
  else PAGINA=""; fi
  case "$PAGINA" in *da=bolla*) echo "Verificato: la pagina $P di $DOMINIO contiene la bolla." ;;
    *) echo "Non riesco a verificarlo da qui (HTTPS, login o redirect davanti): apri il programma dal browser e ricarica la pagina." ;; esac
  echo "La bolla viola è in basso a destra. Per toglierla: sudo sh $0 $DOMINIO --togli"
fi
