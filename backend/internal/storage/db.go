package storage

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	_ "modernc.org/sqlite"
)

// DB wraps the SQLite database connection and provides methods for storage operations.
type DB struct {
	conn *sql.DB
}

// NewDB opens/creates a SQLite database at the given path and initializes schema.
// Pass ":memory:" for in-memory database (useful for tests).
func NewDB(dbPath string) (*DB, error) {
	conn, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	// Enable WAL mode for better concurrency
	if _, err := conn.Exec("PRAGMA journal_mode=WAL"); err != nil {
		conn.Close()
		return nil, fmt.Errorf("failed to enable WAL mode: %w", err)
	}

	db := &DB{conn: conn}
	if err := db.initSchema(); err != nil {
		conn.Close()
		return nil, fmt.Errorf("failed to initialize schema: %w", err)
	}

	return db, nil
}

// initSchema creates the necessary tables if they don't exist.
func (db *DB) initSchema() error {
	schema := `
	CREATE TABLE IF NOT EXISTS commands (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		ts INTEGER NOT NULL,
		session_id TEXT NOT NULL,
		shell TEXT NOT NULL,
		cwd TEXT,
		cmd_text TEXT NOT NULL,
		exit_code INTEGER,
		created_at INTEGER NOT NULL
	);

	CREATE INDEX IF NOT EXISTS idx_commands_ts ON commands(ts DESC);
	CREATE INDEX IF NOT EXISTS idx_commands_session ON commands(session_id);
	CREATE INDEX IF NOT EXISTS idx_commands_text ON commands(cmd_text);
	`

	_, err := db.conn.Exec(schema)
	return err
}

// Close closes the database connection.
func (db *DB) Close() error {
	if db.conn != nil {
		return db.conn.Close()
	}
	return nil
}

// InsertCommand inserts a new command record into the database.
func (db *DB) InsertCommand(ctx context.Context, cmd *Command) error {
	query := `
		INSERT INTO commands (ts, session_id, shell, cwd, cmd_text, exit_code, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`

	result, err := db.conn.ExecContext(ctx, query,
		cmd.Timestamp.Unix(),
		cmd.SessionID,
		cmd.Shell,
		cmd.Cwd,
		cmd.CommandText,
		cmd.ExitCode,
		time.Now().Unix(),
	)
	if err != nil {
		return fmt.Errorf("failed to insert command: %w", err)
	}

	id, err := result.LastInsertId()
	if err != nil {
		return fmt.Errorf("failed to get last insert id: %w", err)
	}

	cmd.ID = id
	return nil
}

// GetRecentCommands retrieves the N most recent commands.
func (db *DB) GetRecentCommands(ctx context.Context, limit int) ([]*Command, error) {
	query := `
		SELECT id, ts, session_id, shell, cwd, cmd_text, exit_code
		FROM commands
		ORDER BY ts DESC
		LIMIT ?
	`

	rows, err := db.conn.QueryContext(ctx, query, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to query recent commands: %w", err)
	}
	defer rows.Close()

	return db.scanCommands(rows)
}

// SearchCommands searches for commands matching a prefix or containing a substring.
func (db *DB) SearchCommands(ctx context.Context, pattern string, limit int) ([]*Command, error) {
	query := `
		SELECT id, ts, session_id, shell, cwd, cmd_text, exit_code
		FROM commands
		WHERE cmd_text LIKE ?
		ORDER BY ts DESC
		LIMIT ?
	`

	rows, err := db.conn.QueryContext(ctx, query, pattern+"%", limit)
	if err != nil {
		return nil, fmt.Errorf("failed to search commands: %w", err)
	}
	defer rows.Close()

	return db.scanCommands(rows)
}

// GetCommandsBySession retrieves all commands for a specific session.
func (db *DB) GetCommandsBySession(ctx context.Context, sessionID string, limit int) ([]*Command, error) {
	query := `
		SELECT id, ts, session_id, shell, cwd, cmd_text, exit_code
		FROM commands
		WHERE session_id = ?
		ORDER BY ts DESC
		LIMIT ?
	`

	rows, err := db.conn.QueryContext(ctx, query, sessionID, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to query commands by session: %w", err)
	}
	defer rows.Close()

	return db.scanCommands(rows)
}

// scanCommands is a helper that scans rows into Command structs.
func (db *DB) scanCommands(rows *sql.Rows) ([]*Command, error) {
	var commands []*Command

	for rows.Next() {
		var cmd Command
		var tsUnix int64
		var exitCode sql.NullInt64

		err := rows.Scan(
			&cmd.ID,
			&tsUnix,
			&cmd.SessionID,
			&cmd.Shell,
			&cmd.Cwd,
			&cmd.CommandText,
			&exitCode,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan command row: %w", err)
		}

		cmd.Timestamp = time.Unix(tsUnix, 0)
		if exitCode.Valid {
			val := int(exitCode.Int64)
			cmd.ExitCode = &val
		}

		commands = append(commands, &cmd)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating command rows: %w", err)
	}

	return commands, nil
}

// UpdateExitCode updates the exit code for a command.
func (db *DB) UpdateExitCode(ctx context.Context, cmdID int64, exitCode int) error {
	query := `UPDATE commands SET exit_code = ? WHERE id = ?`

	_, err := db.conn.ExecContext(ctx, query, exitCode, cmdID)
	if err != nil {
		return fmt.Errorf("failed to update exit code: %w", err)
	}

	return nil
}
