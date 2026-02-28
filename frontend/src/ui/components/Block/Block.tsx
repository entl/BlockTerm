/**
 * Block component - displays a single command/output grouping
 * Warp-style: dark terminal look, inline prompt, hover actions, exit status dot.
 */

import React, { useState } from 'react';
import type { Block as BlockType } from '@/shared/types';
import { ChevronDown, ChevronRight, Copy, RotateCcw, CheckCircle2, XCircle, Clock } from 'lucide-react';
import './Block.css';

export interface BlockProps {
  block: BlockType;
  path: string;
  command: string;
  output: string;
  exitCode: number | null;
  onRerun?: () => void;
}

export const Block: React.FC<BlockProps> = ({
  block,
  path,
  command,
  output,
  exitCode,
  onRerun,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(block.collapsed || false);
  const [copied, setCopied] = useState<'command' | 'output' | 'block' | null>(null);

  const copy = (text: string, kind: 'command' | 'output' | 'block') => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(kind);
      setTimeout(() => setCopied(null), 1500);
    }).catch(console.error);
  };

  const statusIcon = () => {
    if (exitCode === null) return <Clock className="block-status-icon block-status-pending" />;
    if (exitCode === 0)   return <CheckCircle2 className="block-status-icon block-status-ok" />;
    return <XCircle className="block-status-icon block-status-err" />;
  };

  const hasOutput = !!output;

  return (
    <div
      className={`block-root${
        exitCode !== null && exitCode !== 0 ? ' block-root--error' : ''
      }`}
      data-collapsed={isCollapsed}
    >
      {/* ── Command row ─────────────────────────────────────── */}
      <div className="block-cmd-row">
        {/* Left: collapse toggle + status dot + path + command */}
        <button
          className="block-collapse-btn"
          onClick={() => setIsCollapsed(c => !c)}
          aria-label={isCollapsed ? 'Expand output' : 'Collapse output'}
          disabled={!hasOutput}
        >
          {hasOutput
            ? (isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />)
            : <span className="w-3.5 h-3.5" />}
        </button>

        {statusIcon()}

        <span className="block-path">{path}</span>
        <span className="block-prompt">❯</span>
        <span className="block-command">{command || <em className="block-command--empty">no command</em>}</span>

        {/* Right: timestamp + actions (visible on row hover) */}
        <span className="block-timestamp">
          {new Date(block.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>

        <div className="block-actions">
          <button
            className="block-action-btn"
            onClick={() => copy(command, 'command')}
            title="Copy command"
          >
            {copied === 'command' ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          {onRerun && (
            <button
              className="block-action-btn"
              onClick={onRerun}
              title="Re-run"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* ── Output area ──────────────────────────────────────── */}
      {hasOutput && !isCollapsed && (
        <div className="block-output-wrap">
          <pre className="block-output">{output}</pre>
          <button
            className="block-copy-output-btn"
            onClick={() => copy(output, 'output')}
            title="Copy output"
          >
            {copied === 'output' ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      )}

      {/* ── Collapsed summary ────────────────────────────────── */}
      {hasOutput && isCollapsed && (
        <div className="block-collapsed-hint">
          {output.split('\n').length} lines hidden
        </div>
      )}
    </div>
  );
};
