@echo off
title DJ Radio WebApp - Complete Setup
echo.
echo 🎵 Starting DJ Radio WebApp with all services...
echo.

:: Ins Projektverzeichnis wechseln
cd /d "%~dp0"

:: Node.js Version prüfen
echo 📋 Checking Node.js version...
node --version
if %ERRORLEVEL% NEQ 0 (
    echo ❌ Node.js nicht gefunden! Bitte installieren Sie Node.js.
    pause
    exit /b 1
)
echo.

:: Dependencies prüfen
echo 📦 Checking dependencies...
if not exist node_modules (
    echo 📥 Installing dependencies...
    npm install
    echo.
)

:: .env-Datei prüfen
if not exist .env (
    echo ❌ .env-Datei nicht gefunden!
    echo Bitte erstellen Sie eine .env-Datei mit den nötigen Konfigurationen.
    pause
    exit /b 1
)

:: Ports aus .env laden
echo 🔍 Loading configuration from .env...
for /f "tokens=2 delims==" %%a in ('type .env 2^>nul ^| findstr "PROXY_PORT"') do set PROXY_PORT=%%a
for /f "tokens=2 delims==" %%a in ('type .env 2^>nul ^| findstr "WEBRTC_SIGNALING_PORT"') do set WEBRTC_SIGNALING_PORT=%%a
for /f "tokens=2 delims==" %%a in ('type .env 2^>nul ^| findstr "WEBRTC_BRIDGE_PORT"') do set WEBRTC_BRIDGE_PORT=%%a

:: Standard-Ports falls nicht in .env gefunden
if not defined PROXY_PORT set PROXY_PORT=3001
if not defined WEBRTC_SIGNALING_PORT set WEBRTC_SIGNALING_PORT=3002
if not defined WEBRTC_BRIDGE_PORT set WEBRTC_BRIDGE_PORT=3003

echo ✅ Configuration loaded:
echo    - CORS Proxy:        Port %PROXY_PORT%
echo    - WebRTC Signaling:  Port %WEBRTC_SIGNALING_PORT%
echo    - WebRTC Bridge:     Port %WEBRTC_BRIDGE_PORT%
echo    - DJ WebApp:         Port 5173 (Vite)
echo.

:: Server im Hintergrund starten
echo 🚀 Starting backend services...

echo 📡 Starting CORS Proxy Server...
start /b "DJ-CORS-Proxy" cmd /c "node proxy-server.js > logs\proxy.log 2>&1"
timeout /t 2 /nobreak >nul

echo 🌐 Starting WebRTC Signaling Server...
start /b "DJ-WebRTC-Signaling" cmd /c "node webrtc-signaling-server.js > logs\signaling.log 2>&1"
timeout /t 2 /nobreak >nul

echo 🌉 Starting WebRTC-to-Shoutcast Bridge...
start /b "DJ-WebRTC-Bridge" cmd /c "node webrtc-shoutcast-bridge.js > logs\bridge.log 2>&1"
timeout /t 3 /nobreak >nul

echo.
echo ✅ All backend services started!
echo.

:: Health-Checks
echo 🔍 Performing health checks...
timeout /t 2 /nobreak >nul

curl -s http://localhost:%PROXY_PORT%/health >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo ✅ CORS Proxy:       http://localhost:%PROXY_PORT% - OK
) else (
    echo ❌ CORS Proxy:       http://localhost:%PROXY_PORT% - FAILED
)

curl -s http://localhost:%WEBRTC_SIGNALING_PORT%/health >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo ✅ WebRTC Signaling: http://localhost:%WEBRTC_SIGNALING_PORT% - OK
) else (
    echo ❌ WebRTC Signaling: http://localhost:%WEBRTC_SIGNALING_PORT% - FAILED
)

curl -s http://localhost:%WEBRTC_BRIDGE_PORT%/health >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo ✅ WebRTC Bridge:    http://localhost:%WEBRTC_BRIDGE_PORT% - OK
) else (
    echo ❌ WebRTC Bridge:    http://localhost:%WEBRTC_BRIDGE_PORT% - FAILED
)

echo.
echo 📊 Service URLs:
echo    🌐 DJ WebApp:         http://localhost:5173
echo    🔒 CORS Proxy:        http://localhost:%PROXY_PORT%/health
echo    📡 WebRTC Signaling:  http://localhost:%WEBRTC_SIGNALING_PORT%/health  
echo    🌉 WebRTC Bridge:     http://localhost:%WEBRTC_BRIDGE_PORT%/health
echo.

:: Log-Verzeichnis erstellen
if not exist logs mkdir logs

echo 📝 Log files:
echo    - logs\proxy.log
echo    - logs\signaling.log
echo    - logs\bridge.log
echo    - logs\vite.log (after starting)
echo.

:: Vite Dev Server starten (im Vordergrund)
echo 🎯 Starting Vite Development Server...
echo.
echo 🎵 DJ Radio WebApp wird gestartet...
echo 🌐 Öffnen Sie: http://localhost:5173
echo.

npm run dev 2>&1 | tee logs\vite.log

echo.
echo ⏹️ DJ WebApp beendet.
echo.

:: Cleanup: Background-Prozesse beenden
echo 🧹 Stopping background services...
taskkill /f /im node.exe >nul 2>&1
echo ✅ All services stopped.
echo.
pause