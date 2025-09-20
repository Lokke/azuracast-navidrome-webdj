// WebRTC-to-Shoutcast Bridge Server (Vereinfacht)
// Empfängt Audio-Daten über WebSocket und streamt sie an Shoutcast/Icecast-Server weiter

import { WebSocketServer } from 'ws';
import express from 'express';
import { createServer } from 'http';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

// .env laden
dotenv.config();

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// CORS für HTTP-Endpoints aktivieren
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// Shoutcast-Verbindungsdetails aus .env
const SHOUTCAST_CONFIG = {
  serverUrl: process.env.VITE_STREAM_SERVER || 'http://51.75.145.84:8015',
  serverType: process.env.VITE_STREAM_SERVER_TYPE || 'shoutcast',
  mountPoint: process.env.VITE_STREAM_MOUNT_POINT || '',
  username: process.env.VITE_STREAM_USERNAME || 'test',
  password: process.env.VITE_STREAM_PASSWORD || 'test',
  bitrate: parseInt(process.env.VITE_STREAM_BITRATE) || 128
};

// Connected clients und Shoutcast-Verbindungen verwalten
const streamingClients = new Map();
let activeShoutcastStream = null;

console.log('🎵 WebRTC-to-Shoutcast Bridge Server wird gestartet...');
console.log(`🎯 Ziel-Server: ${SHOUTCAST_CONFIG.serverUrl}`);
console.log(`🔑 Auth: ${SHOUTCAST_CONFIG.username}:${SHOUTCAST_CONFIG.password}`);

// WebSocket-Verbindungen verwalten
wss.on('connection', (ws, req) => {
  const clientId = generateClientId();
  streamingClients.set(clientId, {
    ws: ws,
    type: null,
    isStreaming: false
  });
  
  console.log(`📡 Client ${clientId} connected from ${req.socket.remoteAddress}`);

  ws.on('message', async (data) => {
    try {
      // Prüfen ob es Binärdaten (Audio) oder JSON sind
      if (data instanceof Buffer && data.length > 100) {
        // Audio-Daten empfangen
        await handleAudioData(clientId, data);
      } else {
        // JSON-Nachricht
        const message = JSON.parse(data.toString());
        await handleControlMessage(clientId, message, ws);
      }
    } catch (error) {
      console.error('Failed to process message:', error);
    }
  });

  ws.on('close', () => {
    console.log(`📴 Client ${clientId} disconnected`);
    streamingClients.delete(clientId);
    
    // Shoutcast-Stream stoppen wenn kein Client mehr da
    if (streamingClients.size === 0) {
      stopShoutcastStream();
    }
  });

  ws.on('error', (error) => {
    console.error(`❌ WebSocket error for client ${clientId}:`, error);
  });

  // Willkommensnachricht
  ws.send(JSON.stringify({
    type: 'bridge-connected',
    clientId: clientId,
    shoutcastTarget: SHOUTCAST_CONFIG.serverUrl,
    ready: true
  }));
});

// Control-Nachrichten verarbeiten
async function handleControlMessage(clientId, message, ws) {
  const client = streamingClients.get(clientId);
  if (!client) return;

  console.log(`📥 Control Message from ${clientId}: ${message.type}`);

  switch (message.type) {
    case 'start-stream':
      console.log(`🔴 Starting stream bridge for ${clientId}`);
      client.isStreaming = true;
      
      // Shoutcast-Verbindung initialisieren
      const started = await initializeShoutcastStream();
      
      ws.send(JSON.stringify({
        type: 'stream-bridge-ready',
        success: started,
        shoutcastConnected: !!activeShoutcastStream
      }));
      break;

    case 'stop-stream':
      console.log(`⏹️ Stopping stream bridge for ${clientId}`);
      client.isStreaming = false;
      
      // Shoutcast-Stream stoppen wenn kein aktiver Client
      const hasActiveStreams = Array.from(streamingClients.values()).some(c => c.isStreaming);
      if (!hasActiveStreams) {
        stopShoutcastStream();
      }
      
      ws.send(JSON.stringify({
        type: 'stream-bridge-stopped'
      }));
      break;

    case 'ping':
      ws.send(JSON.stringify({
        type: 'pong',
        timestamp: new Date().toISOString(),
        shoutcastActive: !!activeShoutcastStream
      }));
      break;

    default:
      console.log(`❓ Unknown control message: ${message.type}`);
  }
}

// Audio-Daten verarbeiten
async function handleAudioData(clientId, audioBuffer) {
  const client = streamingClients.get(clientId);
  if (!client || !client.isStreaming) return;

  console.log(`🎵 Audio data received from ${clientId}: ${audioBuffer.length} bytes`);

  // Audio-Daten an Shoutcast weiterleiten
  if (activeShoutcastStream) {
    try {
      await forwardAudioToShoutcast(audioBuffer);
    } catch (error) {
      console.error('Failed to forward audio to Shoutcast:', error);
    }
  }
}

