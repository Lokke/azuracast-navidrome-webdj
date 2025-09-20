# 🎵 Browser-Based Shoutcast Streaming

## ✅ Keine externe Software nötig!

Diese Lösung funktioniert **komplett im Browser** ohne Liquidsoap oder andere externe Programme.

## 🚀 Quick Start

### 1. Proxy Server starten
```powershell
node simple-shoutcast-proxy.js
```

### 2. DJ App starten  
```powershell
npm run dev
```

### 3. Streaming Component einbauen
```jsx
import StreamingControl from './components/StreamingControl';

// In Ihrer DJ App Komponente:
<StreamingControl 
    audioContext={audioContext} 
    masterGainNode={masterGainNode} 
/>
```

## 🏗️ Architektur

```
Browser MediaRecorder → WebSocket → Simple Proxy → Shoutcast Server
```

**Vorteile:**
- ✅ Keine externe Software-Installation
- ✅ Läuft komplett in JavaScript/Node.js
- ✅ DirectAudio-Encoding im Browser
- ✅ Einfache WebSocket-Kommunikation
- ✅ Automatische Reconnection
- ✅ Real-time Status Updates

## 📊 Features

- **Live Status**: Streaming-Status, Bytes übertragen, Verbindung
- **Error Handling**: Automatische Fehlerbehandlung und Reconnection
- **Audio Formats**: Automatische Auswahl des besten unterstützten Formats
- **Low Latency**: 100ms Audio-Chunks für minimale Verzögerung

## 🔧 Technische Details

### Audio-Encoding
- Browser `MediaRecorder` API
- Automatische Format-Auswahl (WebM/MP4/WAV)
- 128 kbps Bitrate
- 100ms Chunk-Größe

### Proxy Server
- WebSocket für Browser-Kommunikation
- ICY-Protokoll für Shoutcast
- Automatische Reconnection
- Health-Check Endpoints

### Shoutcast Konfiguration
- **Server**: 51.75.145.84:8015
- **Mount**: /radio.mp3  
- **Auth**: test:test
- **Format**: audio/mpeg

## 🛠️ Entwicklung

### Proxy Server erweitern
```javascript
// simple-shoutcast-proxy.js
const SHOUTCAST_CONFIG = {
    host: '51.75.145.84',
    port: 8015,
    mount: '/radio.mp3',
    username: 'test',
    password: 'test'
    // ... weitere Optionen
};
```

### React Component anpassen
```jsx
// StreamingControl.jsx
const PROXY_URL = 'ws://localhost:3001/stream';
// ... Component Logic
```

## 📋 Troubleshooting

### Proxy nicht erreichbar
```powershell
# Prüfen ob Port 3001 frei ist
netstat -an | findstr :3001

# Proxy neu starten
node simple-shoutcast-proxy.js
```

### Browser-Fehler
- Prüfen Sie die Browser-Konsole
- MediaRecorder API muss unterstützt werden
- HTTPS kann für manche Features erforderlich sein

### Shoutcast Verbindung
```powershell
# Health Check
curl http://localhost:3001/health

# Status Details
curl http://localhost:3001/status
```

## 🎯 Integration in bestehende DJ App

1. **Audio Context**: Stellen Sie sicher, dass `audioContext` verfügbar ist
2. **Master Gain**: `masterGainNode` muss das finale Mixed Audio haben
3. **Component**: `StreamingControl` irgendwo in der UI einbauen

## 🆚 Vergleich zu Liquidsoap

| Feature | Browser-Lösung | Liquidsoap |
|---------|----------------|------------|
| Installation | ❌ Keine | ✅ Externe Software |
| Setup | ✅ Einfach | ❌ Komplex |
| Wartung | ✅ Minimal | ❌ Aufwändig |
| Flexibilität | ✅ Anpassbar | ✅ Sehr flexibel |
| Performance | ✅ Gut | ✅ Exzellent |

**Empfehlung**: Starten Sie mit der Browser-Lösung - sie ist einfacher und für die meisten Anwendungsfälle ausreichend!