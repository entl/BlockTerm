/**
 * StatusBar component - shows backend connection status, git info, and python env
 */

import type { BackendStatus, EnvInfo } from '../../../shared/types';
import './StatusBar.css';

export interface StatusBarProps {
  backendStatus: BackendStatus;
  error?: string | null;
  sessionId?: string | null;
  envInfo?: EnvInfo | null;
}

export function StatusBar({ backendStatus, error, sessionId, envInfo }: StatusBarProps) {
  const getStatusIndicator = () => {
    switch (backendStatus) {
      case 'ready':
        return { className: 'status-ready', text: 'Connected' };
      case 'starting':
        return { className: 'status-starting', text: 'Starting...' };
      case 'error':
        return { className: 'status-error', text: 'Error' };
      case 'stopped':
        return { className: 'status-stopped', text: 'Disconnected' };
      default:
        return { className: 'status-unknown', text: 'Unknown' };
    }
  };

  const status = getStatusIndicator();
  const git = envInfo?.git ?? null;
  const python = envInfo?.python ?? null;

  return (
    <div className="status-bar">
      <div className="status-bar-left">
        <div className={`status-indicator ${status.className}`}>
          <span className="status-dot" />
          <span className="status-text">{status.text}</span>
        </div>
        {error && <span className="status-error-message">{error}</span>}

        {/* Git branch + diff stats */}
        {git && (
          <span className="status-git">
            <span className="status-git-icon" aria-hidden="true">⎏</span>
            <span className="status-git-branch">{git.branch}</span>
            {(git.added > 0 || git.deleted > 0) && (
              <span className="status-git-diff">
                {git.added > 0 && (
                  <span className="status-git-added">+{git.added}</span>
                )}
                {git.deleted > 0 && (
                  <span className="status-git-deleted">−{git.deleted}</span>
                )}
              </span>
            )}
          </span>
        )}

        {/* Python environment */}
        {python && (
          <span className="status-python">
            <span className="status-python-icon" aria-hidden="true">🐍</span>
            <span className="status-python-name">{python.name}</span>
            {python.version && (
              <span className="status-python-version">{python.version}</span>
            )}
          </span>
        )}
      </div>

      <div className="status-bar-right">
        {sessionId && (
          <span className="status-session">Session: {sessionId.slice(0, 8)}...</span>
        )}
      </div>
    </div>
  );
}

export default StatusBar;
