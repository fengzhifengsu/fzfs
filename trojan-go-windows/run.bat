@echo off
cd /d %~dp0
echo Starting Trojan-Go client...
echo Press Ctrl+C to exit
echo.
trojan-go.exe -config client.json
pause