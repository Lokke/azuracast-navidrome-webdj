# SubCaster Docker Setup

## Sicherheitskonfiguration

**WICHTIG**: Die Credentials werden in der `.env.docker` Datei gespeichert und zur Build-Zeit in das JavaScript eingebaut.

## Erste Einrichtung

### 1. Credentials-Datei erstellen

```bash
# Kopiere das Example-File
cp .env.docker.example .env.docker

# Bearbeite mit deinen echten Credentials
nano .env.docker
```

### 2. Credentials konfigurieren

Bearbeite die Datei `.env.docker` und trage deine echten Credentials ein:

```bash
# Streaming Server Credentials
STREAM_USERNAME=dein_echter_username
STREAM_PASSWORD=dein_echtes_passwort

# Streaming Server Connection
STREAM_SERVER=funkturm.radio-endstation.de
STREAM_PORT=8015
STREAM_MOUNT=/

# OpenSubsonic Configuration (automatisch vorausgefüllt im Browser)
VITE_OpenSubsonic_URL=https://your.OpenSubsonic.server
VITE_OpenSubsonic_USERNAME=your_username
VITE_OpenSubsonic_PASSWORD=your_password
```

### 3. Container starten

```bash
# Mit Docker Compose (empfohlen)
docker-compose up -d

# Logs anschauen
docker-compose logs -f

# Stoppen
docker-compose down
```

### 4. Zugriff

Öffne <http://localhost:5173> in deinem Browser. Sowohl die Streaming- als auch die OpenSubsonic-Credentials sind bereits vorausgefüllt!

## Wie es funktioniert

1. **Build-Zeit**: Alle Credentials aus `.env.docker` werden in das JavaScript eingebaut
2. **Laufzeit**: Stream-Credentials werden für den CORS-Proxy verwendet
3. **Browser**: Alle Felder sind automatisch vorausgefüllt
4. **Sicherheit**: `.env.docker` ist in .gitignore und landet nicht auf GitHub

## Environment Variables

| Variable | Beschreibung | Eingebaut in |
|----------|-------------|-------------|
| `STREAM_USERNAME` | Harbor streaming username | JS + Proxy |
| `STREAM_PASSWORD` | Harbor streaming password | JS + Proxy |
| `STREAM_SERVER` | Streaming server | JS + Proxy |
| `STREAM_PORT` | Harbor port | JS + Proxy |
| `STREAM_MOUNT` | Mount point | JS + Proxy |
| `VITE_OpenSubsonic_URL` | OpenSubsonic Server URL | Nur JS |
| `VITE_OpenSubsonic_USERNAME` | OpenSubsonic Username | Nur JS |
| `VITE_OpenSubsonic_PASSWORD` | OpenSubsonic Password | Nur JS |

## Development

### Local Development
```bash
# Install dependencies
npm install

# Start CORS proxy
node cors-proxy-fixed.js

# Start dev server (in another terminal)
npm run dev
```

### Building for Production
```bash
# Build the application
npm run build

# Test production build
npx http-server dist -p 5173 --cors
```

## Ports

- **5173**: Web interface (SubCaster application)
- **8082**: CORS proxy for streaming

## Usage

1. Open http://localhost:5173 in your browser
2. Configure OpenSubsonic credentials in the interface
3. Load tracks into the left and right players
4. Adjust volumes and crossfader position
5. Click "Start Streaming" to go live
6. Use microphone button for live input

## Troubleshooting

### Container won't start
```bash
# Check logs
docker logs SubCaster

# Check if ports are available
netstat -tulpn | grep :5173
netstat -tulpn | grep :8082
```

### Streaming connection issues
- Verify streaming server credentials
- Check if server allows connections from your IP
- Ensure CORS proxy can reach the streaming server

### Browser audio issues
- Enable microphone permissions in browser
- Check if multiple tabs are trying to use audio
- Verify Web Audio API support in your browser
