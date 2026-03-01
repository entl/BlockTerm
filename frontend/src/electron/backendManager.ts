/**
 * Backend Manager - spawns and monitors the Go backend process
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { app } from 'electron';
import { EventEmitter } from 'events';
import fs from 'fs';

export type BackendStatus = 'starting' | 'ready' | 'error' | 'stopped';

export interface BackendManagerOptions {
  /** Path to the backend binary */
  binaryPath?: string;
  /** Port for gRPC server (0 = auto-assign) */
  port?: number;
  /** Max restart attempts */
  maxRestarts?: number;
  /** Restart delay in ms */
  restartDelay?: number;
  /** Dev mode: connect to existing backend instead of spawning */
  devMode?: boolean;
  /** Dev mode backend address (default: localhost:50051) */
  devModeAddress?: string;
}

export interface BackendManagerEvents {
  status: (status: BackendStatus, error?: string) => void;
  ready: (address: string) => void;
  output: (data: string) => void;
  error: (error: Error) => void;
}

export class BackendManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private status: BackendStatus = 'stopped';
  private address: string = '';
  private restartCount = 0;
  private options: Required<BackendManagerOptions>;
  private shouldRestart = true;

  constructor(options: BackendManagerOptions = {}) {
    super();
    
    // Determine backend binary path
    const defaultBinaryPath = this.getDefaultBinaryPath();
    const isDev = process.env.NODE_ENV === 'development';
    
    this.options = {
      binaryPath: options.binaryPath || defaultBinaryPath,
      port: options.port || 0,
      maxRestarts: options.maxRestarts ?? 3,
      restartDelay: options.restartDelay ?? 1000,
      devMode: options.devMode ?? isDev,
      devModeAddress: options.devModeAddress || 'localhost:50051',
    };
  }

  private getDefaultBinaryPath(): string {
    const isDev = process.env.NODE_ENV === 'development';
    
    if (isDev) {
      // Development: backend binary in backend/bin
      return path.join(app.getAppPath(), '..', 'backend', 'bin', 'server');
    } else {
      // Production: bundled in Resources/backend/
      const platform = process.platform;
      const binaryName = platform === 'win32' ? 'server.exe' : 'server';
      return path.join(process.resourcesPath, 'backend', binaryName);
    }
  }

  getStatus(): BackendStatus {
    return this.status;
  }

  getAddress(): string {
    return this.address;
  }

  private setStatus(status: BackendStatus, error?: string): void {
    this.status = status;
    this.emit('status', status, error);
  }

  async start(): Promise<string> {
    if (this.process) {
      console.log('Backend already running');
      return this.address;
    }

    // Dev mode: connect to existing backend instead of spawning
    if (this.options.devMode) {
      console.log(`Dev mode: connecting to backend at ${this.options.devModeAddress}`);
      this.address = this.options.devModeAddress;
      this.setStatus('ready');
      this.emit('ready', this.address);
      return this.address;
    }

    this.shouldRestart = true;
    return this.spawn();
  }

  private async spawn(): Promise<string> {
    return new Promise((resolve, reject) => {
      // Check if binary exists
      if (!fs.existsSync(this.options.binaryPath)) {
        const error = new Error(`Backend binary not found: ${this.options.binaryPath}`);
        this.setStatus('error', error.message);
        reject(error);
        return;
      }

      this.setStatus('starting');

      // Environment variables for backend
      const env = {
        ...process.env,
        BLOCKTERM_PORT: String(this.options.port),
      };

      console.log(`Spawning backend: ${this.options.binaryPath}`);
      
      this.process = spawn(this.options.binaryPath, [], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let startupOutput = '';
      let resolved = false;

      // Handle stdout - look for ready message with address
      this.process.stdout?.on('data', (data: Buffer) => {
        const output = data.toString();
        this.emit('output', output);
        startupOutput += output;

        // Look for ready message with address
        // Expected format: "gRPC server listening on localhost:XXXXX"
        console.log('Backend stdout:', output);
        const addressMatch = output.match(/listening at\s+\[::\]:(\d+)/i);
        console.log('Address match:', addressMatch);
        if (addressMatch && !resolved) {
          resolved = true;
          this.address = "localhost:50051";
          this.restartCount = 0;
          this.setStatus('ready');
          this.emit('ready', this.address);
          resolve(this.address);
        }
      });

      // Handle stderr
      this.process.stderr?.on('data', (data: Buffer) => {
        const output = data.toString();
        console.error('Backend stderr:', output);
        this.emit('output', output);
      });

      // Handle process exit
      this.process.on('exit', (code, signal) => {
        console.log(`Backend exited with code ${code}, signal ${signal}`);
        this.process = null;

        if (!resolved) {
          resolved = true;
          const error = new Error(`Backend failed to start: ${startupOutput}`);
          this.setStatus('error', error.message);
          reject(error);
          return;
        }

        // Attempt restart if unexpected exit
        if (this.shouldRestart && this.restartCount < this.options.maxRestarts) {
          this.restartCount++;
          console.log(`Restarting backend (attempt ${this.restartCount}/${this.options.maxRestarts})`);
          
          setTimeout(() => {
            this.spawn().catch(err => {
              console.error('Backend restart failed:', err);
            });
          }, this.options.restartDelay);
        } else {
          this.setStatus('stopped');
        }
      });

      // Handle process error
      this.process.on('error', (err) => {
        console.error('Backend process error:', err);
        this.emit('error', err);
        
        if (!resolved) {
          resolved = true;
          this.setStatus('error', err.message);
          reject(err);
        }
      });

      // Timeout for startup
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          const error = new Error(`Backend startup timeout. Output: ${startupOutput}`);
          this.setStatus('error', error.message);
          this.stop();
          reject(error);
        }
      }, 10000);
    });
  }

  stop(): void {
    this.shouldRestart = false;
    
    if (this.process) {
      console.log('Stopping backend process');
      
      // Try graceful shutdown first
      this.process.kill('SIGTERM');
      
      // Force kill after timeout
      const forceKillTimeout = setTimeout(() => {
        if (this.process) {
          console.log('Force killing backend process');
          this.process.kill('SIGKILL');
        }
      }, 5000);

      this.process.once('exit', () => {
        clearTimeout(forceKillTimeout);
      });
    }
    
    this.setStatus('stopped');
  }
}

// Singleton instance
let manager: BackendManager | null = null;

export function getBackendManager(): BackendManager {
  if (!manager) {
    manager = new BackendManager();
  }
  return manager;
}

export function createBackendManager(options?: BackendManagerOptions): BackendManager {
  if (manager) {
    manager.stop();
  }
  manager = new BackendManager(options);
  return manager;
}
