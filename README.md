# Navidrome WebDJ for AzuraCast

A browser-based DJ application for streaming to AzuraCast/Liquidsoap Harbor.

## Features

- Browse and play music from Navidrome
- Real-time microphone input
- Live streaming to Liquidsoap Harbor
- Crossfader and volume controls
- Web-based interface

## Docker Setup (Recommended)

### Quick Start with Docker Compose

1. Clone the repository:
```bash
git clone https://github.com/Lokke/azuracast-navidrome-webdj.git
cd azuracast-navidrome-webdj
```

2. Start with Docker Compose:
```bash
docker-compose up -d
```

3. Open http://localhost:5173 in your browser

### Custom Docker Run

```bash
docker build -t webdj .
docker run -d \
  --name webdj \
  -p 5173:5173 \
  -p 8082:8082 \
  -e STREAM_USERNAME=your_username \
  -e STREAM_PASSWORD=your_password \
  -e STREAM_SERVER=your.streaming.server \
  -e STREAM_PORT=8015 \
  -e STREAM_MOUNT=/ \
  webdj
```

### Environment Variables

- `STREAM_USERNAME`: Harbor streaming username
- `STREAM_PASSWORD`: Harbor streaming password  
- `STREAM_SERVER`: Streaming server hostname
- `STREAM_PORT`: Harbor port (default: 8015)
- `STREAM_MOUNT`: Mount point (default: /)

## Manual Setup

1. Install dependencies:
```bash
npm install
```

2. Configure streaming credentials in `.env`:
```
VITE_STREAM_USERNAME=your_username
VITE_STREAM_PASSWORD=your_password
```

3. Start the CORS proxy:
```bash
node cors-proxy-fixed.js
```

4. Start the development server:
```bash
npm run dev
```

5. Open http://localhost:5173 in your browser

## Configuration

The application connects to:
- Streaming server: funkturm.radio-endstation.de:8015
- Mount point: /
- Protocol: HTTP POST via SOURCE

## Usage

1. Load tracks into both players
2. Adjust volumes and crossfader
3. Click "Start Streaming" to go live
4. Use microphone for live announcements

## Docker Ports

- `5173`: Web interface
- `8082`: CORS proxy for streaming

## Development

For development with hot reload:
```bash
npm run dev
```

Access the application at http://localhost:5173