# DJ Streaming Implementation Summary

## Project Overview
Browser-based DJ Radio Webapp with dual player decks, crossfader, microphone controls, and streaming capabilities to AzuraCast/Liquidsoap servers.

## Technical Stack
- **Frontend**: React TypeScript with Vite
- **Audio Processing**: Web Audio API, MediaRecorder
- **Streaming Protocol**: WebSocket with AzuraCast WebDJ protocol
- **Target Server**: AzuraCast with Liquidsoap Harbor
- **Test Environment**: funkturm.radio-endstation.de:8016

## Implementation Journey

### 1. Initial Challenges
- **Problem**: Direct ICY protocol streaming from browser blocked by CORS
- **Error**: "Invalid password" responses from Liquidsoap Harbor
- **Browser Limitations**: ICY/HTTP streaming not fully supported for uploading

### 2. AzuraCast Analysis
- **Research**: Analyzed AzuraCast WebDJ source code
- **Discovery**: Uses WebSocket protocol for browser-to-Liquidsoap communication
- **Architecture**: Browser → WebSocket → Liquidsoap Harbor → Stream output

### 3. WebSocket Implementation

#### Backend: `azuracast-webdj-proxy.js`
```javascript
// WebSocket server implementing AzuraCast WebDJ protocol
const WebSocket = require('ws');
const net = require('net');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());

const wss = new WebSocket.Server({ 
  port: 3001,
  protocols: ['webcast']
});

wss.on('connection', (ws) => {
  console.log('🎵 WebDJ client connected');
  let liquidSoapSocket = null;
  let isAuthenticated = false;
  
  ws.on('message', async (data) => {
    if (typeof data === 'string') {
      // Handle JSON control messages
      const message = JSON.parse(data);
      
      if (message.type === 'hello') {
        // Authentication with Liquidsoap Harbor
        const { user, password } = message.data;
        
        try {
          liquidSoapSocket = new net.Socket();
          
          await new Promise((resolve, reject) => {
            liquidSoapSocket.connect(8016, 'funkturm.radio-endstation.de', () => {
              console.log('📡 Connected to Liquidsoap Harbor');
              
              // Send ICY authentication
              const authData = `SOURCE ${password} HTTP/1.0\r\n` +
                              `Content-Type: audio/mpeg\r\n` +
                              `Ice-Name: WebDJ Stream\r\n` +
                              `Ice-Description: Live DJ Set\r\n` +
                              `Ice-Genre: Electronic\r\n` +
                              `Ice-Bitrate: 128\r\n\r\n`;
              
              liquidSoapSocket.write(authData);
            });
            
            liquidSoapSocket.on('data', (data) => {
              const response = data.toString();
              console.log('📥 Harbor response:', response);
              
              if (response.includes('HTTP/1.0 200')) {
                isAuthenticated = true;
                ws.send(JSON.stringify({ type: 'auth_success' }));
                resolve();
              } else {
                ws.send(JSON.stringify({ 
                  type: 'auth_error', 
                  message: response.trim() 
                }));
                reject(new Error(response));
              }
            });
          });
        } catch (error) {
          console.error('❌ Harbor connection failed:', error);
        }
      }
    } else {
      // Handle binary audio data
      if (isAuthenticated && liquidSoapSocket) {
        liquidSoapSocket.write(data);
      }
    }
  });
});
```

#### Frontend Integration: `main.ts`
```typescript
async function startBridgeStream(): Promise<boolean> {
  try {
    console.log('Starting AzuraCast WebDJ stream...');
    
    // 1. Initialize Audio Mixing System
    if (!audioContext || !masterGainNode) {
      const mixingReady = await initializeAudioMixing();
      if (!mixingReady) {
        throw new Error('Failed to initialize audio mixing');
      }
    }
    
    // 2. AzuraCast WebDJ WebSocket Connection  
    const bridgeUrl = import.meta.env.VITE_WEBRTC_BRIDGE || 'ws://localhost:3001';
    bridgeSocket = new WebSocket(bridgeUrl, 'webcast');
    
    await new Promise<void>((resolve, reject) => {
      bridgeSocket.onopen = () => {
        console.log('🎵 AzuraCast WebDJ WebSocket connected');
        
        // Send AzuraCast Hello message with authentication
        const helloMessage = {
          type: 'hello',
          data: {
            mime: 'audio/webm;codecs=opus',
            user: streamConfig.username || 'test',
            password: streamConfig.password || 'test:test'
          }
        };
        
        bridgeSocket?.send(JSON.stringify(helloMessage));
      };
      
      bridgeSocket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        
        if (message.type === 'auth_success') {
          console.log('✅ AzuraCast authentication successful');
          resolve();
        } else if (message.type === 'auth_error') {
          console.error('❌ Authentication failed:', message.message);
          reject(new Error(message.message));
        }
      };
    });
    
    // 3. Setup MediaRecorder for audio streaming
    const destination = audioContext.createMediaStreamDestination();
    masterGainNode.connect(destination);
    
    const bridgeRecorder = new MediaRecorder(destination.stream, {
      mimeType: 'audio/webm;codecs=opus',
      audioBitsPerSecond: streamConfig.bitrate * 1000
    });
    
    bridgeRecorder.ondataavailable = (event) => {
      if (event.data.size > 0 && bridgeSocket?.readyState === WebSocket.OPEN) {
        event.data.arrayBuffer().then(buffer => {
          bridgeSocket?.send(buffer);
        });
      }
    };
    
    bridgeRecorder.start(1000); // 1-second chunks
    mediaRecorder = bridgeRecorder;
    isStreaming = true;
    
    return true;
  } catch (error) {
    console.error('Failed to start Bridge stream:', error);
    return false;
  }
}
```

