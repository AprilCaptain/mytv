@echo off
setlocal
chcp 65001 >nul
set "MYTV_LAUNCH_ROOT=%~dp0"
set "MYTV_LAUNCH_ACTION=--stop"
powershell.exe -NoLogo -NoProfile -Command "& ([ScriptBlock]::Create([IO.File]::ReadAllText((Join-Path $env:MYTV_LAUNCH_ROOT 'scripts\bootstrap-windows.ps1'), [Text.Encoding]::UTF8)))"
set "MYTV_EXIT=%ERRORLEVEL%"
exit /b %MYTV_EXIT%
