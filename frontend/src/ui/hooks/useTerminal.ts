/**
 * React hooks for terminal session management
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { BackendStatus, HistoryEntry, Suggestion, SuggestionMode } from '../../shared/types';

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
 * Hook for managing multiple terminal tabs
 */
export interface TabState {
  id: string;
  title: string;
  sessionId: string | null;
}

export function useTerminalTabs() {
  const [tabs, setTabs] = useState<TabState[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  const addTab = useCallback((title: string = 'Terminal') => {
    const id = crypto.randomUUID();
    const newTab: TabState = {
      id,
      title,
      sessionId: null,
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(id);
    return id;
  }, []);

  const removeTab = useCallback((tabId: string) => {
    setTabs(prev => {
      const filtered = prev.filter(t => t.id !== tabId);
      // If we removed the active tab, activate another
      if (activeTabId === tabId && filtered.length > 0) {
        setActiveTabId(filtered[filtered.length - 1].id);
      } else if (filtered.length === 0) {
        setActiveTabId(null);
      }
      return filtered;
    });
  }, [activeTabId]);

  const updateTab = useCallback((tabId: string, updates: Partial<TabState>) => {
    setTabs(prev => prev.map(t => (t.id === tabId ? { ...t, ...updates } : t)));
  }, []);

  const getActiveTab = useCallback(() => {
    return tabs.find(t => t.id === activeTabId) || null;
  }, [tabs, activeTabId]);

  return {
    tabs,
    activeTabId,
    activeTab: getActiveTab(),
    addTab,
    removeTab,
    updateTab,
    setActiveTabId,
  };
}
