# 🎵 DJ Radio WebApp - Startup Guide

Dieses Projekt ist eine professionelle DJ-Webapp mit WebRTC-Streaming zu Shoutcast-Servern.

## 🚀 Schnellstart

### Option 1: Alles mit einem Klick (Windows)
```cmd
start-dj-app.bat
```
Doppelklick auf `start-dj-app.bat` startet automatisch:
- ✅ CORS Proxy Server (Port 3001)
- ✅ WebRTC Signaling Server (Port 3002) 
- ✅ WebRTC-to-Shoutcast Bridge (Port 3003)
- ✅ DJ WebApp (Port 5173)

### Option 2: Mit NPM (alle Plattformen)
```bash
# Alle Services gleichzeitig starten
npm run start:all

# Oder nur Backend-Services
npm run start:services

# Oder manuell einzeln
npm run start:proxy    # CORS Proxy
npm run start:signaling # WebRTC Signaling  
npm run start:bridge    # WebRTC Bridge
npm run dev            # DJ WebApp
```

### Option 3: Shell Script (Linux/macOS)
```bash
./start-dj-app.sh
```

## 🏗️ System-Architektur

```
🎧 DJ WebApp (Port 5173)
    ↓ (WebRTC Audio)
📡 WebRTC Signaling (Port 3002)
    ↓
🌉 WebRTC-to-Shoutcast Bridge (Port 3003)
    ↓ (HTTP Streaming)
🎵 Shoutcast Server (funkturm.radio-endstation.de:8015)

🔒 CORS Proxy (Port 3001) - Fallback Option
```

## ⚙️ Konfiguration

Alle Einstellungen in `.env`:

```env
# Bridge-Modus (empfohlen)
VITE_USE_BRIDGE=true
VITE_WEBRTC_BRIDGE=ws://localhost:3003

# Server-Ports
PROXY_PORT=3001
WEBRTC_SIGNALING_PORT=3002
WEBRTC_BRIDGE_PORT=3003

# Shoutcast-Ziel
SHOUTCAST_URL=http://51.75.145.84:8015
SHOUTCAST_USERNAME=test
SHOUTCAST_PASSWORD=test
```

## 📊 Service-Status

Nach dem Start sind folgende URLs verfügbar:

- 🌐 **DJ WebApp**: http://localhost:5173
- 🔒 **CORS Proxy Health**: http://localhost:3001/health  
- 📡 **WebRTC Signaling Health**: http://localhost:3002/health
- 🌉 **WebRTC Bridge Health**: http://localhost:3003/health

## 🎵 Features

### 🎚️ DJ-Controls
- **Dual Deck System**: Zwei unabhängige Player (Links/Rechts)
- **Crossfader**: Nahtloses Mischen zwischen Decks
- **Microphone**: Ein/Aus-Schalter mit Gain-Control
- **Live Streaming**: WebRTC→Shoutcast Bridge-Technologie

### 📡 Streaming-Modi

1. **🌉 WebRTC Bridge** (Standard)
   - Moderne WebRTC-Technologie
   - Automatische Weiterleitung an Shoutcast
   - Keine CORS-Probleme
   - Beste Audio-Qualität

2. **🔒 CORS Proxy** (Fallback)
   - Direkte HTTP-Übertragung
   - Umgeht Browser-CORS-Beschränkungen
   - Kompatibel mit allen Shoutcast-Servern

3. **📡 Pure WebRTC** (P2P)
   - Direkte Peer-to-Peer-Verbindungen
   - Niedrigste Latenz
   - Für WebRTC-kompatible Empfänger

## 📝 Logs

Alle Services loggen in das `logs/` Verzeichnis:
- `logs/proxy.log` - CORS Proxy
- `logs/signaling.log` - WebRTC Signaling
- `logs/bridge.log` - WebRTC Bridge  
- `logs/vite.log` - DJ WebApp

## 🛠️ Troubleshooting

### Services starten nicht?
```bash
# Node.js Version prüfen
node --version  # Benötigt v16+

# Dependencies neu installieren
npm install

# Ports prüfen (Windows)
netstat -ano | findstr ":3001"
netstat -ano | findstr ":3002" 
netstat -ano | findstr ":3003"

# Ports prüfen (Linux/macOS)
lsof -i :3001
lsof -i :3002
lsof -i :3003
```

### Audio funktioniert nicht?
1. ✅ Mikrofon-Berechtigung im Browser erlauben
2. ✅ HTTPS verwenden für WebRTC (außer localhost)
3. ✅ Audio-Context nach User-Interaction aktivieren
4. ✅ Bridge-Server läuft und ist erreichbar

### Streaming-Probleme?
1. ✅ `.env` Konfiguration prüfen
2. ✅ Shoutcast-Server erreichbar: `curl http://51.75.145.84:8015`
3. ✅ WebRTC Bridge Health-Check: `curl http://localhost:3003/health`
4. ✅ Browser-Konsole auf Fehler prüfen

## 🔧 Development

```bash
# Dependencies
npm install

# Development-Server
npm run dev

# Build für Production  
npm run build

# Preview Production-Build
npm run preview
```

## 📦 Tech-Stack

- **Frontend**: Vite + TypeScript + Web Audio API
- **Backend**: Express.js + WebSocket
- **Streaming**: WebRTC + MediaRecorder + Shoutcast
- **Proxy**: http-proxy-middleware
- **Real-time**: WebSocket (ws)

## 🎯 Live-Server

**Ziel-Server**: `funkturm.radio-endstation.de:8015`
- **URL**: http://51.75.145.84:8015
- **Auth**: test:test  
- **Format**: MP3/Icecast-kompatibel

---

🎵 **Happy DJing!** 🎧