/**
 * Type definition for the Terminal API exposed to the renderer
 * via preload script's contextBridge
 */

import type {
  CreateSessionOptions,
  HistoryEntry,
  Suggestion,
  SuggestionMode,
  UnsubscribeFn,
  BackendStatus,
  SavedWorkspace,
  EnvInfo,
} from './types.js';

export interface TerminalApi {
  /**
   * Create a new terminal session
   */
  createSession(options: CreateSessionOptions): Promise<string>;

  /**
   * Send input data to a session
   */
  sendInput(sessionId: string, data: string): void;

  /**
   * Subscribe to output data from a session
   */
  onOutput(sessionId: string, callback: (data: Uint8Array) => void): UnsubscribeFn;

  /**
   * Resize a terminal session
   */
  resizeSession(sessionId: string, cols: number, rows: number): Promise<void>;

  /**
   * Close a terminal session
   */
  closeSession(sessionId: string): Promise<void>;

  /**
   * Get command history
   */
  getHistory(limit: number, filter?: string): Promise<HistoryEntry[]>;

  /**
   * Record a completed command to history
   */
  recordCommand(
    sessionId: string,
    command: string,
    cwd: string,
    exitCode: number,
    timestamp: number
  ): Promise<void>;

  /**
   * Get suggestions for autocomplete
   */
  getSuggestions(
    sessionId: string,
    input: string,
    cursorPos: number,
    mode: SuggestionMode
  ): Promise<Suggestion[]>;

  /**
   * Subscribe to backend status changes
   */
  onBackendStatus(callback: (status: BackendStatus, error?: string) => void): UnsubscribeFn;

  /**
   * Ping the backend to check connectivity
   */
  ping(): Promise<string>;

  /**
   * Save workspace state to disk (fire-and-forget).
   */
  saveWorkspace(data: SavedWorkspace): void;

  /**
   * Load the last saved workspace state from disk.
   */
  loadWorkspace(): Promise<SavedWorkspace | null>;

  /**
   * Detect Python virtualenv / pyenv / conda and git branch + diff stats
   * for the given working directory. Runs in the main process.
   */
  getEnvInfo(cwd: string): Promise<EnvInfo>;
}

// Augment the Window interface
declare global {
  interface Window {
    terminalApi: TerminalApi;
  }
}
