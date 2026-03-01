/**
 * IPC Handlers - bridges renderer requests to gRPC client
 */

import { ipcMain, BrowserWindow, app } from 'electron';
import { getGrpcClient } from './grpcClient.js';
import { getBackendManager } from './backendManager.js';
import type { CreateSessionOptions, SuggestionMode, EnvInfo, GitInfo } from '../shared/types.js';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

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

  // Environment detection - git runs in main process; Python env is detected
  // from the shell's $VIRTUAL_ENV / $CONDA_DEFAULT_ENV / $PYENV_VERSION via
  // the <<<BLOCKTERM:PYENV>>> marker emitted on every prompt (parsed in useBlocks).
  ipcMain.handle('system:getEnvInfo', async (_event, cwd: string): Promise<EnvInfo> => {
    const git = await detectGitInfo(cwd);
    return { git, python: null };
  });

  // ── Workspace persistence ───────────────────────────────────────────────

  ipcMain.on('workspace:save', (_event, data: unknown) => {
    try {
      cachedWorkspaceJson = JSON.stringify(data);
      const filePath = getWorkspaceFilePath();
      fs.writeFile(filePath, cachedWorkspaceJson, 'utf8', (err) => {
        if (err) console.error('Failed to save workspace:', err);
      });
    } catch (err) {
      console.error('Failed to serialize workspace:', err);
    }
  });

  ipcMain.handle('workspace:load', async () => {
    try {
      const filePath = getWorkspaceFilePath();
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.version === 1) {
          return parsed;
        }
      }
    } catch (err) {
      console.error('Failed to load workspace:', err);
    }
    return null;
  });
}
// ── Environment detection helpers ───────────────────────────────────────────

async function detectGitInfo(cwd: string): Promise<GitInfo | null> {
  try {
    // Verify git repo exists at or above cwd
    const { stdout: branchOut } = await execFileAsync(
      'git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'],
      { timeout: 3000 }
    );
    let branch = branchOut.trim();

    // Detached HEAD → show short SHA instead
    if (branch === 'HEAD') {
      const { stdout: shaOut } = await execFileAsync(
        'git', ['-C', cwd, 'rev-parse', '--short', 'HEAD'],
        { timeout: 3000 }
      );
      branch = shaOut.trim();
    }

    // Uncommitted changes vs HEAD (staged + unstaged)
    let added = 0;
    let deleted = 0;
    try {
      const { stdout: statOut } = await execFileAsync(
        'git', ['-C', cwd, 'diff', 'HEAD', '--shortstat'],
        { timeout: 3000 }
      );
      const addedMatch = statOut.match(/(\d+) insertion/);
      const deletedMatch = statOut.match(/(\d+) deletion/);
      added   = addedMatch  ? parseInt(addedMatch[1],  10) : 0;
      deleted = deletedMatch ? parseInt(deletedMatch[1], 10) : 0;
    } catch {
      // Clean working tree – no diff output, that’s fine
    }

    return { branch, added, deleted };
  } catch {
    // Not a git repo or git not on PATH
    return null;
  }
}

// ── Workspace persistence helpers ─────────────────────────────────────────

function getWorkspaceFilePath(): string {
  return path.join(app.getPath('userData'), 'workspace.json');
}

/** Cached workspace JSON for synchronous write on quit. */
let cachedWorkspaceJson: string | null = null;

/** Write the latest cached workspace state to disk synchronously. */
export function saveWorkspaceSync(): void {
  if (cachedWorkspaceJson) {
    try {
      fs.writeFileSync(getWorkspaceFilePath(), cachedWorkspaceJson, 'utf8');
    } catch (err) {
      console.error('Failed to save workspace on quit:', err);
    }
  }
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
  ipcMain.removeAllListeners('system:getEnvInfo');
  ipcMain.removeAllListeners('workspace:save');
  ipcMain.removeAllListeners('workspace:load');
}
