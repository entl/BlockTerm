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

import React, { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import { Block } from '../Block';
import { BlockInput } from '../BlockInput';
import { Terminal, type TerminalRef } from '../Terminal';
import { SearchBar, type SearchMatch } from '../SearchBar';
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
  const { blockData, isFullscreen, currentCwd, isCommandRunning, addBlock } = useBlocks({ sessionId, currentPath });

  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<TerminalRef>(null);
  // True when the user has deliberately scrolled upward.
  const userScrolledUpRef = useRef(false);
  
  // Block selection state
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);

  // Search state
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatchCase, setSearchMatchCase] = useState(false);
  const [searchRegex, setSearchRegex] = useState(false);
  const [searchScope, setSearchScope] = useState<'current' | 'all'>('all');
  const [searchMatches, setSearchMatches] = useState<SearchMatch[]>([]);
  const [currentSearchIndex, setCurrentSearchIndex] = useState(0);
  // True while we are programmatically setting scrollTop so the scroll
  // listener does not misinterpret our own scroll events as user intent.
  const isProgrammaticScrollRef = useRef(false);

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

  // Click handler: select / deselect a block
  const handleBlockClick = useCallback((blockId: string) => {
    setSelectedBlockId(prev => prev === blockId ? null : blockId);
  }, []);

  // Keep a ref to blockData so the search callback can always read the
  // latest data without having blockData as a dependency (which would
  // recreate the callback on every output chunk → re-trigger search →
  // reset currentSearchIndex to 0).
  const blockDataRef = useRef(blockData);
  blockDataRef.current = blockData;

  // Search functionality
  const handleSearch = useCallback(
    (query: string, matchCase: boolean, regex: boolean): SearchMatch[] => {
      setSearchQuery(query);
      setSearchMatchCase(matchCase);
      setSearchRegex(regex);

      if (!query) {
        setSearchMatches([]);
        setCurrentSearchIndex(0);
        return [];
      }

      const matches: SearchMatch[] = [];
      let pattern: RegExp;

      try {
        if (regex) {
          pattern = new RegExp(query, matchCase ? 'g' : 'gi');
        } else {
          const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          pattern = new RegExp(escaped, matchCase ? 'g' : 'gi');
        }

        // Read latest block data from ref (not a dep → no cascade)
        const currentBlockData = blockDataRef.current;

        // Filter blocks by scope
        const searchBlocks = searchScope === 'current' && selectedBlockId
          ? currentBlockData.filter(item => item.block.id === selectedBlockId)
          : currentBlockData;

        searchBlocks.forEach((item) => {
          // Search in command text
          if (item.command) {
            let match;
            pattern.lastIndex = 0;
            while ((match = pattern.exec(item.command)) !== null) {
              matches.push({
                blockId: item.block.id,
                area: 'command',
                index: match.index,
                length: match[0].length,
                line: 0,
                preview: item.command,
              });
            }
          }

          // Search in output text — count every occurrence so the
          // index aligns with how Block.tsx highlights matches.
          if (item.output) {
            const lines = item.output.split('\n');
            lines.forEach((line, lineIndex) => {
              let match;
              pattern.lastIndex = 0;
              while ((match = pattern.exec(line)) !== null) {
                matches.push({
                  blockId: item.block.id,
                  area: 'output',
                  index: match.index,
                  length: match[0].length,
                  line: lineIndex,
                  preview: line.slice(Math.max(0, match.index - 20), match.index + match[0].length + 20),
                });
              }
            });
          }
        });

        setSearchMatches(matches);
        setCurrentSearchIndex(matches.length > 0 ? 0 : -1);
        return matches;
      } catch (err) {
        // Invalid regex
        setSearchMatches([]);
        setCurrentSearchIndex(0);
        return [];
      }
    },
    [searchScope, selectedBlockId]
  );

  const handleSearchNavigate = useCallback(
    (direction: 'next' | 'prev') => {
      if (searchMatches.length === 0) return;

      const newIndex = direction === 'next'
        ? (currentSearchIndex + 1) % searchMatches.length
        : (currentSearchIndex - 1 + searchMatches.length) % searchMatches.length;

      setCurrentSearchIndex(newIndex);

      // Scroll the matching block into view
      const match = searchMatches[newIndex];
      if (match) {
        const blockEl = document.querySelector(`[data-block-id="${match.blockId}"]`);
        blockEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    },
    [searchMatches, currentSearchIndex]
  );

  // Keyboard shortcut for search (Ctrl/Cmd+F)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        setSearchVisible((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleCommand = useCallback(
    (command: string) => {
      if (!sessionId) return;
      // If a command is already running (e.g. git asking for credentials),
      // send input directly to the PTY without creating a new block.
      if (!isCommandRunning) {
        addBlock(command);
      }
      window.terminalApi.sendInput(sessionId, command + '\r');
    },
    [sessionId, addBlock, isCommandRunning],
  );

  const handleXtermData = useCallback(
    (data: string) => {
      if (sessionId) window.terminalApi.sendInput(sessionId, data);
    },
    [sessionId],
  );

  const handleXtermResize = useCallback(
    (cols: number, rows: number) => {
      if (sessionId) window.terminalApi.resizeSession(sessionId, cols, rows).catch(console.error);
    },
    [sessionId],
  );

  // Get current search query for highlighting
  const currentSearchMatch = searchMatches[currentSearchIndex];

  return (
    <div className="block-terminal-container">
      {/* Search bar */}
      <SearchBar
        visible={searchVisible && !isFullscreen}
        onClose={() => setSearchVisible(false)}
        onSearch={handleSearch}
        totalMatches={searchMatches.length}
        currentMatchIndex={currentSearchIndex}
        onNavigate={handleSearchNavigate}
        scope={searchScope}
        onScopeChange={(s) => setSearchScope(s)}
      />

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
        {blockData.map((item, idx) => {
          // Calculate match index for this block, separately for command & output
          const blockCommandMatches = searchMatches.filter(m => m.blockId === item.block.id && m.area === 'command');
          const blockOutputMatches = searchMatches.filter(m => m.blockId === item.block.id && m.area === 'output');
          const commandMatchIndex = blockCommandMatches.length > 0 && currentSearchMatch?.blockId === item.block.id && currentSearchMatch?.area === 'command'
            ? blockCommandMatches.indexOf(currentSearchMatch)
            : -1;
          const outputMatchIndex = blockOutputMatches.length > 0 && currentSearchMatch?.blockId === item.block.id && currentSearchMatch?.area === 'output'
            ? blockOutputMatches.indexOf(currentSearchMatch)
            : -1;

          // Only show highlights on blocks that are in search scope
          const inSearchScope = searchScope === 'all' || item.block.id === selectedBlockId;

          return (
            <Block
              key={item.block.id}
              block={item.block}
              path={item.path}
              command={item.command}
              output={item.output}
              exitCode={item.exitCode}
              onRerun={() => handleCommand(item.command)}
              selected={selectedBlockId === item.block.id}
              onClick={() => handleBlockClick(item.block.id)}
              searchQuery={searchVisible && inSearchScope ? searchQuery : undefined}
              searchMatchCase={searchMatchCase}
              searchRegex={searchRegex}
              currentCommandMatchIndex={commandMatchIndex}
              currentOutputMatchIndex={outputMatchIndex}
            />
          );
        })}

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
          isPassthrough={isCommandRunning}
        />
      )}
    </div>
  );
};
