// Unified Server: Web-App + CORS-Proxy auf Port 5173
import express from 'express';
import cors from 'cors';
import net from 'net';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3001;

// Debug: Environment Variables
console.log('🔍 Environment Debug:');
console.log(`   NODE_ENV: ${process.env.NODE_ENV}`);
console.log(`   DOCKER_ENV: ${process.env.DOCKER_ENV}`);
console.log(`   __dirname: ${__dirname}`);

// CORS für alle Requests aktivieren
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Ice-Public', 'Ice-Name', 'Ice-Description', 'User-Agent', 'Range']
}));

// JSON Body Parser for Setup-Wizard
app.use(express.json({ limit: '10mb' }));

// Harbor Connection Handler
let harborSocket = null;
let isConnected = false;
const MOUNT_POINTS = ['/', '/radio.mp3', '/teststream', '/live'];
let currentMountIndex = 0;

// CORS-Proxy Routes ZUERST definieren (vor static files)
// Audio-Proxy für OpenSubsonic Streams
app.get('/api/opensubsonic-stream', async (req, res) => {
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
            'User-Agent': req.headers['user-agent'] || 'OpenSubsonic-SubCaster-Proxy'
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
        
        console.log(`📥 OpenSubsonic response: ${response.status} ${response.statusText}`);
        
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

// Cover Art Proxy für OpenSubsonic
app.get('/api/opensubsonic-cover', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) {
        return res.status(400).json({ error: 'Missing URL parameter' });
    }
    
    // Reduzierte Logging - nur bei Debug oder Fehlern
    
    try {
        const fetch = (await import('node-fetch')).default;
        
        // Headers für Request vorbereiten
        const requestHeaders = {
            'User-Agent': req.headers['user-agent'] || 'OpenSubsonic-SubCaster-Proxy'
        };
        
        // Authorization hinzufügen falls vorhanden
        if (req.headers.authorization) {
            requestHeaders['Authorization'] = req.headers.authorization;
        }
        
        const response = await fetch(targetUrl, {
            headers: requestHeaders
        });
        
        // Nur Fehlermeldungen loggen, keine 200 OK Spam
        if (response.status >= 400) {
            console.log(`❌ Cover Art Error: ${response.status} ${response.statusText}`);
        }
        
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
        
    } catch (error) {
        console.error(`❌ Cover Art Proxy Error:`, error.message);
        res.status(500).json({ error: 'Proxy Error', details: error.message });
    }
});

// Harbor Stream Handler
app.post('/api/stream', async (req, res) => {
    console.log('📡 Incoming stream request');
    
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
            try {
                harborSocket.write(audioData);
                res.status(200).json({ 
                    status: 'ok', 
                    message: 'Audio data sent to Harbor',
                    bytes: audioData.length,
                    mountPoint: MOUNT_POINTS[currentMountIndex]
                });
            } catch (error) {
                console.error('❌ Failed to send audio to Harbor:', error);
                res.status(500).json({ error: 'Harbor Write Error', details: error.message });
            }
        } else {
            console.warn('⚠️  Harbor not connected, dropping audio data');
            res.status(503).json({ error: 'Harbor not connected' });
        }
    });
});

