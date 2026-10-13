// Mola-Sunucu.cmd, the café server's Windows launcher (Mola.exe starts it; so does the update applier after an install).
// Kept here so scripts/build-installer.mjs and the update tests use the very same text.
//
// 13 Ekim: the update applier is started by the watchdog, and on Windows it inherits the watchdog's standard output, the
// open logs\sunucu.log. While the applier waits for the new version to answer, cmd cannot open that file for its ">>":
// it then does not run node at all, so neither the new version nor the old one (rollback) ever started, and the café was
// closed until the owner opened Mola again. Now the launcher first checks that the log opens; if it does not, the server
// writes to logs\sunucu-<random>.log instead and starts anyway.
/** CRLF text of Mola-Sunucu.cmd. `merkezUrl`: the Mola Merkez the café talks to; `merkezLan`: a plain-HTTP Merkez on the café network. */
export function molaSunucuCmd({ merkezUrl, merkezLan = false }) {
  return `
@echo off
cd /d "%~dp0app"
if exist "%~dp0ayarlar.cmd" call "%~dp0ayarlar.cmd"
set SERVE_BUILD=1
set MOLA_MODE=installed
set MOLA_KEY_PROTECTION=1
set MOLA_CLEAN_INSTALL=1
set MOLA_DESKTOP_KEY=%~dp0masaustu.anahtar
set MOLA_FIREWALL_HELPER=%~dp0Mola.exe
if not defined DATA_DIR set DATA_DIR=%~dp0veri
if not defined PORT set PORT=3000
if not defined MOLA_MERKEZ_URL set MOLA_MERKEZ_URL=${merkezUrl}${merkezLan ? '\nif not defined MOLA_MERKEZ_LAN set MOLA_MERKEZ_LAN=1' : ''}
set MOLA_AG=--lan
if "%MOLA_LAN%"=="0" set MOLA_AG=
if not exist "%~dp0logs" mkdir "%~dp0logs"
set MOLA_KAYIT=sunucu.log
2>nul (type nul >> "%~dp0logs\\sunucu.log") || set MOLA_KAYIT=sunucu-%RANDOM%.log
"%~dp0runtime\\node.exe" --disable-warning=ExperimentalWarning nobetci.mjs server.mjs %MOLA_AG% >> "%~dp0logs\\%MOLA_KAYIT%" 2>&1
`.trim().split('\n').map(l => l.trimEnd()).join('\r\n') + '\r\n';
}
