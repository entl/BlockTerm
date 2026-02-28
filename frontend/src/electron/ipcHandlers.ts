/**
 * IPC Handlers - bridges renderer requests to gRPC client
 */

import { ipcMain, BrowserWindow } from 'electron';
import { getGrpcClient } from './grpcClient.js';
import { getBackendManager } from './backendManager.js';
import type { CreateSessionOptions, SuggestionMode } from '../shared/types.js';

// Track active output subscriptions per session
const activeOutputSubscriptions = new Map<string, Set<BrowserWindow>>();

export function setupIpcHandlers(): void {
  // Session management
  ipcMain.handle('terminal:createSession', async (_event, options: CreateSessionOptions) => {
    const client = getGrpcClient();
    if (!client) {
      throw new Error('Backend not connected');
    }
    
    const sessionId = await client.startSession({
      shell: options.shell,
      cwd: options.cwd,
      env: options.env,
    });

    // Auto-resize after creation if cols/rows provided
    if (options.cols && options.rows) {
      await client.resizeSession(sessionId, options.cols, options.rows);
    }

    return sessionId;
  });

  ipcMain.handle('terminal:closeSession', async (_event, sessionId: string) => {
    const client = getGrpcClient();
    if (!client) {
      throw new Error('Backend not connected');
    }
    
    // Clean up output subscriptions
    activeOutputSubscriptions.delete(sessionId);
    client.unsubscribeOutput(sessionId);
    
    return client.closeSession(sessionId);
  });

  ipcMain.handle('terminal:resizeSession', async (_event, sessionId: string, cols: number, rows: number) => {
    const client = getGrpcClient();
    if (!client) {
      throw new Error('Backend not connected');
    }
    return client.resizeSession(sessionId, cols, rows);
  });

  // Input handling (non-blocking send)
  ipcMain.on('terminal:sendInput', (_event, sessionId: string, data: string) => {
    const client = getGrpcClient();
    if (!client) {
      console.error('Backend not connected, dropping input');
      return;
    }
    client.sendInput(sessionId, data);
  });

  // Output subscription management
  ipcMain.on('terminal:subscribeOutput', (event, sessionId: string) => {
    const client = getGrpcClient();
    if (!client) {
      console.error('Backend not connected');
      return;
    }

    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;

    // Track this window's subscription
    let subscribers = activeOutputSubscriptions.get(sessionId);
    if (!subscribers) {
      subscribers = new Set();
      activeOutputSubscriptions.set(sessionId, subscribers);
      
      // Start the gRPC output stream for this session
      client.subscribeOutput(
        sessionId,
        (data: Uint8Array) => {
          // Broadcast to all subscribed windows
          const subs = activeOutputSubscriptions.get(sessionId);
          if (subs) {
            for (const w of subs) {
              if (!w.isDestroyed()) {
                w.webContents.send('terminal:outputData', sessionId, data);
              }
            }
          }
        },
        (err: Error) => {
          console.error(`Output stream error for ${sessionId}:`, err);
        },
        () => {
          console.log(`Output stream ended for ${sessionId}`);
          activeOutputSubscriptions.delete(sessionId);
        }
      );
    }
    subscribers.add(win);

    // Clean up when window closes
    win.once('closed', () => {
      subscribers?.delete(win);
      if (subscribers?.size === 0) {
        activeOutputSubscriptions.delete(sessionId);
        client.unsubscribeOutput(sessionId);
      }
    });
  });

  ipcMain.on('terminal:unsubscribeOutput', (event, sessionId: string) => {
    const client = getGrpcClient();
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;

    const subscribers = activeOutputSubscriptions.get(sessionId);
    if (subscribers) {
      subscribers.delete(win);
      if (subscribers.size === 0) {
        activeOutputSubscriptions.delete(sessionId);
        client?.unsubscribeOutput(sessionId);
      }
    }
  });

  // History
  ipcMain.handle('terminal:getHistory', async (_event, limit: number, filter?: string) => {
    const client = getGrpcClient();
    if (!client) {
      throw new Error('Backend not connected');
    }
    
    const entries = await client.queryHistory(filter || '', limit);
    return entries.map((entry: { sessionId: string; command: string; cwd: string; exitCode: number; timestamp: number }) => ({
      id: `${entry.sessionId}-${entry.timestamp}`,
      ...entry,
    }));
  });

  ipcMain.handle(
    'terminal:recordCommand',
    async (
      _event,
      sessionId: string,
      command: string,
      cwd: string,
      exitCode: number,
      timestamp: number
    ) => {
      const client = getGrpcClient();
      if (!client) throw new Error('Backend not connected');
      return client.recordCommand(sessionId, command, cwd, exitCode, timestamp);
    }
  );

  // Suggestions
  ipcMain.handle(
    'terminal:getSuggestions',
    async (_event, sessionId: string, input: string, cursorPos: number, _mode: SuggestionMode) => {
      const client = getGrpcClient();
      if (!client) {
        throw new Error('Backend not connected');
      }
      return client.getSuggestions(sessionId, input, cursorPos);
    }
  );

  // Backend status
  ipcMain.on('backend:requestStatus', (event) => {
    const manager = getBackendManager();
    const status = manager.getStatus();
    event.sender.send('backend:status', status);
  });

  // System
  ipcMain.handle('system:ping', async () => {
    const client = getGrpcClient();
    if (!client) {
      throw new Error('Backend not connected');
    }
    return client.ping();
  });
}

export function cleanupIpcHandlers(): void {
  ipcMain.removeAllListeners('terminal:createSession');
  ipcMain.removeAllListeners('terminal:closeSession');
  ipcMain.removeAllListeners('terminal:resizeSession');
  ipcMain.removeAllListeners('terminal:sendInput');
  ipcMain.removeAllListeners('terminal:subscribeOutput');
  ipcMain.removeAllListeners('terminal:unsubscribeOutput');
  ipcMain.removeAllListeners('terminal:getHistory');
  ipcMain.removeAllListeners('terminal:recordCommand');
  ipcMain.removeAllListeners('terminal:getSuggestions');
  ipcMain.removeAllListeners('backend:requestStatus');
  ipcMain.removeAllListeners('system:ping');
}
