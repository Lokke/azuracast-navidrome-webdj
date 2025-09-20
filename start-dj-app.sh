#!/bin/bash

# DJ Radio WebApp - Complete Setup Script
# Startet alle Services gleichzeitig

set -e

echo "🎵 Starting DJ Radio WebApp with all services..."
echo

# Ins richtige Verzeichnis wechseln
cd "$(dirname "$0")"

# Node.js Version prüfen
echo "📋 Checking Node.js version..."
if ! node --version; then
    echo "❌ Node.js not found! Please install Node.js."
    exit 1
fi
echo

# Dependencies prüfen
echo "📦 Checking dependencies..."
if [ ! -d "node_modules" ]; then
    echo "📥 Installing dependencies..."
    npm install
    echo
fi

# .env-Datei prüfen
if [ ! -f ".env" ]; then
    echo "❌ .env file not found!"
    echo "Please create .env file with required configurations."
    exit 1
fi

# Konfiguration laden
echo "🔍 Loading configuration from .env..."
source .env

# Standard-Ports setzen falls nicht definiert
PROXY_PORT=${PROXY_PORT:-3001}
WEBRTC_SIGNALING_PORT=${WEBRTC_SIGNALING_PORT:-3002}
WEBRTC_BRIDGE_PORT=${WEBRTC_BRIDGE_PORT:-3003}

echo "✅ Configuration loaded:"
echo "   - CORS Proxy:        Port $PROXY_PORT"
echo "   - WebRTC Signaling:  Port $WEBRTC_SIGNALING_PORT"
echo "   - WebRTC Bridge:     Port $WEBRTC_BRIDGE_PORT"
echo "   - DJ WebApp:         Port 5173 (Vite)"
echo

# Log-Verzeichnis erstellen
mkdir -p logs

# Cleanup-Funktion für Ctrl+C
cleanup() {
    echo
    echo "🧹 Stopping all services..."
    kill $(jobs -p) 2>/dev/null || true
    echo "✅ All services stopped."
    exit 0
}
trap cleanup SIGINT SIGTERM

echo "🚀 Starting all services..."
echo

# Server im Hintergrund starten
echo "📡 Starting CORS Proxy Server..."
node proxy-server.js > logs/proxy.log 2>&1 &
sleep 1

echo "🌐 Starting WebRTC Signaling Server..."
node webrtc-signaling-server.js > logs/signaling.log 2>&1 &
sleep 1

echo "🌉 Starting WebRTC-to-Shoutcast Bridge..."
node webrtc-shoutcast-bridge.js > logs/bridge.log 2>&1 &
sleep 2

echo
echo "✅ All backend services started!"
echo

# Health-Checks (falls curl verfügbar ist)
echo "🔍 Performing health checks..."
sleep 2

if command -v curl >/dev/null 2>&1; then
    if curl -s "http://localhost:$PROXY_PORT/health" >/dev/null 2>&1; then
        echo "✅ CORS Proxy:       http://localhost:$PROXY_PORT - OK"
    else
        echo "❌ CORS Proxy:       http://localhost:$PROXY_PORT - FAILED"
    fi

    if curl -s "http://localhost:$WEBRTC_SIGNALING_PORT/health" >/dev/null 2>&1; then
        echo "✅ WebRTC Signaling: http://localhost:$WEBRTC_SIGNALING_PORT - OK"
    else
        echo "❌ WebRTC Signaling: http://localhost:$WEBRTC_SIGNALING_PORT - FAILED"
    fi

    if curl -s "http://localhost:$WEBRTC_BRIDGE_PORT/health" >/dev/null 2>&1; then
        echo "✅ WebRTC Bridge:    http://localhost:$WEBRTC_BRIDGE_PORT - OK"
    else
        echo "❌ WebRTC Bridge:    http://localhost:$WEBRTC_BRIDGE_PORT - FAILED"
    fi
else
    echo "ℹ️  curl not available, skipping health checks"
fi

echo
echo "📊 Service URLs:"
echo "   🌐 DJ WebApp:         http://localhost:5173"
echo "   🔒 CORS Proxy:        http://localhost:$PROXY_PORT/health"
echo "   📡 WebRTC Signaling:  http://localhost:$WEBRTC_SIGNALING_PORT/health"
echo "   🌉 WebRTC Bridge:     http://localhost:$WEBRTC_BRIDGE_PORT/health"
echo

echo "📝 Log files:"
echo "   - logs/proxy.log"
echo "   - logs/signaling.log"
echo "   - logs/bridge.log"
echo

echo "🎯 Starting Vite Development Server..."
echo
echo "🎵 DJ Radio WebApp starting..."
echo "🌐 Open: http://localhost:5173"
echo
echo "📝 Press Ctrl+C to stop all services"
echo

# Vite Dev Server starten (im Vordergrund)
npm run dev 2>&1 | tee logs/vite.log

# Cleanup nach Beendigung
cleanup