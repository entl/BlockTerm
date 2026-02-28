/**
 * TerminalPane component - manages a terminal session and its UI
 * Supports both plain terminal and block terminal modes
 */

import { useRef, useEffect, useCallback, useState } from 'react';
import { Terminal, type TerminalRef } from '../Terminal';
import { BlockTerminal } from '../BlockTerminal';
import { Button } from '../ui/button';
import { useCommandBuffer } from '../../hooks';
import { Layout, Terminal as TerminalIcon } from 'lucide-react';
import './TerminalPane.css';

export interface TerminalPaneProps {
  tabId: string;
  sessionId: string | null;
  isActive: boolean;
  onSessionCreate: (tabId: string, sessionId: string) => void;
  onTitleChange?: (title: string) => void;
}

export function TerminalPane({
  tabId,
  sessionId,
  isActive,
  onSessionCreate,
  onTitleChange,
}: TerminalPaneProps) {
  const terminalRef = useRef<TerminalRef>(null);
  const [isCreating, setIsCreating] = useState(false);
  const hasCreatedSession = useRef(false);
  const commandBuffer = useCommandBuffer();
  
  // Terminal mode state
  const [terminalMode, setTerminalMode] = useState<'plain' | 'block'>('block');

  // Create session when pane becomes active and no session exists
  useEffect(() => {
    if (!sessionId && isActive && !isCreating && !hasCreatedSession.current) {
      const createSession = async () => {
        setIsCreating(true);
        hasCreatedSession.current = true;
        
        try {
          // Get terminal dimensions
          const term = terminalRef.current?.terminal;
          const cols = term?.cols ?? 80;
          const rows = term?.rows ?? 24;

          const newSessionId = await window.terminalApi.createSession({
            cols,
            rows,
          });
          
          onSessionCreate(tabId, newSessionId);
        } catch (err) {
          console.error('Failed to create session:', err);
          hasCreatedSession.current = false;
        } finally {
          setIsCreating(false);
        }
      };

      createSession();
    }
  }, [sessionId, isActive, isCreating, tabId, onSessionCreate]);

  // Reset flag when tabId changes
  useEffect(() => {
    hasCreatedSession.current = !!sessionId;
  }, [tabId, sessionId]);

  // Focus terminal when pane becomes active
  useEffect(() => {
    if (isActive && terminalMode === 'plain') {
      terminalRef.current?.focus();
    }
  }, [isActive, terminalMode]);
  
  // Toggle between terminal modes
  const toggleTerminalMode = useCallback(() => {
    setTerminalMode(prev => prev === 'plain' ? 'block' : 'plain');
  }, []);

  // Handle input from terminal
  const handleData = useCallback(
    (data: string) => {
      if (sessionId) {
        // Send raw input to PTY
        window.terminalApi.sendInput(sessionId, data);
        
        // Update command buffer for suggestions
        commandBuffer.processInput(data);
      }
    },
    [sessionId, commandBuffer]
  );

  // Handle Tab key for suggestions
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!sessionId) return;

    // Tab key for suggestions
    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const current = commandBuffer.getCurrent();
      
      // Trigger dropdown suggestions
      window.terminalApi.getSuggestions(
        sessionId,
        current.text,
        current.cursorPos,
        'dropdown'
      ).catch(err => console.error('Failed to get suggestions:', err));
    }
    
    // Ctrl/Cmd+Space for inline suggestions
    if ((e.ctrlKey || e.metaKey) && e.code === 'Space') {
      e.preventDefault();
      const current = commandBuffer.getCurrent();
      
      window.terminalApi.getSuggestions(
        sessionId,
        current.text,
        current.cursorPos,
        'inline'
      ).catch(err => console.error('Failed to get suggestions:', err));
    }
  }, [sessionId, commandBuffer]);

  // Attach keyboard listener to terminal
  useEffect(() => {
    const terminal = terminalRef.current?.terminal;
    if (terminal && isActive) {
      // xterm.js doesn't have a direct onKeyDown, so we listen to the container
      const element = terminal.element;
      if (element) {
        element.addEventListener('keydown', handleKeyDown);
        return () => element.removeEventListener('keydown', handleKeyDown);
      }
    }
  }, [isActive, handleKeyDown]);

  // Handle resize
  const handleResize = useCallback(
    (cols: number, rows: number) => {
      if (sessionId) {
        window.terminalApi.resizeSession(sessionId, cols, rows).catch((err) => {
          console.error('Failed to resize session:', err);
        });
      }
    },
    [sessionId]
  );

  // Handle title change from terminal escape sequences
  const handleTitleChange = useCallback(
    (title: string) => {
      onTitleChange?.(title);
    },
    [onTitleChange]
  );

  return (
    <div
      className={`terminal-pane ${isActive ? 'terminal-pane-active' : 'terminal-pane-hidden'}`}
    >
      {isCreating && (
        <div className="terminal-pane-loading">
          <span>Starting terminal...</span>
        </div>
      )}
      
      {/* Conditional rendering based on terminal mode */}
      {terminalMode === 'plain' ? (
        <Terminal
          ref={terminalRef}
          sessionId={sessionId}
          onData={handleData}
          onResize={handleResize}
          onTitleChange={handleTitleChange}
        />
      ) : (
        <BlockTerminal
          sessionId={sessionId}
          autoScroll={true}
          showInput={true}
        />
      )}
      
      {/* Mode toggle button - bottom right corner */}
      <Button
        variant="outline"
        size="icon"
        className="terminal-mode-toggle"
        onClick={toggleTerminalMode}
        aria-label={`Switch to ${terminalMode === 'plain' ? 'block' : 'plain'} terminal`}
        title={`Switch to ${terminalMode === 'plain' ? 'block' : 'plain'} terminal`}
      >
        {terminalMode === 'plain' ? <Layout className="w-4 h-4" /> : <TerminalIcon className="w-4 h-4" />}
      </Button>
    </div>
  );
}

export default TerminalPane;

