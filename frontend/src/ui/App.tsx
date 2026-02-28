/**
 * Main App component - Terminal application with tabs
 */

import { useCallback, useEffect } from 'react';
import { TabBar } from './components/TabBar';
import { StatusBar, TerminalPane } from './components';
import { useTerminalTabs, useBackendStatus } from './hooks';
import './App.css';

function App() {
  const { status, error: backendError } = useBackendStatus();
  const { tabs, activeTabId, addTab, removeTab, updateTab, setActiveTabId } = useTerminalTabs();

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

  // Handle tab close
  const handleTabClose = useCallback(
    (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (tab?.sessionId) {
        window.terminalApi.closeSession(tab.sessionId).catch((err) => {
          console.error('Failed to close session:', err);
        });
      }
      removeTab(tabId);
    },
    [tabs, removeTab]
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

  // Handle session creation from TerminalPane
  const handleSessionCreate = useCallback(
    (tabId: string, sessionId: string) => {
      updateTab(tabId, { sessionId });
    },
    [updateTab]
  );

  // Handle title change from terminal escape sequences
  const handleTitleChange = useCallback(
    (tabId: string, title: string) => {
      if (title) {
        updateTab(tabId, { title });
      }
    },
    [updateTab]
  );

  // Get active tab's session ID for status bar
  const activeTab = tabs.find((t) => t.id === activeTabId);

  return (
    <div className="app">
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onTabSelect={handleTabSelect}
        onTabClose={handleTabClose}
        onTabAdd={handleTabAdd}
        onTabRename={handleTabRename}
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
              <TerminalPane
                key={tab.id}
                tabId={tab.id}
                sessionId={tab.sessionId}
                isActive={tab.id === activeTabId}
                onSessionCreate={handleSessionCreate}
                onTitleChange={(title) => handleTitleChange(tab.id, title)}
              />
            ))}
          </div>
        )}
      </main>
      <StatusBar
        backendStatus={status}
        error={backendError}
        sessionId={activeTab?.sessionId}
      />
    </div>
  );
}

export default App;

