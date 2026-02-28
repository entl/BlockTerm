package history

import (
	"context"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/entl/blockterm/internal/storage"
)

// Service manages command history persistence.
// It provides async writes to avoid blocking PTY operations.
type Service struct {
	db       *storage.DB
	writeCh  chan *writeRequest
	wg       sync.WaitGroup
	stopOnce sync.Once
	stopCh   chan struct{}
}

// writeRequest encapsulates a command to be written to storage.
type writeRequest struct {
	cmd      *storage.Command
	resultCh chan error // optional, for callers who want confirmation
}

// NewService creates a new history service with the given storage backend.
// It starts a background goroutine for async writes.
func NewService(db *storage.DB) *Service {
	svc := &Service{
		db:      db,
		writeCh: make(chan *writeRequest, 100), // buffered to handle bursts
		stopCh:  make(chan struct{}),
	}

	svc.wg.Add(1)
	go svc.writeWorker()

	return svc
}

// writeWorker processes write requests in the background.
func (s *Service) writeWorker() {
	defer s.wg.Done()

	for {
		select {
		case req := <-s.writeCh:
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			err := s.db.InsertCommand(ctx, req.cmd)
			cancel()

			if err != nil {
				log.Printf("history: failed to insert command: %v", err)
			}

			// Notify caller if they're waiting for result
			if req.resultCh != nil {
				req.resultCh <- err
				close(req.resultCh)
			}

		case <-s.stopCh:
			// Drain remaining writes before exiting
			for {
				select {
				case req := <-s.writeCh:
					ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
					err := s.db.InsertCommand(ctx, req.cmd)
					cancel()

					if err != nil {
						log.Printf("history: failed to insert command during shutdown: %v", err)
					}

					if req.resultCh != nil {
						req.resultCh <- err
						close(req.resultCh)
					}
				default:
					return
				}
			}
		}
	}
}

// RecordCommand asynchronously persists a command to storage.
// The command text is sanitized before storage.
func (s *Service) RecordCommand(sessionID, shell, cwd, cmdText string) {
	sanitized := sanitizeCommand(cmdText)
	if sanitized == "" {
		return // skip empty commands
	}

	cmd := &storage.Command{
		Timestamp:   time.Now(),
		SessionID:   sessionID,
		Shell:       shell,
		Cwd:         cwd,
		CommandText: sanitized,
	}

	select {
	// enqueue write request to write channel
	case s.writeCh <- &writeRequest{cmd: cmd}:
		// queued successfully
	default:
		log.Printf("history: write buffer full, dropping command: %s", sanitized)
	}
}

// RecordCommandSync synchronously persists a command and waits for completion.
// Returns an error if the write fails. Use sparingly.
func (s *Service) RecordCommandSync(sessionID, shell, cwd, cmdText string) error {
	sanitized := sanitizeCommand(cmdText)
	if sanitized == "" {
		return nil
	}

	cmd := &storage.Command{
		Timestamp:   time.Now(),
		SessionID:   sessionID,
		Shell:       shell,
		Cwd:         cwd,
		CommandText: sanitized,
	}

	resultCh := make(chan error, 1)
	req := &writeRequest{cmd: cmd, resultCh: resultCh}

	select {
	case s.writeCh <- req:
		return <-resultCh
	default:
		return nil // drop if buffer full
	}
}

// UpdateExitCode updates the exit code for a recently recorded command.
// This is called after a command completes and we detect its exit status.
func (s *Service) UpdateExitCode(cmdID int64, exitCode int) error {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	return s.db.UpdateExitCode(ctx, cmdID, exitCode)
}

// GetRecent retrieves the N most recent commands from history.
func (s *Service) GetRecent(ctx context.Context, limit int) ([]*storage.Command, error) {
	return s.db.GetRecentCommands(ctx, limit)
}

// Search finds commands matching the given pattern (prefix search).
func (s *Service) Search(ctx context.Context, pattern string, limit int) ([]*storage.Command, error) {
	return s.db.SearchCommands(ctx, pattern, limit)
}

// GetBySession retrieves commands for a specific session.
func (s *Service) GetBySession(ctx context.Context, sessionID string, limit int) ([]*storage.Command, error) {
	return s.db.GetCommandsBySession(ctx, sessionID, limit)
}

// Close gracefully shuts down the history service.
// It waits for pending writes to complete.
func (s *Service) Close() error {
	s.stopOnce.Do(func() {
		close(s.stopCh)
		s.wg.Wait()
	})
	return nil
}

// sanitizeCommand cleans command text before storage.
// It trims whitespace and filters out potentially sensitive patterns.
func sanitizeCommand(cmdText string) string {
	// Trim leading/trailing whitespace and newlines
	cleaned := strings.TrimSpace(cmdText)

	// Skip commands that are just whitespace
	if cleaned == "" {
		return ""
	}

	// TODO: Add optional filtering for sensitive patterns
	// e.g., commands containing "password", "token", "secret", etc.
	// For now, store as-is but this can be extended.

	return cleaned
}
