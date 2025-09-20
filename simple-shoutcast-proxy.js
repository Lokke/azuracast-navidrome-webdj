#!/usr/bin/env node

import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import express from 'express';
import cors from 'cors';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

/**
 * Simple Browser-to-Shoutcast Proxy
 * 
 * This proxy receives browser-encoded audio (WebM/MP4/WAV) via WebSocket
 * and streams it directly to Shoutcast server using ICY protocol.
 * 
 * No external dependencies like Liquidsoap needed!
 * 
 * Architecture:
 * Browser (MediaRecorder) → WebSocket → This Proxy → Shoutcast Server
 */

const app = express();
const PORT = 3001;

// Shoutcast server configuration (Port 8016 instead of 8015)
const SHOUTCAST_CONFIG = {
    host: '51.75.145.84',
    port: 8016,  // Changed from 8015 to 8016
    mount: '/radio.mp3',
    username: 'test',
    password: 'test',
    name: 'WebDJ Live Stream',
    description: 'Live DJ mix from browser',
    genre: 'Electronic',
    bitrate: 128
};

app.use(cors());
app.use(express.json());

// Create HTTP server
const server = http.createServer(app);

// WebSocket server for receiving audio from browser
const wss = new WebSocketServer({ 
    server,
    path: '/stream'
});

console.log('🎵 Browser-to-Shoutcast Proxy starting...');
console.log(`📡 WebSocket endpoint: ws://localhost:${PORT}/stream`);
console.log(`🎯 Shoutcast target: ${SHOUTCAST_CONFIG.host}:${SHOUTCAST_CONFIG.port}${SHOUTCAST_CONFIG.mount}`);

// Store active connections and Shoutcast connection
const activeConnections = new Map();
let shoutcastConnection = null;
let reconnectTimer = null;

/**
 * Connect to Shoutcast server using ICY protocol
 */
async function connectToShoutcast() {
    if (shoutcastConnection) {
        shoutcastConnection.destroy();
    }

    console.log('🔄 Connecting to Shoutcast server...');
    
    const { Socket } = await import('net');
    shoutcastConnection = new Socket();
    
    shoutcastConnection.connect(SHOUTCAST_CONFIG.port, SHOUTCAST_CONFIG.host, () => {
        console.log('✅ Connected to Shoutcast server');
        
        // Send ICY source request
        // For Shoutcast, sometimes only password without username works
        const authString = SHOUTCAST_CONFIG.password; // Try password only first
        const auth = Buffer.from(authString).toString('base64');
        
        console.log(`🔑 Trying auth method: password-only ("${authString}")`);
        
        const icyRequest = [
            `SOURCE ${SHOUTCAST_CONFIG.mount} ICY/1.0`,
            `Authorization: Basic ${auth}`,
            `User-Agent: WebDJ-Proxy/1.0`,
            `Content-Type: audio/mpeg`,
            `ice-name: ${SHOUTCAST_CONFIG.name}`,
            `ice-description: ${SHOUTCAST_CONFIG.description}`,
            `ice-genre: ${SHOUTCAST_CONFIG.genre}`,
            `ice-bitrate: ${SHOUTCAST_CONFIG.bitrate}`,
            `ice-public: 1`,
            `ice-audio-info: ice-samplerate=44100;ice-bitrate=${SHOUTCAST_CONFIG.bitrate};ice-channels=2`,
            '', // Empty line to end headers
            ''
        ].join('\r\n');
        
        shoutcastConnection.write(icyRequest);
    });

    shoutcastConnection.on('data', (data) => {
        const response = data.toString();
        console.log('📥 Shoutcast response:', response.trim());
        
        if (response.includes('200 OK')) {
            console.log('🎉 Shoutcast streaming started successfully!');
        } else if (response.includes('Invalid password')) {
            console.log('🔄 Trying alternative auth method...');
            // Try with username:password format
            tryAlternativeAuth();
        } else if (response.includes('401') || response.includes('403')) {
            console.error('❌ Shoutcast authentication failed');
        }
    });

    shoutcastConnection.on('error', (error) => {
        console.error('❌ Shoutcast connection error:', error.message);
        scheduleReconnect();
    });

    shoutcastConnection.on('close', () => {
        console.log('🔌 Shoutcast connection closed');
        scheduleReconnect();
    });
}

/**
 * Try alternative authentication method
 */
function tryAlternativeAuth() {
    if (!shoutcastConnection || !shoutcastConnection.writable) return;
    
    // Try username:password format
    const authString = `${SHOUTCAST_CONFIG.username}:${SHOUTCAST_CONFIG.password}`;
    const auth = Buffer.from(authString).toString('base64');
    
    console.log(`🔑 Trying auth method: username:password ("${authString}")`);
    
    const icyRequest = [
        `SOURCE ${SHOUTCAST_CONFIG.mount} ICY/1.0`,
        `Authorization: Basic ${auth}`,
        `User-Agent: WebDJ-Proxy/1.0`,
        `Content-Type: audio/mpeg`,
        `ice-name: ${SHOUTCAST_CONFIG.name}`,
        `ice-description: ${SHOUTCAST_CONFIG.description}`,
        `ice-genre: ${SHOUTCAST_CONFIG.genre}`,
        `ice-bitrate: ${SHOUTCAST_CONFIG.bitrate}`,
        `ice-public: 1`,
        `ice-audio-info: ice-samplerate=44100;ice-bitrate=${SHOUTCAST_CONFIG.bitrate};ice-channels=2`,
        '', // Empty line to end headers
        ''
    ].join('\r\n');
    
    shoutcastConnection.write(icyRequest);
}

