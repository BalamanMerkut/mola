@echo off
rem Mola: copies this PC's own files (Claude chats, APK signing key, SSH key) to Google Drive (npm run bilgisayar:yedek).
rem Windows Task Scheduler starts this file once a day (npm run bilgisayar:yedek -- -Zamanla prints the command).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0bilgisayar-yedek.ps1"
exit /b %ERRORLEVEL%
