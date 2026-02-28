/**
 * gRPC Client for communicating with Go backend
 */

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';
import { app } from 'electron';
import { EventEmitter } from 'events';

// Proto file path
const PROTO_PATH = path.join(app.getAppPath(), '..', 'proto', 'blockterm.proto');

// Load proto definition
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as any;
const blockterm = protoDescriptor.blockterm;

export interface GrpcClientOptions {
  address: string;
}

export class GrpcClient extends EventEmitter {
  private terminalClient: any;
  private suggestionClient: any;
  private historyClient: any;
  private systemClient: any;
  private address: string;
  private outputStreams: Map<string, grpc.ClientReadableStream<any>> = new Map();

  constructor(options: GrpcClientOptions) {
    super();
    this.address = options.address;
    
    const credentials = grpc.credentials.createInsecure();
    
    this.terminalClient = new blockterm.TerminalService(this.address, credentials);
    this.suggestionClient = new blockterm.SuggestionService(this.address, credentials);
    this.historyClient = new blockterm.HistoryService(this.address, credentials);
    this.systemClient = new blockterm.SystemService(this.address, credentials);
  }

  // System methods
  async ping(message: string = 'ping'): Promise<string> {
    return new Promise((resolve, reject) => {
      this.systemClient.ping({ message }, (err: Error | null, response: any) => {
        if (err) {
          reject(err);
        } else {
          resolve(response.message);
        }
      });
    });
  }

  async getVersion(): Promise<{ version: string; build: string }> {
    return new Promise((resolve, reject) => {
      this.systemClient.getVersion({}, (err: Error | null, response: any) => {
        if (err) {
          reject(err);
        } else {
          resolve({ version: response.version, build: response.build });
        }
      });
    });
  }

  // Terminal session methods
  async startSession(options: {
    shell?: string;
    cwd?: string;
    env?: Record<string, string>;
  }): Promise<string> {
    return new Promise((resolve, reject) => {
      this.terminalClient.startSession(
        {
          shell: options.shell || '',
          cwd: options.cwd || '',
          env: options.env || {},
        },
        (err: Error | null, response: any) => {
          if (err) {
            reject(err);
          } else {
            resolve(response.sessionId);
          }
        }
      );
    });
  }

  async closeSession(sessionId: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      this.terminalClient.closeSession({ sessionId }, (err: Error | null, response: any) => {
        if (err) {
          reject(err);
        } else {
          resolve(response.ok);
        }
      });
    });
  }

  async resizeSession(sessionId: string, cols: number, rows: number): Promise<boolean> {
    return new Promise((resolve, reject) => {
      this.terminalClient.resizeSession(
        { sessionId, cols, rows },
        (err: Error | null, response: any) => {
          if (err) {
            reject(err);
          } else {
            resolve(response.ok);
          }
        }
      );
    });
  }

  // Start bidirectional input stream
  createInputStream(): grpc.ClientWritableStream<any> {
    const stream = this.terminalClient.sendInput((err: Error | null, _response: any) => {
      if (err) {
        console.error('Input stream error:', err);
      }
    });
    return stream;
  }

  // Send input to a session
  sendInput(sessionId: string, data: Buffer | string): void {
    const inputData = typeof data === 'string' ? Buffer.from(data) : data;
    
    // Create a streaming call for input
    const stream = this.terminalClient.sendInput((err: Error | null) => {
      if (err) {
        console.error('SendInput error:', err);
      }
    });
    
    stream.write({ sessionId, data: inputData });
    stream.end();
  }

  // Subscribe to output stream for a session
  subscribeOutput(
    sessionId: string,
    onData: (data: Uint8Array) => void,
    onError?: (err: Error) => void,
    onEnd?: () => void
  ): () => void {
    // Cancel existing stream for this session if any
    this.unsubscribeOutput(sessionId);

    const stream = this.terminalClient.receiveOutput({ sessionId });
    this.outputStreams.set(sessionId, stream);

    stream.on('data', (chunk: any) => {
      if (chunk.data) {
        onData(chunk.data);
      }
    });

    stream.on('error', (err: Error) => {
      console.error(`Output stream error for session ${sessionId}:`, err);
      this.outputStreams.delete(sessionId);
      onError?.(err);
    });

    stream.on('end', () => {
      this.outputStreams.delete(sessionId);
      onEnd?.();
    });

    // Return unsubscribe function
    return () => this.unsubscribeOutput(sessionId);
  }

  unsubscribeOutput(sessionId: string): void {
    const stream = this.outputStreams.get(sessionId);
    if (stream) {
      stream.cancel();
      this.outputStreams.delete(sessionId);
    }
  }

  // Suggestion methods
  async getSuggestions(
    sessionId: string,
    input: string,
    cursorPos: number
  ): Promise<Array<{ text: string; source: string; score: number }>> {
    return new Promise((resolve, reject) => {
      this.suggestionClient.getSuggestions(
        { sessionId, input, cursorPos },
        (err: Error | null, response: any) => {
          if (err) {
            reject(err);
          } else {
            resolve(response.suggestions || []);
          }
        }
      );
    });
  }

  // History methods
  async recordCommand(
    sessionId: string,
    command: string,
    cwd: string,
    exitCode: number,
    timestamp: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      this.historyClient.recordCommand(
        { sessionId, command, cwd, exitCode, timestamp },
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  async queryHistory(
    query: string,
    limit: number
  ): Promise<Array<{
    sessionId: string;
    command: string;
    cwd: string;
    exitCode: number;
    timestamp: number;
  }>> {
    return new Promise((resolve, reject) => {
      this.historyClient.queryHistory({ query, limit }, (err: Error | null, response: any) => {
        if (err) {
          reject(err);
        } else {
          const entries = (response.entries || []).map((entry: any) => ({
            sessionId: entry.sessionId,
            command: entry.command,
            cwd: entry.cwd,
            exitCode: entry.exitCode,
            timestamp: Number(entry.timestamp),
          }));
          resolve(entries);
        }
      });
    });
  }

  // Cleanup
  close(): void {
    // Cancel all output streams
    for (const [sessionId] of this.outputStreams) {
      this.unsubscribeOutput(sessionId);
    }
    
    // Close all clients
    grpc.closeClient(this.terminalClient);
    grpc.closeClient(this.suggestionClient);
    grpc.closeClient(this.historyClient);
    grpc.closeClient(this.systemClient);
  }
}

// Singleton instance
let client: GrpcClient | null = null;

export function getGrpcClient(): GrpcClient | null {
  return client;
}

export function createGrpcClient(address: string): GrpcClient {
  if (client) {
    client.close();
  }
  client = new GrpcClient({ address });
  return client;
}

export function closeGrpcClient(): void {
  if (client) {
    client.close();
    client = null;
  }
}
