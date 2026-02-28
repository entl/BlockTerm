/**
 * Hook for tracking and buffering the current command line
 * Handles character input, backspace, special keys, etc.
 */

import { useState, useRef, useCallback } from 'react';

export interface CommandBuffer {
  text: string;
  cursorPos: number;
}

export function useCommandBuffer() {
  const [buffer, setBuffer] = useState<CommandBuffer>({ text: '', cursorPos: 0 });
  
  // Track if we're in a command (not in fullscreen app like vim)
  const isInCommandRef = useRef(true);
  
  /**
   * Process input from terminal and update buffer
   * Handles regular characters, backspace (\x7f), etc.
   */
  const processInput = useCallback((data: string) => {
    setBuffer(prev => {
      let newText = prev.text;
      let newCursorPos = prev.cursorPos;

      for (const char of data) {
        if (char === '\r' || char === '\n') {
          // Enter pressed - clear buffer after command execution
          // (Optional: we could keep history here)
          newText = '';
          newCursorPos = 0;
        } else if (char === '\x7f' || char === '\b') {
          // Backspace
          if (newCursorPos > 0) {
            newText = newText.slice(0, newCursorPos - 1) + newText.slice(newCursorPos);
            newCursorPos--;
          }
        } else if (char === '\x03' || char === '\x04') {
          // Ctrl+C or Ctrl+D - clear buffer
          newText = '';
          newCursorPos = 0;
        } else if (char === '\x01') {
          // Ctrl+A - move to start
          newCursorPos = 0;
        } else if (char === '\x05') {
          // Ctrl+E - move to end
          newCursorPos = newText.length;
        } else if (char === '\x08') {
          // Backspace (alternate code)
          if (newCursorPos > 0) {
            newText = newText.slice(0, newCursorPos - 1) + newText.slice(newCursorPos);
            newCursorPos--;
          }
        } else if (char.charCodeAt(0) >= 32) {
          // Printable character
          newText = newText.slice(0, newCursorPos) + char + newText.slice(newCursorPos);
          newCursorPos++;
        }
        // Ignore other control characters
      }

      return { text: newText, cursorPos: newCursorPos };
    });
  }, []);

  /**
   * Clear buffer (called when entering fullscreen app or command finishes)
   */
  const clear = useCallback(() => {
    setBuffer({ text: '', cursorPos: 0 });
  }, []);

  /**
   * Get current command and cursor position
   */
  const getCurrent = useCallback(() => {
    return buffer;
  }, [buffer]);

  return {
    buffer,
    processInput,
    clear,
    getCurrent,
    setIsInCommand: (inCommand: boolean) => {
      isInCommandRef.current = inCommand;
    },
    isInCommand: () => isInCommandRef.current,
  };
}
