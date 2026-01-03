package validators

import (
	pb "github.com/entl/blockterm/gen/proto"
	"google.golang.org/genproto/googleapis/rpc/errdetails"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func addViolation(violations *[]*errdetails.BadRequest_FieldViolation, field, desc string) {
	*violations = append(*violations, &errdetails.BadRequest_FieldViolation{
		Field:       field,
		Description: desc,
	})
}

func returnIfViolations(violations []*errdetails.BadRequest_FieldViolation) error {
	if len(violations) == 0 {
		return nil
	}
	st := status.New(codes.InvalidArgument, "validation failed")
	br := &errdetails.BadRequest{FieldViolations: violations}
	stWithDetails, err := st.WithDetails(br)
	if err != nil {
		return st.Err()
	}
	return stWithDetails.Err()
}

func ValidateGetSuggestionsRequest(req *pb.GetSuggestionsRequest) error {
	var violations []*errdetails.BadRequest_FieldViolation

	if req == nil {
		addViolation(&violations, "request", "request cannot be nil")
		return returnIfViolations(violations)
	}

	if req.SessionId == "" {
		addViolation(&violations, "session_id", "session_id is required")
	}

	// Input can be empty (for initial suggestions or when cursor is at beginning)
	// but if provided, cursor_pos should be valid
	if req.Input != "" {
		inputLen := uint32(len(req.Input))
		if req.CursorPos > inputLen {
			addViolation(&violations, "cursor_pos", "cursor_pos exceeds input length")
		}
	} else {
		// Empty input should have cursor_pos at 0
		if req.CursorPos != 0 {
			addViolation(&violations, "cursor_pos", "cursor_pos must be 0 for empty input")
		}
	}

	return returnIfViolations(violations)
}

// ValidateSuggestion validates a Suggestion message.
func ValidateSuggestion(s *pb.Suggestion) error {
	var violations []*errdetails.BadRequest_FieldViolation

	if s == nil {
		addViolation(&violations, "suggestion", "suggestion cannot be nil")
		return returnIfViolations(violations)
	}

	if s.Text == "" {
		addViolation(&violations, "text", "suggestion text is required")
	}

	if s.Source == "" {
		addViolation(&violations, "source", "suggestion source is required")
	}

	if s.Score < 0.0 || s.Score > 1.0 {
		addViolation(&violations, "score", "score must be between 0.0 and 1.0")
	}

	return returnIfViolations(violations)
}
