// Minimaler CORS-Proxy für direkte Liquidsoap Harbor Verbindung
import express from 'express';
import cors from 'cors';
import net from 'net';

const app = express();
const PORT = 8082;

// CORS für alle Requests aktivieren
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Ice-Public', 'Ice-Name', 'Ice-Description', 'User-Agent', 'Range']
}));

// Harbor Connection Handler
let harborSocket = null;
let isConnected = false;

// Mount points to try (most common for Radio Endstation)
const MOUNT_POINTS = ['/', '/radio.mp3', '/teststream', '/live'];
let currentMountIndex = 0;

// Direkter Harbor SOURCE Handler
app.post('/stream', async (req, res) => {
    console.log('📡 Incoming stream request');
    
    // Buffer für Request Body
    const chunks = [];
    
    req.on('data', (chunk) => {
        chunks.push(chunk);
    });
    
    req.on('end', async () => {
        const audioData = Buffer.concat(chunks);
        console.log(`🎵 Received audio chunk: ${audioData.length} bytes`);
        
        // Harbor-Verbindung aufbauen falls noch nicht vorhanden
        if (!harborSocket || harborSocket.destroyed) {
            try {
                await connectToHarbor(req.headers);
            } catch (error) {
                console.error('❌ Failed to connect to Harbor:', error);
                return res.status(504).json({ error: 'Gateway Timeout', details: error.message });
            }
        }
        
        // Audio-Daten an Harbor senden
        if (isConnected && harborSocket && !harborSocket.destroyed) {
            harborSocket.write(audioData);
            res.status(200).json({ status: 'chunk sent', size: audioData.length });
        } else {
            console.log('❌ Harbor not connected, cannot send audio');
            res.status(503).json({ error: 'Harbor not connected' });
        }
    });
});

// Harbor TCP-Verbindung aufbauen
function connectToHarbor(headers) {
    return new Promise((resolve, reject) => {
        const mountPoint = MOUNT_POINTS[currentMountIndex];
        console.log(`🔌 Connecting to Liquidsoap Harbor with mount: ${mountPoint}`);
        
        harborSocket = new net.Socket();
        
        harborSocket.connect(8015, 'funkturm.radio-endstation.de', () => {
            console.log('✅ Connected to Harbor TCP socket');
            
            // Use original auth header directly (already corrected from frontend)
            const authHeader = headers.authorization || '';
            console.log('🔐 Using auth header:', authHeader);
            
            // Decode to see credentials for debugging
            if (authHeader.startsWith('Basic ')) {
                const decoded = Buffer.from(authHeader.substring(6), 'base64').toString();
                console.log('🔐 Decoded credentials:', decoded);
            }
            
            // SOURCE Request an Harbor senden
            const sourceRequest = [
                `SOURCE ${mountPoint} HTTP/1.0`,
                `Authorization: ${authHeader}`,
                `Content-Type: ${headers['content-type'] || 'audio/webm'}`,
                `Ice-Public: ${headers['ice-public'] || '0'}`,
                `Ice-Name: ${headers['ice-name'] || 'SubCaster Live Stream'}`,
                `Ice-Description: ${headers['ice-description'] || 'Live broadcast from SubCaster'}`,
                `User-Agent: ${headers['user-agent'] || 'SubCaster/1.0'}`,
                '',
                ''
            ].join('\r\n');
            
            console.log(`📤 Sending SOURCE request: SOURCE ${mountPoint} HTTP/1.0`);
            harborSocket.write(sourceRequest);
            
            // Timeout für Harbor Response
            setTimeout(() => {
                if (!isConnected) {
                    isConnected = true;
                    console.log(`✅ Harbor connection assumed successful with mount: ${mountPoint}`);
                    resolve(true);
                }
            }, 1000);
        });
        
        harborSocket.on('data', (data) => {
            const response = data.toString();
            console.log('📥 Harbor response:', response);
            
            if (response.includes('200') || response.includes('OK')) {
                isConnected = true;
                console.log(`✅ Harbor confirmed connection with mount: ${mountPoint}`);
                resolve(true);
            } else if (response.includes('401') || response.includes('403')) {
                console.log('❌ Harbor authentication failed');
                reject(new Error('Authentication failed'));
            } else if (response.includes('404')) {
                console.log(`❌ Harbor mountpoint ${mountPoint} not available`);
                
                // Try next mount point
                currentMountIndex++;
                if (currentMountIndex < MOUNT_POINTS.length) {
                    console.log(`🔄 Trying next mount point: ${MOUNT_POINTS[currentMountIndex]}`);
                    harborSocket.destroy();
                    // Recursively try next mount point
                    connectToHarbor(headers).then(resolve).catch(reject);
                } else {
                    reject(new Error('All mount points failed'));
                }
            }
        });
        
        harborSocket.on('error', (error) => {
            console.error('❌ Harbor connection error:', error);
            isConnected = false;
            reject(error);
        });
        
        harborSocket.on('close', () => {
            console.log('🔌 Harbor connection closed');
            isConnected = false;
        });
    });
}

