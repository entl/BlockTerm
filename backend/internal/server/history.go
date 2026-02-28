package server

import (
	"context"

	pb "github.com/entl/blockterm/gen/proto"
	"github.com/entl/blockterm/internal/history"
	"github.com/entl/blockterm/internal/storage"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// HistoryServer implements pb.HistoryServiceServer.
type HistoryServer struct {
	pb.UnimplementedHistoryServiceServer
	svc *history.Service
}

// NewHistoryServer creates a HistoryServer backed by the given service.
func NewHistoryServer(svc *history.Service) *HistoryServer {
	return &HistoryServer{svc: svc}
}

// RecordCommand persists a command to history.
// The write is enqueued asynchronously; the Ack is returned immediately.
func (h *HistoryServer) RecordCommand(_ context.Context, req *pb.RecordCommandRequest) (*pb.Ack, error) {
	if req.SessionId == "" {
		return nil, status.Error(codes.InvalidArgument, "session_id is required")
	}
	// shell is unknown to the client; session_id is the primary identity.
	h.svc.RecordCommand(req.SessionId, "", req.Cwd, req.Command)
	return &pb.Ack{Ok: true}, nil
}

// QueryHistory returns recent or prefix-filtered command history.
func (h *HistoryServer) QueryHistory(ctx context.Context, req *pb.QueryHistoryRequest) (*pb.QueryHistoryResponse, error) {
	limit := int(req.Limit)
	if limit <= 0 || limit > 500 {
		limit = 100
	}

	var results []*storage.Command
	var err error

	if req.Query != "" {
		results, err = h.svc.Search(ctx, req.Query, limit)
	} else {
		results, err = h.svc.GetRecent(ctx, limit)
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to query history: %v", err)
	}

	entries := make([]*pb.RecordCommandRequest, 0, len(results))
	for _, c := range results {
		exitCode := int32(0)
		if c.ExitCode != nil {
			exitCode = int32(*c.ExitCode)
		}
		entries = append(entries, &pb.RecordCommandRequest{
			SessionId: c.SessionID,
			Command:   c.CommandText,
			Cwd:       c.Cwd,
			ExitCode:  exitCode,
			Timestamp: c.Timestamp.Unix(),
		})
	}

	return &pb.QueryHistoryResponse{Entries: entries}, nil
}
