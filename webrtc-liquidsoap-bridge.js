#!/usr/bin/env node

const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const cors = require('cors');

/**
 * WebRTC-to-Liquidsoap Bridge Server
 * 
 * This bridge receives audio streams from the WebRTC DJ application
 * and forwards them to Liquidsoap's Harbor input, which then handles
 * the connection to Shoutcast servers.
 * 
 * Architecture:
 * WebRTC Client → This Bridge → Liquidsoap Harbor → Shoutcast Server
 * 
 * Port 3003: Bridge server
 * Port 8001: Liquidsoap Harbor input (configured in liquidsoap-bridge.liq)
 */

const app = express();
const PORT = 3003;
const LIQUIDSOAP_HARBOR_PORT = 8001;

app.use(cors());
app.use(express.json());

// Create HTTP server
const server = http.createServer(app);

// WebSocket server for receiving audio from client
const wss = new WebSocket.Server({ 
    server,
    path: '/stream'
});

console.log('🎵 WebRTC-to-Liquidsoap Bridge Server starting...');
console.log(`📡 WebSocket endpoint: ws://localhost:${PORT}/stream`);
console.log(`🔄 Forwarding to Liquidsoap Harbor: http://localhost:${LIQUIDSOAP_HARBOR_PORT}/`);

// Store active connections
const activeConnections = new Map();

wss.on('connection', (ws, req) => {
    const clientId = req.socket.remoteAddress + ':' + req.socket.remotePort;
    console.log(`✅ WebRTC client connected: ${clientId}`);
    
    // Store connection info
    activeConnections.set(ws, {
        clientId,
        connectedAt: new Date(),
        bytesReceived: 0
    });

    ws.on('message', async (audioData) => {
        const connection = activeConnections.get(ws);
        if (connection) {
            connection.bytesReceived += audioData.length;
            
            // Forward audio data to Liquidsoap Harbor input
            try {
                await forwardToLiquidsoap(audioData);
            } catch (error) {
                console.error('❌ Error forwarding to Liquidsoap:', error.message);
            }
        }
    });

    ws.on('close', () => {
        const connection = activeConnections.get(ws);
        if (connection) {
            console.log(`❌ Client disconnected: ${connection.clientId}`);
            console.log(`📊 Session stats: ${connection.bytesReceived} bytes received`);
            activeConnections.delete(ws);
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        activeConnections.delete(ws);
    });
});

/**
 * Forward audio data to Liquidsoap Harbor input
 * Harbor expects PCM audio data via HTTP PUT
 */
async function forwardToLiquidsoap(audioData) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: LIQUIDSOAP_HARBOR_PORT,
            path: '/',
            method: 'PUT',
            headers: {
                'Content-Type': 'audio/wav',
                'Content-Length': audioData.length,
                'User-Agent': 'WebRTC-Bridge/1.0'
            }
        };

        const req = http.request(options, (res) => {
            if (res.statusCode === 200) {
                resolve();
            } else {
                reject(new Error(`Liquidsoap Harbor returned status ${res.statusCode}`));
            }
        });

        req.on('error', (error) => {
            reject(error);
        });

        req.write(audioData);
        req.end();
    });
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        activeConnections: activeConnections.size,
        uptime: process.uptime(),
        liquidsoap: {
            harborPort: LIQUIDSOAP_HARBOR_PORT,
            endpoint: `http://localhost:${LIQUIDSOAP_HARBOR_PORT}/`
        }
    });
});

// Status endpoint
app.get('/status', (req, res) => {
    const connections = Array.from(activeConnections.values()).map(conn => ({
        clientId: conn.clientId,
        connectedAt: conn.connectedAt,
        bytesReceived: conn.bytesReceived
    }));

    res.json({
        bridge: {
            port: PORT,
            activeConnections: activeConnections.size,
            connections
        },
        liquidsoap: {
            harborPort: LIQUIDSOAP_HARBOR_PORT,
            endpoint: `http://localhost:${LIQUIDSOAP_HARBOR_PORT}/`
        }
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Bridge server running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    console.log(`📈 Status: http://localhost:${PORT}/status`);
    console.log('');
    console.log('🔄 Make sure Liquidsoap is running:');
    console.log('   liquidsoap liquidsoap-bridge.liq');
    console.log('');
    console.log('🎯 Client should connect to:');
    console.log(`   ws://localhost:${PORT}/stream`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down bridge server...');
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});