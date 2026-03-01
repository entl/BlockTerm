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
}

export const BlockInput: React.FC<BlockInputProps> = ({
  currentPath,
  sessionId,
  onSubmit,
  placeholder = 'type a command…',
}) => {
  const [command, setCommand] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [inlineSuggestion, setInlineSuggestion] = useState<string | null>(null);
  
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // History navigation state
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const savedInputRef = useRef('');

  // Fetch suggestions from backend
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
          setSuggestions(results);
          setSelectedSuggestionIndex(0);
          setShowSuggestions(results.length > 0);
        } else {
          // For inline suggestion, show the best match's completion
          if (results.length > 0) {
            const bestMatch = results[0].text;
            // Only show inline if it starts with the current input
            if (bestMatch.toLowerCase().startsWith(input.toLowerCase()) && bestMatch !== input) {
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

  // Select a suggestion
  const selectSuggestion = useCallback((suggestion: Suggestion) => {
    setCommand(suggestion.text);
    setShowSuggestions(false);
    setSuggestions([]);
    setInlineSuggestion(null);
    inputRef.current?.focus();
  }, []);

  // Accept inline suggestion
  const acceptInlineSuggestion = useCallback(() => {
    if (inlineSuggestion) {
      setCommand(inlineSuggestion);
      setInlineSuggestion(null);
    }
  }, [inlineSuggestion]);

  const handleKeyDown = useCallback(
    async (e: React.KeyboardEvent<HTMLInputElement>) => {
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
      showSuggestions,
      suggestions,
      selectedSuggestionIndex,
      inlineSuggestion,
      loadHistory,
      fetchSuggestions,
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

  // Calculate ghost text (portion after what user typed)
  const ghostText = inlineSuggestion && inlineSuggestion.toLowerCase().startsWith(command.toLowerCase())
    ? inlineSuggestion.slice(command.length)
    : null;

  return (
    <div
      className="block-input-container"
      onClick={() => inputRef.current?.focus()}
    >
      <span className="block-input-path">{currentPath}</span>
      <span className="block-input-prompt">❯</span>
      <form onSubmit={handleSubmit} className="block-input-form">
        <div className="block-input-wrapper">
          <input
            ref={inputRef}
            type="text"
            value={command}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            placeholder={placeholder}
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
