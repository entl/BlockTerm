/**
 * TabBar component for terminal tabs with right-click context menu.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { TabState } from '../../hooks/useTerminal';
import './TabBar.css';

export interface TabBarProps {
  tabs: TabState[];
  activeTabId: string | null;
  onTabSelect: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onTabAdd: () => void;
  onTabRename?: (tabId: string, newTitle: string) => void;
  /** Split the active pane right (horizontal). */
  onSplitRight?: (tabId: string) => void;
  /** Split the active pane down (vertical). */
  onSplitDown?: (tabId: string) => void;
  /** Close the active pane within a tab. */
  onClosePane?: (tabId: string) => void;
  /** Toggle between plain / block terminal for the active pane. */
  onToggleTerminalMode?: (tabId: string) => void;
  /** Current terminal mode per tab (used to label the toggle). */
  terminalModes?: Record<string, 'plain' | 'block'>;
  /** Whether a tab has multiple panes (used to show/hide pane actions). */
  tabHasSplits?: Record<string, boolean>;
}

export function TabBar({
  tabs,
  activeTabId,
  onTabSelect,
  onTabClose,
  onTabAdd,
  onTabRename,
  onSplitRight,
  onSplitDown,
  onClosePane,
  onToggleTerminalMode,
  terminalModes,
  tabHasSplits,
}: TabBarProps) {
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ tabId: string; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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

  // Right-click context menu
  const handleContextMenu = useCallback(
    (e: React.MouseEvent, tabId: string) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ tabId, x: e.clientX, y: e.clientY });
    },
    []
  );

  const closeMenu = useCallback(() => setContextMenu(null), []);

  // Close menu on outside click or Escape
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [contextMenu, closeMenu]);

  const menuAction = useCallback(
    (fn?: (tabId: string) => void) => {
      if (contextMenu && fn) fn(contextMenu.tabId);
      closeMenu();
    },
    [contextMenu, closeMenu]
  );

  const ctxTabId = contextMenu?.tabId ?? '';
  const currentMode = terminalModes?.[ctxTabId] ?? 'block';
  const hasSplits = tabHasSplits?.[ctxTabId] ?? false;

  return (
    <div className="tab-bar">
      <div className="tab-bar-tabs">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`tab ${tab.id === activeTabId ? 'tab-active' : ''}`}
            onClick={() => onTabSelect(tab.id)}
            onDoubleClick={() => handleDoubleClick(tab.id, tab.title)}
            onContextMenu={(e) => handleContextMenu(e, tab.id)}
          >
            <span className="tab-icon">
              <TabTerminalIcon />
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

      {/* Right-click context menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="tab-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button className="tab-context-item" onClick={() => menuAction(onSplitRight)}>
            <SplitHIcon /> Split Right
            <span className="tab-context-shortcut">⌘D</span>
          </button>
          <button className="tab-context-item" onClick={() => menuAction(onSplitDown)}>
            <SplitVIcon /> Split Down
            <span className="tab-context-shortcut">⌘⇧D</span>
          </button>
          <div className="tab-context-separator" />
          <button className="tab-context-item" onClick={() => menuAction(onToggleTerminalMode)}>
            {currentMode === 'block' ? <TabTerminalIcon /> : <BlockIcon />}
            {currentMode === 'block' ? 'Switch to Plain Terminal' : 'Switch to Block Terminal'}
          </button>
          <div className="tab-context-separator" />
          {hasSplits && (
            <button className="tab-context-item tab-context-item--danger" onClick={() => menuAction(onClosePane)}>
              <CloseIcon /> Close Pane
              <span className="tab-context-shortcut">⌘W</span>
            </button>
          )}
          <button className="tab-context-item tab-context-item--danger" onClick={() => menuAction(onTabClose)}>
            <CloseIcon /> Close Tab
          </button>
        </div>
      )}
    </div>
  );
}

// ── SVG icons ──────────────────────────────────────────────────────────────

function TabTerminalIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="4,17 10,11 4,5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

function BlockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="3" y1="15" x2="21" y2="15" />
    </svg>
  );
}

function SplitHIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="12" y1="3" x2="12" y2="21" />
    </svg>
  );
}

function SplitVIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="12" x2="21" y2="12" />
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
