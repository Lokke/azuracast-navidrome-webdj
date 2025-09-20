import WebSocket, { WebSocketServer } from 'ws';
import express from 'express';
import cors from 'cors';
import net from 'net';
import { createServer } from 'http';

const app = express();
app.use(cors());

// Configuration
const WEBSOCKET_PORT = 3001;
const TARGET_HOST = 'funkturm.radio-endstation.de';
const TARGET_PORT = 8015; // Try port 8015 first
const MOUNT_POINT = ''; // Try without specific mountpoint

// Create WebSocket server
const wss = new WebSocketServer({ 
    port: WEBSOCKET_PORT,
    verifyClient: (info) => {
        console.log('🔌 WebSocket connection attempt from:', info.origin);
        return true;
    }
});

console.log(`🎵 AzuraCast WebDJ Proxy listening on ws://localhost:${WEBSOCKET_PORT}`);
console.log(`🎯 Target: ${TARGET_HOST}:${TARGET_PORT}${MOUNT_POINT}`);

wss.on('connection', (ws, req) => {
    console.log('🟢 WebSocket client connected');
    
    let isAuthenticated = false;
    let liquidsoaptSocket = null;
    let username = null;
    let password = null;

    // Handle WebSocket messages
    ws.on('message', async (data) => {
        try {
            // Try to parse as JSON (hello/metadata messages)
            if (data[0] === 0x7b) { // Check if starts with '{'
                const message = JSON.parse(data.toString());
                console.log('📩 Received JSON message:', message);

                if (message.type === 'hello') {
                    await handleHelloMessage(message.data);
                } else if (message.type === 'metadata') {
                    await handleMetadata(message.data);
                }
            } else {
                // Raw audio data
                if (isAuthenticated && liquidsoaptSocket) {
                    // Forward raw audio data to Liquidsoap
                    liquidsoaptSocket.write(data);
                    console.log(`🔊 Forwarded ${data.length} bytes audio data`);
                } else {
                    console.log('⚠️ Dropping audio data - not authenticated');
                }
            }
        } catch (error) {
            console.error('❌ Error processing message:', error);
        }
    });

    // Handle hello message (authentication)
    async function handleHelloMessage(data) {
        console.log('👋 Processing hello message:', data);
        
        username = data.user || 'source';
        password = data.password || 'test';
        const mimeType = data.mime || 'audio/webm;codecs=opus';

        console.log(`🔑 Attempting authentication with ${username}:${password}`);
        console.log(`🎵 MIME type: ${mimeType}`);

        try {
            // Connect to Liquidsoap Harbor
            liquidsoaptSocket = new net.Socket();
            
            liquidsoaptSocket.connect(TARGET_PORT, TARGET_HOST, () => {
                console.log(`🔗 Connected to ${TARGET_HOST}:${TARGET_PORT}`);
                
                // Send Liquidsoap Harbor request with proper authentication
                // Harbor expects SOURCE / ICY/1.0 format
                const credentials = password.includes(':') ? password : `${username}:${password}`;
                const harborRequest = [
                    `SOURCE / ICY/1.0`,
                    `Authorization: source ${credentials}`,
                    `Content-Type: audio/mpeg`,
                    `User-Agent: WebDJ/1.0`,
                    `Ice-Name: WebDJ Live Stream`,
                    `Ice-Genre: Electronic`,
                    `Ice-Bitrate: 128`,
                    `Ice-Public: 0`,
                    '',
                    ''
                ].join('\r\n');

                console.log('📤 Sending Harbor SOURCE request:');
                console.log(`SOURCE / ICY/1.0`);
                console.log(`Authorization: source ${credentials}`);
                
                liquidsoaptSocket.write(harborRequest);
            });

            liquidsoaptSocket.on('data', (data) => {
                const response = data.toString();
                console.log('📥 Shoutcast response:', response);

                if (response.includes('ICY 200 OK') || response.includes('HTTP/1.0 200 OK') || response.includes('HTTP/1.1 200 OK')) {
                    console.log('✅ Shoutcast authentication successful!');
                    isAuthenticated = true;
                    
                    // Send success response to WebDJ client
                    ws.send(JSON.stringify({
                        type: 'auth_success',
                        message: 'Connected to Shoutcast stream'
                    }));
                } else if (response.includes('401') || response.includes('Unauthorized') || response.includes('Invalid password')) {
                    console.log('❌ Shoutcast authentication failed');
                    ws.send(JSON.stringify({
                        type: 'auth_error',
                        message: 'Invalid credentials for Shoutcast'
                    }));
                } else {
                    console.log('❓ Unexpected response:', response);
                    ws.send(JSON.stringify({
                        type: 'auth_error',
                        message: `Unexpected response: ${response.trim()}`
                    }));
                }
            });

            liquidsoaptSocket.on('error', (error) => {
                console.error('❌ Shoutcast connection error:', error);
                ws.send(JSON.stringify({
                    type: 'connection_error',
                    message: error.message
                }));
            });

            liquidsoaptSocket.on('close', () => {
                console.log('🔌 Shoutcast connection closed');
                isAuthenticated = false;
            });

        } catch (error) {
            console.error('❌ Error connecting to Shoutcast:', error);
            ws.send(JSON.stringify({
                type: 'connection_error',
                message: error.message
            }));
        }
    }

    // Handle metadata updates
    async function handleMetadata(data) {
        if (!isAuthenticated || !liquidsoaptSocket) {
            console.log('⚠️ Cannot send metadata - not connected');
            return;
        }

        console.log('🏷️ Updating metadata:', data);
        
        // Format metadata for ICY protocol
        const title = data.title || '';
        const artist = data.artist || '';
        const metadata = artist && title ? `${artist} - ${title}` : (title || 'Live Stream');
        
        // Send ICY metadata update (if Liquidsoap supports it)
        // This is optional and depends on Liquidsoap configuration
        console.log(`🏷️ Metadata: ${metadata}`);
    }

    // Handle client disconnect
    ws.on('close', () => {
        console.log('🔴 WebSocket client disconnected');
        
        if (liquidsoaptSocket) {
            liquidsoaptSocket.destroy();
            liquidsoaptSocket = null;
        }
        
        isAuthenticated = false;
    });

    ws.on('error', (error) => {
        console.error('❌ WebSocket error:', error);
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        server: 'AzuraCast WebDJ Proxy',
        websocket_port: WEBSOCKET_PORT,
        target: `${TARGET_HOST}:${TARGET_PORT}${MOUNT_POINT}`,
        timestamp: new Date().toISOString()
    });
});

const HTTP_PORT = 3002;
app.listen(HTTP_PORT, () => {
    console.log(`🌐 Health check server running on http://localhost:${HTTP_PORT}`);
    console.log(`📋 Check status: http://localhost:${HTTP_PORT}/health`);
});