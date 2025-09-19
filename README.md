# DJ Radio Webapp

A professional DJ/Radio interface with dual player decks, crossfader controls, and Navidrome music library integration.

## Features

🎵 **Dual Player Decks**
- Independent left and right player controls
- Play, pause, stop functionality
- Volume controls for each deck
- Progress bars with real-time updates

🎛️ **Professional DJ Controls**
- Crossfader for seamless mixing between decks
- Microphone on/off switch
- Broadcast button for live streaming

📚 **Music Library Integration**
- Connected to Navidrome server
- Search functionality for tracks, artists, albums
- Drag and drop tracks to players or queue
- Queue management for upcoming tracks

🎨 **Modern Interface**
- Responsive design for all screen sizes
- Professional dark theme with neon accents
- Smooth animations and hover effects

## Technology Stack

- **Frontend**: Vanilla TypeScript + Vite
- **Styling**: Modern CSS Grid/Flexbox
- **Audio**: Web Audio API for real-time processing
- **Music Source**: Navidrome REST API
- **Development**: Hot reload with Vite dev server

## Development

### Prerequisites
- Node.js 20.19+ or 22.12+
- Modern web browser with Web Audio API support

### Getting Started

1. **Install dependencies**
   ```bash
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