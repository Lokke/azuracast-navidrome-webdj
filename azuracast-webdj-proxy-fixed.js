// AzuraCast-kompatibles WebSocket WebDJ Proxy (Exakte Implementierung)
import WebSocket, { WebSocketServer } from 'ws';
import express from 'express';
import cors from 'cors';
import net from 'net';

const app = express();
const PORT = 8080;
const WS_PORT = 8081;

// CORS konfigurieren für Cross-Origin Requests
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Einfacher Health Check Endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', message: 'AzuraCast WebDJ Proxy läuft' });
});

app.listen(PORT, () => {
    console.log(`HTTP Server läuft auf Port ${PORT}`);
});

// WebSocket Server für WebDJ (exakte AzuraCast Implementierung)
const wss = new WebSocketServer({ 
    port: WS_PORT,
    protocols: ['webcast']  // Exakt wie AzuraCast
});

console.log(`WebSocket Server läuft auf Port ${WS_PORT} mit 'webcast' Protokoll`);

wss.on('connection', (ws, req) => {
    console.log('WebSocket Verbindung erhalten mit Protokoll:', ws.protocol);
    
    let liquidSocket = null;
    let helloReceived = false;
    let isConnected = false;
    
    ws.on('message', async (data) => {
        try {
            if (!helloReceived && !Buffer.isBuffer(data)) {
                // Erste Nachricht muss hello sein (JSON)
                const message = JSON.parse(data.toString());
                console.log('Hello-Nachricht empfangen:', message);
                
                if (message.type === 'hello' && message.data) {
                    helloReceived = true;
                    const helloData = message.data;
                    
                    console.log('Hello Data:', {
                        mime: helloData.mime,
                        user: helloData.user,
                        password: helloData.password
                    });
                    
                    // Verbindung zu Liquidsoap Harbor aufbauen
                    liquidSocket = new net.Socket();
                    
                    liquidSocket.connect(8015, 'funkturm.radio-endstation.de', () => {
                        console.log('Verbunden mit Liquidsoap Harbor auf Port 8015');
                        
                        // Harbor SOURCE Request mit korrektem Format
                        const username = helloData.user || 'source';
                        const password = helloData.password || 'test';
                        const mount = '/teststream';
                        
                        const requestLines = [
                            `SOURCE ${mount} HTTP/1.0`,
                            `Authorization: Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
                            `Content-Type: ${helloData.mime || 'audio/webm; codecs=opus'}`,
                            'User-Agent: AzuraCast WebDJ',
                            'ice-public: 0',
                            'ice-name: WebDJ Live Stream',
                            'ice-description: Live broadcast from WebDJ',
                            'ice-genre: Live',
                            '',
                            ''
                        ];
                        
                        const request = requestLines.join('\r\n');
                        console.log('Sende Harbor SOURCE Request:', request);
                        liquidSocket.write(request);
                        
                        // AzuraCast verwendet Timeout für Erfolg (kein Server Response)
                        setTimeout(() => {
                            if (liquidSocket && !liquidSocket.destroyed) {
                                isConnected = true;
                                console.log('✓ Angenommen: Verbindung erfolgreich (Timeout-basiert wie AzuraCast)');
                            }
                        }, 1000);
                    });
                    
                    liquidSocket.on('data', (response) => {
                        const responseStr = response.toString();
                        console.log('Harbor Response:', responseStr);
                        
                        // Prüfe auf erfolgreiche Antwort
                        if (responseStr.includes('200') || responseStr.includes('OK')) {
                            isConnected = true;
                            console.log('✓ Harbor bestätigt Verbindung');
                        } else if (responseStr.includes('401') || responseStr.includes('403')) {
                            console.log('✗ Authentifizierung fehlgeschlagen');
                            ws.close(1008, 'Authentication failed');
                        } else if (responseStr.includes('404')) {
                            console.log('✗ Mountpoint nicht verfügbar');
                            ws.close(1008, 'Mountpoint not available');
                        }
                    });
                    
                    liquidSocket.on('error', (error) => {
                        console.error('Liquidsoap Verbindungsfehler:', error);
                        ws.close(1011, 'Server connection failed');
                    });
                    
                    liquidSocket.on('close', () => {
                        console.log('Liquidsoap Verbindung geschlossen');
                        isConnected = false;
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.close(1000, 'Server connection closed');
                        }
                    });
                } else {
                    console.log('Ungültige Hello-Nachricht:', message);
                    ws.close(1008, 'Invalid hello message');
                }
            } else {
                // Weitere Nachrichten nach hello
                if (!Buffer.isBuffer(data)) {
                    try {
                        const message = JSON.parse(data.toString());
                        if (message.type === 'metadata' && message.data) {
                            console.log('Metadata empfangen:', message.data);
                            // Metadata handling könnte hier implementiert werden
                        }
                    } catch (e) {
                        console.log('Nicht-JSON Nachricht empfangen, ignoriere');
                    }
                } else {
                    // Binäre Audio-Daten (wie AzuraCast)
                    if (isConnected && liquidSocket && liquidSocket.writable) {
                        liquidSocket.write(data);
                        console.log(`Audio-Chunk gesendet: ${data.length} bytes`);
                    } else {
                        console.log('Audio-Daten empfangen, aber nicht verbunden');
                    }
                }
            }
        } catch (error) {
            console.error('Fehler beim Verarbeiten der Nachricht:', error);
        }
    });
    
    ws.on('close', (code, reason) => {
        console.log(`WebSocket geschlossen: ${code} - ${reason}`);
        isConnected = false;
        if (liquidSocket) {
            liquidSocket.destroy();
        }
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket Fehler:', error);
        if (liquidSocket) {
            liquidSocket.destroy();
        }
    });
});