/**
 * SearchBar - search within block outputs
 * Supports searching in current block or across all blocks
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { X, ChevronUp, ChevronDown, Search } from 'lucide-react';
import './SearchBar.css';

export interface SearchMatch {
  blockId: string;
  area: 'command' | 'output';
  index: number;
  length: number;
  line: number;
  preview: string;
}

export interface SearchBarProps {
  visible: boolean;
  onClose: () => void;
  onSearch: (query: string, matchCase: boolean, regex: boolean) => SearchMatch[];
  totalMatches: number;
  currentMatchIndex: number;
  onNavigate: (direction: 'next' | 'prev') => void;
  scope: 'current' | 'all';
  onScopeChange: (scope: 'current' | 'all') => void;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  visible,
  onClose,
  onSearch,
  totalMatches,
  currentMatchIndex,
  onNavigate,
  scope,
  onScopeChange,
}) => {
  const [query, setQuery] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when visible
  useEffect(() => {
    if (visible) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [visible]);

  const handleSearch = useCallback(() => {
    if (query) {
      onSearch(query, matchCase, useRegex);
    }
  }, [query, matchCase, useRegex, onSearch]);

  // Trigger search on input change or scope change
  useEffect(() => {
    if (query) {
      handleSearch();
    }
  }, [query, matchCase, useRegex, scope, handleSearch]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        onNavigate('prev');
      } else {
        onNavigate('next');
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      onNavigate('next');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      onNavigate('prev');
    } else if (e.key === 'F3') {
      e.preventDefault();
      onNavigate(e.shiftKey ? 'prev' : 'next');
    }
  }, [onClose, onNavigate]);

  if (!visible) return null;

  return (
    <div className="search-bar">
      <div className="search-bar-icon">
        <Search className="w-4 h-4" />
      </div>
      
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Search in blocks..."
        className="search-bar-input"
      />

      {query && (
        <span className="search-bar-matches">
          {totalMatches > 0
            ? `${currentMatchIndex + 1} of ${totalMatches}`
            : 'No matches'}
        </span>
      )}

      <div className="search-bar-controls">
        <button
          className="search-bar-btn"
          onClick={() => setMatchCase(!matchCase)}
          title="Match case"
          data-active={matchCase}
        >
          Aa
        </button>
        
        <button
          className="search-bar-btn"
          onClick={() => setUseRegex(!useRegex)}
          title="Use regex"
          data-active={useRegex}
        >
          .*
        </button>

        {onScopeChange && (
          <select
            value={scope}
            onChange={(e) => onScopeChange(e.target.value as 'current' | 'all')}
            className="search-bar-scope"
            title="Search scope"
          >
            <option value="all">All blocks</option>
            <option value="current">Selected block</option>
          </select>
        )}

        <button
          className="search-bar-btn"
          onClick={() => onNavigate('prev')}
          title="Previous match (Shift+Enter)"
          disabled={totalMatches === 0}
        >
          <ChevronUp className="w-4 h-4" />
        </button>

        <button
          className="search-bar-btn"
          onClick={() => onNavigate('next')}
          title="Next match (Enter)"
          disabled={totalMatches === 0}
        >
          <ChevronDown className="w-4 h-4" />
        </button>

        <button
          className="search-bar-btn search-bar-close"
          onClick={onClose}
          title="Close (Esc)"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

export default SearchBar;
