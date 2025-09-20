// Simple CORS Proxy für Shoutcast/Icecast Streaming
// Startet einen lokalen Proxy-Server um CORS-Probleme zu umgehen

import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import dotenv from 'dotenv';

// .env-Datei laden
dotenv.config();

const app = express();

// CORS-Headers für alle Anfragen aktivieren
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Ice-Name, Ice-URL, Ice-Genre, Ice-Description, Ice-Bitrate, Ice-Public, Icy-Name, Icy-Genre, Icy-Br, Icy-Pub');
  res.header('Access-Control-Max-Age', '86400');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Proxy für Shoutcast/Icecast Server
app.use('/stream', createProxyMiddleware({
  target: process.env.VITE_STREAM_SERVER || 'http://51.75.145.84:8015',
  changeOrigin: true,
  pathRewrite: {
    '^/stream': '' // entfernt /stream prefix
  },
  onProxyReq: (proxyReq, req, res) => {
    console.log(`Proxying ${req.method} ${req.url} to streaming server`);
  },
  onError: (err, req, res) => {
    console.error('Proxy error:', err);
    res.status(500).json({ error: 'Proxy connection failed' });
  }
}));

// Gesundheitscheck
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    proxy: 'running',
    target: process.env.VITE_STREAM_SERVER || 'http://51.75.145.84:8015'
  });
});

const PORT = process.env.PROXY_PORT || 3001;

app.listen(PORT, () => {
  console.log(`\n🎵 DJ WebApp CORS Proxy Server gestartet!`);
  console.log(`📡 Läuft auf: http://localhost:${PORT}`);
  console.log(`🎯 Proxy für: ${process.env.VITE_STREAM_SERVER || 'http://51.75.145.84:8015'}`);
  console.log(`\n💡 Verwende in der App: http://localhost:${PORT}/stream`);
  console.log(`⚙️  Gesundheitscheck: http://localhost:${PORT}/health\n`);
});