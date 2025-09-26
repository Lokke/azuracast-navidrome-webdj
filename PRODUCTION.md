# SubCaster Production Deployment

Robuste Produktions-Scripts für SubCaster mit automatischem Neustart bei Crashes.

## 🚀 Schnellstart

### Produktionsserver starten
```bash
npm run start:production
```

### Produktionsserver stoppen
```bash
npm run stop:production
```

### PowerShell Alternative (Windows)
```powershell
.\start-production.ps1
```

## 📋 Features

### ✅ Automatischer Build
- Kompiliert TypeScript automatisch
- Baut Vite-Distribution
- Validiert Build-Erfolg vor dem Start

### ✅ Crash Recovery
- Automatischer Neustart bei Server-Crashes
- Konfigurierbare maximale Restart-Anzahl (Standard: 10)
- Restart-Verzögerung von 5 Sekunden
- Graceful Shutdown bei SIGTERM/SIGINT

### ✅ Process Management
- PID-File Verwaltung (`subcaster.pid`)
- Verhindert mehrfache Server-Instanzen
- Cleanup bei Shutdown

### ✅ Logging
- Vollständige Logs in `production.log`
- Timestamp für alle Log-Einträge
- Separate Behandlung von stdout/stderr
- Build-Logs und Server-Logs

### ✅ Monitoring
- Server-Status Überwachung
- Restart-Counter
- Graceful Shutdown mit Timeout
- Force-Kill als Fallback

## ⚙️ Konfiguration

### Node.js Script (`start-production.js`)
```javascript
const CONFIG = {
  maxRestarts: 10,      // Maximale Restart-Versuche
  restartDelay: 5000,   // Verzögerung zwischen Restarts (ms)
  buildTimeout: 300000, // Build-Timeout (ms)
  port: 3001           // Server-Port
};
```

### PowerShell Script (`start-production.ps1`)
```powershell
# Aufruf mit Custom-Parametern
.\start-production.ps1 -MaxRestarts 15 -RestartDelay 3000 -Port 8080
```

### Umgebungsvariablen
```bash
export NODE_ENV=production
export PORT=3001
```

## 📁 Dateien

### Generierte Dateien
- `production.log` - Vollständige Server-Logs
- `subcaster.pid` - Process ID des laufenden Servers
- `build.log` / `build-error.log` - Temporäre Build-Logs (PowerShell)

### Script-Dateien
- `start-production.js` - Node.js Produktions-Starter
- `start-production.ps1` - PowerShell Produktions-Starter
- `stop-production.js` - Server-Stopper
- `unified-server.js` - Haupt-Server-Datei

## 🔧 Troubleshooting

### Server läuft bereits
```
❌ Server already running with PID 1234
Use "npm run stop:production" to stop the existing server
```
**Lösung:** `npm run stop:production` ausführen

### Build-Fehler
```
❌ Build failed with code 1
```
**Lösung:** 
1. Dependencies prüfen: `npm install`
2. TypeScript-Fehler beheben
3. Manueller Build-Test: `npm run build`

### Maximale Restarts erreicht
```
❌ Maximum restart attempts (10) reached. Giving up.
```
**Lösung:**
1. Logs in `production.log` prüfen
2. Grund für wiederholte Crashes finden
3. Konfiguration oder Code reparieren

### Port bereits belegt
```
Error: listen EADDRINUSE :::3001
```
**Lösung:**
1. Anderen Port verwenden: `PORT=8080 npm run start:production`
2. Bestehenden Prozess auf Port beenden

## 📊 Monitoring

### Live-Logs verfolgen
```bash
# Linux/Mac
tail -f production.log

# Windows PowerShell
Get-Content production.log -Wait
```

### Server-Status prüfen
```bash
# PID-File existiert?
ls -la subcaster.pid

# Prozess läuft?
ps aux | grep node
```

### Log-Analyse
```bash
# Fehler-Logs filtern
grep "ERROR" production.log

# Restart-Events
grep "crashed" production.log

# Build-Events
grep "Build" production.log
```

## 🎯 Production Checklist

### Vor dem Deploy
- [ ] `.env` Datei mit Produktions-Werten
- [ ] Dependencies installiert (`npm install`)
- [ ] Port-Konfiguration geprüft
- [ ] Firewall-Regeln für Port
- [ ] SSL-Zertifikate (falls HTTPS)

### Nach dem Deploy
- [ ] Server-Start erfolgreich (`production.log`)
- [ ] HTTP-Endpoint erreichbar
- [ ] WebSocket-Verbindungen funktional
- [ ] Audio-Streaming funktional

### Wartung
- [ ] Regelmäßige Log-Rotation
- [ ] Disk-Space Monitoring
- [ ] Backup-Strategie
- [ ] Update-Prozedur

## 🔐 Sicherheit

### Empfohlene Einstellungen
```bash
# Benutzer ohne Root-Rechte
useradd -r -s /bin/false subcaster

# Service-User für Prozess
sudo -u subcaster npm run start:production

# Firewall-Regel
ufw allow 3001/tcp
```

### Systemd Service (Linux)
```ini
[Unit]
Description=SubCaster Production Server
After=network.target

[Service]
Type=simple
User=subcaster
WorkingDirectory=/path/to/subcaster
ExecStart=/usr/bin/npm run start:production
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

## 📞 Support

Bei Problemen:
1. `production.log` prüfen
2. GitHub Issues erstellen
3. Server-Konfiguration mitteilen
4. Log-Auszüge anhängen