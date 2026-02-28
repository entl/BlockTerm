/**
 * BlockInput – native terminal prompt row:
 *   <path>  ❯  <command input>
 *
 * Supports Up/Down arrow history navigation:
 *   - ArrowUp   cycles backward through recent commands (oldest-first from API,
 *               so we reverse the list to get newest-first)
 *   - ArrowDown cycles forward; reaching the end restores the in-progress input
 */

import React, { useState, useRef, useCallback } from 'react';
import './BlockInput.css';

export interface BlockInputProps {
  currentPath: string;
  sessionId?: string | null;
  onSubmit?: (command: string) => void;
  placeholder?: string;
}

export const BlockInput: React.FC<BlockInputProps> = ({
  currentPath,
  sessionId,
  onSubmit,
  placeholder = 'type a command…',
}) => {
  const [command, setCommand] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // History navigation state
  const historyRef = useRef<string[]>([]); // newest-first
  const historyIndexRef = useRef(-1);      // -1 = not navigating
  const savedInputRef = useRef('');        // saves in-progress input while navigating

  // Always fetch fresh history on ArrowUp — do not cache between keystrokes.
  // Caching caused a race: refreshing right after submit fetched before
  // recordCommand reached SQLite, permanently hiding the last command.
  const loadHistory = useCallback(async () => {
    try {
      const entries = await window.terminalApi.getHistory(200);
      // Deduplicate consecutive identical commands for cleaner cycling.
      const seen = new Set<string>();
      const deduped: string[] = [];
      for (const e of entries) {
        if (!seen.has(e.command)) {
          seen.add(e.command);
          deduped.push(e.command);
        }
      }
      historyRef.current = deduped; // newest-first
    } catch (err) {
      console.warn('BlockInput: failed to load history', err);
    }
  }, []);

  const handleKeyDown = useCallback(
    async (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        await loadHistory();
        if (historyRef.current.length === 0) return;
        if (historyIndexRef.current === -1) {
          // Start navigating — save whatever the user had typed
          savedInputRef.current = command;
        }
        const next = Math.min(
          historyIndexRef.current + 1,
          historyRef.current.length - 1,
        );
        historyIndexRef.current = next;
        setCommand(historyRef.current[next]);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (historyIndexRef.current === -1) return;
        const next = historyIndexRef.current - 1;
        if (next < 0) {
          historyIndexRef.current = -1;
          setCommand(savedInputRef.current);
        } else {
          historyIndexRef.current = next;
          setCommand(historyRef.current[next]);
        }
      }
    },
    [command, loadHistory],
  );

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    // Any manual edit cancels history navigation
    historyIndexRef.current = -1;
    setCommand(e.target.value);
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!command.trim() || !onSubmit) return;
      onSubmit(command.trim());
      setCommand('');
      historyIndexRef.current = -1;
      savedInputRef.current = '';
      // Do NOT pre-fetch history here: recordCommand hasn't reached SQLite yet.
      // The next ArrowUp will always fetch fresh data.
    },
    [command, onSubmit],
  );

  return (
    <div
      className="block-input-container"
      onClick={() => inputRef.current?.focus()}
    >
      <span className="block-input-path">{currentPath}</span>
      <span className="block-input-prompt">❯</span>
      <form onSubmit={handleSubmit} className="block-input-form">
        <input
          ref={inputRef}
          type="text"
          value={command}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="block-input-field"
          autoFocus
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
        />
      </form>
    </div>
  );
};
