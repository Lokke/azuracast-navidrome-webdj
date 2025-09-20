# WebDJ - Browser-Based DJ Application# DJ Radio Webapp



Modern web-based DJ application with dual players, crossfader, microphone input, and live streaming capabilities.A professional DJ/Radio interface with dual player decks, crossfader controls, and Navidrome music library integration.



## Features## Features



- **Dual DJ Players** - Load and mix tracks from Navidrome music library🎵 **Dual Player Decks**

- **Professional Crossfader** - Smooth transitions between decks- Independent left and right player controls

- **Microphone Integration** - Live microphone input with echo prevention- Play, pause, stop functionality

- **Live Streaming** - Direct broadcast to Liquidsoap Harbor (Radio Endstation)- Volume controls for each deck

- **Music Library** - Search and browse via Navidrome integration- Progress bars with real-time updates



## Quick Start🎛️ **Professional DJ Controls**

- Crossfader for seamless mixing between decks

1. **Install dependencies:**- Microphone on/off switch

   ```bash- Broadcast button for live streaming

   npm install

   ```📚 **Music Library Integration**

- Connected to Navidrome server

2. **Configure environment:**- Search functionality for tracks, artists, albums

   Copy `.env.example` to `.env` and set your Navidrome credentials- Drag and drop tracks to players or queue

- Queue management for upcoming tracks

3. **Start CORS proxy:**

   ```bash🎨 **Modern Interface**

   node cors-proxy-fixed.js- Responsive design for all screen sizes

   ```- Professional dark theme with neon accents

- Smooth animations and hover effects

4. **Start application:**

   ```bash## Technology Stack

   npm run dev

   ```- **Frontend**: Vanilla TypeScript + Vite

- **Styling**: Modern CSS Grid/Flexbox

5. **Access at:** http://localhost:5173 (or next available port)- **Audio**: Web Audio API for real-time processing

- **Music Source**: Navidrome REST API

## Streaming Setup- **Development**: Hot reload with Vite dev server



- CORS proxy runs on port 8082## Development

- Streams to: funkturm.radio-endstation.de:8015

- Authentication: test:test (configured in .env)### Prerequisites

- Node.js 20.19+ or 22.12+

## Tech Stack- Modern web browser with Web Audio API support



- **Frontend:** Vite + TypeScript + Web Audio API### Getting Started

- **Music Library:** Navidrome REST API

- **Streaming:** Direct HTTP POST to Liquidsoap Harbor1. **Install dependencies**

- **Audio Processing:** Web Audio API with real-time mixing   ```bash
   npm install
   ```

2. **Start development server**
   ```bash
   npm run dev
   ```

3. **Open in browser**
   ```
   http://localhost:5173/
   ```

### Project Structure

```
webdj/
├── src/
│   ├── main.ts          # Application entry point
│   └── style.css        # DJ interface styling
├── index.html           # HTML layout
├── package.json         # Dependencies and scripts
└── vite.config.ts       # Vite configuration
```

## Usage

### Basic DJ Operations

1. **Load Tracks**: Search for music and drag tracks onto player decks
2. **Mix Audio**: Use the crossfader to blend between left and right players
3. **Queue Management**: Drag tracks to the queue for later playback
4. **Microphone**: Toggle microphone input for live commentary
5. **Broadcasting**: Click broadcast button to start streaming

### Navidrome Configuration

The app connects to a Navidrome server at:
- **Server**: https://musik.radio-endstation.de
- **API**: Subsonic REST API v1.12.0
- **Authentication**: Basic username/password

## Features in Development

- [ ] Real-time audio mixing with Web Audio API
- [ ] Navidrome authentication and track streaming
- [ ] Drag and drop track loading
- [ ] Queue management system
- [ ] Microphone input integration
- [ ] Broadcasting/streaming output
- [ ] Keyboard shortcuts for DJ controls
- [ ] BPM detection and sync
- [ ] Audio effects and filters

## Browser Compatibility

- Chrome 66+ (recommended)
- Firefox 60+
- Safari 11.1+
- Edge 79+

*Web Audio API and Media Streams API required*

## License

This project is for educational and personal use.

---

**Ready to DJ!** 🎧 Start the development server and begin mixing your music.