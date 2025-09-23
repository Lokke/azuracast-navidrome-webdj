const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, shell } = require('electron');
const { join } = require('path');
const { spawn } = require('child_process');

// App configuration
const isDev = process.env.NODE_ENV === 'development';
const port = process.env.PORT || 3000; // For dev mode only

let mainWindow = null;
let tray = null;
let isQuiting = false;
let proxyServer = null;
let unifiedServer = null;

// Create main application window
function createMainWindow() {
  const win = new BrowserWindow({
    title: 'SubCaster',
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, 'preload.js'),
      webSecurity: !isDev
    },
    show: false
  });

  // Load the app
  if (isDev) {
    win.loadURL(`http://localhost:${port}`);
    win.webContents.openDevTools();
  } else {
    // In production, load from embedded server
    win.loadURL('http://localhost:3737');
  }

  // Show window when ready
  win.once('ready-to-show', () => {
    win.show();
    if (isDev) win.focus();
  });

  // Handle window closed
  win.on('closed', () => {
    mainWindow = null;
  });

  // Handle close to tray
  win.on('close', (event) => {
    if (!isQuiting) {
      event.preventDefault();
      win.hide();
    }
    return false;
  });

  // Open external links in browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

// Create system tray
function createTray() {
  // Skip tray creation if no icon available
  if (!isDev) {
    console.log('Tray creation skipped: no icon available in production');
    return;
  }
  
  try {
    tray = new Tray(join(process.cwd(), 'public', 'vite.svg'));
    
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show SubCaster',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Quit SubCaster',
        click: () => {
          isQuiting = true;
          app.quit();
        }
      }
    ]);
    
    tray.setContextMenu(contextMenu);
    tray.setToolTip('SubCaster - Professional DJ Software');
    
    // Double-click to show window
    tray.on('double-click', () => {
      if (mainWindow) {
        mainWindow.show();
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    });
  } catch (error) {
    console.log('Tray creation failed:', error.message);
  }
}// Create application menu
function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Quit',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
          click: () => {
            isQuiting = true;
            app.quit();
          }
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        { label: 'Toggle Developer Tools', accelerator: 'F12', role: 'toggleDevTools' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// IPC handlers
function setupIpcHandlers() {
  ipcMain.on('quit-app', () => {
    isQuiting = true;
    app.quit();
  });

  ipcMain.on('show-window', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  ipcMain.on('hide-window', () => {
    if (mainWindow) {
      mainWindow.hide();
    }
  });
}

// App event handlers
// Start proxy server for production
function startProxyServer() {
  if (isDev) return; // In dev mode, Vite handles proxying
  
  try {
    // Embedded unified server direkt in main.js
    const express = require('express');
    const cors = require('cors');
    const net = require('net');
    
    const app = express();
    const PORT = 3737; // Different port for desktop app

    // CORS für alle Requests aktivieren
    app.use(cors({
        origin: '*',
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'Ice-Public', 'Ice-Name', 'Ice-Description', 'User-Agent', 'Range']
    }));

    // Harbor Connection Handler
    let harborSocket = null;
    let isConnected = false;
    const MOUNT_POINTS = ['/', '/radio.mp3', '/teststream', '/live'];
    let currentMountIndex = 0;

    // Audio-Proxy für OpenSubsonic Streams
    app.get('/api/OpenSubsonic-stream', async (req, res) => {
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
    app.get('/api/OpenSubsonic-cover', async (req, res) => {
        const targetUrl = req.query.url;
        if (!targetUrl) {
            return res.status(400).json({ error: 'Missing URL parameter' });
        }
        
        console.log(`🖼️ Cover Art Request: ${targetUrl}`);
        
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
    app.get('/api/health', (req, res) => {
        res.json({ 
            status: 'ok', 
            message: 'Unified SubCaster Server (Embedded in Electron)',
            harbor: isConnected ? 'connected' : 'disconnected',
            mountPoint: isConnected ? MOUNT_POINTS[currentMountIndex] : null,
            corsProxy: 'enabled'
        });
    });

    // Statische Dateien servieren
    const path = require('path');
    const distPath = path.join(__dirname, '../dist');
    app.use(express.static(distPath, {
        setHeaders: (res, filePath, stat) => {
            // Cache-Control für bessere Performance
            res.set('Cache-Control', 'public, max-age=31536000'); // 1 Jahr für Assets
            if (filePath.endsWith('.html')) {
                res.set('Cache-Control', 'no-cache'); // HTML nicht cachen
            }
        }
    }));

    // Server starten
    unifiedServer = app.listen(PORT, '0.0.0.0', () => {
        console.log(`🌐 Embedded Unified SubCaster Server läuft auf Port ${PORT}`);
        console.log(`📡 CORS Proxy: /api/OpenSubsonic-stream, /api/OpenSubsonic-cover`);
        console.log(`🔄 Health check: /api/health`);
    });
    
    unifiedServer.on('error', (error) => {
        console.error('❌ Failed to start embedded unified server:', error);
    });
      
  } catch (error) {
    console.error('Failed to start embedded unified server:', error);
  }
}

app.whenReady().then(() => {
  mainWindow = createMainWindow();
  createTray();
  createMenu();
  setupIpcHandlers();
  startProxyServer(); // Start proxy server

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    } else if (mainWindow) {
      mainWindow.show();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  isQuiting = true;
  
  // Stop proxy server
  if (proxyServer && !proxyServer.killed) {
    console.log('Stopping proxy server...');
    proxyServer.kill();
  }
  
  // Stop unified server
  if (unifiedServer) {
    console.log('Stopping unified server...');
    unifiedServer.close();
  }
});

// Set app user model ID for Windows
if (process.platform === 'win32') {
  app.setAppUserModelId('com.lokke.subcaster');
}