const { app, BrowserWindow, Menu, Tray, dialog, globalShortcut, ipcMain, shell } = require('electron');const { app, BrowserWindow, Menu, Tray, dialog, globalShortcut, ipcMain, shell } = require('electron');

const { join } = require('path');const { join } = require('path');

const { readFileSync } = require('fs');const { readFileSync } = require('fs');



// App configuration// App configuration

const isDev = process.env.NODE_ENV === 'development';const isDev = process.env.NODE_ENV === 'development';

const port = process.env.PORT || 5173;const port = process.env.PORT || 5173;



let mainWindow = null;let mainWindow: BrowserWindow | null = null;

let tray = null;let tray: Tray | null = null;

let isQuiting = false;let isQuiting = false;



// Create main application window// Create main application window

function createMainWindow() {function createMainWindow(): BrowserWindow {

  const win = new BrowserWindow({  const win = new BrowserWindow({

    title: 'SubCaster',    title: 'SubCaster',

    width: 1400,    width: 1400,

    height: 900,    height: 900,

    minWidth: 1200,    minWidth: 1200,

    minHeight: 700,    minHeight: 700,

    icon: join(__dirname, '../public/subcaster-icon.png'),    icon: join(__dirname, '../public/subcaster-icon.png'),

    webPreferences: {    webPreferences: {

      nodeIntegration: false,      nodeIntegration: false,

      contextIsolation: true,      contextIsolation: true,

      preload: join(__dirname, 'preload.js'),      preload: join(__dirname, 'preload.js'),

      webSecurity: !isDev, // Disable web security in dev for CORS      webSecurity: !isDev, // Disable web security in dev for CORS

    },    },

    titleBarStyle: 'default',    titleBarStyle: 'default',

    autoHideMenuBar: false,    autoHideMenuBar: false,

    show: false, // Don't show until ready-to-show    show: false, // Don't show until ready-to-show

  });  });



  // Load the app  // Load the app

  if (isDev) {  if (isDev) {

    win.loadURL(`http://localhost:${port}`);    win.loadURL(`http://localhost:${port}`);

    // Open DevTools in development    // Open DevTools in development

    win.webContents.openDevTools();    win.webContents.openDevTools();

  } else {  } else {

    win.loadFile(join(__dirname, '../dist/index.html'));    win.loadFile(join(__dirname, '../dist/index.html'));

  }  }



  // Show window when ready  // Show window when ready

  win.once('ready-to-show', () => {  win.once('ready-to-show', () => {

    win.show();    win.show();

        

    // Focus window    // Focus window

    if (isDev) {    if (isDev) {

      win.focus();      win.focus();

    }    }

  });  });



  // Handle window closed  // Handle window closed

  win.on('closed', () => {  win.on('closed', () => {

    mainWindow = null;    mainWindow = null;

  });  });



  // Handle close to tray (don't quit app)  // Handle close to tray (don't quit app)

  win.on('close', (event) => {  win.on('close', (event) => {

    if (!isQuiting) {    if (!isQuiting) {

      event.preventDefault();      event.preventDefault();

      win.hide();      win.hide();

    }    }

    return false;    return false;

  });  });



  // Open external links in default browser  // Open external links in default browser

  win.webContents.setWindowOpenHandler(({ url }) => {  win.webContents.setWindowOpenHandler(({ url }) => {

    shell.openExternal(url);    shell.openExternal(url);

    return { action: 'deny' };    return { action: 'deny' };

  });  });



  return win;  return win;

}}



// Create system tray// Create system tray