// Shoutcast-Stream initialisieren
async function initializeShoutcastStream() {
  if (activeShoutcastStream) {
    console.log('Shoutcast stream already active');
    return true;
  }

  // Verschiedene Shoutcast v2.6 Mountpoints zum Ausprobieren
  const possibleMountpoints = [
    SHOUTCAST_CONFIG.mountPoint || '/stream',  // Standard aus .env
    '/live',
    '/source', 
    '/audio',
    '/',
    '/stream.mp3'
  ];

  for (const mountpoint of possibleMountpoints) {
    console.log(`🎯 Trying Shoutcast v2.6 connection with mountpoint: ${mountpoint}`);
    
    try {
      // Shoutcast v2.6 Stream-URL mit aktuellem Mountpoint
      const streamUrl = SHOUTCAST_CONFIG.serverUrl + mountpoint;

      // Auth-Header für Shoutcast v2.6
      const authHeader = `Basic ${Buffer.from(`${SHOUTCAST_CONFIG.username}:${SHOUTCAST_CONFIG.password}`).toString('base64')}`;

      // Headers für Shoutcast v2.6
      const headers = {
        'Authorization': authHeader,
        'Content-Type': 'audio/mpeg',
        'User-Agent': 'WebRTC-Bridge/1.0 (Shoutcast v2.6 Compatible)',
        'Connection': 'keep-alive',
        'Transfer-Encoding': 'chunked'
      };

      // Icecast-spezifische Headers
      if (SHOUTCAST_CONFIG.serverType === 'icecast') {
        headers['Ice-Name'] = 'DJ Radio Live Stream (WebRTC Bridge)';
        headers['Ice-Genre'] = 'Electronic';
        headers['Ice-Bitrate'] = SHOUTCAST_CONFIG.bitrate.toString();
        headers['Ice-Public'] = '1';
        headers['Ice-Description'] = 'Live DJ Set via WebRTC Bridge';
      } else {
        // Shoutcast v2.6 Headers
        headers['icy-name'] = 'DJ Radio Live Stream (WebRTC Bridge)';
        headers['icy-genre'] = 'Electronic';
        headers['icy-br'] = SHOUTCAST_CONFIG.bitrate.toString();
        headers['icy-pub'] = '1';
        headers['icy-description'] = 'Live DJ Set via WebRTC Bridge';
        headers['icy-url'] = 'http://localhost:5173';
      }

      // Test-Verbindung zu Shoutcast v2.6
      const testResponse = await fetch(streamUrl, {
        method: 'PUT',
        headers: headers,
        body: Buffer.alloc(0), // Leerer Body für Test
        timeout: 5000
      });

      if (testResponse.ok || testResponse.status === 200) {
        console.log(`✅ Shoutcast v2.6 connection successful with mountpoint: ${mountpoint}`);
        
        activeShoutcastStream = {
          url: streamUrl,
          headers: headers,
          buffer: [],
          lastSent: Date.now(),
          mountpoint: mountpoint
        };

        // Erfolg an Clients melden
        broadcastToClients({
          type: 'stream-connection',
          status: 'connected',
          mountpoint: mountpoint,
          url: streamUrl
        });

        return true;
        
      } else {
        console.log(`❌ Mountpoint ${mountpoint} failed: ${testResponse.status} ${testResponse.statusText}`);
        continue; // Nächsten Mountpoint versuchen
      }

    } catch (error) {
      console.log(`❌ Mountpoint ${mountpoint} connection failed:`, error.message);
      continue; // Nächsten Mountpoint versuchen
    }
  }

  // Alle Mountpoints fehlgeschlagen
  console.error(`❌ All Shoutcast v2.6 mountpoints failed!`);
  broadcastToClients({
    type: 'stream-error',
    error: 'all-mountpoints-failed',
    message: 'Could not connect to any Shoutcast v2.6 mountpoint',
    triedMountpoints: possibleMountpoints
  });
  
  return false;
      headers['Icy-Name'] = 'DJ Radio Live Stream (WebRTC Bridge)';
      headers['Icy-Genre'] = 'Electronic';
      headers['Icy-Br'] = SHOUTCAST_CONFIG.bitrate.toString();
      headers['Icy-Pub'] = '1';
      headers['Icy-Pub'] = '1';
    }

}

// Audio-Daten an Shoutcast weiterleiten
async function forwardAudioToShoutcast(audioBuffer) {
  if (!activeShoutcastStream) return;

  try {
    // Buffer zu Shoutcast-Stream hinzufügen
    activeShoutcastStream.buffer.push(audioBuffer);

    // Alle 2 Sekunden oder bei Buffer-Größe > 64KB senden
    const bufferSize = activeShoutcastStream.buffer.reduce((size, buf) => size + buf.length, 0);
    const timeSinceLastSend = Date.now() - activeShoutcastStream.lastSent;

    if (bufferSize > 65536 || timeSinceLastSend > 2000) {
      await flushAudioToShoutcast();
    }

  } catch (error) {
    console.error('Failed to buffer audio for Shoutcast:', error);
    // Fehler an alle Clients weiterleiten
    broadcastToClients({
      type: 'stream-error',
      error: 'buffer-failed',
      message: error.message
    });
  }
}

