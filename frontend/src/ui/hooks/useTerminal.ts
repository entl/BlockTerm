/**
 * React hooks for terminal session management
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  BackendStatus,
  HistoryEntry,
  Suggestion,
  SuggestionMode,
  SplitNode,
  SplitBranch,
  SplitDirection,
} from '../../shared/types';

/**
 * Hook for tracking backend connection status
 */
export function useBackendStatus() {
  const [status, setStatus] = useState<BackendStatus>('starting');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = window.terminalApi.onBackendStatus((newStatus, err) => {
      setStatus(newStatus);
      setError(err || null);
    });

    return unsubscribe;
  }, []);

  return { status, error, isReady: status === 'ready' };
}

/**
 * Hook for managing a terminal session
 */
export interface UseTerminalSessionOptions {
  shell?: string;
  cwd?: string;
  cols?: number;
  rows?: number;
  autoCreate?: boolean;
}

export interface TerminalSession {
  sessionId: string | null;
  isConnecting: boolean;
  error: string | null;
  create: (cols: number, rows: number) => Promise<string>;
  sendInput: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  close: () => void;
}

export function useTerminalSession(options: UseTerminalSessionOptions = {}): TerminalSession {
  const { shell, cwd } = options;
  
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Track if we've created a session to avoid duplicates
  const hasCreated = useRef(false);

  const create = useCallback(async (cols: number, rows: number): Promise<string> => {
    if (sessionId) {
      return sessionId;
    }
    
    setIsConnecting(true);
    setError(null);
    
    try {
      const newSessionId = await window.terminalApi.createSession({
        shell,
        cwd,
        cols,
        rows,
      });
      setSessionId(newSessionId);
      hasCreated.current = true;
      return newSessionId;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create session';
      setError(message);
      throw err;
    } finally {
      setIsConnecting(false);
    }
  }, [sessionId, shell, cwd]);

  const sendInput = useCallback((data: string) => {
    if (sessionId) {
      window.terminalApi.sendInput(sessionId, data);
    }
  }, [sessionId]);

  const resize = useCallback((cols: number, rows: number) => {
    if (sessionId) {
      window.terminalApi.resizeSession(sessionId, cols, rows).catch(err => {
        console.error('Resize failed:', err);
      });
    }
  }, [sessionId]);

  const close = useCallback(() => {
    if (sessionId) {
      window.terminalApi.closeSession(sessionId).catch(err => {
        console.error('Close session failed:', err);
      });
      setSessionId(null);
      hasCreated.current = false;
    }
  }, [sessionId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (sessionId) {
        window.terminalApi.closeSession(sessionId).catch(() => {});
      }
    };
  }, [sessionId]);

  return {
    sessionId,
    isConnecting,
    error,
    create,
    sendInput,
    resize,
    close,
  };
}

/**
 * Hook for subscribing to terminal output
 */
export function useTerminalOutput(
  sessionId: string | null,
  onData: (data: Uint8Array) => void
) {
  const callbackRef = useRef(onData);
  callbackRef.current = onData;

  useEffect(() => {
    if (!sessionId) return;

    const unsubscribe = window.terminalApi.onOutput(sessionId, (data) => {
      callbackRef.current(data);
    });

    return unsubscribe;
  }, [sessionId]);
}

/**
 * Hook for command history
 */
export function useHistory(limit: number = 100) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async (filter?: string) => {
    setIsLoading(true);
    try {
      const results = await window.terminalApi.getHistory(limit, filter);
      setEntries(results);
    } catch (err) {
      console.error('Failed to fetch history:', err);
    } finally {
      setIsLoading(false);
    }
  }, [limit]);

  return { entries, isLoading, refresh };
}

/**
 * Hook for autocomplete suggestions
 */
export function useSuggestions(sessionId: string | null) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  
  // Debounce timer
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetch = useCallback(
    async (input: string, cursorPos: number, mode: SuggestionMode = 'inline') => {
      if (!sessionId || !input.trim()) {
        setSuggestions([]);
        return;
      }

      // Clear previous timer
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      // Debounce fetch
      timerRef.current = setTimeout(async () => {
        setIsLoading(true);
        try {
          const results = await window.terminalApi.getSuggestions(
            sessionId,
            input,
            cursorPos,
            mode
          );
          setSuggestions(results);
        } catch (err) {
          console.error('Failed to fetch suggestions:', err);
          setSuggestions([]);
        } finally {
          setIsLoading(false);
        }
      }, 100);
    },
    [sessionId]
  );

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    setSuggestions([]);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return { suggestions, isLoading, fetch, clear };
}

