# WebRTC-to-Shoutcast Bridge Setup

## Quick Start

### 1. Install Liquidsoap
```powershell
# Install via Chocolatey (recommended)
choco install liquidsoap

# Or download from: https://www.liquidsoap.info/download.html
```

### 2. Install Node.js Dependencies
```powershell
npm install ws express cors
```

### 3. Start the Liquidsoap Bridge
```powershell
# Terminal 1: Start Liquidsoap
liquidsoap liquidsoap-bridge.liq

# Terminal 2: Start Node.js Bridge
node webrtc-liquidsoap-bridge.js

# Terminal 3: Start WebRTC signaling server (if needed)
node webrtc-signaling-server.js
```

### 4. Client Configuration
Update your WebRTC client to connect to:
```javascript
const ws = new WebSocket('ws://localhost:3003/stream');
```

## Architecture

```
WebRTC Client 
    ↓ (audio stream)
Node.js Bridge (port 3003)
    ↓ (HTTP PUT to Harbor)
Liquidsoap Harbor (port 8001)
    ↓ (Shoutcast protocol)
Shoutcast Server (51.75.145.84:8015/radio.mp3)
```

## Configuration

- **Shoutcast Server**: 51.75.145.84:8015
- **Mount Point**: /radio.mp3
- **Credentials**: test:test
- **Bridge Port**: 3003
- **Harbor Port**: 8001

## Health Checks

- Bridge status: http://localhost:3003/health
- Bridge details: http://localhost:3003/status

## Troubleshooting

1. **Liquidsoap not starting**: Check if port 8001 is available
2. **Bridge connection fails**: Verify Liquidsoap is running first
3. **Shoutcast authentication**: Password must be exactly "test:test"
4. **Audio not streaming**: Check browser console for WebSocket errors

## Benefits of Liquidsoap Approach

- ✅ Professional streaming software
- ✅ Proper Shoutcast protocol handling
- ✅ Built-in audio processing and normalization
- ✅ Automatic reconnection and fallback
- ✅ Robust error handling
- ✅ Industry standard solution