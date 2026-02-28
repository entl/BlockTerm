/**
 * Terminal component - wraps xterm.js with React
 */

import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import './Terminal.css';

export interface TerminalProps {
  sessionId: string | null;
  onData?: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
  onTitleChange?: (title: string) => void;
  fontSize?: number;
  fontFamily?: string;
  theme?: TerminalTheme;
}

export interface TerminalTheme {
  background?: string;
  foreground?: string;
  cursor?: string;
  cursorAccent?: string;
  selectionBackground?: string;
  selectionForeground?: string;
  black?: string;
  red?: string;
  green?: string;
  yellow?: string;
  blue?: string;
  magenta?: string;
  cyan?: string;
  white?: string;
  brightBlack?: string;
  brightRed?: string;
  brightGreen?: string;
  brightYellow?: string;
  brightBlue?: string;
  brightMagenta?: string;
  brightCyan?: string;
  brightWhite?: string;
}

export interface TerminalRef {
  terminal: XTerm | null;
  fit: () => void;
  write: (data: string | Uint8Array) => void;
  clear: () => void;
  focus: () => void;
  search: (term: string, options?: { regex?: boolean; caseSensitive?: boolean }) => boolean;
  findNext: () => boolean;
  findPrevious: () => boolean;
}

const defaultTheme: TerminalTheme = {
  background: '#1e1e1e',
  foreground: '#d4d4d4',
  cursor: '#ffffff',
  cursorAccent: '#000000',
  selectionBackground: '#264f78',
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#ffffff',
};

export const Terminal = forwardRef<TerminalRef, TerminalProps>(function Terminal(
  {
    sessionId,
    onData,
    onResize,
    onTitleChange,
    fontSize = 14,
    fontFamily = "'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, Monaco, 'Courier New', monospace",
    theme = defaultTheme,
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  // Store callbacks in refs to avoid recreating terminal on callback changes
  const onDataRef = useRef(onData);
  const onResizeRef = useRef(onResize);
  const onTitleChangeRef = useRef(onTitleChange);

  useEffect(() => {
    onDataRef.current = onData;
    onResizeRef.current = onResize;
    onTitleChangeRef.current = onTitleChange;
  }, [onData, onResize, onTitleChange]);

  // Initialize terminal
  useEffect(() => {
    if (!containerRef.current) return;

    // Create terminal instance
    const terminal = new XTerm({
      fontSize,
      fontFamily,
      theme,
      allowProposedApi: true,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 10000,
      convertEol: false,
    });

    // Create and load addons
    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    const unicode11Addon = new Unicode11Addon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(searchAddon);
    terminal.loadAddon(unicode11Addon);
    terminal.unicode.activeVersion = '11';

    // Open terminal in container
    terminal.open(containerRef.current);

    // Try to load WebGL addon for better performance
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
      });
      terminal.loadAddon(webglAddon);
    } catch (e) {
      console.warn('WebGL addon failed to load:', e);
    }

    // Initial fit
    fitAddon.fit();

    // Store refs
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;

    // Set up event handlers
    terminal.onData((data) => {
      onDataRef.current?.(data);
    });

    terminal.onResize(({ cols, rows }) => {
      onResizeRef.current?.(cols, rows);
    });

    terminal.onTitleChange((title) => {
      onTitleChangeRef.current?.(title);
    });

    // Set up resize observer
    const resizeObserver = new ResizeObserver(() => {
      // Debounce fit calls
      requestAnimationFrame(() => {
        if (fitAddonRef.current && terminalRef.current) {
          fitAddonRef.current.fit();
        }
      });
    });
    resizeObserver.observe(containerRef.current);
    resizeObserverRef.current = resizeObserver;

    // Focus terminal
    terminal.focus();

    // Cleanup
    return () => {
      resizeObserver.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      searchAddonRef.current = null;
    };
  }, []); // Only run once on mount

  // Update theme
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = theme;
    }
  }, [theme]);

  // Update font settings
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.fontSize = fontSize;
      terminalRef.current.options.fontFamily = fontFamily;
      fitAddonRef.current?.fit();
    }
  }, [fontSize, fontFamily]);

  // Subscribe to session output
  useEffect(() => {
    if (!sessionId) return;

    const unsubscribe = window.terminalApi.onOutput(sessionId, (data) => {
      if (terminalRef.current) {
        terminalRef.current.write(data);
      }
    });

    return unsubscribe;
  }, [sessionId]);

  // Expose imperative methods
  const fit = useCallback(() => {
    fitAddonRef.current?.fit();
  }, []);

  const write = useCallback((data: string | Uint8Array) => {
    terminalRef.current?.write(data);
  }, []);

  const clear = useCallback(() => {
    terminalRef.current?.clear();
  }, []);

  const focus = useCallback(() => {
    terminalRef.current?.focus();
  }, []);

  const search = useCallback(
    (term: string, options?: { regex?: boolean; caseSensitive?: boolean }) => {
      if (!searchAddonRef.current) return false;
      return searchAddonRef.current.findNext(term, {
        regex: options?.regex,
        caseSensitive: options?.caseSensitive,
      });
    },
    []
  );

  const findNext = useCallback(() => {
    return searchAddonRef.current?.findNext('') ?? false;
  }, []);

  const findPrevious = useCallback(() => {
    return searchAddonRef.current?.findPrevious('') ?? false;
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      terminal: terminalRef.current,
      fit,
      write,
      clear,
      focus,
      search,
      findNext,
      findPrevious,
    }),
    [fit, write, clear, focus, search, findNext, findPrevious]
  );

  return <div ref={containerRef} className="terminal-container" />;
});

export default Terminal;
