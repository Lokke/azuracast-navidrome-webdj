# SubCaster# SubCaster



Web interface for radio moderators. Provides access to music from OpenSubsonic-compatible servers (Navidrome, Gonic) with live streaming to AzuraCast.Web-Interface für Radiomoderatoren. Ermöglicht Zugriff auf Musik von OpenSubsonic-kompatiblen Servern (Navidrome, Gonic) und Live-Streaming an AzuraCast.



## Features## Features



- Music library browser for OpenSubsonic servers- Musikbibliothek-Browser für OpenSubsonic-Server

- Dual-deck audio player with crossfader- Dual-Deck Audio-Player mit Crossfader

- Microphone input with live mixing- Mikrofon-Eingang mit Live-Mixing

- Direct streaming to AzuraCast Harbor- Direktes Streaming an AzuraCast Harbor

- Smart metadata transmission- Intelligente Metadaten-Übertragung

- Browser-based interface- Browser-basierte Bedienung



## License## 📄 License



Non-commercial use only.**⚠️ NON-COMMERCIAL USE ONLY**



See LICENSE and COMMERCIAL-LICENSE.md for details.- 🆓 **Free for private/educational use**

- ❌ **Commercial use strictly prohibited**

## Docker Setup- � **Commercial licensing may be offered in the future**



Clone repository:See [LICENSE](LICENSE) and [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md) for details.



```bash**Commercial Use?** Currently not available. Contact: felix@pielok.de

git clone https://github.com/Lokke/subcaster.git

cd subcaster## Docker Setup (Recommended)

```

### Quick Start with Docker Compose

Start with Docker Compose:

1. Clone the repository:

```bash```bash

docker-compose up -dgit clone https://github.com/Lokke/subcaster.git

```cd subcaster

```

Open interface at http://localhost:5173

2. Start with Docker Compose:

### Environment Variables```bash

docker-compose up -d

- `STREAM_USERNAME`: Harbor streaming username```

- `STREAM_PASSWORD`: Harbor streaming password  

- `STREAM_SERVER`: Streaming server hostname3. Open http://localhost:5173 in your browser

- `STREAM_PORT`: Harbor port (default: 8015)

- `STREAM_MOUNT`: Mount point (default: /)### Custom Docker Run



## Manual Installation```bash

docker build -t subcaster .

Install dependencies:docker run -d \

  --name subcaster \

```bash  -p 5173:5173 \

npm install  -p 8082:8082 \

```  -e STREAM_USERNAME=your_username \

  -e STREAM_PASSWORD=your_password \

Configure streaming in `.env`:  -e STREAM_SERVER=your.streaming.server \

  -e STREAM_PORT=8015 \

```env  -e STREAM_MOUNT=/ \

VITE_STREAM_USERNAME=username  subcaster

VITE_STREAM_PASSWORD=password```

```

### Environment Variables

Start CORS proxy:

- `STREAM_USERNAME`: Harbor streaming username

```bash- `STREAM_PASSWORD`: Harbor streaming password  

node cors-proxy-fixed.js- `STREAM_SERVER`: Streaming server hostname

```- `STREAM_PORT`: Harbor port (default: 8015)

- `STREAM_MOUNT`: Mount point (default: /)

Start development server:

## Manual Setup

```bash

npm run dev1. Install dependencies:

``````bash

npm install

Open interface at http://localhost:5173```



## Configuration2. Configure streaming credentials in `.env`:

```

Connects to:VITE_STREAM_USERNAME=your_username

- Streaming server: funkturm.radio-endstation.de:8015VITE_STREAM_PASSWORD=your_password

- Mount point: /```

- Protocol: HTTP POST via SOURCE

3. Start the CORS proxy:

## Usage```bash

node cors-proxy-fixed.js

1. Load tracks into both players```

2. Adjust volumes and crossfader

3. Click "Start Streaming" for live broadcast4. Start the development server:

4. Use microphone for live announcements```bash
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