package suggest

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"strings"

	pb "github.com/entl/blockterm/gen/proto"
	"github.com/entl/blockterm/internal/session"
)

// FilesystemProvider provides file and directory suggestions based on current input.
type FilesystemProvider struct {
	sessionMgr *session.Manager
}

// NewFilesystemProvider creates a new filesystem suggestion provider.
func NewFilesystemProvider(sessionMgr *session.Manager) *FilesystemProvider {
	return &FilesystemProvider{
		sessionMgr: sessionMgr,
	}
}

// Name returns the provider name.
func (p *FilesystemProvider) Name() string {
	return "filesystem"
}

// GetSuggestions returns filesystem suggestions based on input token.
func (p *FilesystemProvider) GetSuggestions(ctx context.Context, input string, cursorPos int, sessionID string) ([]*pb.Suggestion, error) {
	if input == "" {
		return nil, nil
	}

	// Get current working directory from session
	cwd := homeDir()
	if sessionID != "" {
		if sess, err := p.sessionMgr.GetSession(sessionID); err == nil {
			cwd = sess.Cwd
		}
	}

	// Determine the path to complete
	pathToComplete := input

	// Handle relative vs absolute paths
	var basePath string
	var prefix string

	if filepath.IsAbs(pathToComplete) {
		// Absolute path
		basePath = filepath.Dir(pathToComplete)
		prefix = filepath.Base(pathToComplete)
	} else if strings.HasPrefix(pathToComplete, "~") {
		// Home directory expansion
		home := homeDir()
		expanded := strings.Replace(pathToComplete, "~", home, 1)
		basePath = filepath.Dir(expanded)
		prefix = filepath.Base(expanded)
	} else if strings.Contains(pathToComplete, string(os.PathSeparator)) {
		// Relative path with directory component
		basePath = filepath.Join(cwd, filepath.Dir(pathToComplete))
		prefix = filepath.Base(pathToComplete)
	} else {
		// Simple filename/dirname in current directory
		basePath = cwd
		prefix = pathToComplete
	}

	// Read directory contents
	entries, err := os.ReadDir(basePath)
	if err != nil {
		return nil, nil // Directory doesn't exist or not accessible
	}

	var suggestions []*pb.Suggestion
	lowerPrefix := strings.ToLower(prefix)

	for _, entry := range entries {
		name := entry.Name()
		lowerName := strings.ToLower(name)

		// Match if prefix is empty or name starts with prefix (case-insensitive)
		if prefix == "" || strings.HasPrefix(lowerName, lowerPrefix) {
			// Build the completion text
			var completionText string
			if filepath.IsAbs(pathToComplete) {
				completionText = filepath.Join(basePath, name)
			} else if strings.HasPrefix(pathToComplete, "~") {
				// Keep the ~ prefix
				home := homeDir()
				relPath := strings.TrimPrefix(basePath, home)
				if relPath == "" {
					completionText = "~/" + name
				} else {
					completionText = "~" + relPath + "/" + name
				}
			} else if strings.Contains(pathToComplete, string(os.PathSeparator)) {
				completionText = filepath.Join(filepath.Dir(pathToComplete), name)
			} else {
				completionText = name
			}

			// Add trailing slash for directories
			if entry.IsDir() {
				completionText += "/"
			}

			// Calculate score based on match quality and type
			score := calculateFilesystemScore(name, prefix, entry.IsDir())

			suggestions = append(suggestions, &pb.Suggestion{
				Text:   completionText,
				Source: "filesystem",
				Score:  score,
			})
		}
	}

	// Sort by score descending, then alphabetically
	sort.Slice(suggestions, func(i, j int) bool {
		if suggestions[i].Score != suggestions[j].Score {
			return suggestions[i].Score > suggestions[j].Score
		}
		return suggestions[i].Text < suggestions[j].Text
	})

	// Limit to reasonable number
	if len(suggestions) > 30 {
		suggestions = suggestions[:30]
	}

	return suggestions, nil
}

// calculateFilesystemScore computes a relevance score for a filesystem entry.
func calculateFilesystemScore(name, prefix string, isDir bool) float32 {
	var score float32 = 0.5 // Base score for filesystem

	// Boost for directories (more common in tab completion)
	if isDir {
		score += 0.1
	}

	// Boost for exact prefix match
	if prefix != "" && strings.HasPrefix(strings.ToLower(name), strings.ToLower(prefix)) {
		matchRatio := float32(len(prefix)) / float32(len(name))
		score += matchRatio * 0.3
	}

	// Slight penalty for hidden files (unless explicitly typed)
	if strings.HasPrefix(name, ".") && !strings.HasPrefix(prefix, ".") {
		score -= 0.2
	}

	return score
}

// homeDir returns the user's home directory.
func homeDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "/"
	}
	return home
}