/**
 * Hook for managing multiple terminal tabs with split-pane layouts.
 *
 * Each tab owns a SplitNode tree.  Leaves are individual panes; branches
 * represent horizontal or vertical splits.
 */
export interface TabState {
  id: string;
  title: string;
  /** Root of the split layout tree for this tab. */
  layout: SplitNode;
  /** Currently focused pane id within this tab. */
  activePaneId: string;
}

/* ── Tree helpers (pure) ──────────────────────────────────────────────── */

/** Create a fresh leaf node. */
function makeLeaf(): { id: string; node: import('../../shared/types').SplitLeaf } {
  const id = crypto.randomUUID();
  return { id, node: { type: 'leaf', id, sessionId: null } };
}

/** Depth-first map: apply `fn` to every node and return a new tree. */
function mapTree(node: SplitNode, fn: (n: SplitNode) => SplitNode): SplitNode {
  const mapped = fn(node);
  if (mapped.type === 'branch') {
    return { ...mapped, children: mapped.children.map(c => mapTree(c, fn)) };
  }
  return mapped;
}

/** Find a node by id. */
function findNode(node: SplitNode, id: string): SplitNode | null {
  if (node.id === id) return node;
  if (node.type === 'branch') {
    for (const child of node.children) {
      const found = findNode(child, id);
      if (found) return found;
    }
  }
  return null;
}

/** Collect all leaf ids in the tree. */
function leafIds(node: SplitNode): string[] {
  if (node.type === 'leaf') return [node.id];
  return node.children.flatMap(leafIds);
}

/** Replace the subtree whose root has `targetId` with `replacement`. */
function replaceNode(
  root: SplitNode,
  targetId: string,
  replacement: SplitNode,
): SplitNode {
  if (root.id === targetId) return replacement;
  if (root.type === 'branch') {
    return {
      ...root,
      children: root.children.map(c => replaceNode(c, targetId, replacement)),
    };
  }
  return root;
}

/** Remove a leaf and simplify the tree (collapse single-child branches). */
function removeLeaf(root: SplitNode, leafId: string): SplitNode | null {
  if (root.type === 'leaf') {
    return root.id === leafId ? null : root;
  }

  const newChildren: SplitNode[] = [];
  const newSizes: number[] = [];
  const branch = root as SplitBranch;

  for (let i = 0; i < branch.children.length; i++) {
    const result = removeLeaf(branch.children[i], leafId);
    if (result !== null) {
      newChildren.push(result);
      newSizes.push(branch.sizes[i]);
    }
  }

  if (newChildren.length === 0) return null;
  if (newChildren.length === 1) return newChildren[0]; // collapse

  // Re-normalise sizes so they sum to 1
  const total = newSizes.reduce((a, b) => a + b, 0);
  const normSizes = newSizes.map(s => s / total);

  return { ...branch, children: newChildren, sizes: normSizes };
}

/* ── Hook ─────────────────────────────────────────────────────────────── */

