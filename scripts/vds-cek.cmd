@echo off
rem Mola: copies the VDS work folder and Merkez backups to this PC (npm run vds:cek).
rem Windows Task Scheduler starts this file once a day (npm run vds:cek -- --zamanla prints the command).
rem The tool writes its own log: .local\kayitlar\vds-cek.log
cd /d "%~dp0.."
call npm.cmd run --silent vds:cek
exit /b %ERRORLEVEL%