function createTray() {function createTray(): void {

  tray = new Tray(join(__dirname, '../public/subcaster-tray.png'));  tray = new Tray(join(__dirname, '../public/subcaster-tray.png'));

    

  const contextMenu = Menu.buildFromTemplate([  const contextMenu = Menu.buildFromTemplate([

    {    {

      label: 'Show SubCaster',      label: 'Show SubCaster',

      click: () => {      click: () => {

        if (mainWindow) {        if (mainWindow) {

          mainWindow.show();          mainWindow.show();

          mainWindow.focus();          mainWindow.focus();

        }        }

      }      }

    },    },

    {    {

      label: 'Quick Play/Pause',      label: 'Quick Play/Pause',

      accelerator: 'Space',      accelerator: 'Space',

      click: () => {      click: () => {

        if (mainWindow) {        if (mainWindow) {

          mainWindow.webContents.send('hotkey-space');          mainWindow.webContents.send('hotkey-space');

        }        }

      }      }

    },    },

    { type: 'separator' },    { type: 'separator' },

    {    {

      label: 'Streaming Status',      label: 'Streaming Status',

      enabled: false      enabled: false

    },    },

    {    {

      label: 'Start Streaming',      label: 'Start Streaming',

      id: 'streaming-toggle',      id: 'streaming-toggle',

      click: () => {      click: () => {

        if (mainWindow) {        if (mainWindow) {

          mainWindow.webContents.send('hotkey-start-stream');          mainWindow.webContents.send('hotkey-start-stream');

        }        }

      }      }

    },    },

    { type: 'separator' },    { type: 'separator' },

    {    {

      label: 'Settings',      label: 'Settings',

      click: () => {      click: () => {

        if (mainWindow) {        if (mainWindow) {

          mainWindow.show();          mainWindow.show();

          mainWindow.webContents.send('show-settings');          mainWindow.webContents.send('show-settings');

        }        }

      }      }

    },    },

    {    {

      label: 'Quit SubCaster',      label: 'Quit SubCaster',

      click: () => {      click: () => {

        isQuiting = true;        isQuiting = true;

        app.quit();        app.quit();

      }      }

    }    }

  ]);  ]);



  tray.setToolTip('SubCaster - Professional DJ Software');  tray.setToolTip('SubCaster - Professional DJ Software');

  tray.setContextMenu(contextMenu);  tray.setContextMenu(contextMenu);

    

  // Double click to show window  // Double click to show window

  tray.on('double-click', () => {  tray.on('double-click', () => {

    if (mainWindow) {    if (mainWindow) {

      mainWindow.show();      mainWindow.show();

      mainWindow.focus();      mainWindow.focus();

    }    }

  });  });

}}



// Create application menu// Create application menu

