import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
/**
 * Find the index of a trailing incomplete ANSI escape sequence in `s`.
 * Returns the start index of the partial sequence, or -1 if the string
 * ends cleanly.  Used to buffer partial escape sequences across PTY
 * output chunks so that `cleanTerminalOutput` can always process
 * complete sequences.
 */
export function findTrailingPartialEscape(s: string): number {
  const lastEsc = s.lastIndexOf('\x1b');
  // Only consider ESC within the last ~20 bytes (no single sequence is longer)
  if (lastEsc === -1 || lastEsc < s.length - 20) return -1;

  const tail = s.slice(lastEsc);

  // Lone ESC at the very end
  if (tail.length === 1) return lastEsc;

  // CSI sequence: \x1b[ <params> <final_byte in @-~>
  if (tail[1] === '[') {
    return /^\x1b\[[0-?]*[ -/]*[@-~]/.test(tail) ? -1 : lastEsc;
  }

  // OSC sequence: \x1b] ... BEL or ST
  if (tail[1] === ']') {
    return (tail.includes('\x07') || tail.indexOf('\x1b\\', 2) !== -1)
      ? -1
      : lastEsc;
  }

  // Any other 2-byte escape (SS2, SS3, RIS, etc.) is complete
  return -1;
}

/**
 * Clean terminal output by removing ANSI/VT100 control sequences, normalising
 * line endings, and handling backspaces.  Deliberately does NOT strip trailing
 * spaces from individual lines — they carry column-alignment information (e.g.
 * `ls` output).
 */
export function cleanTerminalOutput(raw: string): string {
  let s = raw
    // Normalize CRLF and standalone CR to LF
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // CSI sequences – covers SGR (colors), cursor movement, erase, etc.
    // e.g. \x1b[0m  \x1b[1;34m  \x1b[2J  \x1b[K  \x1b[?2004h
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    // OSC sequences – terminal title, hyperlinks, color palette, etc.
    // \x1b]...\x07  or  \x1b]...\x1b\
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    // Other two-character escape sequences (SS2/SS3, RIS, index, …)
    .replace(/\x1b[@-_]/g, '')
    // Any remaining lone ESC followed by one character
    .replace(/\x1b./g, '');

  // Handle backspaces (character-by-character for correctness)
  const out: string[] = [];
  for (const c of s) {
    if (c === '\b') out.pop();
    else out.push(c);
  }
  s = out.join('');

  // Trim only leading/trailing blank lines, not internal content
  return s.replace(/^\n+/, '').replace(/\n+$/, '');
}