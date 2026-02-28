/**
 * TabBar component for terminal tabs
 */

import { useState, useCallback } from 'react';
import type { TabState } from '../../hooks/useTerminal';
import './TabBar.css';

export interface TabBarProps {
  tabs: TabState[];
  activeTabId: string | null;
  onTabSelect: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onTabAdd: () => void;
  onTabRename?: (tabId: string, newTitle: string) => void;
}

export function TabBar({
  tabs,
  activeTabId,
  onTabSelect,
  onTabClose,
  onTabAdd,
  onTabRename,
}: TabBarProps) {
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const handleDoubleClick = useCallback(
    (tabId: string, currentTitle: string) => {
      if (onTabRename) {
        setEditingTabId(tabId);
        setEditValue(currentTitle);
      }
    },
    [onTabRename]
  );

  const handleEditSubmit = useCallback(
    (tabId: string) => {
      if (editValue.trim() && onTabRename) {
        onTabRename(tabId, editValue.trim());
      }
      setEditingTabId(null);
      setEditValue('');
    },
    [editValue, onTabRename]
  );

  const handleEditKeyDown = useCallback(
    (e: React.KeyboardEvent, tabId: string) => {
      if (e.key === 'Enter') {
        handleEditSubmit(tabId);
      } else if (e.key === 'Escape') {
        setEditingTabId(null);
        setEditValue('');
      }
    },
    [handleEditSubmit]
  );

  const handleCloseClick = useCallback(
    (e: React.MouseEvent, tabId: string) => {
      e.stopPropagation();
      onTabClose(tabId);
    },
    [onTabClose]
  );

  return (
    <div className="tab-bar">
      <div className="tab-bar-tabs">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`tab ${tab.id === activeTabId ? 'tab-active' : ''}`}
            onClick={() => onTabSelect(tab.id)}
            onDoubleClick={() => handleDoubleClick(tab.id, tab.title)}
          >
            <span className="tab-icon">
              <TerminalIcon />
            </span>
            {editingTabId === tab.id ? (
              <input
                type="text"
                className="tab-title-input"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={() => handleEditSubmit(tab.id)}
                onKeyDown={(e) => handleEditKeyDown(e, tab.id)}
                autoFocus
              />
            ) : (
              <span className="tab-title">{tab.title}</span>
            )}
            <button
              className="tab-close"
              onClick={(e) => handleCloseClick(e, tab.id)}
              title="Close tab"
            >
              <CloseIcon />
            </button>
          </div>
        ))}
      </div>
      <button className="tab-add" onClick={onTabAdd} title="New terminal">
        <PlusIcon />
      </button>
    </div>
  );
}

// Simple SVG icons
function TerminalIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="4,17 10,11 4,5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export default TabBar;
