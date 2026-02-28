package session

import (
	"io"
	"os"
	"sync"
	"time"
)

// Session represents a single PTY session (shell process).
type Session struct {
	ID        string
	Shell     string
	Cwd       string
	Cols      int
	Rows      int
	PTY       *os.File    // PTY master file descriptor
	Process   interface{} // Platform-specific process handle
	CreatedAt time.Time
	State     SessionState

	// For output streaming
	outputMu sync.RWMutex
	readers  []io.Writer // Subscribers for output

	// Current command tracking
	CurrentCommandID string
	CommandStatus    string // "running", "completed", "failed"
	CommandExitCode  int

	// Cleanup function for init script
	initCleanup func()

	mu sync.RWMutex
}

// SessionState represents the current state of a session.
type SessionState string

const (
	StateRunning SessionState = "running"
	StateClosed  SessionState = "closed"
	StateExited  SessionState = "exited"
)

// SessionOptions contains options for creating a new session.
type SessionOptions struct {
	Shell string   // Optional: override default shell
	Cwd   string   // Optional: starting directory
	Cols  int      // Terminal columns
	Rows  int      // Terminal rows
	Env   []string // Optional: additional environment variables
}

// OutputChunk represents a chunk of PTY output.
type OutputChunk struct {
	SessionID string
	Data      []byte
	CommandID string // Unique identifier for the current command block
	Status    string // "running", "completed", "failed"
	ExitCode  int    // Exit code (only set when status is completed/failed)
	Timestamp time.Time
}
