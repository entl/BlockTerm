/// <reference types="vite/client" />

import type { TerminalApi } from '../shared/terminalApi';

declare global {
  interface Window {
    terminalApi: TerminalApi;
  }
}
