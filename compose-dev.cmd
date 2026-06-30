@echo off
REM Double-click to start the LED "Compose" dev environment:
REM   - Control server on http://localhost:8088 (analyze / taste-rules / translate; reads .env for GEMINI_API_KEY)
REM   - Vite UI on http://localhost:5173 (the Timeline Manager with the Compose panel)
REM Two terminal windows open and STAY open; close them to stop the servers.
cd /d "%~dp0"
echo Starting LED Compose dev servers...
start "LED Control Server (8088)" cmd /k "set CONTROL_SERVER_PORT=8088&& node node_modules\ts-node\dist\bin.js --transpile-only src\control-server.ts"
start "LED UI - Vite (5173)" cmd /k "cd ui && node node_modules\vite\bin\vite.js --port 5173 --strictPort"
echo Waiting for the servers to come up...
timeout /t 7 >nul
start "" http://localhost:5173/
echo.
echo Done. If the page shows an old version, hard-refresh with Ctrl+Shift+R.
