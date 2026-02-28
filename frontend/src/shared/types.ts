/**
 * Shared types for IPC communication between Electron main and renderer
 */

// Session types
export interface Session {
  id: string;
  shell: string;
  cwd: string;
  cols: number;
  rows: number;
  createdAt: number;
  state: 'active' | 'closed';
}

export interface CreateSessionOptions {
  shell?: string;
  cwd?: string;
  cols: number;
  rows: number;
  env?: Record<string, string>;
}

// History types
export interface HistoryEntry {
  id: string;
  sessionId: string;
  command: string;
  cwd: string;
  exitCode: number | null;
  timestamp: number;
}

// Suggestion types
export type SuggestionSource = 'history' | 'filesystem' | 'static' | 'ai';

export interface Suggestion {
  text: string;
  source: SuggestionSource;
  score: number;
}

export type SuggestionMode = 'inline' | 'tab' | 'dropdown';

// Block types (command/output grouping)
export interface Block {
  id: string;
  sessionId: string;
  command: string;
  cwd: string;          // working directory at the time the command was run
  startOffset: number;
  endOffset: number | null;
  exitCode: number | null;
  timestamp: number;
  collapsed: boolean;
}

export interface BlockEvent {
  type: 'command-start' | 'command-end' | 'prompt-detected';
  sessionId: string;
  command?: string;
  exitCode?: number;
  timestamp: number;
}

// Output chunk with optional metadata
export interface OutputData {
  sessionId: string;
  data: Uint8Array;
  blockEvent?: BlockEvent;
}

// Tab types
export interface Tab {
  id: string;
  sessionId: string;
  title: string;
  isActive: boolean;
}

// Layout types for workspace restore
export interface WorkspaceLayout {
  tabs: Array<{
    id: string;
    title: string;
    sessionConfig: {
      shell?: string;
      cwd?: string;
    };
  }>;
  activeTabId: string;
}

// Unsubscribe function type
export type UnsubscribeFn = () => void;

// IPC Channel names
export const IPC_CHANNELS = {
  // Session management
  CREATE_SESSION: 'terminal:createSession',
  CLOSE_SESSION: 'terminal:closeSession',
  SEND_INPUT: 'terminal:sendInput',
  RESIZE_SESSION: 'terminal:resizeSession',
  
  // Output streaming
  ON_OUTPUT: 'terminal:onOutput',
  OUTPUT_DATA: 'terminal:outputData',
  
  // History
  GET_HISTORY: 'terminal:getHistory',
  
  // Suggestions
  GET_SUGGESTIONS: 'terminal:getSuggestions',
  
  // Backend status
  BACKEND_STATUS: 'backend:status',
  BACKEND_READY: 'backend:ready',
  
  // System
  PING: 'system:ping',
} as const;

// Backend status
export type BackendStatus = 'starting' | 'ready' | 'error' | 'stopped';

export interface BackendStatusEvent {
  status: BackendStatus;
  error?: string;
}