/**
 * Schedule Shoutcast reconnection
 */
function scheduleReconnect() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
    }
    
    reconnectTimer = setTimeout(() => {
        console.log('🔄 Attempting to reconnect to Shoutcast...');
        connectToShoutcast();
    }, 5000); // Retry after 5 seconds
}

/**
 * Send audio data to Shoutcast server
 */
function sendAudioToShoutcast(audioData) {
    if (shoutcastConnection && shoutcastConnection.writable) {
        try {
            shoutcastConnection.write(audioData);
            // console.log(`📤 Sent ${audioData.length} bytes to Shoutcast`);
        } catch (error) {
            console.error('❌ Failed to send audio to Shoutcast:', error.message);
            scheduleReconnect();
        }
    } else {
        console.warn('⚠️ Shoutcast connection not ready, audio data dropped');
    }
}

/**
 * WebSocket connection handler
 */
wss.on('connection', (ws, request) => {
    const connectionId = Date.now() + Math.random();
    console.log(`🔗 New browser connection: ${connectionId}`);
    
    activeConnections.set(connectionId, ws);
    
    // Send connection confirmation
    ws.send(JSON.stringify({
        type: 'bridge-connected',
        connectionId: connectionId,
        shoutcastReady: shoutcastConnection?.writable || false
    }));

    ws.on('message', async (message) => {
        console.log(`📥 Raw message received (type: ${typeof message}, length: ${message.length})`);
        
        try {
            // Handle text messages (commands)
            if (typeof message === 'string' || message instanceof String) {
                const messageStr = message.toString();
                console.log(`📄 Text message: ${messageStr}`);
                const command = JSON.parse(messageStr);
                console.log(`📨 Command received:`, command.type);
                
                if (command.type === 'start-stream') {
                    console.log('🎬 Starting Shoutcast stream...');
                    await connectToShoutcast();
                    
                    ws.send(JSON.stringify({
                        type: 'stream-bridge-ready',
                        success: shoutcastConnection?.writable || false
                    }));
                    
                } else if (command.type === 'stop-stream') {
                    console.log('⏹️ Stopping Shoutcast stream...');
                    if (shoutcastConnection) {
                        shoutcastConnection.destroy();
                        shoutcastConnection = null;
                    }
                    
                    ws.send(JSON.stringify({
                        type: 'stream-stopped',
                        success: true
                    }));
                }
                
            } else {
                // Handle binary audio data
                const audioBuffer = Buffer.from(message);
                console.log(`🎵 Audio data received: ${audioBuffer.length} bytes`);
                
                // Auto-connect to Shoutcast if not already connected and audio data arrives
                if (!shoutcastConnection || !shoutcastConnection.writable) {
                    console.log('🚀 Auto-starting Shoutcast connection due to incoming audio...');
                    await connectToShoutcast();
                }
                
                if (audioBuffer.length > 0) {
                    // Send raw audio data to Shoutcast
                    sendAudioToShoutcast(audioBuffer);
                    
                    // Send status update occasionally
                    if (Math.random() < 0.1) { // 10% chance
                        ws.send(JSON.stringify({
                            type: 'stream-status',
                            status: 'streaming',
                            bytesTransferred: audioBuffer.length
                        }));
                    }
                }
            }
            
        } catch (error) {
            console.error('❌ Error processing message:', error.message);
            
            ws.send(JSON.stringify({
                type: 'stream-error',
                error: 'processing-error',
                message: error.message
            }));
        }
    });

    ws.on('close', () => {
        console.log(`🔌 Browser connection closed: ${connectionId}`);
        activeConnections.delete(connectionId);
        
        // If no more connections, disconnect from Shoutcast
        if (activeConnections.size === 0 && shoutcastConnection) {
            console.log('📡 No more browser connections, keeping Shoutcast connection alive');
            // We could disconnect here, but keeping alive for quick reconnection
        }
    });

    ws.on('error', (error) => {
        console.error(`❌ WebSocket error for ${connectionId}:`, error.message);
        activeConnections.delete(connectionId);
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'running',
        connections: activeConnections.size,
        shoutcastConnected: shoutcastConnection?.writable || false,
        target: `${SHOUTCAST_CONFIG.host}:${SHOUTCAST_CONFIG.port}${SHOUTCAST_CONFIG.mount}`
    });
});

// Start the server
server.listen(PORT, () => {
    console.log(`🚀 Proxy server running on port ${PORT}`);
    console.log(`🔍 Health check: http://localhost:${PORT}/health`);
    console.log(`🎵 Ready to bridge browser audio to Shoutcast!`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down proxy server...');
    
    // Close all WebSocket connections
    activeConnections.forEach((ws, id) => {
        ws.close();
    });
    
    // Close Shoutcast connection
    if (shoutcastConnection) {
        shoutcastConnection.destroy();
    }
    
    // Close server
    server.close(() => {
        console.log('✅ Proxy server shut down gracefully');
        process.exit(0);
    });
});