// Harbor Verbindung aufbauen
async function connectToHarbor(headers = {}) {
    return new Promise((resolve, reject) => {
        const SERVER_HOST = process.env.STREAM_SERVER || 'funkturm.radio-endstation.de';
        const SERVER_PORT = parseInt(process.env.STREAM_PORT || '8015', 10);
        const USERNAME = process.env.STREAM_USERNAME || 'test';
        const PASSWORD = process.env.STREAM_PASSWORD || 'test';
        
        const mountPoint = MOUNT_POINTS[currentMountIndex];
        
        console.log(`🔌 Connecting to Liquidsoap Harbor with mount: ${mountPoint}`);
        
        harborSocket = new net.Socket();
        
        harborSocket.connect(SERVER_PORT, SERVER_HOST, () => {
            console.log('✅ Connected to Harbor TCP socket');
            
            const credentials = Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64');
            console.log(`🔐 Using auth header: Basic ${credentials}`);
            console.log(`🔐 Decoded credentials: ${USERNAME}:${PASSWORD}`);
            
            const sourceRequest = `SOURCE ${mountPoint} HTTP/1.0\r\nAuthorization: Basic ${credentials}\r\nUser-Agent: SubCaster-Harbor-Client\r\nContent-Type: audio/mpeg\r\n\r\n`;
            
            console.log(`📤 Sending SOURCE request: SOURCE ${mountPoint} HTTP/1.0`);
            harborSocket.write(sourceRequest);
        });
        
        harborSocket.on('data', (data) => {
            const response = data.toString();
            console.log(`📥 Harbor response: ${response.trim()}`);
            
            if (response.includes('200 OK')) {
                console.log(`✅ Harbor confirmed connection with mount: ${mountPoint}`);
                isConnected = true;
                resolve();
            } else if (response.includes('401') || response.includes('403')) {
                console.error('❌ Harbor authentication failed');
                reject(new Error('Authentication failed'));
            } else if (response.includes('404')) {
                console.warn(`⚠️  Mount point ${mountPoint} not found, trying next...`);
                currentMountIndex = (currentMountIndex + 1) % MOUNT_POINTS.length;
                if (currentMountIndex === 0) {
                    reject(new Error('All mount points failed'));
                } else {
                    harborSocket.destroy();
                    setTimeout(() => connectToHarbor(headers).then(resolve).catch(reject), 1000);
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

// Setup Wizard - Save Configuration Endpoint
app.post('/api/save-config', async (req, res) => {
    try {
        const { content, createBackup } = req.body;
        
        if (!content || typeof content !== 'string') {
            return res.status(400).json({ error: 'Invalid content provided' });
        }
        
        // In Docker: persistentes Volume verwenden, sonst aktuelles Verzeichnis
        const isDocker = process.env.DOCKER_ENV === 'true';
        const envDir = isDocker ? '/app/docker-data' : __dirname;
        const envPath = path.join(envDir, '.env');
        
        console.log(`📁 Using env path: ${envPath} (Docker: ${isDocker})`);
        
        // Verzeichnis erstellen falls nicht vorhanden
        if (isDocker) {
            await fs.mkdir('/app/docker-data', { recursive: true });
        }
        
        // Create backup if requested
        if (createBackup) {
            try {
                const existingContent = await fs.readFile(envPath, 'utf8');
                const backupPath = path.join(__dirname, `.env.backup.${Date.now()}`);
                await fs.writeFile(backupPath, existingContent, 'utf8');
                console.log(`📁 Backup created: ${backupPath}`);
            } catch (backupError) {
                console.warn('⚠️ Could not create backup:', backupError.message);
                // Continue anyway - backup is optional
            }
        }
        
        // Write new configuration
        await fs.writeFile(envPath, content, 'utf8');
        console.log('✅ Configuration saved to .env file');
        
        res.json({ 
            success: true, 
            message: 'Configuration saved successfully',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Error saving configuration:', error);
        res.status(500).json({ 
            error: 'Failed to save configuration', 
            details: error.message 
        });
    }
});

// Setup Wizard - Check Configuration Status
app.get('/api/setup-status', async (req, res) => {
    try {
        // In Docker: persistentes Volume verwenden, sonst aktuelles Verzeichnis
        const isDocker = process.env.DOCKER_ENV === 'true';
        const envDir = isDocker ? '/app/docker-data' : __dirname;
        const envPath = path.join(envDir, '.env');
        
        console.log(`📁 Checking env path: ${envPath} (Docker: ${isDocker})`);
        
        try {
            const envContent = await fs.readFile(envPath, 'utf8');
            const hasContent = envContent.trim().length > 0;
            const hasOpenSubsonic = envContent.includes('VITE_OPENSUBSONIC_URL');
            const hasAzuraCast = envContent.includes('VITE_AZURACAST_SERVERS');
            const hasStreaming = envContent.includes('STREAM_SERVER');
            
            res.json({
                configExists: true,
                hasEnvFile: true,
                hasContent,
                services: {
                    opensubsonic: hasOpenSubsonic,
                    azuracast: hasAzuraCast,
                    streaming: hasStreaming
                },
                lastModified: (await fs.stat(envPath)).mtime
            });
        } catch (fileError) {
            res.json({
                configExists: false,
                hasEnvFile: false,
                hasContent: false,
                services: {
                    opensubsonic: false,
                    azuracast: false,
                    streaming: false
                }
            });
        }
    } catch (error) {
        console.error('❌ Error checking setup status:', error);
        res.status(500).json({ error: 'Failed to check setup status' });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'Unified SubCaster Server (Web + CORS Proxy)',
        harbor: isConnected ? 'connected' : 'disconnected',
        mountPoint: isConnected ? MOUNT_POINTS[currentMountIndex] : null,
        corsProxy: 'enabled'
    });
});

// Statische Dateien NACH den API-Routes
app.use(express.static(path.join(__dirname, 'dist'), {
    setHeaders: (res, path, stat) => {
        // Cache-Control für bessere Performance
        res.set('Cache-Control', 'public, max-age=31536000'); // 1 Jahr für Assets
        if (path.endsWith('.html')) {
            res.set('Cache-Control', 'no-cache'); // HTML nicht cachen
        }
    }
}));

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Unified SubCaster Server running on Port ${PORT}`);
    console.log(`🎯 Target: ${process.env.STREAM_SERVER || 'funkturm.radio-endstation.de'}:${process.env.STREAM_PORT || '8015'}`);
    console.log(`📡 CORS Proxy: /api/opensubsonic-stream, /api/opensubsonic-cover`);
    console.log(`🔄 Harbor Stream: /api/stream`);
    console.log(`🔄 Mount-Points: ${MOUNT_POINTS.join(', ')}`);
});
