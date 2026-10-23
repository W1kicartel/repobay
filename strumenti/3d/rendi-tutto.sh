#!/bin/bash
# Redoes every 3D illustration (one render at a time), retouches the shadows and writes the WebP versions.
#   bash strumenti/3d/rendi-tutto.sh
set -u
cd "$(dirname "$0")"
B=/Applications/Blender.app/Contents/MacOS/Blender
for s in eroe passo_codice passo_installa passo_negozio divisione crypto builder installatore vuoto og; do
  echo "== $s $(date +%T)"
  "$B" -b -P "$s.py" 2>&1 | grep -E "RENDER|Error|Traceback" || echo "ERRORE $s"
done
python3 ritocca.py ../../web/img/{eroe,passo-codice,passo-installa,passo-negozio,divisione,crypto,builder,installatore,vuoto}.png
python3 og_componi.py
python3 webp.py
python3 og_titolo.py
echo "FINITO $(date +%T)"
