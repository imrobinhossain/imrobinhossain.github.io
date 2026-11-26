@echo off
echo Stopping Music Sync Service...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*sync-music.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
echo Music Sync Service stopped.
ping 127.0.0.1 -n 2 >nul
