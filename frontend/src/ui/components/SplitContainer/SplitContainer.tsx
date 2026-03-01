/**
 * SplitContainer – recursively renders a SplitNode tree.
 *
 * Branch nodes lay out their children using CSS flex with draggable resize
 * handles between them.  Leaf nodes render a TerminalPane.
 */

import React, { useCallback, useRef, useState, useEffect } from 'react';
import type { SplitNode, SplitBranch, SplitDirection } from '../../../shared/types';
import { TerminalPane } from '../TerminalPane';
import './SplitContainer.css';

export interface SplitContainerProps {
  /** The layout tree for the current tab. */
  node: SplitNode;
  /** Currently focused pane id. */
  activePaneId: string | null;
  /** Called when a pane gains focus. */
  onPaneFocus: (paneId: string) => void;
  /** Called when a leaf pane creates its session. */
  onSessionCreate: (paneId: string, sessionId: string) => void;
  /** Called when the user drags a resize handle. */
  onResize: (branchId: string, sizes: number[]) => void;
  /** Called when a pane requests a split. */
  onSplit: (paneId: string, direction: SplitDirection) => void;
  /** Called when a pane requests to close itself. */
  onClosePane: (paneId: string) => void;
  /** Title change from terminal escape sequences. */
  onTitleChange?: (paneId: string, title: string) => void;
  /** Whether the tree contains multiple panes. When false, the active border is hidden. */
  hasSplits?: boolean;
  /** Terminal display mode per pane id. */
  terminalModes?: Record<string, 'plain' | 'block'>;
}

export const SplitContainer: React.FC<SplitContainerProps> = ({
  node,
  activePaneId,
  onPaneFocus,
  onSessionCreate,
  onResize,
  onSplit,
  onClosePane,
  onTitleChange,
  hasSplits: hasSplitsProp,
  terminalModes,
}) => {
  // Auto-detect: if caller doesn't pass hasSplits, derive from root node type.
  const hasSplits = hasSplitsProp ?? node.type === 'branch';

  if (node.type === 'leaf') {
    const showActiveBorder = hasSplits && node.id === activePaneId;
    return (
      <div
        className={`split-leaf${showActiveBorder ? ' split-leaf--active' : ''}`}
        onClick={() => onPaneFocus(node.id)}
      >
        <TerminalPane
          tabId={node.id}
          sessionId={node.sessionId}
          isActive={node.id === activePaneId}
          terminalMode={terminalModes?.[node.id]}
          onSessionCreate={(_, sessionId) => onSessionCreate(node.id, sessionId)}
          onTitleChange={(title) => onTitleChange?.(node.id, title)}
        />
      </div>
    );
  }

  // Branch node
  return (
    <BranchContainer
      node={node}
      activePaneId={activePaneId}
      onPaneFocus={onPaneFocus}
      onSessionCreate={onSessionCreate}
      onResize={onResize}
      onSplit={onSplit}
      onClosePane={onClosePane}
      onTitleChange={onTitleChange}
      hasSplits={hasSplits}
      terminalModes={terminalModes}
    />
  );
};

/* ── Branch with resizable children ────────────────────────────────────── */

interface BranchContainerProps extends SplitContainerProps {
  node: SplitBranch;
}

const BranchContainer: React.FC<BranchContainerProps> = ({
  node,
  activePaneId,
  onPaneFocus,
  onSessionCreate,
  onResize,
  onSplit,
  onClosePane,
  onTitleChange,
  hasSplits,
  terminalModes,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [localSizes, setLocalSizes] = useState(node.sizes);

  // Sync local sizes when the tree changes from outside (e.g. split/close).
  useEffect(() => {
    setLocalSizes(node.sizes);
  }, [node.sizes]);

  const isHorizontal = node.direction === 'horizontal';

  /* ── Drag logic ──────────────────────────────────────────────────────── */
  const handleMouseDown = useCallback(
    (handleIndex: number) => (e: React.MouseEvent) => {
      e.preventDefault();
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const totalSize = isHorizontal ? rect.width : rect.height;
      const startPos = isHorizontal ? e.clientX : e.clientY;
      const startSizes = [...localSizes];

      const onMouseMove = (ev: MouseEvent) => {
        const currentPos = isHorizontal ? ev.clientX : ev.clientY;
        const delta = (currentPos - startPos) / totalSize;
        const newSizes = [...startSizes];

        // Minimum pane size: 10% of total
        const MIN = 0.1;
        const left = startSizes[handleIndex] + delta;
        const right = startSizes[handleIndex + 1] - delta;

        if (left >= MIN && right >= MIN) {
          newSizes[handleIndex] = left;
          newSizes[handleIndex + 1] = right;
          setLocalSizes(newSizes);
        }
      };

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        // Persist final sizes
        onResize(node.id, localSizes);
      };

      document.body.style.cursor = isHorizontal ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [isHorizontal, localSizes, node.id, onResize],
  );

  return (
    <div
      ref={containerRef}
      className={`split-branch split-branch--${node.direction}`}
    >
      {node.children.map((child, i) => (
        <React.Fragment key={child.id}>
          {i > 0 && (
            <div
              className={`split-handle split-handle--${node.direction}`}
              onMouseDown={handleMouseDown(i - 1)}
            />
          )}
          <div
            className="split-child"
            style={{
              [isHorizontal ? 'width' : 'height']: `calc(${localSizes[i] * 100}% - ${
                (node.children.length - 1) * 4 / node.children.length
              }px)`,
            }}
          >
            <SplitContainer
              node={child}
              activePaneId={activePaneId}
              onPaneFocus={onPaneFocus}
              onSessionCreate={onSessionCreate}
              onResize={onResize}
              onSplit={onSplit}
              onClosePane={onClosePane}
              onTitleChange={onTitleChange}
              hasSplits={hasSplits}
              terminalModes={terminalModes}
            />
          </div>
        </React.Fragment>
      ))}
    </div>
  );
};

export default SplitContainer;