function createMenu() {function createMenu(): void {

  const template = [  const template = [

    {    {

      label: 'File',      label: 'File',

      submenu: [      submenu: [

        {        {

          label: 'Open Audio File...',          label: 'Open Audio File...',

          accelerator: 'CmdOrCtrl+O',          accelerator: 'CmdOrCtrl+O',

          click: async () => {          click: async () => {

            if (mainWindow) {            if (mainWindow) {

              const result = await dialog.showOpenDialog(mainWindow, {              const result = await dialog.showOpenDialog(mainWindow, {

                properties: ['openFile', 'multiSelections'],                properties: ['openFile', 'multiSelections'],

                filters: [                filters: [

                  {                  {

                    name: 'Audio Files',                    name: 'Audio Files',

                    extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac']                    extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac']

                  },                  },

                  { name: 'All Files', extensions: ['*'] }                  { name: 'All Files', extensions: ['*'] }

                ]                ]

              });              });

                            

              if (!result.canceled) {              if (!result.canceled) {

                mainWindow.webContents.send('files-selected', result.filePaths);                mainWindow.webContents.send('files-selected', result.filePaths);

              }              }

            }            }

          }          }

        },        },

        { type: 'separator' },        {

        {          label: 'Open Folder...',

          label: 'Quit',          accelerator: 'CmdOrCtrl+Shift+O',

          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',          click: async () => {

          click: () => {            if (mainWindow) {

            isQuiting = true;              const result = await dialog.showOpenDialog(mainWindow, {

            app.quit();                properties: ['openDirectory']

          }              });

        }              

      ]              if (!result.canceled) {

    },                mainWindow.webContents.send('folder-selected', result.filePaths[0]);

    {              }

      label: 'Playback',            }

      submenu: [          }

        {        },

          label: 'Play/Pause',        { type: 'separator' },

          accelerator: 'Space',        {

          click: () => {          label: 'Quit',

            if (mainWindow) {          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',

              mainWindow.webContents.send('hotkey-space');          click: () => {

            }            isQuiting = true;

          }            app.quit();

        }          }

      ]        }

    },      ]

    {    },

      label: 'View',    {

      submenu: [      label: 'Edit',

        { label: 'Reload', accelerator: 'CmdOrCtrl+R', role: 'reload' },      submenu: [

        { label: 'Toggle Developer Tools', accelerator: 'F12', role: 'toggleDevTools' }        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', role: 'undo' },

      ]        { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo' },

    }        { type: 'separator' },

  ];        { label: 'Cut', accelerator: 'CmdOrCtrl+X', role: 'cut' },

        { label: 'Copy', accelerator: 'CmdOrCtrl+C', role: 'copy' },

  const menu = Menu.buildFromTemplate(template);        { label: 'Paste', accelerator: 'CmdOrCtrl+V', role: 'paste' }

  Menu.setApplicationMenu(menu);      ]

}    },

    {

// IPC handlers      label: 'Playback',

function setupIpcHandlers() {      submenu: [

  // Update tray menu when streaming status changes        {

  ipcMain.on('streaming-status-changed', (event, isStreaming) => {          label: 'Play/Pause',

    // Handle streaming status updates          accelerator: 'Space',

    console.log('Streaming status changed:', isStreaming);          click: () => {

  });            if (mainWindow) {

              mainWindow.webContents.send('hotkey-space');

  // Handle app quit request from renderer            }

  ipcMain.on('quit-app', () => {          }

    isQuiting = true;        },

    app.quit();        {

  });          label: 'Stop',

          accelerator: 'Esc',

  // Handle show/hide window          click: () => {

  ipcMain.on('show-window', () => {            if (mainWindow) {

    if (mainWindow) {              mainWindow.webContents.send('hotkey-stop');

      mainWindow.show();            }

      mainWindow.focus();          }

    }        },

  });        { type: 'separator' },

        {

  ipcMain.on('hide-window', () => {          label: 'Crossfader Left',

    if (mainWindow) {          accelerator: 'CmdOrCtrl+Left',

      mainWindow.hide();          click: () => {

    }            if (mainWindow) {

  });              mainWindow.webContents.send('hotkey-crossfader-left');

}            }

          }

// App event handlers        },

app.whenReady().then(() => {        {

  mainWindow = createMainWindow();          label: 'Crossfader Center',

  createTray();          accelerator: 'CmdOrCtrl+Down',

  createMenu();          click: () => {

  setupIpcHandlers();            if (mainWindow) {

              mainWindow.webContents.send('hotkey-crossfader-center');

  app.on('activate', () => {            }

    if (BrowserWindow.getAllWindows().length === 0) {          }

      mainWindow = createMainWindow();        },

    } else if (mainWindow) {        {

      mainWindow.show();          label: 'Crossfader Right',

    }          accelerator: 'CmdOrCtrl+Right',

  });          click: () => {

});            if (mainWindow) {

              mainWindow.webContents.send('hotkey-crossfader-right');

app.on('window-all-closed', () => {            }

  if (process.platform !== 'darwin') {          }

    app.quit();        }

  }      ]

});    },

    {

app.on('before-quit', () => {      label: 'Streaming',

  isQuiting = true;      submenu: [

});        {

          label: 'Start/Stop Streaming',

// Set app user model ID for Windows          accelerator: 'CmdOrCtrl+S',

if (process.platform === 'win32') {          click: () => {

  app.setAppUserModelId('com.lokke.subcaster');            if (mainWindow) {

}              mainWindow.webContents.send('hotkey-toggle-stream');

            }

module.exports = {};          }
        },
        {
          label: 'Toggle Microphone',
          accelerator: 'CmdOrCtrl+M',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('hotkey-toggle-mic');
            }
          }
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        { label: 'Force Reload', accelerator: 'CmdOrCtrl+Shift+R', role: 'forceReload' },
        { label: 'Toggle Developer Tools', accelerator: 'F12', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', role: 'zoomIn' },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { type: 'separator' },
        { label: 'Toggle Fullscreen', accelerator: 'F11', role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { label: 'Minimize', accelerator: 'CmdOrCtrl+M', role: 'minimize' },
        { label: 'Close', accelerator: 'CmdOrCtrl+W', role: 'close' },
        { type: 'separator' },
        {
          label: 'Minimize to Tray',
          accelerator: 'CmdOrCtrl+H',
          click: () => {
            if (mainWindow) {
              mainWindow.hide();
            }
          }
        }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About SubCaster',
          click: async () => {
            const packageInfo = JSON.parse(
              readFileSync(join(__dirname, '../package.json'), 'utf-8')
            );
            
            await dialog.showMessageBox(mainWindow!, {
              type: 'info',
              title: 'About SubCaster',
              message: `SubCaster v${packageInfo.version}`,
              detail: `Professional streaming and podcasting software with mixing capabilities\n\nAuthor: ${packageInfo.author}\nLicense: ${packageInfo.license}`
            });
          }
        },
        {
          label: 'Open GitHub Repository',
          click: () => {
            shell.openExternal('https://github.com/Lokke/subcaster');
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// Register global shortcuts
function registerGlobalShortcuts(): void {
  // Only register global shortcuts if not in development to avoid conflicts
  if (!isDev) {
    globalShortcut.register('MediaPlayPause', () => {
      if (mainWindow) {
        mainWindow.webContents.send('hotkey-space');
      }
    });

    globalShortcut.register('MediaStop', () => {
      if (mainWindow) {
        mainWindow.webContents.send('hotkey-stop');
      }
    });

    globalShortcut.register('MediaNextTrack', () => {
      if (mainWindow) {
        mainWindow.webContents.send('hotkey-next-track');
      }
    });

    globalShortcut.register('MediaPreviousTrack', () => {
      if (mainWindow) {
        mainWindow.webContents.send('hotkey-prev-track');
      }
    });
  }
}

// IPC handlers
function setupIpcHandlers(): void {
  // Update tray menu when streaming status changes
  ipcMain.on('streaming-status-changed', (event, isStreaming) => {
    if (tray) {
      const menu = tray.getContextMenu();
      // We'll need to rebuild the menu to update the label
      createTray();
    }
  });

  // Handle app quit request from renderer
  ipcMain.on('quit-app', () => {
    isQuiting = true;
    app.quit();
  });

  // Handle show/hide window
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
app.whenReady().then(() => {
  mainWindow = createMainWindow();
  createTray();
  createMenu();
  registerGlobalShortcuts();
  setupIpcHandlers();

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
});

app.on('will-quit', () => {
  // Unregister all global shortcuts
  globalShortcut.unregisterAll();
});

// Security: prevent new window creation
app.on('web-contents-created', (event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
});

// Set app user model ID for Windows
if (process.platform === 'win32') {
  app.setAppUserModelId('com.lokke.subcaster');
}

// Create system tray
function createTray(): void {
  tray = new Tray(join(__dirname, '../public/subcaster-tray.png'));
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show SubCaster',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: 'Quick Play/Pause',
      accelerator: 'Space',
      click: () => {
        if (mainWindow) {
          mainWindow.webContents.send('hotkey-space');
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Streaming Status',
      enabled: false
    },
    {
      label: 'Start Streaming',
      id: 'streaming-toggle',
      click: () => {
        if (mainWindow) {
          mainWindow.webContents.send('hotkey-start-stream');
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Settings',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.webContents.send('show-settings');
        }
      }
    },
    {
      label: 'Quit SubCaster',
      click: () => {
        app.isQuiting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('SubCaster - Professional DJ Software');
  tray.setContextMenu(contextMenu);
  
  // Double click to show window
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// Create application menu
function createMenu(): void {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Audio File...',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            if (mainWindow) {
              const result = await dialog.showOpenDialog(mainWindow, {
                properties: ['openFile', 'multiSelections'],
                filters: [
                  {
                    name: 'Audio Files',
                    extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac']
                  },
                  { name: 'All Files', extensions: ['*'] }
                ]
              });
              
              if (!result.canceled) {
                mainWindow.webContents.send('files-selected', result.filePaths);
              }
            }
          }
        },
        {
          label: 'Open Folder...',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: async () => {
            if (mainWindow) {
              const result = await dialog.showOpenDialog(mainWindow, {
                properties: ['openDirectory']
              });
              
              if (!result.canceled) {
                mainWindow.webContents.send('folder-selected', result.filePaths[0]);
              }
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Quit',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
          click: () => {
            app.isQuiting = true;
            app.quit();
          }
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo' },
        { type: 'separator' },
        { label: 'Cut', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: 'Paste', accelerator: 'CmdOrCtrl+V', role: 'paste' }
      ]
    },
    {
      label: 'Playback',
      submenu: [
        {
          label: 'Play/Pause',
          accelerator: 'Space',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('hotkey-space');
            }
          }
        },
        {
          label: 'Stop',
          accelerator: 'Esc',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('hotkey-stop');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Crossfader Left',
          accelerator: 'CmdOrCtrl+Left',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('hotkey-crossfader-left');
            }
          }
        },
        {
          label: 'Crossfader Center',
          accelerator: 'CmdOrCtrl+Down',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('hotkey-crossfader-center');
            }
          }
        },
        {
          label: 'Crossfader Right',
          accelerator: 'CmdOrCtrl+Right',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('hotkey-crossfader-right');
            }
          }
        }
      ]
    },
    {
      label: 'Streaming',
      submenu: [
        {
          label: 'Start/Stop Streaming',
          accelerator: 'CmdOrCtrl+S',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('hotkey-toggle-stream');
            }
          }
        },
        {
          label: 'Toggle Microphone',
          accelerator: 'CmdOrCtrl+M',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('hotkey-toggle-mic');
            }
          }
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        { label: 'Force Reload', accelerator: 'CmdOrCtrl+Shift+R', role: 'forceReload' },
        { label: 'Toggle Developer Tools', accelerator: 'F12', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', role: 'zoomIn' },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { type: 'separator' },
        { label: 'Toggle Fullscreen', accelerator: 'F11', role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { label: 'Minimize', accelerator: 'CmdOrCtrl+M', role: 'minimize' },
        { label: 'Close', accelerator: 'CmdOrCtrl+W', role: 'close' },
        { type: 'separator' },
        {
          label: 'Minimize to Tray',
          accelerator: 'CmdOrCtrl+H',
          click: () => {
            if (mainWindow) {
              mainWindow.hide();
            }
          }
        }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About SubCaster',
          click: async () => {
            const packageInfo = JSON.parse(
              readFileSync(join(__dirname, '../package.json'), 'utf-8')
            );
            
            await dialog.showMessageBox(mainWindow!, {
              type: 'info',
              title: 'About SubCaster',
              message: `SubCaster v${packageInfo.version}`,
              detail: `Professional streaming and podcasting software with mixing capabilities\n\nAuthor: ${packageInfo.author}\nLicense: ${packageInfo.license}`
            });
          }
        },
        {
          label: 'Open GitHub Repository',
          click: () => {
            shell.openExternal('https://github.com/Lokke/subcaster');
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template as any);
  Menu.setApplicationMenu(menu);
}

// Register global shortcuts
function registerGlobalShortcuts(): void {
  // Only register global shortcuts if not in development to avoid conflicts
  if (!isDev) {
    globalShortcut.register('MediaPlayPause', () => {
      if (mainWindow) {
        mainWindow.webContents.send('hotkey-space');
      }
    });

    globalShortcut.register('MediaStop', () => {
      if (mainWindow) {
        mainWindow.webContents.send('hotkey-stop');
      }
    });

    globalShortcut.register('MediaNextTrack', () => {
      if (mainWindow) {
        mainWindow.webContents.send('hotkey-next-track');
      }
    });

    globalShortcut.register('MediaPreviousTrack', () => {
      if (mainWindow) {
        mainWindow.webContents.send('hotkey-prev-track');
      }
    });
  }
}

// IPC handlers
function setupIpcHandlers(): void {
  // Update tray menu when streaming status changes
  ipcMain.on('streaming-status-changed', (event, isStreaming: boolean) => {
    if (tray) {
      const menu = tray.getContextMenu();
      const streamingItem = menu?.getMenuItemById('streaming-toggle');
      if (streamingItem) {
        streamingItem.label = isStreaming ? 'Stop Streaming' : 'Start Streaming';
      }
    }
  });

  // Handle app quit request from renderer
  ipcMain.on('quit-app', () => {
    app.isQuiting = true;
    app.quit();
  });

  // Handle show/hide window
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
app.whenReady().then(() => {
  createMainWindow();
  createTray();
  createMenu();
  registerGlobalShortcuts();
  setupIpcHandlers();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
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
  app.isQuiting = true;
});

app.on('will-quit', () => {
  // Unregister all global shortcuts
  globalShortcut.unregisterAll();
});

// Security: prevent new window creation
app.on('web-contents-created', (event, contents) => {
  contents.on('new-window', (event, navigationUrl) => {
    event.preventDefault();
    shell.openExternal(navigationUrl);
  });
});

// Set app user model ID for Windows
if (process.platform === 'win32') {
  app.setAppUserModelId('com.lokke.subcaster');
}

export {};