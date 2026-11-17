@echo off
title Music Sync Service
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& '%~dp0sync-music.ps1'"
pause
