/**
 * StatusBar component - shows backend connection status and other info
 */

import type { BackendStatus } from '../../../shared/types';
import './StatusBar.css';

export interface StatusBarProps {
  backendStatus: BackendStatus;
  error?: string | null;
  sessionId?: string | null;
}

export function StatusBar({ backendStatus, error, sessionId }: StatusBarProps) {
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

  return (
    <div className="status-bar">
      <div className="status-bar-left">
        <div className={`status-indicator ${status.className}`}>
          <span className="status-dot" />
          <span className="status-text">{status.text}</span>
        </div>
        {error && <span className="status-error-message">{error}</span>}
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
