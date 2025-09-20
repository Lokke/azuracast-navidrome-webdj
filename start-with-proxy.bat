@echo off
echo.
echo 🎵 Starting DJ WebApp with CORS Proxy...
echo.

:: Prüfen ob Node.js verfügbar ist
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ❌ Node.js nicht gefunden! Bitte installieren Sie Node.js.
    pause
    exit /b 1
)

:: Ins Projektverzeichnis wechseln
cd /d "%~dp0"

:: Proxy Dependencies installieren falls noch nicht vorhanden
if not exist node_modules\express (
    echo 📦 Installing proxy dependencies...
    copy proxy-package.json package-proxy.json
    npm install --prefix . express http-proxy-middleware nodemon
    echo.
)

:: .env-Datei laden für Proxy-Port
for /f "tokens=2 delims==" %%a in ('type .env ^| findstr "PROXY_PORT"') do set PROXY_PORT=%%a
if not defined PROXY_PORT set PROXY_PORT=3001

echo 🚀 Starting CORS Proxy Server on port %PROXY_PORT%...
echo.

:: Proxy-Server im Hintergrund starten
start /b "DJ-Proxy" node proxy-server.js

:: Kurz warten damit Proxy startet
timeout /t 3 /nobreak >nul

echo ✅ Proxy Server gestartet!
echo 🌐 Dev Server starten mit: npm run dev
echo 📡 Proxy läuft auf: http://localhost:%PROXY_PORT%
echo 🔍 Health-Check: http://localhost:%PROXY_PORT%/health
echo.
echo 💡 Die App wird nun automatisch den Proxy verwenden (VITE_USE_PROXY=true)
echo.

:: Optional: Auch Dev-Server starten
set /p START_DEV="Auch Development Server starten? (y/n): "
if /i "%START_DEV%"=="y" (
    echo.
    echo 🎯 Starting Vite Dev Server...
    npm run dev
) else (
    echo.
    echo ℹ️  Starte später mit: npm run dev
    pause
)