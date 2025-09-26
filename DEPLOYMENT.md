# SubCaster Production Deployment Guide

## 🎯 Was Sie für die Produktion benötigen

Das `create-production-deployment.js` Script erstellt einen sauberen `production/` Ordner mit **nur** den notwendigen Dateien:

### ✅ Enthaltene Dateien (17 Files, ~1.33 MB):

#### 🔧 **Core Server Files**
- `unified-server.js` - Haupt-Server-Datei
- `package.json` - Nur Production Dependencies  
- `package-lock.json` - Dependency Versionen
- `tsconfig.json` - TypeScript Konfiguration

#### 🚀 **Production Scripts** 
- `start-production.js` - Auto-Restart Production Starter
- `stop-production.js` - Graceful Server Stopper

#### 🏗️ **Built Application**
- `dist/` - Kompilierte Web-App (HTML, CSS, JS)
  - `index.html` - Haupt-HTML-Datei
  - `assets/` - CSS/JS Bundles
  - `material-icons.woff2` - Icon Font

#### 🖼️ **Static Assets**
- `public/` - Statische Assets (Icons, etc.)

#### 📚 **Documentation**
- `README.md` - Deployment Anleitung
- `PRODUCTION.md` - Production Guide
- `LICENSE.md` - Lizenz

#### ⚙️ **Configuration Templates**
- `.env.production.example` - Environment Template

### ❌ **Nicht enthalten** (spart ~500MB+):
- `src/` - Source Code (nicht benötigt)
- `node_modules/` - Dev Dependencies 
- `electron/` - Desktop App Files
- `.git/` - Git Repository
- `.vscode/` - Editor Konfiguration
- `config/` - Development Configs
- Docker Files
- Build Scripts
- Aktuelle `.env` (Sicherheit!)

## 🚀 **Deployment Workflow**

### 1. Production Package erstellen
```bash
npm run deploy:production
```

### 2. Production Ordner kopieren
```bash
# Gesamten production/ Ordner auf Server kopieren
scp -r production/ user@server:/opt/subcaster/
# oder per FTP, Git, Docker, etc.
```

### 3. Auf Server installieren
```bash
cd /opt/subcaster
npm install --production
cp .env.production.example .env
# .env mit echten Werten editieren
```

### 4. Server starten
```bash
npm start
# oder: node start-production.js
```

## 🔧 **Production Features**

### Auto-Restart & Monitoring
- Automatischer Neustart bei Crashes (max. 10x)
- Vollständige Logs in `production.log`
- PID-Management verhindert Doppel-Instanzen
- Graceful Shutdown via SIGTERM/SIGINT

### Optimierte package.json
- Nur Production Dependencies
- Vereinfachte Scripts (`start`, `stop`, `start:server`)
- Node.js Version Requirements
- Production-optimierte Konfiguration

### Environment Configuration
- Sichere Environment-Template
- Keine Secrets im Package
- Flexible Port-Konfiguration
- Production Environment Flags

## 📊 **Deployment Statistiken**

- **Dateien**: 17 (vs. ~2000+ im Entwicklungsordner)
- **Größe**: ~1.33 MB (vs. ~500MB+ mit node_modules)
- **Dependencies**: Nur Runtime (keine Dev-Tools)
- **Startup Zeit**: < 5 Sekunden
- **Memory Footprint**: ~50-100MB je nach Load

## 🛠️ **Server Requirements**

### Minimum
- **Node.js**: 18.0.0+
- **RAM**: 512MB
- **Disk**: 50MB + Logs
- **Port**: 3001 (konfigurierbar)

### Empfohlen
- **Node.js**: 20.0.0+ LTS
- **RAM**: 1GB+
- **Disk**: 1GB (für Logs)
- **CPU**: 1+ Cores
- **OS**: Linux/Windows/macOS

## 🔐 **Sicherheits-Checklist**

- [ ] `.env` Datei nicht in Git committen
- [ ] Server als Non-Root User laufen lassen
- [ ] Reverse Proxy (nginx) für HTTPS verwenden
- [ ] Firewall für Port 3001 konfigurieren
- [ ] Regelmäßige Updates der Dependencies
- [ ] Log-Rotation einrichten
- [ ] Backup-Strategie für Konfiguration

## 🎛️ **Quick Commands**

```bash
# Development
npm run deploy:production    # Create production package

# Production Server
npm start                   # Start with auto-restart
npm stop                    # Graceful shutdown
node unified-server.js      # Direct server start
tail -f production.log      # Monitor logs
```

## 📈 **Scaling Options**

### Single Server
- Node.js Cluster Module
- PM2 Process Manager
- Systemd Service

### Multi Server
- Load Balancer (nginx)
- Docker Swarm/Kubernetes
- Database für Session Storage

### Cloud Deployment
- Heroku, Railway, Render
- AWS ECS, Google Cloud Run
- Azure Container Instances

---

**🎵 SubCaster Production Ready!** 

Kompakte, sichere und wartbare Production Deployments in unter 2MB! 🚀