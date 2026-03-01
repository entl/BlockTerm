/**
 * BlockInput – native terminal prompt row:
 *   <path>  ❯  <command input>
 *
 * Features:
 * - Up/Down arrow history navigation
 * - Tab autocompletion with dropdown
 * - Inline ghost text suggestion
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { SuggestionDropdown } from '../SuggestionDropdown';
import type { Suggestion } from '../../../shared/types';
import './BlockInput.css';

export interface BlockInputProps {
  currentPath: string;
  sessionId?: string | null;
  onSubmit?: (command: string) => void;
  placeholder?: string;
  /** When true a command is already running and input bypasses block creation. */
  isPassthrough?: boolean;
}

export const BlockInput: React.FC<BlockInputProps> = ({
  currentPath,
  sessionId,
  onSubmit,
  placeholder = 'type a command…',
  isPassthrough = false,
}) => {
  const [command, setCommand] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [inlineSuggestion, setInlineSuggestion] = useState<string | null>(null);
  /** Tracks what triggered the current dropdown so selection logic can adapt. */
  const [suggestionSource, setSuggestionSource] = useState<'tab' | 'history'>('tab');
  
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // History navigation state
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const savedInputRef = useRef('');

  // Fetch suggestions from backend.
  // Tab dropdown filters out history (filesystem + static only).
  // Inline ghost uses all sources.
  const fetchSuggestions = useCallback(
    async (input: string, forDropdown = false) => {
      if (!sessionId || !input.trim()) {
        setSuggestions([]);
        setInlineSuggestion(null);
        return;
      }

      try {
        const results = await window.terminalApi.getSuggestions(
          sessionId,
          input,
          input.length,
          forDropdown ? 'tab' : 'inline'
        );

        if (forDropdown) {
          // Tab dropdown: exclude history — only filesystem + static
          // (like a real terminal where Tab completes paths/commands)
          const filtered = results.filter((s) => s.source !== 'history');
          setSuggestionSource('tab');
          setSuggestions(filtered);
          setSelectedSuggestionIndex(0);
          setShowSuggestions(filtered.length > 0);
        } else {
          // For inline suggestion, show the best match's completion.
          // The backend returns suggestions for the last token only,
          // so compare against the current token, not the full command.
          if (results.length > 0) {
            const bestMatch = results[0].text;
            // Extract last token from input
            let tokenStart = input.length;
            while (tokenStart > 0 && input[tokenStart - 1] !== ' ' && input[tokenStart - 1] !== '\t') {
              tokenStart--;
            }
            const lastToken = input.slice(tokenStart);

            if (bestMatch.toLowerCase().startsWith(lastToken.toLowerCase()) && bestMatch !== lastToken) {
              setInlineSuggestion(bestMatch);
            } else {
              setInlineSuggestion(null);
            }
          } else {
            setInlineSuggestion(null);
          }
        }
      } catch (err) {
        console.warn('BlockInput: failed to fetch suggestions', err);
        if (forDropdown) {
          setSuggestions([]);
          setShowSuggestions(false);
        }
      }
    },
    [sessionId]
  );

  // Debounced inline suggestion fetching
  useEffect(() => {
    if (suggestionTimeoutRef.current) {
      clearTimeout(suggestionTimeoutRef.current);
    }

    if (command && !showSuggestions) {
      suggestionTimeoutRef.current = setTimeout(() => {
        fetchSuggestions(command, false);
      }, 150);
    } else if (!command) {
      setInlineSuggestion(null);
    }

    return () => {
      if (suggestionTimeoutRef.current) {
        clearTimeout(suggestionTimeoutRef.current);
      }
    };
  }, [command, fetchSuggestions, showSuggestions]);

  // Load history for arrow navigation
  const loadHistory = useCallback(async () => {
    try {
      const entries = await window.terminalApi.getHistory(200);
      const seen = new Set<string>();
      const deduped: string[] = [];
      for (const e of entries) {
        if (!seen.has(e.command)) {
          seen.add(e.command);
          deduped.push(e.command);
        }
      }
      historyRef.current = deduped;
    } catch (err) {
      console.warn('BlockInput: failed to load history', err);
    }
  }, []);

  // Fetch history suggestions for ArrowUp dropdown.
  // Uses getHistory with a prefix filter so matches are full-command based
  // (e.g., typing "cd" returns "cd Documents", "cd /usr/local", etc.).
  const fetchHistorySuggestions = useCallback(
    async (input: string) => {
      if (!input.trim()) return;

      try {
        const entries = await window.terminalApi.getHistory(50, input.trim());
        // Deduplicate and convert to Suggestion[]
        const seen = new Set<string>();
        const results: Suggestion[] = [];
        for (const e of entries) {
          const cmd = e.command;
          if (!seen.has(cmd) && cmd !== input.trim()) {
            seen.add(cmd);
            results.push({ text: cmd, source: 'history', score: 1 });
          }
        }

        setSuggestionSource('history');
        setSuggestions(results);
        setSelectedSuggestionIndex(0);
        setShowSuggestions(results.length > 0);
      } catch (err) {
        console.warn('BlockInput: failed to fetch history suggestions', err);
      }
    },
    []
  );

  // Select a suggestion.
  // History items replace the entire command line (they're full commands).
  // Tab items replace only the last token (filesystem/static completions).
  const selectSuggestion = useCallback((suggestion: Suggestion) => {
    if (suggestionSource === 'history') {
      // History: replace entire input with the selected command
      const newCommand = suggestion.text;
      setCommand(newCommand);
      setShowSuggestions(false);
      setSuggestions([]);
      setInlineSuggestion(null);
      inputRef.current?.focus();
      requestAnimationFrame(() => {
        inputRef.current?.setSelectionRange(newCommand.length, newCommand.length);
      });
    } else {
      // Tab (filesystem/static): replace only the token being completed
      const cursorPos = inputRef.current?.selectionStart ?? command.length;
      let start = cursorPos;
      while (start > 0 && command[start - 1] !== ' ' && command[start - 1] !== '\t') {
        start--;
      }

      const before = command.slice(0, start);
      const after = command.slice(cursorPos);

      const newCommand = before + suggestion.text + after;
      setCommand(newCommand);
      setShowSuggestions(false);
      setSuggestions([]);
      setInlineSuggestion(null);
      inputRef.current?.focus();

      requestAnimationFrame(() => {
        const pos = before.length + suggestion.text.length;
        inputRef.current?.setSelectionRange(pos, pos);
      });
    }
  }, [command, suggestionSource]);

  // Accept inline suggestion – replaces only the last token
  const acceptInlineSuggestion = useCallback(() => {
    if (inlineSuggestion) {
      let tokenStart = command.length;
      while (tokenStart > 0 && command[tokenStart - 1] !== ' ' && command[tokenStart - 1] !== '\t') {
        tokenStart--;
      }
      const before = command.slice(0, tokenStart);
      const newCommand = before + inlineSuggestion;
      setCommand(newCommand);
      setInlineSuggestion(null);
    }
  }, [inlineSuggestion, command]);

  const handleKeyDown = useCallback(
    async (e: React.KeyboardEvent<HTMLInputElement>) => {
      // Ctrl+C: clear input if non-empty, otherwise send interrupt to PTY.
      if (e.ctrlKey && e.key === 'c') {
        e.preventDefault();
        if (command) {
          // Discard whatever was typed — classic shell Ctrl+C behaviour.
          setCommand('');
          setInlineSuggestion(null);
          setShowSuggestions(false);
          setSuggestions([]);
          historyIndexRef.current = -1;
        } else if (sessionId) {
          // Empty input (or passthrough mode): send SIGINT to the running process.
          window.terminalApi.sendInput(sessionId, '\x03');
        }
        return;
      }

      // Handle suggestion dropdown navigation
      if (showSuggestions && suggestions.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedSuggestionIndex((prev) =>
            prev < suggestions.length - 1 ? prev + 1 : 0
          );
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedSuggestionIndex((prev) =>
            prev > 0 ? prev - 1 : suggestions.length - 1
          );
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          selectSuggestion(suggestions[selectedSuggestionIndex]);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setShowSuggestions(false);
          return;
        }
        if (e.key === 'Tab') {
          e.preventDefault();
          selectSuggestion(suggestions[selectedSuggestionIndex]);
          return;
        }
      }

      // Tab key: trigger autocomplete dropdown
      if (e.key === 'Tab' && !showSuggestions) {
        e.preventDefault();
        
        // Always fetch and show dropdown (Tab never accepts inline)
        if (command.trim()) {
          await fetchSuggestions(command, true);
        }
        return;
      }

      // Escape: close suggestions or clear inline
      if (e.key === 'Escape') {
        if (showSuggestions) {
          e.preventDefault();
          setShowSuggestions(false);
        } else if (inlineSuggestion) {
          e.preventDefault();
          setInlineSuggestion(null);
        }
        return;
      }

      // Right arrow at end: accept inline suggestion
      if (e.key === 'ArrowRight' && inlineSuggestion) {
        const input = inputRef.current;
        if (input && input.selectionStart === command.length) {
          e.preventDefault();
          acceptInlineSuggestion();
          return;
        }
      }

      // History navigation (when dropdown not showing)
      if (!showSuggestions) {
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (command.trim()) {
            // Non-empty input → show filtered history dropdown
            await fetchHistorySuggestions(command);
          } else {
            // Empty input → sequential history walk (classic shell behaviour)
            await loadHistory();
            if (historyRef.current.length === 0) return;
            if (historyIndexRef.current === -1) {
              savedInputRef.current = command;
            }
            const next = Math.min(
              historyIndexRef.current + 1,
              historyRef.current.length - 1
            );
            historyIndexRef.current = next;
            setCommand(historyRef.current[next]);
            setInlineSuggestion(null);
          }
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
          setInlineSuggestion(null);
        }
      }
    },
    [
      command,
      sessionId,
      showSuggestions,
      suggestions,
      selectedSuggestionIndex,
      inlineSuggestion,
      loadHistory,
      fetchSuggestions,
      fetchHistorySuggestions,
      selectSuggestion,
      acceptInlineSuggestion,
    ]
  );

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    historyIndexRef.current = -1;
    setCommand(e.target.value);
    setShowSuggestions(false); // Close dropdown on typing
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!command.trim() || !onSubmit) return;
      onSubmit(command.trim());
      setCommand('');
      historyIndexRef.current = -1;
      savedInputRef.current = '';
      setShowSuggestions(false);
      setSuggestions([]);
      setInlineSuggestion(null);
    },
    [command, onSubmit]
  );

  const handleBlur = useCallback(() => {
    // Delay hiding to allow click on suggestion
    setTimeout(() => {
      setShowSuggestions(false);
    }, 150);
  }, []);

  // Calculate ghost text – the inline suggestion completes the last token,
  // so the ghost is the portion of the suggestion after the current token.
  const ghostText = (() => {
    if (!inlineSuggestion) return null;
    let tokenStart = command.length;
    while (tokenStart > 0 && command[tokenStart - 1] !== ' ' && command[tokenStart - 1] !== '\t') {
      tokenStart--;
    }
    const lastToken = command.slice(tokenStart);
    if (inlineSuggestion.toLowerCase().startsWith(lastToken.toLowerCase()) && inlineSuggestion !== lastToken) {
      return inlineSuggestion.slice(lastToken.length);
    }
    return null;
  })();

  return (
    <div
      className="block-input-container"
      onClick={() => inputRef.current?.focus()}
    >
      {!isPassthrough && <span className="block-input-path">{currentPath}</span>}
      <span className="block-input-prompt">{isPassthrough ? '↳' : '❯'}</span>
      <form onSubmit={handleSubmit} className="block-input-form">
        <div className="block-input-wrapper">
          <input
            ref={inputRef}
            type="text"
            value={command}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            placeholder={isPassthrough ? 'respond to prompt…' : placeholder}
            className="block-input-field"
            autoFocus
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
          />
          {ghostText && (
            <span className="block-input-ghost">
              {command}
              <span className="ghost-text">{ghostText}</span>
            </span>
          )}
        </div>
        <SuggestionDropdown
          suggestions={suggestions}
          selectedIndex={selectedSuggestionIndex}
          onSelect={selectSuggestion}
          onClose={() => setShowSuggestions(false)}
          visible={showSuggestions}
        />
      </form>
    </div>
  );
};
