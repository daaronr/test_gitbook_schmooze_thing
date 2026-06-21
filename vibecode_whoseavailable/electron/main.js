const { app, BrowserWindow, Tray, Menu, nativeImage, Notification, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

// Keep references to prevent garbage collection
let mainWindow = null;
let tray = null;
let serverProcess = null;
let serverPort = 3000;

// App configuration
const APP_NAME = "Who's Available";
const ICON_PATH = path.join(__dirname, 'build', 'icon.png');
const TRAY_ICON_PATH = path.join(__dirname, 'build', 'tray-icon.png');

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 400,
    minHeight: 500,
    title: APP_NAME,
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false, // Don't show until ready
    backgroundColor: '#fafafa',
  });

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Load the app
  mainWindow.loadURL(`http://localhost:${serverPort}`);

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Minimize to tray instead of closing
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  // Create tray icon (use a simple colored square if icon doesn't exist)
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(TRAY_ICON_PATH);
    if (trayIcon.isEmpty()) {
      trayIcon = createDefaultTrayIcon();
    }
  } catch {
    trayIcon = createDefaultTrayIcon();
  }

  // Resize for macOS menu bar
  if (process.platform === 'darwin') {
    trayIcon = trayIcon.resize({ width: 18, height: 18 });
  }

  tray = new Tray(trayIcon);
  tray.setToolTip(APP_NAME);

  updateTrayMenu();

  // Click behavior
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

function createDefaultTrayIcon() {
  // Create a simple 32x32 icon programmatically
  const size = 32;
  const canvas = Buffer.alloc(size * size * 4);

  // Fill with a nice blue color (#2563eb)
  for (let i = 0; i < size * size; i++) {
    const offset = i * 4;
    canvas[offset] = 37;     // R
    canvas[offset + 1] = 99; // G
    canvas[offset + 2] = 235; // B
    canvas[offset + 3] = 255; // A
  }

  return nativeImage.createFromBuffer(canvas, { width: size, height: size });
}

function updateTrayMenu(status = 'Not available') {
  const contextMenu = Menu.buildFromTemplate([
    {
      label: APP_NAME,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: "I'm Available",
      submenu: [
        { label: '10 minutes', click: () => setAvailable(10) },
        { label: '15 minutes', click: () => setAvailable(15) },
        { label: '30 minutes', click: () => setAvailable(30) },
        { label: '1 hour', click: () => setAvailable(60) },
      ],
    },
    {
      label: 'Mark as Done',
      click: () => markDone(),
    },
    { type: 'separator' },
    {
      label: 'Show Window',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
}

function setAvailable(minutes) {
  if (mainWindow) {
    mainWindow.webContents.executeJavaScript(`
      (function() {
        const minutes = ${minutes};
        document.getElementById('minutes').value = minutes;
        document.getElementById('goBtn').click();
      })();
    `);
    showNotification('Availability Set', `You're available for ${minutes} minutes`);
  }
}

function markDone() {
  if (mainWindow) {
    mainWindow.webContents.executeJavaScript(`
      document.getElementById('doneBtn').click();
    `);
    showNotification('Marked as Done', "You're no longer listed as available");
  }
}

function showNotification(title, body) {
  if (Notification.isSupported()) {
    const notification = new Notification({
      title,
      body,
      icon: ICON_PATH,
      silent: false,
    });
    notification.on('click', () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
    notification.show();
  }
}

function startServer() {
  return new Promise((resolve, reject) => {
    const serverPath = path.join(__dirname, '..', 'server.js');

    // Set environment variable to prevent browser auto-open
    const env = { ...process.env, ELECTRON: '1' };

    serverProcess = spawn(process.execPath, [serverPath], {
      cwd: path.join(__dirname, '..'),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let started = false;

    serverProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('[Server]', output.trim());

      // Detect when server is ready
      if (!started && output.includes('running on')) {
        started = true;
        // Extract port from output if different from default
        const portMatch = output.match(/:(\d+)/);
        if (portMatch) {
          serverPort = parseInt(portMatch[1], 10);
        }
        resolve();
      }
    });

    serverProcess.stderr.on('data', (data) => {
      console.error('[Server Error]', data.toString().trim());
    });

    serverProcess.on('error', (err) => {
      console.error('Failed to start server:', err);
      reject(err);
    });

    serverProcess.on('exit', (code) => {
      console.log(`Server exited with code ${code}`);
      if (!started) {
        reject(new Error(`Server exited with code ${code}`));
      }
    });

    // Timeout after 10 seconds
    setTimeout(() => {
      if (!started) {
        reject(new Error('Server start timeout'));
      }
    }, 10000);
  });
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}

// App lifecycle
app.whenReady().then(async () => {
  try {
    console.log('Starting server...');
    await startServer();
    console.log(`Server running on port ${serverPort}`);

    createWindow();
    createTray();

    // macOS: re-create window when dock icon clicked
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      } else if (mainWindow) {
        mainWindow.show();
      }
    });
  } catch (err) {
    console.error('Failed to start:', err);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  // On macOS, keep running in menu bar
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  stopServer();
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  stopServer();
  app.quit();
});
