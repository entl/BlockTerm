package suggest

import (
	"context"
	"fmt"
	"log"
	"sort"
	"strings"

	pb "github.com/entl/blockterm/gen/proto"
	"github.com/entl/blockterm/internal/validators"
)

// Provider is an interface for suggestion sources (history, filesystem, static, etc.)
type Provider interface {
	GetSuggestions(ctx context.Context, input string, cursorPos int, sessionID string) ([]*pb.Suggestion, error)
	Name() string
}

// SuggestionService implements the suggestion related methods.
type SuggestionService struct {
	pb.UnimplementedSuggestionServiceServer
	providers []Provider
}

// NewSuggestionService creates a new suggestion service with the given providers.
func NewSuggestionService(providers ...Provider) *SuggestionService {
	return &SuggestionService{
		providers: providers,
	}
}

// GetSuggestions returns suggestions from all registered providers.
func (s *SuggestionService) GetSuggestions(ctx context.Context, req *pb.GetSuggestionsRequest) (*pb.GetSuggestionsResponse, error) {
	// Validate request
	if err := validators.ValidateGetSuggestionsRequest(req); err != nil {
		return nil, err
	}

	// Extract the token at cursor position for targeted suggestions
	token := extractTokenAtCursor(req.Input, int(req.CursorPos))

	// Collect suggestions from all providers
	var allSuggestions []*pb.Suggestion
	for _, provider := range s.providers {
		suggestions, err := provider.GetSuggestions(ctx, token, int(req.CursorPos), req.SessionId)
		if err != nil {
			log.Printf("provider %s error: %v", provider.Name(), err)
			continue
		}
		allSuggestions = append(allSuggestions, suggestions...)
	}

	// Sort by score (descending)
	sort.Slice(allSuggestions, func(i, j int) bool {
		return allSuggestions[i].Score > allSuggestions[j].Score
	})

	// Deduplicate suggestions (keep highest score)
	deduped := deduplicateSuggestions(allSuggestions)

	// Limit results to prevent overwhelming UI (max 50)
	if len(deduped) > 50 {
		deduped = deduped[:50]
	}

	fmt.Println("Returning suggestions:", deduped)

	return &pb.GetSuggestionsResponse{
		Suggestions: deduped,
	}, nil
}

// extractTokenAtCursor extracts the token (word) at the cursor position.
// This helps providers focus on the relevant part of the input.
func extractTokenAtCursor(input string, cursorPos int) string {
	if input == "" || cursorPos <= 0 || cursorPos > len(input) {
		return ""
	}

	// Find token boundaries (split on whitespace)
	start := cursorPos - 1
	for start > 0 && !isWhitespace(rune(input[start-1])) {
		start--
	}

	end := cursorPos
	for end < len(input) && !isWhitespace(rune(input[end])) {
		end++
	}

	return input[start:end]
}

func isWhitespace(r rune) bool {
	return r == ' ' || r == '\t' || r == '\n' || r == '\r'
}

// deduplicateSuggestions removes duplicate suggestions, keeping the one with highest score.
func deduplicateSuggestions(suggestions []*pb.Suggestion) []*pb.Suggestion {
	seen := make(map[string]*pb.Suggestion)
	for _, s := range suggestions {
		if existing, ok := seen[s.Text]; ok {
			// Keep the one with higher score
			if s.Score > existing.Score {
				seen[s.Text] = s
			}
		} else {
			seen[s.Text] = s
		}
	}

	// Convert map back to slice
	result := make([]*pb.Suggestion, 0, len(seen))
	for _, s := range seen {
		result = append(result, s)
	}

	// Re-sort by score
	sort.Slice(result, func(i, j int) bool {
		return result[i].Score > result[j].Score
	})

	return result
}

// StaticProvider provides static/builtin command suggestions.
type StaticProvider struct{}

func NewStaticProvider() *StaticProvider {
	return &StaticProvider{}
}

func (p *StaticProvider) Name() string {
	return "static"
}

func (p *StaticProvider) GetSuggestions(ctx context.Context, input string, cursorPos int, sessionID string) ([]*pb.Suggestion, error) {
	// Common shell commands
	commonCommands := []string{
		"ls", "cd", "pwd", "cat", "grep", "find", "echo", "mkdir", "rm", "cp", "mv",
		"chmod", "chown", "ps", "kill", "top", "htop", "df", "du", "tar", "zip",
		"git", "docker", "npm", "yarn", "python", "node", "go", "cargo", "make",
	}

	var suggestions []*pb.Suggestion
	lowerInput := strings.ToLower(input)

	for _, cmd := range commonCommands {
		if strings.HasPrefix(cmd, lowerInput) && cmd != input {
			// Score based on how early the match is and length
			score := float32(1.0)
			if lowerInput != "" {
				score = float32(len(lowerInput)) / float32(len(cmd))
			}

			suggestions = append(suggestions, &pb.Suggestion{
				Text:   cmd,
				Source: "static",
				Score:  score * 0.5, // Lower priority than history
			})
		}
	}

	return suggestions, nil
}
