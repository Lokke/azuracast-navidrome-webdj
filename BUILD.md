# SubCaster - Web & Desktop App

SubCaster ist eine professionelle DJ- und Streaming-Software, die sowohl als Web-App als auch als native Desktop-Anwendung verwendet werden kann.

## 🚀 Dual-Build-System

Dieses Projekt unterstützt zwei verschiedene Build-Targets aus derselben Codebase:

### 📱 Web-App
- Läuft in jedem modernen Browser
- Volle DJ-Funktionalität
- Live-Streaming zu Shoutcast/Icecast
- OpenSubsonic Integration

### 🖥️ Desktop-App (Electron)
- Native Windows/macOS/Linux App
- Alle Web-Features PLUS:
  - System Tray Integration
  - Globale Hotkeys (Media Keys)
  - Native Datei-Dialoge
  - Drag & Drop von lokalen Dateien
  - Minimize to Tray
  - Auto-Updates

## 🛠️ Development

### Setup
```bash
# Dependencies installieren
npm install

# Web-App Development Server
npm run dev

# Desktop-App Development (startet Web-Server + Electron)
npm run electron:dev
```

### Available Scripts

#### Web Development
```bash
npm run dev          # Web dev server (http://localhost:5173)
npm run build:web    # Web production build
npm run preview      # Preview web build
```

#### Desktop Development
```bash
npm run electron:dev     # Desktop dev mode (Web + Electron)
npm run electron         # Start Electron with built web app
npm run build:electron   # Compile Electron TypeScript
```

#### Production Builds
```bash
# Web-App für Deployment
npm run build:web

# Desktop-App (alle Plattformen)
npm run build:desktop

# Plattform-spezifische Desktop Builds
npm run build:desktop:win    # Windows (NSIS Installer)
npm run build:desktop:mac    # macOS (DMG)
npm run build:desktop:linux  # Linux (AppImage, DEB, RPM)

# Alles bauen
npm run build:all
```

## 📁 Project Structure

```
subcaster/
├── src/                    # Web-App Source Code
│   ├── main.ts            # Main Web App
│   ├── navidrome.ts       # OpenSubsonic Client
│   ├── desktop-features.ts # Desktop Integration
│   └── style.css          # Styles
├── electron/               # Desktop-App Code
│   ├── main.ts            # Electron Main Process
│   ├── preload.ts         # Electron Preload Script
│   └── tsconfig.json      # Electron TypeScript Config
├── public/                 # Static Assets
├── dist/                   # Web Build Output
├── dist-electron/          # Desktop Build Output
├── electron-builder.yml   # Desktop Build Configuration
└── package.json           # Scripts & Dependencies
```

## 🔧 Platform Detection

Der Code erkennt automatisch, ob er in der Web- oder Desktop-Version läuft:

```typescript
import { PlatformUtils, DesktopFeatures } from './desktop-features';

// Plattform erkennen
if (PlatformUtils.isElectron()) {
  console.log('Running as desktop app');
  DesktopFeatures.init();
} else {
  console.log('Running as web app');
}

// Platform-spezifische Features
if (PlatformUtils.isElectron()) {
  // Desktop-only features
  DesktopFeatures.updateStreamingStatus(true);
} else {
  // Web-only fallbacks
  console.log('Desktop features not available');
}
```

## 📦 Build Output

### Web-App (`dist/`)
- Optimierte Web-Assets
- Für Webserver-Deployment
- Kann in Docker containerized werden

### Desktop-App (`dist-electron/`)
- **Windows**: `.exe` Installer (NSIS)
- **macOS**: `.dmg` Disk Image
- **Linux**: `.AppImage`, `.deb`, `.rpm`

## 🎯 Desktop Features

Die Desktop-Version bietet zusätzliche Features:

### System Integration
- **System Tray**: Minimize to tray, quick controls
- **Global Hotkeys**: Space (Play/Pause), Media Keys
- **Native Menus**: File, Edit, Playback, Streaming, etc.

### File Operations
- **Drag & Drop**: Lokale Audio-Dateien auf Decks
- **File Dialogs**: Native Datei/Ordner-Auswahl
- **Local Files**: Unterstützung für lokale Musik-Bibliothek

### Window Management
- **Always on Top**: Optional
- **Multiple Monitors**: Support
- **Custom Window Controls**

## 🔧 Configuration

### Electron Builder (`electron-builder.yml`)
Konfiguriert die Desktop-Builds für alle Plattformen mit:
- Icons und Metadaten
- Installer-Optionen
- Code-Signing (für Distribution)
- Auto-Update-URLs

### TypeScript Configuration
- `tsconfig.json`: Web-App TypeScript Config
- `electron/tsconfig.json`: Desktop-App TypeScript Config

## 🚢 Distribution

### Web-App Deployment
```bash
npm run build:web
# Deploy dist/ folder to webserver
```

### Desktop-App Distribution
```bash
npm run build:desktop
# Installer files in dist-electron/
```

### GitHub Releases (Auto-Update)
```yaml
# electron-builder.yml
publish:
  provider: github
  owner: Lokke
  repo: subcaster
```

## 🛡️ Security

### Web-App
- Standard Web-Security
- CORS-Konfiguration für Streaming

### Desktop-App
- Context Isolation enabled
- Node Integration disabled
- Preload Script für sichere API-Exposition
- Code-Signing für Vertrauen

## 🔄 Development Workflow

1. **Feature Development**: Implementiere Features in `src/`
2. **Platform Detection**: Nutze `PlatformUtils` für Platform-spezifische Logik
3. **Desktop Enhancement**: Erweitere `DesktopFeatures` für native Funktionen
4. **Testing**: Teste sowohl Web- als auch Desktop-Version
5. **Build**: Erstelle beide Builds für Release

## 📋 TODO

- [ ] VST Plugin Support (Desktop)
- [ ] MIDI Controller Integration (Desktop)
- [ ] Hardware Audio Interface Support (Desktop)
- [ ] Auto-Updates Implementation
- [ ] Code-Signing Certificates
- [ ] CI/CD Pipeline für automatische Builds