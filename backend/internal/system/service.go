// Package system implements the blockterm.SystemService gRPC service.
// It provides health-check (Ping) and version introspection (GetVersion) RPCs.
package system

import (
	"context"
	"log"

	pb "github.com/entl/blockterm/gen/proto"
	"google.golang.org/protobuf/types/known/emptypb"
)

// Service implements pb.SystemServiceServer.
type Service struct {
	pb.UnimplementedSystemServiceServer
	version string
	build   string
}

// New creates a SystemService.
// version and build are typically injected at link time via -ldflags.
func New(version, build string) *Service {
	return &Service{
		version: version,
		build:   build,
	}
}

// Ping echoes the request message back to the caller.
// A missing message is treated as a plain liveness probe and echoes "pong".
func (s *Service) Ping(_ context.Context, req *pb.PingRequest) (*pb.PingResponse, error) {
	msg := req.GetMessage()
	if msg == "" {
		msg = "pong"
	}
	log.Printf("[system] Ping: %q", msg)
	return &pb.PingResponse{Message: msg}, nil
}

// GetVersion returns the compiled-in version and build strings.
func (s *Service) GetVersion(_ context.Context, _ *emptypb.Empty) (*pb.VersionResponse, error) {
	return &pb.VersionResponse{
		Version: s.version,
		Build:   s.build,
	}, nil
}
