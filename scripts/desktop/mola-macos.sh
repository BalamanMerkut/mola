#!/bin/bash
# Mola for macOS (Mola.app/Contents/MacOS/Mola) · Merkut Studios
# Starts the local server if it is not running (under app/nobetci.mjs, which starts it again after a crash), then opens
# Mola in its own window. Program files live inside
# Mola.app (replaced on update); data, backups and logs live in ~/Library/Application Support/Mola.
CONTENTS="$(cd "$(dirname "$0")/.." && pwd)"
RES="$CONTENTS/Resources"
NODE="$RES/runtime/node"
HOME_DIR="$HOME/Library/Application Support/Mola"
PORT="${MOLA_PORT:-3000}"
mkdir -p "$HOME_DIR/logs"

KEYFILE="$HOME_DIR/masaustu.anahtar"
up() { "$NODE" -e "fetch('http://127.0.0.1:$PORT/api/health',{signal:AbortSignal.timeout(1500)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" 2>/dev/null; }
# "Own": the server on the port proves it holds this installation's desktop key (HMAC of a fresh random nonce,
# GET /api/desktop/kanit, server/desktop.ts) without being sent the key; only then does the key go to our own window.
own() { [ -s "$KEYFILE" ] && "$NODE" -e "const c=require('crypto'),k=require('fs').readFileSync(process.argv[1],'utf8').trim(),n=c.randomBytes(16).toString('hex');fetch('http://127.0.0.1:'+process.argv[2]+'/api/desktop/kanit?n='+n,{signal:AbortSignal.timeout(1500)}).then(r=>r.ok?r.json():{}).then(j=>{const e=c.createHmac('sha256',k).update('mola-masaustu-kanit:'+n).digest('hex');process.exit(typeof j.kanit==='string'&&j.kanit.length===e.length&&c.timingSafeEqual(Buffer.from(j.kanit),Buffer.from(e))?0:1)},()=>process.exit(1))" "$KEYFILE" "$PORT" 2>/dev/null; }
conflict() { osascript -e "display alert \"Mola açılamadı\" message \"$PORT numaralı bağlantı noktasını başka bir program kullanıyor. O programı kapatıp Mola'yı yeniden açın.\" as warning" >/dev/null 2>&1; exit 2; }

if [ "$1" = "--durdur" ]; then pkill -f "$NODE" ; exit 0; fi

if ! own; then
  up && conflict
  cd "$RES/app" || exit 1
  SERVE_BUILD=1 MOLA_MODE=installed MOLA_KEY_PROTECTION=1 MOLA_CLEAN_INSTALL=1 PORT="$PORT" DATA_DIR="$HOME_DIR/veri" MOLA_DESKTOP_KEY="$HOME_DIR/masaustu.anahtar" MOLA_MERKEZ_URL="${MOLA_MERKEZ_URL:-__MOLA_MERKEZ_URL__}" MOLA_MERKEZ_LAN="${MOLA_MERKEZ_LAN:-__MOLA_MERKEZ_LAN__}" \
    nohup "$NODE" --disable-warning=ExperimentalWarning nobetci.mjs server.mjs --lan >> "$HOME_DIR/logs/sunucu.log" 2>&1 &
  disown
  # Otomatik güncelleme: while an update is put in place (guncelleme/) the server comes later, up to 6 minutes.
  updating() { [ -f "$HOME_DIR/guncelleme/gunluk.json" ] || [ -f "$HOME_DIR/guncelleme/bekleyen.json" ]; }
  i=0
  while [ $i -lt 60 ] || { [ $i -lt 720 ] && updating; }; do sleep 0.5; own && break; i=$((i + 1)); done
  if ! own; then
    up && conflict
    osascript -e 'display alert "Mola başlatılamadı" message "Ayrıntılar: ~/Library/Application Support/Mola/logs/sunucu.log" as critical' >/dev/null 2>&1
    exit 1
  fi
fi
[ "$1" = "--arkaplan" ] && exit 0

KEY="$(cat "$KEYFILE" 2>/dev/null)"
URL="http://localhost:$PORT/"
[ -n "$KEY" ] && URL="$URL#masaustu=$KEY"
# A Chromium browser gives Mola its own window without an address bar; Safari opens a normal tab.
for BROWSER in "Microsoft Edge" "Google Chrome" "Brave Browser" "Chromium"; do
  if [ -d "/Applications/$BROWSER.app" ] || [ -d "$HOME/Applications/$BROWSER.app" ]; then
    open -na "$BROWSER" --args --app="$URL" --user-data-dir="$HOME_DIR/pencere" --lang=tr --no-first-run --no-default-browser-check --disable-extensions --disable-sync
    exit 0
  fi
done
open "$URL"
