/**
 * Electron Main Process
 * - Spawns and monitors Go backend
 * - Creates main window with preload script
 * - Sets up IPC handlers for renderer communication
 */

import { app, BrowserWindow } from 'electron';
import path from 'path';
import { isDev } from './utils.js';
import { getBackendManager, BackendManager } from './backendManager.js';
import { createGrpcClient, closeGrpcClient, getGrpcClient } from './grpcClient.js';
import { setupIpcHandlers, cleanupIpcHandlers, saveWorkspaceSync } from './ipcHandlers.js';

let mainWindow: BrowserWindow | null = null;
let backendManager: BackendManager | null = null;

function createWindow(): BrowserWindow {
  const preloadPath = path.join(app.getAppPath(), 'dist-electron', 'electron', 'preload.js');
  
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    backgroundColor: '#1e1e1e',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Required for preload script to access Node.js APIs
    },
  });

  // Load the app
  if (isDev()) {
    win.loadURL('http://localhost:5123');
  } else {
    win.loadFile(path.join(app.getAppPath(), 'dist-react', 'index.html'));
  }

  return win;
}

async function startBackend(): Promise<void> {
  backendManager = getBackendManager();
  
  // Forward backend status to renderer
  backendManager.on('status', (status, error) => {
    mainWindow?.webContents.send('backend:status', status, error);
  });

  backendManager.on('output', (data) => {
    console.log('[Backend]', data);
  });

  try {
    const address = await backendManager.start();
    console.log(`Backend ready at ${address}`);
    
    // Create gRPC client
    createGrpcClient(address);
    
    // Verify connection
    const client = getGrpcClient();
    if (client) {
      try {
        const pong = await client.ping('hello');
        console.log('Backend ping response:', pong);
      } catch (err) {
        console.warn('Backend ping failed:', err);
      }
    }
  } catch (err) {
    console.error('Failed to start backend:', err);
    // App can still run, but terminal features won't work
  }
}

// App lifecycle
app.on('ready', async () => {
  // Set up IPC handlers before creating window
  setupIpcHandlers();
  
  // Create main window
  mainWindow = createWindow();
  
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Start backend in parallel
  startBackend().catch(err => {
    console.error('Backend startup error:', err);
  });
});

app.on('window-all-closed', () => {
  // On macOS, apps typically stay open until explicitly quit
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On macOS, re-create window when dock icon clicked
  if (mainWindow === null) {
    mainWindow = createWindow();
  }
});

app.on('before-quit', () => {
  // Flush latest workspace state to disk synchronously
  saveWorkspaceSync();
  // Cleanup
  cleanupIpcHandlers();
  closeGrpcClient();
  backendManager?.stop();
});

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});