/**
 * Workspace persistence store.
 *
 * Two responsibilities:
 *  1. **Block registry** – each active useBlocks instance registers its
 *     current block data here so App.tsx can serialize the full workspace
 *     on save without reaching into component state.
 *  2. **Restored pane data** – when a saved workspace is deserialized the
 *     per-pane block/cwd data is stored here so that useBlocks and
 *     TerminalPane can read it once on mount.
 */

import type {
  Block,
  SavedBlock,
  SavedSplitNode,
  SavedWorkspace,
  SplitNode,
  PythonEnvInfo,
} from '../../shared/types';

// ── 1. Block Registry (saving) ──────────────────────────────────────────────

interface PaneBlockData {
  blocks: Block[];
  contents: Map<string, string>;
  cwd: string;
  pythonEnv: PythonEnvInfo | null;
}

const paneBlockRegistry = new Map<string, PaneBlockData>();

/** Update the registry entry for a pane. Called by useBlocks on every change. */
export function registerPaneBlocks(
  paneId: string,
  blocks: Block[],
  contents: Map<string, string>,
  cwd: string,
  pythonEnv: PythonEnvInfo | null = null,
): void {
  paneBlockRegistry.set(paneId, { blocks, contents, cwd, pythonEnv });
}

/** Remove a pane from the registry (unmount). */
export function unregisterPaneBlocks(paneId: string): void {
  paneBlockRegistry.delete(paneId);
}

/** Read current block data for a pane (used during serialization). */
export function getPaneBlockData(paneId: string): PaneBlockData | null {
  return paneBlockRegistry.get(paneId) ?? null;
}

// ── 2. Restored Pane Data (loading) ─────────────────────────────────────────

export interface RestoredPaneData {
  cwd: string;
  blocks: SavedBlock[];
  terminalMode: 'plain' | 'block';
}

const restoredPaneData = new Map<string, RestoredPaneData>();

/** Store restored pane data (called during deserialization). */
export function setRestoredPaneData(paneId: string, data: RestoredPaneData): void {
  restoredPaneData.set(paneId, data);
}

/** Read restored pane data without consuming it. */
export function getRestoredPaneData(paneId: string): RestoredPaneData | null {
  return restoredPaneData.get(paneId) ?? null;
}

/**
 * Consume (read + delete) restored pane data.
 * Called by useBlocks on mount so the data is only applied once.
 */
export function consumeRestoredPaneData(paneId: string): RestoredPaneData | null {
  const data = restoredPaneData.get(paneId);
  if (data) {
    restoredPaneData.delete(paneId);
    return data;
  }
  return null;
}

// ── 3. Serialization ────────────────────────────────────────────────────────

// Import TabState type – it lives in the hooks module, so use an inline
// interface to avoid circular imports.
interface TabStateLike {
  id: string;
  title: string;
  layout: SplitNode;
  activePaneId: string;
}

/**
 * Build a SavedWorkspace from the current in-memory state.
 */
export function serializeWorkspace(
  tabs: TabStateLike[],
  activeTabId: string | null,
  terminalModes: Record<string, 'plain' | 'block'>,
): SavedWorkspace {
  function serializeNode(node: SplitNode): SavedSplitNode {
    if (node.type === 'leaf') {
      const data = getPaneBlockData(node.id);
      return {
        type: 'leaf',
        id: node.id,
        pane: {
          id: node.id,
          cwd: data?.cwd ?? '~',
          blocks: data
            ? data.blocks
                .filter(b => b.command || (data.contents.get(b.id) ?? '').length > 0)
                .map(b => ({
                  id: b.id,
                  command: b.command,
                  output: data.contents.get(b.id) ?? '',
                  cwd: b.cwd,
                  exitCode: b.exitCode,
                  timestamp: b.timestamp,
                  collapsed: b.collapsed,
                }))
            : [],
          terminalMode: terminalModes[node.id] ?? 'block',
        },
      };
    }
    return {
      type: 'branch',
      id: node.id,
      direction: node.direction,
      children: node.children.map(serializeNode),
      sizes: node.sizes,
    };
  }

  return {
    version: 1,
    activeTabId: activeTabId ?? '',
    tabs: tabs.map(tab => ({
      id: tab.id,
      title: tab.title,
      layout: serializeNode(tab.layout),
      activePaneId: tab.activePaneId,
    })),
    terminalModes,
    savedAt: Date.now(),
  };
}

// ── 4. Deserialization ──────────────────────────────────────────────────────

/**
 * Convert a saved layout node back into a live SplitNode.
 * Also populates the restoredPaneData registry for each leaf.
 */
export function deserializeLayout(saved: SavedSplitNode): SplitNode {
  if (saved.type === 'leaf') {
    setRestoredPaneData(saved.id, {
      cwd: saved.pane.cwd,
      blocks: saved.pane.blocks,
      terminalMode: saved.pane.terminalMode,
    });
    return {
      type: 'leaf',
      id: saved.id,
      sessionId: null, // new session will be created
    };
  }
  return {
    type: 'branch',
    id: saved.id,
    direction: saved.direction,
    children: saved.children.map(deserializeLayout),
    sizes: saved.sizes,
  };
}

/**
 * Fully restore TabState[] + metadata from a SavedWorkspace.
 */
export function deserializeWorkspace(saved: SavedWorkspace): {
  tabs: TabStateLike[];
  activeTabId: string;
  terminalModes: Record<string, 'plain' | 'block'>;
} {
  const tabs: TabStateLike[] = saved.tabs.map(savedTab => ({
    id: savedTab.id,
    title: savedTab.title,
    layout: deserializeLayout(savedTab.layout),
    activePaneId: savedTab.activePaneId,
  }));

  return {
    tabs,
    activeTabId: saved.activeTabId,
    terminalModes: saved.terminalModes,
  };
}
