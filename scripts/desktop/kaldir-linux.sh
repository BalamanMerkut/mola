#!/bin/sh
# Removes Mola for this user: program files, menu entry, desktop icon and start-up entry (what kur.sh added).
# The café's data and backups (veri/, backups/, ...) stay, so installing again continues where it left off, unless
# --verileri-sil is given. Second backup places (flash drive, cloud folder) are never touched: only this folder is.
#   ~/.local/share/mola/kaldir.sh [--verileri-sil] [--evet]      (--evet: no questions, for scripts)
set -e
TARGET="$(cd "$(dirname "$0")" && pwd)"
WIPE=0; YES=0
for a in "$@"; do
  case "$a" in
    --verileri-sil) WIPE=1 ;;
    --evet) YES=1 ;;
    *) echo "Bilinmeyen seçenek: $a  (kullanım: kaldir.sh [--verileri-sil] [--evet])"; exit 1 ;;
  esac
done
if [ -f "$TARGET/kur.sh" ]; then echo "Bu klasör kurulum paketi. Kurulu Mola'yı kaldırmak için: ~/.local/share/mola/kaldir.sh"; exit 1; fi
if [ ! -f "$TARGET/mola" ] && [ ! -f "$TARGET/app/manifest.json" ]; then echo "Bu klasörde Mola kurulumu bulunamadı: $TARGET"; exit 1; fi

ask() { [ "$YES" = 1 ] && return 0; [ -t 0 ] || { echo "Soru sorulamıyor; onay için --evet ekleyin."; exit 1; }; printf '%s ' "$1"; read -r answer; [ "$answer" = "$2" ]; }
echo "Mola bu bilgisayardan kaldırılacak: $TARGET"
if [ "$WIPE" = 1 ]; then
  echo "DİKKAT: satış geçmişi, işletme verileri ve bu bilgisayardaki yedekler de KALICI OLARAK silinecek. Geri alınamaz."
  echo "Bu bilgisayarda açılacak veri kalmayacağı için kurtarma kodu burada işe yaramaz. Flash bellek ya da başka yerdeki"
  echo "ikinci yedekler silinmez; onları ileride geri yüklemek isterseniz kurtarma kodunu saklamaya devam edin."
  ask "Verileri de silmek için büyük harflerle SIL yazın:" SIL || { echo "Vazgeçildi."; exit 1; }
else
  echo "Satışlar, veriler ve yedekler bu klasörde kalır; yeniden kurarsanız Mola kaldığı yerden devam eder."
  ask "Devam edilsin mi? (e/h)" e || { echo "Vazgeçildi."; exit 1; }
fi

# Stop the server and close the Mola window (the browser running with this folder's "pencere" profile).
if [ -x "$TARGET/mola" ]; then "$TARGET/mola" --durdur >/dev/null 2>&1 || true; fi
pkill -f "$TARGET/runtime/node" >/dev/null 2>&1 || true
pkill -f -- "--user-data-dir=$TARGET/pencere" >/dev/null 2>&1 || true
sleep 2

# Menu entry, start-up entry and desktop icon, only when they start this installation.
APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
AUTO="${XDG_CONFIG_HOME:-$HOME/.config}/autostart"
DESK="$(xdg-user-dir DESKTOP 2>/dev/null || true)"
[ -n "$DESK" ] || DESK="$HOME/Desktop"
for f in "$APPS/mola.desktop" "$AUTO/mola-sunucu.desktop" "$DESK/Mola.desktop"; do
  if [ -f "$f" ] && grep -qF "$TARGET/mola" "$f"; then rm -f "$f"; echo "Silindi: $f"; fi
done
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS" >/dev/null 2>&1 || true

cd "$TARGET"
rm -rf app runtime pencere mola mola.png BENIOKU.txt kaldir.sh guncelleme onceki
if [ "$WIPE" = 1 ]; then
  rm -rf veri veri-* veri.* backups backup-keys restore-checks logs lisans-izi guncelleme-yedek ./*.anahtar ./*-tasima-oncesi-*
  cd /
  if rmdir "$TARGET" 2>/dev/null; then echo "Mola, verileri ve yedekleri silindi."
  else echo "Mola ve verileri silindi. Klasörde Mola'ya ait olmayan dosyalar kaldı: $TARGET"; fi
else
  echo "Mola kaldırıldı. Veriler ve yedekler duruyor: $TARGET"
fi
echo "Flash bellek ya da başka yerdeki ikinci yedeklere dokunulmadı."