export function useTerminalTabs() {
  const [tabs, setTabs] = useState<TabState[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  /* ── Tab-level actions ──────────────────────────────────────────────── */

  const addTab = useCallback((title: string = 'Terminal') => {
    const tabId = crypto.randomUUID();
    const leaf = makeLeaf();
    const newTab: TabState = {
      id: tabId,
      title,
      layout: leaf.node,
      activePaneId: leaf.id,
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(tabId);
    return tabId;
  }, []);

  const removeTab = useCallback((tabId: string) => {
    setTabs(prev => {
      const filtered = prev.filter(t => t.id !== tabId);
      if (activeTabId === tabId && filtered.length > 0) {
        setActiveTabId(filtered[filtered.length - 1].id);
      } else if (filtered.length === 0) {
        setActiveTabId(null);
      }
      return filtered;
    });
  }, [activeTabId]);

  const updateTab = useCallback((tabId: string, updates: Partial<Omit<TabState, 'id'>>) => {
    setTabs(prev => prev.map(t => (t.id === tabId ? { ...t, ...updates } : t)));
  }, []);

  /* ── Pane-level actions ─────────────────────────────────────────────── */

  /** Assign a session id to a leaf pane. */
  const setPaneSession = useCallback((paneId: string, sessionId: string) => {
    setTabs(prev =>
      prev.map(tab => {
        const node = findNode(tab.layout, paneId);
        if (!node) return tab;
        const newLayout = mapTree(tab.layout, n =>
          n.id === paneId && n.type === 'leaf' ? { ...n, sessionId } : n,
        );
        return { ...tab, layout: newLayout };
      }),
    );
  }, []);

  /** Set the focused pane within a tab. */
  const setActivePaneId = useCallback((paneId: string) => {
    setTabs(prev =>
      prev.map(tab => {
        if (findNode(tab.layout, paneId)) {
          return { ...tab, activePaneId: paneId };
        }
        return tab;
      }),
    );
  }, []);

  /** Split a leaf pane in the given direction. Returns the new pane id. */
  const splitPane = useCallback(
    (paneId: string, direction: SplitDirection): string | null => {
      let newPaneId: string | null = null;

      setTabs(prev =>
        prev.map(tab => {
          const target = findNode(tab.layout, paneId);
          if (!target || target.type !== 'leaf') return tab;

          const newLeaf = makeLeaf();
          newPaneId = newLeaf.id;

          const branch: SplitBranch = {
            type: 'branch',
            id: crypto.randomUUID(),
            direction,
            children: [target, newLeaf.node],
            sizes: [0.5, 0.5],
          };

          const newLayout = replaceNode(tab.layout, paneId, branch);
          return { ...tab, layout: newLayout, activePaneId: newLeaf.id };
        }),
      );

      return newPaneId;
    },
    [],
  );

  /** Close a leaf pane (and its session). */
  const closePane = useCallback(
    (paneId: string) => {
      setTabs(prev => {
        return prev.map(tab => {
          const node = findNode(tab.layout, paneId);
          if (!node) return tab;

          // Close the session if it has one
          if (node.type === 'leaf' && node.sessionId) {
            window.terminalApi.closeSession(node.sessionId).catch(console.error);
          }

          const newLayout = removeLeaf(tab.layout, paneId);

          // If the entire tab is now empty, keep the tab but add a new leaf
          if (!newLayout) {
            const leaf = makeLeaf();
            return { ...tab, layout: leaf.node, activePaneId: leaf.id };
          }

          // If the closed pane was active, pick another leaf
          const leaves = leafIds(newLayout);
          const newActive = leaves.includes(tab.activePaneId)
            ? tab.activePaneId
            : leaves[0];

          return { ...tab, layout: newLayout, activePaneId: newActive };
        });
      });
    },
    [],
  );

  /** Update branch sizes after a resize drag. */
  const resizeBranch = useCallback((branchId: string, sizes: number[]) => {
    setTabs(prev =>
      prev.map(tab => {
        const node = findNode(tab.layout, branchId);
        if (!node || node.type !== 'branch') return tab;
        const newLayout = mapTree(tab.layout, n =>
          n.id === branchId && n.type === 'branch' ? { ...n, sizes } : n,
        );
        return { ...tab, layout: newLayout };
      }),
    );
  }, []);

  /* ── Derived ────────────────────────────────────────────────────────── */

  const getActiveTab = useCallback(() => {
    return tabs.find(t => t.id === activeTabId) || null;
  }, [tabs, activeTabId]);

  /** Get session ids for all leaves in a tab (for cleanup). */
  const getTabSessionIds = useCallback(
    (tabId: string): string[] => {
      const tab = tabs.find(t => t.id === tabId);
      if (!tab) return [];
      const collectSessions = (node: SplitNode): string[] => {
        if (node.type === 'leaf') return node.sessionId ? [node.sessionId] : [];
        return node.children.flatMap(collectSessions);
      };
      return collectSessions(tab.layout);
    },
    [tabs],
  );

  return {
    tabs,
    activeTabId,
    activeTab: getActiveTab(),
    addTab,
    removeTab,
    updateTab,
    setActiveTabId,
    // Split-pane actions
    setPaneSession,
    setActivePaneId,
    splitPane,
    closePane,
    resizeBranch,
    getTabSessionIds,
  };
}
