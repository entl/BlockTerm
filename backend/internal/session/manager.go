package session

import (
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"sync"
	"time"

	"github.com/creack/pty"
	"github.com/google/uuid"
)

// Manager manages multiple PTY sessions.
type Manager struct {
	sessions map[string]*Session
	mu       sync.RWMutex
}

// NewManager creates a new session manager.
func NewManager() *Manager {
	return &Manager{
		sessions: make(map[string]*Session),
	}
}

// StartSession creates and starts a new PTY session.
func (m *Manager) StartSession(opts SessionOptions) (*Session, error) {
	// Apply defaults
	if opts.Cols == 0 {
		return nil, fmt.Errorf("cols must be greater than 0")
	}
	if opts.Rows == 0 {
		return nil, fmt.Errorf("rows must be greater than 0")
	}
	if opts.Shell == "" {
		opts.Shell = defaultShell()
	}
	if opts.Cwd == "" {
		opts.Cwd = homeDir()
	}

	// Create the session
	sessionID := uuid.New().String()
	session := &Session{
		ID:        sessionID,
		Shell:     opts.Shell,
		Cwd:       opts.Cwd,
		Cols:      opts.Cols,
		Rows:      opts.Rows,
		CreatedAt: time.Now(),
		State:     StateRunning,
		readers:   make([]io.Writer, 0),
	}

	// Prepare shell command with initialization script
	shellPath, shellArgs, cleanup, err := prepareShellCommand(opts.Shell)
	if err != nil {
		return nil, fmt.Errorf("failed to prepare shell command: %w", err)
	}
	if cleanup != nil {
		// Store cleanup function to be called when session closes
		session.initCleanup = cleanup
	}

	// Spawn PTY with shell
	var cmd *exec.Cmd
	if len(shellArgs) > 0 {
		cmd = exec.Command(shellPath, shellArgs...)
	} else {
		cmd = exec.Command(shellPath)
	}
	cmd.Dir = opts.Cwd
	cmd.Env = append(os.Environ(), opts.Env...)
	cmd.Env = append(cmd.Env, getEnvSetup()...)

	// Start the command with PTY
	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{
		Rows: uint16(opts.Rows),
		Cols: uint16(opts.Cols),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to start PTY: %w", err)
	}

	session.PTY = ptmx
	session.Process = cmd.Process

	// Store session
	m.mu.Lock()
	m.sessions[sessionID] = session
	m.mu.Unlock()

	// Start output reader goroutine
	go m.readOutput(session)

	// Monitor process exit
	go m.monitorProcess(session, cmd)

	return session, nil
}

// GetSession retrieves a session by ID.
func (m *Manager) GetSession(sessionID string) (*Session, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	session, ok := m.sessions[sessionID]
	if !ok {
		return nil, fmt.Errorf("session not found: %s", sessionID)
	}
	return session, nil
}

// CloseSession closes a session and cleans up resources.
func (m *Manager) CloseSession(sessionID string) error {
	m.mu.Lock()
	session, ok := m.sessions[sessionID]
	if !ok {
		m.mu.Unlock()
		return fmt.Errorf("session not found: %s", sessionID)
	}
	delete(m.sessions, sessionID)
	m.mu.Unlock()

	session.mu.Lock()
	defer session.mu.Unlock()

	if session.State == StateClosed {
		return nil // already closed
	}

	session.State = StateClosed

	// Close PTY
	if session.PTY != nil {
		session.PTY.Close()
	}

	// Kill process if still running
	if session.Process != nil {
		if proc, ok := session.Process.(*os.Process); ok {
			proc.Kill()
		}
	}

	// Clean up init script file
	if session.initCleanup != nil {
		session.initCleanup()
	}

	return nil
}

// ResizeSession updates the terminal size for a session.
func (m *Manager) ResizeSession(sessionID string, cols, rows int) error {
	session, err := m.GetSession(sessionID)
	if err != nil {
		return err
	}

	session.mu.Lock()
	defer session.mu.Unlock()

	if session.State != StateRunning {
		return fmt.Errorf("session is not running: %s", sessionID)
	}

	session.Cols = cols
	session.Rows = rows

	// Resize PTY
	if session.PTY != nil {
		return pty.Setsize(session.PTY, &pty.Winsize{
			Rows: uint16(rows),
			Cols: uint16(cols),
		})
	}

	return nil
}

// WriteInput writes input bytes to a session's PTY.
func (m *Manager) WriteInput(sessionID string, data []byte) error {
	session, err := m.GetSession(sessionID)
	if err != nil {
		return err
	}

	session.mu.RLock()
	defer session.mu.RUnlock()

	if session.State != StateRunning {
		return fmt.Errorf("session is not running: %s", sessionID)
	}

	if session.PTY == nil {
		return fmt.Errorf("session PTY is nil: %s", sessionID)
	}

	_, err = session.PTY.Write(data)
	return err
}

// AddOutputWriter adds a writer to receive session output.
func (m *Manager) AddOutputWriter(sessionID string, writer io.Writer) error {
	session, err := m.GetSession(sessionID)
	if err != nil {
		return err
	}

	session.outputMu.Lock()
	defer session.outputMu.Unlock()

	session.readers = append(session.readers, writer)
	return nil
}

// readOutput continuously reads from PTY and broadcasts to subscribers.
func (m *Manager) readOutput(session *Session) {
	buf := make([]byte, 4096) // 4KB chunks

	for {
		session.mu.RLock()
		if session.State != StateRunning || session.PTY == nil {
			session.mu.RUnlock()
			break
		}
		pty := session.PTY
		session.mu.RUnlock()

		n, err := pty.Read(buf)
		if err != nil {
			if err != io.EOF {
				log.Printf("session %s: error reading PTY: %v", session.ID, err)
			}
			break
		}

		if n > 0 {
			data := make([]byte, n)
			copy(data, buf[:n])

			// Broadcast raw output to all subscribers (including markers)
			session.outputMu.RLock()
			for _, writer := range session.readers {
				_, _ = writer.Write(data)
			}
			session.outputMu.RUnlock()
		}
	}

	log.Printf("session %s: output reader stopped", session.ID)
}

// monitorProcess watches the shell process and updates session state on exit.
func (m *Manager) monitorProcess(session *Session, cmd *exec.Cmd) {
	err := cmd.Wait()

	session.mu.Lock()
	if session.State == StateRunning {
		session.State = StateExited
	}
	session.mu.Unlock()

	if err != nil {
		log.Printf("session %s: process exited with error: %v", session.ID, err)
	} else {
		log.Printf("session %s: process exited normally", session.ID)
	}

	// Cleanup from manager
	m.mu.Lock()
	delete(m.sessions, session.ID)
	m.mu.Unlock()
}

// ListSessions returns all active sessions.
func (m *Manager) ListSessions() []*Session {
	m.mu.RLock()
	defer m.mu.RUnlock()

	sessions := make([]*Session, 0, len(m.sessions))
	for _, s := range m.sessions {
		sessions = append(sessions, s)
	}
	return sessions
}

// Close closes all sessions and cleans up resources.
func (m *Manager) Close() error {
	m.mu.RLock()
	sessionIDs := make([]string, 0, len(m.sessions))
	for id := range m.sessions {
		sessionIDs = append(sessionIDs, id)
	}
	m.mu.RUnlock()

	for _, id := range sessionIDs {
		if err := m.CloseSession(id); err != nil {
			log.Printf("error closing session %s: %v", id, err)
		}
	}

	return nil
}
