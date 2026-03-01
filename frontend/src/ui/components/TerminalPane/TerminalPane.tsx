/**
 * TerminalPane component - manages a terminal session and its UI
 * Supports both plain terminal and block terminal modes
 */

import { useRef, useEffect, useCallback, useState } from 'react';
import { Terminal, type TerminalRef } from '../Terminal';
import { BlockTerminal } from '../BlockTerminal';
import { useCommandBuffer } from '../../hooks';
import { getRestoredPaneData } from '../../services/workspaceStore';
import './TerminalPane.css';

export interface TerminalPaneProps {
  tabId: string;
  sessionId: string | null;
  isActive: boolean;
  /** Terminal display mode controlled by the parent (tab context menu). */
  terminalMode?: 'plain' | 'block';
  onSessionCreate: (tabId: string, sessionId: string) => void;
  onTitleChange?: (title: string) => void;
}

export function TerminalPane({
  tabId,
  sessionId,
  isActive,
  terminalMode = 'block',
  onSessionCreate,
  onTitleChange,
}: TerminalPaneProps) {
  const terminalRef = useRef<TerminalRef>(null);
  const [isCreating, setIsCreating] = useState(false);
  const hasCreatedSession = useRef(false);
  const commandBuffer = useCommandBuffer();

  // Create session when pane mounts and no session exists.
  // In a split layout every visible pane needs its own session,
  // regardless of which pane is currently focused.
  useEffect(() => {
    if (!sessionId && !isCreating && !hasCreatedSession.current) {
      const createSession = async () => {
        setIsCreating(true);
        hasCreatedSession.current = true;
        
        try {
          // Get terminal dimensions
          const term = terminalRef.current?.terminal;
          const cols = term?.cols ?? 80;
          const rows = term?.rows ?? 24;

          // Use restored cwd if this pane is being restored from a saved workspace
          const restoredData = getRestoredPaneData(tabId);

          const newSessionId = await window.terminalApi.createSession({
            cols,
            rows,
            cwd: restoredData?.cwd,
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
  }, [sessionId, isCreating, tabId, onSessionCreate]);

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

  // Re-fit xterm when pane becomes active (e.g. after tab switch).
  // display:none→block causes the container size to change from 0 to actual,
  // and xterm needs to recalculate its dimensions.
  useEffect(() => {
    if (isActive) {
      requestAnimationFrame(() => terminalRef.current?.fit());
    }
  }, [isActive]);

  // Re-fit xterm when switching to plain mode
  useEffect(() => {
    if (terminalMode === 'plain') {
      requestAnimationFrame(() => terminalRef.current?.fit());
    }
  }, [terminalMode]);

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
      className={`terminal-pane terminal-pane-active`}
    >
      {isCreating && (
        <div className="terminal-pane-loading">
          <span>Starting terminal...</span>
        </div>
      )}
      
      {/* Both views are always mounted so they share the same session and
          keep their internal state.  CSS toggles which one is visible. */}
      <div className={`terminal-pane-view${terminalMode === 'plain' ? ' terminal-pane-view--visible' : ''}`}>
        <Terminal
          ref={terminalRef}
          sessionId={sessionId}
          onData={handleData}
          onResize={handleResize}
          onTitleChange={handleTitleChange}
        />
      </div>
      <div className={`terminal-pane-view${terminalMode === 'block' ? ' terminal-pane-view--visible' : ''}`}>
        <BlockTerminal
          paneId={tabId}
          sessionId={sessionId}
          autoScroll={true}
          showInput={true}
        />
      </div>
    </div>
  );
}

export default TerminalPane;
