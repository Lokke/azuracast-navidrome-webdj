# WebDJ Docker Examples

## Quick Start Commands

### Using Docker Compose (Recommended)
```bash
# Clone the repository
git clone https://github.com/Lokke/azuracast-navidrome-webdj.git
cd azuracast-navidrome-webdj

# Start with default settings
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

### Using Docker Run
```bash
# Build the image
docker build -t webdj .

# Run with default settings
docker run -d \
  --name webdj \
  -p 5173:5173 \
  -p 8082:8082 \
  webdj

# Run with custom streaming server
docker run -d \
  --name webdj-custom \
  -p 5173:5173 \
  -p 8082:8082 \
  -e STREAM_USERNAME=myuser \
  -e STREAM_PASSWORD=mypass \
  -e STREAM_SERVER=my.streaming.server \
  -e STREAM_PORT=8000 \
  -e STREAM_MOUNT=/live \
  webdj
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `STREAM_USERNAME` | `test` | Harbor streaming username |
| `STREAM_PASSWORD` | `test` | Harbor streaming password |
| `STREAM_SERVER` | `funkturm.radio-endstation.de` | Streaming server hostname |
| `STREAM_PORT` | `8015` | Harbor port |
| `STREAM_MOUNT` | `/` | Mount point |

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

- **5173**: Web interface (WebDJ application)
- **8082**: CORS proxy for streaming

## Usage

1. Open http://localhost:5173 in your browser
2. Configure Navidrome credentials in the interface
3. Load tracks into the left and right players
4. Adjust volumes and crossfader position
5. Click "Start Streaming" to go live
6. Use microphone button for live input

## Troubleshooting

### Container won't start
```bash
# Check logs
docker logs webdj

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