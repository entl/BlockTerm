/**
 * Preload script - exposes safe IPC API to renderer
 * Runs in a sandboxed context with access to Node.js APIs
 */

import { contextBridge, ipcRenderer } from 'electron';
import type { TerminalApi } from '../shared/terminalApi.js';
import type {
  CreateSessionOptions,
  HistoryEntry,
  Suggestion,
  SuggestionMode,
  BackendStatus,
} from '../shared/types.js';

// Map to track output listeners per session
const outputListeners = new Map<string, Set<(data: Uint8Array) => void>>();
const backendStatusListeners = new Set<(status: BackendStatus, error?: string) => void>();

// Set up IPC listener for output data (once, at preload time)
ipcRenderer.on('terminal:outputData', (_event, sessionId: string, data: Uint8Array) => {
  const listeners = outputListeners.get(sessionId);
  if (listeners) {
    listeners.forEach(cb => cb(data));
  }
});

// Set up IPC listener for backend status
ipcRenderer.on('backend:status', (_event, status: BackendStatus, error?: string) => {
  backendStatusListeners.forEach(cb => cb(status, error));
});

const terminalApi: TerminalApi = {
  async createSession(options: CreateSessionOptions): Promise<string> {
    return ipcRenderer.invoke('terminal:createSession', options);
  },

  sendInput(sessionId: string, data: string): void {
    ipcRenderer.send('terminal:sendInput', sessionId, data);
  },

  onOutput(sessionId: string, callback: (data: Uint8Array) => void) {
    // Get or create listener set for this session
    let listeners = outputListeners.get(sessionId);
    if (!listeners) {
      listeners = new Set();
      outputListeners.set(sessionId, listeners);
    }
    listeners.add(callback);

    // Tell main process to start streaming for this session
    ipcRenderer.send('terminal:subscribeOutput', sessionId);

    // Return unsubscribe function
    return () => {
      listeners?.delete(callback);
      if (listeners?.size === 0) {
        outputListeners.delete(sessionId);
        ipcRenderer.send('terminal:unsubscribeOutput', sessionId);
      }
    };
  },

  async resizeSession(sessionId: string, cols: number, rows: number): Promise<void> {
    return ipcRenderer.invoke('terminal:resizeSession', sessionId, cols, rows);
  },

  async closeSession(sessionId: string): Promise<void> {
    // Clean up local listeners
    outputListeners.delete(sessionId);
    return ipcRenderer.invoke('terminal:closeSession', sessionId);
  },

  async getHistory(limit: number, filter?: string): Promise<HistoryEntry[]> {
    return ipcRenderer.invoke('terminal:getHistory', limit, filter);
  },

  async recordCommand(
    sessionId: string,
    command: string,
    cwd: string,
    exitCode: number,
    timestamp: number
  ): Promise<void> {
    return ipcRenderer.invoke('terminal:recordCommand', sessionId, command, cwd, exitCode, timestamp);
  },

  async getSuggestions(
    sessionId: string,
    input: string,
    cursorPos: number,
    mode: SuggestionMode
  ): Promise<Suggestion[]> {
    return ipcRenderer.invoke('terminal:getSuggestions', sessionId, input, cursorPos, mode);
  },

  onBackendStatus(callback: (status: BackendStatus, error?: string) => void) {
    backendStatusListeners.add(callback);
    
    // Request current status
    ipcRenderer.send('backend:requestStatus');

    return () => {
      backendStatusListeners.delete(callback);
    };
  },

  async ping(): Promise<string> {
    return ipcRenderer.invoke('system:ping');
  },
};

// Expose API to renderer via contextBridge
contextBridge.exposeInMainWorld('terminalApi', terminalApi);
