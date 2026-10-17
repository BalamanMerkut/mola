#!/bin/bash
# İşletmemi yönet'in adresi: kafem.molayazilim.com.tr → isletme.molayazilim.com.tr (docs/ISLETME_ADRESI.md).
# Sunucuda, sahibin kendisi çalıştırır: sudo bash isletme-gecis.sh
#   - Caddy: "kafem.molayazilim.com.tr {" bloğunun adı "isletme.molayazilim.com.tr {" olur; ikisi de yoksa tam blok eklenir.
#   - Mola Merkez: MERKEZ_OWNER_ORIGIN=https://isletme.molayazilim.com.tr (satır varsa değişir, yoksa eklenir).
#   - Bir dosyayı değiştirmeden önce yedeğini alır (<dosya>.yedek-isletme); Caddy ayarı geçersizse yedekleri geri koyar, durur.
#   - İki kez çalıştırılsa da aynı sonucu verir (değişecek bir şey yoksa dokunmaz, yedeği de ezmez).
set -euo pipefail
CF=/etc/caddy/Caddyfile
ENV=/etc/mola-merkez/ayarlar.env
OLD=kafem.molayazilim.com.tr
NEW=isletme.molayazilim.com.tr
ORIGIN="https://$NEW"
SITE=/var/www/molayazilim

if [ "$(id -u)" -ne 0 ]; then echo "HATA: sudo ile çalıştırın: sudo bash $0"; exit 1; fi
for f in "$CF" "$ENV"; do [ -f "$f" ] || { echo "HATA: $f bulunamadı; hiçbir şey değişmedi."; exit 1; }; done

caddy_changed=0
env_changed=0
restore() {
  [ "$caddy_changed" = 1 ] && cp -p "$CF.yedek-isletme" "$CF"
  [ "$env_changed" = 1 ] && cp -p "$ENV.yedek-isletme" "$ENV"
  return 0
}

# ---- Caddy ----
if grep -q "^${NEW//./\\.} {" "$CF"; then
  echo "Caddy: $NEW bloğu zaten var."
  if grep -q "^${OLD//./\\.} {" "$CF"; then echo "UYARI: Caddyfile'da eski $OLD bloğu da duruyor; elle kaldırabilirsiniz (docs/ISLETME_ADRESI.md)."; fi
elif grep -q "^${OLD//./\\.} {" "$CF"; then
  cp -p "$CF" "$CF.yedek-isletme"; caddy_changed=1
  sed -i "s/^${OLD//./\\.} {/$NEW {/" "$CF"
  sed -i 's/^# Kafemi yönet/# İşletmemi yönet/' "$CF"
  echo "Caddy: $OLD bloğunun adı $NEW oldu (yedek: $CF.yedek-isletme)."
else
  cp -p "$CF" "$CF.yedek-isletme"; caddy_changed=1
  cat >> "$CF" <<'BLOK'

# İşletmemi yönet (işletme sahiplerinin adresi): yalnız Mola Merkez'e gider; Merkez bu adda yalnız sahip sayfasını açar.
isletme.molayazilim.com.tr {
	encode zstd gzip
	request_body {
		max_size 16MB
	}
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "no-referrer"
		X-Frame-Options "DENY"
		-Server
	}
	reverse_proxy 127.0.0.1:4000
}
BLOK
  echo "Caddy: $NEW bloğu eklendi (yedek: $CF.yedek-isletme)."
fi

# ---- Mola Merkez ayarı ----
if grep -qx "MERKEZ_OWNER_ORIGIN=$ORIGIN" "$ENV" && [ "$(grep -c '^MERKEZ_OWNER_ORIGIN=' "$ENV")" = 1 ]; then
  echo "Merkez: MERKEZ_OWNER_ORIGIN zaten $ORIGIN."
else
  cp -p "$ENV" "$ENV.yedek-isletme"; env_changed=1
  if grep -q '^MERKEZ_OWNER_ORIGIN=' "$ENV"; then
    # The first such line becomes the new one, any repeat goes; written in place (the file keeps its owner and mode).
    awk -v line="MERKEZ_OWNER_ORIGIN=$ORIGIN" '/^MERKEZ_OWNER_ORIGIN=/ { if (!done) { print line; done = 1 } next } { print }' "$ENV.yedek-isletme" > "$ENV"
    echo "Merkez: MERKEZ_OWNER_ORIGIN satırı $ORIGIN oldu (yedek: $ENV.yedek-isletme)."
  else
    printf '\nMERKEZ_OWNER_ORIGIN=%s\n' "$ORIGIN" >> "$ENV"
    echo "Merkez: MERKEZ_OWNER_ORIGIN satırı eklendi (yedek: $ENV.yedek-isletme)."
  fi
fi

# ---- Doğrula, yükle ----
if ! caddy validate --config "$CF" --adapter caddyfile >/dev/null 2>&1; then
  restore
  echo "HATA: Caddy ayarı geçersiz çıktı; yedekler geri kondu, hiçbir şey değişmedi."
  caddy validate --config "$CF" --adapter caddyfile 2>&1 | tail -5 || true
  exit 1
fi
systemctl reload caddy
echo "Caddy: yeniden yüklendi."

# Sitenin eski kısa adres sayfaları (molayazilim.com.tr/yonet, /raporlarim, /kafemi-yonet artık sitenin 404'ü).
for d in yonet raporlarim kafemi-yonet; do
  if [ -d "$SITE/$d" ]; then rm -rf -- "${SITE:?}/$d"; echo "Site: eski /$d sayfası kaldırıldı."; fi
done

since=$(date '+%Y-%m-%d %H:%M:%S')
systemctl restart mola-merkez
sleep 4
ignored=$(journalctl -u mola-merkez --since "$since" --no-pager 2>/dev/null | grep "yok sayıldı" || true)
if [ -n "$ignored" ]; then
  echo "UYARI: Merkez bir adres ayarını yok saydı; bu çıktıyı saklayın:"
  echo "$ignored"
fi
systemctl is-active mola-merkez
echo ISLETME_TAMAM
