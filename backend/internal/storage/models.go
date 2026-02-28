package storage

import (
	"time"
)

// Command represents a single command execution in the history.
type Command struct {
	ID          int64
	Timestamp   time.Time
	SessionID   string
	Shell       string
	Cwd         string
	CommandText string
	ExitCode    *int // nullable, may not be available immediately
}

// QueryOptions provides filtering options for command queries.
type QueryOptions struct {
	SessionID string
	Limit     int
	Pattern   string // for prefix/fuzzy search
}
