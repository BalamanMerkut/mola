#!/bin/sh
# Installs Mola for this user (no root needed): program to ~/.local/share/mola, menu entry, desktop icon and start-up.
# Running it again updates the program; data (veri/) and backups are kept.
set -e
SRC="$(cd "$(dirname "$0")" && pwd)"
TARGET="${1:-$HOME/.local/share/mola}"
echo "Mola kuruluyor: $TARGET"
if [ -x "$TARGET/mola" ]; then "$TARGET/mola" --durdur >/dev/null 2>&1 || true; sleep 2; fi
mkdir -p "$TARGET"
rm -rf "$TARGET/app" "$TARGET/runtime"
cp -R "$SRC/app" "$SRC/runtime" "$TARGET/"
cp "$SRC/mola" "$SRC/mola.png" "$SRC/BENIOKU.txt" "$SRC/kaldir.sh" "$TARGET/"
chmod +x "$TARGET/mola" "$TARGET/runtime/node" "$TARGET/kaldir.sh"
if [ "$2" = "--kisayolsuz" ]; then echo "Kurulum tamamlandı."; exit 0; fi

APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
AUTO="${XDG_CONFIG_HOME:-$HOME/.config}/autostart"
mkdir -p "$APPS" "$AUTO"
entry() {
  printf '[Desktop Entry]\nType=Application\nName=%s\nComment=Adisyon ve QR menü · Merkut Studios\nExec="%s/mola"%s\nIcon=%s/mola.png\nTerminal=false\nCategories=Office;\n' "$1" "$TARGET" "$2" "$TARGET"
}
entry "Mola" "" > "$APPS/mola.desktop"
entry "Mola sunucusu" " --arkaplan" > "$AUTO/mola-sunucu.desktop"
DESK="$(xdg-user-dir DESKTOP 2>/dev/null || true)"
[ -n "$DESK" ] || DESK="$HOME/Desktop"
if [ -d "$DESK" ]; then
  cp "$APPS/mola.desktop" "$DESK/Mola.desktop"
  chmod +x "$DESK/Mola.desktop"
  # GNOME asks before launching an unknown desktop file unless it is marked as trusted.
  if command -v gio >/dev/null 2>&1; then gio set "$DESK/Mola.desktop" metadata::trusted true 2>/dev/null || true; fi
fi
nohup "$TARGET/mola" >/dev/null 2>&1 &
echo "Kurulum tamamlandı. Mola birkaç saniye içinde açılır."
