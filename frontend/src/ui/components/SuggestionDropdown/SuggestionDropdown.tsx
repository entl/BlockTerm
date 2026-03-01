/**
 * SuggestionDropdown - displays autocomplete suggestions in a dropdown menu.
 * Supports keyboard navigation (ArrowUp, ArrowDown, Enter, Escape).
 */

import React, { useEffect, useRef, useCallback } from 'react';
import type { Suggestion } from '../../../shared/types';
import './SuggestionDropdown.css';

export interface SuggestionDropdownProps {
  suggestions: Suggestion[];
  selectedIndex: number;
  onSelect: (suggestion: Suggestion) => void;
  onClose: () => void;
  visible: boolean;
}

export const SuggestionDropdown: React.FC<SuggestionDropdownProps> = ({
  suggestions,
  selectedIndex,
  onSelect,
  onClose,
  visible,
}) => {
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Scroll selected item into view
  useEffect(() => {
    if (visible && itemRefs.current[selectedIndex]) {
      itemRefs.current[selectedIndex]?.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      });
    }
  }, [selectedIndex, visible]);

  const handleClick = useCallback(
    (e: React.MouseEvent, suggestion: Suggestion) => {
      e.preventDefault();
      e.stopPropagation();
      onSelect(suggestion);
    },
    [onSelect]
  );

  // Map source to display icon/badge
  const getSourceIcon = (source: string) => {
    switch (source) {
      case 'history':
        return '⏱';
      case 'filesystem':
        return '📁';
      case 'static':
        return '⌘';
      case 'ai':
        return '✨';
      default:
        return '•';
    }
  };

  const getSourceLabel = (source: string) => {
    switch (source) {
      case 'history':
        return 'History';
      case 'filesystem':
        return 'File';
      case 'static':
        return 'Command';
      case 'ai':
        return 'AI';
      default:
        return source;
    }
  };

  if (!visible || suggestions.length === 0) {
    return null;
  }

  return (
    <div className="suggestion-dropdown" ref={listRef}>
      {suggestions.map((suggestion, index) => (
        <div
          key={`${suggestion.text}-${index}`}
          ref={(el) => (itemRefs.current[index] = el)}
          className={`suggestion-item ${index === selectedIndex ? 'selected' : ''}`}
          onClick={(e) => handleClick(e, suggestion)}
          onMouseDown={(e) => e.preventDefault()} // Prevent input blur
        >
          <span className="suggestion-icon" title={getSourceLabel(suggestion.source)}>
            {getSourceIcon(suggestion.source)}
          </span>
          <span className="suggestion-text">{suggestion.text}</span>
          <span className={`suggestion-source source-${suggestion.source}`}>
            {getSourceLabel(suggestion.source)}
          </span>
        </div>
      ))}
      <div className="suggestion-hint">
        <span>↑↓ navigate</span>
        <span>Enter select</span>
        <span>Esc close</span>
      </div>
    </div>
  );
};

export default SuggestionDropdown;
