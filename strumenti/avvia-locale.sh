#!/bin/bash
# Repobay sul Mac, con le chiavi DI PROVA prese dal Portachiavi: non finiscono mai in un file, nella cronologia o nel terminale.
# Uso:  APP_ADMIN=la-tua@email bash strumenti/avvia-locale.sh
# Le chiavi si mettono una volta sola nel Portachiavi (il comando chiede il valore senza mostrarlo):
#   security add-generic-password -a "$USER" -s repobay-stripe-test -w      (sk_test_… dalla dashboard di Stripe, modalità test)
#   security add-generic-password -a "$USER" -s repobay-github-id -w        (Client ID dell'app OAuth di GitHub)
#   security add-generic-password -a "$USER" -s repobay-github-secret -w    (Client secret dell'app OAuth di GitHub)
#   security add-generic-password -a "$USER" -s repobay-posta -w            (facoltativa: la chiave API di Resend)
set -euo pipefail
cd "$(dirname "$0")/.."
k() { security find-generic-password -a "$USER" -s "$1" -w 2>/dev/null || true; }
STRIPE_CHIAVE="$(k repobay-stripe-test)"
case "$STRIPE_CHIAVE" in
  sk_test_*|rk_test_*) ;;
  '') echo "· Stripe: nessuna chiave nel Portachiavi (repobay-stripe-test): i pagamenti con carta restano spenti" ;;
  *) echo "La chiave Stripe nel Portachiavi NON è di prova: qui si usano solo chiavi sk_test_. Mi fermo."; exit 1 ;;
esac
export STRIPE_CHIAVE
export GITHUB_CLIENT_ID="$(k repobay-github-id)" GITHUB_CLIENT_SECRET="$(k repobay-github-secret)"
[ -z "$GITHUB_CLIENT_ID" ] && echo "· GitHub: manca l'app OAuth nel Portachiavi (repobay-github-id / repobay-github-secret)"
POSTA="$(k repobay-posta)"
if [ -n "$POSTA" ]; then export POSTA_DRIVER=resend POSTA_CHIAVE="$POSTA" POSTA_DA="${POSTA_DA:-Repobay <noreply@repobay.net>}"; else export POSTA_DRIVER=console; fi
export APP_URL="${APP_URL:-http://localhost:4600}" APP_PORTA="${APP_PORTA:-4600}" APP_DATI="${APP_DATI:-$HOME/Library/Application Support/Repobay/dati}" APP_ADMIN="${APP_ADMIN:-}"
export APP_RETI="${APP_RETI:-base-sepolia,solana-devnet,bitcoin-testnet4,tron-nile}"   # in locale solo le reti di prova
mkdir -p "$APP_DATI"
echo "Repobay in locale: $APP_URL (dati in $APP_DATI)"
exec node server/avvia.js
