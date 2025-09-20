// WebRTC Signaling Server für Live-Streaming
// Ersetzt Shoutcast/Icecast mit modernem WebRTC-Streaming

import { WebSocketServer } from 'ws';
import express from 'express';
import { createServer } from 'http';
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

// Connected clients verwalten
const clients = new Map();
const streamers = new Map();
const listeners = new Map();

// WebSocket-Verbindungen verwalten
wss.on('connection', (ws, req) => {
  const clientId = generateClientId();
  clients.set(clientId, ws);
  
  console.log(`📡 Client ${clientId} connected from ${req.socket.remoteAddress}`);

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      await handleMessage(clientId, message, ws);
    } catch (error) {
      console.error('Failed to parse message:', error);
      ws.send(JSON.stringify({
        type: 'error',
        error: 'Invalid message format'
      }));
    }
  });

  ws.on('close', () => {
    console.log(`📴 Client ${clientId} disconnected`);
    clients.delete(clientId);
    streamers.delete(clientId);
    listeners.delete(clientId);
  });

  ws.on('error', (error) => {
    console.error(`❌ WebSocket error for client ${clientId}:`, error);
  });

  // Willkommensnachricht
  ws.send(JSON.stringify({
    type: 'connected',
    clientId: clientId,
    timestamp: new Date().toISOString()
  }));
});

// Nachrichten verarbeiten
async function handleMessage(clientId, message, ws) {
  console.log(`📥 Message from ${clientId}:`, message.type);

  switch (message.type) {
    case 'register-streamer':
      streamers.set(clientId, {
        ws: ws,
        streamId: message.streamId || 'default',
        metadata: message.metadata || {},
        startTime: new Date()
      });
      console.log(`🎵 Streamer ${clientId} registered for stream: ${message.streamId}`);
      
      ws.send(JSON.stringify({
        type: 'streamer-registered',
        streamId: message.streamId,
        ready: true
      }));
      break;

    case 'register-listener':
      listeners.set(clientId, {
        ws: ws,
        streamId: message.streamId || 'default',
        startTime: new Date()
      });
      console.log(`🎧 Listener ${clientId} registered for stream: ${message.streamId}`);
      
      ws.send(JSON.stringify({
        type: 'listener-registered',
        streamId: message.streamId
      }));
      break;

    case 'offer':
      // Offer von Streamer an alle Listener weiterleiten
      const streamer = streamers.get(clientId);
      if (streamer) {
        console.log(`📤 Forwarding offer from streamer ${clientId}`);
        broadcastToListeners(streamer.streamId, {
          type: 'offer',
          offer: message.offer,
          streamerId: clientId
        });
        
        ws.send(JSON.stringify({
          type: 'offer-sent',
          listeners: countListeners(streamer.streamId)
        }));
      }
      break;

    case 'answer':
      // Answer von Listener an entsprechenden Streamer weiterleiten
      if (message.streamerId && streamers.has(message.streamerId)) {
        const streamerWs = streamers.get(message.streamerId).ws;
        streamerWs.send(JSON.stringify({
          type: 'answer',
          answer: message.answer,
          listenerId: clientId
        }));
        console.log(`📤 Forwarding answer from listener ${clientId} to streamer ${message.streamerId}`);
      }
      break;

    case 'ice-candidate':
      // ICE-Kandidaten weiterleiten
      if (message.targetId) {
        const targetClient = clients.get(message.targetId);
        if (targetClient) {
          targetClient.send(JSON.stringify({
            type: 'ice-candidate',
            candidate: message.candidate,
            senderId: clientId
          }));
        }
      } else {
        // An alle relevanten Clients senden
        forwardIceCandidate(clientId, message);
      }
      break;

    case 'stream-started':
      console.log(`🔴 Stream started by ${clientId}`);
      notifyStreamStatus(clientId, 'started');
      break;

    case 'stream-stopped':
      console.log(`⏹️ Stream stopped by ${clientId}`);
      notifyStreamStatus(clientId, 'stopped');
      break;

    case 'ping':
      ws.send(JSON.stringify({
        type: 'pong',
        timestamp: new Date().toISOString()
      }));
      break;

    default:
      console.log(`❓ Unknown message type: ${message.type}`);
      ws.send(JSON.stringify({
        type: 'error',
        error: `Unknown message type: ${message.type}`
      }));
  }
}

// ICE-Kandidaten weiterleiten
function forwardIceCandidate(senderId, message) {
  const isStreamer = streamers.has(senderId);
  const isListener = listeners.has(senderId);

  if (isStreamer) {
    // Von Streamer an alle Listener
    const streamer = streamers.get(senderId);
    broadcastToListeners(streamer.streamId, {
      type: 'ice-candidate',
      candidate: message.candidate,
      senderId: senderId
    });
  } else if (isListener) {
    // Von Listener an Streamer
    const listener = listeners.get(senderId);
    streamers.forEach((streamer, streamerId) => {
      if (streamer.streamId === listener.streamId) {
        streamer.ws.send(JSON.stringify({
          type: 'ice-candidate',
          candidate: message.candidate,
          senderId: senderId
        }));
      }
    });
  }
}

// An alle Listener eines Streams senden
function broadcastToListeners(streamId, message) {
  let count = 0;
  listeners.forEach((listener) => {
    if (listener.streamId === streamId) {
      listener.ws.send(JSON.stringify(message));
      count++;
    }
  });
  console.log(`📡 Broadcast to ${count} listeners for stream: ${streamId}`);
}

// Stream-Status-Änderungen benachrichtigen
function notifyStreamStatus(streamerId, status) {
  const streamer = streamers.get(streamerId);
  if (streamer) {
    broadcastToListeners(streamer.streamId, {
      type: 'stream-status',
      status: status,
      streamerId: streamerId,
      timestamp: new Date().toISOString()
    });
  }
}

// Anzahl Listener für Stream zählen
function countListeners(streamId) {
  let count = 0;
  listeners.forEach((listener) => {
    if (listener.streamId === streamId) count++;
  });
  return count;
}

// Client-ID generieren
function generateClientId() {
  return Math.random().toString(36).substring(2, 15) + 
         Math.random().toString(36).substring(2, 15);
}

// HTTP-Endpoints für Monitoring
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    clients: clients.size,
    streamers: streamers.size,
    listeners: listeners.size,
    streams: getActiveStreams()
  });
});

app.get('/stats', (req, res) => {
  const activeStreams = {};
  streamers.forEach((streamer, id) => {
    activeStreams[streamer.streamId] = {
      streamerId: id,
      listeners: countListeners(streamer.streamId),
      startTime: streamer.startTime,
      metadata: streamer.metadata
    };
  });

  res.json({
    totalClients: clients.size,
    activeStreamers: streamers.size,
    totalListeners: listeners.size,
    activeStreams: activeStreams
  });
});

function getActiveStreams() {
  const streams = {};
  streamers.forEach((streamer) => {
    streams[streamer.streamId] = {
      listeners: countListeners(streamer.streamId),
      startTime: streamer.startTime
    };
  });
  return streams;
}

// Server starten
const PORT = process.env.WEBRTC_SIGNALING_PORT || 3002;

server.listen(PORT, () => {
  console.log(`\n🎵 WebRTC Signaling Server gestartet!`);
  console.log(`📡 WebSocket: ws://localhost:${PORT}`);
  console.log(`🌐 HTTP API: http://localhost:${PORT}`);
  console.log(`⚙️  Health-Check: http://localhost:${PORT}/health`);
  console.log(`📊 Stats: http://localhost:${PORT}/stats\n`);
  console.log(`🎧 Bereit für Live-Streaming über WebRTC!`);
});