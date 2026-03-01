package suggest

import (
	"context"
	"sort"
	"strings"

	pb "github.com/entl/blockterm/gen/proto"
	"github.com/entl/blockterm/internal/history"
)

// HistoryProvider provides command suggestions based on command history.
type HistoryProvider struct {
	historySvc *history.Service
}

// NewHistoryProvider creates a new history suggestion provider.
func NewHistoryProvider(historySvc *history.Service) *HistoryProvider {
	return &HistoryProvider{
		historySvc: historySvc,
	}
}

// Name returns the provider name.
func (p *HistoryProvider) Name() string {
	return "history"
}

// GetSuggestions returns history-based suggestions matching the input prefix.
func (p *HistoryProvider) GetSuggestions(ctx context.Context, input string, cursorPos int, sessionID string) ([]*pb.Suggestion, error) {
	if input == "" {
		return nil, nil
	}

	// Search history for commands starting with the input
	commands, err := p.historySvc.Search(ctx, input, 50)
	if err != nil {
		return nil, err
	}

	// Deduplicate and score suggestions
	seen := make(map[string]struct{})
	var suggestions []*pb.Suggestion

	for i, cmd := range commands {
		cmdText := cmd.CommandText
		if _, exists := seen[cmdText]; exists {
			continue
		}
		seen[cmdText] = struct{}{}

		// Skip exact matches (no point suggesting what's already typed)
		if cmdText == input {
			continue
		}

		// Calculate score based on:
		// - Recency (newer commands score higher)
		// - Prefix match quality
		score := calculateHistoryScore(cmdText, input, i, len(commands))

		suggestions = append(suggestions, &pb.Suggestion{
			Text:   cmdText,
			Source: "history",
			Score:  score,
		})
	}

	// Sort by score descending
	sort.Slice(suggestions, func(i, j int) bool {
		return suggestions[i].Score > suggestions[j].Score
	})

	// Limit results
	if len(suggestions) > 20 {
		suggestions = suggestions[:20]
	}

	return suggestions, nil
}

// calculateHistoryScore computes a relevance score for a history entry.
func calculateHistoryScore(cmdText, input string, index, total int) float32 {
	var score float32 = 0.7 // Base score for history (higher than static)

	// Recency boost: newer commands get higher scores
	// Index 0 is most recent
	if total > 1 {
		recencyFactor := float32(total-index) / float32(total)
		score += recencyFactor * 0.15
	}

	// Prefix match quality boost
	lowerCmd := strings.ToLower(cmdText)
	lowerInput := strings.ToLower(input)

	if strings.HasPrefix(lowerCmd, lowerInput) {
		// Better match = higher score
		matchRatio := float32(len(input)) / float32(len(cmdText))
		score += matchRatio * 0.1

		// Exact case match bonus
		if strings.HasPrefix(cmdText, input) {
			score += 0.05
		}
	}

	return score
}
