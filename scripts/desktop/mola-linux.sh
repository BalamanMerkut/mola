#!/bin/sh
# Mola for Linux · Merkut Studios
# Starts the local server if it is not running, then opens Mola in its own window. The server runs under app/nobetci.mjs,
# which starts it again after a crash; `mola --durdur` (or "Kapat" in the window) stops it for good.
# Program: app/ and runtime/ (replaced on update). Data: veri/, backups/, logs/ next to them (kept on update).
HERE="$(cd "$(dirname "$0")" && pwd)"
NODE="$HERE/runtime/node"
PORT="${MOLA_PORT:-3000}"
mkdir -p "$HERE/logs"

KEYFILE="$HERE/masaustu.anahtar"
up() { "$NODE" -e "fetch('http://127.0.0.1:$PORT/api/health',{signal:AbortSignal.timeout(1500)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" 2>/dev/null; }
# "Own": the server on the port proves it holds this installation's desktop key (HMAC of a fresh random nonce,
# GET /api/desktop/kanit, server/desktop.ts) without being sent the key; only then does the key go to our own window.
own() { [ -s "$KEYFILE" ] && "$NODE" -e "const c=require('crypto'),k=require('fs').readFileSync(process.argv[1],'utf8').trim(),n=c.randomBytes(16).toString('hex');fetch('http://127.0.0.1:'+process.argv[2]+'/api/desktop/kanit?n='+n,{signal:AbortSignal.timeout(1500)}).then(r=>r.ok?r.json():{}).then(j=>{const e=c.createHmac('sha256',k).update('mola-masaustu-kanit:'+n).digest('hex');process.exit(typeof j.kanit==='string'&&j.kanit.length===e.length&&c.timingSafeEqual(Buffer.from(j.kanit),Buffer.from(e))?0:1)},()=>process.exit(1))" "$KEYFILE" "$PORT" 2>/dev/null; }
say() { command -v notify-send >/dev/null 2>&1 && notify-send "Mola" "$1"; echo "$1"; }
conflict() { say "Mola açılamadı: $PORT numaralı bağlantı noktasını başka bir program kullanıyor. O programı kapatıp Mola'yı yeniden açın."; exit 2; }

if [ "$1" = "--durdur" ]; then pkill -f "$NODE"; exit 0; fi

if ! own; then
  up && conflict
  cd "$HERE/app" || exit 1
  SERVE_BUILD=1 MOLA_MODE=installed MOLA_KEY_PROTECTION=1 MOLA_CLEAN_INSTALL=1 PORT="$PORT" DATA_DIR="$HERE/veri" MOLA_DESKTOP_KEY="$HERE/masaustu.anahtar" MOLA_MERKEZ_URL="${MOLA_MERKEZ_URL:-__MOLA_MERKEZ_URL__}" MOLA_MERKEZ_LAN="${MOLA_MERKEZ_LAN:-__MOLA_MERKEZ_LAN__}" \
    nohup "$NODE" --disable-warning=ExperimentalWarning nobetci.mjs server.mjs --lan >> "$HERE/logs/sunucu.log" 2>&1 &
  i=0
  # Otomatik güncelleme: while an update is put in place (guncelleme/) the server comes later, up to 6 minutes.
  updating() { [ -f "$HERE/guncelleme/gunluk.json" ] || [ -f "$HERE/guncelleme/bekleyen.json" ]; }
  while [ $i -lt 60 ] || { [ $i -lt 720 ] && updating; }; do sleep 0.5; own && break; i=$((i + 1)); done
  up && ! own && conflict
  if ! own; then say "Mola başlatılamadı. Ayrıntılar: $HERE/logs/sunucu.log"; exit 1; fi
fi
[ "$1" = "--arkaplan" ] && exit 0

KEY="$(cat "$KEYFILE" 2>/dev/null)"
URL="http://localhost:$PORT/"
[ -n "$KEY" ] && URL="$URL#masaustu=$KEY"
# A Chromium browser gives Mola its own window without an address bar; otherwise the default browser opens it.
for BROWSER in microsoft-edge microsoft-edge-stable google-chrome google-chrome-stable chromium chromium-browser brave-browser; do
  if command -v "$BROWSER" >/dev/null 2>&1; then
    nohup "$BROWSER" --app="$URL" --user-data-dir="$HERE/pencere" --lang=tr --no-first-run --no-default-browser-check --disable-extensions --disable-sync >/dev/null 2>&1 &
    exit 0
  fi
done
xdg-open "$URL" >/dev/null 2>&1 &