// Gepufferte Audio-Daten an Shoutcast senden
async function flushAudioToShoutcast() {
  if (!activeShoutcastStream || activeShoutcastStream.buffer.length === 0) return;

  try {
    // Buffer zusammenfügen
    const totalSize = activeShoutcastStream.buffer.reduce((size, buf) => size + buf.length, 0);
    const combinedBuffer = Buffer.concat(activeShoutcastStream.buffer, totalSize);
    
    console.log(`📡 Sending ${totalSize} bytes to Shoutcast...`);

    // HTTP-Request an Shoutcast v2.6 Server mit PUT-Methode
    const response = await fetch(activeShoutcastStream.url, {
      method: 'PUT',  // Shoutcast v2.6 verwendet PUT für Source-Verbindungen
      headers: {
        ...activeShoutcastStream.headers,
        'Content-Length': totalSize.toString()
      },
      body: combinedBuffer,
      timeout: 10000  // Längeres Timeout für Shoutcast v2.6
    });

    if (response.ok) {
      console.log(`✅ Audio data sent to Shoutcast successfully`);
      activeShoutcastStream.buffer = [];
      activeShoutcastStream.lastSent = Date.now();
      
      // Erfolg an Clients melden
      broadcastToClients({
        type: 'stream-status',
        status: 'streaming',
        message: 'Audio successfully sent to Shoutcast'
      });
      
    } else {
      console.error(`❌ Shoutcast server responded with: ${response.status} ${response.statusText}`);
      
      // Fehler an Clients melden
      broadcastToClients({
        type: 'stream-error',
        error: 'shoutcast-response-error',
        status: response.status,
        statusText: response.statusText,
        message: `Shoutcast server error: ${response.status} ${response.statusText}`
      });
      
      // Bei Fehler trotzdem Buffer leeren um Memory-Leak zu vermeiden
      activeShoutcastStream.buffer = [];
    }

  } catch (error) {
    console.error('Failed to send audio to Shoutcast:', error);
    
    // Fehler an Clients melden
    broadcastToClients({
      type: 'stream-error',
      error: 'shoutcast-connection-error',
      message: error.message,
      details: error.code || 'Unknown error'
    });
    // Buffer leeren bei Fehler
    activeShoutcastStream.buffer = [];
  }
}

// Shoutcast-Stream stoppen
function stopShoutcastStream() {
  if (activeShoutcastStream) {
    console.log(`⏹️ Stopping Shoutcast stream`);
    
    // Letzten Buffer senden
    if (activeShoutcastStream.buffer.length > 0) {
      flushAudioToShoutcast().catch(console.error);
    }
    
    activeShoutcastStream = null;
  }
}

// Client-ID generieren
function generateClientId() {
  return Math.random().toString(36).substring(2, 15) + 
         Math.random().toString(36).substring(2, 15);
}

// Broadcast-Nachricht an alle verbundenen Clients senden
function broadcastToClients(message) {
  const messageStr = JSON.stringify(message);
  
  streamingClients.forEach((client, clientId) => {
    try {
      if (client.ws && client.ws.readyState === 1) { // WebSocket.OPEN
        client.ws.send(messageStr);
      }
    } catch (error) {
      console.error(`Failed to send message to client ${clientId}:`, error);
    }
  });
}

// HTTP-Endpoints
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    connectedClients: streamingClients.size,
    activeShoutcastStream: !!activeShoutcastStream,
    shoutcastTarget: SHOUTCAST_CONFIG.serverUrl,
    bufferSize: activeShoutcastStream ? activeShoutcastStream.buffer.length : 0
  });
});

app.get('/stats', (req, res) => {
  const clients = {};
  streamingClients.forEach((client, id) => {
    clients[id] = {
      isStreaming: client.isStreaming
    };
  });

  res.json({
    totalClients: streamingClients.size,
    activeStreams: Array.from(streamingClients.values()).filter(c => c.isStreaming).length,
    clients: clients,
    shoutcastConfig: {
      server: SHOUTCAST_CONFIG.serverUrl,
      type: SHOUTCAST_CONFIG.serverType,
      bitrate: SHOUTCAST_CONFIG.bitrate
    },
    shoutcastStatus: {
      active: !!activeShoutcastStream,
      bufferSize: activeShoutcastStream ? activeShoutcastStream.buffer.length : 0,
      lastSent: activeShoutcastStream ? activeShoutcastStream.lastSent : null
    }
  });
});

// Server starten
const PORT = process.env.WEBRTC_BRIDGE_PORT || 3003;

server.listen(PORT, () => {
  console.log(`\n🌉 WebRTC-to-Shoutcast Bridge Server gestartet!`);
  console.log(`📡 WebSocket: ws://localhost:${PORT}`);
  console.log(`🌐 HTTP API: http://localhost:${PORT}`);
  console.log(`⚙️  Health-Check: http://localhost:${PORT}/health`);
  console.log(`📊 Stats: http://localhost:${PORT}/stats`);
  console.log(`🎯 Shoutcast Target: ${SHOUTCAST_CONFIG.serverUrl}`);
  console.log(`\n🎵 Bereit für WebRTC→Shoutcast Streaming!`);
});