## Configuration

### Stream Configuration
```typescript
let streamConfig: StreamConfig = {
  serverUrl: 'ws://localhost:3001',
  serverType: 'icecast',
  mountPoint: '/teststream',
  password: 'test:test',
  bitrate: 128,
  format: 'mp3',
  sampleRate: 44100,
  username: 'test'
};
```

### Environment Variables
```env
VITE_STREAM_SERVER=funkturm.radio-endstation.de:8016
VITE_STREAM_PASSWORD=test:test
VITE_STREAM_USERNAME=test
VITE_STREAM_MOUNT_POINT=/teststream
VITE_WEBRTC_BRIDGE=ws://localhost:3001
VITE_USE_BRIDGE=true
```

## Audio Pipeline

1. **Browser Audio Sources**:
   - Player Deck A (left)
   - Player Deck B (right)
   - Microphone input

2. **Web Audio API Mixing**:
   - Individual gain nodes for each source
   - Crossfader control (left/right balance)
   - Master gain node for final output

3. **MediaRecorder Capture**:
   - Captures mixed audio stream
   - Encodes to WebM/Opus format
   - Generates 1-second audio chunks

4. **WebSocket Transmission**:
   - Binary audio data sent via WebSocket
   - Control messages (hello, metadata) as JSON

5. **Liquidsoap Harbor Integration**:
   - Receives audio via TCP connection
   - Transcodes to stream format
   - Broadcasts to listeners

## Current Status

### ✅ Completed
- [x] WebSocket server implementation
- [x] AzuraCast protocol integration
- [x] Frontend WebSocket client
- [x] Audio mixing and capture system
- [x] Authentication message handling
- [x] Binary audio data transmission

### ⚠️ Current Issues
- **Authentication**: Liquidsoap Harbor still rejecting password
- **Format Compatibility**: Need to verify audio format compatibility
- **Connection Stability**: Occasional disconnections during testing

### 🔄 Attempted Authentication Formats
1. `username:password` format
2. `:password` format (Shoutcast style)
3. `test:test` direct format
4. Base64 encoded credentials
5. Different ICY header combinations

## Testing Environment

**Target Server**: funkturm.radio-endstation.de
- **Port**: 8016 (Liquidsoap Harbor)
- **Protocol**: ICY/HTTP for source connections
- **Expected Format**: MP3 stream
- **Authentication**: Username/password required

## Next Steps

### Immediate Actions
1. **Community Support**: Seek guidance from AzuraCast Discord community
2. **Authentication Debug**: Work with server admin to verify correct credentials
3. **Protocol Verification**: Ensure ICY headers match server expectations
4. **Audio Format Testing**: Verify WebM→MP3 transcoding in Liquidsoap

### Future Enhancements
1. **Metadata Support**: Send track information to stream
2. **Reconnection Logic**: Handle connection drops gracefully
3. **Audio Quality**: Optimize encoding settings
4. **Error Handling**: Improve user feedback for connection issues

## Code Structure

```
webdj/
├── src/
│   ├── main.ts              # Main application logic
│   ├── navidrome-client.ts  # Music library integration
│   └── types.ts             # TypeScript definitions
├── azuracast-webdj-proxy.js # WebSocket→Liquidsoap bridge
├── package.json             # Dependencies
└── .env                     # Configuration
```

## Key Learnings

1. **Browser Limitations**: Direct ICY streaming not feasible due to CORS
2. **WebSocket Solution**: Modern approach using WebSocket for real-time audio
3. **AzuraCast Architecture**: Well-designed system for browser-based DJ streaming
4. **Authentication Complexity**: Harbor protocol requires specific credential format
5. **Audio Pipeline**: Web Audio API provides powerful mixing capabilities

## Discord Community Question

For troubleshooting the current authentication issues:

> **Subject**: WebDJ Browser Streaming to Liquidsoap Harbor - Authentication Issues
> 
> Hi AzuraCast community! I'm implementing a browser-based DJ application that streams to AzuraCast via WebSocket (similar to the built-in WebDJ). I've successfully established the WebSocket connection and implemented the AzuraCast protocol with hello messages and binary audio transmission.
> 
> **Current Setup**:
> - WebSocket server on port 3001 implementing AzuraCast WebDJ protocol
> - Connects to Liquidsoap Harbor on port 8016
> - Sends ICY headers: `SOURCE test:test HTTP/1.0`
> - Audio format: WebM/Opus from browser MediaRecorder
> 
> **Issue**: Harbor responds with "Invalid password" despite trying multiple authentication formats (test:test, :test, username:password). 
> 
> **Question**: What's the correct authentication format for Harbor source connections? Any insights on WebDJ→Harbor protocol specifics would be greatly appreciated!

---

*Last Updated: September 20, 2025*
*Project: WebDJ Radio Streaming Application*