// Audio-Proxy für Navidrome Streams (CORS-Fix)
app.get('/navidrome-stream', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) {
        return res.status(400).json({ error: 'Missing URL parameter' });
    }
    
    console.log(`🎵 Audio-Stream Request: ${targetUrl}`);
    console.log(`📡 Headers: Range=${req.headers.range || 'none'}`);
    
    try {
        const fetch = (await import('node-fetch')).default;
        
        // Headers für Request vorbereiten
        const requestHeaders = {
            'User-Agent': req.headers['user-agent'] || 'Navidrome-SubCaster-Proxy'
        };
        
        // Range-Header nur hinzufügen wenn vorhanden
        if (req.headers.range) {
            requestHeaders['Range'] = req.headers.range;
        }
        
        // Authorization hinzufügen falls vorhanden
        if (req.headers.authorization) {
            requestHeaders['Authorization'] = req.headers.authorization;
        }
        
        console.log(`📤 Forwarding headers:`, requestHeaders);
        
        const response = await fetch(targetUrl, {
            headers: requestHeaders
        });
        
        console.log(`📥 Navidrome response: ${response.status} ${response.statusText}`);
        
        // CORS-Headers hinzufügen
        res.set({
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
            'Access-Control-Allow-Headers': 'Range, Authorization, Content-Type',
            'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
        });
        
        // Content-Type weiterleiten
        if (response.headers.get('content-type')) {
            res.set('Content-Type', response.headers.get('content-type'));
        }
        
        // Content-Length weiterleiten falls vorhanden
        if (response.headers.get('content-length')) {
            res.set('Content-Length', response.headers.get('content-length'));
        }
        
        // Accept-Ranges weiterleiten
        if (response.headers.get('accept-ranges')) {
            res.set('Accept-Ranges', response.headers.get('accept-ranges'));
        }
        
        // Content-Range weiterleiten (wichtig für Range-Requests)
        if (response.headers.get('content-range')) {
            res.set('Content-Range', response.headers.get('content-range'));
        }
        
        // Status Code weiterleiten
        res.status(response.status);
        
        // Stream weiterleiten
        response.body.pipe(res);
        console.log(`✅ Audio-Stream proxied: ${response.status}`);
        
    } catch (error) {
        console.error(`❌ Audio-Proxy Error:`, error.message);
        res.status(500).json({ error: 'Proxy Error', details: error.message });
    }
});

// Cover Art Proxy für Navidrome
app.get('/navidrome-cover', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) {
        return res.status(400).json({ error: 'Missing URL parameter' });
    }
    
    console.log(`🖼️ Cover Art Request: ${targetUrl}`);
    
    try {
        const fetch = (await import('node-fetch')).default;
        
        // Headers für Request vorbereiten
        const requestHeaders = {
            'User-Agent': req.headers['user-agent'] || 'Navidrome-SubCaster-Proxy'
        };
        
        // Authorization hinzufügen falls vorhanden
        if (req.headers.authorization) {
            requestHeaders['Authorization'] = req.headers.authorization;
        }
        
        const response = await fetch(targetUrl, {
            headers: requestHeaders
        });
        
        console.log(`📥 Cover response: ${response.status} ${response.statusText}`);
        
        // CORS-Headers hinzufügen
        res.set({
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
            'Access-Control-Allow-Headers': 'Authorization, Content-Type'
        });
        
        // Content-Type weiterleiten
        if (response.headers.get('content-type')) {
            res.set('Content-Type', response.headers.get('content-type'));
        }
        
        // Content-Length weiterleiten falls vorhanden
        if (response.headers.get('content-length')) {
            res.set('Content-Length', response.headers.get('content-length'));
        }
        
        // Status Code weiterleiten
        res.status(response.status);
        
        // Stream weiterleiten
        response.body.pipe(res);
        console.log(`✅ Cover Art proxied: ${response.status}`);
        
    } catch (error) {
        console.error(`❌ Cover Art Proxy Error:`, error.message);
        res.status(500).json({ error: 'Proxy Error', details: error.message });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'Harbor CORS Proxy with Audio-Proxy',
        harbor: isConnected ? 'connected' : 'disconnected',
        mountPoint: isConnected ? MOUNT_POINTS[currentMountIndex] : null,
        audioProxy: 'enabled'
    });
});

app.listen(PORT, () => {
    console.log(`🌐 Harbor CORS Proxy läuft auf Port ${PORT}`);
    console.log(`🎯 Ziel: funkturm.radio-endstation.de:8015`);
    console.log(`📡 Nutze: http://localhost:${PORT}/stream`);
    console.log(`🔄 Wird Mount-Points probieren: ${MOUNT_POINTS.join(', ')}`);
});
