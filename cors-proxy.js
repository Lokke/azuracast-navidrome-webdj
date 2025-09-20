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
    allowedHeaders: ['Content-Type', 'Authorization', 'Ice-Public', 'Ice-Name', 'Ice-Description', 'User-Agent']
}));

// Harbor Connection Handler
let harborSocket = null;
let isConnected = false;

// Mount points to try (most common for Radio Endstation)
const MOUNT_POINTS = ['/', '/radio.mp3', '/teststream', '/live'];
let currentMountIndex = 0;

// Direkter Harbor SOURCE Handler (nicht über http-proxy-middleware)
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
            
            // SOURCE Request an Harbor senden
            const auth = headers.authorization || '';
            const sourceRequest = [
                `SOURCE ${mountPoint} HTTP/1.0`,
                `Authorization: ${auth}`,
                `Content-Type: ${headers['content-type'] || 'audio/webm'}`,
                `Ice-Public: ${headers['ice-public'] || '0'}`,
                `Ice-Name: ${headers['ice-name'] || 'WebDJ Live Stream'}`,
                `Ice-Description: ${headers['ice-description'] || 'Live broadcast from WebDJ'}`,
                `User-Agent: ${headers['user-agent'] || 'WebDJ/1.0'}`,
                '',
                ''
            ].join('\r\n');
            
            console.log(`📤 Sending SOURCE request to Harbor: SOURCE ${mountPoint} HTTP/1.0`);
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

// Harbor TCP-Verbindung aufbauen
function connectToHarbor(headers) {
    return new Promise((resolve, reject) => {
        console.log('🔌 Connecting to Liquidsoap Harbor...');
        
        harborSocket = new net.Socket();
        
        harborSocket.connect(8015, 'funkturm.radio-endstation.de', () => {
            console.log('✅ Connected to Harbor TCP socket');
            
            // SOURCE Request an Harbor senden
            const auth = headers.authorization || '';
            const sourceRequest = [
                'SOURCE /teststream HTTP/1.0',
                `Authorization: ${auth}`,
                `Content-Type: ${headers['content-type'] || 'audio/webm'}`,
                `Ice-Public: ${headers['ice-public'] || '0'}`,
                `Ice-Name: ${headers['ice-name'] || 'WebDJ Live Stream'}`,
                `Ice-Description: ${headers['ice-description'] || 'Live broadcast from WebDJ'}`,
                `User-Agent: ${headers['user-agent'] || 'WebDJ/1.0'}`,
                '',
                ''
            ].join('\r\n');
            
            console.log('� Sending SOURCE request to Harbor:', sourceRequest.split('\r\n')[0]);
            harborSocket.write(sourceRequest);
            
            // Timeout für Harbor Response
            setTimeout(() => {
                if (!isConnected) {
                    isConnected = true;
                    console.log('✅ Harbor connection assumed successful (timeout-based)');
                    resolve(true);
                }
            }, 1000);
        });
        
        harborSocket.on('data', (data) => {
            const response = data.toString();
            console.log('� Harbor response:', response);
            
            if (response.includes('200') || response.includes('OK')) {
                isConnected = true;
                console.log('✅ Harbor confirmed connection');
                resolve(true);
            } else if (response.includes('401') || response.includes('403')) {
                console.log('❌ Harbor authentication failed');
                reject(new Error('Authentication failed'));
            } else if (response.includes('404')) {
                console.log('❌ Harbor mountpoint not available');
                reject(new Error('Mountpoint not available'));
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

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'Harbor CORS Proxy',
        harbor: isConnected ? 'connected' : 'disconnected'
    });
});

app.listen(PORT, () => {
    console.log(`🌐 Harbor CORS Proxy läuft auf Port ${PORT}`);
    console.log(`🎯 Ziel: funkturm.radio-endstation.de:8015/teststream`);
    console.log(`📡 Nutze: http://localhost:${PORT}/stream`);
});