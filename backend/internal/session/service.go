package session

import (
	"context"
	"fmt"
	"io"
	"log"
	"time"

	pb "github.com/entl/blockterm/gen/proto"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Service implements the gRPC TerminalServiceServer interface.
// It bridges between the gRPC layer and the session Manager.
type Service struct {
	pb.UnimplementedTerminalServiceServer
	manager *Manager
}

// NewService creates a new gRPC service for terminal sessions.
func NewService(manager *Manager) *Service {
	return &Service{
		manager: manager,
	}
}

// StartSession creates a new PTY session and returns the session ID.
func (s *Service) StartSession(ctx context.Context, req *pb.StartSessionRequest) (*pb.StartSessionResponse, error) {
	opts := SessionOptions{
		Shell: req.Shell,
		Cwd:   req.Cwd,
		Cols:  80, // Default terminal size
		Rows:  24,
	}

	// Convert env map to slice
	if len(req.Env) > 0 {
		opts.Env = make([]string, 0, len(req.Env))
		for k, v := range req.Env {
			opts.Env = append(opts.Env, fmt.Sprintf("%s=%s", k, v))
		}
	}

	session, err := s.manager.StartSession(opts)
	if err != nil {
		log.Printf("failed to start session: %v", err)
		return nil, status.Errorf(codes.Internal, "failed to start session: %v", err)
	}

	log.Printf("started session: %s", session.ID)
	return &pb.StartSessionResponse{
		SessionId: session.ID,
	}, nil
}

// CloseSession closes a session and cleans up resources.
func (s *Service) CloseSession(ctx context.Context, req *pb.CloseSessionRequest) (*pb.Ack, error) {
	if req.SessionId == "" {
		return nil, status.Error(codes.InvalidArgument, "session_id is required")
	}

	err := s.manager.CloseSession(req.SessionId)
	if err != nil {
		log.Printf("failed to close session %s: %v", req.SessionId, err)
		return nil, status.Errorf(codes.Internal, "failed to close session: %v", err)
	}

	log.Printf("closed session: %s", req.SessionId)
	return &pb.Ack{Ok: true}, nil
}

// SendInput receives a stream of input chunks from the client and writes them to the PTY.
func (s *Service) SendInput(stream pb.TerminalService_SendInputServer) error {
	for {
		fmt.Printf("waiting for input chunk...\n")
		chunk, err := stream.Recv()
		fmt.Printf("received input chunk: %+v\n", chunk)
		if err == io.EOF {
			return stream.SendAndClose(&pb.Ack{Ok: true})
		}
		if err != nil {
			log.Printf("error receiving input: %v", err)
			return status.Errorf(codes.Internal, "error receiving input: %v", err)
		}

		if chunk.SessionId == "" {
			return status.Error(codes.InvalidArgument, "session_id is required")
		}

		// Write input to session
		if err := s.manager.WriteInput(chunk.SessionId, chunk.Data); err != nil {
			log.Printf("error writing input to session %s: %v", chunk.SessionId, err)
			return status.Errorf(codes.Internal, "error writing input: %v", err)
		}
	}
}

// ReceiveOutput streams PTY output from a session to the client.
func (s *Service) ReceiveOutput(req *pb.ReceiveOutputRequest, stream pb.TerminalService_ReceiveOutputServer) error {
	if req.SessionId == "" {
		return status.Error(codes.InvalidArgument, "session_id is required")
	}

	session, err := s.manager.GetSession(req.SessionId)
	if err != nil {
		return status.Errorf(codes.NotFound, "session not found: %v", err)
	}

	// Create a pipe to receive output from the session
	pr, pw := io.Pipe()
	defer pr.Close()

	// Add the pipe writer as an output subscriber
	if err := s.manager.AddOutputWriter(req.SessionId, pw); err != nil {
		return status.Errorf(codes.Internal, "failed to subscribe to output: %v", err)
	}

	// Stream output to client
	buf := make([]byte, 4096)
	done := make(chan error, 1)

	// Read output in a goroutine to avoid blocking
	go func() {
		for {
			n, err := pr.Read(buf)
			if err != nil {
				done <- err
				return
			}
			if n > 0 {
				chunk := &pb.OutputChunk{
					SessionId: req.SessionId,
					Data:      append([]byte(nil), buf[:n]...),
				}
				fmt.Printf("sending output chunk: %+v\n", chunk)
				if err := stream.Send(chunk); err != nil {
					done <- err
					return
				}
			}
		}
	}()

	// Monitor session and context
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-stream.Context().Done():
			pw.Close()
			<-done
			return stream.Context().Err()

		case err := <-done:
			pw.Close()
			if err == io.EOF {
				return nil
			}
			log.Printf("error streaming output for session %s: %v", req.SessionId, err)
			return status.Errorf(codes.Internal, "error streaming output: %v", err)

		case <-ticker.C:
			// Periodically check if session is still running
			session.mu.RLock()
			sessionState := session.State
			session.mu.RUnlock()

			if sessionState != StateRunning {
				pw.Close()
				<-done
				log.Printf("session %s is no longer running, closing output stream", req.SessionId)
				return nil
			}
		}
	}
}

// ResizeSession updates the terminal window size for a session.
func (s *Service) ResizeSession(ctx context.Context, req *pb.ResizeSessionRequest) (*pb.Ack, error) {
	if req.SessionId == "" {
		return nil, status.Error(codes.InvalidArgument, "session_id is required")
	}

	if req.Cols == 0 || req.Rows == 0 {
		return nil, status.Error(codes.InvalidArgument, "cols and rows must be greater than 0")
	}

	err := s.manager.ResizeSession(req.SessionId, int(req.Cols), int(req.Rows))
	if err != nil {
		log.Printf("failed to resize session %s: %v", req.SessionId, err)
		return nil, status.Errorf(codes.Internal, "failed to resize session: %v", err)
	}

	return &pb.Ack{Ok: true}, nil
}
