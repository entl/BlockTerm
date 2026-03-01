/**
 * Main App component - Terminal application with tabs and split panes
 */

import { useCallback, useEffect, useState } from 'react';
import { TabBar } from './components/TabBar';
import { StatusBar } from './components';
import { SplitContainer } from './components/SplitContainer';
import { useTerminalTabs, useBackendStatus } from './hooks';
import type { SplitDirection } from '../shared/types';
import './App.css';

function App() {
  const { status, error: backendError } = useBackendStatus();
  const {
    tabs,
    activeTabId,
    addTab,
    removeTab,
    updateTab,
    setActiveTabId,
    setPaneSession,
    setActivePaneId,
    splitPane,
    closePane,
    resizeBranch,
    getTabSessionIds,
  } = useTerminalTabs();

  // Per-pane terminal display mode ('plain' | 'block')
  const [terminalModes, setTerminalModes] = useState<Record<string, 'plain' | 'block'>>({});

  // Create initial tab when backend is ready and no tabs exist
  useEffect(() => {
    if (status === 'ready' && tabs.length === 0) {
      addTab('Terminal');
    }
  }, [status, tabs.length, addTab]);

  // Handle tab selection
  const handleTabSelect = useCallback(
    (tabId: string) => {
      setActiveTabId(tabId);
    },
    [setActiveTabId]
  );

  // Handle tab close – close all sessions in the tab
  const handleTabClose = useCallback(
    (tabId: string) => {
      const sessionIds = getTabSessionIds(tabId);
      sessionIds.forEach(sid => {
        window.terminalApi.closeSession(sid).catch(console.error);
      });
      removeTab(tabId);
    },
    [getTabSessionIds, removeTab]
  );

  // Handle adding new tab
  const handleTabAdd = useCallback(() => {
    addTab('Terminal');
  }, [addTab]);

  // Handle tab rename
  const handleTabRename = useCallback(
    (tabId: string, newTitle: string) => {
      updateTab(tabId, { title: newTitle });
    },
    [updateTab]
  );

  // Handle session creation from a leaf pane
  const handleSessionCreate = useCallback(
    (paneId: string, sessionId: string) => {
      setPaneSession(paneId, sessionId);
    },
    [setPaneSession]
  );

  // Handle title change from terminal escape sequences
  const handleTitleChange = useCallback(
    (_paneId: string, title: string) => {
      if (title && activeTabId) {
        updateTab(activeTabId, { title });
      }
    },
    [activeTabId, updateTab]
  );

  // Handle pane focus
  const handlePaneFocus = useCallback(
    (paneId: string) => {
      setActivePaneId(paneId);
    },
    [setActivePaneId]
  );

  // Handle split
  const handleSplit = useCallback(
    (paneId: string, direction: SplitDirection) => {
      splitPane(paneId, direction);
    },
    [splitPane]
  );

  // Handle pane close
  const handleClosePane = useCallback(
    (paneId: string) => {
      closePane(paneId);
    },
    [closePane]
  );

  // Tab context menu: split the active pane right
  const handleTabSplitRight = useCallback(
    (tabId: string) => {
      const tab = tabs.find(t => t.id === tabId);
      if (tab) splitPane(tab.activePaneId, 'horizontal');
    },
    [tabs, splitPane]
  );

  // Tab context menu: split the active pane down
  const handleTabSplitDown = useCallback(
    (tabId: string) => {
      const tab = tabs.find(t => t.id === tabId);
      if (tab) splitPane(tab.activePaneId, 'vertical');
    },
    [tabs, splitPane]
  );

  // Tab context menu: close the active pane
  const handleTabClosePane = useCallback(
    (tabId: string) => {
      const tab = tabs.find(t => t.id === tabId);
      if (tab && tab.layout.type === 'branch') closePane(tab.activePaneId);
    },
    [tabs, closePane]
  );

  // Tab context menu: toggle terminal mode for the active pane
  const handleToggleTerminalMode = useCallback(
    (tabId: string) => {
      const tab = tabs.find(t => t.id === tabId);
      if (!tab) return;
      const paneId = tab.activePaneId;
      setTerminalModes(prev => ({
        ...prev,
        [paneId]: (prev[paneId] ?? 'block') === 'block' ? 'plain' : 'block',
      }));
    },
    [tabs]
  );

  // Derive per-tab terminal mode (of active pane) for TabBar label
  const tabTerminalModes: Record<string, 'plain' | 'block'> = {};
  const tabHasSplits: Record<string, boolean> = {};
  for (const tab of tabs) {
    tabTerminalModes[tab.id] = terminalModes[tab.activePaneId] ?? 'block';
    tabHasSplits[tab.id] = tab.layout.type === 'branch';
  }

  // Handle resize
  const handleResize = useCallback(
    (branchId: string, sizes: number[]) => {
      resizeBranch(branchId, sizes);
    },
    [resizeBranch]
  );

  // Keyboard shortcuts for splitting
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTab = tabs.find(t => t.id === activeTabId);
      if (!activeTab) return;

      // Cmd+D / Ctrl+D → split vertical (side-by-side)
      if ((e.metaKey || e.ctrlKey) && e.key === 'd' && !e.shiftKey) {
        e.preventDefault();
        splitPane(activeTab.activePaneId, 'horizontal');
      }

      // Cmd+Shift+D / Ctrl+Shift+D → split horizontal (top-bottom)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        splitPane(activeTab.activePaneId, 'vertical');
      }

      // Cmd+W / Ctrl+W → close active pane (if more than one pane)
      if ((e.metaKey || e.ctrlKey) && e.key === 'w' && !e.shiftKey) {
        // Only intercept if there are multiple panes
        if (activeTab.layout.type === 'branch') {
          e.preventDefault();
          closePane(activeTab.activePaneId);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tabs, activeTabId, splitPane, closePane]);

  // Get active tab's active pane's session for status bar
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const activePaneSessionId = (() => {
    if (!activeTab) return null;
    const findLeaf = (node: import('../shared/types').SplitNode): string | null => {
      if (node.type === 'leaf' && node.id === activeTab.activePaneId) return node.sessionId;
      if (node.type === 'branch') {
        for (const child of node.children) {
          const found = findLeaf(child);
          if (found) return found;
        }
      }
      return null;
    };
    return findLeaf(activeTab.layout);
  })();

  return (
    <div className="app">
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onTabSelect={handleTabSelect}
        onTabClose={handleTabClose}
        onTabAdd={handleTabAdd}
        onTabRename={handleTabRename}
        onSplitRight={handleTabSplitRight}
        onSplitDown={handleTabSplitDown}
        onClosePane={handleTabClosePane}
        onToggleTerminalMode={handleToggleTerminalMode}
        terminalModes={tabTerminalModes}
        tabHasSplits={tabHasSplits}
      />
      <main className="app-content">
        {status !== 'ready' ? (
          <div className="app-loading">
            <div className="app-loading-content">
              {status === 'starting' && (
                <>
                  <div className="app-loading-spinner" />
                  <p>Starting backend...</p>
                </>
              )}
              {status === 'error' && (
                <>
                  <p className="app-loading-error">Failed to start backend</p>
                  {backendError && <p className="app-loading-error-detail">{backendError}</p>}
                </>
              )}
              {status === 'stopped' && <p>Backend stopped</p>}
            </div>
          </div>
        ) : (
          <div className="terminal-container-wrapper">
            {tabs.map((tab) => (
              <div
                key={tab.id}
                className={`tab-content ${tab.id === activeTabId ? 'tab-content--active' : 'tab-content--hidden'}`}
              >
                <SplitContainer
                  node={tab.layout}
                  activePaneId={tab.activePaneId}
                  onPaneFocus={handlePaneFocus}
                  onSessionCreate={handleSessionCreate}
                  onResize={handleResize}
                  onSplit={handleSplit}
                  onClosePane={handleClosePane}
                  onTitleChange={handleTitleChange}
                  terminalModes={terminalModes}
                />
              </div>
            ))}
          </div>
        )}
      </main>
      <StatusBar
        backendStatus={status}
        error={backendError}
        sessionId={activePaneSessionId}
      />
    </div>
  );
}

export default App;
