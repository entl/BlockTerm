/**
 * BlockTerminal component – renders command blocks in a scrollable container.
 *
 * Owns its own block state via useBlocks: subscribes to raw PTY output for
 * the given sessionId, groups output into blocks, and renders them.
 * Blocks appear top-to-bottom (oldest → newest), with input anchored at bottom.
 *
 * Fullscreen mode: when a TUI app (vim, nano, htop, …) emits the alternate-
 * screen sequence (\x1b[?1049h), the block list is hidden and a raw xterm.js
 * Terminal is revealed in its place. When the app exits (\x1b[?1049l) the
 * block view is restored. The xterm instance is *always* mounted so it
 * processes every PTY byte from the start — it is never recreated.
 */

import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import { Block } from '../Block';
import { BlockInput } from '../BlockInput';
import { Terminal, type TerminalRef } from '../Terminal';
import { useBlocks } from '../../hooks';
import './BlockTerminal.css';

export interface BlockTerminalProps {
  sessionId: string | null;
  currentPath?: string;
  autoScroll?: boolean;
  showInput?: boolean;
}

export const BlockTerminal: React.FC<BlockTerminalProps> = ({
  sessionId,
  currentPath = '~',
  autoScroll = true,
  showInput = true,
}) => {
  const { blockData, isFullscreen, currentCwd, addBlock } = useBlocks({ sessionId, currentPath });

  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<TerminalRef>(null);
  // True when the user has deliberately scrolled upward.
  const userScrolledUpRef = useRef(false);
  // True while we are programmatically setting scrollTop so the scroll
  // listener does not misinterpret our own scroll events as user intent.
  const isProgrammaticScrollRef = useRef(false);

  // ── Block-mode column measurement ──────────────────────────────────────
  // In block mode the <pre class="block-output"> area is narrower than the
  // full-width xterm overlay because of padding / border / scrollbar.  We
  // measure the *actual* text area width in characters and resize the PTY
  // to match, so commands like `ls` produce the right number of columns.
  //
  // We use a DOM "ruler" that replicates the exact CSS structure of a real
  // block output element, so the measurement is immune to padding / border
  // / scrollbar / font changes.
  const blockColsRef = useRef<number>(0); // 0 = never measured yet

  /**
   * Measure how many monospace characters fit in the block output area by
   * temporarily inserting a hidden replica of the block DOM structure.
   */
  const measureBlockCols = useCallback((container: HTMLElement): number => {
    // Build: .block-root > .block-output-wrap > pre.block-output > span
    const root = document.createElement('div');
    root.className = 'block-root';
    root.style.cssText = 'height:0;overflow:hidden;visibility:hidden;pointer-events:none';

    const wrap = document.createElement('div');
    wrap.className = 'block-output-wrap';

    const pre = document.createElement('pre');
    pre.className = 'block-output';
    // Force a vertical scrollbar so the measurement reflects the worst case
    // (real output that exceeds max-height).
    pre.style.overflowY = 'scroll';

    const ruler = document.createElement('span');
    ruler.textContent = 'X'.repeat(200);

    pre.appendChild(ruler);
    wrap.appendChild(pre);
    root.appendChild(wrap);
    container.appendChild(root);

    const charWidth = ruler.getBoundingClientRect().width / 200;
    const style = getComputedStyle(pre);
    const padL = parseFloat(style.paddingLeft) || 0;
    const padR = parseFloat(style.paddingRight) || 0;
    // clientWidth includes padding but excludes the scrollbar
    const availableWidth = pre.clientWidth - padL - padR;
    const cols = charWidth > 0 ? Math.max(40, Math.floor(availableWidth / charWidth)) : 80;

    container.removeChild(root);
    return cols;
  }, []);

  // ResizeObserver: keep PTY cols in sync with the block output area.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const syncCols = () => {
      if (isFullscreen) return;

      const cols = measureBlockCols(el);

      if (cols !== blockColsRef.current) {
        // Only commit the ref value when we actually send the resize.
        // This prevents the mount-time measurement (sessionId=null) from
        // "using up" the change and silently skipping the first real resize.
        if (sessionId) {
          blockColsRef.current = cols;
          const rows = xtermRef.current?.terminal?.rows ?? 24;
          window.terminalApi
            .resizeSession(sessionId, cols, rows)
            .catch(console.error);
        }
      }
    };

    const observer = new ResizeObserver(() => {
      requestAnimationFrame(syncCols);
    });
    observer.observe(el);
    // Run immediately so we pick up the right cols before the first command.
    syncCols();

    return () => observer.disconnect();
  }, [sessionId, isFullscreen, measureBlockCols]);

  // The xterm fires its initial fitAddon.fit() / onResize while sessionId is
  // still null, so the resize is dropped. Re-fit once a session is connected
  // so the PTY gets the real cols/rows instead of the 80×24 fallback.
  useEffect(() => {
    if (!sessionId) return;
    xtermRef.current?.fit();
  }, [sessionId]);

  // Helper: scroll to the very bottom, marking the action as programmatic so
  // the scroll listener ignores it.
  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    isProgrammaticScrollRef.current = true;
    el.scrollTop = el.scrollHeight;
    // Clear the flag after the event loop tick so the scroll event (which
    // fires synchronously in the same tick in most browsers) is suppressed.
    requestAnimationFrame(() => {
      isProgrammaticScrollRef.current = false;
    });
  }, []);

  // Detect manual scroll-up so we don't yank the user back down while they're
  // reading history.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      if (isProgrammaticScrollRef.current) return; // ignore our own scrolls
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      userScrolledUpRef.current = distanceFromBottom > 60;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // A single string that changes whenever any block gains new output.
  // Using it as an effect dependency means we scroll on every output chunk,
  // not just when a new block is created.
  const outputFingerprint = useMemo(
    () => blockData.map(d => d.output.length).join(','),
    [blockData],
  );

  // New block added → re-enable auto-follow and snap to bottom.
  useEffect(() => {
    if (!autoScroll) return;
    userScrolledUpRef.current = false;
    scrollToBottom();
  }, [blockData.length, autoScroll, scrollToBottom]);

  // Streaming output → keep following the bottom unless the user scrolled up.
  useEffect(() => {
    if (!autoScroll || userScrolledUpRef.current) return;
    scrollToBottom();
  }, [outputFingerprint, autoScroll, scrollToBottom]);

  // Focus the right element when fullscreen mode changes
  useEffect(() => {
    if (isFullscreen) {
      xtermRef.current?.focus();
    }
  }, [isFullscreen]);

  const handleCommand = useCallback(
    (command: string) => {
      if (!sessionId) return;
      addBlock(command);
      window.terminalApi.sendInput(sessionId, command + '\r');
    },
    [sessionId, addBlock],
  );

  const handleXtermData = useCallback(
    (data: string) => {
      if (sessionId) window.terminalApi.sendInput(sessionId, data);
    },
    [sessionId],
  );

  const handleXtermResize = useCallback(
    (cols: number, rows: number) => {
      // In fullscreen (TUI) mode the xterm dimensions are authoritative.
      // In block mode the ResizeObserver-based measurement below drives
      // the PTY cols so commands like `ls` format for the visible width.
      if (sessionId && isFullscreen) {
        window.terminalApi.resizeSession(sessionId, cols, rows).catch(console.error);
      }
    },
    [sessionId, isFullscreen],
  );

  return (
    <div className="block-terminal-container">
      {/*
       * xterm.js instance — always mounted so it processes every byte.
       * Hidden via CSS when not in fullscreen; revealed as an overlay when
       * a TUI app takes over the alternate screen buffer.
       */}
      <div
        className={`block-terminal-xterm-overlay${
          isFullscreen ? ' block-terminal-xterm-overlay--visible' : ''
        }`}
        aria-hidden={!isFullscreen}
      >
        <Terminal
          ref={xtermRef}
          sessionId={sessionId}
          onData={handleXtermData}
          onResize={handleXtermResize}
        />
      </div>

      {/* Block list — hidden (not unmounted) during fullscreen */}
      <div
        className={`block-terminal-content${
          isFullscreen ? ' block-terminal-content--hidden' : ''
        }`}
        ref={containerRef}
      >
        {blockData.map(item => (
          <Block
            key={item.block.id}
            block={item.block}
            path={item.path}
            command={item.command}
            output={item.output}
            exitCode={item.exitCode}
            onRerun={() => handleCommand(item.command)}
          />
        ))}

        {blockData.length === 0 && (
          <div className="block-terminal-empty">
            <p>No commands executed yet</p>
          </div>
        )}
      </div>

      {showInput && !isFullscreen && (
        <BlockInput
          currentPath={currentCwd || currentPath}
          sessionId={sessionId}
          onSubmit={handleCommand}
          placeholder="Enter command..."
        />
      )}
    </div>
  );
};
