package main

import (
	"log"
	"net"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	pb "github.com/entl/blockterm/gen/proto"
	"github.com/entl/blockterm/internal/history"
	"github.com/entl/blockterm/internal/server"
	"github.com/entl/blockterm/internal/session"
	"github.com/entl/blockterm/internal/storage"
	"github.com/entl/blockterm/internal/suggest"
	"github.com/entl/blockterm/internal/system"
	"google.golang.org/grpc"
)

// version and build are injected at link time:
//
//	go build -ldflags "-X main.version=1.0.0 -X main.build=$(git rev-parse --short HEAD)"
var (
	version = "dev"
	build   = "unknown"
)

func main() {
	// Set up logging to stdout
	log.SetOutput(os.Stdout)

	// Listen on a TCP port (could be unix socket in production)
	lis, err := net.Listen("tcp", ":50051")
	if err != nil {
		log.Fatalf("failed to listen: %v", err)
	}

	grpcServer := grpc.NewServer()

	// --- Storage & History ------------------------------------------------
	// Store the DB in ~/.blockterm/ so it persists across app restarts.
	homedir, err := os.UserHomeDir()
	if err != nil {
		log.Fatalf("failed to resolve home directory: %v", err)
	}
	dbDir := filepath.Join(homedir, ".blockterm")
	if err := os.MkdirAll(dbDir, 0o700); err != nil {
		log.Fatalf("failed to create db directory: %v", err)
	}
	db, err := storage.NewDB(filepath.Join(dbDir, "history.db"))
	if err != nil {
		log.Fatalf("failed to open history database: %v", err)
	}
	historySvc := history.NewService(db)

	// Initialize session manager
	sessionMgr := session.NewManager()

	// Initialize suggestion providers
	staticProvider := suggest.NewStaticProvider()
	historyProvider := suggest.NewHistoryProvider(historySvc)
	filesystemProvider := suggest.NewFilesystemProvider(sessionMgr)

	// Initialize services with all providers
	suggestionService := suggest.NewSuggestionService(
		historyProvider,    // History matches (highest priority)
		filesystemProvider, // Filesystem completions
		staticProvider,     // Static command suggestions (lowest priority)
	)
	sessionService := session.NewService(sessionMgr)
	systemService := system.New(version, build)

	// Register gRPC service implementations
	pb.RegisterSuggestionServiceServer(grpcServer, suggestionService)
	pb.RegisterTerminalServiceServer(grpcServer, sessionService)
	pb.RegisterSystemServiceServer(grpcServer, systemService)
	pb.RegisterHistoryServiceServer(grpcServer, server.NewHistoryServer(historySvc))

	// Graceful shutdown handling
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		log.Printf("gRPC server listening at %v", lis.Addr())
		if err := grpcServer.Serve(lis); err != nil {
			log.Fatalf("failed to serve: %v", err)
		}
	}()

	<-quit
	log.Println("Shutting down gRPC server...")
	grpcServer.GracefulStop()
	if err := historySvc.Close(); err != nil {
		log.Printf("history service close error: %v", err)
	}
	if err := db.Close(); err != nil {
		log.Printf("db close error: %v", err)
	}
	log.Println("Server stopped.")
}
