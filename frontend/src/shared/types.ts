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

// Split pane layout types
export type SplitDirection = 'horizontal' | 'vertical';

/** Leaf node – a single terminal pane. */
export interface SplitLeaf {
  type: 'leaf';
  id: string;           // unique pane id
  sessionId: string | null;
}

/** Branch node – two or more children laid out in a direction. */
export interface SplitBranch {
  type: 'branch';
  id: string;
  direction: SplitDirection;
  children: SplitNode[];
  /** Relative sizes for each child (sum = 1). */
  sizes: number[];
}

export type SplitNode = SplitLeaf | SplitBranch;

// ── Workspace persistence types ─────────────────────────────────────────────

/** A serialised block (command + output text). */
export interface SavedBlock {
  id: string;
  command: string;
  output: string;
  cwd: string;
  exitCode: number | null;
  timestamp: number;
  collapsed: boolean;
}

/** Persisted state of a single terminal pane. */
export interface SavedPane {
  id: string;
  cwd: string;
  blocks: SavedBlock[];
  terminalMode: 'plain' | 'block';
}

/** Serialised leaf node with pane data. */
export interface SavedSplitLeaf {
  type: 'leaf';
  id: string;
  pane: SavedPane;
}

/** Serialised branch node. */
export interface SavedSplitBranch {
  type: 'branch';
  id: string;
  direction: SplitDirection;
  children: SavedSplitNode[];
  sizes: number[];
}

export type SavedSplitNode = SavedSplitLeaf | SavedSplitBranch;

/** Serialised tab. */
export interface SavedTab {
  id: string;
  title: string;
  layout: SavedSplitNode;
  activePaneId: string;
}

/** Top-level persisted workspace. */
export interface SavedWorkspace {
  version: 1;
  activeTabId: string;
  tabs: SavedTab[];
  terminalModes: Record<string, 'plain' | 'block'>;
  savedAt: number;
}

// Unsubscribe function type
export type UnsubscribeFn = () => void;

// ── Environment detection types ─────────────────────────────────────────────

/** Git repository status for the current working directory. */
export interface GitInfo {
  /** Current branch name, or short SHA when in detached HEAD state. */
  branch: string;
  /** Lines added relative to HEAD (uncommitted changes). */
  added: number;
  /** Lines deleted relative to HEAD (uncommitted changes). */
  deleted: number;
}

/** Active Python environment detected from the filesystem. */
export interface PythonEnvInfo {
  /** Environment name, e.g. ".venv", "myenv", "3.11.0" */
  name: string;
  /** Environment manager that owns this environment. */
  type: 'venv' | 'conda' | 'pyenv' | 'system';
  /** Python version string, if detectable. */
  version?: string;
}

/** Combined environment context for the active terminal pane. */
export interface EnvInfo {
  git: GitInfo | null;
  python: PythonEnvInfo | null;
}

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
  
  // Workspace persistence
  SAVE_WORKSPACE: 'workspace:save',
  LOAD_WORKSPACE: 'workspace:load',

  // System
  PING: 'system:ping',
  GET_ENV_INFO: 'system:getEnvInfo',
} as const;

// Backend status
export type BackendStatus = 'starting' | 'ready' | 'error' | 'stopped';

export interface BackendStatusEvent {
  status: BackendStatus;
  error?: string;
}
