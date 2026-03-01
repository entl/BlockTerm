/**
 * Hook for managing command blocks from a terminal session.
 *
 * Subscribes to raw PTY output and parses the BlockTerm shell-integration
 * markers to automatically detect block boundaries and trim output:
 *
 *   <<<BLOCKTERM:START>>>   – emitted by the shell's preexec hook
 *   <<<BLOCKTERM:END exit=N>>>  – emitted by the shell's precmd hook
 *
 * Everything outside these markers (prompt text, escape sequences, etc.) is
 * discarded. Each block's `output` contains only the text between them.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { Block } from '../../shared/types';
import { cleanTerminalOutput, findTrailingPartialEscape } from '../lib/utils';

// ── Marker constants ──────────────────────────────────────────────────────────
const MARKER_START = '<<<BLOCKTERM:START>>>';
const MARKER_END_PREFIX = '<<<BLOCKTERM:END exit='; // used for partial-match detection
const MARKER_END_RE = /<<<BLOCKTERM:END exit=(-?\d+)>>>/;

// Matches OSC 7 sequences used by shells to broadcast cwd changes:
//   \x1b]7;file://hostname/path\x07   (BEL-terminated)
//   \x1b]7;file://hostname/path\x1b\  (ST-terminated)
//   \x1b]7;/path\x07                  (bare path form)
const OSC7_RE = /\x1b\]7;(?:file:\/\/[^\/]*)?([^\x07\x1b]+)(?:\x07|\x1b\\)/g;

/** Extract the last cwd broadcast in a raw PTY chunk, or null if none. */
function extractOsc7Cwd(raw: string): string | null {
  let last: string | null = null;
  let m: RegExpExecArray | null;
  OSC7_RE.lastIndex = 0;
  while ((m = OSC7_RE.exec(raw)) !== null) {
    try {
      last = decodeURIComponent(m[1]);
    } catch {
      last = m[1];
    }
  }
  return last;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Checks whether `text` (from index `from`) ends with a *partial* prefix of
 * `needle`. Returns the index where that partial fragment starts, or -1.
 * Used to save the tail of a chunk when a marker might be split across chunks.
 */
function findTrailingFragment(text: string, from: number, needle: string): number {
  const tail = text.slice(from);
  for (let len = Math.min(needle.length - 1, tail.length); len > 0; len--) {
    if (tail.endsWith(needle.slice(0, len))) {
      return from + tail.length - len;
    }
  }
  return -1;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BlockData {
  block: Block;
  path: string;
  command: string;
  output: string;
  exitCode: number | null;
}

export interface UseBlocksOptions {
  sessionId: string | null;
  currentPath?: string;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useBlocks({ sessionId, currentPath = '~' }: UseBlocksOptions) {
  const [blocks, setBlocks] = useState<Block[]>([]);  const [isFullscreen, setIsFullscreen] = useState(false);
  // Tracks the most-recently-received OSC 7 cwd; falls back to currentPath prop.
  const cwdRef = useRef<string>(currentPath);
  const [currentCwd, setCurrentCwd] = useState<string>(currentPath);
  // Content map: blockId → trimmed output text (only between START / END).
  // Stored in a ref for synchronous mutation, mirrored to state for renders.
  const blockContentsRef = useRef<Map<string, string>>(new Map());
  const [blockContents, setBlockContents] = useState<Map<string, string>>(new Map());

  // ── Parser state (per-session, reset on sessionId change) ──────────────────
  const activeBlockIdRef = useRef<string | null>(null); // block currently receiving output
  const activeBlockCommandRef = useRef<string>('');     // command text of the active block
  const inBlockRef = useRef(false);                     // between START and END?
  const fragmentRef = useRef('');                       // partial marker from previous chunk
  const rawBufferRef = useRef('');                      // partial ANSI escape from previous chunk
  // True while we are between a START and END marker (command is executing).
  // Exposed so callers can route user input directly to the PTY instead of
  // creating a new block (e.g. when a command asks for credentials).
  const [isCommandRunning, setIsCommandRunning] = useState(false);

  // Reset parser state when the session changes
  useEffect(() => {
    activeBlockIdRef.current = null;
    activeBlockCommandRef.current = '';
    inBlockRef.current = false;
    fragmentRef.current = '';
    rawBufferRef.current = '';
    blockContentsRef.current = new Map();
    cwdRef.current = currentPath;
    setBlocks([]);
    setBlockContents(new Map());
    setCurrentCwd(currentPath);
    setIsFullscreen(false);
    setIsCommandRunning(false);
  }, [sessionId]);

  // ── Output subscription ───────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return;

    const unsubscribe = window.terminalApi.onOutput(sessionId, (chunk: Uint8Array) => {
      // Reassemble any partial ANSI escape left over from the previous chunk
      // so that cleanTerminalOutput can always process complete sequences.
      const rawFull = rawBufferRef.current + new TextDecoder().decode(chunk);
      rawBufferRef.current = '';

      const escIdx = findTrailingPartialEscape(rawFull);
      let raw: string;
      if (escIdx !== -1) {
        rawBufferRef.current = rawFull.slice(escIdx);
        raw = rawFull.slice(0, escIdx);
      } else {
        raw = rawFull;
      }

      // Detect alternate-screen transitions before any cleaning.
      // \x1b[?1049h / \x1b[?47h  → app entered fullscreen (vim, nano, htop, …)
      // \x1b[?1049l / \x1b[?47l  → app left fullscreen
      if (raw.includes('\x1b[?1049h') || raw.includes('\x1b[?47h')) {
        setIsFullscreen(true);
      }
      if (raw.includes('\x1b[?1049l') || raw.includes('\x1b[?47l')) {
        setIsFullscreen(false);
      }

      // Parse OSC 7 cwd announcements (must happen on raw bytes, before cleaning).
      const newCwd = extractOsc7Cwd(raw);
      if (newCwd && newCwd !== cwdRef.current) {
        cwdRef.current = newCwd;
        setCurrentCwd(newCwd);
      }

      const cleaned = cleanTerminalOutput(raw);

      // Reassemble any partial marker left over from the previous chunk.
      let text = fragmentRef.current + cleaned;
      fragmentRef.current = '';

      let pos = 0;

      while (pos < text.length) {
        if (!inBlockRef.current) {
          // ── Looking for START ───────────────────────────────────────────
          const startIdx = text.indexOf(MARKER_START, pos);

          if (startIdx === -1) {
            // No START in this text – but the tail might be a partial marker.
            const fragIdx = findTrailingFragment(text, pos, MARKER_START);
            if (fragIdx !== -1) {
              fragmentRef.current = text.slice(fragIdx);
            }
            // Discard everything else (prompt text, shell echoes, etc.).
            break;
          }

          // Activate the pending block registered by addBlock(), or create an
          // auto-detected block for commands run via the plain terminal.
          if (activeBlockIdRef.current === null) {
            const autoBlock: Block = {
              id: `block-auto-${Date.now()}`,
              sessionId: sessionId!,
              command: '',
              cwd: cwdRef.current,
              startOffset: 0,
              endOffset: null,
              exitCode: null,
              timestamp: Date.now(),
              collapsed: false,
            };
            blockContentsRef.current.set(autoBlock.id, '');
            activeBlockIdRef.current = autoBlock.id;
            setBlocks(prev => [...prev, autoBlock]);
          }

          inBlockRef.current = true;
          setIsCommandRunning(true);
          pos = startIdx + MARKER_START.length;

        } else {
          // ── Inside a block: looking for END ────────────────────────────
          const remaining = text.slice(pos);
          const endMatch = MARKER_END_RE.exec(remaining);

          if (!endMatch) {
            // No END yet – save partial END marker for next chunk.
            const fragIdx = findTrailingFragment(text, pos, MARKER_END_PREFIX);
            const contentEnd = fragIdx !== -1 ? fragIdx : text.length;
            if (fragIdx !== -1) {
              fragmentRef.current = text.slice(fragIdx);
            }
            appendToBlock(remaining.slice(0, contentEnd - pos));
            break;
          }

          // Found complete END marker.
          const exitCode = parseInt(endMatch[1], 10);
          const endMarkerOffset = endMatch.index!;

          // Flush content that precedes the END marker.
          appendToBlock(remaining.slice(0, endMarkerOffset));

          // Close the block.
          const closedId = activeBlockIdRef.current!;
          const closedCommand = activeBlockCommandRef.current;
          const closedAt = Date.now();
          setBlocks(prev =>
            prev.map(b =>
              b.id === closedId ? { ...b, exitCode, endOffset: b.startOffset } : b,
            ),
          );

          // Persist to history (fire-and-forget; non-blocking).
          if (closedCommand && sessionId) {
            // Use the cwd snapshotted when the block was created, not currentPath.
            const closedBlock = blocks.find(b => b.id === closedId);
            const closedCwd = closedBlock?.cwd ?? cwdRef.current;
            window.terminalApi
              .recordCommand(sessionId, closedCommand, closedCwd, exitCode, closedAt)
              .catch(err => console.warn('history: failed to record command:', err));
          }

          activeBlockIdRef.current = null;
          activeBlockCommandRef.current = '';
          inBlockRef.current = false;
          setIsCommandRunning(false);
          pos += endMarkerOffset + endMatch[0].length;
        }
      }
    });

    return unsubscribe;
  }, [sessionId]);

  // ── Internal helpers ──────────────────────────────────────────────────────

  function appendToBlock(content: string) {
    if (!content || !activeBlockIdRef.current) return;
    const id = activeBlockIdRef.current;
    const existing = blockContentsRef.current.get(id) ?? '';
    blockContentsRef.current.set(id, existing + content);
    setBlockContents(new Map(blockContentsRef.current));
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Register a command submitted via BlockInput.
   * Creates a pending block and arms the parser so the next START marker
   * routes output into it.
   */
  const addBlock = useCallback(
    (command: string) => {
      if (!sessionId) return;

      const newBlock: Block = {
        id: `block-${Date.now()}`,
        sessionId,
        command,
        cwd: cwdRef.current,
        startOffset: 0,
        endOffset: null,
        exitCode: null,
        timestamp: Date.now(),
        collapsed: false,
      };

      blockContentsRef.current.set(newBlock.id, '');
      activeBlockIdRef.current = newBlock.id;
      activeBlockCommandRef.current = command;
      setBlocks(prev => [...prev, newBlock]);
    },
    [sessionId],
  );

  /** Toggle the collapsed state of a block. */
  const toggleCollapse = useCallback((blockId: string) => {
    setBlocks(prev =>
      prev.map(b => (b.id === blockId ? { ...b, collapsed: !b.collapsed } : b)),
    );
  }, []);

  /** Derived view: each block paired with its marker-trimmed output text. */
  const blockData: BlockData[] = useMemo(
    () => blocks.map(block => ({
      block,
      path: block.cwd,
      command: block.command,
      output: blockContents.get(block.id) ?? '',
      exitCode: block.exitCode,
    })),
    [blocks, blockContents],
  );

  return { blocks, blockData, isFullscreen, currentCwd, isCommandRunning, addBlock, toggleCollapse };
}
